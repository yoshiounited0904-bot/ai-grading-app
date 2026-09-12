import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MARKETING_CONFIG } from '../config/marketingConfig';
import { createBillingPortalSession, createPremiumCheckoutSession } from '../services/paymentService';
import { getUserPlan } from '../services/usageLimitService';

const rows = [
    ['利用回数', '月3回', '制限なし'],
    ['合格判定', '簡易判定', '詳細判定'],
    ['詳細解説', 'ロック', '利用可能'],
    ['AI質問', 'ロック', '利用可能'],
    ['過去履歴', 'ロック', '利用可能']
];

const PremiumPage = () => {
    const { user, profile, refreshProfile } = useAuth();
    const [searchParams] = useSearchParams();
    const [loadingCheckout, setLoadingCheckout] = useState(false);
    const [loadingPortal, setLoadingPortal] = useState(false);
    const [refreshingProfile, setRefreshingProfile] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [checkingPayment, setCheckingPayment] = useState(false);
    const [paypayForm, setPaypayForm] = useState({
        lineDisplayName: ''
    });
    const checkoutStatus = searchParams.get('checkout');
    const currentPlan = getUserPlan(profile);
    const isPremium = currentPlan === 'premium' || currentPlan === 'admin';
    const isBillingEnabled = MARKETING_CONFIG.enablePremiumBilling;
    const launchPremiumAccess = MARKETING_CONFIG.launchPremiumAccess;
    const launchPremiumEndsAt = launchPremiumAccess?.endsAt ? new Date(launchPremiumAccess.endsAt) : null;
    const launchPremiumEndsAtLabel = launchPremiumEndsAt && Number.isFinite(launchPremiumEndsAt.getTime())
        ? launchPremiumEndsAt.toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' })
        : '';

    useEffect(() => {
        if (checkoutStatus !== 'success' || isPremium) return undefined;

        let cancelled = false;
        let attempts = 0;
        setCheckingPayment(true);

        const poll = async () => {
            attempts += 1;
            await refreshProfile?.();
            if (!cancelled && attempts < 15) {
                setTimeout(poll, 2000);
            } else if (!cancelled) {
                setCheckingPayment(false);
            }
        };

        poll();
        return () => {
            cancelled = true;
        };
    }, [checkoutStatus, isPremium, refreshProfile]);

    useEffect(() => {
        if (isPremium) setCheckingPayment(false);
    }, [isPremium]);

    const handleCheckout = async () => {
        setErrorMessage('');
        if (!user) {
            document.dispatchEvent(new CustomEvent('openAuthModal', {
                detail: { message: 'プレミアムプランの購入にはログインまたは無料会員登録が必要です。' }
            }));
            return;
        }

        try {
            setLoadingCheckout(true);
            const url = await createPremiumCheckoutSession();
            window.location.href = url;
        } catch (error) {
            setErrorMessage(error?.message || '決済ページの作成に失敗しました。');
        } finally {
            setLoadingCheckout(false);
        }
    };

    const handlePortal = async () => {
        setErrorMessage('');
        if (!user) {
            document.dispatchEvent(new CustomEvent('openAuthModal', {
                detail: { message: '契約管理にはログインが必要です。' }
            }));
            return;
        }

        try {
            setLoadingPortal(true);
            const url = await createBillingPortalSession();
            window.location.href = url;
        } catch (error) {
            setErrorMessage(error?.message || '契約管理ページの作成に失敗しました。');
        } finally {
            setLoadingPortal(false);
        }
    };

    const handleRefreshProfile = async () => {
        setErrorMessage('');
        try {
            setRefreshingProfile(true);
            await refreshProfile?.();
        } catch (error) {
            setErrorMessage(error?.message || 'プラン状態の再確認に失敗しました。');
        } finally {
            setRefreshingProfile(false);
        }
    };

    const buildPaypayLineMessage = () => {
        const paypayPass = MARKETING_CONFIG.paypayPass;
        return [
            'PayPayでプレミアムプランを申し込みます。',
            `ユーザー名: ${profile?.username || profile?.display_name || '未設定'}`,
            `登録メール: ${user?.email || '未登録'}`,
            `希望プラン: ${paypayPass.label}`,
            `料金: ${paypayPass.amountLabel}`,
            `利用期間: ${paypayPass.durationLabel}`,
            paypayForm.lineDisplayName ? `LINE表示名: ${paypayForm.lineDisplayName}` : ''
        ].filter(Boolean).join('\n');
    };

    const copyPaypayLineMessage = async () => {
        setErrorMessage('');

        if (!user) {
            document.dispatchEvent(new CustomEvent('openAuthModal', {
                detail: { message: 'PayPayでの申込にはログインまたは無料会員登録が必要です。' }
            }));
            return;
        }

        try {
            await navigator.clipboard.writeText(buildPaypayLineMessage());
            alert('LINE送信用文面をコピーしました。');
        } catch {
            alert('コピーに失敗しました。本文を選択してコピーしてください。');
        }
    };

    return (
        <div className="container premium-page" style={{ maxWidth: '960px', padding: '3rem 1rem 4rem' }}>
            <section className="premium-hero" style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    color: '#b45309',
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    padding: '0.35rem 0.8rem',
                    borderRadius: '999px',
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    marginBottom: '1rem'
                }}>
                    PREMIUM PLAN
                </div>
                <h1 style={{ color: 'var(--color-accent-primary)', marginBottom: '0.75rem' }}>
                    採点結果を、次の一手まで使い切る
                </h1>
                <p style={{ color: '#64748b', lineHeight: 1.8, margin: '0 auto', maxWidth: '640px' }}>
                    {isBillingEnabled
                        ? 'プレミアムでは、採点回数・詳細解説・AI質問・過去履歴を解禁します。無料版は体験用、プレミアムは継続学習用という位置づけです。'
                        : '現在はローンチ期間として、採点回数・詳細解説・AI質問・過去履歴をすべて無料で開放しています。'}
                </p>
                {isBillingEnabled ? (
                    <p style={{ color: '#64748b', lineHeight: 1.8, margin: '0.9rem auto 0', maxWidth: '640px', fontSize: '0.85rem' }}>
                        料金、更新周期、支払方法、次回請求日はStripeの決済画面で確認できます。
                        内容を確認してから決済を確定してください。
                    </p>
                ) : (
                    <p style={{ color: '#64748b', lineHeight: 1.8, margin: '0.9rem auto 0', maxWidth: '640px', fontSize: '0.85rem' }}>
                        期間終了後の課金導線は、準備が整い次第あらためて案内します。
                    </p>
                )}
            </section>

            {checkoutStatus === 'success' && isBillingEnabled && (
                <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem', border: '1px solid #22c55e', background: '#f0fdf4', color: '#166534' }}>
                    {isPremium
                        ? '決済が完了し、プレミアムプランが有効になりました。'
                        : checkingPayment
                            ? '決済が完了しました。プレミアム反映を確認中です...'
                            : '決済が完了しました。反映に時間がかかっています。少し待ってから再読み込みしてください。'}
                </div>
            )}

            {checkoutStatus === 'cancelled' && isBillingEnabled && (
                <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem', border: '1px solid #f59e0b', background: '#fffbeb', color: '#92400e' }}>
                    決済はキャンセルされました。必要なタイミングで再開できます。
                </div>
            )}

            {errorMessage && (
                <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem', border: '1px solid #ef4444', background: '#fef2f2', color: '#991b1b' }}>
                    {errorMessage}
                </div>
            )}

            <div className="glass-panel premium-comparison" style={{ overflow: 'hidden', padding: 0, marginBottom: '2rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                    <thead>
                        <tr>
                            <th style={{ padding: '1rem', borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>機能</th>
                            <th style={{ padding: '1rem', borderBottom: '1px solid #e5e7eb', textAlign: 'center', color: '#64748b' }}>フリー</th>
                            <th style={{ padding: '1rem', borderBottom: '1px solid #e5e7eb', textAlign: 'center', color: '#b45309', background: '#fffbeb' }}>プレミアム</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(([feature, free, premium]) => (
                            <tr key={feature}>
                                <td style={{ padding: '1rem', borderBottom: '1px solid #f1f5f9', fontWeight: 800 }}>{feature}</td>
                                <td style={{ padding: '1rem', borderBottom: '1px solid #f1f5f9', textAlign: 'center', color: '#64748b' }}>{free}</td>
                                <td style={{ padding: '1rem', borderBottom: '1px solid #f1f5f9', textAlign: 'center', fontWeight: 900, color: '#92400e', background: '#fffbeb' }}>{premium}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {!isBillingEnabled && (
                <div className="glass-panel premium-action-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem', border: '1px solid #f59e0b', background: '#fffbeb' }}>
                    <div>
                        <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.15rem', color: '#92400e' }}>
                            {launchPremiumAccess?.label || '無料開放中'}
                        </h2>
                        <p style={{ margin: 0, color: '#64748b', lineHeight: 1.7 }}>
                            現在、すべてのユーザーにプレミアム機能を開放しています。
                            {launchPremiumEndsAtLabel && `無料開放期間は${launchPremiumEndsAtLabel}までです。`}
                        </p>
                    </div>
                </div>
            )}

            {isBillingEnabled && (
            <div className="glass-panel premium-action-panel" style={{ padding: '1.5rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                    <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.15rem' }}>
                        {isPremium ? 'プレミアムプラン利用中' : 'プレミアムプランに登録'}
                    </h2>
                    <p style={{ margin: 0, color: '#64748b' }}>
                        {isPremium
                            ? '現在、プレミアム機能が解放されています。'
                            : checkingPayment
                                ? '決済完了を確認しています。二重購入を避けるため、このまま少し待ってください。'
                            : 'Stripeの安全な決済ページで登録します。カード情報はスマサイ側には保存されません。'}
                    </p>
                    {!isPremium && !checkingPayment && (
                        <p style={{ margin: '0.55rem 0 0', color: '#94a3b8', fontSize: '0.78rem', lineHeight: 1.7 }}>
                            プレミアムは継続課金です。解約は契約管理ページから行えます。デジタルサービスの性質上、利用開始後の返金は原則として行いません。
                        </p>
                    )}
                </div>
                {isPremium ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span style={{ color: '#16a34a', fontWeight: 900 }}>ACTIVE</span>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={handlePortal}
                            disabled={loadingPortal}
                        >
                            {loadingPortal ? '契約管理ページを作成中...' : '契約を管理する'}
                        </button>
                    </div>
                ) : checkingPayment ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span style={{ color: '#b45309', fontWeight: 900 }}>確認中...</span>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={handleRefreshProfile}
                            disabled={refreshingProfile}
                        >
                            {refreshingProfile ? '再確認中...' : '状態を再確認'}
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleCheckout}
                        disabled={loadingCheckout}
                    >
                        {loadingCheckout ? '決済ページを作成中...' : 'プレミアムに登録する'}
                    </button>
                )}
            </div>
            )}

            {isBillingEnabled && (
            <section className="glass-panel premium-paypay-panel" style={{ padding: '1.5rem', marginTop: '1.5rem', border: '1px solid #dbeafe', background: '#f8fbff' }}>
                    <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.25rem' }}>
                        <div style={{
                            display: 'inline-flex',
                            width: 'fit-content',
                            alignItems: 'center',
                            gap: '0.45rem',
                            color: '#0369a1',
                            background: '#e0f2fe',
                            border: '1px solid #bae6fd',
                            padding: '0.3rem 0.7rem',
                            borderRadius: '999px',
                            fontSize: '0.75rem',
                            fontWeight: 900
                        }}>
                            PAYPAY MANUAL
                        </div>
                        <h2 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a' }}>
                            PayPayでの支払いもLINEから相談できます
                        </h2>
                        <p style={{ margin: 0, color: '#64748b', lineHeight: 1.8 }}>
                            PayPayは自動更新ではなく、1か月2,980円の手動決済として反映します。
                            公式LINEに下の文面を送ってください。入金確認後、通常24時間以内にプレミアムを有効化します。
                        </p>
                    </div>

                    <div style={{ display: 'grid', gap: '1rem' }}>
                        <div style={{ border: '1px solid #cbd5e1', background: '#fff', padding: '0.9rem', borderRadius: '2px' }}>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 900, marginBottom: '0.25rem' }}>PayPay決済</div>
                            <div style={{ fontSize: '1rem', color: '#0f172a', fontWeight: 900 }}>
                                {MARKETING_CONFIG.paypayPass.label} / {MARKETING_CONFIG.paypayPass.amountLabel}
                            </div>
                        </div>
                        <label style={{ display: 'grid', gap: '0.45rem', color: '#334155', fontSize: '0.85rem', fontWeight: 800 }}>
                            LINE表示名
                            <input
                                value={paypayForm.lineDisplayName}
                                onChange={(e) => setPaypayForm(prev => ({ ...prev, lineDisplayName: e.target.value }))}
                                placeholder="公式LINEで表示される名前。照合に使います。"
                                style={{ width: '100%', padding: '0.75rem', border: '1px solid #cbd5e1', borderRadius: '2px', background: '#fff', boxSizing: 'border-box' }}
                            />
                        </label>
                        <textarea
                            readOnly
                            value={buildPaypayLineMessage()}
                            style={{ width: '100%', minHeight: '145px', padding: '0.85rem', border: '1px solid #cbd5e1', borderRadius: '2px', background: '#fff', boxSizing: 'border-box', lineHeight: 1.7 }}
                        />
                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-secondary" onClick={copyPaypayLineMessage}>
                                LINE文面をコピー
                            </button>
                            <button type="button" className="btn btn-primary" onClick={() => window.open(MARKETING_CONFIG.lineUrl, '_blank')} style={{ background: '#06c755', border: 'none' }}>
                                公式LINEを開く
                            </button>
                        </div>
                    </div>
            </section>
            )}
        </div>
    );
};

export default PremiumPage;
