import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";
import { corsHeaders, fetchPrivatePdfAsInlineData } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const MODELS = {
  PRIMARY: "gemini-2.5-flash",
  FALLBACK: "gemini-2.5-pro",
};

const sanitizeJson = (text: string): string => {
  let cleaned = text.replace(/```json\s*/g, "").replace(/```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1) cleaned = cleaned.substring(first, last + 1);
  return cleaned;
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

async function generateWithRetry(genAI: GoogleGenerativeAI, prompt: string, imageParts: unknown[], config = {}) {
  for (const modelName of [MODELS.PRIMARY, MODELS.FALLBACK]) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName, ...config });
      const result = await model.generateContent([prompt, ...imageParts]);
      return result.response.text();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("404") || msg.includes("not found")) continue;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("All Gemini models failed.");
}

const getAllowedOrigin = () => Deno.env.get("ALLOWED_ORIGIN") ?? "*";

serve(async (req) => {
  const origin = getAllowedOrigin();
  const headers = { ...corsHeaders, "Access-Control-Allow-Origin": origin };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  // CORSチェック: ALLOWED_ORIGINが設定されている場合、リクエストのオリジンを検証する
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

    // レートリミットの検証
    const { allowed, remaining } = await checkRateLimit(supabase, user.id, "gemini-grade");
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "レートリミットに達しました。時間をおいてから再度お試しください。" }),
        { status: 429, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
    console.log(`Rate limit OK: ${remaining} remaining for ${user.id}`);

    // ボディデータのサイズ検証
    const body = await req.json();
    if (JSON.stringify(body).length > 500_000) {
      return new Response(JSON.stringify({ error: "リクエストデータが大きすぎます。" }), {
        status: 413,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const { pendingAiGrading, examMeta, pdfPath } = body;

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

    const imageParts = pdfPath ? await fetchPrivatePdfAsInlineData(pdfPath) : [];
    const genAI = new GoogleGenerativeAI(apiKey);

    // ---------------------------------------------------------------
    type GradingQuestion = {
      id: string;
      type: string;
      sectionId: string;
      userAnswer: unknown;
      correctAnswer: unknown;
      alternativeAnswers: unknown[];
      points: number;
      gradingInstruction: string;
      completeGroupId?: string;
      scoringElements?: Array<{
        id: string;
        description: string;
        points: number;
        allowPartial: boolean;
        type: 'content' | 'logic';
      }>;
    };

    const allAiFeedback: Array<{
      id: string;
      score: number;
      correct: boolean;
      explanation: string;
      essayResult?: unknown;
      scoringElements?: unknown;
    }> = [];
    let aggregatedWeakness = "";

    const essayQuestions = (pendingAiGrading as GradingQuestion[]).filter(
      (q) => q.type === "essay"
    );
    const otherQuestions = (pendingAiGrading as GradingQuestion[]).filter(
      (q) => q.type !== "essay"
    );

    // [A-1] 自由記述問題（essay）の採点処理
    for (const q of essayQuestions) {
      const userAnswer = sanitizeUserAnswer(q.userAnswer);
      const scoringElements = q.scoringElements || [];

      const scoringElementsJson = JSON.stringify(scoringElements, null, 2);
      const essayPrompt = `あなたは厳格な英語の採点官です。以下の答案について、指定された採点要素および文法ルールに基づいて採点を行ってください。

【試験メタデータ】
大学名: ${examMeta.university}
学部名: ${examMeta.faculty}
科目: ${examMeta.subject}
年度: ${examMeta.year}

【設問情報】
設問ID: ${q.id}
総配点: ${q.points}点
採点基準・指示: ${q.gradingInstruction || "特になし"}

【採点要素（scoringElements）】
${scoringElementsJson}

【採点ルール】
1. 各採点要素（id: e1, e2, ...）について、答案が満たしているかどうかを個別に判定してください。
   ステータスは以下の3つから選択してください：
   - "full": 要素を完全に満たしている（その要素の満点を与える）
   - "partial": 要素を部分的に満たしている（allowPartialがtrueの場合のみ選択可能。falseの場合は選択禁止）
   - "none": 要素を満たしていない（0点）
   ※各要素의 判定理由（reason）を、日本語で具体的かつ客観的に記述してください。

2. 答案全体の文法・スペル・語法ミスをすべて抽出し、エラー箇所と修正案をリストアップしてください。同一文内の同種ミスは1件とカウントします。
   ※ミス1件につき-1点の減点となります（減点計算はシステム側で行うため、JSONにはエラーリストのみ含めてください）。

3. 全体的なフィードバックを日本語で100〜200文字記述してください。

【答案】
<user_answer>
${userAnswer}
</user_answer>

【出力形式（JSON厳守）】
以下のJSONのみを返すこと。説明文・前置きは一切不要。

{
  "elementResults": [
    {
      "elementId": "e1",
      "status": "full | partial | none",
      "reason": "〜について明確に述べられており、要素を満たしている。"
    }
  ],
  "grammarErrors": [
    { "error": "<エラー箇所>", "correction": "<修正案>" }
  ],
  "overallComment": "全体的なフィードバックを日本語で100〜200文字記述してください。"
}`;

      try {
        const text = await generateWithRetry(genAI, essayPrompt, imageParts, {
          generationConfig: { responseMimeType: "application/json" },
        });
        const result = JSON.parse(sanitizeJson(text));

        // 要素得点の計算
        let totalElementPoints = 0;
        for (const elResult of result.elementResults || []) {
          const el = scoringElements.find(e => e.id === elResult.elementId);
          if (!el) continue;
          if (elResult.status === "full") {
            totalElementPoints += el.points;
          } else if (elResult.status === "partial" && el.allowPartial) {
            totalElementPoints += el.points / 2;
          }
        }

        // 文法減点の計算
        const grammarErrors = result.grammarErrors || [];
        const finalScore = Math.max(0, totalElementPoints - grammarErrors.length);
        const correct = finalScore >= q.points * 0.6;

        const explanation = buildNewEssayExplanation(result, scoringElements, finalScore, q.points);

        allAiFeedback.push({
          id: q.id,
          score: finalScore,
          correct,
          explanation,
          essayResult: result,
          scoringElements: scoringElements,
        });

        if (result.overallComment) {
          aggregatedWeakness += (aggregatedWeakness ? "\n" : "") + `[${q.id}] ${result.overallComment}`;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        allAiFeedback.push({ id: q.id, score: 0, correct: false, explanation: `【採点エラー】${msg}` });
      }
    }

    // [A-2] 記述式問題（otherQuestions）の採点処理（大問単位またはバッチで採点）
    const groupedQuestions: Record<string, GradingQuestion[]> = {};
    for (const q of otherQuestions) {
      const gId = q.completeGroupId || q.sectionId || "default";
      if (!groupedQuestions[gId]) groupedQuestions[gId] = [];
      groupedQuestions[gId].push(q);
    }

    for (const [_, questions] of Object.entries(groupedQuestions)) {
      const elementPrompt = `あなたは厳格な採点官です。以下の答案について、採点基準・指示に基づいて採点を行ってください。

【試験メタデータ】
大学名: ${examMeta.university}
学部名: ${examMeta.faculty}
科目: ${examMeta.subject}
年度: ${examMeta.year}

【設問リストと答案】
${questions.map(q => `
---
設問ID: ${q.id}
配点: ${q.points}点
採点基準・指示: ${q.gradingInstruction || "模範解答に合致しているか判定してください。"}
答案: ${sanitizeUserAnswer(q.userAnswer)}
`).join("\n")}

【採点基準・指示】
各設問について、答案が採点基準を満たしているか客観的に判断し、得点を算出してください。
得点は 0 から 各設問の配点 の範囲で、部分点も含めて適切に与えてください。

【出力形式（JSON厳守）】
以下のJSONのみを返すこと。説明文・前置きは一切不要。

{
  "aiFeedback": [
    {
      "id": "設問ID",
      "score": 得点（数値）,
      "correct": 合否（得点が配点の60%以上の場合はtrue、それ以外はfalse）,
      "explanation": "採点結果の詳細と、なぜその得点になったかの理由（日本語で100〜200文字）"
    }
  ],
  "sectionAdvice": "大問全体の講評やアドバイスを日本語で100文字以内で記述してください。"
}`;

      try {
        const text = await generateWithRetry(genAI, elementPrompt, imageParts, {
          generationConfig: { responseMimeType: "application/json" },
        });
        const result = JSON.parse(sanitizeJson(text));
        if (result.aiFeedback) {
          allAiFeedback.push(...result.aiFeedback);
        }
        if (result.sectionAdvice) {
          aggregatedWeakness += (aggregatedWeakness ? "\n" : "") + result.sectionAdvice;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        questions.forEach((q) => {
          allAiFeedback.push({ id: q.id, score: 0, correct: false, explanation: `【採点エラー】${msg}` });
        });
      }
    }

    // -----------------------------------------------------------------------
    // 全体アドバイスの生成
    // -----------------------------------------------------------------------
    let weaknessAnalysis = aggregatedWeakness || "全体のパフォーマンスに基づいたアドバイスがここに表示されます。";
    try {
      const holisticPrompt = `あなたはプロの受験アドバイザーです。受験生の各大問の採点結果と全体講評を元に、この試験全体に対する弱点分析と、今後の学習に向けた具体的なアドバイスを日本語で200〜400文字程度で生成してください。

【試験メタデータ】
大学名: ${examMeta.university}
学部名: ${examMeta.faculty}
科目: ${examMeta.subject}
年度: ${examMeta.year}

【各大問の採点結果】
${(allAiFeedback as Array<{ id: string; score: number; correct: boolean; explanation?: string }>)
  .map((f) => `設問${f.id}: ${f.score}点 (${f.correct ? "正解" : "不正解"})`)
  .join("\n")}

【各大問の講評】
${aggregatedWeakness}

【出力指示】
余計な解説や前置きは含めず、受験生へのアドバイス文だけを出力してください。`;

      weaknessAnalysis = (await generateWithRetry(genAI, holisticPrompt, imageParts)).trim();
    } catch (_) {
      // フォールバック
    }

    return new Response(JSON.stringify({ aiFeedback: allAiFeedback, weaknessAnalysis }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});

// -----------------------------------------------------------------------
// ヘルパー関数: explanation文字列の構築
// -----------------------------------------------------------------------
function buildEssayExplanation(result: {
  score?: number;
  breakdown?: { content_score?: number; logic_score?: number; grammar_deductions?: number; grammar_error_count?: number };
  grammar_errors?: Array<{ error?: string; correction?: string }>;
  content_elements?: Array<{ element?: string; score?: number; comment?: string }>;
  logic_level?: string;
  explanation?: string;
}): string {
  const lines: string[] = [];

  if (result.breakdown) {
    const b = result.breakdown;
    lines.push(`【得点内訳】内容: ${b.content_score ?? "-"}点 ／ 論理: ${b.logic_score ?? "-"}点 ／ 文法減点: -${b.grammar_deductions ?? 0}点 (${b.grammar_error_count ?? 0}箇所)`);
  }

  if (result.logic_level) {
    const levelMap: Record<string, string> = {
      "high": "論理構成: 非常に論理的で一貫しています。",
      "medium": "論理構成: 概ね論理的ですが、一部に飛躍があります。",
      "low": "論理構成: 論理展開に改善の余地があります。",
    };
    lines.push(levelMap[result.logic_level] ?? `論理レベル: ${result.logic_level}`);
  }

  if (result.content_elements && result.content_elements.length > 0) {
    lines.push("\n【内容要素の評価】");
    for (const el of result.content_elements) {
      const mark = el.score === 1 ? "✅" : el.score === 0.5 ? "⚠️" : "❌";
      lines.push(`${mark} ${el.element ?? ""}: ${el.comment ?? ""}`);
    }
  }

  if (result.grammar_errors && result.grammar_errors.length > 0) {
    lines.push("\n【文法エラー】");
    for (const err of result.grammar_errors.slice(0, 5)) {
      lines.push(`・${err.error ?? ""} → ${err.correction ?? ""}`);
    }
    if (result.grammar_errors.length > 5) {
      lines.push(`…他 ${result.grammar_errors.length - 5} 件`);
    }
  }

  if (result.explanation) {
    lines.push(`\n【解説】\n${result.explanation}`);
  }

  return lines.join("\n");
}

type NewEssayResult = {
  elementResults?: Array<{
    elementId: string;
    status: "full" | "partial" | "none";
    reason: string;
  }>;
  grammarErrors?: Array<{
    error: string;
    correction: string;
  }>;
  overallComment?: string;
};

function buildNewEssayExplanation(
  result: NewEssayResult,
  scoringElements: Array<{ id: string; description: string; points: number; allowPartial: boolean; type: "content" | "logic" }>,
  finalScore: number,
  totalPoints: number
): string {
  const lines: string[] = [];

  let contentSum = 0;
  let logicSum = 0;
  for (const elResult of result.elementResults || []) {
    const el = scoringElements.find(e => e.id === elResult.elementId);
    if (!el) continue;
    let score = 0;
    if (elResult.status === "full") score = el.points;
    else if (elResult.status === "partial" && el.allowPartial) score = el.points / 2;

    if (el.type === "content") contentSum += score;
    else if (el.type === "logic") logicSum += score;
  }
  const grammarCount = result.grammarErrors?.length || 0;

  lines.push(`【得点内訳】内容: ${contentSum.toFixed(1)}点 ／ 論理: ${logicSum.toFixed(1)}点 ／ 文法減点: -${grammarCount}点`);
  lines.push(`最終得点: ${finalScore.toFixed(1)} / ${totalPoints} 点`);

  lines.push("\n【要素別の採点結果】");
  for (const elResult of result.elementResults || []) {
    const el = scoringElements.find(e => e.id === elResult.elementId);
    if (!el) continue;
    const mark = elResult.status === "full" ? "✅" : elResult.status === "partial" ? "△" : "❌";
    const typeLabel = el.type === "content" ? "内容" : "論理";
    let scoreText = `${el.points}点`;
    if (elResult.status === "partial" && el.allowPartial) scoreText = `${el.points / 2}点（部分点）`;
    else if (elResult.status === "none" || (elResult.status === "partial" && !el.allowPartial)) scoreText = `0点`;

    lines.push(`${mark} [${typeLabel}] ${el.description} (${scoreText})`);
    lines.push(`   判定理由: ${elResult.reason}`);
  }

  if (result.grammarErrors && result.grammarErrors.length > 0) {
    lines.push("\n【指摘された文法エラー】");
    for (const err of result.grammarErrors.slice(0, 5)) {
      lines.push(`・${err.error} → ${err.correction}`);
    }
    if (result.grammarErrors.length > 5) {
      lines.push(`…他 ${result.grammarErrors.length - 5} 件`);
    }
  }

  if (result.overallComment) {
    lines.push(`\n【全体総評】\n${result.overallComment}`);
  }

  return lines.join("\n");
}
