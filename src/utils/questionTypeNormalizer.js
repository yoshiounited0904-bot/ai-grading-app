const OPTION_TYPES = new Set(['selection', 'selection_multi', 'ordering']);
const EXPLICIT_QUESTION_TYPES = new Set(['selection', 'selection_multi', 'ordering', 'descriptive', 'essay']);
const ORDERING_KEYWORDS = ['並び替え', '並べ替え', '並べかえ', '整序', '語順', '正しい順', '順番', '並べ'];
const ESSAY_KEYWORDS = ['自由記述', '論述', '小論文', '作文', '英作文', '要約', 'あなたの考え', '自分の考え'];
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
const LOWER_ALPHABET_OPTIONS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const UPPER_ALPHABET_OPTIONS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const KATAKANA_OPTIONS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン'.split('');
const MAX_AUTO_NUMERIC_OPTIONS = 10;
const DEFAULT_CHARACTER_COUNT_DESCRIPTION = '答案の文字数が指定範囲内である';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

export const normalizeChoiceLabel = (value) => {
    const label = normalizeCircledNumbers(value).normalize('NFKC').trim();
    if (CHOICE_LABEL_FIXES[label]) return CHOICE_LABEL_FIXES[label];
    return label.replace(CHOICE_LABEL_PATTERN, (_, prefix, choice) => `${prefix}${CHOICE_LABEL_FIXES[choice] || choice}`);
};

const completeAlphabetOptions = (options) => {
    const uniqueOptions = [...new Set(options)];
    if (uniqueOptions.every(option => /^[a-z]$/.test(option)) && uniqueOptions.length === 25) {
        return LOWER_ALPHABET_OPTIONS;
    }
    if (uniqueOptions.every(option => /^[A-Z]$/.test(option)) && uniqueOptions.length === 25) {
        return UPPER_ALPHABET_OPTIONS;
    }
    return uniqueOptions;
};

const completeOneMissingFromSequence = (options, sequence, minLength = 3) => {
    const uniqueOptions = [...new Set(options)];
    if (uniqueOptions.length < minLength || !uniqueOptions.every(option => sequence.includes(option))) {
        return uniqueOptions;
    }

    const indexes = uniqueOptions.map(option => sequence.indexOf(option));
    const start = Math.min(...indexes);
    const end = Math.max(...indexes);
    const expected = sequence.slice(start, end + 1);
    if (expected.length === uniqueOptions.length + 1) {
        const missingCount = expected.filter(option => !uniqueOptions.includes(option)).length;
        if (missingCount === 1) return expected;
    }
    return uniqueOptions;
};

const completeOneMissingNumericOptions = (options) => {
    const uniqueOptions = [...new Set(options)];
    if (uniqueOptions.length < 3 || !uniqueOptions.every(option => /^[0-9]+$/.test(option))) {
        return uniqueOptions;
    }

    const numbers = uniqueOptions.map(option => Number(option)).sort((a, b) => a - b);
    const start = numbers[0];
    const end = numbers[numbers.length - 1];
    const expected = Array.from({ length: end - start + 1 }, (_, idx) => String(start + idx));
    if (expected.length === uniqueOptions.length + 1) {
        const missingCount = expected.filter(option => !uniqueOptions.includes(option)).length;
        if (missingCount === 1) return expected;
    }
    return uniqueOptions;
};

const completeLikelyMissingOption = (options) => {
    const alphabetCompleted = completeAlphabetOptions(options);
    if (alphabetCompleted.length !== [...new Set(options)].length) return alphabetCompleted;

    const lowerCompleted = completeOneMissingFromSequence(options, LOWER_ALPHABET_OPTIONS);
    if (lowerCompleted.length !== [...new Set(options)].length) return lowerCompleted;

    const upperCompleted = completeOneMissingFromSequence(options, UPPER_ALPHABET_OPTIONS);
    if (upperCompleted.length !== [...new Set(options)].length) return upperCompleted;

    const katakanaCompleted = completeOneMissingFromSequence(options, KATAKANA_OPTIONS);
    if (katakanaCompleted.length !== [...new Set(options)].length) return katakanaCompleted;

    return completeOneMissingNumericOptions(options);
};

