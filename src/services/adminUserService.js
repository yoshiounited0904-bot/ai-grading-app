import { supabase } from './supabaseClient';

/**
 * すべてのユーザープロフィールを取得する
 */
export const getAdminProfiles = async () => {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
    return { data, error };
};

/**
 * ユーザーを管理者として追加・削除する（ role の更新 ）
 */
export const updateUserRole = async (userId, role) => {
    const { data, error } = await supabase.functions.invoke('admin-update-profile', {
        body: { userId, role }
    });
    return { data, error };
};

/**
 * ユーザーの課金プランを更新する
 */
export const updateUserPlan = async (userId, plan) => {
    const { data, error } = await supabase.functions.invoke('admin-update-profile', {
        body: { userId, plan }
    });
    return { data, error };
};

/**
 * auth.usersからメールアドレスのマッピングを取得する（管理者専用）
 * @returns {{ emailMap: Record<string, string> } | null}
 */
export const getAdminUserEmails = async () => {
    const { data, error } = await supabase.functions.invoke('admin-update-profile', {
        method: 'GET',
    });
    if (error) {
        console.error('Failed to fetch user emails:', error);
        return null;
    }
    return data;
};
