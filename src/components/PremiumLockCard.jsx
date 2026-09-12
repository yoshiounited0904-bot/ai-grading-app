const PremiumLockCard = ({
    title = 'プレミアム機能です',
    description = 'この機能はプレミアムプランで利用できます。',
    features = [],
    buttonLabel = 'プレミアムプランを見る',
    onClick
}) => (
    <div
        className="glass-panel"
        style={{
            padding: '1.5rem',
            border: '1px solid #facc15',
            background: 'linear-gradient(135deg, #fffbeb 0%, #ffffff 70%)',
            marginBottom: '1.5rem'
        }}
    >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '240px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#b45309', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                    PREMIUM
                </div>
                <h3 style={{ margin: '0 0 0.5rem', color: '#0f172a', fontSize: '1.15rem' }}>{title}</h3>
                <p style={{ margin: 0, color: '#64748b', lineHeight: 1.7 }}>{description}</p>
                {features.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                        {features.map((feature) => (
                            <span
                                key={feature}
                                style={{
                                    fontSize: '0.78rem',
                                    fontWeight: 700,
                                    color: '#92400e',
                                    background: '#fef3c7',
                                    border: '1px solid #fde68a',
                                    padding: '0.25rem 0.55rem',
                                    borderRadius: '999px'
                                }}
                            >
                                {feature}
                            </span>
                        ))}
                    </div>
                )}
            </div>
            {onClick && (
                <button
                    type="button"
                    className="btn btn-primary"
                    onClick={onClick}
                    style={{ whiteSpace: 'nowrap' }}
                >
                    {buttonLabel}
                </button>
            )}
        </div>
    </div>
);

export default PremiumLockCard;
