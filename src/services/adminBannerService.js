import { supabase } from './supabaseClient';

const ACTIVE_BANNER_SELECT = [
    'id',
    'title',
    'image_url',
    'target_url',
    'layout_type',
    'page_target',
    'slot',
    'slots',
    'target_audience',
    'priority',
    'width_percent',
    'description',
    'button_text',
    'university',
    'faculty',
    'subject',
    'year',
    'created_at'
].join(',');

const LEGACY_ACTIVE_BANNER_SELECT = ACTIVE_BANNER_SELECT
    .split(',')
    .filter(column => !['slots', 'width_percent'].includes(column))
    .join(',');

const trackedImpressionKeys = new Set();

export const AD_SLOTS = [
    { value: 'home_hero', label: 'ホーム：大学選択前', pageTarget: 'home' },
    { value: 'exam_pre_submit', label: '採点前：開始/提出付近', pageTarget: 'exam' },
    { value: 'result_top', label: '結果：上部', pageTarget: 'result' },
    { value: 'result_premium_lock', label: '結果：詳細解説ロック', pageTarget: 'result' },
    { value: 'result_ai_chat_lock', label: '結果：AI質問ロック', pageTarget: 'result' },
    { value: 'mypage_top', label: 'マイページ：上部', pageTarget: 'dashboard' },
    { value: 'mypage_history_lock', label: 'マイページ：履歴ロック', pageTarget: 'dashboard' },
];

export const AD_TARGETABLE_SLOTS = ['exam_pre_submit', 'result_top', 'result_premium_lock', 'result_ai_chat_lock'];

export const AD_AUDIENCES = [
    { value: 'all', label: '全員' },
    { value: 'guest', label: '未ログイン' },
    { value: 'free', label: '無料会員' },
    { value: 'premium', label: 'プレミアム会員' },
];

export const getSlotLabel = (slot) => slot === 'all'
    ? '全枠共通'
    : AD_SLOTS.find(item => item.value === slot)?.label || slot || '未設定';
export const getAudienceLabel = (audience) => AD_AUDIENCES.find(item => item.value === audience)?.label || audience || '全員';
export const getPageTargetForSlot = (slot) => AD_SLOTS.find(item => item.value === slot)?.pageTarget || 'all';
export const normalizeBannerSlots = (banner = {}) => {
    if (Array.isArray(banner.slots) && banner.slots.length > 0) {
        return banner.slots.filter(Boolean);
    }
    return [banner.slot || banner.page_target || 'all'];
};
export const getSlotLabels = (banner = {}) => normalizeBannerSlots(banner).map(getSlotLabel).join(' / ');
export const canTargetByExamData = (slots = []) => slots.some(slot => AD_TARGETABLE_SLOTS.includes(slot));
export const clampBannerWidthPercent = (value) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return 100;
    return Math.min(100, Math.max(30, Math.round(next)));
};

const normalizeText = (value) => String(value || '').replace(/\s+/g, '').toLowerCase();

const matchesOptionalField = (bannerValue, contextValue) => {
    if (!bannerValue) return true;
    if (!contextValue) return false;
    return normalizeText(contextValue).includes(normalizeText(bannerValue));
};

const getSpecificityScore = (banner) => {
    return ['university', 'faculty', 'subject', 'year'].reduce((score, key) => score + (banner?.[key] ? 1 : 0), 0);
};

const bannerMatchesSlot = (banner, requestedSlot, requestedPageTarget) => {
    const slots = normalizeBannerSlots(banner);
    if (slots.includes('all')) return true;
    if (requestedSlot && slots.includes(requestedSlot)) return true;
    return slots.some(slot => getPageTargetForSlot(slot) === requestedPageTarget);
};

