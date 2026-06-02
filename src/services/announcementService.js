import { supabase } from './supabaseClient';

export const getAnnouncements = async () => {
    const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('date', { ascending: false });
    return { data, error };
};

export const saveAnnouncement = async (announcement) => {
    const { data, error } = await supabase
        .from('announcements')
        .upsert([announcement])
        .select();
    return { data, error };
};

export const deleteAnnouncement = async (id) => {
    const { error } = await supabase
        .from('announcements')
        .delete()
        .eq('id', id);
    return { error };
};
