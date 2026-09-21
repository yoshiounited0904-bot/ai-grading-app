import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import universityBaseData from '../data/universityBaseData.json';
import { buildSnippet } from './AnswerImageSnippetGenerator';
import { getAdminExams, getAdminExamStructureSummaries } from '../services/adminExamService';

const normalizeMatchText = (value) => String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[（）()／/・,，、\-_]/g, '')
    .toLowerCase();

const makeBaseMatchKey = (item) => [
    normalizeMatchText(item.university),
    String(item.year || ''),
    normalizeMatchText(item.faculty),
    normalizeMatchText(item.subject_en || item.subject)
].join('|');

const makeExamMatchKey = (exam) => [
    normalizeMatchText(exam.university),
    String(exam.year || ''),
    normalizeMatchText(exam.faculty),
    normalizeMatchText(exam.subject_en || exam.subject)
].join('|');

const getBaseDataId = (item) => item.id || [
    item.university,
    item.year,
    item.faculty,
    item.subject
].filter(Boolean).join('_');

const MASTER_STATUS_LABELS = {
    incomplete: '未完成',
    completed: '完成',
    verified: '検証済み',
    production: '本番用'
};

const PROGRESS_CONFIG = {
    missing: {
        label: '未生成',
        badge: 'bg-red-50 text-red-600 border-red-100',
        row: 'bg-red-50/20'
    },
    partial: {
        label: '生成途中',
        badge: 'bg-amber-50 text-amber-700 border-amber-100',
        row: 'bg-amber-50/20'
    },
    complete: {
        label: '生成済み',
        badge: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        row: 'bg-white'
    },
    published: {
        label: '公開中',
        badge: 'bg-sky-50 text-sky-700 border-sky-100',
        row: 'bg-sky-50/20'
    },
    production: {
        label: '本番用',
        badge: 'bg-indigo-50 text-indigo-700 border-indigo-100',
        row: 'bg-indigo-50/20'
    }
};

const getProgressKey = (row) => {
    if (!row.hasExam) return 'missing';
    if (row.masterStatus === 'production') return 'production';
    if (row.isPublished) return 'published';
    if (row.isComplete) return 'complete';
    return 'partial';
};

const getQuestionStats = (structure = []) => {
    const sections = Array.isArray(structure) ? structure : [];
    const questions = sections.flatMap(section => Array.isArray(section?.questions) ? section.questions : []);
    const totalPoints = questions.reduce((sum, question) => {
        const points = Number(question?.points);
        return sum + (Number.isFinite(points) ? points : 0);
    }, 0);

    return {
        sectionCount: sections.length,
        questionCount: questions.length,
        totalPoints,
        hasSectionQuestionFiles: sections.length > 0 && sections.every(section => Boolean(section?.question_pdf_path)),
        hasAnswerImages: sections.length > 0 && sections.every(section => Boolean(section?.answer_pdf_path))
    };
};

const buildRowStatus = (item, matchedExam) => {
    const questionStats = getQuestionStats(matchedExam?.structure || []);
    const savedMaxScore = Number(matchedExam?.max_score);
    const hasPointTarget = Number.isFinite(savedMaxScore) && savedMaxScore > 0;
    const pointsMatch = questionStats.questionCount > 0 && hasPointTarget && questionStats.totalPoints === savedMaxScore;
    const missingItems = [];

    if (!matchedExam) {
        missingItems.push('試験マスター');
    } else {
        if (!savedMaxScore) missingItems.push('満点');
        if (!matchedExam.duration_minutes) missingItems.push('制限時間');
        if (!matchedExam.pdf_path) missingItems.push('全体PDF');
        if (!questionStats.hasSectionQuestionFiles) missingItems.push('大問PDF');
        if (!questionStats.hasAnswerImages) missingItems.push('解答画像');
        if (questionStats.questionCount === 0) missingItems.push('問題構造');
        if (questionStats.questionCount > 0 && !pointsMatch) missingItems.push('配点一致');
    }

    return {
        id: getBaseDataId(item),
        university: item.university || '大学名未設定',
        faculty: item.faculty || '学部未設定',
        year: item.year || '年度未設定',
        subject: item.subject || '科目未設定',
        subjectEn: item.subject_en || '',
        expectedMaxScore: item.maxScore || '',
        expectedDuration: item.duration || '',
        matchedExamId: matchedExam?.id || '',
        masterStatus: matchedExam?.master_status || '',
        savedMaxScore: Number.isFinite(savedMaxScore) ? savedMaxScore : '',
        savedDuration: matchedExam?.duration_minutes || '',
        hasMainPdf: Boolean(matchedExam?.pdf_path),
        sectionCount: questionStats.sectionCount,
        questionCount: questionStats.questionCount,
        totalPoints: questionStats.totalPoints,
        pointsMatch,
        hasExam: Boolean(matchedExam),
        isPublished: Boolean(matchedExam?.is_published),
        isComplete: Boolean(matchedExam) && missingItems.length === 0,
        missingItems
    };
};

