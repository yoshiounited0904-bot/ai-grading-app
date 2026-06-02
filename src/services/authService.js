import { supabase } from './supabaseClient'

// サインアップ
export const signUp = async (email, password, username, firstChoiceUniversity, grade, termsAgreed = false) => {
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
    })

    if (error) return { data, error }

    // プロフィール作成
    if (data.user) {
        const { error: profileError } = await supabase
            .from('profiles')
            .insert([
                {
                    id: data.user.id,
                    username,
                    first_choice_university: firstChoiceUniversity,
                    grade,
                    approval_status: 'pending',
                    terms_agreed_at: termsAgreed ? new Date().toISOString() : null
                }
            ])
        if (profileError) console.error('Profile creation error:', profileError)
    }

    return { data, error }
}

// ログイン
export const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    })
    return { data, error }
}

// ログアウト
export const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
}

// 現在のユーザー取得
export const getCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    return user
}

// ユーザープロフィール取得
export const getUserProfile = async (userId) => {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
    return { data, error }
}

// セッション監視
export const onAuthStateChange = (callback) => {
    return supabase.auth.onAuthStateChange(callback)
}
