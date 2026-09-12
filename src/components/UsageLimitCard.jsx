import ConsultationCTA from './ConsultationCTA';
import { getUsagePlanLabel } from '../services/usageLimitService';
import { MARKETING_CONFIG } from '../config/marketingConfig';

const UsageLimitCard = ({
    usage,
    loading = false,
    compact = false,
    showConsultationCta = false,
    onConsultationClick,
    onPremiumClick
}) => {
    if (loading) {
        return (
            <div className="glass-panel" style={{ padding: compact ? '1rem' : '1.25rem', marginBottom: '1.5rem' }}>
                <p style={{ margin: 0, color: '#64748b' }}>採点回数を確認中...</p>
            </div>
        );
    }

    if (!usage) return null;

    const isUnlimited = usage.limit === null;
    const reached = !isUnlimited && usage.remaining <= 0;
    const percent = isUnlimited ? 100 : Math.min(100, Math.round((usage.used / usage.limit) * 100));

    return (
        <div
            className="glass-panel"
            style={{
                padding: compact ? '1rem' : '1.25rem',
                marginBottom: '1.5rem',
                border: reached ? '1px solid #f59e0b' : '1px solid var(--color-silver-light)',
                background: reached ? '#fffbeb' : '#fff'
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>
                        MONTHLY GRADING LIMIT
                    </div>
                    <h3 style={{ margin: 0, fontSize: compact ? '1rem' : '1.15rem', color: '#0f172a' }}>
                        {getUsagePlanLabel(usage.plan)}の採点回数
                    </h3>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: compact ? '1.4rem' : '1.8rem', fontWeight: 800, color: reached ? '#b45309' : 'var(--color-accent-primary)' }}>
                        {isUnlimited ? '無制限' : `残り${usage.remaining}回`}
                    </div>
                    {!isUnlimited && (
                        <div style={{ color: '#64748b', fontSize: '0.85rem' }}>
                            今月 {usage.used}/{usage.limit} 回使用
                        </div>
                    )}
                </div>
            </div>

            {!isUnlimited && (
                <div style={{ marginTop: '1rem', height: '8px', background: '#e5e7eb', borderRadius: '999px', overflow: 'hidden' }}>
                    <div
                        style={{
                            width: `${percent}%`,
                            height: '100%',
                            background: reached ? '#f59e0b' : 'var(--color-accent-primary)',
                            transition: 'width 0.2s ease'
                        }}
                    />
                </div>
            )}

            {reached && (
                <p style={{ margin: '0.9rem 0 0', color: '#92400e', fontWeight: 600 }}>
                    今月の無料採点回数を使い切りました。プレミアムなら採点回数を気にせず利用できます。
                </p>
            )}

            {reached && onPremiumClick && (
                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={onPremiumClick}
                        style={{ padding: compact ? '0.55rem 1rem' : '0.7rem 1.25rem' }}
                    >
                        プレミアムで無制限に採点する
                    </button>
                </div>
            )}

            {MARKETING_CONFIG.enableConsultation && reached && showConsultationCta && (
                <div style={{ marginTop: '1rem' }}>
                    <ConsultationCTA
                        variant="compact"
                        title="診断結果を基にプロ講師に答案相談"
                        description="上限到達後も、採点結果や志望校に合わせて次の復習方針を相談できます。"
                        buttonLabel="答案相談を申し込む"
                        note=""
                        points={[]}
                        onClick={onConsultationClick}
                    />
                </div>
            )}
        </div>
    );
};

export default UsageLimitCard;
