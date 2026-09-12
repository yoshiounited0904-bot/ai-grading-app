import { supabase } from './supabaseClient';

const ACTIVITY_COLUMNS = `
    id,
    event_type,
    anonymous_label,
    university_name,
    faculty_name,
    exam_subject,
    exam_year,
    score,
    max_score,
    pass_probability,
    created_at
`;

export const getLiveActivityEvents = async ({ limit = 20 } = {}) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);

    const { data, error } = await supabase
        .from('activity_events')
        .select(ACTIVITY_COLUMNS)
        .eq('is_public', true)
        .order('created_at', { ascending: false })
        .limit(safeLimit);

    if (error) {
        const message = String(error?.message || '');
        if (message.includes('activity_events') || message.includes('schema cache')) {
            return { data: [], error: null };
        }
    }

    return { data: data || [], error };
};
