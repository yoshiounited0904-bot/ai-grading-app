import { chatWithGemini } from '../services/geminiService';
import RecruitmentBanner from '../components/RecruitmentBanner';
import AdBanner from '../components/AdBanner';
import ConsultationCTA from '../components/ConsultationCTA';
import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { saveExamResult, getExamStatistics } from '../services/resultService';
import { reportGradingError } from '../services/reportService';
import { isAdminEmail } from '../config/adminConfig';
import { MARKETING_CONFIG } from '../config/marketingConfig';
import { updateAdminFields, uploadAnalysisImage, getAdminExamById } from '../services/adminExamService';
import { uploadBannerImage } from '../services/adminBannerService';
import UsageLimitCard from '../components/UsageLimitCard';
import PremiumLockCard from '../components/PremiumLockCard';
import { getGradingUsageStatus, getPlanFeatures, getUserPlan } from '../services/usageLimitService';
import { getUserPromoVerified } from '../services/promoCodeService';

const getWeakQuestionCount = (feedback = []) => feedback.filter(item => !item.correct).length;

const extractWeaknessText = (value) => {
    if (!value) return '';
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
                return parsed.map(block => block.content || '').filter(Boolean).join('\n');
            }
        } catch {}
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(block => block.content || '').filter(Boolean).join('\n');
    }
    return String(value);
};

const clampAdWidthPercent = (value) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return 100;
    return Math.min(100, Math.max(30, Math.round(next)));
};

const normalizeAdBlockContent = (content) => {
    if (content && typeof content === 'object' && !Array.isArray(content)) {
        return {
            ...content,
            imageUrl: content.imageUrl || content.image_url || '',
            targetUrl: content.targetUrl || content.target_url || '',
            widthPercent: clampAdWidthPercent(content.widthPercent || content.width_percent || 100)
        };
    }
    return { imageUrl: '', targetUrl: '', widthPercent: 100 };
};

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('ファイルの読み込みに失敗しました'));
    reader.readAsDataURL(file);
});

const PremiumMosaic = ({
    children,
    title = 'プレミアムで解禁',
    description = 'この内容はプレミアムプランで確認できます。',
    buttonLabel = 'プレミアムプランを見る',
    onClick
}) => (
    <div style={{ position: 'relative' }}>
        <div
            aria-hidden="true"
            style={{
                filter: 'blur(5px)',
                opacity: 0.5,
                pointerEvents: 'none',
                userSelect: 'none'
            }}
        >
            {children}
        </div>
        <div
            style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
                background: 'rgba(255,255,255,0.45)',
                backdropFilter: 'blur(1px)'
            }}
        >
            <div
                style={{
                    maxWidth: '320px',
                    padding: '1rem',
                    borderRadius: '4px',
                    background: 'rgba(255,255,255,0.92)',
                    border: '1px solid #facc15',
                    boxShadow: '0 10px 30px rgba(15,23,42,0.12)',
                    textAlign: 'center'
                }}
            >
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#b45309', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>
                    PREMIUM
                </div>
                <h3 style={{ margin: '0 0 0.4rem', color: '#0f172a', fontSize: '1rem' }}>{title}</h3>
                <p style={{ margin: '0 0 0.8rem', color: '#64748b', fontSize: '0.82rem', lineHeight: 1.6 }}>{description}</p>
                {onClick && (
                    <button type="button" className="btn btn-primary" onClick={onClick} style={{ padding: '0.5rem 1rem' }}>
                        {buttonLabel}
                    </button>
                )}
            </div>
        </div>
    </div>
);

const SectionAnalysisShell = ({ children, isDesignMode }) => {
    const shellRef = useRef(null);
    const paneRef = useRef(null);
    const [fixedStyle, setFixedStyle] = useState(null);

    useEffect(() => {
        let frameId = 0;

        const updatePosition = () => {
            const shell = shellRef.current;
            if (!shell || window.innerWidth <= 768) {
                setFixedStyle(null);
                return;
            }

            const rect = shell.getBoundingClientRect();
            const rowRect = shell.parentElement?.getBoundingClientRect() || rect;
            const topOffset = 96;
            const bottomGap = 16;
            const minVisibleHeight = 180;
            const shouldFollow = rowRect.top <= topOffset && rowRect.bottom > topOffset + minVisibleHeight;

            if (!shouldFollow) {
                setFixedStyle(null);
                return;
            }

            const availableHeight = Math.max(
                minVisibleHeight,
                Math.min(window.innerHeight - topOffset - bottomGap, rowRect.bottom - topOffset)
            );

            setFixedStyle({
                position: 'fixed',
                top: `${topOffset}px`,
                left: `${rect.left}px`,
                width: `${rect.width}px`,
                maxHeight: `${availableHeight}px`,
                zIndex: 30
            });
        };

        const scheduleUpdate = () => {
            window.cancelAnimationFrame(frameId);
            frameId = window.requestAnimationFrame(updatePosition);
        };

        updatePosition();
        window.addEventListener('scroll', scheduleUpdate, { passive: true });
        window.addEventListener('resize', scheduleUpdate);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('scroll', scheduleUpdate);
            window.removeEventListener('resize', scheduleUpdate);
        };
    }, []);

    return (
        <div
            ref={shellRef}
            className="section-analysis-follow-shell"
            style={{
                flex: '1 1 500px',
                minWidth: 0,
                minHeight: fixedStyle ? `${paneRef.current?.offsetHeight || 0}px` : undefined
            }}
        >
            <div
                ref={paneRef}
                className="section-analysis-follow-pane"
                style={{
                    background: 'rgba(99,102,241,0.04)',
                    borderRadius: '2px',
                    padding: '1rem',
                    border: isDesignMode ? '1px dashed #6366f1' : 'none',
                    maxHeight: '70vh',
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    ...(fixedStyle || {})
                }}
            >
                {children}
            </div>
        </div>
    );
};

const RANK_LABELS = {
    A: '合格安全圏',
    B: '合格有力',
    C: '合格ライン付近',
    D: '要改善',
    E: '厳しい'
};

const RANK_ORDER = ['A', 'B', 'C', 'D', 'E'];

const toFiniteNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

const formatPoint = (value) => {
    const num = toFiniteNumber(value);
    if (num === null) return '-';
    return `${Math.floor(num)}点`;
};

const floorDisplayScore = (value, fallback = 0) => {
    const num = toFiniteNumber(value);
    return num === null ? fallback : Math.floor(num);
};

const getSectionQuestionIds = (section = {}) => new Set((section.questions || []).map(q => String(q.id)));

const getSectionFeedback = (section, feedback = []) => {
    const sectionId = String(section?.id || '');
    const questionIds = getSectionQuestionIds(section);
    return (feedback || []).filter(item => {
        if (item?.sectionId) {
            return String(item.sectionId) === sectionId;
        }
        const itemId = String(item.id || '');
        const matchesByList = questionIds.has(itemId);
        const matchesByPrefix = questionIds.size === 0 && sectionId && itemId.startsWith(`${sectionId}-`);
        return matchesByList || matchesByPrefix;
    });
};

const isEssayForceZeroTriggered = (essayResult, scoringElements) => {
    const elementResults = Array.isArray(essayResult?.elementResults) ? essayResult.elementResults : [];
    if (!Array.isArray(scoringElements) || elementResults.length === 0) return false;

    return elementResults.some((res) => {
        const el = scoringElements.find((item) => item.id === res.elementId);
        if (!el) return false;
        if (el.type === 'force_zero') return res.status === 'full';
        if (el.type === 'character_count') {
            return res.status === 'none' && el.forceZeroOnFail !== false;
        }
        return false;
    });
};

const getFeedbackScore = (item) => {
    if (isEssayForceZeroTriggered(item?.essayResult, item?.scoringElements)) return 0;
    const explicitScore = toFiniteNumber(item?.score);
    if (explicitScore !== null) return Math.floor(explicitScore);
    return item?.correct ? Math.floor(toFiniteNumber(item?.points) || 0) : 0;
};

const getFeedbackMaxPoints = (item) => {
    const points = toFiniteNumber(item?.points);
    if (points !== null && points > 0) return Math.floor(points);
    const maxPoints = toFiniteNumber(item?.maxPoints);
    return maxPoints !== null && maxPoints > 0 ? Math.floor(maxPoints) : null;
};

const FEEDBACK_STATUS = {
    correct: {
        label: '正解',
        color: '#10b981',
        background: 'rgba(16,185,129,0.03)',
        badgeBackground: '#ecfdf5',
        border: '#10b981'
    },
    partial: {
        label: '部分点',
        color: '#d97706',
        background: 'rgba(245,158,11,0.06)',
        badgeBackground: '#fffbeb',
        border: '#f59e0b'
    },
    wrong: {
        label: '不正解',
        color: '#ef4444',
        background: 'rgba(239,68,68,0.03)',
        badgeBackground: '#fef2f2',
        border: '#ef4444'
    }
};

const getFeedbackStatus = (item) => {
    const score = getFeedbackScore(item);
    const maxPoints = getFeedbackMaxPoints(item);
    if (maxPoints !== null) {
        if (score >= maxPoints) return { key: 'correct', ...FEEDBACK_STATUS.correct };
        if (score <= 0) return { key: 'wrong', ...FEEDBACK_STATUS.wrong };
        return { key: 'partial', ...FEEDBACK_STATUS.partial };
    }
    if (item?.correct) return { key: 'correct', ...FEEDBACK_STATUS.correct };
    if (score > 0) return { key: 'partial', ...FEEDBACK_STATUS.partial };
    return { key: 'wrong', ...FEEDBACK_STATUS.wrong };
};

const buildAdmissionThresholds = (resultData, currentStructure = []) => {
    const displayMax = toFiniteNumber(resultData?.maxScore) || 100;
    const rawMax = toFiniteNumber(resultData?.rawMaxScore) || displayMax;
    const displayToRawRatio = displayMax > 0 ? rawMax / displayMax : 1;
    const lines = resultData?.passingLines || resultData?.passing_lines || {};
    const hasLines = ['A', 'B', 'C', 'D'].every(rank => toFiniteNumber(lines?.[rank]) !== null);

    if (hasLines) {
        const maxLine = Math.max(...['A', 'B', 'C', 'D'].map(rank => toFiniteNumber(lines[rank]) || 0));
        const linesAppearDisplayScale = maxLine <= displayMax * 1.1 && Math.abs(rawMax - displayMax) > 0.5;
        return {
            A: (toFiniteNumber(lines.A) || 0) * (linesAppearDisplayScale ? displayToRawRatio : 1),
            B: (toFiniteNumber(lines.B) || 0) * (linesAppearDisplayScale ? displayToRawRatio : 1),
            C: (toFiniteNumber(lines.C) || 0) * (linesAppearDisplayScale ? displayToRawRatio : 1),
            D: (toFiniteNumber(lines.D) || 0) * (linesAppearDisplayScale ? displayToRawRatio : 1),
            source: 'passingLines'
        };
    }

    const structureMax = (currentStructure || []).reduce((sum, section) => {
        const sectionMax = toFiniteNumber(section.totalPoints || section.allocatedPoints)
            || (section.questions || []).reduce((qSum, q) => qSum + (toFiniteNumber(q.points) || 0), 0);
        return sum + sectionMax;
    }, 0);
    const maxForFallback = rawMax || structureMax || displayMax || 100;
    return {
        A: maxForFallback * 0.8,
        B: maxForFallback * 0.7,
        C: maxForFallback * 0.6,
        D: maxForFallback * 0.4,
        source: 'fallback'
    };
};

const calculateAdmissionRank = (score, thresholds) => {
    if (score >= thresholds.A) return 'A';
    if (score >= thresholds.B) return 'B';
    if (score >= thresholds.C) return 'C';
    if (score >= thresholds.D) return 'D';
    return 'E';
};

