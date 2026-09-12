import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { recoverPasswordSessionFromUrl, requestPasswordReset, updatePassword, onAuthStateChange } from '../services/authService';

const ResetPasswordPage = () => {
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [email, setEmail] = useState('');
    const [sessionReady, setSessionReady] = useState(false);
    const [recoveringSession, setRecoveringSession] = useState(true);
    const [resending, setResending] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        let cancelled = false;
        const recover = async () => {
            setRecoveringSession(true);
            setError('');
            const { error: recoverError } = await recoverPasswordSessionFromUrl();
            if (cancelled) return;

            if (recoverError) {
                setSessionReady(false);
                setError(recoverError.message || '再設定リンクの確認に失敗しました。メール内の最新リンクから開き直してください。');
            } else {
                setSessionReady(true);
                setError('');
            }
            setRecoveringSession(false);
        };

        recover();

        // onAuthStateChange で PASSWORD_RECOVERY またはセッション復帰を検知した場合も即座に有効化
        const { data: { subscription } } = onAuthStateChange((event, session) => {
            if (cancelled) return;
            if (event === 'PASSWORD_RECOVERY' || (session && event === 'SIGNED_IN')) {
                setSessionReady(true);
                setRecoveringSession(false);
                setError('');
            }
        });

        return () => {
            cancelled = true;
            subscription.unsubscribe();
        };
    }, []);

    const handleResend = async (e) => {
        e.preventDefault();
        setError('');
        setMessage('');

        if (!email.trim()) {
            setError('メールアドレスを入力してください。');
            return;
        }

        setResending(true);
        const { error: resetError } = await requestPasswordReset(email.trim());
        if (resetError) {
            setError(resetError.message || '再設定メールの送信に失敗しました。');
        } else {
            setMessage('再設定メールを送信しました。届いた最新メールのリンクから開いてください。');
        }
        setResending(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setMessage('');

        if (!sessionReady) {
            setError('再設定用の認証情報がありません。メール内の最新リンクから開き直してください。');
            return;
        }

        if (password.length < 6) {
            setError('パスワードは6文字以上で入力してください。');
            return;
        }

        if (password !== confirmPassword) {
            setError('確認用パスワードが一致しません。');
            return;
        }

        setLoading(true);
        try {
            const { error: updateError } = await updatePassword(password);
            if (updateError) {
                setError(updateError.message || 'パスワードの更新に失敗しました。再設定メールから開き直してください。');
                return;
            }
            setMessage('パスワードを更新しました。新しいパスワードでログインできます。');
            setTimeout(() => navigate('/', { replace: true }), 1200);
        } catch (err) {
            setError('予期せぬエラーが発生しました。再設定メールから開き直してください。');
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
            <section className="glass-panel" style={{ width: '100%', maxWidth: '460px', padding: '2rem', borderRadius: '2px' }}>
                <h1 style={{ textAlign: 'center', color: 'var(--color-accent-primary)', marginBottom: '0.75rem' }}>
                    パスワード再設定
                </h1>
                <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                    {recoveringSession ? '再設定リンクを確認しています。' : '新しいパスワードを入力してください。'}
                </p>

                {error && <div style={{ color: '#ef4444', marginBottom: '1rem', textAlign: 'center', fontSize: '0.9rem' }}>{error}</div>}
                {message && <div style={{ color: '#10b981', marginBottom: '1rem', textAlign: 'center', fontSize: '0.9rem' }}>{message}</div>}

                {!sessionReady && !recoveringSession && (
                    <form onSubmit={handleResend} style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                        <p style={{ margin: '0 0 0.75rem', color: '#64748b', fontSize: '0.86rem', lineHeight: 1.7 }}>
                            リンクが古い、または別端末で開いた可能性があります。登録メールアドレスに再設定メールを送り直せます。
                        </p>
                        <input
                            type="email"
                            className="form-control"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="登録メールアドレス"
                            style={{ marginBottom: '0.75rem' }}
                        />
                        <button
                            type="submit"
                            className="btn btn-secondary"
                            style={{ width: '100%' }}
                            disabled={resending}
                        >
                            {resending ? '送信中...' : '再設定メールを送り直す'}
                        </button>
                    </form>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>新しいパスワード</label>
                        <input
                            type="password"
                            className="form-control"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            minLength={6}
                            required
                            disabled={!sessionReady || recoveringSession}
                        />
                    </div>
                    <div className="form-group">
                        <label>新しいパスワード（確認）</label>
                        <input
                            type="password"
                            className="form-control"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            minLength={6}
                            required
                            disabled={!sessionReady || recoveringSession}
                        />
                    </div>
                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%', marginTop: '1rem', padding: '0.8rem' }}
                        disabled={loading || !sessionReady || recoveringSession}
                    >
                        {recoveringSession ? 'リンク確認中...' : (loading ? '更新中...' : 'パスワードを更新する')}
                    </button>
                </form>
            </section>
        </main>
    );
};

export default ResetPasswordPage;