const aggregateBy = (rows, getKey) => {
    const map = new Map();

    rows.forEach((row) => {
        const key = getKey(row);
        if (!map.has(key)) {
            map.set(key, {
                key,
                total: 0,
                complete: 0,
                unimplemented: 0,
                missingMaster: 0,
                partial: 0,
                published: 0,
                missingItems: {}
            });
        }

        const item = map.get(key);
        item.total += 1;
        if (row.isComplete) item.complete += 1;
        if (row.isPublished) item.published += 1;
        if (!row.isComplete) {
            item.unimplemented += 1;
            if (!row.hasExam) item.missingMaster += 1;
            else item.partial += 1;
            row.missingItems.forEach((missing) => {
                item.missingItems[missing] = (item.missingItems[missing] || 0) + 1;
            });
        }
    });

    return [...map.values()]
        .map(item => ({
            ...item,
            completionRate: item.total > 0 ? Math.round((item.complete / item.total) * 100) : 0
        }))
        .sort((a, b) => b.unimplemented - a.unimplemented || a.key.localeCompare(b.key, 'ja'));
};

const SummaryCard = ({ label, value, tone = 'navy', sub }) => {
    const toneClass = {
        navy: 'text-navy-blue border-indigo-100',
        red: 'text-red-600 border-red-100',
        amber: 'text-amber-600 border-amber-100',
        emerald: 'text-emerald-600 border-emerald-100',
        indigo: 'text-indigo-600 border-indigo-100'
    }[tone] || 'text-navy-blue border-indigo-100';

    return (
        <div className={`bg-white rounded-2xl border ${toneClass} px-5 py-4 shadow-sm`}>
            <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{label}</div>
            <div className={`mt-2 text-3xl font-black ${toneClass.split(' ')[0]}`}>{value}</div>
            {sub && <div className="mt-1 text-[11px] font-bold text-gray-400">{sub}</div>}
        </div>
    );
};

