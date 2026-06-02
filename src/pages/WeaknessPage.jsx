import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getUserResults } from '../services/resultService';
import { useNavigate } from 'react-router-dom';

const WeaknessPage = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [weaknesses, setWeaknesses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterSubject, setFilterSubject] = useState('all');

    useEffect(() => {
        if (!user) {
            navigate('/');
            return;
        }

        const fetchWeaknesses = async () => {
            const { data, error } = await getUserResults(user.id);
            if (error) {
                console.error("Error fetching results:", error);
                setLoading(false);
                return;
            }

            const allWeaknesses = [];
            data.forEach(result => {
                if (result.question_feedback && Array.isArray(result.question_feedback)) {
                    result.question_feedback.forEach(item => {
                        if (!item.correct) {
                            allWeaknesses.push({
                                ...item,
                                universityName: result.university_name,
                                examSubject: result.exam_subject,
                                examDate: result.created_at,
                                resultId: result.id
                            });
                        }
                    });
                }
            });

            setWeaknesses(allWeaknesses);
            setLoading(false);
        };

        fetchWeaknesses();
    }, [user, navigate]);

    const subjects = ['all', ...new Set(weaknesses.map(w => w.examSubject))];

    const filteredWeaknesses = filterSubject === 'all'
        ? weaknesses
        : weaknesses.filter(w => w.examSubject === filterSubject);

    if (loading) {
        return (
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <div style={{ fontSize: '1.2rem', color: '#888' }}>読み込み中...</div>
            </div>
        );
    }

    return (
        <div className="container" style={{ maxWidth: '1000px', paddingBottom: '4rem' }}>
            {/* Mobile-friendly header: stacked on small screens */}
            <header style={{ marginBottom: '2rem', marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h1 style={{ marginBottom: '0.35rem' }}>弱点克服ノート</h1>
                        <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '0.95rem' }}>
                            過去に間違えた問題: 全{weaknesses.length}問
                        </p>
                    </div>
                    <button className="btn btn-secondary" onClick={() => navigate('/dashboard')} style={{ flexShrink: 0, fontSize: '0.85rem' }}>
                        ダッシュボードに戻る
                    </button>
                </div>
            </header>

            {/* Filter - horizontal scroll on mobile */}
            <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem', WebkitOverflowScrolling: 'touch' }}>
                {subjects.map(subject => (
                    <button
                        key={subject}
                        onClick={() => setFilterSubject(subject)}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '2px',
                            border: '1px solid',
                            borderColor: filterSubject === subject ? 'var(--color-accent-primary)' : '#e2e8f0',
                            background: filterSubject === subject ? 'var(--color-accent-primary)' : 'white',
                            color: filterSubject === subject ? 'white' : '#64748b',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            fontSize: '0.85rem',
                            flexShrink: 0
                        }}
                    >
                        {subject === 'all' ? 'すべて' : subject}
                    </button>
                ))}
            </div>

            {/* List */}
            {filteredWeaknesses.length === 0 ? (
                <div className="glass-panel" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                    <h3 style={{ marginBottom: '1rem' }}>素晴らしい！</h3>
                    <p style={{ color: '#888' }}>
                        {filterSubject === 'all'
                            ? '間違えた問題はまだありません。'
                            : 'この科目の間違えた問題はありません。'}
                    </p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {filteredWeaknesses.map((item, index) => (
                        <div key={`${item.resultId}-${item.id}-${index}`} className="glass-panel" style={{ padding: '1.25rem', borderLeft: '4px solid #ef4444' }}>
                            {/* Header row */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span style={{
                                        background: '#f1f5f9',
                                        padding: '0.2rem 0.6rem',
                                        borderRadius: '2px',
                                        fontSize: '0.8rem',
                                        color: '#64748b',
                                        fontWeight: '600'
                                    }}>
                                        {item.universityName} {item.examSubject}
                                    </span>
                                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                        {new Date(item.examDate).toLocaleDateString('ja-JP')}
                                    </span>
                                </div>
                                <span style={{ fontWeight: '700', color: '#ef4444', fontSize: '0.85rem' }}>不正解</span>
                            </div>

                            <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', fontWeight: '700' }}>
                                問: {item.id}
                            </h3>

                            {/* Answer comparison - stacks on mobile */}
                            <div className="weakness-answer-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                                <div style={{ background: '#fff1f2', padding: '0.75rem', borderRadius: '2px' }}>
                                    <div style={{ fontSize: '0.75rem', color: '#ef4444', marginBottom: '0.25rem', fontWeight: '600' }}>あなたの解答</div>
                                    <div style={{ fontSize: '1rem', wordBreak: 'break-word' }}>{item.userAnswer || '(無回答)'}</div>
                                </div>
                                <div style={{ background: '#f0fdf4', padding: '0.75rem', borderRadius: '2px' }}>
                                    <div style={{ fontSize: '0.75rem', color: '#10b981', marginBottom: '0.25rem', fontWeight: '600' }}>正解</div>
                                    <div style={{ fontSize: '1rem', wordBreak: 'break-word' }}>{item.correctAnswer}</div>
                                </div>
                            </div>

                            {item.explanation && (
                                <div style={{ background: 'rgba(255,255,255,0.5)', padding: '1rem', borderRadius: '2px' }}>
                                    <div style={{ fontWeight: '600', color: '#475569', marginBottom: '0.4rem', fontSize: '0.85rem' }}>解説</div>
                                    <p style={{ lineHeight: '1.7', color: '#334155', margin: 0, fontSize: '0.9rem' }}>
                                        {item.explanation}
                                    </p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default WeaknessPage;
