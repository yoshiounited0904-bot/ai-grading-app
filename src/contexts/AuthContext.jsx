import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { getCurrentUser, onAuthStateChange, getUserProfile } from '../services/authService'

const AuthContext = createContext({})

export const useAuth = () => useContext(AuthContext)

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null)
    const [profile, setProfile] = useState(null)
    const [loading, setLoading] = useState(true)

    const buildFallbackProfile = (authUser) => ({
        username: authUser?.user_metadata?.username || authUser?.email?.split('@')[0] || 'ゲストユーザー',
        first_choice_university: '',
        grade: ''
    })

    const withTimeout = (promise, ms, message) => Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
    ])

    const fetchProfile = async (authUser) => {
        try {
            if (!authUser?.id) return
            console.log('Fetching profile for userId:', authUser.id)
            const { data, error } = await withTimeout(
                getUserProfile(authUser.id),
                8000,
                'プロフィール取得がタイムアウトしました。'
            )
            if (error) {
                console.error('getUserProfile error:', error)
                if (error.code === 'PGRST116' || error.message.includes('406')) {
                    console.log('Profile does not exist yet. Using guest profile.')
                    setProfile(buildFallbackProfile(authUser))
                } else {
                    console.error('Error fetching profile:', error)
                    setProfile(buildFallbackProfile(authUser))
                }
            } else if (data) {
                console.log('Fetched profile data:', data)
                setProfile(data)
            } else {
                setProfile(buildFallbackProfile(authUser))
            }
        } catch (err) {
            console.error('Error fetching profile catch:', err)
            setProfile(buildFallbackProfile(authUser))
        }
    }

    useEffect(() => {
        // Initial auth check
        getCurrentUser().then((u) => {
            setUser(u)
            if (u) {
                fetchProfile(u)
            } else {
                setProfile(null)
            }
            setLoading(false)
        }).catch(() => setLoading(false))

        // Auth state listener
        const { data: { subscription } } = onAuthStateChange((event, session) => {
            const u = session?.user ?? null
            setUser(u)
            if (u) {
                fetchProfile(u)
            } else {
                setProfile(null)
            }
            setLoading(false)
        })

        // Safety timeout to ensure loading always resolves
        const safetyTimer = setTimeout(() => {
            setLoading(false)
        }, 5000)

        return () => {
            subscription.unsubscribe()
            clearTimeout(safetyTimer)
        }
    }, [])

    const refreshProfile = useCallback(async () => {
        if (!user) return
        await fetchProfile(user)
    }, [user])

    return (
        <AuthContext.Provider value={{ user, profile, loading, refreshProfile }}>
            {children}
        </AuthContext.Provider>
    )
}
