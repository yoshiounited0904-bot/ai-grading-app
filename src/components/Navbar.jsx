import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { isAdminEmail } from '../config/adminConfig';
import { signOut } from '../services/authService';

const Navbar = () => {
    const [isOpen, setIsOpen] = useState(false);
    const navigate = useNavigate();
    const { profile, user } = useAuth();

    const toggleMenu = () => setIsOpen(!isOpen);

    return (
        <nav style={{
            background: 'var(--color-bg-glass)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid var(--color-silver-light)',
            position: 'sticky',
            top: 0,
            zIndex: 1000,
            height: '64px',
            display: 'flex',
            alignItems: 'center'
        }}>
            <div className="container" style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0 1.5rem',
                margin: '0 auto',
                width: '100%'
            }}>
                {/* Logo */}
                <Link to="/" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    textDecoration: 'none'
                }}>
                    <div style={{
                        width: '32px',
                        height: '32px',
                        background: 'var(--color-accent-primary)',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontWeight: 'bold',
                        fontSize: '1.2rem'
                    }}>
                        A
                    </div>
                    <span style={{
                        fontFamily: 'var(--font-heading)',
                        fontSize: '1.25rem',
                        fontWeight: '700',
                        color: 'var(--color-accent-primary)',
                        letterSpacing: '0.05em'
                    }}>
                        スマサイ
                    </span>
                </Link>

                {/* Desktop Navigation */}
                <div className="hide-on-mobile" style={{
                    display: 'flex',
                    gap: '2rem',
                    alignItems: 'center'
                }}>
                    <Link to="/" style={{ fontWeight: '600', color: 'var(--color-text-primary)' }}>ホーム</Link>
                    {profile && (
                        <Link to="/dashboard" style={{ fontWeight: '600', color: 'var(--color-text-primary)' }}>マイページ</Link>
                    )}
                    {(profile?.role === 'admin' || isAdminEmail(user?.email)) && (
                        <Link to="/admin" style={{ fontWeight: '600', color: 'var(--color-accent-gold)' }}>管理者ページ</Link>
                    )}

                    {profile ? (
                        <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.9rem', padding: '0.5rem 1rem', background: 'transparent', border: '1px solid var(--color-silver-light)' }}
                            onClick={async () => {
                                await signOut();
                                navigate('/');
                                window.location.reload();
                            }}
                        >
                            ログアウト
                        </button>
                    ) : (
                        <button
                            className="btn btn-primary"
                            style={{ fontSize: '0.9rem', padding: '0.5rem 1.25rem' }}
                            onClick={() => document.dispatchEvent(new CustomEvent('openAuthModal'))}
                        >
                            ログイン / 登録
                        </button>
                    )}
                </div>

                {/* Mobile Menu Toggle */}
                <button
                    className="mobile-only"
                    onClick={toggleMenu}
                    style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '0.5rem',
                        display: 'none' // Controlled by CSS .mobile-only
                    }}
                >
                    <div style={{
                        width: '24px',
                        height: '2px',
                        background: 'var(--color-accent-primary)',
                        marginBottom: '6px',
                        transition: '0.3s',
                        transform: isOpen ? 'rotate(45deg) translate(5px, 6px)' : 'none'
                    }} />
                    <div style={{
                        width: '24px',
                        height: '2px',
                        background: 'var(--color-accent-primary)',
                        marginBottom: '6px',
                        opacity: isOpen ? 0 : 1
                    }} />
                    <div style={{
                        width: '24px',
                        height: '2px',
                        background: 'var(--color-accent-primary)',
                        transition: '0.3s',
                        transform: isOpen ? 'rotate(-45deg) translate(5px, -6px)' : 'none'
                    }} />
                </button>
            </div>

            {/* Mobile Menu Overlay */}
            {isOpen && (
                <div style={{
                    position: 'fixed',
                    top: '64px',
                    left: 0,
                    right: 0,
                    background: 'white',
                    borderBottom: '1px solid var(--color-silver-light)',
                    padding: '1.5rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1.25rem',
                    zIndex: 999,
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                    animation: 'slideUp 0.3s ease-out'
                }}>
                    <Link to="/" onClick={toggleMenu} style={{ fontSize: '1.1rem', fontWeight: '600' }}>ホーム</Link>
                    {profile && (
                        <>
                            <Link to="/dashboard" onClick={toggleMenu} style={{ fontSize: '1.1rem', fontWeight: '600' }}>マイページ</Link>
                            <Link to="/weakness" onClick={toggleMenu} style={{ fontSize: '1.1rem', fontWeight: '600' }}>弱点分析</Link>
                        </>
                    )}
                    {(profile?.role === 'admin' || isAdminEmail(user?.email)) && (
                        <Link to="/admin" onClick={toggleMenu} style={{ fontSize: '1.1rem', fontWeight: '600', color: 'var(--color-accent-gold)' }}>管理者ページ</Link>
                    )}

                    {profile ? (
                        <button
                            className="btn btn-secondary btn-mobile-full"
                            style={{ background: 'transparent', border: '1px solid var(--color-silver-light)', marginTop: '1rem' }}
                            onClick={async () => {
                                await signOut();
                                toggleMenu();
                                navigate('/');
                                window.location.reload();
                            }}
                        >
                            ログアウト
                        </button>
                    ) : (
                        <button
                            className="btn btn-primary btn-mobile-full"
                            onClick={() => {
                                document.dispatchEvent(new CustomEvent('openAuthModal'));
                                toggleMenu();
                            }}
                        >
                            ログイン / 無料登録
                        </button>
                    )}
                </div>
            )}

            <style>{`
        @media (max-width: 768px) {
          .mobile-only {
            display: block !important;
          }
        }
      `}</style>
        </nav>
    );
};

export default Navbar;
