import { supabase } from './supabaseClient';

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
 * Get active banners for a specific page target
 */
export const getActiveBanners = async (pageTarget = 'all') => {
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('banner_ads')
        .select('*')
        .eq('is_active', true)
        .or(`page_target.eq.${pageTarget},page_target.eq.all`)
        .or(`end_at.is.null,end_at.gt.${now}`)
        .filter('start_at', 'lte', now)
        .order('created_at', { ascending: false });

    if (error) throw error;

    // Process impressions (optional: could be done asynchronously or via a separate edge function)
    const bannerIds = data.map(b => b.id);
    if (bannerIds.length > 0) {
        incrementImpressions(bannerIds);
    }

    return data;
};

/**
 * Create a new banner
 */
export const createBanner = async (banner) => {
    const { data, error } = await supabase
        .from('banner_ads')
        .insert([banner])
        .select();

    if (error) throw error;
    return data[0];
};

/**
 * Update a banner
 */
export const updateBanner = async (id, updates) => {
    const { data, error } = await supabase
        .from('banner_ads')
        .update(updates)
        .eq('id', id)
        .select();

    if (error) throw error;
    return data[0];
};

/**
 * Delete a banner
 */
export const deleteBanner = async (id) => {
    const { error } = await supabase
        .from('banner_ads')
        .delete()
        .eq('id', id);

    if (error) throw error;
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
 * Increment impression counts (Internal)
 */
const incrementImpressions = async (ids) => {
    // Ideally use an RPC for batch update
    for (const id of ids) {
        const { data } = await supabase.from('banner_ads').select('impression_count').eq('id', id).single();
        await supabase.from('banner_ads').update({ impression_count: (data?.impression_count || 0) + 1 }).eq('id', id);
    }
};
