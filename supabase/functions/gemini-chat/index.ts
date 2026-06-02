import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";
import { corsHeaders, fetchPrivatePdfAsInlineData } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const MODELS = {
  PRIMARY: "gemini-2.5-flash",
  FALLBACK: "gemini-2.5-pro",
};

const sanitizeUserAnswer = (answer: unknown): string => {
  if (answer === null || answer === undefined) return "";
  const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
    /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
    /forget\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
    /you\s+are\s+now\s+(a\s+)?(?:different|new|another)/gi,
    /system\s*:/gi,
  ];
  let text = String(answer).slice(0, 2000);
  for (const p of INJECTION_PATTERNS) text = text.replace(p, "[REMOVED]");
  text = text.replace(/<user_answer>/gi, "&lt;user_answer&gt;");
  text = text.replace(/<\/user_answer>/gi, "&lt;/user_answer&gt;");
  return text;
};

const getAllowedOrigin = () => Deno.env.get("ALLOWED_ORIGIN") ?? "*";

serve(async (req) => {
  const origin = getAllowedOrigin();
  const headers = { ...corsHeaders, "Access-Control-Allow-Origin": origin };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  const requestOrigin = req.headers.get("origin") ?? "";
  if (origin !== "*" && requestOrigin !== origin) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // レート制限チェック
    const { allowed } = await checkRateLimit(supabase, user.id, "gemini-chat");
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "本日のチャット回数の上限（100回）に達しました。明日また挑戦してください。" }),
        { status: 429, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    if (JSON.stringify(body).length > 300_000) {
      return new Response(JSON.stringify({ error: "リクエストが大きすぎます。" }), {
        status: 413,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const { userMessage, history, gradingResult, examMeta, pdfPath } = body;

    if (!userMessage || String(userMessage).length > 2000) {
      return new Response(JSON.stringify({ error: "メッセージが長すぎます（2000文字以内）。" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

    const imageParts = pdfPath ? await fetchPrivatePdfAsInlineData(pdfPath) : [];

    const { universityName = "", facultyName = "", examSubject = "", examYear = "", examDurationMinutes = "", sectionSummary = [] } = examMeta || {};

    const sanitizedResult = {
      ...gradingResult,
      questionFeedback: gradingResult?.questionFeedback?.map((f: { userAnswer?: unknown }) => ({
        ...f,
        userAnswer: f.userAnswer ? sanitizeUserAnswer(f.userAnswer) : f.userAnswer,
      })),
    };

    const systemPrompt = `
# Role
あなたは入試採点ツールに常駐する「AI先生」です。
あなたの役割は、提示された入試問題に関する生徒の疑問に対し、正確かつ前向きなアドバイスを提供することです。

# Context (試験情報)
大学: ${universityName}
学部: ${facultyName}
科目: ${examSubject}
年度: ${examYear}年
試験時間: ${examDurationMinutes}分
大問構成: ${sectionSummary.length > 0 ? sectionSummary.map((s: { title: string; questionCount: number; totalPoints: number }) => `${s.title}（${s.questionCount}問・${s.totalPoints}点）`).join(" / ") : "情報なし"}

# Context (採点結果)
採点結果データ（questionFeedback の userAnswer は生徒が実際に記入した解答です）:
${JSON.stringify(sanitizedResult)}

# Constraints
1. 入試問題の内容・解き方・解説に関する質問以外には回答しないでください。
2. 常にポジティブで励ますような口調を保ってください。
3. すぐに答えを教えるのではなく、ヒントを与えて考えさせる誘導を優先してください。
4. 政治・宗教・不適切なトピックには触れません。

# Character Voice
- 一人称は「私」。丁寧語（です・ます調）。
- 生徒を「あなた」と呼ぶ。

# Formatting Rules
- Markdownの記号（*や#）は使用しない。
- 改行と空白を適切に使い、読みやすいテキストにする。
- リストはハイフン（-）を使用。
${imageParts.length > 0 ? "\n# 試験PDF\n上記のPDFが今回の試験問題です。生徒の質問に応じて参照してください。" : ""}
`;

    const genAI = new GoogleGenerativeAI(apiKey);

    let model;
    try {
      model = genAI.getGenerativeModel({ model: MODELS.PRIMARY });
    } catch {
      model = genAI.getGenerativeModel({ model: MODELS.FALLBACK });
    }

    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: systemPrompt }, ...imageParts],
        },
        {
          role: "model",
          parts: [{ text: "わかりました。生徒さんの質問に丁寧に答えます。" }],
        },
        ...(history || []).map((msg: { role: string; text: string }) => ({
          role: msg.role === "ai" ? "model" : "user",
          parts: [{ text: msg.text }],
        })),
      ],
    });

    const result = await chat.sendMessage(userMessage);
    const response = result.response.text();

    return new Response(JSON.stringify({ response }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("503") || msg.includes("overloaded")) {
      return new Response(JSON.stringify({ error: "AIが混み合っています。少し時間を置いて再度お試しください。" }), {
        status: 503,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
