import { supabase } from './supabaseClient';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const withTimeout = (promise, label, ms = 20000) => Promise.race([
    promise,
    new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label}がタイムアウトしました`)), ms);
    })
]);

const isTransientError = (error) => {
    const message = String(error?.message || error?.details || error || '').toLowerCase();
    const status = Number(error?.status || error?.code);
    return [408, 429, 500, 502, 503, 504, 522, 523, 524].includes(status) ||
        /522|timeout|timed out|load failed|failed to fetch|network|gateway|temporarily/i.test(message);
};

const runAdminAnalyticsQuery = async (queryFactory, label, { retries = 2 } = {}) => {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const result = await withTimeout(queryFactory(), label);
            if (!result?.error) return result;
            lastError = result.error;
            if (!isTransientError(result.error) || attempt === retries) return result;
        } catch (error) {
            lastError = error;
            if (!isTransientError(error) || attempt === retries) return { data: null, error };
        }

        await sleep(700 * (attempt + 1));
    }

    return { data: null, error: lastError || new Error(`${label}に失敗しました`) };
};

const buildDateFilter = (query, days) => {
    const numericDays = Number(days);
    if (!Number.isFinite(numericDays) || numericDays <= 0) return query;

    const since = new Date();
    since.setDate(since.getDate() - numericDays);
    return query.gte('created_at', since.toISOString());
};

export const getAdminResultAnalytics = async ({ days = 30, limit = 500 } = {}) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 500, 50), 1500);

    const profilesResult = await runAdminAnalyticsQuery(
        () => supabase
            .from('profiles')
            .select('id, username, first_choice_university, grade, role, plan, created_at')
            .limit(2000),
        'ユーザー一覧の取得'
    );

    if (profilesResult.error) {
        return { data: null, error: profilesResult.error };
    }

    const resultsResult = await runAdminAnalyticsQuery(
        () => buildDateFilter(
            supabase
                .from('exam_results')
                .select(`
                    id,
                    user_id,
                    university_name,
                    faculty_name,
                    exam_subject,
                    exam_year,
                    score,
                    max_score,
                    pass_probability,
                    section_scores,
                    question_feedback,
                    weakness_analysis,
                    answers,
                    pdf_path,
                    created_at
                `),
            days
        )
            .order('created_at', { ascending: false })
            .limit(safeLimit),
        '成績ログの取得'
    );

    if (resultsResult.error) {
        return { data: null, error: resultsResult.error };
    }

    const visibleUsers = (profilesResult.data || []).filter(user => user?.role !== 'admin');
    const usersById = new Map((profilesResult.data || []).map(user => [user.id, user]));
    const results = (resultsResult.data || []).filter(result => {
        const user = usersById.get(result.user_id) || null;
        return user?.role !== 'admin';
    }).map(result => {
        const user = usersById.get(result.user_id) || null;
        const score = Number(result.score);
        const maxScore = Number(result.max_score);
        const scoreRate = Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0
            ? Math.round((score / maxScore) * 1000) / 10
            : null;

        return {
            ...result,
            scoreRate,
            userName: user?.username || '名前なし',
            userGrade: user?.grade || '',
            userFirstChoice: user?.first_choice_university || '',
            userPlan: user?.plan || 'free',
            userRole: user?.role || 'user'
        };
    });

    return {
        data: {
            users: visibleUsers,
            results
        },
        error: null
    };
};
