import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getUniversityList } from '../data/examRegistry';
import { findUniversityMetadataKnowledge, listUniversityMetadataKnowledgeCandidates } from '../data/universityMetadataKnowledge';
import { extractExamMetadata } from '../services/adminGeminiService';
import { geminiQueue } from '../utils/promiseQueue';

function AdminExamLab() {
    const [universitiesData, setUniversitiesData] = useState([]);
    const [questionFiles, setQuestionFiles] = useState([]);
    const [extracting, setExtracting] = useState(false);
    const [metadata, setMetadata] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [copyStatus, setCopyStatus] = useState('');
    const [knowledgeSelection, setKnowledgeSelection] = useState('');

    useEffect(() => {
        getUniversityList().then(data => setUniversitiesData(data || []));
    }, []);

    const findMatches = (result) => {
        const matchedUniversity = universitiesData.find(u => u.name === result.university);
        const matchedFaculty = matchedUniversity?.faculties.find(f => f.name === result.faculty);
        const knowledgeCandidates = listUniversityMetadataKnowledgeCandidates({
            university: result.university,
            year: result.year,
            subject: result.subject,
            subject_en: result.subject_en
        });
        const exactKnowledge = findUniversityMetadataKnowledge({
            university: result.university,
            faculty: result.faculty,
            subject: result.subject,
            year: result.year,
            subject_en: result.subject_en
        });

        return {
            ...result,
            matchedUniversityId: matchedUniversity?.id || null,
            matchedFacultyId: matchedFaculty?.id || null,
            resolvedMaxScore: result.max_score ?? exactKnowledge?.max_score ?? null,
            resolvedDurationMinutes: result.duration_minutes ?? exactKnowledge?.duration_minutes ?? null,
            resolvedPassingLines: exactKnowledge?.passing_lines || null,
            knowledgeMatched: Boolean(exactKnowledge),
            knowledgeNotes: exactKnowledge?.notes || [],
            knowledgeSources: exactKnowledge?.sources || [],
            knowledgeCandidates
        };
    };

    const handleExtract = async () => {
        if (!questionFiles.length) {
            setErrorMessage('先に問題PDFを選択してください。');
            return;
        }

        setExtracting(true);
        setErrorMessage('');

        try {
            const result = await geminiQueue.add(() => extractExamMetadata(questionFiles));
            const matched = findMatches(result);
            setMetadata(matched);
            setKnowledgeSelection(matched.knowledgeCandidates?.[0]?.key || '');
        } catch (error) {
            console.error('Exam lab extraction failed:', error);
            setErrorMessage(error.message || '抽出に失敗しました。');
            setMetadata(null);
        } finally {
            setExtracting(false);
        }
    };

    const buildDraft = (data) => {
        if (!data) return null;

        const passingLines = data.resolvedPassingLines || {};
        const sourceLines = [...new Set([...(data.sources || []), ...(data.knowledgeSources || [])])]
            .filter(Boolean)
            .map((url) => `- URL: ${url}`);
        const notes = [...new Set([...(data.notes || []), ...(data.knowledgeNotes || [])])].filter(Boolean);

        const fileName = [data.university, data.faculty, data.subject]
            .filter(Boolean)
            .join('_')
            .replace(/[\\/:*?"<>|]/g, '_');

        const markdown = [
            `# ${data.university || '{{大学名}}'} ${data.faculty || '{{学部名}}'} ${data.subject || '{{科目名}}'}`,
            '',
            '## 基本情報',
            `- 大学名: ${data.university || ''}`,
            `- 学部名: ${data.faculty || ''}`,
            `- 科目名: ${data.subject || ''}`,
            `- 内部科目ID: ${data.subject_en || ''}`,
            `- 満点: ${data.resolvedMaxScore ?? data.max_score ?? 'null'}`,
            `- 制限時間: ${data.resolvedDurationMinutes ?? data.duration_minutes ?? 'null'}`,
            '',
            '## 合格可能性水準',
            `- 判定A: ${passingLines.A ?? 'null'}`,
            `- 判定B: ${passingLines.B ?? 'null'}`,
            `- 判定C: ${passingLines.C ?? 'null'}`,
            `- 判定D: ${passingLines.D ?? 'null'}`,
            `- 判定E: ${passingLines.E ?? 'null'}`,
            '',
            '## 根拠ソース',
            ...(sourceLines.length > 0 ? sourceLines : ['- URL:']),
            '',
            '## 更新情報',
            `- 更新日: ${data.updatedAt || new Date().toISOString().slice(0, 10)}`,
            `- 調査担当AI: ${data.researchAgent || 'Gemini'}`,
            '',
            '## 備考',
            ...(notes.length > 0 ? notes.map((note) => `- ${note}`) : ['- '])
        ].join('\n');

        return { fileName, markdown };
    };

    const draft = buildDraft(metadata);

    const handleApplyKnowledgeSelection = () => {
        if (!metadata || !knowledgeSelection) return;
        const selectedKnowledge = metadata.knowledgeCandidates?.find((candidate) => candidate.key === knowledgeSelection);
        if (!selectedKnowledge) return;

        setMetadata((prev) => ({
            ...prev,
            faculty: selectedKnowledge.faculty,
            subject: selectedKnowledge.subject,
            subject_en: selectedKnowledge.subject_en,
            resolvedMaxScore: selectedKnowledge.max_score,
            resolvedDurationMinutes: selectedKnowledge.duration_minutes,
            resolvedPassingLines: selectedKnowledge.passing_lines,
            knowledgeMatched: true,
            knowledgeNotes: selectedKnowledge.notes || [],
            knowledgeSources: selectedKnowledge.sources || []
        }));
        setCopyStatus('選択した大学データを適用しました。');
    };

    const handleCopyDraft = async () => {
        if (!draft?.markdown) return;
        try {
            await navigator.clipboard.writeText(draft.markdown);
            setCopyStatus('Markdownをコピーしました。');
        } catch (error) {
            console.error('Failed to copy markdown draft:', error);
            setCopyStatus('コピーに失敗しました。');
        }
    };

    return (
        <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-10">
            <div className="max-w-5xl mx-auto space-y-8">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-black text-navy-blue">基本情報自動入力ラボ</h1>
                        <p className="text-sm text-gray-500 mt-2 font-medium">
                            既存の管理画面とは別に、PDFからの大学名・学部名・年度・科目・満点・制限時間の抽出だけを検証する画面です。
                        </p>
                    </div>
                    <Link to="/admin" className="px-4 py-2 rounded-xl border border-navy-blue/10 bg-white text-navy-blue font-bold shadow-sm hover:bg-gray-50 transition-all">
                        管理一覧へ戻る
                    </Link>
                </div>

                <div className="bg-white rounded-[2rem] border border-indigo-100 shadow-2xl shadow-indigo-100/40 p-8 space-y-6">
                    <div className="space-y-3">
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                            問題PDF
                        </label>
                        <input
                            type="file"
                            accept="application/pdf,image/*"
                            onChange={(e) => setQuestionFiles(Array.from(e.target.files || []))}
                            className="block w-full text-sm text-gray-500 file:mr-4 file:py-3 file:px-5 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-navy-blue file:text-white hover:file:bg-navy-light"
                        />
                        <p className="text-xs text-gray-500">
                            まずは1ファイルで検証する想定です。ローカル選択だけで動き、保存はしません。
                        </p>
                    </div>

                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleExtract}
                            disabled={extracting || !questionFiles.length}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 px-5 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50"
                        >
                            {extracting ? 'AIが抽出中...' : '基本情報を自動抽出'}
                        </button>
                        {questionFiles[0] && (
                            <button
                                onClick={() => window.open(URL.createObjectURL(questionFiles[0]), '_blank')}
                                className="px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-600 font-bold hover:bg-gray-100 transition-all"
                            >
                                PDFを確認
                            </button>
                        )}
                    </div>

                    {metadata?.knowledgeCandidates?.length > 0 && (
                        <div className="rounded-md border border-indigo-100 bg-indigo-50/60 p-5 space-y-4">
                            <div className="text-sm font-black text-navy-blue">参照する大学データを選択</div>
                            <div className="flex flex-col md:flex-row gap-3">
                                <select
                                    value={knowledgeSelection}
                                    onChange={(e) => setKnowledgeSelection(e.target.value)}
                                    className="flex-1 rounded-xl border border-indigo-100 bg-white px-4 py-3 text-sm font-bold text-navy-blue"
                                >
                                    {metadata.knowledgeCandidates.map((candidate) => (
                                        <option key={candidate.key} value={candidate.key}>
                                            {candidate.label}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    onClick={handleApplyKnowledgeSelection}
                                    className="bg-navy-blue hover:bg-navy-light text-white font-black py-3 px-4 rounded-xl shadow transition-all"
                                >
                                    選択した大学データを適用
                                </button>
                            </div>
                        </div>
                    )}

                    {errorMessage && (
                        <div className="rounded-md border border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">
                            {errorMessage}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="bg-white rounded-[2rem] border border-gray-100 shadow-xl shadow-slate-100/50 p-8">
                        <h2 className="text-xl font-black text-navy-blue mb-6">抽出結果</h2>
                        {metadata ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FieldCard label="大学名" value={metadata.university} />
                                <FieldCard label="学部名" value={metadata.faculty} />
                                <FieldCard label="年度" value={metadata.year} />
                                <FieldCard label="科目名" value={metadata.subject} />
                                <FieldCard label="内部科目ID" value={metadata.subject_en} />
                                <FieldCard label="満点" value={metadata.max_score} />
                                <FieldCard label="制限時間" value={metadata.duration_minutes ? `${metadata.duration_minutes}分` : ''} />
                                <FieldCard label="補完後満点" value={metadata.resolvedMaxScore} />
                                <FieldCard label="補完後制限時間" value={metadata.resolvedDurationMinutes ? `${metadata.resolvedDurationMinutes}分` : ''} />
                                <FieldCard label="大学ID候補" value={metadata.matchedUniversityId} />
                                <FieldCard label="学部ID候補" value={metadata.matchedFacultyId} />
                                <FieldCard label="大学データ照合" value={metadata.knowledgeMatched ? '一致あり' : 'なし'} />
                            </div>
                        ) : (
                            <p className="text-sm text-gray-400 font-medium">まだ抽出結果はありません。</p>
                        )}
                    </div>

                    <div className="bg-slate-950 rounded-[2rem] shadow-2xl shadow-slate-200/50 p-8 space-y-6">
                        <h2 className="text-xl font-black text-white mb-6">生JSON</h2>
                        <pre className="text-xs leading-6 text-slate-200 whitespace-pre-wrap break-all overflow-auto min-h-[320px]">
                            {metadata ? JSON.stringify(metadata, null, 2) : '{\n  "status": "waiting"\n}'}
                        </pre>
                        {metadata?.resolvedPassingLines && (
                            <div className="rounded-md bg-slate-900/80 border border-slate-800 p-4">
                                <div className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-3">補完された判定ライン</div>
                                <div className="grid grid-cols-5 gap-2 text-center">
                                    {Object.entries(metadata.resolvedPassingLines).map(([grade, score]) => (
                                        <div key={grade} className="rounded-xl bg-slate-800 px-3 py-2">
                                            <div className="text-[10px] font-black text-slate-400">{grade}</div>
                                            <div className="text-sm font-black text-white">{score}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {metadata?.knowledgeMatched && metadata.knowledgeNotes?.length > 0 && (
                            <div className="rounded-md bg-slate-900/80 border border-slate-800 p-4">
                                <div className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-3">大学データ備考</div>
                                <ul className="space-y-2 text-xs text-slate-200">
                                    {metadata.knowledgeNotes.map((note) => (
                                        <li key={note}>{note}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-white rounded-[2rem] border border-emerald-100 shadow-xl shadow-emerald-100/40 p-8 space-y-6">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <h2 className="text-xl font-black text-navy-blue">大学データ下書き</h2>
                            <p className="text-sm text-gray-500 mt-2 font-medium">
                                抽出結果と大学データ照合結果を使って、Obsidianに置くMarkdown草案を作成します。
                            </p>
                        </div>
                        {draft?.markdown && (
                            <button
                                onClick={handleCopyDraft}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-100 transition-all"
                            >
                                Markdownをコピー
                            </button>
                        )}
                    </div>

                    {copyStatus && (
                        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-bold text-emerald-700">
                            {copyStatus}
                        </div>
                    )}

                    {draft ? (
                        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-6">
                            <div className="rounded-md border border-gray-100 bg-gray-50/70 p-5">
                                <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">保存ファイル名候補</div>
                                <div className="text-sm font-bold text-navy-blue break-all">{draft.fileName}.md</div>
                            </div>
                            <div className="rounded-md bg-slate-950 p-6 shadow-inner">
                                <pre className="text-xs leading-6 text-slate-200 whitespace-pre-wrap break-all overflow-auto min-h-[280px]">
                                    {draft.markdown}
                                </pre>
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-400 font-medium">PDFを解析すると、ここに大学データの下書きが表示されます。</p>
                    )}
                </div>
            </div>
        </div>
    );
}

function FieldCard({ label, value }) {
    return (
        <div className="rounded-md border border-gray-100 bg-gray-50/70 p-4">
            <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">{label}</div>
            <div className="text-sm font-bold text-navy-blue break-words">{value || '未抽出'}</div>
        </div>
    );
}

export default AdminExamLab;
