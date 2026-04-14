import { supabase } from './supabaseClient'

// 成績を保存
export const saveExamResult = async (userId, resultData) => {
    const insertData = {
        user_id: userId,
        university_name: resultData.universityName,
        faculty_name: resultData.facultyName,
        exam_subject: resultData.examSubject,
        exam_year: resultData.examYear || 2025,
        score: resultData.score,
        max_score: resultData.maxScore,
        pass_probability: resultData.passProbability,
        weakness_analysis: resultData.weaknessAnalysis,
        question_feedback: resultData.questionFeedback,
        answers: resultData.answers,
        section_scores: resultData.sectionScores
    };

    const { data, error } = await supabase
        .from('exam_results')
        .insert([insertData]);

    return { data, error };
}

// ユーザーの全成績を取得
export const getUserResults = async (userId) => {
    const { data, error } = await supabase
        .from('exam_results')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

    return { data, error }
}

// 統計情報を取得
export const getUserStats = async (userId) => {
    const { data, error } = await supabase
        .from('exam_results')
        .select('score, max_score')
        .eq('user_id', userId)

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