const isLargeSequentialNumericOptions = (options) => {
    if (options.length <= MAX_AUTO_NUMERIC_OPTIONS) return false;
    return options.every((option, idx) => String(option).trim() === String(idx + 1));
};

export const normalizeQuestionOptions = (options) => {
    let normalized = [];
    if (Array.isArray(options)) {
        normalized = options.map(option => normalizeChoiceLabel(option)).filter(Boolean);
    } else if (typeof options === 'string') {
        normalized = options.split(',').map(option => normalizeChoiceLabel(option)).filter(Boolean);
    }
    const completed = completeLikelyMissingOption(normalized);
    return isLargeSequentialNumericOptions(completed) ? [] : completed;
};

const splitAnswerParts = (answer) => {
    if (Array.isArray(answer)) return answer.map(item => String(item).trim()).filter(Boolean);
    return String(answer ?? '')
        .split(/[,\u3001]/)
        .map(item => item.trim())
        .filter(Boolean);
};

const normalizeChoiceAnswer = (answer) => {
    if (Array.isArray(answer)) {
        return answer.map(item => normalizeChoiceLabel(item)).filter(Boolean).join(',');
    }
    return normalizeChoiceLabel(answer);
};

const normalizeAlternativeAnswers = (answers) => {
    if (!Array.isArray(answers)) return answers;
    return answers
        .map(answer => normalizeChoiceLabel(answer))
        .filter(Boolean);
};

const hasScoringElements = (question) => {
    if (!Array.isArray(question?.scoringElements)) return false;
    return question.scoringElements.some(item =>
        !(item?.type === 'character_count' &&
            item?.description === DEFAULT_CHARACTER_COUNT_DESCRIPTION &&
            !item?.minChars &&
            !item?.maxChars &&
            (Number(item?.points) || 0) === 0) &&
        (hasText(item?.description) || Number.isFinite(Number(item?.points)))
    );
};

const createDefaultCharacterCountElement = (id = 'e1') => ({
    id,
    description: DEFAULT_CHARACTER_COUNT_DESCRIPTION,
    points: 0,
    allowPartial: false,
    type: 'character_count',
    minChars: '',
    maxChars: '',
    forceZeroOnFail: true
});

export const normalizeScoringElement = (item = {}, idx = 0) => {
    const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
    const type = ['content', 'logic', 'character_count', 'deduction', 'force_zero'].includes(String(source.type))
        ? String(source.type)
        : 'content';
    return {
        id: source.id || `e${idx + 1}`,
        description: source.description || '',
        points: Number.isFinite(Number(source.points)) ? Number(source.points) : 0,
        allowPartial: type === 'character_count' ? false : Boolean(source.allowPartial),
        type,
        minChars: source.minChars ?? '',
        maxChars: source.maxChars ?? '',
        forceZeroOnFail: type === 'character_count' ? source.forceZeroOnFail !== false : Boolean(source.forceZeroOnFail)
    };
};

export const ensureEssayCharacterCountElement = (question = {}) => {
    if (String(question?.type || '').toLowerCase() !== 'essay') return question;

    const elements = Array.isArray(question.scoringElements)
        ? question.scoringElements.map(normalizeScoringElement)
        : [];
    if (elements.some(item => item.type === 'character_count')) {
        return { ...question, scoringElements: elements };
    }

    const nextElements = [...elements];
    if (nextElements.length >= 20) {
        nextElements.pop();
    }
    nextElements.push(createDefaultCharacterCountElement(`e${nextElements.length + 1}`));
    return { ...question, scoringElements: nextElements };
};

export const ensureExamStructureEssayCharacterCountElements = (structure = []) => {
    let changeCount = 0;
    const normalizedStructure = Array.isArray(structure)
        ? structure.map(section => ({
            ...section,
            questions: Array.isArray(section?.questions)
                ? section.questions.map(question => {
                    const beforeElements = JSON.stringify(question?.scoringElements || []);
                    const normalized = ensureEssayCharacterCountElement(question);
                    if (beforeElements !== JSON.stringify(normalized.scoringElements || [])) {
                        changeCount += 1;
                    }
                    return normalized;
                })
                : []
        }))
        : [];

    return {
        structure: normalizedStructure,
        changed: changeCount > 0,
        changeCount
    };
};

