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

serve(async (req) => {
  const { headers, isAllowed } = getCorsConfig(req);

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);
  if (!isAllowed) return json({ error: "Forbidden" }, 403, headers);

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const portalConfiguration = Deno.env.get("STRIPE_PORTAL_CONFIGURATION_ID");

    if (!stripeSecretKey || !supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return json({ error: "Billing portal environment variables are not configured" }, 500, headers);
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
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("create-billing-portal-session profile error:", profileError);
      return json({ error: "プロフィール情報の取得に失敗しました" }, 500, headers);
    }

    const customerId = profile?.stripe_customer_id as string | undefined;
    if (!customerId) {
      return json({ error: "このアカウントにはStripe決済情報がありません" }, 404, headers);
    }

    const appUrl = getAppUrl(req);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/premium`,
      ...(portalConfiguration ? { configuration: portalConfiguration } : {}),
    });

    return json({ url: session.url }, 200, headers);
  } catch (error) {
    console.error("create-billing-portal-session error:", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500, headers);
  }
});
