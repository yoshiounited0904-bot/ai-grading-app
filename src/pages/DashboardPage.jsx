import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getUserResults, getUserStats } from '../services/resultService'
import { useNavigate } from 'react-router-dom'

const DashboardPage = () => {
    const { user, loading: authLoading } = useAuth()
    const navigate = useNavigate()
    const [results, setResults] = useState([])
    const [stats, setStats] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    useEffect(() => {
        if (authLoading) return

        if (!user) {
            navigate('/')
            return
        }

        const loadData = async () => {
            try {
                // 3秒タイムアウトで即座に諦める
                const timeout = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 3000)
                )

                const dataLoad = Promise.all([
                    getUserResults(user.id),
                    getUserStats(user.id)
                ])

                const [resultsRes, statsRes] = await Promise.race([dataLoad, timeout])

                setResults(resultsRes.data || [])
                setStats(statsRes.data)
            } catch (err) {
                console.error('Dashboard data load failed:', err)
                // エラーでも空のデータで表示
                setResults([])
                setStats({ totalExams: 0, averageScore: 0, bestScore: 0 })
                setError('データの読み込みに失敗しました')
            } finally {
                setLoading(false)
            }
        }

        loadData()
    }, [user, navigate, authLoading])

    if (loading) {
        return (
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <div style={{ fontSize: '1.2rem', color: '#888' }}>読み込み中...</div>
            </div>
        )
    }

    const getProbabilityColor = (prob) => {
        switch (prob) {
            case 'A': return '#10b981'
            case 'B': return '#3b82f6'
            case 'C': return '#f59e0b'
            case 'D': return '#f97316'
            case 'E': return '#ef4444'
            default: return '#888'
        }
    }

    return (
        <div className="container" style={{ maxWidth: '1000px', paddingBottom: '4rem' }}>
            {/* Mobile-friendly top nav */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', marginBottom: '1rem' }}>
                <button className="btn btn-secondary" onClick={() => navigate('/')} style={{ fontSize: '0.85rem' }}>
                    トップに戻る
                </button>
            </div>
            <header style={{ marginBottom: '2rem' }}>
                <h1 style={{ color: 'var(--color-accent-primary)', marginBottom: '0.5rem' }}>
                    マイページ
                </h1>
                <p style={{ color: '#64748b', fontSize: '1rem' }}>
                    これまでの学習成果と分析結果を確認しましょう。
                </p>
            </header>

            {error && (
                <div style={{
                    background: '#fef2f2',
                    border: '1px solid #fca5a5',
                    padding: '1rem',
                    borderRadius: '2px',
                    marginBottom: '1.5rem',
                    color: '#991b1b'
                }}>
                    {error}（一時的な通信エラーの可能性があります）
                </div>
            )}

            {/* 統計情報 - mobile responsive */}
            <div className="dashboard-stats-grid" style={{ marginBottom: '2rem' }}>
                <div className="glass-panel" style={{ padding: '1.25rem', textAlign: 'center', maxWidth: '300px' }}>
                    <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '0.4rem' }}>受験回数</div>
                    <div style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--color-accent-primary)' }}>
                        {stats?.totalExams || 0}
                    </div>
                </div>
            </div>

            {/* Weakness Notebook Link */}
            <div
                className="glass-panel"
                style={{
                    padding: '1.5rem',
                    marginBottom: '2rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: '#fff',
                    border: '1px solid #fecdd3',
                    cursor: 'pointer',
                    gap: '1rem'
                }}
                onClick={() => navigate('/weakness')}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = '#f9a8d4'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = '#fecdd3'}
            >
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem', color: '#be123c' }}>弱点克服ノート</h3>
                    <p style={{ color: '#881337', fontSize: '0.9rem', margin: 0 }}>
                        これまでに間違えた問題をまとめて復習できます。
                    </p>
                </div>
                <div style={{ fontSize: '1.2rem', color: '#be123c', fontWeight: '600', flexShrink: 0 }}>→</div>
            </div>

            {/* 成績一覧 */}
            <h2 style={{ marginBottom: '1.25rem' }}>過去の成績</h2>

            {results.length === 0 ? (
                <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'center' }}>
                    <p style={{ color: '#888', fontSize: '1.1rem', marginBottom: '1.5rem' }}>
                        {error ? 'データを読み込めませんでした' : 'まだ受験記録がありません'}
                    </p>
                    <button className="btn btn-primary" onClick={() => navigate('/')}>
                        試験を受ける
                    </button>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {results.map((result) => (
                        <div
                            key={result.id}
                            className="glass-panel"
                            style={{ padding: '1.25rem', cursor: 'pointer', transition: 'transform 0.2s' }}
                            onClick={() => navigate('/result', {
                                state: {
                                    result: {
                                        score: result.score,
                                        maxScore: result.max_score,
                                        passProbability: result.pass_probability,
                                        weakness_analysis: result.weakness_analysis,
                                        question_feedback: result.question_feedback,
                                        section_scores: result.section_scores
                                    },
                                    universityName: result.university_name,
                                    facultyName: result.faculty_name,
                                    examSubject: result.exam_subject,
                                    answers: result.answers
                                }
                            })}
                            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--color-silver)'}
                            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--color-silver-light)'}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                                        <span style={{ 
                                            fontSize: '0.75rem', 
                                            background: 'var(--color-accent-primary)15', 
                                            color: 'var(--color-accent-primary)',
                                            padding: '0.1rem 0.5rem',
                                            borderRadius: '2px',
                                            fontWeight: '600'
                                        }}>
                                            {result.exam_subject || '科目不明'}
                                        </span>
                                        {result.faculty_name && (
                                            <span style={{ 
                                                fontSize: '0.75rem', 
                                                background: '#f3f4f6', 
                                                color: '#4b5563',
                                                padding: '0.1rem 0.5rem',
                                                borderRadius: '2px',
                                                fontWeight: '600'
                                            }}>
                                                {result.faculty_name}
                                            </span>
                                        )}
                                    </div>
                                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>
                                        {result.university_name || ''}
                                    </h3>
                                    <p style={{ color: '#888', fontSize: '0.85rem', margin: 0 }}>
                                        {new Date(result.created_at).toLocaleDateString('ja-JP', {
                                            year: 'numeric',
                                            month: 'long',
                                            day: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        })}
                                    </p>
                                </div>
                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                    <div style={{ fontSize: '1.75rem', fontWeight: '700', marginBottom: '0.25rem' }}>
                                        {result.score}/{result.max_score}
                                        <span style={{ fontSize: '0.85rem', color: '#888', marginLeft: '0.35rem' }}>
                                            ({((result.score / result.max_score) * 100).toFixed(1)}%)
                                        </span>
                                    </div>
                                    <div style={{
                                        fontSize: '1rem',
                                        fontWeight: '600',
                                        color: getProbabilityColor(result.pass_probability),
                                        background: `${getProbabilityColor(result.pass_probability)}20`,
                                        padding: '0.2rem 0.6rem',
                                        borderRadius: '2px',
                                        display: 'inline-block'
                                    }}>
                                        判定: {result.pass_probability}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

export default DashboardPage
