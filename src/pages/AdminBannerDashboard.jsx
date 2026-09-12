import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    AD_AUDIENCES,
    AD_SLOTS,
    getAdminBanners,
    getAudienceLabel,
    getSlotLabels,
    normalizeBannerSlots,
    updateBanner,
    deleteBanner
} from '../services/adminBannerService';

const AdminBannerDashboard = () => {
    const navigate = useNavigate();
    const [banners, setBanners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [slotFilter, setSlotFilter] = useState('all');
    const [audienceFilter, setAudienceFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');

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

    const filteredBanners = banners.filter((banner) => {
        if (slotFilter !== 'all' && !normalizeBannerSlots(banner).includes(slotFilter)) return false;
        if (audienceFilter !== 'all' && (banner.target_audience || 'all') !== audienceFilter) return false;
        if (statusFilter === 'active' && !banner.is_active) return false;
        if (statusFilter === 'inactive' && banner.is_active) return false;
        return true;
    });

    const totalImpressions = filteredBanners.reduce((sum, banner) => sum + Number(banner.impression_count || 0), 0);
    const totalClicks = filteredBanners.reduce((sum, banner) => sum + Number(banner.click_count || 0), 0);
    const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(1) : '0.0';
    const activeCount = filteredBanners.filter(banner => banner.is_active).length;

    const formatTargets = (banner) => {
        const items = [
            banner.university,
            banner.faculty,
            banner.subject,
            banner.year ? `${banner.year}年` : ''
        ].filter(Boolean);
        return items.length > 0 ? items.join(' / ') : '条件なし';
    };

    if (loading) return <div className="p-8 text-center text-gray-500">読み込み中...</div>;

    return (
        <div className="admin-page p-6 max-w-6xl mx-auto">
            <div className="admin-mobile-stack flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-serif text-navy-blue">管理者ページ</h1>
                    <div className="flex gap-6 mt-2 border-b border-gray-200">
                        <button 
                            onClick={() => {
                                console.log("Navigating to Exam Master...");
                                navigate('/admin');
                            }}
                            className="pb-2 px-1 text-gray-400 hover:text-navy-blue"
                        >
                            試験マスター管理
                        </button>
                        <button className="pb-2 px-1 border-b-2 border-navy-blue font-bold text-navy-blue">
                            広告管理
                        </button>
                    </div>
                </div>
                <Link
                    to="/admin/banners/new"
                    className="bg-navy-blue text-white font-bold py-2.5 px-6 rounded-lg shadow hover:bg-opacity-90 transition-all flex items-center gap-2 admin-mobile-action-link"
                >
                    <span className="text-xl">+</span> 広告を作成・配信設定
                </Link>
            </div>

            <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm mb-5">
                <div className="text-sm font-bold text-navy-blue mb-1">広告管理</div>
                <p className="text-sm text-gray-600 leading-relaxed">
                    広告素材の作成、表示場所、対象条件、公開状態、効果測定をこの画面でまとめて管理します。
                </p>
            </div>

            <details className="bg-blue-50 border border-blue-100 rounded-xl p-5 shadow-sm mb-5" open>
                <summary className="cursor-pointer text-sm font-bold text-blue-900">
                    広告管理の使い方
                </summary>
                <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="bg-white/80 border border-blue-100 rounded-lg p-4">
                        <h3 className="text-sm font-bold text-blue-900 mb-2">1. 広告を作る</h3>
                        <ol className="text-xs text-blue-800 space-y-1 list-decimal pl-4 leading-relaxed">
                            <li>「広告を作成・配信設定」を押す。</li>
                            <li>管理用タイトル、説明文、画像、リンク先URLを入力する。</li>
                            <li>広告形式は横長バナーで統一されます。</li>
                        </ol>
                    </div>
                    <div className="bg-white/80 border border-blue-100 rounded-lg p-4">
                        <h3 className="text-sm font-bold text-blue-900 mb-2">2. 出す場所を決める</h3>
                        <ul className="text-xs text-blue-800 space-y-1 list-disc pl-4 leading-relaxed">
                            <li>結果上部、詳細解説ロック、AI質問ロック、マイページなどから複数選ぶ。</li>
                            <li>プレミアム訴求は「詳細解説ロック」「AI質問ロック」が最も強い。</li>
                            <li>複数箇所で同じ広告を使う場合は、必要な枠をすべて選択する。</li>
                        </ul>
                    </div>
                    <div className="bg-white/80 border border-blue-100 rounded-lg p-4">
                        <h3 className="text-sm font-bold text-blue-900 mb-2">3. 誰に出すか決める</h3>
                        <ul className="text-xs text-blue-800 space-y-1 list-disc pl-4 leading-relaxed">
                            <li>未ログイン、無料会員、プレミアム会員、全員から選ぶ。</li>
                            <li>有料化の導線は基本「無料会員」向けにする。</li>
                            <li>ゲスト向けには会員登録や体験価値を見せる広告が向いている。</li>
                        </ul>
                    </div>
                </div>
                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-white/80 border border-blue-100 rounded-lg p-4">
                        <h3 className="text-sm font-bold text-blue-900 mb-2">表示条件の考え方</h3>
                        <ul className="text-xs text-blue-800 space-y-1 list-disc pl-4 leading-relaxed">
                            <li>大学・学部・科目・年度を空欄にすると、その条件は絞り込まれない。</li>
                            <li>大学別や学部別の教材広告は、採点前・結果系の枠を選んだ時だけ条件指定できる。</li>
                            <li>同じ場所に複数広告がある場合は、条件が具体的な広告が先に表示される。</li>
                        </ul>
                    </div>
                    <div className="bg-white/80 border border-blue-100 rounded-lg p-4">
                        <h3 className="text-sm font-bold text-blue-900 mb-2">公開前チェック</h3>
                        <ul className="text-xs text-blue-800 space-y-1 list-disc pl-4 leading-relaxed">
                            <li>公開スイッチがONになっているか確認する。</li>
                            <li>公開終了日を設定している場合は、現在日時に合っているか確認する。</li>
                            <li>表示場所、対象ユーザー、大学条件が狭すぎないか確認する。</li>
                        </ul>
                    </div>
                </div>
            </details>

            {error && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6">
                    <p className="text-red-700 text-sm font-bold">{error}</p>
                    <p className="text-xs text-red-600 mt-1">※ supabase_schema_banners.sqlの内容をSQL Editorで実行したか確認してください。</p>
                </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                <div className="bg-white border border-gray-100 rounded-lg p-4 shadow-sm">
                    <div className="text-xs text-gray-500 font-bold">表示中</div>
                    <div className="text-2xl font-bold text-gray-900">{filteredBanners.length}件</div>
                </div>
                <div className="bg-white border border-gray-100 rounded-lg p-4 shadow-sm">
                    <div className="text-xs text-gray-500 font-bold">公開中</div>
                    <div className="text-2xl font-bold text-green-700">{activeCount}件</div>
                </div>
                <div className="bg-white border border-gray-100 rounded-lg p-4 shadow-sm">
                    <div className="text-xs text-gray-500 font-bold">表示 / クリック</div>
                    <div className="text-2xl font-bold text-gray-900">{totalImpressions} / {totalClicks}</div>
                </div>
                <div className="bg-white border border-gray-100 rounded-lg p-4 shadow-sm">
                    <div className="text-xs text-gray-500 font-bold">CTR</div>
                    <div className="text-2xl font-bold text-amber-700">{ctr}%</div>
                </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm mb-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="text-xs font-bold text-gray-500">
                        表示場所
                        <select value={slotFilter} onChange={(e) => setSlotFilter(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-md p-2 text-sm text-gray-800">
                            <option value="all">すべて</option>
                            {AD_SLOTS.map(slot => (
                                <option key={slot.value} value={slot.value}>{slot.label}</option>
                            ))}
                        </select>
                    </label>
                    <label className="text-xs font-bold text-gray-500">
                        対象ユーザー
                        <select value={audienceFilter} onChange={(e) => setAudienceFilter(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-md p-2 text-sm text-gray-800">
                            <option value="all">すべて</option>
                            {AD_AUDIENCES.filter(audience => audience.value !== 'all').map(audience => (
                                <option key={audience.value} value={audience.value}>{audience.label}</option>
                            ))}
                        </select>
                    </label>
                    <label className="text-xs font-bold text-gray-500">
                        公開状態
                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-md p-2 text-sm text-gray-800">
                            <option value="all">すべて</option>
                            <option value="active">公開中のみ</option>
                            <option value="inactive">停止中のみ</option>
                        </select>
                    </label>
                </div>
            </div>

                    <div className="admin-banner-table-shell bg-white rounded-xl shadow border border-gray-100">
                        <table className="admin-banner-table min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">広告素材</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">表示内容 / リンク</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">表示場所 / 対象</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">表示条件</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">効果測定</th>
                            <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">公開</th>
                            <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">操作</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {filteredBanners.length === 0 ? (
                            <tr>
                                <td colSpan="7" className="px-6 py-12 text-center text-gray-400">条件に一致する広告はありません</td>
                            </tr>
                        ) : (
                            filteredBanners.map((banner) => (
                                <tr key={banner.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="w-24 h-12 bg-gray-100 rounded overflow-hidden flex items-center justify-center border border-gray-200" style={{ width: '120px', height: '60px' }}>
                                            {banner.image_url ? (
                                                <img src={banner.image_url} alt={banner.title} className="admin-banner-preview" />
                                            ) : (
                                                <span className="text-[10px] text-gray-400">No Image</span>
                                            )}
                                        </div>
                                    </td>
                                        <td className="admin-banner-main-cell px-6 py-4">
                                            <div className="admin-banner-title">{banner.title}</div>
                                            {banner.description && (
                                                <div className="admin-banner-description" title={banner.description}>{banner.description}</div>
                                            )}
                                            <div className="admin-banner-url-line" title={banner.target_url || ''}>
                                                {banner.target_url ? (
                                                    <a href={banner.target_url} target="_blank" rel="noopener noreferrer" className="admin-banner-url">
                                                        {banner.target_url}
                                                    </a>
                                                ) : (
                                                    <span className="admin-banner-url-empty">リンクなし</span>
                                                )}
                                            </div>
                                        </td>
                                    <td className="px-6 py-4">
                                        <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold" style={{ backgroundColor: '#e0e7ff', color: '#4338ca', padding: '0.125rem 0.5rem', borderRadius: '9999px' }}>
                                            {getSlotLabels(banner)}
                                        </span>
                                        <div className="text-[10px] text-gray-400 mt-1">
                                            {getAudienceLabel(banner.target_audience || 'all')} / 横長バナー / サイズ {banner.width_percent || 100}%
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                            <div className="admin-banner-target-text text-xs text-gray-700 max-w-[180px]">{formatTargets(banner)}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-xs font-medium text-gray-700">
                                            {banner.impression_count} / {banner.click_count}
                                        </div>
                                        <div className="text-[10px] font-bold" style={{ color: '#d97706' }}>
                                            CTR: {banner.impression_count > 0 ? ((banner.click_count / banner.impression_count) * 100).toFixed(1) : 0}%
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <button
                                            onClick={() => handleToggleActive(banner.id, banner.is_active)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${banner.is_active ? 'bg-green-500' : 'bg-gray-200'}`}
                                            style={{ 
                                                width: '44px', 
                                                height: '24px', 
                                                backgroundColor: banner.is_active ? '#22c55e' : '#e5e7eb',
                                                borderRadius: '9999px',
                                                border: 'none',
                                                position: 'relative'
                                            }}
                                        >
                                            <span 
                                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${banner.is_active ? 'translate-x-5' : 'translate-x-0'}`} 
                                                style={{
                                                    display: 'block',
                                                    width: '20px',
                                                    height: '20px',
                                                    backgroundColor: 'white',
                                                    borderRadius: '50%',
                                                    transform: banner.is_active ? 'translateX(20px)' : 'translateX(0)',
                                                    transition: '0.2s'
                                                }}
                                            />
                                        </button>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <Link to={`/admin/banners/${banner.id}`} className="text-navy-blue hover:text-indigo-900 mr-4 font-bold" style={{ marginRight: '1rem' }}>編集</Link>
                                        <button 
                                            onClick={() => handleDelete(banner.id)} 
                                            className="text-red-600 hover:text-red-900 font-bold"
                                            style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                                        >
                                            削除
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <div className="mt-8 bg-amber-50 rounded-xl p-6 border border-amber-100">
                <h3 className="text-sm font-bold text-amber-900 mb-2">広告が表示されない時の確認</h3>
                <ul className="text-xs text-amber-800 space-y-1 list-disc list-inside">
                    <li>公開スイッチ、公開終了日、対象ユーザー、表示場所のどれかが合っていない可能性があります。</li>
                    <li>大学・学部・科目・年度を指定した広告は、該当する試験画面でだけ表示されます。</li>
                    <li>アプリ側の広告表示設定がOFFの場合、広告データが公開中でも表示されません。</li>
                    <li>同じ枠の広告が複数ある場合、大学・学部などの条件が具体的な広告が優先されます。</li>
                </ul>
            </div>
        </div>
    );
};

export default AdminBannerDashboard;
