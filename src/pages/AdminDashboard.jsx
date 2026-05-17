import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAdminExams, deleteAdminExam, updateAdminComment, updateAdminFields, importMockData, duplicateAdminExam } from '../services/adminExamService';
import { extractSectionVocabulary } from '../services/adminGeminiService';
import { geminiQueue } from '../utils/promiseQueue';

function AdminDashboard() {
    const [exams, setExams] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        fetchExams();
    }, []);

    const fetchExams = async () => {
        setLoading(true);
        const { data, error } = await getAdminExams();
        if (error) {
            console.error('Error fetching exams:', error);
            alert('試験データの取得に失敗しました。');
        } else {
            setExams(data || []);
        }
        setLoading(false);
    };

    const handleDelete = async (exam) => {
        const confirmMsg = `本当に以下の試験データを削除しますか？\n削除すると元に戻せません。\n\n【対象】\n${exam.university} ${exam.year}年度 ${exam.subject}`;
        if (window.confirm(confirmMsg)) {
            const { error } = await deleteAdminExam(exam.id);
            if (error) {
                console.error('Error deleting exam:', error);
                alert('削除に失敗しました。');
            } else {
                fetchExams();
            }
        }
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
        const statuses = ['working', 'completed', 'verified'];
        let normalizedStatus = currentStatus;
        if (currentStatus === true || currentStatus === 'completed') normalizedStatus = 'completed';
        else if (currentStatus === false || currentStatus === 'working' || !currentStatus) normalizedStatus = 'working';
        else if (currentStatus === 'verified') normalizedStatus = 'verified';

        const currentIndex = statuses.indexOf(normalizedStatus);
        const nextStatus = statuses[(currentIndex + 1) % statuses.length];

        const { error } = await updateAdminFields(examId, { master_status: nextStatus });
        if (error) {
            console.error('Error updating status:', error);
            alert('更新に失敗しました。');
        } else {
            setExams(prev => prev.map(e => e.id === examId ? { ...e, master_status: nextStatus } : e));
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

    const handlePreview = (rawExam) => {
        const formattedExam = {
            id: rawExam.id,
            university: rawExam.university,
            universityId: rawExam.university_id,
            faculty: rawExam.faculty,
            facultyId: rawExam.faculty_id,
            year: rawExam.year,
            subject: rawExam.subject,
            subjectEn: rawExam.subject_en,
            type: rawExam.type,
            pdfPath: rawExam.pdf_path,
            maxScore: rawExam.max_score,
            detailedAnalysis: rawExam.detailed_analysis,
            structure: rawExam.structure
        };

        navigate(`/exam/${formattedExam.universityId}-${formattedExam.facultyId}-preview`, {
            state: {
                exam: formattedExam,
                universityName: formattedExam.university,
                universityId: formattedExam.universityId
            }
        });
    };

    const handleEditLayout = (exam) => {
        // Generate dummy question feedback based on real master data from structure
        const dummyFeedback = [];
        if (Array.isArray(exam.structure)) {
            exam.structure.forEach(section => {
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
                universityName: exam.university,
                examSubject: `${exam.year}年度 ${exam.subject}`,
                isDesignMode: true,
                result: {
                    score: 50,
                    maxScore: exam.max_score || 100,
                    passProbability: "B",
                    detailedAnalysis: exam.detailed_analysis || "デザインモード用の詳細解説ダミーです。",
                    weaknessAnalysis: "これはデザインモード用のダミー弱点分析です。実際の採点時には、得点率に応じた適切な分析メッセージが表示されます。",
                    questionFeedback: dummyFeedback
                },
                examStructure: exam.structure,
                isNewResult: false
            }
        });
    };

    const [batchProcessing, setBatchProcessing] = useState(false);
    const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });

    const handleBatchVocabularyExtraction = async () => {
        const englishExams = exams.filter(e => 
            e.subject_en === 'english' && 
            e.structure && 
            e.structure.some(s => !s.vocabulary || s.vocabulary.length === 0)
        );

        if (englishExams.length === 0) {
            alert('単語が未抽出の英語試験はありません。');
            return;
        }

        if (!window.confirm(`${englishExams.length}件の英語試験に対して、AI単語抽出を一括実行しますか？\n（API消費量が増えますのでご注意ください）`)) {
            return;
        }

        setBatchProcessing(true);
        setBatchProgress({ current: 0, total: englishExams.length });

        const apiKey = import.meta.env.VITE_GEMINI_API_KEY || localStorage.getItem('gemini_api_key');

        for (let i = 0; i < englishExams.length; i++) {
            const exam = englishExams[i];
            console.log(`[BatchVocab] Processing exam: ${exam.id}`);
            
            try {
                const newStructure = [...exam.structure];
                let changed = false;

                for (let sIdx = 0; sIdx < newStructure.length; sIdx++) {
                    const section = newStructure[sIdx];
                    if (!section.vocabulary || section.vocabulary.length === 0) {
                        const pdfPath = section.question_pdf_path || exam.pdf_path;
                        if (pdfPath) {
                            console.log(`[BatchVocab] Extracting vocab for ${exam.id} Section ${sIdx + 1}`);
                            const vocab = await geminiQueue.add(() => extractSectionVocabulary(apiKey, [pdfPath]));
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

    const handleImport = async () => {
        if (window.confirm('ダミーデータをSupabaseに一括登録します。よろしいですか？')) {
            setLoading(true);
            const count = await importMockData();
            alert(`${count}件の試験データを登録しました！`);
            fetchExams();
        }
    };

    return (
        <div className="min-h-screen bg-indigo-50/30 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <div>
                        <h1 className="text-3xl font-black text-navy-blue flex items-center gap-3">
                            管理者ページ
                            <span className="text-xs bg-navy-blue text-white px-2 py-1 rounded-full font-mono">v2.1</span>
                        </h1>
                        <div className="flex gap-6 mt-2 border-b border-gray-200">
                        <button className="pb-2 px-1 border-b-2 border-navy-blue font-bold text-navy-blue">
                            試験マスター管理
                        </button>
                        <button 
                            onClick={() => {
                                console.log("Navigating to Banners...");
                                navigate('/admin/banners');
                            }}
                            className="pb-2 px-1 text-gray-400 hover:text-navy-blue"
                        >
                            広告運用管理 (CMS)
                        </button>
                        <button 
                            onClick={() => navigate('/admin/users')}
                            className="pb-2 px-1 text-gray-400 hover:text-navy-blue"
                        >
                            ユーザー承認管理
                        </button>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-4 md:mt-0">
                        {batchProcessing && (
                            <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl shadow-sm border border-indigo-100">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
                                <span className="text-xs font-bold text-indigo-600">
                                    一括抽出中: {batchProgress.current} / {batchProgress.total}
                                </span>
                            </div>
                        )}
                        <Link
                            to="/admin/exam-lab"
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-lg shadow transition-colors flex items-center gap-2"
                        >
                            <span className="text-lg">AI</span> 自動入力ラボ
                        </Link>
                        <button
                            onClick={handleBatchVocabularyExtraction}
                            disabled={batchProcessing || loading}
                            className="bg-white hover:bg-gray-50 text-indigo-600 font-bold py-2.5 px-6 rounded-lg shadow-sm border border-indigo-200 transition-all disabled:opacity-50 text-sm flex items-center gap-2"
                        >
                            <span className="text-lg">📚</span> 英単語を一括抽出
                        </button>
                        <Link
                            to="/admin/exam/new"
                            className="bg-navy-blue hover:bg-navy-light text-white font-bold py-2.5 px-6 rounded-lg shadow transition-colors flex items-center gap-2"
                        >
                            <span className="text-xl">+</span> 新規試験作成
                        </Link>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center my-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navy-blue"></div>
                    </div>
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
                        {Object.entries(
                            exams.reduce((acc, exam) => {
                                const univ = exam.university || 'その他';
                                if (!acc[univ]) acc[univ] = [];
                                acc[univ].push(exam);
                                return acc;
                            }, {})
                        )
                        .sort(([nameA, examsA], [nameB, examsB]) => {
                            // Get most recent update time for each university
                            const lastA = Math.max(...examsA.map(e => new Date(e.updated_at || 0).getTime()));
                            const lastB = Math.max(...examsB.map(e => new Date(e.updated_at || 0).getTime()));
                            return lastB - lastA; // Latest first
                        })
                        .map(([university, rawExams]) => {
                            // Sort exams by faculty within university
                            const universityExams = [...rawExams].sort((a, b) => 
                                (a.faculty || "").localeCompare(b.faculty || "", 'ja')
                            );
                            return (
                            <div key={university} className="bg-white/50 backdrop-blur-sm rounded-3xl p-6 shadow-xl shadow-indigo-100/50 border-2 border-indigo-100/30 transition-all">
                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-1.5 h-8 bg-navy-blue rounded-full"></div>
                                    <h2 className="text-2xl font-black text-navy-blue tracking-tight">
                                        {university}
                                        <span className="ml-3 text-xs font-bold text-navy-blue/40 bg-navy-blue/5 px-3 py-1 rounded-full align-middle">
                                            {universityExams.length} 件
                                        </span>
                                    </h2>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full border-separate border-spacing-y-4">
                                        <thead>
                                            <tr className="text-navy-blue/40 font-black text-[10px] uppercase tracking-[0.2em]">
                                                <th className="px-6 py-2 text-left">学部 / ID</th>
                                                <th className="px-6 py-2 text-left">年度・科目</th>
                                                <th className="px-6 py-2 text-center whitespace-nowrap">公開設定</th>
                                                <th className="px-6 py-2 text-center whitespace-nowrap">ステータス</th>
                                                <th className="px-6 py-2 text-center whitespace-nowrap">未実装項目</th>
                                                <th className="px-6 py-2 text-left">共有メモ</th>
                                                <th className="px-6 py-2 text-right">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {universityExams.map((exam) => (
                                                <tr key={exam.id} className={`group hover:-translate-y-0.5 transition-all duration-300 ${exam.is_completed ? 'opacity-70 hover:opacity-100' : ''}`}>
                                                    {/* Faculty & ID */}
                                                    <td className="bg-white px-6 py-5 rounded-l-2xl border-y-2 border-l-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm min-w-[200px]">
                                                        <div className="flex flex-col">
                                                            <span className="text-lg font-black text-navy-blue leading-tight">{exam.faculty}</span>
                                                            <span className="text-[10px] font-mono mt-1 text-gray-300"># {exam.id}</span>
                                                        </div>
                                                    </td>

                                            {/* Year & Subject */}
                                            <td className="bg-white px-6 py-5 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-black bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded">{exam.year}年度</span>
                                                        {exam.pdf_path && (
                                                            <a href={exam.pdf_path} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-green-600 hover:text-green-800 flex items-center gap-1 transition-colors">
                                                                📄 PDF
                                                            </a>
                                                        )}
                                                    </div>
                                                    <span className="text-base font-bold text-gray-700 mt-1">{exam.subject}</span>
                                                </div>
                                            </td>
                                            
                                            {/* Publish Toggle */}
                                            <td className="bg-white px-6 py-5 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm text-center">
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
                                            <td className="bg-white px-6 py-5 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm text-center">
                                                <button
                                                    onClick={() => handleCycleStatus(exam.id, exam.master_status)}
                                                    className={`px-3 py-1.5 text-[10px] font-black rounded-full transition-all flex items-center justify-center mx-auto gap-1 border-2 ${
                                                        exam.master_status === 'verified'
                                                        ? 'bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 shadow-sm'
                                                        : exam.master_status === 'completed'
                                                        ? 'bg-green-50 text-green-600 border-green-200 hover:bg-green-100 hover:border-green-300' 
                                                        : 'bg-gray-50 text-gray-400 border-gray-100 hover:bg-gray-100 hover:text-gray-500'
                                                    }`}
                                                >
                                                    {exam.master_status === 'verified' ? (
                                                        <><span className="text-[12px]">💎</span>検証済み</>
                                                    ) : exam.master_status === 'completed' ? (
                                                        <><span className="text-[12px]">✨</span>完成</>
                                                    ) : (
                                                        <><span className="text-[12px]">✏️</span>作業中</>
                                                    )}
                                                </button>
                                            </td>

                                            {/* Unimplemented Status */}
                                            <td className="bg-white px-6 py-5 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm">
                                                <div className="flex flex-wrap gap-1 justify-center max-w-[150px] mx-auto">
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
                                                                className={`text-[9px] w-8 h-8 rounded-full border-2 transition-all duration-300 font-bold flex items-center justify-center ${isActive
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
                                            <td className="bg-white px-6 py-5 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm">
                                                <textarea
                                                    defaultValue={exam.admin_comment || ''}
                                                    onBlur={(e) => {
                                                        if (e.target.value !== (exam.admin_comment || '')) {
                                                            handleCommentUpdate(exam.id, e.target.value);
                                                        }
                                                    }}
                                                    placeholder="共有メモ..."
                                                    className="w-full text-[10px] p-2 bg-yellow-50/20 border-b border-yellow-200/50 focus:border-navy-blue focus:bg-white transition-all resize-none h-12 outline-none"
                                                />
                                            </td>

                                            {/* Actions */}
                                            <td className="bg-white px-6 py-5 rounded-r-2xl border-y-2 border-r-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm">
                                                <div className="flex flex-col gap-1 w-24 ml-auto">
                                                    <button onClick={() => handlePreview(exam)} className="w-full py-1 text-[10px] font-black bg-navy-blue text-white rounded shadow hover:bg-navy-light transition-colors">
                                                        プレビュー
                                                    </button>
                                                    <button onClick={() => handleEditLayout(exam)} className="w-full py-1 text-[10px] font-black bg-indigo-500 text-white rounded shadow hover:bg-indigo-600 transition-colors">
                                                        🎨 レイアウト編集
                                                    </button>
                                                    <div className="flex gap-1">
                                                        <Link to={`/admin/exam/${exam.id}`} className="flex-1 py-1 text-[10px] font-bold bg-gray-50 text-gray-600 rounded border border-gray-100 hover:bg-gray-100 text-center">
                                                            編集
                                                        </Link>
                                                        <button onClick={() => handleCopy(exam)} className="flex-1 py-1 text-[10px] font-bold bg-indigo-50 text-indigo-600 rounded border border-indigo-100 hover:bg-indigo-600 hover:text-white transition-colors">
                                                            複
                                                        </button>
                                                        <button onClick={() => handleDelete(exam)} className="flex-1 py-1 text-[10px] font-bold bg-red-50 text-red-500 rounded border border-red-100 hover:bg-red-500 hover:text-white transition-colors">
                                                            削
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
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
