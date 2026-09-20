import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { getAdminExamsWithStructure, updateAdminFields } from '../services/adminExamService';
import {
    consultScoringElements,
    transformRubricToScoringElements,
    generateEssayModelAnswer
} from '../services/adminGeminiService';
import { ensureEssayCharacterCountElement } from '../utils/questionTypeNormalizer';
import { geminiQueue } from '../utils/promiseQueue';

const scoringModalStyles = {
    overlay: {
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.2s ease-out'
    },
    shell: {
        width: 'min(1100px, 96vw)',
        height: 'min(860px, 92vh)',
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid #e2e8f0'
    },
    header: {
        flexShrink: 0
    },
    body: {
        flex: 1,
        minHeight: 0
    },
    pane: {
        minHeight: 0
    },
    footer: {
        flexShrink: 0
    }
};

const normalizeScoringElement = (el, idx = 0) => {
    if (!el || typeof el !== 'object') {
        return {
            id: `e${idx + 1}`,
            description: '',
            points: 1,
            allowPartial: false,
            type: 'content',
            minChars: '',
            maxChars: '',
            forceZeroOnFail: false
        };
    }
    return {
        id: el.id || `e${idx + 1}`,
        description: el.description || '',
        points: Number.isFinite(Number(el.points)) ? Number(el.points) : 1,
        allowPartial: Boolean(el.allowPartial),
        type: el.type || 'content',
        minChars: el.minChars != null && el.minChars !== '' ? Number(el.minChars) : '',
        maxChars: el.maxChars != null && el.maxChars !== '' ? Number(el.maxChars) : '',
        forceZeroOnFail: Boolean(el.forceZeroOnFail)
    };
};

const normalizeScoringElements = (value) => {
    return Array.isArray(value)
        ? value.map(normalizeScoringElement)
        : [];
};

const resolveSourceFiles = (item) => {
    const { section, pdfPath } = item || {};
    const savedQuestionPath = section?.question_pdf_path;
    const savedAnswerPath = section?.answer_pdf_path;

    const qFiles = savedQuestionPath ? [savedQuestionPath] : (pdfPath ? [pdfPath] : []);
    const aFiles = savedAnswerPath ? [savedAnswerPath] : [];

    return { questionFiles: qFiles, answerFiles: aFiles };
};

