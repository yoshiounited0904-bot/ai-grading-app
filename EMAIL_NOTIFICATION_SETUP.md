# メール通知設定ガイド

このアプリで以下のイベントが起きたときに、管理用メールアドレス
`successedge41@gmail.com` へ通知を送るための設定手順。

## 何が通知されるか

- 採点ミス報告
- 無料カウンセリング申込
- 要望・バグ報告

通知処理は `supabase/functions/notify-admin` で行う。  
メール送信用のAPIキーはブラウザ側には置かず、SupabaseのSecretに保存する。

## 全体の流れ

1. Resendでメール送信用APIキーを作る
2. SupabaseにSecretを設定する
3. `notify-admin` Edge Functionをデプロイする
4. アプリからテスト送信する

## 1. Resend APIキーを作る

Resendは、アプリからメールを送るための外部サービス。

1. [Resend](https://resend.com/) にログイン
2. 左メニューの `API Keys` を開く
3. `Create API Key` を押す
4. 権限はまず `Sending access` でOK
5. `re_...` で始まるAPIキーをコピーする

注意: APIキーは一度しか表示されないことがある。コピーして控えておく。

## 2. SupabaseにSecretを設定する

ターミナルでこのプロジェクトに移動する。

```bash
cd /Users/yoshitakaosawa/ai-grading-app
```

Supabase CLIにログインしていない場合は先にログインする。

```bash
supabase login
```

次に、ResendのAPIキーをSupabase Secretに保存する。

```bash
supabase secrets set RESEND_API_KEY="re_xxxxxxxxxxxxxxxxx"
```

通知先メールアドレスを設定する。

```bash
supabase secrets set ADMIN_NOTIFICATION_TO="successedge41@gmail.com"
```

送信元メールアドレスを設定する。

```bash
supabase secrets set ADMIN_NOTIFICATION_FROM="Success Edge <onboarding@resend.dev>"
```

最初は `onboarding@resend.dev` でよい。  
将来的に独自ドメインをResendで認証したら、次のように変更する。

```bash
supabase secrets set ADMIN_NOTIFICATION_FROM="Success Edge <noreply@success-edge.net>"
```

## 3. Edge Functionをデプロイする

このプロジェクトのSupabase project refはこれ。

```text
ijlaveuzloctsbpoyzkd
```

次のコマンドで通知用のEdge Functionをデプロイする。

```bash
supabase functions deploy notify-admin --project-ref ijlaveuzloctsbpoyzkd
```

成功すると、Supabase上に `notify-admin` 関数が反映される。

## 4. 動作確認

アプリ上で次のどれかを実行する。

- 採点ミス報告を送る
- 無料カウンセリング申込を送る
- 要望・バグ報告を送る

その後、`successedge41@gmail.com` にメールが届くか確認する。

## 届かないときに見る場所

まずSupabase Dashboardで確認する。

1. Supabase Dashboardを開く
2. 対象プロジェクトを選ぶ
3. `Edge Functions` を開く
4. `notify-admin` を開く
5. `Logs` を確認する

よくある原因:

- `RESEND_API_KEY` が未設定
- APIキーの値が間違っている
- `notify-admin` をまだデプロイしていない
- Resend側で送信元ドメインや送信制限に引っかかっている
- 迷惑メールに入っている

## Codexに任せられること

Codexに頼めること:

- `notify-admin` のコード修正
- デプロイコマンドの実行
- ビルド確認
- エラー文の読み取り

あなたがやる必要があること:

- ResendにログインしてAPIキーを作る
- Supabaseログインが必要な場面で認証する
- Gmail側で実際にメールが届いたか確認する

## 現在の実装ファイル

- 通知関数: `supabase/functions/notify-admin/index.ts`
- フロント側通知呼び出し: `src/services/notificationService.js`
- カウンセリング申込通知: `src/services/consultationService.js`
- 採点ミス報告通知: `src/services/reportService.js`
- 要望・バグ報告通知: `src/components/FeedbackForm.jsx`
