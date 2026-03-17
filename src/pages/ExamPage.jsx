import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { gradeExamWithGemini } from '../services/geminiService';

const ExamPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    let { exam, universityName, universityId } = location.state || {};
    
    // Check localStorage if coming from Admin "Save & Preview" new tab
    if (!exam) {
        try {
            const previewData = localStorage.getItem('previewExamData');
            if (previewData) {
                const parsed = JSON.parse(previewData);
                exam = parsed.exam;
                universityName = parsed.universityName;
                universityId = parsed.universityId;
            }
        } catch (e) {
            console.error("Failed to parse preview data from localStorage", e);
        }
    }

    // Debug: Check what is actually being passed
    // alert(`Debug State: ID=${universityId}, Exam=${!!exam}`);
    console.log("ExamPage State:", location.state);

    const [answers, setAnswers] = useState({});
    const [grading, setGrading] = useState(false);
    const [gradingProgress, setGradingProgress] = useState('');
    const [logs, setLogs] = useState([]);
    // Initialize directly from the passed exam object
    // This restores the behavior to the "first version" where we relied on mock data
    const [examData, setExamData] = useState(exam || null);

    // Timer states
    const [timerStarted, setTimerStarted] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState(60 * 60); // 60 minutes in seconds
    const [timerExpired, setTimerExpired] = useState(false);

    // Mobile Tab State (pdf or answer)
    const [activeTab, setActiveTab] = useState('pdf');
    // Submission Confirmation
    const [showConfirmModal, setShowConfirmModal] = useState(false);

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

    // Start timer function
    const startTimer = () => {
        setTimerStarted(true);
        setTimeRemaining(60 * 60); // Reset to 60 minutes
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
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (!apiKey) {
            alert('APIキーが設定されていません。');
            return;
        }

        setShowConfirmModal(false); // Close modal

        try {
            setGrading(true);
            setLogs(['採点を開始します...']);

            // Re-fetch images for grading context
            setGradingProgress("PDFを画像に変換中...");
            addLog("Step 1: 採点用にPDFを再読み込み中...");
            const images = await import('../utils/pdfUtils').then(m => m.convertPdfToImages(exam.pdfPath, (msg) => {
                addLog(msg);
                if (msg.includes("Page")) {
                    setGradingProgress(`PDF変換中: ${msg}`);
                }
            }));

            setGradingProgress("AIによる採点を実行中...");
            addLog("Step 2: 採点データを送信中...");

            // Format answers for submission (join arrays with comma)
            const formattedAnswers = Object.entries(answers).reduce((acc, [key, val]) => {
                acc[key] = Array.isArray(val) ? val.sort().join(', ') : val;
                return acc;
            }, {});

            let result;
            try {
                // Pass the loaded examData (with structure/answers) to the grading service
                result = await gradeExamWithGemini(apiKey, examData, formattedAnswers, images);
                console.log("Grading Result Raw:", result);
            } catch (apiError) {
                console.error("API Error:", apiError);
                throw new Error(`API Error: ${apiError.message}`);
            }

            if (!result) {
                throw new Error("採点結果が空でした。");
            }

            addLog("採点完了！結果画面へ移動します。");

            setGrading(false);
            navigate('/result', {
                state: {
                    result,
                    universityName,
                    examSubject: exam.subject,
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
                        onClick={() => navigate(`/university/${universityId || ''}`)}
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
                            {universityName || '大学'}
                        </h2>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                            {exam.year}年 {exam.subject}
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
                        onClick={() => navigate('/')}
                    >
                        終了
                    </button>
                    {timerStarted && !grading && (
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
                    display: activeTab === 'pdf' ? 'block' : 'none'
                }} className="pdf-container">
                    {exam.type === 'pdf' ? (
                        <iframe
                            src={exam.pdfPath}
                            style={{ width: '100%', height: '100%', border: 'none' }}
                            title="Exam PDF"
                        />
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
                    display: activeTab === 'answer' ? 'flex' : 'none',
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
                                        <li>制限時間は60分です</li>
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
            {/* Log Overlay */}
            {logs.length > 0 && (
                <div style={{
                    position: 'fixed',
                    bottom: '20px',
                    right: '20px',
                    background: 'rgba(0,0,0,0.8)',
                    color: 'white',
                    padding: '1rem',
                    borderRadius: '8px',
                    maxWidth: '400px',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    zIndex: 1000,
                    fontSize: '0.8rem',
                    fontFamily: 'monospace'
                }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', borderBottom: '1px solid #555' }}>採点ログ</div>
                    {logs.map((log, i) => (
                        <div key={i}>{log}</div>
                    ))}
                    {grading && (
                        <div style={{ marginTop: '0.5rem', color: '#4ade80' }}>
                            <div style={{ fontWeight: 'bold' }}>{gradingProgress}</div>
                            <div className="animate-pulse">採点中...</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ExamPage;
