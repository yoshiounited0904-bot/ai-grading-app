import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@^22";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "");
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const getUserIdFromObject = (object: Record<string, unknown>) => {
  const metadata = object.metadata as Record<string, unknown> | undefined;
  return (
    metadata?.supabase_user_id ||
    metadata?.user_id ||
    object.client_reference_id
  ) as string | undefined;
};

const asUnixSeconds = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const syncSubscription = async (
  adminClient: ReturnType<typeof createClient>,
  subscriptionId: string,
) => {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = getUserIdFromObject(subscription as unknown as Record<string, unknown>);
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  const currentPeriodEnd = asUnixSeconds((subscription as unknown as Record<string, unknown>).current_period_end);
  const premiumUntil = currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null;
  const isActive = ["active", "trialing"].includes(subscription.status);

  let targetUserId = userId;
  if (!targetUserId && customerId) {
    const { data } = await adminClient
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    targetUserId = data?.id;
  }

  if (!targetUserId) {
    console.warn("Could not resolve Supabase user for subscription:", subscriptionId);
    return;
  }

  const { error: updateError } = await adminClient
    .from("profiles")
    .update({
      plan: isActive ? "premium" : "free",
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      premium_until: premiumUntil,
    })
    .eq("id", targetUserId);

  if (updateError) {
    throw updateError;
  }
};

const recordEventStart = async (
  adminClient: ReturnType<typeof createClient>,
  event: Stripe.Event,
) => {
  const { error } = await adminClient
    .from("payment_events")
    .insert({
      id: event.id,
      type: event.type,
      status: "processing",
      payload: event as unknown as Record<string, unknown>,
      processed_at: new Date().toISOString(),
    });

  if (!error) return { duplicated: false };
  if (error.code === "23505") return { duplicated: true };
  throw error;
};

const recordEventResult = async (
  adminClient: ReturnType<typeof createClient>,
  eventId: string,
  status: "processed" | "failed",
  errorMessage = "",
) => {
  const { error } = await adminClient
    .from("payment_events")
    .update({
      status,
      error: errorMessage || null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId);

  if (error) throw error;
};

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  if (!signature || !webhookSecret || !serviceRoleKey || !supabaseUrl) {
    return json({ error: "Webhook environment variables are not configured" }, 500);
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return json({ error: "Invalid signature" }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const eventStart = await recordEventStart(adminClient, event);
    if (eventStart.duplicated) {
      return json({ received: true, duplicated: true });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (typeof session.subscription === "string") {
          await syncSubscription(adminClient, session.subscription);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await syncSubscription(adminClient, subscription.id);
        break;
      }
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = (invoice as unknown as Record<string, unknown>).subscription;
        if (typeof subscriptionId === "string") await syncSubscription(adminClient, subscriptionId);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = (invoice as unknown as Record<string, unknown>).subscription;
        if (typeof subscriptionId === "string") await syncSubscription(adminClient, subscriptionId);
        break;
      }
      default:
        break;
    }

    await recordEventResult(adminClient, event.id, "processed");

    return json({ received: true });
  } catch (error) {
    console.error("stripe-webhook processing error:", error);
    try {
      await recordEventResult(
        adminClient,
        event.id,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
    } catch (recordError) {
      console.error("payment_events failure record error:", recordError);
    }
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
