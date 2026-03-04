import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null)
    const [profile, setProfile] = useState(null)
    const [loading, setLoading] = useState(true)

    // Fetch user profile from the profiles table
    async function fetchProfile(userId) {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single()

        if (error) {
            console.error('Error fetching profile:', error)
            return null
        }
        return data
    }

    useEffect(() => {
        // Check initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null)
            if (session?.user) {
                fetchProfile(session.user.id).then(p => {
                    setProfile(p)
                    setLoading(false)
                })
            } else {
                setLoading(false)
            }
        })

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                setUser(session?.user ?? null)
                if (session?.user) {
                    // Small delay to let the trigger create the profile
                    if (event === 'SIGNED_IN') {
                        await new Promise(resolve => setTimeout(resolve, 1000))
                    }
                    const p = await fetchProfile(session.user.id)
                    setProfile(p)
                } else {
                    setProfile(null)
                }
                setLoading(false)
            }
        )

        return () => subscription.unsubscribe()
    }, [])

    async function signInWithGoogle() {
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
    }

    async function signOut() {
        // Log the logout
        if (user && profile) {
            await supabase.from('audit_logs').insert({
                actor_id: user.id,
                action: 'user_logout',
                target_email: profile.email,
            })
        }
        const { error } = await supabase.auth.signOut()
        if (error) console.error('Error signing out:', error)
    }

    // Refresh profile data (useful after admin changes)
    async function refreshProfile() {
        if (user) {
            const p = await fetchProfile(user.id)
            setProfile(p)
        }
    }

    const value = {
        user,
        profile,
        loading,
        signInWithGoogle,
        signOut,
        refreshProfile,
        isAdmin: profile?.role === 'admin',
        isActive: profile?.is_active === true,
    }

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
