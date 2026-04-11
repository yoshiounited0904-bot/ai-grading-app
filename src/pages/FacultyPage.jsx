import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getExamsForUniversity } from '../data/examRegistry';

const FacultyPage = () => {
    const { universityId, facultyId } = useParams();
    const navigate = useNavigate();
    const [university, setUniversity] = useState(null);
    const [faculty, setFaculty] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchFaculty = async () => {
            if (!universityId) return;
            const u = await getExamsForUniversity(universityId);
            const f = u?.faculties?.find(fac => fac.id === facultyId);

            setUniversity(u || null);
            setFaculty(f || null);
            setLoading(false);
        };
        fetchFaculty();
    }, [universityId, facultyId]);

    if (loading) {
        return <div className="container" style={{ textAlign: 'center', padding: '2rem' }}>読み込み中...</div>;
    }

    if (!university || !faculty) {
        return <div className="container">Faculty not found</div>;
    }

    return (
        <div className="container" style={{ maxWidth: '800px' }}>
            <header style={{ marginBottom: '3rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
                    {university.name}
                </div>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>{faculty.name}</h1>
                <p style={{ color: 'var(--color-text-secondary)' }}>受験する年度・科目を選択してください</p>
            </header>

            <div style={{ display: 'grid', gap: '1rem' }}>
                {faculty.exams && faculty.exams.map((exam, index) => (
                    <div key={exam.id || index} className="glass-panel" style={{ padding: '1.5rem' }}>
                        <div className="mobile-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                            <div style={{ flex: 1 }}>
                                <h3 style={{ fontSize: '1.1rem', marginBottom: '0.4rem' }}>
                                    {exam.year}年 {exam.subject}
                                </h3>
                                {exam.type === 'pdf' && (
                                    <span style={{
                                        fontSize: '0.75rem',
                                        background: '#e0f2fe',
                                        color: '#0369a1',
                                        padding: '0.2rem 0.6rem',
                                        borderRadius: '12px',
                                        fontWeight: '600'
                                    }}>
                                        PDF採点対応
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }} className="btn-mobile-full">
                                <button
                                    className="btn btn-secondary"
                                    style={{ flex: 1, whiteSpace: 'nowrap', fontSize: '0.85rem' }}
                                    onClick={() => {
                                        if (exam.type === 'pdf' && exam.pdfPath) {
                                            window.open(exam.pdfPath, '_blank');
                                        } else {
                                            alert('印刷可能なPDFがありません。');
                                        }
                                    }}
                                >
                                    問題
                                </button>
                                <button
                                    className="btn btn-primary"
                                    style={{ flex: 1, whiteSpace: 'nowrap', fontSize: '0.85rem' }}
                                    onClick={() => navigate(`/exam/${university.id}-${faculty.id}-${index}`, {
                                        state: {
                                            exam,
                                            universityName: university.name,
                                            universityId: university.id
                                        }
                                    })}
                                >
                                    解答する
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div style={{ marginTop: '3rem', textAlign: 'center' }}>
                <button className="btn btn-secondary" onClick={() => navigate(`/university/${universityId}`)}>
                    学部一覧に戻る
                </button>
            </div>
        </div>
    );
};

export default FacultyPage;
