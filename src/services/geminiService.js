import { gradeObjectively } from "../utils/gradingEngine";
import { supabase } from "./supabaseClient";

// ---------------------------------------------------------------------------
// Edge Function invocation helpers
// ---------------------------------------------------------------------------

async function invokeGrade(payload) {
    const { data, error } = await supabase.functions.invoke("gemini-grade", { body: payload });
    if (error) throw new Error(error.message || "採点サーバーでエラーが発生しました。");
    return data;
}

async function invokeChat(payload) {
    const { data, error } = await supabase.functions.invoke("gemini-chat", { body: payload });
    if (error) throw new Error(error.message || "チャットサーバーでエラーが発生しました。");
    return data;
}

// ---------------------------------------------------------------------------
// Scoring helpers (client-side, no API)
// ---------------------------------------------------------------------------

const calculatePassProbability = (score, max, passingLines, fullMaxScore = 0) => {
    if (passingLines && fullMaxScore > 0) {
        const ratio = max / fullMaxScore;
        const scale = (val) => (val ? val * ratio : 0);
        if (score >= scale(passingLines.A)) return "A";
        if (score >= scale(passingLines.B)) return "B";
        if (score >= scale(passingLines.C)) return "C";
        if (score >= scale(passingLines.D)) return "D";
        return "E";
    }
    const r = score / max;
    if (r >= 0.8) return "A";
    if (r >= 0.7) return "B";
    if (r >= 0.6) return "C";
    if (r >= 0.4) return "D";
    return "E";
};

const generateSimpleWeakness = (score, maxScore, feedback) => {
    const pct = Math.round((score / maxScore) * 100);
    const wrong = feedback.filter((f) => !f.correct).length;
    const total = feedback.length;
    if (pct >= 80) return `得点率${pct}%、素晴らしい結果です。間違えた${wrong}問を復習し、完璧を目指しましょう。`;
    if (pct >= 60) return `得点率${pct}%、合格ラインです。間違えた${wrong}問（全${total}問中）の解説を読み、理解を深めましょう。`;
    return `得点率${pct}%、基礎固めが必要です。詳細解説を熟読し、論理的に理解しましょう。類似問題で練習を重ねてください。`;
};

// ---------------------------------------------------------------------------
// gradeExamWithGemini
// apiKey パラメータを廃止。採点 AI 呼び出しは Edge Function 経由。
// ---------------------------------------------------------------------------

export const gradeExamWithGemini = async (examData, userAnswers, pdfPath, fullMaxScore = 0, onProgress = null) => {
    try {
        // Step 1: 客観式を手元でプログラム採点
        const { score: objScore, maxScore: objMaxScore, questionFeedback: initialFeedback, pendingAiGrading } = gradeObjectively(examData, userAnswers);

        // 主観式がなければそのまま返す
        if (pendingAiGrading.length === 0) {
            const finalMaxScore = objMaxScore || examData.max_score || examData.maxScore || 100;
            const simpleWeakness = generateSimpleWeakness(objScore, finalMaxScore, initialFeedback);
            if (onProgress) onProgress(100);
            const scoreCap0 = examData.score_cap ? parseInt(examData.score_cap) : 0;
            const displayScore0 = scoreCap0 > 0 && finalMaxScore > 0 ? Math.floor(objScore / finalMaxScore * scoreCap0) : objScore;
            const displayMaxScore0 = scoreCap0 > 0 ? scoreCap0 : finalMaxScore;
            return {
                score: displayScore0,
                maxScore: displayMaxScore0,
                rawScore: objScore,
                rawMaxScore: finalMaxScore,
                scoreCap: scoreCap0 > 0 ? scoreCap0 : null,
                passProbability: calculatePassProbability(objScore, finalMaxScore, examData.passing_lines, fullMaxScore),
                passingLines: examData.passing_lines || null,
                weaknessAnalysis: simpleWeakness,
                questionFeedback: initialFeedback,
                detailedAnalysis: examData.detailedAnalysis || "",
            };
        }

        if (onProgress) onProgress(20);

        // Step 2: 主観式を Edge Function で採点
        const examMeta = {
            university: examData.university,
            faculty: examData.faculty,
            subject: examData.subject,
            subject_en: examData.subject_en,
            year: examData.year,
            detailedAnalysis: examData.detailedAnalysis,
        };

        if (onProgress) onProgress(30);

        const { aiFeedback, weaknessAnalysis } = await invokeGrade({
            pendingAiGrading,
            examMeta,
            pdfPath: pdfPath || null,
        });

        if (onProgress) onProgress(90);

        // Step 3: 結果をマージ
        let totalScore = objScore;
        const finalFeedback = initialFeedback.map((f) => {
            if (f.isSubjective) {
                const ai = aiFeedback.find((a) => a.id === f.id);
                if (ai) {
                    totalScore += ai.score;
                    return { 
                        ...f, 
                        score: ai.score, 
                        correct: ai.correct, 
                        explanation: ai.explanation ? ai.explanation.replace(/\*/g, "") : "",
                        essayResult: ai.essayResult,
                        scoringElements: ai.scoringElements
                    };
                }
                return { ...f, score: 0, correct: false, explanation: "【採点エラー】AIが結果を出力しませんでした。" };
            }
            return f;
        });

        const maxScore = objMaxScore || examData.max_score || examData.maxScore || initialFeedback.length * 5;
        const passProbability = calculatePassProbability(totalScore, maxScore, examData.passing_lines, fullMaxScore);
        const scoreCap = examData.score_cap ? parseInt(examData.score_cap) : 0;
        const displayScore = scoreCap > 0 && maxScore > 0 ? Math.floor(totalScore / maxScore * scoreCap) : totalScore;
        const displayMaxScore = scoreCap > 0 ? scoreCap : maxScore;

        if (onProgress) onProgress(100);

        return {
            score: displayScore,
            maxScore: displayMaxScore,
            rawScore: totalScore,
            rawMaxScore: maxScore,
            scoreCap: scoreCap > 0 ? scoreCap : null,
            passProbability,
            passingLines: examData.passing_lines || null,
            weaknessAnalysis: (weaknessAnalysis || "間違えた箇所を中心に復習しましょう。").replace(/\*/g, ""),
            questionFeedback: finalFeedback,
            detailedAnalysis: examData.detailedAnalysis || "",
        };
    } catch (error) {
        throw new Error("採点中に重大なエラーが発生しました: " + error.message);
    }
};

// ---------------------------------------------------------------------------
// chatWithGemini
// apiKey パラメータを廃止。チャット AI 呼び出しは Edge Function 経由。
// ---------------------------------------------------------------------------

export const chatWithGemini = async (userMessage, history, gradingResult, examMeta = {}, pdfPath = null) => {
    const { response } = await invokeChat({
        userMessage,
        history,
        gradingResult,
        examMeta,
        pdfPath,
    });
    return response ? response.replace(/\*/g, "") : "";
};
