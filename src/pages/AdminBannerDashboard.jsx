import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getAdminBanners, updateBanner, deleteBanner } from '../services/adminBannerService';

const AdminBannerDashboard = () => {
    const [banners, setBanners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadBanners();
    }, []);

    const loadBanners = async () => {
        try {
            setLoading(true);
            const data = await getAdminBanners();
            setBanners(data);
        } catch (err) {
            console.error("Failed to load banners:", err);
            setError("広告の読み込みに失敗しました。テーブルが作成されているか確認してください。");
        } finally {
            setLoading(false);
        }
    };

    const handleToggleActive = async (id, currentStatus) => {
        try {
            await updateBanner(id, { is_active: !currentStatus });
            setBanners(banners.map(b => b.id === id ? { ...b, is_active: !currentStatus } : b));
        } catch (err) {
            alert("ステータスの更新に失敗しました。");
        }
    };

    const handleDelete = async (id) => {
        if (!confirm("この広告を削除してもよろしいですか？")) return;
        try {
            await deleteBanner(id);
            setBanners(banners.filter(b => b.id !== id));
        } catch (err) {
            alert("削除に失敗しました。");
        }
    };

    if (loading) return <div className="p-8 text-center text-gray-500">読み込み中...</div>;

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-serif text-navy-blue">管理者ページ</h1>
                    <div className="flex gap-6 mt-2 border-b border-gray-200">
                        <Link to="/admin" className="pb-2 px-1 text-gray-400 hover:text-navy-blue">
                            試験マスター管理
                        </Link>
                        <button className="pb-2 px-1 border-b-2 border-navy-blue font-bold text-navy-blue">
                            広告運用管理 (CMS)
                        </button>
                    </div>
                </div>
                <Link
                    to="/admin/banners/new"
                    className="bg-navy-blue text-white font-bold py-2.5 px-6 rounded-lg shadow hover:bg-opacity-90 transition-all flex items-center gap-2"
                >
                    <span className="text-xl">+</span> 新規広告作成
                </Link>
            </div>

            {error && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6">
                    <p className="text-red-700 text-sm font-bold">{error}</p>
                    <p className="text-xs text-red-600 mt-1">※ supabase_schema_banners.sqlの内容をSQL Editorで実行したか確認してください。</p>
                </div>
            )}

            <div className="bg-white rounded-xl shadow overflow-hidden border border-gray-100">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">バナー</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">タイトル / リンク</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">掲載場所 / 形式</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">効果 (Imp/Click/CTR)</th>
                            <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">公開</th>
                            <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">操作</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {banners.length === 0 ? (
                            <tr>
                                <td colSpan="6" className="px-6 py-12 text-center text-gray-400">登録されている広告はありません</td>
                            </tr>
                        ) : (
                            banners.map((banner) => (
                                <tr key={banner.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="w-24 h-12 bg-gray-100 rounded overflow-hidden flex items-center justify-center border border-gray-200">
                                            {banner.image_url ? (
                                                <img src={banner.image_url} alt={banner.title} className="w-full h-full object-cover" />
                                            ) : (
                                                <span className="text-[10px] text-gray-400">No Image</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-sm font-bold text-gray-900">{banner.title}</div>
                                        <div className="text-xs text-blue-500 truncate max-w-[150px]" title={banner.target_url}>
                                            {banner.target_url || 'リンクなし'}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold">
                                            {banner.page_target === 'all' ? '全画面' : banner.page_target}
                                        </span>
                                        <div className="text-[10px] text-gray-400 mt-1 uppercase">{banner.layout_type}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-xs font-medium text-gray-700">
                                            {banner.impression_count} / {banner.click_count}
                                        </div>
                                        <div className="text-[10px] text-accent-gold font-bold">
                                            CTR: {banner.impression_count > 0 ? ((banner.click_count / banner.impression_count) * 100).toFixed(1) : 0}%
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <button
                                            onClick={() => handleToggleActive(banner.id, banner.is_active)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${banner.is_active ? 'bg-green-500' : 'bg-gray-200'}`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${banner.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                                        </button>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <Link to={`/admin/banners/${banner.id}`} className="text-navy-blue hover:text-indigo-900 mr-4 font-bold">編集</Link>
                                        <button onClick={() => handleDelete(banner.id)} className="text-red-600 hover:text-red-900 font-bold">削除</button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <div className="mt-8 bg-blue-50 rounded-xl p-6 border border-blue-100">
                <h3 className="text-sm font-bold text-blue-800 mb-2">💡 運用ヒント</h3>
                <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
                    <li>成果の低い広告(CTR 1%以下)は、画像やレイアウトを変更してみる。</li>
                    <li>掲載期間を設定すると、その期間のみ自動的に表示されます。</li>
                    <li>掲載場所を「result」に設定すると、採点結果画面のみに表示されます。</li>
                </ul>
            </div>
        </div>
    );
};

export default AdminBannerDashboard;