const buildPremiumAdmissionAnalysis = (resultData, currentStructure = []) => {
    const rawScore = toFiniteNumber(resultData?.rawScore) ?? toFiniteNumber(resultData?.score) ?? 0;
    const rawMax = toFiniteNumber(resultData?.rawMaxScore) ?? toFiniteNumber(resultData?.maxScore) ?? 100;
    const displayMax = toFiniteNumber(resultData?.maxScore) || rawMax || 100;
    const displayRatio = rawMax > 0 ? displayMax / rawMax : 1;
    const thresholds = buildAdmissionThresholds(resultData, currentStructure);
    const currentRank = resultData?.passProbability || calculateAdmissionRank(rawScore, thresholds);
    const currentRankIndex = RANK_ORDER.indexOf(currentRank);
    const nextRank = currentRankIndex > 0 ? RANK_ORDER[currentRankIndex - 1] : null;
    const pointsToNextRank = nextRank ? Math.max(0, thresholds[nextRank] - rawScore) * displayRatio : 0;
    const pointsToA = currentRank === 'A' ? 0 : Math.max(0, thresholds.A - rawScore) * displayRatio;
    const passLineGap = (rawScore - thresholds.C) * displayRatio;
    const feedback = resultData?.questionFeedback || [];

    const sections = (currentStructure || []).map((section, index) => {
        const sectionFeedback = getSectionFeedback(section, feedback);
        const maxScore = toFiniteNumber(section.totalPoints || section.allocatedPoints)
            || (section.questions || []).reduce((sum, q) => sum + (toFiniteNumber(q.points) || 0), 0)
            || sectionFeedback.reduce((sum, item) => sum + (toFiniteNumber(item.points) || 0), 0);
        const rawSectionScore = sectionFeedback.reduce((sum, item) => sum + getFeedbackScore(item), 0);
        const score = maxScore > 0 ? Math.min(rawSectionScore, maxScore) : rawSectionScore;
        const lostPoints = Math.max(0, maxScore - score);
        const scoreRate = maxScore > 0 ? Math.min(100, Math.round((score / maxScore) * 100)) : null;
        return {
            sectionId: section.id,
            label: section.label || section.title || `第${index + 1}問`,
            score,
            maxScore,
            lostPoints,
            scoreRate,
            wrongCount: sectionFeedback.filter(item => !item.correct).length,
            totalCount: sectionFeedback.length
        };
    }).filter(section => section.maxScore > 0 || section.totalCount > 0);

    const improveTargets = sections
        .filter(section => section.lostPoints > 0)
        .sort((a, b) => b.lostPoints - a.lostPoints);
    const topTargetId = improveTargets[0]?.sectionId;
    const secondTargetId = improveTargets[1]?.sectionId;

    const sectionImpact = sections.map(section => {
        let title = '維持';
        let priority = 'maintain';
        let impact = 'positive';
        let comment = '得点が安定しており、合格判定を支えている大問です。ここは取りこぼしを防ぐ維持領域です。';

        if (section.sectionId === topTargetId) {
            title = '最優先';
            priority = 'highest';
            impact = 'negative_high';
            comment = '失点幅が最も大きく、ここを改善できると判定への影響が大きい大問です。';
        } else if (section.sectionId === secondTargetId || (section.scoreRate !== null && section.scoreRate < 65)) {
            title = '改善候補';
            priority = 'improve';
            impact = 'negative_mid';
            comment = '標準的な取りこぼしがあり、復習による得点上積みが狙いやすい大問です。';
        }

        if (section.scoreRate !== null && section.scoreRate >= 85) {
            title = '強み';
            priority = 'strength';
            impact = 'positive_high';
            comment = '高い得点率で取れており、現時点の強みになっています。';
        }

        return { ...section, title, priority, impact, comment };
    });

    const primaryTarget = sectionImpact.find(section => section.priority === 'highest') || sectionImpact.find(section => section.priority === 'improve');
    const summary = currentRank === 'A'
        ? '今回の答案は合格安全圏です。大きな崩れを防ぎながら、失点した問題の復習でさらに安定させましょう。'
        : passLineGap >= 0
            ? '今回の答案は合格目安を上回っています。次のランクに上げるには、失点幅の大きい大問を絞って改善するのが有効です。'
            : '今回の答案は合格目安を下回っています。まずは失点が集中している大問から優先して復習するのが近道です。';
    const improvementPoint = primaryTarget
        ? Math.min(primaryTarget.lostPoints * displayRatio, pointsToNextRank || primaryTarget.lostPoints * displayRatio)
        : 0;
    const reason = primaryTarget
        ? currentRank === 'A'
            ? `${primaryTarget.label}に${formatPoint(improvementPoint)}前後の改善余地があります。ここを復習できると、合格安全圏をさらに安定させやすくなります。`
            : `${primaryTarget.label}の失点幅が大きく、全体の判定を押し下げています。ここで${formatPoint(improvementPoint)}前後を上積みできると、次の判定に近づきます。`
        : '大きく崩れている大問は少なく、全体の安定度が判定を支えています。';

    return {
        currentRank,
        currentRankLabel: RANK_LABELS[currentRank] || '判定中',
        nextRank,
        pointsToNextRank,
        pointsToA,
        passLineGap,
        summary,
        reason,
        sectionImpact,
        actionPlan: primaryTarget ? (
            currentRank === 'A' ? [
                `${primaryTarget.label}の間違いを、知識不足・読み違い・記述不足に分けて復習する`,
                `次回もA判定を維持するため、${primaryTarget.label}の取りこぼしを優先して潰す`,
                '正解した大問は解き方を維持し、失点した小問だけを短時間で解き直す'
            ] : [
                `${primaryTarget.label}の間違いを、知識不足・読み違い・記述不足に分けて復習する`,
                `次回は${primaryTarget.label}でまず${formatPoint(improvementPoint)}の上積みを狙う`,
                '正解した大問は解き方を維持し、失点の大きい大問に復習時間を寄せる'
            ]
        ) : [
            '正解した問題の解法を再現できるか確認する',
            '失点した小問だけを解き直し、同じミスを潰す'
        ]
    };
};

