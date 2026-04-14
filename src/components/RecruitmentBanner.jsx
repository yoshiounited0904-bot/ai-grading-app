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
        justifyContent: 'flex-start', // Ensure left alignment
        gap: '0.5rem', // Reduced gap between sections
        animation: 'slideUp 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
        borderRadius: '0',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(20px)',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%)',
    } : {
        marginTop: '4rem',
        padding: '3.5rem 2rem',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '3rem',
        width: '100%',
        maxWidth: '1100px',
        margin: '6rem auto',
        borderRadius: '32px',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
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
                border-radius: 8px !important;
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
                color: 'white',
                ...bannerStyle
            }}>
                {/* Decorative Elements */}
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    left: '-10%',
                    width: '40%',
                    height: '200%',
                    background: 'radial-gradient(circle, rgba(251, 191, 36, 0.05) 0%, transparent 70%)',
                    transform: 'rotate(-15deg)',
                    pointerEvents: 'none'
                }} />

                {/* Logo & Main Text Section */}
                <div className="banner-content" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.6rem',
                    zIndex: 1,
                    flex: 'none', // Changed from sticky ? '1.5' : 'none' to 'none'
                    minWidth: 'fit-content'
                }}>
                    <div className="banner-logo-text" style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.8rem',
                        marginBottom: '0.2rem'
                    }}>
                        <div style={{
                            background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
                            color: '#0f172a',
                            padding: '0.25rem 0.75rem',
                            borderRadius: '8px',
                            fontWeight: '900',
                            fontSize: sticky ? '0.9rem' : '1.1rem',
                            boxShadow: '0 4px 12px rgba(251, 191, 36, 0.4)'
                        }}>SE</div>
                        <span style={{
                            fontSize: sticky ? '1.1rem' : '1.6rem',
                            fontWeight: '800',
                            letterSpacing: '0.03em',
                            color: '#f8fafc'
                        }}>Success Edge</span>
                    </div>

                    <h3 style={{
                        fontSize: sticky ? '1.4rem' : '2.6rem',
                        fontWeight: '900',
                        margin: '0',
                        lineHeight: '1.1',
                        background: 'linear-gradient(to right, #fff, #e2e8f0)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent'
                    }}>
                        早慶GMARCH合格率 <span style={{ color: '#fbbf24', textShadow: '0 0 20px rgba(251, 191, 36, 0.3)' }}>140%</span>
                    </h3>

                    <div className="banner-sub-text" style={{
                        fontSize: sticky ? '1.1rem' : '1.4rem', // Increased font size
                        color: '#fbbf24',
                        fontWeight: '800',
                        marginTop: '0.4rem',
                        letterSpacing: '0.02em',
                        textShadow: '0 2px 4px rgba(0,0,0,0.3)',
                        background: 'linear-gradient(to right, #fbbf24, #f59e0b)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        display: 'inline-block'
                    }}>
                        どこまでも寄り添う異次元の指導力で<span style={{ borderBottom: '2px solid #fbbf24', paddingBottom: '2px' }}>”確信する合格へ”</span>
                    </div>
                </div>

                {/* LINE Section */}
                <div className="line-section" style={{
                    zIndex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1.5rem',
                    padding: sticky ? '1rem 2rem' : '2rem 3rem',
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '28px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    flex: 'none', // Changed from sticky ? '1' : 'none' to 'none' to prevent growing
                    margin: sticky ? '0' : '0', // Removed margin to stick to left
                    transition: 'all 0.3s ease',
                    boxShadow: '0 10px 30px rgba(0,0,0,0.2)'
                }}>
                    <div className="line-icon-wrapper" style={{ position: 'relative', flexShrink: 0 }}>
                        <img
                            src="/images/line-icon.png"
                            alt="LINE Icon"
                            style={{
                                width: sticky ? '52px' : '72px',
                                height: sticky ? '52px' : '72px',
                                borderRadius: '14px',
                                boxShadow: '0 8px 25px rgba(6, 199, 85, 0.3)'
                            }}
                        />
                        <div style={{
                            position: 'absolute',
                            top: '-6px',
                            right: '-6px',
                            width: '14px',
                            height: '14px',
                            background: '#06c755',
                            borderRadius: '50%',
                            border: '3px solid #1e293b',
                            boxShadow: '0 0 10px rgba(6, 199, 85, 0.5)'
                        }} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', flexGrow: 1 }}>
                        <div className="line-text-wrapper" style={{
                            fontSize: sticky ? '1rem' : '1.3rem',
                            fontWeight: '800',
                            color: '#fff',
                            whiteSpace: 'nowrap'
                        }}>
                            <span style={{ color: '#06c755', marginRight: '0.5rem' }}>●</span>
                            無料LINE合格戦略相談
                        </div>
                        <button
                            className="line-btn"
                            style={{
                                background: 'linear-gradient(135deg, #06c755 0%, #05b34c 100%)',
                                color: 'white',
                                border: 'none',
                                padding: sticky ? '0.6rem 1.5rem' : '0.8rem 2.2rem',
                                borderRadius: '14px',
                                fontSize: sticky ? '0.9rem' : '1rem',
                                fontWeight: '900',
                                cursor: 'pointer',
                                transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                                boxShadow: '0 6px 20px rgba(6, 199, 85, 0.4)',
                                whiteSpace: 'nowrap'
                            }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.transform = 'scale(1.05) translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 8px 25px rgba(6, 199, 85, 0.5)';
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.transform = 'scale(1) translateY(0)';
                                e.currentTarget.style.boxShadow = '0 6px 20px rgba(6, 199, 85, 0.4)';
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
                    justifyContent: 'flex-start' // Changed to flex-start
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <button
                            style={{
                                background: 'rgba(255, 255, 255, 0.08)',
                                color: '#fff',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                padding: sticky ? '0.6rem 1.5rem' : '0.8rem 2.2rem', // Slightly reduced padding for stacked layout
                                borderRadius: '14px',
                                fontSize: sticky ? '0.9rem' : '1rem',
                                fontWeight: '700',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                whiteSpace: 'nowrap',
                                textAlign: 'center'
                            }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                                e.currentTarget.style.transform = 'translateY(-2px)';
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                                e.currentTarget.style.transform = 'translateY(0)';
                            }}
                            onClick={() => window.open('https://www.success-edge.net/contact/', '_blank')}
                        >
                            お問い合わせ・資料請求はこちらから
                        </button>
                        <button
                            style={{
                                background: 'rgba(255, 255, 255, 0.08)',
                                color: '#fff',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                padding: sticky ? '0.6rem 1.5rem' : '0.8rem 2.2rem',
                                borderRadius: '14px',
                                fontSize: sticky ? '0.9rem' : '1rem',
                                fontWeight: '700',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                whiteSpace: 'nowrap',
                                textAlign: 'center'
                            }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                                e.currentTarget.style.transform = 'translateY(-2px)';
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                                e.currentTarget.style.transform = 'translateY(0)';
                            }}
                            onClick={() => window.open('https://www.success-edge.net/about/', '_blank')}
                        >
                            Success Edgeとは
                        </button>
                    </div>

                    <div style={{
                        height: sticky ? '100px' : '120px', // Further increased height
                        width: sticky ? '150px' : '180px', // Further increased width
                        borderRadius: '12px',
                        overflow: 'hidden',
                        boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255, 255, 255, 0.2)'
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
