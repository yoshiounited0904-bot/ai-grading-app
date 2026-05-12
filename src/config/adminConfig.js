// Reference list only — NOT used for access control.
// Admin role is granted exclusively via the Supabase dashboard:
//   Table Editor → profiles → set role = 'admin' for the target user.
export const ADMIN_EMAILS = [
    'yoshiounited0904@gmail.com',
    'se-support@success-edge.net',
];

export const isAdminEmail = (email) => {
    return ADMIN_EMAILS.includes(email);
};
