import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { getAdminExamById, saveAdminExam, updateAdminFields, uploadExamPdf } from '../services/adminExamService';
import { generateExamMasterData, regenerateQuestionExplanation, regenerateDetailedAnalysis, regeneratePointsAllocation, generateSectionDetailedAnalysis, generateSingleSectionData, generateSectionQuestionsExplanations, extractSectionVocabulary, extractExamMetadata, consultScoringElements, transformRubricToScoringElements, generateEssayModelAnswer } from '../services/adminGeminiService';
import { getAdminExams } from '../services/adminExamService';
import { getUniversityList } from '../data/examRegistry';
import { findUniversityMetadataKnowledge, listUniversityMetadataKnowledgeCandidates } from '../data/universityMetadataKnowledge';
import { uploadBannerImage } from '../services/adminBannerService';
import { geminiQueue } from '../utils/promiseQueue';
import {
    ensureEssayCharacterCountElement,
    ensureExamStructureEssayCharacterCountElements,
    normalizeExamStructureChoiceLabels,
    normalizeExamStructureQuestionTypes,
    normalizeScoringElement
} from '../utils/questionTypeNormalizer';
import universityBaseData from '../data/universityBaseData.json';
import { MARKETING_CONFIG } from '../config/marketingConfig';
import { SUBJECT_OPTIONS, inferSubjectIdFromLabel } from '../config/subjectConfig';
import { EXTERNAL_AI_PROMPTS } from '../config/externalAiPrompts';

const normalizeAdBlockContent = (content) => {
    if (content && typeof content === 'object' && !Array.isArray(content)) {
        return {
            ...content,
            imageUrl: content.imageUrl || content.image_url || '',
            targetUrl: content.targetUrl || content.target_url || '',
            widthPercent: clampAdWidthPercent(content.widthPercent || content.width_percent || 100)
        };
    }
    return { imageUrl: '', targetUrl: '', widthPercent: 100 };
};

const clampAdWidthPercent = (value) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return 100;
    return Math.min(100, Math.max(30, Math.round(next)));
};

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('ファイルの読み込みに失敗しました'));
    reader.readAsDataURL(file);
});

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const normalizeEditorStructure = (structure = []) => {
    const { structure: typeNormalized } = normalizeExamStructureQuestionTypes(structure);
    return ensureExamStructureEssayCharacterCountElements(typeNormalized).structure;
};

const requireGeneratedNumber = (record, field, context, positive = false) => {
    const value = record?.[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${context}: ${field} が数値ではありません。`);
    }
    if (positive && value <= 0) {
        throw new Error(`${context}: ${field} が1以上ではありません。`);
    }
    return value;
};

const extractQuestionNumbers = (value) => {
    const text = String(value ?? '').normalize('NFKC');
    const numbers = Array.from(text.matchAll(/\d+/g))
        .map(match => Number(match[0]))
        .filter(num => Number.isInteger(num) && num > 0);
    return Array.from(new Set(numbers));
};

const getQuestionNumberCoverage = (questions = []) => {
    const covered = new Set();
    questions.forEach((question) => {
        const numbers = extractQuestionNumbers(`${question?.id ?? ''} ${question?.label ?? ''}`);
        if (numbers.length > 0) {
            numbers.forEach(num => covered.add(num));
        } else {
            covered.add(covered.size + 1);
        }
    });
    return covered.size;
};

const validateGeneratedSection = (section, context, { requirePositivePoints = true, targetPoints = null, expectedQuestionCount = null } = {}) => {
    if (!isPlainObject(section)) {
        throw new Error(`${context}: 大問データが不正です。`);
    }
    if (!Array.isArray(section.questions) || section.questions.length === 0) {
        throw new Error(`${context}: 小問が抽出されていません。`);
    }
    if (
        expectedQuestionCount &&
        section.questions.length < expectedQuestionCount &&
        getQuestionNumberCoverage(section.questions) < expectedQuestionCount
    ) {
        throw new Error(`${context}: 小問が ${section.questions.length} 件しか抽出されていません。期待小問数 ${expectedQuestionCount} 件を下回るため、反映を中止しました。問題画像の範囲または「期待小問数」を確認してください。`);
    }

    const allocatedPoints = requireGeneratedNumber(section, 'allocatedPoints', context, requirePositivePoints);
    const allowZeroQuestionPoints = Boolean(
        requirePositivePoints &&
        targetPoints !== null &&
        expectedQuestionCount &&
        targetPoints < expectedQuestionCount
    );
    const questionPointTotal = section.questions.reduce((sum, question, qIdx) => {
        const qContext = `${context} 小問${qIdx + 1}`;
        if (!isPlainObject(question)) {
            throw new Error(`${qContext}: 小問データが不正です。`);
        }
        if (!question.id) {
            throw new Error(`${qContext}: id が空です。`);
        }
        if (question.correctAnswer === undefined || question.correctAnswer === null || question.correctAnswer === '') {
            throw new Error(`${qContext}: correctAnswer が空です。`);
        }
        const points = requireGeneratedNumber(question, 'points', qContext, false);
        if (requirePositivePoints && allowZeroQuestionPoints && points < 0) {
            throw new Error(`${qContext}: points が0以上ではありません。`);
        }
        if (requirePositivePoints && !allowZeroQuestionPoints && points <= 0) {
            throw new Error(`${qContext}: points が1以上ではありません。`);
        }
        return sum + points;
    }, 0);

    if (requirePositivePoints && questionPointTotal !== allocatedPoints) {
        throw new Error(`${context}: 小問配点合計 ${questionPointTotal} 点が大問配点 ${allocatedPoints} 点と一致しません。`);
    }
    if (targetPoints !== null && allocatedPoints !== targetPoints) {
        throw new Error(`${context}: 大問配点 ${allocatedPoints} 点が目標配点 ${targetPoints} 点と一致しません。`);
    }
};

const validateGeneratedExamMaster = (result, expectedMaxScore) => {
    if (!isPlainObject(result) || !Array.isArray(result.structure) || result.structure.length === 0) {
        throw new Error('AI生成結果の問題構造が空です。反映を中止しました。');
    }
    const maxScore = Number.isFinite(Number(result.max_score)) ? Number(result.max_score) : expectedMaxScore;
    let total = 0;
    result.structure.forEach((section, idx) => {
        validateGeneratedSection(section, `第${idx + 1}問`);
        total += section.allocatedPoints;
    });
    if (Number.isFinite(maxScore) && maxScore > 0 && total !== maxScore) {
        throw new Error(`大問配点合計 ${total} 点が満点 ${maxScore} 点と一致しません。反映を中止しました。`);
    }
};

const cleanExplanationOpening = (text) => {
    let cleaned = String(text || '')
        .replace(/```markdown\n?|```\n?|```/g, '')
        .replace(/\*/g, '')
        .trim();

    cleaned = cleaned.replace(
        /^(?:本解説では|この解説では|以下では)[\s\S]{0,160}?(?:詳細な解説を行う。|解説する。|説明する。)\s*/u,
        ''
    );
    cleaned = cleaned.replace(/^(?:全体解説|大問全体の解説|大問分析|詳細解説)\s*[①-⑳0-9０-９]*\s*[\n:：-]*/u, '');
    cleaned = cleaned.replace(/^【\s*(?:解説|詳細解説|全体解説|大問分析)\s*】\s*/u, '');
    cleaned = cleaned.replace(/^#+\s*(?:解説|詳細解説|全体解説|大問分析)\s*[①-⑳0-9０-９]*\s*\n+/u, '');
    cleaned = cleaned.replace(/^(?:①|1[.)．、])\s*(?:解答|正解)\s*\n+/u, '');

    return cleaned.trim();
};

const validateGeneratedText = (text, context) => {
    if (typeof text !== 'string' || !text.trim()) {
        throw new Error(`${context} が空です。反映を中止しました。`);
    }
    if (text.includes('AI生成中') || text.includes('AI生成エラー')) {
        throw new Error(`${context} が生成途中またはエラー表示のままです。反映を中止しました。`);
    }
    const cleaned = cleanExplanationOpening(text);
    if (!cleaned) {
        throw new Error(`${context} が空です。反映を中止しました。`);
    }
    return cleaned;
};

const extractExpectedQuestionCount = (instruction = '') => {
    const text = String(instruction || '');
    const match = text.match(/(?:小問|設問|問題)?\s*([0-9０-９]{1,2})\s*(?:問|題|個|件)/);
    if (!match) return null;
    const normalized = match[1].replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));
    const count = parseInt(normalized, 10);
    return Number.isFinite(count) && count > 0 ? count : null;
};

const isPdfFile = (file) => {
    const name = String(file?.name || '').toLowerCase();
    return file?.type === 'application/pdf' || name.endsWith('.pdf');
};

const isAnswerImageFile = (file) => {
    const name = String(file?.name || '').toLowerCase();
    return file?.type?.startsWith('image/') ||
        ['.gif', '.png', '.jpg', '.jpeg', '.webp'].some(ext => name.endsWith(ext));
};

const LocalAnswerImagePreview = ({ file, label }) => {
    const [url, setUrl] = useState('');

    useEffect(() => {
        if (!file) {
            setUrl('');
            return undefined;
        }
        const nextUrl = URL.createObjectURL(file);
        setUrl(nextUrl);
        return () => URL.revokeObjectURL(nextUrl);
    }, [file]);

    if (!file || !url) return null;

    return (
        <div className="rounded-lg border border-emerald-100 bg-white overflow-hidden" style={{ width: 420, maxWidth: '100%' }}>
            <div className="px-2 py-1 bg-emerald-50/70 border-b border-emerald-100 flex items-center justify-between gap-2" style={{ minHeight: 24 }}>
                <span className="text-[10px] font-black text-emerald-700 truncate" style={{ fontSize: 10, lineHeight: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label || file.name}</span>
                <span className="text-[9px] font-bold text-emerald-500 whitespace-nowrap" style={{ fontSize: 9, whiteSpace: 'nowrap' }}>{Math.round(file.size / 1024)} KB</span>
            </div>
            <div className="bg-slate-50 p-1.5" style={{ padding: 6 }}>
                <img src={url} alt={label || file.name} className="rounded bg-white" style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'contain', background: '#fff' }} />
            </div>
        </div>
    );
};

const SavedAnswerImagePreview = ({ url, label }) => {
    if (!url) return null;

    return (
        <div className="rounded-lg border border-navy-blue/10 bg-white overflow-hidden" style={{ width: 420, maxWidth: '100%' }}>
            <div className="px-2 py-1 bg-navy-blue/5 border-b border-navy-blue/10 flex items-center justify-between gap-2" style={{ minHeight: 24 }}>
                <span className="text-[10px] font-black text-navy-blue truncate" style={{ fontSize: 10, lineHeight: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label || '保存済み解答画像'}</span>
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-[9px] font-black text-indigo-600 hover:text-indigo-700 whitespace-nowrap" style={{ fontSize: 9, whiteSpace: 'nowrap' }}>
                    別タブで開く
                </a>
            </div>
            <div className="bg-slate-50 p-1.5" style={{ padding: 6 }}>
                <img src={url} alt={label || '保存済み解答画像'} className="rounded bg-white" style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'contain', background: '#fff' }} />
            </div>
        </div>
    );
};

const validateUploadFiles = (files, kind) => {
    const list = Array.from(files || []);
    const invalid = list.filter(file => kind === 'question' ? !isPdfFile(file) : !isAnswerImageFile(file));
    if (invalid.length === 0) return true;

    const label = kind === 'question' ? '問題ファイル' : '解答ファイル';
    const expected = kind === 'question' ? 'PDF（.pdf）' : '画像（.gif / .png / .jpg / .webp）';
    const opposite = kind === 'question' ? '解答画像を問題側に入れている可能性があります。' : '問題PDFを解答側に入れている可能性があります。';
    alert(
        `アップロードするファイルの種類が違います。\n\n` +
        `${label} は ${expected} のみ選択してください。\n` +
        `${opposite}\n\n` +
        `選択された不一致ファイル:\n${invalid.map(file => `・${file.name}`).join('\n')}`
    );
    return false;
};

const MASTER_STATUS_OPTIONS = [
    { value: 'working', label: '未完成', description: 'まだ作業中。生徒には公開しない。' },
    { value: 'completed', label: '完成', description: '作成完了。最終検証前。' },
    { value: 'verified', label: '検証済み', description: '確認済み。本番公開前の最終チェック済み。' },
    { value: 'production', label: '本番用', description: '本番公開対象。生徒に公開する。' }
];

const normalizeMasterStatus = (status) => {
    if (status === 'production') return 'production';
    if (status === 'verified') return 'verified';
    if (status === 'completed' || status === true) return 'completed';
    return 'working';
};

const GENERATION_DRAFT_PREFIX = 'adminExamGenerationDraft.v1';

const getUniversityBaseDataId = (item) => (
    item?.id ||
    [item?.university, item?.year, item?.faculty, item?.subject].filter(Boolean).join('_')
);

const buildSectionAnalysisInstruction = (baseInstruction = '', section) => {
    const customPrompt = String(baseInstruction || '').trim();
    if (!customPrompt) return '';

    return [
        '【詳細解説用プロンプト（管理者入力・最優先）】',
        '以下の指示は、この大問の「大問全体の詳細解説」を生成するための自作プロンプトです。',
        '出力の構成・見出し・順番・文体・分量・禁止事項は、この指示に必ず従ってください。',
        '小問解説、全体講評、学習アドバイス用の通常テンプレートに置き換えないでください。',
        section?.id ? `対象: 第${section.id}問（${section.label || ''}）` : '',
        '',
        customPrompt
    ].filter(Boolean).join('\n');
};

const getSectionInstruction = (instructionsBySection, sectionNum, section) => (
    instructionsBySection?.[sectionNum] ||
    section?.instruction ||
    ''
);

const ensureSectionAnalysisSources = (section, questionFiles = [], answerFiles = []) => {
    if (questionFiles.length > 0 || answerFiles.length > 0) return;
    throw new Error(`第${section?.id || ''}問の問題画像/解答画像が見つかりません。詳細解説は画像を根拠に作成するため、先に問題または解答ファイルを登録してください。`);
};

const resolveSectionSourceFiles = ({
    sectionIndex,
    structure = [],
    questionFilesBySection = {},
    answerFilesBySection = {},
    questionFiles = [],
    examPdfPath = ''
}) => {
    const section = structure?.[sectionIndex - 1] || {};
    const localQuestionFiles = questionFilesBySection?.[sectionIndex] || [];
    const localAnswerFiles = answerFilesBySection?.[sectionIndex] || [];
    const savedQuestionPath = section?.question_pdf_path;
    const savedAnswerPath = section?.answer_pdf_path;

    const sectionQuestionFiles = localQuestionFiles.length > 0
        ? localQuestionFiles
        : (savedQuestionPath ? [savedQuestionPath] : []);
    const sectionAnswerFiles = localAnswerFiles.length > 0
        ? localAnswerFiles
        : (savedAnswerPath ? [savedAnswerPath] : []);

    if (sectionQuestionFiles.length > 0 || sectionAnswerFiles.length > 0) {
        return {
            questionFiles: sectionQuestionFiles,
            answerFiles: sectionAnswerFiles
        };
    }

    return {
        questionFiles: questionFiles.length > 0
            ? questionFiles
            : (examPdfPath ? [examPdfPath] : []),
        answerFiles: []
    };
};

const isQuestionExplanationMissing = (question) => {
    const text = String(question?.explanation || '').trim();
    return !text || text.includes('AI生成中') || text.includes('AI生成エラー');
};

