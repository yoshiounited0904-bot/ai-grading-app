import { supabase } from './supabaseClient';

const GRADING_COLUMNS = `
    id,
    display_name,
    university,
    faculty,
    subject,
    year,
    score,
    max_score,
    created_at
`;

/**
 * 直近の公開採点イベントを取得
 */
export const getLiveGradingEvents = async ({ limit = 10 } = {}) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 30);

    try {
        const { data, error } = await supabase
            .from('grading_activity_events')
            .select(GRADING_COLUMNS)
            .eq('is_public', true)
            .order('created_at', { ascending: false })
            .limit(safeLimit);

        if (error) {
            const message = String(error?.message || '');
            if (message.includes('grading_activity_events') || message.includes('schema cache')) {
                return { data: [], error: null };
            }
            return { data: [], error };
        }

        return { data: data || [], error: null };
    } catch (err) {
        return { data: [], error: err };
    }
};

/**
 * リアルタイム採点通知の購読（Supabase Realtime）
 */
export const subscribeToGradingActivityEvents = (onNewEvent) => {
    if (!supabase || typeof supabase.channel !== 'function') {
        return () => {};
    }

    try {
        const channelName = `realtime-grading-${Math.random().toString(36).substring(2, 9)}`;
        const channel = supabase
            .channel(channelName)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'grading_activity_events'
                },
                (payload) => {
                    if (payload && payload.new && payload.new.is_public !== false) {
                        onNewEvent(payload.new);
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR') {
                    console.warn('[ActivityRealtime] Realtime subscription error');
                }
            });

        return () => {
            try {
                supabase.removeChannel(channel);
            } catch (e) {
                // cleanup error ignore
            }
        };
    } catch (err) {
        console.warn('[ActivityRealtime] Failed to initialize channel', err);
        return () => {};
    }
};

/**
 * 採点イベントの表示用テキストを整形
 */
export const formatGradingEvent = (event) => {
    if (!event) return null;

    const name = event.display_name || event.anonymous_label || '受験生';
    const university = String(event.university || event.university_name || '').trim();
    const faculty = String(event.faculty || event.faculty_name || '').trim();
    const subject = String(event.subject || event.exam_subject || '').trim();
    const year = event.year || event.exam_year ? `${event.year || event.exam_year}年度` : '';

    // 大学名に学部名が含まれる場合の重複除去
    const displayUniversity = faculty && university.endsWith(faculty)
        ? university.slice(0, -faculty.length).trim()
        : university;

    const examParts = [displayUniversity, faculty, subject, year].filter(Boolean);
    const examLabel = examParts.join(' ');

    const score = Math.floor(Number(event.score) || 0);
    const maxScore = Math.floor(Number(event.max_score) || 0);
    const scoreRate = maxScore > 0 ? score / maxScore : null;

    return {
        id: event.id,
        name,
        examLabel,
        score,
        maxScore,
        scoreRate,
        createdAt: event.created_at
    };
};

/**
 * 経過時間のフォーマット
 */
export const getRelativeTime = (timestamp) => {
    if (!timestamp) return 'たった今';
    const date = new Date(timestamp);
    const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (!Number.isFinite(diffSeconds)) return 'たった今';
    if (diffSeconds < 60) return 'たった今';
    const minutes = Math.floor(diffSeconds / 60);
    if (minutes < 60) return `${minutes}分前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}時間前`;
    const days = Math.floor(hours / 24);
    return `${days}日前`;
};

// 互換性のための既存関数
export const getLiveActivityEvents = getLiveGradingEvents;
