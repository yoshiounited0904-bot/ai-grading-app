import React, { useState, useEffect } from 'react';
import { getAnnouncements, saveAnnouncement, deleteAnnouncement } from '../services/announcementService';

const AdminAnnouncements = () => {
    const [announcements, setAnnouncements] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingItem, setEditingItem] = useState(null);

    const defaultItem = {
        date: new Date().toISOString().split('T')[0],
        title: '',
        content: '',
        type: 'feature',
        is_new: true
    };

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        const { data, error } = await getAnnouncements();
        if (error) {
            console.error(error);
        } else {
            setAnnouncements(data || []);
        }
        setLoading(false);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setLoading(true);
        const { error } = await saveAnnouncement(editingItem);
        if (error) {
            alert('保存に失敗しました: ' + error.message);
        } else {
            alert('保存しました！');
            setEditingItem(null);
            fetchData();
        }
        setLoading(false);
    };

    const handleDelete = async (id) => {
        if (!window.confirm('本当に削除しますか？')) return;
        setLoading(true);
        const { error } = await deleteAnnouncement(id);
        if (error) {
            alert('削除に失敗しました: ' + error.message);
        } else {
            fetchData();
        }
        setLoading(false);
    };

    if (loading && !editingItem) return <div className="text-center py-10">読み込み中...</div>;

    return (
        <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-navy-blue">📢 お知らせ管理</h2>
                <button
                    onClick={() => setEditingItem({ ...defaultItem })}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg shadow transition-colors"
                >
                    ＋ 新規作成
                </button>
            </div>

            {editingItem ? (
                <form onSubmit={handleSave} className="bg-indigo-50/30 p-6 rounded-lg mb-8 border border-indigo-100">
                    <h3 className="font-bold mb-4">{editingItem.id ? 'お知らせを編集' : '新規お知らせ作成'}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">日付</label>
                            <input type="date" className="w-full border rounded-lg p-2" required
                                value={editingItem.date} onChange={e => setEditingItem({...editingItem, date: e.target.value})} />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">タイプ</label>
                            <select className="w-full border rounded-lg p-2" required
                                value={editingItem.type} onChange={e => setEditingItem({...editingItem, type: e.target.value})}>
                                <option value="feature">新機能 (緑)</option>
                                <option value="update">更新情報 (青)</option>
                                <option value="event">イベント (黄)</option>
                            </select>
                        </div>
                    </div>
                    <div className="mb-4">
                        <label className="block text-sm font-bold text-gray-700 mb-1">タイトル</label>
                        <input type="text" className="w-full border rounded-lg p-2" required placeholder="【新機能】..."
                            value={editingItem.title} onChange={e => setEditingItem({...editingItem, title: e.target.value})} />
                    </div>
                    <div className="mb-4">
                        <label className="block text-sm font-bold text-gray-700 mb-1">内容 (コンテンツ)</label>
                        <textarea className="w-full border rounded-lg p-2 h-32" required placeholder="お知らせの詳細..."
                            value={editingItem.content} onChange={e => setEditingItem({...editingItem, content: e.target.value})} />
                    </div>
                    <div className="mb-4 flex items-center gap-2">
                        <input type="checkbox" id="is_new" checked={editingItem.is_new}
                            onChange={e => setEditingItem({...editingItem, is_new: e.target.checked})} />
                        <label htmlFor="is_new" className="font-bold cursor-pointer">「New」バッジを表示する</label>
                    </div>
                    <div className="flex gap-4">
                        <button type="submit" disabled={loading} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg">保存</button>
                        <button type="button" onClick={() => setEditingItem(null)} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg">キャンセル</button>
                    </div>
                </form>
            ) : null}

            <div className="overflow-x-auto">
                <table className="min-w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b-2 border-gray-200">
                            <th className="p-3 text-sm font-semibold text-gray-600">日付</th>
                            <th className="p-3 text-sm font-semibold text-gray-600">タイトル</th>
                            <th className="p-3 text-sm font-semibold text-gray-600">タイプ</th>
                            <th className="p-3 text-sm font-semibold text-gray-600">New</th>
                            <th className="p-3 text-sm font-semibold text-gray-600">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {announcements.map(a => (
                            <tr key={a.id} className="border-b hover:bg-gray-50 transition-colors">
                                <td className="p-3 whitespace-nowrap">{a.date}</td>
                                <td className="p-3 font-medium">{a.title}</td>
                                <td className="p-3">
                                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                                        a.type === 'feature' ? 'bg-green-100 text-green-700' : 
                                        a.type === 'event' ? 'bg-yellow-100 text-yellow-700' : 
                                        'bg-blue-100 text-blue-700'
                                    }`}>
                                        {a.type === 'feature' ? '新機能' : a.type === 'event' ? 'イベント' : '更新情報'}
                                    </span>
                                </td>
                                <td className="p-3">{a.is_new ? '✅' : '-'}</td>
                                <td className="p-3">
                                    <button onClick={() => setEditingItem(a)} className="text-blue-600 hover:underline mr-4">編集</button>
                                    <button onClick={() => handleDelete(a.id)} className="text-red-600 hover:underline">削除</button>
                                </td>
                            </tr>
                        ))}
                        {announcements.length === 0 && (
                            <tr><td colSpan="5" className="text-center p-6 text-gray-500">お知らせがありません</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default AdminAnnouncements;
