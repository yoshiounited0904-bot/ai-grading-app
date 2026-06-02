import React from 'react';
import { Link } from 'react-router-dom';

export default function Footer() {
    return (
        <footer className="border-t border-gray-100 bg-white mt-auto">
            <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
                <p className="text-[11px] text-gray-400 font-black">
                    © {new Date().getFullYear()} 過去問採点サービス スマサイ
                </p>
                <div className="flex gap-4">
                    <Link to="/terms" className="text-[11px] text-gray-400 hover:text-gray-600 font-black transition-colors">利用規約</Link>
                    <Link to="/privacy" className="text-[11px] text-gray-400 hover:text-gray-600 font-black transition-colors">プライバシーポリシー</Link>
                </div>
            </div>
        </footer>
    );
}
