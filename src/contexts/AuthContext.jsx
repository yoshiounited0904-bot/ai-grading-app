import { createContext, useContext, useEffect, useState } from 'react'
import { getCurrentUser, onAuthStateChange, getUserProfile } from '../services/authService'

const AuthContext = createContext({})

export const useAuth = () => useContext(AuthContext)

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null)
    const [profile, setProfile] = useState(null)
    const [loading, setLoading] = useState(true)

    const fetchProfile = async (userId) => {
        try {
            console.log('Fetching profile for userId:', userId)
            const { data, error } = await getUserProfile(userId)
            if (error) {
                console.error('getUserProfile error:', error)
                if (error.code === 'PGRST116' || error.message.includes('406')) {
                    console.log('Profile does not exist yet. Using guest profile.')
                    setProfile({ username: 'ゲストユーザー', first_choice_university: '', grade: '' })
                } else {
                    console.error('Error fetching profile:', error)
                }
            } else if (data) {
                console.log('Fetched profile data:', data)
                setProfile(data)
            }
        } catch (err) {
            console.error('Error fetching profile catch:', err)
        }
    }

    useEffect(() => {
        // Initial auth check
        getCurrentUser().then((u) => {
            setUser(u)
            if (u) fetchProfile(u.id)
            setLoading(false)
        }).catch(() => setLoading(false))

        // Auth state listener
        const { data: { subscription } } = onAuthStateChange((event, session) => {
            const u = session?.user ?? null
            setUser(u)
            if (u) {
                fetchProfile(u.id)
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

    return (
        <AuthContext.Provider value={{ user, profile, loading }}>
            {children}
        </AuthContext.Provider>
    )
}
