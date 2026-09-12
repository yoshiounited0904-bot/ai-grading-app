import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAdminResultAnalytics } from '../services/adminResultAnalyticsService';

const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const normalizeSearchText = (value) => String(value || '').toLowerCase().normalize('NFKC');

const formatScore = (result) => {
    const score = Number(result.score);
    const maxScore = Number(result.max_score);
    if (!Number.isFinite(score) || !Number.isFinite(maxScore)) return '-';
    return `${score}/${maxScore}`;
};

const getExamTitle = (result) => {
    const university = String(result.university_name || '').trim();
    const faculty = String(result.faculty_name || '').trim();
    const year = result.exam_year ? `${result.exam_year}年度` : '';
    const subject = String(result.exam_subject || '').trim();
    return [university, faculty, year, subject].filter(Boolean).join(' ');
};

const getUniqueOptions = (items, mapper) => (
    [...new Set(items.map(mapper).filter(Boolean))]
        .sort((a, b) => String(a).localeCompare(String(b), 'ja'))
);

const summarizeSectionScores = (sectionScores) => {
    if (!sectionScores) return '';
    if (Array.isArray(sectionScores)) {
        return sectionScores
            .map((section, index) => {
                if (typeof section === 'number') return `大問${index + 1}: ${section}点`;
                const score = section?.score ?? section?.earned ?? section?.points;
                const max = section?.maxScore ?? section?.max_score ?? section?.total;
                if (score === undefined) return null;
                return `大問${section?.sectionId || section?.id || index + 1}: ${score}${max ? `/${max}` : ''}点`;
            })
            .filter(Boolean)
            .slice(0, 4)
            .join(' / ');
    }
    if (typeof sectionScores === 'object') {
        return Object.entries(sectionScores)
            .slice(0, 4)
            .map(([key, value]) => {
                if (typeof value === 'number') return `${key}: ${value}点`;
                const score = value?.score ?? value?.earned ?? value?.points;
                const max = value?.maxScore ?? value?.max_score ?? value?.total;
                return `${key}: ${score ?? '-'}${max ? `/${max}` : ''}点`;
            })
            .join(' / ');
    }
    return '';
};

