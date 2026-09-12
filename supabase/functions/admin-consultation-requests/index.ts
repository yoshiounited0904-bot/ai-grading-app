import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const DEFAULT_ADMIN_EMAILS = [
  "yoshiounited0904@gmail.com",
  "se-support@success-edge.net",
  "admin@test.com",
];

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const getAdminEmails = () => {
  const configured = Deno.env.get("ADMIN_EMAILS") ?? "";
  return new Set(
    [...DEFAULT_ADMIN_EMAILS, ...configured.split(",")]
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
};

const isUuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);

const ALLOWED_UPDATE_FIELDS = new Set([
  "status",
  "line_matched",
  "admin_memo",
]);

const filterUpdates = (updates: unknown) => {
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) return null;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates as Record<string, unknown>)) {
    if (ALLOWED_UPDATE_FIELDS.has(key)) next[key] = value;
  }
  return next;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json({ error: "Admin consultation environment variables are not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  const actor = userData?.user;
  if (userError || !actor) {
    return json({ error: "ログインが必要です" }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: actorProfile, error: actorProfileError } = await adminClient
    .from("profiles")
    .select("id, role")
    .eq("id", actor.id)
    .maybeSingle();

  if (actorProfileError) {
    console.error("admin-consultation actor profile error:", actorProfileError);
    return json({ error: "管理者情報の確認に失敗しました" }, 500);
  }

  const actorEmail = String(actor.email || "").toLowerCase();
  const actorIsAdmin = actorProfile?.role === "admin" || getAdminEmails().has(actorEmail);
  if (!actorIsAdmin) {
    return json({ error: "管理者権限が必要です" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { action, id } = body;

  if (action === "list") {
    const { data, error } = await adminClient
      .from("consultation_requests")
      .select("*, exam_results(*)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("admin-consultation list error:", error);
      return json({ error: "お問い合わせ情報の取得に失敗しました" }, 500);
    }

    return json({ consultations: data || [] });
  }

  if (!isUuid(id)) {
    return json({ error: "お問い合わせIDが不正です" }, 400);
  }

  if (action === "update") {
    const updates = filterUpdates(body.updates);
    if (!updates || Object.keys(updates).length === 0) {
      return json({ error: "更新内容がありません" }, 400);
    }

    const { data, error } = await adminClient
      .from("consultation_requests")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      console.error("admin-consultation update error:", error);
      return json({ error: "お問い合わせ情報の更新に失敗しました" }, 500);
    }
    if (!data) return json({ error: "対象のお問い合わせが見つかりません" }, 404);

    return json({ consultation: data });
  }

  if (action === "delete") {
    const { data, error } = await adminClient
      .from("consultation_requests")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("admin-consultation delete error:", error);
      return json({ error: "お問い合わせ情報の削除に失敗しました" }, 500);
    }
    if (!data) return json({ error: "対象のお問い合わせが見つかりません" }, 404);

    return json({ deletedId: data.id });
  }

  return json({ error: "操作が不正です" }, 400);
});
