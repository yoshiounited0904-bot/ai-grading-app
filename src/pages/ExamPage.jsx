import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

import { gradeExamWithGemini } from '../services/geminiService';

const ExamPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, loading: authLoading } = useAuth();
    const [exam, setExam] = useState(null);
    const [universityName, setUniversityName] = useState('');
    const [universityId, setUniversityId] = useState('');
    const [selectedSectionIds, setSelectedSectionIds] = useState(null);
    const [facultyName, setFacultyName] = useState('');

    useEffect(() => {
        if (!authLoading && !user) {
            navigate('/');
            return;
        }

        // 1. Try location state
        if (location.state?.exam) {
            setExam(location.state.exam);
            setUniversityName(location.state.universityName || '');
            setUniversityId(location.state.universityId || '');
            setSelectedSectionIds(location.state.selectedSectionIds || null);
            setFacultyName(location.state.facultyName || '');
            return;
        }

        // 2. Fallback to localStorage (e.g. on refresh)
        try {
            const previewData = localStorage.getItem('previewExamData');
            if (previewData) {
                const parsed = JSON.parse(previewData);
                setExam(parsed.exam);
                setUniversityName(parsed.universityName || '');
                setUniversityId(parsed.universityId || '');
                // Note: selectedSectionIds/facultyName might not be in previewData if from Admin
            }
        } catch (e) {
            console.error("Failed to recover exam from localStorage", e);
        }
    }, [user, authLoading, navigate, location.state]);

    const [answers, setAnswers] = useState({});
    const [grading, setGrading] = useState(false);
    const [gradingProgress, setGradingProgress] = useState('');
    const [gradingProgressValue, setGradingProgressValue] = useState(0); 
    const [logs, setLogs] = useState([]);
    const [examData, setExamData] = useState(null);

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
    const [rawImagesForGrading, setRawImagesForGrading] = useState([]); // Store raw base64 for grading
    const [loadingPdf, setLoadingPdf] = useState(false);

    // Submission Confirmation
    const [showConfirmModal, setShowConfirmModal] = useState(false);

    // Persistence: Load state from sessionStorage
    useEffect(() => {
        if (!exam?.id) return;
        
        const savedAnswers = sessionStorage.getItem(`exam_answers_${exam.id}`);
        if (savedAnswers) {
            try {
                setAnswers(JSON.parse(savedAnswers));
            } catch (e) {
                console.error("Failed to parse saved answers", e);
            }
        }

        const savedTimerStarted = sessionStorage.getItem(`exam_timer_started_${exam.id}`);
        if (savedTimerStarted === 'true') {
            setTimerStarted(true);
            const savedTime = sessionStorage.getItem(`exam_time_remaining_${exam.id}`);
            if (savedTime) {
                setTimeRemaining(parseInt(savedTime, 10));
            }
        }
    }, [exam?.id]);

    // Persistence: Save state to sessionStorage
    useEffect(() => {
        if (!exam?.id) return;
        sessionStorage.setItem(`exam_answers_${exam.id}`, JSON.stringify(answers));
    }, [answers, exam?.id]);

    useEffect(() => {
        if (!exam?.id) return;
        sessionStorage.setItem(`exam_timer_started_${exam.id}`, timerStarted);
        sessionStorage.setItem(`exam_time_remaining_${exam.id}`, timeRemaining);
    }, [timerStarted, timeRemaining, exam?.id]);

    // Exit Confirmation
    useEffect(() => {
        const handleBeforeUnload = (e) => {
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
    }, [answers, timerStarted]);

    const handleExit = (targetPath) => {
        const hasAnswers = Object.values(answers).some(val => 
            Array.isArray(val) ? val.length > 0 : (val && String(val).trim() !== '')
        );
        
        if (hasAnswers || timerStarted) {
            if (window.confirm("回答途中のデータは全て失われます。本当に終了しますか？")) {
                navigate(targetPath);
            }
        } else {
            navigate(targetPath);
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
            if (window.innerWidth <= 768 && exam?.type === 'pdf' && exam.pdfPath) {
                setLoadingPdf(true);
                try {
                    const { convertPdfToImages } = await import('../utils/pdfUtils');
                    const images = await convertPdfToImages(exam.pdfPath, (msg) => {
                        console.log("PDF Viewer Load:", msg);
                    });
                    setRawImagesForGrading(images);
                    setPdfImages(images.map(img => `data:image/jpeg;base64,${img.inlineData.data}`));
                } catch (err) {
                    console.error("Failed to load PDF images for viewer:", err);
                } finally {
                    setLoadingPdf(false);
                }
            }
        };

        loadPdfForMobile();
        return () => window.removeEventListener('resize', checkMobile);
    }, [exam]);

    // Start timer function
    const startTimer = () => {
        setTimerStarted(true);
        setTimeRemaining(examDuration); // Use exam-specific duration
        setTimerExpired(false);
    };


    // Removed useEffect fetching logic to restore stability
    // We now rely solely on the structure defined in mockData.js

    if (!exam) {
        return <div className="container">Exam not found. Please go back to home.</div>;
    }

    const handleAnswerChange = (questionId, value, isMultiple) => {
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

    const handleSubmit = async () => {
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY_V2 || import.meta.env.VITE_GEMINI_API_KEY || window._GEMINI_API_KEY;
        if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
            alert('APIキーが設定されていません。');
            return;
        }

        setShowConfirmModal(false); // Close modal

        try {
            setGrading(true);
            setGradingProgressValue(0);
            setLogs(['採点を開始します...']);

            // Process images for grading
            let images = [];
            if (rawImagesForGrading && rawImagesForGrading.length > 0) {
                addLog("Step 1: 既にロード済みの画像を使用します（メモリ節約）。");
                images = rawImagesForGrading;
                setGradingProgressValue(20); // 既に画像がある場合は20%まで進める
            } else {
                setGradingProgress("PDFを画像に変換中...");
                addLog("Step 1: 採点用にPDFを読み込み中...");
                images = await import('../utils/pdfUtils').then(m => m.convertPdfToImages(
                    exam.pdfPath, 
                    (msg) => addLog(msg),
                    (p) => setGradingProgressValue(Math.round(p * 0.2)) // 0-20%
                ));
            }

            setGradingProgress("AIによる採点を実行中...");
            addLog("Step 2: 採点データを送信中...");

            // Format answers for submission (join arrays with comma)
            const formattedAnswers = Object.entries(answers).reduce((acc, [key, val]) => {
                acc[key] = Array.isArray(val) ? val.sort().join(', ') : val;
                return acc;
            }, {});

            // Calculate the total points of the FULL exam (for proportional passing score)
            const fullMaxScore = exam.structure?.reduce((acc, section) => {
                return acc + (section.questions?.reduce((qAcc, q) => qAcc + (q.points || 0), 0) || 0);
            }, 0) || examData.maxScore || 100;

            let result;
            try {
                // Including fullMaxScore for proportional border calculation
                const { gradeExamWithGemini } = await import('../services/geminiService');
                result = await gradeExamWithGemini(apiKey, examData, formattedAnswers, images, fullMaxScore, (val) => {
                    if (val < 100) {
                        // AI採点の各セクション進捗を 20% 〜 90% にマッピング
                        setGradingProgressValue(20 + Math.round(val * 0.7));
                    } else {
                        // 100% (採点完了直後) は 90% として止めておき、総評生成中であることを示す
                        setGradingProgress('AI先生の総評を生成中...');
                        setGradingProgressValue(90);
                        addLog("採点完了。AI先生が全体の総評を生成しています...");
                    }
                });
                setGradingProgressValue(100);
                console.log("Grading Result Raw:", result);
            } catch (apiError) {
                console.error("API Error:", apiError);
                throw new Error(`API Error: ${apiError.message}`);
            }

            if (!result) {
                throw new Error("採点結果が空でした。");
            }

            addLog("採点完了！結果画面へ移動します。");

            // Clear session storage on successful completion
            sessionStorage.removeItem(`exam_answers_${exam.id}`);
            sessionStorage.removeItem(`exam_timer_started_${exam.id}`);
            sessionStorage.removeItem(`exam_time_remaining_${exam.id}`);

            setGrading(false);
            navigate('/result', {
                state: {
                    result,
                    universityName,
                    facultyName,
                    examId: exam.id,
                    examSubject: exam.subject,
                    examStructure: examData?.structure || [], // Pass section-level master data
                    customLayout: examData?.custom_layout || exam?.custom_layout || [],
                    answers: formattedAnswers,
                    pdfPath: exam.pdfPath, // Added to allow viewing PDF from ResultPage
                    isNewResult: true // Flag to indicate this is a new result that needs saving
                }
            });
        } catch (error) {
            console.error("Submit Error:", error);
            setGrading(false);
            addLog(`エラー発生: ${error.message}`);
            alert(`エラーが発生しました: ${error.message}`);
        }
    };

    const confirmSubmit = () => {
        setShowConfirmModal(true);
    };

    return (
        <div style={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--color-bg-secondary)',
            position: 'relative'
        }}>
            {/* Compact Header for Mobile & Desktop */}
            <div className="exam-header-compact">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button
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
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <h2 style={{ fontSize: '0.95rem', color: 'var(--color-accent-primary)', lineHeight: 1.2, margin: 0 }}>
                            {universityName || exam?.university || '大学'}
                        </h2>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                            {exam?.year || ''}年 {exam?.subject || ''}
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {timerStarted && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            color: timerExpired ? '#ef4444' : (timeRemaining < 300 ? '#f59e0b' : 'var(--color-text-primary)'),
                            fontWeight: '700',
                            fontFamily: 'monospace',
                            fontSize: '1.1rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '20px',
                            background: 'rgba(255,255,255,0.6)',
                            border: '1px solid currentColor'
                        }}>
                            {formatTime(timeRemaining)}
                        </div>
                    )}
                    <button
                        className="btn btn-secondary"
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                        onClick={() => handleExit('/')}
                    >
                        終了
                    </button>
                    {timerStarted && !grading && (
                        <>
                            <button
                                className="btn btn-secondary shadow-none"
                                style={{
                                    padding: '0.4rem 0.8rem',
                                    fontSize: '0.8rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.3rem'
                                }}
                                onClick={() => {
                                    if (exam?.pdfPath || exam?.pdf_path) {
                                        window.open(exam.pdfPath || exam.pdf_path, '_blank');
                                    } else {
                                        alert("PDFのパスが見つかりません。");
                                    }
                                }}
                                title="原本PDFを新しいタブで開いて印刷・保存します"
                            >
                                <span style={{ fontSize: '1rem' }}>📥</span>
                                <span className="hide-on-mobile">PDF印刷/保存</span>
                                <span className="show-on-mobile" style={{ display: 'none' }}>PDF</span>
                            </button>
                            <button
                                className="btn btn-primary"
                                style={{
                                    padding: '0.4rem 0.8rem',
                                    fontSize: '0.8rem',
                                    boxShadow: 'none'
                                }}
                                onClick={confirmSubmit}
                            >
                                採点
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Mobile Tab Switcher - Segmented Control Style */}
            <div className="show-on-mobile" style={{
                display: 'none',
                padding: '0.6rem 1rem',
                background: 'white',
                borderBottom: '1px solid var(--color-silver-light)'
            }}>
                <div style={{
                    display: 'flex',
                    background: '#f1f5f9',
                    padding: '2px',
                    borderRadius: '8px'
                }}>
                    <button
                        onClick={() => setActiveTab('pdf')}
                        className="btn-mobile-full"
                        style={{
                            flex: 1,
                            padding: '0.5rem',
                            border: 'none',
                            borderRadius: '6px',
                            background: activeTab === 'pdf' ? 'white' : 'transparent',
                            color: activeTab === 'pdf' ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
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
                        onClick={() => setActiveTab('answer')}
                        className="btn-mobile-full"
                        style={{
                            flex: 1,
                            padding: '0.5rem',
                            border: 'none',
                            borderRadius: '6px',
                            background: activeTab === 'answer' ? 'white' : 'transparent',
                            color: activeTab === 'answer' ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
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
                                src={exam?.pdfPath || exam?.pdf_path}
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
                                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⏱️</div>
                                <h2 style={{ fontSize: '1.3rem', marginBottom: '1.5rem', color: '#1e293b' }}>
                                    試験を開始する前に
                                </h2>
                                <div style={{
                                    background: '#f8fafc',
                                    padding: '1.5rem',
                                    borderRadius: '12px',
                                    marginBottom: '2rem',
                                    textAlign: 'left',
                                    border: '1px solid #e2e8f0'
                                }}>
                                    <p style={{ fontSize: '0.9rem', color: '#475569', marginBottom: '1rem', fontWeight: '600' }}>
                                        以下を確認してください：
                                    </p>
                                    <ul style={{ fontSize: '0.85rem', color: '#64748b', lineHeight: '1.8', paddingLeft: '1.2rem', margin: 0 }}>
                                        <li>筆記用具の準備</li>
                                        <li>静かな環境の確保</li>
                                        <li>制限時間は{exam?.duration_minutes || 60}分です</li>
                                        <li>途中で中断できません</li>
                                    </ul>
                                </div>
                                <button
                                    className="btn btn-primary"
                                    onClick={startTimer}
                                    style={{
                                        width: '100%',
                                        padding: '1rem 2rem',
                                        fontSize: '1.1rem',
                                        fontWeight: 'bold',
                                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                                        boxShadow: '0 4px 15px rgba(59, 130, 246, 0.3)'
                                    }}
                                >
                                    試験を開始
                                </button>
                            </div>
                        </div>
                    )}

                    <div style={{ padding: '1.5rem', borderBottom: 'var(--border-glass)' }}>
                        <h2 style={{ fontSize: '1.1rem' }}>解答用紙</h2>
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                            問題を見て解答を入力してください。
                        </p>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
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

                                            // Determine if multiple selection is allowed
                                            // Check if correctAnswer contains comma (e.g., "c, a")
                                            const isMultiple = q.correctAnswer && String(q.correctAnswer).includes(',');

                                            return (
                                                <div key={uniqueKey} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                                                    <span style={{ minWidth: '30px', fontWeight: '600', fontSize: '0.9rem', paddingTop: '0.2rem' }}>
                                                        {q.label || `(${i + 1})`}
                                                    </span>
                                                    {qType === 'selection' ? (
                                                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                                            {qOptions.map(option => (
                                                                <label key={option} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
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
                                                                        disabled={!timerStarted}
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
                                                                borderRadius: '8px',
                                                                fontFamily: 'inherit',
                                                                opacity: !timerStarted ? 0.5 : 1,
                                                                cursor: !timerStarted ? 'not-allowed' : 'text'
                                                            }}
                                                            placeholder="解答を入力..."
                                                            value={answers[uniqueKey] || ''}
                                                            onChange={(e) => handleAnswerChange(uniqueKey, e.target.value)}
                                                            disabled={!timerStarted}
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

                    <div style={{ padding: '1.5rem', borderTop: 'var(--border-glass)', background: 'var(--color-bg-glass)' }}>
                        <button
                            className="btn btn-primary"
                            style={{
                                width: '100%',
                                opacity: grading ? 0.7 : 1,
                                cursor: grading ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.5rem'
                            }}
                            onClick={confirmSubmit}
                            disabled={grading}
                        >
                            {grading ? (
                                <>
                                    <span className="spinner"></span>
                                    <span>採点中...</span>
                                </>
                            ) : (
                                "AIで採点する"
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
                    <div className="glass-panel" style={{ background: 'white', padding: '2rem', maxWidth: '400px', width: '100%', textAlign: 'center' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📤</div>
                        <h3 style={{ marginBottom: '1rem' }}>試験を終了して採点しますか？</h3>
                        <p style={{ color: 'var(--color-text-secondary)', marginBottom: '2rem', fontSize: '0.9rem' }}>
                            一度提出すると、解答を修正することはできません。<br />
                            AI先生が採点と詳細な分析を開始します。
                        </p>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowConfirmModal(false)}>
                                まだ続ける
                            </button>
                            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSubmit}>
                                提出する
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Log & Progress Overlay */}
            {(logs.length > 0 || grading) && (
                <div style={{
                    position: 'fixed',
                    bottom: '24px',
                    right: '24px',
                    background: 'rgba(15, 23, 42, 0.95)',
                    backdropFilter: 'blur(12px)',
                    color: 'white',
                    padding: '1.5rem',
                    borderRadius: '24px',
                    width: '360px',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
                    zIndex: 3000,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem'
                }}>
                    {/* Progress Section (Always Visible at Top) */}
                    {grading && (
                        <div style={{ 
                            borderBottom: '1px solid rgba(255, 255, 255, 0.1)', 
                            paddingBottom: '1rem' 
                        }}>
                            <div style={{ 
                                fontWeight: '900', 
                                fontSize: '0.85rem', 
                                marginBottom: '0.75rem', 
                                color: '#10b981', 
                                display: 'flex', 
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                                    {gradingProgress || '採点中...'}
                                </span>
                                <span style={{ fontFamily: 'monospace', fontSize: '1rem' }}>{gradingProgressValue}%</span>
                            </div>
                            
                            <div style={{ 
                                height: '6px', 
                                width: '100%', 
                                background: 'rgba(255,255,255,0.1)', 
                                borderRadius: '3px', 
                                overflow: 'hidden'
                            }}>
                                <div style={{ 
                                    height: '100%', 
                                    width: `${gradingProgressValue}%`, 
                                    background: 'linear-gradient(90deg, #10b981 0%, #34d399 100%)',
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
                            color: 'rgba(255,255,255,0.4)', 
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
                                <span style={{ color: '#10b981', marginRight: '8px', fontWeight: 'bold' }}>&gt;</span>
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
