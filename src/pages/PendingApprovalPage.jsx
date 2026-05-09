import React from 'react';
import { signOut } from '../services/authService';

const PendingApprovalPage = () => {
    const handleLogout = async () => {
        await signOut();
        window.location.href = '/';
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-indigo-50/30">
            <div className="max-w-md w-full glass-panel p-8 animate-slide-up text-center">
                <div className="mb-6">
                    <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <span className="text-4xl">⏳</span>
                    </div>
                    <h2 className="text-2xl font-black text-navy-blue mb-2">アカウント承認待ち</h2>
                    <p className="text-gray-600 text-sm">
                        ご登録ありがとうございます。<br />
                        現在、あなたのアカウントは承認待ち状態です。
                    </p>
                </div>

                <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-8 text-left">
                    <h3 className="text-sm font-bold text-blue-800 mb-2">💡 利用開始までのステップ</h3>
                    <ol className="text-xs text-blue-700 space-y-2 list-decimal list-inside">
                        <li>
                            <strong>下のボタンから公式LINEを友だち追加</strong>してください。
                        </li>
                        <li>
                            LINE内の案内に従って、必要事項をお送りください。
                        </li>
                        <li>
                            運営が内容を確認し、問題なければ承認作業を行います。
                        </li>
                    </ol>
                </div>

                <div className="flex flex-col gap-3">
                    <a 
                        href="https://lin.ee/ihaPWfv" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="btn btn-primary flex items-center justify-center gap-2"
                        style={{ backgroundColor: '#06C755', padding: '0.8rem 1.5rem', width: 'fit-content', margin: '0 auto' }}
                    >
                        <img src="/images/line-icon.png" alt="LINE" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
                        公式LINEを友だち追加
                    </a>
                </div>

                <div className="mt-10 pt-6 border-t border-gray-100">
                    <p className="text-[10px] text-gray-400 mb-4">
                        承認が完了すると、自動的にすべての機能が利用可能になります。<br />
                        お急ぎの場合やご不明な点は公式LINEにてお問い合わせください。
                    </p>
                    <button 
                        onClick={handleLogout}
                        className="text-xs font-bold text-gray-500 hover:text-red-500 transition-colors"
                    >
                        ログアウトして戻る
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PendingApprovalPage;
