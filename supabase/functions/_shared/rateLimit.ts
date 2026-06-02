import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const LIMITS: Record<string, number> = {
  "gemini-grade": 20,   // 1日20回まで
  "gemini-chat": 100,   // 1日100回まで
};

export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string,
  functionName: string
): Promise<{ allowed: boolean; remaining: number }> {
  const limit = LIMITS[functionName] ?? 20;
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // 管理者は制限なし
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  if (profile?.role === "admin") return { allowed: true, remaining: 999 };

  const { count } = await supabase
    .from("function_calls")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("function_name", functionName)
    .gte("created_at", oneDayAgo);

  const used = count ?? 0;
  if (used >= limit) return { allowed: false, remaining: 0 };

  // 今回の呼び出しを記録
  await supabase.from("function_calls").insert({ user_id: userId, function_name: functionName });

  return { allowed: true, remaining: limit - used - 1 };
}
