import { chatWithGemini } from '../services/geminiService';
import RecruitmentBanner from '../components/RecruitmentBanner';
import AdBanner from '../components/AdBanner';
import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { saveExamResult, getExamStatistics } from '../services/resultService';
import { reportGradingError } from '../services/reportService';
import { isAdminEmail } from '../config/adminConfig';
import { updateAdminFields, uploadAnalysisImage, getAdminExamById } from '../services/adminExamService';
import { getAdminBanners } from '../services/adminBannerService';

const ResultPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { result: initialResult, universityName, facultyName, examId, examSubject, answers, examStructure: initialStructure, customLayout: initialCustomLayout, isNewResult, isDesignMode: incomingDesignMode } = location.state || {};
    const { user, profile } = useAuth();
    const isAdmin = user && (isAdminEmail(user.email) || profile?.role === 'admin');

    // Local state for editable data to ensure instant feedback
    const [resultData, setResultData] = useState(initialResult);
    const [currentStructure, setCurrentStructure] = useState(initialStructure || []);
    const [banners, setBanners] = useState([]);

    useEffect(() => {
        if (isAdmin) {
            const fetchBanners = async () => {
                try {
                    const data = await getAdminBanners();
                    setBanners(data || []);
                } catch (err) {
                    console.error("Failed to fetch banners in ResultPage:", err);
                }
            };
            fetchBanners();
        }
    }, [isAdmin]);

    if (!resultData || typeof resultData.score === 'undefined') {
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
    const [isDesignMode, setIsDesignMode] = useState(!!incomingDesignMode);
    const [originalData, setOriginalData] = useState(null); // Backup for cancel

    const hasSavedRef = useRef(false);

    useEffect(() => {
        if (!examId) return;
        
        const syncWithDB = async () => {
            try {
                const { data, error } = await getAdminExamById(examId);
                if (!error && data) {
                    console.log("--- SYNC WITH DB ---");
                    console.log("Master Data Questions:", data.structure?.flatMap(s => s.questions || []).length);
                    
                    // Sync with latest DB data to ensure persistence across reloads/navigation
                    setResultData(prev => {
                        const next = { ...prev };
                        // Only sync master analysis fields if we're in design mode or if they are currently empty
                        // This prevents student-specific results from being overwritten by master templates
                        if (isDesignMode || !prev?.detailedAnalysis) {
                            if (data.detailed_analysis) next.detailedAnalysis = data.detailed_analysis;
                        }
                        if (isDesignMode || !prev?.weaknessAnalysis) {
                            if (data.weakness_analysis) next.weaknessAnalysis = data.weakness_analysis;
                        }
                        
                        // If we are in design mode and have no questionFeedback, try to re-map from structure
                        if (prev && (!prev.questionFeedback || prev.questionFeedback.length === 0) && data.structure) {
                            console.log("Populating dummy feedback from master structure during sync...");
                            const dummy = [];
                            data.structure.forEach(section => {
                                (section.questions || []).forEach(q => {
                                    dummy.push({
                                        id: q.id,
                                        correct: false,
                                        userAnswer: "",
                                        correctAnswer: q.correctAnswer || q.answer || "",
                                        explanation: q.explanation || ""
                                    });
                                });
                            });
                            next.questionFeedback = dummy;
                        }
                        return next;
                    });
                    
                    if (data.structure) {
                        setCurrentStructure(data.structure);
                    }
                }
            } catch (err) {
                console.error("Sync error:", err);
            }
        };
        syncWithDB();
    }, [examId]);

    useEffect(() => {
        const saveData = async () => {
            if (user && resultData && isNewResult && !hasSavedRef.current) {
                hasSavedRef.current = true;
                try {
                    await saveExamResult(user.id, {
                        universityName,
                        facultyName,
                        examSubject,
                        score: resultData.score,
                        maxScore: resultData.maxScore,
                        passProbability: resultData.passProbability,
                        weaknessAnalysis: typeof resultData.weaknessAnalysis === 'string' ? resultData.weaknessAnalysis : JSON.stringify(resultData.weaknessAnalysis),
                        answers: answers,
                        questionFeedback: resultData.questionFeedback
                    });
                    setSaved(true);
                    const statsData = await getExamStatistics(universityName, examSubject, resultData.score);
                    setStats(statsData);
                } catch (err) {
                    console.error("Error saving result:", err);
                    setError("結果の保存に失敗しました");
                }
            } else if (resultData) {
                try {
                    const statsData = await getExamStatistics(universityName, examSubject, resultData.score);
                    setStats(statsData);
                } catch (err) {
                    console.error("Error fetching stats:", err);
                }
            }
        };
        saveData();
    }, [user, resultData, universityName, examSubject, answers, isNewResult]);

    const handleChatSubmit = async (e) => {
        e.preventDefault();
        if (!chatInput.trim() || isChatting) return;

        const userMsg = chatInput;
        setChatInput('');
        setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
        setIsChatting(true);

        try {
            const apiKey = import.meta.env.VITE_GEMINI_API_KEY_V2 || import.meta.env.VITE_GEMINI_API_KEY || window._GEMINI_API_KEY;
            const response = await chatWithGemini(apiKey, userMsg, chatHistory, resultData);
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

    const getProbabilityColor = (prob) => {
        if (!prob) return 'var(--color-text-primary)';
        if (prob === 'A' || prob === 'B') return 'var(--color-accent-primary)';
        if (prob === 'C') return '#f59e0b';
        if (prob === 'D') return '#ef4444';
        return '#64748b';
    };

    const parseBlocks = (data) => {
        if (!data) return [{ type: 'text', content: '', id: Math.random() }];
        if (Array.isArray(data)) return data;
        try {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {}
        return [{ type: 'text', content: String(data), id: Math.random() }];
    };

    const handleSaveLayout = async () => {
        if (!examId) {
            alert("この試験のIDが見つからないため保存できません。");
            return;
        }
        try {
            // Ensure we are saving ALL fields correctly
            const masterUpdates = {
                structure: currentStructure,
                detailed_analysis: JSON.stringify(parseBlocks(resultData.detailedAnalysis)),
                weakness_analysis: JSON.stringify(parseBlocks(resultData.weaknessAnalysis))
            };
            
            console.log("--- SAVE ACTION DEBUG ---");
            console.log("Exam ID:", examId);
            console.log("Payload:", masterUpdates);
            
            const { data, error } = await updateAdminFields(examId, masterUpdates);
            
            if (error) {
                console.error("Supabase Update Error:", error);
                throw error;
            }
            
            console.log("✅ Save success. Response data:", data);
            alert("解説データをマスターデータに同期しました。");
            setIsDesignMode(false);
        } catch (err) {
            console.error("Save error:", err);
            alert("保存に失敗しました。");
        }
    };

    const ContentBlockRenderer = ({ blocks, onUpdate, fieldName }) => {
        const handleFileChange = async (e, blockId) => {
            const file = e.target.files[0];
            if (!file) return;

            // Robust examId retrieval
            const currentExamId = examId || resultData?.examId || resultData?.id;

            try {
                console.log("--- Image Upload Debug ---");
                console.log("Target Exam ID:", currentExamId);
                console.log("Supabase URL Configured:", import.meta.env.VITE_SUPABASE_URL);
                
                if (!currentExamId) throw new Error("試験IDを特定できませんでした。トップページから入り直すか、一度データを保存してから再度お試しください。");
                
                const { publicUrl, error } = await uploadAnalysisImage(file, currentExamId);
                if (error) throw error;
                
                console.log("✅ Uploaded Image URL:", publicUrl);
                if (!publicUrl) throw new Error("URLの取得に失敗しました。");
                
                onUpdate(prevBlocks => prevBlocks.map(b => b.id === blockId ? { ...b, imageUrl: publicUrl } : b));
            } catch (err) {
                console.error("❌ Upload error detail:", err);
                alert(`画像のアップロードに失敗しました: ${err.message || '不明なエラー'}\n\n※サーバー再起動（npm run dev）とブラウザ更新（Cmd+Shift+R）を試してください。`);
            }
        };

        const addBlock = (type, index = -1) => {
            const newBlock = { 
                type, 
                id: Math.random(), 
                content: (type === 'image_full' || type === 'ad') ? '' : 'ここに文章を入力...',
                imageUrl: (type === 'image_left' || type === 'image_full') ? 'https://via.placeholder.com/400x300?text=Image+Upload' : undefined
            };
            
            onUpdate(prevBlocks => {
                const updated = [...prevBlocks];
                if (index >= 0) {
                    updated.splice(index, 0, newBlock);
                } else {
                    updated.push(newBlock);
                }
                return updated;
            });
        };

        const removeBlock = (id) => {
            if (blocks.length <= 1) return;
            onUpdate(blocks.filter(b => b.id !== id));
        };

        const Inserter = ({ index }) => {
            if (!isDesignMode || fieldName === 'weakness') return null;
            return (
                <div 
                    className="block-inserter"
                    style={{ 
                        height: '24px', 
                        margin: '-12px 0', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        position: 'relative', 
                        zIndex: 20,
                        opacity: 0,
                        transition: 'opacity 0.2s',
                        cursor: 'pointer'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = '0'}
                >
                    <div style={{ width: '100%', height: '2px', background: '#6366f1', position: 'absolute' }}></div>
                    <div style={{ 
                        background: '#6366f1', 
                        color: 'white', 
                        borderRadius: '12px', 
                        padding: '0 8px', 
                        fontSize: '0.7rem', 
                        fontWeight: '700', 
                        display: 'flex', 
                        gap: '8px',
                        alignItems: 'center',
                        boxShadow: '0 2px 8px rgba(99,102,241,0.4)',
                        zIndex: 21
                    }}>
                        <span style={{ fontSize: '1rem' }}>+</span> 
                        <span onClick={() => addBlock('heading', index)} style={{ cursor: 'pointer' }}>見出し</span>
                        <span onClick={() => addBlock('subheading', index)} style={{ cursor: 'pointer' }}>中見出し</span>
                        <span onClick={() => addBlock('text', index)} style={{ cursor: 'pointer' }}>テキスト</span>
                        <span onClick={() => addBlock('image_left', index)} style={{ cursor: 'pointer' }}>画像(左)</span>
                        <span onClick={() => addBlock('image_full', index)} style={{ cursor: 'pointer' }}>画像(全幅)</span>
                        <span onClick={() => addBlock('ad', index)} style={{ cursor: 'pointer' }}>広告</span>
                    </div>
                </div>
            );
        };

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {blocks.map((block, index) => (
                    <div key={block.id}>
                        <Inserter index={index} />
                        <div style={{ 
                            position: 'relative', 
                            border: (isDesignMode && fieldName !== 'weakness') ? '1px dashed #6366f1' : 'none', 
                            padding: (isDesignMode && fieldName !== 'weakness') ? '0.5rem' : '0', 
                            borderRadius: '8px',
                            margin: '0.5rem 0'
                        }}>
                            {isDesignMode && fieldName !== 'weakness' && (
                                <button 
                                    onClick={() => removeBlock(block.id)}
                                    style={{ position: 'absolute', top: '-10px', right: '-10px', width: '24px', height: '24px', borderRadius: '50%', background: '#ef4444', color: 'white', border: 'none', cursor: 'pointer', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    ×
                                </button>
                            )}

                            {block.type === 'heading' && (
                                <div 
                                    contentEditable={isDesignMode}
                                    suppressContentEditableWarning
                                    onBlur={(e) => {
                                        const next = blocks.map(b => b.id === block.id ? { ...b, content: e.target.innerText } : b);
                                        onUpdate(next);
                                    }}
                                    style={{ fontSize: '1.4rem', fontWeight: '700', color: 'var(--color-text-primary)', marginBottom: '0.75rem', outline: 'none', lineHeight: '1.4' }}
                                >
                                    {block.content}
                                </div>
                            )}

                            {block.type === 'subheading' && (
                                <div 
                                    contentEditable={isDesignMode}
                                    suppressContentEditableWarning
                                    onBlur={(e) => {
                                        const next = blocks.map(b => b.id === block.id ? { ...b, content: e.target.innerText } : b);
                                        onUpdate(next);
                                    }}
                                    style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--color-text-primary)', marginBottom: '0.5rem', marginTop: '1rem', outline: 'none', lineHeight: '1.4' }}
                                >
                                    {block.content}
                                </div>
                            )}

                            {block.type === 'text' && (
                                <div style={{ position: 'relative' }}>
                                    <div 
                                        contentEditable={isDesignMode}
                                        suppressContentEditableWarning
                                        onBlur={(e) => {
                                            const next = blocks.map(b => b.id === block.id ? { ...b, content: e.target.innerText } : b);
                                            onUpdate(next);
                                        }}
                                        style={{ lineHeight: '1.6', color: 'var(--color-text-secondary)', fontSize: '0.9rem', outline: 'none', whiteSpace: 'pre-wrap', paddingRight: isDesignMode ? '40px' : '0' }}
                                    >
                                        {block.content}
                                    </div>
                                    {isDesignMode && fieldName !== 'weakness' && (
                                        <button 
                                            onMouseDown={(e) => {
                                                e.preventDefault(); // Prevent blur to keep selection
                                                const selection = window.getSelection();
                                                if (!selection.rangeCount) return;
                                                const range = selection.getRangeAt(0);
                                                const offset = range.startOffset;
                                                
                                                onUpdate(prevBlocks => {
                                                    const updated = [...prevBlocks];
                                                    const idx = updated.findIndex(b => b.id === block.id);
                                                    if (idx === -1) return prevBlocks;
                                                    
                                                    const originalText = updated[idx].content;
                                                    const beforeText = originalText.substring(0, offset);
                                                    const afterText = originalText.substring(offset);
                                                    
                                                    updated[idx] = { ...updated[idx], content: beforeText };
                                                    updated.splice(idx + 1, 0, { type: 'text', content: afterText, id: Math.random() });
                                                    return updated;
                                                });
                                            }}
                                            title="ここで文章を分割"
                                            style={{ position: 'absolute', top: 0, right: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', opacity: 0.6, padding: '4px' }}
                                        >
                                            ✂️
                                        </button>
                                    )}
                                </div>
                            )}

                            {block.type === 'image_left' && (
                                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                    <div style={{ flex: '0 0 200px', width: '200px' }}>
                                        <img src={block.imageUrl} alt="Analysis" style={{ width: '100%', borderRadius: '8px', display: 'block', backgroundColor: '#f1f5f9', minHeight: '100px' }} />
                                        {isDesignMode && fieldName !== 'weakness' && (
                                            <input type="file" accept="image/*" onChange={(e) => handleFileChange(e, block.id)} style={{ fontSize: '0.7rem', marginTop: '0.5rem', width: '100%' }} />
                                        )}
                                    </div>
                                    <div 
                                        contentEditable={isDesignMode}
                                        suppressContentEditableWarning
                                        onBlur={(e) => {
                                            const next = blocks.map(b => b.id === block.id ? { ...b, content: e.target.innerText } : b);
                                            onUpdate(next);
                                        }}
                                        style={{ flex: '1 1 300px', lineHeight: '1.6', color: 'var(--color-text-secondary)', fontSize: '0.9rem', outline: 'none', whiteSpace: 'pre-wrap' }}
                                    >
                                        {block.content}
                                    </div>
                                </div>
                            )}

                            {block.type === 'image_full' && (
                                <div style={{ textAlign: 'center' }}>
                                    <img src={block.imageUrl} alt="Analysis" style={{ width: '100%', borderRadius: '12px', display: 'block', backgroundColor: '#f1f5f9', minHeight: '100px' }} />
                                    {isDesignMode && fieldName !== 'weakness' && (
                                        <input type="file" accept="image/*" onChange={(e) => handleFileChange(e, block.id)} style={{ fontSize: '0.7rem', marginTop: '0.5rem' }} />
                                    )}
                                </div>
                            )}

                            {block.type === 'ad' && (
                                <div style={{ position: 'relative', border: isDesignMode ? '2px dashed #6366f1' : 'none', borderRadius: '12px', padding: isDesignMode ? '1.5rem' : '0', background: isDesignMode ? 'rgba(99,102,241,0.02)' : 'none', transition: 'all 0.3s' }}>
                                    {isDesignMode && (
                                        <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid rgba(99,102,241,0.1)', paddingBottom: '1rem' }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: '800', color: '#6366f1', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                <span style={{ background: '#6366f1', color: 'white', padding: '2px 6px', borderRadius: '4px' }}>AD</span> 広告ユニット設定
                                            </div>
                                            
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                                                <div>
                                                    <label style={{ fontSize: '0.65rem', fontWeight: '900', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', textTransform: 'uppercase' }}>① 自動配信ターゲット</label>
                                                    <select 
                                                        value={block.content?.pageTarget || 'result_inline'}
                                                        onChange={(e) => {
                                                            const next = blocks.map(b => b.id === block.id ? { ...b, content: { ...b.content, pageTarget: e.target.value, bannerId: null } } : b);
                                                            onUpdate(next);
                                                        }}
                                                        style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.8rem', outline: 'none', background: 'white' }}
                                                    >
                                                        <option value="all">すべて</option>
                                                        <option value="result_inline">結果画面 (インライン)</option>
                                                        <option value="result">結果画面 (全体)</option>
                                                        <option value="home">ホーム画面</option>
                                                        <option value="exam">試験画面</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label style={{ fontSize: '0.65rem', fontWeight: '900', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', textTransform: 'uppercase' }}>② 特定の広告を指定</label>
                                                    <select 
                                                        value={block.content?.bannerId || ''}
                                                        onChange={(e) => {
                                                            const next = blocks.map(b => b.id === block.id ? { ...b, content: { ...b.content, bannerId: e.target.value || null } } : b);
                                                            onUpdate(next);
                                                        }}
                                                        style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid #6366f1', color: '#6366f1', fontSize: '0.8rem', outline: 'none', background: 'white', fontWeight: '700' }}
                                                    >
                                                        <option value="">-- 自動配信を優先 --</option>
                                                        {banners.map(b => (
                                                            <option key={b.id} value={b.id}>
                                                                {b.is_active ? '✅' : '❌'} {b.title} ({b.id.substring(0,6)})
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                            {block.content?.bannerId && (
                                                <div style={{ textAlign: 'right', marginTop: '0.5rem' }}>
                                                    <button 
                                                        onClick={() => {
                                                            const next = blocks.map(b => b.id === block.id ? { ...b, content: { ...b.content, bannerId: null } } : b);
                                                            onUpdate(next);
                                                        }}
                                                        style={{ fontSize: '0.7rem', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '700' }}
                                                    >
                                                        × 指定を解除
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <AdBanner 
                                        pageTarget={block.content?.pageTarget || "result_inline"} 
                                        bannerId={block.content?.bannerId}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                <Inserter index={blocks.length} />

                {isDesignMode && fieldName !== 'weakness' && blocks.length === 0 && (
                    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center', marginTop: '1rem', padding: '0.5rem', background: 'rgba(99,102,241,0.05)', borderRadius: '8px', flexWrap: 'wrap' }}>
                        <button onClick={() => addBlock('heading')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '4px', border: '1px solid #6366f1', background: 'white', color: '#6366f1', cursor: 'pointer' }}>+ 見出し</button>
                        <button onClick={() => addBlock('subheading')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '4px', border: '1px solid #6366f1', background: 'white', color: '#6366f1', cursor: 'pointer' }}>+ 中見出し</button>
                        <button onClick={() => addBlock('text')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '4px', border: '1px solid #6366f1', background: 'white', color: '#6366f1', cursor: 'pointer' }}>+ テキスト</button>
                        <button onClick={() => addBlock('image_left')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '4px', border: '1px solid #6366f1', background: 'white', color: '#6366f1', cursor: 'pointer' }}>+ 画像(左)</button>
                        <button onClick={() => addBlock('image_full')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '4px', border: '1px solid #6366f1', background: 'white', color: '#6366f1', cursor: 'pointer' }}>+ 画像(全幅)</button>
                        <button onClick={() => addBlock('ad')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '4px', border: '1px solid #6366f1', background: '#6366f1', color: 'white', cursor: 'pointer' }}>+ 広告</button>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="container" style={{ maxWidth: '1400px', paddingBottom: '4rem' }}>
            <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>採点結果</h1>
                <p style={{ color: 'var(--color-text-secondary)' }}>{universityName} {facultyName} - {examSubject}</p>
                {isAdmin && (
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1rem' }}>
                        <button 
                            onClick={() => {
                                if (!isDesignMode) {
                                    setOriginalData({
                                        detailedAnalysis: resultData.detailedAnalysis,
                                        sectionAnalysis: currentStructure.map(s => ({ id: s.id, content: s.sectionAnalysis })),
                                        weaknessAnalysis: resultData.weaknessAnalysis
                                    });
                                }
                                setIsDesignMode(!isDesignMode);
                            }}
                            style={{ padding: '0.5rem 1.5rem', background: isDesignMode ? '#ef4444' : '#6366f1', color: 'white', border: 'none', borderRadius: '20px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,0.2)' }}
                        >
                            {isDesignMode ? '⚊ 編集モードを終了' : '🎨 レイアウトを直接編集する'}
                        </button>
                    </div>
                )}
            </header>

            <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 120px' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>得点</div>
                        <div style={{ fontSize: '3rem', fontWeight: '700', color: 'var(--color-accent-primary)' }}>
                            {resultData.score}<span style={{ fontSize: '1.2rem', color: 'var(--color-text-secondary)' }}>/{resultData.maxScore}</span>
                        </div>
                    </div>
                    <div style={{ flex: '1 1 120px' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>合格可能性</div>
                        <div style={{ fontSize: '3rem', fontWeight: '700', color: getProbabilityColor(resultData.passProbability) }}>
                            {resultData.passProbability}
                        </div>
                    </div>
                </div>

                <div className="no-print" style={{ 
                    display: 'flex', 
                    gap: '1rem', 
                    justifyContent: 'center', 
                    marginTop: '2rem',
                    padding: '1rem',
                    borderTop: '1px solid rgba(0,0,0,0.05)'
                }}>
                    <button 
                        onClick={() => window.print()}
                        className="btn btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.5rem' }}
                    >
                        <span>🖨️</span> 結果を印刷/PDF保存
                    </button>
                    {(location.state?.pdfPath || examId) && (
                        <button 
                            onClick={() => {
                                const path = location.state?.pdfPath;
                                if (path) window.open(path, '_blank');
                                else alert("原本PDFのパスが見つかりません。");
                            }}
                            className="btn btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.5rem' }}
                        >
                            <span>📄</span> 原本PDFを表示
                        </button>
                    )}
                </div>

                <div style={{ textAlign: 'left', background: 'rgba(255,255,255,0.5)', padding: '1.25rem', borderRadius: '12px', marginTop: '2rem' }}>
                    <h3 style={{ fontSize: '1rem', color: 'var(--color-text-primary)', marginBottom: '1rem' }}>弱点分析・アドバイス</h3>
                    <ContentBlockRenderer 
                        fieldName="weakness"
                        blocks={parseBlocks(resultData.weaknessAnalysis)}
                        onUpdate={(updateFn) => {
                            setResultData(prev => ({ 
                                ...prev, 
                                weaknessAnalysis: typeof updateFn === 'function' ? updateFn(parseBlocks(prev.weaknessAnalysis)) : updateFn 
                            }));
                        }}
                    />
                </div>
            </div>

            <AdBanner pageTarget="result" className="mb-8" />

            <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', textAlign: 'center' }}>成績分析</h2>
                <div className="glass-panel" style={{ padding: '2rem' }}>
                    {stats ? (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '2rem', marginBottom: '2rem' }}>
                                <div style={{ textAlign: 'center', minWidth: '120px' }}>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>偏差値</div>
                                    <div style={{ fontSize: '2.5rem', fontWeight: '700', color: 'var(--color-text-primary)' }}>{stats.deviationValue}</div>
                                </div>
                                <div style={{ textAlign: 'center', minWidth: '120px' }}>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>全体順位</div>
                                    <div style={{ fontSize: '2.5rem', fontWeight: '700', color: 'var(--color-text-primary)' }}>
                                        {stats.ranking}<span style={{ fontSize: '1.2rem', color: 'var(--color-text-secondary)' }}>/{stats.totalExaminees}位</span>
                                    </div>
                                </div>
                                {stats.firstChoiceUniversity && (
                                    <div style={{ textAlign: 'center', minWidth: '120px', borderLeft: '1px solid #eee', paddingLeft: '2rem' }}>
                                        <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>{stats.firstChoiceUniversity}志望内順位</div>
                                        <div style={{ fontSize: '2.5rem', fontWeight: '700', color: 'var(--color-accent-primary)' }}>
                                            {stats.firstChoiceRank ? (
                                                <>{stats.firstChoiceRank}<span style={{ fontSize: '1.2rem', color: 'var(--color-text-secondary)' }}>/{stats.firstChoiceTotal}位</span></>
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
                                                        <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${(section.userScore / section.maxScore) * 100}%`, background: 'var(--color-accent-primary)', opacity: 0.8 }} />
                                                        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(section.averageScore / section.maxScore) * 100}%`, width: '4px', background: '#ef4444', zIndex: 10 }} />
                                                    </div>
                                                </div>
                                                <div style={{ width: '40px', textAlign: 'right', fontSize: '0.85rem', color: '#64748b' }}>/{section.maxScore}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : error ? (
                        <div style={{ textAlign: 'center', padding: '2rem', color: '#ef4444' }}><p>データの読み込みに失敗しました。</p></div>
                    ) : (
                        <div style={{ textAlign: 'center', padding: '2rem' }}>分析データを読み込み中...</div>
                    )}
                </div>
            </div>

            <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>詳細フィードバック</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
                {currentStructure && currentStructure.length > 0 ? (
                    currentStructure.map((section) => {
                        const sectionId = section.id;
                        const sectionQuestionIds = section.questions?.map(q => q.id) || [];
                        const sectionFeedback = (resultData.questionFeedback || []).filter(item => {
                            const itemId = String(item.id);
                            const matchesByList = sectionQuestionIds.some(qId => String(qId) === itemId);
                            const matchesByPrefix = (sectionQuestionIds.length === 0 && itemId.startsWith(String(sectionId) + '-'));
                            return matchesByList || matchesByPrefix;
                        });
                        return (
                            <div key={sectionId} className="glass-panel" style={{ padding: '1.5rem' }}>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '1.25rem', color: 'var(--color-text-primary)', borderBottom: '2px solid var(--color-accent-primary)', paddingBottom: '0.5rem' }}>
                                    {section.label || section.title || `大問 ${sectionId}`}
                                    {section.totalPoints && <span style={{ fontSize: '0.8rem', fontWeight: '500', color: '#64748b', marginLeft: '0.75rem' }}>（配点 {section.totalPoints}点）</span>}
                                </h3>
                                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                    <div style={{ flex: '1 1 500px', minWidth: 0 }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                            {sectionFeedback.map((item) => (
                                                <div key={item.id} style={{ padding: '1rem', borderLeft: `3px solid ${item.correct ? '#10b981' : '#ef4444'}`, background: item.correct ? 'rgba(16,185,129,0.03)' : 'rgba(239,68,68,0.03)', borderRadius: '0 8px 8px 0' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                        <span style={{ fontWeight: '600' }}>{item.id}</span>
                                                        <span style={{ color: item.correct ? '#10b981' : '#ef4444', fontWeight: '600', padding: '0.15rem 0.6rem', borderRadius: '20px', fontSize: '0.75rem' }}>{item.correct ? '正解' : '不正解'}</span>
                                                    </div>
                                                    <div style={{ fontSize: '0.85rem' }}>
                                                        <span style={{ fontWeight: '600' }}>解答:</span> {item.userAnswer || '(無回答)'} <span style={{ color: '#cbd5e1' }}>→</span> <span style={{ fontWeight: '600' }}>正解:</span> {item.correctAnswer}
                                                    </div>
                                                    {item.explanation && <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>{item.explanation}</p>}
                                                    <div style={{ textAlign: 'right' }}><button onClick={() => setReportingItem(item)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}>採点ミスを報告</button></div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div style={{ 
                                        flex: '1 1 500px', 
                                        minWidth: 0, 
                                        position: window.innerWidth > 768 ? 'sticky' : 'relative', 
                                        top: '1rem', 
                                        alignSelf: 'flex-start', 
                                        maxHeight: window.innerWidth > 768 ? '70vh' : 'auto', 
                                        overflowY: window.innerWidth > 768 ? 'auto' : 'visible', 
                                        background: 'rgba(99,102,241,0.04)', 
                                        borderRadius: '12px', 
                                        padding: '1rem', 
                                        border: isDesignMode ? '1px dashed #6366f1' : 'none' 
                                    }}>
                                        <p style={{ fontSize: '0.75rem', fontWeight: '700', color: '#6366f1', marginBottom: '0.75rem' }}>📝 大問全体の詳細解説</p>
                                        <ContentBlockRenderer 
                                            fieldName="section"
                                            blocks={parseBlocks(section.sectionAnalysis)}
                                            onUpdate={(updateFn) => {
                                                setCurrentStructure(prev => {
                                                    const next = [...prev];
                                                    const idx = next.findIndex(s => s.id === sectionId);
                                                    if (idx !== -1) {
                                                        const currentBlocks = parseBlocks(next[idx].sectionAnalysis);
                                                        next[idx] = { 
                                                            ...next[idx], 
                                                            sectionAnalysis: typeof updateFn === 'function' ? updateFn(currentBlocks) : updateFn 
                                                        };
                                                    }
                                                    return next;
                                                });
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>フィードバックデータがありません。</div>
                )}
            </div>

            {resultData.detailedAnalysis && (
                <div style={{ marginTop: '3rem' }}>
                    <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>AI先生による思考プロセス解説</h2>
                    <div className="glass-panel" style={{ padding: '2rem', background: 'white', border: isDesignMode ? '1px dashed #6366f1' : 'none' }}>
                        <ContentBlockRenderer 
                            fieldName="detailed"
                            blocks={parseBlocks(resultData.detailedAnalysis)}
                            onUpdate={(updateFn) => {
                                setResultData(prev => ({ 
                                    ...prev, 
                                    detailedAnalysis: typeof updateFn === 'function' ? updateFn(parseBlocks(prev.detailedAnalysis)) : updateFn 
                                }));
                            }}
                        />
                    </div>
                </div>
            )}

            <RecruitmentBanner />

            <div style={{ marginTop: '3rem' }}>
                <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>AI先生に質問する</h2>
                <div className="glass-panel" style={{ padding: '1.5rem' }}>
                    <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {chatHistory.map((msg, i) => (
                            <div key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', background: msg.role === 'user' ? 'var(--color-accent-primary)' : '#f1f5f9', color: msg.role === 'user' ? 'white' : '#333', padding: '0.75rem 1rem', borderRadius: '12px', maxWidth: '80%' }}>{msg.text}</div>
                        ))}
                    </div>
                    <form onSubmit={handleChatSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
                        <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="質問を入力..." style={{ flex: 1, padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }} disabled={isChatting} />
                        <button type="submit" className="btn btn-primary" disabled={isChatting}>送信</button>
                    </form>
                </div>
            </div>

            {isDesignMode && (
                <div style={{ position: 'fixed', bottom: '2rem', left: '50%', transform: 'translateX(-50%)', background: 'white', padding: '1rem 2rem', borderRadius: '50px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)', display: 'flex', gap: '1.5rem', alignItems: 'center', zIndex: 1000, border: '1px solid #eee' }}>
                    <p style={{ fontSize: '0.8rem', fontWeight: '700', color: '#666' }}>⚡ デザイン編集中</p>
                    <button 
                        onClick={() => {
                            // Restore from backup
                            if (originalData) {
                                setResultData(prev => ({
                                    ...prev,
                                    detailedAnalysis: originalData.detailedAnalysis,
                                    weaknessAnalysis: originalData.weaknessAnalysis
                                }));
                                setCurrentStructure(prev => prev.map(s => {
                                    const backup = originalData.sectionAnalysis.find(b => b.id === s.id);
                                    return backup ? { ...s, sectionAnalysis: backup.content } : s;
                                }));
                            }
                            setIsDesignMode(false);
                        }} 
                        style={{ padding: '0.5rem 1.5rem', border: '1px solid #ddd', background: 'none', borderRadius: '25px', fontSize: '0.8rem', cursor: 'pointer' }}
                    >
                        キャンセル
                    </button>
                    <button onClick={handleSaveLayout} style={{ padding: '0.5rem 2rem', border: 'none', background: '#6366f1', color: 'white', borderRadius: '25px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}>保存して確定</button>
                </div>
            )}

            <div style={{ marginTop: '3rem', textAlign: 'center' }}>
                <button className="btn btn-secondary" onClick={() => navigate('/')}>トップに戻る</button>
            </div>

            {reportingItem && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }}>
                    <div className="glass-panel" style={{ background: 'white', padding: '2rem', maxWidth: '500px', width: '100%' }}>
                        <h3 style={{ marginBottom: '1rem' }}>採点ミスの報告</h3>
                        <textarea value={reportComment} onChange={(e) => setReportComment(e.target.value)} placeholder="理由を教えてください..." style={{ width: '100%', height: '120px', padding: '0.75rem', marginBottom: '1.5rem' }} />
                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setReportingItem(null)}>キャンセル</button>
                            <button className="btn btn-primary" onClick={handleReportSubmit} disabled={isReporting}>{isReporting ? '送信中...' : '報告を送信'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ResultPage;
