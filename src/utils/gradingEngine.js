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
            const completeGroupOrderMode = q.completeGroupOrderMode || 'ordered';

            // Only process objective types here
            const isCorrect = checkCorrectness(userAnswer, correctAnswer, q.type, q.alternativeAnswers, q.answerIssue);
            
            // Only essay/writing require AI grading. Everything else is exact-match (instant).
            const aiRequiredTypes = ['essay', 'writing'];
            const isObjective = !aiRequiredTypes.includes(q.type);

            if (isObjective) {
                const defectExplanation = q.answerIssue === 'all_choices_correct'
                    ? '【問題不備】この設問は選択肢を問わず正解として扱います。'
                    : q.answerIssue === 'single_choice_multiple_answers'
                        ? '【問題不備】この設問は一つしか選択できませんが、複数の正解候補を許容しています。'
                        : '';
                const feedbackItem = {
                    id: q.id,
                    questionKey: uniqueKey,
                    sectionId: section.id,
                    userAnswer: Array.isArray(userAnswer) ? userAnswer.join(', ') : userAnswer,
                    correctAnswer: q.answerIssue === 'all_choices_correct' ? '全選択肢' : correctAnswer,
                    correct: isCorrect,
                    explanation: defectExplanation || q.explanation || (isCorrect ? "正解です。" : "不正解です。正解を確認しましょう。"),
                    isSubjective: false,
                    points: q.points || 0 // Store points for possible group sum
                };

                if (q.completeGroupId && q.completeGroupId.trim() !== '') {
                    const groupId = q.completeGroupId.trim();
                    if (!completeGroups[groupId]) {
                        completeGroups[groupId] = {
                            questions: [],
                            allCorrect: true,
                            totalPoints: 0,
                            orderMode: completeGroupOrderMode
                        };
                    }
                    if (completeGroupOrderMode === 'unordered') {
                        completeGroups[groupId].orderMode = 'unordered';
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
                    aiId: uniqueKey,
                    questionKey: uniqueKey,
                    type: q.type, // Pass the dropdown type (e.g., 'essay')
                    sectionId: section.id,
                    label: q.label || questionId,
                    userAnswer: userAnswer,
                    correctAnswer: correctAnswer,
                    alternativeAnswers: q.alternativeAnswers || [],
                    points: q.points || 0,
                    gradingInstruction: q.gradingInstruction || q.gradingCriteria || "",
                    scoringElements: q.scoringElements || [],
                    isSubjective: true,
                    completeGroupId: q.completeGroupId
                };
                questionFeedback.push(feedbackItem);
            }
        });
    });

    // Process Complete Groups
    Object.keys(completeGroups).forEach(groupId => {
        const group = completeGroups[groupId];
        if (group.orderMode === 'unordered') {
            group.allCorrect = checkUnorderedCompleteGroup(group.questions);
        }
        if (group.allCorrect) {
            score += group.totalPoints;
            group.questions.forEach(fq => {
                fq.correct = true;
                const modeLabel = group.orderMode === 'unordered' ? '順不同・' : '';
                fq.explanation = `【${modeLabel}完答正解! グループ合計 ${group.totalPoints}点】\n` + (fq.explanation || "");
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

const CHOICE_LABEL_FIXES = {
    '力': 'カ',
    '才': 'オ',
    '工': 'エ',
    '口': 'ロ',
    '夕': 'タ',
    '二': 'ニ',
    '卜': 'ト',
    '八': 'ハ'
};
const CHOICE_LABEL_PATTERN = /(^|[（(【\[\s,、])([力才工口夕二卜八])(?=($|[）)】\]\s,、.:：]))/g;
const CIRCLED_NUMBER_MAP = {
    '①': '1',
    '②': '2',
    '③': '3',
    '④': '4',
    '⑤': '5',
    '⑥': '6',
    '⑦': '7',
    '⑧': '8',
    '⑨': '9',
    '⑩': '10',
    '⑪': '11',
    '⑫': '12',
    '⑬': '13',
    '⑭': '14',
    '⑮': '15',
    '⑯': '16',
    '⑰': '17',
    '⑱': '18',
    '⑲': '19',
    '⑳': '20'
};
const normalizeCircledNumbers = (value) => String(value ?? '').replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g, char => CIRCLED_NUMBER_MAP[char] || char);

const normalizeChoiceLikeText = (value) => {
    const text = normalizeCircledNumbers(value).normalize('NFKC').trim();
    if (CHOICE_LABEL_FIXES[text]) return CHOICE_LABEL_FIXES[text];
    return text.replace(CHOICE_LABEL_PATTERN, (_, prefix, choice) => `${prefix}${CHOICE_LABEL_FIXES[choice] || choice}`);
};

const normalizeAnswer = (val) => {
    if (!val) return "";
    return normalizeChoiceLikeText(val)
        .toLowerCase()
        .replace(/[，、]/g, ',')
        .replace(/[→＞>]/g, ',')
        .replace(/\s+/g, '');
};

const normalizeAnswerForMatch = (val) => {
    if (!val) return "";
    return normalizeChoiceLikeText(val)
        .toLowerCase()
        .replace(/^([0-9]+)\s*[（(][^）)]*[）)]$/u, '$1')
        .replace(/[＝=・･·•・\-‐‑‒–—―ー]/g, '')
        .replace(/[『』「」"'`´｀（）()[\]【】]/g, '')
        .replace(/\s+/g, '')
        .trim();
};

const splitAnswerParts = (answer) => {
    if (Array.isArray(answer)) return answer.map(normalizeAnswerForMatch).filter(Boolean);
    return normalizeAnswer(answer).split(',').map(s => normalizeAnswerForMatch(s)).filter(Boolean);
};

const checkUnorderedCompleteGroup = (questions) => {
    const userParts = questions.flatMap(q => splitAnswerParts(q.userAnswer));
    const correctSlots = questions.flatMap(q => {
        const correctParts = splitAnswerParts(q.correctAnswer);
        if (correctParts.length === 0) return [];
        const alternatives = Array.isArray(q.alternativeAnswers) ? q.alternativeAnswers.map(normalizeAnswerForMatch).filter(Boolean) : [];
        return correctParts.map(part => [part, ...alternatives]);
    });

    if (userParts.length === 0 || userParts.length !== correctSlots.length) return false;

    const used = new Set();
    return userParts.every(userPart => {
        const matchIndex = correctSlots.findIndex((candidates, index) => !used.has(index) && candidates.includes(userPart));
        if (matchIndex === -1) return false;
        used.add(matchIndex);
        return true;
    });
};

const checkCorrectness = (userAnswer, correctAnswer, type, alternativeAnswers = [], answerIssue = '') => {
    const hasUserAnswer = Array.isArray(userAnswer)
        ? userAnswer.length > 0
        : userAnswer !== undefined && userAnswer !== null && String(userAnswer).trim() !== '';

    if (answerIssue === 'all_choices_correct') {
        return hasUserAnswer;
    }

    if (!hasUserAnswer || !correctAnswer) return false;

    // Normalize for comparison
    const normUser = normalizeAnswer(userAnswer);
    const normCorrect = normalizeAnswer(correctAnswer);
    const matchUser = normalizeAnswerForMatch(userAnswer);
    const matchCorrect = normalizeAnswerForMatch(correctAnswer);

    // Multi-selection (comma separated or array)
    if (type === 'ordering' || String(correctAnswer).includes(',') || Array.isArray(userAnswer)) {
        const correctParts = normCorrect.split(',').map(s => s.trim()).filter(Boolean);
        const userParts = Array.isArray(userAnswer)
            ? userAnswer.map(normalizeAnswer)
            : normUser.split(',').map(s => s.trim()).filter(Boolean);

        if (answerIssue === 'single_choice_multiple_answers') {
            return userParts.length === 1 && correctParts.includes(userParts[0]);
        }

        if (correctParts.length !== userParts.length) return false;

        if (type === 'selection_multi') {
            // Order does not matter
            return correctParts.every(p => userParts.includes(p));
        } else {
            // Strict order match for ordering/default comma-separated answers
            return correctParts.every((p, i) => userParts[i] === p);
        }
    }

    if (matchUser === matchCorrect) return true;

    // Check alternative answers (OR match) for any type
    if (Array.isArray(alternativeAnswers) && alternativeAnswers.length > 0) {
        return alternativeAnswers.some(alt => normalizeAnswerForMatch(alt) === matchUser);
    }

    return false;
};
