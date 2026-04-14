/**
 * Hybrid Grading Engine
 * Programmatically grades objective questions (Selection, Terminology)
 * to save tokens and ensure 100% accuracy for fixed-answer questions.
 */

export const gradeObjectively = (examData, userAnswers) => {
    const questionFeedback = [];
    let score = 0;
    let maxScore = 0;
    const completeGroups = {};

    examData.structure.forEach((section, sIdx) => {
        section.questions.forEach((q, qIdx) => {
            const questionId = q.id || `${section.id}-${qIdx + 1}`;
            const uniqueKey = `${section.id}_${qIdx}_${questionId}`;
            const userAnswer = userAnswers[uniqueKey] !== undefined ? userAnswers[uniqueKey] : (userAnswers[q.id] || "");
            const correctAnswer = q.correctAnswer;
            maxScore += q.points || 0;

            // Only process objective types here
            const hasInstruction = (q.gradingInstruction && q.gradingInstruction.trim() !== '') || (q.gradingCriteria && q.gradingCriteria.trim() !== '');
            const isCorrect = checkCorrectness(userAnswer, correctAnswer, q.type, q.alternativeAnswers);
            
            // Standard objective types
            const isStandardObjective = ['selection', 'selection_multi'].includes(q.type) && !hasInstruction;
            // Descriptive match (auto-pass if answer matches exactly)
            const isDescriptiveMatch = q.type === 'descriptive' && !hasInstruction && isCorrect;

            if (isStandardObjective || isDescriptiveMatch) {
                const feedbackItem = {
                    id: q.id,
                    userAnswer: Array.isArray(userAnswer) ? userAnswer.join(', ') : userAnswer,
                    correctAnswer: correctAnswer,
                    correct: isCorrect,
                    explanation: q.explanation || (isCorrect ? "正解です。" : "不正解です。正解を確認しましょう。"),
                    isSubjective: false,
                    points: q.points || 0 // Store points for possible group sum
                };

                if (q.completeGroupId && q.completeGroupId.trim() !== '') {
                    const groupId = q.completeGroupId.trim();
                    if (!completeGroups[groupId]) {
                        completeGroups[groupId] = {
                            questions: [],
                            allCorrect: true,
                            totalPoints: 0
                        };
                    }
                    completeGroups[groupId].questions.push(feedbackItem);
                    if (!isCorrect) {
                        completeGroups[groupId].allCorrect = false;
                    }
                    completeGroups[groupId].totalPoints += (q.points || 0);
                } else {
                    if (isCorrect) {
                        score += q.points || 0;
                    }
                    questionFeedback.push(feedbackItem);
                }
            } else {
                // Mark for AI processing (subjective)
                const feedbackItem = {
                    id: q.id,
                    userAnswer: userAnswer,
                    correctAnswer: correctAnswer,
                    alternativeAnswers: q.alternativeAnswers || [],
                    points: q.points || 0,
                    gradingInstruction: q.gradingInstruction || q.gradingCriteria || "",
                    isSubjective: true,
                    completeGroupId: q.completeGroupId // Pass group ID
                };
                questionFeedback.push(feedbackItem);
            }
        });
    });

    // Process Complete Groups
    Object.keys(completeGroups).forEach(groupId => {
        const group = completeGroups[groupId];
        if (group.allCorrect) {
            score += group.totalPoints;
            group.questions.forEach(fq => {
                fq.explanation = `【完答正解! グループ合計 ${group.totalPoints}点】\n` + (fq.explanation || "");
                questionFeedback.push(fq);
            });
        } else {
            // Failed group: All questions in group get 0 score
            group.questions.forEach(fq => {
                fq.correct = false; // Force incorrect
                fq.explanation = "【完答問題: グループ内で不正解が含まれるため、この問題の得点は0点となります】\n" + (fq.explanation || "");
                questionFeedback.push(fq);
            });
        }
    });

    return {
        score,
        maxScore,
        questionFeedback,
        pendingAiGrading: questionFeedback.filter(f => f.isSubjective)
    };
};

const checkCorrectness = (userAnswer, correctAnswer, type, alternativeAnswers = []) => {
    if (!userAnswer || !correctAnswer) return false;

    // Normalize for comparison
    const normalize = (val) => {
        if (!val) return "";
        return val.toString().trim().toLowerCase()
            .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)); // Full-width to half-width
    };

    const normUser = normalize(userAnswer);
    const normCorrect = normalize(correctAnswer);

    // Multi-selection (comma separated or array)
    if (correctAnswer.includes(',') || Array.isArray(userAnswer)) {
        const correctParts = normCorrect.split(',').map(s => s.trim()).filter(Boolean);
        const userParts = Array.isArray(userAnswer)
            ? userAnswer.map(normalize)
            : normUser.split(',').map(s => s.trim()).filter(Boolean);

        if (correctParts.length !== userParts.length) return false;

        if (type === 'selection_multi') {
            // Order does not matter
            return correctParts.every(p => userParts.includes(p));
        } else {
            // Strict order match for default
            return correctParts.every((p, i) => userParts[i] === p);
        }
    }

    if (normUser === normCorrect) return true;

    // Check alternative answers for descriptive (OR match)
    if (type === 'descriptive' && Array.isArray(alternativeAnswers)) {
        return alternativeAnswers.some(alt => normalize(alt) === normUser);
    }

    return false;
};
