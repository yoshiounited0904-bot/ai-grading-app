import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAdminExamById, saveAdminExam } from '../services/adminExamService';

const normalizeStructure = (structure) => {
    if (!Array.isArray(structure)) return [];
    const sorted = [...structure].sort((a, b) => (parseInt(a.id) || 0) - (parseInt(b.id) || 0));
    return sorted.map(section => {
        const questions = Array.isArray(section.questions) ? section.questions : [];
        return {
            ...section,
            questions: questions.map(q => {
                let options = q.options;
                if (typeof options === 'string') {
                    options = options.split(',').map(s => s.trim()).filter(Boolean);
                } else if (!Array.isArray(options)) {
                    options = [];
                }
                return {
                    ...q,
                    options,
                    type: q.type || 'selection',
                    correctAnswer: (q.correctAnswer !== undefined && q.correctAnswer !== null && typeof q.correctAnswer !== 'object')
                        ? String(q.correctAnswer)
                        : '',
                    points: q.points !== undefined ? (parseInt(q.points) || 0) : 0,
                };
            })
        };
    });
};

export default function AnswerVerifyPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [fullExamData, setFullExamData] = useState(null);
    const [sections, setSections] = useState([]);
    const [examMeta, setExamMeta] = useState(null);
    const [selectedSectionIdx, setSelectedSectionIdx] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    useEffect(() => {
        const fetch = async () => {
            const { data, error } = await getAdminExamById(id);
            if (error || !data) { alert('データ取得失敗'); navigate('/admin'); return; }
            setExamMeta({ university: data.university, faculty: data.faculty, subject: data.subject, year: data.year });
            setFullExamData(data);
            setSections(normalizeStructure(data.structure));
            setLoading(false);
        };
        fetch();
    }, [id]);

    const updateQuestion = useCallback((sIdx, qIdx, field, value) => {
        setSections(prev => prev.map((sec, si) =>
            si !== sIdx ? sec : {
                ...sec,
                questions: sec.questions.map((q, qi) => qi === qIdx ? { ...q, [field]: value } : q)
            }
        ));
        setIsDirty(true);
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            const { error } = await saveAdminExam({ ...fullExamData, structure: sections });
            if (error) throw error;
            setIsDirty(false);
            setFullExamData(prev => ({ ...prev, structure: sections }));
            alert('保存しました');
        } catch (e) {
            alert('保存失敗: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="text-gray-400 text-sm font-black">読み込み中...</div>
        </div>
    );

    const section = sections[selectedSectionIdx];
    const pdfUrl = section?.answer_pdf_path || null;

    return (
        // 100vh - Navbar(64px) を占有し、内部でflexcolumn
        <div style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Header — 高さ auto、縮まない */}
            <div style={{ flexShrink: 0 }} className="bg-white border-b border-gray-100 px-6 py-3 flex items-center gap-4 shadow-sm">
                <button onClick={() => navigate(`/admin/exam/${id}`)} className="text-gray-400 hover:text-gray-600 text-sm font-black transition-colors">← 編集に戻る</button>
                <div className="h-4 w-px bg-gray-200" />
                <div className="text-sm font-black text-gray-700 flex-1">
                    {examMeta?.university} {examMeta?.faculty} {examMeta?.year}年 {examMeta?.subject} — 解答照合
                </div>
                {isDirty && <span className="text-xs font-black text-amber-500">未保存の変更あり</span>}
                <button
                    onClick={handleSave}
                    disabled={saving || !isDirty}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-black py-2 px-5 rounded-xl text-xs transition-all disabled:opacity-40 shadow-lg shadow-indigo-200"
                >
                    {saving ? '保存中...' : '💾 保存'}
                </button>
            </div>

            {/* Section Tabs — 高さ auto、縮まない */}
            <div style={{ flexShrink: 0 }} className="bg-white border-b border-gray-100 px-6 flex gap-2 overflow-x-auto">
                {sections.map((sec, idx) => (
                    <button
                        key={sec.id || idx}
                        onClick={() => setSelectedSectionIdx(idx)}
                        className={`py-3 px-4 text-xs font-black whitespace-nowrap border-b-2 transition-all ${
                            idx === selectedSectionIdx
                                ? 'border-indigo-600 text-indigo-600'
                                : 'border-transparent text-gray-400 hover:text-gray-600'
                        }`}
                    >
                        {sec.label || `第${idx + 1}問`}
                    </button>
                ))}
            </div>

            {/* Split View — 残りの高さをすべて占有 */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

                {/* Left: 正解データ — 独立してスクロール */}
                <div style={{ width: '50%', height: '100%', overflowY: 'auto' }} className="border-r border-gray-200 bg-white p-6">
                    <div className="mb-4">
                        <h2 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">正解データ</h2>
                        <div className="text-base font-black text-gray-800">{section?.label || `第${selectedSectionIdx + 1}問`}</div>
                        {section?.allocatedPoints > 0 && (
                            <div className="text-xs text-indigo-500 font-black mt-0.5">目標配点: {section.allocatedPoints}点</div>
                        )}
                    </div>

                    {!section?.questions?.length ? (
                        <div className="text-gray-300 text-sm italic">小問データなし</div>
                    ) : (
                        <div className="space-y-2">
                            <div className="bg-indigo-50 rounded-xl p-3 flex gap-6 text-xs font-black text-indigo-700 mb-4">
                                <span>小問数: {section.questions.length}</span>
                                <span>合計配点: {section.questions.reduce((s, q) => s + (parseInt(q.points) || 0), 0)}点</span>
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ minWidth: '520px' }} className="w-full text-xs">
                                    <thead>
                                        <tr className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100">
                                            <th className="text-left pb-2 pr-3 whitespace-nowrap">小問</th>
                                            <th className="text-left pb-2 pr-3 whitespace-nowrap">種別</th>
                                            <th className="text-left pb-2 pr-3 whitespace-nowrap">選択肢</th>
                                            <th className="text-left pb-2 pr-3 whitespace-nowrap text-indigo-600">正解</th>
                                            <th className="text-left pb-2 whitespace-nowrap">配点</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {section.questions.map((q, qIdx) => {
                                            const hasOptions = Array.isArray(q.options) && q.options.length > 0;
                                            const isSelection = ['selection', 'selection_multi'].includes(q.type);
                                            const currentAnswers = String(q.correctAnswer || '').split(',').map(s => s.trim()).filter(Boolean);
                                            const allSelected = hasOptions && q.options.every(opt => currentAnswers.includes(String(opt).trim()));

                                            const toggleOption = (opt) => {
                                                const o = String(opt).trim();
                                                const next = q.type === 'selection'
                                                    ? [o]
                                                    : currentAnswers.includes(o)
                                                        ? currentAnswers.filter(a => a !== o)
                                                        : [...currentAnswers, o];
                                                updateQuestion(selectedSectionIdx, qIdx, 'correctAnswer', next.join(','));
                                                updateQuestion(selectedSectionIdx, qIdx, 'type', next.length > 1 ? 'selection_multi' : 'selection');
                                            };

                                            const toggleAll = () => {
                                                if (allSelected) {
                                                    updateQuestion(selectedSectionIdx, qIdx, 'correctAnswer', '');
                                                    updateQuestion(selectedSectionIdx, qIdx, 'type', 'selection');
                                                } else {
                                                    updateQuestion(selectedSectionIdx, qIdx, 'correctAnswer', q.options.map(o => String(o).trim()).join(','));
                                                    updateQuestion(selectedSectionIdx, qIdx, 'type', 'selection_multi');
                                                }
                                            };

                                            return (
                                                <tr key={q.id || qIdx} className="hover:bg-gray-50/50 transition-colors">
                                                    <td className="py-3 pr-3 font-black text-gray-700 whitespace-nowrap">{q.label || q.id}</td>
                                                    <td className="py-3 pr-3 whitespace-nowrap">
                                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                                                            q.type === 'selection' ? 'bg-blue-50 text-blue-500' :
                                                            q.type === 'selection_multi' ? 'bg-purple-50 text-purple-500' :
                                                            'bg-gray-100 text-gray-400'
                                                        }`}>
                                                            {q.type === 'selection' ? '単一' : q.type === 'selection_multi' ? '複数' : q.type}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 pr-3 text-gray-400 text-[11px] whitespace-nowrap">
                                                        {hasOptions ? q.options.join('・') : <span className="text-gray-200 italic">—</span>}
                                                    </td>
                                                    <td className="py-3 pr-3">
                                                        {isSelection && hasOptions ? (
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex flex-wrap gap-1">
                                                                    {q.options.map(opt => {
                                                                        const o = String(opt).trim();
                                                                        const selected = currentAnswers.includes(o);
                                                                        return (
                                                                            <button key={o} onClick={() => toggleOption(o)}
                                                                                className={`px-2.5 py-1 rounded-lg text-[11px] font-black border transition-all ${
                                                                                    selected ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-400 border-gray-200 hover:border-indigo-300 hover:text-indigo-500'
                                                                                }`}>
                                                                                {o}
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                                <button onClick={toggleAll}
                                                                    className={`text-[9px] font-black px-2 py-0.5 rounded-md transition-all self-start ${
                                                                        allSelected ? 'bg-red-50 text-red-400 hover:bg-red-100' : 'bg-gray-50 text-gray-400 hover:bg-indigo-50 hover:text-indigo-500'
                                                                    }`}>
                                                                    {allSelected ? '全解除' : '全選択'}
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <input type="text" value={q.correctAnswer || ''}
                                                                onChange={e => updateQuestion(selectedSectionIdx, qIdx, 'correctAnswer', e.target.value)}
                                                                className="w-24 p-1.5 rounded-lg border border-gray-200 text-[11px] font-black text-indigo-700 bg-indigo-50/50 focus:bg-white focus:border-indigo-300 outline-none transition-all"
                                                            />
                                                        )}
                                                    </td>
                                                    <td className="py-3">
                                                        <div className="flex items-center gap-1">
                                                            <input type="number" min="0" value={q.points ?? ''}
                                                                onChange={e => updateQuestion(selectedSectionIdx, qIdx, 'points', parseInt(e.target.value) || 0)}
                                                                className="w-14 p-1.5 rounded-lg border border-gray-200 text-[11px] font-black text-gray-700 text-center focus:border-indigo-300 outline-none transition-all"
                                                            />
                                                            <span className="text-[10px] text-gray-400 font-black">点</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right: Answer PDF — iframeがすべて占有 */}
                <div style={{ width: '50%', height: '100%', position: 'relative' }}>
                    {pdfUrl ? (
                        <>
                            <iframe
                                key={pdfUrl}
                                src={pdfUrl}
                                style={{ width: '100%', height: '100%', display: 'block', border: 'none' }}
                                title={`${section?.label} 解答PDF`}
                            />
                            <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
                                className="absolute top-2 right-3 text-[10px] font-black text-white bg-black/40 hover:bg-black/60 px-2 py-1 rounded-lg transition-all backdrop-blur-sm">
                                別タブで開く ↗
                            </a>
                        </>
                    ) : (
                        <div style={{ width: '100%', height: '100%' }} className="flex items-center justify-center text-gray-300 text-sm font-black bg-gray-100">
                            この大問の解答PDFが設定されていません
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