const PremiumAdmissionAnalysisCard = ({ analysis }) => {
    const passGapColor = analysis.passLineGap >= 0 ? '#047857' : '#b91c1c';
    const isTopRank = analysis.currentRank === 'A';
    return (
        <div style={{ textAlign: 'left', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '1.25rem', marginTop: '1.25rem', boxShadow: '0 10px 24px rgba(15,23,42,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 900, color: '#b45309', letterSpacing: '0.08em', marginBottom: '0.25rem' }}>PREMIUM JUDGEMENT</div>
                    <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a' }}>詳細合格判定</h3>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ padding: '0.35rem 0.65rem', border: '1px solid #fee2e2', background: '#fff7ed', color: '#9a3412', fontWeight: 800, borderRadius: '999px', fontSize: '0.8rem' }}>
                        現在 {analysis.currentRank}判定
                    </span>
                    <span style={{ padding: '0.35rem 0.65rem', border: '1px solid #dcfce7', background: '#f0fdf4', color: passGapColor, fontWeight: 800, borderRadius: '999px', fontSize: '0.8rem' }}>
                        合格目安との差 {analysis.passLineGap >= 0 ? '+' : ''}{formatPoint(analysis.passLineGap)}
                    </span>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.85rem', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 800 }}>{isTopRank ? '安全圏キープ' : '次ランクまで'}</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a' }}>
                        {analysis.nextRank ? `あと${formatPoint(analysis.pointsToNextRank)}` : '到達済み'}
                    </div>
                    {analysis.nextRank && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{analysis.nextRank}判定へ</div>}
                </div>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.85rem', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 800 }}>{isTopRank ? '合格目安との差' : 'A判定まで'}</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a' }}>
                        {isTopRank ? `${analysis.passLineGap >= 0 ? '+' : ''}${formatPoint(analysis.passLineGap)}` : `あと${formatPoint(analysis.pointsToA)}`}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{isTopRank ? '合格ラインより上' : '安全圏との差'}</div>
                </div>
            </div>

            <p style={{ margin: '0 0 0.65rem', color: '#334155', lineHeight: 1.7 }}>{analysis.summary}</p>
            <p style={{ margin: '0 0 1rem', color: '#475569', lineHeight: 1.7 }}>{analysis.reason}</p>

            {analysis.sectionImpact.length > 0 && (
                <div style={{ display: 'grid', gap: '0.6rem', marginBottom: '1rem' }}>
                    {analysis.sectionImpact.map(section => {
                        const accent = section.priority === 'highest' ? '#dc2626' : section.priority === 'improve' ? '#f59e0b' : section.priority === 'strength' ? '#059669' : '#64748b';
                        return (
                            <div key={section.sectionId} style={{ border: '1px solid #e2e8f0', borderLeft: `4px solid ${accent}`, borderRadius: '4px', padding: '0.8rem', background: '#ffffff' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                                    <strong style={{ color: '#0f172a' }}>{section.label}</strong>
                                    <span style={{ color: accent, fontWeight: 900, fontSize: '0.82rem' }}>{section.title}</span>
                                </div>
                                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.35rem' }}>
                                    得点率 {section.scoreRate ?? '-'}% / 失点 {formatPoint(section.lostPoints)}
                                </div>
                                <div style={{ fontSize: '0.84rem', color: '#334155', lineHeight: 1.6 }}>{section.comment}</div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div style={{ background: '#fefce8', border: '1px solid #fde68a', padding: '0.9rem', borderRadius: '4px' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 900, color: '#92400e', marginBottom: '0.4rem' }}>次にやること</div>
                <ul style={{ margin: 0, paddingLeft: '1.1rem', color: '#334155', lineHeight: 1.7, fontSize: '0.86rem' }}>
                    {analysis.actionPlan.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
            </div>
        </div>
    );
};

const EssayGradingDetail = ({ item }) => {
    const { essayResult, scoringElements } = item;
    const [openElements, setOpenElements] = useState({});
    const [showGrammar, setShowGrammar] = useState(true);

    if (!essayResult) return null;

    const toggleElement = (elId) => {
        setOpenElements(prev => ({
            ...prev,
            [elId]: !prev[elId]
        }));
    };

    let contentSum = 0;
    let logicSum = 0;
    let characterSum = 0;
    const elementResults = essayResult.elementResults || [];
    const grammarErrors = essayResult.grammarErrors || [];
    const overallComment = essayResult.overallComment || "";
    const hasElementRubric = Array.isArray(scoringElements) && scoringElements.length > 0 && elementResults.length > 0;
    const finalPoints = getFeedbackMaxPoints(item);
    const forceZeroTriggered = isEssayForceZeroTriggered(essayResult, scoringElements);
    const rawFinalScore = forceZeroTriggered ? 0 : floorDisplayScore(item.score ?? essayResult.score, 0);
    const finalScore = forceZeroTriggered ? 0 : (finalPoints ? Math.min(rawFinalScore, finalPoints) : rawFinalScore);
    const finalStatus = getFeedbackStatus({ ...item, score: finalScore, points: finalPoints ?? item.points });

    if (!hasElementRubric) {
        return (
            <div className="essay-grading-detail" style={{ marginTop: '1rem', background: '#fff', borderRadius: '2px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <div style={{ padding: '1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: '800', color: '#1e293b' }}>自由記述 採点結果</span>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <span style={{ background: finalStatus.badgeBackground, color: finalStatus.color, border: `1px solid ${finalStatus.border}`, padding: '0.2rem 0.5rem', borderRadius: '2px', fontSize: '0.75rem', fontWeight: '800' }}>{finalStatus.label}</span>
                        <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '0.2rem 0.5rem', borderRadius: '2px', fontSize: '0.75rem', fontWeight: '800' }}>
                            {finalPoints ? `${finalScore} / ${finalPoints}点` : `${finalScore}点`}
                        </span>
                    </div>
                </div>
                {essayResult.explanation && (
                    <div style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#334155', lineHeight: '1.6' }}>
                        <strong>採点理由:</strong> {essayResult.explanation}
                    </div>
                )}
                {grammarErrors.length > 0 && (
                    <div style={{ padding: '0.75rem', borderTop: '1px solid #f1f5f9' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: '800', color: '#94a3b8', marginBottom: '0.5rem' }}>指摘された文法・表記エラー ({grammarErrors.length})</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            {grammarErrors.map((err, idx) => (
                                <div key={idx} style={{ background: '#fff1f2', border: '1px solid #ffe4e6', borderRadius: '2px', padding: '0.5rem 0.75rem', fontSize: '0.75rem' }}>
                                    <span style={{ textDecoration: 'line-through', marginRight: '0.5rem', color: '#be123c', fontWeight: '700' }}>{err.error}</span>
                                    <span style={{ color: '#0f766e', fontWeight: '800' }}>→ {err.correction}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {overallComment && (
                    <div style={{ padding: '0.75rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0', fontSize: '0.75rem', color: '#334155', lineHeight: '1.6' }}>
                        <strong>次に直すこと:</strong> {overallComment}
                    </div>
                )}
            </div>
        );
    }

    elementResults.forEach(res => {
        const el = (scoringElements || []).find(e => e.id === res.elementId);
        if (!el) return;
        let score = 0;
        if (res.status === 'full') score = el.points;
        else if (res.status === 'partial' && el.allowPartial) score = el.points / 2;

        if (el.type === 'content') contentSum += score;
        else if (el.type === 'logic') logicSum += score;
        else if (el.type === 'character_count') characterSum += Math.max(0, score);
    });

    const grammarCount = grammarErrors.length;
    const characterStatusResults = elementResults.filter(res => {
        const el = (scoringElements || []).find(e => e.id === res.elementId);
        return el?.type === 'character_count';
    });
    const characterStatusLabel = characterStatusResults.length === 0
        ? null
        : characterStatusResults.every(res => res.status === 'full') ? 'OK' : '条件外';

    return (
        <div className="essay-grading-detail" style={{ marginTop: '1rem', background: '#fff', borderRadius: '2px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: '800', color: '#1e293b' }}>英作文 採点内訳</span>
                <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem', fontWeight: '700', flexWrap: 'wrap' }}>
                    <span style={{ background: finalStatus.badgeBackground, color: finalStatus.color, border: `1px solid ${finalStatus.border}`, padding: '0.2rem 0.5rem', borderRadius: '2px', fontWeight: '800' }}>{finalStatus.label}</span>
                    <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '0.2rem 0.5rem', borderRadius: '2px', fontWeight: '800' }}>
                        最終: {finalPoints ? `${finalScore}/${finalPoints}点` : `${finalScore}点`}
                    </span>
                    <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '0.2rem 0.5rem', borderRadius: '2px' }}>内容: {Math.floor(contentSum)}点</span>
                    <span style={{ background: '#f3e8ff', color: '#6b21a8', padding: '0.2rem 0.5rem', borderRadius: '2px' }}>論理: {Math.floor(logicSum)}点</span>
                    {characterSum > 0 && (
                        <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '0.2rem 0.5rem', borderRadius: '2px' }}>文字数: {Math.floor(characterSum)}点</span>
                    )}
                    {characterStatusLabel && (
                        <span style={{ background: characterStatusLabel === 'OK' ? '#dcfce7' : '#fee2e2', color: characterStatusLabel === 'OK' ? '#166534' : '#b91c1c', padding: '0.2rem 0.5rem', borderRadius: '2px' }}>
                            文字数: {characterStatusLabel}
                        </span>
                    )}
                    <span style={{ background: '#ffe4e6', color: '#be123c', padding: '0.2rem 0.5rem', borderRadius: '2px' }}>文法減点: -{grammarCount}点</span>
                </div>
            </div>

            {forceZeroTriggered && (
                <div style={{ padding: '0.65rem 0.75rem', background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.75rem', fontWeight: '800', lineHeight: 1.6 }}>
                    強制0点条件に該当したため、最終得点は0点です。
                </div>
            )}

            {finalPoints && !forceZeroTriggered && rawFinalScore > finalPoints && (
                <div style={{ padding: '0.65rem 0.75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '0.75rem', lineHeight: 1.6 }}>
                    採点基準の合計は配点を超える設定です。最終得点は配点上限の {finalPoints} 点に丸めています。
                </div>
            )}

            <div style={{ padding: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.5rem', paddingLeft: '0.25rem' }}>採点基準ごとの結果</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {(scoringElements || []).map((el) => {
                        const res = elementResults.find(r => r.elementId === el.id) || { status: 'none', reason: '判定データなし' };
                        const isOpen = !!openElements[el.id];

                        let mark = '✕';
                        let statusColor = '#ef4444';
                        let bgStatus = '#fef2f2';
                        let scoreText = '0点';
                        if (el.type === 'force_zero') {
                            if (res.status === 'full') {
                                mark = '✕';
                                statusColor = '#ef4444';
                                bgStatus = '#fef2f2';
                                scoreText = '強制0点';
                            } else {
                                mark = '◯';
                                statusColor = '#10b981';
                                bgStatus = '#ecfdf5';
                                scoreText = '発動なし';
                            }
                        } else if (res.status === 'full') {
                            mark = '◯';
                            statusColor = '#10b981';
                            bgStatus = '#ecfdf5';
                            scoreText = el.type === 'character_count'
                                ? `OK${Number(el.points) ? ` (+${Math.floor(Number(el.points))}点)` : ''}`
                                : `${Math.floor(Number(el.points) || 0)}点`;
                        } else if (res.status === 'partial') {
                            mark = '△';
                            statusColor = '#f59e0b';
                            bgStatus = '#fffbeb';
                            scoreText = el.allowPartial ? `${Math.floor((Number(el.points) || 0) / 2)}点 (部分点)` : '0点';
                        } else if (el.type === 'character_count') {
                            scoreText = `条件外${el.forceZeroOnFail !== false ? '・強制0点' : ''}`;
                        }

                        const typeLabel = el.type === 'content' ? '内容' : el.type === 'logic' ? '論理' : el.type === 'character_count' ? '文字数' : el.type === 'deduction' ? '減点' : '強制0点';
                        const typeBg = el.type === 'content' ? '#e0f2fe' : el.type === 'logic' ? '#f3e8ff' : el.type === 'character_count' ? '#dbeafe' : el.type === 'deduction' ? '#fee2e2' : '#fef2f2';
                        const typeColor = el.type === 'content' ? '#0369a1' : el.type === 'logic' ? '#6b21a8' : el.type === 'character_count' ? '#1d4ed8' : el.type === 'deduction' ? '#b91c1c' : '#991b1b';

                        return (
                            <div key={el.id} style={{ border: '1px solid #f1f5f9', borderRadius: '2px', overflow: 'hidden' }}>
                                <div 
                                    onClick={() => toggleElement(el.id)}
                                    style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        alignItems: 'flex-start', 
                                        gap: '0.75rem',
                                        padding: '0.65rem 0.75rem', 
                                        background: bgStatus, 
                                        cursor: 'pointer',
                                        userSelect: 'none'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', flex: 1, minWidth: 0 }}>
                                        <span style={{ fontSize: '1rem', color: statusColor, fontWeight: '800', lineHeight: 1.5 }}>{mark}</span>
                                        <span style={{ background: typeBg, color: typeColor, fontSize: '0.65rem', fontWeight: '800', padding: '0.1rem 0.3rem', borderRadius: '2px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                            {typeLabel}
                                        </span>
                                        <span
                                            title={el.description}
                                            style={{
                                                fontSize: '0.8rem',
                                                fontWeight: '700',
                                                color: '#334155',
                                                whiteSpace: 'pre-wrap',
                                                overflowWrap: 'anywhere',
                                                wordBreak: 'break-word',
                                                lineHeight: 1.6,
                                                flex: 1,
                                                minWidth: 0
                                            }}
                                        >
                                            {el.description}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0, paddingTop: '0.1rem' }}>
                                        <span style={{ fontSize: '0.8rem', fontWeight: '800', color: statusColor, whiteSpace: 'nowrap' }}>{scoreText}</span>
                                        <span style={{ fontSize: '0.6rem', color: '#94a3b8', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', lineHeight: 1.5 }}>▼</span>
                                    </div>
                                </div>

                                {isOpen && (
                                    <div style={{ padding: '0.75rem', background: '#fff', borderTop: '1px solid #f8fafc', fontSize: '0.75rem', color: '#475569', lineHeight: '1.5' }}>
                                        <strong>判定理由:</strong> {res.reason}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {grammarCount > 0 && (
                <div style={{ padding: '0 0.75rem 0.75rem 0.75rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.75rem' }}>
                    <div 
                        onClick={() => setShowGrammar(!showGrammar)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none', marginBottom: '0.5rem' }}
                    >
                        <div style={{ fontSize: '0.75rem', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span>指摘された文法エラー ({grammarCount})</span>
                        </div>
                        <span style={{ fontSize: '0.6rem', color: '#94a3b8', transform: showGrammar ? 'rotate(180deg)' : 'none' }}>▼</span>
                    </div>

                    {showGrammar && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
                            {grammarErrors.map((err, idx) => (
                                <div key={idx} style={{ background: '#fff1f2', border: '1px solid #ffe4e6', borderRadius: '2px', padding: '0.5rem 0.75rem', fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                    <div style={{ color: '#be123c', fontWeight: '700' }}>
                                        <span style={{ textDecoration: 'line-through', marginRight: '0.5rem' }}>{err.error}</span>
                                        <span style={{ color: '#0f766e', fontWeight: '800' }}>→ {err.correction}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {overallComment && (
                <div style={{ padding: '0.75rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0', fontSize: '0.75rem', color: '#334155', lineHeight: '1.6' }}>
                    <strong>全体総評:</strong> {overallComment}
                </div>
            )}
        </div>
    );
};

const ResultPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { result: initialResult, universityName, facultyName, examSubject, examYear, examDurationMinutes, customLayout: initialCustomLayout, isNewResult, isDesignMode: incomingDesignMode } = location.state || {};
    const { user, profile } = useAuth();
    const isAdmin = user && (isAdminEmail(user.email) || profile?.role === 'admin');

    // Extract answers and embedded metadata (examId, examStructure) if accessing from Dashboard (past results)
    const rawAnswers = location.state?.answers || [];
    const actualAnswers = rawAnswers.items || rawAnswers;
    const initialStructure = location.state?.examStructure || rawAnswers.examStructure;
    const examId = location.state?.examId || rawAnswers.examId;
    const pdfPath = location.state?.pdfPath || rawAnswers.pdfPath || null;
    const initialSectionIds = Array.isArray(initialStructure) && initialStructure.length > 0
        ? new Set(initialStructure.map(section => String(section.id)))
        : null;
    const filterStructureForSolvedSections = (structure = []) => {
        if (!initialSectionIds || initialSectionIds.size === 0) return structure || [];
        return (structure || []).filter(section => initialSectionIds.has(String(section.id)));
    };

    // Local state for editable data to ensure instant feedback
    const [resultData, setResultData] = useState(() => {
        if (!initialResult) return null;
        return {
            ...initialResult,
            score: initialResult.score,
            maxScore: typeof initialResult.maxScore !== 'undefined' ? initialResult.maxScore : initialResult.max_score,
            passProbability: initialResult.passProbability || initialResult.pass_probability,
            weaknessAnalysis: initialResult.weaknessAnalysis || initialResult.weakness_analysis,
            questionFeedback: initialResult.questionFeedback || initialResult.question_feedback,
            detailedAnalysis: initialResult.detailedAnalysis || initialResult.detailed_analysis,
            rawScore: initialResult.rawScore ?? initialResult.raw_score ?? rawAnswers.rawScore,
            rawMaxScore: initialResult.rawMaxScore ?? initialResult.raw_max_score ?? rawAnswers.rawMaxScore,
            compressedScore: initialResult.compressedScore ?? rawAnswers.compressedScore,
            compressedMaxScore: initialResult.compressedMaxScore ?? rawAnswers.compressedMaxScore,
            scoreCompression: initialResult.scoreCompression || rawAnswers.scoreCompression || null,
            scoreCap: initialResult.scoreCap ?? rawAnswers.scoreCap ?? null
        };
    });
    const [currentStructure, setCurrentStructure] = useState(initialStructure || []);
    const [usageStatus, setUsageStatus] = useState(location.state?.usageStatus || null);
    const shouldShowVocabulary = String(examSubject || '').toLowerCase() === 'english' || String(examSubject || '').includes('英語');
    const currentPlan = getUserPlan(profile, usageStatus);
    const planFeatures = getPlanFeatures(currentPlan);
    const displayedUsageStatus = planFeatures.unlimitedGrading
        ? { ...(usageStatus || {}), allowed: true, used: usageStatus?.used || 0, limit: null, remaining: null, plan: currentPlan }
        : usageStatus;
    const adContext = {
        universityName,
        facultyName,
        examSubject,
        subject: examSubject,
        examYear,
        year: examYear,
        audience: !user ? 'guest' : currentPlan
    };

    useEffect(() => {
        if (!user || location.state?.usageStatus) return;

        let cancelled = false;
        const loadUsageStatus = async () => {
            const { data, error } = await getGradingUsageStatus(user);
            if (!cancelled && !error) setUsageStatus(data);
        };

        loadUsageStatus();
        return () => {
            cancelled = true;
        };
    }, [user, location.state?.usageStatus]);

    const [promoVerified, setPromoVerified] = useState(false);
    useEffect(() => {
        let cancelled = false;
        getUserPromoVerified(user?.id)
            .then(verified => {
                if (!cancelled) setPromoVerified(Boolean(verified));
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [user?.id]);

    const rawDisplayUniversity = String(universityName || resultData?.universityName || resultData?.university_name || '').trim();
    const rawDisplayFaculty = String(facultyName || resultData?.facultyName || resultData?.faculty_name || '').trim();
    const displayUniversity = rawDisplayFaculty && rawDisplayUniversity.endsWith(rawDisplayFaculty)
        ? rawDisplayUniversity.slice(0, -rawDisplayFaculty.length).trim()
        : rawDisplayUniversity;
    const rawDisplaySubject = String(examSubject || resultData?.examSubject || resultData?.exam_subject || '').trim();
    const parsedSubjectYear = rawDisplaySubject.match(/^([0-9]{4})年度\s*(.+)$/);
    const displayYear = String(examYear || resultData?.examYear || resultData?.exam_year || parsedSubjectYear?.[1] || '').trim();
    const displaySubject = (parsedSubjectYear ? parsedSubjectYear[2] : rawDisplaySubject).trim();
    const resultMetaParts = [
        displayUniversity,
        rawDisplayFaculty,
        displayYear ? `${displayYear}年度` : '',
        displaySubject
    ].filter(Boolean);

    const [chatInput, setChatInput] = useState('');
    const [chatHistory, setChatHistory] = useState(() => {
        if (!examId) return [];
        try {
            const stored = sessionStorage.getItem(`exam_chat_history_${examId}`);
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    });
    const [isChatting, setIsChatting] = useState(false);
    const [saved, setSaved] = useState(false);
    const [stats, setStats] = useState(null);
    const [error, setError] = useState(null);
    const [reportingItem, setReportingItem] = useState(null);
    const [reportComment, setReportComment] = useState('');
    const [isReporting, setIsReporting] = useState(false);
    const [isDesignMode, setIsDesignMode] = useState(!!incomingDesignMode);
    const [originalData, setOriginalData] = useState(null); // Backup for cancel
    const [savedResultId, setSavedResultId] = useState(initialResult?.id || initialResult?.result_id || null);

    const hasSavedRef = useRef(false);

    useEffect(() => {
        if (!examId || chatHistory.length === 0) return;
        try {
            sessionStorage.setItem(`exam_chat_history_${examId}`, JSON.stringify(chatHistory));
        } catch {
            // sessionStorage quota exceeded — ignore silently
        }
    }, [chatHistory, examId]);

    useEffect(() => {
        if (!examId) return;
        
        const syncWithDB = async () => {
            try {
                const { data, error } = await getAdminExamById(examId);
                if (!error && data) {
                    console.log("--- SYNC WITH DB ---");
                    console.log("Master Data Questions:", data.structure?.flatMap(s => s.questions || []).length);
                    
                    // Sync with latest DB data to ensure persistence across reloads/navigation
                    setResultData(prev => {
                        if (!prev) return prev;
                        const next = { ...prev };
                        if (isDesignMode || !prev?.detailedAnalysis) {
                            if (data.detailed_analysis) next.detailedAnalysis = data.detailed_analysis;
                        }
                        if (isDesignMode || !prev?.weaknessAnalysis) {
                            if (data.weakness_analysis) next.weaknessAnalysis = data.weakness_analysis;
                        }
                        
                        if (prev && (!prev.questionFeedback || prev.questionFeedback.length === 0) && data.structure) {
                            console.log("Populating dummy feedback from master structure during sync...");
                            const dummy = [];
                            filterStructureForSolvedSections(data.structure).forEach(section => {
                                (section.questions || []).forEach(q => {
                                    dummy.push({
                                        id: q.id,
                                        correct: false,
                                        userAnswer: "",
                                        correctAnswer: q.correctAnswer || q.answer || "",
                                        explanation: q.explanation || ""
                                    });
                                });
                            });
                            next.questionFeedback = dummy;
                        }
                        return next;
                    });
                    
                    if (data.structure) {
                        setCurrentStructure(filterStructureForSolvedSections(data.structure));
                    }
                }
            } catch (err) {
                console.error("Sync error:", err);
            }
        };
        syncWithDB();
    }, [examId]);

    useEffect(() => {
        const saveData = async () => {
            if (user && resultData && isNewResult && !hasSavedRef.current) {
                hasSavedRef.current = true;
                try {
                    const { data: savedResult } = await saveExamResult(user.id, {
                        universityName,
                        facultyName,
                        examSubject,
                        score: floorDisplayScore(resultData.score),
                        maxScore: resultData.maxScore,
                        passProbability: resultData.passProbability,
                        weaknessAnalysis: typeof resultData.weaknessAnalysis === 'string' ? resultData.weaknessAnalysis : JSON.stringify(resultData.weaknessAnalysis),
                        answers: {
                            items: actualAnswers,
                            examId: examId,
                            examStructure: currentStructure,
                            pdfPath,
                            rawScore: floorDisplayScore(resultData.rawScore),
                            rawMaxScore: resultData.rawMaxScore,
                            compressedScore: floorDisplayScore(resultData.compressedScore),
                            compressedMaxScore: resultData.compressedMaxScore,
                            scoreCompression: resultData.scoreCompression,
                            scoreCap: resultData.scoreCap
                        },
                        pdfPath,
                        questionFeedback: resultData.questionFeedback
                    });
                    if (savedResult?.id) setSavedResultId(savedResult.id);
                    setSaved(true);
                    const statsData = await getExamStatistics(universityName, examSubject, floorDisplayScore(resultData.score));
                    setStats(statsData);
                } catch (err) {
                    console.error("Error saving result:", err);
                    setError("結果の保存に失敗しました");
                }
            } else if (resultData) {
                try {
                    const statsData = await getExamStatistics(universityName, examSubject, floorDisplayScore(resultData.score));
                    setStats(statsData);
                } catch (err) {
                    console.error("Error fetching stats:", err);
                }
            }
        };
        saveData();
    }, [user, resultData, universityName, facultyName, examSubject, actualAnswers, examId, currentStructure, pdfPath, isNewResult]);

    if (!resultData || typeof resultData.score === 'undefined') {
        return (
            <div className="container" style={{ padding: '2rem', textAlign: 'center' }}>
                <h2>結果データが不正です</h2>
                <p>採点結果の読み込みに失敗しました。</p>
                {isAdmin && (
                    <div style={{ background: '#f0f0f0', padding: '1rem', margin: '1rem 0', borderRadius: '8px', textAlign: 'left', fontSize: '0.8rem' }}>
                        <strong>Debug Info (管理者のみ表示):</strong>
                        <pre>{JSON.stringify(location.state, null, 2)}</pre>
                    </div>
                )}
                <button className="btn btn-primary" onClick={() => navigate('/')}>トップへ戻る</button>
            </div>
        );
    }

    const handleChatSubmit = async (e) => {
        e.preventDefault();
        if (!user) {
            document.dispatchEvent(new CustomEvent('openAuthModal', { detail: { message: '質問チャットを利用するにはログインが必要です。' } }));
            return;
        }
        if (!planFeatures.aiQuestions) {
            navigate('/premium');
            return;
        }
        if (!chatInput.trim() || isChatting) return;

        const userMsg = chatInput;
        setChatInput('');
        setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
        setIsChatting(true);

        try {
            const sectionSummary = currentStructure.map(s => ({
                id: s.id,
                title: s.title || s.name || s.id,
                questionCount: s.questions?.length || 0,
                totalPoints: s.allocatedPoints || s.questions?.reduce((sum, q) => sum + (q.points || 0), 0) || 0
            }));
            const response = await chatWithGemini(
                userMsg, chatHistory, resultData,
                { universityName, facultyName, examSubject, examYear, examDurationMinutes, sectionSummary },
                pdfPath
            );
            setChatHistory(prev => [...prev, { role: 'ai', text: response }]);
        } catch (err) {
            console.error("Chat error:", err);
            setChatHistory(prev => [...prev, { role: 'ai', text: "すみません、エラーが発生しました。" }]);
        } finally {
            setIsChatting(false);
        }
    };

    const handleReportSubmit = async () => {
        if (!user || !reportingItem) return;
        setIsReporting(true);
        try {
            const { error } = await reportGradingError(user.id, {
                examResultId: savedResultId,
                examId,
                universityName,
                facultyName,
                examSubject,
                examYear,
                questionId: reportingItem.id,
                userAnswer: reportingItem.userAnswer,
                correctAnswer: reportingItem.correctAnswer,
                aiExplanation: reportingItem.explanation,
                userComment: reportComment
            });
            if (error) throw error;
            alert('報告ありがとうございます。内容を確認させていただきます。');
            setReportingItem(null);
            setReportComment('');
        } catch (err) {
            console.error("Report error:", err);
            alert(`報告の送信に失敗しました。\n${err?.message || ''}`);
        } finally {
            setIsReporting(false);
        }
    };

    const getProbabilityColor = (prob) => {
        if (!prob) return 'var(--color-text-primary)';
        if (prob === 'A' || prob === 'B') return 'var(--color-accent-primary)';
        if (prob === 'C') return '#f59e0b';
        if (prob === 'D') return '#ef4444';
        return '#64748b';
    };

    const parseBlocks = (data) => {
        if (!data) return [{ type: 'text', content: '', id: 'empty-text' }];
        if (Array.isArray(data)) return data;
        try {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {}
        return [{ type: 'text', content: String(data), id: 'legacy-text' }];
    };

    const premiumAdmissionAnalysis = buildPremiumAdmissionAnalysis(resultData, currentStructure);

    const handleSaveLayout = async () => {
        if (!examId) {
            alert("この試験のIDが見つからないため保存できません。");
            return;
        }
        try {
            // Ensure we are saving ALL fields correctly
            const masterUpdates = {
                structure: currentStructure,
                detailed_analysis: JSON.stringify(parseBlocks(resultData.detailedAnalysis)),
                weakness_analysis: JSON.stringify(parseBlocks(resultData.weaknessAnalysis))
            };
            
            console.log("--- SAVE ACTION DEBUG ---");
            console.log("Exam ID:", examId);
            console.log("Payload:", masterUpdates);
            
            const { data, error } = await updateAdminFields(examId, masterUpdates);
            
            if (error) {
                console.error("Supabase Update Error:", error);
                throw error;
            }
            
            console.log("✅ Save success. Response data:", data);
            alert("解説データをマスターデータに同期しました。");
            setIsDesignMode(false);
        } catch (err) {
            console.error("Save error:", err);
            alert("保存に失敗しました。");
        }
    };

    const handleXShare = () => {
        const text = `自動採点アプリで ${universityName || ''} ${facultyName || ''}の過去問を解きました！\n得点: ${floorDisplayScore(resultData?.score)} / ${floorDisplayScore(resultData?.maxScore)} 点\n合格可能性: ${resultData?.passProbability || '不明'}\n\n#大学受験 #過去問採点 #スマサイ\nhttps://smart-scoring.com`;
        const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    };

    const buildChatSummary = () => {
        const recent = chatHistory.slice(-6);
        if (recent.length === 0) return '';
        return recent.map(msg => `${msg.role === 'user' ? '生徒' : 'AI'}: ${String(msg.text || '').slice(0, 500)}`).join('\n');
    };

    const handleReserveConsultation = (extraContext = {}) => {
        const chatSummary = buildChatSummary();
        const consultationContext = {
            source: 'result_cta',
            examId,
            examResultId: savedResultId,
            universityName,
            facultyName,
            examSubject,
            examYear,
            score: floorDisplayScore(resultData?.score),
            maxScore: resultData?.maxScore,
            passProbability: resultData?.passProbability,
            weaknessSummary: extractWeaknessText(resultData?.weaknessAnalysis),
            wrongQuestionCount: getWeakQuestionCount(resultData?.questionFeedback || []),
            chatSummary,
            chatHistory: chatHistory.slice(-6),
            ...extraContext
        };
        try {
            sessionStorage.setItem('latest_consultation_context', JSON.stringify(consultationContext));
        } catch {
            // Continue with router state even if sessionStorage is unavailable.
        }
        navigate(MARKETING_CONFIG.consultationPath, { state: { consultationContext } });
    };

    const openFeedbackRegistrationPrompt = () => {
        document.dispatchEvent(new CustomEvent('openAuthModal', {
            detail: { message: '得点以外のフィードバックを見るには、ログインまたは無料会員登録が必要です。' }
        }));
    };

    const ContentBlockRenderer = ({ blocks, onUpdate, fieldName }) => {
        const handleFileChange = async (e, blockId) => {
            const file = e.target.files[0];
            if (!file) return;

            // Robust examId retrieval
            const currentExamId = examId || resultData?.examId || resultData?.id;

            try {
                console.log("--- Image Upload Debug ---");
                console.log("Target Exam ID:", currentExamId);
                console.log("Supabase URL Configured:", import.meta.env.VITE_SUPABASE_URL);
                
                if (!currentExamId) throw new Error("試験IDを特定できませんでした。トップページから入り直すか、一度データを保存してから再度お試しください。");
                
                const { publicUrl, error } = await uploadAnalysisImage(file, currentExamId);
                if (error) throw error;
                
                console.log("✅ Uploaded Image URL:", publicUrl);
                if (!publicUrl) throw new Error("URLの取得に失敗しました。");
                
                onUpdate(prevBlocks => prevBlocks.map(b => b.id === blockId ? { ...b, imageUrl: publicUrl } : b));
            } catch (err) {
                console.error("❌ Upload error detail:", err);
                alert(`画像のアップロードに失敗しました: ${err.message || '不明なエラー'}\n\n※サーバー再起動（npm run dev）とブラウザ更新（Cmd+Shift+R）を試してください。`);
            }
        };

        const handleAdImageChange = async (e, blockIndex) => {
            const file = e.target.files[0];
            if (!file) return;
            let previewUrl = '';
            try {
                previewUrl = await readFileAsDataUrl(file);
            } catch (err) {
                console.error("Ad image read error:", err);
                alert(`画像ファイルの読み込みに失敗しました: ${err.message || '不明なエラー'}`);
                e.target.value = '';
                return;
            }

            onUpdate(prevBlocks => prevBlocks.map((b, idx) => (
                idx === blockIndex
                    ? { ...b, content: { ...normalizeAdBlockContent(b.content), imageUrl: previewUrl, uploading: true, uploadError: false } }
                    : b
            )));

            try {
                const publicUrl = await uploadBannerImage(file);
                onUpdate(prevBlocks => prevBlocks.map((b, idx) => (
                    idx === blockIndex
                        ? { ...b, content: { ...normalizeAdBlockContent(b.content), imageUrl: publicUrl, uploading: false, uploadError: false } }
                        : b
                )));
            } catch (err) {
                console.error("Ad image upload error:", err);
                onUpdate(prevBlocks => prevBlocks.map((b, idx) => (
                    idx === blockIndex
                        ? { ...b, content: { ...normalizeAdBlockContent(b.content), imageUrl: previewUrl, uploading: false, uploadError: true } }
                        : b
                )));
            } finally {
                e.target.value = '';
            }
        };

        const handleAdResizeStart = (e, blockIndex) => {
            e.preventDefault();
            e.stopPropagation();
            const resizeBox = e.currentTarget.closest('[data-ad-resize-box]');
            const parent = resizeBox?.parentElement;
            if (!parent) return;

            const updateWidth = (clientX) => {
                const rect = parent.getBoundingClientRect();
                if (!rect.width) return;
                const nextWidth = clampAdWidthPercent(((clientX - rect.left) / rect.width) * 100);
                onUpdate(prevBlocks => prevBlocks.map((b, idx) => (
                    idx === blockIndex
                        ? { ...b, content: { ...normalizeAdBlockContent(b.content), widthPercent: nextWidth } }
                        : b
                )));
            };

            const handlePointerMove = (moveEvent) => updateWidth(moveEvent.clientX);
            const handlePointerUp = () => {
                window.removeEventListener('pointermove', handlePointerMove);
                window.removeEventListener('pointerup', handlePointerUp);
            };

            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);
        };

        const addBlock = (type, index = -1) => {
            const newBlock = { 
                type, 
                id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, 
                content: type === 'ad' ? { imageUrl: '', targetUrl: '', widthPercent: 100 } : ((type === 'image_full') ? '' : 'ここに文章を入力...'),
                imageUrl: (type === 'image_left' || type === 'image_full') ? '' : undefined
            };
            
            onUpdate(prevBlocks => {
                const updated = [...prevBlocks];
                if (index >= 0) {
                    updated.splice(index, 0, newBlock);
                } else {
                    updated.push(newBlock);
                }
                return updated;
            });
        };

        const removeBlock = (id) => {
            if (blocks.length <= 1) return;
            onUpdate(blocks.filter(b => b.id !== id));
        };

        const Inserter = ({ index }) => {
            if (!isDesignMode || fieldName === 'weakness') return null;
            return (
                <div 
                    className="block-inserter"
                    style={{ 
                        minHeight: '32px', 
                        margin: '0.35rem 0', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        position: 'relative', 
                        zIndex: 20,
                        cursor: 'pointer'
                    }}
                >
                    <div style={{ width: '100%', height: '1px', background: 'rgba(99,102,241,0.35)', position: 'absolute' }}></div>
                    <div style={{ 
                        background: '#6366f1', 
                        color: 'white', 
                        borderRadius: '2px', 
                        padding: '0 8px', 
                        fontSize: '0.7rem', 
                        fontWeight: '700', 
                        display: 'flex', 
                        gap: '8px',
                        alignItems: 'center',
                        zIndex: 21
                    }}>
                        <span style={{ fontSize: '1rem' }}>+</span> 
                        <span onClick={() => addBlock('heading', index)} style={{ cursor: 'pointer' }}>見出し</span>
                        <span onClick={() => addBlock('subheading', index)} style={{ cursor: 'pointer' }}>中見出し</span>
                        <span onClick={() => addBlock('text', index)} style={{ cursor: 'pointer' }}>テキスト</span>
                        <span onClick={() => addBlock('image_left', index)} style={{ cursor: 'pointer' }}>画像(左)</span>
                        <span onClick={() => addBlock('image_full', index)} style={{ cursor: 'pointer' }}>画像(全幅)</span>
                        {MARKETING_CONFIG.enableAdBanners && (
                            <span onClick={() => addBlock('ad', index)} style={{ cursor: 'pointer' }}>広告</span>
                        )}
                    </div>
                </div>
            );
        };

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {blocks.map((block, index) => {
                    const blockKey = block.id || `${fieldName}-${index}-${block.type}`;
                    const adContent = block.type === 'ad' ? normalizeAdBlockContent(block.content) : null;
                    const adPreviewUrl = adContent ? adContent.imageUrl : '';
                    return (
                    <div key={blockKey}>
                        <Inserter index={index} />
                        <div style={{ 
                            position: 'relative', 
                            border: (isDesignMode && fieldName !== 'weakness') ? '1px dashed #6366f1' : 'none', 
                            padding: (isDesignMode && fieldName !== 'weakness') ? '0.5rem' : '0', 
                            borderRadius: '2px',
                            margin: '0.5rem 0'
                        }}>
                            {isDesignMode && fieldName !== 'weakness' && (
                                <button 
                                    onClick={() => removeBlock(block.id)}
                                    style={{ position: 'absolute', top: '-10px', right: '-10px', width: '24px', height: '24px', borderRadius: '50%', background: '#ef4444', color: 'white', border: 'none', cursor: 'pointer', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    ×
                                </button>
                            )}

                            {block.type === 'heading' && (
                                <div 
                                    contentEditable={isDesignMode}
                                    suppressContentEditableWarning
                                    onBlur={(e) => {
                                        const next = blocks.map(b => b.id === block.id ? { ...b, content: e.target.innerText } : b);
                                        onUpdate(next);
                                    }}
                                    style={{ fontSize: '1.4rem', fontWeight: '700', color: 'var(--color-text-primary)', marginBottom: '0.75rem', outline: 'none', lineHeight: '1.4' }}
                                >
                                    {block.content}
                                </div>
                            )}

                            {block.type === 'subheading' && (
                                <div 
                                    contentEditable={isDesignMode}
                                    suppressContentEditableWarning
                                    onBlur={(e) => {
                                        const next = blocks.map(b => b.id === block.id ? { ...b, content: e.target.innerText } : b);
                                        onUpdate(next);
                                    }}
                                    style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--color-text-primary)', marginBottom: '0.5rem', marginTop: '1rem', outline: 'none', lineHeight: '1.4' }}
                                >
                                    {block.content}
                                </div>
                            )}

                            {block.type === 'text' && (
                                <div style={{ position: 'relative' }}>
                                    <div 
                                        contentEditable={isDesignMode}
                                        suppressContentEditableWarning
                                        onBlur={(e) => {
                                            const next = blocks.map(b => b.id === block.id ? { ...b, content: e.target.innerText } : b);
                                            onUpdate(next);
                                        }}
                                        style={{ lineHeight: '1.6', color: 'var(--color-text-secondary)', fontSize: '0.9rem', outline: 'none', whiteSpace: 'pre-wrap', paddingRight: isDesignMode ? '40px' : '0' }}
                                    >
                                        {block.content}
                                    </div>
                                    {isDesignMode && fieldName !== 'weakness' && (
                                        <button 
                                            onMouseDown={(e) => {
                                                e.preventDefault(); // Prevent blur to keep selection
                                                const selection = window.getSelection();
                                                if (!selection.rangeCount) return;
                                                const range = selection.getRangeAt(0);
                                                const offset = range.startOffset;
                                                
                                                onUpdate(prevBlocks => {
                                                    const updated = [...prevBlocks];
                                                    const idx = updated.findIndex(b => b.id === block.id);
                                                    if (idx === -1) return prevBlocks;
                                                    
                                                    const originalText = updated[idx].content;
                                                    const beforeText = originalText.substring(0, offset);
                                                    const afterText = originalText.substring(offset);
                                                    
                                                    updated[idx] = { ...updated[idx], content: beforeText };
                                                    updated.splice(idx + 1, 0, { type: 'text', content: afterText, id: Math.random() });
                                                    return updated;
                                                });
                                            }}
                                            title="ここで文章を分割"
                                            style={{ position: 'absolute', top: 0, right: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', opacity: 0.6, padding: '4px' }}
                                        >
                                            分割
                                        </button>
                                    )}
                                </div>
                            )}

                            {block.type === 'image_left' && (
                                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                    <div style={{ flex: '0 0 200px', width: '200px' }}>
                                        <div style={{ width: '100%', minHeight: '120px', borderRadius: '2px', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                            {block.imageUrl ? (
                                                <img src={block.imageUrl} alt="Analysis" style={{ width: '100%', height: '100%', minHeight: '120px', objectFit: 'cover', display: 'block' }} />
                                            ) : (
                                                <span style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 700 }}>画像を選択</span>
                                            )}
                                        </div>
                                        {isDesignMode && fieldName !== 'weakness' && (
                                            <input type="file" accept="image/*" onChange={(e) => handleFileChange(e, block.id)} style={{ fontSize: '0.7rem', marginTop: '0.5rem', width: '100%' }} />
                                        )}
                                    </div>
                                    <div 
                                        contentEditable={isDesignMode}
                                        suppressContentEditableWarning
                                        onBlur={(e) => {
                                            const next = blocks.map(b => b.id === block.id ? { ...b, content: e.target.innerText } : b);
                                            onUpdate(next);
                                        }}
                                        style={{ flex: '1 1 300px', lineHeight: '1.6', color: 'var(--color-text-secondary)', fontSize: '0.9rem', outline: 'none', whiteSpace: 'pre-wrap' }}
                                    >
                                        {block.content}
                                    </div>
                                </div>
                            )}

                            {block.type === 'image_full' && (
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ width: '100%', minHeight: '140px', borderRadius: '2px', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                        {block.imageUrl ? (
                                            <img src={block.imageUrl} alt="Analysis" style={{ width: '100%', maxHeight: '360px', objectFit: 'contain', display: 'block' }} />
                                        ) : (
                                            <span style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 700 }}>画像を選択</span>
                                        )}
                                    </div>
                                    {isDesignMode && fieldName !== 'weakness' && (
                                        <input type="file" accept="image/*" onChange={(e) => handleFileChange(e, block.id)} style={{ fontSize: '0.7rem', marginTop: '0.5rem' }} />
                                    )}
                                </div>
                            )}

                            {MARKETING_CONFIG.enableAdBanners && block.type === 'ad' && (
                                <div style={{ position: 'relative', border: isDesignMode ? '2px dashed #6366f1' : 'none', borderRadius: '2px', padding: isDesignMode ? '1.5rem' : '0', background: isDesignMode ? 'rgba(99,102,241,0.02)' : 'none' }}>
                                    {isDesignMode && (
                                        <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid rgba(99,102,241,0.1)', paddingBottom: '1rem' }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: '800', color: '#6366f1', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                <span style={{ background: '#6366f1', color: 'white', padding: '2px 6px', borderRadius: '2px' }}>AD</span> 広告ユニット設定
                                            </div>
                                            
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                                                <div>
                                                    <label style={{ fontSize: '0.65rem', fontWeight: '900', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', textTransform: 'uppercase' }}>① 画像をアップロード</label>
                                                    <label style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        width: '100%',
                                                        minHeight: '42px',
                                                        padding: '0.5rem',
                                                        borderRadius: '2px',
                                                        border: '1px solid #e2e8f0',
                                                        fontSize: '0.8rem',
                                                        background: 'white',
                                                        color: '#334155',
                                                        fontWeight: '800',
                                                        cursor: 'pointer',
                                                        userSelect: 'none'
                                                    }}>
                                                        画像を選択
                                                        <input
                                                            type="file"
                                                            accept="image/*"
                                                            onChange={(e) => handleAdImageChange(e, index)}
                                                            style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
                                                        />
                                                    </label>
                                                    {adContent.uploading && (
                                                        <p style={{ margin: '0.35rem 0 0', color: '#6366f1', fontSize: '0.7rem', fontWeight: 700 }}>アップロード中...</p>
                                                    )}
                                                    {adContent.uploadError && (
                                                        <p style={{ margin: '0.35rem 0 0', color: '#ef4444', fontSize: '0.7rem', fontWeight: 700 }}>アップロード失敗。選択画像を一時表示中です。</p>
                                                    )}
                                                </div>
                                                <div>
                                                    <label style={{ fontSize: '0.65rem', fontWeight: '900', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', textTransform: 'uppercase' }}>② 「詳しく見る」の遷移先URL</label>
                                                    <input
                                                            type="url"
                                                            defaultValue={adContent.targetUrl || ''}
                                                            onBlur={(e) => {
                                                            const next = blocks.map((b, idx) => idx === index ? { ...b, content: { ...normalizeAdBlockContent(b.content), targetUrl: e.target.value } } : b);
                                                            onUpdate(next);
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') e.currentTarget.blur();
                                                        }}
                                                        placeholder="https://example.com"
                                                        style={{ width: '100%', padding: '0.5rem', borderRadius: '2px', border: '1px solid #6366f1', color: '#334155', fontSize: '0.8rem', outline: 'none', background: 'white', fontWeight: '700' }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                                        <div
                                            data-ad-resize-box
                                            style={{
                                                position: 'relative',
                                                width: `${adContent.widthPercent}%`,
                                                minWidth: '160px',
                                                maxWidth: '100%'
                                            }}
                                        >
                                            {adPreviewUrl ? (
                                                <a
                                                    href={adContent.targetUrl || '#'}
                                                    target={adContent.targetUrl ? '_blank' : undefined}
                                                    rel={adContent.targetUrl ? 'noopener noreferrer' : undefined}
                                                    onClick={(e) => {
                                                        if (!adContent.targetUrl) e.preventDefault();
                                                    }}
                                                    className="block relative overflow-hidden rounded-sm shadow-sm border border-gray-200 hover:shadow-md transition-shadow w-full min-h-[60px] aspect-[16/3] md:aspect-[1200/300]"
                                                >
                                                    <img
                                                        src={adPreviewUrl}
                                                        alt="広告"
                                                        className="w-full h-full object-cover"
                                                        style={{ minHeight: '60px' }}
                                                    />
                                                    <div className="absolute bottom-2 right-2 bg-red-700 text-white text-xs font-bold px-3 py-1 rounded-sm">詳しく見る</div>
                                                </a>
                                            ) : (
                                                <div style={{ minHeight: '120px', border: '1px dashed #cbd5e1', borderRadius: '2px', background: '#f8fafc', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 700 }}>
                                                    広告画像をアップロードしてください
                                                </div>
                                            )}
                                            {isDesignMode && (
                                                <button
                                                    type="button"
                                                    aria-label="広告サイズを調整"
                                                    title="ドラッグして広告サイズを調整"
                                                    onPointerDown={(e) => handleAdResizeStart(e, index)}
                                                    style={{
                                                        position: 'absolute',
                                                        right: '-8px',
                                                        bottom: '-8px',
                                                        width: '18px',
                                                        height: '18px',
                                                        borderRadius: '2px',
                                                        border: '2px solid #6366f1',
                                                        background: 'white',
                                                        cursor: 'nwse-resize',
                                                        zIndex: 12,
                                                        boxShadow: '0 2px 8px rgba(15,23,42,0.18)'
                                                    }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )})}
                <Inserter index={blocks.length} />

                {isDesignMode && fieldName !== 'weakness' && blocks.length === 0 && (
                    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center', marginTop: '1rem', padding: '0.5rem', background: 'rgba(99,102,241,0.05)', borderRadius: '2px', flexWrap: 'wrap' }}>
                        <button onClick={() => addBlock('heading')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '2px', border: '1px solid #6366f1', background: 'white', color: '#6366f1', cursor: 'pointer' }}>+ 見出し</button>
                        <button onClick={() => addBlock('subheading')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '2px', border: '1px solid #6366f1', background: 'white', color: '#6366f1', cursor: 'pointer' }}>+ 中見出し</button>
                        <button onClick={() => addBlock('text')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '2px', border: '1px solid #6366f1', background: 'white', color: '#6366f1', cursor: 'pointer' }}>+ テキスト</button>
                        <button onClick={() => addBlock('image_left')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '2px', border: '1px solid #6366f1', background: 'white', color: '#6366f1', cursor: 'pointer' }}>+ 画像(左)</button>
                        <button onClick={() => addBlock('image_full')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '2px', border: '1px solid #6366f1', background: 'white', color: '#6366f1', cursor: 'pointer' }}>+ 画像(全幅)</button>
                        {MARKETING_CONFIG.enableAdBanners && (
                            <button onClick={() => addBlock('ad')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '2px', border: '1px solid #6366f1', background: '#6366f1', color: 'white', cursor: 'pointer' }}>+ 広告</button>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="container result-page" style={{ maxWidth: '1400px', paddingBottom: '4rem' }}>
            {location.state?.fromAdmin && (
                <div style={{ marginBottom: '1.25rem' }}>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => navigate('/admin')}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            padding: '0.5rem 1rem',
                            fontSize: '0.85rem',
                            fontWeight: 800,
                            borderRadius: '6px',
                            background: '#ffffff',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
                        }}
                    >
                        <span>←</span>
                        <span>成績ログ一覧に戻る</span>
                    </button>
                </div>
            )}
            <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>採点結果</h1>
                <p style={{ color: 'var(--color-text-secondary)' }}>{resultMetaParts.join(' - ')}</p>
                {planFeatures.unlimitedGrading && (
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        marginTop: '0.85rem',
                        padding: '0.35rem 0.8rem',
                        borderRadius: '999px',
                        border: '1px solid #f59e0b',
                        background: 'linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%)',
                        color: '#92400e',
                        fontSize: '0.78rem',
                        fontWeight: 900,
                        letterSpacing: '0.08em',
                        boxShadow: '0 8px 22px rgba(245, 158, 11, 0.16)'
                    }}>
                        <span>PREMIUM ACTIVE</span>
                        <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#d97706' }} />
                        <span>詳細解説・AI質問 解放中</span>
                    </div>
                )}
                {isAdmin && (
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1rem' }}>
                        <button 
                            onClick={() => {
                                if (!isDesignMode) {
                                    setOriginalData({
                                        detailedAnalysis: resultData.detailedAnalysis,
                                        sectionAnalysis: currentStructure.map(s => ({ id: s.id, content: s.sectionAnalysis })),
                                        weaknessAnalysis: resultData.weaknessAnalysis
                                    });
                                }
                                setIsDesignMode(!isDesignMode);
                            }}
                            style={{ padding: '0.5rem 1.5rem', background: isDesignMode ? '#ef4444' : '#6366f1', color: 'white', border: 'none', borderRadius: '2px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}
                        >
                            {isDesignMode ? '⚊ 編集モードを終了' : 'レイアウトを直接編集する'}
                        </button>
                    </div>
                )}
            </header>


            <div className="glass-panel result-section-card" style={{ padding: '2rem', marginBottom: '2rem', textAlign: 'center' }}>
                <div className="result-summary-grid" style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 120px' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>得点</div>
                        <div className="result-summary-number" style={{ fontSize: '3rem', fontWeight: '700', color: 'var(--color-accent-primary)' }}>
                            {floorDisplayScore(resultData.score)}<span style={{ fontSize: '1.2rem', color: 'var(--color-text-secondary)' }}>/{floorDisplayScore(resultData.maxScore)}</span>
                        </div>
                        {resultData.scoreCap && (
                            <div style={{ fontSize: '0.75rem', color: '#f97316', marginTop: '0.3rem', fontWeight: '600' }}>
                                ※得点調整済み（素点: {floorDisplayScore(resultData.rawScore)}/{floorDisplayScore(resultData.rawMaxScore)}）
                            </div>
                        )}
                        {resultData.scoreCompression && (
                            <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '0.3rem', fontWeight: '700', lineHeight: 1.6 }}>
                                ※得点圧縮済み（素点: {floorDisplayScore(resultData.scoreCompression.rawScore)}/{floorDisplayScore(resultData.scoreCompression.rawMaxScore)} → {floorDisplayScore(resultData.scoreCompression.compressedScore)}/{floorDisplayScore(resultData.scoreCompression.compressedMaxScore)}）
                            </div>
                        )}
                    </div>
                    {user && (
                        <div style={{ flex: '1 1 120px' }}>
                            <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
                                {planFeatures.fullPassJudgement ? '合格可能性' : '簡易合格判定'}
                            </div>
                            <div className="result-summary-number" style={{ fontSize: '3rem', fontWeight: '700', color: getProbabilityColor(resultData.passProbability) }}>
                                {resultData.passProbability}
                            </div>
                            {!planFeatures.fullPassJudgement && (
                                <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '0.35rem', fontWeight: 700 }}>
                                    詳細判定はプレミアムで確認できます
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {user ? (
                    <>
                        <UsageLimitCard
                            usage={displayedUsageStatus}
                            compact
                            showConsultationCta={!planFeatures.unlimitedGrading && usageStatus?.remaining <= 0}
                            onConsultationClick={() => handleReserveConsultation({ source: 'result_limit_cta' })}
                            onPremiumClick={() => navigate('/premium')}
                        />

                        {planFeatures.fullPassJudgement ? (
                            <PremiumAdmissionAnalysisCard analysis={premiumAdmissionAnalysis} />
                        ) : (
                            <>
                                <AdBanner
                                    slot="result_premium_lock"
                                    pageTarget="result"
                                    variant="lock_cta"
                                    context={adContext}
                                    audience={adContext.audience}
                                    className="mb-4"
                                />
                                <PremiumMosaic
                                    title="合格までの差を詳しく見る"
                                    description="次の判定まで何点必要か、どの大問を優先すべきかを確認できます。"
                                    buttonLabel="詳細な合格判定を開放する"
                                    onClick={() => navigate('/premium')}
                                >
                                    <PremiumAdmissionAnalysisCard analysis={premiumAdmissionAnalysis} />
                                </PremiumMosaic>
                            </>
                        )}

                        {!planFeatures.history && (
                            <PremiumLockCard
                                title="過去履歴を開放する"
                                description="この採点結果をあとから見返し、過去履歴や成績推移として復習に使えます。"
                                features={['過去履歴', '成績推移']}
                                buttonLabel="プレミアムで履歴を見る"
                                onClick={() => navigate('/premium')}
                            />
                        )}

                        <div className="no-print result-action-buttons" style={{ 
                            display: 'flex', 
                            gap: '1rem', 
                            justifyContent: 'center', 
                            marginTop: '2rem',
                            padding: '1rem',
                            borderTop: '1px solid rgba(0,0,0,0.05)',
                            flexWrap: 'wrap'
                        }}>
                            <button 
                                onClick={() => window.print()}
                                className="btn btn-secondary"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.5rem' }}
                            >
                                結果を印刷/PDF保存
                            </button>
                            {(location.state?.pdfPath || examId) && (
                                <button 
                                    onClick={() => {
                                        const path = location.state?.pdfPath;
                                        if (path) window.open(path, '_blank');
                                        else alert("原本PDFのパスが見つかりません。");
                                    }}
                                    className="btn btn-secondary"
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.5rem' }}
                                >
                                    <span>📄</span> 原本PDFを表示
                                </button>
                            )}
                            <button 
                                onClick={handleXShare}
                                className="btn"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.5rem', background: '#0f1419', color: 'white', border: 'none' }}
                            >
                                <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>𝕏</span> 結果をシェア
                            </button>
                        </div>

                        <div style={{ textAlign: 'left', background: 'rgba(255,255,255,0.5)', padding: '1.25rem', borderRadius: '2px', marginTop: '2rem', border: '1px solid #cbd5e1' }}>
                            <h3 style={{ fontSize: '1rem', color: 'var(--color-text-primary)', marginBottom: '1rem' }}>弱点分析・アドバイス</h3>
                            {ContentBlockRenderer({
                                fieldName: 'weakness',
                                blocks: parseBlocks(resultData.weaknessAnalysis),
                                onUpdate: (updateFn) => {
                                    setResultData(prev => ({
                                        ...prev,
                                        weaknessAnalysis: typeof updateFn === 'function' ? updateFn(parseBlocks(prev.weaknessAnalysis)) : updateFn
                                    }));
                                }
                            })}
                        </div>

                        <ConsultationCTA
                            onClick={() => handleReserveConsultation({ source: 'result_weakness_cta' })}
                        />
                    </>
                ) : (
                    <PremiumLockCard
                        title="無料会員登録でフィードバックを表示"
                        description="得点以外の合格判定・弱点分析・詳細フィードバック・AI質問は、ログイン後に表示されます。"
                        features={['合格判定', '弱点分析', '詳細フィードバック', 'AI質問']}
                        buttonLabel="ログイン / 無料登録"
                        onClick={openFeedbackRegistrationPrompt}
                    />
                )}
            </div>

            {user && (
                <>
            <AdBanner
                slot="result_top"
                pageTarget="result"
                context={adContext}
                audience={adContext.audience}
                className="mb-8"
            />

            <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', textAlign: 'center' }}>成績分析</h2>
                <div className="glass-panel result-section-card" style={{ padding: '2rem' }}>
                    {stats ? (
                        <>
                            <div className="result-summary-grid" style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '2rem', marginBottom: '2rem' }}>
                                <div style={{ textAlign: 'center', minWidth: '120px' }}>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>偏差値</div>
                                    <div className="result-summary-number" style={{ fontSize: '2.5rem', fontWeight: '700', color: 'var(--color-text-primary)' }}>{stats.deviationValue}</div>
                                </div>
                                <div style={{ textAlign: 'center', minWidth: '120px' }}>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>全体順位</div>
                                    <div className="result-summary-number" style={{ fontSize: '2.5rem', fontWeight: '700', color: 'var(--color-text-primary)' }}>
                                        {stats.ranking}<span style={{ fontSize: '1.2rem', color: 'var(--color-text-secondary)' }}>/{stats.totalExaminees}位</span>
                                    </div>
                                </div>
                                {stats.firstChoiceUniversity && (
                                    <div style={{ textAlign: 'center', minWidth: '120px', borderLeft: '1px solid #eee', paddingLeft: '2rem' }}>
                                        <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>{stats.firstChoiceUniversity}志望内順位</div>
                                        <div className="result-summary-number" style={{ fontSize: '2.5rem', fontWeight: '700', color: 'var(--color-accent-primary)' }}>
                                            {stats.firstChoiceRank ? (
                                                <>{stats.firstChoiceRank}<span style={{ fontSize: '1.2rem', color: 'var(--color-text-secondary)' }}>/{stats.firstChoiceTotal}位</span></>
                                            ) : (
                                                <span style={{ fontSize: '1.2rem', color: '#999' }}>データ不足</span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                            {stats.sectionAverages && stats.sectionAverages.length > 0 && (
                                <div style={{ marginTop: '2rem' }}>
                                    <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', textAlign: 'center' }}>大問別得点比較</h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {stats.sectionAverages.map((section, index) => (
                                            <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                                <div style={{ width: '60px', fontWeight: '600' }}>{section.sectionId}</div>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.85rem' }}>
                                                        <span>あなた: {section.userScore}</span>
                                                        <span>平均: {floorDisplayScore(section.averageScore)}</span>
                                                    </div>
                                                    <div style={{ height: '10px', background: '#e2e8f0', borderRadius: '5px', overflow: 'hidden', position: 'relative' }}>
                                                        <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${(section.userScore / section.maxScore) * 100}%`, background: 'var(--color-accent-primary)', opacity: 0.8 }} />
                                                        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(section.averageScore / section.maxScore) * 100}%`, width: '4px', background: '#ef4444', zIndex: 10 }} />
                                                    </div>
                                                </div>
                                                <div style={{ width: '40px', textAlign: 'right', fontSize: '0.85rem', color: '#64748b' }}>/{section.maxScore}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : error ? (
                        <div style={{ textAlign: 'center', padding: '2rem', color: '#ef4444' }}><p>データの読み込みに失敗しました。</p></div>
                    ) : (
                        <div style={{ textAlign: 'center', padding: '2rem' }}>分析データを読み込み中...</div>
                    )}
                </div>
            </div>

            <>
                    <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>詳細フィードバック</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
                        {currentStructure && currentStructure.length > 0 ? (
                    currentStructure.map((section) => {
                        const sectionId = section.id;
                        const sectionQuestionIds = section.questions?.map(q => q.id) || [];
                        const sectionFeedback = (resultData.questionFeedback || []).filter(item => {
                            const itemId = String(item.id);
                            const matchesByList = sectionQuestionIds.some(qId => String(qId) === itemId);
                            const matchesByPrefix = (sectionQuestionIds.length === 0 && itemId.startsWith(String(sectionId) + '-'));
                            return matchesByList || matchesByPrefix;
                        });
                        const sectionWrongItems = sectionFeedback.filter(item => !item.correct);
                        const sectionAccuracy = sectionFeedback.length > 0 ? (sectionFeedback.length - sectionWrongItems.length) / sectionFeedback.length : 1;
                        const shouldShowSectionConsultation = sectionFeedback.length > 0 && sectionAccuracy < 0.6;
                        const sectionLabel = section.label || section.title || `大問 ${sectionId}`;
                        const sectionTotalPoints = section.totalPoints || section.allocatedPoints || section.questions?.reduce((sum, q) => sum + (q.points || 0), 0) || null;
                        const sectionRawScore = sectionFeedback.reduce((sum, item) => sum + getFeedbackScore(item), 0);
                        const sectionScore = sectionTotalPoints ? Math.min(sectionRawScore, Number(sectionTotalPoints)) : sectionRawScore;
                        return (
                            <div key={sectionId} className="glass-panel result-section-card" style={{ padding: '1.5rem' }}>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '1.25rem', color: 'var(--color-text-primary)', borderBottom: '2px solid var(--color-accent-primary)', paddingBottom: '0.5rem' }}>
                                    {section.label || section.title || `大問 ${sectionId}`}
                                    {section.totalPoints && <span style={{ fontSize: '0.8rem', fontWeight: '500', color: '#64748b', marginLeft: '0.75rem' }}>（配点 {section.totalPoints}点）</span>}
                                </h3>
                                <div className="result-feedback-row" style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                    <div style={{ flex: '1 1 500px', minWidth: 0 }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                            {sectionFeedback.map((item) => {
                                                const status = getFeedbackStatus(item);
                                                return (
                                                <div key={item.id} style={{ padding: '1rem', borderLeft: `3px solid ${status.border}`, background: status.background, borderRadius: '0 2px 2px 0' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                        <span style={{ fontWeight: '600' }}>{item.id}</span>
                                                        <span style={{ color: status.color, background: status.badgeBackground, fontWeight: '600', padding: '0.15rem 0.5rem', borderRadius: '2px', fontSize: '0.75rem', border: `1px solid ${status.border}` }}>{status.label}</span>
                                                    </div>
                                                    <div style={{ fontSize: '0.85rem' }}>
                                                        <span style={{ fontWeight: '600' }}>解答:</span> {item.userAnswer || '(無回答)'} <span style={{ color: '#cbd5e1' }}>→</span> <span style={{ fontWeight: '600' }}>正解:</span> {item.correctAnswer}
                                                    </div>
                                                    {item.essayResult ? (
                                                        <EssayGradingDetail item={item} />
                                                    ) : (
                                                        item.explanation && <p style={{ fontSize: '0.85rem', marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>{item.explanation}</p>
                                                    )}
                                                    <div style={{ textAlign: 'right' }}><button onClick={() => {
                                                         if (!user) {
                                                             document.dispatchEvent(new CustomEvent('openAuthModal', { detail: { message: '採点ミスの報告にはログインが必要です。' } }));
                                                             return;
                                                         }
                                                         setReportingItem(item);
                                                     }} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}>採点ミスを報告</button></div>
                                                </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    {window.innerWidth > 768 ? (
                                        <SectionAnalysisShell isDesignMode={isDesignMode}>
                                            <p style={{ fontSize: '0.75rem', fontWeight: '700', color: '#6366f1', marginBottom: '0.75rem' }}>大問全体の詳細解説</p>
                                            {planFeatures.detailedExplanations ? (
                                                ContentBlockRenderer({
                                                    fieldName: 'section',
                                                    blocks: parseBlocks(section.sectionAnalysis),
                                                    onUpdate: (updateFn) => {
                                                        setCurrentStructure(prev => {
                                                            const next = [...prev];
                                                            const idx = next.findIndex(s => s.id === sectionId);
                                                            if (idx !== -1) {
                                                                const currentBlocks = parseBlocks(next[idx].sectionAnalysis);
                                                                next[idx] = {
                                                                    ...next[idx],
                                                                    sectionAnalysis: typeof updateFn === 'function' ? updateFn(currentBlocks) : updateFn
                                                                };
                                                            }
                                                            return next;
                                                        });
                                                    }
                                                })
                                            ) : (
                                                <>
                                                    <AdBanner
                                                        slot="result_premium_lock"
                                                        pageTarget="result"
                                                        variant="lock_cta"
                                                        context={adContext}
                                                        audience={adContext.audience}
                                                        className="mb-3"
                                                    />
                                                    <PremiumMosaic
                                                        title="この解説を開放する"
                                                        description="小問解説に加えて、大問全体の読み方・失点原因・復習ポイントまで確認できます。"
                                                            buttonLabel="プレミアムで解説を見る"
                                                        onClick={() => navigate('/premium')}
                                                    >
                                                        {ContentBlockRenderer({
                                                            fieldName: 'section',
                                                            blocks: parseBlocks(section.sectionAnalysis),
                                                            onUpdate: () => {}
                                                        })}
                                                    </PremiumMosaic>
                                                </>
                                            )}
                                        </SectionAnalysisShell>
                                    ) : (
                                        <details style={{
                                            width: '100%',
                                            background: 'rgba(99,102,241,0.04)',
                                            borderRadius: '2px',
                                            overflow: 'hidden',
                                            border: isDesignMode ? '1px dashed #6366f1' : '1px solid #e2e8f0'
                                        }}>
                                            <summary style={{
                                                padding: '0.75rem 1rem',
                                                cursor: 'pointer',
                                                fontWeight: '700',
                                                fontSize: '0.8rem',
                                                color: '#6366f1',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                listStyle: 'none',
                                                outline: 'none',
                                                userSelect: 'none'
                                            }}>
                                                <span>大問全体の詳細解説を表示</span>
                                                <span className="details-arrow" style={{ transition: 'transform 0.3s ease' }}>▼</span>
                                            </summary>
	                                            <div style={{ padding: '0 1rem 1rem' }}>
	                                                {planFeatures.detailedExplanations ? (
	                                                    ContentBlockRenderer({
	                                                        fieldName: 'section',
	                                                        blocks: parseBlocks(section.sectionAnalysis),
	                                                        onUpdate: (updateFn) => {
	                                                            setCurrentStructure(prev => {
	                                                                const next = [...prev];
	                                                                const idx = next.findIndex(s => s.id === sectionId);
	                                                                if (idx !== -1) {
	                                                                    const currentBlocks = parseBlocks(next[idx].sectionAnalysis);
	                                                                    next[idx] = {
	                                                                        ...next[idx],
	                                                                        sectionAnalysis: typeof updateFn === 'function' ? updateFn(currentBlocks) : updateFn
	                                                                    };
	                                                                }
	                                                                return next;
	                                                            });
	                                                        }
	                                                    })
	                                                ) : (
	                                                    <>
	                                                        <AdBanner
	                                                            slot="result_premium_lock"
	                                                            pageTarget="result"
	                                                            variant="lock_cta"
	                                                            context={adContext}
	                                                            audience={adContext.audience}
	                                                            className="mb-3"
	                                                        />
	                                                        <PremiumMosaic
	                                                            title="この解説を開放する"
	                                                            description="小問解説に加えて、大問全体の読み方・失点原因・復習ポイントまで確認できます。"
                                                                buttonLabel="プレミアムで解説を見る"
	                                                            onClick={() => navigate('/premium')}
	                                                        >
	                                                            {ContentBlockRenderer({
	                                                                fieldName: 'section',
	                                                                blocks: parseBlocks(section.sectionAnalysis),
	                                                                onUpdate: () => {}
	                                                            })}
	                                                        </PremiumMosaic>
	                                                    </>
	                                                )}
	                                            </div>
	                                        </details>
                                    )}
                                </div>
                                {shouldShowSectionConsultation && (
                                    <ConsultationCTA
                                        variant="inline"
                                        title={`${sectionLabel}の復習方針を相談する`}
                                        description="この大問で失点が目立ちます。解き直し方と優先すべき復習を講師が整理します。"
                                        buttonLabel="大問相談を申し込む"
                                        onClick={() => handleReserveConsultation({
                                            source: 'section_cta',
                                            sectionFocus: {
                                                sectionId,
                                                sectionLabel,
                                                sectionScore,
                                                sectionMaxScore: sectionTotalPoints,
                                                sectionAccuracy: Math.round(sectionAccuracy * 100),
                                                wrongQuestionIds: sectionWrongItems.map(item => item.id),
                                                sectionAnalysis: extractWeaknessText(section.sectionAnalysis)
                                            }
                                        })}
                                    />
                                )}
                                {shouldShowVocabulary && section.vocabulary && section.vocabulary.length > 0 && (
                                    <div style={{ marginTop: '1.5rem' }}>
                                        <details open style={{ background: '#f8fafc', borderRadius: '2px', border: '1px solid #e2e8f0', overflow: 'hidden', transition: 'all 0.3s ease' }}>
                                            <summary style={{ padding: '1rem', cursor: 'pointer', fontWeight: 'bold', color: 'var(--color-accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', outline: 'none', listStyle: 'none' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                                    <span style={{ fontSize: '0.95rem' }}>この大問で出題された難単語 ({section.vocabulary.length}語)</span>
                                                </div>
                                                <span className="details-arrow" style={{ transition: 'transform 0.3s ease' }}>▼</span>
                                            </summary>
                                            <div style={{ padding: '0 1rem 1rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                {section.vocabulary.map((vocab, vIdx) => (
                                                    <span key={vIdx} style={{ background: 'white', border: '1px solid #cbd5e1', padding: '0.4rem 0.8rem', borderRadius: '2px', fontSize: '0.85rem' }}>
                                                        <span style={{ fontWeight: 'bold', color: '#1e293b', marginRight: '0.4rem' }}>{vocab.word}</span>
                                                        <span style={{ color: '#64748b' }}>{vocab.meaning}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </details>
                                    </div>
                                )}
                            </div>
                        );
                    })
                        ) : (
                            <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>フィードバックデータがありません。</div>
                        )}
                    </div>
            </>



	            <RecruitmentBanner />

	            <div style={{ marginTop: '3rem' }}>
	                <>
	                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
	                            <h2 style={{ fontSize: '1.5rem' }}>解説についてAIに質問する</h2>
	                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', borderLeft: '1px solid var(--color-silver-light)', paddingLeft: '1rem' }}>
	                                会話履歴はこのタブを閉じると消えます。アカウントには保存されません。
	                            </span>
	                        </div>
	                        <div className="glass-panel" style={{ padding: '1.5rem', position: 'relative', overflow: 'hidden' }}>
	                            <div
	                                style={{
	                                    filter: planFeatures.aiQuestions ? 'none' : 'blur(5px)',
	                                    opacity: planFeatures.aiQuestions ? 1 : 0.5,
	                                    pointerEvents: planFeatures.aiQuestions ? 'auto' : 'none',
	                                    userSelect: planFeatures.aiQuestions ? 'auto' : 'none'
	                                }}
	                            >
	                            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
	                                {chatHistory.length === 0 && (
	                                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', textAlign: 'center', margin: '1rem 0', lineHeight: '1.6' }}>
                                        解説でわからなかった点について、AIアシスタントに自由に質問してください。<br />
                                        <span style={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: 'bold' }}>※相手はAIです。回答が不正確な場合がありますのでご注意ください。</span>
                                    </p>
                                )}
                                {chatHistory.map((msg, i) => (
                            <div key={i} style={{ 
                                display: 'flex', 
                                flexDirection: 'column', 
                                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                maxWidth: '80%'
                            }}>
                                <span style={{ 
                                    fontSize: '0.7rem', 
                                    color: 'var(--color-text-secondary)', 
                                    marginBottom: '0.2rem',
                                    textAlign: msg.role === 'user' ? 'right' : 'left',
                                    fontWeight: 'bold'
                                }}>
                                    {msg.role === 'user' ? 'あなた' : 'AIアシスタント'}
                                </span>
                                <div style={{ 
                                    background: msg.role === 'user' ? 'var(--color-accent-primary)' : '#f1f5f9', 
                                    color: msg.role === 'user' ? 'white' : '#333', 
                                    padding: '0.75rem 1rem', 
                                    borderRadius: '2px' 
                                }}>
                                    {msg.text}
                                </div>
                            </div>
                                ))}
                                {isChatting && (
                            <div style={{ 
                                display: 'flex',
                                flexDirection: 'column',
                                alignSelf: 'flex-start',
                                maxWidth: '80%'
                            }}>
                                <span style={{
                                    fontSize: '0.7rem',
                                    color: 'var(--color-text-secondary)',
                                    marginBottom: '0.2rem',
                                    fontWeight: 'bold'
                                }}>
                                    AIアシスタント
                                </span>
                                <div className="ai-chat-loading">
                                    <span>回答を作成中</span>
                                    <span className="ai-chat-loading__dots" aria-hidden="true">
                                        <span></span>
                                        <span></span>
                                        <span></span>
                                    </span>
                                </div>
                            </div>
                                )}
                            </div>
                            {chatHistory.some(msg => msg.role === 'user') && (
                                <ConsultationCTA
                                    variant="compact"
                                    title="この質問をプロ講師に引き継ぐ"
                                    description="AIとのやり取りと診断結果をもとに、復習方針を整理します。"
                                    buttonLabel="質問を引き継ぐ"
                                    onClick={() => handleReserveConsultation({
                                        source: 'chat_cta',
                                        chatSummary: buildChatSummary()
                                    })}
                                />
                            )}
                            <form onSubmit={handleChatSubmit} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <input 
                                    type="text" 
                                    value={chatInput} 
                                    onChange={(e) => setChatInput(e.target.value)} 
	                                    placeholder={planFeatures.aiQuestions ? "AIへの質問を入力..." : (user ? "プレミアムでAI質問を使う" : "AIに質問するにはログインが必要です")} 
	                                    style={{ flex: 1, minWidth: '200px', padding: '0.75rem', borderRadius: '2px', border: '1px solid #e2e8f0' }} 
	                                    disabled={isChatting || !planFeatures.aiQuestions} 
	                                    onClick={(e) => {
	                                        if (!user) {
	                                            e.preventDefault();
                                            document.dispatchEvent(new CustomEvent('openAuthModal', { detail: { message: 'AIに質問するにはログインが必要です。' } }));
                                        }
	                                    }}
	                                />
	                                <button type="submit" className="btn btn-primary" disabled={isChatting || !planFeatures.aiQuestions}>送信</button>
	                            </form>
	                            <p style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.75rem', marginBottom: 0 }}>
	                                ※ 自動生成AIによる回答です。解答内容等に間違いがないか、必ずご自身でも確認を行ってください。
	                            </p>
	                            </div>
	                            {!planFeatures.aiQuestions && (
	                                <div
	                                    style={{
	                                        position: 'absolute',
	                                        inset: 0,
	                                        display: 'flex',
	                                        alignItems: 'center',
	                                        justifyContent: 'center',
	                                        padding: '1rem',
	                                        background: 'rgba(255,255,255,0.45)',
	                                        backdropFilter: 'blur(1px)'
	                                    }}
	                                    >
	                                    <div
	                                        style={{
	                                            maxWidth: '340px',
	                                            padding: '1rem',
	                                            borderRadius: '4px',
	                                            background: 'rgba(255,255,255,0.92)',
	                                            border: '1px solid #facc15',
	                                            boxShadow: '0 10px 30px rgba(15,23,42,0.12)',
	                                            textAlign: 'center'
	                                        }}
	                                    >
                                            <AdBanner
                                                slot="result_ai_chat_lock"
                                                pageTarget="result"
                                                variant="lock_cta"
                                                context={adContext}
                                                audience={adContext.audience}
                                                className="mb-3"
                                            />
	                                        <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#b45309', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>
	                                            PREMIUM
	                                        </div>
	                                        <h3 style={{ margin: '0 0 0.4rem', color: '#0f172a', fontSize: '1rem' }}>AIに質問して復習する</h3>
	                                        <p style={{ margin: '0 0 0.8rem', color: '#64748b', fontSize: '0.82rem', lineHeight: 1.6 }}>
	                                            小問解説を読んだ後の追加質問や復習相談は、プレミアムプランで利用できます。
	                                        </p>
	                                        <button type="button" className="btn btn-primary" onClick={() => navigate('/premium')} style={{ padding: '0.5rem 1rem' }}>
	                                            プレミアムでAI質問を使う
	                                        </button>
	                                    </div>
	                                </div>
	                            )}
	                        </div>
	                    </>
	            </div>
                </>
            )}

            {isDesignMode && (
                <div style={{ position: 'fixed', bottom: '2rem', left: '50%', transform: 'translateX(-50%)', background: 'white', padding: '1rem 2rem', borderRadius: '2px', display: 'flex', gap: '1.5rem', alignItems: 'center', zIndex: 1000, border: '2px solid #6366f1' }}>
                    <p style={{ fontSize: '0.8rem', fontWeight: '700', color: '#666' }}>デザイン編集中</p>
                    <button 
                        onClick={() => {
                            // Restore from backup
                            if (originalData) {
                                setResultData(prev => ({
                                    ...prev,
                                    detailedAnalysis: originalData.detailedAnalysis,
                                    weaknessAnalysis: originalData.weaknessAnalysis
                                }));
                                setCurrentStructure(prev => prev.map(s => {
                                    const backup = originalData.sectionAnalysis.find(b => b.id === s.id);
                                    return backup ? { ...s, sectionAnalysis: backup.content } : s;
                                }));
                            }
                            setIsDesignMode(false);
                        }} 
                        style={{ padding: '0.5rem 1.5rem', border: '1px solid #ddd', background: 'none', borderRadius: '2px', fontSize: '0.8rem', cursor: 'pointer' }}
                    >
                        キャンセル
                    </button>
                    <button onClick={handleSaveLayout} style={{ padding: '0.5rem 2rem', border: 'none', background: '#6366f1', color: 'white', borderRadius: '2px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}>保存して確定</button>
                </div>
            )}

            {!promoVerified && !planFeatures.unlimitedGrading && (
                <div style={{
                    marginTop: '2.5rem',
                    background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)',
                    border: '1px solid #86efac',
                    borderRadius: '8px',
                    padding: '1.75rem',
                    textAlign: 'center',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
                }}>
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        background: '#06C755',
                        color: '#fff',
                        padding: '0.25rem 0.75rem',
                        borderRadius: '9999px',
                        fontSize: '0.75rem',
                        fontWeight: 800,
                        marginBottom: '0.75rem'
                    }}>
                        🎁 公式LINE限定特典
                    </div>
                    <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem', color: '#065f46', fontWeight: 800 }}>
                        2回目以降の採点も「公式LINE追加」で無料開放！
                    </h3>
                    <p style={{ margin: '0 auto 1.25rem', color: '#047857', fontSize: '0.88rem', lineHeight: 1.6, maxWidth: '520px' }}>
                        初回採点はお疲れ様でした！次回（2回目以降）の採点には、公式LINEの友だち追加メッセージで配布される<strong>プロモーションコード</strong>が必要です。今のうちに友だち追加してコードを受け取っておきましょう。
                    </p>
                    <a
                        href={MARKETING_CONFIG.lineUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            background: '#06C755',
                            color: '#ffffff',
                            padding: '0.75rem 1.75rem',
                            borderRadius: '6px',
                            textDecoration: 'none',
                            fontWeight: 800,
                            fontSize: '0.95rem',
                            boxShadow: '0 2px 4px rgba(6, 199, 85, 0.25)'
                        }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 5.92 2 10.75c0 2.94 1.66 5.56 4.24 7.15-.18.66-.67 2.45-.77 2.82-.12.45.16.44.34.33.14-.09 1.95-1.32 2.76-1.87.46.08.94.12 1.43.12 5.52 0 10-3.92 10-8.75S17.52 2 12 2z"/>
                        </svg>
                        公式LINEで無料開放コードを受け取る
                    </a>
                </div>
            )}

            <div style={{ marginTop: '3rem', textAlign: 'center', display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                {location.state?.fromAdmin && (
                    <button className="btn btn-primary" onClick={() => navigate('/admin')}>
                        ← 成績ログ一覧に戻る
                    </button>
                )}
                <button className="btn btn-secondary" onClick={() => navigate('/')}>トップに戻る</button>
            </div>

            {reportingItem && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }}>
                    <div className="glass-panel" style={{ background: 'white', padding: '2rem', maxWidth: '500px', width: '100%' }}>
                        <h3 style={{ marginBottom: '1rem' }}>採点ミスの報告</h3>
                        <textarea value={reportComment} onChange={(e) => setReportComment(e.target.value)} placeholder="理由を教えてください..." style={{ width: '100%', height: '120px', padding: '0.75rem', marginBottom: '1.5rem' }} />
                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <button className="btn btn-secondary" onClick={() => setReportingItem(null)}>キャンセル</button>
                            <button className="btn btn-primary" onClick={handleReportSubmit} disabled={isReporting}>{isReporting ? '送信中...' : '報告を送信'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ResultPage;
