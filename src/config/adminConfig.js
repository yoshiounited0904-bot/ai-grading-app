// UI表示の補助用途のみ。アクセス制御には使用しない。
// 実際の権限管理は Supabase RLS + profiles.role = 'admin' で行う。
// 管理者を追加・削除する場合は Supabase の profiles テーブルを更新すること。
export const ADMIN_EMAILS = [
    'yoshiounited0904@gmail.com',
    'se-support@success-edge.net',
];

export const isAdminEmail = (email) => {
    if (!email) return false;
    return ADMIN_EMAILS.includes(email);
};
