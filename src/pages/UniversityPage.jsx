import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getExamsForUniversity } from '../data/examRegistry';
import { SUBJECT_DISPLAY_ORDER } from '../config/subjectConfig';

const isProductionExam = (exam) => exam?.master_status === 'production' || exam?.originalExam?.master_status === 'production';

const ProductionBadge = ({ compact = false }) => (
    <div
        style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.25rem',
            color: '#b91c1c',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '999px',
            fontSize: compact ? '0.62rem' : '0.68rem',
            fontWeight: 800,
            lineHeight: 1.2,
            padding: compact ? '0.16rem 0.42rem' : '0.2rem 0.5rem',
            whiteSpace: 'nowrap'
        }}
        title="本番用として確認済み。採点基準・解説の整備が進んでおり、採点精度が高い問題です。"
    >
        高精度
    </div>
);

const FACULTY_BASE_ORDER_BY_UNIVERSITY = {
    '慶應義塾大学': ['文', '経済', '法', '商', '医', '理工', '総合政策', '環境情報', '看護医療', '薬'],
    '早稲田大学': ['政治経済', '法', '文化構想', '文', '教育', '商', '基幹理工', '創造理工', '先進理工', '社会科学', '人間科学', 'スポーツ科学', '国際教養'],
    '青山学院大学': ['文', '教育人間科学', '経済', '法', '経営', '国際政治経済', '総合文化政策', '理工', '社会情報', '地球社会共生', 'コミュニティ人間科学'],
    '中央大学': ['法', '経済', '商', '理工', '文', '総合政策', '国際経営', '国際情報'],
    '明治大学': ['法', '商', '政治経済', '文', '理工', '農', '経営', '情報コミュニケーション', '国際日本', '総合数理'],
    '法政大学': ['法', '文', '経営', '国際文化', '人間環境', 'キャリアデザイン', 'デザイン工', 'GIS', '経済', '社会', '現代福祉', 'スポーツ健康', '情報科', '理工', '生命科'],
    '立教大学': ['文', '異文化コミュニケーション', '経済', '経営', '理', '社会', '法', '観光', 'コミュニティ福祉', '現代心理', 'スポーツウエルネス']
};

const normalizeOrderText = (value = '') => (
    String(value)
        .replace(/[（）]/g, (char) => (char === '（' ? '(' : ')'))
        .replace(/[／]/g, '/')
        .replace(/\s+/g, '')
);

const getFacultyBaseRank = (universityName = '', facultyName = '') => {
    const order = FACULTY_BASE_ORDER_BY_UNIVERSITY[universityName] || [];
    const normalizedFaculty = normalizeOrderText(facultyName);
    const index = order.findIndex(base => normalizedFaculty.startsWith(normalizeOrderText(base)));
    return index === -1 ? 999 : index;
};

const getFacultyVariantRank = (facultyName = '') => {
    const normalized = normalizeOrderText(facultyName);
    let rank = 0;

    if (/全学部|共通|統一/.test(normalized)) rank -= 30;
    if (/個別|学部別|一般/.test(normalized)) rank += 10;
    if (/A方式|A日程|A個別|A\)/.test(normalized)) rank += 1;
    if (/B方式|B日程|B個別|B\)/.test(normalized)) rank += 2;
    if (/C方式|C日程|C個別|C\)/.test(normalized)) rank += 3;
    if (/D方式|D日程|D個別|D\)/.test(normalized)) rank += 4;
    if (/前期/.test(normalized)) rank -= 5;
    if (/後期/.test(normalized)) rank += 20;

    return rank;
};

const sortFacultiesForDisplay = (faculties = [], universityName = '') => (
    [...faculties].sort((a, b) => {
        const aName = a?.name || '';
        const bName = b?.name || '';
        const baseDiff = getFacultyBaseRank(universityName, aName) - getFacultyBaseRank(universityName, bName);
        if (baseDiff !== 0) return baseDiff;

        const variantDiff = getFacultyVariantRank(aName) - getFacultyVariantRank(bName);
        if (variantDiff !== 0) return variantDiff;

        return aName.localeCompare(bName, 'ja');
    })
);

