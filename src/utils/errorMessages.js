const SUPABASE_SERVICE_RESTRICTED_PATTERNS = [
    /Service for this project is restricted/i,
    /exceed_egress_quota/i,
    /remove spend caps/i,
    /upgrade their plan/i
];

const NETWORK_ERROR_PATTERNS = [
    /Failed to fetch/i,
    /NetworkError/i,
    /Load failed/i
];

const TIMEOUT_ERROR_PATTERNS = [
    /timeout/i,
    /タイムアウト/i
];

const getRawErrorMessage = (error) => {
    if (!error) return '';
    if (typeof error === 'string') return error;

    return [
        error.message,
        error.details,
        error.hint,
        error.code
    ].filter(Boolean).join(' ');
};

export const toUserFacingErrorMessage = (error, fallback = 'エラーが発生しました。時間をおいて再度お試しください。') => {
    const rawMessage = getRawErrorMessage(error);

    if (!rawMessage) return fallback;

    if (SUPABASE_SERVICE_RESTRICTED_PATTERNS.some(pattern => pattern.test(rawMessage))) {
        return '現在、サーバーの利用上限に達しているため、一時的にログインやデータ取得ができません。復旧までしばらくお待ちください。';
    }

    if (NETWORK_ERROR_PATTERNS.some(pattern => pattern.test(rawMessage))) {
        return 'サーバーに接続できませんでした。通信環境を確認し、時間をおいて再度お試しください。';
    }

    if (TIMEOUT_ERROR_PATTERNS.some(pattern => pattern.test(rawMessage))) {
        return '接続がタイムアウトしました。時間をおいて再度お試しください。';
    }

    return rawMessage || fallback;
};

export const toAuthErrorMessage = (error) => {
    const rawMessage = getRawErrorMessage(error);

    if (rawMessage === 'Invalid login credentials') {
        return 'メールアドレスまたはパスワードが正しくありません';
    }

    if (/Email not confirmed/i.test(rawMessage)) {
        return 'メール認証が完了していません。登録時に届いた確認メールを開いてください。';
    }

    return toUserFacingErrorMessage(error, '認証処理に失敗しました。時間をおいて再度お試しください。');
};