const AggregationTable = ({ title, rows, detailLabel }) => (
    <section className="bg-white rounded-2xl border border-indigo-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
            <h2 className="text-base font-black text-navy-blue">{title}</h2>
            <span className="rounded-full bg-red-50 px-3 py-1 text-[10px] font-black text-red-600">
                未実装順
            </span>
        </div>
        <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                    <tr>
                        <th className="px-4 py-3 text-left">{detailLabel}</th>
                        <th className="px-4 py-3 text-center">未実装</th>
                        <th className="px-4 py-3 text-center">DBなし</th>
                        <th className="px-4 py-3 text-center">不足あり</th>
                        <th className="px-4 py-3 text-center">完備</th>
                        <th className="px-4 py-3 text-center">進捗</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => (
                        <tr key={row.key} className="border-b border-gray-100 hover:bg-indigo-50/30">
                            <td className="px-4 py-3 font-black text-navy-blue min-w-[180px]">{row.key}</td>
                            <td className="px-4 py-3 text-center">
                                <span className="inline-flex min-w-[44px] justify-center rounded-full bg-red-50 px-3 py-1 text-xs font-black text-red-600">
                                    {row.unimplemented}
                                </span>
                            </td>
                            <td className="px-4 py-3 text-center font-bold text-red-500">{row.missingMaster}</td>
                            <td className="px-4 py-3 text-center font-bold text-amber-600">{row.partial}</td>
                            <td className="px-4 py-3 text-center font-bold text-emerald-600">{row.complete}</td>
                            <td className="px-4 py-3 min-w-[150px]">
                                <div className="flex items-center gap-2">
                                    <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
                                        <div
                                            className="h-full rounded-full bg-emerald-500"
                                            style={{ width: `${row.completionRate}%` }}
                                        />
                                    </div>
                                    <span className="w-10 text-right text-[10px] font-black text-gray-500">{row.completionRate}%</span>
                                </div>
                            </td>
                        </tr>
                    ))}
                    {rows.length === 0 && (
                        <tr>
                            <td colSpan="6" className="px-4 py-10 text-center text-xs font-bold text-gray-400">
                                表示できるデータがありません。
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    </section>
);

function UniversityDataCoveragePage() {
    const [adminExams, setAdminExams] = useState([]);
    const [structureSummaries, setStructureSummaries] = useState({});
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const [copiedId, setCopiedId] = useState('');
    const [filters, setFilters] = useState({
        university: 'all',
        year: 'all',
        subject: 'all',
        progress: 'all',
        query: ''
    });

    useEffect(() => {
        const fetchCoverage = async () => {
            setLoading(true);
            setErrorMessage('');
            const [{ data: exams, error: examsError }, { data: summaries, error: summariesError }] = await Promise.all([
                getAdminExams(),
                getAdminExamStructureSummaries()
            ]);

            if (examsError || summariesError) {
                console.error('Failed to fetch coverage data:', examsError || summariesError);
                setErrorMessage('Supabase上の試験データ取得に失敗しました。');
            }

            setAdminExams(exams || []);
            setStructureSummaries((summaries || []).reduce((acc, item) => {
                acc[item.id] = item;
                return acc;
            }, {}));
            setLoading(false);
        };

        fetchCoverage();
    }, []);

    const rows = useMemo(() => {
        const examMap = new Map();
        adminExams.forEach((exam) => {
            const summary = structureSummaries[exam.id] || {};
            const merged = { ...exam, structure: summary.structure || [] };
            examMap.set(makeExamMatchKey(merged), merged);
        });

        return universityBaseData.map((item) => {
            const row = buildRowStatus(item, examMap.get(makeBaseMatchKey(item)));
            return {
                ...row,
                progressKey: getProgressKey(row)
            };
        });
    }, [adminExams, structureSummaries]);

    const summary = useMemo(() => {
        const complete = rows.filter(row => row.isComplete).length;
        const unimplemented = rows.length - complete;
        const missingMaster = rows.filter(row => !row.hasExam).length;
        const partial = rows.filter(row => row.hasExam && !row.isComplete).length;
        return {
            total: rows.length,
            complete,
            unimplemented,
            missingMaster,
            partial,
            completionRate: rows.length > 0 ? Math.round((complete / rows.length) * 100) : 0
        };
    }, [rows]);

    const aggregations = useMemo(() => ({
        years: aggregateBy(rows, row => `${row.year}年度`),
        universities: aggregateBy(rows, row => row.university),
        faculties: aggregateBy(rows, row => `${row.university} / ${row.faculty}`),
        subjects: aggregateBy(rows, row => row.subject)
    }), [rows]);

    const filterOptions = useMemo(() => ({
        universities: [...new Set(rows.map(row => row.university))].sort((a, b) => a.localeCompare(b, 'ja')),
        years: [...new Set(rows.map(row => row.year))].sort((a, b) => Number(b) - Number(a)),
        subjects: [...new Set(rows.map(row => row.subject))].sort((a, b) => a.localeCompare(b, 'ja'))
    }), [rows]);

    const filteredRows = useMemo(() => {
        const query = normalizeMatchText(filters.query);
        return rows
            .filter(row => filters.university === 'all' || row.university === filters.university)
            .filter(row => filters.year === 'all' || String(row.year) === String(filters.year))
            .filter(row => filters.subject === 'all' || row.subject === filters.subject)
            .filter(row => filters.progress === 'all' || row.progressKey === filters.progress)
            .filter(row => {
                if (!query) return true;
                return [
                    row.university,
                    row.faculty,
                    row.year,
                    row.subject,
                    row.subjectEn,
                    row.id,
                    row.matchedExamId
                ].some(value => normalizeMatchText(value).includes(query));
            })
            .sort((a, b) =>
                Number(b.year || 0) - Number(a.year || 0) ||
                String(a.university).localeCompare(String(b.university), 'ja') ||
                String(a.subject).localeCompare(String(b.subject), 'ja') ||
                String(a.faculty).localeCompare(String(b.faculty), 'ja')
            );
    }, [filters, rows]);

    const updateFilter = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const copySnippet = async (row) => {
        const snippet = buildSnippet({
            university: row.university,
            faculty: row.faculty,
            year: row.year,
            subject: row.subject
        });
        await navigator.clipboard.writeText(snippet);
        setCopiedId(row.id);
        window.setTimeout(() => setCopiedId(''), 1600);
    };

    const handleCopyAndCreate = async (row) => {
        const editorUrl = `${window.location.origin}/admin/exam/new?baseDataId=${encodeURIComponent(row.id)}`;
        const newTab = window.open(editorUrl, '_blank');
        if (newTab) newTab.opener = null;
        await copySnippet(row);
        if (!newTab) {
            alert('コードはコピーしましたが、新規作成タブを開けませんでした。ポップアップブロックを確認してください。');
        }
    };

    const renderProgressBadge = (row) => {
        const config = PROGRESS_CONFIG[row.progressKey] || PROGRESS_CONFIG.partial;
        return (
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${config.badge}`}>
                {config.label}
            </span>
        );
    };

    return (
        <div className="min-h-screen bg-indigo-50/30 py-10 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-6">
                    <div>
                        <h1 className="text-3xl font-black text-navy-blue">未実装データ可視化</h1>
                        <p className="text-sm font-bold text-gray-500 mt-2">
                            Obsidian基礎データに対して、試験データ作成が不足している数を年度・大学・学部・科目別に集計します。
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link
                            to="/admin/university-data-checklist"
                            className="rounded-lg bg-white px-4 py-2 text-xs font-black text-indigo-700 border border-indigo-200 hover:bg-indigo-50"
                        >
                            詳細チェックへ
                        </Link>
                        <Link
                            to="/admin"
                            className="rounded-lg bg-navy-blue px-4 py-2 text-xs font-black text-white hover:bg-navy-light"
                        >
                            管理者ページへ
                        </Link>
                    </div>
                </div>

                {loading && (
                    <div className="mb-6 rounded-2xl border border-indigo-100 bg-white px-5 py-4 text-xs font-black text-indigo-700 shadow-sm">
                        Supabase上の試験データと照合中...
                    </div>
                )}
                {errorMessage && (
                    <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-xs font-black text-red-600">
                        {errorMessage}
                    </div>
                )}

                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
                    <SummaryCard label="対象データ" value={summary.total} sub="Obsidian基礎データ" />
                    <SummaryCard label="未実装" value={summary.unimplemented} tone="red" sub="DBなし＋不足あり" />
                    <SummaryCard label="DBなし" value={summary.missingMaster} tone="red" sub="試験マスター未作成" />
                    <SummaryCard label="不足あり" value={summary.partial} tone="amber" sub="PDF・構造・配点など" />
                    <SummaryCard label="完備率" value={`${summary.completionRate}%`} tone="emerald" sub={`${summary.complete}件 完備`} />
                </div>

                <div className="grid xl:grid-cols-2 gap-6">
                    <AggregationTable title="年度別" detailLabel="年度" rows={aggregations.years} />
                    <AggregationTable title="大学別" detailLabel="大学" rows={aggregations.universities} />
                    <AggregationTable title="科目別" detailLabel="科目" rows={aggregations.subjects} />
                    <AggregationTable title="学部別" detailLabel="大学 / 学部・方式" rows={aggregations.faculties} />
                </div>

                <section className="mt-6 bg-white rounded-2xl border border-indigo-100 shadow-sm overflow-hidden">
                    <div className="border-b border-gray-100 px-5 py-4">
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                            <div>
                                <h2 className="text-base font-black text-navy-blue">Obsidian取込データ一覧</h2>
                                <p className="mt-1 text-xs font-bold text-gray-500">
                                    Obsidianから取り込んだ基礎データをDB上の試験データと照合し、生成状況を表示します。
                                </p>
                            </div>
                            <span className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-black text-indigo-700">
                                表示 {filteredRows.length} / {rows.length} 件
                            </span>
                        </div>
                        <div className="mt-4 grid md:grid-cols-5 gap-3">
                            <select
                                value={filters.university}
                                onChange={(e) => updateFilter('university', e.target.value)}
                                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                            >
                                <option value="all">全大学</option>
                                {filterOptions.universities.map(value => <option key={value} value={value}>{value}</option>)}
                            </select>
                            <select
                                value={filters.year}
                                onChange={(e) => updateFilter('year', e.target.value)}
                                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                            >
                                <option value="all">全年度</option>
                                {filterOptions.years.map(value => <option key={value} value={value}>{value}年度</option>)}
                            </select>
                            <select
                                value={filters.subject}
                                onChange={(e) => updateFilter('subject', e.target.value)}
                                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                            >
                                <option value="all">全科目</option>
                                {filterOptions.subjects.map(value => <option key={value} value={value}>{value}</option>)}
                            </select>
                            <select
                                value={filters.progress}
                                onChange={(e) => updateFilter('progress', e.target.value)}
                                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                            >
                                <option value="all">全進捗</option>
                                {Object.entries(PROGRESS_CONFIG).map(([key, config]) => (
                                    <option key={key} value={key}>{config.label}</option>
                                ))}
                            </select>
                            <input
                                value={filters.query}
                                onChange={(e) => updateFilter('query', e.target.value)}
                                placeholder="大学・学部・ID検索"
                                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                            />
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                                <tr>
                                    <th className="px-4 py-3 text-left">進捗</th>
                                    <th className="px-4 py-3 text-left">大学</th>
                                    <th className="px-4 py-3 text-left">学部・方式</th>
                                    <th className="px-4 py-3 text-center">年度</th>
                                    <th className="px-4 py-3 text-center">科目</th>
                                    <th className="px-4 py-3 text-center">基礎値</th>
                                    <th className="px-4 py-3 text-center">DB状態</th>
                                    <th className="px-4 py-3 text-left">足りないもの</th>
                                    <th className="px-4 py-3 text-center">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRows.map((row) => {
                                    const config = PROGRESS_CONFIG[row.progressKey] || PROGRESS_CONFIG.partial;
                                    return (
                                    <tr key={row.id} className={`border-b border-gray-100 hover:bg-indigo-50/30 ${config.row}`}>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <div className="flex flex-col gap-1">
                                                {renderProgressBadge(row)}
                                                {row.masterStatus && (
                                                    <span className="text-[9px] font-black text-gray-400">
                                                        {MASTER_STATUS_LABELS[row.masterStatus] || row.masterStatus}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 font-black text-navy-blue whitespace-nowrap">{row.university}</td>
                                        <td className="px-4 py-3 font-bold text-gray-700 min-w-[260px]">{row.faculty}</td>
                                        <td className="px-4 py-3 text-center font-bold whitespace-nowrap">{row.year}</td>
                                        <td className="px-4 py-3 text-center font-bold whitespace-nowrap">{row.subject}</td>
                                        <td className="px-4 py-3 text-center whitespace-nowrap">
                                            <div className="text-[10px] font-black text-gray-500">
                                                {row.expectedMaxScore || '-'}点 / {row.expectedDuration || '-'}分
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-center min-w-[180px]">
                                            {row.hasExam ? (
                                                <div className="flex flex-col items-center gap-1">
                                                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${row.isPublished ? 'bg-sky-50 text-sky-700' : 'bg-gray-50 text-gray-500'}`}>
                                                        {row.isPublished ? '公開中' : '非公開'}
                                                    </span>
                                                    <span className="text-[9px] font-bold text-gray-400">
                                                        {row.questionCount}問 / {row.totalPoints || 0}点
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-[10px] font-black text-red-500">DB未作成</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 min-w-[220px]">
                                            <div className="flex flex-wrap gap-1">
                                                {row.missingItems.length > 0 ? row.missingItems.map(item => (
                                                    <span key={item} className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-black text-red-600 border border-red-100">
                                                        {item}
                                                    </span>
                                                )) : (
                                                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black text-emerald-700 border border-emerald-100">
                                                        不足なし
                                                    </span>
                                                )}
                                            </div>
                                            {row.matchedExamId && (
                                                <div className="mt-1 max-w-[220px] truncate text-[9px] font-mono text-gray-300" title={row.matchedExamId}>
                                                    {row.matchedExamId}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center whitespace-nowrap">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => copySnippet(row)}
                                                    className={`rounded-lg px-3 py-1.5 text-[10px] font-black border transition-colors ${
                                                        copiedId === row.id
                                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                                            : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                                                    }`}
                                                >
                                                    {copiedId === row.id ? 'コピー済' : 'コピー'}
                                                </button>
                                                <button
                                                    onClick={() => handleCopyAndCreate(row)}
                                                    className={`rounded-lg px-3 py-1.5 text-[10px] font-black border transition-colors ${
                                                        copiedId === row.id
                                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                                            : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                                                    }`}
                                                >
                                                    コピー＋新規作成
                                                </button>
                                                {row.matchedExamId && (
                                                    <Link
                                                        to={`/admin/exam/${row.matchedExamId}`}
                                                        className="rounded-lg bg-white px-3 py-1.5 text-[10px] font-black text-gray-600 border border-gray-200 hover:bg-gray-50"
                                                    >
                                                        編集
                                                    </Link>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                    );
                                })}
                                {filteredRows.length === 0 && (
                                    <tr>
                                        <td colSpan="9" className="px-4 py-10 text-center text-xs font-bold text-gray-400">
                                            条件に一致するObsidian取込データがありません。
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    );
}

export default UniversityDataCoveragePage;
