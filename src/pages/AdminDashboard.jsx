import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAdminExams, getAdminExamById, getAdminExamStructureSummaries, deleteAdminExam, updateAdminComment, updateAdminFields, importMockData, duplicateAdminExam, importAogakuData, deleteAdminExamsBulk } from '../services/adminExamService';

import { extractSectionVocabulary, generateSectionQuestionsExplanations, generateSingleSectionData } from '../services/adminGeminiService';
import { geminiQueue } from '../utils/promiseQueue';
import { normalizeExamStructureChoiceLabels } from '../utils/questionTypeNormalizer';
import AdminAnnouncements from '../components/AdminAnnouncements';
import AdminFeedbacks from '../components/AdminFeedbacks';
import AdminResultAnalytics from '../components/AdminResultAnalytics';
import { MARKETING_CONFIG } from '../config/marketingConfig';

const CRITERIA_REQUIRED_TYPES = new Set(['essay']);

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const hasQuestionExplanation = (question) => hasText(question?.explanation);

const hasScoringElements = (question) => {
    if (!Array.isArray(question?.scoringElements)) return false;
    return question.scoringElements.some(item =>
        hasText(item?.description) || Number.isFinite(Number(item?.points))
    );
};

const needsGradingCriteria = (question) => {
    const type = String(question?.type || '').toLowerCase();
    return CRITERIA_REQUIRED_TYPES.has(type);
};

const hasGradingCriteria = (question) => {
    return hasText(question?.gradingInstruction) ||
        hasText(question?.gradingCriteria) ||
        hasScoringElements(question);
};

const getGradingCriteriaStats = (exam) => {
    const questions = (exam?.structure || []).flatMap(section => section?.questions || []);
    const required = questions.filter(needsGradingCriteria);
    const completed = required.filter(hasGradingCriteria);
    return {
        required: required.length,
        completed: completed.length,
        missing: required.length - completed.length
    };
};

const getPointTotalStats = (exam) => {
    const maxScore = Number(exam?.max_score);
    const questions = (exam?.structure || []).flatMap(section => section?.questions || []);
    const generatedTotal = questions.reduce((sum, question) => {
        const points = Number(question?.points);
        return sum + (Number.isFinite(points) ? points : 0);
    }, 0);
    const hasGeneratedQuestions = questions.length > 0;
    const canCompare = Number.isFinite(maxScore) && maxScore > 0 && hasGeneratedQuestions;

    return {
        maxScore,
        generatedTotal,
        questionCount: questions.length,
        canCompare,
        isMismatch: canCompare && generatedTotal !== maxScore,
        diff: canCompare ? generatedTotal - maxScore : 0
    };
};

const getQuestionExplanationStats = (exam) => {
    const questions = (exam?.structure || []).flatMap(section => section?.questions || []);
    const completed = questions.filter(hasQuestionExplanation);

    return {
        required: questions.length,
        completed: completed.length,
        missing: questions.length - completed.length
    };
};

const getDetailedExplanationStats = (exam) => {
    const sections = (exam?.structure || []).filter(section => {
        const questions = Array.isArray(section?.questions) ? section.questions : [];
        return questions.length > 0 || Number(section?.totalPoints) > 0;
    });
    const completed = sections.filter(section => hasText(section?.sectionAnalysis));

    return {
        required: sections.length,
        completed: completed.length,
        missing: sections.length - completed.length
    };
};

const normalizeDataGroupText = (value) => String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[()]/g, (match) => match === '(' ? '（' : '）')
    .replace(/\//g, '／');

const getUniversityDataGroupLabel = (exam) => {
    const faculty = normalizeDataGroupText(exam?.faculty);
    if (!faculty) return '大学データ未設定';

    const parenMatch = faculty.match(/^(.+?)（(.+?)）$/);
    if (parenMatch) {
        const baseFaculty = parenMatch[1];
        const innerParts = parenMatch[2].split(/[／・]/).filter(Boolean);
        const method = innerParts.find(part => /方式|日程|選抜|学部別|全学部|一般入試|共通/.test(part)) || innerParts[innerParts.length - 1];
        return method ? `${baseFaculty}（${method}）` : baseFaculty;
    }

    const slashParts = faculty.split('／').filter(Boolean);
    if (slashParts.length >= 2) {
        const baseFaculty = slashParts[0];
        const method = slashParts.find(part => /方式|日程|選抜|学部別|全学部|一般入試|共通/.test(part));
        return method ? `${baseFaculty}／${method}` : baseFaculty;
    }

    const departmentMatch = faculty.match(/^(.+?学部).+?(学科|専攻|コース|課程|領域)$/);
    if (departmentMatch) return departmentMatch[1];

    return faculty;
};

const makeUniversityDataGroupKey = (exam) => [
    normalizeDataGroupText(exam?.university),
    String(exam?.year || ''),
    normalizeDataGroupText(exam?.subject_en || exam?.subject),
    getUniversityDataGroupLabel(exam)
].join('|');

const formatQuestionCounts = (exams, examStats) => {
    const counts = [...new Set(
        exams
            .map(exam => examStats[exam.id]?.points?.questionCount)
            .filter(count => Number.isFinite(Number(count)))
            .map(count => Number(count))
    )].sort((a, b) => a - b);

    if (counts.length === 0) return '問題数 未確認';
    if (counts.length === 1) return `${counts[0]}問`;
    return `問題数 ${counts.join(' / ')}問`;
};

const DASHBOARD_FILTER_STORAGE_KEY = 'adminDashboardFilters.v1';
const MAX_AUTO_STATS_EXAMS = 60;
const DEFAULT_DASHBOARD_FILTERS = {
    university: 'all',
    faculty: 'all',
    subject: 'all',
    year: 'all',
    masterStatus: 'all',
    publishStatus: 'all'
};

const MASTER_STATUS_FILTER_OPTIONS = [
    { value: 'working', label: '未完成' },
    { value: 'completed', label: '完成' },
    { value: 'verified', label: '検証済み' },
    { value: 'production', label: '本番用' }
];

const PUBLISH_STATUS_FILTER_OPTIONS = [
    { value: 'published', label: '公開中' },
    { value: 'unpublished', label: '非公開' }
];

const normalizeMasterStatus = (status) => {
    if (status === 'production') return 'production';
    if (status === 'verified') return 'verified';
    if (status === 'completed' || status === true) return 'completed';
    return 'working';
};

const extractExpectedQuestionCount = (instruction = '') => {
    const text = String(instruction || '');
    const match = text.match(/(?:小問|設問|問題)?\s*([0-9０-９]{1,2})\s*(?:問|題|個|件)/);
    if (!match) return null;
    const normalized = match[1].replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));
    const count = parseInt(normalized, 10);
    return Number.isFinite(count) && count > 0 ? count : null;
};

const buildCrossExamBatchLabel = (exam) => [
    exam?.university,
    exam?.year ? `${exam.year}年度` : '',
    exam?.faculty,
    exam?.subject
].filter(Boolean).join(' ');

const waitForIdle = () => new Promise(resolve => {
    if (typeof window !== 'undefined' && window.requestIdleCallback) {
        window.requestIdleCallback(resolve, { timeout: 1200 });
    } else {
        window.setTimeout(resolve, 250);
    }
});

const chunkArray = (items, size) => {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
};