const hasEssaySignals = (question) => {
    const currentType = String(question?.type || '').toLowerCase();
    if (currentType === 'essay' || currentType === 'writing') return true;
    if (hasText(question?.gradingInstruction) || hasText(question?.gradingCriteria) || hasScoringElements(question)) {
        return true;
    }

    const textBlob = [
        question?.label,
        question?.question,
        question?.prompt,
        question?.instruction
    ].filter(Boolean).join(' ');
    return ESSAY_KEYWORDS.some(keyword => textBlob.includes(keyword));
};

const hasOrderingSignals = (question) => {
    const currentType = String(question?.type || '').toLowerCase();
    if (currentType === 'ordering') return true;

    const textBlob = [
        question?.label,
        question?.question,
        question?.prompt,
        question?.instruction,
        question?.explanation
    ].filter(Boolean).join(' ');
    return ORDERING_KEYWORDS.some(keyword => textBlob.includes(keyword));
};

export const isSingleChoiceSymbol = (value) => {
    const str = String(value ?? '').trim().normalize('NFKC');
    if (!str) return false;
    // 1文字の英字 (a-z, A-Z)
    if (/^[a-zA-Z]$/.test(str)) return true;
    // 1〜10の数字
    if (/^([1-9]|10)$/.test(str)) return true;
    // 1文字のカタカナ (ア-ン)
    if (/^[\u30A1-\u30F6]$/.test(str)) return true;
    // 1文字のひらがな (ぁ-ん)
    if (/^[\u3041-\u3096]$/.test(str)) return true;
    // ①〜⑳などの丸数字
    if (/^[\u2460-\u2473]$/.test(str)) return true;
    // (a), (1), (ア), (あ) のような括弧付き記号
    if (/^[(（][a-zA-Z0-9\u30A1-\u30F6\u3041-\u3096][)）]$/.test(str)) return true;
    return false;
};

export const buildDefaultOptionsForChoiceAnswer = (answer) => {
    const norm = String(answer || '').trim().normalize('NFKC');
    if (/^[a-d]$/i.test(norm)) {
        return norm === norm.toLowerCase() ? ['a', 'b', 'c', 'd'] : ['A', 'B', 'C', 'D'];
    }
    if (/^[e-f]$/i.test(norm)) {
        return norm === norm.toLowerCase() ? ['a', 'b', 'c', 'd', 'e', 'f'] : ['A', 'B', 'C', 'D', 'E', 'F'];
    }
    if (/^[1-4]$/.test(norm)) {
        return ['1', '2', '3', '4'];
    }
    if (/^[5-6]$/.test(norm)) {
        return ['1', '2', '3', '4', '5', '6'];
    }
    if (/^[アイウエ]$/.test(norm)) {
        return ['ア', 'イ', 'ウ', 'エ'];
    }
    if (/^[オカ]$/.test(norm)) {
        return ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ'];
    }
    if (/^[あいうえ]$/.test(norm)) {
        return ['あ', 'い', 'う', 'え'];
    }
    if (/^[おか]$/.test(norm)) {
        return ['あ', 'い', 'う', 'え', 'お', 'か'];
    }
    return [];
};

export const inferQuestionType = (question = {}) => {
    const options = normalizeQuestionOptions(question.options);
    const answerParts = splitAnswerParts(question.correctAnswer);
    const hasOptions = options.length > 0;
    const answerIssue = String(question.answerIssue || '');

    // 正解が1文字の選択肢記号（b, d, 3, ア等）の場合、絶対に記述（descriptive）や論述（essay）ではない！
    const isAnswerChoiceSymbol = answerParts.length === 1 && isSingleChoiceSymbol(answerParts[0]);
    const isMultipleChoiceSymbols = answerParts.length > 1 && answerParts.every(isSingleChoiceSymbol);

    if (isAnswerChoiceSymbol && !hasEssaySignals(question)) {
        return 'selection';
    }
    if (isMultipleChoiceSymbols && !hasEssaySignals(question)) {
        return hasOrderingSignals(question) ? 'ordering' : 'selection_multi';
    }

    if (hasEssaySignals(question)) return 'essay';
    if (hasOptions && answerParts.length > 1 && hasOrderingSignals(question)) return 'ordering';
    if (hasOptions && answerParts.length > 1 && answerIssue !== 'single_choice_multiple_answers') return 'selection_multi';
    if (hasOptions) return 'selection';
    return 'descriptive';
};