const getImpressionScopeKey = (banner, trackingContext = {}) => {
    const context = trackingContext.context || {};
    return [
        banner.id,
        trackingContext.slot || 'all',
        trackingContext.pageTarget || 'all',
        trackingContext.audience || context.audience || 'all',
        context.universityName || context.university || '',
        context.facultyName || context.faculty || '',
        context.examSubject || context.subject || '',
        context.examYear || context.year || ''
    ].map(value => normalizeText(value)).join('|');
};

const filterAndSortBanners = (banners = [], context = {}, limit = 1, slot = 'all', pageTarget = 'all') => {
    const audience = context.audience || 'all';
    return banners
        .filter(banner => {
            if (!bannerMatchesSlot(banner, slot, pageTarget)) return false;
            const targetAudience = banner.target_audience || 'all';
            if (targetAudience !== 'all' && targetAudience !== audience) return false;
            if (!matchesOptionalField(banner.university, context.universityName || context.university)) return false;
            if (!matchesOptionalField(banner.faculty, context.facultyName || context.faculty)) return false;
            if (!matchesOptionalField(banner.subject, context.examSubject || context.subject)) return false;
            if (banner.year && String(banner.year) !== String(context.examYear || context.year || '')) return false;
            return true;
        })
        .sort((a, b) => {
            const specificityDiff = getSpecificityScore(b) - getSpecificityScore(a);
            if (specificityDiff !== 0) return specificityDiff;
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        })
        .slice(0, limit);
};

/**
 * Get all banners for Admin Dashboard
 */
export const getAdminBanners = async () => {
    const { data, error } = await supabase
        .from('banner_ads')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
};

/**
 * Get a specific banner by ID
 */
export const getBannerById = async (id) => {
    const { data, error } = await supabase
        .from('banner_ads')
        .select('*')
        .eq('id', id)
        .single();

    if (error) throw error;
    return data;
};

const getLegacyActiveBanners = async (pageTarget = 'all', limit = 1) => {
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('banner_ads')
        .select(LEGACY_ACTIVE_BANNER_SELECT)
        .eq('is_active', true)
        .or(`page_target.eq.${pageTarget},page_target.eq.all`)
        .or(`end_at.is.null,end_at.gt.${now}`)
        .or(`start_at.is.null,start_at.lte.${now}`)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) throw error;
    return data || [];
};

/**
 * Get active banners for a specific slot/page with audience and exam context.
 */
export const getActiveBanners = async (slotOrPageTarget = 'all', options = {}) => {
    const {
        pageTarget,
        context = {},
        audience,
        limit = 1
    } = options || {};

    const slot = slotOrPageTarget || 'all';
    const resolvedPageTarget = pageTarget || getPageTargetForSlot(slot) || slot;
    const now = new Date().toISOString();

    let data = [];
    try {
        const { data: enhancedData, error } = await supabase
            .from('banner_ads')
            .select(ACTIVE_BANNER_SELECT)
            .eq('is_active', true)
            .or(`end_at.is.null,end_at.gt.${now}`)
            .or(`start_at.is.null,start_at.lte.${now}`)
            .order('created_at', { ascending: false });

        if (error) throw error;
        data = filterAndSortBanners(
            enhancedData || [],
            { ...context, audience: audience || context.audience },
            limit,
            slot,
            resolvedPageTarget
        );
    } catch (error) {
        console.warn('Enhanced banner query failed, falling back to legacy page_target:', error);
        data = await getLegacyActiveBanners(resolvedPageTarget, limit);
        if ((!data || data.length === 0) && resolvedPageTarget !== 'all') {
            data = await getLegacyActiveBanners('all', limit);
        }
    }

    const trackingContext = { slot, pageTarget: resolvedPageTarget, audience: audience || context.audience, context };
    const bannerIds = data
        .filter(banner => {
            const key = getImpressionScopeKey(banner, trackingContext);
            if (trackedImpressionKeys.has(key)) return false;
            trackedImpressionKeys.add(key);
            return true;
        })
        .map(b => b.id);

    if (bannerIds.length > 0) {
        incrementImpressions(bannerIds);
    }

    return data || [];
};

