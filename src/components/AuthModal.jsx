import React, { useState, useEffect } from 'react'
import { signUp, signIn } from '../services/authService'

const AuthModal = ({ isOpen, onClose }) => {
    const [isSignUp, setIsSignUp] = useState(false)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [username, setUsername] = useState('')
    const [firstChoiceUniversity, setFirstChoiceUniversity] = useState('')
    const [grade, setGrade] = useState('')
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

        try {
            const { data, error: authError } = isSignUp
                ? await signUp(email, password, username, firstChoiceUniversity, grade)
                : await signIn(email, password)

            if (authError) {
                setError(authError.message === 'Invalid login credentials'
                    ? 'メールアドレスまたはパスワードが正しくありません'
                    : authError.message)
            } else {
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
            <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: '450px', width: '90%' }}>
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
                        borderRadius: '8px', 
                        marginBottom: '1.5rem', 
                        fontSize: '0.85rem', 
                        textAlign: 'center',
                        fontWeight: '600',
                        border: '1px solid var(--color-silver-light)'
                    }}>
                        ℹ️ {infoMessage}
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
                                <label>ユーザー名</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>第一志望大学</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={firstChoiceUniversity}
                                    onChange={e => setFirstChoiceUniversity(e.target.value)}
                                    placeholder="例：早稲田大学"
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
