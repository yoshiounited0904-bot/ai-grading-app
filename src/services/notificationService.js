import { supabase } from './supabaseClient';

export const notifyAdmin = async (eventType, payload = {}) => {
    try {
        const { error } = await supabase.functions.invoke('notify-admin', {
            body: {
                eventType,
                payload
            }
        });

        if (error) {
            console.warn('Admin notification failed:', error);
            return { error };
        }

        return { error: null };
    } catch (error) {
        console.warn('Admin notification failed:', error);
        return { error };
    }
};
