import React from 'react';

const RecruitmentBanner = ({ sticky = false }) => {
    const bannerStyle = sticky ? {
        position: 'fixed',
        bottom: '0',
        left: '0',
        width: '100%',
        zIndex: 1000,
        padding: '1.2rem 3rem',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: '0.5rem',
        animation: 'slideUp 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
        borderRadius: '0',
        borderTop: '2px solid var(--color-accent-primary)',
        background: '#ffffff',
        color: 'var(--color-text-primary)',
    } : {
        marginTop: '4rem',
        padding: '3.5rem 2rem',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '3rem',
        width: '100%',
        maxWidth: '1100px',
        margin: '6rem auto',
        borderRadius: '2px',
        background: 'var(--color-bg-primary)',
        border: '1px solid var(--border-glass)',
        boxShadow: 'var(--shadow-card)',
        color: 'var(--color-text-primary)',
    };

    return (
        <>
            {sticky && (
                <style>
                    {`
            @keyframes slideUp {
              from { transform: translateY(100%); opacity: 0; }
              to { transform: translateY(0); opacity: 1; }
            }
            @media (max-width: 600px) {
              .recruitment-banner {
                flex-direction: row !important;
                padding: 0.6rem 1rem !important;
                gap: 0.8rem !important;
                height: 64px !important;
                align-items: center !important;
              }
              .banner-content h3 {
                font-size: 0.9rem !important;
              }
              .banner-content .banner-logo-text {
                display: none !important;
              }
              .banner-content .banner-sub-text {
                display: none !important;
              }
              .line-section {
                padding: 0 !important;
                background: none !important;
                border: none !important;
                box-shadow: none !important;
                flex: 1 !important;
                justify-content: flex-end !important;
              }
              .line-icon-wrapper {
                display: none !important;
              }
              .line-text-wrapper {
                display: none !important;
              }
              .line-btn {
                padding: 0.5rem 1rem !important;
                font-size: 0.75rem !important;
                border-radius: 2px !important;
              }
              .cta-section {
                display: none !important;
              }
            }
          `}
                </style>
            )}
            <div className={`recruitment-banner`} style={{
                display: 'flex',
                position: 'relative',
                overflow: 'hidden',
                ...bannerStyle
            }}>
                {/* Logo & Main Text Section */}
                <div className="banner-content" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.6rem',
                    zIndex: 1,
                    flex: 'none',
                    minWidth: 'fit-content'
                }}>
                    <div className="banner-logo-text" style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.8rem',
                        marginBottom: '0.2rem'
                    }}>
                        <div style={{
                            background: '#fbbf24',
                            color: '#0f172a',
                            padding: '0.25rem 0.75rem',
                            borderRadius: '2px',
                            fontWeight: '900',
                            fontSize: sticky ? '0.9rem' : '1.1rem',
                            border: '1px solid #d97706'
                        }}>SE</div>
                        <span style={{
                            fontSize: sticky ? '1.1rem' : '1.6rem',
                            fontWeight: '800',
                            letterSpacing: '0.03em',
                            color: 'var(--color-text-primary)'
                        }}>Success Edge</span>
                    </div>

                    <h3 style={{
                        fontSize: sticky ? '1.4rem' : '2.6rem',
                        fontWeight: '900',
                        margin: '0',
                        lineHeight: '1.1',
                        color: 'var(--color-text-primary)'
                    }}>
                        早慶GMARCH合格率 <span style={{ color: 'var(--color-accent-primary)' }}>140%</span>
                    </h3>

                    <div className="banner-sub-text" style={{
                        fontSize: sticky ? '1.1rem' : '1.4rem',
                        color: 'var(--color-accent-primary)',
                        fontWeight: '800',
                        marginTop: '0.4rem',
                        letterSpacing: '0.02em',
                        display: 'inline-block'
                    }}>
                        どこまでも寄り添う異次元の指導力で<span style={{ borderBottom: '2px solid var(--color-accent-primary)', paddingBottom: '2px' }}>”確信する合格へ”</span>
                    </div>
                </div>

                {/* LINE Section */}
                <div className="line-section" style={{
                    zIndex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1.5rem',
                    padding: sticky ? '1rem 2rem' : '2rem 3rem',
                    background: 'var(--color-bg-secondary)',
                    borderRadius: '2px',
                    border: '1px solid var(--border-glass)',
                    flex: 'none',
                    margin: sticky ? '0' : '0',
                    transition: 'all 0.3s ease',
                }}>
                    <div className="line-icon-wrapper" style={{ position: 'relative', flexShrink: 0 }}>
                        <img
                            src="/images/line-icon.png"
                            alt="LINE Icon"
                            style={{
                                width: sticky ? '52px' : '72px',
                                height: sticky ? '52px' : '72px',
                                borderRadius: '2px',
                            }}
                        />
                        <div style={{
                            position: 'absolute',
                            top: '-3px',
                            right: '-3px',
                            width: '10px',
                            height: '10px',
                            background: '#06c755',
                            borderRadius: '2px',
                            border: '2px solid #1e293b'
                        }} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', flexGrow: 1 }}>
                        <div className="line-text-wrapper" style={{
                            fontSize: sticky ? '1rem' : '1.3rem',
                            fontWeight: '800',
                            color: 'var(--color-text-primary)',
                            whiteSpace: 'nowrap'
                        }}>
                            <span style={{ color: '#06c755', marginRight: '0.5rem' }}>■</span>
                            無料LINE合格戦略相談
                        </div>
                        <button
                            className="line-btn"
                            style={{
                                background: '#06c755',
                                color: 'white',
                                border: 'none',
                                padding: sticky ? '0.6rem 1.5rem' : '0.8rem 2.2rem',
                                borderRadius: '2px',
                                fontSize: sticky ? '0.9rem' : '1rem',
                                fontWeight: '900',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap'
                            }}
                            onClick={() => window.open('https://lin.ee/ihaPWfv', '_blank')}
                        >
                            友だち追加して相談する
                        </button>
                    </div>
                </div>

                {/* CTA Button Section */}
                <div className="cta-section" style={{
                    zIndex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    minWidth: '160px',
                    justifyContent: 'flex-start'
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <button
                            style={{
                                background: 'var(--color-bg-primary)',
                                color: 'var(--color-text-primary)',
                                border: '1px solid var(--border-glass)',
                                padding: sticky ? '0.6rem 1.5rem' : '0.8rem 2.2rem',
                                borderRadius: '2px',
                                fontSize: sticky ? '0.9rem' : '1rem',
                                fontWeight: '700',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                whiteSpace: 'nowrap',
                                textAlign: 'center'
                            }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.background = 'var(--color-bg-secondary)';
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.background = 'var(--color-bg-primary)';
                            }}
                            onClick={() => window.open('https://www.success-edge.net/contact/', '_blank')}
                        >
                            お問い合わせ・資料請求はこちらから
                        </button>
                        <button
                            style={{
                                background: 'var(--color-bg-primary)',
                                color: 'var(--color-text-primary)',
                                border: '1px solid var(--border-glass)',
                                padding: sticky ? '0.6rem 1.5rem' : '0.8rem 2.2rem',
                                borderRadius: '2px',
                                fontSize: sticky ? '0.9rem' : '1rem',
                                fontWeight: '700',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                textAlign: 'center'
                            }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.background = 'var(--color-bg-secondary)';
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.background = 'var(--color-bg-primary)';
                            }}
                            onClick={() => window.open('https://www.success-edge.net/about/', '_blank')}
                        >
                            Success Edgeとは
                        </button>
                    </div>

                    <div style={{
                        height: sticky ? '100px' : '120px',
                        width: sticky ? '150px' : '180px',
                        borderRadius: '2px',
                        overflow: 'hidden',
                        border: '1px solid var(--border-glass)'
                    }}>
                        <img
                            src="/images/student-writing.jpg"
                            alt="Student Writing"
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover'
                            }}
                        />
                    </div>
                </div>
            </div>
        </>
    );
};

export default RecruitmentBanner;