const isCorrectAnswerUnresolved = (value) => {
    const text = String(value ?? '').trim();
    if (!text) return true;
    if (['要確認', '未確認', '不明', '不明確', '要修正', '確認中'].includes(text)) return true;
    return /^要確認[（(]/u.test(text);
};

const buildResolvedCorrectAnswerPatch = (existingQuestion, generatedQuestion) => {
    if (!isCorrectAnswerUnresolved(existingQuestion?.correctAnswer) || isCorrectAnswerUnresolved(generatedQuestion?.correctAnswer)) {
        return {};
    }

    const patch = {
        correctAnswer: String(generatedQuestion.correctAnswer).trim(),
        needsReview: false,
    };
    if (existingQuestion?.answerIssue === 'unresolved' || existingQuestion?.answerIssue === 'missing_answer') {
        patch.answerIssue = '';
    }
    return patch;
};

const GENERATION_PHASE_LABELS = {
    structure: '大問構造を生成中',
    explanations: '小問解説を生成中',
    analysis: '詳細解説を生成中',
    vocabulary: '難単語を抽出中'
};

function AdminExamEditor() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const isNew = id === 'new' || location.pathname === '/admin/exam/new';
    const initialBaseDataAppliedRef = useRef(false);

    const [universitiesData, setUniversitiesData] = useState([]);

    const [loading, setLoading] = useState(!isNew);
    const [generating, setGenerating] = useState(false);
    const [generatingSectionData, setGeneratingSectionData] = useState({});
    const [sectionGenerationPhases, setSectionGenerationPhases] = useState({});
    const [generatingDetailed, setGeneratingDetailed] = useState(false);
    const [generatingSectionAnalysis, setGeneratingSectionAnalysis] = useState({});
    const [generatingVocabulary, setGeneratingVocabulary] = useState({});
    const [regeneratingPoints, setRegeneratingPoints] = useState(false);
    const [bulkGenerating, setBulkGenerating] = useState(false);
    const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
    const [bulkGeneratingSectionAnalyses, setBulkGeneratingSectionAnalyses] = useState(false);
    const [bulkSectionAnalysisProgress, setBulkSectionAnalysisProgress] = useState({ current: 0, total: 0 });
    const [isBulkGeneratingSections, setIsBulkGeneratingSections] = useState(false);
    const [bulkSectionsProgress, setBulkSectionsProgress] = useState({ current: 0, total: 0 });
    const [bulkIncludeVocab, setBulkIncludeVocab] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploadingQuestion, setUploadingQuestion] = useState(false);
    const [extractingMetadata, setExtractingMetadata] = useState(false);
    const [knowledgeCandidates, setKnowledgeCandidates] = useState([]);
    const [selectedKnowledgeKey, setSelectedKnowledgeKey] = useState('');
    const [baseDataUniversityFilter, setBaseDataUniversityFilter] = useState('all');
    const [baseDataYearFilter, setBaseDataYearFilter] = useState('all');
    const [baseDataSubjectFilter, setBaseDataSubjectFilter] = useState('all');
    const [uploadingAnswers, setUploadingAnswers] = useState({});
    const [generatingExplanationsOnly, setGeneratingExplanationsOnly] = useState({});
    const [activeTab, setActiveTab] = useState('master');
    const [customLayout, setCustomLayout] = useState([]);

    const [aiChats, setAiChats] = useState({});
    const [chatInputs, setChatInputs] = useState({});
    const [chatLoading, setChatLoading] = useState({});
    const [activeScoringEditor, setActiveScoringEditor] = useState(null);
    const [alternativeAnswerDrafts, setAlternativeAnswerDrafts] = useState({});
    const [essayModelAnswerLoading, setEssayModelAnswerLoading] = useState({});
    const [essayModelAnswerPreview, setEssayModelAnswerPreview] = useState(null);
    const [customPromptType, setCustomPromptType] = useState('auto');

    // Form states
    const [examId, setExamId] = useState('');
    const [university, setUniversity] = useState('');
    const [universityId, setUniversityId] = useState(Math.floor(Math.random() * 10000));
    const [faculty, setFaculty] = useState('');
    const [facultyId, setFacultyId] = useState('fac' + Math.floor(Math.random() * 10000));
    const [year, setYear] = useState(new Date().getFullYear());
    const [subject, setSubject] = useState('');
    const [subjectEn, setSubjectEn] = useState('english');
    const [type, setType] = useState('pdf');
    const [masterStatus, setMasterStatus] = useState('working');
    const [durationMinutes, setDurationMinutes] = useState(60);
    const generateDetailed = true;

    // PDF/Image files
    const [questionFiles, setQuestionFiles] = useState([]);
    const [sectionCount, setSectionCount] = useState(3);
    const [questionFilesBySection, setQuestionFilesBySection] = useState({ 1: [], 2: [], 3: [] });
    const [answerFilesBySection, setAnswerFilesBySection] = useState({ 1: [], 2: [], 3: [] });
    const [bulkQuestionFiles, setBulkQuestionFiles] = useState([]);
    const [bulkUploadingQuestions, setBulkUploadingQuestions] = useState(false);
    const [bulkQuestionUploadProgress, setBulkQuestionUploadProgress] = useState({ current: 0, total: 0 });
    const [bulkAnswerFiles, setBulkAnswerFiles] = useState([]);
    const [bulkUploadingAnswers, setBulkUploadingAnswers] = useState(false);
    const [bulkAnswerUploadProgress, setBulkAnswerUploadProgress] = useState({ current: 0, total: 0 });
    const [sectionInstructionsBySection, setSectionInstructionsBySection] = useState({ 1: '', 2: '', 3: '' });
    const [sectionPointsBySection, setSectionPointsBySection] = useState({ 1: '', 2: '', 3: '' });
    const [sectionExpectedQuestionCounts, setSectionExpectedQuestionCounts] = useState({ 1: '', 2: '', 3: '' });
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const savedSnapshotRef = useRef('');
    const skipUnsavedCheckRef = useRef(true);
    const dirtyCheckTimerRef = useRef(null);

    const [availableDrafts, setAvailableDrafts] = useState([]);

    // JSON Data
    const [examData, setExamData] = useState(isNew ? {
        max_score: 100,
        detailed_analysis: '',
        structure: [],
        pdf_path: '',
        passing_lines: { A: 80, B: 70, C: 60, D: 40 }
    } : null);
    const examDataRef = useRef(examData);

    useEffect(() => {
        examDataRef.current = examData;
    }, [examData]);

    const scoringModalStyles = {
        overlay: {
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            background: 'rgba(15, 23, 42, 0.68)',
            backdropFilter: 'blur(6px)'
        },
        shell: {
            width: 'min(1180px, 96vw)',
            height: '88vh',
            background: '#fff',
            borderRadius: '24px',
            boxShadow: '0 28px 80px rgba(15, 23, 42, 0.35)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
        },
        header: {
            padding: '16px 24px',
            background: 'var(--color-navy-blue, #0f172a)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px'
        },
        body: {
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            overflow: 'hidden'
        },
        pane: {
            minHeight: 0,
            overflowY: 'auto',
            padding: '24px'
        },
        footer: {
            padding: '16px 24px',
            background: '#f8fafc',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'flex-end'
        }
    };

    const buildEditorSnapshot = (structureOverride = null, sectionCountOverride = null, pdfPathOverride = null) => {
        const currentExamData = examDataRef.current || examData || {};
        const currentStructure = structureOverride || currentExamData?.structure || [];
        const effectiveSectionCount = Math.max(
            Number(sectionCountOverride) || 0,
            Number(sectionCount) || 0,
            Array.isArray(currentStructure) ? currentStructure.length : 0
        );
        const syncedStructure = [];

        for (let i = 1; i <= effectiveSectionCount; i++) {
            const existing = currentStructure[i - 1] || {
                id: String(i),
                label: `第${i}問`,
                questions: [],
                sectionAnalysis: '',
                questionType: 'default'
            };
            const parsedSectionPoints = parseInt(sectionPointsBySection[i], 10);
            syncedStructure.push({
                ...existing,
                instruction: sectionInstructionsBySection[i] ?? existing.instruction ?? '',
                allocatedPoints: Number.isFinite(parsedSectionPoints)
                    ? parsedSectionPoints
                    : existing.allocatedPoints || 0
            });
        }

        const { structure: choiceNormalizedStructure } = normalizeExamStructureChoiceLabels(syncedStructure);
        const normalizedStructure = normalizeEditorStructure(choiceNormalizedStructure);

        return JSON.stringify({
            id: examId,
            university,
            university_id: parseInt(universityId) || 0,
            faculty,
            faculty_id: facultyId,
            year: parseInt(year) || '',
            subject,
            subject_en: subjectEn,
            type,
            master_status: masterStatus,
            is_published: masterStatus === 'production',
            duration_minutes: parseInt(durationMinutes) || 60,
            pdf_path: pdfPathOverride ?? currentExamData?.pdf_path ?? '',
            max_score: parseInt(currentExamData?.max_score || 100),
            detailed_analysis: currentExamData?.detailed_analysis || '',
            structure: normalizedStructure,
            passing_lines: currentExamData?.passing_lines || { A: 80, B: 70, C: 60, D: 40 },
            custom_layout: customLayout
        });
    };

    const markCurrentStateAsSaved = (snapshotOverride = null) => {
        if (dirtyCheckTimerRef.current) {
            window.clearTimeout(dirtyCheckTimerRef.current);
            dirtyCheckTimerRef.current = null;
        }
        savedSnapshotRef.current = snapshotOverride || buildEditorSnapshot();
        skipUnsavedCheckRef.current = false;
        setHasUnsavedChanges(false);
    };

    const getGenerationDraftKey = (targetExamId = examId) => (
        targetExamId ? `${GENERATION_DRAFT_PREFIX}:${targetExamId}` : ''
    );

    const saveGenerationDraft = (structure, reason = '') => {
        const key = getGenerationDraftKey();
        if (!key || !Array.isArray(structure)) return;
        try {
            localStorage.setItem(key, JSON.stringify({
                examId,
                savedAt: new Date().toISOString(),
                reason,
                structure,
                sectionCount: Math.max(sectionCount, structure.length),
                sectionInstructionsBySection,
                sectionPointsBySection,
                sectionExpectedQuestionCounts
            }));
        } catch (error) {
            console.warn('Failed to save generation draft:', error);
        }
    };

    const clearGenerationDraft = (targetExamId = examId) => {
        const key = getGenerationDraftKey(targetExamId);
        if (!key) return;
        try {
            localStorage.removeItem(key);
        } catch (error) {
            console.warn('Failed to clear generation draft:', error);
        }
    };

    const loadGenerationDraft = (targetExamId) => {
        const key = getGenerationDraftKey(targetExamId);
        if (!key) return null;
        try {
            const draft = JSON.parse(localStorage.getItem(key) || 'null');
            return draft && Array.isArray(draft.structure) ? draft : null;
        } catch {
            return null;
        }
    };

    const findMatchingDraft = (targetExamId) => {
        if (!targetExamId) return null;
        const direct = loadGenerationDraft(targetExamId);
        if (direct && Array.isArray(direct.structure) && direct.structure.length > 0) {
            return direct;
        }
        try {
            const targetLower = String(targetExamId).toLowerCase();
            const targetFacMatch = targetLower.match(/fac\d+/);
            const targetYearMatch = targetLower.match(/202\d/);
            const targetIsJp = targetLower.includes('japanese') || targetLower.includes('国語');
            const targetIsEn = targetLower.includes('english') || targetLower.includes('英語');

            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(GENERATION_DRAFT_PREFIX)) {
                    const storedExamId = key.replace(`${GENERATION_DRAFT_PREFIX}:`, '').toLowerCase();
                    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
                    if (!parsed || !Array.isArray(parsed.structure) || parsed.structure.length === 0) continue;

                    // 1. 完全一致・部分一致
                    if (storedExamId === targetLower || targetLower.includes(storedExamId) || storedExamId.includes(targetLower)) {
                        return parsed;
                    }

                    // 2. 学部ID (fac8090 等) による一致判定
                    if (targetFacMatch && storedExamId.includes(targetFacMatch[0])) {
                        return parsed;
                    }

                    // 3. 年度 + 科目 + キーワードによる判定
                    if (targetYearMatch && storedExamId.includes(targetYearMatch[0])) {
                        const storedIsJp = storedExamId.includes('japanese') || storedExamId.includes('国語');
                        const storedIsEn = storedExamId.includes('english') || storedExamId.includes('英語');
                        if ((targetIsJp && storedIsJp) || (targetIsEn && storedIsEn)) {
                            if ((targetLower.includes('商') && storedExamId.includes('商')) ||
                                (targetLower.includes('早稲田') && storedExamId.includes('早稲田')) ||
                                (targetLower.includes('waseda') && storedExamId.includes('waseda'))) {
                                return parsed;
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[AdminExamEditor] Error scanning drafts in localStorage:', e);
        }
        return null;
    };

    // 利用可能なローカルドラフトの一覧スキャン
    useEffect(() => {
        try {
            const drafts = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(GENERATION_DRAFT_PREFIX)) {
                    const storedExamId = key.replace(`${GENERATION_DRAFT_PREFIX}:`, '');
                    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
                    if (parsed && Array.isArray(parsed.structure) && parsed.structure.length > 0) {
                        const qCount = parsed.structure.reduce((s, sec) => s + (sec.questions?.length || 0), 0);
                        if (qCount > 0) {
                            drafts.push({
                                key,
                                examId: storedExamId,
                                structure: parsed.structure,
                                questionCount: qCount,
                                sectionCount: parsed.structure.length,
                                savedAt: parsed.savedAt || ''
                            });
                        }
                    }
                }
            }
            setAvailableDrafts(drafts);
        } catch (e) {
            console.warn('[AdminExamEditor] Error reading available drafts:', e);
        }
    }, [examData]);

    const handleRestoreDraft = (draftItem) => {
        if (!draftItem || !draftItem.structure) return;
        const loadedStructure = normalizeEditorStructure(draftItem.structure);
        const questionCount = loadedStructure.reduce((s, sec) => s + (sec.questions?.length || 0), 0);
        const totalPoints = loadedStructure.reduce((sum, sec) => 
            sum + (sec.questions || []).reduce((qsum, q) => qsum + (Number(q.points) || 0), 0)
        , 0);

        setExamData(prev => ({
            ...(prev || {}),
            max_score: totalPoints > 0 ? totalPoints : (prev?.max_score || 100),
            structure: loadedStructure
        }));
        setSectionCount(Math.max(loadedStructure.length, 1));

        if (isNew && draftItem.examId) {
            setExamId(draftItem.examId);
            if (draftItem.examId.includes('早稲田')) setUniversity('早稲田大学');
            if (draftItem.examId.includes('商')) setFaculty('商（地歴・公民型）');
            const yearMatch = draftItem.examId.match(/202\d/);
            if (yearMatch) setYear(parseInt(yearMatch[0], 10));
            if (draftItem.examId.includes('japanese') || draftItem.examId.includes('国語')) {
                setSubject('国語');
                setSubjectEn('japanese');
            }
        }

        setHasUnsavedChanges(true);
        alert(`生成済みデータ（${questionCount}問 / 計${totalPoints}点）をエディタに復元しました！\n\n右上の「💾 保存する」ボタンを押すとデータベースに反映されます。`);
    };

    const handleDismissDraft = (key) => {
        if (window.confirm('このローカル下書きを破棄してもよろしいですか？')) {
            localStorage.removeItem(key);
            setAvailableDrafts(prev => prev.filter(d => d.key !== key));
        }
    };

    const persistSectionMerge = async (sectionNum, sectionData, { syncLocal = true } = {}) => {
        if (!examId || isNew) {
            // For new exams, we must build the merged structure ourselves and pass it
            // to handleSave via structureOverride, because the React state update from
            // setExamData hasn't committed yet and examDataRef still has stale data.
            const currentStructure = [...(examDataRef.current?.structure || [])];
            const sIdx = sectionNum - 1;
            while (currentStructure.length <= sIdx) {
                currentStructure.push({
                    id: String(currentStructure.length + 1),
                    label: `第${currentStructure.length + 1}問`,
                    allocatedPoints: 0,
                    sectionAnalysis: '',
                    questionType: 'default',
                    questions: []
                });
            }
            currentStructure[sIdx] = {
                ...currentStructure[sIdx],
                ...sectionData,
                id: String(sectionData?.id || currentStructure[sIdx]?.id || sectionNum),
                label: sectionData?.label || currentStructure[sIdx]?.label || `第${sectionNum}問`
            };
            const { structure: choiceNormalized } = normalizeExamStructureChoiceLabels(currentStructure);
            const mergedStructure = normalizeEditorStructure(choiceNormalized);
            await handleSave(false, mergedStructure, Math.max(sectionCount, mergedStructure.length));
            return;
        }

        const runMerge = async () => {
            const { data: latestExam, error: fetchError } = await getAdminExamById(examId);
            if (fetchError) throw fetchError;

            const latestStructure = Array.isArray(latestExam?.structure) ? [...latestExam.structure] : [];
            const sIdx = sectionNum - 1;
            while (latestStructure.length <= sIdx) {
                latestStructure.push({
                    id: String(latestStructure.length + 1),
                    label: `第${latestStructure.length + 1}問`,
                    allocatedPoints: 0,
                    sectionAnalysis: '',
                    questionType: 'default',
                    questions: []
                });
            }

            latestStructure[sIdx] = {
                ...latestStructure[sIdx],
                ...sectionData,
                id: String(sectionData?.id || latestStructure[sIdx]?.id || sectionNum),
                label: sectionData?.label || latestStructure[sIdx]?.label || `第${sectionNum}問`
            };

            const { structure: choiceNormalizedStructure } = normalizeExamStructureChoiceLabels(latestStructure);
            const normalizedStructure = normalizeEditorStructure(choiceNormalizedStructure);
            saveGenerationDraft(normalizedStructure, `大問${sectionNum}のDB保存前`);
            const { error: updateError } = await updateAdminFields(examId, { structure: normalizedStructure });
            if (updateError) throw updateError;
            clearGenerationDraft();

            if (syncLocal) {
                setExamData(prev => ({ ...prev, structure: normalizedStructure }));
                markCurrentStateAsSaved(buildEditorSnapshot(normalizedStructure, Math.max(sectionCount, normalizedStructure.length)));
            }

            return normalizedStructure;
        };

        if (navigator?.locks?.request) {
            return navigator.locks.request(`exam-structure:${examId}`, runMerge);
        }

        return runMerge();
    };

    useEffect(() => {
        const handleBeforeUnload = (event) => {
            if (!hasUnsavedChanges || saving) return;
            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasUnsavedChanges, saving]);

    useEffect(() => {
        const handleDocumentClick = (event) => {
            if (!hasUnsavedChanges || saving || event.defaultPrevented) return;
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

            const link = event.target.closest?.('a[href]');
            if (!link || link.target || link.hasAttribute('download')) return;

            const destination = new URL(link.href, window.location.href);
            const current = new URL(window.location.href);
            if (destination.origin !== current.origin || destination.href === current.href) return;

            const shouldLeave = window.confirm('未保存の変更があります。このページを離れると変更が失われます。移動しますか？');
            if (!shouldLeave) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            event.preventDefault();
            skipUnsavedCheckRef.current = true;
            setHasUnsavedChanges(false);
            window.location.assign(destination.href);
        };

        document.addEventListener('click', handleDocumentClick, true);
        return () => document.removeEventListener('click', handleDocumentClick, true);
    }, [hasUnsavedChanges, saving]);

    useEffect(() => {
        if (!examData) return;

        if (skipUnsavedCheckRef.current || !savedSnapshotRef.current) {
            const currentSnapshot = buildEditorSnapshot();
            markCurrentStateAsSaved(currentSnapshot);
            return;
        }

        // Large exam structures make JSON snapshot comparisons expensive.
        // Mark dirty immediately for navigation safety, then verify after typing/rendering settles.
        setHasUnsavedChanges(true);
        if (dirtyCheckTimerRef.current) {
            window.clearTimeout(dirtyCheckTimerRef.current);
        }
        dirtyCheckTimerRef.current = window.setTimeout(() => {
            const currentSnapshot = buildEditorSnapshot();
            setHasUnsavedChanges(currentSnapshot !== savedSnapshotRef.current);
            dirtyCheckTimerRef.current = null;
        }, 350);

        return () => {
            if (dirtyCheckTimerRef.current) {
                window.clearTimeout(dirtyCheckTimerRef.current);
                dirtyCheckTimerRef.current = null;
            }
        };
    }, [
        examId,
        university,
        universityId,
        faculty,
        facultyId,
        year,
        subject,
        subjectEn,
        type,
        masterStatus,
        durationMinutes,
        examData,
        customLayout,
        sectionCount,
        sectionInstructionsBySection,
        sectionPointsBySection
    ]);



    useEffect(() => {
        getUniversityList().then(data => setUniversitiesData(data || []));
        if (!isNew) {
            fetchExam();
        }
    }, [id]);

    useEffect(() => {
        if (isNew) {
            setExamId(`${universityId}-${facultyId}-${year}-${subjectEn}`.toLowerCase());
        }
    }, [universityId, facultyId, year, subjectEn, isNew]);

    // 大学リストの非同期ロード完了時にIDを補正
    useEffect(() => {
        if (isNew && university && universitiesData.length > 0) {
            const matchUni = universitiesData.find(u => u.name === university);
            if (matchUni && matchUni.id !== universityId) {
                setUniversityId(matchUni.id);
            }
            if (faculty && matchUni?.faculties) {
                const matchFac = matchUni.faculties.find(f => f.name === faculty);
                if (matchFac && matchFac.id !== facultyId) {
                    setFacultyId(matchFac.id);
                }
            }
        }
    }, [universitiesData, university, faculty, isNew]);

    const handleUniversityChange = (e) => {
        const val = e.target.value;
        setUniversity(val);
        const match = universitiesData.find(u => u.name === val);
        if (match) {
            setUniversityId(match.id);
        } else {
            setUniversityId(Math.floor(Math.random() * 10000));
        }
    };

    const handleFacultyChange = (e) => {
        const val = e.target.value;
        setFaculty(val);
        const uni = universitiesData.find(u => u.name === university);
        const match = uni?.faculties.find(f => f.name === val);
        if (match) {
            setFacultyId(match.id);
        } else {
            setFacultyId('fac' + Math.floor(Math.random() * 10000));
        }
    };

    const normalizeSubjectFromMetadata = (subjectEnValue, subjectLabel) => {
        return inferSubjectIdFromLabel(subjectEnValue, subjectLabel);
    };

    const enrichMetadataWithKnowledge = (metadata) => {
        const normalizedSubjectEn = normalizeSubjectFromMetadata(metadata.subject_en, metadata.subject);
        const knowledgeCandidatesList = listUniversityMetadataKnowledgeCandidates({
            university: metadata.university,
            year: metadata.year,
            subject: metadata.subject,
            subject_en: normalizedSubjectEn
        });
        const knowledge = findUniversityMetadataKnowledge({
            university: metadata.university,
            faculty: metadata.faculty,
            subject: metadata.subject,
            year: metadata.year,
            subject_en: normalizedSubjectEn
        });

        return {
            ...metadata,
            subject_en: normalizedSubjectEn,
            max_score: metadata.max_score ?? knowledge?.max_score ?? null,
            duration_minutes: metadata.duration_minutes ?? knowledge?.duration_minutes ?? null,
            passing_lines: knowledge?.passing_lines || null,
            knowledgeMatched: Boolean(knowledge),
            knowledgeSources: knowledge?.sources || [],
            knowledgeNotes: knowledge?.notes || [],
            knowledgeCandidates: knowledgeCandidatesList
        };
    };

    const applyKnowledgeCandidate = (candidate) => {
        if (!candidate) return;
        applyMetadataToForm({
            university: candidate.university,
            faculty: candidate.faculty,
            year: candidate.year,
            subject: candidate.subject,
            subject_en: candidate.subject_en,
            max_score: candidate.max_score,
            duration_minutes: candidate.duration_minutes,
            passing_lines: candidate.passing_lines
        });
    };

    const applyMetadataToForm = (metadata) => {
        if (metadata.university) {
            setUniversity(metadata.university);
            const matchedUniversity = universitiesData.find(u => u.name === metadata.university);
            setUniversityId(matchedUniversity?.id || Math.floor(Math.random() * 10000));

            if (metadata.faculty) {
                setFaculty(metadata.faculty);
                const matchedFaculty = matchedUniversity?.faculties.find(f => f.name === metadata.faculty);
                setFacultyId(matchedFaculty?.id || ('fac' + Math.floor(Math.random() * 10000)));
            }
        } else if (metadata.faculty) {
            setFaculty(metadata.faculty);
            setFacultyId('fac' + Math.floor(Math.random() * 10000));
        }

        if (metadata.year) {
            setYear(String(metadata.year));
        }

        if (metadata.subject) {
            setSubject(metadata.subject);
        }

        setSubjectEn(metadata.subject_en || normalizeSubjectFromMetadata(metadata.subject_en, metadata.subject));

        if (metadata.duration_minutes !== null && metadata.duration_minutes !== undefined) {
            setDurationMinutes(String(metadata.duration_minutes));
        }

        if (metadata.max_score) {
            setExamData(prev => ({
                ...prev,
                max_score: metadata.max_score,
                passing_lines: metadata.passing_lines || {
                    A: Math.round(metadata.max_score * 0.8),
                    B: Math.round(metadata.max_score * 0.7),
                    C: Math.round(metadata.max_score * 0.6),
                    D: Math.round(metadata.max_score * 0.4)
                }
            }));
        } else if (metadata.passing_lines) {
            setExamData(prev => ({
                ...prev,
                passing_lines: metadata.passing_lines
            }));
        }
    };

    useEffect(() => {
        if (!isNew || initialBaseDataAppliedRef.current) return;

        const params = new URLSearchParams(location.search);
        const baseDataId = params.get('baseDataId');
        if (!baseDataId) return;

        const data = universityBaseData.find(item => getUniversityBaseDataId(item) === baseDataId);
        if (!data) return;

        initialBaseDataAppliedRef.current = true;
        applyMetadataToForm({
            university: data.university,
            faculty: data.faculty,
            year: data.year,
            subject: data.subject,
            subject_en: normalizeSubjectFromMetadata(data.subject_en, data.subject),
            max_score: data.maxScore,
            duration_minutes: data.duration,
            passing_lines: data.passingLines
        });
    }, [isNew, location.search]);

    const handleExtractMetadata = async () => {
        const finalQFiles = questionFiles.length > 0 ? questionFiles : (examData?.pdf_path ? [examData.pdf_path] : []);
        if (finalQFiles.length === 0) {
            alert('先に問題PDFをアップロードしてください。');
            return;
        }

        setExtractingMetadata(true);
        try {
            const metadata = await geminiQueue.add(() => extractExamMetadata(finalQFiles));
            const enrichedMetadata = enrichMetadataWithKnowledge(metadata);
            applyMetadataToForm(enrichedMetadata);
            setKnowledgeCandidates(enrichedMetadata.knowledgeCandidates || []);
            setSelectedKnowledgeKey(enrichedMetadata.knowledgeCandidates?.[0]?.key || '');
            alert(enrichedMetadata.knowledgeMatched
                ? '基本情報の自動入力が完了しました。大学データから満点・制限時間・判定ラインも補完しました。'
                : '基本情報の自動入力が完了しました。内容を確認してください。');
        } catch (error) {
            console.error('Metadata extraction failed:', error);
            alert('基本情報の自動入力に失敗しました。\n' + error.message);
        } finally {
            setExtractingMetadata(false);
        }
    };

    const fetchExam = async () => {
        setLoading(true);
        const { data, error } = await getAdminExamById(id);
        if (error) {
            console.error('[AdminExamEditor] Failed to fetch exam:', id, error);
            const isNotFound = error?.code === 'PGRST116' || String(error?.message || '').includes('0 rows') || String(error?.details || '').includes('0 rows');

            // 1. ローカルストレージ内の生成済みドラフト（下書きデータ）を自動復元
            const draft = findMatchingDraft(id);
            if (draft && Array.isArray(draft.structure) && draft.structure.length > 0) {
                console.info('[AdminExamEditor] Restoring unpersisted exam from local draft:', id, draft);
                const loadedStructure = normalizeEditorStructure(draft.structure);
                const questionCount = loadedStructure.reduce((s, sec) => s + (sec.questions?.length || 0), 0);
                const totalPoints = loadedStructure.reduce((sum, sec) => 
                    sum + (sec.questions || []).reduce((qsum, q) => qsum + (Number(q.points) || 0), 0)
                , 0);

                const parsedYearMatch = String(id).match(/202[0-9]/);
                const parsedYear = parsedYearMatch ? parseInt(parsedYearMatch[0], 10) : 2026;
                const isJp = String(id).includes('japanese') || String(id).includes('国語');

                setExamId(id);
                setUniversity(String(id).includes('早稲田') ? '早稲田大学' : '早稲田大学');
                setFaculty(String(id).includes('商') ? '商学部（地歴・公民型）' : '商学部');
                setYear(parsedYear);
                setSubject(isJp ? '国語' : '英語');
                setSubjectEn(isJp ? 'japanese' : 'english');
                setType('pdf');
                setMasterStatus('working');
                setDurationMinutes(isJp ? 90 : 60);

                setExamData({
                    max_score: totalPoints > 0 ? totalPoints : 60,
                    detailed_analysis: '',
                    structure: loadedStructure,
                    pdf_path: ''
                });
                setStructure(loadedStructure);
                setSectionCount(Math.max(loadedStructure.length, 1));
                if (draft.sectionInstructionsBySection) setSectionInstructionsBySection(draft.sectionInstructionsBySection);
                if (draft.sectionPointsBySection) setSectionPointsBySection(draft.sectionPointsBySection);
                if (draft.sectionExpectedQuestionCounts) setSectionExpectedQuestionCounts(draft.sectionExpectedQuestionCounts);

                setHasUnsavedChanges(true);
                setLoading(false);

                alert(`データベース上には未保存ですが、ローカルに一時保存されていた問題生成データ（${questionCount}問 / ${totalPoints || 60}点満点）を自動復元しました！\n\n画面右上の「💾 保存する」ボタンを押すと、データベースに正式に保存されます。`);
                return;
            }

            if (isNotFound) {
                const proceedNew = window.confirm(`試験データ（ID: "${id}"）がデータベースに見つかりませんでした。\n\n新規作成画面（/admin/exam/new）を開きますか？`);
                if (proceedNew) {
                    navigate('/admin/exam/new');
                    return;
                }
            } else {
                alert(`データの取得に失敗しました。\n対象ID: ${id}\n原因: ${error.message || '不明なエラー'}`);
            }
            navigate('/admin');
        } else if (data) {
            const draft = loadGenerationDraft(data.id);
            const dbUpdatedAt = data.updated_at ? new Date(data.updated_at).getTime() : 0;
            const draftSavedAt = draft?.savedAt ? new Date(draft.savedAt).getTime() : 0;
            const shouldRestoreDraft = draft && draftSavedAt > dbUpdatedAt;
            const loadedStructure = normalizeEditorStructure(shouldRestoreDraft ? draft.structure : (data.structure || []));

            setExamId(data.id);
            setUniversity(data.university);
            setUniversityId(data.university_id);
            setFaculty(data.faculty);
            setFacultyId(data.faculty_id);
            setYear(data.year);
            setSubject(data.subject);
            setSubjectEn(data.subject_en);
            setType(data.type);
            setMasterStatus(normalizeMasterStatus(data.master_status));
            setDurationMinutes(data.duration_minutes || 60);
            setExamData({
                max_score: data.max_score,
                detailed_analysis: data.detailed_analysis,
                structure: loadedStructure,
                pdf_path: data.pdf_path,
                passing_lines: data.passing_lines || { A: 80, B: 70, C: 60, D: 40 }
            });
            setCustomLayout(data.custom_layout || []);
            if (loadedStructure && loadedStructure.length > 0) {
                // Ensure at least 3 sections are shown or the stored count, whichever is higher
                const displayCount = Math.max(3, loadedStructure.length);
                setSectionCount(displayCount);

                // Also initialize the file and instruction maps for each section to avoid blanks
                const qMap = {};
                const aMap = {};
                const iMap = {};
                const pMap = {};
                const cMap = {};

                // Initialize all slots up to displayCount
                for (let n = 1; n <= displayCount; n++) {
                    const sec = loadedStructure[n - 1];
                    qMap[n] = [];
                    aMap[n] = [];
                    iMap[n] = sec?.instruction || '';
                    pMap[n] = sec?.allocatedPoints || '';
                    cMap[n] = sec?.questions?.length > 0 ? String(sec.questions.length) : '';
                }

                setQuestionFilesBySection(qMap);
                setAnswerFilesBySection(aMap);
                setSectionInstructionsBySection(iMap);
                setSectionPointsBySection(pMap);
                setSectionExpectedQuestionCounts(cMap);
            }
            if (shouldRestoreDraft) {
                alert('生成中に退避されていたデータを復元しました。内容を確認して保存してください。');
            }
        }
        setLoading(false);
    };

    const handleImportUniversityData = (e) => {
        const selectedId = e.target.value;
        if (!selectedId) return;

        const data = universityBaseData.find(d => getUniversityBaseDataId(d) === selectedId);
        if (!data) return;

        if (!confirm(`${data.university} ${data.faculty} の基礎データを読み込みますか？\n(満点、制限時間、合格ラインが上書きされます)`)) {
            e.target.value = "";
            return;
        }

        applyMetadataToForm({
            university: data.university,
            faculty: data.faculty,
            year: data.year,
            subject: data.subject,
            subject_en: normalizeSubjectFromMetadata(data.subject_en, data.subject),
            max_score: data.maxScore,
            duration_minutes: data.duration,
            passing_lines: data.passingLines
        });
        
        e.target.value = "";
        alert('データを読み込みました。');
    };

    const handleGenerateSection = async (sectionNum, silent = false, shouldExtractVocab = false, includeAnalysis = true, includeExplanations = true, options = {}) => {
        const fail = (message) => {
            if (!silent) alert(message);
            if (typeof options.onError === 'function') options.onError(message);
            return false;
        };

        if (!examId) {
            return fail('IDを入力してください。');
        }

        const qFiles = questionFilesBySection[sectionNum] || [];
        const aFiles = answerFilesBySection[sectionNum] || [];
        const hasUploadedAnswers = examData?.structure?.[sectionNum - 1]?.answer_pdf_path;
        
        if (qFiles.length === 0 && !examData?.structure?.[sectionNum - 1]?.question_pdf_path && questionFiles.length === 0 && !examData?.pdf_path) {
            return fail(`大問${sectionNum}の問題PDF、もしくは全体の問題PDFが必要です。`);
        }

        if (aFiles.length === 0 && !hasUploadedAnswers) {
            return fail(`大問${sectionNum}の解答画像が必要です。`);
        }

        const targetPoints = parseInt(sectionPointsBySection[sectionNum]);
        if (!targetPoints || isNaN(targetPoints) || targetPoints <= 0) {
            if (!silent && !confirm(`大問${sectionNum}の「目標配点」が設定されていません。\n配点はAIが自然な点数を適当に割り振ります（大問や全体の合計点が目標とズレる可能性があります）。\nよろしいですか？`)) {
                return fail(`大問${sectionNum}の「目標配点」が設定されていません。`);
            }
        }
        const manualExpectedCount = parseInt(sectionExpectedQuestionCounts[sectionNum]);
        const instructionForExpectedCount = getSectionInstruction(
            sectionInstructionsBySection,
            sectionNum,
            examData?.structure?.[sectionNum - 1]
        );
        const expectedQuestionCount = manualExpectedCount && !isNaN(manualExpectedCount) && manualExpectedCount > 0
            ? manualExpectedCount
            : extractExpectedQuestionCount(instructionForExpectedCount);

        setGeneratingSectionData(prev => ({ ...prev, [sectionNum]: true }));
        setSectionGenerationPhases(prev => ({ ...prev, [sectionNum]: 'structure' }));
        try {
            const instructionSourceSection = examData?.structure?.[sectionNum - 1];
            const baseInstruction = getSectionInstruction(sectionInstructionsBySection, sectionNum, instructionSourceSection);
            
            const savedQPath = examData?.structure?.[sectionNum - 1]?.question_pdf_path;
            const savedAPath = examData?.structure?.[sectionNum - 1]?.answer_pdf_path;
            const {
                questionFiles: finalQFiles,
                answerFiles: finalAFiles
            } = resolveSectionSourceFiles({
                sectionIndex: sectionNum,
                structure: examData?.structure || [],
                questionFilesBySection,
                answerFilesBySection,
                questionFiles,
                examPdfPath: examData?.pdf_path
            });
            const instruction = [
                baseInstruction,
                expectedQuestionCount
                    ? `【システム補足】この大問の期待小問数は ${expectedQuestionCount} 件です。${expectedQuestionCount} 件未満のquestionsは不完全データとして扱います。`
                    : ''
            ].filter(Boolean).join('\n\n').trim();

            console.info('[AdminExamEditor] generate section request', {
                sectionNum,
                expectedQuestionCount,
                targetPoints,
                questionFileCount: finalQFiles.length,
                answerFileCount: finalAFiles.length,
                hasSavedQuestion: Boolean(savedQPath),
                hasSavedAnswer: Boolean(savedAPath)
            });

            setSectionGenerationPhases(prev => ({ ...prev, [sectionNum]: 'structure' }));
            const sectionResult = await geminiQueue.add(() => generateSingleSectionData(
                subjectEn,
                sectionNum,
                finalQFiles,
                finalAFiles,
                instruction,
                targetPoints,
                expectedQuestionCount,
                false,
                !includeExplanations
            ));
            console.info('[AdminExamEditor] generate section response', {
                sectionNum,
                expectedQuestionCount,
                returnedQuestionCount: Array.isArray(sectionResult?.questions) ? sectionResult.questions.length : null,
                returnedQuestionIds: Array.isArray(sectionResult?.questions) ? sectionResult.questions.map(q => q?.id || q?.label) : []
            });
            let normalizedSectionResult = normalizeEditorStructure([sectionResult])[0] || sectionResult;
            validateGeneratedSection(normalizedSectionResult, `大問${sectionNum}の生成結果`, {
                targetPoints: targetPoints && !isNaN(targetPoints) && targetPoints > 0 ? targetPoints : null,
                expectedQuestionCount
            });

            const sIdx = sectionNum - 1;
            const existingSection = examData?.structure?.[sIdx] || {};
            const buildPersistableSection = (sectionData, sectionAnalysis = '') => ({
                ...sectionData,
                sectionAnalysis,
                questionType: sectionData.questionType || existingSection.questionType || 'default',
                vocabulary: existingSection.vocabulary || sectionData.vocabulary || [],
                answer_pdf_path: existingSection.answer_pdf_path,
                question_pdf_path: existingSection.question_pdf_path,
                instruction: existingSection.instruction || baseInstruction
            });

            const persistGeneratedStep = async (sectionData, sectionAnalysis = '') => {
                const stepSection = buildPersistableSection(sectionData, sectionAnalysis);
                setExamData(prev => {
                    const newStructure = [...(prev?.structure || [])];

                    while (newStructure.length <= sIdx) {
                        newStructure.push({ id: String(newStructure.length + 1), label: `第${newStructure.length + 1}問`, allocatedPoints: 0, sectionAnalysis: '', questionType: 'default', questions: [] });
                    }

                    newStructure[sIdx] = {
                        ...newStructure[sIdx],
                        ...stepSection,
                        vocabulary: newStructure[sIdx].vocabulary || stepSection.vocabulary || []
                    };

                    return { ...prev, structure: newStructure };
                });
                await persistSectionMerge(sectionNum, stepSection);
                return stepSection;
            };

            await persistGeneratedStep(normalizedSectionResult, '');

            if (includeExplanations) {
                setSectionGenerationPhases(prev => ({ ...prev, [sectionNum]: 'explanations' }));
                const sectionWithExplanations = await geminiQueue.add(() => generateSectionQuestionsExplanations(
                    subjectEn,
                    normalizedSectionResult,
                    finalQFiles,
                    finalAFiles,
                    {
                        onChunk: async (partialSection, chunkInfo) => {
                            const normalizedPartial = normalizeEditorStructure([partialSection])[0] || partialSection;
                            await persistGeneratedStep(normalizedPartial, '');
                            console.info('[AdminExamEditor] saved explanation chunk', {
                                sectionNum,
                                chunkInfo
                            });
                        }
                    }
                ));
                normalizedSectionResult = normalizeEditorStructure([sectionWithExplanations])[0] || sectionWithExplanations;
                await persistGeneratedStep(normalizedSectionResult, '');
            }

            const generationWarnings = Array.isArray(normalizedSectionResult.generationWarnings)
                ? normalizedSectionResult.generationWarnings.filter(Boolean)
                : [];

            let generatedSectionAnalysis = normalizedSectionResult.sectionAnalysis || '';
            if (includeAnalysis) {
                setSectionGenerationPhases(prev => ({ ...prev, [sectionNum]: 'analysis' }));
                generatedSectionAnalysis = await geminiQueue.add(() => generateSectionDetailedAnalysis(
                    subjectEn,
                    normalizedSectionResult,
                    finalQFiles,
                    finalAFiles,
                    buildSectionAnalysisInstruction(baseInstruction, normalizedSectionResult),
                    examData?.subject || subject || ''
                ));
                generatedSectionAnalysis = validateGeneratedText(generatedSectionAnalysis, `第${normalizedSectionResult.id || sectionNum}問の詳細解説`);
            }

            const sectionToPersist = buildPersistableSection(
                normalizedSectionResult,
                includeAnalysis ? generatedSectionAnalysis : ''
            );
            try {
                await persistGeneratedStep(normalizedSectionResult, includeAnalysis ? generatedSectionAnalysis : '');
            } catch (saveError) {
                console.error(`Section ${sectionNum} auto-save failed:`, saveError);
                throw new Error(`大問${sectionNum}の生成結果は画面に反映されましたが、自動保存に失敗しました: ${saveError.message}`);
            }

            // Automatic Vocabulary Extraction
            if (shouldExtractVocab) {
                setGeneratingVocabulary(prev => ({ ...prev, [sIdx]: true }));
                setSectionGenerationPhases(prev => ({ ...prev, [sectionNum]: 'vocabulary' }));
                try {
                    const vocabResult = await geminiQueue.add(() => extractSectionVocabulary(finalQFiles));
                    const sectionWithVocab = {
                        ...sectionToPersist,
                        vocabulary: vocabResult
                    };
                    setExamData(prev => {
                        const newStructure = [...(prev?.structure || [])];
                        newStructure[sIdx] = {
                            ...(newStructure[sIdx] || {}),
                            ...sectionWithVocab
                        };
                        return { ...prev, structure: newStructure };
                    });
                    await persistSectionMerge(sectionNum, sectionWithVocab);
                } catch (vocabError) {
                    console.error(`Vocabulary extraction failed for section ${sectionNum}:`, vocabError);
                    // Don't fail the whole process if only vocab fails, but maybe log it
                } finally {
                    setGeneratingVocabulary(prev => ({ ...prev, [sIdx]: false }));
                }
            }

            if (!silent) {
                const warningText = generationWarnings.length > 0
                    ? `\n\n【要確認】\n${generationWarnings.join('\n')}`
                    : '';
                alert(`大問${sectionNum}の生成が完了しました！下部のエディタ（C）に内容が反映されました。${warningText}`);
            }
            return true;
        } catch (error) {
            console.error(`Section ${sectionNum} Generation failed:`, error);
            const message = `大問${sectionNum}の生成中にエラーが発生しました。\n${error.message || '不明なエラー'}`;
            if (!silent) alert(message);
            if (typeof options.onError === 'function') options.onError(message);
            return false;
        } finally {
            setGeneratingSectionData(prev => ({ ...prev, [sectionNum]: false }));
            setSectionGenerationPhases(prev => {
                const next = { ...prev };
                delete next[sectionNum];
                return next;
            });
        }
    };

    const handleGenerateOnlyExplanations = async (sectionNum, includeAnalysis = true) => {
        const sIdx = sectionNum - 1;
        const sectionData = examData?.structure?.[sIdx];
        if (!sectionData) {
            alert('大問の構成データが見つかりません。先にStep 1を実行するか、手動で構成を作成してください。');
            return;
        }

        setGeneratingExplanationsOnly(prev => ({ ...prev, [sectionNum]: true }));
        setSectionGenerationPhases(prev => ({ ...prev, [sectionNum]: 'explanations' }));
        try {
            const {
                questionFiles: finalQFiles,
                answerFiles: finalAFiles
            } = resolveSectionSourceFiles({
                sectionIndex: sectionNum,
                structure: examData?.structure || [],
                questionFilesBySection,
                answerFilesBySection,
                questionFiles,
                examPdfPath: examData?.pdf_path
            });

            const result = await geminiQueue.add(() => generateSectionQuestionsExplanations(
                subjectEn,
                sectionData,
                finalQFiles,
                finalAFiles
            ));
            
            console.log("=== AI Generation Result ===", result);
            if (!result) {
                alert("AIから有効なデータが返されませんでした。");
                return;
            }

            let aiQuestions = [];
            if (Array.isArray(result)) {
                aiQuestions = result;
            } else if (result.questions) {
                if (Array.isArray(result.questions)) {
                    aiQuestions = result.questions;
                } else if (typeof result.questions === 'object') {
                    // Handle case where AI returns an object map { "id": { ... } }
                    aiQuestions = Object.values(result.questions);
                    // If the object values don't have IDs, use the keys
                    if (aiQuestions.length > 0 && !aiQuestions[0].id) {
                        aiQuestions = Object.entries(result.questions).map(([key, val]) => ({ ...val, id: key }));
                    }
                }
            }

            if (aiQuestions.length === 0) {
                alert("AIの回答から小問リストを抽出できませんでした。構造を確認してください。");
                console.error("Failed to extract questions from AI result:", result);
                return;
            }
            if (aiQuestions.length !== (sectionData.questions || []).length) {
                throw new Error(`AIの小問数 ${aiQuestions.length} 件が現在の小問数 ${(sectionData.questions || []).length} 件と一致しません。誤った紐付けを避けるため反映しません。`);
            }
            if (!aiQuestions.some(q => q?.explanation && String(q.explanation).trim())) {
                throw new Error('AIが有効な小問解説を返しませんでした。反映を中止しました。');
            }
            const unansweredQuestions = (sectionData.questions || []).filter(q => !q.explanation || !String(q.explanation).trim());
            const missingGeneratedExplanations = unansweredQuestions.filter((origQ, idx) => {
                const match = aiQuestions.find(newQ =>
                    String(newQ.id).trim() === String(origQ.id).trim() ||
                    String(newQ.label).trim() === String(origQ.label).trim()
                ) || (aiQuestions.length === (sectionData.questions || []).length ? aiQuestions[idx] : null);
                return !match?.explanation || !String(match.explanation).trim();
            });
            if (missingGeneratedExplanations.length > 0) {
                throw new Error(`AIが ${missingGeneratedExplanations.length} 件の小問解説を返しませんでした。反映を中止しました。`);
            }

            let generatedSectionAnalysis = sectionData.sectionAnalysis || '';
            if (includeAnalysis) {
                setSectionGenerationPhases(prev => ({ ...prev, [sectionNum]: 'analysis' }));
                ensureSectionAnalysisSources(sectionData, finalQFiles, finalAFiles);
                generatedSectionAnalysis = await geminiQueue.add(() => generateSectionDetailedAnalysis(
                    subjectEn,
                    sectionData,
                    finalQFiles,
                    finalAFiles,
                    buildSectionAnalysisInstruction(getSectionInstruction(sectionInstructionsBySection, sectionNum, sectionData), sectionData),
                    examData?.subject || ''
                ));
                generatedSectionAnalysis = validateGeneratedText(generatedSectionAnalysis, `第${sectionData.id}問の詳細解説`);
            }

            // Robust update logic: Try ID match first, then index match as fallback.
            const mergedQuestions = sectionData.questions.map((origQ, idx) => {
                let match = aiQuestions.find(newQ =>
                    String(newQ.id).trim() === String(origQ.id).trim() ||
                    String(newQ.label).trim() === String(origQ.label).trim()
                );

                if (!match && aiQuestions.length === sectionData.questions.length && aiQuestions[idx]) {
                    console.warn(`ID mismatch for question ${origQ.id}. Falling back to index match.`);
                    match = aiQuestions[idx];
                }

                if (match && match.explanation) {
                    return {
                        ...origQ,
                        ...buildResolvedCorrectAnswerPatch(origQ, match),
                        explanation: match.explanation
                    };
                }
                return origQ;
            });

            const finalSectionForSave = {
                ...sectionData,
                sectionAnalysis: includeAnalysis ? generatedSectionAnalysis : sectionData.sectionAnalysis,
                questions: mergedQuestions
            };

            setExamData(prev => {
                const newStructure = [...(prev?.structure || [])];
                newStructure[sIdx] = finalSectionForSave;
                return { ...prev, structure: newStructure };
            });

            await persistSectionMerge(sectionNum, finalSectionForSave);

            alert(includeAnalysis
                ? `大問 ${sectionNum} の小問解説・詳細解説の生成が完了しました！`
                : `大問 ${sectionNum} の小問解説の生成が完了しました！`
            );

        } catch (err) {
            console.error(err);
            alert(`生成中にエラーが発生しました: ${err.message}`);
        } finally {
            setGeneratingExplanationsOnly(prev => ({ ...prev, [sectionNum]: false }));
            setSectionGenerationPhases(prev => {
                const next = { ...prev };
                delete next[sectionNum];
                return next;
            });
        }
    };

    const handleBulkGenerateSections = async (includeAnalysis = true, includeExplanations = true) => {
        if (!examId) {
            alert('IDを入力してください。');
            return;
        }
        
        // Initial validations before bulk start
        for (let i = 1; i <= sectionCount; i++) {
            const qFiles = questionFilesBySection[i] || [];
            const aFiles = answerFilesBySection[i] || [];
            const hasUploadedAnswers = examData?.structure?.[i - 1]?.answer_pdf_path;
            
            if (qFiles.length === 0 && !examData?.structure?.[i - 1]?.question_pdf_path && questionFiles.length === 0 && !examData?.pdf_path) {
                alert(`大問${i}の問題PDF、もしくは全体の問題PDFが必要です。`);
                return;
            }
            if (aFiles.length === 0 && !hasUploadedAnswers) {
                alert(`大問${i}の解答画像が必要です。`);
                return;
            }
        }

        const generationModeLabel = includeAnalysis
            ? '大問構成・小問解説・詳細解説'
            : includeExplanations
                ? '大問構成・小問解説'
                : '大問構成のみ';

        if (!confirm(`全 ${sectionCount} つの大問データを「${generationModeLabel}」で順番にAI生成します。処理には時間がかかる場合があります。\nよろしいですか？`)) {
            return;
        }

        setIsBulkGeneratingSections(true);
        setBulkSectionsProgress({ current: 0, total: sectionCount });

        try {
            const failures = [];
            let successCount = 0;
            for (let i = 1; i <= sectionCount; i++) {
                setBulkSectionsProgress({ current: i, total: sectionCount });
                let failureMessage = '';
                const success = await handleGenerateSection(i, true, bulkIncludeVocab, includeAnalysis, includeExplanations, {
                    onError: (message) => {
                        failureMessage = message;
                    }
                });
                
                if (!success) {
                    failures.push(`第${i}問`);
                    const detail = failureMessage ? `\n\n原因:\n${failureMessage}` : '';
                    const proceed = confirm(`大問${i}の生成中にエラーが発生しました。${detail}\n\nこの大問をスキップして次へ進みますか？\n(「キャンセル」を押すと一括処理を中断します)`);
                    if (!proceed) break;
                    continue;
                }
                successCount += 1;
                
                // Rate limit spacing
                if (i < sectionCount) {
                    await new Promise(res => setTimeout(res, 3000));
                }
            }
            if (failures.length > 0) {
                alert(`${successCount}件の大問生成が完了しました。\n\n以下は生成できていません:\n${failures.join('\n')}\n\n未生成の大問は、問題PDF・解答画像・期待小問数を確認してから個別に再生成してください。`);
            } else {
                alert('全大問の生成が完了しました！下部のエディタ（C）に内容が反映されました。');
            }
        } catch (error) {
            console.error("Bulk Generation error:", error);
            alert('一括生成中に予期せぬエラーが発生しました: ' + error.message);
        } finally {
            setIsBulkGeneratingSections(false);
            setBulkSectionsProgress({ current: 0, total: 0 });
        }
    };

    const handleGenerate = async () => {
        const totalAnswerFiles = Object.values(answerFilesBySection).reduce((sum, arr) => sum + arr.length, 0);
        const hasUploadedAnswers = (examData?.structure || []).some(s => s.answer_pdf_path);

        if (!examId) {
            alert('IDを入力してください。');
            return;
        }

        const hasAnySectionQuestionSource = Array.from({ length: sectionCount }, (_, idx) => idx + 1).some((sectionNum) => (
            (questionFilesBySection[sectionNum] || []).length > 0 ||
            Boolean(examData?.structure?.[sectionNum - 1]?.question_pdf_path)
        ));

        if (questionFiles.length === 0 && !examData?.pdf_path && !hasAnySectionQuestionSource) {
            alert('問題ファイルが必要です。');
            return;
        }

        if (totalAnswerFiles === 0 && !hasUploadedAnswers) {
            alert('解答ファイルが必要です。');
            return;
        }

        setGenerating(true);
        try {
            // Ensure files are uploaded if not already, fallback to saved paths.
            const finalQFiles = questionFiles.length > 0 ? questionFiles : (examData?.pdf_path ? [examData.pdf_path] : []);
            const finalQFilesBySection = {};
            for (let i = 1; i <= sectionCount; i++) {
                const localQ = questionFilesBySection[i] || [];
                const savedQ = examData?.structure?.[i - 1]?.question_pdf_path;
                finalQFilesBySection[i] = localQ.length > 0 ? localQ : (savedQ ? [savedQ] : []);
            }
            
            // For answers, we'd need to map them properly if missing, but usually they are section-specific
            const finalAFiles = {};
            for (let i = 1; i <= sectionCount; i++) {
                const localA = answerFilesBySection[i] || [];
                const savedA = examData?.structure?.[i - 1]?.answer_pdf_path;
                finalAFiles[i] = localA.length > 0 ? localA : (savedA ? [savedA] : []);
            }

            const result = await geminiQueue.add(() => generateExamMasterData(
                subjectEn,
                finalQFiles,
                finalQFilesBySection,
                finalAFiles,
                sectionInstructionsBySection,
                sectionPointsBySection,
                {
                    id: examId, university, universityId: parseInt(universityId),
                    faculty, facultyId, year: parseInt(year), subject,
                    generateDetailed, maxScore: parseInt(examData?.max_score) || 100
                }
            ));
            const normalizedResultStructure = normalizeEditorStructure(result.structure || []);
            const normalizedResult = { ...result, structure: normalizedResultStructure };
            validateGeneratedExamMaster(normalizedResult, parseInt(examData?.max_score) || 100);

            setExamData(prev => ({
                ...prev,
                max_score: normalizedResult.max_score,
                detailed_analysis: normalizedResult.detailed_analysis,
                structure: normalizedResult.structure.map((s, idx) => ({
                    ...s,
                    // Preserve existing PDF paths if the new structure doesn't have them
                    answer_pdf_path: prev?.structure?.[idx]?.answer_pdf_path || s.answer_pdf_path,
                    question_pdf_path: prev?.structure?.[idx]?.question_pdf_path || s.question_pdf_path
                })),
                pdf_path: normalizedResult.pdf_path || prev?.pdf_path,
                passing_lines: prev?.passing_lines || { A: Math.round(normalizedResult.max_score * 0.8), B: Math.round(normalizedResult.max_score * 0.7), C: Math.round(normalizedResult.max_score * 0.6), D: Math.round(normalizedResult.max_score * 0.4) }
            }));
            alert('マスターデータの生成が完了しました！内容を確認・編集して保存してください。');
        } catch (error) {
            console.error("AI Generation failed:", error);
            alert('生成中にエラーが発生しました。\n' + error.message);
        } finally {
            setGenerating(false);
        }
    };

    const handleCopyStructureExplanations = async () => {
        if (!examData) return;
        let copyPdfPath = examData.pdf_path || '';

        if (!copyPdfPath && questionFiles.length > 0) {
            if (!examId) {
                alert('全体PDFをコピーに含めるには、先に試験IDが必要です。');
                return;
            }
            try {
                setUploadingQuestion(true);
                const { publicUrl, error: uploadError } = await uploadExamPdf(questionFiles[0], examId);
                if (uploadError) throw uploadError;
                copyPdfPath = publicUrl || '';
                if (copyPdfPath) {
                    setExamData(prev => ({ ...prev, pdf_path: copyPdfPath }));
                }
            } catch (err) {
                console.error('Failed to upload PDF before copy:', err);
                alert('全体PDFのアップロードに失敗したため、コピーを中止しました。\n' + err.message);
                return;
            } finally {
                setUploadingQuestion(false);
            }
        }

        const effectiveSectionCount = Math.max(sectionCount, examData.structure?.length || 0);
        const syncedStructure = [];
        for (let i = 1; i <= effectiveSectionCount; i++) {
            const existing = examData.structure?.[i - 1] || {
                id: String(i),
                label: `第${i}問`,
                questions: [],
                sectionAnalysis: '',
                questionType: 'default'
            };
            syncedStructure.push({
                ...existing,
                instruction: sectionInstructionsBySection[i] || existing.instruction || '',
                allocatedPoints: parseInt(sectionPointsBySection[i]) || existing.allocatedPoints || 0
            });
        }

        const copyData = {
            schema: 'smashai.examDataCopy.v2',
            copiedAt: new Date().toISOString(),
            pdf_path: copyPdfPath,
            structure: syncedStructure,
            detailed_analysis: examData.detailed_analysis || '',
            custom_layout: customLayout || []
        };
        navigator.clipboard.writeText(JSON.stringify(copyData, null, 2))
            .then(() => {
                alert('問題データ一式をクリップボードにコピーしました！');
            })
            .catch(err => {
                console.error('Failed to copy data:', err);
                alert('コピーに失敗しました。');
            });
    };

    const handlePasteStructureExplanations = async () => {
        try {
            const text = await navigator.clipboard.readText();
            const pasteData = JSON.parse(text);
            if (!pasteData || (!pasteData.structure && !pasteData.detailed_analysis)) {
                alert('無効なコピーデータです。');
                return;
            }
            const isV2Copy = pasteData.schema === 'smashai.examDataCopy.v2';
            const confirmMessage = isV2Copy
                ? 'クリップボードの問題データ一式を貼り付けますか？\n全体PDF・大問別PDF/GIF・問題構造・詳細解説・レイアウトが上書きされます。\n大学名・学部名・年度・科目・満点・制限時間・合格ライン・試験IDは現在の画面のまま残します。'
                : 'クリップボードのデータで「問題の構造」と「詳細解説」を上書きしますか？（古いコピー形式のため、PDFや合格ラインは含まれません）';

            if (confirm(confirmMessage)) {
                const nextStructure = Array.isArray(pasteData.structure)
                    ? normalizeEditorStructure(normalizeExamStructureChoiceLabels(pasteData.structure).structure)
                    : [];
                setExamData(prev => ({
                    ...prev,
                    pdf_path: isV2Copy ? (pasteData.pdf_path || prev?.pdf_path || '') : (prev?.pdf_path || ''),
                    structure: nextStructure.length > 0 ? nextStructure : (prev?.structure || []),
                    detailed_analysis: pasteData.detailed_analysis ?? prev?.detailed_analysis ?? ''
                }));

                if (isV2Copy) {
                    if (Array.isArray(pasteData.custom_layout)) setCustomLayout(pasteData.custom_layout);
                }

                if (nextStructure.length > 0) {
                    setSectionCount(Math.max(3, nextStructure.length));
                    const instructionMap = {};
                    const pointsMap = {};
                    const countMap = {};
                    for (let i = 1; i <= Math.max(3, nextStructure.length); i++) {
                        const section = nextStructure[i - 1];
                        instructionMap[i] = section?.instruction || '';
                        pointsMap[i] = section?.allocatedPoints ? String(section.allocatedPoints) : '';
                        countMap[i] = Array.isArray(section?.questions) && section.questions.length > 0 ? String(section.questions.length) : '';
                    }
                    setSectionInstructionsBySection(instructionMap);
                    setSectionPointsBySection(pointsMap);
                    setSectionExpectedQuestionCounts(countMap);
                }
                alert('移植が完了しました。保存ボタンを押すと変更が確定します。');
            }
        } catch (err) {
            console.error('Failed to paste data:', err);
            alert('ペーストに失敗しました。クリップボードに正しいJSON形式のデータがあるか確認してください。');
        }
    };

    const handleSave = async (showPrompt = true, structureOverride = null, sectionCountOverride = null) => {
        if (!examId) {
            if (showPrompt) alert('IDを入力してください。');
            return;
        }

        const currentExamData = examDataRef.current || examData || {};
        setSaving(true);
        let finalPdfPath = currentExamData?.pdf_path || '';

        // Final check/upload for main PDF if not yet done
        if (questionFiles && questionFiles.length > 0 && !finalPdfPath) {
            try {
                const { publicUrl, error: uploadError } = await uploadExamPdf(questionFiles[0], examId);
                if (uploadError) throw uploadError;
                if (publicUrl) finalPdfPath = publicUrl;
            } catch (err) {
                if (showPrompt) alert('PDFのアップロードに失敗しました:\n' + err.message);
                setSaving(false);
                return;
            }
        }

        // Sync UI inputs (Instructions/Points) into the structure before saving
        const currentStructure = structureOverride || currentExamData?.structure || [];
        const effectiveSectionCount = Math.max(
            Number(sectionCountOverride) || 0,
            Number(sectionCount) || 0,
            Array.isArray(currentStructure) ? currentStructure.length : 0
        );
        const syncedStructure = [];
        for (let i = 1; i <= effectiveSectionCount; i++) {
            const existing = currentStructure[i - 1] || { 
                id: String(i), 
                label: `第${i}問`, 
                questions: [],
                sectionAnalysis: '',
                questionType: 'default'
            };
            const parsedSectionPoints = parseInt(sectionPointsBySection[i], 10);
            syncedStructure.push({
                ...existing,
                instruction: sectionInstructionsBySection[i] ?? existing.instruction ?? '',
                allocatedPoints: Number.isFinite(parsedSectionPoints)
                    ? parsedSectionPoints
                    : existing.allocatedPoints || 0
            });
        }

        const { structure: choiceNormalizedStructure } = normalizeExamStructureChoiceLabels(syncedStructure);
        const normalizedStructure = normalizeEditorStructure(choiceNormalizedStructure);

        const payload = {
            id: examId,
            university,
            university_id: parseInt(universityId) || 0,
            faculty,
            faculty_id: facultyId,
            year: parseInt(year),
            subject,
            subject_en: subjectEn,
            type,
            master_status: masterStatus,
            is_published: masterStatus === 'production',
            duration_minutes: parseInt(durationMinutes) || 60,
            pdf_path: finalPdfPath,
            max_score: parseInt(currentExamData?.max_score || 100),
            detailed_analysis: currentExamData?.detailed_analysis || '',
            structure: normalizedStructure,
            passing_lines: currentExamData?.passing_lines || { A: 80, B: 70, C: 60, D: 40 },
            custom_layout: customLayout
        };

        const { error } = await saveAdminExam(payload);
        setSaving(false);

        if (error) {
            console.error('[AdminExamEditor] Save failed:', error);
            const isRlsError = error?.code === '42501' || String(error?.message || '').includes('row-level security');
            const alertMsg = isRlsError
                ? `保存に失敗しました（RLS権限エラー 42501）:\n${error.message}\n\n※ Supabase側で管理者権限（RLSポリシーまたはRPC関数）の更新が必要です。\n生成済みデータはブラウザ（localStorage）に安全に保持されています。`
                : `保存に失敗しました:\n${error.message}`;
            alert(alertMsg);
        } else {
            const savedSnapshot = JSON.stringify(payload);
            const nextExamData = { ...currentExamData, pdf_path: finalPdfPath, structure: normalizedStructure };
            examDataRef.current = nextExamData;
            setExamData(nextExamData);
            clearGenerationDraft(examId);
            setAvailableDrafts(prev => prev.filter(d => d.examId !== examId && !d.key.includes(examId)));
            markCurrentStateAsSaved(savedSnapshot);
            if (showPrompt) alert('保存しました！');
            if (isNew && examId) {
                navigate(`/admin/exam/${examId}`, { replace: true });
            }
        }
    };

    // Lightweight immediate upload helper
    const handleImmediateUpload = async (file, type, sectionNum = null) => {
        if (!examId) {
            alert('先に試験IDを入力（または自動生成）してください。ファイルを保存するために必要です。');
            return null;
        }

        if (type === 'question') setUploadingQuestion(true);
        else if (type === 'answer' && sectionNum) setUploadingAnswers(prev => ({ ...prev, [sectionNum]: true }));
        else if (type === 'section_question' && sectionNum) setUploadingQuestion(true);

        try {
            const { publicUrl, error } = await uploadExamPdf(file, examId);
            if (error) throw error;

            // CRITICAL: Calculate the new expanded structure synchronously first
            // This prevents the "Save" call from using stale state that might truncate the array
            const currentStructure = [...(examData?.structure || [])];
            let updatedStructure = currentStructure;

            if (type === 'question') {
                setExamData(prev => ({ ...prev, pdf_path: publicUrl }));
                await handleSave(false, null); // For main PDF, we can use the default but it's safer to just save
            } else if ((type === 'answer' || type === 'section_question') && sectionNum !== null) {
                const sIdx = sectionNum - 1;
                // Pad the structure if it's shorter than the section number
                while (updatedStructure.length <= sIdx) {
                    updatedStructure.push({ 
                        id: String(updatedStructure.length + 1), 
                        label: `第${updatedStructure.length + 1}問`, 
                        allocatedPoints: 0, 
                        sectionAnalysis: '', 
                        questionType: 'default',
                        questions: [] 
                    });
                }
                
                // Update the specific path
                if (type === 'answer') {
                    updatedStructure[sIdx].answer_pdf_path = publicUrl;
                } else {
                    updatedStructure[sIdx].question_pdf_path = publicUrl;
                }

                // Update state
                setExamData(prev => ({ ...prev, structure: updatedStructure }));
                
                // CRITICAL: Save immediately with the expanded and updated structure
                await handleSave(false, updatedStructure);
            }

            return publicUrl;
        } catch (err) {
            console.error("Immediate upload failed:", err);
            alert('アップロードに失敗しました: ' + err.message);
            return null;
        } finally {
            if (type === 'question') setUploadingQuestion(false);
            else if (type === 'answer' && sectionNum) setUploadingAnswers(prev => ({ ...prev, [sectionNum]: false }));
            else if (type === 'section_question' && sectionNum) setUploadingQuestion(false);
        }
    };

    const handleBulkAnswerFilesSelect = (files) => {
        if (!validateUploadFiles(files, 'answer')) {
            setBulkAnswerFiles([]);
            return false;
        }
        const sorted = Array.from(files || []).sort((a, b) =>
            a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' })
        );
        setBulkAnswerFiles(sorted);
        setAnswerFilesBySection(prev => {
            const next = { ...prev };
            sorted.forEach((file, index) => {
                next[index + 1] = [file];
            });
            return next;
        });
        if (sorted.length > sectionCount) {
            setSectionCount(sorted.length);
        }
        return true;
    };

    const handleBulkQuestionFilesSelect = (files) => {
        if (!validateUploadFiles(files, 'question')) {
            setBulkQuestionFiles([]);
            return false;
        }
        const sorted = Array.from(files || []).sort((a, b) =>
            a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' })
        );
        setBulkQuestionFiles(sorted);
        setQuestionFilesBySection(prev => {
            const next = { ...prev };
            sorted.forEach((file, index) => {
                next[index + 1] = [file];
            });
            return next;
        });
        if (sorted.length > sectionCount) {
            setSectionCount(sorted.length);
        }
        return true;
    };

    const handleBulkQuestionUpload = async () => {
        if (!examId) {
            alert('先に試験IDを入力（または自動生成）してください。');
            return;
        }
        if (bulkQuestionFiles.length === 0) {
            alert('先に問題PDFをまとめて選択してください。');
            return;
        }
        if (!validateUploadFiles(bulkQuestionFiles, 'question')) return;

        const targetCount = Math.max(sectionCount, bulkQuestionFiles.length);
        if (!confirm(`${bulkQuestionFiles.length}件の問題PDFを、大問1から順に保存します。\n既存の大問別問題PDFは該当する大問だけ上書きされます。`)) {
            return;
        }

        setBulkUploadingQuestions(true);
        setBulkQuestionUploadProgress({ current: 0, total: bulkQuestionFiles.length });

        try {
            const updatedStructure = [...(examData?.structure || [])];
            while (updatedStructure.length < targetCount) {
                updatedStructure.push({
                    id: String(updatedStructure.length + 1),
                    label: `第${updatedStructure.length + 1}問`,
                    allocatedPoints: 0,
                    sectionAnalysis: '',
                    questionType: 'default',
                    questions: []
                });
            }

            for (let i = 0; i < bulkQuestionFiles.length; i += 1) {
                const file = bulkQuestionFiles[i];
                setBulkQuestionUploadProgress({ current: i + 1, total: bulkQuestionFiles.length });

                const { publicUrl, error } = await uploadExamPdf(file, examId);
                if (error) throw error;
                updatedStructure[i].question_pdf_path = publicUrl;
            }

            setSectionCount(targetCount);
            setExamData(prev => ({ ...prev, structure: updatedStructure }));
            await handleSave(false, updatedStructure, targetCount);
            alert('問題PDFのまとめ保存が完了しました。');
        } catch (err) {
            console.error('Bulk question upload failed:', err);
            alert('問題PDFのまとめ保存に失敗しました:\n' + err.message);
        } finally {
            setBulkUploadingQuestions(false);
            setBulkQuestionUploadProgress({ current: 0, total: 0 });
        }
    };

    const handleBulkAnswerUpload = async () => {
        if (!examId) {
            alert('先に試験IDを入力（または自動生成）してください。');
            return;
        }
        if (bulkAnswerFiles.length === 0) {
            alert('先に解答画像をまとめて選択してください。');
            return;
        }
        if (!validateUploadFiles(bulkAnswerFiles, 'answer')) return;

        const targetCount = Math.max(sectionCount, bulkAnswerFiles.length);
        if (!confirm(`${bulkAnswerFiles.length}件の解答画像を、大問1から順に保存します。\n既存の大問別解答画像は該当する大問だけ上書きされます。`)) {
            return;
        }

        setBulkUploadingAnswers(true);
        setBulkAnswerUploadProgress({ current: 0, total: bulkAnswerFiles.length });

        try {
            const updatedStructure = [...(examData?.structure || [])];
            while (updatedStructure.length < targetCount) {
                updatedStructure.push({
                    id: String(updatedStructure.length + 1),
                    label: `第${updatedStructure.length + 1}問`,
                    allocatedPoints: 0,
                    sectionAnalysis: '',
                    questionType: 'default',
                    questions: []
                });
            }

            for (let i = 0; i < bulkAnswerFiles.length; i += 1) {
                const sectionNum = i + 1;
                const file = bulkAnswerFiles[i];
                setUploadingAnswers(prev => ({ ...prev, [sectionNum]: true }));
                setBulkAnswerUploadProgress({ current: i + 1, total: bulkAnswerFiles.length });

                const { publicUrl, error } = await uploadExamPdf(file, examId);
                if (error) throw error;
                updatedStructure[i].answer_pdf_path = publicUrl;

                setUploadingAnswers(prev => ({ ...prev, [sectionNum]: false }));
            }

            setSectionCount(targetCount);
            setExamData(prev => ({ ...prev, structure: updatedStructure }));
            await handleSave(false, updatedStructure, targetCount);
            alert('解答画像のまとめ保存が完了しました。');
        } catch (err) {
            console.error('Bulk answer upload failed:', err);
            alert('解答画像のまとめ保存に失敗しました:\n' + err.message);
        } finally {
            setBulkUploadingAnswers(false);
            setBulkAnswerUploadProgress({ current: 0, total: 0 });
            setUploadingAnswers({});
        }
    };

    const handleExportCsv = () => {
        const structure = examData?.structure || [];
        if (!structure || structure.length === 0) {
            alert('エクスポート可能な大問・問題データがありません。');
            return;
        }

        const headers = [
            '大学名',
            '学部名',
            '年度',
            '科目',
            '大問',
            '大問配点',
            '問題番号',
            '問題形式',
            '配点',
            '回答',
            '小問解説',
            '大問詳細解説',
            '採点基準・指示'
        ];

        const rows = [];

        structure.forEach((section, sIdx) => {
            const sectionLabel = section.label || `第${sIdx + 1}問`;
            const sectionPoints = section.allocatedPoints ?? section.totalPoints ?? '';
            const sectionAnalysis = section.sectionAnalysis || '';
            const questions = section.questions || [];

            if (questions.length === 0) {
                rows.push([
                    university || '',
                    faculty || '',
                    year ? `${year}年度` : '',
                    subject || '',
                    sectionLabel,
                    sectionPoints,
                    '',
                    '',
                    '',
                    '',
                    '',
                    sectionAnalysis,
                    ''
                ]);
                return;
            }

            questions.forEach((q, qIdx) => {
                const qLabel = q.label || q.id || `問${qIdx + 1}`;
                let qTypeLabel = q.type || '';
                if (q.type === 'selection') qTypeLabel = '選択式';
                else if (q.type === 'selection_multi') qTypeLabel = '複数選択';
                else if (q.type === 'descriptive') qTypeLabel = '記述式';
                else if (q.type === 'essay') qTypeLabel = '論述式';

                const answer = q.correctAnswer ?? q.answer ?? '';
                const explanation = q.explanation || '';
                const gradingInstruction = q.gradingInstruction || '';
                const points = q.points ?? '';

                rows.push([
                    university || '',
                    faculty || '',
                    year ? `${year}年度` : '',
                    subject || '',
                    sectionLabel,
                    qIdx === 0 ? sectionPoints : '',
                    qLabel,
                    qTypeLabel,
                    points,
                    answer,
                    explanation,
                    qIdx === 0 ? sectionAnalysis : '',
                    gradingInstruction
                ]);
            });
        });

        if (rows.length === 0) {
            alert('エクスポート対象のデータがありません。');
            return;
        }

        const escapeCell = (val) => {
            if (val === null || val === undefined) return '""';
            const str = String(val);
            return `"${str.replace(/"/g, '""')}"`;
        };

        const csvContent = [
            headers.map(escapeCell).join(','),
            ...rows.map(row => row.map(escapeCell).join(','))
        ].join('\r\n');

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const filename = `${university || '大学'}_${faculty || '学部'}_${year ? year + '年度_' : ''}${subject || '問題データ'}_問題一覧.csv`
            .replace(/[\\/:*?"<>|]/g, '_');

        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleSaveAndPreview = async () => {
        if (!examData || !examId) {
            alert('保存するデータがありません。');
            return;
        }

        // 1. Prepare initial preview data and open window SYNCHRONOUSLY
        const previewId = `${universityId}-${facultyId}-preview`;
        const normalizedCurrentStructure = normalizeEditorStructure(examData.structure);
        
        // MATCH ExamPage expect keys for immediate local preview
        const initialFormattedExam = {
            id: examId,
            university,
            universityId: universityId,
            faculty,
            facultyId: facultyId,
            year,
            subject,
            subjectEn: subjectEn,
            type,
            pdf_path: examData.pdf_path,
            pdfPath: examData.pdf_path,
            max_score: examData.max_score,
            structure: normalizedCurrentStructure,
            passing_lines: examData.passing_lines,
            duration_minutes: durationMinutes,
            custom_layout: customLayout
        };

        localStorage.setItem('previewExamData', JSON.stringify({
            exam: initialFormattedExam,
            universityName: university,
            universityId: universityId
        }));

        // Open immediately - browser won't block this
        const previewWindow = window.open(`/exam/${previewId}`, '_blank');

        setSaving(true);
        let finalPdfPath = examData.pdf_path || '';

        // Continue with async operations (upload & save)
        if (questionFiles && questionFiles.length > 0) {
            try {
                const { publicUrl, error: uploadError } = await uploadExamPdf(questionFiles[0], examId);
                if (uploadError) throw uploadError;
                if (publicUrl) {
                    finalPdfPath = publicUrl;
                    
                    // Update the already opened preview window with the new PDF path
                    const updatedExam = { ...initialFormattedExam, pdf_path: publicUrl, pdfPath: publicUrl };
                    localStorage.setItem('previewExamData', JSON.stringify({
                        exam: updatedExam,
                        universityName: university,
                        universityId: universityId
                    }));
                    if (previewWindow) previewWindow.location.reload();
                }
            } catch (err) {
                console.error("PDF upload failed for preview:", err);
            }
        }

        const payload = {
            id: examId,
            university,
            university_id: parseInt(universityId) || 0,
            faculty,
            faculty_id: facultyId,
            year: parseInt(year),
            subject,
            subject_en: subjectEn,
            type,
            pdf_path: finalPdfPath,
            max_score: parseInt(examData.max_score),
            detailed_analysis: examData.detailed_analysis,
            structure: normalizedCurrentStructure,
            passing_lines: examData.passing_lines || { A: 80, B: 70, C: 60, D: 40 },
            custom_layout: customLayout
        };

        const { error } = await saveAdminExam(payload);
        setSaving(false);

        if (error) {
            alert('データベースへの保存には失敗しましたが、プレビューは表示しました:\n' + error.message);
        } else {
            clearGenerationDraft(examId);
            setAvailableDrafts(prev => prev.filter(d => d.examId !== examId && !d.key.includes(examId)));
            if (isNew && examId) {
                navigate(`/admin/exam/${examId}`, { replace: true });
            }
            alert('保存しました！');
        }
    };

    const handleStructureChange = (sectionIdx, qIdx, field, value) => {
        const currentExamData = examDataRef.current || examData || {};
        const newStructure = (currentExamData.structure || []).map(section => ({
            ...section,
            questions: Array.isArray(section?.questions)
                ? section.questions.map(question => ({ ...question }))
                : []
        }));
        const targetSection = newStructure[sectionIdx];
        if (!targetSection) {
            console.warn('[AdminExamEditor] Structure update skipped: section not found', { sectionIdx, qIdx, field });
            return false;
        }
        if (qIdx === null) {
            targetSection[field] = value;
        } else {
            const targetQuestion = targetSection.questions?.[qIdx];
            if (!targetQuestion) {
                console.warn('[AdminExamEditor] Structure update skipped: question not found', { sectionIdx, qIdx, field });
                return false;
            }
            if (field === 'options') {
                targetQuestion[field] = value.split(',').map(s => s.trim());
            } else {
                targetQuestion[field] = value;
                if (field === 'completeGroupOrderMode') {
                    const groupId = targetQuestion.completeGroupId;
                    if (groupId) {
                        newStructure.forEach(section => {
                            (section.questions || []).forEach(question => {
                                if (question.completeGroupId === groupId) {
                                    question.completeGroupOrderMode = value;
                                }
                            });
                        });
                    }
                }
                // Auto-detect multi-selection when comma is entered in correctAnswer
                if (
                    field === 'correctAnswer' &&
                    String(value).includes(',') &&
                    targetQuestion.type === 'selection' &&
                    targetQuestion.type !== 'ordering' &&
                    targetQuestion.answerIssue !== 'single_choice_multiple_answers'
                ) {
                    targetQuestion.type = 'selection_multi';
                }
                if (field === 'answerIssue' && value === 'single_choice_multiple_answers') {
                    targetQuestion.type = 'selection';
                }
                if (field === 'type' && value === 'essay') {
                    targetSection.questions[qIdx] = ensureEssayCharacterCountElement(targetQuestion);
                }
                if (field === 'type' && value === 'descriptive') {
                    delete targetQuestion.scoringElements;
                    delete targetQuestion.gradingCriteria;
                    targetQuestion.gradingInstruction = '';
                }
            }
        }
        const nextExamData = { ...currentExamData, structure: newStructure };
        examDataRef.current = nextExamData;
        setExamData(nextExamData);
        return true;
    };
    const handleUpdateVocab = (sIdx, vIdx, field, value) => {
        const newStructure = [...examData.structure];
        const newVocab = [...(newStructure[sIdx].vocabulary || [])];
        newVocab[vIdx] = { ...newVocab[vIdx], [field]: value };
        newStructure[sIdx].vocabulary = newVocab;
        setExamData({ ...examData, structure: newStructure });
    };

    const handleRemoveVocab = (sIdx, vIdx) => {
        const newStructure = [...examData.structure];
        const newVocab = (newStructure[sIdx].vocabulary || []).filter((_, i) => i !== vIdx);
        newStructure[sIdx].vocabulary = newVocab;
        setExamData({ ...examData, structure: newStructure });
    };

    const handleAddVocab = (sIdx) => {
        const newStructure = [...examData.structure];
        const newVocab = [...(newStructure[sIdx].vocabulary || []), { word: '', meaning: '' }];
        newStructure[sIdx].vocabulary = newVocab;
        setExamData({ ...examData, structure: newStructure });
    };

    const buildScoringAssistantContext = (sectionIdx) => {
        const section = examData?.structure?.[sectionIdx] || {};
        const questions = Array.isArray(section.questions) ? section.questions : [];
        return {
            sectionId: section.id || sectionIdx + 1,
            sectionLabel: section.label || '',
            questionType: section.questionType || '',
            instruction: section.instruction || sectionInstructionsBySection[sectionIdx + 1] || '',
            sectionAnalysis: section.sectionAnalysis || '',
            questions: questions.map(item => ({
                id: item.id,
                label: item.label,
                type: item.type,
                points: item.points,
                correctAnswer: item.correctAnswer,
                gradingInstruction: item.gradingInstruction || ''
            }))
        };
    };

    const getScoringAssistantFiles = (sectionIdx) => {
        return resolveSectionSourceFiles({
            sectionIndex: sectionIdx + 1,
            structure: examData?.structure || [],
            questionFilesBySection,
            answerFilesBySection,
            questionFiles,
            examPdfPath: examData?.pdf_path
        });
    };

    const handleSendChatMessage = async (sectionIdx, qIdx, q) => {
        const chatKey = `${sectionIdx}_${qIdx}`;
        const input = (chatInputs[chatKey] || '').trim();
        if (!input) return;

        const userMsg = { role: 'user', text: input };
        const updatedHistory = [...(aiChats[chatKey] || []), userMsg];
        
        setAiChats(prev => ({ ...prev, [chatKey]: updatedHistory }));
        setChatInputs(prev => ({ ...prev, [chatKey]: '' }));
        setChatLoading(prev => ({ ...prev, [chatKey]: true }));

        try {
            console.log("[ScoringChat] Consulting scoring elements with context...");
            const examMeta = { university, faculty, subject, year };
            const assistantFiles = getScoringAssistantFiles(sectionIdx);
            const questionData = {
                id: q.id,
                points: q.points,
                label: q.label,
                correctAnswer: q.correctAnswer,
                gradingInstruction: q.gradingInstruction,
                scoringElements: q.scoringElements || [],
                sectionContext: buildScoringAssistantContext(sectionIdx)
            };

            const response = await consultScoringElements(examMeta, questionData, input, updatedHistory, assistantFiles.questionFiles, assistantFiles.answerFiles);
            
            const aiMsg = { role: 'ai', text: response };
            setAiChats(prev => ({
                ...prev,
                [chatKey]: [...updatedHistory, aiMsg]
            }));
        } catch (error) {
            console.error("[ScoringChat] Chat consult failed:", error);
            setAiChats(prev => ({
                ...prev,
                [chatKey]: [...updatedHistory, { role: 'ai', text: `⚠️ エラーが発生しました: ${error.message}` }]
            }));
        } finally {
            setChatLoading(prev => ({ ...prev, [chatKey]: false }));
        }
    };

    const handleConvertRubricToScoringElements = async (sectionIdx, qIdx, q) => {
        const chatKey = `${sectionIdx}_${qIdx}`;
        const input = (chatInputs[chatKey] || '').trim();
        if (!input) return;

        const userMsg = { role: 'user', text: input };
        const updatedHistory = [...(aiChats[chatKey] || []), userMsg];

        setAiChats(prev => ({ ...prev, [chatKey]: updatedHistory }));
        setChatInputs(prev => ({ ...prev, [chatKey]: '' }));
        setChatLoading(prev => ({ ...prev, [chatKey]: true }));

        try {
            const examMeta = { university, faculty, subject, year };
            const assistantFiles = getScoringAssistantFiles(sectionIdx);
            const questionData = {
                id: q.id,
                points: q.points,
                label: q.label,
                correctAnswer: q.correctAnswer,
                gradingInstruction: q.gradingInstruction,
                scoringElements: q.scoringElements || [],
                sectionContext: buildScoringAssistantContext(sectionIdx)
            };

            const result = await transformRubricToScoringElements(examMeta, questionData, input, assistantFiles.questionFiles, assistantFiles.answerFiles);
            const convertedQuestion = ensureEssayCharacterCountElement({
                ...q,
                type: 'essay',
                scoringElements: normalizeScoringElements(result?.scoringElements)
            });
            const convertedElements = normalizeScoringElements(convertedQuestion.scoringElements);
            if (convertedElements.length === 0) {
                throw new Error('採点要素に変換できませんでした。');
            }

            handleStructureChange(sectionIdx, qIdx, 'scoringElements', convertedElements);
            handleStructureChange(sectionIdx, qIdx, 'gradingInstruction', result?.gradingInstruction || '');

            const total = convertedElements
                .filter(item => item.type !== 'force_zero')
                .reduce((sum, item) => sum + (item.type === 'deduction' ? -Math.abs(Number(item.points) || 0) : Number(item.points) || 0), 0);
            const pointLimit = Number(q.points) || 0;
            const pointSummary = pointLimit > 0 && total > pointLimit
                ? `要素合計: ${total}点 → 最終上限: ${pointLimit}点`
                : `要素合計: ${total}点 / 設問配点: ${pointLimit}点`;

            const aiMsg = {
                role: 'ai',
                text: `採点基準をスマサイ独自表現に変換し、採点要素 ${convertedElements.length}件として反映しました。\n${pointSummary}\n必要に応じて左側で微調整し、最後に試験データを保存してください。`
            };
            setAiChats(prev => ({
                ...prev,
                [chatKey]: [...updatedHistory, aiMsg]
            }));
        } catch (error) {
            console.error("[ScoringChat] Rubric transform failed:", error);
            setAiChats(prev => ({
                ...prev,
                [chatKey]: [...updatedHistory, { role: 'ai', text: `⚠️ 変換に失敗しました: ${error.message}` }]
            }));
        } finally {
            setChatLoading(prev => ({ ...prev, [chatKey]: false }));
        }
    };

    const handleResetChat = (sectionIdx, qIdx) => {
        const chatKey = `${sectionIdx}_${qIdx}`;
        if (confirm("会話履歴をリセットしますか？")) {
            setAiChats(prev => ({ ...prev, [chatKey]: [] }));
            setChatInputs(prev => ({ ...prev, [chatKey]: '' }));
        }
    };

    const handleGenerateEssayModelAnswer = async (sectionIdx, qIdx, q, mode = 'with_original') => {
        const currentQuestion = examDataRef.current?.structure?.[sectionIdx]?.questions?.[qIdx] || q;
        if (!currentQuestion) {
            alert('対象の小問が見つかりません。画面を再読み込みしてから再度お試しください。');
            return;
        }

        const scoringElements = Array.isArray(currentQuestion.scoringElements) ? currentQuestion.scoringElements : [];
        const gradingInstruction = String(currentQuestion.gradingInstruction || '').trim();
        if (scoringElements.length === 0 && !gradingInstruction) {
            alert('採点基準（scoringElements または 採点指示）がまだ設定されていません。\n先に採点要素エディタを開いて、採点基準を作成してください。');
            return;
        }

        if (mode === 'with_original' && !String(currentQuestion.correctAnswer || '').trim()) {
            alert('元々の模範解答が入力されていません。\n「🌱 模範解答B（基準＋本文のみ）」をご利用ください。');
            return;
        }

        const loadingKey = `${sectionIdx}_${qIdx}`;
        setEssayModelAnswerLoading(prev => ({ ...prev, [loadingKey]: mode }));

        try {
            const {
                questionFiles: finalQFiles,
                answerFiles: finalAFiles
            } = resolveSectionSourceFiles({
                sectionIndex: sectionIdx + 1,
                structure: examData?.structure || [],
                questionFilesBySection,
                answerFilesBySection,
                questionFiles,
                examPdfPath: examData?.pdf_path
            });

            const section = examData?.structure?.[sectionIdx] || {};
            const examMeta = {
                university: examData?.university || university,
                faculty: examData?.faculty || faculty,
                subject: examData?.subject || subject,
                year: examData?.year || year
            };

            const sectionContext = {
                sectionId: section.id,
                sectionLabel: section.label,
                instruction: section.instruction,
                sectionAnalysis: section.sectionAnalysis,
                questionType: section.questionType,
                questions: (section.questions || []).map(item => ({
                    id: item.id,
                    label: item.label,
                    points: item.points
                }))
            };

            const result = await geminiQueue.add(() => generateEssayModelAnswer({
                mode,
                examMeta,
                questionData: {
                    id: currentQuestion.id,
                    label: currentQuestion.label,
                    points: currentQuestion.points,
                    correctAnswer: currentQuestion.correctAnswer,
                    scoringElements: currentQuestion.scoringElements,
                    gradingInstruction: currentQuestion.gradingInstruction
                },
                sectionContext,
                questionFiles: finalQFiles,
                answerFiles: finalAFiles
            }));

            setEssayModelAnswerPreview({
                sectionIdx,
                qIdx,
                questionId: currentQuestion.id,
                currentAnswer: currentQuestion.correctAnswer || '',
                generatedAnswer: result.modelAnswer,
                draftAnswer: result.modelAnswer,
                charCount: result.charCount,
                reasoning: result.reasoning,
                satisfiedElements: result.satisfiedElements || [],
                mode
            });
        } catch (error) {
            console.error('[EssayModelAnswer] Generation failed:', error);
            alert('模範解答の生成に失敗しました:\n' + error.message);
        } finally {
            setEssayModelAnswerLoading(prev => {
                const next = { ...prev };
                delete next[loadingKey];
                return next;
            });
        }
    };

    const renderEssayModelAnswerPreviewModal = () => {
        if (!essayModelAnswerPreview) return null;

        const {
            sectionIdx,
            qIdx,
            questionId,
            currentAnswer,
            draftAnswer,
            reasoning,
            satisfiedElements,
            mode
        } = essayModelAnswerPreview;

        const isModeA = mode === 'with_original';
        const currentChars = Array.from(currentAnswer || '').length;
        const draftChars = Array.from(draftAnswer || '').length;

        return createPortal(
            <div style={scoringModalStyles.overlay}>
                <div style={{ ...scoringModalStyles.shell, width: 'min(760px, 94vw)', maxHeight: '90vh', height: 'auto' }}>
                    {/* Header */}
                    <div className="px-6 py-4 bg-navy-blue text-white flex justify-between items-center rounded-t-2xl">
                        <div className="flex items-center gap-3">
                            <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full text-white ${isModeA ? 'bg-indigo-600' : 'bg-emerald-600'}`}>
                                {isModeA ? '🤖 模範解答A (基準+元解答+本文)' : '🌱 模範解答B (基準+本文のみ)'}
                            </span>
                            <h3 className="font-black text-sm">
                                問{questionId} AI模範解答の確認・適用
                            </h3>
                        </div>
                        <button
                            type="button"
                            onClick={() => setEssayModelAnswerPreview(null)}
                            className="text-gray-300 hover:text-white font-bold text-xl px-2"
                        >
                            ×
                        </button>
                    </div>

                    {/* Body */}
                    <div className="p-6 overflow-y-auto space-y-5" style={{ maxHeight: 'calc(90vh - 140px)' }}>
                        {/* Reasoning / Policy */}
                        {reasoning && (
                            <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl text-xs text-navy-blue leading-relaxed">
                                <div className="text-[10px] font-black text-indigo-700 uppercase tracking-wider mb-1">
                                    💡 採点基準の充足と表現の工夫
                                </div>
                                <div>{reasoning}</div>
                            </div>
                        )}

                        {/* Comparison */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Current / Original */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                                        現在の模範解答（元解答）
                                    </span>
                                    <span className="text-[10px] font-mono font-bold text-gray-400">
                                        {currentChars}字
                                    </span>
                                </div>
                                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600 leading-relaxed min-h-[140px] whitespace-pre-wrap">
                                    {currentAnswer || '（未入力）'}
                                </div>
                            </div>

                            {/* Generated / Draft */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                                        <span>✨</span> 新たに生成されたオリジナル模範解答
                                    </span>
                                    <span className="text-[10px] font-mono font-bold text-emerald-700">
                                        {draftChars}字
                                    </span>
                                </div>
                                <textarea
                                    value={draftAnswer}
                                    onChange={(e) => setEssayModelAnswerPreview(prev => ({
                                        ...prev,
                                        draftAnswer: e.target.value
                                    }))}
                                    rows={6}
                                    className="w-full p-3 border-2 border-emerald-300 focus:border-emerald-500 rounded-xl text-xs text-navy-blue font-bold leading-relaxed outline-none min-h-[140px]"
                                    placeholder="生成された模範解答（直接編集も可能です）"
                                />
                                <div className="text-[10px] text-gray-400">
                                    ※必要に応じて上記の枠内で直接文章を微調整できます。
                                </div>
                            </div>
                        </div>

                        {/* Satisfied Elements */}
                        {Array.isArray(satisfiedElements) && satisfiedElements.length > 0 && (
                            <div className="space-y-2">
                                <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                                    採点要素への適合状況
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {satisfiedElements.map((el, idx) => (
                                        <div key={idx} className="p-2.5 bg-emerald-50/60 border border-emerald-100 rounded-lg text-[11px] flex items-start gap-2">
                                            <span className="font-mono font-black text-emerald-700 bg-white px-1.5 py-0.5 rounded border border-emerald-200 text-[10px]">
                                                {el.id}
                                            </span>
                                            <span className="text-gray-700 font-medium leading-tight">
                                                {el.summary}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3 rounded-b-2xl">
                        <button
                            type="button"
                            onClick={() => setEssayModelAnswerPreview(null)}
                            className="text-xs font-bold text-gray-500 hover:text-gray-700 px-4 py-2.5 rounded-xl transition-colors"
                        >
                            キャンセル
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                handleStructureChange(sectionIdx, qIdx, 'correctAnswer', draftAnswer);
                                setEssayModelAnswerPreview(null);
                            }}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black px-6 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-1.5"
                        >
                            <span>✓</span> この模範解答を適用する
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        );
    };

    const normalizeScoringElements = (value) => {
        return Array.isArray(value)
            ? value.map(normalizeScoringElement)
            : [];
    };

    const renderScoringModal = () => {
        if (!activeScoringEditor) {
            return null;
        }

        console.log("[ScoringModal] rendering. activeScoringEditor state:", activeScoringEditor);
        const { sectionIdx, qIdx } = activeScoringEditor;
        const q = examData?.structure?.[sectionIdx]?.questions?.[qIdx] || activeScoringEditor.question;
        
        console.log("[ScoringModal] q data resolved:", q);
        if (!q) {
            console.warn("[ScoringModal] question 'q' not found in examData.structure or activeScoringEditor snapshot!");
            return createPortal(
                <div style={scoringModalStyles.overlay}>
                    <div style={{ ...scoringModalStyles.shell, width: 'min(520px, 94vw)', height: 'auto', padding: '32px' }}>
                        <h3 className="font-black text-navy-blue mb-3">採点要素エディタを開けませんでした</h3>
                        <p className="text-sm text-gray-500 leading-relaxed mb-6">
                            対象の小問データを取得できませんでした。画面を再読み込みしてからもう一度試してください。
                        </p>
                        <button
                            type="button"
                            onClick={() => setActiveScoringEditor(null)}
                            className="bg-navy-blue text-white text-xs font-black px-5 py-3 rounded-xl"
                        >
                            閉じる
                        </button>
                    </div>
                </div>,
                document.body
            );
        }

        const chatKey = `${sectionIdx}_${qIdx}`;
        const elements = q.type === 'essay'
            ? normalizeScoringElements(ensureEssayCharacterCountElement(q).scoringElements)
            : normalizeScoringElements(q.scoringElements);
        const totalPoints = elements
            .filter(item => item.type !== 'force_zero')
            .reduce((sum, item) => {
                const points = Number(item.points) || 0;
                return sum + (item.type === 'deduction' ? -Math.abs(points) : points);
            }, 0);
        const forceZeroCount = elements.filter(item => item.type === 'force_zero' || (item.type === 'character_count' && item.forceZeroOnFail !== false)).length;
        const questionPointLimit = Number(q.points) || 0;
        const isExactMatch = totalPoints === questionPointLimit;
        const isCapScoring = questionPointLimit > 0 && totalPoints > questionPointLimit;
        const pointsCheckClass = isExactMatch
            ? 'bg-green-50 text-green-700 border border-green-100'
            : isCapScoring
                ? 'bg-blue-50 text-blue-700 border border-blue-100'
                : 'bg-red-50 text-red-600 border border-red-100';

        return createPortal(
            <div style={scoringModalStyles.overlay}>
                <div style={scoringModalStyles.shell}>
                    {/* Modal Header */}
                    <div className="px-6 py-4 bg-navy-blue text-white flex justify-between items-center" style={scoringModalStyles.header}>
                        <div className="flex items-center gap-3">
                            <span className="bg-indigo-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">Essay Scoring</span>
                            <h3 className="font-black text-sm">
                                大問 {sectionIdx + 1} 小問 {q.id} : 採点要素設定 & AIアシスタント
                            </h3>
                        </div>
                        <button 
                            type="button"
                            onClick={() => {
                                console.log("[ScoringModal] Close button clicked");
                                setActiveScoringEditor(null);
                            }}
                            className="text-gray-300 hover:text-white font-bold text-xl transition-colors px-2"
                        >
                            ×
                        </button>
                    </div>

                    {/* Modal Body */}
                    <div className="flex-1 flex overflow-hidden" style={scoringModalStyles.body}>
                        {/* Left Side: Scoring Elements config */}
                        <div className="w-1/2 overflow-y-auto p-6 border-r border-gray-100 flex flex-col gap-5" style={{ ...scoringModalStyles.pane, borderRight: '1px solid #eef2f7' }}>
                            <div>
                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">設問本文 (配点: {q.points || 0}点)</h4>
                                <div className="p-3 bg-gray-50 rounded-xl text-xs font-bold text-navy-blue whitespace-pre-wrap leading-relaxed max-h-[100px] overflow-y-auto">
                                    {q.label || "問題文未入力"}
                                </div>
                            </div>

                            <div>
                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider">模範解答・解答例</h4>
                                    <div className="flex flex-wrap gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => handleGenerateEssayModelAnswer(sectionIdx, qIdx, q, 'with_original')}
                                            disabled={essayModelAnswerLoading[`${sectionIdx}_${qIdx}`]}
                                            className="text-[9px] font-black px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-all flex items-center gap-1 shadow-sm disabled:opacity-50 cursor-pointer"
                                            title="独自採点基準＋元解答＋本文・問題文から、著作権に配慮した新模範解答を生成"
                                        >
                                            {essayModelAnswerLoading[`${sectionIdx}_${qIdx}`] === 'with_original' ? '🔄 生成中...' : '🤖 模範解答A (基準+元解答+本文)'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleGenerateEssayModelAnswer(sectionIdx, qIdx, q, 'rubric_only')}
                                            disabled={essayModelAnswerLoading[`${sectionIdx}_${qIdx}`]}
                                            className="text-[9px] font-black px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-all flex items-center gap-1 shadow-sm disabled:opacity-50 cursor-pointer"
                                            title="元解答を見ず、独自採点基準＋本文・問題文のみからゼロベースで新模範解答を生成"
                                        >
                                            {essayModelAnswerLoading[`${sectionIdx}_${qIdx}`] === 'rubric_only' ? '🔄 生成中...' : '🌱 模範解答B (基準+本文のみ)'}
                                        </button>
                                    </div>
                                </div>
                                <div className="p-3 bg-gray-50 rounded-xl text-xs text-gray-600 whitespace-pre-wrap leading-relaxed max-h-[100px] overflow-y-auto font-medium">
                                    {q.correctAnswer || "解答例未入力"}
                                </div>
                            </div>

                            {/* Scoring Elements Manager */}
                            <div className="flex-1 flex flex-col min-h-[300px]">
                                <div className="flex justify-between items-center mb-3">
                                    <span className="text-[10px] font-black text-orange-700 uppercase tracking-wider">
                                        採点判定要素 ({elements.length})
                                    </span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const newElements = [...elements];
                                            newElements.push({
                                                id: `e${newElements.length + 1}`,
                                                description: "",
                                                points: 1,
                                                allowPartial: false,
                                                type: "content",
                                                minChars: '',
                                                maxChars: '',
                                                forceZeroOnFail: false
                                            });
                                            handleStructureChange(sectionIdx, qIdx, 'scoringElements', newElements);
                                        }}
                                        className="text-[10px] font-black text-orange-600 hover:text-orange-800 bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-100 transition-colors"
                                    >
                                        ＋ 新しい判定要素を追加
                                    </button>
                                </div>

                                <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                                    {elements.length === 0 ? (
                                        <div className="text-center py-12 bg-orange-50/20 border border-dashed border-orange-100 rounded-2xl text-gray-400 text-xs flex flex-col items-center gap-2">
                                            <span className="text-2xl">📝</span>
                                            <span className="font-bold">採点要素がまだ登録されていません</span>
                                            <span className="text-[10px] text-gray-400 max-w-[250px]">
                                                AI採点はここで設定された個別の要素基準のみを用いて客観的に評価を行います。
                                            </span>
                                        </div>
                                    ) : (
                                        elements.map((el, elIdx) => (
                                            <div key={elIdx} className="bg-white p-4 rounded-xl border border-orange-100 shadow-sm text-xs space-y-3">
                                                <div className="flex items-center gap-3">
                                                    <span className="font-mono bg-orange-100 text-orange-700 font-bold px-2 py-0.5 rounded text-[10px]">{el.id}</span>
                                                    <input
                                                        type="text"
                                                        value={el.description}
                                                        onChange={(e) => {
                                                            const newElements = [...elements];
                                                            newElements[elIdx].description = e.target.value;
                                                            handleStructureChange(sectionIdx, qIdx, 'scoringElements', newElements);
                                                        }}
                                                        placeholder="基準（例: 「AIが進化する理由」について具体的に言及している）"
                                                        className="flex-1 p-2 border border-gray-200 rounded-lg outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const newElements = elements.filter((_, i) => i !== elIdx)
                                                                .map((item, idx) => ({ ...item, id: `e${idx + 1}` }));
                                                            handleStructureChange(sectionIdx, qIdx, 'scoringElements', newElements);
                                                        }}
                                                        className="text-red-400 hover:text-red-600 font-bold px-2 text-sm"
                                                        title="要素を削除"
                                                    >
                                                        ×
                                                    </button>
                                                </div>

                                                <div className="flex flex-wrap items-center gap-4 text-[10px] text-gray-500 font-bold bg-gray-50 p-2 rounded-lg">
                                                    <div className="flex items-center gap-1.5">
                                                        <span>種別:</span>
                                                        <select
                                                            value={el.type || 'content'}
                                                            onChange={(e) => {
                                                                const newElements = [...elements];
                                                                const nextType = e.target.value;
                                                                const currentPoints = Number(newElements[elIdx].points) || 0;
                                                                newElements[elIdx] = {
                                                                    ...newElements[elIdx],
                                                                    type: nextType,
                                                                    points: nextType === 'force_zero'
                                                                        ? 0
                                                                        : nextType === 'character_count'
                                                                            ? Math.max(0, currentPoints || 0)
                                                                        : nextType === 'deduction'
                                                                            ? -Math.abs(currentPoints || 1)
                                                                            : currentPoints,
                                                                    allowPartial: nextType === 'character_count' ? false : newElements[elIdx].allowPartial,
                                                                    forceZeroOnFail: nextType === 'character_count' ? true : newElements[elIdx].forceZeroOnFail,
                                                                    description: nextType === 'character_count' && !newElements[elIdx].description
                                                                        ? '答案の文字数が指定範囲内である'
                                                                        : newElements[elIdx].description
                                                                };
                                                                handleStructureChange(sectionIdx, qIdx, 'scoringElements', newElements);
                                                            }}
                                                            className="p-1 border border-gray-300 rounded text-navy-blue bg-white"
                                                        >
                                                            <option value="content">内容加点</option>
                                                            <option value="logic">論理加点</option>
                                                            <option value="character_count">文字数条件</option>
                                                            <option value="deduction">減点</option>
                                                            <option value="force_zero">強制0点</option>
                                                        </select>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <span>配点:</span>
                                                        <input
                                                            type="number"
                                                            step="0.5"
                                                            value={el.points}
                                                            disabled={el.type === 'force_zero'}
                                                            onChange={(e) => {
                                                                const newElements = [...elements];
                                                                const nextPoints = Number(e.target.value) || 0;
                                                                newElements[elIdx].points = el.type === 'deduction'
                                                                    ? -Math.abs(nextPoints)
                                                                    : Math.max(0, nextPoints);
                                                                handleStructureChange(sectionIdx, qIdx, 'scoringElements', newElements);
                                                            }}
                                                            className="w-12 p-1 border border-gray-300 rounded text-center text-navy-blue"
                                                        />
                                                        <span>点</span>
                                                    </div>
                                                    {el.type === 'character_count' && (
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span>文字数:</span>
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                value={el.minChars ?? ''}
                                                                onChange={(e) => {
                                                                    const newElements = [...elements];
                                                                    newElements[elIdx].minChars = e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0);
                                                                    handleStructureChange(sectionIdx, qIdx, 'scoringElements', newElements);
                                                                }}
                                                                placeholder="下限"
                                                                className="w-16 p-1 border border-gray-300 rounded text-center text-navy-blue"
                                                            />
                                                            <span>〜</span>
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                value={el.maxChars ?? ''}
                                                                onChange={(e) => {
                                                                    const newElements = [...elements];
                                                                    newElements[elIdx].maxChars = e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0);
                                                                    handleStructureChange(sectionIdx, qIdx, 'scoringElements', newElements);
                                                                }}
                                                                placeholder="上限"
                                                                className="w-16 p-1 border border-gray-300 rounded text-center text-navy-blue"
                                                            />
                                                            <span>字</span>
                                                        </div>
                                                    )}
                                                    {el.type !== 'force_zero' && el.type !== 'character_count' && (
                                                        <label className="flex items-center gap-1.5">
                                                            <input
                                                                type="checkbox"
                                                                checked={Boolean(el.allowPartial)}
                                                                onChange={(e) => {
                                                                    const newElements = [...elements];
                                                                    newElements[elIdx].allowPartial = e.target.checked;
                                                                    handleStructureChange(sectionIdx, qIdx, 'scoringElements', newElements);
                                                                }}
                                                            />
                                                            部分点/半減点を許可
                                                        </label>
                                                    )}
                                                    {el.type === 'character_count' && (
                                                        <label className="flex items-center gap-1.5">
                                                            <input
                                                                type="checkbox"
                                                                checked={el.forceZeroOnFail !== false}
                                                                onChange={(e) => {
                                                                    const newElements = [...elements];
                                                                    newElements[elIdx].forceZeroOnFail = e.target.checked;
                                                                    handleStructureChange(sectionIdx, qIdx, 'scoringElements', newElements);
                                                                }}
                                                            />
                                                            条件外なら強制0点
                                                        </label>
                                                    )}

                                                </div>
                                                {el.type === 'force_zero' && (
                                                    <p className="text-[10px] font-bold text-red-500 leading-relaxed">
                                                        この条件を満たすと、他の採点要素や文法減点に関係なく最終得点を0点にします。
                                                    </p>
                                                )}
                                                {el.type === 'character_count' && (
                                                    <p className="text-[10px] font-bold text-blue-600 leading-relaxed">
                                                        答案の空白・改行を除いた文字数をシステム側で数えます。条件内なら配点を加点し、条件外は基本的に強制0点にします。
                                                    </p>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Points check info */}
                            {elements.length > 0 && (
                                <div className={`text-xs font-black p-3 rounded-xl ${pointsCheckClass}`}>
                                    {isExactMatch ? (
                                        <span>強制0点専用条件を除く要素の合計配点（{totalPoints}点）が設問の配点（{questionPointLimit}点）と完全に一致しています。{forceZeroCount > 0 ? ` 強制0点条件: ${forceZeroCount}件。` : ''}</span>
                                    ) : isCapScoring ? (
                                        <span>上限採点：強制0点専用条件を除く要素の合計（{totalPoints}点）を採点し、最終得点は設問の配点（{questionPointLimit}点）で頭打ちにします。{forceZeroCount > 0 ? ` 強制0点条件: ${forceZeroCount}件。` : ''}</span>
                                    ) : (
                                        <span>不足：強制0点専用条件を除く要素の合計（{totalPoints}点）が設問の配点（{questionPointLimit}点）を下回っています。</span>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Right Side: AI Assistant Chat */}
                        <div className="w-1/2 bg-indigo-50/15 flex flex-col p-6" style={{ ...scoringModalStyles.pane, background: '#f8faff', display: 'flex', flexDirection: 'column' }}>
                            <div className="flex justify-between items-center mb-3">
                                <span className="text-[10px] font-black text-indigo-700 uppercase tracking-widest flex items-center gap-1.5">
                                    ✨ AI採点基準アシスタント
                                </span>
                                <button
                                    onClick={() => handleResetChat(sectionIdx, qIdx)}
                                    className="text-[9px] font-black text-gray-400 hover:text-indigo-600 bg-white px-2 py-1 rounded border border-gray-100 transition-colors shadow-sm"
                                >
                                    会話をリセット
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto bg-white border border-indigo-100/50 rounded-2xl p-4 text-xs space-y-3 mb-4 max-h-[500px]">
                                {(!aiChats[chatKey] || aiChats[chatKey].length === 0) ? (
                                    <div className="text-gray-400 text-center py-16 space-y-3 h-full flex flex-col justify-center items-center">
                                        <div className="text-3xl animate-bounce">💡</div>
                                        <p className="font-bold text-xs text-gray-600">
                                            AIと対話しながら採点基準を作成
                                        </p>
                                        <p className="text-[10px] text-gray-400 max-w-[280px] leading-normal text-center">
                                            AIは設問の内容や模範解答、現在の要素設定を熟知しています。「採点要素を提案して」「解説から要素に落とし込んで」など、お気軽にご相談ください。
                                        </p>
                                    </div>
                                ) : (
                                    aiChats[chatKey].map((msg, mIdx) => (
                                        <div key={mIdx} className={`p-3 rounded-2xl ${msg.role === 'user' ? 'bg-indigo-50 text-indigo-900 border border-indigo-100/50 ml-6' : 'bg-gray-50 text-gray-800 border border-gray-100 mr-6'}`}>
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="font-black text-[9px] uppercase tracking-widest text-indigo-600">
                                                    {msg.role === 'user' ? 'あなた' : 'AI'}
                                                </span>
                                            </div>
                                            <div className="whitespace-pre-wrap font-medium leading-relaxed">{msg.text}</div>
                                        </div>
                                    ))
                                )}
                                {chatLoading[chatKey] && (
                                    <div className="flex items-center justify-center gap-2 py-4 text-indigo-500/80 text-[10px] font-black italic">
                                        <span className="animate-bounce">●</span>
                                        <span className="animate-bounce [animation-delay:0.2s]">●</span>
                                        <span className="animate-bounce [animation-delay:0.4s]">●</span>
                                        <span>検討中...</span>
                                    </div>
                                )}
                            </div>

                            {/* Chat Input */}
                            <div className="space-y-2">
                                <textarea
                                    value={chatInputs[chatKey] || ''}
                                    onChange={(e) => setChatInputs({ ...chatInputs, [chatKey]: e.target.value })}
                                    onKeyDown={(e) => {
                                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                            e.preventDefault();
                                            handleSendChatMessage(sectionIdx, qIdx, q);
                                        }
                                    }}
                                    placeholder="採点基準を貼り付けるか、AIへの相談を書いてください。貼り付け基準は下のボタンでスマサイ独自表現の採点要素に変換できます。"
                                    className="w-full min-h-[92px] p-3 border border-indigo-100 rounded-xl outline-none text-xs focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-white resize-y leading-relaxed"
                                    disabled={chatLoading[chatKey]}
                                />
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleConvertRubricToScoringElements(sectionIdx, qIdx, q)}
                                        disabled={chatLoading[chatKey] || !(chatInputs[chatKey] || '').trim()}
                                        className="bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-black uppercase tracking-widest px-4 py-3 rounded-xl disabled:opacity-40 transition-all shadow-sm"
                                    >
                                        独自化して採点要素に保存
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleSendChatMessage(sectionIdx, qIdx, q)}
                                        disabled={chatLoading[chatKey] || !(chatInputs[chatKey] || '').trim()}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-widest px-5 py-3 rounded-xl disabled:opacity-40 transition-all shadow-sm"
                                    >
                                        相談として送信
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Modal Footer */}
                    <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3" style={scoringModalStyles.footer}>
                        <button
                            type="button"
                            onClick={() => {
                                console.log("[ScoringModal] setting activeScoringEditor to null");
                                setActiveScoringEditor(null);
                            }}
                            className="bg-navy-blue text-white hover:bg-navy-blue/90 text-xs font-black px-6 py-2.5 rounded-xl shadow-md transition-all"
                        >
                            設定を適用して閉じる
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        );
    };

    const handleAddGenerationSection = () => {
        const newCount = sectionCount + 1;
        setSectionCount(newCount);
        setAnswerFilesBySection(prev => ({ ...prev, [newCount]: [] }));
        setQuestionFilesBySection(prev => ({ ...prev, [newCount]: [] }));
        setSectionInstructionsBySection(prev => ({ ...prev, [newCount]: '' }));
        setSectionPointsBySection(prev => ({ ...prev, [newCount]: '' }));
        setSectionExpectedQuestionCounts(prev => ({ ...prev, [newCount]: '' }));
    };

    const handleDeleteGenerationSection = (num) => {
        if (sectionCount <= 1) return;
        if (!confirm(`第${num}問のアップロード設定を削除しますか？`)) return;

        setSectionCount(prev => prev - 1);

        // Offset the files for higher sections
        const newAnswerFiles = {};
        const newQuestionFiles = {};
        const newInstructions = {};
        const newPoints = {};
        const newExpectedCounts = {};

        let targetIdx = 1;
        for (let i = 1; i <= sectionCount; i++) {
            if (i === num) continue;
            newAnswerFiles[targetIdx] = answerFilesBySection[i] || [];
            newQuestionFiles[targetIdx] = questionFilesBySection[i] || [];
            newInstructions[targetIdx] = sectionInstructionsBySection[i] || '';
            newPoints[targetIdx] = sectionPointsBySection[i] || '';
            newExpectedCounts[targetIdx] = sectionExpectedQuestionCounts[i] || '';
            targetIdx++;
        }

        setAnswerFilesBySection(newAnswerFiles);
        setQuestionFilesBySection(newQuestionFiles);
        setSectionInstructionsBySection(newInstructions);
        setSectionPointsBySection(newPoints);
        setSectionExpectedQuestionCounts(newExpectedCounts);

        // Crucial: also update the actual structure data to keep it in sync
        setExamData(prev => {
            const newStructure = (prev?.structure || []).filter((_, idx) => (idx + 1) !== num);
            // Re-index the remaining items' IDs and Labels to match the new order if necessary
            const reindexed = newStructure.map((sec, idx) => ({
                ...sec,
                id: String(idx + 1),
                label: `第${idx + 1}問`
            }));
            return { ...prev, structure: reindexed };
        });
    };

    const flatAnswerFiles = Object.values(answerFilesBySection).flat();

    const applyGeneratedExplanationResult = (sIdx, qIdx, result) => {
        const explanation = typeof result === 'string' ? result : result?.explanation;
        if (!explanation || typeof explanation !== 'string') {
            throw new Error('AIから有効な解説が返りませんでした。');
        }

        handleStructureChange(sIdx, qIdx, 'explanation', explanation);

        if (result && typeof result === 'object') {
            if ('evidenceQuote' in result) {
                handleStructureChange(sIdx, qIdx, 'evidenceQuote', result.evidenceQuote || '');
            }
            if ('evidenceConfidence' in result) {
                handleStructureChange(sIdx, qIdx, 'evidenceConfidence', result.evidenceConfidence || '');
            }
            if ('needsReview' in result) {
                handleStructureChange(sIdx, qIdx, 'needsReview', Boolean(result.needsReview));
            }
            if ('explanationIssue' in result) {
                handleStructureChange(sIdx, qIdx, 'explanationIssue', result.explanationIssue || '');
            }
            if (result.questionText) {
                handleStructureChange(sIdx, qIdx, 'questionText', result.questionText);
            }
            if (result.choiceTexts) {
                handleStructureChange(sIdx, qIdx, 'choiceTexts', result.choiceTexts);
            }
            if (result.sourceExcerpt) {
                handleStructureChange(sIdx, qIdx, 'sourceExcerpt', result.sourceExcerpt);
                handleStructureChange(sIdx, qIdx, 'evidenceHint', result.sourceExcerpt);
            }
        }
    };

    const handleRegenerateExplanation = async (sIdx, qIdx, q) => {
        const currentQuestion = examDataRef.current?.structure?.[sIdx]?.questions?.[qIdx] || q;
        if (!currentQuestion) {
            alert('対象の小問が見つかりません。画面を再読み込みしてから再度お試しください。');
            return;
        }
        if (!confirm(`問${currentQuestion.id}の解説を再生成しますか？\n（内容が上書きされます）`)) return;

        const oldExplanation = currentQuestion.explanation;
        if (!handleStructureChange(sIdx, qIdx, 'explanation', '🔄 AI生成中...')) {
            alert('対象の小問が見つかりません。画面を再読み込みしてから再度お試しください。');
            return;
        }
        try {
            const {
                questionFiles: finalQFiles,
                answerFiles: finalAFiles
            } = resolveSectionSourceFiles({
                sectionIndex: sIdx + 1,
                structure: examData?.structure || [],
                questionFilesBySection,
                answerFilesBySection,
                questionFiles,
                examPdfPath: examData?.pdf_path
            });

            const explanationResult = await geminiQueue.add(() => regenerateQuestionExplanation(
                currentQuestion,
                finalQFiles,
                finalAFiles,
                subjectEn
            ));
            applyGeneratedExplanationResult(sIdx, qIdx, explanationResult);
        } catch (error) {
            alert('解説の再生成に失敗しました:\n' + error.message);
            handleStructureChange(sIdx, qIdx, 'explanation', oldExplanation || '');
        }
    };

    const handleBulkGenerateExplanations = async () => {
        if (!examData || !examData.structure) return;
        if (!confirm('空欄の小問解説だけをAIで一括生成します。これには時間がかかる場合があります。\n※すでに解説が入力されている設問は上書きせずスキップされます。\nよろしいですか？')) return;

        // Build a flat list of tasks
        const tasks = [];
        examData.structure.forEach((section, sIdx) => {
            section.questions.forEach((q, qIdx) => {
                // Skip if it already has explanation
                if (!q.explanation || q.explanation.trim() === '' || q.explanation.includes('AI生成中')) {
                    tasks.push({ sIdx, qIdx, q });
                }
            });
        });

        if (tasks.length === 0) {
            alert('自動生成が必要な（解説が空欄の）設問はありません。');
            return;
        }

        setBulkGenerating(true);
        setBulkProgress({ current: 0, total: tasks.length });

        try {
            for (let i = 0; i < tasks.length; i++) {
                const { sIdx, qIdx, q } = tasks[i];
                setBulkProgress({ current: i + 1, total: tasks.length });
                
                // Show loading indicator
                handleStructureChange(sIdx, qIdx, 'explanation', '🔄 AI生成中...');
                
                try {
                    const {
                        questionFiles: finalQFiles,
                        answerFiles: finalAFiles
                    } = resolveSectionSourceFiles({
                        sectionIndex: sIdx + 1,
                        structure: examData?.structure || [],
                        questionFilesBySection,
                        answerFilesBySection,
                        questionFiles,
                        examPdfPath: examData?.pdf_path
                    });

                    const explanationResult = await geminiQueue.add(() => regenerateQuestionExplanation(
                        q,
                        finalQFiles,
                        finalAFiles,
                        subjectEn
                    ));
                    applyGeneratedExplanationResult(sIdx, qIdx, explanationResult);
                } catch (err) {
                    console.error("Error generating explanation for question", q.id, err);
                    handleStructureChange(sIdx, qIdx, 'explanation', '⚠️ AI生成エラー');
                }

                // Wait 2 seconds to prevent rate limit (unless it's the last one)
                if (i < tasks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            alert('空欄の小問解説の一括生成が完了しました！');
        } catch (error) {
            alert('一括生成中にエラーが発生しました:\n' + error.message);
        } finally {
            setBulkGenerating(false);
            setBulkProgress({ current: 0, total: 0 });
        }
    };

    const handleBulkGenerateSectionAnalyses = async () => {
        if (!examData || !examData.structure) return;

        const tasks = [];
        examData.structure.forEach((section, sIdx) => {
            if (section && Array.isArray(section.questions) && section.questions.length > 0) {
                tasks.push({ sIdx, section });
            }
        });

        if (tasks.length === 0) {
            alert('詳細解説を生成できる大問がありません。先に大問構成を作成してください。');
            return;
        }

        if (!confirm('各大問の「詳細解説」をAIで一括生成します。これには時間がかかる場合があります。\n※すでに入力されている詳細解説もすべて上書きされます。\nよろしいですか？')) return;

        setBulkGeneratingSectionAnalyses(true);
        setBulkSectionAnalysisProgress({ current: 0, total: tasks.length });

        try {
            const failures = [];
            for (let i = 0; i < tasks.length; i++) {
                const { sIdx, section } = tasks[i];
                setBulkSectionAnalysisProgress({ current: i + 1, total: tasks.length });
                setSectionGenerationPhases(prev => ({ ...prev, [sIdx + 1]: 'analysis' }));
                
                const previousAnalysis = section.sectionAnalysis || '';
                handleStructureChange(sIdx, null, 'sectionAnalysis', '🔄 AI生成中...');
                
                try {
                    const {
                        questionFiles: finalQFiles,
                        answerFiles: finalAFiles
                    } = resolveSectionSourceFiles({
                        sectionIndex: sIdx + 1,
                        structure: examData?.structure || [],
                        questionFilesBySection,
                        answerFilesBySection,
                        questionFiles,
                        examPdfPath: examData?.pdf_path
                    });

                    ensureSectionAnalysisSources(section, finalQFiles, finalAFiles);
                    const newAnalysis = await geminiQueue.add(() => generateSectionDetailedAnalysis(
                        subjectEn,
                        section,
                        finalQFiles,
                        finalAFiles,
                        buildSectionAnalysisInstruction(getSectionInstruction(sectionInstructionsBySection, sIdx + 1, section), section),
                        examData?.subject || ''
                    ));
                    handleStructureChange(sIdx, null, 'sectionAnalysis', validateGeneratedText(newAnalysis, `第${section.id}問の詳細解説`));
                } catch (err) {
                    console.error("Error generating analysis for section", section.id, err);
                    handleStructureChange(sIdx, null, 'sectionAnalysis', previousAnalysis);
                    failures.push(`第${section.id}問: ${err.message}`);
                } finally {
                    setSectionGenerationPhases(prev => {
                        const next = { ...prev };
                        delete next[sIdx + 1];
                        return next;
                    });
                }

                if (i < tasks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 3000)); // slightly longer wait for section analysis
                }
            }
            if (failures.length > 0) {
                throw new Error(`以下の大問の詳細解説を生成できませんでした。\n\n${failures.join('\n')}`);
            }
            alert('大問詳細解説の一括生成が完了しました！');
        } catch (error) {
            alert('一括生成中にエラーが発生しました:\n' + error.message);
        } finally {
            setBulkGeneratingSectionAnalyses(false);
            setBulkSectionAnalysisProgress({ current: 0, total: 0 });
        }
    };

    const handleRegenerateSectionAnalysis = async (sIdx, section) => {
        if (!confirm(`第${section.id}問の全体解説を再生成しますか？\n（内容が上書きされます）`)) return;

        setGeneratingSectionAnalysis(prev => ({ ...prev, [sIdx]: true }));
        setSectionGenerationPhases(prev => ({ ...prev, [sIdx + 1]: 'analysis' }));
        try {
            const {
                questionFiles: finalQFiles,
                answerFiles: finalAFiles
            } = resolveSectionSourceFiles({
                sectionIndex: sIdx + 1,
                structure: examData?.structure || [],
                questionFilesBySection,
                answerFilesBySection,
                questionFiles,
                examPdfPath: examData?.pdf_path
            });

            ensureSectionAnalysisSources(section, finalQFiles, finalAFiles);
            const newAnalysis = await geminiQueue.add(() => generateSectionDetailedAnalysis(
                subjectEn,
                section,
                finalQFiles,
                finalAFiles,
                buildSectionAnalysisInstruction(getSectionInstruction(sectionInstructionsBySection, sIdx + 1, section), section),
                examData?.subject || ''
            ));
            handleStructureChange(sIdx, null, 'sectionAnalysis', validateGeneratedText(newAnalysis, `第${section.id}問の詳細解説`));
        } catch (error) {
            alert('大問解説の再生成に失敗しました:\n' + error.message);
        } finally {
            setGeneratingSectionAnalysis(prev => ({ ...prev, [sIdx]: false }));
            setSectionGenerationPhases(prev => {
                const next = { ...prev };
                delete next[sIdx + 1];
                return next;
            });
        }
    };

    const handleExtractVocabulary = async (sIdx, section) => {
        if (!confirm(`第${section.id}問から英検準一級レベルの英単語を抽出しますか？\n（すでに抽出済みの場合は上書きされます）`)) return;

        setGeneratingVocabulary(prev => ({ ...prev, [sIdx]: true }));
        try {
            const {
                questionFiles: finalQFiles
            } = resolveSectionSourceFiles({
                sectionIndex: sIdx + 1,
                structure: examData?.structure || [],
                questionFilesBySection,
                answerFilesBySection,
                questionFiles,
                examPdfPath: examData?.pdf_path
            });

            if (finalQFiles.length === 0) {
                throw new Error("単語を抽出するための問題データがありません。");
            }

            const newVocabulary = await geminiQueue.add(() => extractSectionVocabulary(finalQFiles));
            handleStructureChange(sIdx, null, 'vocabulary', newVocabulary);
            alert(`第${section.id}問の英単語抽出が完了しました！`);
        } catch (error) {
            alert('英単語の抽出に失敗しました:\n' + error.message);
        } finally {
            setGeneratingVocabulary(prev => ({ ...prev, [sIdx]: false }));
        }
    };
    const handleRemoveAllAsterisks = () => {
        if (!examData) {
            alert('マスターデータが存在しません。');
            return;
        }
        if (!confirm('試験内のすべての詳細解説・大問全体の分析・小問解説からアスタリスク（*）を一括削除しますか？')) return;

        let cleanedDetailed = examData.detailed_analysis || '';
        cleanedDetailed = cleanedDetailed.replace(/\*/g, '');

        const newStructure = (examData.structure || []).map(section => {
            let cleanedSecAnalysis = section.sectionAnalysis || '';
            cleanedSecAnalysis = cleanedSecAnalysis.replace(/\*/g, '');

            const newQuestions = (section.questions || []).map(q => {
                let cleanedExpl = q.explanation || '';
                cleanedExpl = cleanedExpl.replace(/\*/g, '');
                
                let cleanedGrading = q.gradingInstruction || '';
                cleanedGrading = cleanedGrading.replace(/\*/g, '');

                return {
                    ...q,
                    explanation: cleanedExpl,
                    gradingInstruction: cleanedGrading
                };
            });

            return {
                ...section,
                sectionAnalysis: cleanedSecAnalysis,
                questions: newQuestions
            };
        });

        setExamData({
            ...examData,
            detailed_analysis: cleanedDetailed,
            structure: newStructure
        });
        alert('すべての解説テキストからアスタリスク（*）を一括削除しました！\n（忘れずに「保存」してください）');
    };

    const handleRegenerateDetailedAnalysis = async () => {
        if (!examData) {
            alert('マスターデータが存在しません。');
            return;
        }
        const finalQFiles = questionFiles.length > 0 ? questionFiles : (examData?.pdf_path ? [examData.pdf_path] : []);
        const finalAFiles = flatAnswerFiles.length > 0 ? flatAnswerFiles : (examData?.answer_pdf_path ? [examData.answer_pdf_path] : []);

        if (finalQFiles.length === 0 && finalAFiles.length === 0) {
            alert('試験全体の講評をAIで生成するには、問題または解答のデータ（アップロードまたは保存済みPDF）が必要です。');
            return;
        }
        if (!confirm('試験全体の講評をAIで再生成しますか？\n（内容が上書きされます）')) return;

        setGeneratingDetailed(true);
        try {
            const newAnalysis = await geminiQueue.add(() => regenerateDetailedAnalysis(
                subjectEn,
                examData,
                finalQFiles,
                finalAFiles
            ));

            setExamData(prev => ({ ...prev, detailed_analysis: validateGeneratedText(newAnalysis, '試験全体の講評') }));
            alert('試験全体の講評を再生成しました！確認して保存してください。');
        } catch (error) {
            alert('講評の再生成に失敗しました:\n' + error.message);
        } finally {
            setGeneratingDetailed(false);
        }
    };

    const handleRegeneratePoints = async () => {
        if (!examData) {
            alert('マスターデータが存在しません。');
            return;
        }
        if (!confirm('大問・小問の構造を維持したまま、配点（points）だけをAIで再計算・再割り当てしますか？\n（指定した満点に合わせて、厳密な科目別ルールに基づき再生成されます）')) return;

        setRegeneratingPoints(true);
        try {
            const newStructure = await geminiQueue.add(() => regeneratePointsAllocation(
                subjectEn,
                examData,
                questionFiles,
                flatAnswerFiles
            ));

            setExamData(prev => ({ ...prev, structure: newStructure }));
            alert('配点の再生成が完了しました！内容を確認して保存してください。');
        } catch (error) {
            alert('配点の再生成に失敗しました:\n' + error.message);
        } finally {
            setRegeneratingPoints(false);
        }
    };

    const handleAddQuestion = (sectionIdx, insertAtIdx = null) => {
        const newStructure = [...examData.structure];
        const questionsLength = newStructure[sectionIdx].questions.length;
        
        let targetPrevQ = null;
        if (insertAtIdx !== null && insertAtIdx > 0) {
            targetPrevQ = newStructure[sectionIdx].questions[insertAtIdx - 1];
        } else if (questionsLength > 0 && insertAtIdx === null) {
            targetPrevQ = newStructure[sectionIdx].questions[questionsLength - 1];
        }

        let nextId = "new";
        if (targetPrevQ && !isNaN(parseInt(targetPrevQ.id))) {
            nextId = String(parseInt(targetPrevQ.id) + 1);
        }

        const newQuestion = {
            id: nextId,
            label: `問${nextId}`,
            points: 0,
            type: "selection", // Default to selection
            completeGroupId: "", // Added
            completeGroupOrderMode: "ordered",
            correctAnswer: "",
            alternativeAnswers: [],
            gradingInstruction: "",
            explanation: ""
        };

        if (insertAtIdx !== null) {
            newStructure[sectionIdx].questions.splice(insertAtIdx, 0, newQuestion);
        } else {
            newStructure[sectionIdx].questions.push(newQuestion);
        }
        
        setExamData({ ...examData, structure: newStructure });
    };

    const handleMoveQuestion = (sectionIdx, qIdx, direction) => {
        const newStructure = [...examData.structure];
        const questions = [...newStructure[sectionIdx].questions];
        
        if (direction === 'up' && qIdx > 0) {
            const temp = questions[qIdx];
            questions[qIdx] = questions[qIdx - 1];
            questions[qIdx - 1] = temp;
        } else if (direction === 'down' && qIdx < questions.length - 1) {
            const temp = questions[qIdx];
            questions[qIdx] = questions[qIdx + 1];
            questions[qIdx + 1] = temp;
        } else {
            return; // Invalid move
        }
        
        newStructure[sectionIdx].questions = questions;
        setExamData({ ...examData, structure: newStructure });
    };

    const handleDeleteQuestion = (sectionIdx, qIdx) => {
        if (!confirm('この小問を削除しますか？')) return;
        const newStructure = [...examData.structure];
        newStructure[sectionIdx].questions.splice(qIdx, 1);
        setExamData({ ...examData, structure: newStructure });
    };

    const handleAddSection = () => {
        const newStructure = [...(examData.structure || [])];
        newStructure.push({
            id: String(newStructure.length + 1),
            label: `第${newStructure.length + 1}問`,
            allocatedPoints: 0,
            sectionAnalysis: '',
            questionType: 'default',
            questions: []
        });
        setExamData({ ...examData, structure: newStructure });
    };

    const handleDeleteSection = (sectionIdx) => {
        if (!confirm('この大問に含まれるすべての小問も削除されます。本当に削除しますか？')) return;
        const newStructure = [...examData.structure];
        newStructure.splice(sectionIdx, 1);
        setExamData({ ...examData, structure: newStructure });
    };

    // --- CSV Export: download current structure as CSV for external AI to fill ---
    const handleCsvExport = () => {
        if (!examData?.structure?.length) {
            alert('先にAIでデータを生成してください。');
            return;
        }
        const rows = [['section_id', 'section_label', 'question_id', 'question_label', 'type', 'correct_answer', 'alternative_answers', 'grading_instruction', 'points', 'explanation', 'section_analysis']];
        examData.structure.forEach(sec => {
            sec.questions.forEach((q, qIdx) => {
                rows.push([
                    sec.id,
                    sec.label,
                    q.id,
                    q.label,
                    q.type || 'selection',
                    q.correctAnswer || '',
                    (q.alternativeAnswers || []).join('|'), // Joined by pipe
                    (q.gradingInstruction || '').replace(/"/g, '""'), // escape quotes
                    q.points || 0,
                    (q.explanation || '').replace(/"/g, '""'), // escape quotes
                    qIdx === 0 ? (sec.sectionAnalysis || '').replace(/"/g, '""') : '' // Output detailed section analysis on first question of each section
                ]);
            });
        });
        const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${examId || 'exam'}_explanations.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // --- CSV Import: read CSV and map explanations back into questions ---
    const parseCsvText = (text) => {
        const rows = [];
        let curRow = [];
        let curCell = '';
        let inQuote = false;

        const cleanText = text.replace(/^\uFEFF/, '');

        for (let i = 0; i < cleanText.length; i++) {
            const ch = cleanText[i];
            const next = cleanText[i + 1];

            if (ch === '"') {
                if (inQuote && next === '"') {
                    curCell += '"';
                    i++;
                } else {
                    inQuote = !inQuote;
                }
            } else if (ch === ',' && !inQuote) {
                curRow.push(curCell);
                curCell = '';
            } else if ((ch === '\r' || ch === '\n') && !inQuote) {
                if (ch === '\r' && next === '\n') i++;
                curRow.push(curCell);
                if (curRow.some(c => c.trim() !== '')) {
                    rows.push(curRow);
                }
                curRow = [];
                curCell = '';
            } else {
                curCell += ch;
            }
        }
        if (curCell !== '' || curRow.length > 0) {
            curRow.push(curCell);
            if (curRow.some(c => c.trim() !== '')) {
                rows.push(curRow);
            }
        }
        return rows;
    };

    const handleCsvImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const text = ev.target.result;
                const rows = parseCsvText(text);
                if (rows.length < 2) {
                    alert('CSVデータが空か、有効な行がありません。');
                    return;
                }

                // Dynamic column index resolution based on header names
                const headerRow = rows[0].map(h => h.trim().toLowerCase().replace(/[\s_]/g, ''));
                const findColIdx = (candidates) => {
                    return headerRow.findIndex(h => candidates.some(c => h === c || h.includes(c)));
                };

                const secIdIdx = findColIdx(['sectionid', '大問id', '大問番号', '大問']);
                const qIdIdx = findColIdx(['questionid', '問題id', '小問id', '問題番号', '設問番号']);
                const expIdx = findColIdx(['explanation', '小問解説', '解説']);
                const secAnalysisIdx = findColIdx(['sectionanalysis', '詳細解説', '大問詳細解説', '大問解説', '大問総評']);
                const gradingIdx = findColIdx(['gradinginstruction', '採点基準', '指示']);
                const pointsIdx = findColIdx(['points', '配点', '点数']);
                const answerIdx = findColIdx(['correctanswer', 'answer', '正解', '回答', '解答']);

                if (secIdIdx === -1 || qIdIdx === -1 || expIdx === -1) {
                    throw new Error('CSVに必要なカラム（section_id, question_id, explanation）が見つかりません。ヘッダー名をご確認ください。');
                }

                const updates = {};
                const sectionAnalysisUpdates = {};

                for (let r = 1; r < rows.length; r++) {
                    const row = rows[r];
                    const secId = (row[secIdIdx] || '').trim();
                    const qId = (row[qIdIdx] || '').trim();
                    if (!secId || !qId) continue;

                    const explanation = (row[expIdx] || '').trim();
                    const gradingInstruction = gradingIdx !== -1 ? (row[gradingIdx] || '').trim() : undefined;
                    const points = pointsIdx !== -1 ? Number(row[pointsIdx]) : undefined;
                    const correctAnswer = answerIdx !== -1 ? (row[answerIdx] || '').trim() : undefined;

                    updates[`${secId}__${qId}`] = {
                        explanation,
                        ...(gradingInstruction !== undefined ? { gradingInstruction } : {}),
                        ...(Number.isFinite(points) && points > 0 ? { points } : {}),
                        ...(correctAnswer ? { correctAnswer } : {})
                    };

                    if (secAnalysisIdx !== -1) {
                        const secAnalysis = (row[secAnalysisIdx] || '').trim();
                        if (secAnalysis) {
                            sectionAnalysisUpdates[secId] = secAnalysis;
                        }
                    }
                }

                const currentExamData = examDataRef.current || examData || {};
                const newStructure = (currentExamData.structure || []).map(sec => ({
                    ...sec,
                    sectionAnalysis: sectionAnalysisUpdates[sec.id] !== undefined
                        ? sectionAnalysisUpdates[sec.id]
                        : sec.sectionAnalysis,
                    questions: (sec.questions || []).map(q => {
                        const key = `${sec.id}__${q.id}`;
                        const altKey = `${sec.id}__${q.label}`;
                        const matched = updates[key] || updates[altKey];
                        if (matched !== undefined) {
                            return {
                                ...q,
                                explanation: matched.explanation !== undefined ? matched.explanation : q.explanation,
                                ...(matched.gradingInstruction !== undefined ? { gradingInstruction: matched.gradingInstruction } : {}),
                                ...(matched.points !== undefined ? { points: matched.points } : {}),
                                ...(matched.correctAnswer !== undefined ? { correctAnswer: matched.correctAnswer } : {})
                            };
                        }
                        return q;
                    })
                }));

                const nextExamData = { ...currentExamData, structure: newStructure };
                examDataRef.current = nextExamData;
                setExamData(nextExamData);
                const updatedSecCount = Object.keys(sectionAnalysisUpdates).length;
                alert(`CSVのインポートが完了しました！\n・小問解説が更新された問題: ${Object.keys(updates).length}問${updatedSecCount > 0 ? `\n・詳細解説が更新された大問: ${updatedSecCount}個` : ''}\n\n忘れずに画面右上の「保存」ボタンを押してください！`);
            } catch (err) {
                alert('CSVの読み込みに失敗しました。形式を確認してください。\n' + err.message);
            } finally {
                e.target.value = '';
            }
        };
        reader.readAsText(file, 'UTF-8');
    };

    const totalAllocatedPoints = examData?.structure?.reduce((acc, section) => {
        return acc + section.questions.reduce((qAcc, q) => qAcc + (parseInt(q.points) || 0), 0);
    }, 0) || 0;

    const baseDataUniversities = [...new Set(universityBaseData.map(item => item.university).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ja'));
    const baseDataYears = [...new Set(universityBaseData.map(item => item.year).filter(Boolean))]
        .sort((a, b) => Number(b) - Number(a));
    const baseDataSubjects = [...new Set(universityBaseData.map(item => item.subject).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ja'));
    const filteredUniversityBaseData = universityBaseData.filter(item => {
        const matchesUniversity = baseDataUniversityFilter === 'all' || item.university === baseDataUniversityFilter;
        const matchesYear = baseDataYearFilter === 'all' || String(item.year) === String(baseDataYearFilter);
        const matchesSubject = baseDataSubjectFilter === 'all' || item.subject === baseDataSubjectFilter;
        return matchesUniversity && matchesYear && matchesSubject;
    });
    const activeSectionGenerationEntries = Object.entries(sectionGenerationPhases)
        .filter(([, phase]) => phase)
        .map(([sectionNum, phase]) => ({
            sectionNum,
            phase,
            label: GENERATION_PHASE_LABELS[phase] || '生成中'
        }));
    const renderBaseDataFilterButton = (label, active, onClick) => (
        <button
            type="button"
            onClick={onClick}
            className={`px-3 py-1.5 rounded-lg border text-[10px] font-black transition-all ${
                active
                    ? 'bg-white text-indigo-700 border-white shadow-sm'
                    : 'bg-white/10 text-indigo-100 border-white/20 hover:bg-white/20'
            }`}
        >
            {label}
        </button>
    );

    if (loading) return <div className="p-8 text-center text-gray-500">読み込み中...</div>;

    return (
        <div className="min-h-screen bg-indigo-50/20 py-12 px-4 sm:px-6 lg:px-8 pb-32">
            <div className="max-w-7xl mx-auto">
                {/* Header Navigation Section */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
                    <div className="flex flex-col gap-2">
                        <Link
                            to="/admin"
                            className="text-navy-blue/60 hover:text-navy-blue font-black text-[10px] uppercase tracking-[0.2em] flex items-center gap-2 transition-colors mb-2"
                        >
                            <span className="w-5 h-5 rounded-full bg-navy-blue/5 flex items-center justify-center text-[10px] pb-0.5">←</span>
                            ダッシュボードに戻る
                        </Link>
                        <h1 className="text-4xl font-black text-navy-blue leading-tight">
                            {isNew ? '新規試験データの作成' : '試験内容の編集'}
                            <span className="ml-3 text-xs bg-navy-blue text-white px-3 py-1 rounded-full font-mono align-middle">
                                エディター v2.2
                            </span>
                        </h1>
                        <div className="flex gap-6 mt-4 border-b border-gray-200">
                            <span className="pb-3 px-1 border-b-2 border-navy-blue font-bold text-navy-blue text-sm">
                                試験マスター編集
                            </span>
                            {MARKETING_CONFIG.enableAdBanners && (
                                <Link to="/admin/banners" className="pb-3 px-1 text-gray-400 hover:text-navy-blue font-medium text-sm transition-colors">
                                    広告管理
                                </Link>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-3 mt-4 md:mt-0">
                        {examData && (
                            <>
                                <button 
                                    onClick={handleCopyStructureExplanations}
                                    className="bg-white hover:bg-gray-50 text-indigo-600 font-bold py-3 px-6 rounded-xl border border-indigo-100 transition-all active:scale-95 text-sm flex items-center gap-2 cursor-pointer"
                                >
                                    📋 問題データ一式コピー
                                </button>
                                <button 
                                    onClick={handlePasteStructureExplanations}
                                    className="bg-white hover:bg-gray-50 text-indigo-600 font-bold py-3 px-6 rounded-xl border border-indigo-100 transition-all active:scale-95 text-sm flex items-center gap-2 cursor-pointer"
                                >
                                    📋 問題データ一式ペースト
                                </button>
                                <button 
                                    onClick={handleRemoveAllAsterisks}
                                    className="bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold py-3 px-6 rounded-xl border border-amber-200 transition-all active:scale-95 text-sm flex items-center gap-2 cursor-pointer"
                                >
                                    🧹 アスタリスク(*)を一括消去
                                </button>
                                <button 
                                    onClick={() => navigate(`/admin/exam/${examId}/verify`)}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-emerald-200 transition-all active:scale-95 text-sm flex items-center gap-2"
                                >
                                    🔍 解答照合 (正解・配点)
                                </button>
                                <button 
                                    type="button"
                                    onClick={handleExportCsv}
                                    className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold py-3 px-6 rounded-xl border border-emerald-300 transition-all active:scale-95 text-sm flex items-center gap-2 cursor-pointer shadow-sm"
                                    title="大問、問題番号、回答、小問解説、詳細解説などの問題データをCSV形式でダウンロードします"
                                >
                                    📥 CSVエクスポート
                                </button>
                                <button onClick={handleSaveAndPreview} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50 text-sm flex items-center gap-2">
                                    {saving ? '保存中...' : '保存してプレビュー'}
                                </button>
                                <button onClick={() => handleSave(true)} disabled={saving} className="bg-white hover:bg-gray-50 text-navy-blue font-bold py-3 px-6 rounded-xl shadow-sm border border-navy-blue/10 transition-all active:scale-95 disabled:opacity-50 text-sm">
                                    {saving ? '保存中...' : 'DBに保存のみ'}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>



            {/* Tab Navigation */}
            <div className="flex flex-wrap gap-4 mb-10 sticky top-4 z-[40]">
                <button 
                    onClick={() => setActiveTab('master')}
                    className={`px-8 py-4 rounded-3xl font-black transition-all text-sm flex items-center gap-3 ${activeTab === 'master' ? 'bg-navy-blue text-white shadow-2xl shadow-navy-blue/30 scale-105' : 'bg-white/80 backdrop-blur-md text-gray-400 hover:text-navy-blue border border-white hover:bg-white shadow-sm'}`}
                >
                    <span className="text-xl">🛠️</span>
                    マスター設定・AI生成
                </button>
                <button 
                    onClick={() => setActiveTab('design')}
                    className={`px-8 py-4 rounded-3xl font-black transition-all text-sm flex items-center gap-3 ${activeTab === 'design' ? 'bg-navy-blue text-white shadow-2xl shadow-navy-blue/30 scale-105' : 'bg-white/80 backdrop-blur-md text-gray-400 hover:text-navy-blue border border-white hover:bg-white shadow-sm'}`}
                >
                    <span className="text-xl">🎨</span>
                    解説ページのデザイン編集
                    <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full animate-pulse">β</span>
                </button>
            </div>

            {/* Main Content Area */}
            {activeTab === 'master' ? (
                <div className="grid grid-cols-1 gap-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Draft Recovery Banner */}
                {availableDrafts.length > 0 && (!examData?.structure || examData.structure.every(s => !s.questions || s.questions.length === 0)) && (
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-3xl p-6 shadow-md shadow-amber-100/50">
                        <div className="flex items-start justify-between gap-6 flex-wrap">
                            <div className="space-y-2 w-full">
                                <div className="flex items-center gap-2 font-black text-amber-900 text-base">
                                    <span className="text-xl">⚠️</span>
                                    <span>未保存のローカル問題データ（生成ドラフト）が見つかりました</span>
                                </div>
                                <p className="text-xs font-bold text-amber-800/80">
                                    データベースに未登録ですが、ブラウザに保存されている生成済み問題データを復元できます。
                                </p>
                                <div className="space-y-2 pt-2">
                                    {availableDrafts.map((d) => (
                                        <div key={d.key} className="flex items-center justify-between gap-3 text-xs bg-white/90 backdrop-blur-sm rounded-xl px-4 py-2.5 border border-amber-200 text-amber-900 font-bold shadow-sm">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span>📝 ID: <code className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded font-mono font-black">{d.examId}</code></span>
                                                <span className="text-amber-700">（大問 {d.sectionCount}個 / 小問 {d.questionCount}問）</span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => handleRestoreDraft(d)}
                                                    className="bg-amber-600 hover:bg-amber-700 text-white font-black px-4 py-1.5 rounded-lg shadow-sm text-xs transition-all active:scale-95 cursor-pointer"
                                                >
                                                    このデータを復元
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDismissDraft(d.key)}
                                                    className="text-gray-400 hover:text-red-500 text-xs font-bold px-2 py-1 transition-colors cursor-pointer"
                                                    title="このドラフトを破棄"
                                                >
                                                    ✕ 破棄
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Explanation Generation Panel */}
                {examData && (
                    <div className="space-y-6">
                        {/* CSV Import/Export Panel (Fallback) */}
                        <details className="bg-white/50 backdrop-blur-sm border border-white rounded-3xl p-6 shadow-sm group transition-all">
                            <summary className="text-sm font-black text-navy-blue/60 cursor-pointer select-none flex items-center gap-3 list-none">
                                <span className="group-open:rotate-90 transition-transform bg-navy-blue/5 w-6 h-6 rounded-full flex items-center justify-center text-[10px]">▶</span>
                                <span className="text-xl">🛠️</span> 外部AI（ChatGPT等）を使って解説を作る場合（CSV連携）
                            </summary>
                            <div className="mt-6 pt-6 border-t border-navy-blue/5 space-y-6">
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                    <div className="text-xs text-gray-500 space-y-4">
                                        <p className="font-black text-navy-blue uppercase tracking-widest text-[10px]">Workflow</p>
                                        <ol className="space-y-3">
                                            <li className="flex gap-3"><span className="font-mono text-navy-blue bg-navy-blue/5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0">1</span> 「CSVをエクスポート」で構造データを取得</li>
                                            <li className="flex gap-3"><span className="font-mono text-navy-blue bg-navy-blue/5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0">2</span> AIにPDFとCSVを渡し、右のプロンプトで解説生成を依頼</li>
                                            <li className="flex gap-3"><span className="font-mono text-navy-blue bg-navy-blue/5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0">3</span> AIが返したCSVを「インポート」して保存</li>
                                        </ol>
                                        <div className="flex gap-3 pt-2">
                                            <button onClick={handleCsvExport} className="px-5 py-2.5 bg-navy-blue text-white rounded-xl text-xs font-black shadow-lg shadow-navy-blue/20 hover:bg-navy-light transition-all">
                                                📤 CSVをエクスポート
                                            </button>
                                            <label className="px-5 py-2.5 bg-green-600 text-white rounded-xl text-xs font-black shadow-lg shadow-green-200 hover:bg-green-700 transition-all cursor-pointer">
                                                📥 解説入りCSVをインポート
                                                <input type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
                                            </label>
                                        </div>
                                    </div>
                                    {(() => {
                                        const isJapaneseExam = (examData?.subject && (
                                            examData.subject.includes('国語') ||
                                            examData.subject.includes('現代文') ||
                                            examData.subject.includes('古文') ||
                                            examData.subject.includes('漢文')
                                        )) || subjectEn === 'japanese';
                                        const effectiveKey = customPromptType === 'auto'
                                            ? (isJapaneseExam ? 'japanese' : 'standard')
                                            : customPromptType;
                                        const currentConfig = EXTERNAL_AI_PROMPTS[effectiveKey] || EXTERNAL_AI_PROMPTS.standard;

                                        return (
                                            <div className="bg-navy-blue/5 p-5 rounded-2xl border border-navy-blue/10 space-y-3 relative group/prompt">
                                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                                    <div className="flex items-center gap-1.5 p-1 bg-navy-blue/10 rounded-xl">
                                                        <button
                                                            type="button"
                                                            onClick={() => setCustomPromptType('japanese')}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                                                                effectiveKey === 'japanese'
                                                                    ? 'bg-white text-navy-blue shadow-sm'
                                                                    : 'text-navy-blue/60 hover:text-navy-blue'
                                                            }`}
                                                        >
                                                            📖 国語（完全解説・詳細版）
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCustomPromptType('standard')}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                                                                effectiveKey === 'standard'
                                                                    ? 'bg-white text-navy-blue shadow-sm'
                                                                    : 'text-navy-blue/60 hover:text-navy-blue'
                                                            }`}
                                                        >
                                                            🌐 標準 / 英語長文用
                                                        </button>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            navigator.clipboard.writeText(currentConfig.prompt);
                                                            alert(`【${currentConfig.name}】のプロンプトをコピーしました！`);
                                                        }}
                                                        className="px-3.5 py-1.5 bg-navy-blue text-white rounded-lg text-xs font-black shadow-sm hover:bg-navy-light transition-all flex items-center gap-1.5"
                                                    >
                                                        📋 プロンプトをコピー
                                                    </button>
                                                </div>
                                                <div className="flex items-center justify-between text-[11px] text-navy-blue/60 font-bold px-1">
                                                    <span className="truncate">{currentConfig.badge}：{currentConfig.shortDescription}</span>
                                                    <span className="font-mono flex-shrink-0 ml-2">{currentConfig.prompt.length.toLocaleString()}文字</span>
                                                </div>
                                                <div className="relative">
                                                    <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-navy-blue/80 max-h-52 overflow-y-auto p-3 bg-white/70 rounded-xl border border-navy-blue/10 select-all">
                                                        {currentConfig.prompt}
                                                    </pre>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                </div>
                            </div>
                        </details>
                    </div>
                )}

                {/* Basic Info Panel */}
                <div className="admin-editor-card bg-white rounded-[2.5rem] shadow-2xl shadow-indigo-100/50 p-10 border border-gray-100">
                    <div className="flex items-center justify-between mb-8">
                        <h2 className="text-2xl font-black text-navy-blue flex items-center gap-3">
                            <span className="bg-navy-blue text-white w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-lg shadow-navy-blue/20">A</span>
                            基本情報の設定
                        </h2>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleExtractMetadata}
                                disabled={extractingMetadata || uploadingQuestion || (!questionFiles.length && !examData?.pdf_path)}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white font-black py-2.5 px-4 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50 text-xs"
                            >
                                {extractingMetadata ? 'AIが自動入力中...' : 'PDFから基本情報を自動入力'}
                            </button>
                            <div className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-full text-xs font-black border border-indigo-100">
                                ID: {examId || '(未生成)'}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">大学名</label>
                            <input type="text" list="uni-list" value={university} onChange={handleUniversityChange} className="block w-full rounded-2xl border-gray-100 shadow-sm focus:border-navy-blue focus:ring-navy-blue text-sm p-4 border bg-gray-50/30 focus:bg-white transition-all font-bold" placeholder="例: 明治大学" />
                            <datalist id="uni-list">
                                {universitiesData.map(u => <option key={u.id} value={u.name} />)}
                            </datalist>
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">学部名</label>
                            <input type="text" list="fac-list" value={faculty} onChange={handleFacultyChange} className="block w-full rounded-2xl border-gray-100 shadow-sm focus:border-navy-blue focus:ring-navy-blue text-sm p-4 border bg-gray-50/30 focus:bg-white transition-all font-bold" placeholder="例: 法学部" />
                            <datalist id="fac-list">
                                {universitiesData.find(u => u.name === university)?.faculties.map(f => <option key={f.id} value={f.name} />)}
                            </datalist>
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">年度</label>
                            <input 
                                type="text" 
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={year} 
                                onChange={e => setYear(e.target.value.replace(/[^0-9]/g, ''))} 
                                className="block w-full rounded-2xl border-gray-100 shadow-sm focus:border-navy-blue focus:ring-navy-blue text-sm p-4 border bg-gray-50/30 focus:bg-white transition-all font-bold" 
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">表示用科目名</label>
                            <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className="block w-full rounded-2xl border-gray-100 shadow-sm focus:border-navy-blue focus:ring-navy-blue text-sm p-4 border bg-gray-50/30 focus:bg-white transition-all font-bold" placeholder="例: 英語" />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">科目ID（内部用）</label>
                            <select value={subjectEn} onChange={e => setSubjectEn(e.target.value)} className="block w-full rounded-2xl border-gray-100 shadow-sm focus:border-navy-blue focus:ring-navy-blue text-sm p-4 border bg-gray-50/30 focus:bg-white transition-all font-black appearance-none">
                                {SUBJECT_OPTIONS.map(option => (
                                    <option key={option.value} value={option.value}>{option.display}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">作成ステータス</label>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {MASTER_STATUS_OPTIONS.map(option => {
                                    const isActive = masterStatus === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setMasterStatus(option.value)}
                                            title={option.description}
                                            className={`rounded-2xl border px-3 py-3 text-xs font-black transition-all ${
                                                isActive
                                                    ? option.value === 'production'
                                                        ? 'bg-red-600 text-white border-red-600 shadow-lg shadow-red-100'
                                                        : option.value === 'verified'
                                                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-100'
                                                        : option.value === 'completed'
                                                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-100'
                                                            : 'bg-gray-700 text-white border-gray-700 shadow-lg shadow-gray-100'
                                                    : 'bg-gray-50/30 text-gray-400 border-gray-100 hover:bg-white hover:text-navy-blue'
                                            }`}
                                        >
                                            {option.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-[10px] text-gray-400 font-bold leading-relaxed ml-1">
                                本番用にすると公開対象、それ以外は非公開として保存します。
                            </p>
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">満点（合計）</label>
                            <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={examData?.max_score || ""}
                                onChange={e => {
                                    const val = e.target.value.replace(/[^0-9]/g, '');
                                    const newMax = parseInt(val) || 0;
                                    setExamData(prev => ({
                                        ...prev,
                                        max_score: newMax,
                                        passing_lines: {
                                            A: Math.round(newMax * 0.8),
                                            B: Math.round(newMax * 0.7),
                                            C: Math.round(newMax * 0.6),
                                            D: Math.round(newMax * 0.4)
                                        }
                                    }));
                                }}
                                className="block w-full rounded-2xl border-gray-100 shadow-sm focus:border-navy-blue focus:ring-navy-blue text-sm p-4 border bg-gray-50/30 focus:bg-white transition-all font-black text-indigo-600"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">制限時間（分）</label>
                            <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={durationMinutes}
                                onChange={e => setDurationMinutes(e.target.value.replace(/[^0-9]/g, ''))}
                                className="block w-full rounded-2xl border-gray-100 shadow-sm focus:border-navy-blue focus:ring-navy-blue text-sm p-4 border bg-gray-50/30 focus:bg-white transition-all font-black text-amber-600"
                            />
                        </div>
                    </div>

                    {knowledgeCandidates.length > 0 && (
                        <div className="mt-6 rounded-3xl border border-indigo-100 bg-indigo-50/70 p-6">
                            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                                <div className="flex-1">
                                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">参照する大学データ</div>
                                    <select
                                        value={selectedKnowledgeKey}
                                        onChange={e => setSelectedKnowledgeKey(e.target.value)}
                                        className="block w-full rounded-2xl border-gray-100 shadow-sm text-sm p-4 border bg-white transition-all font-bold text-navy-blue"
                                    >
                                        {knowledgeCandidates.map(candidate => (
                                            <option key={candidate.key} value={candidate.key}>
                                                {candidate.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <button
                                    onClick={() => applyKnowledgeCandidate(knowledgeCandidates.find(candidate => candidate.key === selectedKnowledgeKey))}
                                    className="bg-navy-blue hover:bg-navy-light text-white font-black py-3 px-5 rounded-xl shadow transition-all"
                                >
                                    選択した大学データを適用
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="mt-10 pt-10 border-t border-gray-50 space-y-6">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black text-navy-blue tracking-tight">合格判定ボーダーライン設定</h3>
                            <button
                                onClick={() => {
                                    const max = examData?.max_score || 100;
                                    setExamData(prev => ({
                                        ...prev,
                                        passing_lines: {
                                            A: Math.round(max * 0.8), B: Math.round(max * 0.7), C: Math.round(max * 0.6), D: Math.round(max * 0.4)
                                        }
                                    }));
                                }}
                                className="text-[9px] font-black bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white px-3 py-1.5 rounded-lg border border-indigo-100 transition-all uppercase tracking-widest"
                            >
                                満点から自動計算
                            </button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                            {['A', 'B', 'C', 'D'].map(grade => (
                                <div key={grade} className="bg-gray-50/50 p-4 rounded-2xl border border-gray-100">
                                    <label className="block text-[10px] font-black text-gray-400 mb-2">{grade} 判定 (以上)</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        value={examData?.passing_lines?.[grade] ?? ''}
                                        onChange={e => {
                                            const val = e.target.value.replace(/[^0-9]/g, '');
                                            setExamData(prev => ({
                                                ...prev,
                                                passing_lines: {
                                                    ...(prev?.passing_lines || { A: 80, B: 70, C: 60, D: 40 }),
                                                    [grade]: parseInt(val) || 0
                                                }
                                            }));
                                        }}
                                        className="w-full bg-transparent text-lg font-black text-navy-blue border-none p-0 focus:ring-0"
                                        placeholder="0"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>


                {/* AI Generation Section */}
                <div className="admin-editor-card bg-white rounded-[2.5rem] shadow-2xl shadow-indigo-100/50 p-10 border border-amber-100 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-amber-50 rounded-full -mr-16 -mt-16 opacity-50"></div>
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 relative z-10">
                        <h2 className="text-2xl font-black text-navy-blue flex items-center gap-3">
                            <span className="bg-accent-gold text-white w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-lg shadow-amber-200">B</span>
                            AI構造解析・自動生成
                        </h2>
                        <button
                            onClick={handleAddGenerationSection}
                            className="bg-navy-blue hover:bg-navy-light text-white font-black py-2.5 px-6 rounded-xl shadow-lg transition-all text-xs flex items-center gap-2"
                        >
                            <span className="text-lg leading-none">+</span> 大問を追加
                        </button>
                    </div>

                    <div className="space-y-8 relative z-10">
                        {/* Data Import from Obsidian */}
                        <div className="bg-indigo-600 p-6 rounded-3xl border border-indigo-500 shadow-xl shadow-indigo-100 space-y-5">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                                <div className="flex items-center gap-4">
                                    <span className="text-3xl">📚</span>
                                    <div>
                                        <h4 className="text-white font-black text-sm">大学データ（Obsidian）から読込</h4>
                                        <p className="text-indigo-200 text-[10px] font-bold">収集済みの満点・配点・制限時間データを適用します</p>
                                    </div>
                                </div>
                                <div className="text-indigo-100 text-[10px] font-black bg-white/10 border border-white/10 rounded-xl px-3 py-2">
                                    表示中 {filteredUniversityBaseData.length} / 全{universityBaseData.length}件
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                <div>
                                    <div className="text-[10px] font-black text-indigo-200 uppercase tracking-[0.18em] mb-2">大学</div>
                                    <div className="flex flex-wrap gap-2">
                                        {renderBaseDataFilterButton('すべて', baseDataUniversityFilter === 'all', () => setBaseDataUniversityFilter('all'))}
                                        {baseDataUniversities.map(name => renderBaseDataFilterButton(
                                            name,
                                            baseDataUniversityFilter === name,
                                            () => setBaseDataUniversityFilter(name)
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-black text-indigo-200 uppercase tracking-[0.18em] mb-2">年度</div>
                                    <div className="flex flex-wrap gap-2">
                                        {renderBaseDataFilterButton('すべて', baseDataYearFilter === 'all', () => setBaseDataYearFilter('all'))}
                                        {baseDataYears.map(dataYear => renderBaseDataFilterButton(
                                            `${dataYear}`,
                                            String(baseDataYearFilter) === String(dataYear),
                                            () => setBaseDataYearFilter(dataYear)
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-black text-indigo-200 uppercase tracking-[0.18em] mb-2">科目</div>
                                    <div className="flex flex-wrap gap-2">
                                        {renderBaseDataFilterButton('すべて', baseDataSubjectFilter === 'all', () => setBaseDataSubjectFilter('all'))}
                                        {baseDataSubjects.map(name => renderBaseDataFilterButton(
                                            name,
                                            baseDataSubjectFilter === name,
                                            () => setBaseDataSubjectFilter(name)
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <select
                                onChange={handleImportUniversityData}
                                className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-3 px-4 rounded-xl border border-white/20 outline-none transition-all cursor-pointer text-sm"
                                defaultValue=""
                            >
                                <option value="" className="text-navy-blue">選択してください...</option>
                                {filteredUniversityBaseData.map(d => (
                                    <option key={getUniversityBaseDataId(d)} value={getUniversityBaseDataId(d)} className="text-navy-blue">
                                        {d.university} - {d.year} - {d.faculty} ({d.subject})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* PDF Tools Notice */}
                        <div className="bg-amber-50/80 p-4 rounded-2xl border border-amber-200/50 flex items-start gap-3">
                            <span className="text-amber-600 mt-0.5">💡</span>
                            <div className="text-xs text-amber-900 leading-relaxed font-bold">
                                PDFのファイルサイズが大きすぎる場合や、余分なページが含まれている場合は、<br className="hidden md:block" />
                                <a href="https://tools.pdf24.org/ja/split-pdf" target="_blank" rel="noopener noreferrer" className="text-navy-blue hover:text-indigo-600 underline decoration-indigo-300 underline-offset-4 transition-colors">
                                    PDF24 Tools (無料PDF分割ツール)
                                </a> などの外部サービスを使って、必要なページだけを分割してからアップロードしてください。
                            </div>
                        </div>

                        {/* Step 1: Main PDF */}
                        <div className="bg-indigo-50/30 p-8 rounded-3xl border border-indigo-100">
                            <label className="block text-[10px] font-black text-navy-blue/40 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-navy-blue rounded-full"></span>
                                Step 1: 全体PDFアップロード
                            </label>
                            <div className="flex flex-col md:flex-row items-center gap-4 bg-white p-5 rounded-2xl border-2 border-dashed border-indigo-200 hover:border-indigo-400 transition-all group">
                                <input
                                    type="file"
                                    accept="application/pdf,.pdf"
                                    onChange={async (e) => {
                                        const files = Array.from(e.target.files);
                                        if (!validateUploadFiles(files, 'question')) {
                                            e.target.value = '';
                                            setQuestionFiles([]);
                                            return;
                                        }
                                        setQuestionFiles(files);
                                        if (files[0]) {
                                            await handleImmediateUpload(files[0], 'question');
                                        }
                                    }}
                                    className="flex-1 text-xs text-gray-500 file:mr-4 file:py-2.5 file:px-6 file:rounded-xl file:border-0 file:text-[10px] file:font-black file:bg-navy-blue file:text-white hover:file:bg-navy-light cursor-pointer"
                                />
                                {uploadingQuestion && (
                                    <div className="flex items-center gap-2 bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100 animate-pulse">
                                        <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                                        <span className="text-[10px] font-black text-indigo-500">保存中...</span>
                                    </div>
                                )}
                                {questionFiles[0] && (
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            window.open(URL.createObjectURL(questionFiles[0]), '_blank');
                                        }}
                                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-[10px] font-black transition-all"
                                    >
                                        👀 選択中のファイルを確認
                                    </button>
                                )}
                                {examData?.pdf_path && (
                                    <a
                                        href={examData.pdf_path}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-4 py-2 bg-navy-blue/5 text-navy-blue hover:bg-navy-blue/10 rounded-xl text-[10px] font-black border border-navy-blue/10 transition-all"
                                    >
                                        📄 保存済みファイルを表示
                                    </a>
                                )}
                            </div>
                        </div>

                        {/* Bulk Section Question Upload */}
                        <div className="bg-white p-6 rounded-3xl border border-indigo-100 shadow-sm">
                            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
                                <div>
                                    <label className="block text-[10px] font-black text-indigo-700/70 uppercase tracking-[0.2em] mb-2">
                                        問題PDFまとめアップロード
                                    </label>
                                    <h3 className="text-lg font-black text-navy-blue mb-2">保存した問題PDFを大問順にまとめて割り当て</h3>
                                    <p className="text-xs text-gray-500 leading-relaxed">
                                        `question_01.pdf`, `question_02.pdf` のように保存したファイルを複数選択すると、ファイル名順に大問1から割り当てます。
                                        PDF以外を選ぶと警告して停止します。
                                    </p>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        type="file"
                                        multiple
                                        accept="application/pdf,.pdf"
                                        onChange={(e) => {
                                            if (!handleBulkQuestionFilesSelect(e.target.files)) e.target.value = '';
                                        }}
                                        className="text-[10px] text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-[10px] file:font-black file:text-indigo-700 hover:file:bg-indigo-100"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleBulkQuestionUpload}
                                        disabled={bulkUploadingQuestions || bulkQuestionFiles.length === 0}
                                        className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white text-[10px] font-black transition-all"
                                    >
                                        {bulkUploadingQuestions
                                            ? `保存中 ${bulkQuestionUploadProgress.current}/${bulkQuestionUploadProgress.total}`
                                            : '大問順にまとめて保存'}
                                    </button>
                                </div>
                            </div>

                            {bulkQuestionFiles.length > 0 && (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                    {bulkQuestionFiles.map((file, index) => {
                                        const sectionNum = index + 1;
                                        const previewUrl = URL.createObjectURL(file);
                                        return (
                                            <div key={`${file.name}-${file.lastModified}-${index}`} className="border border-gray-100 rounded-2xl p-3 bg-gray-50/60 flex gap-3 items-center">
                                                <div className="w-16 h-16 bg-white border border-gray-100 rounded-xl overflow-hidden flex items-center justify-center shrink-0">
                                                    {file.type?.startsWith('image/') ? (
                                                        <img src={previewUrl} alt="" className="w-full h-full object-contain" onLoad={() => URL.revokeObjectURL(previewUrl)} />
                                                    ) : (
                                                        <span className="text-[10px] font-black text-gray-400">PDF</span>
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[10px] font-black text-indigo-700 mb-1">大問 {sectionNum} に割り当て</div>
                                                    <div className="text-[11px] text-gray-700 font-bold truncate" title={file.name}>{file.name}</div>
                                                    <div className="text-[10px] text-gray-400">{Math.round(file.size / 1024)} KB</div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Bulk Answer Image Upload */}
                        <div className="bg-white p-6 rounded-3xl border border-emerald-100 shadow-sm">
                            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
                                <div>
                                    <label className="block text-[10px] font-black text-emerald-700/70 uppercase tracking-[0.2em] mb-2">
                                        解答画像まとめアップロード
                                    </label>
                                    <h3 className="text-lg font-black text-navy-blue mb-2">保存した解答画像を大問順にまとめて割り当て</h3>
                                    <p className="text-xs text-gray-500 leading-relaxed">
                                        `answer_01.gif`, `answer_02.png` のように保存した画像やPCスクショを複数選択すると、ファイル名順に大問1から割り当てます。
                                        GIF / PNG / JPG / WebP 以外を選ぶと警告して停止します。
                                    </p>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        type="file"
                                        multiple
                                        accept="image/gif,image/png,image/jpeg,image/webp,.gif,.png,.jpg,.jpeg,.webp"
                                        onChange={(e) => {
                                            if (!handleBulkAnswerFilesSelect(e.target.files)) e.target.value = '';
                                        }}
                                        className="text-[10px] text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-[10px] file:font-black file:text-emerald-700 hover:file:bg-emerald-100"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleBulkAnswerUpload}
                                        disabled={bulkUploadingAnswers || bulkAnswerFiles.length === 0}
                                        className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white text-[10px] font-black transition-all"
                                    >
                                        {bulkUploadingAnswers
                                            ? `保存中 ${bulkAnswerUploadProgress.current}/${bulkAnswerUploadProgress.total}`
                                            : '大問順にまとめて保存'}
                                    </button>
                                </div>
                            </div>

                            {bulkAnswerFiles.length > 0 && (
                                <div className="space-y-3">
                                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                        まとめアップロード 解答画像プレビュー
                                    </div>
                                    <div className="space-y-3" style={{ maxWidth: 440 }}>
                                        {bulkAnswerFiles.map((file, index) => (
                                            <LocalAnswerImagePreview
                                                key={`${file.name}-${file.lastModified}-${index}`}
                                                file={file}
                                                label={`大問${index + 1} に割り当て: ${file.name}`}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {(examData?.structure || []).some(section => section?.answer_pdf_path) && (
                                <div className={`space-y-3 ${bulkAnswerFiles.length > 0 ? 'mt-6 pt-5 border-t border-emerald-100' : ''}`}>
                                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                        保存済み 解答画像プレビュー
                                    </div>
                                    <div className="space-y-3" style={{ maxWidth: 440 }}>
                                        {(examData?.structure || []).map((section, index) => (
                                            section?.answer_pdf_path ? (
                                                <SavedAnswerImagePreview
                                                    key={`${section.id || index}-${section.answer_pdf_path}`}
                                                    url={section.answer_pdf_path}
                                                    label={`大問${index + 1} 保存済み: ${section.label || `第${index + 1}問`}`}
                                                />
                                            ) : null
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Section Uploads */}
                        <div className="space-y-6">
                            {[...Array(sectionCount)].map((_, i) => {
                                const num = i + 1;
                                const sectionInStructure = examData?.structure?.[i];
                                return (
                                    <div key={num} className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        <div className="bg-gray-50/50 px-8 py-4 flex justify-between items-center border-b border-gray-100/50">
                                            <h3 className="text-xs font-black text-navy-blue flex items-center gap-3">
                                                <span className="bg-navy-blue text-white w-6 h-6 rounded-lg flex items-center justify-center text-[10px]">
                                                    {num}
                                                </span>
                                                大問 {num} の解析用データ
                                            </h3>
                                            {sectionCount > 1 && (
                                                <button onClick={() => handleDeleteGenerationSection(num)} className="text-[10px] font-black text-red-300 hover:text-red-500 transition-colors">
                                                    削除
                                                </button>
                                            )}
                                        </div>
                                        <div className="p-8 space-y-8">
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                                                {/* Q Files */}
                                                <div className="space-y-3">
                                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest flex justify-between">
                                                        大問 {num} の問題PDF
                                                        {questionFilesBySection[num]?.length > 0 && <span className="text-navy-blue bg-navy-blue/5 px-2 rounded">選択中</span>}
                                                    </label>
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="file" multiple accept="application/pdf,.pdf"
                                                            onChange={async (e) => {
                                                                const files = Array.from(e.target.files);
                                                                if (!validateUploadFiles(files, 'question')) {
                                                                    e.target.value = '';
                                                                    setQuestionFilesBySection(prev => ({ ...prev, [num]: [] }));
                                                                    return;
                                                                }
                                                                setQuestionFilesBySection(prev => ({ ...prev, [num]: files }));
                                                                if (files.length > 0) {
                                                                    await handleImmediateUpload(files[0], 'section_question', num);
                                                                }
                                                            }}
                                                            className="flex-1 text-[10px] text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gray-50 file:text-[10px] file:font-black file:text-gray-500 hover:file:bg-gray-100 transition-all"
                                                        />
                                                        {questionFilesBySection[num]?.[0] && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    window.open(URL.createObjectURL(questionFilesBySection[num][0]), '_blank');
                                                                }}
                                                                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-[9px] font-black transition-all"
                                                            >
                                                                👀 プレビュー
                                                            </button>
                                                        )}
                                                        {sectionInStructure?.question_pdf_path && (
                                                            <a href={sectionInStructure.question_pdf_path} target="_blank" rel="noopener noreferrer" className="px-3 py-2 bg-navy-blue/5 text-navy-blue hover:bg-navy-blue/10 rounded-lg text-[9px] font-black border border-navy-blue/10 transition-all">
                                                                📄 保存済みファイルを表示
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                                {/* A Files */}
                                                <div className="space-y-3">
                                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest flex justify-between">
                                                        大問 {num} の解答画像
                                                        {uploadingAnswers[num] ? <span className="text-indigo-500 animate-pulse">保存中...</span> : sectionInStructure?.answer_pdf_path ? <span className="text-green-600">保存済み</span> : null}
                                                    </label>
                                                    <div className="flex flex-wrap gap-2">
                                                        <input
                                                            type="file" multiple accept="image/gif,image/png,image/jpeg,image/webp,.gif,.png,.jpg,.jpeg,.webp"
                                                            onChange={async (e) => {
                                                                const files = Array.from(e.target.files);
                                                                if (!validateUploadFiles(files, 'answer')) {
                                                                    e.target.value = '';
                                                                    setAnswerFilesBySection(prev => ({ ...prev, [num]: [] }));
                                                                    return;
                                                                }
                                                                setAnswerFilesBySection(prev => ({ ...prev, [num]: files }));
                                                                if (files[0]) {
                                                                    await handleImmediateUpload(files[0], 'answer', num);
                                                                }
                                                            }}
                                                            className="flex-1 text-[10px] text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gray-50 file:text-[10px] file:font-black file:text-gray-500 hover:file:bg-gray-100 transition-all"
                                                        />
                                                        {answerFilesBySection[num]?.[0] && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    window.open(URL.createObjectURL(answerFilesBySection[num][0]), '_blank');
                                                                }}
                                                                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-[9px] font-black transition-all"
                                                            >
                                                                👀 プレビュー
                                                            </button>
                                                        )}
                                                        {sectionInStructure?.answer_pdf_path && (
                                                            <a href={sectionInStructure.answer_pdf_path} target="_blank" rel="noopener noreferrer" className="px-3 py-2 bg-navy-blue/5 text-navy-blue hover:bg-navy-blue/10 rounded-lg text-[9px] font-black border border-navy-blue/10 transition-all">
                                                                📄 保存済みファイルを表示
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="pt-6 border-t border-gray-50 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)] gap-6">
                                                <div className="flex-1">
                                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">大問の配点（AI目標値）</label>
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        pattern="[0-9]*"
                                                        value={sectionPointsBySection[num] || ''}
                                                        onChange={e => {
                                                            const val = e.target.value.replace(/[^0-9]/g, '');
                                                            setSectionPointsBySection(prev => ({ ...prev, [num]: val }));
                                                        }}
                                                        placeholder="例: 20"
                                                        className="w-full p-4 rounded-2xl border border-gray-100 text-xs bg-gray-50/30 focus:bg-white focus:border-indigo-100 transition-all font-black outline-none"
                                                    />
                                                </div>
                                                <div className="flex-1">
                                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">期待小問数</label>
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        pattern="[0-9]*"
                                                        value={sectionExpectedQuestionCounts[num] || ''}
                                                        onChange={e => {
                                                            const val = e.target.value.replace(/[^0-9]/g, '');
                                                            setSectionExpectedQuestionCounts(prev => ({ ...prev, [num]: val }));
                                                        }}
                                                        placeholder="例: 10"
                                                        className="w-full p-4 rounded-2xl border border-gray-100 text-xs bg-gray-50/30 focus:bg-white focus:border-indigo-100 transition-all font-black outline-none"
                                                    />
                                                    <p className="mt-2 text-[10px] text-gray-400 font-bold leading-relaxed">
                                                        指定数未満なら保存せずエラーにします。
                                                    </p>
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">詳細解説用プロンプト（オプション・最優先）</label>
                                                    <textarea
                                                        value={sectionInstructionsBySection[num] || ''}
                                                    onChange={e => setSectionInstructionsBySection(prev => ({ ...prev, [num]: e.target.value }))}
                                                    placeholder="例: 各設問ごとに「解答根拠→誤答理由→解法の着眼点」の順で説明。導入や講評は不要。"
                                                    className="w-full p-4 rounded-2xl border border-gray-100 text-xs bg-gray-50/30 focus:bg-white focus:border-indigo-100 transition-all outline-none min-h-[60px]"
                                                />
                                                    <p className="mt-2 text-[10px] text-gray-400 font-bold leading-relaxed">
                                                        ここに書いた内容は、大問全体の詳細解説生成で最優先されます。
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="px-8 pb-8 pt-4">
                                                <button
                                                    onClick={() => handleGenerateSection(num)}
                                                    disabled={generatingSectionData[num] || generating}
                                                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 px-6 rounded-xl shadow-lg transition-all text-sm flex items-center justify-center gap-3 disabled:opacity-50"
                                                >
                                                    {generatingSectionData[num] ? (
                                                        <>
                                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                            <span>（大問 {num}）解答・配点・解説をAI生成中...</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span className="text-xl">🪄</span>
                                                            この大問のデータ（解答構造・配点・解説）をAI生成する
                                                        </>
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => handleGenerateSection(num, false, false, false, false)}
                                                    disabled={generatingSectionData[num] || generating}
                                                    className="w-full mt-3 bg-white text-indigo-600 hover:bg-indigo-50 border border-indigo-200 font-black py-3 px-6 rounded-xl transition-all text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                                                >
                                                    {generatingSectionData[num] ? (
                                                        <span>生成中...</span>
                                                    ) : (
                                                        <>
                                                            <span className="text-sm">⚡</span>
                                                            小問・正解・配点だけ高速生成
                                                        </>
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => handleGenerateOnlyExplanations(num, true)}
                                                    disabled={generatingExplanationsOnly[num] || generating}
                                                    className="w-full mt-3 bg-gradient-to-r from-indigo-600 to-navy-blue hover:from-indigo-700 hover:to-navy-light text-white font-black py-4 px-6 rounded-xl shadow-lg shadow-indigo-200 transition-all text-sm flex items-center justify-center gap-3 disabled:opacity-50"
                                                >
                                                    {generatingExplanationsOnly[num] ? (
                                                        <>
                                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                            <span>（大問 {num}）全解説を生成中...</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span className="text-xl">💎</span>
                                                            「大問の全解説」を一括生成する（小問＋詳細）
                                                        </>
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => handleGenerateOnlyExplanations(num, false)}
                                                    disabled={generatingExplanationsOnly[num] || generating}
                                                    className="w-full mt-2 bg-white text-gray-500 hover:bg-gray-50 border border-gray-200 font-bold py-3 px-6 rounded-xl transition-all text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                                                >
                                                    {generatingExplanationsOnly[num] ? (
                                                        <span>生成中...</span>
                                                    ) : (
                                                        <>
                                                            <span className="text-sm">✍️</span>
                                                            小問解説のみ生成（既存の構造を維持）
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="pt-10 flex flex-col items-center border-t border-indigo-50 mt-8">
                            <div className="bg-gradient-to-br from-indigo-50/50 to-white p-8 rounded-3xl border border-indigo-100 max-w-2xl w-full text-center space-y-6 shadow-sm">
                                <h4 className="text-lg font-black text-navy-blue flex items-center justify-center gap-3">
                                    <span className="text-2xl">✨</span>全大問一括処理
                                </h4>
                                <p className="text-xs text-gray-500 font-bold leading-relaxed max-w-md mx-auto">
                                    上記で設定した各大問ファイルと目標配点をもとに、すべての大問データを順番にAI生成します。<br/>
                                    <span className="text-red-400 font-black mt-2 block">※すでに生成済みのデータがある場合は上書きされます。</span>
                                </p>

                                <div className="flex justify-center mb-6">
                                    <label className="flex items-center gap-3 bg-white/80 backdrop-blur px-6 py-3 rounded-2xl border border-indigo-100 cursor-pointer hover:bg-white transition-all shadow-sm">
                                        <input 
                                            type="checkbox" 
                                            checked={bulkIncludeVocab}
                                            onChange={(e) => setBulkIncludeVocab(e.target.checked)}
                                            className="w-5 h-5 rounded-lg border-2 border-indigo-200 text-indigo-600 focus:ring-indigo-500 transition-all"
                                        />
                                        <span className="text-xs font-black text-navy-blue">難単語（抽出）も同時に行う</span>
                                    </label>
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                    <button
                                        onClick={() => handleBulkGenerateSections(true, true)}
                                        disabled={isBulkGeneratingSections || generating || Object.values(generatingSectionData).some(v => v)}
                                        className="bg-gradient-to-r from-indigo-600 to-navy-blue hover:from-indigo-700 hover:to-navy-light text-white font-black py-4 px-6 rounded-2xl shadow-xl shadow-indigo-200 transition-all text-sm disabled:opacity-50 flex items-center justify-center gap-3"
                                    >
                                        {isBulkGeneratingSections ? (
                                            <>
                                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                <span>一括生成中...</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-xl">🚀</span>
                                                大問構成＋小問解説＋詳細解説を全自動生成
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => handleBulkGenerateSections(false, true)}
                                        disabled={isBulkGeneratingSections || generating || Object.values(generatingSectionData).some(v => v)}
                                        className="bg-white text-indigo-600 hover:bg-indigo-50 border-2 border-indigo-100 font-black py-4 px-6 rounded-2xl shadow-sm transition-all text-sm disabled:opacity-50 flex items-center justify-center gap-3"
                                    >
                                        <span className="text-lg">✍️</span>
                                        小問・正解・配点・小問解説だけ一括生成
                                    </button>
                                    <button
                                        onClick={() => handleBulkGenerateSections(false, false)}
                                        disabled={isBulkGeneratingSections || generating || Object.values(generatingSectionData).some(v => v)}
                                        className="bg-white text-gray-700 hover:bg-gray-50 border-2 border-gray-200 font-black py-4 px-6 rounded-2xl shadow-sm transition-all text-sm disabled:opacity-50 flex items-center justify-center gap-3"
                                    >
                                        <span className="text-lg">🏗️</span>
                                        小問・正解・配点だけ一括生成
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Question Editor Section */}
                <div className="admin-editor-card bg-white rounded-[2.5rem] shadow-2xl shadow-indigo-100/50 p-10 border border-gray-100" id="editor-main">
                    <div className="admin-mobile-stack flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
                        <h2 className="text-2xl font-black text-navy-blue flex items-center gap-3">
                            <span className="bg-navy-blue text-white w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-lg shadow-navy-blue/20">C</span>
                            設問内容・配点の編集
                        </h2>
                        <div className="admin-mobile-actions flex flex-wrap items-center gap-2 bg-gray-50 p-1.5 rounded-2xl border border-gray-100">
                            <div className="px-4 py-2">
                                <span className="text-[10px] font-black text-gray-400 uppercase block leading-none mb-1">合計配点</span>
                                <span className={`text-sm font-black ${totalAllocatedPoints !== (parseInt(examData?.max_score) || 100) ? 'text-red-500' : 'text-navy-blue'}`}>
                                    {totalAllocatedPoints} / {examData?.max_score || 100} 点
                                </span>
                            </div>
                            <button
                                onClick={handleRegeneratePoints}
                disabled={regeneratingPoints || bulkGenerating || bulkGeneratingSectionAnalyses}
                                className="bg-navy-blue text-white hover:bg-navy-light font-black py-3 px-4 rounded-xl shadow-lg transition-all text-xs disabled:opacity-50"
                            >
                                {regeneratingPoints ? '再計算中...' : '🤖 配点自動調整'}
                            </button>
                            <button
                                onClick={handleBulkGenerateExplanations}
                                disabled={bulkGenerating || bulkGeneratingSectionAnalyses || regeneratingPoints}
                                className="bg-indigo-600 text-white hover:bg-indigo-700 font-black py-3 px-4 rounded-xl shadow-lg transition-all text-xs disabled:opacity-50 flex items-center justify-center gap-2"
                                style={{ minWidth: '190px' }}
                            >
                                {bulkGenerating ? (
                                    <>
                                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                        <span>生成中 ({bulkProgress.current}/{bulkProgress.total})</span>
                                    </>
                                ) : (
                                    '空の小問解説を一括生成'
                                )}
                            </button>
                            <button
                                onClick={handleBulkGenerateSectionAnalyses}
                                disabled={bulkGeneratingSectionAnalyses || regeneratingPoints}
                                className="bg-purple-600 text-white hover:bg-purple-700 font-black py-3 px-4 rounded-xl shadow-lg transition-all text-xs disabled:opacity-50 flex items-center justify-center gap-2"
                                style={{ minWidth: '160px' }}
                            >
                                {bulkGeneratingSectionAnalyses ? (
                                    <>
                                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                        <span>詳細解説生成中 ({bulkSectionAnalysisProgress.current}/{bulkSectionAnalysisProgress.total})</span>
                                    </>
                                ) : (
                                    '📄 全詳細解説を一括作成'
                                )}
                            </button>
                        </div>
                    </div>
                    {activeSectionGenerationEntries.length > 0 && (
                        <div className="mb-6 rounded-2xl border border-indigo-100 bg-indigo-50 px-5 py-4 shadow-sm">
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                                <span className="text-xs font-black text-indigo-900">AI生成中</span>
                                {activeSectionGenerationEntries.map(({ sectionNum, label }) => (
                                    <span
                                        key={sectionNum}
                                        className="rounded-full bg-white px-3 py-1.5 text-[10px] font-black text-indigo-700 border border-indigo-100 shadow-sm"
                                    >
                                        大問{sectionNum}: {label}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="space-y-12">
                        {examData?.structure?.map((section, sIdx) => {
                            const missingExplanationCount = (section.questions || []).filter(isQuestionExplanationMissing).length;
                            const activeGenerationPhase = sectionGenerationPhases[sIdx + 1];
                            const activeGenerationLabel = GENERATION_PHASE_LABELS[activeGenerationPhase] || '';
                            return (
                            <div key={sIdx} className="admin-section-card bg-gray-50/30 rounded-[2rem] border border-gray-100 p-8 hover:bg-gray-50/50 transition-all">
                                <div className="admin-mobile-stack flex items-center justify-between mb-8">
                                    <div className="flex flex-1 items-center gap-5 min-w-0">
                                        <div className="bg-navy-blue text-white w-12 h-12 rounded-2xl flex items-center justify-center font-black shadow-xl shadow-navy-blue/10 text-lg">
                                            {section.id}
                                        </div>
                                        <input
                                            type="text"
                                            value={section.label}
                                            onChange={e => handleStructureChange(sIdx, null, 'label', e.target.value)}
                                            className="flex-1 bg-transparent text-xl font-black text-navy-blue border-b border-transparent focus:border-navy-blue/10 outline-none pb-1 transition-all"
                                            placeholder="大問ラベル"
                                        />
                                        {missingExplanationCount > 0 && (
                                            <span className="shrink-0 bg-amber-100 text-amber-700 border border-amber-200 text-[10px] font-black px-3 py-1.5 rounded-full">
                                                小問解説 未生成 {missingExplanationCount}件
                                            </span>
                                        )}
                                        {activeGenerationLabel && (
                                            <span className="shrink-0 bg-indigo-600 text-white text-[10px] font-black px-3 py-1.5 rounded-full inline-flex items-center gap-2 shadow-sm">
                                                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                                {activeGenerationLabel}
                                            </span>
                                        )}
                                    </div>
                                    <button 
                                        onClick={() => handleDeleteSection(sIdx)} 
                                        className="text-[10px] font-black text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100/80 border border-red-200/50 px-3 py-1.5 rounded-xl shadow-sm transition-all"
                                    >
                                        🗑️ 大問を削除
                                    </button>
                                </div>

                                <div className="admin-question-table-shell bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-6">
                                    <table className="admin-question-table w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-gray-50/50 border-b border-gray-50">
                                                <th className="px-6 py-4 text-[9px] font-black text-gray-400 uppercase tracking-widest">ID</th>
                                                <th className="px-6 py-4 text-[9px] font-black text-gray-400 uppercase tracking-widest">ラベル</th>
                                                 <th className="px-6 py-4 text-[9px] font-black text-gray-400 uppercase tracking-widest">形式</th>
                                                 <th className="px-6 py-4 text-[9px] font-black text-gray-400 uppercase tracking-widest">完答</th>
                                                 <th className="px-6 py-4 text-[9px] font-black text-gray-400 uppercase tracking-widest">配点</th>
                                                 <th className="px-6 py-4 text-[9px] font-black text-gray-400 uppercase tracking-widest">正解</th>
                                                 <th className="px-6 py-4 text-[9px] font-black text-gray-400 uppercase tracking-widest">別解</th>
                                                 <th className="px-6 py-4 text-[9px] font-black text-gray-400 uppercase tracking-widest">解説・採点基準</th>
                                                <th className="px-6 py-4 w-10"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {section.questions.map((q, qIdx) => {
                                                const essayNeedsCriteria = q.type === 'essay';
                                                const explanationMissing = isQuestionExplanationMissing(q);
                                                const essayCriteriaDone = Boolean(
                                                    (q.gradingInstruction && String(q.gradingInstruction).trim()) ||
                                                    (q.gradingCriteria && String(q.gradingCriteria).trim()) ||
                                                    (Array.isArray(q.scoringElements) && q.scoringElements.some(item =>
                                                        (item?.description && String(item.description).trim()) ||
                                                        Number.isFinite(Number(item?.points))
                                                    ))
                                                );
                                                const rowClassName = explanationMissing
                                                    ? 'bg-amber-50/70 hover:bg-amber-50 transition-colors ring-1 ring-inset ring-amber-200'
                                                    : essayNeedsCriteria
                                                    ? essayCriteriaDone
                                                        ? 'bg-emerald-50/50 hover:bg-emerald-50 transition-colors'
                                                        : 'bg-red-50/70 hover:bg-red-50 transition-colors ring-1 ring-inset ring-red-100'
                                                    : 'hover:bg-indigo-50/20 transition-colors';
                                                return (
                                                <tr key={qIdx} className={rowClassName}>
                                                    <td className="px-6 py-4"><input type="text" value={q.id} onChange={e => handleStructureChange(sIdx, qIdx, 'id', e.target.value)} className="w-12 p-3 rounded-xl border border-gray-100 text-xs font-black bg-gray-50/30" /></td>
                                                    <td className="px-6 py-4"><input type="text" value={q.label} onChange={e => handleStructureChange(sIdx, qIdx, 'label', e.target.value)} className="w-16 p-3 rounded-xl border border-gray-100 text-xs font-bold" /></td>
                                                                                                        <td className="px-6 py-4">
                                                        <div className="flex flex-col gap-2">
                                                            <div className="flex items-center gap-1">
                                                                <select value={q.type || 'selection'} onChange={e => handleStructureChange(sIdx, qIdx, 'type', e.target.value)} className={`w-[120px] p-2 rounded-xl border text-[10px] font-bold bg-white outline-none focus:border-navy-blue/30 ${essayNeedsCriteria && !essayCriteriaDone ? 'border-red-200 text-red-700' : 'border-gray-100'}`}>
                                                                    <option value="selection">選択(一つ選択)</option>
                                                                    <option value="selection_multi">選択(複数選択)</option>
                                                                    <option value="ordering">並び替え</option>
                                                                    <option value="descriptive">記述</option>
                                                                    <option value="essay">自由記述</option>
                                                                </select>
                                                                {q.answerIssue === 'all_choices_correct' && (
                                                                    <span className="bg-emerald-100 text-emerald-700 text-[8px] px-1.5 py-0.5 rounded-full font-black whitespace-nowrap">
                                                                        全選択肢正解
                                                                    </span>
                                                                )}
                                                                {q.answerIssue === 'single_choice_multiple_answers' && (
                                                                    <span className="bg-amber-100 text-amber-700 text-[8px] px-1.5 py-0.5 rounded-full font-black whitespace-nowrap">
                                                                        単一選択・複数正解
                                                                    </span>
                                                                )}
                                                                {q.type === 'ordering' && (
                                                                    <span className="bg-sky-100 text-sky-700 text-[8px] px-1.5 py-0.5 rounded-full font-black whitespace-nowrap">
                                                                        順序一致
                                                                    </span>
                                                                )}
                                                                {q.type !== 'ordering' && q.answerIssue !== 'single_choice_multiple_answers' && (q.type === 'selection_multi' || (q.correctAnswer && String(q.correctAnswer).includes(','))) && (
                                                                    <span className="bg-purple-100 text-purple-700 text-[8px] px-1.5 py-0.5 rounded-full font-black animate-pulse whitespace-nowrap">
                                                                        複数判定中
                                                                    </span>
                                                                )}
                                                                {essayNeedsCriteria && !essayCriteriaDone && (
                                                                    <span className="bg-red-100 text-red-700 text-[8px] px-1.5 py-0.5 rounded-full font-black whitespace-nowrap">
                                                                        採点基準が必要
                                                                    </span>
                                                                )}
                                                                {essayNeedsCriteria && essayCriteriaDone && (
                                                                    <span className="bg-emerald-100 text-emerald-700 text-[8px] px-1.5 py-0.5 rounded-full font-black whitespace-nowrap">
                                                                        採点基準作成済み
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {['selection', 'selection_multi', 'ordering'].includes(q.type) && (
                                                                <input 
                                                                    type="text" 
                                                                    value={Array.isArray(q.options) ? q.options.join(',') : (q.options || '')} 
                                                                    onChange={e => handleStructureChange(sIdx, qIdx, 'options', e.target.value)} 
                                                                    placeholder={q.type === 'ordering' ? "並び替え候補(a,b,c)" : "選択肢(a,b,c)"}
                                                                    className="w-full min-w-[110px] p-2 rounded-lg border border-gray-100 text-[10px] bg-white transition-all shadow-sm" 
                                                                    title="カンマ区切りで入力（例: a,b,c,d）"
                                                                />
                                                            )}
                                                            {['selection', 'selection_multi', 'descriptive'].includes(q.type) && (
                                                                <select
                                                                    value={q.answerIssue || ''}
                                                                    onChange={e => handleStructureChange(sIdx, qIdx, 'answerIssue', e.target.value)}
                                                                    className={`w-full min-w-[120px] p-2 rounded-lg border text-[10px] font-bold outline-none transition-all ${
                                                                        q.answerIssue
                                                                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                                                                            : 'border-gray-100 bg-white text-gray-400'
                                                                    }`}
                                                                    title="問題不備がある場合だけ設定してください"
                                                                >
                                                                    <option value="">問題不備なし</option>
                                                                    <option value="all_choices_correct">選択肢を問わず正解</option>
                                                                    <option value="single_choice_multiple_answers">一つしか選択できないが答えが複数存在</option>
                                                                    <option value="kanji_self_grade">漢字問題: 受験者が正誤を自己申告</option>
                                                                </select>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex flex-col gap-1 items-center">
                                                            <select 
                                                                value={q.completeGroupId || ""} 
                                                                onChange={e => handleStructureChange(sIdx, qIdx, 'completeGroupId', e.target.value)} 
                                                                className={`w-[80px] p-2 rounded-xl border text-[10px] font-bold transition-all ${q.completeGroupId ? 'border-orange-200 bg-orange-50 text-orange-600' : 'border-gray-100 bg-indigo-50/30 text-gray-400'}`}
                                                            >
                                                                <option value="">なし</option>
                                                                {[...Array(10)].map((_, i) => (
                                                                    <option key={i+1} value={String(i+1)}>グループ{i+1}</option>
                                                                ))}
                                                            </select>
                                                            {q.completeGroupId && (
                                                                <>
                                                                    <select
                                                                        value={q.completeGroupOrderMode || 'ordered'}
                                                                        onChange={e => handleStructureChange(sIdx, qIdx, 'completeGroupOrderMode', e.target.value)}
                                                                        className="w-[96px] p-1.5 rounded-lg border border-orange-100 bg-white text-[9px] font-black text-orange-600 outline-none"
                                                                        title="同じ完答グループ内の解答順を採点で固定するか、順不同にするかを設定します"
                                                                    >
                                                                        <option value="ordered">順序固定</option>
                                                                        <option value="unordered">順不同</option>
                                                                    </select>
                                                                    <span className="text-[8px] font-black text-orange-400 uppercase">
                                                                        {q.completeGroupOrderMode === 'unordered' ? '順不同完答' : '完答対象'}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4"><input type="text" inputMode="numeric" pattern="[0-9]*" value={q.points} onChange={e => handleStructureChange(sIdx, qIdx, 'points', parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0)} className="w-14 p-3 rounded-xl border border-gray-100 text-xs font-black text-indigo-600 bg-indigo-50/30" /></td>
                                                    <td className="px-6 py-4">
                                                        <input type="text" value={q.correctAnswer} onChange={e => handleStructureChange(sIdx, qIdx, 'correctAnswer', e.target.value)} className="w-full min-w-[120px] p-3 rounded-xl border border-gray-100 text-xs font-bold" />
                                                        {q.type === 'essay' && (
                                                            <div className="mt-2 flex flex-col gap-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleGenerateEssayModelAnswer(sIdx, qIdx, q, 'with_original')}
                                                                    disabled={essayModelAnswerLoading[`${sIdx}_${qIdx}`]}
                                                                    className="text-[9px] font-black px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors flex items-center justify-center gap-1 shadow-sm disabled:opacity-50 cursor-pointer"
                                                                    title="独自採点基準＋元解答＋本文・問題文から、著作権に配慮した新模範解答を生成"
                                                                >
                                                                    {essayModelAnswerLoading[`${sIdx}_${qIdx}`] === 'with_original' ? '🔄 生成中...' : '🤖 模範解答A (基準+元解答+本文)'}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleGenerateEssayModelAnswer(sIdx, qIdx, q, 'rubric_only')}
                                                                    disabled={essayModelAnswerLoading[`${sIdx}_${qIdx}`]}
                                                                    className="text-[9px] font-black px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors flex items-center justify-center gap-1 shadow-sm disabled:opacity-50 cursor-pointer"
                                                                    title="元解答を見ず、独自採点基準＋本文・問題文のみからゼロベースで新模範解答を生成"
                                                                >
                                                                    {essayModelAnswerLoading[`${sIdx}_${qIdx}`] === 'rubric_only' ? '🔄 生成中...' : '🌱 模範解答B (基準+本文のみ)'}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {q.type === 'descriptive' ? (() => {
                                                            const draftKey = `${sIdx}-${qIdx}`;
                                                            return (
                                                                <input
                                                                    type="text"
                                                                    placeholder="別解1, 別解2"
                                                                    value={alternativeAnswerDrafts[draftKey] ?? (q.alternativeAnswers || []).join(', ')}
                                                                    onChange={e => {
                                                                        const raw = e.target.value;
                                                                        setAlternativeAnswerDrafts(prev => ({ ...prev, [draftKey]: raw }));
                                                                        const alts = raw.split(',').map(s => s.trim()).filter(s => s !== "");
                                                                        handleStructureChange(sIdx, qIdx, 'alternativeAnswers', alts);
                                                                    }}
                                                                    onBlur={() => {
                                                                        setAlternativeAnswerDrafts(prev => {
                                                                            const next = { ...prev };
                                                                            delete next[draftKey];
                                                                            return next;
                                                                        });
                                                                    }}
                                                                    className="w-full min-w-[150px] p-3 rounded-xl border border-gray-100 text-xs bg-indigo-50/20 focus:bg-white focus:border-indigo-300 outline-none transition-all"
                                                                />
                                                            );
                                                        })() : (
                                                            <span className="text-gray-300 text-[10px] italic">記述のみ有効</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 space-y-4">
                                                        <div className="space-y-2">
                                                            <div className="flex justify-between">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest">解説</span>
                                                                    {explanationMissing ? (
                                                                        <span className="bg-amber-100 text-amber-700 border border-amber-200 text-[8px] px-2 py-0.5 rounded-full font-black whitespace-nowrap">
                                                                            未生成
                                                                        </span>
                                                                    ) : q.needsReview ? (
                                                                        <span
                                                                            className="bg-orange-100 text-orange-800 border border-orange-200 text-[8px] px-2 py-0.5 rounded-full font-black whitespace-nowrap cursor-pointer hover:bg-orange-200 transition-colors"
                                                                            title="本文根拠の自動照合が不十分です（AIの下書き解説）。内容を確認してクリックで確認済みにできます。"
                                                                            onClick={() => handleStructureChange(sIdx, qIdx, 'needsReview', false)}
                                                                        >
                                                                            ⚠️ 根拠要確認 (下書き)
                                                                        </span>
                                                                    ) : null}
                                                                </div>
                                                                <button onClick={() => handleRegenerateExplanation(sIdx, qIdx, q)} className="text-[9px] font-black text-indigo-400 hover:text-indigo-600 transition-colors">AIで再生成</button>
                                                            </div>
                                                            <textarea
                                                                value={q.explanation || ''}
                                                                onChange={e => {
                                                                    handleStructureChange(sIdx, qIdx, 'explanation', e.target.value);
                                                                    if (q.needsReview) handleStructureChange(sIdx, qIdx, 'needsReview', false);
                                                                }}
                                                                placeholder={explanationMissing ? '小問解説が未生成です。上部の「空の小問解説を一括生成」または「AIで再生成」を実行してください。' : ''}
                                                                className={`w-full p-4 rounded-xl border text-[11px] leading-relaxed min-h-[60px] focus:bg-gray-50/30 outline-none transition-all ${explanationMissing ? 'border-amber-300 bg-amber-50/80 text-amber-900 placeholder:text-amber-500' : q.needsReview ? 'border-orange-200 bg-orange-50/30' : 'border-gray-100'}`}
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest">採点基準・指示</span>
                                                            <textarea value={q.gradingInstruction || ''} onChange={e => handleStructureChange(sIdx, qIdx, 'gradingInstruction', e.target.value)} placeholder={essayNeedsCriteria ? "自由記述の採点基準を入力してください" : "例: 部分点5点とする基準..."} className={`w-full p-4 rounded-xl border text-[10px] leading-relaxed min-h-[40px] outline-none ${essayNeedsCriteria && !essayCriteriaDone ? 'border-red-200 bg-red-50/80 focus:bg-white focus:border-red-300' : 'border-navy-blue/5 bg-navy-blue/5'}`} />
                                                        </div>
                                                        {q.type === 'essay' && (() => {
                                                            const elements = normalizeScoringElements(ensureEssayCharacterCountElement(q).scoringElements);
                                                            const totalPoints = elements
                                                                .filter(item => item.type !== 'force_zero')
                                                                .reduce((sum, item) => {
                                                                    const points = Number(item.points) || 0;
                                                                    return sum + (item.type === 'deduction' ? -Math.abs(points) : points);
                                                                }, 0);
                                                            const questionPointLimit = Number(q.points) || 0;
                                                            const isExactMatch = totalPoints === questionPointLimit;
                                                            const isCapScoring = questionPointLimit > 0 && totalPoints > questionPointLimit;
                                                            const statusBadgeClass = isExactMatch
                                                                ? 'bg-green-100 text-green-700'
                                                                : isCapScoring
                                                                    ? 'bg-blue-100 text-blue-700'
                                                                    : 'bg-orange-100 text-orange-700';
                                                            const statusLabel = isExactMatch ? '一致' : isCapScoring ? '上限採点' : '不足';
                                                            return (
                                                                <div className="mt-3 p-3 bg-indigo-50/30 border border-indigo-100/50 rounded-xl flex flex-wrap items-center justify-between gap-3">
                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        <span className="text-[10px] font-black text-indigo-700 uppercase tracking-widest">
                                                                            要素採点設定:
                                                                        </span>
                                                                        {elements.length === 0 ? (
                                                                            <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-red-100 text-red-700 animate-pulse">
                                                                                ⚠️ 未設定 (要設定)
                                                                            </span>
                                                                        ) : (
                                                                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${statusBadgeClass}`}>
                                                                                {statusLabel}: {elements.length}個の要素設定中 ({totalPoints} / {questionPointLimit}点)
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.preventDefault();
                                                                            e.stopPropagation();
                                                                            console.log("[TriggerButton] clicked for sIdx:", sIdx, "qIdx:", qIdx, "q:", q);
                                                                            setActiveScoringEditor({ sectionIdx: sIdx, qIdx, question: q });
                                                                        }}
                                                                        className="text-[9px] font-black text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer animate-pulse"
                                                                    >
                                                                        ✨ 採点要素・AIアシスタントを開く
                                                                    </button>
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex flex-col items-center gap-2">
                                                            <div className="flex gap-1 mb-1">
                                                                <button onClick={() => handleMoveQuestion(sIdx, qIdx, 'up')} disabled={qIdx === 0} className="text-gray-300 hover:text-indigo-500 disabled:opacity-30 disabled:hover:text-gray-300 transition-colors" title="上に移動">↑</button>
                                                                <button onClick={() => handleMoveQuestion(sIdx, qIdx, 'down')} disabled={qIdx === section.questions.length - 1} className="text-gray-300 hover:text-indigo-500 disabled:opacity-30 disabled:hover:text-gray-300 transition-colors" title="下に移動">↓</button>
                                                            </div>
                                                            <button onClick={() => handleAddQuestion(sIdx, qIdx)} className="text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 w-6 h-6 rounded-full flex items-center justify-center transition-all text-sm font-black bg-white border border-gray-100 shadow-sm" title="この上に小問を追加">＋</button>
                                                            <button 
                                                                onClick={() => handleDeleteQuestion(sIdx, qIdx)} 
                                                                className="text-red-500 hover:text-white bg-red-50 hover:bg-red-500 w-7 h-7 rounded-full flex items-center justify-center transition-all border border-red-200/50 shadow-sm text-base font-bold" 
                                                                title="小問を削除"
                                                            >
                                                                ×
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex flex-col lg:flex-row gap-8 items-start">
                                    <div className="flex-1 w-full">
                                        <div className="flex justify-between items-center mb-3">
                                            <div className="flex items-center gap-4">
                                                <label className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em]">大問全体の分析 (AI用)</label>
                                                {subjectEn === 'english' && (
                                                    <select
                                                        value={section.questionType || 'default'}
                                                        onChange={e => handleStructureChange(sIdx, null, 'questionType', e.target.value)}
                                                        className="p-1 px-2 rounded-md border border-gray-200 text-[10px] font-black text-navy-blue outline-none cursor-pointer"
                                                    >
                                                        <option value="default">自動 (長文問題)</option>
                                                        <option value="grammar">文法・語彙問題</option>
                                                        <option value="writing">英作文問題</option>
                                                        <option value="conversation">会話文問題</option>
                                                    </select>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {subjectEn === 'english' && (
                                                    <button onClick={() => handleExtractVocabulary(sIdx, section)} disabled={generatingVocabulary[sIdx]} className="text-[10px] font-black text-indigo-500 hover:text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-all flex items-center gap-1.5">
                                                        {generatingVocabulary[sIdx] ? '抽出中...' : '📚 英検準1級単語を抽出'}
                                                    </button>
                                                )}

                                                <button onClick={() => handleRegenerateSectionAnalysis(sIdx, section)} disabled={generatingSectionAnalysis[sIdx]} className="text-[10px] font-black text-purple-500 hover:text-purple-700 bg-purple-50 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-all flex items-center gap-1.5">
                                                    {generatingSectionAnalysis[sIdx] ? '再生成中...' : '✨ AIで解説生成'}
                                                </button>
                                            </div>
                                        </div>
                                        <textarea value={section.sectionAnalysis || ''} onChange={e => handleStructureChange(sIdx, null, 'sectionAnalysis', e.target.value)} className="w-full p-5 rounded-2xl border border-gray-100 text-xs bg-white focus:bg-gray-50/30 outline-none transition-all min-h-[100px]" placeholder="この大問全体の読解ポイント..." />
                                        
                                        {subjectEn === 'english' && (
                                            <div className="mt-4 p-4 bg-indigo-50/30 border border-indigo-100 rounded-xl">
                                                <div className="flex justify-between items-center mb-2">
                                                    <h4 className="text-[10px] font-black text-indigo-800 uppercase">この大問で出題された難易英単語 ({section.vocabulary?.length || 0}語)</h4>
                                                    <div className="flex gap-2">
                                                        <button onClick={() => handleAddVocab(sIdx)} className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold">＋ 単語を追加</button>
                                                        <button onClick={() => handleStructureChange(sIdx, null, 'vocabulary', [])} className="text-[10px] text-red-400 hover:text-red-600 font-bold">クリア</button>
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {section.vocabulary && section.vocabulary.map((vocab, vIdx) => (
                                                        <div key={vIdx} className="inline-flex items-center gap-1 p-1 bg-white border border-indigo-100 rounded-md shadow-sm">
                                                            <input 
                                                                type="text" 
                                                                value={vocab.word} 
                                                                onChange={(e) => handleUpdateVocab(sIdx, vIdx, 'word', e.target.value)}
                                                                className="w-20 bg-transparent border-none outline-none text-[10px] font-black text-indigo-900 px-1"
                                                                placeholder="Word"
                                                            />
                                                            <span className="text-gray-300">|</span>
                                                            <input 
                                                                type="text" 
                                                                value={vocab.meaning} 
                                                                onChange={(e) => handleUpdateVocab(sIdx, vIdx, 'meaning', e.target.value)}
                                                                className="w-32 bg-transparent border-none outline-none text-[10px] text-gray-500 px-1"
                                                                placeholder="Meaning"
                                                            />
                                                            <button 
                                                                onClick={() => handleRemoveVocab(sIdx, vIdx)}
                                                                className="text-gray-300 hover:text-red-500 transition-colors ml-1 px-1"
                                                            >
                                                                ×
                                                            </button>
                                                        </div>
                                                    ))}
                                                    {(!section.vocabulary || section.vocabulary.length === 0) && (
                                                        <p className="text-[10px] text-gray-400 italic">単語が抽出されていません。</p>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <button onClick={() => handleAddQuestion(sIdx)} className="w-full lg:w-auto px-8 py-4 bg-white hover:bg-navy-blue hover:text-white text-navy-blue font-black rounded-2xl border-2 border-navy-blue/10 transition-all text-xs whitespace-nowrap">＋ 小問を追加</button>
                                </div>
                            </div>
                            );
                        })}
                    </div>

                    <div className="mt-12">
                        <button onClick={handleAddSection} className="w-full py-8 bg-gray-50/50 hover:bg-gray-50 text-gray-400 hover:text-navy-blue font-black rounded-[2rem] border-2 border-dashed border-gray-200 hover:border-navy-blue/30 transition-all text-sm tracking-[0.3em] uppercase">
                            ＋ 大問を追加
                        </button>
                    </div>
                </div>

                {/* Full Analysis Section */}
                <div className="admin-editor-card bg-white rounded-[2.5rem] shadow-2xl shadow-indigo-100/50 p-10 border border-gray-100">
                    <div className="flex justify-between items-center mb-10">
                        <h2 className="text-2xl font-black text-navy-blue flex items-center gap-3">
                            <span className="bg-navy-blue text-white w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-lg shadow-navy-blue/20">D</span>
                            試験全体の講評（マークダウン）
                        </h2>
                        <button
                            onClick={handleRegenerateDetailedAnalysis}
                            disabled={generatingDetailed}
                            className="bg-navy-blue hover:bg-navy-light text-white font-black py-4 px-10 rounded-2xl shadow-xl shadow-navy-blue/20 transition-all active:scale-[0.98] disabled:opacity-50 text-xs flex items-center gap-2"
                        >
                            {generatingDetailed ? '生成中...' : '🤖 全体講評をAI生成'}
                        </button>
                    </div>
                    <div className="bg-navy-blue/[0.02] rounded-[2rem] p-8 border border-navy-blue/5">
                        <textarea
                            value={examData?.detailed_analysis}
                            onChange={e => setExamData({ ...examData, detailed_analysis: e.target.value })}
                            className="w-full bg-transparent font-mono text-[13px] leading-relaxed text-navy-blue/80 min-h-[800px] outline-none resize-y"
                            placeholder="# 試験全体の講評を入力..."
                        />
                    </div>
                </div>

                </div>
            ) : (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <BlockDesigner 
                        layout={customLayout} 
                        setLayout={setCustomLayout} 
                        examData={examData}
                        onSave={() => handleSave(true)}
                    />
                </div>
            )}
            {renderScoringModal()}
            {renderEssayModelAnswerPreviewModal()}
        </div>
    );
}

