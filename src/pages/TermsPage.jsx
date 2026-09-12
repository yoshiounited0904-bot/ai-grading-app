import React from 'react';
import { Link } from 'react-router-dom';

export default function TermsPage() {
    return (
        <div className="max-w-3xl mx-auto px-6 py-12">
            <div className="mb-8">
                <Link to="/" className="text-sm text-gray-400 hover:text-gray-600 font-black transition-colors">← トップに戻る</Link>
            </div>
            <h1 className="text-2xl font-black text-gray-900 mb-2">利用規約</h1>
            <p className="text-xs text-gray-400 mb-10">最終更新日: 2026年8月23日</p>

            <div className="space-y-8 text-sm text-gray-600 leading-relaxed">
                <section>
                    <h2 className="text-base font-black text-gray-800 mb-3">第1条（サービスの概要）</h2>
                    <p>本サービスは、大学入試問題の採点・解説を提供する学習支援ツールです。本サービスは、登録ユーザーのほか、会員登録前のゲストユーザー（以下「ゲスト」）がお試しとして利用できます。</p>
                </section>

                <section>
                    <h2 className="text-base font-black text-gray-800 mb-3">第2条（利用資格）</h2>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>登録ユーザーは、本サービス所定の無料プランまたは有料プランの範囲内で利用できます。</li>
                        <li>18歳未満の方は、保護者の同意を得た上でご利用ください。</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-base font-black text-gray-800 mb-3">第3条（禁止事項）</h2>
                    <p className="mb-2">以下の行為を禁止します。</p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>本サービス上の問題・解説・採点結果の外部への転載・二次配布</li>
                        <li>スクリーンショット等による問題・解説の第三者への共有</li>
                        <li>本サービスへの不正アクセス・リバースエンジニアリング</li>
                        <li>他のユーザーへの迷惑行為</li>
                        <li>その他、運営者が不適切と判断する行為</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-base font-black text-gray-800 mb-3">第4条（著作権）</h2>
                    <p>本サービスで表示される入試問題・本文・図表等の著作権は、各大学、出版社、著作者その他の権利者に帰属します。本サービスは学習支援を目的として表示・採点補助を行うものであり、利用者に対して入試問題等の転載、複製、配布、公開、二次利用を許諾するものではありません。自動生成解説および本サービス独自の表示内容の無断転載・二次配布も禁止します。</p>
                </section>

                <section className="bg-red-50 border border-red-200 rounded-sm p-4">
                    <h2 className="text-base font-black text-red-800 mb-3">第5条（採点・解説システムの限界および免責）</h2>
                    <p className="text-red-700 mb-3">本サービスの自動採点・解説・質問チャット機能についての重要事項です。必ずご確認ください。</p>
                    <ul className="list-disc pl-5 space-y-2 text-red-700">
                        <li><strong>参考情報に限る：</strong>本機能による採点結果・解説・アドバイスはすべて参考情報です。100%の正確性・完全性を保証するものではありません。</li>
                        <li><strong>誤採点の可能性：</strong>システムの性質上、記述式問題の採点・解説に誤りが含まれる場合があります。疑問がある場合は担当講師や公式解答に必ず照合してください。</li>
                        <li><strong>進路・合否判断への不使用：</strong>採点結果・合格可能性判定を、志望校選択・出願・受験の最終判断に使用しないでください。これらは補助的な学習ツールとしてのみ提供しています。</li>
                        <li><strong>損害の免責：</strong>本機能の誤り・不正確な情報・システム障害等によって生じた学習上・受験上・その他いかなる損害についても、運営者は責任を負いません。</li>
                        <li><strong>外部システムへの依存：</strong>本サービスは外部のAI処理（Google Gemini API等）に依存しています。該当サービスの仕様変更・障害・ポリシー変更により機能が停止・変更される場合があります。</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-base font-black text-gray-800 mb-3">第6条（サービスの変更・停止）</h2>
                    <p>運営者は予告なくサービス内容の変更・停止・終了を行う場合があります。これにより生じた損害について責任を負いません。</p>
                </section>

                <section>
                    <h2 className="text-base font-black text-gray-800 mb-3">第7条（有料プラン・解約・返金）</h2>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>有料プランはStripeの決済画面に表示される料金、更新周期、支払条件に基づく継続課金です。</li>
                        <li>契約内容の確認、支払方法の変更、解約は、サービス内の契約管理ページまたはStripeが提供する管理画面から行えます。</li>
                        <li>解約後の利用可能期間、次回請求の有無、返金の可否は、決済画面および契約管理画面の表示に従います。</li>
                        <li>デジタルサービスの性質上、利用開始後の返金は、法令上必要な場合を除き原則として行いません。</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-base font-black text-gray-800 mb-3">第8条（退会・アカウント削除）</h2>
                    <p>退会を希望する場合は運営者にお問い合わせください。退会後、学習履歴・採点結果等のデータは削除されます。</p>
                </section>

                <section>
                    <h2 className="text-base font-black text-gray-800 mb-3">第9条（準拠法）</h2>
                    <p>本規約は日本法に準拠し、解釈されます。</p>
                </section>
            </div>

            <div className="mt-12 pt-8 border-t border-gray-100 text-center">
                <Link to="/privacy" className="text-xs text-indigo-500 hover:text-indigo-700 font-black transition-colors">プライバシーポリシーを見る →</Link>
            </div>
        </div>
    );
}
