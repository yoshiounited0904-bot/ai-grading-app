import { supabase } from './supabaseClient';
import { MARKETING_CONFIG } from '../config/marketingConfig';

export const FREE_ACCESS_PROMO_CODE = MARKETING_CONFIG.promoCode || 'SUMASAI2026';
const LOCAL_VERIFIED_KEY = 'smashai_free_access_promo_verified';
const LOCAL_GRADED_COUNT_KEY = 'smashai_local_graded_count';

export const normalizePromoCode = (value) => (
    String(value || '')
        .normalize('NFKC')
        .toUpperCase()
        .replace(/[\s\-ー_]/g, '')
);

export const isValidFreeAccessPromoCode = (value) => {
    const normalizedInput = normalizePromoCode(value);
    const validCodes = [
        normalizePromoCode(MARKETING_CONFIG.promoCode || FREE_ACCESS_PROMO_CODE),
        normalizePromoCode('SUMASAI2026')
    ];
    return validCodes.includes(normalizedInput);
};

export const getLocalPromoVerified = () => (
    localStorage.getItem(LOCAL_VERIFIED_KEY) === 'true'
);

export const markLocalPromoVerified = () => {
    localStorage.setItem(LOCAL_VERIFIED_KEY, 'true');
};

export const getLocalGradedCount = () => {
    const raw = Number(localStorage.getItem(LOCAL_GRADED_COUNT_KEY) || 0);
    if (Number.isFinite(raw)) return Math.max(raw, localStorage.getItem('smashai_guest_graded') === 'true' ? 1 : 0);
    return localStorage.getItem('smashai_guest_graded') === 'true' ? 1 : 0;
};

export const incrementLocalGradedCount = () => {
    const next = getLocalGradedCount() + 1;
    localStorage.setItem(LOCAL_GRADED_COUNT_KEY, String(next));
    return next;
};

export const getUserPromoVerified = async (userId) => {
    if (!userId) return getLocalPromoVerified();

    const { data, error } = await supabase
        .from('profiles')
        .select('promo_code_verified')
        .eq('id', userId)
        .single();

    if (error) {
        const message = String(error?.message || error?.details || '');
        if (message.includes('promo_code_verified')) return getLocalPromoVerified();
        throw error;
    }

    return Boolean(data?.promo_code_verified) || getLocalPromoVerified();
};

export const markUserPromoVerified = async (userId, promoCode) => {
    markLocalPromoVerified();
    if (!userId) return { error: null };

    const { error } = await supabase
        .from('profiles')
        .update({
            promo_code_verified: true,
            promo_code_verified_at: new Date().toISOString(),
            promo_code_value: normalizePromoCode(promoCode)
        })
        .eq('id', userId);

    if (error) {
        const message = String(error?.message || error?.details || '');
        if (message.includes('promo_code_verified') || message.includes('promo_code_verified_at') || message.includes('promo_code_value')) {
            return { error: null };
        }
    }

    return { error };
};

export const getUserGradingCount = async (userId) => {
    if (!userId) return getLocalGradedCount();

    const { count, error } = await supabase
        .from('exam_results')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

    if (error) throw error;
    return Math.max(Number(count || 0), getLocalGradedCount());
};
