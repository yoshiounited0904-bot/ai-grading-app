import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '24px', maxWidth: '800px', margin: '40px auto', background: '#fee2e2', border: '2px solid #ef4444', borderRadius: '12px', color: '#991b1b', fontFamily: 'monospace' }}>
                    <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px' }}>⚠️ 画面の描画中にエラーが発生しました</h2>
                    <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>{String(this.state.error?.message || this.state.error)}</p>
                    <pre style={{ fontSize: '11px', background: '#ffffff', padding: '12px', borderRadius: '8px', overflowX: 'auto', maxHeight: '300px', whiteSpace: 'pre-wrap' }}>
                        {this.state.error?.stack}
                    </pre>
                    <button 
                        onClick={() => window.location.href = '/admin'}
                        style={{ marginTop: '16px', padding: '8px 16px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                        管理者トップへ戻る
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
