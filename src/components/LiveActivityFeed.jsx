import React, { useEffect, useMemo, useState } from 'react';
import { getLiveActivityEvents } from '../services/activityService';

const getRelativeTime = (value) => {
    const date = new Date(value);
    const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (!Number.isFinite(diffSeconds)) return '';
    if (diffSeconds < 60) return 'たった今';
    const minutes = Math.floor(diffSeconds / 60);
    if (minutes < 60) return `${minutes}分前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}時間前`;
    const days = Math.floor(hours / 24);
    return `${days}日前`;
};

const buildEventText = (event) => {
    const label = event.anonymous_label || '受験生';
    const year = event.exam_year ? `${event.exam_year}年度` : '';
    const university = String(event.university_name || '').trim();
    const faculty = String(event.faculty_name || '').trim();
    const displayUniversity = faculty && university.endsWith(faculty)
        ? university.slice(0, -faculty.length).trim()
        : university;
    const examParts = [
        displayUniversity,
        faculty,
        event.exam_subject,
        year
    ].filter(Boolean);
    const examLabel = examParts.join(' ');

    const score = Number(event.score);
    const maxScore = Number(event.max_score);
    const scoreRate = Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0
        ? score / maxScore
        : null;

    if (event.pass_probability && ['A', 'B'].includes(String(event.pass_probability).toUpperCase())) {
        return `${label}が ${examLabel} で${event.pass_probability}判定を記録`;
    }

    if (scoreRate !== null && scoreRate >= 0.7) {
        return `${label}が ${examLabel} で ${score}/${maxScore}点を記録`;
    }

    return `${label}が ${examLabel} を採点しました`;
};

const LiveActivityFeed = ({
    compact = false,
    limit = 12,
    pollMs = 45000,
    title = 'みんなの採点速報',
    description = '他の受験生もいま過去問演習中です。'
}) => {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        let timer = null;

        const load = async () => {
            const { data, error } = await getLiveActivityEvents({ limit });
            if (cancelled) return;
            if (!error) setEvents(data || []);
            setLoading(false);
        };

        load();
        timer = window.setInterval(load, pollMs);

        return () => {
            cancelled = true;
            if (timer) window.clearInterval(timer);
        };
    }, [limit, pollMs]);

    const visibleEvents = useMemo(() => events.slice(0, compact ? 5 : limit), [compact, events, limit]);

    if (!loading && visibleEvents.length === 0) return null;

    if (compact) {
        return (
            <div className="no-print" style={{
                margin: '0 auto 1.5rem',
                maxWidth: '920px',
                border: '1px solid rgba(185, 28, 28, 0.14)',
                background: '#fffafa',
                padding: '0.75rem 1rem'
            }}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', overflow: 'hidden' }}>
                    <span style={{ color: 'var(--color-accent-primary)', fontSize: '0.75rem', fontWeight: 900, whiteSpace: 'nowrap', letterSpacing: '0.08em' }}>
                        LIVE
                    </span>
                    <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', fontSize: '0.82rem', color: '#64748b', fontWeight: 700 }}>
                        {loading ? (
                            <span>速報を読み込み中...</span>
                        ) : visibleEvents.map(event => (
                            <span key={event.id} style={{ whiteSpace: 'nowrap' }}>
                                {getRelativeTime(event.created_at)}: {buildEventText(event)}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <section className="no-print glass-panel" style={{
            padding: '1.5rem',
            margin: '0 auto 3rem',
            maxWidth: '980px',
            borderTop: '4px solid var(--color-accent-primary)',
            background: '#fff'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                    <div style={{ color: 'var(--color-accent-primary)', fontSize: '0.72rem', fontWeight: 900, letterSpacing: '0.16em', marginBottom: '0.4rem' }}>
                        LIVE FEED
                    </div>
                    <h2 style={{ margin: 0, fontSize: '1.35rem', color: 'var(--color-text-primary)' }}>{title}</h2>
                    <p style={{ margin: '0.4rem 0 0', color: '#94a3b8', fontWeight: 700, fontSize: '0.9rem' }}>{description}</p>
                </div>
                <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    color: '#16a34a',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    padding: '0.35rem 0.7rem',
                    fontSize: '0.72rem',
                    fontWeight: 900,
                    whiteSpace: 'nowrap'
                }}>
                    ● 更新中
                </span>
            </div>
            <div style={{ display: 'grid', gap: '0.65rem' }}>
                {loading ? (
                    <div style={{ color: '#94a3b8', fontWeight: 700 }}>速報を読み込み中...</div>
                ) : visibleEvents.map(event => (
                    <div key={event.id} style={{
                        display: 'grid',
                        gridTemplateColumns: '92px 1fr',
                        gap: '0.75rem',
                        alignItems: 'center',
                        padding: '0.85rem 1rem',
                        border: '1px solid #eef2f7',
                        background: '#ffffff'
                    }}>
                        <span style={{ color: '#94a3b8', fontWeight: 900, fontSize: '0.78rem' }}>
                            {getRelativeTime(event.created_at)}
                        </span>
                        <span style={{ color: '#334155', fontWeight: 800, lineHeight: 1.6 }}>
                            {buildEventText(event)}
                        </span>
                    </div>
                ))}
            </div>
        </section>
    );
};

export default LiveActivityFeed;
