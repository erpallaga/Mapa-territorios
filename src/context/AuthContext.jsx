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
            // El `return` dentro del executor de una Promise no hace nada, así
            // que el timer nunca se limpiaba: se guarda fuera y se limpia en el
            // finally.
            let timer;
            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Timeout')), 10000); // 10s timeout per attempt
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
            } finally {
                clearTimeout(timer);
            }
        }
        return null;
    }, []);

    useEffect(() => {
        let mounted = true;
        let authListener = null;
        // Cada evento de auth incrementa esto. Si llega uno nuevo mientras el
        // anterior aún espera su perfil (p. ej. SIGNED_OUT durante el fetch de
        // SIGNED_IN), el viejo no debe pisar el estado con un perfil caducado.
        let ultimoEvento = 0;

        const handleAuthChange = async (event, session) => {
            if (!mounted) return;
            const esteEvento = ++ultimoEvento;
            const vigente = () => mounted && esteEvento === ultimoEvento;

            const currentUser = session?.user ?? null;
            setUser(currentUser);

            if (currentUser) {
                try {
                    // Small delay to let the trigger create the profile for new users
                    if (event === 'SIGNED_IN') {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }

                    const p = await fetchProfile(currentUser.id);

                    if (vigente()) {
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
                    if (vigente()) setLoading(false);
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
                const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
                    // INITIAL_SESSION repite la sesión que ya ha procesado
                    // `getSession()` arriba: atenderlo duplicaba el fetch del perfil.
                    if (event === 'INITIAL_SESSION') return;
                    // supabase-js ejecuta este callback mientras retiene su lock
                    // de auth. Hacer `await` aquí de otra llamada a Supabase (el
                    // fetch del perfil) puede quedarse bloqueado esperando ese
                    // mismo lock; la documentación pide diferirlo fuera del
                    // callback. Es la causa probable de los "Timeout" del perfil.
                    setTimeout(() => handleAuthChange(event, session), 0);
                });
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
        // El registro de auditoría es secundario: si falla (sin red, RLS), el
        // usuario tiene que poder cerrar sesión igualmente.
        if (user && profile) {
            try {
                await supabase.from('audit_logs').insert({
                    actor_id: user.id,
                    action: 'user_logout',
                    target_email: profile.email,
                })
            } catch (err) {
                console.warn('[Auth] Could not write logout audit log:', err)
            }
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

// El hook vive aquí a propósito, junto al contexto que consume: separarlo en
// otro fichero solo para contentar a react-refresh obligaría a tocar todos los
// imports de la app. El coste es que el Fast Refresh de este fichero recarga el
// módulo entero en vez de preservar el estado.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
    const context = useContext(AuthContext)
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}
