import { gradeObjectively } from "../utils/gradingEngine";
import { supabase } from "./supabaseClient";

// ---------------------------------------------------------------------------
// Edge Function invocation helpers
// ---------------------------------------------------------------------------

async function invokeGrade(payload) {
    const { data, error } = await supabase.functions.invoke("gemini-grade", { body: payload });
    if (error) throw new Error(await getFunctionErrorMessage(error, "採点サーバーでエラーが発生しました。"));
    if (data?.error) throw new Error(data.error);
    return data;
}

async function invokeChat(payload) {
    const { data, error } = await supabase.functions.invoke("gemini-chat", { body: payload });
    if (error) throw new Error(await getFunctionErrorMessage(error, "チャットサーバーでエラーが発生しました。"));
    if (data?.error) throw new Error(data.error);
    return data;
}

async function getFunctionErrorMessage(error, fallbackMessage) {
    const context = error?.context;
    if (context && typeof context.clone === 'function') {
        try {
            const payload = await context.clone().json();
            if (payload?.error || payload?.message) {
                return payload.error || payload.message;
            }
        } catch {
            // Try text below.
        }
        try {
            const text = await context.clone().text();
            if (text) return text;
        } catch {
            // Fall back to SDK message.
        }
    }
    return error?.message || fallbackMessage;
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
    const wrongItems = feedback.filter((f) => !f.correct);
    const wrong = wrongItems.length;
    const total = feedback.length;
    const wrongIds = wrongItems.slice(0, 8).map((f) => f.id).filter(Boolean).join('、') || '該当なし';
    const commonAdvice = `【今回の弱点】\n得点率は${pct}%です。誤答は全${total}問中${wrong}問で、特に ${wrongIds} を優先して確認してください。\n\n【優先して直すこと】\n正解との差が出た設問について、本文や資料のどの根拠を見落としたか、選択肢・記述のどの条件を満たせなかったかを1問ずつ整理してください。\n\n【次回の解き方】\n解答後すぐに根拠箇所と設問条件を照合し、迷った選択肢や不足した記述要素をメモしてから次の問題へ進んでください。`;
    if (pct >= 80) return `${commonAdvice}\n高得点ですが、誤答箇所を放置すると同形式で取りこぼしやすくなります。`;
    if (pct >= 60) return `${commonAdvice}\n合格ラインに近い答案です。失点した設問の型を潰すと、次回の安定感が上がります。`;
    return `${commonAdvice}\nまずは失点が集中している形式から復習し、正解根拠を自分の言葉で説明できる状態を目指してください。`;
};

const getNumericScore = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const floorScore = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

const calculateAllocatedMaxScore = (examData) => {
    const sections = Array.isArray(examData?.structure) ? examData.structure : [];
    return sections.reduce((sectionSum, section) => {
        const questions = Array.isArray(section?.questions) ? section.questions : [];
        return sectionSum + questions.reduce((questionSum, question) => questionSum + getNumericScore(question?.points, 0), 0);
    }, 0);
};

const buildScoreDisplay = ({ rawScore, allocatedMaxScore, officialMaxScore, scoreCap }) => {
    const flooredRawScore = floorScore(rawScore, 0);
    const shouldCompress = officialMaxScore > 0 && allocatedMaxScore > officialMaxScore;
    const baseScore = shouldCompress
        ? Math.floor(flooredRawScore / allocatedMaxScore * officialMaxScore)
        : flooredRawScore;
    const baseMaxScore = shouldCompress ? officialMaxScore : allocatedMaxScore;
    const shouldApplyScoreCap = scoreCap > 0 && baseMaxScore > 0;

    return {
        score: shouldApplyScoreCap ? Math.floor(baseScore / baseMaxScore * scoreCap) : baseScore,
        maxScore: shouldApplyScoreCap ? scoreCap : baseMaxScore,
        compressedScore: baseScore,
        compressedMaxScore: baseMaxScore,
        compression: shouldCompress
            ? {
                rawScore: flooredRawScore,
                rawMaxScore: allocatedMaxScore,
                compressedScore: baseScore,
                compressedMaxScore: officialMaxScore,
                message: `設問配点の合計が${allocatedMaxScore}点で試験満点${officialMaxScore}点を超えているため、素点を満点比率で換算しました（小数点以下切り下げ）。`
            }
            : null
    };
};

const appendScoreCompressionNotice = (weaknessAnalysis, compression) => {
    if (!compression) return weaknessAnalysis;
    return `${compression.message}\n\n${weaknessAnalysis || ""}`.trim();
};

// ---------------------------------------------------------------------------
// gradeExamWithGemini
// apiKey パラメータを廃止。採点 AI 呼び出しは Edge Function 経由。
// ---------------------------------------------------------------------------

