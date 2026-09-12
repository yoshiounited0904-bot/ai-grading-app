import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@^22";
import { corsHeaders } from "../_shared/cors.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "");

const json = (body: Record<string, unknown>, status = 200, headers = corsHeaders) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });

const DEFAULT_ALLOWED_ORIGIN = "https://smart-saiten.com,https://www.smart-saiten.com,https://ai-grading-app.vercel.app,http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:5173,http://localhost:5173";

const getCorsConfig = (req: Request) => {
  const configuredAllowedOrigin = Deno.env.get("ALLOWED_ORIGIN")?.trim();
  const allowedOrigins = (configuredAllowedOrigin && configuredAllowedOrigin !== "*" ? configuredAllowedOrigin : DEFAULT_ALLOWED_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestOrigin = req.headers.get("origin") ?? "";
  const isAllowed = requestOrigin !== "" && allowedOrigins.includes(requestOrigin);
  const responseOrigin = isAllowed ? requestOrigin : allowedOrigins[0] ?? "https://smart-saiten.com";
  return {
    headers: { ...corsHeaders, "Access-Control-Allow-Origin": responseOrigin },
    isAllowed,
  };
};

const getAppUrl = (req: Request) => {
  const configured = Deno.env.get("APP_URL");
  if (configured) return configured.replace(/\/$/, "");
  const origin = req.headers.get("origin");
  return origin && getCorsConfig(req).isAllowed ? origin.replace(/\/$/, "") : "https://smart-saiten.com";
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

const hasActiveStripeSubscription = async (customerId: string, priceId: string) => {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
    expand: ["data.items.data.price"],
  });

  return subscriptions.data.some((subscription) => (
    ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status) &&
    subscription.items.data.some((item) => item.price.id === priceId)
  ));
};

serve(async (req) => {
  const { headers, isAllowed } = getCorsConfig(req);

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);
  if (!isAllowed) return json({ error: "Forbidden" }, 403, headers);

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const priceId = Deno.env.get("STRIPE_PREMIUM_PRICE_ID");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !priceId || !supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return json({ error: "Payment environment variables are not configured" }, 500, headers);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userError || !user) {
      return json({ error: "ログインが必要です" }, 401, headers);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile } = await adminClient
      .from("profiles")
      .select("id, username, plan, subscription_status, stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    let customerId = profile?.stripe_customer_id as string | undefined;
    const isAlreadyPremium =
      profile?.plan === "premium" ||
      ["active", "trialing"].includes(String(profile?.subscription_status ?? ""));

    const hasStripeSubscription = customerId
      ? await hasActiveStripeSubscription(customerId, priceId)
      : false;

    if (customerId && (isAlreadyPremium || hasStripeSubscription)) {
      const portalConfiguration = Deno.env.get("STRIPE_PORTAL_CONFIGURATION_ID");
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${getAppUrl(req)}/premium`,
        ...(portalConfiguration ? { configuration: portalConfiguration } : {}),
      });
      return json({ url: portalSession.url, alreadySubscribed: true }, 200, headers);
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await adminClient
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    const appUrl = getAppUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      customer_update: {
        address: "never",
        name: "never",
        shipping: "never",
      },
      name_collection: {
        business: { enabled: false },
        individual: { enabled: false },
      },
      success_url: `${appUrl}/premium?checkout=success`,
      cancel_url: `${appUrl}/premium?checkout=cancelled`,
      client_reference_id: user.id,
      metadata: { supabase_user_id: user.id },
      subscription_data: {
        metadata: { supabase_user_id: user.id },
      },
    });

    return json({ url: session.url }, 200, headers);
  } catch (error) {
    console.error("create-checkout-session error:", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500, headers);
  }
});
