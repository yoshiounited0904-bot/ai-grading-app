import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { 
    getLiveGradingEvents, 
    subscribeToGradingActivityEvents, 
    formatGradingEvent, 
    getRelativeTime 
} from '../services/activityService';

const DISPLAY_DURATION_MS = 4200; // 表示時間 (約4.2秒)
const FADE_DURATION_MS = 300;     // フェード時間
const ROTATION_INTERVAL_MS = 28000; // 新規通知がない時の過去イベント巡回間隔 (約28秒)

const RealtimeGradingToast = () => {
    const location = useLocation();
    const [currentEvent, setCurrentEvent] = useState(null);
    const [isExiting, setIsExiting] = useState(false);
    const [isDismissedTemporarily, setIsDismissedTemporarily] = useState(false);

    const queueRef = useRef([]);
    const recentPoolRef = useRef([]);
    const poolIndexRef = useRef(0);
    const timerRef = useRef(null);
    const isProcessingRef = useRef(false);

    // 次の通知を処理
    const showNext = () => {
        if (queueRef.current.length === 0) {
            setCurrentEvent(null);
            setIsExiting(false);
            isProcessingRef.current = false;
            return;
        }

        isProcessingRef.current = true;
        const nextRaw = queueRef.current.shift();
        const formatted = formatGradingEvent(nextRaw);

        if (!formatted || !formatted.examLabel) {
            showNext();
            return;
        }

        setCurrentEvent(formatted);
        setIsExiting(false);

        // 一定時間後にフェードアウト
        timerRef.current = setTimeout(() => {
            setIsExiting(true);
            setTimeout(() => {
                showNext();
            }, FADE_DURATION_MS);
        }, DISPLAY_DURATION_MS);
    };

    // キューにイベントを追加して表示を開始
    const enqueueEvent = (event, { isRealtime = false } = {}) => {
        if (!event) return;

        if (isRealtime) {
            // リアルタイム通知はキューの最前列に優先挿入
            queueRef.current.unshift(event);
            // 手動ミュート状態もリアルタイム新着なら解除
            setIsDismissedTemporarily(false);
        } else {
            queueRef.current.push(event);
        }

        if (!isProcessingRef.current) {
            showNext();
        }
    };

    // 手動で閉じる
    const handleDismiss = (e) => {
        e.stopPropagation();
        if (timerRef.current) clearTimeout(timerRef.current);
        setIsExiting(true);
        setIsDismissedTemporarily(true);

        // 90秒間は巡回表示を控える
        setTimeout(() => {
            setIsDismissedTemporarily(false);
        }, 90000);

        setTimeout(() => {
            showNext();
        }, FADE_DURATION_MS);
    };

    // 初期データのロードと Realtime 購読
    useEffect(() => {
        let isMounted = true;

        // 1. 直近の採点ログを取得
        getLiveGradingEvents({ limit: 10 }).then(({ data, error }) => {
            if (!isMounted || error || !data || data.length === 0) return;
            recentPoolRef.current = data;

            // ページ表示から約 2.5 秒後に最初の1件を控えめに表示
            setTimeout(() => {
                if (!isMounted || queueRef.current.length > 0 || isProcessingRef.current) return;
                if (recentPoolRef.current.length > 0) {
                    enqueueEvent(recentPoolRef.current[0]);
                    poolIndexRef.current = 1;
                }
            }, 2500);
        });

        // 2. Realtime 購読開始
        const unsubscribe = subscribeToGradingActivityEvents((newEvent) => {
            if (!isMounted) return;
            // 新規リアルタイムイベントをプッシュ
            enqueueEvent(newEvent, { isRealtime: true });
        });

        // 3. 新規通知が途絶えている間、活気維持のため過去ログを定期的に巡回表示
        const rotationTimer = setInterval(() => {
            if (!isMounted) return;
            if (isDismissedTemporarily) return;
            if (isProcessingRef.current || queueRef.current.length > 0) return;

            const pool = recentPoolRef.current;
            if (pool.length > 0) {
                const index = poolIndexRef.current % pool.length;
                enqueueEvent(pool[index]);
                poolIndexRef.current = index + 1;
            }
        }, ROTATION_INTERVAL_MS);

        return () => {
            isMounted = false;
            unsubscribe();
            clearInterval(rotationTimer);
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [isDismissedTemporarily]);

    if (!currentEvent) return null;

    // 解答画面（/exam）では下部ボタンと重ならないよう下部余白を拡張
    const isExamPage = location.pathname.startsWith('/exam');
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

    // 位置スタイルの決定（レイアウト押し下げ一切なしの fixed 配置）
    const containerStyle = {
        position: 'fixed',
        zIndex: 9999,
        bottom: isMobile 
            ? (isExamPage ? '92px' : '20px') 
            : '24px',
        right: isMobile ? '16px' : '24px',
        left: isMobile ? '16px' : 'auto',
        maxWidth: isMobile ? '380px' : '360px',
        margin: isMobile ? '0 auto' : '0',
        pointerEvents: 'auto',
        transition: `opacity ${FADE_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), transform ${FADE_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
        opacity: isExiting ? 0 : 1,
        transform: isExiting ? 'translateY(12px) scale(0.96)' : 'translateY(0) scale(1)',
    };

    const isHighScore = currentEvent.scoreRate !== null && currentEvent.scoreRate >= 0.75;

    return (
        <aside 
            aria-live="polite"
            className="no-print" 
            style={containerStyle}
        >
            <div style={{
                background: 'rgba(255, 255, 255, 0.98)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(226, 232, 240, 0.9)',
                borderRadius: '12px',
                padding: '0.75rem 0.9rem',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
                fontSize: '0.82rem',
                color: '#1e293b',
                lineHeight: 1.4,
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* アクセントバー（高得点なら緑、通常はブランド赤） */}
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '3px',
                    background: isHighScore 
                        ? 'linear-gradient(90deg, #10b981, #059669)' 
                        : 'linear-gradient(90deg, #b91c1c, #ef4444)'
                }} />

                {/* ヘッダー行: バッジ + 相対時刻 + 閉じるボタン */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.2rem',
                            fontSize: '0.68rem',
                            fontWeight: 800,
                            padding: '0.15rem 0.45rem',
                            borderRadius: '4px',
                            background: isHighScore ? '#ecfdf5' : '#fef2f2',
                            color: isHighScore ? '#059669' : '#b91c1c',
                            letterSpacing: '0.04em'
                        }}>
                            <span>🔥</span> 採点速報
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 500 }}>
                            {getRelativeTime(currentEvent.createdAt)}
                        </span>
                    </div>

                    {/* 閉じるボタン */}
                    <button
                        onClick={handleDismiss}
                        aria-label="通知を閉じる"
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            padding: '0.2rem',
                            lineHeight: 1,
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.9rem',
                            transition: 'color 0.15s ease'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#475569'}
                        onMouseLeave={(e) => e.currentTarget.style.color = '#94a3b8'}
                    >
                        ✕
                    </button>
                </div>

                {/* 本文: ユーザー名 + 問題名 */}
                <div style={{ marginTop: '0.1rem', fontWeight: 600, color: '#334155' }}>
                    <span style={{ color: '#0f172a', fontWeight: 700 }}>
                        {currentEvent.name}さん
                    </span>
                    <span style={{ color: '#64748b', fontWeight: 500 }}> が </span>
                    <span style={{ color: '#1e293b' }}>
                        {currentEvent.examLabel}
                    </span>
                    <span style={{ color: '#64748b', fontWeight: 500 }}> を採点</span>
                </div>

                {/* スコアバッジ行 */}
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'baseline', 
                    justifyContent: 'space-between',
                    marginTop: '0.1rem',
                    paddingTop: '0.3rem',
                    borderTop: '1px dashed #f1f5f9'
                }}>
                    <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>獲得得点</span>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.2rem' }}>
                        <span style={{
                            fontSize: '1rem',
                            fontWeight: 800,
                            color: isHighScore ? '#059669' : '#b91c1c'
                        }}>
                            {currentEvent.score}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
                            / {currentEvent.maxScore}点
                        </span>
                    </div>
                </div>
            </div>
        </aside>
    );
};

export default RealtimeGradingToast;