const BlockDesigner = ({ layout, setLayout, examData, onSave }) => {
    const [adLocalPreviews, setAdLocalPreviews] = useState({});
    const [adUploadStates, setAdUploadStates] = useState({});

    const importFromMaster = () => {
        if (!examData) return;
        const blocks = [];
        
        // Add Hero
        blocks.push({ id: 'hero-' + Date.now(), type: 'hero', content: {} });
        

        
        // Add sections
        examData.structure?.forEach((sec, idx) => {
            blocks.push({ id: `sec-title-${idx}-${Date.now()}`, type: 'section_analysis', content: { sectionId: sec.id, label: sec.label, text: sec.sectionAnalysis || '' } });
            blocks.push({ id: `q-list-${idx}-${Date.now()}`, type: 'question_list', content: { sectionId: sec.id } });
        });
        
        setLayout(blocks);
    };

    const addBlock = (type) => {
        const newBlock = { 
            id: type + '-' + Date.now(), 
            type, 
            content: type === 'text' ? '新しいテキストを入力...' : 
                     type === 'image' ? { url: '', alt: '' } :
                     type === 'ad' ? { imageUrl: '', targetUrl: '', widthPercent: 100 } : {} 
        };
        setLayout([...layout, newBlock]);
    };

    const updateBlock = (index, newContent) => {
        const newLayout = [...layout];
        newLayout[index] = { ...newLayout[index], content: newContent };
        setLayout(newLayout);
    };

    const updateAdBlockContent = (index, updater) => {
        setLayout(prevLayout => {
            const newLayout = [...prevLayout];
            const currentBlock = newLayout[index];
            if (!currentBlock) return prevLayout;
            const currentContent = normalizeAdBlockContent(currentBlock.content);
            const nextContent = typeof updater === 'function' ? updater(currentContent) : updater;
            newLayout[index] = { ...currentBlock, content: { ...currentContent, ...nextContent } };
            return newLayout;
        });
    };

    const removeBlock = (index) => {
        if (!confirm('このブロックを削除してもよろしいですか？')) return;
        setLayout(layout.filter((_, i) => i !== index));
    };

    const moveBlock = (index, direction) => {
        const newLayout = [...layout];
        const target = index + direction;
        if (target < 0 || target >= layout.length) return;
        [newLayout[index], newLayout[target]] = [newLayout[target], newLayout[index]];
        setLayout(newLayout);
    };

    const handleAdImageUpload = async (e, index, blockKey, currentContent) => {
        const file = e.target.files?.[0];
        if (!file) return;
        let previewUrl = '';
        try {
            previewUrl = await readFileAsDataUrl(file);
        } catch (error) {
            console.error('Ad image read failed:', error);
            alert(`画像ファイルの読み込みに失敗しました: ${error.message || '不明なエラー'}`);
            e.target.value = '';
            return;
        }

        const previousContent = normalizeAdBlockContent(currentContent);
        setAdLocalPreviews(prev => ({ ...prev, [blockKey]: previewUrl }));
        setAdUploadStates(prev => ({ ...prev, [blockKey]: { uploading: true, error: false } }));

        updateAdBlockContent(index, { ...previousContent, imageUrl: previewUrl });

        try {
            const publicUrl = await uploadBannerImage(file);
            setAdLocalPreviews(prev => ({ ...prev, [blockKey]: publicUrl }));
            setAdUploadStates(prev => ({ ...prev, [blockKey]: { uploading: false, error: false } }));
            updateAdBlockContent(index, { imageUrl: publicUrl });
        } catch (error) {
            console.error('Ad image upload failed:', error);
            setAdUploadStates(prev => ({ ...prev, [blockKey]: { uploading: false, error: true } }));
        } finally {
            e.target.value = '';
        }
    };

    const handleAdResizeStart = (e, index, currentContent) => {
        e.preventDefault();
        e.stopPropagation();
        const resizeBox = e.currentTarget.closest('[data-ad-resize-box]');
        const parent = resizeBox?.parentElement;
        if (!parent) return;

        const updateWidth = (clientX) => {
            const rect = parent.getBoundingClientRect();
            if (!rect.width) return;
            updateBlock(index, {
                ...normalizeAdBlockContent(currentContent),
                widthPercent: clampAdWidthPercent(((clientX - rect.left) / rect.width) * 100)
            });
        };

        const handlePointerMove = (moveEvent) => updateWidth(moveEvent.clientX);
        const handlePointerUp = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
    };

    return (
        <div className="space-y-8">
            <div className="admin-editor-card bg-white rounded-[2.5rem] p-10 shadow-2xl shadow-indigo-100/50 border border-gray-100">
                <div className="flex justify-between items-center mb-10">
                    <div>
                        <h2 className="text-2xl font-black text-navy-blue flex items-center gap-3">
                            <span className="text-3xl">🎨</span> ページデザイナー
                        </h2>
                        <p className="text-xs text-gray-400 font-bold mt-2 uppercase tracking-widest ml-1">実際の解説画面と同じ構成でブロックを配置・編集できます</p>
                    </div>
                    <div className="flex gap-3">
                        <button onClick={importFromMaster} className="px-6 py-3 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-2xl text-xs font-black transition-all border border-gray-200">
                            🔄 マスターから初期配置を生成
                        </button>
                        <button onClick={onSave} className="px-8 py-3 bg-navy-blue text-white rounded-2xl text-xs font-black shadow-xl shadow-navy-blue/20 hover:bg-navy-light transition-all flex items-center gap-2">
                            <span>💾</span> 保存する
                        </button>
                    </div>
                </div>

                {layout.length === 0 ? (
                    <div className="py-20 text-center border-4 border-dashed border-gray-100 rounded-[3rem] bg-gray-50/30">
                        <span className="text-4xl block mb-4">✨</span>
                        <p className="text-gray-400 font-black text-sm">レイアウトが空です。「マスターから初期配置を生成」を押すか、<br/>下のボタンからブロックを追加してください。</p>
                    </div>
                ) : (
                    <div className="space-y-6 max-w-4xl mx-auto">
                        {layout.map((block, idx) => {
                            const blockKey = block.id || `designer-${idx}-${block.type}`;
                            const adContent = block.type === 'ad' ? normalizeAdBlockContent(block.content) : null;
                            const adPreviewUrl = adContent ? (adLocalPreviews[blockKey] || adContent.imageUrl) : '';
                            const adUploadState = adUploadStates[blockKey] || {};
                            return (
                            <div key={block.id || idx} className="group relative bg-white border-2 border-transparent hover:border-indigo-200 rounded-3xl transition-colors shadow-sm hover:shadow-xl hover:shadow-indigo-100/50">
                                {/* Block Toolbar */}
                                <div className="absolute -left-12 top-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100 z-10">
                                    <button onClick={() => moveBlock(idx, -1)} className="p-2 bg-white shadow-lg rounded-xl text-gray-400 hover:text-navy-blue border border-gray-100 transition-colors">▲</button>
                                    <button onClick={() => moveBlock(idx, 1)} className="p-2 bg-white shadow-lg rounded-xl text-gray-400 hover:text-navy-blue border border-gray-100 transition-colors">▼</button>
                                    <button onClick={() => removeBlock(idx)} className="p-2 bg-white shadow-lg rounded-xl text-red-100 hover:bg-red-500 hover:text-white border border-gray-100 transition-colors">✕</button>
                                </div>

                                <div className="p-2">
                                    <div className="bg-gray-50/50 rounded-2xl p-6">
                                        <div className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                            <span className="bg-white w-5 h-5 rounded-md flex items-center justify-center shadow-sm text-xs">
                                                {block.type === 'text' ? 'T' : block.type === 'hero' ? '⭐' : block.type === 'section_analysis' ? '📄' : block.type === 'question_list' ? '📋' : block.type === 'image' ? '🖼️' : '📢'}
                                            </span>
                                            {block.type} Block
                                        </div>
                                        
                                        {block.type === 'text' && (
                                            <div 
                                                contentEditable 
                                                suppressContentEditableWarning
                                                onBlur={(e) => updateBlock(idx, e.target.innerText)}
                                                className="outline-none focus:ring-4 focus:ring-indigo-500/10 rounded-xl p-4 bg-white text-sm leading-relaxed whitespace-pre-wrap font-bold text-navy-blue border border-transparent focus:border-indigo-200 transition-all"
                                            >
                                                {block.content}
                                            </div>
                                        )}
                                        
                                        {block.type === 'hero' && (
                                            <div className="bg-gradient-to-r from-indigo-600 to-navy-blue h-24 rounded-2xl flex items-center justify-center text-white font-black text-xs gap-3 shadow-inner">
                                                <span className="text-2xl">🏆</span> 
                                                <div className="text-center">
                                                    <div className="opacity-60 text-[8px] uppercase tracking-tighter mb-1">Preview Component</div>
                                                    <div>スコア・合格判定ヘッダー</div>
                                                </div>
                                            </div>
                                        )}

                                        {block.type === 'section_analysis' && (
                                            <div className="space-y-4">
                                                <div className="flex items-center gap-3">
                                                    <input 
                                                        type="text"
                                                        value={block.content.label}
                                                        onChange={(e) => updateBlock(idx, { ...block.content, label: e.target.value })}
                                                        className="bg-white border border-gray-100 rounded-lg px-3 py-1 text-xs font-black text-navy-blue shadow-sm outline-none focus:border-indigo-500 w-32"
                                                    />
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">の解説</span>
                                                </div>
                                                <textarea 
                                                    value={block.content.text}
                                                    onChange={(e) => updateBlock(idx, { ...block.content, text: e.target.value })}
                                                    className="w-full text-xs p-5 bg-white border border-gray-100 rounded-2xl min-h-[120px] outline-none font-bold text-gray-600 shadow-sm focus:border-indigo-500 transition-all"
                                                    placeholder="解説の内容を入力してください..."
                                                />
                                            </div>
                                        )}

                                        {block.type === 'question_list' && (
                                            <div className="bg-navy-blue/10 border-2 border-navy-blue/5 text-navy-blue p-6 rounded-2xl text-center">
                                                <div className="text-[10px] font-black uppercase tracking-widest opacity-50 mb-2">設問リストを表示します</div>
                                                <div className="flex items-center justify-center gap-2">
                                                    <span className="text-xs font-black bg-white px-3 py-1 rounded-full shadow-sm">Section ID: {block.content.sectionId}</span>
                                                </div>
                                            </div>
                                        )}

                                        {block.type === 'image' && (
                                            <div className="space-y-4">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">画像URL</label>
                                                        <input 
                                                            type="text"
                                                            value={block.content.url}
                                                            onChange={(e) => updateBlock(idx, { ...block.content, url: e.target.value })}
                                                            className="w-full bg-white border border-gray-100 rounded-lg px-3 py-2 text-xs font-bold text-navy-blue outline-none focus:border-indigo-500"
                                                            placeholder="https://example.com/image.jpg"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">代替テキスト (alt)</label>
                                                        <input 
                                                            type="text"
                                                            value={block.content.alt}
                                                            onChange={(e) => updateBlock(idx, { ...block.content, alt: e.target.value })}
                                                            className="w-full bg-white border border-gray-100 rounded-lg px-3 py-2 text-xs font-bold text-navy-blue outline-none focus:border-indigo-500"
                                                            placeholder="画像の説明"
                                                        />
                                                    </div>
                                                </div>
                                                {block.content.url && (
                                                    <div className="mt-4 border-2 border-dashed border-gray-100 rounded-2xl overflow-hidden bg-white h-48 flex items-center justify-center">
                                                        <img src={block.content.url} alt={block.content.alt} className="max-w-full max-h-48 object-contain" />
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {MARKETING_CONFIG.enableAdBanners && block.type === 'ad' && (
                                            <div className="bg-gray-100/50 p-4 rounded-2xl border border-gray-200">
                                                <div className="grid grid-cols-2 gap-6">
                                                    <div>
                                                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">① 画像をアップロード</div>
                                                        <label className="flex min-h-[42px] w-full cursor-pointer select-none items-center justify-center rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs font-black text-navy-blue outline-none transition-colors hover:border-indigo-500 hover:bg-indigo-50">
                                                            画像を選択
                                                            <input
                                                                type="file"
                                                                accept="image/*"
                                                                onChange={(e) => handleAdImageUpload(e, idx, blockKey, adContent)}
                                                                className="sr-only"
                                                            />
                                                        </label>
                                                        {adUploadState.uploading && (
                                                            <p className="text-[9px] text-indigo-500 mt-2 font-black">アップロード中...</p>
                                                        )}
                                                        {adUploadState.error && (
                                                            <p className="text-[9px] text-red-500 mt-2 font-black">アップロード失敗。選択画像を一時表示中です。</p>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">② 「詳しく見る」の遷移先URL</div>
                                                        <input
                                                            type="url"
                                                            defaultValue={adContent.targetUrl || ''}
                                                            onBlur={(e) => updateAdBlockContent(idx, { targetUrl: e.target.value })}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') e.currentTarget.blur();
                                                            }}
                                                            className="w-full bg-white border border-gray-100 rounded-lg px-3 py-2 text-xs font-black text-navy-blue outline-none focus:border-indigo-500"
                                                            placeholder="https://example.com"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="mt-4 bg-white rounded-2xl border border-gray-100 p-4">
                                                    <div className="flex justify-center w-full">
                                                        <div
                                                            data-ad-resize-box
                                                            className="relative min-w-[160px] max-w-full"
                                                            style={{ width: `${adContent.widthPercent}%` }}
                                                        >
                                                            {adPreviewUrl ? (
                                                                <a
                                                                    href={adContent.targetUrl || '#'}
                                                                    target={adContent.targetUrl ? '_blank' : undefined}
                                                                    rel={adContent.targetUrl ? 'noopener noreferrer' : undefined}
                                                                    onClick={(e) => {
                                                                        if (!adContent.targetUrl) e.preventDefault();
                                                                    }}
                                                                    className="block relative aspect-[16/3] min-h-[80px] overflow-hidden rounded-xl border border-gray-100"
                                                                >
                                                                    <img src={adPreviewUrl} alt="広告" className="w-full h-full object-cover" />
                                                                    <span className="absolute bottom-2 right-2 bg-red-700 text-white text-[10px] font-black px-3 py-1 rounded-md">詳しく見る</span>
                                                                </a>
                                                            ) : (
                                                                <div className="h-32 flex items-center justify-center text-xs font-black text-gray-400 border-2 border-dashed border-gray-100 rounded-xl">
                                                                    広告画像をアップロードしてください
                                                                </div>
                                                            )}
                                                            <button
                                                                type="button"
                                                                aria-label="広告サイズを調整"
                                                                title="ドラッグして広告サイズを調整"
                                                                onPointerDown={(e) => handleAdResizeStart(e, idx, adContent)}
                                                                className="absolute -right-2 -bottom-2 w-[18px] h-[18px] rounded border-2 border-indigo-500 bg-white shadow-md cursor-nwse-resize z-20"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )})}
                    </div>
                )}

                {/* Add Block Menu */}
                <div className="mt-16 pt-12 border-t border-indigo-50">
                    <div className="text-center mb-8">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">新しいブロックを追加</span>
                    </div>
                    <div className="flex flex-wrap justify-center gap-4">
                        <button onClick={() => addBlock('text')} className="px-8 py-5 bg-white border-2 border-gray-100 hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-100 rounded-[2rem] text-xs font-black transition-all flex items-center gap-4 shadow-sm group">
                            <span className="text-2xl group-hover:scale-125 transition-transform">✍️</span> 文章
                        </button>
                        <button onClick={() => addBlock('hero')} className="px-8 py-5 bg-white border-2 border-gray-100 hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-100 rounded-[2rem] text-xs font-black transition-all flex items-center gap-4 shadow-sm group">
                            <span className="text-2xl group-hover:scale-125 transition-transform">⭐</span> 判定ヘッダー
                        </button>
                        <button onClick={() => addBlock('section_analysis')} className="px-8 py-5 bg-white border-2 border-gray-100 hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-100 rounded-[2rem] text-xs font-black transition-all flex items-center gap-4 shadow-sm group">
                            <span className="text-2xl group-hover:scale-125 transition-transform">📄</span> 大問解説
                        </button>
                        <button onClick={() => addBlock('question_list')} className="px-8 py-5 bg-white border-2 border-gray-100 hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-100 rounded-[2rem] text-xs font-black transition-all flex items-center gap-4 shadow-sm group">
                            <span className="text-2xl group-hover:scale-125 transition-transform">📋</span> 設問リスト
                        </button>
                        <button onClick={() => addBlock('image')} className="px-8 py-5 bg-white border-2 border-gray-100 hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-100 rounded-[2rem] text-xs font-black transition-all flex items-center gap-4 shadow-sm group">
                            <span className="text-2xl group-hover:scale-125 transition-transform">🖼️</span> 画像
                        </button>
                        {MARKETING_CONFIG.enableAdBanners && (
                            <button onClick={() => addBlock('ad')} className="px-8 py-5 bg-white border-2 border-gray-100 hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-100 rounded-[2rem] text-xs font-black transition-all flex items-center gap-4 shadow-sm group">
                                <span className="text-2xl group-hover:scale-125 transition-transform">📢</span> 広告
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminExamEditor;
