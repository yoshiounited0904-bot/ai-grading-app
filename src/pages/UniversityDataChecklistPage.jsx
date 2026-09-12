import React, { useEffect, useMemo, useState } from 'react';
import universityBaseData from '../data/universityBaseData.json';
import { buildSnippet } from './AnswerImageSnippetGenerator';
import { getAdminExams, getAdminExamStructureSummaries } from '../services/adminExamService';

const STORAGE_KEY = 'universityDataChecklistStatus.v1';
const DELETED_STORAGE_KEY = 'universityDataChecklistDeleted.v1';

const normalizeText = (value) => String(value || '').toLowerCase().trim();
const normalizeMatchText = (value) => String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[（）()／/・,，、\-_]/g, '')
    .toLowerCase();

const getItemId = (item) => (
    item.id ||
    [item.university, item.year, item.faculty, item.subject].filter(Boolean).join('_')
);

const normalizeStatus = (status) => (
    status === 'created' || status === 'pending' || status === 'uncreated'
        ? status
        : 'uncreated'
);

const STATUS_CONFIG = {
    uncreated: { label: '未作成', rowClass: 'bg-white', buttonClass: 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100' },
    pending: { label: '保留', rowClass: 'bg-amber-50/30', buttonClass: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' },
    created: { label: '作成済', rowClass: 'bg-emerald-50/30', buttonClass: 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200' },
    deleted: { label: '削除済', rowClass: 'bg-gray-100 text-gray-400', buttonClass: 'bg-gray-200 text-gray-500 border-gray-300' }
};

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
        sections,
        sectionCount: sections.length,
        questionCount: questions.length,
        totalPoints,
        hasSectionQuestionFiles: sections.length > 0 && sections.every(section => Boolean(section?.question_pdf_path)),
        hasAnswerImages: sections.length > 0 && sections.every(section => Boolean(section?.answer_pdf_path))
    };
};

function UniversityDataChecklistPage() {
    const [statuses, setStatuses] = useState({});
    const [deletedIds, setDeletedIds] = useState({});
    const [adminExams, setAdminExams] = useState([]);
    const [structureSummaries, setStructureSummaries] = useState({});
    const [loadingCoverage, setLoadingCoverage] = useState(true);
    const [filters, setFilters] = useState({
        university: 'all',
        year: 'all',
        subject: 'all',
        status: 'all',
        coverage: 'all',
        query: ''
    });
    const [copiedId, setCopiedId] = useState('');

    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            setStatuses(saved && typeof saved === 'object' ? saved : {});
        } catch {
            setStatuses({});
        }
        try {
            const savedDeleted = JSON.parse(localStorage.getItem(DELETED_STORAGE_KEY) || '{}');
            setDeletedIds(savedDeleted && typeof savedDeleted === 'object' ? savedDeleted : {});
        } catch {
            setDeletedIds({});
        }
    }, []);

    useEffect(() => {
        const fetchCoverage = async () => {
            setLoadingCoverage(true);
            const [{ data: exams, error: examsError }, { data: summaries, error: summariesError }] = await Promise.all([
                getAdminExams(),
                getAdminExamStructureSummaries()
            ]);

            if (examsError) {
                console.error('Failed to fetch admin exams for checklist:', examsError);
            }
            if (summariesError) {
                console.error('Failed to fetch exam structures for checklist:', summariesError);
            }

            setAdminExams(exams || []);
            setStructureSummaries((summaries || []).reduce((acc, item) => {
                acc[item.id] = item;
                return acc;
            }, {}));
            setLoadingCoverage(false);
        };

        fetchCoverage();
    }, []);

    const examCoverageMap = useMemo(() => {
        const map = new Map();
        adminExams.forEach((exam) => {
            const summary = structureSummaries[exam.id] || {};
            const merged = {
                ...exam,
                structure: summary.structure || []
            };
            map.set(makeExamMatchKey(merged), merged);
        });
        return map;
    }, [adminExams, structureSummaries]);

    const rows = useMemo(() => {
        return [...universityBaseData]
            .map((item) => {
                const id = getItemId(item);
                const matchedExam = examCoverageMap.get(makeBaseMatchKey(item));
                const questionStats = getQuestionStats(matchedExam?.structure || []);
                const expectedMaxScore = Number(item.maxScore ?? item.max_score);
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
                const coverageStatus = !matchedExam
                    ? 'missing'
                    : missingItems.length === 0
                        ? 'complete'
                        : 'partial';
                return {
                    id,
                    university: item.university || '',
                    faculty: item.faculty || '',
                    year: item.year || '',
                    subject: item.subject || '',
                    subjectEn: item.subject_en || '',
                    maxScore: item.maxScore ?? item.max_score ?? '',
                    duration: item.duration ?? item.durationMinutes ?? '',
                    fileName: item.fileName || '',
                    status: deletedIds[id] ? 'deleted' : normalizeStatus(statuses[id]),
                    matchedExamId: matchedExam?.id || '',
                    masterStatus: matchedExam?.master_status || '',
                    isPublished: Boolean(matchedExam?.is_published),
                    savedMaxScore: matchedExam?.max_score ?? '',
                    savedDuration: matchedExam?.duration_minutes ?? '',
                    hasExam: Boolean(matchedExam),
                    hasMainPdf: Boolean(matchedExam?.pdf_path),
                    hasSectionQuestionFiles: questionStats.hasSectionQuestionFiles,
                    hasAnswerImages: questionStats.hasAnswerImages,
                    sectionCount: questionStats.sectionCount,
                    questionCount: questionStats.questionCount,
                    totalPoints: questionStats.totalPoints,
                    pointsMatch,
                    expectedMaxScore,
                    coverageStatus,
                    missingItems
                };
            })
            .sort((a, b) => {
                return String(a.university).localeCompare(String(b.university), 'ja') ||
                    Number(b.year || 0) - Number(a.year || 0) ||
                    String(a.subject).localeCompare(String(b.subject), 'ja') ||
                    String(a.faculty).localeCompare(String(b.faculty), 'ja');
            });
    }, [deletedIds, examCoverageMap, statuses]);

    const options = useMemo(() => {
        const unique = (key) => [...new Set(rows.map(row => row[key]).filter(Boolean))];
        return {
            universities: unique('university'),
            years: unique('year').sort((a, b) => Number(b) - Number(a)),
            subjects: unique('subject')
        };
    }, [rows]);

    const filteredRows = useMemo(() => {
        const query = normalizeText(filters.query);
        return rows.filter((row) => {
            if (row.status === 'deleted' && filters.status !== 'deleted') return false;
            if (filters.university !== 'all' && row.university !== filters.university) return false;
            if (filters.year !== 'all' && String(row.year) !== String(filters.year)) return false;
            if (filters.subject !== 'all' && row.subject !== filters.subject) return false;
            if (filters.status !== 'all' && row.status !== filters.status) return false;
            if (filters.coverage !== 'all' && row.coverageStatus !== filters.coverage) return false;
            if (query) {
                const haystack = normalizeText([
                    row.university,
                    row.faculty,
                    row.year,
                    row.subject,
                    row.fileName,
                    row.id
                ].join(' '));
                if (!haystack.includes(query)) return false;
            }
            return true;
        });
    }, [filters, rows]);

    const stats = useMemo(() => {
        const activeRows = rows.filter(row => row.status !== 'deleted');
        const created = activeRows.filter(row => row.status === 'created').length;
        const pending = activeRows.filter(row => row.status === 'pending').length;
        const deleted = rows.filter(row => row.status === 'deleted').length;
        const complete = activeRows.filter(row => row.coverageStatus === 'complete').length;
        const partial = activeRows.filter(row => row.coverageStatus === 'partial').length;
        const missing = activeRows.filter(row => row.coverageStatus === 'missing').length;
        return {
            total: activeRows.length,
            created,
            pending,
            processed: created + pending,
            uncreated: activeRows.length - created - pending,
            deleted,
            complete,
            partial,
            missing,
            visible: filteredRows.length
        };
    }, [filteredRows.length, rows]);

    const groupedRows = useMemo(() => {
        const universityGroups = filteredRows.reduce((groups, row) => {
            const lastGroup = groups[groups.length - 1];
            if (lastGroup && lastGroup.university === row.university) {
                lastGroup.rows.push(row);
            } else {
                groups.push({ university: row.university || '大学名未設定', rows: [row] });
            }
            return groups;
        }, []);

        return universityGroups.map((group) => {
            const facultyGroups = group.rows.reduce((chunks, row) => {
                const facultyName = row.faculty || '学部・方式未設定';
                let chunk = chunks.find(item => item.faculty === facultyName);
                if (!chunk) {
                    chunk = { faculty: facultyName, rows: [] };
                    chunks.push(chunk);
                }
                chunk.rows.push(row);
                return chunks;
            }, []);

            return {
                ...group,
                facultyGroups
            };
        });
    }, [filteredRows]);

    const saveStatuses = (next) => {
        setStatuses(next);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    };

    const saveDeletedIds = (next) => {
        setDeletedIds(next);
        localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify(next));
    };

    const setRowStatus = (id, status) => {
        if (deletedIds[id]) return;
        const next = {
            ...statuses,
            [id]: status
        };
        saveStatuses(next);
    };

    const setVisibleStatus = (status) => {
        const next = { ...statuses };
        filteredRows.forEach(row => {
            next[row.id] = status;
        });
        saveStatuses(next);
    };

    const resetStatuses = () => {
        if (!window.confirm('作成済み/保留/未作成の手動チェックをすべてリセットしますか？')) return;
        saveStatuses({});
    };

    const deleteRow = (row) => {
        if (!window.confirm(`この大学データをチェック画面から削除しますか？\n\n${row.university} ${row.year}年度 ${row.subject}\n${row.faculty}\n\n※元JSONは削除せず、この画面から非表示にします。削除済フィルタから復元できます。`)) return;
        const nextDeleted = { ...deletedIds, [row.id]: true };
        const nextStatuses = { ...statuses };
        delete nextStatuses[row.id];
        saveStatuses(nextStatuses);
        saveDeletedIds(nextDeleted);
    };

    const deleteVisibleRows = () => {
        const targetRows = filteredRows.filter(row => row.status !== 'deleted');
        if (targetRows.length === 0) {
            alert('削除対象の表示中データがありません。');
            return;
        }
        if (!window.confirm(`表示中の ${targetRows.length} 件をチェック画面から削除しますか？\n※元JSONは削除せず、この画面から非表示にします。`)) return;

        const nextDeleted = { ...deletedIds };
        const nextStatuses = { ...statuses };
        targetRows.forEach(row => {
            nextDeleted[row.id] = true;
            delete nextStatuses[row.id];
        });
        saveStatuses(nextStatuses);
        saveDeletedIds(nextDeleted);
    };

    const hideVisiblePublishedRows = () => {
        const targetRows = filteredRows.filter(row => row.status !== 'deleted' && row.isPublished);
        if (targetRows.length === 0) {
            alert('表示中に公開中のデータはありません。');
            return;
        }
        if (!window.confirm(`表示中の公開中データ ${targetRows.length} 件を非表示にしますか？\n※元JSONやSupabaseの試験データは削除せず、このチェック画面からだけ非表示にします。`)) return;

        const nextDeleted = { ...deletedIds };
        const nextStatuses = { ...statuses };
        targetRows.forEach(row => {
            nextDeleted[row.id] = true;
            delete nextStatuses[row.id];
        });
        saveStatuses(nextStatuses);
        saveDeletedIds(nextDeleted);
    };

    const hideVisiblePendingRows = () => {
        const targetRows = filteredRows.filter(row => row.status === 'pending');
        if (targetRows.length === 0) {
            alert('表示中に保留のデータはありません。');
            return;
        }
        if (!window.confirm(`表示中の保留データ ${targetRows.length} 件を非表示にしますか？\n※元JSONやSupabaseの試験データは削除せず、このチェック画面からだけ非表示にします。`)) return;

        const nextDeleted = { ...deletedIds };
        const nextStatuses = { ...statuses };
        targetRows.forEach(row => {
            nextDeleted[row.id] = true;
            delete nextStatuses[row.id];
        });
        saveStatuses(nextStatuses);
        saveDeletedIds(nextDeleted);
    };

    const hideVisibleCreatedRows = () => {
        const targetRows = filteredRows.filter(row => row.status === 'created');
        if (targetRows.length === 0) {
            alert('表示中に完成のデータはありません。');
            return;
        }
        if (!window.confirm(`表示中の完成データ ${targetRows.length} 件を非表示にしますか？\n※元JSONやSupabaseの試験データは削除せず、このチェック画面からだけ非表示にします。`)) return;

        const nextDeleted = { ...deletedIds };
        const nextStatuses = { ...statuses };
        targetRows.forEach(row => {
            nextDeleted[row.id] = true;
            delete nextStatuses[row.id];
        });
        saveStatuses(nextStatuses);
        saveDeletedIds(nextDeleted);
    };

    const restoreRow = (row) => {
        const nextDeleted = { ...deletedIds };
        delete nextDeleted[row.id];
        saveDeletedIds(nextDeleted);
    };

    const restoreAllDeleted = () => {
        if (stats.deleted === 0) return;
        if (!window.confirm(`削除済み ${stats.deleted} 件をすべて復元しますか？`)) return;
        saveDeletedIds({});
    };

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

    const handleCopySnippetOnly = async (row) => {
        await copySnippet(row);
    };

    const handleCopySnippetAndOpenEditor = async (row) => {
        const editorUrl = `${window.location.origin}/admin/exam/new?baseDataId=${encodeURIComponent(row.id)}`;
        const newTab = window.open(editorUrl, '_blank');
        if (newTab) {
            newTab.opener = null;
        }

        await copySnippet(row);

        if (!newTab) {
            alert('コードはコピーしましたが、新規作成タブを開けませんでした。ポップアップブロックを確認してください。');
        }
    };

    const renderCoverageBadge = (row) => {
        if (row.coverageStatus === 'complete') {
            return <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">完備</span>;
        }
        if (row.coverageStatus === 'partial') {
            return <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-700">不足あり</span>;
        }
        return <span className="inline-flex rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black text-red-600">DBなし</span>;
    };

    const renderCheck = (ok, label) => (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-500'}`}>
            {ok ? '✓' : '×'} {label}
        </span>
    );

    return (
        <div className="min-h-screen bg-indigo-50/30 py-10 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-6">
                    <div>
                        <h1 className="text-3xl font-black text-navy-blue">大学データ作成チェック</h1>
                        <p className="text-sm font-bold text-gray-500 mt-2">
                            Obsidianから読み込む基礎データを、大学・学部・年度・科目ごとに手動確認します。
                        </p>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
                        <div className="bg-white rounded-xl border border-indigo-100 px-4 py-3">
                            <div className="text-[10px] font-black text-gray-400 uppercase">全件</div>
                            <div className="text-xl font-black text-navy-blue">{stats.total}</div>
                        </div>
                        <div className="bg-white rounded-xl border border-indigo-100 px-4 py-3">
                            <div className="text-[10px] font-black text-gray-400 uppercase">表示中</div>
                            <div className="text-xl font-black text-indigo-600">{stats.visible}</div>
                        </div>
                        <div className="bg-white rounded-xl border border-emerald-100 px-4 py-3">
                            <div className="text-[10px] font-black text-gray-400 uppercase">作成済</div>
                            <div className="text-xl font-black text-emerald-600">{stats.created}</div>
                        </div>
                        <div className="bg-white rounded-xl border border-amber-100 px-4 py-3">
                            <div className="text-[10px] font-black text-gray-400 uppercase">保留</div>
                            <div className="text-xl font-black text-amber-600">{stats.pending}</div>
                        </div>
                        <div className="bg-white rounded-xl border border-sky-100 px-4 py-3">
                            <div className="text-[10px] font-black text-gray-400 uppercase">保留＋作成済</div>
                            <div className="text-xl font-black text-sky-600">{stats.processed}</div>
                        </div>
                        <div className="bg-white rounded-xl border border-emerald-100 px-4 py-3">
                            <div className="text-[10px] font-black text-gray-400 uppercase">完備</div>
                            <div className="text-xl font-black text-emerald-600">{stats.complete}</div>
                        </div>
                        <div className="bg-white rounded-xl border border-amber-100 px-4 py-3">
                            <div className="text-[10px] font-black text-gray-400 uppercase">不足あり</div>
                            <div className="text-xl font-black text-amber-600">{stats.partial}</div>
                        </div>
                        <div className="bg-white rounded-xl border border-red-100 px-4 py-3">
                            <div className="text-[10px] font-black text-gray-400 uppercase">DBなし</div>
                            <div className="text-xl font-black text-red-500">{stats.missing}</div>
                        </div>
                        <div className="bg-white rounded-xl border border-red-100 px-4 py-3">
                            <div className="text-[10px] font-black text-gray-400 uppercase">未作成</div>
                            <div className="text-xl font-black text-red-500">{stats.uncreated}</div>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                            <div className="text-[10px] font-black text-gray-400 uppercase">削除済</div>
                            <div className="text-xl font-black text-gray-500">{stats.deleted}</div>
                        </div>
                    </div>
                </div>

                <section className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-5 mb-6">
                    {loadingCoverage && (
                        <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs font-black text-indigo-700">
                            Supabase上の試験マスターと照合中...
                        </div>
                    )}
                    <div className="grid md:grid-cols-6 gap-3">
                        <select
                            value={filters.university}
                            onChange={(e) => updateFilter('university', e.target.value)}
                            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                        >
                            <option value="all">全大学</option>
                            {options.universities.map(value => <option key={value} value={value}>{value}</option>)}
                        </select>
                        <select
                            value={filters.year}
                            onChange={(e) => updateFilter('year', e.target.value)}
                            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                        >
                            <option value="all">全年度</option>
                            {options.years.map(value => <option key={value} value={value}>{value}年度</option>)}
                        </select>
                        <select
                            value={filters.subject}
                            onChange={(e) => updateFilter('subject', e.target.value)}
                            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                        >
                            <option value="all">全科目</option>
                            {options.subjects.map(value => <option key={value} value={value}>{value}</option>)}
                        </select>
                        <select
                            value={filters.status}
                            onChange={(e) => updateFilter('status', e.target.value)}
                            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                        >
                            <option value="all">全ステータス</option>
                            <option value="uncreated">未作成のみ</option>
                            <option value="pending">保留のみ</option>
                            <option value="created">作成済のみ</option>
                            <option value="deleted">削除済のみ</option>
                        </select>
                        <select
                            value={filters.coverage}
                            onChange={(e) => updateFilter('coverage', e.target.value)}
                            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                        >
                            <option value="all">全データ状態</option>
                            <option value="complete">完備のみ</option>
                            <option value="partial">不足ありのみ</option>
                            <option value="missing">DBなしのみ</option>
                        </select>
                        <input
                            value={filters.query}
                            onChange={(e) => updateFilter('query', e.target.value)}
                            placeholder="学部・方式で検索"
                            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-navy-blue outline-none"
                        />
                    </div>
                    <div className="flex flex-wrap gap-2 mt-4">
                        <button
                            onClick={() => setVisibleStatus('created')}
                            className="rounded-lg bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                        >
                            表示中を作成済にする
                        </button>
                        <button
                            onClick={() => setVisibleStatus('pending')}
                            className="rounded-lg bg-amber-50 px-4 py-2 text-xs font-black text-amber-700 border border-amber-200 hover:bg-amber-100"
                        >
                            表示中を保留にする
                        </button>
                        <button
                            onClick={() => setVisibleStatus('uncreated')}
                            className="rounded-lg bg-red-50 px-4 py-2 text-xs font-black text-red-600 border border-red-200 hover:bg-red-100"
                        >
                            表示中を未作成に戻す
                        </button>
                        <button
                            onClick={resetStatuses}
                            className="rounded-lg bg-gray-50 px-4 py-2 text-xs font-black text-gray-500 border border-gray-200 hover:bg-gray-100"
                        >
                            チェックを全リセット
                        </button>
                        <button
                            onClick={deleteVisibleRows}
                            disabled={filters.status === 'deleted'}
                            className="rounded-lg bg-rose-50 px-4 py-2 text-xs font-black text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-40"
                        >
                            表示中を削除
                        </button>
                        <button
                            onClick={hideVisiblePublishedRows}
                            disabled={filters.status === 'deleted'}
                            className="rounded-lg bg-indigo-50 px-4 py-2 text-xs font-black text-indigo-700 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-40"
                        >
                            公開中だけ非表示
                        </button>
                        <button
                            onClick={hideVisiblePendingRows}
                            disabled={filters.status === 'deleted'}
                            className="rounded-lg bg-amber-50 px-4 py-2 text-xs font-black text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-40"
                        >
                            保留だけ非表示
                        </button>
                        <button
                            onClick={hideVisibleCreatedRows}
                            disabled={filters.status === 'deleted'}
                            className="rounded-lg bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-40"
                        >
                            完成だけ非表示
                        </button>
                        <button
                            onClick={restoreAllDeleted}
                            disabled={stats.deleted === 0}
                            className="rounded-lg bg-gray-50 px-4 py-2 text-xs font-black text-gray-600 border border-gray-200 hover:bg-gray-100 disabled:opacity-40"
                        >
                            削除済を全復元
                        </button>
                    </div>
                </section>

                <section className="bg-white rounded-2xl border border-indigo-100 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                                <tr>
                                    <th className="px-4 py-3 text-left">状態</th>
                                    <th className="px-4 py-3 text-left">大学</th>
                                    <th className="px-4 py-3 text-left">学部・方式</th>
                                    <th className="px-4 py-3 text-center">年度</th>
                                    <th className="px-4 py-3 text-center">科目</th>
                                    <th className="px-4 py-3 text-center">満点</th>
                                    <th className="px-4 py-3 text-center">時間</th>
                                    <th className="px-4 py-3 text-center">実データ</th>
                                    <th className="px-4 py-3 text-left">足りないもの</th>
                                    <th className="px-4 py-3 text-center">解答コード</th>
                                    <th className="px-4 py-3 text-center">操作</th>
                                    <th className="px-4 py-3 text-left">ID</th>
                                </tr>
                            </thead>
                            <tbody>
                                {groupedRows.map((group) => {
                                    const createdCount = group.rows.filter(row => row.status === 'created').length;
                                    const pendingCount = group.rows.filter(row => row.status === 'pending').length;
                                    const processedCount = createdCount + pendingCount;
                                    return (
                                        <React.Fragment key={group.university}>
                                            <tr className="bg-navy-blue text-white border-t-4 border-indigo-200">
                                                <td colSpan="12" className="px-4 py-3">
                                                    <div className="flex items-center justify-between gap-4">
                                                        <div className="flex items-center gap-3">
                                                            <span className="inline-block w-1.5 h-6 rounded-full bg-indigo-300"></span>
                                                            <span className="text-sm font-black">{group.university}</span>
                                                        </div>
                                                        <span className="text-[11px] font-black text-indigo-100 whitespace-nowrap">
                                                            保留＋作成済 {processedCount} / {group.rows.length} 件
                                                            <span className="ml-3 text-indigo-200">作成済 {createdCount}・保留 {pendingCount}</span>
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                            {group.facultyGroups.map((facultyGroup) => {
                                                const facultyCreatedCount = facultyGroup.rows.filter(row => row.status === 'created').length;
                                                const facultyPendingCount = facultyGroup.rows.filter(row => row.status === 'pending').length;
                                                const facultyProcessedCount = facultyCreatedCount + facultyPendingCount;
                                                return (
                                                    <React.Fragment key={`${group.university}-${facultyGroup.faculty}`}>
                                                        <tr className="bg-indigo-50 border-t border-b border-indigo-100">
                                                            <td colSpan="12" className="px-4 py-2">
                                                                <div className="flex items-center justify-between gap-4">
                                                                    <div className="flex items-center gap-2 min-w-0">
                                                                        <span className="inline-block w-1 h-4 rounded-full bg-indigo-400"></span>
                                                                        <span className="truncate text-xs font-black text-indigo-900">{facultyGroup.faculty}</span>
                                                                    </div>
                                                                    <span className="text-[10px] font-black text-indigo-500 whitespace-nowrap">
                                                                        保留＋作成済 {facultyProcessedCount} / {facultyGroup.rows.length} 件
                                                                        <span className="ml-2 text-indigo-400">作成済 {facultyCreatedCount}・保留 {facultyPendingCount}</span>
                                                                    </span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                        {facultyGroup.rows.map((row) => (
                                                <tr key={row.id} className={`${STATUS_CONFIG[row.status]?.rowClass || STATUS_CONFIG.uncreated.rowClass} border-b border-gray-100`}>
                                                    <td className="px-4 py-3 whitespace-nowrap">
                                                        <div className="flex items-center gap-1">
                                                            {Object.entries(STATUS_CONFIG).map(([status, config]) => {
                                                                const isActive = row.status === status;
                                                                return (
                                                                    <button
                                                                        key={status}
                                                                        onClick={() => setRowStatus(row.id, status)}
                                                                        className={`min-w-[48px] rounded-full px-2 py-1 text-[9px] font-black border transition-colors ${
                                                                            isActive
                                                                                ? config.buttonClass
                                                                                : 'bg-white text-gray-300 border-gray-100 hover:border-gray-200 hover:text-gray-500'
                                                                        }`}
                                                                    >
                                                                        {config.label}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 font-black text-navy-blue whitespace-nowrap">{row.university}</td>
                                                    <td className="px-4 py-3 font-bold text-gray-700 min-w-[260px]">{row.faculty}</td>
                                                    <td className="px-4 py-3 text-center font-bold whitespace-nowrap">{row.year}</td>
                                                    <td className="px-4 py-3 text-center font-bold whitespace-nowrap">{row.subject}</td>
                                                    <td className="px-4 py-3 text-center font-bold whitespace-nowrap">{row.maxScore || '-'}</td>
                                                    <td className="px-4 py-3 text-center font-bold whitespace-nowrap">{row.duration || '-'}</td>
                                                    <td className="px-4 py-3 text-center min-w-[220px]">
                                                        <div className="flex flex-col items-center gap-2">
                                                            {renderCoverageBadge(row)}
                                                            {row.hasExam && (
                                                                <div className="flex flex-wrap justify-center gap-1">
                                                                    {renderCheck(row.hasMainPdf, '全PDF')}
                                                                    {renderCheck(row.hasSectionQuestionFiles, '大問PDF')}
                                                                    {renderCheck(row.hasAnswerImages, '解答')}
                                                                    {renderCheck(row.questionCount > 0, `${row.questionCount}問`)}
                                                                    {renderCheck(row.pointsMatch, `${row.totalPoints}/${row.savedMaxScore || row.maxScore}点`)}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 min-w-[220px]">
                                                        {row.missingItems.length > 0 ? (
                                                            <div className="flex flex-wrap gap-1">
                                                                {row.missingItems.map(item => (
                                                                    <span key={item} className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-black text-red-600 border border-red-100">
                                                                        {item}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="text-[10px] font-black text-emerald-600">不足なし</span>
                                                        )}
                                                        {row.matchedExamId && (
                                                            <div className="mt-1 text-[9px] font-mono text-gray-300 truncate" title={row.matchedExamId}>
                                                                {row.masterStatus || 'statusなし'} / {row.isPublished ? '公開' : '非公開'}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-center whitespace-nowrap">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <button
                                                                onClick={() => handleCopySnippetOnly(row)}
                                                                disabled={row.status === 'deleted'}
                                                                className={`rounded-lg px-3 py-1.5 text-[10px] font-black border transition-colors ${
                                                                    copiedId === row.id
                                                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                                                        : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                                                                } disabled:opacity-40`}
                                                                title="解答画像保存コードだけをコピーします。新規タブは開きません。"
                                                            >
                                                                {copiedId === row.id ? 'コピー済' : 'コードのみ'}
                                                            </button>
                                                        <button
                                                            onClick={() => handleCopySnippetAndOpenEditor(row)}
                                                            disabled={row.status === 'deleted'}
                                                            className={`rounded-lg px-3 py-1.5 text-[10px] font-black border transition-colors ${
                                                                copiedId === row.id
                                                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                                                    : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                                                            } disabled:opacity-40`}
                                                            title="解答画像保存コードをコピーし、この大学データを入力した新規試験作成タブを開きます。"
                                                        >
                                                            {copiedId === row.id ? 'コピー済' : 'コピー＋新規作成'}
                                                        </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-center whitespace-nowrap">
                                                        {row.status === 'deleted' ? (
                                                            <button
                                                                onClick={() => restoreRow(row)}
                                                                className="rounded-lg bg-white px-3 py-1.5 text-[10px] font-black text-gray-600 border border-gray-200 hover:bg-gray-50"
                                                            >
                                                                復元
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={() => deleteRow(row)}
                                                                className="rounded-lg bg-white px-3 py-1.5 text-[10px] font-black text-rose-600 border border-rose-100 hover:bg-rose-50"
                                                            >
                                                                削除
                                                            </button>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-[10px] font-mono text-gray-400 min-w-[260px]">{row.id}</td>
                                                </tr>
                                                        ))}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    );
}

export default UniversityDataChecklistPage;
