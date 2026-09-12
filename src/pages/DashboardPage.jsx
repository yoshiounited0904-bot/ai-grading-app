import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getUserResults, getUserStats, getUserResultUniversities } from '../services/resultService'
import { useNavigate } from 'react-router-dom'
import ConsultationCTA from '../components/ConsultationCTA'
import { MARKETING_CONFIG } from '../config/marketingConfig'
import UsageLimitCard from '../components/UsageLimitCard'
import PremiumLockCard from '../components/PremiumLockCard'
import AdBanner from '../components/AdBanner'
import { getGradingUsageStatus, getPlanFeatures, getUsagePlanLabel, getUserPlan } from '../services/usageLimitService'

const extractWeaknessText = (value) => {
    if (!value) return ''
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) {
                return parsed.map(block => block.content || '').filter(Boolean).join('\n')
            }
        } catch {}
        return value
    }
    if (Array.isArray(value)) {
        return value.map(block => block.content || '').filter(Boolean).join('\n')
    }
    return String(value)
}

const getWeakQuestionCount = (feedback = []) => Array.isArray(feedback) ? feedback.filter(item => !item.correct).length : 0
const HISTORY_PAGE_SIZE = 20

const PremiumPlanSummary = ({ plan, usage, planFeatures, onPremiumClick }) => {
    const isUnlimited = planFeatures.unlimitedGrading
    const remainingText = isUnlimited
        ? '無制限'
        : usage
            ? `今月あと${Math.max(Number(usage.remaining || 0), 0)}回`
            : '確認中'

    return (
        <div
            className="glass-panel"
            style={{
                padding: isUnlimited ? '1.5rem' : '1.25rem',
                marginBottom: '1.5rem',
                border: isUnlimited ? '1px solid #f59e0b' : '1px solid #fde68a',
                background: isUnlimited
                    ? 'linear-gradient(135deg, #fff7ed 0%, #fffbeb 44%, #ffffff 100%)'
                    : 'linear-gradient(135deg, #fffbeb 0%, #ffffff 72%)',
                boxShadow: isUnlimited ? '0 18px 45px rgba(146, 64, 14, 0.12)' : undefined
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '240px' }}>
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 900, color: isUnlimited ? '#92400e' : '#b45309', letterSpacing: '0.08em' }}>
                            {isUnlimited ? 'PREMIUM ACTIVE' : 'CURRENT PLAN'}
                        </div>
                        {isUnlimited && (
                            <span style={{
                                fontSize: '0.72rem',
                                fontWeight: 900,
                                color: '#92400e',
                                background: '#fef3c7',
                                border: '1px solid #f59e0b',
                                borderRadius: '999px',
                                padding: '0.22rem 0.58rem'
                            }}>
                                全機能解放中
                            </span>
                        )}
                    </div>
                    <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.25rem', color: '#0f172a' }}>
                        現在のプラン：{getUsagePlanLabel(plan)}
                    </h2>
                    <p style={{ margin: 0, color: '#64748b', lineHeight: 1.6 }}>
                        採点回数：<strong style={{ color: isUnlimited ? '#92400e' : '#b45309' }}>{remainingText}</strong>
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.85rem' }}>
                        {['採点回数無制限', '詳細解説', 'AI質問', '過去履歴'].map(feature => (
                            <span
                                key={feature}
                                style={{
                                    fontSize: '0.78rem',
                                    fontWeight: 800,
                                    color: isUnlimited ? '#78350f' : '#92400e',
                                    background: isUnlimited ? '#fffbeb' : '#fef3c7',
                                    border: `1px solid ${isUnlimited ? '#f59e0b' : '#fde68a'}`,
                                    borderRadius: '999px',
                                    padding: '0.28rem 0.6rem'
                                }}
                            >
                                {isUnlimited ? '✓ ' : ''}{feature}
                            </span>
                        ))}
                    </div>
                </div>
                {MARKETING_CONFIG.enablePremiumBilling && plan === 'premium' ? (
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={onPremiumClick}
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        契約を管理する
                    </button>
                ) : MARKETING_CONFIG.enablePremiumBilling && !isUnlimited && (
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={onPremiumClick}
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        プレミアムに変更
                    </button>
                )}
            </div>
        </div>
    )
}

