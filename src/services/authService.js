import { supabase } from './supabaseClient'

const AUTH_TIMEOUT_MS = 15000

const withAuthTimeout = async (promise, label) => {
    let timeoutId
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${label}がタイムアウトしました。少し待ってから再試行してください。`))
        }, AUTH_TIMEOUT_MS)
    })

    try {
        return await Promise.race([promise, timeoutPromise])
    } catch (error) {
        return { data: null, error }
    } finally {
        clearTimeout(timeoutId)
    }
}

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

// パスワード再設定メール送信
export const requestPasswordReset = async (email) => {
    const redirectTo = `${window.location.origin}/reset-password`
    const { data, error } = await withAuthTimeout(
        supabase.auth.resetPasswordForEmail(email, { redirectTo }),
        'パスワード再設定メール送信'
    )
    return { data, error }
}

// パスワード再設定リンクから戻った時の一時セッション復元
export const recoverPasswordSessionFromUrl = async () => {
    const searchParams = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const code = searchParams.get('code') || hashParams.get('code')
    const accessToken = hashParams.get('access_token') || searchParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token')

    if (code) {
        const result = await withAuthTimeout(
            supabase.auth.exchangeCodeForSession(code),
            'パスワード再設定セッション復元'
        )
        if (result.error) return result
        window.history.replaceState({}, document.title, '/reset-password')
        return result
    }

    if (accessToken && refreshToken) {
        const result = await withAuthTimeout(
            supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken
            }),
            'パスワード再設定セッション復元'
        )
        if (result.error) return result
        window.history.replaceState({}, document.title, '/reset-password')
        return result
    }

    const { data, error } = await withAuthTimeout(
        supabase.auth.getSession(),
        'パスワード再設定セッション確認'
    )
    if (error) return { data, error }
    if (!data?.session) {
        return {
            data,
            error: new Error('再設定用の認証情報が見つかりません。メール内の最新リンクから開き直してください。')
        }
    }
    return { data, error: null }
}

// パスワード更新
export const updatePassword = async (password) => {
    const { data, error } = await withAuthTimeout(
        supabase.auth.updateUser({ password }),
        'パスワード更新'
    )
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
