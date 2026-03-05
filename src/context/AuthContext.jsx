import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null)
    const [profile, setProfile] = useState(null)
    const [loading, setLoading] = useState(true)

    // Fetch user profile from the profiles table with retry and backoff
    const fetchProfile = useCallback(async (userId, retries = 3, delay = 1000) => {
        for (let i = 0; i < retries; i++) {
            const timeoutPromise = new Promise((_, reject) => {
                const timer = setTimeout(() => reject(new Error('Timeout')), 10000); // 10s timeout per attempt
                return () => clearTimeout(timer);
            });

            try {
                const fetchPromise = supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', userId)
                    .single();

                const result = await Promise.race([fetchPromise, timeoutPromise]);
                const { data, error } = result;

                if (error) {
                    // PGRST116 is "JSON object requested, but no rows returned"
                    if (error.code === 'PGRST116' && i < retries - 1) {
                        console.log(`[Auth] Profile not found, retrying (${i + 1}/${retries})...`);
                        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
                        continue;
                    }
                    throw error;
                }
                return data;
            } catch (error) {
                console.error(`[Auth] Profile fetch attempt ${i + 1} failed:`, error.message);
                if (i === retries - 1) return null;
                await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
            }
        }
        return null;
    }, []);

    useEffect(() => {
        let mounted = true;
        let authListener = null;

        const handleAuthChange = async (event, session) => {
            if (!mounted) return;

            const currentUser = session?.user ?? null;
            setUser(currentUser);

            if (currentUser) {
                try {
                    // Small delay to let the trigger create the profile for new users
                    if (event === 'SIGNED_IN') {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }

                    const p = await fetchProfile(currentUser.id);

                    if (mounted) {
                        setProfile(prevProfile => {
                            if (p) return p;
                            // If we already have a profile and fetch failed (null), KEEP the old one
                            // This prevents intermittent network errors from kicking users out
                            if (prevProfile) {
                                console.warn("[Auth] Profile re-fetch failed, preserving current session to avoid lockout.");
                                return prevProfile;
                            }
                            return null;
                        });
                        setLoading(false);
                    }
                } catch (err) {
                    console.error("Profile load error:", err);
                    if (mounted) setLoading(false);
                }
            } else {
                if (mounted) {
                    setProfile(null);
                    setLoading(false);
                }
            }
        };

        const init = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            await handleAuthChange('INITIAL', session);

            if (mounted) {
                const { data: { subscription } } = supabase.auth.onAuthStateChange(handleAuthChange);
                authListener = subscription;
            }
        };

        init();

        return () => {
            mounted = false;
            if (authListener) authListener.unsubscribe();
        };
    }, [fetchProfile]);

    const signInWithGoogle = useCallback(async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin,
            }
        })
        if (error) {
            console.error('Error signing in with Google:', error)
            throw error
        }
    }, []);

    const signOut = useCallback(async () => {
        if (user && profile) {
            await supabase.from('audit_logs').insert({
                actor_id: user.id,
                action: 'user_logout',
                target_email: profile.email,
            })
        }
        const { error } = await supabase.auth.signOut()
        if (error) console.error('Error signing out:', error)
    }, [user, profile]);

    const refreshProfile = useCallback(async () => {
        if (user) {
            const p = await fetchProfile(user.id)
            if (p) setProfile(p)
        }
    }, [user, fetchProfile]);

    const value = useMemo(() => ({
        user,
        profile,
        loading,
        signInWithGoogle,
        signOut,
        refreshProfile,
        isAdmin: profile?.role === 'admin',
        isActive: profile?.is_active === true,
    }), [user, profile, loading, signInWithGoogle, signOut, refreshProfile]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}