/**
 * Create a new banner
 */
export const createBanner = async (banner) => {
    let { data, error } = await supabase
        .from('banner_ads')
        .insert([banner])
        .select();

    if (error && String(error.message || error.details || '').includes('width_percent')) {
        const { width_percent, ...fallbackBanner } = banner;
        const result = await supabase
            .from('banner_ads')
            .insert([fallbackBanner])
            .select();
        data = result.data;
        error = result.error;
    }

    if (error) throw error;
    return data[0];
};

/**
 * Update a banner
 */
export const updateBanner = async (id, updates) => {
    let { data, error } = await supabase
        .from('banner_ads')
        .update(updates)
        .eq('id', id)
        .select();

    if (error && String(error.message || error.details || '').includes('width_percent')) {
        const { width_percent, ...fallbackUpdates } = updates;
        const result = await supabase
            .from('banner_ads')
            .update(fallbackUpdates)
            .eq('id', id)
            .select();
        data = result.data;
        error = result.error;
    }

    if (error) throw error;
    return data[0];
};

/**
 * Delete a banner
 */
export const deleteBanner = async (id) => {
    // 1. Get banner data first to find image URL
    const { data: banner, error: fetchError } = await supabase
        .from('banner_ads')
        .select('image_url')
        .eq('id', id)
        .single();

    if (fetchError) {
        console.error("Error fetching banner for deletion:", fetchError);
    }

    // 2. Delete database record
    const { error: dbError } = await supabase
        .from('banner_ads')
        .delete()
        .eq('id', id);

    if (dbError) throw dbError;

    // 3. Delete image from storage if it exists and is a Supabase storage URL
    if (banner?.image_url && banner.image_url.includes('/storage/v1/object/public/banners/')) {
        try {
            const fileName = banner.image_url.split('/').pop();
            const { error: storageError } = await supabase.storage
                .from('banners')
                .remove([fileName]);
            
            if (storageError) {
                console.warn("Could not delete image from usage storage:", storageError);
            }
        } catch (err) {
            console.warn("Storage cleanup failed (non-critical):", err);
        }
    }
};

/**
 * Upload an image to the 'banners' bucket
 */
export const uploadBannerImage = async (file) => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { data, error } = await supabase.storage
        .from('banners')
        .upload(filePath, file);

    if (error) {
        console.error("Supabase Storage Upload Error Full Object:", error);
        console.error("Bucket: banners, FilePath:", filePath);
        throw new Error(`Upload failed: ${error.message || 'Unknown error'} (${error.status || 'No status'})`);
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
        .from('banners')
        .getPublicUrl(filePath);

    return publicUrl;
};

/**
 * Increment click count for a banner
 */
export const incrementClick = async (id) => {
    const { error } = await supabase.rpc('increment_banner_click', { banner_id: id });

    if (error) {
        // Fallback if RPC doesn't exist (less atomic but works)
        const { data } = await supabase.from('banner_ads').select('click_count').eq('id', id).single();
        await supabase.from('banner_ads').update({ click_count: (data?.click_count || 0) + 1 }).eq('id', id);
    }
};

/**
 * Increment impression counts (Optimized via RPC)
 */
const incrementImpressions = async (ids) => {
    if (!ids || ids.length === 0) return;
    
    try {
        // Use RPC for atomic batch update to prevent network hammering
        const { error } = await supabase.rpc('increment_banner_impressions', { banner_ids: ids });
        
        if (error) {
            console.warn("RPC increment_banner_impressions failed, falling back to legacy mode:", error);
            // Legacy fallback (Inefficient, but works if RPC is missing)
            for (const id of ids) {
                const { data } = await supabase.from('banner_ads').select('impression_count').eq('id', id).single();
                await supabase.from('banner_ads').update({ impression_count: (data?.impression_count || 0) + 1 }).eq('id', id);
            }
        }
    } catch (err) {
        console.error("Impression update failed:", err);
    }
};
