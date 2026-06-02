import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../contexts/AuthContext';

const FeedbackForm = () => {
    const { user } = useAuth();
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        type: 'feature_request',
        message: ''
    });
    const [status, setStatus] = useState('idle'); // 'idle' | 'submitting' | 'success' | 'error'

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.message.trim()) return;

        setStatus('submitting');
        
        try {
            const { error } = await supabase.from('user_feedbacks').insert([{
                user_id: user?.id || null,
                name: formData.name,
                email: formData.email,
                type: formData.type,
                message: formData.message
            }]);

            if (error) throw error;
            
            setStatus('success');
            setFormData({ name: '', email: '', type: 'feature_request', message: '' });
            
            // 3秒後に成功メッセージを消す
            setTimeout(() => setStatus('idle'), 3000);
        } catch (error) {
            console.error('Feedback submission error:', error);
            setStatus('error');
        }
    };

    return (
        <div className="glass-panel" style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto', background: '#fff' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: 'var(--color-navy-blue)' }}>
                ご意見・ご要望・バグ報告
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '1.5rem' }}>
                スマサイをより良くするため、皆様からのフィードバックをお待ちしております。お気軽にお送りください！
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '0.5rem', color: '#64748b' }}>
                            お名前 (任意)
                        </label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="山田 太郎"
                            style={{ width: '100%', padding: '0.75rem', borderRadius: '2px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                        />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '0.5rem', color: '#64748b' }}>
                            メールアドレス (任意)
                        </label>
                        <input
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            placeholder="info@example.com"
                            style={{ width: '100%', padding: '0.75rem', borderRadius: '2px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                        />
                    </div>
                </div>

                <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '0.5rem', color: '#64748b' }}>
                        カテゴリ
                    </label>
                    <select
                        value={formData.type}
                        onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                        style={{ width: '100%', padding: '0.75rem', borderRadius: '2px', border: '1px solid #cbd5e1', fontSize: '0.9rem', backgroundColor: '#fff' }}
                    >
                        <option value="feature_request">要望</option>
                        <option value="bug">バグ報告</option>
                        <option value="inquiry">その他のお問い合わせ</option>
                    </select>
                </div>

                <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '0.5rem', color: '#64748b' }}>
                        内容 <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <textarea
                        required
                        rows="4"
                        value={formData.message}
                        onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                        placeholder="ご自由にご記入ください"
                        style={{ width: '100%', padding: '0.75rem', borderRadius: '2px', border: '1px solid #cbd5e1', fontSize: '0.9rem', resize: 'vertical' }}
                    />
                </div>

                {status === 'success' && (
                    <div style={{ padding: '0.75rem', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '2px', fontSize: '0.9rem', fontWeight: 'bold', textAlign: 'center' }}>
                        送信が完了しました。貴重なご意見ありがとうございます！
                    </div>
                )}

                {status === 'error' && (
                    <div style={{ padding: '0.75rem', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '2px', fontSize: '0.9rem', fontWeight: 'bold', textAlign: 'center' }}>
                        送信に失敗しました。時間をおいて再度お試しください。
                    </div>
                )}

                <button
                    type="submit"
                    disabled={status === 'submitting' || !formData.message.trim()}
                    className="btn btn-primary"
                    style={{ padding: '0.75rem', fontSize: '1rem', opacity: (status === 'submitting' || !formData.message.trim()) ? 0.6 : 1 }}
                >
                    {status === 'submitting' ? '送信中...' : '送信する'}
                </button>
            </form>
        </div>
    );
};

export default FeedbackForm;
