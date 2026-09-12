import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { deleteGradingReport, getGradingReports, updateGradingReport } from '../services/reportService';

const AdminFeedbacks = () => {
    const [feedbacks, setFeedbacks] = useState([]);
    const [gradingReports, setGradingReports] = useState([]);
    const [gradingReportsError, setGradingReportsError] = useState('');
    const [activeTab, setActiveTab] = useState('grading');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchFeedbacks();
    }, []);

    const fetchFeedbacks = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('user_feedbacks')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching feedbacks:', error);
            // alert('フィードバックの取得に失敗しました。テーブルが作成されているか確認してください。');
        } else {
            setFeedbacks(data || []);
        }
        const reportsResult = await getGradingReports();
        if (reportsResult.error) {
            console.error('Error fetching grading reports:', reportsResult.error);
            setGradingReportsError(reportsResult.error.message || '採点ミス報告の取得に失敗しました。');
            setGradingReports([]);
        } else {
            setGradingReportsError('');
            setGradingReports(reportsResult.data || []);
        }
        setLoading(false);
    };

    const updateStatus = async (id, newStatus) => {
        const { error } = await supabase
            .from('user_feedbacks')
            .update({ status: newStatus })
            .eq('id', id);

        if (error) {
            console.error('Error updating status:', error);
            alert('ステータスの更新に失敗しました。');
        } else {
            setFeedbacks(prev => prev.map(f => f.id === id ? { ...f, status: newStatus } : f));
        }
    };

    const updateReport = async (id, updates) => {
        const { data, error } = await updateGradingReport(id, updates);
        if (error) {
            console.error('Error updating grading report:', error);
            alert('採点ミス報告の更新に失敗しました。');
            return;
        }
        setGradingReports(prev => prev.map(r => r.id === id ? { ...r, ...data } : r));
    };

    const deleteReport = async (id) => {
        if (!window.confirm('本当にこの採点ミス報告を削除しますか？')) return;
        const { error } = await deleteGradingReport(id);
        if (error) {
            console.error('Error deleting grading report:', error);
            alert('削除に失敗しました。');
            return;
        }
        setGradingReports(prev => prev.filter(r => r.id !== id));
    };

    const deleteFeedback = async (id) => {
        if (!window.confirm('本当にこのフィードバックを削除しますか？')) return;
        const { error } = await supabase
            .from('user_feedbacks')
            .delete()
            .eq('id', id);
        
        if (error) {
            console.error('Error deleting feedback:', error);
            alert('削除に失敗しました。');
        } else {
            setFeedbacks(prev => prev.filter(f => f.id !== id));
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center my-20">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navy-blue"></div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <h2 className="text-xl font-bold text-navy-blue">お問い合わせ管理</h2>
                <div className="flex gap-2">
                    <button
                        onClick={() => setActiveTab('grading')}
                        className={`px-4 py-2 text-xs font-black rounded-lg border ${activeTab === 'grading' ? 'bg-navy-blue text-white border-navy-blue' : 'bg-white text-gray-500 border-gray-200'}`}
                    >
                        採点ミス報告 ({gradingReports.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('general')}
                        className={`px-4 py-2 text-xs font-black rounded-lg border ${activeTab === 'general' ? 'bg-navy-blue text-white border-navy-blue' : 'bg-white text-gray-500 border-gray-200'}`}
                    >
                        通常問い合わせ ({feedbacks.length})
                    </button>
                </div>
            </div>

            {activeTab === 'grading' ? (
                <GradingReportsList
                    reports={gradingReports}
                    error={gradingReportsError}
                    onUpdate={updateReport}
                    onDelete={deleteReport}
                />
            ) : feedbacks.length === 0 ? (
                <div className="text-center text-gray-500 py-10">データがありません。</div>
            ) : (
                <div className="space-y-4">
                    {feedbacks.map(f => (
                        <div key={f.id} className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3 relative">
                            <div className="flex justify-between items-start">
                                <div className="flex gap-2 items-center">
                                    <span className={`px-2 py-1 text-xs font-bold rounded-full ${
                                        f.type === 'bug' ? 'bg-red-100 text-red-700' :
                                        f.type === 'feature_request' ? 'bg-blue-100 text-blue-700' :
                                        'bg-gray-100 text-gray-700'
                                    }`}>
                                        {f.type === 'bug' ? '🐛 バグ' : f.type === 'feature_request' ? '💡 要望' : '💬 問い合わせ'}
                                    </span>
                                    <span className="text-xs text-gray-400">
                                        {new Date(f.created_at).toLocaleString('ja-JP')}
                                    </span>
                                </div>
                                <div className="flex gap-2 items-center">
                                    <select
                                        value={f.status}
                                        onChange={(e) => updateStatus(f.id, e.target.value)}
                                        className={`text-xs font-bold p-1 rounded border ${
                                            f.status === 'resolved' ? 'bg-green-50 border-green-200 text-green-700' :
                                            f.status === 'in_progress' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' :
                                            'bg-gray-50 border-gray-200 text-gray-700'
                                        }`}
                                    >
                                        <option value="new">未対応</option>
                                        <option value="in_progress">対応中</option>
                                        <option value="resolved">解決済み</option>
                                    </select>
                                    <button
                                        onClick={() => deleteFeedback(f.id)}
                                        className="text-red-500 hover:text-red-700 text-xs px-2"
                                    >
                                        削除
                                    </button>
                                </div>
                            </div>

                            <div className="text-sm font-medium text-gray-800 whitespace-pre-wrap bg-gray-50 p-3 rounded">
                                {f.message}
                            </div>

                            <div className="text-xs text-gray-500 flex gap-4">
                                {f.name && <span>名前: {f.name}</span>}
                                {f.email && <span>Email: {f.email}</span>}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const REPORT_STATUS = [
    ['new', '未対応'],
    ['checking', '確認中'],
    ['fixed', '修正済み'],
    ['rejected', '問題なし'],
    ['closed', '完了']
];

const GradingReportsList = ({ reports, error, onUpdate, onDelete }) => {
    if (error) {
        return (
            <div className="border border-red-200 bg-red-50 text-red-700 rounded-lg p-4 text-sm leading-relaxed">
                <div className="font-black mb-2">採点ミス報告を取得できません。</div>
                <div className="whitespace-pre-wrap">{error}</div>
                <div className="mt-3 text-xs text-red-600">
                    Supabase SQL Editorで supabase_schema_grading_reports_admin.sql を実行してください。
                </div>
            </div>
        );
    }

    if (reports.length === 0) {
        return <div className="text-center text-gray-500 py-10">採点ミス報告はありません。</div>;
    }

    return (
        <div className="space-y-4">
            {reports.map(report => {
                const result = report.exam_results;
                const feedback = result?.question_feedback || [];
                const matchedFeedback = feedback.find(item => String(item.id) === String(report.question_id));
                return (
                    <div key={report.id} className="border border-red-100 rounded-lg p-4 bg-red-50/20 flex flex-col gap-4">
                        <div className="flex justify-between items-start gap-3 flex-wrap">
                            <div>
                                <div className="flex flex-wrap gap-2 items-center mb-2">
                                    <span className="px-2 py-1 text-xs font-black rounded-full bg-red-100 text-red-700">採点ミス報告</span>
                                    <span className="text-xs text-gray-400">{new Date(report.created_at).toLocaleString('ja-JP')}</span>
                                </div>
                                <h3 className="font-black text-navy-blue">
                                    {report.university_name} {report.faculty_name || ''} {report.exam_subject} / 問題 {report.question_id}
                                </h3>
                                <p className="text-xs text-gray-500 mt-1">
                                    報告者: {report.user_id || '不明'} / 結果ID: {report.exam_result_id || '未紐付け'}
                                </p>
                            </div>
                            <div className="flex gap-2 items-center">
                                <select
                                    value={report.status || 'new'}
                                    onChange={(e) => onUpdate(report.id, { status: e.target.value })}
                                    className="text-xs font-bold p-2 rounded border bg-white"
                                >
                                    {REPORT_STATUS.map(([value, label]) => (
                                        <option key={value} value={value}>{label}</option>
                                    ))}
                                </select>
                                <button onClick={() => onDelete(report.id)} className="text-red-500 hover:text-red-700 text-xs px-2">
                                    削除
                                </button>
                            </div>
                        </div>

                        <div className="grid md:grid-cols-3 gap-3 text-xs">
                            <DataBox title="生徒の解答" value={report.user_answer || matchedFeedback?.userAnswer || '(無回答)'} />
                            <DataBox title="正解" value={report.correct_answer || matchedFeedback?.correctAnswer || '-'} />
                            <DataBox title="AI解説・採点理由" value={report.ai_explanation || matchedFeedback?.explanation || '-'} />
                        </div>

                        <DataBox title="ユーザーコメント" value={report.user_comment || '-'} />

                        {matchedFeedback && (
                            <details className="bg-white border border-gray-100 rounded-lg p-3">
                                <summary className="cursor-pointer text-xs font-black text-indigo-600">紐づく小問フィードバックJSON</summary>
                                <pre className="mt-3 text-[11px] whitespace-pre-wrap overflow-x-auto">{JSON.stringify(matchedFeedback, null, 2)}</pre>
                            </details>
                        )}

                        {result?.answers && (
                            <details className="bg-white border border-gray-100 rounded-lg p-3">
                                <summary className="cursor-pointer text-xs font-black text-indigo-600">保存答案JSON</summary>
                                <pre className="mt-3 text-[11px] whitespace-pre-wrap overflow-x-auto">{JSON.stringify(result.answers, null, 2)}</pre>
                            </details>
                        )}

                        <label className="grid gap-2 text-xs font-black text-gray-500">
                            管理者メモ
                            <textarea
                                defaultValue={report.admin_memo || ''}
                                onBlur={(e) => onUpdate(report.id, { admin_memo: e.target.value })}
                                className="w-full min-h-[90px] p-3 rounded-lg border border-gray-200 text-sm font-normal text-gray-800 bg-white"
                                placeholder="確認内容、修正方針、対応履歴など"
                            />
                        </label>
                    </div>
                );
            })}
        </div>
    );
};

const DataBox = ({ title, value }) => (
    <div className="bg-white border border-gray-100 rounded-lg p-3">
        <div className="text-[10px] font-black text-gray-400 mb-2 uppercase tracking-wider">{title}</div>
        <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{String(value ?? '-')}</div>
    </div>
);

export default AdminFeedbacks;
