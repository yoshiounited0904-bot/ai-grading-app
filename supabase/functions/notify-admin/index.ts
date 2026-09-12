import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

type EventType = "consultation_request" | "grading_report" | "user_feedback";

const EVENT_LABELS: Record<EventType, string> = {
  consultation_request: "無料カウンセリング申込",
  grading_report: "採点ミス報告",
  user_feedback: "要望・バグ報告",
};

const EVENT_SUBJECTS: Record<EventType, string> = {
  consultation_request: "【Success Edge】無料カウンセリング申込がありました",
  grading_report: "【Success Edge】採点ミス報告がありました",
  user_feedback: "【Success Edge】要望・バグ報告がありました",
};

const DEFAULT_ALLOWED_ORIGIN = "https://smart-saiten.com,https://www.smart-saiten.com,https://ai-grading-app.vercel.app,http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:5173,http://localhost:5173";
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

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

const checkBasicRateLimit = (req: Request) => {
  const now = Date.now();
  const key = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("cf-connecting-ip")
    || "unknown";
  const current = rateLimitStore.get(key);
  if (!current || current.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= 10) return false;
  current.count += 1;
  return true;
};

const toText = (value: unknown, max = 1200) => {
  if (value === null || value === undefined || value === "") return "-";
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

const escapeHtml = (value: unknown) =>
  toText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const row = (label: string, value: unknown) => `
  <tr>
    <th style="text-align:left;width:180px;padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#475569;background:#f8fafc;">${label}</th>
    <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;white-space:pre-wrap;">${escapeHtml(value)}</td>
  </tr>
`;

const buildFields = (eventType: EventType, payload: Record<string, unknown>) => {
  if (eventType === "consultation_request") {
    return [
      ["申込ID", payload.id],
      ["生徒名", payload.student_name],
      ["学年", payload.grade],
      ["メール", payload.email],
      ["LINE表示名", payload.line_display_name],
      ["照合コード", payload.line_match_code],
      ["希望相談方法", payload.preferred_method],
      ["希望日時1", payload.preferred_time_1],
      ["希望日時2", payload.preferred_time_2],
      ["希望日時3", payload.preferred_time_3],
      ["相談内容", payload.consultation_message],
      ["大学・学部・科目", `${toText(payload.university_name)} ${toText(payload.faculty_name)} ${toText(payload.exam_subject)}`],
      ["得点", payload.score !== null && payload.max_score !== null ? `${payload.score}/${payload.max_score}` : "-"],
      ["判定", payload.pass_probability],
      ["LINE送信用文面", payload.line_match_message],
    ];
  }

  if (eventType === "grading_report") {
    return [
      ["報告ID", payload.id],
      ["大学・学部・科目", `${toText(payload.university_name)} ${toText(payload.faculty_name)} ${toText(payload.exam_subject)}`],
      ["年度", payload.exam_year],
      ["問題ID", payload.question_id],
      ["ユーザーコメント", payload.user_comment],
      ["結果ID", payload.exam_result_id],
      ["ユーザーID", payload.user_id],
      ["確認方法", "管理画面で詳細を確認してください"],
    ];
  }

  return [
    ["問い合わせID", payload.id],
    ["名前", payload.name],
    ["メール", payload.email],
    ["カテゴリ", payload.type],
    ["内容", payload.message],
    ["ユーザーID", payload.user_id],
  ];
};

const buildEmail = (eventType: EventType, payload: Record<string, unknown>) => {
  const label = EVENT_LABELS[eventType];
  const createdAt = toText(payload.created_at || new Date().toISOString());
  const fields = buildFields(eventType, payload);
  const text = [
    `${label}がありました。`,
    `日時: ${createdAt}`,
    "",
    ...fields.map(([key, value]) => `${key}: ${toText(value)}`),
  ].join("\n");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;line-height:1.6;">
      <h2 style="margin:0 0 12px;">${label}がありました</h2>
      <p style="margin:0 0 16px;color:#64748b;">日時: ${escapeHtml(createdAt)}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;border:1px solid #e5e7eb;">
        <tbody>
          ${fields.map(([key, value]) => row(String(key), value)).join("")}
        </tbody>
      </table>
    </div>
  `;

  return { subject: EVENT_SUBJECTS[eventType], text, html };
};

serve(async (req) => {
  const { headers, isAllowed } = getCorsConfig(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  if (!isAllowed) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
  if (!checkBasicRateLimit(req)) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    if (JSON.stringify(body).length > 80_000) {
      return new Response(JSON.stringify({ error: "Request too large" }), {
        status: 413,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const eventType = body.eventType as EventType;
    if (!eventType || !(eventType in EVENT_LABELS)) {
      return new Response(JSON.stringify({ error: "Invalid event type" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY is not configured" }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const to = Deno.env.get("ADMIN_NOTIFICATION_TO") ?? "successedge41@gmail.com";
    const from = Deno.env.get("ADMIN_NOTIFICATION_FROM") ?? "Success Edge <onboarding@resend.dev>";
    const payload = (body.payload ?? {}) as Record<string, unknown>;
    const email = buildEmail(eventType, payload);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Email send failed", detail: result }), {
        status: 502,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, id: result.id ?? null }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