function AdminDashboard() {
    const [exams, setExams] = useState([]);
    const [examStats, setExamStats] = useState({});
    const [statsLoading, setStatsLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('exams');
    const statsRequestIdRef = useRef(0);
    const [dashboardFilters, setDashboardFilters] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(DASHBOARD_FILTER_STORAGE_KEY) || '{}');
            return { ...DEFAULT_DASHBOARD_FILTERS, ...(saved && typeof saved === 'object' ? saved : {}) };
        } catch {
            return DEFAULT_DASHBOARD_FILTERS;
        }
    });
    const navigate = useNavigate();

    useEffect(() => {
        fetchExams();
    }, []);

    const fetchExams = async () => {
        setLoading(true);
        try {
            const { data, error } = await getAdminExams();
            if (error) {
                console.error('Error fetching exams:', error);
                alert(`試験データの取得に失敗しました。\n原因: ${error.message || '不明なエラー'}`);
            } else {
                setExams(data || []);
            }
        } finally {
            setLoading(false);
        }
    };

    const fetchExamStats = async (targetExams = exams) => {
        const targetIds = (targetExams || []).map(exam => exam.id).filter(Boolean);
        const requestId = statsRequestIdRef.current + 1;
        statsRequestIdRef.current = requestId;

        if (targetIds.length === 0) {
            setExamStats({});
            setStatsLoading(false);
            return;
        }

        setStatsLoading(true);
        try {
            setExamStats({});
            const chunks = chunkArray(targetIds, 10);

            for (const ids of chunks) {
                if (statsRequestIdRef.current !== requestId) return;
                await waitForIdle();

                const { data, error } = await getAdminExamStructureSummaries(ids);
                if (error) {
                    console.error('Error fetching exam stats chunk:', error);
                    continue;
                }

                const chunkStats = {};
                (data || []).forEach((exam) => {
                    chunkStats[exam.id] = {
                        criteria: getGradingCriteriaStats(exam),
                        points: getPointTotalStats(exam),
                        explanations: getQuestionExplanationStats(exam),
                        detailedExplanations: getDetailedExplanationStats(exam)
                    };
                });

                setExamStats(prev => ({ ...prev, ...chunkStats }));
            }
        } finally {
            if (statsRequestIdRef.current === requestId) {
                setStatsLoading(false);
            }
        }
    };

    const handleDelete = async (exam) => {
        const confirmMsg = `本当に以下の試験データを削除しますか？\n削除すると元に戻せません。\n\n【対象】\n${exam.university} ${exam.year}年度 ${exam.subject}`;
        if (window.confirm(confirmMsg)) {
            const { error } = await deleteAdminExam(exam.id);
            if (error) {
                console.error('Error deleting exam:', error);
                alert('削除に失敗しました。');
            } else {
                setSelectedExams(prev => {
                    const next = new Set(prev);
                    next.delete(exam.id);
                    return next;
                });
                fetchExams();
            }
        }
    };

    const handleBulkDelete = async () => {
        if (selectedExams.size === 0) return;
        if (window.confirm(`選択した${selectedExams.size}件の試験データを本当に削除しますか？\n削除すると元に戻せません。`)) {
            setLoading(true);
            const { error } = await deleteAdminExamsBulk(Array.from(selectedExams));
            if (error) {
                console.error('Error in bulk delete:', error);
                alert('一括削除に失敗しました。');
            } else {
                setSelectedExams(new Set());
                fetchExams();
            }
            setLoading(false);
        }
    };

    const handleToggleSelect = (examId) => {
        setSelectedExams(prev => {
            const next = new Set(prev);
            if (next.has(examId)) {
                next.delete(examId);
            } else {
                next.add(examId);
            }
            return next;
        });
    };

    const handleSelectAll = (universityExams) => {
        const allIds = universityExams.map(e => e.id);
        const allSelected = allIds.every(id => selectedExams.has(id));
        
        setSelectedExams(prev => {
            const next = new Set(prev);
            if (allSelected) {
                allIds.forEach(id => next.delete(id));
            } else {
                allIds.forEach(id => next.add(id));
            }
            return next;
        });
    };

    const handleCopy = async (exam) => {
        const result = window.prompt(`「${exam.university} ${exam.year}年度 ${exam.subject}」をコピーします。作成する個数を半角数字で入力してください。`, "1");
        
        if (result !== null) {
            const count = parseInt(result, 10);
            if (isNaN(count) || count < 1) {
                alert("正しい数字（1以上の整数）を入力してください。");
                return;
            }
            if (count > 50) {
                 if(!window.confirm(`本当に${count}個もコピーを作成しますか？`)) return;
            }
            
            setLoading(true);
            const { error } = await duplicateAdminExam(exam.id, count);
            if (error) {
                console.error('Error duplicating exam:', error);
                alert('コピーに失敗しました。');
            } else {
                fetchExams();
            }
            setLoading(false);
        }
    };


    const handleCommentUpdate = async (id, comment) => {
        const { error } = await updateAdminComment(id, comment);
        if (error) {
            console.error('Error updating comment:', error);
            alert('メモの更新に失敗しました。管理者メモ用の「admin_comment」カラムをデータベース(Supabase)の exams テーブルに追加したか確認してください。');
        } else {
            setExams(prev => prev.map(e => e.id === id ? { ...e, admin_comment: comment } : e));
        }
    };

    const handleToggleUnimplemented = async (examId, item, currentItems) => {
        const items = Array.isArray(currentItems) ? currentItems : [];
        const newItems = items.includes(item)
            ? items.filter(i => i !== item)
            : [...items, item];

        const { error } = await updateAdminFields(examId, { unimplemented_items: newItems });
        if (error) {
            console.error('Error updating unimplemented items:', error);
            alert('更新に失敗しました。SQLを実行してカラムを追加したか確認してください。');
        } else {
            setExams(prev => prev.map(e => e.id === examId ? { ...e, unimplemented_items: newItems } : e));
        }
    };

    const handleCycleStatus = async (examId, currentStatus) => {
        const statuses = ['working', 'completed', 'verified', 'production'];
        const normalizedStatus = normalizeMasterStatus(currentStatus);

        const currentIndex = statuses.indexOf(normalizedStatus);
        const nextStatus = statuses[(currentIndex + 1) % statuses.length];
        
        // Only the production-ready status is exposed to students automatically.
        const nextPublished = nextStatus === 'production';

        const { error } = await updateAdminFields(examId, { 
            master_status: nextStatus,
            is_published: nextPublished
        });

        if (error) {
            console.error('Error updating status:', error);
            alert('更新に失敗しました。');
        } else {
            setExams(prev => prev.map(e => e.id === examId ? { 
                ...e, 
                master_status: nextStatus,
                is_published: nextPublished
            } : e));
        }
    };

    const handleTogglePublish = async (examId, currentPublished) => {
        const nextPublished = !currentPublished;
        const { error } = await updateAdminFields(examId, { is_published: nextPublished });
        
        if (error) {
            console.error('Error toggling publish:', error);
            alert('公開ステータスの更新に失敗しました。SQLを実行して「is_published」(boolean) カラムを追加してください。');
        } else {
            setExams(prev => prev.map(e => e.id === examId ? { ...e, is_published: nextPublished } : e));
        }
    };

    const handlePreview = async (rawExam) => {
        const { data: fullExam, error } = await getAdminExamById(rawExam.id);
        if (error || !fullExam) {
            alert('プレビュー用データの取得に失敗しました。');
            return;
        }

        const formattedExam = {
            id: fullExam.id,
            university: fullExam.university,
            universityId: fullExam.university_id,
            faculty: fullExam.faculty,
            facultyId: fullExam.faculty_id,
            year: fullExam.year,
            subject: fullExam.subject,
            subjectEn: fullExam.subject_en,
            type: fullExam.type,
            pdfPath: fullExam.pdf_path,
            maxScore: fullExam.max_score,
            detailedAnalysis: fullExam.detailed_analysis,
            structure: fullExam.structure
        };

        navigate(`/exam/${formattedExam.universityId}-${formattedExam.facultyId}-preview`, {
            state: {
                exam: formattedExam,
                universityName: formattedExam.university,
                universityId: formattedExam.universityId
            }
        });
    };

    const handleEditLayout = async (exam) => {
        const { data: fullExam, error } = await getAdminExamById(exam.id);
        if (error || !fullExam) {
            alert('レイアウト編集用データの取得に失敗しました。');
            return;
        }

        // Generate dummy question feedback based on real master data from structure
        const dummyFeedback = [];
        if (Array.isArray(fullExam.structure)) {
            fullExam.structure.forEach(section => {
                if (Array.isArray(section.questions)) {
                    section.questions.forEach(q => {
                        dummyFeedback.push({
                            id: String(q.id || `${section.id}-${Math.floor(Math.random() * 10)}`),
                            correct: false, // Default to incorrect since userAnswer is empty
                            userAnswer: "", 
                            correctAnswer: q.correctAnswer || q.answer || "未設定",
                            explanation: q.explanation || "マスターデータに解説が設定されていません。"
                        });
                    });
                } else if (section.totalPoints) {
                    // Fallback for sections without explicit questions but have points
                    dummyFeedback.push({
                        id: `${section.id}-1`,
                        correct: false,
                        userAnswer: "",
                        correctAnswer: "未設定",
                        explanation: "マスターデータに解説が設定されていません。"
                    });
                }
            });
        }

        // Jump directly to ResultPage in Design Mode with dummy data
        navigate('/result', {
            state: {
                examId: exam.id,
                universityName: fullExam.university,
                examSubject: `${fullExam.year}年度 ${fullExam.subject}`,
                isDesignMode: true,
                result: {
                    score: 50,
                    maxScore: fullExam.max_score || 100,
                    passProbability: "B",
                    detailedAnalysis: fullExam.detailed_analysis || "デザインモード用の詳細解説ダミーです。",
                    weaknessAnalysis: "これはデザインモード用のダミー弱点分析です。実際の採点時には、得点率に応じた適切な分析メッセージが表示されます。",
                    questionFeedback: dummyFeedback
                },
                examStructure: fullExam.structure,
                isNewResult: false
            }
        });
    };

    const [batchProcessing, setBatchProcessing] = useState(false);
    const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
    const [batchType, setBatchType] = useState('');
    const [crossExamBatchStatus, setCrossExamBatchStatus] = useState(null);
    const [selectedExams, setSelectedExams] = useState(new Set());
    const [editingFacultyId, setEditingFacultyId] = useState(null);
    const [facultyDraft, setFacultyDraft] = useState('');

    const dashboardFilterOptions = useMemo(() => {
        const unique = (key) => [...new Set(exams.map(exam => exam[key]).filter(Boolean))];
        return {
            universities: unique('university').sort((a, b) => String(a).localeCompare(String(b), 'ja')),
            faculties: unique('faculty').sort((a, b) => String(a).localeCompare(String(b), 'ja')),
            subjects: unique('subject').sort((a, b) => String(a).localeCompare(String(b), 'ja')),
            years: unique('year').sort((a, b) => Number(b) - Number(a))
        };
    }, [exams]);

    const filteredExams = useMemo(() => (
        exams.filter((exam) => {
            if (dashboardFilters.university !== 'all' && exam.university !== dashboardFilters.university) return false;
            if (dashboardFilters.faculty !== 'all' && exam.faculty !== dashboardFilters.faculty) return false;
            if (dashboardFilters.subject !== 'all' && exam.subject !== dashboardFilters.subject) return false;
            if (dashboardFilters.year !== 'all' && String(exam.year) !== String(dashboardFilters.year)) return false;
            if (dashboardFilters.masterStatus !== 'all' && normalizeMasterStatus(exam.master_status) !== dashboardFilters.masterStatus) return false;
            if (dashboardFilters.publishStatus === 'published' && !exam.is_published) return false;
            if (dashboardFilters.publishStatus === 'unpublished' && exam.is_published) return false;
            return true;
        })
    ), [dashboardFilters, exams]);

    const updateDashboardFilter = (key, value) => {
        setDashboardFilters(prev => {
            const next = { ...prev, [key]: value };
            localStorage.setItem(DASHBOARD_FILTER_STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    };

    const beginFacultyEdit = (exam) => {
        setEditingFacultyId(exam.id);
        setFacultyDraft(exam.faculty || '');
    };

    const cancelFacultyEdit = () => {
        setEditingFacultyId(null);
        setFacultyDraft('');
    };

    const saveFacultyEdit = async (exam) => {
        const nextFaculty = facultyDraft.trim();
        const currentFaculty = exam.faculty || '';

        if (!nextFaculty) {
            alert('学部名を空にはできません。');
            setFacultyDraft(currentFaculty);
            return;
        }

        if (nextFaculty === currentFaculty) {
            cancelFacultyEdit();
            return;
        }

        const { error } = await updateAdminFields(exam.id, { faculty: nextFaculty });
        if (error) {
            console.error('Error updating faculty:', error);
            alert('学部名の更新に失敗しました。');
            setFacultyDraft(currentFaculty);
            return;
        }

        setExams(prev => prev.map(e => e.id === exam.id ? { ...e, faculty: nextFaculty } : e));
        cancelFacultyEdit();
    };

    const resetDashboardFilters = () => {
        setDashboardFilters(DEFAULT_DASHBOARD_FILTERS);
        localStorage.removeItem(DASHBOARD_FILTER_STORAGE_KEY);
    };

    const handleCrossExamAutoGenerate = async () => {
        const selectedIds = Array.from(selectedExams);
        if (selectedIds.length === 0) {
            alert('生成対象の試験データを選択してください。');
            return;
        }

        const selectedLabels = exams
            .filter(exam => selectedExams.has(exam.id))
            .slice(0, 8)
            .map(buildCrossExamBatchLabel)
            .join('\n・');
        const extraCount = Math.max(0, selectedIds.length - 8);

        if (!window.confirm(
            `選択した ${selectedIds.length} 件の試験データを、1件ずつ順番にAI生成します。\n\n` +
            `対象例:\n・${selectedLabels}${extraCount ? `\n・ほか ${extraCount} 件` : ''}\n\n` +
            `処理内容:\n` +
            `1. 大問別の配点・問題PDF・解答画像が揃っている大問だけ生成\n` +
            `2. 小問解説を5問ずつ分割生成\n` +
            `3. 大問ごとに自動保存\n\n` +
            `既存の大問構造・小問解説は上書きされます。よろしいですか？`
        )) {
            return;
        }

        setBatchType('crossExamGenerate');
        setBatchProcessing(true);
        setBatchProgress({ current: 0, total: selectedIds.length });
        setCrossExamBatchStatus({
            currentExam: '',
            currentSection: '',
            logs: []
        });

        const addLog = (message) => {
            setCrossExamBatchStatus(prev => ({
                ...(prev || {}),
                logs: [message, ...((prev?.logs || []).slice(0, 9))]
            }));
        };

        let successExamCount = 0;
        let failedSectionCount = 0;
        let skippedSectionCount = 0;

        try {
            for (let examIndex = 0; examIndex < selectedIds.length; examIndex += 1) {
                const examId = selectedIds[examIndex];
                setBatchProgress({ current: examIndex + 1, total: selectedIds.length });

                const { data: fullExam, error: fetchError } = await getAdminExamById(examId);
                if (fetchError || !fullExam) {
                    failedSectionCount += 1;
                    addLog(`取得失敗: ${examId}`);
                    continue;
                }

                const examLabel = buildCrossExamBatchLabel(fullExam);
                setCrossExamBatchStatus(prev => ({ ...(prev || {}), currentExam: examLabel, currentSection: '' }));

                const originalStructure = Array.isArray(fullExam.structure) ? fullExam.structure : [];
                const nextStructure = [...originalStructure];
                let changed = false;
                let examHadSuccess = false;

                if (nextStructure.length === 0) {
                    skippedSectionCount += 1;
                    addLog(`スキップ: ${examLabel} / 大問データがありません`);
                    continue;
                }

                for (let sIdx = 0; sIdx < nextStructure.length; sIdx += 1) {
                    const existingSection = nextStructure[sIdx] || {};
                    const sectionNum = Number(existingSection.id) || sIdx + 1;
                    const sectionLabel = existingSection.label || `第${sectionNum}問`;
                    const questionPath = existingSection.question_pdf_path;
                    const answerPath = existingSection.answer_pdf_path;
                    const targetPoints = Number(existingSection.allocatedPoints);

                    setCrossExamBatchStatus(prev => ({ ...(prev || {}), currentSection: sectionLabel }));

                    if (!questionPath) {
                        skippedSectionCount += 1;
                        addLog(`スキップ: ${examLabel} ${sectionLabel} / 大問別の問題PDFなし`);
                        continue;
                    }

                    if (!answerPath) {
                        skippedSectionCount += 1;
                        addLog(`スキップ: ${examLabel} ${sectionLabel} / 大問別の解答画像なし`);
                        continue;
                    }

                    if (!Number.isFinite(targetPoints) || targetPoints <= 0) {
                        skippedSectionCount += 1;
                        addLog(`スキップ: ${examLabel} ${sectionLabel} / 大問別の配点なし`);
                        continue;
                    }

                    const expectedQuestionCount = Number(existingSection.expectedQuestionCount) > 0
                        ? Number(existingSection.expectedQuestionCount)
                        : extractExpectedQuestionCount(existingSection.instruction || '');
                    const instruction = [
                        existingSection.instruction || '',
                        expectedQuestionCount
                            ? `【システム補足】この大問の期待小問数は ${expectedQuestionCount} 件です。`
                            : ''
                    ].filter(Boolean).join('\n\n');

                    try {
                        addLog(`生成開始: ${examLabel} ${sectionLabel}`);

                        const sectionResult = await geminiQueue.add(() => generateSingleSectionData(
                            fullExam.subject_en || fullExam.subject || '',
                            sectionNum,
                            [questionPath],
                            [answerPath],
                            instruction,
                            targetPoints,
                            expectedQuestionCount,
                            false,
                            false
                        ));

                        if (!Array.isArray(sectionResult?.questions) || sectionResult.questions.length === 0) {
                            throw new Error('小問が生成されませんでした。');
                        }

                        const structureOnlySection = {
                            ...existingSection,
                            ...sectionResult,
                            id: String(sectionResult?.id || existingSection.id || sectionNum),
                            label: sectionResult?.label || existingSection.label || `第${sectionNum}問`,
                            question_pdf_path: existingSection.question_pdf_path,
                            answer_pdf_path: existingSection.answer_pdf_path,
                            vocabulary: existingSection.vocabulary || sectionResult?.vocabulary || []
                        };

                        nextStructure[sIdx] = structureOnlySection;
                        await updateAdminFields(fullExam.id, { structure: nextStructure });
                        changed = true;
                        examHadSuccess = true;
                        addLog(`構造保存: ${examLabel} ${sectionLabel} / ${sectionResult.questions.length}問`);

                        const sectionWithExplanations = await geminiQueue.add(() => generateSectionQuestionsExplanations(
                            fullExam.subject_en || fullExam.subject || '',
                            structureOnlySection,
                            [questionPath],
                            [answerPath],
                            {
                                onChunk: async (partialSection, chunkInfo) => {
                                    nextStructure[sIdx] = {
                                        ...structureOnlySection,
                                        ...partialSection,
                                        id: String(partialSection?.id || existingSection.id || sectionNum),
                                        label: partialSection?.label || existingSection.label || `第${sectionNum}問`,
                                        question_pdf_path: existingSection.question_pdf_path,
                                        answer_pdf_path: existingSection.answer_pdf_path,
                                        vocabulary: existingSection.vocabulary || partialSection?.vocabulary || []
                                    };
                                    await updateAdminFields(fullExam.id, { structure: nextStructure });
                                    addLog(`解説途中保存: ${examLabel} ${sectionLabel} / ${chunkInfo.end}/${chunkInfo.total}問`);
                                }
                            }
                        ));

                        const generatedQuestions = Array.isArray(sectionWithExplanations?.questions)
                            ? sectionWithExplanations.questions
                            : sectionResult.questions;
                        const explanationCount = generatedQuestions.filter(hasQuestionExplanation).length;

                        nextStructure[sIdx] = {
                            ...structureOnlySection,
                            ...sectionWithExplanations,
                            id: String(sectionWithExplanations?.id || existingSection.id || sectionNum),
                            label: sectionWithExplanations?.label || existingSection.label || `第${sectionNum}問`,
                            question_pdf_path: existingSection.question_pdf_path,
                            answer_pdf_path: existingSection.answer_pdf_path,
                            vocabulary: existingSection.vocabulary || sectionWithExplanations?.vocabulary || []
                        };

                        await updateAdminFields(fullExam.id, { structure: nextStructure });
                        addLog(`解説保存: ${examLabel} ${sectionLabel} / ${generatedQuestions.length}問・解説${explanationCount}件`);

                        await new Promise(resolve => setTimeout(resolve, 2500));
                    } catch (sectionError) {
                        failedSectionCount += 1;
                        console.error(`[CrossExamBatch] Failed ${fullExam.id} ${sectionLabel}:`, sectionError);
                        addLog(`失敗: ${examLabel} ${sectionLabel} / ${sectionError.message || '不明なエラー'}`);
                    }
                }

                if (changed) {
                    await updateAdminFields(fullExam.id, { structure: nextStructure });
                }
                if (examHadSuccess) successExamCount += 1;
            }
        } finally {
            setBatchProcessing(false);
            setBatchType('');
            setBatchProgress({ current: 0, total: 0 });
        }

        alert(
            `横断自動生成が完了しました。\n\n` +
            `生成できた試験: ${successExamCount} 件\n` +
            `スキップした大問: ${skippedSectionCount} 件\n` +
            `失敗した大問: ${failedSectionCount} 件`
        );
        fetchExams();
    };

    const groupedExams = useMemo(() => {
        return Object.entries(
            filteredExams.reduce((acc, exam) => {
                const univ = exam.university || 'その他';
                if (!acc[univ]) acc[univ] = [];
                acc[univ].push(exam);
                return acc;
            }, {})
        )
            .sort(([nameA, examsA], [nameB, examsB]) => {
                const lastA = Math.max(...examsA.map(e => new Date(e.updated_at || 0).getTime()));
                const lastB = Math.max(...examsB.map(e => new Date(e.updated_at || 0).getTime()));
                return lastB - lastA || nameA.localeCompare(nameB, 'ja');
            })
            .map(([university, rawExams]) => {
                const sortedExams = [...rawExams].sort((a, b) =>
                    Number(b.year || 0) - Number(a.year || 0) ||
                    String(a.subject || '').localeCompare(String(b.subject || ''), 'ja') ||
                    String(a.faculty || '').localeCompare(String(b.faculty || ''), 'ja')
                );
                const dataGroups = Object.entries(
                    sortedExams.reduce((acc, exam) => {
                        const groupKey = makeUniversityDataGroupKey(exam);
                        if (!acc[groupKey]) {
                            acc[groupKey] = {
                                label: getUniversityDataGroupLabel(exam),
                                exams: []
                            };
                        }
                        acc[groupKey].exams.push(exam);
                        return acc;
                    }, {})
                )
                    .sort(([, groupA], [, groupB]) => {
                        const latestA = Math.max(...groupA.exams.map(e => new Date(e.updated_at || 0).getTime()));
                        const latestB = Math.max(...groupB.exams.map(e => new Date(e.updated_at || 0).getTime()));
                        return latestB - latestA || groupA.label.localeCompare(groupB.label, 'ja');
                    })
                    .map(([groupKey, group]) => ({
                        groupKey,
                        label: group.label,
                        exams: group.exams
                    }));

                return [university, sortedExams, dataGroups];
            });
    }, [filteredExams]);

    useEffect(() => {
        if (loading || activeTab !== 'exams' || exams.length === 0) return undefined;

        const visibleExams = filteredExams.slice(0, MAX_AUTO_STATS_EXAMS);
        const timerId = window.setTimeout(() => {
            fetchExamStats(visibleExams);
        }, 500);

        return () => window.clearTimeout(timerId);
    }, [activeTab, exams.length, filteredExams, loading]);

    const handleBatchRemoveAsterisks = async () => {
        if (exams.length === 0) {
            alert('対象の試験データがありません。');
            return;
        }

        if (!window.confirm(`全 ${exams.length} 件の試験データ（解説・大問分析・採点基準）からアスタリスク（*）を機械的に一括除去しますか？\n(データ量によっては数秒〜数十秒程度かかる場合があります)`)) {
            return;
        }

        setBatchType('asterisk');
        setBatchProcessing(true);
        setBatchProgress({ current: 0, total: exams.length });

        let updatedCount = 0;

        for (let i = 0; i < exams.length; i++) {
            const basicExam = exams[i];
            
            try {
                const { data: fullExam, error: fetchError } = await getAdminExamById(basicExam.id);
                if (fetchError || !fullExam) {
                    console.error(`Failed to fetch full data for ${basicExam.id}:`, fetchError);
                    setBatchProgress(prev => ({ ...prev, current: i + 1 }));
                    continue;
                }

                let hasChanges = false;

                // 1. Clean detailed_analysis
                let cleanedDetailed = fullExam.detailed_analysis || '';
                if (cleanedDetailed.includes('*')) {
                    cleanedDetailed = cleanedDetailed.replace(/\*/g, '');
                    hasChanges = true;
                }

                // 2. Clean structure
                const cleanedStructure = (fullExam.structure || []).map(section => {
                    let sectionChanged = false;
                    let cleanedSecAnalysis = section.sectionAnalysis || '';
                    if (cleanedSecAnalysis.includes('*')) {
                        cleanedSecAnalysis = cleanedSecAnalysis.replace(/\*/g, '');
                        sectionChanged = true;
                    }

                    const cleanedQuestions = (section.questions || []).map(q => {
                        let qChanged = false;
                        let cleanedExpl = q.explanation || '';
                        if (cleanedExpl.includes('*')) {
                            cleanedExpl = cleanedExpl.replace(/\*/g, '');
                            qChanged = true;
                        }

                        let cleanedGrading = q.gradingInstruction || '';
                        if (cleanedGrading.includes('*')) {
                            cleanedGrading = cleanedGrading.replace(/\*/g, '');
                            qChanged = true;
                        }

                        if (qChanged) {
                            return {
                                ...q,
                                explanation: cleanedExpl,
                                gradingInstruction: cleanedGrading
                            };
                        }
                        return q;
                    });

                    if (sectionChanged || JSON.stringify(section.questions) !== JSON.stringify(cleanedQuestions)) {
                        hasChanges = true;
                        return {
                            ...section,
                            sectionAnalysis: cleanedSecAnalysis,
                            questions: cleanedQuestions
                        };
                    }
                    return section;
                });

                if (hasChanges) {
                    const { error: updateError } = await updateAdminFields(fullExam.id, {
                        detailed_analysis: cleanedDetailed,
                        structure: cleanedStructure
                    });

                    if (updateError) {
                        console.error(`Failed to update exam ${fullExam.id}:`, updateError.message);
                    } else {
                        updatedCount++;
                    }
                }
            } catch (err) {
                console.error(`Error processing exam ${basicExam.id}:`, err);
            }

            setBatchProgress(prev => ({ ...prev, current: i + 1 }));
        }

        setBatchProcessing(false);
        setBatchType('');
        alert(`アスタリスクの一括消去が完了しました！\n更新された試験：${updatedCount} 件`);
        fetchExams();
    };

    const handleBatchVocabularyExtraction = async () => {
        const englishExams = exams.filter(e => e.subject_en === 'english');

        if (englishExams.length === 0) {
            alert('対象の英語試験はありません。');
            return;
        }

        if (!window.confirm(`${englishExams.length}件の英語試験を確認し、単語未抽出の大問だけAI単語抽出を実行しますか？\n（API消費量が増えますのでご注意ください）`)) {
            return;
        }

        setBatchProcessing(true);
        setBatchProgress({ current: 0, total: englishExams.length });

        for (let i = 0; i < englishExams.length; i++) {
            const basicExam = englishExams[i];
            console.log(`[BatchVocab] Processing exam: ${basicExam.id}`);
            
            try {
                const { data: exam, error: fetchError } = await getAdminExamById(basicExam.id);
                if (fetchError || !exam) {
                    console.error(`[BatchVocab] Failed to fetch ${basicExam.id}:`, fetchError);
                    setBatchProgress(prev => ({ ...prev, current: i + 1 }));
                    continue;
                }

                const newStructure = Array.isArray(exam.structure) ? [...exam.structure] : [];
                let changed = false;

                for (let sIdx = 0; sIdx < newStructure.length; sIdx++) {
                    const section = newStructure[sIdx];
                    if (!section.vocabulary || section.vocabulary.length === 0) {
                        const pdfPath = section.question_pdf_path || exam.pdf_path;
                        if (pdfPath) {
                            console.log(`[BatchVocab] Extracting vocab for ${exam.id} Section ${sIdx + 1}`);
                            const vocab = await geminiQueue.add(() => extractSectionVocabulary([pdfPath]));
                            newStructure[sIdx] = { ...section, vocabulary: vocab };
                            changed = true;
                        }
                    }
                }

                if (changed) {
                    await updateAdminFields(exam.id, { structure: newStructure });
                }
            } catch (err) {
                console.error(`[BatchVocab] Failed for exam ${exam.id}:`, err);
            }

            setBatchProgress(prev => ({ ...prev, current: i + 1 }));
        }

        setBatchProcessing(false);
        alert('一括単語抽出が完了しました！');
        fetchExams();
    };

    const handleBatchNormalizeChoiceLabels = async () => {
        if (exams.length === 0) {
            alert('対象の試験データがありません。');
            return;
        }

        if (!window.confirm(`全 ${exams.length} 件の試験データをスキャンし、選択肢・正解・別解の表記揺れだけを確認します。\n対象は「力→カ」「才→オ」「工→エ」「口→ロ」などのOCR誤変換と、a〜z / A〜Z / 数字 / カタカナ連番で1つだけ欠けている場合の補完です。\nこの時点ではまだ保存データを書き換えません。`)) {
            return;
        }

        const getRepairChanges = (beforeStructure, afterStructure) => {
            const changes = [];
            (beforeStructure || []).forEach((beforeSection, sIdx) => {
                const afterSection = afterStructure?.[sIdx] || {};
                (beforeSection?.questions || []).forEach((beforeQuestion, qIdx) => {
                    const afterQuestion = afterSection?.questions?.[qIdx] || {};
                    const fieldChanges = [];
                    if (JSON.stringify(beforeQuestion?.options || []) !== JSON.stringify(afterQuestion?.options || [])) {
                        fieldChanges.push(`選択肢: ${JSON.stringify(beforeQuestion?.options || [])} → ${JSON.stringify(afterQuestion?.options || [])}`);
                    }
                    if (String(beforeQuestion?.correctAnswer ?? '') !== String(afterQuestion?.correctAnswer ?? '')) {
                        fieldChanges.push(`正解: ${beforeQuestion?.correctAnswer ?? ''} → ${afterQuestion?.correctAnswer ?? ''}`);
                    }
                    if (JSON.stringify(beforeQuestion?.alternativeAnswers || []) !== JSON.stringify(afterQuestion?.alternativeAnswers || [])) {
                        fieldChanges.push(`別解: ${JSON.stringify(beforeQuestion?.alternativeAnswers || [])} → ${JSON.stringify(afterQuestion?.alternativeAnswers || [])}`);
                    }
                    if (fieldChanges.length > 0) {
                        changes.push({
                            sectionLabel: beforeSection?.label || `第${sIdx + 1}問`,
                            questionLabel: beforeQuestion?.label || `問${qIdx + 1}`,
                            fieldChanges
                        });
                    }
                });
            });
            return changes;
        };

        setBatchType('choiceLabelScan');
        setBatchProcessing(true);
        setBatchProgress({ current: 0, total: exams.length });

        const candidates = [];

        for (let i = 0; i < exams.length; i++) {
            const basicExam = exams[i];

            try {
                const { data: fullExam, error: fetchError } = await getAdminExamById(basicExam.id);
                if (fetchError || !fullExam) {
                    console.error(`Failed to fetch full data for ${basicExam.id}:`, fetchError);
                    setBatchProgress(prev => ({ ...prev, current: i + 1 }));
                    continue;
                }

                const normalized = normalizeExamStructureChoiceLabels(fullExam.structure || []);
                if (normalized.changed) {
                    candidates.push({
                        exam: fullExam,
                        normalizedStructure: normalized.structure,
                        changes: getRepairChanges(fullExam.structure || [], normalized.structure)
                    });
                }
            } catch (err) {
                console.error(`Error normalizing choice labels for ${basicExam.id}:`, err);
            }

            setBatchProgress(prev => ({ ...prev, current: i + 1 }));
        }

        setBatchProcessing(false);
        setBatchType('');

        const changedQuestionCount = candidates.reduce((sum, item) => sum + item.changes.length, 0);
        if (candidates.length === 0) {
            alert('補正が必要な選択肢・正解・別解の表記揺れは見つかりませんでした。');
            return;
        }

        const allChangeLines = candidates
            .flatMap(item => item.changes.map(change =>
                `・${item.exam.university || ''} ${item.exam.year || ''} ${item.exam.subject || ''} ${change.sectionLabel} ${change.questionLabel}\n  ${change.fieldChanges.join(' / ')}`
            ));
        const visibleChangeLines = allChangeLines.slice(0, 80).join('\n');
        const hiddenChangeCount = Math.max(0, allChangeLines.length - 80);
        if (hiddenChangeCount > 0) {
            console.table(allChangeLines.map(line => ({ change: line })));
        }

        if (!window.confirm(`選択肢・正解・別解の補正候補が見つかりました。\n\n対象試験: ${candidates.length} 件\n対象小問: ${changedQuestionCount} 件\n\n修正一覧:\n${visibleChangeLines}${hiddenChangeCount > 0 ? `\n\nほか ${hiddenChangeCount} 件あります。全件はブラウザのコンソールに出力しました。` : ''}\n\nこの内容でSupabase上の問題データを更新しますか？\n※問題タイプは変更しません。`)) {
            alert('更新をキャンセルしました。保存データは変更していません。');
            return;
        }

        setBatchType('choiceLabelUpdate');
        setBatchProcessing(true);
        setBatchProgress({ current: 0, total: candidates.length });

        let updatedCount = 0;
        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i];
            try {
                const { error: updateError } = await updateAdminFields(candidate.exam.id, {
                    structure: candidate.normalizedStructure
                });

                if (updateError) {
                    console.error(`Failed to normalize answer labels for ${candidate.exam.id}:`, updateError.message);
                } else {
                    updatedCount += 1;
                }
            } catch (err) {
                console.error(`Error updating normalized answer labels for ${candidate.exam.id}:`, err);
            }
            setBatchProgress(prev => ({ ...prev, current: i + 1 }));
        }

        setBatchProcessing(false);
        setBatchType('');
        alert(`選択肢・正解・別解の補正が完了しました。\n更新された試験：${updatedCount} 件\n補正された小問：${changedQuestionCount} 件`);
        fetchExams();
    };

    const handleImport = async () => {
        if (window.confirm('ダミーデータをSupabaseに一括登録します。よろしいですか？')) {
            setLoading(true);
            const count = await importMockData();
            alert(`${count}件の試験データを登録しました！`);
            fetchExams();
        }
    };

    const handleImportAogaku = async () => {
        if (window.confirm('Obsidianの最新データ（青学42件）をSupabaseに一括登録します。よろしいですか？')) {
            setLoading(true);
            const count = await importAogakuData();
            alert(`${count}件のデータを登録しました！`);
            fetchExams();
        }
    };

    const handleFixSubjects = async () => {
        if (!window.confirm('科目名から(コピー)を削除し、青学のデータをすべて「公開中」に変更しますか？')) return;
        setLoading(true);
        let updated = 0;
        for (const exam of exams) {
            if (exam.university === '青山学院大学') {
                const newSubject = exam.subject ? exam.subject.replace(/\(コピー[0-9]*\)/g, '').trim() : exam.subject;
                const { error } = await updateAdminFields(exam.id, { 
                    subject: newSubject,
                    is_published: true
                });
                if (!error) updated++;
            }
        }
        alert(`青学のデータ ${updated}件 を修正・公開状態にしました！`);
        fetchExams();
    };

    return (
        <div className="admin-page min-h-screen bg-indigo-50/30 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
                <div className="admin-mobile-stack flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <div>
                        <h1 className="text-3xl font-black text-navy-blue flex items-center gap-3">
                            管理者ページ
                            <span className="text-xs bg-navy-blue text-white px-2 py-1 rounded-full font-mono">v2.1</span>
                        </h1>
                        <div className="admin-tabs-scroll flex gap-6 mt-2 border-b border-gray-200">
                        <button 
                            onClick={() => setActiveTab('exams')}
                            className={`pb-2 px-1 border-b-2 font-bold transition-all ${activeTab === 'exams' ? 'border-navy-blue text-navy-blue' : 'border-transparent text-gray-400 hover:text-navy-blue'}`}
                        >
                            試験マスター管理
                        </button>
                        <button 
                            onClick={() => setActiveTab('announcements')}
                            className={`pb-2 px-1 border-b-2 font-bold transition-all ${activeTab === 'announcements' ? 'border-navy-blue text-navy-blue' : 'border-transparent text-gray-400 hover:text-navy-blue'}`}
                        >
                            📢 お知らせ管理
                        </button>
                        <button 
                            onClick={() => setActiveTab('feedbacks')}
                            className={`pb-2 px-1 border-b-2 font-bold transition-all ${activeTab === 'feedbacks' ? 'border-navy-blue text-navy-blue' : 'border-transparent text-gray-400 hover:text-navy-blue'}`}
                        >
                            📨 お問い合わせ管理
                        </button>
                        <button 
                            onClick={() => setActiveTab('resultAnalytics')}
                            className={`pb-2 px-1 border-b-2 font-bold transition-all ${activeTab === 'resultAnalytics' ? 'border-navy-blue text-navy-blue' : 'border-transparent text-gray-400 hover:text-navy-blue'}`}
                        >
                            成績ログ
                        </button>
                        {MARKETING_CONFIG.enableAdBanners && (
                            <button 
                                onClick={() => {
                                    console.log("Navigating to Banners...");
                                    navigate('/admin/banners');
                                }}
                                className="pb-2 px-1 text-gray-400 hover:text-navy-blue border-b-2 border-transparent"
                            >
                                広告管理
                            </button>
                        )}
                        <button 
                            onClick={() => navigate('/admin/users')}
                            className="pb-2 px-1 text-gray-400 hover:text-navy-blue border-b-2 border-transparent"
                        >
                            ユーザー管理
                        </button>
                        {MARKETING_CONFIG.enableConsultation && (
                            <button 
                                onClick={() => navigate('/admin/consultations')}
                                className="pb-2 px-1 text-gray-400 hover:text-navy-blue border-b-2 border-transparent"
                            >
                                カウンセリング申込
                            </button>
                        )}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-4 md:mt-0">
                        {batchProcessing && (
                            <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl shadow-sm border border-indigo-100">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
                                <span className="text-xs font-bold text-indigo-600">
                                    {batchType === 'asterisk'
                                        ? 'アスタリスク消去中'
                                        : batchType === 'choiceLabelScan'
                                            ? '表記揺れ確認中'
                                            : batchType === 'choiceLabelUpdate'
                                                ? '表記揺れ更新中'
                                            : batchType === 'crossExamGenerate'
                                                ? '横断生成中'
                                                : '一括抽出中'}: {batchProgress.current} / {batchProgress.total}
                                </span>
                            </div>
                        )}
                        <Link
                            to="/admin/exam-lab"
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-lg shadow transition-colors flex items-center gap-2"
                        >
                            <span className="text-lg">AI</span> 自動入力ラボ
                        </Link>
                        <Link
                            to="/admin/answer-image-snippet"
                            className="bg-white hover:bg-gray-50 text-navy-blue font-bold py-2.5 px-6 rounded-lg shadow-sm border border-indigo-200 transition-all text-sm flex items-center gap-2"
                        >
                            <span className="text-lg">🖼️</span> 解答画像コード
                        </Link>
                        <Link
                            to="/admin/university-data-checklist"
                            className="bg-white hover:bg-gray-50 text-navy-blue font-bold py-2.5 px-6 rounded-lg shadow-sm border border-indigo-200 transition-all text-sm flex items-center gap-2"
                        >
                            <span className="text-lg">📋</span> 大学データ確認
                        </Link>
                        <Link
                            to="/admin/university-data-coverage"
                            className="bg-white hover:bg-gray-50 text-red-600 font-bold py-2.5 px-6 rounded-lg shadow-sm border border-red-100 transition-all text-sm flex items-center gap-2"
                        >
                            <span className="text-lg">📊</span> 未実装データ可視化
                        </Link>
                        <button
                            onClick={handleBatchVocabularyExtraction}
                            disabled={batchProcessing || loading}
                            className="bg-white hover:bg-gray-50 text-indigo-600 font-bold py-2.5 px-6 rounded-lg shadow-sm border border-indigo-200 transition-all disabled:opacity-50 text-sm flex items-center gap-2"
                        >
                            <span className="text-lg">📚</span> 英単語を一括抽出
                        </button>

                        <button
                            onClick={handleBatchRemoveAsterisks}
                            disabled={batchProcessing || loading}
                            className="bg-white hover:bg-gray-50 text-amber-700 font-bold py-2.5 px-6 rounded-lg shadow-sm border border-amber-200 transition-all disabled:opacity-50 text-sm flex items-center gap-2"
                        >
                            <span className="text-lg">🧹</span> アスタリスクを一括消去
                        </button>

                        <button
                            onClick={handleBatchNormalizeChoiceLabels}
                            disabled={batchProcessing || loading}
                            className="bg-white hover:bg-gray-50 text-emerald-700 font-bold py-2.5 px-6 rounded-lg shadow-sm border border-emerald-200 transition-all disabled:opacity-50 text-sm flex items-center gap-2"
                        >
                            <span className="text-lg">✓</span> 選択肢・解答を一括補正
                        </button>

                        <button
                            onClick={handleFixSubjects}
                            disabled={loading}
                            className="bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 px-6 rounded-lg shadow transition-all flex items-center gap-2 text-sm"
                        >
                            <span className="text-lg">🔧</span> 青学一括公開＆コピー修復
                        </button>

                        <button
                            onClick={handleImportAogaku}
                            disabled={loading}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 px-6 rounded-lg shadow transition-all flex items-center gap-2 text-sm"
                        >
                            <span className="text-lg">🔄</span> Obsidianデータ同期(117件)
                        </button>

                        {selectedExams.size > 0 && (
                            <>
                                <button
                                    onClick={handleCrossExamAutoGenerate}
                                    disabled={batchProcessing || loading}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-lg shadow transition-colors flex items-center gap-2 animate-fade-in disabled:opacity-50"
                                >
                                    <span className="text-lg">🪄</span> 選択試験を順番AI生成 ({selectedExams.size})
                                </button>
                                <button
                                    onClick={handleBulkDelete}
                                    disabled={loading || batchProcessing}
                                    className="bg-red-500 hover:bg-red-600 text-white font-bold py-2.5 px-6 rounded-lg shadow transition-colors flex items-center gap-2 animate-fade-in disabled:opacity-50"
                                >
                                    <span className="text-lg">🗑️</span> 選択項目を削除 ({selectedExams.size})
                                </button>
                            </>
                        )}
                        <Link
                            to="/admin/exam/new"
                            className="bg-navy-blue hover:bg-navy-light text-white font-bold py-2.5 px-6 rounded-lg shadow transition-colors flex items-center gap-2"
                        >
                            <span className="text-xl">+</span> 新規試験作成
                        </Link>
                    </div>
                </div>

                {batchType === 'crossExamGenerate' && crossExamBatchStatus && (
                    <div className="mb-6 bg-white border border-indigo-100 rounded-2xl shadow-sm p-5">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div>
                                <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1">Cross Exam AI Queue</p>
                                <h2 className="text-lg font-black text-navy-blue">
                                    {crossExamBatchStatus.currentExam || '対象試験を準備中'}
                                </h2>
                                <p className="text-sm font-bold text-gray-500 mt-1">
                                    {crossExamBatchStatus.currentSection || '大問を確認中'} を処理しています
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-2xl font-black text-indigo-600">{batchProgress.current} / {batchProgress.total}</p>
                                <p className="text-[10px] font-bold text-gray-400">選択試験</p>
                            </div>
                        </div>
                        {crossExamBatchStatus.logs?.length > 0 && (
                            <div className="mt-4 grid gap-1">
                                {crossExamBatchStatus.logs.slice(0, 5).map((log, index) => (
                                    <div key={`${log}-${index}`} className="text-xs font-bold text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                                        {log}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {loading ? (
                    <div className="flex justify-center my-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navy-blue"></div>
                    </div>
                ) : activeTab === 'announcements' ? (
                    <AdminAnnouncements />
                ) : activeTab === 'feedbacks' ? (
                    <AdminFeedbacks />
                ) : activeTab === 'resultAnalytics' ? (
                    <AdminResultAnalytics />
                ) : exams.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-md p-10 text-center flex flex-col items-center gap-4">
                        <p className="text-gray-500 mb-2">登録されている試験データがありません。</p>
                        <div className="flex gap-4">
                            <button
                                onClick={handleImport}
                                className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded shadow transition-colors"
                            >
                                初期データを読み込む
                            </button>
                            <Link to="/admin/exam/new" className="bg-navy-blue hover:bg-navy-light text-white font-bold py-2 px-6 rounded shadow transition-colors">
                                新しく作成する
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div className="mt-8 space-y-12">
                        <section className="bg-white/80 backdrop-blur-sm rounded-2xl border border-indigo-100 shadow-sm p-5">
                            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                                <div>
                                    <h2 className="text-base font-black text-navy-blue">表示フィルタ</h2>
                                    <p className="text-xs font-bold text-gray-400 mt-1">
                                        表示中 {filteredExams.length} / 全{exams.length}件
                                    </p>
                                </div>
                                <button
                                    onClick={resetDashboardFilters}
                                    className="self-start lg:self-auto rounded-lg bg-gray-50 px-4 py-2 text-xs font-black text-gray-500 border border-gray-200 hover:bg-gray-100"
                                >
                                    絞り込みをリセット
                                </button>
                            </div>
                            <div className="grid md:grid-cols-2 lg:grid-cols-6 gap-3 mt-4">
                                <select
                                    value={dashboardFilters.university}
                                    onChange={(e) => updateDashboardFilter('university', e.target.value)}
                                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                                >
                                    <option value="all">全大学</option>
                                    {dashboardFilterOptions.universities.map(value => (
                                        <option key={value} value={value}>{value}</option>
                                    ))}
                                </select>
                                <select
                                    value={dashboardFilters.faculty}
                                    onChange={(e) => updateDashboardFilter('faculty', e.target.value)}
                                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                                >
                                    <option value="all">全学部・方式</option>
                                    {dashboardFilterOptions.faculties.map(value => (
                                        <option key={value} value={value}>{value}</option>
                                    ))}
                                </select>
                                <select
                                    value={dashboardFilters.subject}
                                    onChange={(e) => updateDashboardFilter('subject', e.target.value)}
                                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                                >
                                    <option value="all">全科目</option>
                                    {dashboardFilterOptions.subjects.map(value => (
                                        <option key={value} value={value}>{value}</option>
                                    ))}
                                </select>
                                <select
                                    value={dashboardFilters.year}
                                    onChange={(e) => updateDashboardFilter('year', e.target.value)}
                                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                                >
                                    <option value="all">全年度</option>
                                    {dashboardFilterOptions.years.map(value => (
                                        <option key={value} value={value}>{value}年度</option>
                                    ))}
                                </select>
                                <select
                                    value={dashboardFilters.masterStatus}
                                    onChange={(e) => updateDashboardFilter('masterStatus', e.target.value)}
                                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                                >
                                    <option value="all">全作成ステータス</option>
                                    {MASTER_STATUS_FILTER_OPTIONS.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                                <select
                                    value={dashboardFilters.publishStatus}
                                    onChange={(e) => updateDashboardFilter('publishStatus', e.target.value)}
                                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                                >
                                    <option value="all">全公開ステータス</option>
                                    {PUBLISH_STATUS_FILTER_OPTIONS.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                        </section>

                        {filteredExams.length === 0 ? (
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-10 text-center">
                                <p className="text-sm font-bold text-gray-500">条件に一致する試験データがありません。</p>
                            </div>
                        ) : groupedExams.map(([university, universityExams, dataGroups]) => {
                            return (
                            <div key={university} className="admin-section-card bg-white/50 backdrop-blur-sm rounded-lg p-6 shadow-xl shadow-indigo-100/50 border-2 border-indigo-100/30 transition-all">
                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-1.5 h-8 bg-navy-blue rounded-full"></div>
                                    <h2 className="text-2xl font-black text-navy-blue tracking-tight">
                                        {university}
                                        <span className="ml-3 text-xs font-bold text-navy-blue/40 bg-navy-blue/5 px-3 py-1 rounded-full align-middle">
                                            {universityExams.length} 件
                                        </span>
                                    </h2>
                                </div>
                                <div className="mobile-scroll-x overflow-x-auto">
                                    <table className="min-w-full border-separate border-spacing-y-2">
                                        <thead>
                                            <tr className="text-navy-blue/40 font-black text-[10px] uppercase tracking-[0.2em]">
                                                <th className="px-6 py-2 text-center">
                                                    <input 
                                                        type="checkbox" 
                                                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                        checked={universityExams.length > 0 && universityExams.every(e => selectedExams.has(e.id))}
                                                        onChange={() => handleSelectAll(universityExams)}
                                                    />
                                                </th>
                                                <th className="px-6 py-2 text-left">学部 / ID</th>
                                                <th className="px-6 py-2 text-left">年度・科目</th>
                                                <th className="px-6 py-2 text-center whitespace-nowrap">問題数</th>
                                                <th className="px-6 py-2 text-center whitespace-nowrap">配点合計</th>
                                                <th className="px-6 py-2 text-center whitespace-nowrap">採点基準</th>
                                                <th className="px-6 py-2 text-center whitespace-nowrap">小問解説</th>
                                                <th className="px-6 py-2 text-center whitespace-nowrap">詳細解説</th>
                                                <th className="px-6 py-2 text-center whitespace-nowrap">公開設定</th>
                                                <th className="px-6 py-2 text-center whitespace-nowrap">ステータス</th>
                                                <th className="px-6 py-2 text-center whitespace-nowrap">未実装項目</th>
                                                <th className="px-6 py-2 text-left">共有メモ</th>
                                                <th className="px-6 py-2 text-right">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dataGroups.map((dataGroup) => {
                                                const completedCount = dataGroup.exams.filter(exam => normalizeMasterStatus(exam.master_status) === 'completed').length;
                                                const verifiedCount = dataGroup.exams.filter(exam => normalizeMasterStatus(exam.master_status) === 'verified').length;
                                                const productionCount = dataGroup.exams.filter(exam => normalizeMasterStatus(exam.master_status) === 'production').length;
                                                const publishedCount = dataGroup.exams.filter(exam => exam.is_published).length;
                                                return (
                                                    <React.Fragment key={dataGroup.groupKey}>
                                                        <tr>
                                                            <td colSpan="13" className="px-3 pt-4 pb-1">
                                                                <div className="flex items-center justify-between gap-4 rounded-xl border border-indigo-100 bg-indigo-50/80 px-4 py-2">
                                                                    <div className="flex items-center gap-2 min-w-0">
                                                                        <span className="inline-block w-1 h-5 rounded-full bg-indigo-500"></span>
                                                                        <span className="truncate text-sm font-black text-navy-blue">{dataGroup.label}</span>
                                                                    </div>
                                                                    <span className="text-[10px] font-black text-indigo-500 whitespace-nowrap">
                                                                        {dataGroup.exams.length}件
                                                                        <span className="ml-2 text-indigo-400">{formatQuestionCounts(dataGroup.exams, examStats)}</span>
                                                                        <span className="ml-2 text-indigo-400">完成 {completedCount}・検証済 {verifiedCount}・本番 {productionCount}・公開 {publishedCount}</span>
                                                                    </span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                        {dataGroup.exams.map((exam) => {
                                                const stats = examStats[exam.id];
                                                const criteriaStats = stats?.criteria || null;
                                                const pointStats = stats?.points || null;
                                                const explanationStats = stats?.explanations || null;
                                                const detailedExplanationStats = stats?.detailedExplanations || null;
                                                const hasMissingCriteria = Boolean(criteriaStats?.missing > 0);
                                                const hasPointMismatch = Boolean(pointStats?.isMismatch);
                                                const hasMissingExplanation = Boolean(explanationStats?.missing > 0);
                                                const hasMissingDetailedExplanation = Boolean(detailedExplanationStats?.missing > 0);
                                                const currentMasterStatus = normalizeMasterStatus(exam.master_status);
                                                return (
                                                <tr key={exam.id} className={`group hover:-translate-y-0.5 transition-all duration-300 ${exam.is_completed ? 'opacity-70 hover:opacity-100' : ''} ${selectedExams.has(exam.id) ? 'bg-indigo-50/50' : ''} ${hasMissingCriteria || hasPointMismatch || hasMissingExplanation || hasMissingDetailedExplanation ? 'ring-2 ring-red-100 rounded-2xl' : ''}`}>
                                                    {/* Checkbox */}
                                                    <td className="bg-white px-3 py-2 rounded-l-2xl border-y-2 border-l-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm text-center">
                                                        <input 
                                                            type="checkbox" 
                                                            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                                            checked={selectedExams.has(exam.id)}
                                                            onChange={() => handleToggleSelect(exam.id)}
                                                        />
                                                    </td>
                                                    {/* Faculty & ID */}
                                                    <td className="bg-white px-3 py-2 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm min-w-[280px]">
                                                        <div className="flex flex-col">
                                                            {editingFacultyId === exam.id ? (
                                                                <input
                                                                    type="text"
                                                                    value={facultyDraft}
                                                                    autoFocus
                                                                    onChange={(e) => setFacultyDraft(e.target.value)}
                                                                    onBlur={() => saveFacultyEdit(exam)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') {
                                                                            e.preventDefault();
                                                                            e.currentTarget.blur();
                                                                        }
                                                                        if (e.key === 'Escape') {
                                                                            e.preventDefault();
                                                                            cancelFacultyEdit();
                                                                        }
                                                                    }}
                                                                    className="w-full rounded-md border border-indigo-200 bg-indigo-50/40 px-2 py-1 text-base font-black text-navy-blue leading-tight outline-none focus:border-indigo-500 focus:bg-white"
                                                                />
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => beginFacultyEdit(exam)}
                                                                    className="text-left text-base font-black text-navy-blue leading-tight hover:text-indigo-600 hover:underline decoration-indigo-300 underline-offset-4"
                                                                    title="クリックして学部名を編集"
                                                                >
                                                                    {exam.faculty}
                                                                </button>
                                                            )}
                                                            <span className="text-[10px] font-mono mt-1 text-gray-300"># {exam.id}</span>
                                                        </div>
                                                    </td>

                                            {/* Year & Subject */}
                                            <td className="bg-white px-3 py-2 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm min-w-[130px]">
                                                <div className="flex flex-col whitespace-nowrap">
                                                    <div className="flex items-center gap-2 whitespace-nowrap">
                                                        <span className="text-sm font-black bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded whitespace-nowrap">{exam.year}年度</span>
                                                        {exam.pdf_path && (
                                                            <a href={exam.pdf_path} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-green-600 hover:text-green-800 inline-flex items-center gap-1 transition-colors whitespace-nowrap">
                                                                📄 PDF
                                                            </a>
                                                        )}
                                                    </div>
                                                    <span className="text-base font-bold text-gray-700 mt-1">{exam.subject}</span>
                                                </div>
                                            </td>

                                            {/* Question Count */}
                                            <td className="bg-white px-3 py-2 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm text-center">
                                                <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 min-w-[70px]">
                                                    <span className="text-[10px] font-black text-slate-600">
                                                        {pointStats ? `${pointStats.questionCount}問` : statsLoading ? '確認中' : '未確認'}
                                                    </span>
                                                    <span className="text-[9px] font-bold text-slate-300 mt-0.5">小問</span>
                                                </div>
                                            </td>

                                            {/* Point Total Status */}
                                            <td className="bg-white px-3 py-2 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm text-center">
                                                {!pointStats ? (
                                                    <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-gray-50 border border-gray-100 min-w-[86px]">
                                                        <span className="text-[10px] font-black text-gray-400">{statsLoading ? '確認中' : '未確認'}</span>
                                                        <span className="text-[9px] font-bold text-gray-300 mt-0.5">-</span>
                                                    </div>
                                                ) : !pointStats.canCompare ? (
                                                    <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-gray-50 border border-gray-100 min-w-[86px]">
                                                        <span className="text-[10px] font-black text-gray-400">未生成</span>
                                                        <span className="text-[9px] font-bold text-gray-300 mt-0.5">{pointStats.questionCount}問</span>
                                                    </div>
                                                ) : pointStats.isMismatch ? (
                                                    <Link
                                                        to={`/admin/exam/${exam.id}`}
                                                        className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-red-50 border border-red-200 hover:bg-red-100 transition-colors min-w-[86px]"
                                                        title={`生成問題の合計点が満点と一致していません。差分: ${pointStats.diff > 0 ? '+' : ''}${pointStats.diff}点`}
                                                    >
                                                        <span className="text-[10px] font-black text-red-600">要確認</span>
                                                        <span className="text-[9px] font-bold text-red-500 mt-0.5">{pointStats.generatedTotal}/{pointStats.maxScore}点</span>
                                                    </Link>
                                                ) : (
                                                    <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 min-w-[86px]">
                                                        <span className="text-[10px] font-black text-emerald-700">一致</span>
                                                        <span className="text-[9px] font-bold text-emerald-500 mt-0.5">{pointStats.generatedTotal}/{pointStats.maxScore}点</span>
                                                    </div>
                                                )}
                                            </td>

                                            {/* Grading Criteria Status */}
                                            <td className="bg-white px-3 py-2 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm text-center">
                                                {!criteriaStats ? (
                                                    <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-gray-50 border border-gray-100 min-w-[78px]">
                                                        <span className="text-[10px] font-black text-gray-400">{statsLoading ? '確認中' : '未確認'}</span>
                                                        <span className="text-[9px] font-bold text-gray-300 mt-0.5">-</span>
                                                    </div>
                                                ) : criteriaStats.required === 0 ? (
                                                    <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-gray-50 border border-gray-100 min-w-[78px]">
                                                        <span className="text-[10px] font-black text-gray-400">不要</span>
                                                        <span className="text-[9px] font-bold text-gray-300 mt-0.5">記述なし</span>
                                                    </div>
                                                ) : criteriaStats.missing === 0 ? (
                                                    <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 min-w-[78px]">
                                                        <span className="text-[10px] font-black text-emerald-700">作成済み</span>
                                                        <span className="text-[9px] font-bold text-emerald-500 mt-0.5">{criteriaStats.completed}/{criteriaStats.required}問</span>
                                                    </div>
                                                ) : (
                                                    <Link
                                                        to={`/admin/exam/${exam.id}`}
                                                        className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-red-50 border border-red-200 hover:bg-red-100 transition-colors min-w-[78px]"
                                                        title="採点基準が未作成の問題があります。編集画面で採点基準を入力してください。"
                                                    >
                                                        <span className="text-[10px] font-black text-red-600">要作成</span>
                                                        <span className="text-[9px] font-bold text-red-500 mt-0.5">未 {criteriaStats.missing}/{criteriaStats.required}問</span>
                                                    </Link>
                                                )}
                                            </td>

                                            {/* Question Explanation Status */}
                                            <td className="bg-white px-3 py-2 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm text-center">
                                                {!explanationStats ? (
                                                    <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-gray-50 border border-gray-100 min-w-[78px]">
                                                        <span className="text-[10px] font-black text-gray-400">{statsLoading ? '確認中' : '未確認'}</span>
                                                        <span className="text-[9px] font-bold text-gray-300 mt-0.5">-</span>
                                                    </div>
                                                ) : explanationStats.required === 0 ? (
                                                    <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-gray-50 border border-gray-100 min-w-[78px]">
                                                        <span className="text-[10px] font-black text-gray-400">未生成</span>
                                                        <span className="text-[9px] font-bold text-gray-300 mt-0.5">小問なし</span>
                                                    </div>
                                                ) : explanationStats.missing === 0 ? (
                                                    <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 min-w-[78px]">
                                                        <span className="text-[10px] font-black text-emerald-700">作成済み</span>
                                                        <span className="text-[9px] font-bold text-emerald-500 mt-0.5">{explanationStats.completed}/{explanationStats.required}問</span>
                                                    </div>
                                                ) : (
                                                    <Link
                                                        to={`/admin/exam/${exam.id}`}
                                                        className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-red-50 border border-red-200 hover:bg-red-100 transition-colors min-w-[78px]"
                                                        title="小問解説が未入力の小問があります。編集画面で小問解説を生成・入力してください。"
                                                    >
                                                        <span className="text-[10px] font-black text-red-600">要作成</span>
                                                        <span className="text-[9px] font-bold text-red-500 mt-0.5">未 {explanationStats.missing}/{explanationStats.required}問</span>
                                                    </Link>
                                                )}
                                            </td>

                                            {/* Detailed Explanation Status */}
                                            <td className="bg-white px-3 py-2 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm text-center">
                                                {!detailedExplanationStats ? (
                                                    <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-gray-50 border border-gray-100 min-w-[78px]">
                                                        <span className="text-[10px] font-black text-gray-400">{statsLoading ? '確認中' : '未確認'}</span>
                                                        <span className="text-[9px] font-bold text-gray-300 mt-0.5">-</span>
                                                    </div>
                                                ) : detailedExplanationStats.required === 0 ? (
                                                    <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-gray-50 border border-gray-100 min-w-[78px]">
                                                        <span className="text-[10px] font-black text-gray-400">未生成</span>
                                                        <span className="text-[9px] font-bold text-gray-300 mt-0.5">大問なし</span>
                                                    </div>
                                                ) : detailedExplanationStats.missing === 0 ? (
                                                    <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 min-w-[78px]">
                                                        <span className="text-[10px] font-black text-emerald-700">作成済み</span>
                                                        <span className="text-[9px] font-bold text-emerald-500 mt-0.5">{detailedExplanationStats.completed}/{detailedExplanationStats.required}問</span>
                                                    </div>
                                                ) : (
                                                    <Link
                                                        to={`/admin/exam/${exam.id}`}
                                                        className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-lg bg-red-50 border border-red-200 hover:bg-red-100 transition-colors min-w-[78px]"
                                                        title="大問全体の詳細解説が未入力の大問があります。編集画面で詳細解説を生成・入力してください。"
                                                    >
                                                        <span className="text-[10px] font-black text-red-600">要作成</span>
                                                        <span className="text-[9px] font-bold text-red-500 mt-0.5">未 {detailedExplanationStats.missing}/{detailedExplanationStats.required}問</span>
                                                    </Link>
                                                )}
                                            </td>
                                             
                                            {/* Publish Toggle */}
                                            <td className="bg-white px-3 py-2 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm text-center">
                                                <button
                                                    onClick={() => handleTogglePublish(exam.id, exam.is_published)}
                                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                                                        exam.is_published ? 'bg-indigo-600' : 'bg-gray-200'
                                                    }`}
                                                >
                                                    <span
                                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                                            exam.is_published ? 'translate-x-6' : 'translate-x-1'
                                                        }`}
                                                    />
                                                </button>
                                                <div className={`text-[9px] mt-1 font-black ${exam.is_published ? 'text-indigo-600' : 'text-gray-400'}`}>
                                                    {exam.is_published ? '公開中' : '非公開'}
                                                </div>
                                            </td>

                                            {/* Status Badge */}
                                            <td className="bg-white px-3 py-2 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm text-center">
                                                <button
                                                    onClick={() => handleCycleStatus(exam.id, exam.master_status)}
                                                    className={`px-2 py-1 text-[9px] font-black rounded-full transition-all flex items-center justify-center mx-auto gap-1 border-2 whitespace-nowrap ${
                                                        currentMasterStatus === 'production'
                                                        ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 hover:border-red-300 shadow-sm'
                                                        : currentMasterStatus === 'verified'
                                                        ? 'bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 shadow-sm'
                                                        : currentMasterStatus === 'completed'
                                                        ? 'bg-green-50 text-green-600 border-green-200 hover:bg-green-100 hover:border-green-300' 
                                                        : 'bg-gray-50 text-gray-400 border-gray-100 hover:bg-gray-100 hover:text-gray-500'
                                                    }`}
                                                >
                                                    {currentMasterStatus === 'production' ? (
                                                        <><span className="text-[12px]">🚀</span>本番用</>
                                                    ) : currentMasterStatus === 'verified' ? (
                                                        <><span className="text-[12px]">💎</span>検証済み</>
                                                    ) : currentMasterStatus === 'completed' ? (
                                                        <><span className="text-[12px]">✨</span>完成</>
                                                    ) : (
                                                        <><span className="text-[12px]">✏️</span>未完成</>
                                                    )}
                                                </button>
                                            </td>

                                            {/* Unimplemented Status */}
                                            <td className="bg-white px-3 py-2 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm min-w-[180px]">
                                                <div className="flex flex-nowrap gap-1 justify-center mx-auto">
                                                    {[
                                                        { id: 'detailed', label: '詳細' },
                                                        { id: 'question', label: '小問' },
                                                        { id: 'points', label: '配点' },
                                                        { id: 'criteria', label: '基準' },
                                                        { id: 'passing', label: '合格' },
                                                        { id: 'other', label: '他' }
                                                    ].map(item => {
                                                        const isActive = (exam.unimplemented_items || []).includes(item.id);
                                                        return (
                                                            <button
                                                                key={item.id}
                                                                onClick={() => handleToggleUnimplemented(exam.id, item.id, exam.unimplemented_items)}
                                                                className={`text-[9px] w-7 h-7 rounded-full border-2 transition-all duration-300 font-bold flex items-center justify-center ${isActive
                                                                    ? 'bg-red-500 text-white border-red-500 shadow-md'
                                                                    : 'bg-white text-gray-200 border-gray-100 hover:border-red-200 hover:text-red-400'
                                                                    }`}
                                                                title={item.label}
                                                            >
                                                                {item.label}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </td>

                                            {/* Admin Comment */}
                                            <td className="bg-white px-3 py-2 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm">
                                                <textarea
                                                    defaultValue={exam.admin_comment || ''}
                                                    onBlur={(e) => {
                                                        if (e.target.value !== (exam.admin_comment || '')) {
                                                            handleCommentUpdate(exam.id, e.target.value);
                                                        }
                                                    }}
                                                    placeholder="共有メモ..."
                                                    className="w-full text-[10px] p-1.5 bg-yellow-50/20 border-b border-yellow-200/50 focus:border-navy-blue focus:bg-white transition-all resize-none h-8 outline-none"
                                                />
                                            </td>

                                            {/* Actions */}
                                            <td className="bg-white px-3 py-2 rounded-r-2xl border-y-2 border-r-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm min-w-[120px]">
                                                <div className="flex flex-col gap-0.5 w-28 ml-auto">
                                                    <button onClick={() => handlePreview(exam)} className="w-full py-0.5 text-[9px] font-black bg-navy-blue text-white rounded shadow hover:bg-navy-light transition-colors whitespace-nowrap">
                                                        プレビュー
                                                    </button>
                                                    <button onClick={() => handleEditLayout(exam)} className="w-full py-0.5 text-[9px] font-black bg-indigo-500 text-white rounded shadow hover:bg-indigo-600 transition-colors whitespace-nowrap">
                                                        🎨 レイアウト編集
                                                    </button>
                                                    <div className="flex gap-1">
                                                        <Link to={`/admin/exam/${exam.id}`} className="flex-1 py-0.5 text-[9px] font-bold bg-gray-50 text-gray-600 rounded border border-gray-100 hover:bg-gray-100 text-center">
                                                            編集
                                                        </Link>
                                                        <button onClick={() => handleCopy(exam)} className="flex-1 py-0.5 text-[9px] font-bold bg-indigo-50 text-indigo-600 rounded border border-indigo-100 hover:bg-indigo-600 hover:text-white transition-colors">
                                                            複
                                                        </button>
                                                        <button onClick={() => handleDelete(exam)} className="flex-1 py-0.5 text-[9px] font-bold bg-red-50 text-red-500 rounded border border-red-100 hover:bg-red-500 hover:text-white transition-colors">
                                                            削
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                                </tr>
                                            );
                                                        })}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

export default AdminDashboard;
