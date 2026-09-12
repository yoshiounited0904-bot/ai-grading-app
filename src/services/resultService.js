import { supabase } from './supabaseClient'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const withTimeout = (promise, label, ms = 15000) => Promise.race([
    promise,
    new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label}がタイムアウトしました`)), ms)
    })
])

const isTransientError = (error) => {
    const message = String(error?.message || error?.details || error || '').toLowerCase()
    const status = Number(error?.status || error?.code)
    return [408, 429, 500, 502, 503, 504, 522, 523, 524].includes(status) ||
        /522|timeout|timed out|load failed|failed to fetch|network|gateway|temporarily/i.test(message)
}

const hasColumnError = (error, columnName) => {
    const message = String(error?.message || error?.details || error || '');
    return message.includes(columnName);
}

const extractUniversityFilterName = (value) => {
    const text = String(value || '').trim()
    const match = text.match(/^(.+?大学)/)
    return match ? match[1] : text
}

const runResultQuery = async (queryFactory, label, retries = 2) => {
    let lastError = null
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const result = await withTimeout(queryFactory(), label)
            if (!result?.error) return result
            lastError = result.error
            if (!isTransientError(result.error) || attempt === retries) return result
        } catch (error) {
            lastError = error
            if (!isTransientError(error) || attempt === retries) return { data: null, error }
        }
        await sleep(700 * (attempt + 1))
    }
    return { data: null, error: lastError || new Error(`${label}に失敗しました`) }
}

// 成績を保存
export const saveExamResult = async (userId, resultData) => {
    const insertData = {
        user_id: userId,
        university_name: resultData.facultyName ? `${resultData.universityName} ${resultData.facultyName}` : resultData.universityName,
        faculty_name: resultData.facultyName,
        exam_subject: resultData.examSubject,
        exam_year: resultData.examYear || 2025,
        score: resultData.score,
        max_score: resultData.maxScore,
        pass_probability: resultData.passProbability,
        weakness_analysis: resultData.weaknessAnalysis,
        question_feedback: resultData.questionFeedback,
        answers: resultData.answers,
        section_scores: resultData.sectionScores,
        pdf_path: resultData.pdfPath || resultData.pdf_path || resultData.answers?.pdfPath || null
    };

    const insertResult = async (payload) => runResultQuery(
        () => supabase
            .from('exam_results')
            .insert([payload])
            .select('id, created_at')
            .single(),
        '成績の保存',
        3
    );

    let payload = insertData;
    let { data, error } = await insertResult(payload);

    const optionalColumns = ['faculty_name', 'pdf_path'];
    for (const columnName of optionalColumns) {
        if (error && hasColumnError(error, columnName) && Object.prototype.hasOwnProperty.call(payload, columnName)) {
            const { [columnName]: _omitted, ...fallbackData } = payload;
            payload = fallbackData;
            const result = await insertResult(payload);
            data = result.data;
            error = result.error;
        }
    }

    return { data, error };
}

// ユーザーの成績を取得
export const getUserResults = async (userId, options = {}) => {
    const page = Math.max(Number(options.page || 1), 1)
    const pageSize = Math.max(Number(options.pageSize || 30), 1)
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    const universityName = String(options.universityName || '').trim()
    const applyFilters = (query) => {
        const scoped = query.eq('user_id', userId)
        return universityName ? scoped.ilike('university_name', `${universityName}%`) : scoped
    }

    let { data, error, count } = await runResultQuery(
        () => applyFilters(
            supabase
                .from('exam_results')
                .select(`
                id,
                university_name,
                faculty_name,
                exam_subject,
                exam_year,
                score,
                max_score,
                pass_probability,
                weakness_analysis,
                question_feedback,
                answers,
                section_scores,
                pdf_path,
                created_at
            `, { count: 'exact' })
        )
            .order('created_at', { ascending: false })
            .range(from, to),
        '成績履歴の取得'
    )

    if (typeof count !== 'number') count = null

    if (error && (hasColumnError(error, 'pdf_path') || hasColumnError(error, 'faculty_name'))) {
        const fallback = await runResultQuery(
            () => applyFilters(
                supabase
                    .from('exam_results')
                    .select(`
                    id,
                    university_name,
                    exam_subject,
                    exam_year,
                    score,
                    max_score,
                    pass_probability,
                    weakness_analysis,
                    question_feedback,
                    answers,
                    section_scores,
                    created_at
                `, { count: 'exact' })
            )
                .order('created_at', { ascending: false })
                .range(from, to),
            '成績履歴の取得'
        );
        data = fallback.data;
        error = fallback.error;
        count = typeof fallback.count === 'number' ? fallback.count : null;
    }

    return { data, error, count }
}

export const getUserResultUniversities = async (userId) => {
    const { data, error } = await runResultQuery(
        () => supabase
            .from('exam_results')
            .select('university_name')
            .eq('user_id', userId)
            .order('university_name', { ascending: true })
            .limit(500),
        '大学フィルタの取得'
    )

    if (error) return { data: [], error }

    return {
        data: [...new Set((data || []).map(row => extractUniversityFilterName(row.university_name)).filter(Boolean))],
        error: null
    }
}

export const getExamPdfPathsByIds = async (examIds = []) => {
    const ids = [...new Set(examIds.filter(Boolean))];
    if (ids.length === 0) return { data: {}, error: null };

    const { data, error } = await runResultQuery(
        () => supabase
            .from('exams')
            .select('id, pdf_path')
            .in('id', ids),
        '問題PDFの取得'
    );

    if (error) return { data: {}, error };

    return {
        data: Object.fromEntries((data || []).map(exam => [exam.id, exam.pdf_path])),
        error: null
    };
}

// 統計情報を取得
export const getUserStats = async (userId) => {
    const { data, error } = await runResultQuery(
        () => supabase
            .from('exam_results')
            .select('score, max_score')
            .eq('user_id', userId)
            .limit(200),
        '成績統計の取得'
    )

    if (error) return { data: null, error }

    if (data.length === 0) {
        return {
            data: { totalExams: 0, averageScore: 0, bestScore: 0 },
            error: null
        }
    }

    const totalExams = data.length
    const averageScore = data.reduce((sum, r) => sum + (r.score / r.max_score * 100), 0) / totalExams
    const bestScore = Math.max(...data.map(r => r.score / r.max_score * 100))

    return {
        data: { totalExams, averageScore, bestScore },
        error: null
    }
}

// 特定の試験の統計情報を取得（偏差値、順位、大問別平均）
export const getExamStatistics = async (universityName, examSubject, examYear, userScore, userSectionScores) => {
    let { data, error } = await supabase
        .from('exam_results')
        .select('score, section_scores, user_id')
        .eq('university_name', universityName)
        .eq('exam_subject', examSubject)
        .eq('exam_year', examYear)

    if (error) return { data: null, error }

    if (!data || data.length === 0) {
        return {
            data: {
                ranking: 1,
                totalExaminees: 1,
                deviationValue: 50,
                sectionAverages: userSectionScores
            },
            error: null
        }
    }

    const scores = data.map(r => r.score)
    const totalExaminees = scores.length
    const rank = scores.filter(s => s > userScore).length + 1
    const sum = scores.reduce((a, b) => a + b, 0)
    const avg = sum / totalExaminees
    const variance = scores.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / totalExaminees
    const stdDev = Math.sqrt(variance)

    let deviationValue = 50
    if (stdDev > 0) {
        deviationValue = 50 + 10 * ((userScore - avg) / stdDev)
    }

    const sectionSums = {}
    const sectionCounts = {}

    data.forEach(row => {
        if (row.section_scores && Array.isArray(row.section_scores)) {
            row.section_scores.forEach(section => {
                if (!sectionSums[section.sectionId]) {
                    sectionSums[section.sectionId] = 0
                    sectionCounts[section.sectionId] = 0
                }
                sectionSums[section.sectionId] += section.score
                sectionCounts[section.sectionId]++
            })
        }
    })

    const sectionAverages = userSectionScores.map(userSection => {
        const total = sectionSums[userSection.sectionId] || 0
        const count = sectionCounts[userSection.sectionId] || 0
        const average = count > 0 ? total / count : 0
        return {
            sectionId: userSection.sectionId,
            userScore: userSection.score,
            averageScore: average,
            maxScore: userSection.maxScore
        }
    })

    return {
        data: {
            ranking: rank,
            totalExaminees,
            deviationValue: parseFloat(deviationValue.toFixed(1)),
            sectionAverages
        },
        error: null
    }
}