const UniversityPage = () => {
    const { universityId } = useParams();
    const navigate = useNavigate();
    const [university, setUniversity] = useState(null);
    const [loading, setLoading] = useState(true);

    // Modal state
    const [showSectionModal, setShowSectionModal] = useState(false);
    const [examToStart, setExamToStart] = useState(null);
    const [tempSelectedSections, setTempSelectedSections] = useState([]);

    useEffect(() => {
        const fetchUniversity = async () => {
            if (!universityId) return;
            const data = await getExamsForUniversity(universityId);
            setUniversity(data);
            setLoading(false);
        };
        fetchUniversity();
    }, [universityId]);

    const handleStartClick = (exam) => {
        // If the exam has sections, show the selection modal
        if (exam.originalExam.structure && exam.originalExam.structure.length > 1) {
            setExamToStart(exam);
            // Default to all sections selected
            setTempSelectedSections(exam.originalExam.structure.map(s => s.id));
            setShowSectionModal(true);
        } else {
            // If only 1 section, navigate directly as before
            navigate(`/exam/${universityId}-${exam.facultyId}-${exam.originalIndex}`, {
                state: {
                    exam: exam.originalExam,
                    universityName: university.name,
                    universityId: university.id,
                    facultyName: exam.facultyName,
                    selectedSectionIds: null // null means all
                }
            });
        }
    };

    const confirmStart = () => {
        if (tempSelectedSections.length === 0) {
            alert('少なくとも1つの大問を選択してください。');
            return;
        }
        setShowSectionModal(false);
        navigate(`/exam/${universityId}-${examToStart.facultyId}-${examToStart.originalIndex}`, {
            state: {
                exam: examToStart.originalExam,
                universityName: university.name,
                universityId: university.id,
                facultyName: examToStart.facultyName,
                selectedSectionIds: tempSelectedSections
            }
        });
    };

    if (loading) {
        return <div className="container" style={{ textAlign: 'center', padding: '2rem' }}>読み込み中...</div>;
    }

    if (!university) {
        return <div className="container">University not found</div>;
    }

    // Aggregate all exams from all faculties
    const allExams = [];
    if (university.faculties) {
        university.faculties.forEach(faculty => {
            if (faculty.exams) {
                faculty.exams.forEach((exam, index) => {
                    allExams.push({
                        ...exam,
                        facultyId: faculty.id,
                        facultyName: faculty.name,
                        originalExam: exam,
                        originalIndex: index,
                        uniqueId: `${faculty.id}-${exam.id || index}`
                    });
                });
            }
        });
    }

    // Extract unique years and subjects for the matrix
    const years = [...new Set(allExams.map(e => e.year))].sort((a, b) => b - a);
    const subjects = [...new Set(allExams.map(e => e.subject))].sort((a, b) => {
        const ai = SUBJECT_DISPLAY_ORDER.indexOf(a);
        const bi = SUBJECT_DISPLAY_ORDER.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b, 'ja');
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
    });

    return (
        <div className="container" style={{ maxWidth: '980px' }}>
            <header style={{ marginBottom: '2rem', marginTop: '1rem' }}>
                <h1 style={{ fontSize: '2rem', lineHeight: 1.3, marginBottom: '0.5rem' }}>
                    {university.name}
                </h1>
                <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7, margin: 0, fontSize: '0.95rem' }}>
                    学部・年度・科目を選択してください。
                </p>
            </header>

            {/* Exam Matrix View - Per Year */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
                {years.map(year => {
                    const facultiesForYear = sortFacultiesForDisplay(university.faculties, university.name).filter(faculty =>
                        allExams.some(exam => exam.year === year && exam.facultyId === faculty.id)
                    );

                    return (
                    <div key={year} className="glass-panel" style={{ padding: '1.25rem' }}>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', borderBottom: '2px solid var(--color-accent-primary)', paddingBottom: '0.5rem', display: 'inline-block' }}>
                            {year}年度
                        </h2>

                        {/* Desktop Matrix Table */}
                        <div className="hide-on-mobile" style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                                <thead>
                                    <tr>
                                        <th style={{ padding: '0.65rem 0.75rem', textAlign: 'left', borderBottom: '2px solid #e2e8f0', color: 'var(--color-text-secondary)', width: '180px', fontSize: '0.95rem' }}>
                                            学部 \ 科目
                                        </th>
                                        {subjects.map(subject => (
                                            <th key={subject} style={{ padding: '0.65rem 0.75rem', textAlign: 'center', borderBottom: '2px solid #e2e8f0', color: 'var(--color-text-primary)', fontSize: '0.95rem' }}>
                                                {subject}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {facultiesForYear.map(faculty => (
                                        <tr key={faculty.id}>
                                            <td style={{ padding: '0.65rem 0.75rem', fontWeight: '700', borderBottom: '1px solid #f1f5f9', color: 'var(--color-text-primary)', lineHeight: 1.35 }}>
                                                {faculty.name}
                                            </td>
                                            {subjects.map(subject => {
                                                const examsForCell = allExams.filter(e => e.year === year && e.subject === subject && e.facultyId === faculty.id);
                                                return (
                                                    <td key={`${faculty.id}-${subject}`} style={{ padding: '0.55rem 0.75rem', textAlign: 'center', borderBottom: '1px solid #f1f5f9' }}>
                                                        {examsForCell.length > 0 ? (
                                                            <div style={{ display: 'grid', gap: '0.65rem', justifyItems: 'center' }}>
                                                                {examsForCell.map((exam) => {
                                                                    const production = isProductionExam(exam);
                                                                    return (
                                                                        <div
                                                                            key={exam.uniqueId}
                                                                            style={{
                                                                                display: 'flex',
                                                                                flexDirection: 'column',
                                                                                alignItems: 'center',
                                                                                gap: '0.35rem',
                                                                                width: '100%'
                                                                            }}
                                                                        >
                                                                            {production && <ProductionBadge compact />}
                                                                            <button
                                                                                className="btn btn-primary"
                                                                                style={{
                                                                                    fontSize: '0.78rem',
                                                                                    padding: '0.38rem 0.9rem',
                                                                                    borderRadius: '2px',
                                                                                    width: '100%',
                                                                                    maxWidth: '108px',
                                                                                    boxShadow: production ? '0 0 0 3px rgba(185, 28, 28, 0.12)' : undefined,
                                                                                    border: production ? '1px solid #b91c1c' : undefined
                                                                                }}
                                                                                onClick={() => handleStartClick(exam)}
                                                                            >
                                                                                解答する
                                                                            </button>
                                                                            {production && (
                                                                                <div style={{
                                                                                    color: '#991b1b',
                                                                                    fontSize: '0.58rem',
                                                                                    fontWeight: 800,
                                                                                    lineHeight: 1.25,
                                                                                    maxWidth: '8.5rem'
                                                                                }}>
                                                                                    採点精度が高い確認済み問題
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        ) : (
                                                            <span style={{ color: '#e2e8f0', fontSize: '1.2rem' }}>-</span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {facultiesForYear.length === 0 && (
                                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                                    この年度の過去問データはありません。
                                </div>
                            )}
                        </div>

                        {/* Mobile Card View */}
                        <div className="mobile-only" style={{ display: 'none' }}>
                            {sortFacultiesForDisplay(university.faculties, university.name).map(faculty => {
                                const facultyExams = allExams.filter(e => e.year === year && e.facultyId === faculty.id);
                                if (facultyExams.length === 0) return null;

                                return (
                                    <div key={faculty.id} style={{ marginBottom: '2rem' }}>
                                        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--color-text-secondary)' }}>{faculty.name}</h3>
                                        <div style={{ display: 'grid', gap: '1rem' }}>
                                            {facultyExams.map(exam => (
                                                <div
                                                    key={exam.uniqueId}
                                                    className="mobile-card"
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'center',
                                                        border: isProductionExam(exam) ? '1px solid #fecaca' : undefined,
                                                        background: isProductionExam(exam) ? '#fffafa' : undefined
                                                    }}
                                                >
                                                    <div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                                            <div className="mobile-card-title">{exam.subject}</div>
                                                            {isProductionExam(exam) && <ProductionBadge compact />}
                                                        </div>
                                                        <div className="mobile-card-meta">{exam.year}年度</div>
                                                        {isProductionExam(exam) && (
                                                            <div style={{ marginTop: '0.35rem', color: '#991b1b', fontSize: '0.72rem', fontWeight: 800 }}>
                                                                採点精度が高い確認済み問題
                                                            </div>
                                                        )}
                                                    </div>
                                                    <button
                                                        className="btn btn-primary"
                                                        style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                                                        onClick={() => handleStartClick(exam)}
                                                    >
                                                        解答する
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    );
                })}
                {allExams.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
                        過去問データが見つかりませんでした。
                    </div>
                )}
            </div>

            <div style={{ marginTop: '3rem', textAlign: 'center' }}>
                <button className="btn btn-secondary" onClick={() => navigate('/')}>
                    大学一覧に戻る
                </button>
            </div>

            {/* Section Selection Modal */}
            {showSectionModal && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '1rem'
                }}>
                    <div className="glass-panel" style={{
                        width: '100%',
                        maxWidth: '500px',
                        padding: '2.5rem',
                        position: 'relative',
                        border: '1px solid #cbd5e1'
                    }}>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'var(--color-text-primary)' }}>解答範囲の選択</h2>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', marginBottom: '2rem' }}>解きたい大問にチェックを入れてください</p>
                        
                        <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '2.5rem', paddingRight: '0.5rem' }}>
                            <div 
                                style={{ 
                                    padding: '1rem', 
                                    backgroundColor: 'rgba(var(--color-accent-primary-rgb), 0.05)',
                                    borderRadius: '2px',
                                    marginBottom: '1rem',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '1rem',
                                    fontWeight: '600',
                                    border: '1px solid rgba(var(--color-accent-primary-rgb), 0.1)'
                                }}
                                onClick={() => {
                                    if (tempSelectedSections.length === examToStart.originalExam.structure.length) {
                                        setTempSelectedSections([]);
                                    } else {
                                        setTempSelectedSections(examToStart.originalExam.structure.map(s => s.id));
                                    }
                                }}
                            >
                                <input 
                                    type="checkbox" 
                                    checked={tempSelectedSections.length === examToStart.originalExam.structure.length}
                                    readOnly
                                    style={{ width: '18px', height: '18px' }}
                                />
                                すべて選択する
                            </div>

                            {examToStart.originalExam.structure.map((section) => (
                                <div 
                                    key={section.id} 
                                    style={{ 
                                        padding: '1rem', 
                                        backgroundColor: 'white',
                                        borderRadius: '2px',
                                        marginBottom: '0.5rem',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '1rem',
                                        border: '1px solid #f1f5f9',
                                        transition: 'all 0.2s'
                                    }}
                                    onClick={() => {
                                        if (tempSelectedSections.includes(section.id)) {
                                            setTempSelectedSections(prev => prev.filter(id => id !== section.id));
                                        } else {
                                            setTempSelectedSections(prev => [...prev, section.id]);
                                        }
                                    }}
                                >
                                    <input 
                                        type="checkbox" 
                                        checked={tempSelectedSections.includes(section.id)}
                                        readOnly
                                        style={{ width: '16px', height: '16px' }}
                                    />
                                    <span style={{ fontWeight: '500' }}>{section.label}</span>
                                </div>
                            ))}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <button 
                                className="btn btn-secondary" 
                                style={{ width: '100%' }}
                                onClick={() => setShowSectionModal(false)}
                            >
                                キャンセル
                            </button>
                            <button 
                                className="btn btn-primary" 
                                style={{ width: '100%' }}
                                onClick={confirmStart}
                            >
                                試験を開始
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UniversityPage;
