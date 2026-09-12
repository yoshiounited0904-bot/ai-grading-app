import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import universityBaseData from '../data/universityBaseData.json';
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
        university: item.university || '大学名未設定',
        faculty: item.faculty || '学部未設定',
        year: item.year || '年度未設定',
        subject: item.subject || '科目未設定',
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

        return universityBaseData.map((item) => buildRowStatus(item, examMap.get(makeBaseMatchKey(item))));
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

    const worstRows = useMemo(() => (
        rows
            .filter(row => !row.isComplete)
            .slice()
            .sort((a, b) =>
                String(a.university).localeCompare(String(b.university), 'ja') ||
                Number(b.year || 0) - Number(a.year || 0) ||
                String(a.subject).localeCompare(String(b.subject), 'ja') ||
                String(a.faculty).localeCompare(String(b.faculty), 'ja')
            )
            .slice(0, 12)
    ), [rows]);

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

                <section className="mt-6 bg-white rounded-2xl border border-red-100 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
                        <h2 className="text-base font-black text-navy-blue">未実装データ一覧プレビュー</h2>
                        <span className="text-[10px] font-black text-gray-400">先頭12件</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                                <tr>
                                    <th className="px-4 py-3 text-left">大学</th>
                                    <th className="px-4 py-3 text-left">学部・方式</th>
                                    <th className="px-4 py-3 text-center">年度</th>
                                    <th className="px-4 py-3 text-center">科目</th>
                                    <th className="px-4 py-3 text-left">足りないもの</th>
                                </tr>
                            </thead>
                            <tbody>
                                {worstRows.map((row, index) => (
                                    <tr key={`${row.university}-${row.faculty}-${row.year}-${row.subject}-${index}`} className="border-b border-gray-100">
                                        <td className="px-4 py-3 font-black text-navy-blue whitespace-nowrap">{row.university}</td>
                                        <td className="px-4 py-3 font-bold text-gray-700 min-w-[260px]">{row.faculty}</td>
                                        <td className="px-4 py-3 text-center font-bold whitespace-nowrap">{row.year}</td>
                                        <td className="px-4 py-3 text-center font-bold whitespace-nowrap">{row.subject}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-wrap gap-1">
                                                {row.missingItems.map(item => (
                                                    <span key={item} className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-black text-red-600 border border-red-100">
                                                        {item}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    );
}

export default UniversityDataCoveragePage;
