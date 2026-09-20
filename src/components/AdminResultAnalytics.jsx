import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAdminResultAnalytics } from '../services/adminResultAnalyticsService';
import { supabase } from '../services/supabaseClient';

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
    const [roleFilter, setRoleFilter] = useState('all');
    const [userFilter, setUserFilter] = useState('all');
    const [universityFilter, setUniversityFilter] = useState('all');
    const [analytics, setAnalytics] = useState({ users: [], results: [] });
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [openingResultId, setOpeningResultId] = useState(null);

    const handleOpenResult = async (result) => {
        if (openingResultId) return; // Prevent double-clicks
        setOpeningResultId(result.id);
        try {
            // Fetch the heavy payload (answers, weakness_analysis, etc.) here instead of pulling 32MB up front
            const { data: detailedResult, error } = await supabase
                .from('exam_results')
                .select('answers, weakness_analysis, question_feedback, pdf_path')
                .eq('id', result.id)
                .single();

            if (error) throw error;

            navigate('/result', {
                state: {
                    result: {
                        id: result.id,
                        score: result.score,
                        maxScore: result.max_score,
                        passProbability: result.pass_probability,
                        weaknessAnalysis: detailedResult?.weakness_analysis,
                        weakness_analysis: detailedResult?.weakness_analysis,
                        questionFeedback: detailedResult?.question_feedback,
                        question_feedback: detailedResult?.question_feedback,
                        section_scores: result.section_scores,
                        rawScore: detailedResult?.answers?.rawScore,
                        rawMaxScore: detailedResult?.answers?.rawMaxScore,
                        compressedScore: detailedResult?.answers?.compressedScore,
                        compressedMaxScore: detailedResult?.answers?.compressedMaxScore,
                        scoreCompression: detailedResult?.answers?.scoreCompression || null,
                        scoreCap: detailedResult?.answers?.scoreCap || null
                    },
                    universityName: result.university_name,
                    facultyName: result.faculty_name,
                    examSubject: result.exam_subject,
                    examYear: result.exam_year,
                    answers: detailedResult?.answers,
                    pdfPath: detailedResult?.pdf_path || detailedResult?.answers?.pdfPath || null,
                    isNewResult: false,
                    fromAdmin: true
                }
            });
        } catch (err) {
            console.error('Failed to load detailed result:', err);
            alert('成績データの詳細取得に失敗しました。');
        } finally {
            setOpeningResultId(null);
        }
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
            if (roleFilter === 'students' && result.isAdminResult) return false;
            if (roleFilter === 'admin' && !result.isAdminResult) return false;
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
    }, [analytics.results, roleFilter, searchQuery, universityFilter, userFilter]);

    const summary = useMemo(() => {
        const studentUsers = analytics.users.filter(u => u?.role !== 'admin');
        const activeUserIds = new Set(filteredResults.map(result => result.user_id).filter(Boolean));
        const promoVerifiedUsers = analytics.users.filter(u => u?.promo_code_verified).length;
        const rates = filteredResults
            .map(result => result.scoreRate)
            .filter(rate => Number.isFinite(rate));
        const averageRate = rates.length
            ? Math.round((rates.reduce((sum, rate) => sum + rate, 0) / rates.length) * 10) / 10
            : null;
        const newest = filteredResults[0]?.created_at || null;

        return {
            registeredUsers: studentUsers.length || analytics.users.length,
            promoVerifiedUsers,
            activeUsers: activeUserIds.size,
            resultCount: filteredResults.length,
            averageRate,
            newest
        };
    }, [analytics.users, filteredResults]);

    const examUsageStats = useMemo(() => {
        const stats = {};
        filteredResults.forEach(r => {
            const uni = r.university_name || '大学不明';
            const fac = r.faculty_name || '学部不明';
            const year = r.exam_year ? `${r.exam_year}年度` : '';
            const subj = r.exam_subject || '';
            const examKey = [year, subj].filter(Boolean).join(' ');

            if (!stats[uni]) stats[uni] = { total: 0, faculties: {} };
            stats[uni].total++;

            if (!stats[uni].faculties[fac]) stats[uni].faculties[fac] = { total: 0, exams: {} };
            stats[uni].faculties[fac].total++;

            if (examKey) {
                if (!stats[uni].faculties[fac].exams[examKey]) stats[uni].faculties[fac].exams[examKey] = 0;
                stats[uni].faculties[fac].exams[examKey]++;
            }
        });

        // Convert to array and sort by total descending
        return Object.entries(stats)
            .map(([uni, data]) => ({
                university: uni,
                total: data.total,
                faculties: Object.entries(data.faculties)
                    .map(([fac, fData]) => ({
                        faculty: fac,
                        total: fData.total,
                        exams: Object.entries(fData.exams)
                            .map(([exam, count]) => ({ exam, count }))
                            .sort((a, b) => b.count - a.count)
                    }))
                    .sort((a, b) => b.total - a.total)
            }))
            .sort((a, b) => b.total - a.total);
    }, [filteredResults]);

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
                <div className="grid grid-cols-1 md:grid-cols-[130px_130px_1fr_180px_180px_auto] gap-3 items-end">
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
                        <span className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em]">種別</span>
                        <select
                            value={roleFilter}
                            onChange={(e) => setRoleFilter(e.target.value)}
                            className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none focus:border-navy-blue/40 focus:bg-white"
                        >
                            <option value="all">全答案</option>
                            <option value="students">生徒のみ</option>
                            <option value="admin">管理者テスト</option>
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
                                <option key={user.id} value={user.id}>
                                    {user.username || user.id.slice(0, 8)} {user.role === 'admin' ? '(管理者)' : ''}
                                </option>
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
                            setRoleFilter('all');
                            setUserFilter('all');
                            setUniversityFilter('all');
                        }}
                        className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-black text-navy-blue hover:bg-gray-50"
                    >
                        リセット
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                    ['登録者数', `${summary.registeredUsers}人`],
                    ['プロモ入力', `${summary.promoVerifiedUsers}人`],
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

            {/* 問題利用状況の集計 */}
            {examUsageStats.length > 0 && (
                <div className="bg-white rounded-md border-2 border-indigo-100/60 shadow-sm p-4">
                    <div className="text-[10px] font-black text-navy-blue/50 uppercase tracking-[0.18em] mb-4 flex items-center gap-2">
                        <span>解かれている問題の集計（大学・学部別）</span>
                        <span className="text-xs normal-case bg-indigo-50 px-2 py-0.5 rounded text-indigo-700">全{summary.resultCount}回</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {examUsageStats.map(uniStat => (
                            <div key={uniStat.university} className="border border-gray-100 rounded-lg bg-gray-50/50 p-3">
                                <div className="flex items-center justify-between border-b border-gray-200 pb-2 mb-2">
                                    <h3 className="font-black text-navy-blue text-sm">{uniStat.university}</h3>
                                    <span className="bg-navy-blue text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                                        {uniStat.total}回
                                    </span>
                                </div>
                                <div className="space-y-2.5">
                                    {uniStat.faculties.map(facStat => (
                                        <div key={facStat.faculty} className="bg-white rounded border border-gray-100 p-2 shadow-sm">
                                            <div className="flex items-center justify-between mb-1.5">
                                                <div className="text-xs font-bold text-gray-700">{facStat.faculty}</div>
                                                <div className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 rounded">{facStat.total}回</div>
                                            </div>
                                            {facStat.exams.length > 0 && (
                                                <ul className="space-y-1 mt-1 border-t border-gray-50 pt-1.5">
                                                    {facStat.exams.map(exam => (
                                                        <li key={exam.exam} className="flex justify-between items-center text-[10px]">
                                                            <span className="text-gray-500 truncate mr-2" title={exam.exam}>・{exam.exam}</span>
                                                            <span className="text-gray-400 font-mono flex-shrink-0">{exam.count}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

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
                                        className={`group transition-all duration-200 cursor-pointer hover:scale-[1.002] ${openingResultId === result.id ? 'opacity-50 pointer-events-none' : ''}`}
                                        title="クリックしてこのユーザーの採点フィードバック詳細を表示"
                                    >
                                        <td className="bg-white px-4 py-4 rounded-l-xl border-y-2 border-l-2 border-gray-100 group-hover:border-navy-blue/40 group-hover:bg-indigo-50/20 shadow-sm whitespace-nowrap relative">
                                            {openingResultId === result.id && (
                                                <div className="absolute inset-0 flex items-center justify-center bg-white/50 rounded-l-xl">
                                                    <div className="animate-spin h-4 w-4 border-2 border-navy-blue border-t-transparent rounded-full"></div>
                                                </div>
                                            )}
                                            <span className="text-xs font-mono text-gray-500">{formatDateTime(result.created_at)}</span>
                                        </td>
                                        <td className="bg-white px-4 py-4 border-y-2 border-gray-100 group-hover:border-navy-blue/40 group-hover:bg-indigo-50/20 shadow-sm min-w-[180px]">
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="font-black text-navy-blue group-hover:text-indigo-600 transition-colors">{result.userName}</span>
                                                    {result.isAdminResult && (
                                                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                                            管理者テスト
                                                        </span>
                                                    )}
                                                </div>
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
