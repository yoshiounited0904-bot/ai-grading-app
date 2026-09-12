# Stripe Payment Setup

プレミアムプラン決済を有効化するための設定です。決済情報はStripeで扱い、スマサイ側にはカード番号・有効期限・CVCを保存しません。

## 1. Supabase SQL

Supabase SQL Editor で `supabase_schema_payments.sql` を実行します。

本格運用では `supabase/migrations/20260905133224_harden_payment_profiles.sql` も適用済みであることを確認します。このmigrationで以下を有効化します。

- `profiles.plan`
- `profiles.stripe_customer_id`
- `profiles.stripe_subscription_id`
- `profiles.subscription_status`
- `profiles.premium_until`
- `payment_events`
- 通常ユーザーが自分で `plan` / `role` / Stripe関連カラムを書き換えられない保護トリガー

## 2. Supabase Secrets

Stripe Dashboard で月額商品の Price ID を作成し、以下を Supabase Edge Functions の Secrets に設定します。

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx
supabase secrets set STRIPE_PREMIUM_PRICE_ID=price_xxx
supabase secrets set APP_URL=http://localhost:5173
supabase secrets set ALLOWED_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
```

本番では `APP_URL` と `ALLOWED_ORIGIN` を本番URLに変えます。

```bash
supabase secrets set APP_URL=https://smart-saiten.com
supabase secrets set ALLOWED_ORIGIN=https://smart-saiten.com,https://www.smart-saiten.com
```

Stripe Billing Portal の設定を複数作る場合のみ、Portal configuration ID も設定します。通常は未設定でOKです。

```bash
supabase secrets set STRIPE_PORTAL_CONFIGURATION_ID=bpc_xxx
```

Stripe Dashboard の Customer Portal で、ユーザーができる操作を有効化します。

- 支払い方法の更新
- 請求書履歴の確認
- サブスクリプションの解約

Checkoutでは余計な心理的負担を減らすため、スマサイ側から名前・住所入力の収集は要求しません。Stripe側のカード認証・不正利用対策・カードブランド要件により、Stripe Checkout上で追加確認が出る場合はあります。

## 3. Edge Functions Deploy

```bash
supabase functions deploy create-checkout-session
supabase functions deploy create-billing-portal-session
supabase functions deploy stripe-webhook --no-verify-jwt
```

## 4. Stripe Webhook

Stripe Dashboard で Webhook endpoint を作成します。

Endpoint URL:

```text
https://<PROJECT_REF>.supabase.co/functions/v1/stripe-webhook
```

Listen events:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.payment_succeeded
invoice.payment_failed
```

WebhookはStripe署名検証を必須にしています。`stripe-webhook` は `--no-verify-jwt` でデプロイしますが、Stripeの `stripe-signature` と `STRIPE_WEBHOOK_SECRET` が一致しないリクエストは拒否します。

`payment_events` はイベントIDを主キーにしているため、Stripeから同じイベントが再送されても二重処理しません。処理成功は `processed`、失敗は `failed` として記録します。

作成後に表示される Signing secret を Supabase Secrets に設定します。

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
```

その後、Webhook Function を再デプロイします。

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

## 5. 動作確認

1. アプリでログインする
2. `/premium` を開く
3. 「プレミアムに登録する」を押す
4. Stripe Checkout でテスト決済する
5. `/premium?checkout=success` に戻る
6. `profiles.plan` が `premium` になっていることを確認する
7. `/premium` の「契約を管理する」から Stripe Customer Portal が開くことを確認する
8. 同じユーザーで再度「プレミアムに登録する」を押した場合、新規契約ではなくCustomer Portalに遷移することを確認する
9. Stripe Dashboard でサブスクをキャンセルし、Webhook反映後に `profiles.subscription_status` と `profiles.plan` が更新されることを確認する

## 6. 本番切り替えチェック

本番運用前に以下を確認します。

- Stripe Dashboard を本番環境に切り替える
- 本番商品の Price ID を `STRIPE_PREMIUM_PRICE_ID` に設定する
- 本番の Secret key を `STRIPE_SECRET_KEY` に設定する
- 本番URLを `APP_URL` に設定する
- 本番Stripe側で Webhook endpoint を作成する
- 本番Webhookの Signing secret を `STRIPE_WEBHOOK_SECRET` に設定する
- `create-checkout-session` / `create-billing-portal-session` / `stripe-webhook` を再デプロイする
- Stripe Customer Portal の解約・支払い方法更新が有効になっていることを確認する
- Stripe Dashboard の支払い方法で、カード決済とApple Payなど必要なウォレットが有効になっていることを確認する