function AdminResultAnalytics() {
    const navigate = useNavigate();
    const [days, setDays] = useState('30');
    const [searchQuery, setSearchQuery] = useState('');
    const [userFilter, setUserFilter] = useState('all');
    const [universityFilter, setUniversityFilter] = useState('all');
    const [analytics, setAnalytics] = useState({ users: [], results: [] });
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);

    const handleOpenResult = (result) => {
        navigate('/result', {
            state: {
                result: {
                    id: result.id,
                    score: result.score,
                    maxScore: result.max_score,
                    passProbability: result.pass_probability,
                    weaknessAnalysis: result.weakness_analysis,
                    weakness_analysis: result.weakness_analysis,
                    questionFeedback: result.question_feedback,
                    question_feedback: result.question_feedback,
                    section_scores: result.section_scores,
                    rawScore: result.answers?.rawScore,
                    rawMaxScore: result.answers?.rawMaxScore,
                    compressedScore: result.answers?.compressedScore,
                    compressedMaxScore: result.answers?.compressedMaxScore,
                    scoreCompression: result.answers?.scoreCompression || null,
                    scoreCap: result.answers?.scoreCap || null
                },
                universityName: result.university_name,
                facultyName: result.faculty_name,
                examSubject: result.exam_subject,
                examYear: result.exam_year,
                answers: result.answers,
                pdfPath: result.pdf_path || result.answers?.pdfPath || null,
                isNewResult: false,
                fromAdmin: true
            }
        });
    };

    const fetchAnalytics = async () => {
        setLoading(true);
        setLoadError(null);
        const { data, error } = await getAdminResultAnalytics({ days: days === 'all' ? null : Number(days) });
        if (error) {
            console.error('Error fetching result analytics:', error);
            const msg = error?.message || (typeof error === 'string' ? error : '不明なエラー');
            setLoadError(msg);
            alert(`成績ログの取得に失敗しました。\n\n【詳細】\n${msg}\n\n※ Supabase の RLS ポリシー（管理者が exam_results を閲覧できる権限）が設定されているかご確認ください。`);
        } else {
            setAnalytics(data || { users: [], results: [] });
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchAnalytics();
    }, [days]);

    const usersWithResults = useMemo(() => {
        const userIds = new Set(analytics.results.map(result => result.user_id).filter(Boolean));
        return analytics.users.filter(user => userIds.has(user.id));
    }, [analytics.results, analytics.users]);

    const universityOptions = useMemo(
        () => getUniqueOptions(analytics.results, result => result.university_name),
        [analytics.results]
    );

    const filteredResults = useMemo(() => {
        const query = normalizeSearchText(searchQuery);
        return analytics.results.filter((result) => {
            if (userFilter !== 'all' && result.user_id !== userFilter) return false;
            if (universityFilter !== 'all' && result.university_name !== universityFilter) return false;
            if (!query) return true;

            const searchable = [
                result.userName,
                result.user_id,
                result.userGrade,
                result.userFirstChoice,
                result.university_name,
                result.faculty_name,
                result.exam_subject,
                result.exam_year,
                result.score,
                result.max_score,
                result.pass_probability
            ].join(' ');

            return normalizeSearchText(searchable).includes(query);
        });
    }, [analytics.results, searchQuery, universityFilter, userFilter]);

    const summary = useMemo(() => {
        const activeUserIds = new Set(filteredResults.map(result => result.user_id).filter(Boolean));
        const rates = filteredResults
            .map(result => result.scoreRate)
            .filter(rate => Number.isFinite(rate));
        const averageRate = rates.length
            ? Math.round((rates.reduce((sum, rate) => sum + rate, 0) / rates.length) * 10) / 10
            : null;
        const newest = filteredResults[0]?.created_at || null;

        return {
            registeredUsers: analytics.users.length,
            activeUsers: activeUserIds.size,
            resultCount: filteredResults.length,
            averageRate,
            newest
        };
    }, [analytics.users.length, filteredResults]);

    return (
        <div className="space-y-5">
            {loadError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-900 shadow-sm">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                            <div className="font-bold text-sm">成績ログの取得でエラーが発生しました</div>
                            <div className="text-xs font-mono text-red-700 mt-1 break-all">{loadError}</div>
                            <div className="text-xs text-red-600 mt-1">
                                ※ Supabase の RLS ポリシー（管理者への exam_results 閲覧許可）が未適用の可能性があります。
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={fetchAnalytics}
                            className="rounded bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 transition"
                        >
                            再試行
                        </button>
                    </div>
                </div>
            )}
            <div className="bg-white rounded-md border-2 border-indigo-100/60 shadow-sm p-4">
                <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_220px_220px_auto] gap-3 items-end">
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em]">期間</span>
                        <select
                            value={days}
                            onChange={(e) => setDays(e.target.value)}
                            className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none focus:border-navy-blue/40 focus:bg-white"
                        >
                            <option value="7">過去7日</option>
                            <option value="30">過去30日</option>
                            <option value="90">過去90日</option>
                            <option value="all">全期間</option>
                        </select>
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em]">検索</span>
                        <input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="ユーザー名・大学・学部・科目・得点で検索"
                            className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none focus:border-navy-blue/40 focus:bg-white"
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em]">ユーザー</span>
                        <select
                            value={userFilter}
                            onChange={(e) => setUserFilter(e.target.value)}
                            className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none focus:border-navy-blue/40 focus:bg-white"
                        >
                            <option value="all">全ユーザー</option>
                            {usersWithResults.map(user => (
                                <option key={user.id} value={user.id}>{user.username || user.id.slice(0, 8)}</option>
                            ))}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em]">大学</span>
                        <select
                            value={universityFilter}
                            onChange={(e) => setUniversityFilter(e.target.value)}
                            className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none focus:border-navy-blue/40 focus:bg-white"
                        >
                            <option value="all">全大学</option>
                            {universityOptions.map(university => (
                                <option key={university} value={university}>{university}</option>
                            ))}
                        </select>
                    </label>
                    <button
                        type="button"
                        onClick={() => {
                            setSearchQuery('');
                            setUserFilter('all');
                            setUniversityFilter('all');
                        }}
                        className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-black text-navy-blue hover:bg-gray-50"
                    >
                        リセット
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {[
                    ['登録者数', `${summary.registeredUsers}人`],
                    ['採点利用者', `${summary.activeUsers}人`],
                    ['採点回数', `${summary.resultCount}回`],
                    ['平均得点率', summary.averageRate === null ? '-' : `${summary.averageRate}%`],
                    ['最新採点', formatDateTime(summary.newest)]
                ].map(([label, value]) => (
                    <div key={label} className="rounded-md border-2 border-indigo-100/60 bg-white p-4 shadow-sm">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-navy-blue/40">{label}</div>
                        <div className="mt-2 text-2xl font-black text-navy-blue">{value}</div>
                    </div>
                ))}
            </div>

            <div className="bg-white/50 backdrop-blur-sm rounded-md p-4 shadow-inner border-2 border-indigo-100/50">
                {loading ? (
                    <div className="flex justify-center my-16">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-navy-blue"></div>
                    </div>
                ) : filteredResults.length === 0 ? (
                    <div className="bg-white rounded-md border border-gray-100 p-10 text-center">
                        <p className="text-gray-500 font-bold">条件に一致する成績ログはありません。</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <div className="flex items-center justify-between text-xs font-bold text-navy-blue/60 mb-2 px-1">
                            <span className="flex items-center gap-1.5">
                                <span className="text-sm">👆</span>
                                各成績行をタップすると、そのユーザーが受け取った採点結果・各問フィードバック画面を確認できます
                            </span>
                        </div>
                        <table className="min-w-full border-separate border-spacing-y-3">
                            <thead>
                                <tr className="text-navy-blue/40 font-black text-[10px] uppercase tracking-[0.2em]">
                                    <th className="px-4 py-2 text-left">日時</th>
                                    <th className="px-4 py-2 text-left">ユーザー</th>
                                    <th className="px-4 py-2 text-left">問題</th>
                                    <th className="px-4 py-2 text-center">得点</th>
                                    <th className="px-4 py-2 text-center">判定</th>
                                    <th className="px-4 py-2 text-left">大問別</th>
                                    <th className="px-4 py-2 text-center">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredResults.map((result) => (
                                    <tr
                                        key={result.id}
                                        onClick={() => handleOpenResult(result)}
                                        className="group transition-all duration-200 cursor-pointer hover:scale-[1.002]"
                                        title="クリックしてこのユーザーの採点フィードバック詳細を表示"
                                    >
                                        <td className="bg-white px-4 py-4 rounded-l-xl border-y-2 border-l-2 border-gray-100 group-hover:border-navy-blue/40 group-hover:bg-indigo-50/20 shadow-sm whitespace-nowrap">
                                            <span className="text-xs font-mono text-gray-500">{formatDateTime(result.created_at)}</span>
                                        </td>
                                        <td className="bg-white px-4 py-4 border-y-2 border-gray-100 group-hover:border-navy-blue/40 group-hover:bg-indigo-50/20 shadow-sm min-w-[180px]">
                                            <div className="flex flex-col">
                                                <span className="font-black text-navy-blue group-hover:text-indigo-600 transition-colors">{result.userName}</span>
                                                <span className="text-[10px] text-gray-400 font-mono">{String(result.user_id || '').slice(0, 8)}...</span>
                                                {(result.userGrade || result.userFirstChoice) && (
                                                    <span className="text-[10px] text-gray-400 font-bold mt-1">
                                                        {[result.userGrade, result.userFirstChoice].filter(Boolean).join(' / ')}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="bg-white px-4 py-4 border-y-2 border-gray-100 group-hover:border-navy-blue/40 group-hover:bg-indigo-50/20 shadow-sm min-w-[320px]">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-black text-navy-blue leading-snug group-hover:text-indigo-600 transition-colors">{getExamTitle(result)}</span>
                                                <span className="text-[10px] text-gray-300 font-mono mt-1"># {result.id}</span>
                                            </div>
                                        </td>
                                        <td className="bg-white px-4 py-4 border-y-2 border-gray-100 group-hover:border-navy-blue/40 group-hover:bg-indigo-50/20 shadow-sm text-center whitespace-nowrap">
                                            <div className="inline-flex flex-col items-center justify-center rounded-lg bg-red-50 px-3 py-1 border border-red-100 group-hover:bg-red-100/70 transition-colors">
                                                <span className="text-sm font-black text-red-700">{formatScore(result)}</span>
                                                <span className="text-[10px] font-bold text-red-400">{result.scoreRate === null ? '-' : `${result.scoreRate}%`}</span>
                                            </div>
                                        </td>
                                        <td className="bg-white px-4 py-4 border-y-2 border-gray-100 group-hover:border-navy-blue/40 group-hover:bg-indigo-50/20 shadow-sm text-center">
                                            <span className="inline-flex min-w-10 items-center justify-center rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-600">
                                                {result.pass_probability || '-'}
                                            </span>
                                        </td>
                                        <td className="bg-white px-4 py-4 border-y-2 border-gray-100 group-hover:border-navy-blue/40 group-hover:bg-indigo-50/20 shadow-sm min-w-[240px]">
                                            <span className="text-xs font-bold text-gray-500">
                                                {summarizeSectionScores(result.section_scores) || '大問別データなし'}
                                            </span>
                                        </td>
                                        <td className="bg-white px-4 py-4 rounded-r-xl border-y-2 border-r-2 border-gray-100 group-hover:border-navy-blue/40 group-hover:bg-indigo-50/20 shadow-sm text-center whitespace-nowrap">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleOpenResult(result);
                                                }}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-navy-blue text-white text-xs font-bold shadow-sm hover:bg-navy-blue/80 hover:shadow transition-all"
                                                title="採点フィードバック画面を開く"
                                            >
                                                <span>詳細</span>
                                                <span>→</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

export default AdminResultAnalytics;
