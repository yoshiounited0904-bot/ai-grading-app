import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MARKETING_CONFIG } from '../config/marketingConfig';
import { buildLineMatchMessage, createLineMatchCode, saveConsultationRequest } from '../services/consultationService';

const loadStoredContext = () => {
    try {
        const stored = sessionStorage.getItem('latest_consultation_context');
        return stored ? JSON.parse(stored) : null;
    } catch {
        return null;
    }
};

const buildDefaultMessage = (context) => {
    if (!context) return '';
    return [
        '答案相談を希望します。',
        '次に優先して復習すべき内容と、志望校対策の進め方を相談したいです。'
    ].filter(Boolean).join('\n');
};

const ConsultationPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, profile } = useAuth();
    const context = location.state?.consultationContext || loadStoredContext();
    const defaultMessage = useMemo(() => buildDefaultMessage(context), [context]);

    const [form, setForm] = useState({
        studentName: profile?.display_name || user?.email?.split('@')[0] || '',
        grade: '',
        email: user?.email || '',
        lineDisplayName: '',
        preferredMethod: 'zoom_no_camera',
        preferredTime1: '',
        preferredTime2: '',
        preferredTime3: '',
        consultationMessage: defaultMessage
    });
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const [completedRequest, setCompletedRequest] = useState(null);

    const updateForm = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitError('');

        if (!form.studentName.trim()) {
            setSubmitError('お名前を入力してください。');
            return;
        }
        if (!form.grade) {
            setSubmitError('学年を選択してください。');
            return;
        }
        if (!form.email.trim() && !form.lineDisplayName.trim()) {
            setSubmitError('メールアドレスまたはLINE表示名のどちらかを入力してください。');
            return;
        }
        if (!form.preferredTime1.trim()) {
            setSubmitError('第1希望日時を入力してください。');
            return;
        }

        const lineMatchCode = createLineMatchCode();
        const requestPayload = {
            ...form,
            lineMatchCode,
            userId: user?.id || null,
            examResultId: context?.examResultId || null,
            examId: context?.examId || '',
            universityName: context?.universityName || '',
            facultyName: context?.facultyName || '',
            examSubject: context?.examSubject || '',
            examYear: context?.examYear || null,
            score: context?.score,
            maxScore: context?.maxScore,
            passProbability: context?.passProbability,
            weaknessSummary: context?.weaknessSummary || '',
            wrongQuestionCount: context?.wrongQuestionCount,
            chatSummary: context?.chatSummary || '',
            chatHistory: context?.chatHistory || [],
            sectionFocus: context?.sectionFocus || null,
            consultationContext: context || null,
            source: context?.source || 'result_cta'
        };
        const lineMatchMessage = buildLineMatchMessage(requestPayload);

        setSubmitting(true);
        try {
            const { data, error } = await saveConsultationRequest({
                ...requestPayload,
                lineMatchMessage
            });
            if (error) throw error;
            setCompletedRequest({
                ...requestPayload,
                id: data?.id,
                lineMatchMessage
            });
        } catch (err) {
            console.error('Consultation request failed:', err);
            setSubmitError(`申し込みの送信に失敗しました。${err?.message ? `\n原因: ${err.message}` : '時間をおいて再度お試しください。'}`);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="container" style={{ maxWidth: '980px', paddingBottom: '4rem' }}>
            <header style={{ margin: '1.5rem 0 2rem' }}>
                <div className="consultation-hero">
                    <div className="consultation-hero__copy">
                        <h1>答案を基に、プロ講師へ相談できます</h1>
                        <p>
                            採点結果・答案・弱点分析を確認し、次にやるべき復習と学習方針を整理します。
                        </p>
                    </div>
                </div>
            </header>

            {completedRequest ? (
                <CompletionPanel request={completedRequest} onBackHome={() => navigate('/')} />
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '1.5rem', alignItems: 'start' }}>
                    <DiagnosisPanel context={context} />

                    <form className="glass-panel" onSubmit={handleSubmit} style={{ padding: '1.5rem', display: 'grid', gap: '1rem' }}>
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>答案相談申込</h2>
                        <Field label="お名前">
                            <input value={form.studentName} onChange={e => updateForm('studentName', e.target.value)} style={inputStyle} />
                        </Field>
                        <Field label="学年">
                            <select value={form.grade} onChange={e => updateForm('grade', e.target.value)} style={inputStyle}>
                                <option value="">選択してください</option>
                                <option value="高1">高1</option>
                                <option value="高2">高2</option>
                                <option value="高3">高3</option>
                                <option value="既卒">既卒</option>
                                <option value="その他">その他</option>
                            </select>
                        </Field>
                        <Field label="メールアドレス">
                            <input value={form.email} onChange={e => updateForm('email', e.target.value)} placeholder="返信先メール。LINE連絡のみなら空欄でも可。" style={inputStyle} />
                        </Field>
                        <Field label="LINE表示名">
                            <input value={form.lineDisplayName} onChange={e => updateForm('lineDisplayName', e.target.value)} placeholder="公式LINEで表示される名前。照合に使います。" style={inputStyle} />
                        </Field>
                        <Field label="希望相談方法">
                            <select value={form.preferredMethod} onChange={e => updateForm('preferredMethod', e.target.value)} style={inputStyle}>
                                <option value="zoom_no_camera">Zoom（顔出しなし）</option>
                                <option value="line">LINE</option>
                            </select>
                        </Field>
                        <Field label="第1希望日時">
                            <input value={form.preferredTime1} onChange={e => updateForm('preferredTime1', e.target.value)} placeholder="例: 7/3 20:00以降" style={inputStyle} />
                        </Field>
                        <Field label="第2希望日時">
                            <input value={form.preferredTime2} onChange={e => updateForm('preferredTime2', e.target.value)} placeholder="例: 7/4 21:00以降" style={inputStyle} />
                        </Field>
                        <Field label="第3希望日時">
                            <input value={form.preferredTime3} onChange={e => updateForm('preferredTime3', e.target.value)} placeholder="例: 土曜午前" style={inputStyle} />
                        </Field>
                        <Field label="相談したい内容">
                            <textarea value={form.consultationMessage} onChange={e => updateForm('consultationMessage', e.target.value)} style={{ ...inputStyle, minHeight: '150px' }} />
                        </Field>

                        {submitError && (
                            <div style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '0.75rem', fontSize: '0.85rem' }}>
                                {submitError}
                            </div>
                        )}

                        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%', padding: '0.9rem' }}>
                            {submitting ? '送信中...' : '答案相談を申し込む'}
                        </button>
                    </form>
                </div>
            )}
        </div>
    );
};

