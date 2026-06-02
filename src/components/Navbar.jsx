import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { isAdminEmail } from '../config/adminConfig';
import { signOut } from '../services/authService';
import { getAnnouncements } from '../services/announcementService';
import FeedbackForm from './FeedbackForm';

const Navbar = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [showAnnouncements, setShowAnnouncements] = useState(false);
    const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
    const [announcementsData, setAnnouncementsData] = useState([]);
    const [readIds, setReadIds] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('read_announcement_ids') || '[]');
        } catch {
            return [];
        }
    });
    const navigate = useNavigate();
    const { profile, user } = useAuth();

    React.useEffect(() => {
        const fetchA = async () => {
            const { data } = await getAnnouncements();
            if (data) setAnnouncementsData(data);
        };
        fetchA();
    }, []);

    const toggleMenu = () => setIsOpen(!isOpen);
    
    // Check if there are any announcements marked is_new that are NOT in the readIds list
    const hasNewAnnouncements = announcementsData.some(a => a.is_new && !readIds.includes(a.id));

    const toggleAnnouncements = () => {
        setShowAnnouncements(!showAnnouncements);
        if (isOpen) setIsOpen(false);
    };

    const markAsRead = (id) => {
        if (readIds.includes(id)) return;
        const newReadIds = [...readIds, id];
        setReadIds(newReadIds);
        localStorage.setItem('read_announcement_ids', JSON.stringify(newReadIds));
    };

    const markAllAsRead = () => {
        const allIds = announcementsData.map(a => a.id);
        setReadIds(allIds);
        localStorage.setItem('read_announcement_ids', JSON.stringify(allIds));
    };

    return (
        <nav style={{
            background: '#ffffff',
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
                        borderRadius: '2px',
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

                    <button 
                        onClick={() => setIsFeedbackModalOpen(true)}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--color-text-primary)',
                            fontFamily: 'inherit',
                            fontWeight: '500',
                            fontSize: '1rem'
                        }}
                    >
                        お問い合わせ
                    </button>
                    <Link to="/terms" style={{ fontFamily: 'inherit', fontWeight: '500', color: 'var(--color-text-primary)', fontSize: '1rem' }}>利用規約</Link>
                    <Link to="/privacy" style={{ fontFamily: 'inherit', fontWeight: '500', color: 'var(--color-text-primary)', fontSize: '1rem' }}>プライバシーポリシー</Link>

                    {/* Announcements Icon (Desktop) */}
                    <div style={{ position: 'relative' }}>
                        <button 
                            onClick={toggleAnnouncements}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--color-navy-blue)',
                                display: 'flex',
                                alignItems: 'center',
                                padding: '0.5rem',
                                position: 'relative'
                            }}
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                                <polyline points="22,6 12,13 2,6"></polyline>
                            </svg>
                            {hasNewAnnouncements && (
                                <span style={{
                                    position: 'absolute',
                                    top: '4px',
                                    right: '4px',
                                    width: '10px',
                                    height: '10px',
                                    backgroundColor: '#ef4444',
                                    borderRadius: '50%',
                                    border: '2px solid white'
                                }} />
                            )}
                        </button>
                    </div>

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

            {/* Announcements Dropdown */}
            {showAnnouncements && (
                <div className="navbar-announcements-dropdown" style={{
                    position: 'absolute',
                    top: '70px',
                    right: '1.5rem',
                    width: '350px',
                    maxHeight: '400px',
                    overflowY: 'auto',
                    background: 'var(--color-bg-primary)',
                    borderRadius: '2px',
                    boxShadow: 'var(--shadow-card)',
                    border: '1px solid var(--border-glass)',
                    zIndex: 1001,
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: '0.5rem' }}>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-navy-blue)' }}>お知らせ</h3>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            {announcementsData.some(a => a.is_new && !readIds.includes(a.id)) && (
                                <button 
                                    onClick={markAllAsRead}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: 'var(--color-accent-primary)',
                                        fontSize: '0.75rem',
                                        cursor: 'pointer',
                                        fontWeight: 'bold',
                                        padding: '0.25rem 0.5rem',
                                    }}
                                >
                                    すべて既読にする
                                </button>
                            )}
                            <button onClick={() => setShowAnnouncements(false)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#888' }}>&times;</button>
                        </div>
                    </div>
                    {announcementsData.length === 0 ? (
                        <p style={{ color: '#666', textAlign: 'center', margin: '1rem 0' }}>現在お知らせはありません</p>
                    ) : (
                        announcementsData.map(item => {
                            const isUnread = item.is_new && !readIds.includes(item.id);
                            return (
                                <div 
                                    key={item.id} 
                                    onClick={() => markAsRead(item.id)}
                                    style={{ 
                                        padding: '1rem 0.5rem', 
                                        background: 'transparent',
                                        borderBottom: '1px solid var(--border-glass)',
                                        cursor: 'pointer',
                                        position: 'relative',
                                        transition: 'background 0.2s',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.25rem'
                                    }}
                                    onMouseOver={e => e.currentTarget.style.background = 'var(--color-bg-secondary)'}
                                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            <span style={{ 
                                                fontSize: '0.7rem', 
                                                fontWeight: 'bold', 
                                                color: 'var(--color-text-secondary)',
                                                border: '1px solid var(--color-silver)',
                                                padding: '0.1rem 0.4rem',
                                                borderRadius: '2px'
                                            }}>
                                                {item.type === 'feature' ? '新機能' : item.type === 'event' ? 'イベント' : '更新情報'}
                                            </span>
                                            {isUnread && (
                                                <span style={{
                                                    width: '6px',
                                                    height: '6px',
                                                    backgroundColor: 'var(--color-accent-primary)',
                                                    borderRadius: '50%'
                                                }} />
                                            )}
                                        </div>
                                        <span style={{ fontSize: '0.75rem', color: '#888' }}>{item.date}</span>
                                    </div>
                                    <h4 style={{ margin: '0.25rem 0', fontSize: '0.95rem', color: isUnread ? 'var(--color-accent-primary)' : '#333', fontWeight: isUnread ? 'bold' : 'normal' }}>
                                        {item.title}
                                    </h4>
                                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#666', lineHeight: '1.4' }}>{item.content}</p>
                                    
                                    {isUnread && (
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.4rem' }}>
                                            <span style={{ fontSize: '0.7rem', color: 'var(--color-accent-primary)', fontWeight: 'bold' }}>✓ 既読にする</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}

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
                    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.06)'
                }}>
                    <Link to="/" onClick={toggleMenu} style={{ fontSize: '1.1rem', fontWeight: '600' }}>ホーム</Link>
                    
                    {/* Announcements Button (Mobile) */}
                    <button 
                        onClick={() => {
                            toggleMenu();
                            setShowAnnouncements(true);
                        }} 
                        style={{ 
                            fontSize: '1.1rem', 
                            fontWeight: '600', 
                            color: 'var(--color-text-primary)',
                            background: 'none',
                            border: 'none',
                            textAlign: 'left',
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            cursor: 'pointer'
                        }}
                    >
                        お知らせ
                        {hasNewAnnouncements && (
                            <span style={{
                                width: '8px',
                                height: '8px',
                                backgroundColor: '#ef4444',
                                borderRadius: '50%'
                            }} />
                        )}
                    </button>

                    {profile && (
                        <>
                            <Link to="/dashboard" onClick={toggleMenu} style={{ fontSize: '1.1rem', fontWeight: '600' }}>マイページ</Link>
                            <Link to="/weakness" onClick={toggleMenu} style={{ fontSize: '1.1rem', fontWeight: '600' }}>弱点分析</Link>
                        </>
                    )}
                    {(profile?.role === 'admin' || isAdminEmail(user?.email)) && (
                        <Link to="/admin" onClick={toggleMenu} style={{ fontSize: '1.1rem', fontWeight: '600', color: 'var(--color-accent-gold)' }}>管理者ページ</Link>
                    )}

                    <button 
                        onClick={() => {
                            toggleMenu();
                            setIsFeedbackModalOpen(true);
                        }} 
                        style={{ 
                            fontSize: '1.1rem', 
                            fontWeight: '500', 
                            fontFamily: 'inherit',
                            color: 'var(--color-text-primary)',
                            background: 'none',
                            border: 'none',
                            textAlign: 'left',
                            padding: 0,
                            cursor: 'pointer'
                        }}
                    >
                        お問い合わせ
                    </button>
                    <Link to="/terms" onClick={toggleMenu} style={{ fontFamily: 'inherit', fontSize: '1.1rem', fontWeight: '500', color: 'var(--color-text-primary)' }}>利用規約</Link>
                    <Link to="/privacy" onClick={toggleMenu} style={{ fontFamily: 'inherit', fontSize: '1.1rem', fontWeight: '500', color: 'var(--color-text-primary)' }}>プライバシーポリシー</Link>

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

            {/* Feedback Modal Overlay */}
            {isFeedbackModalOpen && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    zIndex: 2000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '1rem'
                }} onClick={() => setIsFeedbackModalOpen(false)}>
                    <div style={{ position: 'relative', width: '100%', maxWidth: '600px' }} onClick={e => e.stopPropagation()}>
                        <button 
                            onClick={() => setIsFeedbackModalOpen(false)}
                            style={{
                                position: 'absolute',
                                top: '15px',
                                right: '15px',
                                background: 'rgba(255, 255, 255, 0.8)',
                                border: 'none',
                                borderRadius: '50%',
                                width: '30px',
                                height: '30px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '1.5rem',
                                cursor: 'pointer',
                                color: '#333',
                                zIndex: 10,
                                boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
                            }}
                        >
                            &times;
                        </button>
                        <div style={{ maxHeight: '90vh', overflowY: 'auto', borderRadius: '2px' }}>
                            <FeedbackForm />
                        </div>
                    </div>
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
