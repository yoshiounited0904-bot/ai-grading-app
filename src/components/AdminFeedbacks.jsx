import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';

const AdminFeedbacks = () => {
    const [feedbacks, setFeedbacks] = useState([]);
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
            <h2 className="text-xl font-bold text-navy-blue mb-6">お問い合わせ・バグ報告・要望一覧</h2>
            
            {feedbacks.length === 0 ? (
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

export default AdminFeedbacks;
