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
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json({ error: "Admin profile environment variables are not configured" }, 500);
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
    console.error("admin-update-profile actor profile error:", actorProfileError);
    return json({ error: "管理者情報の確認に失敗しました" }, 500);
  }

  const actorEmail = String(actor.email || "").toLowerCase();
  const actorIsAdmin = actorProfile?.role === "admin" || getAdminEmails().has(actorEmail);
  if (!actorIsAdmin) {
    return json({ error: "管理者権限が必要です" }, 403);
  }

  // GET: return user email mapping
  if (req.method === "GET") {
    const emailMap: Record<string, string> = {};
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data: listData, error: listError } = await adminClient.auth.admin.listUsers({
        page,
        perPage,
      });
      if (listError) {
        console.error("admin listUsers error:", listError);
        return json({ error: "ユーザー一覧の取得に失敗しました" }, 500);
      }
      for (const u of listData.users) {
        if (u.id && u.email) emailMap[u.id] = u.email;
      }
      if (listData.users.length < perPage) break;
      page++;
    }
    return json({ emailMap });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { userId, role, plan } = body;
  if (!isUuid(userId)) {
    return json({ error: "ユーザーIDが不正です" }, 400);
  }

  const updates: Record<string, unknown> = {};
  if (role !== undefined) {
    if (role !== "admin" && role !== "user") {
      return json({ error: "権限の値が不正です" }, 400);
    }
    updates.role = role;
  }

  if (plan !== undefined) {
    if (plan !== "free" && plan !== "premium") {
      return json({ error: "プランの値が不正です" }, 400);
    }
    updates.plan = plan;
    updates.subscription_status = null;
    updates.premium_until = null;
  }

  if (Object.keys(updates).length === 0) {
    return json({ error: "更新内容がありません" }, 400);
  }

  const { data, error } = await adminClient
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select("id, username, role, plan, subscription_status, premium_until")
    .single();

  if (error) {
    console.error("admin-update-profile update error:", error);
    return json({ error: "プロフィール更新に失敗しました" }, 500);
  }

  return json({ profile: data });
});
