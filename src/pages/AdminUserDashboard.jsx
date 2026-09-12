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

    const filteredUsers = useMemo(() => {
        const query = normalizeSearchText(searchQuery);
        return users.filter((user) => {
            const status = getSubscriptionStatus(user);
            if (statusFilter !== 'all' && status !== statusFilter) return false;
            if (!query) return true;

            const searchableText = [
                user.username,
                user.id,
                user.role,
                user.plan,
                status,
                getSubscriptionStatusLabel(status),
                user.first_choice_university,
                user.grade,
                user.stripe_customer_id,
                user.premium_until ? new Date(user.premium_until).toLocaleDateString('ja-JP') : ''
            ].join(' ').toLowerCase();

            return searchableText.includes(query);
        });
    }, [searchQuery, statusFilter, users]);

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

                <div className="bg-white rounded-md border-2 border-indigo-100/60 shadow-sm p-4 mb-5">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-3 items-end">
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em]">検索</span>
                            <input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="名前・ユーザーID・大学・Stripe ID・ステータスで検索"
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
                        <button
                            type="button"
                            onClick={() => {
                                setSearchQuery('');
                                setStatusFilter('all');
                            }}
                            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-black text-navy-blue hover:bg-gray-50"
                        >
                            リセット
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