export default function AdminRubricLab() {
    const [exams, setExams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(null);
    const [savingStates, setSavingStates] = useState({});

    // Filters
    const [universityFilter, setUniversityFilter] = useState('all');
    const [yearFilter, setYearFilter] = useState('all');
    const [subjectFilter, setSubjectFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');

    // AI Generation states
    const [essayModelAnswerLoading, setEssayModelAnswerLoading] = useState({});
    const [essayModelAnswerPreview, setEssayModelAnswerPreview] = useState(null);

    // Scoring Modal states
    const [activeScoringEditor, setActiveScoringEditor] = useState(null);
    const [aiChats, setAiChats] = useState({});
    const [chatInputs, setChatInputs] = useState({});
    const [chatLoading, setChatLoading] = useState({});

    useEffect(() => {
        loadExams();
    }, []);

    const loadExams = async () => {
        setLoading(true);
        setFetchError(null);
        try {
            const { data, error } = await getAdminExamsWithStructure();
            if (error) {
                console.error('Supabase error loading exams:', error);
                setFetchError(error.message || 'データ取得エラー');
                setExams([]);
                return;
            }
            setExams(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load exams:', err);
            setFetchError(err.message || 'データ取得エラー');
        } finally {
            setLoading(false);
        }
    };

    // Extract all essay questions across all exams
    const essayItems = useMemo(() => {
        const items = [];
        (exams || []).forEach((exam) => {
            if (!exam) return;
            const structure = Array.isArray(exam.structure) ? exam.structure : [];
            structure.forEach((section, sectionIdx) => {
                if (!section) return;
                const questions = Array.isArray(section.questions) ? section.questions : [];
                questions.forEach((q, qIdx) => {
                    if (!q) return;
                    if (q.type === 'essay') {
                        items.push({
                            examId: exam.id,
                            examTitle: `${exam.year || ''}年 ${exam.university || ''} ${exam.faculty || ''} ${exam.subject || ''}`.trim(),
                            university: exam.university || '',
                            faculty: exam.faculty || '',
                            year: String(exam.year || ''),
                            subject: exam.subject || '',
                            subjectEn: exam.subject_en || 'english',
                            pdfPath: exam.pdf_path || '',
                            sectionIdx,
                            sectionId: section.id,
                            sectionLabel: section.label || `第${section.id || sectionIdx + 1}問`,
                            sectionInstruction: section.instruction || '',
                            sectionAnalysis: section.sectionAnalysis || '',
                            sectionQuestionType: section.questionType || '',
                            sectionQuestions: section.questions || [],
                            section,
                            qIdx,
                            question: q,
                            itemKey: `${exam.id}_${sectionIdx}_${qIdx}`
                        });
                    }
                });
            });
        });
        return items;
    }, [exams]);

    const universities = useMemo(() => {
        const list = [...new Set(essayItems.map(i => i.university).filter(Boolean))];
        return list.sort();
    }, [essayItems]);

    const years = useMemo(() => {
        const list = [...new Set(essayItems.map(i => i.year).filter(Boolean))];
        return list.sort().reverse();
    }, [essayItems]);

    const subjects = useMemo(() => {
        const list = [...new Set(essayItems.map(i => i.subject).filter(Boolean))];
        return list.sort();
    }, [essayItems]);

    const stats = useMemo(() => {
        let missing = 0;
        let completed = 0;
        let mismatch = 0;
        let noMemo = 0;

        essayItems.forEach(item => {
            const q = item.question;
            const elements = normalizeScoringElements(q.scoringElements);
            if (!q.adminMemo?.trim()) noMemo++;
            if (elements.length === 0) {
                missing++;
            } else {
                const totalPoints = elements
                    .filter(el => el.type !== 'force_zero')
                    .reduce((sum, el) => sum + (el.type === 'deduction' ? -Math.abs(Number(el.points) || 0) : Number(el.points) || 0), 0);
                const limit = Number(q.points) || 0;
                if (totalPoints === limit || (limit > 0 && totalPoints > limit)) {
                    completed++;
                } else {
                    mismatch++;
                }
            }
        });

        return {
            total: essayItems.length,
            missing,
            completed,
            mismatch,
            noMemo
        };
    }, [essayItems]);

    const filteredItems = useMemo(() => {
        return essayItems.filter(item => {
            if (universityFilter !== 'all' && item.university !== universityFilter) return false;
            if (yearFilter !== 'all' && item.year !== yearFilter) return false;
            if (subjectFilter !== 'all' && item.subject !== subjectFilter) return false;

            const q = item.question;
            const elements = normalizeScoringElements(q.scoringElements);
            const totalPoints = elements
                .filter(el => el.type !== 'force_zero')
                .reduce((sum, el) => sum + (el.type === 'deduction' ? -Math.abs(Number(el.points) || 0) : Number(el.points) || 0), 0);
            const limit = Number(q.points) || 0;
            const isMissing = elements.length === 0;
            const isMismatch = elements.length > 0 && totalPoints !== limit && !(limit > 0 && totalPoints > limit);

            if (statusFilter === 'missing' && !isMissing) return false;
            if (statusFilter === 'mismatch' && !isMismatch) return false;
            if (statusFilter === 'completed' && (isMissing || isMismatch)) return false;
            if (statusFilter === 'no_memo' && q.adminMemo?.trim()) return false;
            if (statusFilter === 'no_rubric' && elements.length > 0) return false;

            if (searchQuery.trim()) {
                const query = searchQuery.toLowerCase();
                const text = [
                    item.examTitle,
                    item.sectionLabel,
                    q.id,
                    q.label,
                    q.correctAnswer,
                    q.adminMemo,
                    elements.map(e => e.description).join(' ')
                ].join(' ').toLowerCase();
                if (!text.includes(query)) return false;
            }

            return true;
        });
    }, [essayItems, universityFilter, yearFilter, subjectFilter, statusFilter, searchQuery]);

    const updateQuestionData = (examId, sectionIdx, qIdx, field, value) => {
        setExams(prevExams => {
            return prevExams.map(exam => {
                if (exam.id !== examId) return exam;
                const newStructure = JSON.parse(JSON.stringify(exam.structure || []));
                if (newStructure[sectionIdx]?.questions?.[qIdx]) {
                    newStructure[sectionIdx].questions[qIdx][field] = value;
                }
                return { ...exam, structure: newStructure };
            });
        });
    };

    const handleSaveItem = async (item) => {
        const { examId, sectionIdx, qIdx } = item;
        const exam = exams.find(e => e.id === examId);
        if (!exam) return;

        const saveKey = `${examId}_${sectionIdx}_${qIdx}`;
        setSavingStates(prev => ({ ...prev, [saveKey]: 'saving' }));

        try {
            await updateAdminFields(examId, { structure: exam.structure });
            setSavingStates(prev => ({ ...prev, [saveKey]: 'saved' }));
            setTimeout(() => {
                setSavingStates(prev => {
                    const next = { ...prev };
                    delete next[saveKey];
                    return next;
                });
            }, 3000);
        } catch (error) {
            console.error('Save failed:', error);
            alert('保存に失敗しました: ' + error.message);
            setSavingStates(prev => ({ ...prev, [saveKey]: 'error' }));
        }
    };

    const handleGenerateModelAnswer = async (item, mode = 'with_original') => {
        const { examId, sectionIdx, qIdx, question } = item;
        const currentExam = exams.find(e => e.id === examId);
        const currentQ = currentExam?.structure?.[sectionIdx]?.questions?.[qIdx] || question;

        const scoringElements = Array.isArray(currentQ.scoringElements) ? currentQ.scoringElements : [];
        const gradingInstruction = String(currentQ.gradingInstruction || '').trim();
        if (scoringElements.length === 0 && !gradingInstruction) {
            alert('採点基準（scoringElements または 採点指示）が設定されていません。\n先に「✨ 採点要素・AIアシスタント」で採点基準を作成してください。');
            return;
        }

        if (mode === 'with_original' && !String(currentQ.correctAnswer || '').trim()) {
            alert('元々の模範解答が入力されていません。\n「🌱 模範解答B（基準＋本文のみ）」をご利用ください。');
            return;
        }

        const loadingKey = `${examId}_${sectionIdx}_${qIdx}`;
        setEssayModelAnswerLoading(prev => ({ ...prev, [loadingKey]: mode }));

        try {
            const { questionFiles, answerFiles } = resolveSourceFiles(item);

            const examMeta = {
                university: item.university,
                faculty: item.faculty,
                subject: item.subject,
                year: item.year
            };

            const sectionContext = {
                sectionId: item.sectionId,
                sectionLabel: item.sectionLabel,
                instruction: item.sectionInstruction,
                sectionAnalysis: item.sectionAnalysis,
                questionType: item.sectionQuestionType,
                questions: (item.sectionQuestions || []).map(q => ({
                    id: q.id,
                    label: q.label,
                    points: q.points
                }))
            };

            const result = await geminiQueue.add(() => generateEssayModelAnswer({
                mode,
                examMeta,
                questionData: {
                    id: currentQ.id,
                    label: currentQ.label,
                    points: currentQ.points,
                    correctAnswer: currentQ.correctAnswer,
                    scoringElements: currentQ.scoringElements,
                    gradingInstruction: currentQ.gradingInstruction
                },
                sectionContext,
                questionFiles,
                answerFiles
            }));

            setEssayModelAnswerPreview({
                examId,
                sectionIdx,
                qIdx,
                questionId: currentQ.id,
                examTitle: item.examTitle,
                currentAnswer: currentQ.correctAnswer || '',
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

    const handleSendChatMessage = async (item) => {
        const { examId, sectionIdx, qIdx, question } = item;
        const chatKey = `${examId}_${sectionIdx}_${qIdx}`;
        const input = (chatInputs[chatKey] || '').trim();
        if (!input) return;

        const currentHistory = aiChats[chatKey] || [];
        const userMsg = { role: 'user', text: input };
        const updatedHistory = [...currentHistory, userMsg];

        setAiChats(prev => ({ ...prev, [chatKey]: updatedHistory }));
        setChatInputs(prev => ({ ...prev, [chatKey]: '' }));
        setChatLoading(prev => ({ ...prev, [chatKey]: true }));

        try {
            const { questionFiles, answerFiles } = resolveSourceFiles(item);
            const examMeta = {
                university: item.university,
                faculty: item.faculty,
                subject: item.subject,
                year: item.year
            };

            const sectionContext = {
                sectionId: item.sectionId,
                sectionLabel: item.sectionLabel,
                instruction: item.sectionInstruction,
                sectionAnalysis: item.sectionAnalysis,
                questionType: item.sectionQuestionType,
                questions: (item.sectionQuestions || []).map(q => ({
                    id: q.id,
                    label: q.label,
                    points: q.points
                }))
            };

            const response = await consultScoringElements(
                examMeta,
                {
                    ...question,
                    sectionContext
                },
                input,
                updatedHistory,
                questionFiles,
                answerFiles
            );

            setAiChats(prev => ({
                ...prev,
                [chatKey]: [...updatedHistory, { role: 'ai', text: response }]
            }));
        } catch (error) {
            console.error('[ScoringChat] failed:', error);
            setAiChats(prev => ({
                ...prev,
                [chatKey]: [...updatedHistory, { role: 'ai', text: `⚠️ エラー: ${error.message}` }]
            }));
        } finally {
            setChatLoading(prev => ({ ...prev, [chatKey]: false }));
        }
    };

    const handleConvertRubric = async (item) => {
        const { examId, sectionIdx, qIdx, question } = item;
        const chatKey = `${examId}_${sectionIdx}_${qIdx}`;
        const input = (chatInputs[chatKey] || '').trim();
        if (!input) return;

        const currentHistory = aiChats[chatKey] || [];
        const userMsg = { role: 'user', text: `以下の採点基準を独自採点要素に変換:\n\n${input}` };
        const updatedHistory = [...currentHistory, userMsg];

        setAiChats(prev => ({ ...prev, [chatKey]: updatedHistory }));
        setChatInputs(prev => ({ ...prev, [chatKey]: '' }));
        setChatLoading(prev => ({ ...prev, [chatKey]: true }));

        try {
            const { questionFiles, answerFiles } = resolveSourceFiles(item);
            const examMeta = {
                university: item.university,
                faculty: item.faculty,
                subject: item.subject,
                year: item.year
            };

            const sectionContext = {
                sectionId: item.sectionId,
                sectionLabel: item.sectionLabel,
                instruction: item.sectionInstruction,
                sectionAnalysis: item.sectionAnalysis,
                questionType: item.sectionQuestionType,
                questions: (item.sectionQuestions || []).map(q => ({
                    id: q.id,
                    label: q.label,
                    points: q.points
                }))
            };

            const result = await transformRubricToScoringElements(
                examMeta,
                {
                    ...question,
                    sectionContext
                },
                input,
                questionFiles,
                answerFiles
            );

            const convertedElements = normalizeScoringElements(result?.scoringElements);
            updateQuestionData(examId, sectionIdx, qIdx, 'scoringElements', convertedElements);
            if (result?.gradingInstruction) {
                updateQuestionData(examId, sectionIdx, qIdx, 'gradingInstruction', result.gradingInstruction);
            }

            setAiChats(prev => ({
                ...prev,
                [chatKey]: [...updatedHistory, {
                    role: 'ai',
                    text: `採点基準をスマサイ独自表現に変換し、採点要素 ${convertedElements.length}件として反映しました。左側で内容を確認してください。`
                }]
            }));
        } catch (error) {
            console.error('[ScoringChat] Transform failed:', error);
            setAiChats(prev => ({
                ...prev,
                [chatKey]: [...updatedHistory, { role: 'ai', text: `⚠️ 変換に失敗しました: ${error.message}` }]
            }));
        } finally {
            setChatLoading(prev => ({ ...prev, [chatKey]: false }));
        }
    };

    const renderScoringModal = () => {
        if (!activeScoringEditor) return null;

        const { item } = activeScoringEditor;
        const { examId, sectionIdx, qIdx } = item;
        const currentExam = exams.find(e => e.id === examId);
        const q = currentExam?.structure?.[sectionIdx]?.questions?.[qIdx] || item.question;

        const chatKey = `${examId}_${sectionIdx}_${qIdx}`;
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

        return createPortal(
            <div style={scoringModalStyles.overlay}>
                <div style={scoringModalStyles.shell}>
                    <div className="px-6 py-4 bg-navy-blue text-white flex justify-between items-center" style={scoringModalStyles.header}>
                        <div className="flex items-center gap-3">
                            <span className="bg-emerald-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                                Rubric Lab
                            </span>
                            <h3 className="font-black text-sm">
                                {item.examTitle} {item.sectionLabel} 問{q.id} (配点: {q.points || 0}点)
                            </h3>
                        </div>
                        <button
                            type="button"
                            onClick={() => setActiveScoringEditor(null)}
                            className="text-gray-300 hover:text-white font-bold text-xl px-2 cursor-pointer"
                        >
                            ×
                        </button>
                    </div>

                    <div className="flex-1 flex overflow-hidden" style={scoringModalStyles.body}>
                        <div className="w-1/2 overflow-y-auto p-6 border-r border-gray-100 flex flex-col gap-5" style={{ ...scoringModalStyles.pane, borderRight: '1px solid #eef2f7' }}>
                            <div>
                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">設問本文</h4>
                                <div className="p-3 bg-gray-50 rounded-xl text-xs font-bold text-navy-blue whitespace-pre-wrap leading-relaxed max-h-[90px] overflow-y-auto">
                                    {q.label || '問題文未入力'}
                                </div>
                            </div>

                            <div>
                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider">模範解答・解答例</h4>
                                    <div className="flex flex-wrap gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => handleGenerateModelAnswer(item, 'with_original')}
                                            disabled={essayModelAnswerLoading[`${examId}_${sectionIdx}_${qIdx}`]}
                                            className="text-[9px] font-black px-2.5 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-all flex items-center gap-1 shadow-sm disabled:opacity-50 cursor-pointer"
                                            title="独自採点基準＋元解答＋本文・問題文から、著作権に配慮した新模範解答を生成"
                                        >
                                            {essayModelAnswerLoading[`${examId}_${sectionIdx}_${qIdx}`] === 'with_original' ? '🔄 生成中...' : '🤖 模範解答A'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleGenerateModelAnswer(item, 'rubric_only')}
                                            disabled={essayModelAnswerLoading[`${examId}_${sectionIdx}_${qIdx}`]}
                                            className="text-[9px] font-black px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-all flex items-center gap-1 shadow-sm disabled:opacity-50 cursor-pointer"
                                            title="元解答を見ず、独自採点基準＋本文・問題文のみからゼロベースで新模範解答を生成"
                                        >
                                            {essayModelAnswerLoading[`${examId}_${sectionIdx}_${qIdx}`] === 'rubric_only' ? '🔄 生成中...' : '🌱 模範解答B'}
                                        </button>
                                    </div>
                                </div>
                                <div className="p-3 bg-gray-50 rounded-xl text-xs text-gray-600 whitespace-pre-wrap leading-relaxed max-h-[80px] overflow-y-auto font-medium">
                                    {q.correctAnswer || '解答例未入力'}
                                </div>
                            </div>

                            <div className="flex-1 flex flex-col min-h-[300px]">
                                <div className="flex justify-between items-center mb-3">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-black text-orange-700 uppercase tracking-wider">
                                            採点判定要素 ({elements.length})
                                        </span>
                                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${
                                            isExactMatch ? 'bg-green-100 text-green-700' : isCapScoring ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                                        }`}>
                                            {isExactMatch ? '一致' : isCapScoring ? '上限採点' : '不足'}: {totalPoints} / {questionPointLimit}点
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const newElements = [...elements];
                                            newElements.push({
                                                id: `e${newElements.length + 1}`,
                                                description: '',
                                                points: 1,
                                                allowPartial: false,
                                                type: 'content',
                                                minChars: '',
                                                maxChars: '',
                                                forceZeroOnFail: false
                                            });
                                            updateQuestionData(examId, sectionIdx, qIdx, 'scoringElements', newElements);
                                        }}
                                        className="text-[10px] font-black text-orange-600 hover:text-orange-800 bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-100 transition-colors cursor-pointer"
                                    >
                                        ＋ 要素を追加
                                    </button>
                                </div>

                                <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                                    {elements.length === 0 ? (
                                        <div className="text-center py-10 bg-orange-50/20 border border-dashed border-orange-100 rounded-2xl text-gray-400 text-xs flex flex-col items-center gap-2">
                                            <span className="text-2xl">📝</span>
                                            <span className="font-bold">採点要素がまだ登録されていません</span>
                                            <span className="text-[10px] text-gray-400">
                                                右側のAIアシスタントに基準を貼り付けて自動変換するか、手動で追加してください。
                                            </span>
                                        </div>
                                    ) : (
                                        elements.map((el, elIdx) => (
                                            <div key={elIdx} className="bg-white p-3.5 rounded-xl border border-orange-100 shadow-sm text-xs space-y-2.5">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono bg-orange-100 text-orange-700 font-bold px-2 py-0.5 rounded text-[10px]">{el.id}</span>
                                                    <input
                                                        type="text"
                                                        value={el.description}
                                                        onChange={(e) => {
                                                            const newElements = [...elements];
                                                            newElements[elIdx].description = e.target.value;
                                                            updateQuestionData(examId, sectionIdx, qIdx, 'scoringElements', newElements);
                                                        }}
                                                        placeholder="基準（例: 「AIが進化する理由」について具体的に言及している）"
                                                        className="flex-1 p-1.5 border border-gray-100 rounded-lg text-xs font-bold text-navy-blue outline-none focus:border-orange-300"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const newElements = elements.filter((_, idx) => idx !== elIdx);
                                                            updateQuestionData(examId, sectionIdx, qIdx, 'scoringElements', newElements);
                                                        }}
                                                        className="text-gray-300 hover:text-red-500 font-black px-1.5 text-base cursor-pointer"
                                                    >
                                                        ×
                                                    </button>
                                                </div>

                                                <div className="flex flex-wrap items-center gap-3 bg-gray-50/50 p-2 rounded-lg text-[10px]">
                                                    <label className="flex items-center gap-1 font-bold text-gray-600">
                                                        <span>配点:</span>
                                                        <input
                                                            type="number"
                                                            value={el.points}
                                                            onChange={(e) => {
                                                                const newElements = [...elements];
                                                                newElements[elIdx].points = Number(e.target.value) || 0;
                                                                updateQuestionData(examId, sectionIdx, qIdx, 'scoringElements', newElements);
                                                            }}
                                                            className="w-12 p-1 border rounded bg-white text-center font-bold text-indigo-600"
                                                        />
                                                        <span>点</span>
                                                    </label>
                                                    <label className="flex items-center gap-1 font-bold text-gray-600">
                                                        <span>タイプ:</span>
                                                        <select
                                                            value={el.type}
                                                            onChange={(e) => {
                                                                const newElements = [...elements];
                                                                newElements[elIdx].type = e.target.value;
                                                                updateQuestionData(examId, sectionIdx, qIdx, 'scoringElements', newElements);
                                                            }}
                                                            className="p-1 border rounded bg-white font-bold"
                                                        >
                                                            <option value="content">内容加点</option>
                                                            <option value="logic">論理構成</option>
                                                            <option value="character_count">文字数条件</option>
                                                            <option value="deduction">減点</option>
                                                            <option value="force_zero">強制0点</option>
                                                        </select>
                                                    </label>
                                                    <label className="flex items-center gap-1 cursor-pointer font-bold text-gray-500">
                                                        <input
                                                            type="checkbox"
                                                            checked={el.allowPartial}
                                                            onChange={(e) => {
                                                                const newElements = [...elements];
                                                                newElements[elIdx].allowPartial = e.target.checked;
                                                                updateQuestionData(examId, sectionIdx, qIdx, 'scoringElements', newElements);
                                                            }}
                                                            className="rounded"
                                                        />
                                                        <span>部分点あり</span>
                                                    </label>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="w-1/2 p-6 flex flex-col justify-between bg-white" style={scoringModalStyles.pane}>
                            <div className="flex-1 overflow-y-auto mb-4 space-y-3 pr-2">
                                <div className="text-[10px] font-black text-indigo-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <span>🤖</span> 採点基準AIアシスタント
                                </div>

                                {(!aiChats[chatKey] || aiChats[chatKey].length === 0) ? (
                                    <div className="h-[280px] flex flex-col items-center justify-center p-6 border-2 border-dashed border-indigo-100 rounded-2xl bg-indigo-50/20 text-center space-y-2">
                                        <div className="text-3xl">💡</div>
                                        <p className="font-bold text-xs text-gray-700">
                                            採点基準を貼り付けて独自採点要素に変換
                                        </p>
                                        <p className="text-[10px] text-gray-400 max-w-[300px] leading-relaxed">
                                            ネットや赤本の採点基準を下の入力欄に貼り付け、「独自化して採点要素に保存」を押すと、著作権侵害にならないスマサイ独自表現の採点要素へ自動変換されます。
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
                                            <div className="whitespace-pre-wrap font-medium leading-relaxed text-xs">{msg.text}</div>
                                        </div>
                                    ))
                                )}

                                {chatLoading[chatKey] && (
                                    <div className="flex items-center justify-center gap-2 py-4 text-indigo-500/80 text-[10px] font-black italic">
                                        <span className="animate-bounce">●</span>
                                        <span className="animate-bounce [animation-delay:0.2s]">●</span>
                                        <span className="animate-bounce [animation-delay:0.4s]">●</span>
                                        <span>AIが思考中...</span>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <textarea
                                    value={chatInputs[chatKey] || ''}
                                    onChange={(e) => setChatInputs({ ...chatInputs, [chatKey]: e.target.value })}
                                    placeholder="採点基準を貼り付けるか、AIへの相談（「要素を提案して」等）を入力してください。"
                                    rows={3}
                                    className="w-full p-3 border border-indigo-100 rounded-xl outline-none text-xs focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-white resize-y leading-relaxed"
                                    disabled={chatLoading[chatKey]}
                                />
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleConvertRubric(item)}
                                        disabled={chatLoading[chatKey] || !(chatInputs[chatKey] || '').trim()}
                                        className="bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2.5 rounded-xl disabled:opacity-40 transition-all shadow-sm cursor-pointer"
                                    >
                                        独自化して採点要素に保存
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleSendChatMessage(item)}
                                        disabled={chatLoading[chatKey] || !(chatInputs[chatKey] || '').trim()}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2.5 rounded-xl disabled:opacity-40 transition-all shadow-sm cursor-pointer"
                                    >
                                        相談として送信
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center" style={scoringModalStyles.footer}>
                        <div className="text-[11px] text-gray-500 font-medium">
                            ※モーダルを閉じても、下の問題カードの「💾 保存する」を押すまでDBには反映されません。
                        </div>
                        <button
                            type="button"
                            onClick={() => setActiveScoringEditor(null)}
                            className="bg-navy-blue text-white hover:bg-navy-blue/90 text-xs font-black px-6 py-2.5 rounded-xl shadow-md transition-all cursor-pointer"
                        >
                            完了して閉じる
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        );
    };

    const renderEssayModelAnswerPreviewModal = () => {
        if (!essayModelAnswerPreview) return null;

        const {
            examId,
            sectionIdx,
            qIdx,
            questionId,
            examTitle,
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
                <div style={{ ...scoringModalStyles.shell, width: 'min(780px, 94vw)', maxHeight: '90vh', height: 'auto' }}>
                    <div className="px-6 py-4 bg-navy-blue text-white flex justify-between items-center rounded-t-2xl">
                        <div className="flex items-center gap-3">
                            <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full text-white ${isModeA ? 'bg-indigo-600' : 'bg-emerald-600'}`}>
                                {isModeA ? '🤖 模範解答A (基準+元解答+本文)' : '🌱 模範解答B (基準+本文のみ)'}
                            </span>
                            <h3 className="font-black text-sm">
                                {examTitle} 問{questionId} AI模範解答プレビュー
                            </h3>
                        </div>
                        <button
                            type="button"
                            onClick={() => setEssayModelAnswerPreview(null)}
                            className="text-gray-300 hover:text-white font-bold text-xl px-2 cursor-pointer"
                        >
                            ×
                        </button>
                    </div>

                    <div className="p-6 overflow-y-auto space-y-5" style={{ maxHeight: 'calc(90vh - 140px)' }}>
                        {reasoning && (
                            <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl text-xs text-navy-blue leading-relaxed">
                                <div className="text-[10px] font-black text-indigo-700 uppercase tracking-wider mb-1">
                                    💡 採点基準の充足と表現の工夫
                                </div>
                                <div>{reasoning}</div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                                        現在の模範解答（元解答）
                                    </span>
                                    <span className="text-[10px] font-mono font-bold text-gray-400">
                                        {currentChars}字
                                    </span>
                                </div>
                                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600 leading-relaxed min-h-[140px] whitespace-pre-wrap font-medium">
                                    {currentAnswer || '（未入力）'}
                                </div>
                            </div>

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

                    <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3 rounded-b-2xl">
                        <button
                            type="button"
                            onClick={() => setEssayModelAnswerPreview(null)}
                            className="text-xs font-bold text-gray-500 hover:text-gray-700 px-4 py-2.5 rounded-xl transition-colors cursor-pointer"
                        >
                            キャンセル
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                updateQuestionData(examId, sectionIdx, qIdx, 'correctAnswer', draftAnswer);
                                setEssayModelAnswerPreview(null);
                            }}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black px-6 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                            <span>✓</span> この模範解答を適用する
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        );
    };

    return (
        <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-4 mb-2">
                            <Link to="/admin" className="text-sm font-bold text-navy-blue hover:underline">
                                ← 試験管理へ戻る
                            </Link>
                        </div>
                        <h1 className="text-3xl font-black text-navy-blue flex items-center gap-3">
                            🧪 採点基準ラボ
                            <span className="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded-full font-mono font-bold">
                                ESSAY RUBRIC LAB
                            </span>
                        </h1>
                        <p className="text-xs text-gray-500 font-medium mt-1">
                            全試験の自由記述問題（essay）を横断管理。独自採点要素の設計、模範解答AI生成（ボタンA・B）、DB直接保存を一元化。
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={loadExams}
                        disabled={loading}
                        className="bg-white hover:bg-gray-50 text-navy-blue text-xs font-black px-4 py-2.5 rounded-xl border border-gray-200 shadow-sm transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                        <span>🔄</span> 最新データを再読み込み
                    </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div className="bg-white border-2 border-indigo-100 rounded-xl p-4 shadow-sm text-center">
                        <div className="text-[11px] font-bold text-indigo-700">自由記述の総問数</div>
                        <div className="text-2xl font-black text-navy-blue mt-1">
                            {stats.total}<span className="text-xs text-gray-400 ml-1">問</span>
                        </div>
                    </div>
                    <div className="bg-white border-2 border-emerald-100 rounded-xl p-4 shadow-sm text-center">
                        <div className="text-[11px] font-bold text-emerald-700">採点要素設定済み</div>
                        <div className="text-2xl font-black text-emerald-800 mt-1">
                            {stats.completed}<span className="text-xs text-emerald-600 ml-1">問</span>
                        </div>
                    </div>
                    <div className="bg-white border-2 border-red-100 rounded-xl p-4 shadow-sm text-center">
                        <div className="text-[11px] font-bold text-red-600">⚠️ 要素未設定</div>
                        <div className="text-2xl font-black text-red-700 mt-1">
                            {stats.missing}<span className="text-xs text-red-500 ml-1">問</span>
                        </div>
                    </div>
                    <div className="bg-white border-2 border-amber-100 rounded-xl p-4 shadow-sm text-center">
                        <div className="text-[11px] font-bold text-amber-700">⚠️ 配点不一致</div>
                        <div className="text-2xl font-black text-amber-800 mt-1">
                            {stats.mismatch}<span className="text-xs text-amber-600 ml-1">問</span>
                        </div>
                    </div>
                    <div className="bg-white border-2 border-orange-100 rounded-xl p-4 shadow-sm text-center">
                        <div className="text-[11px] font-bold text-orange-600">📝 メモ未記入</div>
                        <div className="text-2xl font-black text-orange-700 mt-1">
                            {stats.noMemo}<span className="text-xs text-orange-500 ml-1">問</span>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl border-2 border-indigo-100/60 shadow-sm p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em]">大学</span>
                            <select
                                value={universityFilter}
                                onChange={(e) => setUniversityFilter(e.target.value)}
                                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-navy-blue outline-none focus:border-navy-blue/40 focus:bg-white"
                            >
                                <option value="all">すべての大学 ({universities.length})</option>
                                {universities.map(u => (
                                    <option key={u} value={u}>{u}</option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em]">年度</span>
                            <select
                                value={yearFilter}
                                onChange={(e) => setYearFilter(e.target.value)}
                                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-navy-blue outline-none focus:border-navy-blue/40 focus:bg-white"
                            >
                                <option value="all">すべての年度</option>
                                {years.map(y => (
                                    <option key={y} value={y}>{y}年度</option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em]">科目</span>
                            <select
                                value={subjectFilter}
                                onChange={(e) => setSubjectFilter(e.target.value)}
                                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-navy-blue outline-none focus:border-navy-blue/40 focus:bg-white"
                            >
                                <option value="all">すべての科目</option>
                                {subjects.map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em]">採点基準状態</span>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-navy-blue outline-none focus:border-navy-blue/40 focus:bg-white"
                            >
                                <option value="all">すべて</option>
                                <option value="missing">⚠️ 要素未設定のみ ({stats.missing})</option>
                                <option value="mismatch">⚠️ 配点不一致のみ ({stats.mismatch})</option>
                                <option value="completed">✓ 設定済みのみ ({stats.completed})</option>
                                <option value="no_memo">📝 メモ未記入のみ ({stats.noMemo})</option>
                                <option value="no_rubric">🚫 採点基準なし ({stats.missing})</option>
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em]">キーワード検索</span>
                            <input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="問題文・模範解答・大学名"
                                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-navy-blue outline-none focus:border-navy-blue/40 focus:bg-white"
                            />
                        </label>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs font-bold text-gray-400">
                        <span>表示中: {filteredItems.length} / 全 {essayItems.length} 問</span>
                        <button
                            type="button"
                            onClick={() => {
                                setUniversityFilter('all');
                                setYearFilter('all');
                                setSubjectFilter('all');
                                setStatusFilter('all');
                                setSearchQuery('');
                            }}
                            className="text-[11px] text-indigo-600 hover:underline cursor-pointer"
                        >
                            フィルターをリセット
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center my-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navy-blue"></div>
                    </div>
                ) : filteredItems.length === 0 ? (
                    <div className="bg-white rounded-xl p-12 text-center border border-gray-200 shadow-sm space-y-2">
                        <div className="text-4xl">🔍</div>
                        <p className="font-bold text-gray-600 text-sm">該当する自由記述問題が見つかりませんでした。</p>
                        <p className="text-xs text-gray-400">フィルター条件を変更してお試しください。</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {filteredItems.map((item) => {
                            const { examId, sectionIdx, qIdx, itemKey } = item;
                            const currentExam = exams.find(e => e.id === examId);
                            const q = currentExam?.structure?.[sectionIdx]?.questions?.[qIdx] || item.question;
                            const elements = normalizeScoringElements(q.scoringElements);

                            const totalPoints = elements
                                .filter(el => el.type !== 'force_zero')
                                .reduce((sum, el) => sum + (el.type === 'deduction' ? -Math.abs(Number(el.points) || 0) : Number(el.points) || 0), 0);
                            const limit = Number(q.points) || 0;
                            const isMissing = elements.length === 0;
                            const isExact = totalPoints === limit;
                            const isCap = limit > 0 && totalPoints > limit;

                            const statusClass = isMissing
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : isExact
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : isCap
                                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                                        : 'bg-amber-50 text-amber-700 border-amber-200';

                            const statusText = isMissing
                                ? '⚠️ 要素未設定'
                                : isExact
                                    ? `✓ 配点一致 (${totalPoints} / ${limit}点)`
                                    : isCap
                                        ? `上限採点 (${totalPoints} / ${limit}点)`
                                        : `⚠️ 配点不足 (${totalPoints} / ${limit}点)`;

                            const saveState = savingStates[itemKey];

                            return (
                                <div
                                    key={itemKey}
                                    className="bg-white rounded-2xl border-2 border-indigo-100/70 shadow-sm hover:shadow-md transition-all p-5 space-y-4"
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-gray-100">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="bg-navy-blue text-white text-[11px] font-black px-2.5 py-0.5 rounded-lg">
                                                {item.university}
                                            </span>
                                            <span className="bg-slate-100 text-slate-700 text-[11px] font-bold px-2 py-0.5 rounded-md">
                                                {item.faculty}
                                            </span>
                                            <span className="text-xs font-mono font-bold text-gray-500">
                                                {item.year}年度 {item.subject}
                                            </span>
                                            <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 text-[11px] font-black px-2 py-0.5 rounded-md">
                                                {item.sectionLabel} 問{q.id}
                                            </span>
                                            <span className="bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-black px-2 py-0.5 rounded-md">
                                                配点: {q.points || 0}点
                                            </span>
                                            <span className={`text-[11px] font-black px-2.5 py-0.5 rounded-full border ${statusClass}`}>
                                                {statusText}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <Link
                                                to={`/admin/exam/${examId}`}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-[11px] font-bold text-navy-blue hover:text-indigo-600 flex items-center gap-1"
                                            >
                                                <span>🔗</span> 試験エディタを開く ↗
                                            </Link>
                                        </div>
                                    </div>

                                    <div>
                                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">
                                            設問文
                                        </div>
                                        <div className="p-3 bg-slate-50/70 rounded-xl text-xs font-bold text-navy-blue leading-relaxed whitespace-pre-wrap max-h-[90px] overflow-y-auto">
                                            {q.label || '（設問文なし）'}
                                        </div>
                                    </div>

                                    <div>
                                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                                            📝 メモ
                                            <span className="text-[9px] font-medium text-gray-300 normal-case tracking-normal">
                                                （この問題に関する作業メモ・備考）
                                            </span>
                                        </div>
                                        <textarea
                                            value={q.adminMemo || ''}
                                            onChange={(e) => updateQuestionData(examId, sectionIdx, qIdx, 'adminMemo', e.target.value)}
                                            rows={2}
                                            className="w-full p-2.5 bg-amber-50/50 border border-amber-200/60 focus:border-amber-400 rounded-lg text-xs font-medium text-gray-700 outline-none leading-relaxed placeholder:text-gray-300"
                                            placeholder="メモを入力...（保存ボタンでDBに保存されます）"
                                        />
                                    </div>

                                    <div className="bg-indigo-50/20 border border-indigo-100/50 rounded-xl p-4 space-y-2.5">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-black text-navy-blue/70 uppercase tracking-wider">
                                                    模範解答（正解）
                                                </span>
                                                <span className="text-[10px] font-mono font-bold text-gray-400">
                                                    {Array.from(q.correctAnswer || '').length}字
                                                </span>
                                            </div>

                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => handleGenerateModelAnswer(item, 'with_original')}
                                                    disabled={essayModelAnswerLoading[itemKey]}
                                                    className="text-[10px] font-black px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-all flex items-center gap-1 shadow-sm disabled:opacity-50 cursor-pointer"
                                                    title="独自採点基準＋元解答＋本文・問題文から、著作権に配慮した新模範解答を生成"
                                                >
                                                    {essayModelAnswerLoading[itemKey] === 'with_original' ? '🔄 生成中...' : '🤖 模範解答A (基準+元解答+本文)'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleGenerateModelAnswer(item, 'rubric_only')}
                                                    disabled={essayModelAnswerLoading[itemKey]}
                                                    className="text-[10px] font-black px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-all flex items-center gap-1 shadow-sm disabled:opacity-50 cursor-pointer"
                                                    title="元解答を見ず、独自採点基準＋本文・問題文のみからゼロベースで新模範解答を生成"
                                                >
                                                    {essayModelAnswerLoading[itemKey] === 'rubric_only' ? '🔄 生成中...' : '🌱 模範解答B (基準+本文のみ)'}
                                                </button>
                                            </div>
                                        </div>

                                        <textarea
                                            value={q.correctAnswer || ''}
                                            onChange={(e) => updateQuestionData(examId, sectionIdx, qIdx, 'correctAnswer', e.target.value)}
                                            rows={3}
                                            className="w-full p-2.5 bg-white border border-gray-200 focus:border-indigo-400 rounded-lg text-xs font-bold text-navy-blue outline-none leading-relaxed"
                                            placeholder="模範解答を入力または上記のAIボタンで生成"
                                        />
                                    </div>

                                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">
                                                設定中の要素: {elements.length}件
                                            </span>
                                            {elements.slice(0, 3).map((el, i) => (
                                                <span key={i} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium max-w-[200px] truncate">
                                                    {el.id}: {el.description}
                                                </span>
                                            ))}
                                            {elements.length > 3 && (
                                                <span className="text-[10px] text-gray-400 font-bold">
                                                    他 {elements.length - 3}件
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2.5">
                                            <button
                                                type="button"
                                                onClick={() => setActiveScoringEditor({ item })}
                                                className="text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 px-3.5 py-1.5 rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                                            >
                                                ✨ 採点要素・AIアシスタントを開く
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => handleSaveItem(item)}
                                                disabled={saveState === 'saving'}
                                                className={`text-[10px] font-black px-4 py-1.5 rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer ${
                                                    saveState === 'saved'
                                                        ? 'bg-emerald-600 text-white'
                                                        : saveState === 'saving'
                                                            ? 'bg-gray-200 text-gray-500'
                                                            : 'bg-navy-blue hover:bg-navy-blue/90 text-white'
                                                }`}
                                            >
                                                {saveState === 'saving' ? '保存中...' : saveState === 'saved' ? '✓ 保存完了' : '💾 この小問をDB保存'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {renderScoringModal()}
            {renderEssayModelAnswerPreviewModal()}
        </div>
    );
}
