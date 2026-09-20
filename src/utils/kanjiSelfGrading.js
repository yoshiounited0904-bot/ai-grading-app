export const KANJI_SELF_GRADE_CORRECT = '__kanji_self_grade_correct__';
export const KANJI_SELF_GRADE_WRONG = '__kanji_self_grade_wrong__';

const normalizeText = (value) => String(value ?? '').normalize('NFKC').toLowerCase();

const isJapaneseSubject = (examData = {}) => {
    const subjectId = normalizeText(examData.subject_en || examData.subjectEn);
    const subjectLabel = normalizeText(examData.subject);
    return subjectId === 'japanese' ||
        subjectLabel.includes('国語') ||
        subjectLabel.includes('現代文') ||
        subjectLabel.includes('古文') ||
        subjectLabel.includes('漢文');
};

const buildQuestionText = (question = {}, section = {}) => [
    question.answerIssue,
    question.answerFormat,
    question.label,
    question.prompt,
    question.questionText,
    question.question,
    question.instruction,
    question.passageReference,
    question.explanation,
    question.gradingInstruction,
    section.label,
    section.title,
    section.questionType
].map(normalizeText).filter(Boolean).join('\n');

export const isKanjiSelfGradingQuestion = (examData = {}, section = {}, question = {}) => {
    if (!isJapaneseSubject(examData)) return false;

    const marker = normalizeText(question.answerIssue || question.answerFormat);
    if (marker.includes('kanji_self_grade') || marker.includes('self_grade_kanji')) return true;

    const text = buildQuestionText(question, section);
    if (!text.includes('漢字')) return false;

    return /漢字(?:で|に|を|の|問題|表記|直|書|改|答|記せ|記し|記入|書き|なお|変換)|漢字に改め|漢字で答|漢字で書|漢字表記/u.test(text);
};

export const isKanjiSelfGradeCorrect = (value) => value === KANJI_SELF_GRADE_CORRECT;

export const getKanjiSelfGradeLabel = (value) => (
    value === KANJI_SELF_GRADE_CORRECT
        ? '正解として自己申告'
        : value === KANJI_SELF_GRADE_WRONG
            ? '不正解として自己申告'
            : ''
);
