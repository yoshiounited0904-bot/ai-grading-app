import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import UniversityCard from '../components/UniversityCard';
import { getUniversityList } from '../data/examRegistry';
import UniversitySkeleton from '../components/UniversitySkeleton';
import { useAuth } from '../contexts/AuthContext';
import { signOut } from '../services/authService';
import RecruitmentBanner from '../components/RecruitmentBanner';
import AdBanner from '../components/AdBanner';

const Home = () => {
    const { user, profile, loading } = useAuth();
    console.log('Home Render auth state:', { user, profile, loading });
    const navigate = useNavigate();
    const [universities, setUniversities] = useState([]);
    const [loadingUniversities, setLoadingUniversities] = useState(true);

    const displayName = profile?.username || user?.user_metadata?.username || user?.email?.split('@')[0] || 'ユーザー';
    const displayInitial = displayName.charAt(0).toUpperCase();

    useEffect(() => {
        const fetchUniversities = async () => {
            const data = await getUniversityList();
            setUniversities(data);
            setLoadingUniversities(false);
        };
        fetchUniversities();
    }, []);

    const openAuthModal = () => {
        document.dispatchEvent(new CustomEvent('openAuthModal'));
    };

    return (
        <div className="container">
            {user && (
                <div className="mobile-padding-sm" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    textAlign: 'left',
                    paddingTop: '1.5rem',
                    paddingLeft: '0.5rem',
                    marginBottom: '-0.5rem'
                }}>
                    <div style={{
                        width: '32px',
                        height: '32px',
                        background: 'linear-gradient(135deg, var(--color-accent-primary) 0%, #3b82f6 100%)',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontWeight: '800',
                        fontSize: '0.9rem',
                        boxShadow: '0 4px 10px rgba(15, 23, 42, 0.15)',
                        border: '2px solid white'
                    }}>
                        {displayInitial}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                        <span style={{
                            fontSize: '0.95rem',
                            fontWeight: '800',
                            color: 'var(--color-navy-blue)',
                            lineHeight: '1.2'
                        }}>
                            {displayName} さん
                        </span>
                        <span style={{
                            fontSize: '0.7rem',
                            color: '#64748b',
                            fontWeight: '600'
                        }}>
                            ログイン中
                        </span>
                    </div>
                </div>
            )}
            <header className="mobile-padding-sm" style={{ paddingTop: '2rem' }}>
                <div style={{ textAlign: 'center', marginBottom: '3rem', position: 'relative' }}>
                    <div style={{
                        display: 'inline-block',
                        padding: '0.4rem 1rem',
                        background: 'var(--color-accent-primary)',
                        color: 'white',
                        borderRadius: '2px',
                        fontSize: '0.8rem',
                        fontWeight: '700',
                        marginBottom: '1rem',
                        letterSpacing: '0.1em'
                    }}>
                        私大の英語・社会の採点に特化
                    </div>
                    <br />
                    <h1 className="hero-title" style={{
                        color: 'var(--color-accent-primary)',
                        marginBottom: '0.5rem',
                        fontWeight: '900',
                        letterSpacing: '0.05em',
                        fontFamily: 'var(--font-heading)',
                        borderBottom: '2px solid var(--color-silver-light)',
                        display: 'inline-block',
                        paddingBottom: '0.5rem'
                    }}>
                        スマサイ
                    </h1>
                    <div style={{ 
                        fontSize: '0.9rem', 
                        color: 'var(--color-text-secondary)', 
                        fontWeight: '700', 
                        letterSpacing: '0.05em',
                        marginBottom: '1.5rem' 
                    }}>
                        — 「スマートに採点」で、あなたの学習を加速する —
                    </div>
                    <p style={{
                        color: 'var(--color-text-secondary)',
                        fontSize: '1.05rem',
                        marginBottom: '2rem',
                        maxWidth: '800px',
                        marginLeft: 'auto',
                        marginRight: 'auto',
                        lineHeight: '1.8',
                        padding: '0 0.5rem'
                    }}>
                        志望校の過去問を自動採点システムが数秒で正確に採点、圧倒的な時短を実現します。<br className="hide-on-mobile" />
                        一人ひとりの弱点に寄り添う詳細なフィードバックで、合格への最短ルートをサポート。
                    </p>

                    <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', padding: '0 1rem' }}>
                        <button
                            className="btn btn-primary btn-mobile-full"
                            style={{ padding: '1rem 2.5rem', fontSize: '1.1rem' }}
                            onClick={() => {
                                const el = document.getElementById('university-list');
                                if (el) el.scrollIntoView({ behavior: 'smooth' });
                            }}
                        >
                            大学を選択して開始
                        </button>
                    </div>

                    {/* Banner Ad */}
                    <AdBanner pageTarget="home" className="mt-6 md:mt-12 max-w-4xl mx-auto" />
                </div>

                {/* Steps Grid */}
                <div className="home-steps-grid" style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '1rem',
                    marginBottom: '4rem'
                }}>
                    {[
                        { step: '01', title: '過去問を解く', desc: '志望校の過去問を選択し、実際の試験と同じ形式で解答します。' },
                        { step: '02', title: '瞬時に自動採点', desc: 'システムが解答を分析し、数秒で採点結果と詳細なフィードバックを提供します。' },
                        { step: '03', title: 'チャットで質問', desc: '解説でわからなかった点は、チャットでいつでも質問できます。' },
                        { step: '04', title: '弱点を克服', desc: '苦手分野を特定し、あなただけの対策アドバイスで得点アップを狙います。' },
                    ].map(({ step, title, desc }) => (
                        <div key={step} className="glass-panel" style={{ padding: '1.5rem 1rem', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.15em', color: 'var(--color-accent-primary)', marginBottom: '0.75rem' }}>STEP {step}</div>
                            <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', color: 'var(--color-text-primary)' }}>{title}</h3>
                            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', lineHeight: '1.6', margin: 0 }}>
                                {desc}
                            </p>
                        </div>
                    ))}
                </div>

                {/* Registration CTA */}
                {!user && (
                    <div className="glass-panel" style={{
                        padding: '3rem 1.5rem',
                        textAlign: 'center',
                        marginBottom: '4rem',
                        background: '#ffffff',
                        borderTop: '4px solid var(--color-accent-primary)',
                        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.05)'
                    }}>
                        <h2 style={{ marginBottom: '1.5rem', color: 'var(--color-accent-primary)', lineHeight: '1.4' }}>
                            学習データを保存して、成長を可視化しよう
                        </h2>
                        <p style={{ fontSize: '1rem', color: '#94a3b8', marginBottom: '2rem', maxWidth: '700px', marginLeft: 'auto', marginRight: 'auto', lineHeight: '1.8' }}>
                            無料の会員登録をすると、採点結果が自動で保存され、<br className="hide-on-mobile" />
                            過去の成績推移や詳細な分析レポートをいつでも確認できます。
                        </p>
                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                            <button
                                className="btn btn-primary btn-mobile-full"
                                onClick={openAuthModal}
                                style={{ padding: '1rem 2.5rem', fontSize: '1.1rem' }}
                            >
                                無料で会員登録
                            </button>
                        </div>
                    </div>
                )}
            </header>

            {/* Sticky Recruitment Banner */}
            <RecruitmentBanner sticky={true} />

            <h2 id="university-list" style={{ marginBottom: '1.5rem', textAlign: 'center', marginTop: '4rem' }}>
                対応大学一覧
            </h2>
            <div className="grid-responsive" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '1.5rem',
                paddingBottom: '350px'
            }}>
                {loadingUniversities ? (
                    Array.from({ length: 6 }).map((_, i) => (
                        <UniversitySkeleton key={i} />
                    ))
                ) : universities.length === 0 ? (
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: '#888' }}>
                        大学データが見つかりません。
                    </div>
                ) : (
                    universities.map(uni => (
                        <UniversityCard key={uni.id} university={uni} />
                    ))
                )}
            </div>
        </div>
    );
};

export default Home;
