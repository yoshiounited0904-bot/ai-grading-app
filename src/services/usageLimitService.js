import { supabase } from './supabaseClient';
import { MARKETING_CONFIG } from '../config/marketingConfig';

export const USAGE_LIMITS = {
    guest: 1,
    free: 3,
    consultation: 7,
    premium: null
};

export const PLAN_TYPES = {
    GUEST: 'guest',
    FREE: 'free',
    CONSULTATION: 'consultation',
    PREMIUM: 'premium',
    ADMIN: 'admin'
};

const normalizeUsageStatus = (value) => {
    if (!value) return null;
    return {
        allowed: Boolean(value.allowed),
        reason: value.reason || null,
        used: Number(value.used || 0),
        limit: value.limit === null || value.limit === undefined ? null : Number(value.limit),
        remaining: value.remaining === null || value.remaining === undefined ? null : Number(value.remaining || 0),
        plan: value.plan || 'free'
    };
};

export const isLaunchPremiumAccessActive = (now = new Date()) => {
    const config = MARKETING_CONFIG.launchPremiumAccess;
    if (!config?.enabled) return false;
    const endsAt = config.endsAt ? new Date(config.endsAt).getTime() : 0;
    return Number.isFinite(endsAt) && endsAt > now.getTime();
};

export const getLaunchPremiumUsageStatus = () => ({
    allowed: true,
    used: 0,
    limit: null,
    remaining: null,
    plan: PLAN_TYPES.PREMIUM
});

export const getGuestUsageStatus = () => {
    if (isLaunchPremiumAccessActive()) return getLaunchPremiumUsageStatus();

    const used = localStorage.getItem('smashai_guest_graded') === 'true' ? 1 : 0;
    const limit = USAGE_LIMITS.guest;
    return {
        allowed: used < limit,
        used,
        limit,
        remaining: Math.max(limit - used, 0),
        plan: 'guest'
    };
};

export const getGradingUsageStatus = async (user) => {
    if (isLaunchPremiumAccessActive()) return { data: getLaunchPremiumUsageStatus(), error: null };
    if (!user) return getGuestUsageStatus();

    const { data, error } = await supabase.rpc('get_grading_usage_status');
    if (error) return { data: null, error };

    return { data: normalizeUsageStatus(data), error: null };
};

export const consumeGradingUsage = async (user, examId = null) => {
    if (isLaunchPremiumAccessActive()) return { data: getLaunchPremiumUsageStatus(), error: null };
    if (!user) return { data: getGuestUsageStatus(), error: null };

    const { data, error } = await supabase.rpc('consume_grading_usage', {
        p_exam_id: examId
    });
    if (error) return { data: null, error };

    return { data: normalizeUsageStatus(data), error: null };
};

export const getUsagePlanLabel = (plan) => {
    switch (plan) {
        case 'admin':
            return '管理者';
        case 'premium':
            return 'プレミアム';
        case 'consultation':
            return '答案相談申込済み';
        case 'guest':
            return 'ゲスト';
        default:
            return '無料会員';
    }
};

export const getUserPlan = (profile, usageStatus) => {
    if (profile?.role === 'admin') return PLAN_TYPES.ADMIN;
    if (isLaunchPremiumAccessActive()) return PLAN_TYPES.PREMIUM;
    const subscriptionStatus = String(profile?.subscription_status || '');
    const premiumUntil = profile?.premium_until ? new Date(profile.premium_until).getTime() : 0;
    const hasActivePremiumUntil = Number.isFinite(premiumUntil) && premiumUntil > Date.now();
    if (profile?.plan === PLAN_TYPES.PREMIUM && (subscriptionStatus === '' || ['active', 'trialing', 'past_due'].includes(subscriptionStatus) || hasActivePremiumUntil)) {
        return PLAN_TYPES.PREMIUM;
    }
    if (profile?.subscription_plan === PLAN_TYPES.PREMIUM && (subscriptionStatus === '' || ['active', 'trialing', 'past_due'].includes(subscriptionStatus) || hasActivePremiumUntil)) {
        return PLAN_TYPES.PREMIUM;
    }
    if (['active', 'trialing', 'past_due'].includes(subscriptionStatus) || hasActivePremiumUntil) return PLAN_TYPES.PREMIUM;
    if (profile?.is_premium) return PLAN_TYPES.PREMIUM;
    if (usageStatus?.plan) return usageStatus.plan;
    if (profile?.plan) return profile.plan;
    if (profile?.subscription_plan) return profile.subscription_plan;
    return profile ? PLAN_TYPES.FREE : PLAN_TYPES.GUEST;
};

export const isPremiumPlan = (plan) => (
    plan === PLAN_TYPES.PREMIUM || plan === PLAN_TYPES.ADMIN
);

export const getPlanFeatures = (plan) => {
    const premium = isPremiumPlan(plan);
    return {
        unlimitedGrading: premium,
        fullPassJudgement: premium,
        detailedExplanations: premium,
        aiQuestions: premium,
        history: premium,
        consultation: true
    };
};
