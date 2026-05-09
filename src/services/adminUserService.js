import { supabase } from './supabaseClient';

/**
 * すべてのユーザープロフィールを取得する
 * （管理者が承認待ちリストを確認するために使用）
 */
export const getAdminProfiles = async () => {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
    return { data, error };
};

/**
 * ユーザーの承認ステータスを更新する
 */
export const updateUserApprovalStatus = async (userId, status) => {
    const { data, error } = await supabase
        .from('profiles')
        .update({ approval_status: status })
        .eq('id', userId);
    return { data, error };
};

/**
 * ユーザーを管理者として追加・削除する（ role の更新 ）
 */
export const updateUserRole = async (userId, role) => {
    const { data, error } = await supabase
        .from('profiles')
        .update({ role: role })
        .eq('id', userId);
    return { data, error };
};
