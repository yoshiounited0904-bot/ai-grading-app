import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { signUp, signIn } from '../services/authService'

const AuthModal = ({ isOpen, onClose }) => {
    const [isSignUp, setIsSignUp] = useState(false)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [username, setUsername] = useState('')
    const [grade, setGrade] = useState('')
    const [checkedTerms, setCheckedTerms] = useState(false)
    const [checkedAI, setCheckedAI] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [infoMessage, setInfoMessage] = useState('')

    useEffect(() => {
        const handleOpen = (e) => {
            if (e.detail?.message) {
                setInfoMessage(e.detail.message);
            } else {
                setInfoMessage('');
            }
        };
        document.addEventListener('openAuthModal', handleOpen);
        return () => document.removeEventListener('openAuthModal', handleOpen);
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setMessage('')
        setLoading(true)

        if (isSignUp && (!checkedTerms || !checkedAI)) {
            setError('利用規約と自動採点へのデータ送信同意が必要です')
            setLoading(false)
            return
        }

        if (isSignUp && username.length > 15) {
            setError('ユーザー名は15文字以内で入力してください')
            setLoading(false)
            return
        }

        try {
            const { data, error: authError } = isSignUp
                ? await signUp(email, password, username, '', grade, true)
                : await signIn(email, password)

            if (authError) {
                setError(authError.message === 'Invalid login credentials'
                    ? 'メールアドレスまたはパスワードが正しくありません'
                    : authError.message)
            } else {
                localStorage.removeItem('smashai_guest_graded');
                if (isSignUp && data?.session) {
                    onClose()
                } else if (isSignUp) {
                    setMessage('確認メールを送信しました。メールをご確認ください。')
                } else {
                    onClose()
                }
            }
        } catch (err) {
            setError('予期せぬエラーが発生しました。')
        } finally {
            setLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: '450px', width: '90%', borderRadius: '2px' }}>
                <button className="modal-close" onClick={onClose}>&times;</button>
                <h2 style={{ marginBottom: '1.5rem', textAlign: 'center', color: 'var(--color-accent-primary)' }}>
                    {isSignUp ? '新規登録' : 'ログイン'}
                </h2>

                {error && <div style={{ color: '#ef4444', marginBottom: '1rem', textAlign: 'center', fontSize: '0.9rem' }}>{error}</div>}
                {message && <div style={{ color: '#10b981', marginBottom: '1rem', textAlign: 'center', fontSize: '0.9rem' }}>{message}</div>}
                {infoMessage && (
                    <div style={{ 
                        background: 'var(--color-bg-secondary)', 
                        color: 'var(--color-accent-primary)', 
                        padding: '0.75rem', 
                        borderRadius: '2px', 
                        marginBottom: '1.5rem', 
                        fontSize: '0.85rem', 
                        textAlign: 'center',
                        fontWeight: '600',
                        border: '1px solid var(--color-silver-light)'
                    }}>
                        ※ {infoMessage}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>メールアドレス</label>
                        <input
                            type="email"
                            className="form-control"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label>パスワード</label>
                        <input
                            type="password"
                            className="form-control"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    {isSignUp && (
                        <>
                             <div className="form-group">
                                 <label>ユーザー名 <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: '#64748b' }}>(最大15文字)</span></label>
                                 <input
                                     type="text"
                                     className="form-control"
                                     value={username}
                                     onChange={e => setUsername(e.target.value)}
                                     maxLength={15}
                                     required
                                 />
                             </div>
                            <div className="form-group">
                                <label>学年</label>
                                <select
                                    className="form-control"
                                    value={grade}
                                    onChange={e => setGrade(e.target.value)}
                                >
                                    <option value="">選択してください</option>
                                    <option value="高1">高校1年生</option>
                                    <option value="高2">高校2年生</option>
                                    <option value="高3">高校3年生</option>
                                    <option value="既卒">既卒生</option>
                                </select>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', margin: '1rem 0', padding: '1rem', background: '#f8fafc', borderRadius: '2px', border: '1px solid #e2e8f0' }}>
                                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', cursor: 'pointer', fontSize: '0.8rem', color: '#374151', lineHeight: '1.5' }}>
                                    <input type="checkbox" checked={checkedTerms} onChange={e => setCheckedTerms(e.target.checked)} style={{ marginTop: '2px', flexShrink: 0, accentColor: 'var(--color-accent-primary)' }} />
                                    <span>
                                        <Link to="/terms" target="_blank" style={{ color: 'var(--color-accent-primary)', fontWeight: '700' }} onClick={e => e.stopPropagation()}>利用規約</Link>・
                                        <Link to="/privacy" target="_blank" style={{ color: 'var(--color-accent-primary)', fontWeight: '700' }} onClick={e => e.stopPropagation()}>プライバシーポリシー</Link>
                                        に同意します
                                    </span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', cursor: 'pointer', fontSize: '0.8rem', color: '#92400e', lineHeight: '1.5', background: '#fffbeb', padding: '0.6rem', borderRadius: '2px', border: '1px solid #fde68a' }}>
                                    <input type="checkbox" checked={checkedAI} onChange={e => setCheckedAI(e.target.checked)} style={{ marginTop: '2px', flexShrink: 0, accentColor: 'var(--color-accent-primary)' }} />
                                    <span>自動採点処理のため<strong>解答内容や入試問題が外部システムに送信される</strong>ことに同意します</span>
                                </label>
                            </div>
                        </>
                    )}

                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%', marginTop: '1rem', padding: '0.8rem' }}
                        disabled={loading}
                    >
                        {loading ? '処理中...' : (isSignUp ? '登録する' : 'ログインする')}
                    </button>
                </form>

                <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.9rem' }}>
                    {isSignUp ? (
                        <p>すでにアカウントをお持ちですか？ <span onClick={() => setIsSignUp(false)} style={{ color: 'var(--color-accent-primary)', cursor: 'pointer', fontWeight: '600' }}>ログイン</span></p>
                    ) : (
                        <p>アカウントをお持ちでないですか？ <span onClick={() => setIsSignUp(true)} style={{ color: 'var(--color-accent-primary)', cursor: 'pointer', fontWeight: '600' }}>新規登録</span></p>
                    )}
                </div>
            </div>
        </div>
    )
}

export default AuthModal
