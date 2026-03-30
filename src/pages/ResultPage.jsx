import { chatWithGemini } from '../services/geminiService';
import RecruitmentBanner from '../components/RecruitmentBanner';
import AdBanner from '../components/AdBanner';
import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { saveExamResult, getExamStatistics } from '../services/resultService';
import { reportGradingError } from '../services/reportService';

const ResultPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { result, universityName, examSubject, answers, isNewResult } = location.state || {};
    const { user } = useAuth();

    console.log("ResultPage State:", { result, universityName, examSubject, isNewResult });

    if (!result || typeof result.score === 'undefined') {
        return (
            <div className="container" style={{ padding: '2rem', textAlign: 'center' }}>
                <h2>結果データが不正です</h2>
                <p>採点結果の読み込みに失敗しました。</p>
                <div style={{ background: '#f0f0f0', padding: '1rem', margin: '1rem 0', borderRadius: '8px', textAlign: 'left', fontSize: '0.8rem' }}>
                    <strong>Debug Info:</strong>
                    <pre>{JSON.stringify(location.state, null, 2)}</pre>
                </div>
                <button className="btn btn-primary" onClick={() => navigate('/')}>トップへ戻る</button>
            </div>
        );
    }

    const [chatInput, setChatInput] = useState('');
    const [chatHistory, setChatHistory] = useState([]);
    const [isChatting, setIsChatting] = useState(false);
    const [saved, setSaved] = useState(false);
    const [stats, setStats] = useState(null);
    const [error, setError] = useState(null);
    const [reportingItem, setReportingItem] = useState(null);
    const [reportComment, setReportComment] = useState('');
    const [isReporting, setIsReporting] = useState(false);
    const hasSavedRef = useRef(false);

    useEffect(() => {
        const saveData = async () => {
            if (user && result && isNewResult && !hasSavedRef.current) {
                hasSavedRef.current = true;
                try {
                    await saveExamResult(user.id, {
                        universityName,
                        examSubject,
                        score: result.score,
                        maxScore: result.maxScore,
                        passProbability: result.passProbability,
                        weaknessAnalysis: result.weaknessAnalysis,
                        answers: answers,
                        questionFeedback: result.questionFeedback
                    });
                    setSaved(true);
                    // After saving, fetch stats
                    const statsData = await getExamStatistics(universityName, examSubject, result.score);
                    setStats(statsData);
                } catch (err) {
                    console.error("Error saving result:", err);
                    setError("結果の保存に失敗しました");
                }
            } else if (result) {
                // Just fetch stats if not new
                try {
                    const statsData = await getExamStatistics(universityName, examSubject, result.score);
                    setStats(statsData);
                } catch (err) {
                    console.error("Error fetching stats:", err);
                }
            }
        };
        saveData();
    }, [user, result, universityName, examSubject, answers, isNewResult]);

    const handleChatSubmit = async (e) => {
        e.preventDefault();
        if (!chatInput.trim() || isChatting) return;

        const userMsg = chatInput;
        setChatInput('');
        setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
        setIsChatting(true);

        try {
            const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
            const response = await chatWithGemini(apiKey, userMsg, chatHistory, result);
            setChatHistory(prev => [...prev, { role: 'ai', text: response }]);
        } catch (err) {
            console.error("Chat error:", err);
            setChatHistory(prev => [...prev, { role: 'ai', text: "すみません、エラーが発生しました。" }]);
        } finally {
            setIsChatting(false);
        }
    };

    const handleReportSubmit = async () => {
        if (!user || !reportingItem) return;
        setIsReporting(true);
        try {
            await reportGradingError(user.id, {
                universityName,
                examSubject,
                questionId: reportingItem.id,
                userAnswer: reportingItem.userAnswer,
                correctAnswer: reportingItem.correctAnswer,
                aiExplanation: reportingItem.explanation,
                userComment: reportComment
            });
            alert('報告ありがとうございます。内容を確認させていただきます。');
            setReportingItem(null);
            setReportComment('');
        } catch (err) {
            console.error("Report error:", err);
            alert('報告の送信に失敗しました。');
        } finally {
            setIsReporting(false);
        }
    };


    // Helper for probability color
    const getProbabilityColor = (prob) => {
        if (!prob) return 'var(--color-text-primary)';
        if (prob === 'A' || prob === 'B') return 'var(--color-accent-primary)'; // Gold/Yellow
        if (prob === 'C') return '#f59e0b'; // Orange
        if (prob === 'D') return '#ef4444'; // Red
        return '#64748b'; // Gray
    };


    return (
        <div className="container" style={{ maxWidth: '800px', paddingBottom: '4rem' }}>
            <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>採点結果</h1>
                <p style={{ color: 'var(--color-text-secondary)' }}>{universityName} - {examSubject}</p>
            </header>

            <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 120px' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>得点</div>
                        <div style={{ fontSize: '3rem', fontWeight: '700', color: 'var(--color-accent-primary)' }}>
                            {result.score}<span style={{ fontSize: '1.2rem', color: 'var(--color-text-secondary)' }}>/{result.maxScore}</span>
                        </div>
                    </div>
                    <div style={{ flex: '1 1 120px' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>合格可能性</div>
                        <div style={{ fontSize: '3rem', fontWeight: '700', color: getProbabilityColor(result.passProbability) }}>
                            {result.passProbability}
                        </div>
                    </div>
                </div>

                <div style={{ textAlign: 'left', background: 'rgba(255,255,255,0.5)', padding: '1.25rem', borderRadius: '12px' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--color-text-primary)' }}>弱点分析・アドバイス</h3>
                    <p style={{ lineHeight: '1.6', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
                        {result.weaknessAnalysis}
                    </p>
                </div>
            </div>

            {/* Banner Ad */}
            <AdBanner pageTarget="result" className="mb-8" />

            <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', textAlign: 'center' }}>成績分析</h2>

                <div className="glass-panel" style={{ padding: '2rem' }}>
                    {stats ? (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '2rem', marginBottom: '2rem' }}>
                                <div style={{ textAlign: 'center', minWidth: '120px' }}>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>偏差値</div>
                                    <div style={{ fontSize: '2.5rem', fontWeight: '700', color: 'var(--color-text-primary)' }}>
                                        {stats.deviationValue}
                                    </div>
                                </div>
                                <div style={{ textAlign: 'center', minWidth: '120px' }}>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>全体順位</div>
                                    <div style={{ fontSize: '2.5rem', fontWeight: '700', color: 'var(--color-text-primary)' }}>
                                        {stats.ranking}<span style={{ fontSize: '1.2rem', color: 'var(--color-text-secondary)' }}>/{stats.totalExaminees}位</span>
                                    </div>
                                </div>
                                {stats.firstChoiceUniversity && (
                                    <div style={{ textAlign: 'center', minWidth: '120px', borderLeft: '1px solid #eee', paddingLeft: '2rem' }}>
                                        <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
                                            {stats.firstChoiceUniversity}志望内順位
                                        </div>
                                        <div style={{ fontSize: '2.5rem', fontWeight: '700', color: 'var(--color-accent-primary)' }}>
                                            {stats.firstChoiceRank ? (
                                                <>
                                                    {stats.firstChoiceRank}<span style={{ fontSize: '1.2rem', color: 'var(--color-text-secondary)' }}>/{stats.firstChoiceTotal}位</span>
                                                </>
                                            ) : (
                                                <span style={{ fontSize: '1.2rem', color: '#999' }}>データ不足</span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {stats.sectionAverages && stats.sectionAverages.length > 0 && (
                                <div style={{ marginTop: '2rem' }}>
                                    <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', textAlign: 'center' }}>大問別得点比較</h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {stats.sectionAverages.map((section, index) => (
                                            <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                                <div style={{ width: '60px', fontWeight: '600' }}>{section.sectionId}</div>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.85rem' }}>
                                                        <span>あなた: {section.userScore}</span>
                                                        <span>平均: {section.averageScore.toFixed(1)}</span>
                                                    </div>
                                                    <div style={{ height: '10px', background: '#e2e8f0', borderRadius: '5px', overflow: 'hidden', position: 'relative' }}>
                                                        {/* User Score Bar */}
                                                        <div style={{
                                                            position: 'absolute',
                                                            top: 0, left: 0, bottom: 0,
                                                            width: `${(section.userScore / section.maxScore) * 100}%`,
                                                            background: 'var(--color-accent-primary)',
                                                            opacity: 0.8
                                                        }} />
                                                        {/* Average Score Marker */}
                                                        <div style={{
                                                            position: 'absolute',
                                                            top: 0, bottom: 0,
                                                            left: `${(section.averageScore / section.maxScore) * 100}%`,
                                                            width: '4px',
                                                            background: '#ef4444',
                                                            zIndex: 10
                                                        }} />
                                                    </div>
                                                </div>
                                                <div style={{ width: '40px', textAlign: 'right', fontSize: '0.85rem', color: '#64748b' }}>
                                                    /{section.maxScore}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ textAlign: 'center', fontSize: '0.8rem', color: '#64748b', marginTop: '0.5rem' }}>
                                        <span style={{ display: 'inline-block', width: '10px', height: '10px', background: 'var(--color-accent-primary)', marginRight: '5px' }}></span>あなたの得点
                                        <span style={{ display: 'inline-block', width: '4px', height: '10px', background: '#ef4444', marginLeft: '15px', marginRight: '5px' }}></span>平均点
                                    </div>
                                </div>
                            )}
                        </>
                    ) : error ? (
                        <div style={{ textAlign: 'center', padding: '2rem', color: '#ef4444' }}>
                            <p>データの読み込みに失敗しました。</p>
                            <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>{error}</p>
                        </div>
                    ) : (
                        <div style={{ textAlign: 'center', padding: '2rem' }}>分析データを読み込み中...</div>
                    )}
                </div>
            </div>

            <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>詳細フィードバック</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {result.questionFeedback && result.questionFeedback.length > 0 ? (
                    result.questionFeedback.map((item) => (
                        <div key={item.id || Math.random()} className="glass-panel" style={{ padding: '1.5rem', borderLeft: `4px solid ${item.correct ? '#10b981' : '#ef4444'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                <span style={{ fontWeight: '600' }}>{item.id}</span>
                                <span style={{
                                    color: item.correct ? '#10b981' : '#ef4444',
                                    fontWeight: '600',
                                    background: item.correct ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                    padding: '0.25rem 0.75rem',
                                    borderRadius: '20px',
                                    fontSize: '0.8rem'
                                }}>
                                    {item.correct ? '正解' : '不正解'}
                                </span>
                            </div>
                            <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '8px' }}>
                                <div style={{ marginBottom: '0.5rem', fontSize: '0.85rem', color: '#64748b' }}>
                                    <span style={{ fontWeight: '600' }}>あなたの解答:</span>
                                    <span style={{ marginLeft: '0.5rem', fontSize: '1rem', color: '#1e293b', fontWeight: '600' }}>
                                        {item.userAnswer || '(無回答)'}
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                                    <span style={{ fontWeight: '600' }}>正解:</span>
                                    <span style={{ marginLeft: '0.5rem', fontSize: '1rem', color: item.correct ? '#10b981' : '#ef4444', fontWeight: '600' }}>
                                        {item.correctAnswer}
                                    </span>
                                </div>
                            </div>
                            <p style={{ fontSize: '0.95rem', lineHeight: '1.5', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
                                {item.explanation}
                            </p>
                            <div style={{ textAlign: 'right' }}>
                                <button
                                    onClick={() => setReportingItem(item)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: '#94a3b8',
                                        fontSize: '0.8rem',
                                        cursor: 'pointer',
                                        textDecoration: 'underline'
                                    }}
                                >
                                    採点ミスを報告
                                </button>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
                        フィードバックデータがありません。
                    </div>
                )}
            </div>

            {/* Detailed AI Explanation Section */}
            {result.detailedAnalysis && (
                <div style={{ marginTop: '3rem' }}>
                    <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>AI先生による思考プロセス解説</h2>
                    <div className="glass-panel" style={{ padding: '2rem', background: 'white' }}>
                        <div style={{
                            lineHeight: '1.8',
                            color: 'var(--color-text-primary)',
                            fontSize: '1rem',
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'var(--font-main)'
                        }}>
                            {result.detailedAnalysis}
                        </div>
                    </div>
                </div>
            )}

            {/* Recruitment Banner */}
            <RecruitmentBanner />

            {/* Chat Interface */}
            <div style={{ marginTop: '3rem' }}>
                <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>AI先生に質問する</h2>
                <div className="glass-panel" style={{ padding: '1.5rem' }}>
                    <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {chatHistory.length === 0 && (
                            <div style={{ color: '#888', textAlign: 'center', padding: '1rem' }}>
                                解説でわからなかったことや、勉強法について質問してみましょう。
                            </div>
                        )}
                        {chatHistory.map((msg, i) => (
                            <div key={i} style={{
                                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                background: msg.role === 'user' ? 'var(--color-accent-primary)' : '#f1f5f9',
                                color: msg.role === 'user' ? 'white' : '#333',
                                padding: '0.75rem 1rem',
                                borderRadius: '12px',
                                maxWidth: '80%'
                            }}>
                                {msg.text}
                            </div>
                        ))}
                        {isChatting && <div style={{ color: '#888', fontSize: '0.9rem' }}>AIが入力中...</div>}
                    </div>
                    <form onSubmit={handleChatSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
                        <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            placeholder="質問を入力..."
                            style={{ flex: 1, padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                            disabled={isChatting}
                        />
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={isChatting}
                        >
                            送信
                        </button>
                    </form>
                </div>
            </div>

            <div style={{ marginTop: '3rem', textAlign: 'center' }}>
                <button className="btn btn-secondary" onClick={() => navigate('/')}>
                    トップに戻る
                </button>
            </div>

            {/* Report Modal */}
            {reportingItem && (
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
                    <div className="glass-panel" style={{ background: 'white', padding: '2rem', maxWidth: '500px', width: '100%' }}>
                        <h3 style={{ marginBottom: '1rem' }}>採点ミスの報告</h3>
                        <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '1rem' }}>
                            問題: {reportingItem.id}<br />
                            AIの判定が間違っていると思われる理由を教えてください。
                        </p>
                        <textarea
                            value={reportComment}
                            onChange={(e) => setReportComment(e.target.value)}
                            placeholder="例: 正解はAですが、Bも文脈上正しいはずです。"
                            style={{
                                width: '100%',
                                height: '120px',
                                padding: '0.75rem',
                                borderRadius: '8px',
                                border: '1px solid #e2e8f0',
                                marginBottom: '1.5rem',
                                fontFamily: 'inherit'
                            }}
                        />
                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setReportingItem(null)} disabled={isReporting}>
                                キャンセル
                            </button>
                            <button className="btn btn-primary" onClick={handleReportSubmit} disabled={isReporting || !reportComment.trim()}>
                                {isReporting ? '送信中...' : '報告を送信'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ResultPage;