export const gradeExamWithGemini = async (examData, userAnswers, pdfPath, fullMaxScore = 0, onProgress = null) => {
    try {
        // Step 1: 客観式を手元でプログラム採点
        const { score: objScore, maxScore: objMaxScore, questionFeedback: initialFeedback, pendingAiGrading } = gradeObjectively(examData, userAnswers);
        const allocatedMaxScore = objMaxScore || calculateAllocatedMaxScore(examData) || examData.max_score || examData.maxScore || 100;
        const officialMaxScore = getNumericScore(examData.max_score ?? examData.maxScore, 0);
        const scoreCap = getNumericScore(examData.score_cap, 0);

        // 主観式がなければそのまま返す
        if (pendingAiGrading.length === 0) {
            const display = buildScoreDisplay({
                rawScore: objScore,
                allocatedMaxScore,
                officialMaxScore,
                scoreCap
            });
            let weaknessAnalysis = generateSimpleWeakness(display.score, display.maxScore, initialFeedback);
            try {
                const { weaknessAnalysis: aiWeaknessAnalysis } = await invokeGrade({
                    pendingAiGrading: [],
                    objectiveFeedback: initialFeedback,
                    examMeta: {
                        university: examData.university,
                        faculty: examData.faculty,
                        subject: examData.subject,
                        subject_en: examData.subject_en,
                        year: examData.year,
                        detailedAnalysis: examData.detailedAnalysis,
                    },
                    pdfPath: pdfPath || null,
                });
                if (aiWeaknessAnalysis) {
                    weaknessAnalysis = aiWeaknessAnalysis.replace(/\*/g, "");
                }
            } catch (err) {
                console.warn("AI weakness analysis fallback:", err);
            }
            if (onProgress) onProgress(100);
            const feedbackWithCompression = display.compression
                ? initialFeedback.map((item, index) => index === 0 ? {
                    ...item,
                    explanation: `${item.explanation || ""}\n\n${display.compression.message}`.trim()
                } : item)
                : initialFeedback;
            return {
                score: display.score,
                maxScore: display.maxScore,
                rawScore: floorScore(objScore, 0),
                rawMaxScore: allocatedMaxScore,
                compressedScore: display.compressedScore,
                compressedMaxScore: display.compressedMaxScore,
                scoreCompression: display.compression,
                scoreCap: scoreCap > 0 ? scoreCap : null,
                passProbability: calculatePassProbability(
                    display.compressedScore,
                    display.compressedMaxScore,
                    examData.passing_lines,
                    display.compression ? display.compressedMaxScore : (fullMaxScore || display.compressedMaxScore)
                ),
                passingLines: examData.passing_lines || null,
                weaknessAnalysis: appendScoreCompressionNotice(weaknessAnalysis, display.compression),
                questionFeedback: feedbackWithCompression,
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

        const pendingAiGradingPayload = pendingAiGrading.map((item) => ({
            ...item,
            id: item.aiId || item.questionKey || item.id,
            originalId: item.id,
        }));

        const { aiFeedback, weaknessAnalysis } = await invokeGrade({
            pendingAiGrading: pendingAiGradingPayload,
            objectiveFeedback: initialFeedback.filter(f => !f.isSubjective),
            examMeta,
            pdfPath: pdfPath || null,
        });

        if (onProgress) onProgress(90);

        // Step 3: 結果をマージ
        let totalScore = objScore;
        const finalFeedback = initialFeedback.map((f) => {
            if (f.isSubjective) {
                const aiLookupId = f.aiId || f.questionKey || f.id;
                const ai = aiFeedback.find((a) => a.id === aiLookupId);
                if (ai) {
                    const aiScore = floorScore(ai.score, 0);
                    const aiCorrect = aiScore >= (Number(f.points) || 0) * 0.6;
                    totalScore += aiScore;
                    return { 
                        ...f, 
                        score: aiScore, 
                        correct: aiCorrect, 
                        explanation: ai.explanation ? ai.explanation.replace(/\*/g, "") : "",
                        essayResult: ai.essayResult,
                        scoringElements: ai.scoringElements
                    };
                }
                return { ...f, score: 0, correct: false, explanation: "【採点エラー】AIが結果を出力しませんでした。" };
            }
            return f;
        });

        const display = buildScoreDisplay({
            rawScore: totalScore,
            allocatedMaxScore,
            officialMaxScore,
            scoreCap
        });
        const passProbability = calculatePassProbability(
            display.compressedScore,
            display.compressedMaxScore,
            examData.passing_lines,
            display.compression ? display.compressedMaxScore : (fullMaxScore || display.compressedMaxScore)
        );
        const feedbackWithCompression = display.compression
            ? finalFeedback.map((item, index) => index === 0 ? {
                ...item,
                explanation: `${item.explanation || ""}\n\n${display.compression.message}`.trim()
            } : item)
            : finalFeedback;

        if (onProgress) onProgress(100);

        return {
            score: display.score,
            maxScore: display.maxScore,
            rawScore: floorScore(totalScore, 0),
            rawMaxScore: allocatedMaxScore,
            compressedScore: display.compressedScore,
            compressedMaxScore: display.compressedMaxScore,
            scoreCompression: display.compression,
            scoreCap: scoreCap > 0 ? scoreCap : null,
            passProbability,
            passingLines: examData.passing_lines || null,
            weaknessAnalysis: appendScoreCompressionNotice((weaknessAnalysis || "間違えた箇所を中心に復習しましょう。").replace(/\*/g, ""), display.compression),
            questionFeedback: feedbackWithCompression,
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