export const normalizeQuestionType = (question = {}) => {
    let normalizedOptions = normalizeQuestionOptions(question.options);
    const currentType = String(question.type || '').toLowerCase();
    const answerParts = splitAnswerParts(question.correctAnswer);
    const isAnswerChoiceSymbol = answerParts.length === 1 && isSingleChoiceSymbol(answerParts[0]);

    // 正解が選択肢記号なのに descriptive と指定されている場合、強制的に selection に修正
    const shouldOverrideDescriptive = currentType === 'descriptive' && isAnswerChoiceSymbol;

    const inferredType = currentType === 'writing'
        ? 'essay'
        : shouldOverrideDescriptive
            ? 'selection'
            : EXPLICIT_QUESTION_TYPES.has(currentType)
                ? currentType
                : inferQuestionType({ ...question, options: normalizedOptions });

    // 選択問題の options はユーザーの意思で入力・適用するため、ここでは自動補完しない
    const next = {
        ...question,
        type: inferredType
    };

    if (normalizedOptions.length > 0) {
        next.options = normalizedOptions;
        next.correctAnswer = normalizeChoiceAnswer(question.correctAnswer);
    } else if (OPTION_TYPES.has(inferredType)) {
        next.options = [];
        next.correctAnswer = normalizeChoiceAnswer(question.correctAnswer);
    } else {
        delete next.options;
    }

    return ensureEssayCharacterCountElement(next);
};

export const normalizeQuestionChoiceLabels = (question = {}) => {
    const normalizedOptions = normalizeQuestionOptions(question.options);
    const shouldNormalizeAnswer = true;

    if (!shouldNormalizeAnswer && normalizedOptions.length === 0 && !Array.isArray(question.alternativeAnswers)) return question;

    const next = { ...question };
    if (normalizedOptions.length > 0) {
        next.options = normalizedOptions;
    } else {
        delete next.options;
    }
    if (shouldNormalizeAnswer) {
        next.correctAnswer = normalizeChoiceAnswer(question.correctAnswer);
    }
    if (Array.isArray(question.alternativeAnswers)) {
        next.alternativeAnswers = normalizeAlternativeAnswers(question.alternativeAnswers);
    }
    return next;
};

export const normalizeExamStructureChoiceLabels = (structure = []) => {
    let changeCount = 0;
    const normalizedStructure = Array.isArray(structure)
        ? structure.map(section => ({
            ...section,
            questions: Array.isArray(section?.questions)
                ? section.questions.map(question => {
                    const beforeOptions = JSON.stringify(question?.options || []);
                    const beforeAnswer = String(question?.correctAnswer ?? '');
                    const beforeAlternativeAnswers = JSON.stringify(question?.alternativeAnswers || []);
                    const normalized = normalizeQuestionChoiceLabels(question);
                    if (
                        beforeOptions !== JSON.stringify(normalized.options || []) ||
                        beforeAnswer !== String(normalized.correctAnswer ?? '') ||
                        beforeAlternativeAnswers !== JSON.stringify(normalized.alternativeAnswers || [])
                    ) {
                        changeCount += 1;
                    }
                    return normalized;
                })
                : []
        }))
        : [];

    return {
        structure: normalizedStructure,
        changed: changeCount > 0,
        changeCount
    };
};

export const normalizeExamStructureQuestionTypes = (structure = []) => {
    let changeCount = 0;
    const normalizedStructure = Array.isArray(structure)
        ? structure.map(section => ({
            ...section,
            questions: Array.isArray(section?.questions)
                ? section.questions.map(question => {
                    const beforeType = String(question?.type || '');
                    const beforeOptions = JSON.stringify(question?.options || []);
                    const beforeAnswer = String(question?.correctAnswer ?? '');
                    const normalized = normalizeQuestionType(question);
                    if (
                        beforeType !== normalized.type ||
                        beforeOptions !== JSON.stringify(normalized.options || []) ||
                        beforeAnswer !== String(normalized.correctAnswer ?? '')
                    ) {
                        changeCount += 1;
                    }
                    return normalized;
                })
                : []
        }))
        : [];

    return {
        structure: normalizedStructure,
        changed: changeCount > 0,
        changeCount
    };
};
