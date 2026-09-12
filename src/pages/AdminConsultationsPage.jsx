import React, { useEffect, useState } from 'react';
import { deleteConsultationRequest, getConsultationRequests, updateConsultationRequest } from '../services/consultationService';

const STATUS_OPTIONS = [
    ['new', '新規'],
    ['contacted', '連絡済み'],
    ['scheduled', '日程確定'],
    ['completed', '実施済み'],
    ['converted', '入塾'],
    ['closed', '見送り']
];

const AdminConsultationsPage = () => {
    const [requests, setRequests] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const selected = requests.find(item => item.id === selectedId) || requests[0] || null;
    const selectedChatSummary = selected?.chat_summary || selected?.consultation_context?.chatSummary || '';
    const selectedChatHistory = selected?.chat_history || selected?.consultation_context?.chatHistory || null;
    const selectedSectionFocus = selected?.section_focus || selected?.consultation_context?.sectionFocus || null;

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const { data, error } = await getConsultationRequests();
                if (error) throw error;
                setRequests(data || []);
                if (data?.[0]?.id) setSelectedId(data[0].id);
            } catch (err) {
                console.error('Failed to load consultations:', err);
                alert('カウンセリング申込の取得に失敗しました。');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const updateSelected = async (updates) => {
        if (!selected) return;
        setSaving(true);
        try {
            const { data, error } = await updateConsultationRequest(selected.id, updates);
            if (error) throw error;
            setRequests(prev => prev.map(item => item.id === selected.id ? { ...item, ...data } : item));
        } catch (err) {
            console.error('Failed to update consultation:', err);
            alert('更新に失敗しました。');
        } finally {
            setSaving(false);
        }
    };

    const deleteSelected = async () => {
        if (!selected) return;
        const ok = window.confirm(`${selected.student_name || '選択中の申込'} のカウンセリング申込を削除します。\nこの操作は元に戻せません。`);
        if (!ok) return;

        setSaving(true);
        try {
            const { error } = await deleteConsultationRequest(selected.id);
            if (error) throw error;
            setRequests(prev => {
                const next = prev.filter(item => item.id !== selected.id);
                setSelectedId(next[0]?.id || null);
                return next;
            });
        } catch (err) {
            console.error('Failed to delete consultation:', err);
            alert(`削除に失敗しました。${err?.message ? `\n${err.message}` : ''}`);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="container" style={{ padding: '2rem' }}>読み込み中...</div>;
    }

    return (
        <div className="container" style={{ maxWidth: '1400px', paddingBottom: '4rem' }}>
            <header style={{ margin: '1.5rem 0 2rem' }}>
                <h1 style={{ marginBottom: '0.5rem' }}>無料カウンセリング申込</h1>
                <p style={{ color: 'var(--color-text-secondary)' }}>診断結果・答案・LINE照合情報を確認します。</p>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)', gap: '1.5rem', alignItems: 'start' }}>
                <aside className="glass-panel" style={{ padding: '1rem', maxHeight: '78vh', overflowY: 'auto' }}>
                    {requests.length === 0 ? (
                        <p style={{ color: 'var(--color-text-secondary)' }}>申込はまだありません。</p>
                    ) : requests.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedId(item.id)}
                            style={{
                                width: '100%',
                                textAlign: 'left',
                                padding: '0.9rem',
                                marginBottom: '0.6rem',
                                borderRadius: '2px',
                                border: selected?.id === item.id ? '2px solid #2563eb' : '1px solid #e2e8f0',
                                background: selected?.id === item.id ? '#eff6ff' : '#fff',
                                cursor: 'pointer'
                            }}
                        >
                            <div style={{ fontWeight: 900, color: '#0f172a' }}>{item.student_name}</div>
                            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.25rem' }}>
                                {item.university_name} {item.exam_subject} / {item.score ?? '-'}点 / {item.pass_probability || '-'}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: '#2563eb', fontWeight: 800, marginTop: '0.35rem' }}>
                                {STATUS_OPTIONS.find(([key]) => key === item.status)?.[1] || item.status} / {item.line_match_code}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: item.chat_summary || item.chat_history || item.consultation_context?.chatSummary ? '#16a34a' : '#94a3b8', fontWeight: 800, marginTop: '0.25rem' }}>
                                {item.chat_summary || item.chat_history || item.consultation_context?.chatSummary ? 'AIチャット履歴あり' : 'AIチャット履歴なし'}
                            </div>
                        </button>
                    ))}
                </aside>

                {selected && (
                    <main style={{ display: 'grid', gap: '1.25rem' }}>
                        <section className="glass-panel" style={{ padding: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                                <div>
                                    <h2 style={{ margin: '0 0 0.35rem' }}>{selected.student_name}</h2>
                                    <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>{selected.grade || '-'} / {selected.preferred_method === 'zoom_no_camera' ? 'Zoom（顔出しなし）' : 'LINE'}</p>
                                </div>
                                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <select value={selected.status || 'new'} onChange={e => updateSelected({ status: e.target.value })} disabled={saving} style={inputStyle}>
                                        {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                    </select>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 800 }}>
                                        <input type="checkbox" checked={Boolean(selected.line_matched)} onChange={e => updateSelected({ line_matched: e.target.checked })} disabled={saving} />
                                        LINE照合済み
                                    </label>
                                    <button
                                        type="button"
                                        onClick={deleteSelected}
                                        disabled={saving}
                                        style={{
                                            padding: '0.65rem 0.85rem',
                                            border: '1px solid #fecaca',
                                            background: '#fef2f2',
                                            color: '#b91c1c',
                                            fontSize: '0.8rem',
                                            fontWeight: 900,
                                            cursor: saving ? 'not-allowed' : 'pointer'
                                        }}
                                    >
                                        削除
                                    </button>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                                <Info label="LINE表示名" value={selected.line_display_name} />
                                <Info label="メール" value={selected.email} />
                                <Info label="希望1" value={selected.preferred_time_1} />
                                <Info label="希望2" value={selected.preferred_time_2} />
                                <Info label="希望3" value={selected.preferred_time_3} />
                                <Info label="照合コード" value={selected.line_match_code} />
                            </div>
                        </section>

                        <section className="glass-panel" style={{ padding: '1.5rem' }}>
                            <h3 style={{ marginBottom: '0.75rem' }}>LINE照合メッセージ</h3>
                            <textarea readOnly value={selected.line_match_message || ''} style={{ ...inputStyle, minHeight: '130px' }} />
                            <button className="btn btn-secondary" type="button" onClick={() => navigator.clipboard.writeText(selected.line_match_message || '')} style={{ marginTop: '0.75rem' }}>
                                文面をコピー
                            </button>
                        </section>

                        <section className="glass-panel" style={{ padding: '1.5rem', border: '1px solid #bfdbfe', background: '#eff6ff' }}>
                            <h3 style={{ marginBottom: '0.75rem', color: '#1d4ed8' }}>AIチャット履歴</h3>
                            {selectedChatSummary ? (
                                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, background: '#fff', border: '1px solid #dbeafe', padding: '0.9rem' }}>
                                    {selectedChatSummary}
                                </div>
                            ) : (
                                <div style={{ background: '#fff', border: '1px solid #dbeafe', padding: '0.9rem', color: '#64748b', lineHeight: 1.7 }}>
                                    この申込にはAIチャット履歴が保存されていません。<br />
                                    結果画面でAIアシスタントに質問した後、無料カウンセリングを申し込むとここに表示されます。
                                </div>
                            )}
                            {selectedChatHistory && (
                                <details style={{ marginTop: '0.75rem', background: '#fff', border: '1px solid #dbeafe', padding: '0.8rem' }}>
                                    <summary style={{ cursor: 'pointer', fontWeight: 900, color: '#1d4ed8' }}>JSONで確認</summary>
                                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.78rem', overflowX: 'auto' }}>{JSON.stringify(selectedChatHistory, null, 2)}</pre>
                                </details>
                            )}
                        </section>

                        <section className="glass-panel" style={{ padding: '1.5rem' }}>
                            <h3 style={{ marginBottom: '0.75rem' }}>診断・答案</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                <Info label="大学" value={selected.university_name} />
                                <Info label="学部" value={selected.faculty_name} />
                                <Info label="科目" value={selected.exam_subject} />
                                <Info label="得点" value={`${selected.score ?? '-'} / ${selected.max_score ?? '-'}点`} />
                                <Info label="判定" value={selected.pass_probability} />
                                <Info label="要確認問題" value={selected.wrong_question_count !== null ? `${selected.wrong_question_count}問` : '-'} />
                            </div>
                            <TextBlock title="相談内容" text={selected.consultation_message} />
                            <JsonBlock title="大問相談情報" value={selectedSectionFocus} />
                            <TextBlock title="弱点要約" text={selected.weakness_summary} />
                            <ExamResultPreview result={selected.exam_results} />
                        </section>

                        <section className="glass-panel" style={{ padding: '1.5rem' }}>
                            <h3 style={{ marginBottom: '0.75rem' }}>管理者メモ</h3>
                            <textarea
                                defaultValue={selected.admin_memo || ''}
                                onBlur={e => updateSelected({ admin_memo: e.target.value })}
                                style={{ ...inputStyle, minHeight: '140px' }}
                                placeholder="面談前メモ、連絡状況、提案内容など"
                            />
                        </section>
                    </main>
                )}
            </div>
        </div>
    );
};

