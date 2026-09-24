import React, { useRef, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabaseClient';
import { gradeExamWithGemini } from '../services/geminiService';
import UsageLimitCard from '../components/UsageLimitCard';
import AdBanner from '../components/AdBanner';
import { consumeGradingUsage, getGradingUsageStatus, getPlanFeatures, getUserPlan, isLaunchPremiumAccessActive } from '../services/usageLimitService';
import { MARKETING_CONFIG } from '../config/marketingConfig';
import {
    FREE_ACCESS_PROMO_CODE,
    getUserGradingCount,
    getUserPromoVerified,
    incrementLocalGradedCount,
    isValidFreeAccessPromoCode,
    markUserPromoVerified
} from '../services/promoCodeService';
import {
    KANJI_SELF_GRADE_CORRECT,
    KANJI_SELF_GRADE_WRONG,
    isKanjiSelfGradingQuestion
} from '../utils/kanjiSelfGrading';

const PreGradingPremiumHint = ({ usage, planFeatures, onPremiumClick }) => {
    if (!usage || planFeatures.unlimitedGrading || usage.plan !== 'free') return null;

    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', margin: '-0.75rem 0 1.5rem' }}>
            <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 700 }}>
                今月あと{Math.max(Number(usage.remaining || 0), 0)}回
            </span>
            <button
                type="button"
                onClick={onPremiumClick}
                style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#b45309',
                    fontSize: '0.82rem',
                    fontWeight: 900,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0
                }}
            >
                無制限にする
            </button>
        </div>
    );
};

const ExamPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, profile, loading: authLoading } = useAuth();
    const [exam, setExam] = useState(null);
    const [universityName, setUniversityName] = useState('');
    const [universityId, setUniversityId] = useState('');
    const [selectedSectionIds, setSelectedSectionIds] = useState(null);
    const [facultyName, setFacultyName] = useState('');

    // 未ログインでも問題閲覧・解答入力は可能。採点開始時にログインを求める。

    // Exam data loading: mount only — location.state is stable after initial navigation
    useEffect(() => {
        if (location.state?.exam) {
            setExam(location.state.exam);
            setUniversityName(location.state.universityName || '');
            setUniversityId(location.state.universityId || '');
            setSelectedSectionIds(location.state.selectedSectionIds || null);
            setFacultyName(location.state.facultyName || '');
            return;
        }

        // Fallback to localStorage (e.g. on refresh)
        try {
            const previewData = localStorage.getItem('previewExamData');
            if (previewData) {
                const parsed = JSON.parse(previewData);
                setExam(parsed.exam);
                setUniversityName(parsed.universityName || '');
                setUniversityId(parsed.universityId || '');
                setFacultyName(parsed.facultyName || parsed.exam?.faculty || '');
                setSelectedSectionIds(parsed.selectedSectionIds || null);
            }
        } catch (e) {
            console.error("Failed to recover exam from localStorage", e);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [answers, setAnswers] = useState({});
    const [grading, setGrading] = useState(false);
    const [gradingProgress, setGradingProgress] = useState('');
    const [gradingProgressValue, setGradingProgressValue] = useState(0); 
    const [logs, setLogs] = useState([]);
    const [examData, setExamData] = useState(null);
    const gradingAbortControllerRef = useRef(null);
    const examActiveRef = useRef(true);

    useEffect(() => {
        if (!exam) return;
        
        const structure = selectedSectionIds 
            ? exam.structure.filter(section => selectedSectionIds.includes(section.id))
            : exam.structure;
            
        setExamData({
            ...exam,
            structure
        });
    }, [exam, selectedSectionIds]);

    // Timer states
    const examDuration = ((exam?.duration_minutes || exam?.durationMinutes || 60) * 60); // seconds
    const [timerStarted, setTimerStarted] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState(examDuration);
    const [timerExpired, setTimerExpired] = useState(false);


    // Mobile Tab State (pdf or answer)
    const [activeTab, setActiveTab] = useState('pdf');
    const [isMobile, setIsMobile] = useState(false);
    const [pdfImages, setPdfImages] = useState([]);
    const [rawImagesForGrading] = useState([]); // kept for legacy refs only
    const [loadingPdf, setLoadingPdf] = useState(false);
    const [signedPdfUrl, setSignedPdfUrl] = useState(null);

    // 署名付きURLを生成（exam-pdfs バケットが Private の場合に必要）
    useEffect(() => {
        if (!exam?.pdfPath) return;
        const match = exam.pdfPath.match(/\/exam-pdfs\/(.+)/);
        if (!match) { setSignedPdfUrl(exam.pdfPath); return; }
        supabase.storage.from('exam-pdfs').createSignedUrl(match[1], 7200)
            .then(({ data }) => setSignedPdfUrl(data?.signedUrl || exam.pdfPath))
            .catch(() => setSignedPdfUrl(exam.pdfPath));
    }, [exam?.pdfPath]);

    // Submission Confirmation
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const submitIntentRef = useRef(false);
    const pendingPromoSubmitRef = useRef(false);
    const [usageStatus, setUsageStatus] = useState(null);
    const [usageLoading, setUsageLoading] = useState(true);
    const [promoStatus, setPromoStatus] = useState({ loading: true, verified: false, gradingCount: 0 });
    const [showPromoModal, setShowPromoModal] = useState(false);
    const [promoCodeInput, setPromoCodeInput] = useState('');
    const [promoError, setPromoError] = useState('');
    const [promoSubmitting, setPromoSubmitting] = useState(false);
    const currentPlan = getUserPlan(profile, usageStatus);
    const planFeatures = getPlanFeatures(currentPlan);
    const isRealPremiumOrAdmin = profile?.role === 'admin' ||
        profile?.plan === 'premium' ||
        profile?.subscription_plan === 'premium' ||
        profile?.is_premium ||
        ['active', 'trialing', 'past_due'].includes(String(profile?.subscription_status || '')) ||
        (profile?.premium_until && new Date(profile.premium_until).getTime() > Date.now());
    const promoGateEnabled = MARKETING_CONFIG.promoGating?.enabled !== false;
    const promoTriggerCount = MARKETING_CONFIG.promoGating?.triggerCount ?? 1;
    const shouldGateWithPromoCode = promoGateEnabled &&
        !isRealPremiumOrAdmin &&
        !promoStatus.verified &&
        Number(promoStatus.gradingCount || 0) >= promoTriggerCount;
    const displayedUsageStatus = planFeatures.unlimitedGrading
        ? { ...(usageStatus || {}), allowed: true, used: usageStatus?.used || 0, limit: null, remaining: null, plan: currentPlan }
        : usageStatus;
    const isUsageBlocked = !planFeatures.unlimitedGrading && usageStatus && !usageStatus.allowed;
    const handlePremiumClick = () => navigate('/premium');
    const adContext = {
        universityName,
        facultyName,
        examSubject: exam?.subject,
        subject: exam?.subject,
        examYear: exam?.year,
        year: exam?.year,
        audience: !user ? 'guest' : currentPlan
    };

    const clearExamSessionState = React.useCallback((examId) => {
        if (!examId) return;
        sessionStorage.removeItem(`exam_answers_${examId}`);
        sessionStorage.removeItem(`exam_timer_started_${examId}`);
        sessionStorage.removeItem(`exam_time_remaining_${examId}`);
        sessionStorage.removeItem(`exam_pdf_images_${examId}`);
    }, []);

    const abortCurrentGrading = React.useCallback(() => {
        if (gradingAbortControllerRef.current && !gradingAbortControllerRef.current.signal.aborted) {
            gradingAbortControllerRef.current.abort();
        }
        gradingAbortControllerRef.current = null;
    }, []);

    // Clear legacy persisted exam state. Answers/timer are intentionally in-memory only.
    useEffect(() => {
        if (!exam?.id) return;
        clearExamSessionState(exam.id);
        setAnswers({});
        setTimerStarted(false);
        setTimeRemaining(examDuration);
        setTimerExpired(false);
    }, [clearExamSessionState, exam?.id, examDuration]);

    useEffect(() => {
        examActiveRef.current = true;
        return () => {
            examActiveRef.current = false;
            abortCurrentGrading();
            if (exam?.id) clearExamSessionState(exam.id);
        };
    }, [abortCurrentGrading, clearExamSessionState, exam?.id]);

    useEffect(() => {
        if (authLoading) return;

        let cancelled = false;
        const loadUsageStatus = async () => {
            setUsageLoading(true);
            try {
                const { data, error } = await getGradingUsageStatus(user);
                if (error) throw error;
                if (!cancelled) setUsageStatus(data);
            } catch (err) {
                console.error('Failed to load grading usage:', err);
                if (!cancelled) {
                    setUsageStatus(null);
                }
            } finally {
                if (!cancelled) setUsageLoading(false);
            }
        };

        loadUsageStatus();
        return () => {
            cancelled = true;
        };
    }, [authLoading, user]);

    useEffect(() => {
        if (authLoading) return;

        let cancelled = false;
        const loadPromoStatus = async () => {
            setPromoStatus(prev => ({ ...prev, loading: true }));
            try {
                const [verified, gradingCount] = await Promise.all([
                    getUserPromoVerified(user?.id),
                    getUserGradingCount(user?.id)
                ]);
                if (!cancelled) setPromoStatus({ loading: false, verified, gradingCount });
            } catch (err) {
                console.error('Failed to load promo status:', err);
                if (!cancelled) setPromoStatus(prev => ({ ...prev, loading: false }));
            }
        };

        loadPromoStatus();
        return () => {
            cancelled = true;
        };
    }, [authLoading, user?.id]);

    useEffect(() => {
        if (timerStarted && timeRemaining <= 0 && !timerExpired) {
            setTimeRemaining(0);
            setTimerExpired(true);
        }
    }, [timerStarted, timeRemaining, timerExpired]);

    useEffect(() => {
        if (timerStarted && (timerExpired || timeRemaining <= 0) && isMobile) {
            setActiveTab('answer');
        }
    }, [timerStarted, timerExpired, timeRemaining, isMobile]);

    // Exit Confirmation
    useEffect(() => {
        const handleBeforeUnload = (e) => {
            if (grading) {
                abortCurrentGrading();
                if (exam?.id) clearExamSessionState(exam.id);
                return;
            }
            const hasAnswers = Object.values(answers).some(val => 
                Array.isArray(val) ? val.length > 0 : (val && String(val).trim() !== '')
            );
            if (hasAnswers || timerStarted) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [abortCurrentGrading, answers, clearExamSessionState, exam?.id, grading, timerStarted]);

    const handleExit = (targetPath) => {
        if (grading) {
            if (window.confirm("採点中です。終了すると採点を中止します。本当に終了しますか？")) {
                abortCurrentGrading();
                if (exam?.id) clearExamSessionState(exam.id);
                setGrading(false);
                setGradingProgress('');
                setGradingProgressValue(0);
                navigate(targetPath);
            }
            return;
        }

        const hasAnswers = Object.values(answers).some(val => 
            Array.isArray(val) ? val.length > 0 : (val && String(val).trim() !== '')
        );
        
        if (hasAnswers || timerStarted) {
            if (window.confirm("回答途中のデータは全て失われます。本当に終了しますか？")) {
                if (exam?.id) clearExamSessionState(exam.id);
                navigate(targetPath);
            }
        } else {
            if (exam?.id) clearExamSessionState(exam.id);
            navigate(targetPath);
        }
    };

    const openExamPdfForPrint = () => {
        const pdfUrl = signedPdfUrl || exam?.pdfPath || exam?.pdf_path;
        if (pdfUrl) {
            window.open(pdfUrl, '_blank');
        } else {
            alert("PDFのパスが見つかりません。");
        }
    };

    const addLog = React.useCallback((msg) => {
        console.log(msg);
        setLogs(prev => [...prev, msg]);
    }, []);

    // Timer countdown effect
    useEffect(() => {
        if (!timerStarted || timerExpired) return;

        const interval = setInterval(() => {
            setTimeRemaining(prev => {
                if (prev <= 1) {
                    setTimerExpired(true);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [timerStarted, timerExpired]);

    // Format time as MM:SS
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Detect mobile and load PDF as images if needed
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth <= 768);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);

        const loadPdfForMobile = async () => {
            if (window.innerWidth <= 768 && exam?.type === 'pdf' && signedPdfUrl) {
                setLoadingPdf(true);
                try {
                    const { convertPdfToImages } = await import('../utils/pdfUtils');
                    const images = await convertPdfToImages(signedPdfUrl, (msg) => {
                        console.log("PDF Viewer Load:", msg);
                    });
                    setPdfImages(images.map(img => `data:image/jpeg;base64,${img.inlineData.data}`));
                    try {
                        sessionStorage.setItem(`exam_pdf_images_${exam.id}`, JSON.stringify(images));
                    } catch (e) {
                        console.warn("PDF images too large to cache in sessionStorage:", e);
                    }
                } catch (err) {
                    console.error("Failed to load PDF images for viewer:", err);
                } finally {
                    setLoadingPdf(false);
                }
            }
        };

        loadPdfForMobile();
        return () => window.removeEventListener('resize', checkMobile);
    }, [exam, signedPdfUrl]);

    // Start timer function
    const startTimer = () => {
        setTimerStarted(true);
        setTimeRemaining(examDuration); // Use exam-specific duration
        setTimerExpired(false);
    };

    const isTimeLocked = timerStarted && (timerExpired || timeRemaining <= 0);

    // Removed useEffect fetching logic to restore stability
    // We now rely solely on the structure defined in mockData.js

    if (!exam) {
        return <div className="container">Exam not found. Please go back to home.</div>;
    }

    const handleAnswerChange = (questionId, value, isMultiple) => {
        if (!timerStarted || isTimeLocked || grading) return;
        setAnswers(prev => {
            if (isMultiple) {
                const current = prev[questionId] || [];
                // If value is already selected, remove it
                if (current.includes(value)) {
                    return { ...prev, [questionId]: current.filter(v => v !== value) };
                }
                // Otherwise add it
                return { ...prev, [questionId]: [...current, value] };
            }
            // Single selection (Radio)
            return { ...prev, [questionId]: value };
        });
    };

    const handleOrderingAnswerChange = (questionId, option, position) => {
        if (!timerStarted || isTimeLocked || grading) return;
        setAnswers(prev => {
            const current = Array.isArray(prev[questionId])
                ? prev[questionId].map(String)
                : String(prev[questionId] || '').split(',').map(s => s.trim()).filter(Boolean);
            const next = current.filter(value => value !== String(option));
            const numericPosition = parseInt(position, 10);

            if (!position || Number.isNaN(numericPosition)) {
                return { ...prev, [questionId]: next };
            }

            const insertIndex = Math.max(0, Math.min(numericPosition - 1, next.length));
            next.splice(insertIndex, 0, String(option));
            return { ...prev, [questionId]: next };
        });
    };

    const handleSubmit = async () => {
        if (!submitIntentRef.current) {
            console.warn('[ExamPage] Blocked submit without explicit confirmation.');
            setShowConfirmModal(false);
            return;
        }
        submitIntentRef.current = false;
        setShowConfirmModal(false);

        if (grading) return;

        if (!user) {
            document.dispatchEvent(new CustomEvent('openAuthModal', {
                detail: {
                    message: '採点には無料会員登録またはログインが必要です。登録すると、AI採点・弱点分析・詳細フィードバックまで確認できます。'
                }
            }));
            return;
        }

        if (shouldGateWithPromoCode) {
            pendingPromoSubmitRef.current = true;
            setShowPromoModal(true);
            return;
        }

        const usageResult = planFeatures.unlimitedGrading
            ? {
                data: {
                    allowed: true,
                    used: usageStatus?.used || 0,
                    limit: null,
                    remaining: null,
                    plan: currentPlan
                },
                error: null
            }
            : await consumeGradingUsage(user, exam?.id || null);
        if (usageResult.error) {
            console.error('Usage limit error:', usageResult.error);
            alert(`採点回数の確認に失敗しました。\n\n原因: ${usageResult.error.message || usageResult.error.details || '不明なエラー'}\n\nSupabaseに利用回数管理SQL（supabase_schema_grading_usage.sql）が適用されているか確認してください。`);
            return;
        }
        setUsageStatus(usageResult.data);
        if (!usageResult.data?.allowed) {
            if (window.confirm('今月の無料採点回数を使い切りました。プレミアムで無制限に採点しますか？')) {
                navigate('/premium');
            }
            return;
        }

        // -- Fake progress animation system --
        // targetRef holds the "real" progress ceiling from the backend.
        // The interval slowly crawls the displayed value toward it.
        const targetRef = { current: 10 };
        const displayRef = { current: 0 };
        const messageStages = [
            { at: 15, text: '解答データを整理中...' },
            { at: 25, text: '解答データを分析中...' },
            { at: 35, text: '模範解答と照合中...' },
            { at: 50, text: '各問題の採点結果を分析中...' },
            { at: 65, text: '弱点ポイントを洗い出し中...' },
            { at: 80, text: 'フィードバックを生成中...' },
            { at: 90, text: '全体の総評を生成中...' },
        ];
        let lastMsgIdx = -1;

        const fakeInterval = setInterval(() => {
            const target = targetRef.current;
            const current = displayRef.current;
            
            if (current < target) {
                // Crawl speed: faster when far from target, slower when close
                const remaining = target - current;
                const step = Math.max(0.3, remaining * 0.08);
                const next = Math.min(current + step, target);
                displayRef.current = next;
                setGradingProgressValue(Math.round(next));

                // Show stage messages based on displayed progress
                for (let i = messageStages.length - 1; i >= 0; i--) {
                    if (next >= messageStages[i].at && i > lastMsgIdx) {
                        lastMsgIdx = i;
                        setGradingProgress(messageStages[i].text);
                        addLog(messageStages[i].text);
                        break;
                    }
                }
            }
        }, 300);

        try {
            const gradingController = new AbortController();
            gradingAbortControllerRef.current = gradingController;
            setGrading(true);
            setGradingProgressValue(0);
            setLogs(['採点を開始します...']);
            setGradingProgress("解答を送信中...");
            addLog("採点データをサーバーに送信中...");

            // Format answers for submission. Keep array order because ordering questions are order-sensitive.
            const formattedAnswers = Object.entries(answers).reduce((acc, [key, val]) => {
                acc[key] = Array.isArray(val) ? val.join(', ') : val;
                return acc;
            }, {});

            // Calculate the total points of the FULL exam (for proportional passing score)
            const fullMaxScore = exam.structure?.reduce((acc, section) => {
                return acc + (section.questions?.reduce((qAcc, q) => qAcc + (q.points || 0), 0) || 0);
            }, 0) || examData.maxScore || 100;

            // Start the fake crawl toward 85% (will be overridden by real progress)
            targetRef.current = 85;

             let result;
             try {
                 result = await gradeExamWithGemini(examData, formattedAnswers, signedPdfUrl || exam.pdfPath, fullMaxScore, (val) => {
                    if (gradingController.signal.aborted || !examActiveRef.current) return;
                    // Real progress from backend: update the target ceiling
                    const realValue = 10 + Math.round(val * 0.85);
                    targetRef.current = Math.max(targetRef.current, realValue);
                    if (val >= 90) {
                        setGradingProgress('全体の総評を生成中...');
                        addLog("採点完了。全体の総評を生成しています...");
                    }
                }, { signal: gradingController.signal });
                if (gradingController.signal.aborted || !examActiveRef.current) {
                    setGrading(false);
                    setGradingProgress('');
                    setGradingProgressValue(0);
                    gradingAbortControllerRef.current = null;
                    return;
                }
                // Done: jump to 100%
                targetRef.current = 100;
                displayRef.current = 100;
                setGradingProgressValue(100);
            } catch (apiError) {
                console.error("API Error:", apiError);
                throw new Error(`API Error: ${apiError.message}`);
            } finally {
                clearInterval(fakeInterval);
            }

            if (gradingController.signal.aborted || !examActiveRef.current) {
                setGrading(false);
                setGradingProgress('');
                setGradingProgressValue(0);
                gradingAbortControllerRef.current = null;
                return;
            }
            if (!result) {
                throw new Error("採点結果が空でした。");
            }

            addLog("採点完了！結果画面へ移動します。");
            const localGradingCount = incrementLocalGradedCount();
            setPromoStatus(prev => ({
                ...prev,
                gradingCount: Math.max(Number(prev.gradingCount || 0) + 1, localGradingCount, 1)
            }));

            // Clear session storage on successful completion
            sessionStorage.removeItem(`exam_answers_${exam.id}`);
            sessionStorage.removeItem(`exam_timer_started_${exam.id}`);
            sessionStorage.removeItem(`exam_time_remaining_${exam.id}`);

            const finalUsageStatus = usageResult.data;
            setGrading(false);
            gradingAbortControllerRef.current = null;
            navigate('/result', {
                state: {
                    result,
                    universityName,
                    facultyName,
                    examId: exam.id,
                    isAiChecked: Boolean(exam?.is_ai_checked || examData?.is_ai_checked),
                    examSubject: exam.subject,
                    examYear: exam.year,
                    examDurationMinutes: exam.duration_minutes,
                    examStructure: examData?.structure || [],
                    customLayout: examData?.custom_layout || exam?.custom_layout || [],
                    answers: formattedAnswers,
                    pdfPath: exam.pdfPath,
                    usageStatus: finalUsageStatus,
                    isNewResult: true
                }
            });
        } catch (error) {
            clearInterval(fakeInterval);
            console.error("Submit Error:", error);
            if (error?.name === 'AbortError' || gradingAbortControllerRef.current?.signal?.aborted || !examActiveRef.current) {
                setGrading(false);
                setGradingProgress('');
                setGradingProgressValue(0);
                gradingAbortControllerRef.current = null;
                return;
            }
            setGrading(false);
            gradingAbortControllerRef.current = null;
            addLog(`エラー発生: ${error.message}`);
            alert(`エラーが発生しました: ${error.message}`);
        }
    };

    const confirmSubmit = () => {
        if (!user) {
            document.dispatchEvent(new CustomEvent('openAuthModal', {
                detail: {
                    message: '採点には無料会員登録またはログインが必要です。登録すると、AI採点・弱点分析・詳細フィードバックまで確認できます。'
                }
            }));
            return;
        }
        if (promoStatus.loading) {
            alert('無料開放コードの状態を確認中です。少し待ってから再度お試しください。');
            return;
        }
        if (shouldGateWithPromoCode) {
            pendingPromoSubmitRef.current = true;
            setShowPromoModal(true);
            return;
        }
        if (usageLoading) {
            alert('採点回数を確認中です。少し待ってから再度お試しください。');
            return;
        }
        if (isUsageBlocked) {
            if (window.confirm('今月の無料採点回数を使い切りました。プレミアムで無制限に採点しますか？')) {
                navigate('/premium');
            }
            return;
        }
        setShowConfirmModal(true);
    };

    const handleConfirmedSubmit = () => {
        submitIntentRef.current = true;
        handleSubmit();
    };

    const handlePromoSubmit = async (e) => {
        e.preventDefault();
        setPromoError('');

        if (!isValidFreeAccessPromoCode(promoCodeInput)) {
            setPromoError(`コードが違います。公式LINEで配布している無料開放コードを入力してください。`);
            return;
        }

        setPromoSubmitting(true);
        try {
            const { error } = await markUserPromoVerified(user?.id, FREE_ACCESS_PROMO_CODE);
            if (error) throw error;
            setPromoStatus(prev => ({ ...prev, verified: true }));
            setShowPromoModal(false);
            setPromoCodeInput('');
            if (pendingPromoSubmitRef.current) {
                pendingPromoSubmitRef.current = false;
                setShowConfirmModal(true);
            }
        } catch (err) {
            setPromoError(err?.message || 'コードの保存に失敗しました。時間をおいて再度お試しください。');
        } finally {
            setPromoSubmitting(false);
        }
    };

    const handleLimitConsultation = () => {
        if (!MARKETING_CONFIG.enableConsultation) {
            navigate('/premium');
            return;
        }
        navigate('/consultation', {
            state: {
                consultationContext: {
                    source: 'grading_limit',
                    universityName,
                    facultyName,
                    examId: exam?.id,
                    examSubject: exam?.subject,
                    examYear: exam?.year
                }
            }
        });
    };

    return (
        <div className="exam-page-shell" style={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--color-bg-secondary)',
            position: 'relative'
        }}>
            {/* Compact Header for Mobile & Desktop */}
            <div className="exam-header-compact">
                <div className="exam-header-title-row" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button
                        type="button"
                        className="exam-header-back"
                        onClick={() => handleExit(`/university/${universityId || ''}`)}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--color-text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                            fontSize: '1.2rem',
                            padding: '0.25rem'
                        }}
                    >
                        ←
                    </button>
                    <div className="exam-header-title-block" style={{ display: 'flex', flexDirection: 'column' }}>
                        <h2 className="exam-header-title" style={{ fontSize: '0.95rem', color: 'var(--color-accent-primary)', lineHeight: 1.2, margin: 0 }}>
                            {universityName || exam?.university || '大学'} {facultyName || exam?.faculty || ''}
                        </h2>
                        <div className="exam-header-meta" style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                            {exam?.year || ''}年 {exam?.subject || ''}
                        </div>
                    </div>
                </div>

                <div className="exam-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {timerStarted && (
                        <div className="exam-header-timer" style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            color: timerExpired ? '#ef4444' : (timeRemaining < 300 ? '#f59e0b' : 'var(--color-text-primary)'),
                            fontWeight: '700',
                            fontFamily: 'monospace',
                            fontSize: '1.1rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '2px',
                            background: 'rgba(255,255,255,0.6)',
                            border: '1px solid currentColor'
                        }}>
                            {formatTime(timeRemaining)}
                        </div>
                    )}
                    <button
                        type="button"
                        className="btn btn-secondary exam-header-action-button"
                        style={{
                            padding: '0.4rem 0.8rem',
                            fontSize: '0.8rem',
                            display: isTimeLocked ? 'none' : undefined
                        }}
                        onClick={() => handleExit('/')}
                    >
                        終了
                    </button>
                    {!grading && !isTimeLocked && (
                        <button
                            type="button"
                            className="btn btn-secondary shadow-none exam-header-action-button"
                            style={{
                                padding: '0.4rem 0.8rem',
                                fontSize: '0.8rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.3rem'
                            }}
                            onClick={openExamPdfForPrint}
                            title="原本PDFを新しいタブで開いて印刷・保存します"
                        >
                            <span style={{ fontSize: '1rem' }}>📥</span>
                            <span className="hide-on-mobile">PDF印刷/保存</span>
                            <span className="show-on-mobile" style={{ display: 'none' }}>PDF</span>
                        </button>
                    )}
                    {timerStarted && !grading && (
                        <>
                            <button
                                type="button"
                                className="btn btn-primary exam-header-action-button"
                                style={{
                                    padding: '0.4rem 0.8rem',
                                    fontSize: '0.8rem',
                                    boxShadow: 'none',
                                    opacity: usageLoading || promoStatus.loading || isUsageBlocked ? 0.65 : 1
                            }}
                            onClick={confirmSubmit}
                            disabled={usageLoading || promoStatus.loading || isUsageBlocked}
                        >
                                {promoStatus.loading ? '確認中' : (isTimeLocked ? '提出' : '採点')}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Mobile Tab Switcher - Segmented Control Style */}
            <div className="show-on-mobile exam-mobile-tabs" style={{
                display: 'none',
                padding: '0.6rem 1rem',
                background: 'white',
                borderBottom: '1px solid var(--color-silver-light)'
            }}>
                <div style={{
                    display: 'flex',
                    background: 'var(--color-bg-secondary)',
                    padding: '2px',
                    border: '1px solid var(--color-silver-light)',
                    borderRadius: '2px'
                }}>
                    <button
                        type="button"
                        onClick={() => setActiveTab('pdf')}
                        className="btn-mobile-full"
                        style={{
                            flex: 1,
                            padding: '0.5rem',
                            border: 'none',
                            borderRadius: '2px',
                            background: activeTab === 'pdf' ? 'var(--color-accent-primary)' : 'transparent',
                            color: activeTab === 'pdf' ? 'white' : 'var(--color-text-secondary)',
                            fontWeight: activeTab === 'pdf' ? '700' : '500',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                            boxShadow: activeTab === 'pdf' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                            transition: 'all 0.2s',
                            width: 'auto'
                        }}
                    >
                        問題を見る
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('answer')}
                        className="btn-mobile-full"
                        style={{
                            flex: 1,
                            padding: '0.5rem',
                            border: 'none',
                            borderRadius: '2px',
                            background: activeTab === 'answer' ? 'var(--color-accent-primary)' : 'transparent',
                            color: activeTab === 'answer' ? 'white' : 'var(--color-text-secondary)',
                            fontWeight: activeTab === 'answer' ? '700' : '500',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                            boxShadow: activeTab === 'answer' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                            transition: 'all 0.2s',
                            width: 'auto'
                        }}
                    >
                        解答を入力
                    </button>
                </div>
            </div>

            <div className="mobile-stack" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* PDF Viewer Area */}
                <div style={{
                    flex: 1,
                    borderRight: 'var(--border-glass)',
                    background: '#525659',
                    display: isMobile ? (activeTab === 'pdf' ? 'block' : 'none') : 'block',
                    overflowY: isMobile ? 'auto' : 'hidden'
                }} className="pdf-container">
                    {(exam?.type === 'pdf' || (exam?.pdfPath || exam?.pdf_path)) ? (
                        isMobile ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0px', width: '100%' }}>
                                {loadingPdf ? (
                                    <div style={{ padding: '40vh 0', textAlign: 'center', color: 'white' }}>
                                        <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
                                        <p style={{ fontSize: '0.9rem' }}>問題を読み込み中...</p>
                                    </div>
                                ) : pdfImages.length > 0 ? (
                                    pdfImages.map((src, idx) => (
                                        <img 
                                            key={idx} 
                                            src={src} 
                                            alt={`Page ${idx + 1}`} 
                                            style={{ width: '100%', display: 'block' }} 
                                        />
                                    ))
                                ) : (
                                    <div style={{ padding: '2rem', color: 'white', textAlign: 'center' }}>
                                        問題の読み込みに失敗しました。
                                    </div>
                                )}
                            </div>
                        ) : (
                            <iframe
                                src={signedPdfUrl || exam?.pdfPath || exam?.pdf_path}
                                style={{ width: '100%', height: '100%', border: 'none' }}
                                title="Exam PDF"
                            />
                        )
                    ) : (
                        <div style={{ padding: '2rem', color: 'white', textAlign: 'center' }}>
                            PDF not available for this exam type.
                        </div>
                    )}
                </div>

                {/* Answer Sheet Area */}
                <div style={{
                    width: '400px',
                    background: 'var(--color-bg-primary)',
                    display: isMobile ? (activeTab === 'answer' ? 'flex' : 'none') : 'flex',
                    flexDirection: 'column',
                    position: 'relative'
                }} className="answer-container">
                    {/* Start Screen Overlay */}
                    {!timerStarted && (
                        <div style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background: 'rgba(255, 255, 255, 0.98)',
                            zIndex: 100,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '2rem'
                        }}>
                            <div style={{ textAlign: 'center', maxWidth: '320px' }}>
                                <h2 style={{ fontSize: '1.3rem', marginBottom: '1.5rem', color: 'var(--color-text-primary)' }}>
                                    試験を開始する前に
                                </h2>
                                <div style={{
                                    background: 'var(--color-bg-secondary)',
                                    padding: '1.5rem',
                                    borderRadius: '2px',
                                    marginBottom: '2rem',
                                    textAlign: 'left',
                                    border: 'var(--border-glass)'
                                }}>
                                    <p style={{ fontSize: '0.9rem', color: 'var(--color-text-primary)', marginBottom: '1rem', fontWeight: '600' }}>
                                        以下を確認してください：
                                    </p>
                                    <ul style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', lineHeight: '1.8', paddingLeft: '1.2rem', margin: 0 }}>
                                        <li>筆記用具の準備</li>
                                        <li>静かな環境の確保</li>
                                        <li>制限時間は{exam?.duration_minutes || 60}分です</li>
                                        <li>途中で中断できません</li>
                                    </ul>
                                </div>
                                <UsageLimitCard
                                    usage={displayedUsageStatus}
                                    loading={usageLoading}
                                    compact
                                    showConsultationCta={Boolean(user) && !planFeatures.unlimitedGrading}
                                    onConsultationClick={handleLimitConsultation}
                                    onPremiumClick={handlePremiumClick}
                                />
                                <PreGradingPremiumHint
                                    usage={displayedUsageStatus}
                                    planFeatures={planFeatures}
                                    onPremiumClick={handlePremiumClick}
                                />
                                {MARKETING_CONFIG.enableAdBanners && (
                                    <AdBanner
                                        slot="exam_pre_submit"
                                        pageTarget="exam"
                                        variant="inline"
                                        context={adContext}
                                        audience={adContext.audience}
                                    />
                                )}
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={startTimer}
                                    style={{
                                        width: '100%',
                                        padding: '1rem 2rem',
                                        fontSize: '1.1rem',
                                        fontWeight: 'bold',
                                        background: 'var(--color-accent-primary)',
                                        boxShadow: 'none'
                                    }}
                                >
                                    試験を開始
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="answer-sheet-header" style={{ padding: '1.5rem', borderBottom: 'var(--border-glass)' }}>
                        <h2 style={{ fontSize: '1.1rem' }}>解答用紙</h2>
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                            問題を見て解答を入力してください。
                        </p>
                        {isTimeLocked && !grading && (
                            <div style={{
                                marginTop: '1rem',
                                padding: '0.75rem 1rem',
                                border: '1px solid #fecaca',
                                background: '#fef2f2',
                                color: '#b91c1c',
                                fontWeight: 800,
                                lineHeight: 1.6
                            }}>
                                制限時間が終了しました。解答の編集はできません。提出して採点してください。
                            </div>
                        )}
                    </div>

                    <div className="answer-sheet-body" style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                        <UsageLimitCard
                            usage={displayedUsageStatus}
                            loading={usageLoading}
                            compact
                            showConsultationCta={Boolean(user) && !planFeatures.unlimitedGrading}
                            onConsultationClick={handleLimitConsultation}
                            onPremiumClick={handlePremiumClick}
                        />
                        {!timerStarted && (
                            <PreGradingPremiumHint
                                usage={displayedUsageStatus}
                                planFeatures={planFeatures}
                                onPremiumClick={handlePremiumClick}
                            />
                        )}
                        {!timerStarted && MARKETING_CONFIG.enableAdBanners && (
                            <AdBanner
                                slot="exam_pre_submit"
                                pageTarget="exam"
                                variant="inline"
                                context={adContext}
                                audience={adContext.audience}
                            />
                        )}
                        <details
                            className="answer-notation-notice"
                            style={{
                                border: '1px solid #e2e8f0',
                                borderRadius: '8px',
                                background: '#f8fafc',
                                padding: '0.85rem 1rem'
                            }}
                        >
                            <summary
                                style={{
                                    cursor: 'pointer',
                                    fontWeight: 700,
                                    color: 'var(--color-text-primary)',
                                    fontSize: '0.92rem'
                                }}
                            >
                                表記揺れについて
                            </summary>
                            <div
                                style={{
                                    marginTop: '0.75rem',
                                    color: 'var(--color-text-secondary)',
                                    fontSize: '0.86rem',
                                    lineHeight: 1.8
                                }}
                            >
                                <p style={{ margin: '0 0 0.45rem' }}>
                                    問題文で表記が指定されていない場合、一般的な表記揺れは採点時に考慮します。
                                </p>
                                <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                                    <li>人名・用語の「＝」「・」「スペース」は、省略しても基本的に同じ表記として扱います。</li>
                                    <li>例: ラシード＝ウッディーン / ラシード・ウッディーン / ラシード ウッディーン / ラシードウッディーン</li>
                                    <li>数字の全角・半角、丸数字は同じ数字として扱います。例: ① / １ / 1</li>
                                    <li>かな・カナなどの違いも、意味が同じなら可能な範囲で考慮します。</li>
                                    <li>漢字指定、記号指定、字数指定がある場合は、問題文の指示を優先してください。</li>
                                </ul>
                            </div>
                        </details>
                        {examData && examData.structure ? (
                            examData.structure.map((section) => (
                                <div key={section.id}>
                                    <h3 style={{ fontSize: '1rem', marginBottom: '1rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>
                                        {section.label || section.title || 'Section'}
                                    </h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {/* Use specific questions array if available, otherwise generate based on count */}
                                        {(section.questions && section.questions.length > 0
                                            ? section.questions
                                            : Array.from({ length: section.count || 1 }).map((_, i) => ({ id: `${section.id}-${i + 1}`, type: section.type, options: section.options }))
                                        ).map((q, i) => {
                                            // Handle both object (from questions array) and generated index
                                            const questionId = q.id || `${section.id}-${i + 1}`;
                                            const uniqueKey = `${section.id}_${i}_${questionId}`;
                                            const qType = q.type || section.type || 'text';
                                            const qOptions = q.options || section.options || [];
                                            const isKanjiSelfGrade = isKanjiSelfGradingQuestion(examData, section, q);

                                            // Multiple selection should be explicit. Some defective questions
                                            // have multiple acceptable answers while the UI remains single-choice.
                                            const isMultiple = qType === 'selection_multi';
                                            const isOrdering = qType === 'ordering';
                                            const answerDisabled = !timerStarted || isTimeLocked || grading;
                                            const orderingAnswer = Array.isArray(answers[uniqueKey])
                                                ? answers[uniqueKey].map(String)
                                                : String(answers[uniqueKey] || '').split(',').map(s => s.trim()).filter(Boolean);

                                            return (
                                                <div key={uniqueKey} className="answer-question-row" style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                                                    <span className="answer-question-label" style={{ minWidth: '30px', fontWeight: '600', fontSize: '0.9rem', paddingTop: '0.2rem' }}>
                                                        {q.label || `(${i + 1})`}
                                                    </span>
                                                    {isKanjiSelfGrade ? (
                                                        <div className="answer-option-list" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', width: '100%' }}>
                                                            {[
                                                                { value: KANJI_SELF_GRADE_CORRECT, label: '正解にする' },
                                                                { value: KANJI_SELF_GRADE_WRONG, label: '不正解にする' }
                                                            ].map(option => (
                                                                <label key={option.value} style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.5rem',
                                                                    cursor: answerDisabled ? 'not-allowed' : 'pointer',
                                                                    opacity: answerDisabled ? 0.6 : 1,
                                                                    padding: '0.55rem 0.75rem',
                                                                    border: '1px solid #e2e8f0',
                                                                    borderRadius: '2px',
                                                                    background: answers[uniqueKey] === option.value ? '#fef2f2' : '#fff',
                                                                    fontWeight: 700
                                                                }}>
                                                                    <input
                                                                        type="radio"
                                                                        name={uniqueKey}
                                                                        value={option.value}
                                                                        checked={answers[uniqueKey] === option.value}
                                                                        onChange={(e) => handleAnswerChange(uniqueKey, e.target.value, false)}
                                                                        disabled={answerDisabled}
                                                                    />
                                                                    <span>{option.label}</span>
                                                                </label>
                                                            ))}
                                                            <div style={{ flexBasis: '100%', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.6 }}>
                                                                漢字の表記は自動判定が難しいため、解答後に自己採点してください。
                                                            </div>
                                                        </div>
                                                    ) : isOrdering ? (
                                                        <div className="answer-ordering-control" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                            <div className="answer-option-list" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                                                                {qOptions.map(option => {
                                                                    const currentPosition = orderingAnswer.indexOf(String(option)) + 1;
                                                                    return (
                                                                        <label key={option} style={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '0.45rem',
                                                                            padding: '0.5rem 0.65rem',
                                                                            border: '1px solid #e2e8f0',
                                                                            borderRadius: '8px',
                                                                            background: currentPosition > 0 ? '#eef2ff' : '#fff',
                                                                            opacity: answerDisabled ? 0.6 : 1
                                                                        }}>
                                                                            <span style={{ fontWeight: 700 }}>{option}</span>
                                                                            <select
                                                                                value={currentPosition || ''}
                                                                                onChange={(e) => handleOrderingAnswerChange(uniqueKey, option, e.target.value)}
                                                                                disabled={answerDisabled}
                                                                                style={{
                                                                                    border: '1px solid #cbd5e1',
                                                                                    borderRadius: '6px',
                                                                                    padding: '0.25rem 0.4rem',
                                                                                    background: 'white',
                                                                                    cursor: answerDisabled ? 'not-allowed' : 'pointer'
                                                                                }}
                                                                            >
                                                                                <option value="">-</option>
                                                                                {qOptions.map((_, orderIdx) => (
                                                                                    <option key={orderIdx + 1} value={orderIdx + 1}>{orderIdx + 1}</option>
                                                                                ))}
                                                                            </select>
                                                                        </label>
                                                                    );
                                                                })}
                                                            </div>
                                                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                                                                解答順: {orderingAnswer.length > 0 ? orderingAnswer.join(' → ') : '未入力'}
                                                            </div>
                                                        </div>
                                                    ) : qType === 'selection' ? (
                                                        <select
                                                            className="answer-select-control"
                                                            value={answers[uniqueKey] || ''}
                                                            onChange={(e) => handleAnswerChange(uniqueKey, e.target.value, false)}
                                                            disabled={answerDisabled}
                                                            style={{
                                                                width: '100%',
                                                                minHeight: '44px',
                                                                padding: '0.65rem 0.75rem',
                                                                border: '1px solid #cbd5e1',
                                                                borderRadius: '2px',
                                                                background: 'white',
                                                                color: answers[uniqueKey] ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                                                                fontFamily: 'inherit',
                                                                opacity: answerDisabled ? 0.6 : 1,
                                                                cursor: answerDisabled ? 'not-allowed' : 'pointer'
                                                            }}
                                                        >
                                                            <option value="">選択してください</option>
                                                            {qOptions.map(option => (
                                                                <option key={option} value={option}>
                                                                    {option}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    ) : qType === 'selection_multi' ? (
                                                        <div className="answer-option-list" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                                            {qOptions.map(option => (
                                                                <label key={option} style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.5rem',
                                                                    cursor: answerDisabled ? 'not-allowed' : 'pointer',
                                                                    opacity: answerDisabled ? 0.6 : 1
                                                                }}>
                                                                    <input
                                                                        type={isMultiple ? "checkbox" : "radio"}
                                                                        name={uniqueKey}
                                                                        value={option}
                                                                        checked={
                                                                            isMultiple
                                                                                ? (answers[uniqueKey] || []).map(String).includes(String(option))
                                                                                : String(answers[uniqueKey] || '') === String(option)
                                                                        }
                                                                        onChange={(e) => handleAnswerChange(uniqueKey, e.target.value, isMultiple)}
                                                                        disabled={answerDisabled}
                                                                    />
                                                                    <span>{option}</span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <textarea
                                                            className="glass-panel"
                                                            style={{
                                                                width: '100%',
                                                                minHeight: section.height === 'medium' ? '120px' : '80px',
                                                                padding: '0.75rem',
                                                                resize: 'vertical',
                                                                background: 'white',
                                                                border: '1px solid #e2e8f0',
                                                                borderRadius: '2px',
                                                                fontFamily: 'inherit',
                                                                opacity: answerDisabled ? 0.5 : 1,
                                                                cursor: answerDisabled ? 'not-allowed' : 'text'
                                                            }}
                                                            placeholder="解答を入力..."
                                                            value={answers[uniqueKey] || ''}
                                                            onChange={(e) => handleAnswerChange(uniqueKey, e.target.value)}
                                                            disabled={answerDisabled}
                                                        />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
                                Loading exam data...
                            </div>
                        )}
                    </div>

                    <div className="answer-submit-bar" style={{ padding: '1.5rem', borderTop: 'var(--border-glass)', background: 'var(--color-bg-glass)' }}>
                        <button
                            type="button"
                            className="btn btn-primary"
                            style={{
                                width: '100%',
                                opacity: grading || usageLoading || promoStatus.loading || isUsageBlocked ? 0.7 : 1,
                                cursor: grading || usageLoading || promoStatus.loading || isUsageBlocked ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.5rem'
                            }}
                            onClick={confirmSubmit}
                            disabled={grading || usageLoading || promoStatus.loading || isUsageBlocked}
                        >
                            {grading ? (
                                <>
                                    <span className="spinner"></span>
                                    <span>採点中...</span>
                                </>
                            ) : promoStatus.loading ? (
                                "確認中..."
                            ) : isTimeLocked ? (
                                "制限時間終了：提出して採点する"
                            ) : (
                                "提出して採点する"
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Confirmation Modal */}
            {showConfirmModal && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 2000,
                    padding: '1rem'
                }}>
                    <div className="glass-panel" style={{ background: 'white', padding: '2rem', maxWidth: '400px', width: '100%', textAlign: 'center', borderRadius: '2px' }}>

                        <h3 style={{ marginBottom: '1rem' }}>{isTimeLocked ? '制限時間が終了しました' : '試験を終了して採点しますか？'}</h3>
                        <p style={{ color: 'var(--color-text-secondary)', marginBottom: '2rem', fontSize: '0.9rem' }}>
                            {isTimeLocked ? (
                                <>
                                    解答の編集はできません。<br />
                                    提出して採点を開始してください。
                                </>
                            ) : (
                                <>
                                    一度提出すると、解答を修正することはできません。<br />
                                    採点と詳細な分析を開始します。
                                </>
                            )}
                        </p>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            {!isTimeLocked && (
                                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowConfirmModal(false)}>
                                    まだ続ける
                                </button>
                            )}
                            <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={handleConfirmedSubmit}>
                                提出する
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Promo Code Modal */}
            {showPromoModal && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(15, 23, 42, 0.65)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 2100,
                    padding: '1rem'
                }}>
                    <form
                        className="glass-panel"
                        onSubmit={handlePromoSubmit}
                        style={{
                            background: 'white',
                            padding: '2rem',
                            maxWidth: '480px',
                            width: '100%',
                            borderRadius: '8px',
                            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
                        }}
                    >
                        <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                color: '#15803d',
                                background: '#f0fdf4',
                                padding: '0.35rem 0.75rem',
                                borderRadius: '9999px',
                                fontWeight: 800,
                                fontSize: '0.78rem',
                                letterSpacing: '0.05em',
                                marginBottom: '0.75rem'
                            }}>
                                <span>🎁</span> 公式LINE限定・無料開放特典
                            </div>
                            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.35rem', color: '#0f172a', fontWeight: 800 }}>
                                2回目以降の採点コードを入力
                            </h3>
                            <p style={{ margin: 0, color: 'var(--color-text-secondary)', lineHeight: 1.7, fontSize: '0.92rem', textAlign: 'left' }}>
                                スマサイをご利用いただきありがとうございます！2回目以降の採点には、公式LINEの友だち追加で配布されている<strong>プロモーションコード</strong>が必要です。
                            </p>
                        </div>

                        <div style={{
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            borderRadius: '6px',
                            padding: '1.25rem',
                            marginBottom: '1.25rem'
                        }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '0.5rem' }}>
                                ① 公式LINEを追加してコードを確認
                            </div>
                            <a
                                href={MARKETING_CONFIG.lineUrl}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    background: '#06C755',
                                    color: '#ffffff',
                                    padding: '0.8rem 1.2rem',
                                    borderRadius: '6px',
                                    textDecoration: 'none',
                                    fontWeight: 800,
                                    fontSize: '0.95rem',
                                    boxShadow: '0 2px 4px rgba(6, 199, 85, 0.25)',
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.48 2 2 5.92 2 10.75c0 2.94 1.66 5.56 4.24 7.15-.18.66-.67 2.45-.77 2.82-.12.45.16.44.34.33.14-.09 1.95-1.32 2.76-1.87.46.08.94.12 1.43.12 5.52 0 10-3.92 10-8.75S17.52 2 12 2z"/>
                                </svg>
                                LINE友だち追加でコードを取得
                            </a>
                            <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#64748b', marginTop: '0.4rem' }}>
                                ※友だち追加メッセージですぐにコードをお届けします
                            </div>
                        </div>

                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', fontWeight: 800, fontSize: '0.85rem', color: '#334155', marginBottom: '0.4rem' }}>
                                ② 届いたコードを入力
                            </label>
                            <input
                                type="text"
                                value={promoCodeInput}
                                onChange={(e) => {
                                    setPromoCodeInput(e.target.value);
                                    setPromoError('');
                                }}
                                placeholder="例: 公式LINEで届いたコードを入力"
                                autoFocus
                                style={{
                                    width: '100%',
                                    minHeight: '46px',
                                    border: promoError ? '2px solid #ef4444' : '1px solid #cbd5e1',
                                    borderRadius: '6px',
                                    padding: '0.75rem 1rem',
                                    fontSize: '1rem',
                                    fontFamily: 'inherit',
                                    boxSizing: 'border-box',
                                    marginBottom: '0.5rem',
                                    letterSpacing: '0.05em'
                                }}
                            />
                            {promoError && (
                                <div style={{ color: '#dc2626', fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                                    {promoError}
                                </div>
                            )}
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                                ※一度認証すれば、次回以降はコード入力不要でご利用いただけます。
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ flex: 1, padding: '0.75rem' }}
                                onClick={() => {
                                    pendingPromoSubmitRef.current = false;
                                    setShowPromoModal(false);
                                    setPromoError('');
                                }}
                                disabled={promoSubmitting}
                            >
                                キャンセル
                            </button>
                            <button
                                type="submit"
                                className="btn btn-primary"
                                style={{ flex: 1.4, padding: '0.75rem' }}
                                disabled={promoSubmitting || !promoCodeInput.trim()}
                            >
                                {promoSubmitting ? '認証中...' : '認証して採点へ進む'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
            {/* Log & Progress Overlay */}
            {(logs.length > 0 || grading) && (
                <div className="grading-overlay" style={{
                    position: 'fixed',
                    bottom: '24px',
                    right: '24px',
                    background: 'var(--color-bg-primary)',
                    color: 'var(--color-text-primary)',
                    padding: '1.5rem',
                    borderRadius: '2px',
                    width: '360px',
                    boxShadow: 'var(--shadow-card)',
                    zIndex: 3000,
                    border: 'var(--border-glass)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem'
                }}>
                    {/* Progress Section (Always Visible at Top) */}
                    {grading && (
                        <div style={{ 
                            borderBottom: '1px solid var(--border-glass)', 
                            paddingBottom: '1rem' 
                        }}>
                            <div style={{ 
                                fontWeight: '900', 
                                fontSize: '0.85rem', 
                                marginBottom: '0.75rem', 
                                color: 'var(--color-accent-primary)', 
                                display: 'flex', 
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-accent-primary)' }}></div>
                                    {gradingProgress || '採点中...'}
                                </span>
                                <span style={{ fontFamily: 'monospace', fontSize: '1rem' }}>{gradingProgressValue}%</span>
                            </div>
                            
                            <div style={{ 
                                height: '6px', 
                                width: '100%', 
                                background: 'var(--color-silver-light)', 
                                borderRadius: '0px', 
                                overflow: 'hidden'
                            }}>
                                <div style={{ 
                                    height: '100%', 
                                    width: `${gradingProgressValue}%`, 
                                    background: 'var(--color-accent-primary)',
                                    transition: 'width 0.4s ease-out'
                                }}></div>
                            </div>
                        </div>
                    )}

                    {/* Logs List (Scrollable Area) */}
                    <div style={{ 
                        maxHeight: '160px', 
                        overflowY: 'auto', 
                        paddingRight: '4px' 
                    }} className="custom-scrollbar">
                        <div style={{ 
                            fontSize: '0.65rem', 
                            color: 'var(--color-text-secondary)', 
                            marginBottom: '0.5rem', 
                            fontWeight: '900', 
                            textTransform: 'uppercase', 
                            letterSpacing: '0.1em' 
                        }}>
                            Grading Logs
                        </div>
                        {logs.map((log, i) => (
                            <div key={i} style={{ 
                                fontSize: '0.75rem', 
                                marginBottom: '6px', 
                                opacity: 0.8, 
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                lineHeight: '1.4'
                            }}>
                                <span style={{ color: 'var(--color-accent-primary)', marginRight: '8px', fontWeight: 'bold' }}>&gt;</span>
                                {log}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExamPage;
