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
