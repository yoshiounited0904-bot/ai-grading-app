import { supabase } from './supabaseClient';

export const createPremiumCheckoutSession = async () => {
    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: {}
    });

    if (error) {
        throw new Error(error.message || '決済ページの作成に失敗しました。');
    }

    if (!data?.url) {
        throw new Error(data?.error || '決済ページのURLを取得できませんでした。');
    }

    return data.url;
};

export const createBillingPortalSession = async () => {
    const { data, error } = await supabase.functions.invoke('create-billing-portal-session', {
        body: {}
    });

    if (error) {
        throw new Error(error.message || '契約管理ページの作成に失敗しました。');
    }

    if (!data?.url) {
        throw new Error(data?.error || '契約管理ページのURLを取得できませんでした。');
    }

    return data.url;
};
