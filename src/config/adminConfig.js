export const ADMIN_EMAILS = [
    // ここに管理者権限を与えたいGoogle/Emailアカウントのアドレスを追加してください
    'yoshiounited0904@gmail.com',
    'se-support@success-edge.net',
    'admin@example.com',
];

export const isAdminEmail = (email) => {
    return email && ADMIN_EMAILS.includes(email);
};
