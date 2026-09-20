export const SUBJECT_OPTIONS = [
    { value: 'english', label: '英語', display: '英語 (english)' },
    { value: 'japanese', label: '国語', display: '国語 (japanese)' },
    { value: 'japanese_history', label: '日本史', display: '日本史 (japanese_history)' },
    { value: 'world_history', label: '世界史', display: '世界史 (world_history)' },
    { value: 'geography', label: '地理', display: '地理 (geography)' },
    { value: 'politics_economics', label: '政治経済', display: '政治経済 (politics_economics)' },
    { value: 'ethics', label: '倫理', display: '倫理 (ethics)' },
    { value: 'math', label: '数学', display: '数学 (math)' },
    { value: 'science', label: '理科', display: '理科 (science)' },
    { value: 'social', label: '社会 汎用', display: '社会 汎用 (social)' }
];

export const SUBJECT_DISPLAY_ORDER = [
    '英語',
    '国語',
    '日本史',
    '世界史',
    '地理',
    '政治経済',
    '倫理',
    '数学',
    '物理',
    '化学',
    '生物',
    '理科',
    '社会'
];

const SUBJECT_IDS = new Set(SUBJECT_OPTIONS.map(option => option.value));

export const normalizeSubjectId = (subjectId, fallback = 'english') => {
    const value = String(subjectId || '').trim();
    return SUBJECT_IDS.has(value) ? value : fallback;
};

export const inferSubjectIdFromLabel = (subjectId, subjectLabel = '', fallback = 'english') => {
    const normalizedId = normalizeSubjectId(subjectId, '');
    if (normalizedId) return normalizedId;

    const label = String(subjectLabel || '').toLowerCase();
    if (label.includes('英')) return 'english';
    if (label.includes('国') || label.includes('現代文') || label.includes('古文') || label.includes('漢文') || label.includes('小論文')) return 'japanese';
    if (label.includes('日本史')) return 'japanese_history';
    if (label.includes('世界史')) return 'world_history';
    if (label.includes('地理')) return 'geography';
    if (label.includes('政治') || label.includes('政経')) return 'politics_economics';
    if (label.includes('倫理')) return 'ethics';
    if (label.includes('数')) return 'math';
    if (label.includes('物理') || label.includes('化学') || label.includes('生物') || label.includes('地学') || label.includes('理科')) return 'science';
    if (label.includes('社会')) return 'social';
    return fallback;
};

export const getSubjectLabel = (subjectId, fallback = '') => {
    const option = SUBJECT_OPTIONS.find(item => item.value === subjectId);
    return option?.label || fallback || subjectId || '';
};