const Info = ({ label, value }) => (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '0.75rem', borderRadius: '2px' }}>
        <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 900, marginBottom: '0.2rem' }}>{label}</div>
        <div style={{ fontWeight: 800, color: '#0f172a', wordBreak: 'break-word' }}>{value || '-'}</div>
    </div>
);

const TextBlock = ({ title, text }) => {
    if (!text) return null;
    return (
        <div style={{ marginTop: '1rem' }}>
            <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 900, marginBottom: '0.35rem' }}>{title}</div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.9rem' }}>{text}</div>
        </div>
    );
};

const JsonBlock = ({ title, value }) => {
    if (!value) return null;
    return (
        <div style={{ marginTop: '1rem' }}>
            <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 900, marginBottom: '0.35rem' }}>{title}</div>
            <pre style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.9rem', fontSize: '0.78rem', overflowX: 'auto' }}>
                {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
            </pre>
        </div>
    );
};

const ExamResultPreview = ({ result }) => {
    if (!result) {
        return <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '1rem' }}>紐づく採点結果が見つかりません。</p>;
    }

    const feedback = result.question_feedback || [];
    const answers = result.answers?.items || result.answers || [];

    return (
        <div style={{ marginTop: '1rem', display: 'grid', gap: '1rem' }}>
            <TextBlock title="保存済み弱点分析" text={result.weakness_analysis} />
            <details open style={{ border: '1px solid #e2e8f0', background: '#fff', padding: '0.9rem' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 900 }}>小問別フィードバック（{feedback.length}件）</summary>
                <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.8rem' }}>
                    {feedback.slice(0, 30).map((item, idx) => (
                        <div key={`${item.id}-${idx}`} style={{ borderLeft: `3px solid ${item.correct ? '#16a34a' : '#dc2626'}`, padding: '0.65rem', background: item.correct ? '#f0fdf4' : '#fef2f2' }}>
                            <div style={{ fontWeight: 900 }}>{item.id} / {item.correct ? '正解' : '要確認'}</div>
                            <div style={{ fontSize: '0.82rem', marginTop: '0.25rem' }}>答案: {item.userAnswer || '(無回答)'}</div>
                            <div style={{ fontSize: '0.82rem' }}>正解: {item.correctAnswer || '-'}</div>
                        </div>
                    ))}
                </div>
            </details>
            <details style={{ border: '1px solid #e2e8f0', background: '#fff', padding: '0.9rem' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 900 }}>保存答案JSON</summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', overflowX: 'auto' }}>{JSON.stringify(answers, null, 2)}</pre>
            </details>
        </div>
    );
};

const inputStyle = {
    padding: '0.65rem',
    borderRadius: '2px',
    border: '1px solid #cbd5e1',
    background: '#fff',
    fontSize: '0.85rem',
    boxSizing: 'border-box'
};

export default AdminConsultationsPage;
