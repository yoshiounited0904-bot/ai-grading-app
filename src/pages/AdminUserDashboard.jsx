import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getAdminProfiles, updateUserApprovalStatus, updateUserRole } from '../services/adminUserService';

function AdminUserDashboard() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all, pending, approved

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

    const handleStatusChange = async (userId, newStatus) => {
        const { error } = await updateUserApprovalStatus(userId, newStatus);
        if (error) {
            alert('ステータスの更新に失敗しました。SQLを実行して approval_status 列を追加したか確認してください。');
        } else {
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, approval_status: newStatus } : u));
        }
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

    const filteredUsers = users.filter(u => {
        if (filter === 'all') return true;
        return u.approval_status === filter;
    });

    return (
        <div className="min-h-screen bg-indigo-50/30 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <div className="flex items-center gap-4 mb-2">
                        <Link to="/admin" className="text-sm font-bold text-navy-blue hover:underline">← 試験管理へ戻る</Link>
                    </div>
                    <h1 className="text-3xl font-black text-navy-blue flex items-center gap-3">
                        ユーザー管理・承認
                        <span className="text-xs bg-navy-blue text-white px-2 py-1 rounded-full font-mono">USER AUTH</span>
                    </h1>
                </div>

                {/* Filters */}
                <div className="flex gap-4 mb-6">
                    {['all', 'pending', 'approved'].map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${filter === f 
                                ? 'bg-navy-blue text-white shadow-md' 
                                : 'bg-white text-gray-400 hover:text-navy-blue'}`}
                        >
                            {f === 'all' ? '全員' : f === 'pending' ? '承認待ち 🍎' : '承認済み ✅'}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="flex justify-center my-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navy-blue"></div>
                    </div>
                ) : filteredUsers.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-md p-10 text-center">
                        <p className="text-gray-500">該当するユーザーはいません。</p>
                    </div>
                ) : (
                    <div className="bg-white/50 backdrop-blur-sm rounded-md p-4 shadow-inner border-2 border-indigo-100/50">
                        <div className="overflow-x-auto">
                            <table className="min-w-full border-separate border-spacing-y-3">
                                <thead>
                                    <tr className="text-navy-blue/40 font-black text-[10px] uppercase tracking-[0.2em]">
                                        <th className="px-6 py-2 text-left">ユーザー情報</th>
                                        <th className="px-6 py-2 text-left">第一志望 / 学年</th>
                                        <th className="px-6 py-2 text-center">権限</th>
                                        <th className="px-6 py-2 text-center">ステータス</th>
                                        <th className="px-6 py-2 text-right">操作</th>
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
                                                <span className={`px-3 py-1 text-[10px] font-black rounded-full ${
                                                    user.approval_status === 'approved' 
                                                    ? 'bg-green-100 text-green-700' 
                                                    : 'bg-red-100 text-red-700'
                                                }`}>
                                                    {user.approval_status === 'approved' ? '承認済み' : '承認待ち'}
                                                </span>
                                            </td>
                                            <td className="bg-white px-6 py-4 rounded-r-xl border-y-2 border-r-2 border-gray-100 group-hover:border-navy-blue/30 shadow-sm text-right">
                                                {user.approval_status === 'pending' ? (
                                                    <button
                                                        onClick={() => handleStatusChange(user.id, 'approved')}
                                                        className="px-4 py-1.5 text-xs font-black bg-navy-blue text-white rounded-lg shadow hover:bg-navy-light transition-all"
                                                    >
                                                        承認する ✅
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleStatusChange(user.id, 'pending')}
                                                        className="px-4 py-1.5 text-xs font-bold text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                                    >
                                                        承認取消
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default AdminUserDashboard;