const DiagnosisPanel = ({ context }) => (
    <aside className="glass-panel" style={{ padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>自動入力された診断情報</h2>
        {context ? (
            <div style={{ display: 'grid', gap: '0.75rem', fontSize: '0.9rem' }}>
                <InfoRow label="大学" value={context.universityName} />
                <InfoRow label="学部" value={context.facultyName} />
                <InfoRow label="科目" value={context.examSubject} />
                <InfoRow label="得点" value={`${context.score ?? '-'} / ${context.maxScore ?? '-'} 点`} />
                <InfoRow label="判定" value={context.passProbability || '未判定'} />
                <InfoRow label="要確認問題" value={context.wrongQuestionCount !== undefined ? `${context.wrongQuestionCount}問` : '-'} />
            </div>
        ) : (
            <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                採点結果データが見つかりません。相談内容欄に志望校・科目・現在の課題を入力してください。
            </p>
        )}
    </aside>
);

const CompletionPanel = ({ request, onBackHome }) => {
    const copyMessage = async () => {
        try {
            await navigator.clipboard.writeText(request.lineMatchMessage);
            alert('LINE相談文面をコピーしました。');
        } catch {
            alert('コピーに失敗しました。本文を選択してコピーしてください。');
        }
    };

    return (
        <div className="glass-panel" style={{ padding: '2rem', display: 'grid', gap: '1.25rem' }}>
            <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 900, color: '#16a34a', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>REQUEST SENT</div>
                <h2 style={{ margin: '0 0 0.5rem' }}>答案相談の申込を受け付けました</h2>
                <p style={{ margin: 0, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                    申し込み情報とLINEアカウントを照合し、そのまま答案相談を始めるため、以下の文面を公式LINEに送ってください。
                </p>
            </div>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '1rem', borderRadius: '2px', display: 'grid', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 900, color: '#15803d' }}>照合コード</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#14532d' }}>{request.lineMatchCode}</div>
                    </div>
                    <button type="button" className="btn btn-secondary" onClick={copyMessage}>
                        LINE相談文面をコピー
                    </button>
                </div>
                <textarea readOnly value={request.lineMatchMessage} style={{ ...inputStyle, minHeight: '170px', background: '#fff', color: '#14532d', fontSize: '0.85rem' }} />
                <button type="button" className="btn btn-primary" onClick={() => window.open(MARKETING_CONFIG.lineUrl, '_blank')} style={{ background: '#06c755', border: 'none' }}>
                    公式LINEを開く
                </button>
            </div>
            <button type="button" className="btn btn-secondary" onClick={onBackHome}>
                トップへ戻る
            </button>
        </div>
    );
};

const InfoRow = ({ label, value }) => (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '0.75rem', borderRadius: '2px' }}>
        <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 900, marginBottom: '0.2rem' }}>{label}</div>
        <div style={{ fontWeight: 800, color: '#0f172a' }}>{value || '-'}</div>
    </div>
);

const Field = ({ label, children }) => (
    <label style={{ display: 'grid', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 800, color: '#334155' }}>
        {label}
        {children}
    </label>
);

const inputStyle = {
    width: '100%',
    padding: '0.75rem',
    borderRadius: '2px',
    border: '1px solid #cbd5e1',
    background: '#fff',
    fontSize: '0.9rem',
    outline: 'none',
    boxSizing: 'border-box'
};

export default ConsultationPage;
