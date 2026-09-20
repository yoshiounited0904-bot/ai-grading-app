import React, { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getAdminProfiles, updateUserRole, updateUserPlan } from '../services/adminUserService';

const normalizeSearchText = (value) => String(value || '').toLowerCase().trim();

const getSubscriptionStatus = (user) => {
    const status = String(user.subscription_status || '').trim();
    if (status) return status;
    return user.plan === 'premium' ? 'manual_premium' : 'none';
};

const getSubscriptionStatusLabel = (status) => {
    const labels = {
        active: '有効',
        trialing: 'トライアル',
        processing: '処理中',
        past_due: '支払い要確認',
        canceled: 'キャンセル',
        incomplete: '未完了',
        incomplete_expired: '期限切れ',
        unpaid: '未払い',
        manual_premium: '手動プレミアム',
        none: '未契約'
    };
    return labels[status] || status;
};

function AdminUserDashboard() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [promoFilter, setPromoFilter] = useState('all');

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        setLoading(true);
        const { data, error } = await getAdminProfiles();
        if (error) {
            console.error('Error fetching users:', error);
            alert('ユーザーデータの取得に失敗しました。');
        } else {
            setUsers(data || []);
        }
        setLoading(false);
    };

    const handleRoleChange = async (userId, currentRole) => {
        const newRole = currentRole === 'admin' ? 'user' : 'admin';
        if (!window.confirm(`このユーザーを${newRole === 'admin' ? '管理者' : '一般ユーザー'}に変更しますか？`)) return;

        const { error } = await updateUserRole(userId, newRole);
        if (error) {
            alert('ロールの更新に失敗しました。');
        } else {
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
        }
    };

    const handlePlanChange = async (userId, currentPlan) => {
        const newPlan = currentPlan === 'premium' ? 'free' : 'premium';
        if (!window.confirm(`このユーザーを${newPlan === 'premium' ? 'プレミアム' : '無料'}プランに変更しますか？`)) return;

        const { error } = await updateUserPlan(userId, newPlan);
        if (error) {
            alert('プランの更新に失敗しました。SQLを実行して profiles.plan 列を追加したか確認してください。');
        } else {
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, plan: newPlan } : u));
        }
    };

    const statusOptions = useMemo(() => {
        const statuses = [...new Set(users.map(getSubscriptionStatus).filter(Boolean))];
        return statuses.sort((a, b) => getSubscriptionStatusLabel(a).localeCompare(getSubscriptionStatusLabel(b), 'ja'));
    }, [users]);

    const referralStats = useMemo(() => {
        const stats = { 'X（Twitter）': 0, 'ウェブ': 0, '知り合いの紹介': 0, 'その他': 0, '未回答': 0 };
        users.forEach((u) => {
            const src = u.referral_source;
            if (src && stats[src] !== undefined) {
                stats[src]++;
            } else if (src) {
                stats['その他']++;
            } else {
                stats['未回答']++;
            }
        });
        return stats;
    }, [users]);

    const promoStats = useMemo(() => {
        let verifiedCount = 0;
        let latestVerifiedAt = null;
        const codeCounts = {};

        users.forEach((u) => {
            if (u.promo_code_verified) {
                verifiedCount++;
                const code = u.promo_code_value || 'SUMASAI2026';
                codeCounts[code] = (codeCounts[code] || 0) + 1;
                if (u.promo_code_verified_at) {
                    if (!latestVerifiedAt || new Date(u.promo_code_verified_at) > new Date(latestVerifiedAt)) {
                        latestVerifiedAt = u.promo_code_verified_at;
                    }
                }
            }
        });

        const total = users.length;
        const unverifiedCount = Math.max(0, total - verifiedCount);
        const rate = total > 0 ? Math.round((verifiedCount / total) * 100) : 0;

        return {
            verifiedCount,
            unverifiedCount,
            total,
            rate,
            latestVerifiedAt,
            codeCounts
        };
    }, [users]);

    const filteredUsers = useMemo(() => {
        const query = normalizeSearchText(searchQuery);
        return users.filter((user) => {
            const status = getSubscriptionStatus(user);
            if (statusFilter !== 'all' && status !== statusFilter) return false;
            if (promoFilter === 'verified' && !user.promo_code_verified) return false;
            if (promoFilter === 'unverified' && user.promo_code_verified) return false;
            if (!query) return true;

            const searchableText = [
                user.username,
                user.id,
                user.role,
                user.plan,
                user.referral_source,
                user.promo_code_value,
                user.promo_code_verified ? 'プロモコード入力済' : 'プロモコード未入力',
                status,
                getSubscriptionStatusLabel(status),
                user.first_choice_university,
                user.grade,
                user.stripe_customer_id,
                user.stripe_subscription_id
            ]
                .filter(Boolean)
                .map(normalizeSearchText)
                .join(' ');

            return searchableText.includes(query);
        });
    }, [promoFilter, searchQuery, statusFilter, users]);

    const exportToExcel = () => {
        const escapeCSV = (val) => {
            const s = String(val ?? '');
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
                return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
        };

        const headers = [
            'ユーザー名', 'ユーザーID', '第一志望大学', '学年',
            '認知経路', 'プロモコード', 'プロモコード入力日',
            '権限', 'プラン', 'サブスク状態', 'プレミアム期限',
            'Stripe顧客ID', 'Stripeサブスク ID', '登録日'
        ];

        const rows = filteredUsers.map(u => [
            u.username || '',
            u.id || '',
            u.first_choice_university || '',
            u.grade || '',
            u.referral_source || '未回答',
            u.promo_code_verified ? (u.promo_code_value || '入力済') : '未入力',
            u.promo_code_verified_at ? new Date(u.promo_code_verified_at).toLocaleString('ja-JP') : '',
            u.role === 'admin' ? '管理者' : '一般',
            u.plan === 'premium' ? 'プレミアム' : '無料',
            getSubscriptionStatusLabel(getSubscriptionStatus(u)),
            u.premium_until ? new Date(u.premium_until).toLocaleDateString('ja-JP') : '',
            u.stripe_customer_id || '',
            u.stripe_subscription_id || '',
            u.created_at ? new Date(u.created_at).toLocaleDateString('ja-JP') : ''
        ]);

        const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(escapeCSV).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `スマサイ_ユーザーデータ_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="min-h-screen bg-indigo-50/30 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <div className="flex items-center gap-4 mb-2">
                        <Link to="/admin" className="text-sm font-bold text-navy-blue hover:underline">← 試験管理へ戻る</Link>
                    </div>
                    <h1 className="text-3xl font-black text-navy-blue flex items-center gap-3">
                        ユーザー管理
                        <span className="text-xs bg-navy-blue text-white px-2 py-1 rounded-full font-mono">USERS</span>
                    </h1>
                </div>

                {/* 認知経路アンケート集計 */}
                <div className="bg-white rounded-md border-2 border-indigo-100/60 shadow-sm p-4 mb-5">
                    <div className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em] mb-3">
                        認知経路アンケート集計（登録時アンケート）
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        <div className="bg-sky-50 border border-sky-200/60 rounded-md p-3 text-center">
                            <div className="text-[11px] font-bold text-sky-700">X（Twitter）</div>
                            <div className="text-xl font-black text-sky-900 mt-1">{referralStats['X（Twitter）']}人</div>
                        </div>
                        <div className="bg-emerald-50 border border-emerald-200/60 rounded-md p-3 text-center">
                            <div className="text-[11px] font-bold text-emerald-700">ウェブ</div>
                            <div className="text-xl font-black text-emerald-900 mt-1">{referralStats['ウェブ']}人</div>
                        </div>
                        <div className="bg-violet-50 border border-violet-200/60 rounded-md p-3 text-center">
                            <div className="text-[11px] font-bold text-violet-700">知り合いの紹介</div>
                            <div className="text-xl font-black text-violet-900 mt-1">{referralStats['知り合いの紹介']}人</div>
                        </div>
                        <div className="bg-amber-50 border border-amber-200/60 rounded-md p-3 text-center">
                            <div className="text-[11px] font-bold text-amber-700">その他</div>
                            <div className="text-xl font-black text-amber-900 mt-1">{referralStats['その他']}人</div>
                        </div>
                        <div className="bg-gray-50 border border-gray-200/60 rounded-md p-3 text-center">
                            <div className="text-[11px] font-bold text-gray-500">未回答</div>
                            <div className="text-xl font-black text-gray-700 mt-1">{referralStats['未回答']}人</div>
                        </div>
                    </div>
                </div>

                {/* プロモコード入力集計 */}
                <div className="bg-white rounded-md border-2 border-emerald-100 shadow-sm p-4 mb-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <div className="text-[10px] font-black text-emerald-900/60 uppercase tracking-[0.18em] flex items-center gap-1.5">
                            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                            公式LINE無料開放 プロモコード入力状況
                        </div>
                        {promoStats.latestVerifiedAt && (
                            <span className="text-[11px] font-mono text-gray-400">
                                最終入力: {new Date(promoStats.latestVerifiedAt).toLocaleString('ja-JP')}
                            </span>
                        )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-emerald-50/80 border border-emerald-200/80 rounded-md p-3 text-center">
                            <div className="text-[11px] font-bold text-emerald-800">入力済み</div>
                            <div className="text-2xl font-black text-emerald-900 mt-1">
                                {promoStats.verifiedCount}<span className="text-sm font-bold text-emerald-700 ml-0.5">人</span>
                            </div>
                        </div>
                        <div className="bg-gray-50 border border-gray-200 rounded-md p-3 text-center">
                            <div className="text-[11px] font-bold text-gray-600">未入力</div>
                            <div className="text-2xl font-black text-gray-800 mt-1">
                                {promoStats.unverifiedCount}<span className="text-sm font-bold text-gray-500 ml-0.5">人</span>
                            </div>
                        </div>
                        <div className="bg-indigo-50/70 border border-indigo-200/70 rounded-md p-3 text-center">
                            <div className="text-[11px] font-bold text-indigo-800">入力率</div>
                            <div className="text-2xl font-black text-navy-blue mt-1">
                                {promoStats.rate}<span className="text-sm font-bold text-indigo-700 ml-0.5">%</span>
                            </div>
                        </div>
                        <div className="bg-amber-50/70 border border-amber-200/70 rounded-md p-3 text-center">
                            <div className="text-[11px] font-bold text-amber-800">登録総数</div>
                            <div className="text-2xl font-black text-amber-900 mt-1">
                                {promoStats.total}<span className="text-sm font-bold text-amber-700 ml-0.5">人</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-md border-2 border-indigo-100/60 shadow-sm p-4 mb-5">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_160px_auto_auto] gap-3 items-end">
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em]">検索</span>
                            <input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="名前・ユーザーID・大学・Stripe ID・プロモコード等で検索"
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none focus:border-navy-blue/40 focus:bg-white"
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em]">ステータス</span>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none focus:border-navy-blue/40 focus:bg-white"
                            >
                                <option value="all">すべて</option>
                                {statusOptions.map(status => (
                                    <option key={status} value={status}>{getSubscriptionStatusLabel(status)}</option>
                                ))}
                            </select>
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em]">プロモコード</span>
                            <select
                                value={promoFilter}
                                onChange={(e) => setPromoFilter(e.target.value)}
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none focus:border-navy-blue/40 focus:bg-white"
                            >
                                <option value="all">すべて</option>
                                <option value="verified">入力済みのみ</option>
                                <option value="unverified">未入力のみ</option>
                            </select>
                        </label>
                        <button
                            type="button"
                            onClick={() => {
                                setSearchQuery('');
                                setStatusFilter('all');
                                setPromoFilter('all');
                            }}
                            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-black text-navy-blue hover:bg-gray-50"
                        >
                            リセット
                        </button>
                        <button
                            type="button"
                            onClick={exportToExcel}
                            className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700 hover:bg-emerald-100 flex items-center gap-1.5"
                        >
                            📥 Excelエクスポート
                        </button>
                    </div>
                    <div className="mt-3 text-xs font-bold text-gray-400">
                        表示中 {filteredUsers.length} / 全{users.length}件
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center my-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navy-blue"></div>
                    </div>
                ) : users.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-md p-10 text-center">
                        <p className="text-gray-500">該当するユーザーはいません。</p>
                    </div>
                ) : (
                    <div className="bg-white/50 backdrop-blur-sm rounded-md p-4 shadow-inner border-2 border-indigo-100/50">
                        <div className="overflow-x-auto">
                            {filteredUsers.length === 0 ? (
                                <div className="bg-white rounded-md border border-gray-100 p-10 text-center">
                                    <p className="text-gray-500 font-bold">検索条件に一致するユーザーはいません。</p>
                                </div>
                            ) : (
                            <table className="min-w-full border-separate border-spacing-y-3">
                                <thead>
                                    <tr className="text-navy-blue/40 font-black text-[10px] uppercase tracking-[0.2em]">
                                        <th className="px-6 py-2 text-left">ユーザー情報</th>
                                        <th className="px-6 py-2 text-left">第一志望 / 学年</th>
                                        <th className="px-6 py-2 text-left">認知経路</th>
                                        <th className="px-6 py-2 text-left">プロモコード</th>
                                        <th className="px-6 py-2 text-center">権限</th>
                                        <th className="px-6 py-2 text-center">プラン</th>
                                        <th className="px-6 py-2 text-left">Stripe</th>
                                        <th className="px-6 py-2 text-right">登録日</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredUsers.map((user) => (
                                        <tr key={user.id} className="group transition-all duration-300">
                                            <td className="bg-white px-6 py-4 rounded-l-xl border-y-2 border-l-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm">
                                                <div className="flex flex-col">
                                                    <span className="font-black text-navy-blue">{user.username || '名前なし'}</span>
                                                    <span className="text-xs text-gray-400 font-mono">{user.id.substring(0, 8)}...</span>
                                                </div>
                                            </td>
                                            <td className="bg-white px-6 py-4 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-bold text-gray-700">{user.first_choice_university || '-'}</span>
                                                    <span className="text-[10px] text-gray-400 font-bold">{user.grade || '-'}</span>
                                                </div>
                                            </td>
                                            <td className="bg-white px-6 py-4 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${
                                                    user.referral_source === 'X（Twitter）' ? 'bg-sky-50 text-sky-700 border border-sky-200' :
                                                    user.referral_source === 'ウェブ' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                                    user.referral_source === '知り合いの紹介' ? 'bg-violet-50 text-violet-700 border border-violet-200' :
                                                    user.referral_source ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                                    'bg-gray-50 text-gray-400 border border-gray-200'
                                                }`}>
                                                    {user.referral_source || '未回答'}
                                                </span>
                                            </td>
                                            <td className="bg-white px-6 py-4 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm">
                                                {user.promo_code_verified ? (
                                                    <div className="flex flex-col">
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 w-fit">
                                                            <span>✓</span> {user.promo_code_value || '入力済'}
                                                        </span>
                                                        {user.promo_code_verified_at && (
                                                            <span className="text-[10px] text-gray-400 font-mono mt-0.5">
                                                                {new Date(user.promo_code_verified_at).toLocaleDateString('ja-JP')}
                                                            </span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-gray-50 text-gray-400 border border-gray-200">
                                                        未入力
                                                    </span>
                                                )}
                                            </td>
                                            <td className="bg-white px-6 py-4 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm text-center">
                                                <button
                                                    onClick={() => handleRoleChange(user.id, user.role)}
                                                    className={`px-3 py-1 text-[10px] font-black rounded-full border-2 ${
                                                        user.role === 'admin' 
                                                        ? 'bg-amber-50 text-amber-600 border-amber-200' 
                                                        : 'bg-gray-50 text-gray-400 border-gray-100'
                                                    }`}
                                                >
                                                    {user.role === 'admin' ? '管理者' : '一般'}
                                                </button>
                                            </td>
                                            <td className="bg-white px-6 py-4 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm text-center">
                                                <button
                                                    onClick={() => handlePlanChange(user.id, user.plan || 'free')}
                                                    className={`px-3 py-1 text-[10px] font-black rounded-full border-2 ${
                                                        user.plan === 'premium' 
                                                        ? 'bg-yellow-50 text-yellow-700 border-yellow-200' 
                                                        : 'bg-gray-50 text-gray-400 border-gray-100'
                                                    }`}
                                                >
                                                    {user.plan === 'premium' ? 'プレミアム' : '無料'}
                                                </button>
                                            </td>
                                            <td className="bg-white px-6 py-4 border-y-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm">
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-xs font-bold text-gray-600">
                                                        {getSubscriptionStatusLabel(getSubscriptionStatus(user))}
                                                    </span>
                                                    <span className="text-[10px] text-gray-400 font-mono">
                                                        {user.premium_until
                                                            ? `期限 ${new Date(user.premium_until).toLocaleDateString('ja-JP')}`
                                                            : '期限 -'}
                                                    </span>
                                                    {user.stripe_customer_id && (
                                                        <span className="text-[10px] text-gray-400 font-mono">
                                                            {user.stripe_customer_id}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="bg-white px-6 py-4 rounded-r-xl border-y-2 border-r-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm text-right">
                                                <span className="text-xs text-gray-400 font-mono">
                                                    {user.created_at ? new Date(user.created_at).toLocaleDateString('ja-JP') : '-'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default AdminUserDashboard;
