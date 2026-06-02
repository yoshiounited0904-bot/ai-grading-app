import React from 'react';
import { Link } from 'react-router-dom';

export default function PrivacyPage() {
    return (
        <div className="max-w-3xl mx-auto px-6 py-12">
            <div className="mb-8">
                <Link to="/" className="text-sm text-gray-400 hover:text-gray-600 font-black transition-colors">← トップに戻る</Link>
            </div>
            <h1 className="text-2xl font-black text-gray-900 mb-2">プライバシーポリシー</h1>
            <p className="text-xs text-gray-400 mb-10">最終更新日: 2026年6月3日</p>

            <div className="space-y-8 text-sm text-gray-600 leading-relaxed">
                <section>
                    <h2 className="text-base font-black text-gray-800 mb-3">1. 取得する情報</h2>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>メールアドレス・ユーザー名（アカウント登録時）</li>
                        <li>ゲスト利用時およびログイン時の学習履歴・採点結果・解答データ</li>
                        <li>志望校・学年などのプロフィール情報（アカウント登録時）</li>
                        <li>サービス利用ログ</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-base font-black text-gray-800 mb-3">2. 利用目的</h2>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>自動採点・解説の提供</li>
                        <li>学習分析・弱点レポートの生成</li>
                        <li>サービス品質の改善</li>
                        <li>運営者からのお知らせの送信</li>
                    </ul>
                    <p className="mt-2">取得した情報を第三者に販売・提供することはありません。</p>
                </section>

                <section>
                    <h2 className="text-base font-black text-gray-800 mb-3">3. データの保存先</h2>
                    <p>ユーザーデータはSupabase（米国サーバー）に保存されます。Supabaseのプライバシーポリシーが適用されます。</p>
                </section>

                <section className="bg-amber-50 border border-amber-200 rounded-sm p-4">
                    <h2 className="text-base font-black text-amber-800 mb-3">4. データの送信について（重要）</h2>
                    <p className="text-amber-700 mb-3">本サービスは自動採点・解説生成・質問チャット機能のために、以下のデータを<strong>外部システム（Google Gemini API等）に送信します。</strong></p>
                    <ul className="list-disc pl-5 space-y-1 text-amber-700 mb-3">
                        <li>入試問題PDFの画像データ</li>
                        <li>ユーザーが入力した解答内容</li>
                        <li>採点結果・大問別スコア・弱点分析テキスト</li>
                        <li>質問チャットの会話内容（送信したメッセージ）</li>
                    </ul>
                    <p className="text-amber-700 mb-2">これらのデータは当サービスのサーバー（Supabase Edge Function）経由で送信されます。送信されたデータは該当提供元のプライバシーポリシー等に基づいて処理されます。</p>
                    <p className="text-amber-700">この点にご同意の上でご利用ください。同意いただけない場合は本サービスのご利用をお控えください。</p>
                </section>

                <section>
                    <h2 className="text-base font-black text-gray-800 mb-3">5. Cookieの使用</h2>
                    <p>本サービスはログイン状態の維持のためにCookieおよびセッションストレージを使用します。セッションストレージには質問チャットの履歴・試験の回答途中データが一時保存されますが、タブを閉じると自動的に削除されます。</p>
                </section>

                <section>
                    <h2 className="text-base font-black text-gray-800 mb-3">6. データの保存期間・削除</h2>
                    <p className="mb-2">ユーザーデータはアカウントが有効な期間中保存します。退会・削除依頼を受理した日から<strong>30日以内</strong>にすべての個人データを削除します。</p>
                    <p className="mb-2">データの削除を希望する場合は、下記のメールアドレスに「データ削除希望」とご連絡ください。本人確認後、速やかに対応します。</p>
                    <p className="font-black text-gray-800">se-support@success-edge.net</p>
                </section>

                <section>
                    <h2 className="text-base font-black text-gray-800 mb-3">7. お問い合わせ</h2>
                    <p>個人情報の取り扱いに関するお問い合わせは、担当の先生または下記メールアドレスまでご連絡ください。</p>
                    <p className="font-black text-gray-800 mt-1">se-support@success-edge.net</p>
                </section>
            </div>

            <div className="mt-12 pt-8 border-t border-gray-100 text-center">
                <Link to="/terms" className="text-xs text-indigo-500 hover:text-indigo-700 font-black transition-colors">利用規約を見る →</Link>
            </div>
        </div>
    );
}