const DashboardPage = () => {
    const { user, profile, loading: authLoading } = useAuth()
    const navigate = useNavigate()
    const [results, setResults] = useState([])
    const [resultCount, setResultCount] = useState(0)
    const [resultUniversities, setResultUniversities] = useState([])
    const [selectedUniversity, setSelectedUniversity] = useState('')
    const [currentPage, setCurrentPage] = useState(1)
    const [stats, setStats] = useState(null)
    const [usageStatus, setUsageStatus] = useState(null)
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
                setError(null)
                // Supabaseが一時的に重い時でも、取得できた情報だけは表示する。
                const timeout = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('マイページの読み込みがタイムアウトしました')), 12000)
                )

                const dataLoad = Promise.allSettled([
                    getUserResults(user.id, {
                        page: currentPage,
                        pageSize: HISTORY_PAGE_SIZE,
                        universityName: selectedUniversity
                    }),
                    getUserResultUniversities(user.id),
                    getUserStats(user.id),
                    getGradingUsageStatus(user)
                ])

                const [resultsRes, universitiesRes, statsRes, usageRes] = await Promise.race([dataLoad, timeout])

                const resultsPayload = resultsRes.status === 'fulfilled' ? resultsRes.value : { data: [], count: 0, error: resultsRes.reason }
                const universitiesPayload = universitiesRes.status === 'fulfilled' ? universitiesRes.value : { data: [], error: universitiesRes.reason }
                const statsPayload = statsRes.status === 'fulfilled' ? statsRes.value : { data: null, error: statsRes.reason }
                const usagePayload = usageRes.status === 'fulfilled' ? usageRes.value : { data: null, error: usageRes.reason }

                setResults(resultsPayload.data || [])
                setResultCount(typeof resultsPayload.count === 'number' ? resultsPayload.count : (resultsPayload.data || []).length)
                setResultUniversities(universitiesPayload.data || [])
                setStats(statsPayload.data || { totalExams: 0, averageScore: 0, bestScore: 0 })
                if (!usagePayload.error) setUsageStatus(usagePayload.data)

                const failedLabels = [
                    resultsPayload.error ? '成績履歴' : '',
                    universitiesPayload.error ? '大学フィルタ' : '',
                    statsPayload.error ? '統計' : '',
                    usagePayload.error ? '利用回数' : ''
                ].filter(Boolean)

                if (failedLabels.length > 0) {
                    setError(`${failedLabels.join('・')}の読み込みに失敗しました`)
                }
            } catch (err) {
                console.error('Dashboard data load failed:', err)
                // エラーでも空のデータで表示
                setResults([])
                setResultCount(0)
                setStats({ totalExams: 0, averageScore: 0, bestScore: 0 })
                setError(err.message || 'データの読み込みに失敗しました')
            } finally {
                setLoading(false)
            }
        }

        loadData()
    }, [user, navigate, authLoading, currentPage, selectedUniversity])

    useEffect(() => {
        const nextTotalPages = Math.max(1, Math.ceil(resultCount / HISTORY_PAGE_SIZE))
        if (currentPage > nextTotalPages) {
            setCurrentPage(nextTotalPages)
        }
    }, [currentPage, resultCount])

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

    const handleDashboardConsultation = () => {
        const latest = results[0]
        const consultationContext = latest ? {
            source: 'dashboard_cta',
            examResultId: latest.id,
            universityName: latest.university_name,
            facultyName: latest.faculty_name,
            examSubject: latest.exam_subject,
            examYear: latest.exam_year,
            score: latest.score,
            maxScore: latest.max_score,
            passProbability: latest.pass_probability,
            weaknessSummary: extractWeaknessText(latest.weakness_analysis),
            wrongQuestionCount: getWeakQuestionCount(latest.question_feedback)
        } : {
            source: 'dashboard_cta'
        }

        try {
            sessionStorage.setItem('latest_consultation_context', JSON.stringify(consultationContext))
        } catch {}
        navigate(MARKETING_CONFIG.consultationPath, { state: { consultationContext } })
    }

    const currentPlan = getUserPlan(profile, usageStatus)
    const planFeatures = getPlanFeatures(currentPlan)
    const displayedUsageStatus = planFeatures.unlimitedGrading
        ? { ...(usageStatus || {}), allowed: true, used: usageStatus?.used || 0, limit: null, remaining: null, plan: currentPlan }
        : usageStatus
    const adContext = { audience: currentPlan }
    const totalPages = Math.max(1, Math.ceil(resultCount / HISTORY_PAGE_SIZE))
    const pageStart = resultCount === 0 ? 0 : ((currentPage - 1) * HISTORY_PAGE_SIZE) + 1
    const pageEnd = Math.min(currentPage * HISTORY_PAGE_SIZE, resultCount)

    return (
        <div className="container dashboard-page" style={{ maxWidth: '1000px', paddingBottom: '4rem' }}>
            {/* Mobile-friendly top nav */}
            <div className="dashboard-top-action" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', marginBottom: '1rem' }}>
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

            <UsageLimitCard
                usage={displayedUsageStatus}
                compact
                showConsultationCta={!planFeatures.unlimitedGrading && usageStatus?.remaining <= 0}
                onConsultationClick={handleDashboardConsultation}
                onPremiumClick={() => navigate('/premium')}
            />

            <PremiumPlanSummary
                plan={currentPlan}
                usage={displayedUsageStatus}
                planFeatures={planFeatures}
                onPremiumClick={() => navigate('/premium')}
            />

            {MARKETING_CONFIG.enableAdBanners && (
                <AdBanner
                    slot="mypage_top"
                    pageTarget="dashboard"
                    variant="inline"
                    context={adContext}
                    audience={currentPlan}
                    className="mb-6"
                />
            )}

            <ConsultationCTA
                variant="compact"
                title="最近の結果を基に、復習方針を相談する"
                description={results.length > 0
                    ? '過去問の得点・弱点・答案をもとに、次に優先すべき復習を整理します。'
                    : '診断結果がない場合も、志望校や現在の課題を入力して相談できます。'
                }
                buttonLabel="答案相談を申し込む"
                onClick={handleDashboardConsultation}
            />

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

            {planFeatures.history ? (
                <>
                    {/* 統計情報 - mobile responsive */}
                    <div className="dashboard-stats-grid" style={{ marginBottom: '2rem' }}>
                        <div className="glass-panel" style={{ padding: '1.25rem', textAlign: 'center', maxWidth: '300px' }}>
                            <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '0.4rem' }}>受験回数</div>
                            <div style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--color-accent-primary)' }}>
                                {stats?.totalExams || 0}
                            </div>
                        </div>
                    </div>

                    {/* 成績一覧 */}
                    <div className="dashboard-history-toolbar" style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-end',
                        gap: '1rem',
                        flexWrap: 'wrap',
                        marginBottom: '1.25rem'
                    }}>
                        <div>
                            <h2 style={{ margin: '0 0 0.35rem' }}>過去の成績</h2>
                            <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>
                                {resultCount > 0 ? `${pageStart}-${pageEnd}件目 / 全${resultCount}件` : '表示できる成績はありません'}
                            </p>
                        </div>
                        <label className="dashboard-filter-control" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: '220px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b' }}>大学名で絞り込み</span>
                            <select
                                value={selectedUniversity}
                                onChange={(e) => {
                                    setSelectedUniversity(e.target.value)
                                    setCurrentPage(1)
                                }}
                                style={{
                                    width: '100%',
                                    minHeight: '42px',
                                    padding: '0.55rem 0.75rem',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '2px',
                                    background: '#fff',
                                    color: '#0f172a',
                                    fontSize: '0.9rem',
                                    fontWeight: 700
                                }}
                            >
                                <option value="">すべての大学</option>
                                {resultUniversities.map(universityName => (
                                    <option key={universityName} value={universityName}>{universityName}</option>
                                ))}
                            </select>
                        </label>
                    </div>

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
                                    className="glass-panel dashboard-history-card"
                                    style={{ padding: '1.25rem', cursor: 'pointer', transition: 'transform 0.2s' }}
                                    onClick={() => navigate('/result', {
                                        state: {
                                            result: {
                                                id: result.id,
                                                score: result.score,
                                                maxScore: result.max_score,
                                                passProbability: result.pass_probability,
                                                weakness_analysis: result.weakness_analysis,
                                                question_feedback: result.question_feedback,
                                                section_scores: result.section_scores,
                                                rawScore: result.answers?.rawScore,
                                                rawMaxScore: result.answers?.rawMaxScore,
                                                compressedScore: result.answers?.compressedScore,
                                                compressedMaxScore: result.answers?.compressedMaxScore,
                                                scoreCompression: result.answers?.scoreCompression || null,
                                                scoreCap: result.answers?.scoreCap || null
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
                                    <div className="dashboard-history-card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
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
                                        <div className="dashboard-history-score" style={{ textAlign: 'right', flexShrink: 0 }}>
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
                            {totalPages > 1 && (
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    gap: '0.75rem',
                                    flexWrap: 'wrap',
                                    marginTop: '0.5rem'
                                }}>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        disabled={currentPage <= 1}
                                        onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
                                        style={{ opacity: currentPage <= 1 ? 0.45 : 1, cursor: currentPage <= 1 ? 'not-allowed' : 'pointer' }}
                                    >
                                        前へ
                                    </button>
                                    <span style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: 800 }}>
                                        {currentPage} / {totalPages}ページ
                                    </span>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        disabled={currentPage >= totalPages}
                                        onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
                                        style={{ opacity: currentPage >= totalPages ? 0.45 : 1, cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}
                                    >
                                        次へ
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </>
            ) : (
                <>
                    {MARKETING_CONFIG.enableAdBanners && (
                        <AdBanner
                            slot="mypage_history_lock"
                            pageTarget="dashboard"
                            variant="lock_cta"
                            context={adContext}
                            audience={currentPlan}
                            className="mb-4"
                        />
                    )}
                    <PremiumLockCard
                        title="過去履歴を開放する"
                        description="採点結果、受験回数、成績推移を保存して、後から復習に使えます。"
                        features={['過去履歴', '成績推移']}
                        buttonLabel="プレミアムで履歴を見る"
                        onClick={() => navigate('/premium')}
                    />
                </>
            )}
        </div>
    )
}

export default DashboardPage
