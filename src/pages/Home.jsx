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
    const { user, loading } = useAuth();
    const navigate = useNavigate();
    const [universities, setUniversities] = useState([]);
    const [loadingUniversities, setLoadingUniversities] = useState(true);

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
            <header className="mobile-padding-sm" style={{ paddingTop: '2rem' }}>
                <div style={{ textAlign: 'center', marginBottom: '4rem', position: 'relative' }}>
                    <div className="hide-on-mobile" style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: '600px',
                        height: '600px',
                        background: 'radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%)',
                        zIndex: -1,
                        pointerEvents: 'none'
                    }} />

                    <div className="animate-slide-up" style={{
                        display: 'inline-block',
                        padding: '0.4rem 1rem',
                        background: 'var(--color-accent-primary)',
                        color: 'white',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                        fontWeight: '700',
                        marginBottom: '1rem',
                        letterSpacing: '0.1em'
                    }}>
                        私大の英語・社会の採点に特化
                    </div>
                    <br />
                    <h1 className="animate-slide-up hero-title" style={{
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
                    <div className="animate-slide-up delay-100" style={{ 
                        fontSize: '0.9rem', 
                        color: 'var(--color-text-secondary)', 
                        fontWeight: '700', 
                        letterSpacing: '0.05em',
                        marginBottom: '1.5rem' 
                    }}>
                        — 「スマートに採点」で、あなたの学習を加速する —
                    </div>
                    <p className="animate-slide-up delay-100" style={{
                        color: 'var(--color-text-secondary)',
                        fontSize: '1.05rem',
                        marginBottom: '2.5rem',
                        maxWidth: '800px',
                        marginLeft: 'auto',
                        marginRight: 'auto',
                        lineHeight: '1.8',
                        padding: '0 1rem'
                    }}>
                        志望校の過去問をAIが数秒で正確に採点、圧倒的な時短を実現します。<br className="hide-on-mobile" />
                        一人ひとりの弱点に寄り添う詳細なフィードバックで、合格への最短ルートをサポート。
                    </p>

                    <div className="animate-slide-up delay-200" style={{ display: 'flex', justifyContent: 'center', gap: '1rem', padding: '0 1rem' }}>
                        <button
                            className="btn btn-primary btn-mobile-full"
                            style={{ padding: '1rem 2.5rem', fontSize: '1.1rem', borderRadius: '50px' }}
                            onClick={() => {
                                const el = document.getElementById('university-list');
                                if (el) el.scrollIntoView({ behavior: 'smooth' });
                            }}
                        >
                            大学を選択して開始
                        </button>
                    </div>

                    {/* Banner Ad */}
                    <AdBanner pageTarget="home" className="mt-12 max-w-4xl mx-auto" />
                </div>

                <div className="grid-responsive" style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '1.5rem',
                    marginBottom: '6rem'
                }}>
                    <div className="glass-panel animate-fade-in delay-100" style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📝</div>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--color-text-primary)' }}>1. 過去問を解く</h3>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                            志望校の過去問を選択し、実際の試験と同じ形式で解答します。
                        </p>
                    </div>
                    <div className="glass-panel animate-fade-in delay-200" style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🤖</div>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--color-text-primary)' }}>2. AIが即座に採点</h3>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                            AIが解答を分析し、数秒で採点結果と詳細なフィードバックを提供します。
                        </p>
                    </div>
                    <div className="glass-panel animate-fade-in delay-300" style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>💬</div>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--color-text-primary)' }}>3. AI先生に質問</h3>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                            解説でわからなかった点は、チャットでAI先生に何度でも質問できます。
                        </p>
                    </div>
                    <div className="glass-panel animate-fade-in delay-300" style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📊</div>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--color-text-primary)' }}>4. 弱点を克服</h3>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                            苦手分野を特定し、あなただけの対策アドバイスで得点アップを狙います。
                        </p>
                    </div>
                </div>

                {/* Registration CTA */}
                {!user && (
                    <div className="glass-panel mobile-padding-sm" style={{
                        padding: '4rem 2rem',
                        textAlign: 'center',
                        marginBottom: '6rem',
                        background: '#ffffff',
                        borderTop: '4px solid var(--color-accent-primary)',
                        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.05)'
                    }}>
                        <h2 style={{ fontSize: '2.2rem', marginBottom: '1.5rem', color: 'var(--color-accent-primary)' }}>
                            学習データを保存して、<span className="hide-on-mobile" style={{ borderBottom: '2px solid var(--color-accent-primary)' }}>成長を可視化</span>しよう
                        </h2>
                        <p style={{ fontSize: '1.2rem', color: '#94a3b8', marginBottom: '3rem', maxWidth: '700px', margin: '0 auto 3rem', lineHeight: '1.8' }}>
                            無料の会員登録をすると、採点結果が自動で保存され、<br className="hide-on-mobile" />
                            過去の成績推移や詳細な分析レポートをいつでも確認できます。
                        </p>
                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                            <button
                                className="btn btn-primary btn-mobile-full"
                                onClick={openAuthModal}
                                style={{ padding: '1.2rem 3rem', fontSize: '1.2rem', borderRadius: '50px' }}
                            >
                                無料で会員登録
                            </button>
                        </div>
                    </div>
                )}
            </header>

            {/* Sticky Recruitment Banner */}
            <RecruitmentBanner sticky={true} />

            <h2 id="university-list" style={{ fontSize: '1.6rem', marginBottom: '2rem', textAlign: 'center', marginTop: '6rem' }}>
                対応大学一覧
            </h2>
            <div className="grid-responsive" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '1.5rem',
                paddingBottom: '350px' // Spacer to prevent sticky banner from covering bottom content
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
