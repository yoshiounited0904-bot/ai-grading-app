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

const getCorsConfig = (req: Request) => {
  const defaultAllowedOrigin = "https://smart-saiten.com,https://www.smart-saiten.com,https://ai-grading-app.vercel.app,http://127.0.0.1:5175,http://localhost:5175,http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:5173,http://localhost:5173";
  const configuredAllowedOrigin = Deno.env.get("ALLOWED_ORIGIN")?.trim();
  const allowedOrigins = (configuredAllowedOrigin && configuredAllowedOrigin !== "*" ? configuredAllowedOrigin : defaultAllowedOrigin)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestOrigin = req.headers.get("origin") ?? "";
  const allowsAnyOrigin = allowedOrigins.includes("*");
  const isAllowed = allowsAnyOrigin || (requestOrigin !== "" && allowedOrigins.includes(requestOrigin));
  const responseOrigin = allowsAnyOrigin ? "*" : (isAllowed ? requestOrigin : allowedOrigins[0] ?? "");
  return {
    headers: { ...corsHeaders, "Access-Control-Allow-Origin": responseOrigin },
    isAllowed,
  };
};

serve(async (req) => {
  const { headers, isAllowed } = getCorsConfig(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  // CORSチェック: ALLOWED_ORIGINが設定されている場合、リクエストのオリジンを検証する
  if (!isAllowed) {
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
    const { pendingAiGrading, examMeta, pdfPath, objectiveFeedback = [] } = body;

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

    const imageParts = pdfPath ? await fetchPrivatePdfAsInlineData(pdfPath) : [];
    const genAI = new GoogleGenerativeAI(apiKey);

    // ---------------------------------------------------------------
    type GradingQuestion = {
      id: string;
      originalId?: string;
      label?: string;
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
        type: 'content' | 'logic' | 'deduction' | 'force_zero' | 'character_count';
        minChars?: number | null;
        maxChars?: number | null;
        forceZeroOnFail?: boolean | null;
      }>;
    };

    const allAiFeedback: Array<{
      id: string;
      score: number;
      points?: number;
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

    const isSubstantialEssayAnswer = (value: string) => value.replace(/\s+/g, "").length >= 10;
    const isUsableEssayModelAnswer = (value: string) => {
      const text = value.trim();
      if (!text) return false;
      if (/^[0-9０-９A-Za-zＡ-Ｚａ-ｚ]{1,3}$/u.test(text)) return false;
      if (/^[-ー―—–_]+$/u.test(text)) return false;
      return text.length >= 8;
    };
    const formatAlternativeAnswers = (answers: unknown[]) => (
      Array.isArray(answers)
        ? answers.map(sanitizeUserAnswer).filter(Boolean).join(" / ") || "なし"
        : "なし"
    );
    const countEssayCharacters = (value: string) => Array.from(value.replace(/\s+/g, "")).length;
    const evaluateCharacterCountElement = (
      element: { id: string; minChars?: number | null; maxChars?: number | null },
      answer: string
    ) => {
      const count = countEssayCharacters(answer);
      const min = Number(element.minChars);
      const max = Number(element.maxChars);
      const hasMin = Number.isFinite(min) && min > 0;
      const hasMax = Number.isFinite(max) && max > 0;
      const minOk = !hasMin || count >= min;
      const maxOk = !hasMax || count <= max;
      const rangeText = hasMin && hasMax
        ? `${min}〜${max}字`
        : hasMin
          ? `${min}字以上`
          : hasMax
            ? `${max}字以内`
            : "指定なし";
      return {
        elementId: element.id,
        status: minOk && maxOk ? "full" as const : "none" as const,
        reason: `答案文字数は${count}字（空白・改行を除く）です。指定条件「${rangeText}」${minOk && maxOk ? "を満たしています。" : "を満たしていません。"}`,
      };
    };
    const extractBoundedScore = (value: unknown, totalPoints: number) => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return Math.floor(Math.max(0, Math.min(totalPoints, value)));
      }
      const text = String(value ?? "").trim();
      const ratioMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)/);
      const scoreText = ratioMatch?.[1] || text.match(/[0-9]+(?:\.[0-9]+)?/)?.[0];
      const score = scoreText ? Number(scoreText) : NaN;
      return Number.isFinite(score) ? Math.floor(Math.max(0, Math.min(totalPoints, score))) : 0;
    };
    const hasPositiveFallbackComment = (result: { explanation?: string; overallComment?: string }) => {
      const text = `${result.explanation || ""}\n${result.overallComment || ""}`;
      if (/採点不能|白紙|無関係|答えていない|極端に短い/u.test(text)) return false;
      return /高く評価|評価できます|明確|適切|丁寧|誤りが見られません|十分|満たして|分かりやす/u.test(text);
    };
    const normalizeRelevance = (result: { relevance?: unknown; offTopic?: unknown }) => {
      if (result.offTopic === true) return "unrelated";
      const relevance = String(result.relevance ?? "").trim().toLowerCase();
      if (["matches", "partial", "unrelated"].includes(relevance)) return relevance;
      return "";
    };
    const clampScoreByRelevance = (
      score: number,
      result: { relevance?: unknown; offTopic?: unknown },
      totalPoints: number
    ) => {
      const relevance = normalizeRelevance(result);
      if (relevance === "unrelated") return 0;
      if (relevance === "partial") return Math.floor(Math.min(score, totalPoints * 0.4));
      return Math.floor(score);
    };
    const buildFallbackEssayPrompt = (q: GradingQuestion, userAnswer: string, zeroScoreReview = false) => {
      const modelAnswer = sanitizeUserAnswer(q.correctAnswer);
      const hasUsableModelAnswer = isUsableEssayModelAnswer(modelAnswer);
      const displayQuestionId = sanitizeUserAnswer(q.originalId || q.label || q.id);
      return `あなたは厳格だが公正な大学入試の自由記述・英作文採点官です。詳細な採点基準が未設定または不足しているため、問題PDF・設問条件・模範解答・答案を総合して妥当な採点を行ってください。

【試験メタデータ】
大学名: ${examMeta.university}
学部名: ${examMeta.faculty}
科目: ${examMeta.subject}
年度: ${examMeta.year}

【設問情報】
設問ID: ${displayQuestionId}
内部ID: ${q.id}
総配点: ${q.points}点
模範解答: ${hasUsableModelAnswer ? modelAnswer : "未設定または番号のみ"}
別解・許容解: ${formatAlternativeAnswers(q.alternativeAnswers)}
採点基準・指示: ${q.gradingInstruction || "未設定"}

【採点ルール】
1. 最初に、答案がこの設問IDの問いに答えているかを判定してください。別の設問の正答らしい内容でも、この設問の解答になっていなければ高得点は禁止です。
2. 問題PDFがある場合は、該当設問の条件・場面・字数・指定内容を読み取り、その条件に照らして採点してください。隣接する設問や別大問の情報と取り違えないでください。
3. 模範解答が有効な場合は、模範解答と同じ内容を述べているかを最優先してください。完全一致でなくても意味内容が同等なら満点または高得点にできますが、内容が別物なら文章が上手くても低得点にしてください。
4. 模範解答が番号のみ、短すぎる、未設定の場合でも、答案が設問条件に答えていれば0点にせず、内容・構成・表現から配点内で妥当に採点してください。ただし、設問条件を特定できない場合は満点を避け、保守的に採点してください。
5. 英作文・自由記述では、主な評価軸を「設問条件への適合」「必要情報の充足」「論理・構成」「英語表現・文法」とし、必要に応じて部分点を与えてください。
6. 文法・スペル・語法ミスは指摘してください。ただし、意味が通る軽微な表現差や自然な前置詞選択だけで0点にしないでください。
7. 白紙、極端に短い答案、設問と無関係な答案は0点にしてください。設問に一部関係するが主旨がずれている答案は、原則として配点の40%以下にしてください。
8. 点数は 0 から ${q.points} の範囲で、整数または0.5点刻みで返してください。
9. scoreとexplanationは必ず整合させてください。高評価の説明を書くなら、その設問に適合している根拠を書いてください。0点にする場合は、なぜ白紙・無関係・条件不充足なのかを具体的に説明してください。
${zeroScoreReview ? `10. 再確認です。この答案は一定量の文章が書かれています。ただし、文章量や自然さだけで加点せず、この設問への答えになっている場合だけ部分点を与えてください。` : ""}

【答案】
<user_answer>
${userAnswer}
</user_answer>

【出力形式（JSON厳守）】
以下のJSONのみを返すこと。説明文・前置きは一切不要。

{
  "relevance": "matches | partial | unrelated",
  "relevanceReason": "答案がこの設問に答えているかの判定理由を日本語で具体的に書く。",
  "offTopic": 設問と無関係ならtrue、それ以外はfalse,
  "score": 得点（数値）,
  "correct": 合否（得点が配点満点以上の場合だけtrue。0点および部分点はfalse）,
  "explanation": "採点理由を日本語で120〜240文字。設問条件に対して満たせている点、足りない点、減点理由を具体的に書く。",
  "grammarErrors": [
    { "error": "<エラー箇所>", "correction": "<修正案>" }
  ],
  "overallComment": "次に直すべき点を日本語で100〜200文字記述してください。"
}`;
    };

    // [A-1] 自由記述問題（essay）の採点処理
    for (const q of essayQuestions) {
      const userAnswer = sanitizeUserAnswer(q.userAnswer);
      const scoringElements = q.scoringElements || [];
      const hasScoringElements = scoringElements.length > 0;
      const hasUsableModelAnswer = isUsableEssayModelAnswer(sanitizeUserAnswer(q.correctAnswer));

      const scoringElementsJson = JSON.stringify(scoringElements, null, 2);
      const essayPrompt = hasScoringElements
        ? `あなたは厳格な英語の採点官です。以下の答案について、指定された採点要素および文法ルールに基づいて採点を行ってください。

【試験メタデータ】
大学名: ${examMeta.university}
学部名: ${examMeta.faculty}
科目: ${examMeta.subject}
年度: ${examMeta.year}

【設問情報】
設問ID: ${sanitizeUserAnswer(q.originalId || q.label || q.id)}
内部ID: ${q.id}
総配点: ${q.points}点
模範解答: ${sanitizeUserAnswer(q.correctAnswer) || "未設定"}
別解・許容解: ${Array.isArray(q.alternativeAnswers) ? q.alternativeAnswers.map(sanitizeUserAnswer).filter(Boolean).join(" / ") || "なし" : "なし"}
採点基準・指示: ${q.gradingInstruction || "特になし"}

【採点要素（scoringElements）】
${scoringElementsJson}

【採点ルール】
1. 各採点要素（id: e1, e2, ...）について、答案が満たしているかどうかを個別に判定してください。
   ステータスは以下の3つから選択してください：
   - "full": 要素を完全に満たしている
   - "partial": 要素を部分的に満たしている（allowPartialがtrueの場合のみ選択可能。falseの場合は選択禁止）
   - "none": 要素を満たしていない（0点）
   ※各要素의 判定理由（reason）を、日本語で具体的かつ客観的に記述してください。
   ※points が正の要素は、満たした場合に加点されます。
   ※points が負の要素、または type が "deduction" の要素は、条件を満たした場合に減点されます。type が "deduction" の場合、points が正数でもシステム側ではマイナスとして扱います。
   ※type が "force_zero" の要素は、条件を満たした場合、他の要素に関係なく最終得点が強制的に0点になります。
   ※type が "character_count" の要素は、システム側で文字数を機械判定します。あなたはこの要素を採点しないでください。条件を満たした場合は設定されたpointsを加点し、forceZeroOnFailがtrueの場合は条件外で最終得点を強制的に0点にします。

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
}`
        : buildFallbackEssayPrompt(q, userAnswer);

      try {
        const text = await generateWithRetry(genAI, essayPrompt, imageParts, {
          generationConfig: { responseMimeType: "application/json" },
        });
        const result = JSON.parse(sanitizeJson(text));

        if (!hasScoringElements) {
          let finalScore = extractBoundedScore(result.score, q.points);
          let outputResult = result;
          if (finalScore === 0 && isSubstantialEssayAnswer(userAnswer) && hasPositiveFallbackComment(result)) {
            try {
              const retryText = await generateWithRetry(genAI, buildFallbackEssayPrompt(q, userAnswer, true), imageParts, {
                generationConfig: { responseMimeType: "application/json" },
              });
              const retryResult = JSON.parse(sanitizeJson(retryText));
              const retryScore = extractBoundedScore(retryResult.score, q.points);
              if (retryScore > finalScore || !hasPositiveFallbackComment(retryResult)) {
                finalScore = retryScore;
                outputResult = retryResult;
              }
            } catch (_) {
              // Keep the first fallback result if the consistency retry fails.
            }
          }
          finalScore = clampScoreByRelevance(finalScore, outputResult, q.points);
          const questionPointLimit = Math.max(0, Number(q.points) || 0);
          const correct = questionPointLimit > 0 && finalScore >= questionPointLimit;
          const explanation = buildFallbackEssayExplanation(
            outputResult,
            finalScore,
            q.points,
            sanitizeUserAnswer(q.correctAnswer)
          );

          allAiFeedback.push({
            id: q.id,
            score: finalScore,
            points: q.points,
            correct,
            explanation,
            essayResult: outputResult,
            scoringElements: [],
          });

          if (outputResult.overallComment || outputResult.explanation) {
            aggregatedWeakness += (aggregatedWeakness ? "\n" : "") + `[${q.id}] ${outputResult.overallComment || outputResult.explanation}`;
          }
          continue;
        }

        // 要素得点の計算
        const modelElementResults = Array.isArray(result.elementResults) ? result.elementResults : [];
        const mechanicalElementResults = scoringElements
          .filter((el) => el.type === "character_count")
          .map((el) => evaluateCharacterCountElement(el, userAnswer));
        result.elementResults = [
          ...modelElementResults.filter((elResult) => {
            const el = scoringElements.find((item) => item.id === elResult.elementId);
            return el?.type !== "character_count";
          }),
          ...mechanicalElementResults,
        ];

        let totalElementPoints = 0;
        let forceZeroTriggered = false;
        for (const elResult of result.elementResults || []) {
          const el = scoringElements.find(e => e.id === elResult.elementId);
          if (!el) continue;
          if (el.type === "force_zero") {
            if (elResult.status === "full") forceZeroTriggered = true;
            continue;
          }
          if (el.type === "character_count") {
            if (elResult.status === "none" && el.forceZeroOnFail !== false) {
              forceZeroTriggered = true;
            } else if (elResult.status === "full") {
              totalElementPoints += Math.max(0, Number(el.points) || 0);
            }
            continue;
          }
          const elementPoints = el.type === "deduction" ? -Math.abs(el.points) : el.points;
          if (elResult.status === "full") {
            totalElementPoints += elementPoints;
          } else if (elResult.status === "partial" && el.allowPartial) {
            totalElementPoints += elementPoints / 2;
          }
        }

        // 文法減点の計算
        const grammarErrors = result.grammarErrors || [];
        const questionPointLimit = Math.max(0, Number(q.points) || 0);
        let finalScore = forceZeroTriggered ? 0 : Math.floor(Math.max(0, Math.min(questionPointLimit, totalElementPoints - grammarErrors.length)));
        let correct = questionPointLimit > 0 && finalScore >= questionPointLimit;
        let explanation = buildNewEssayExplanation(result, scoringElements, finalScore, q.points, forceZeroTriggered);
        let outputEssayResult = result;
        let outputScoringElements: unknown = scoringElements;

        const shouldFallbackAfterZero =
          finalScore === 0 &&
          !forceZeroTriggered &&
          isSubstantialEssayAnswer(userAnswer) &&
          (!hasUsableModelAnswer || !q.gradingInstruction || totalElementPoints === 0);

        if (shouldFallbackAfterZero) {
          try {
            const fallbackText = await generateWithRetry(genAI, buildFallbackEssayPrompt(q, userAnswer), imageParts, {
              generationConfig: { responseMimeType: "application/json" },
            });
            const fallbackResult = JSON.parse(sanitizeJson(fallbackText));
            let fallbackScore = extractBoundedScore(fallbackResult.score, q.points);
            let reviewedFallbackResult = fallbackResult;

            if (fallbackScore === 0 && hasPositiveFallbackComment(fallbackResult)) {
              const retryText = await generateWithRetry(genAI, buildFallbackEssayPrompt(q, userAnswer, true), imageParts, {
                generationConfig: { responseMimeType: "application/json" },
              });
              const retryResult = JSON.parse(sanitizeJson(retryText));
              const retryScore = extractBoundedScore(retryResult.score, q.points);
              if (retryScore > fallbackScore || !hasPositiveFallbackComment(retryResult)) {
                fallbackScore = retryScore;
                reviewedFallbackResult = retryResult;
              }
            }
            fallbackScore = clampScoreByRelevance(fallbackScore, reviewedFallbackResult, q.points);

            if (fallbackScore > finalScore || !hasUsableModelAnswer || !q.gradingInstruction) {
              finalScore = fallbackScore;
              correct = questionPointLimit > 0 && fallbackScore >= questionPointLimit;
              explanation = buildFallbackEssayExplanation(
                reviewedFallbackResult,
                finalScore,
                q.points,
                sanitizeUserAnswer(q.correctAnswer)
              );
              outputEssayResult = reviewedFallbackResult;
              outputScoringElements = [];
            }
          } catch (_) {
            // Keep the original element-based result if the safety fallback fails.
          }
        }

        allAiFeedback.push({
          id: q.id,
          score: finalScore,
          points: q.points,
          correct,
          explanation,
          essayResult: outputEssayResult,
          scoringElements: outputScoringElements,
        });

        const outputComment = (outputEssayResult as { overallComment?: string; explanation?: string }).overallComment ||
          (outputEssayResult as { overallComment?: string; explanation?: string }).explanation;
        if (outputComment) {
          aggregatedWeakness += (aggregatedWeakness ? "\n" : "") + `[${q.id}] ${outputComment}`;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        allAiFeedback.push({ id: q.id, score: 0, points: q.points, correct: false, explanation: `【採点エラー】${msg}` });
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
模範解答: ${sanitizeUserAnswer(q.correctAnswer) || "未設定"}
別解・許容解: ${Array.isArray(q.alternativeAnswers) ? q.alternativeAnswers.map(sanitizeUserAnswer).filter(Boolean).join(" / ") || "なし" : "なし"}
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
      "correct": 合否（得点が配点満点以上の場合だけtrue。0点および部分点はfalse）,
      "explanation": "採点結果の詳細と、なぜその得点になったかの理由（日本語で100〜200文字）"
    }
  ],
  "sectionAdvice": "この大問で目立つ弱点を、設問ID・失点理由・次に直す観点が分かるように日本語で180〜260文字で記述してください。"
}`;

      try {
        const text = await generateWithRetry(genAI, elementPrompt, imageParts, {
          generationConfig: { responseMimeType: "application/json" },
        });
        const result = JSON.parse(sanitizeJson(text));
        if (result.aiFeedback) {
          const questionById = new Map(questions.map((q) => [String(q.id), q]));
          const normalizedFeedback = (Array.isArray(result.aiFeedback) ? result.aiFeedback : []).map((feedback: {
            id?: string;
            score?: unknown;
            explanation?: string;
          }) => {
            const question = questionById.get(String(feedback.id ?? ""));
            const pointLimit = Math.max(0, Number(question?.points) || 0);
            const score = Math.floor(Math.max(0, Math.min(pointLimit, Number(feedback.score) || 0)));
            return {
              ...feedback,
              id: String(feedback.id ?? ""),
              score,
              points: pointLimit,
              correct: pointLimit > 0 && score >= pointLimit,
              explanation: feedback.explanation || "",
            };
          });
          allAiFeedback.push(...normalizedFeedback);
        }
        if (result.sectionAdvice) {
          aggregatedWeakness += (aggregatedWeakness ? "\n" : "") + result.sectionAdvice;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        questions.forEach((q) => {
          allAiFeedback.push({ id: q.id, score: 0, points: q.points, correct: false, explanation: `【採点エラー】${msg}` });
        });
      }
    }

    // -----------------------------------------------------------------------
    // 全体アドバイスの生成
    // -----------------------------------------------------------------------
    const adviceFeedback = [
      ...(objectiveFeedback as Array<{ id: string; correct: boolean; explanation?: string; userAnswer?: unknown; correctAnswer?: unknown; points?: number }>).map((f) => ({
        id: f.id,
        score: f.correct ? (Number(f.points) || 0) : 0,
        correct: Boolean(f.correct),
        explanation: f.explanation || "",
        userAnswer: f.userAnswer,
        correctAnswer: f.correctAnswer,
        points: Number(f.points) || 0,
      })),
      ...(allAiFeedback as Array<{ id: string; score: number; points?: number; correct: boolean; explanation?: string }>),
    ];

    let weaknessAnalysis = aggregatedWeakness || "全体のパフォーマンスに基づいたアドバイスがここに表示されます。";
    try {
      const holisticPrompt = `あなたは大学入試対策に強い個別指導講師です。以下の採点結果・解説データをもとに、この答案専用の弱点分析と復習アドバイスを日本語で作成してください。

【試験メタデータ】
大学名: ${examMeta.university}
学部名: ${examMeta.faculty}
科目: ${examMeta.subject}
年度: ${examMeta.year}

【設問別の採点結果】
${adviceFeedback
  .map((f) => {
    const answerLine = f.userAnswer !== undefined || f.correctAnswer !== undefined
      ? ` / 生徒解答: ${String(f.userAnswer ?? "")} / 正解: ${String(f.correctAnswer ?? "")}`
      : "";
    return `設問${f.id}: ${f.score}${f.points ? `/${f.points}` : ""}点 (${f.correct ? "正解" : "不正解"})${answerLine}${f.explanation ? ` / 解説: ${String(f.explanation).slice(0, 160)}` : ""}`;
  })
  .join("\n")}

【各大問の講評】
${aggregatedWeakness || "主観式の個別講評はありません。客観式の正誤と解説から、弱点を推定してください。"}

【既存の詳細解説・出題内容の参考】
${String(examMeta?.detailedAnalysis || "").slice(0, 6000) || "詳細解説データはありません。設問別の採点結果と添付画像から推定してください。"}

【出力指示】
・600〜900文字程度で、薄い励ましや一般論ではなく、この答案に固有の内容を書く。
・不正解または失点した設問IDを必ず挙げ、何が原因で失点したかを具体化する。
・原因は「知識不足」「本文根拠の取り違え」「選択肢比較の甘さ」「記述の要素不足」「時間配分」などに分解する。
・復習は優先順位つきで、今日やること、次回解く時の注意点が分かるように書く。
・正解が多い場合も、点を落とした箇所や安定化すべき観点を具体化する。
・「詳しく復習しましょう」「解説を読みましょう」だけの定型文は禁止。
・見出しは次の3つだけに統一する。

【今回の弱点】
【優先して直すこと】
【次回の解き方】

余計な前置き・挨拶・結びは出力しない。`;

      weaknessAnalysis = (await generateWithRetry(genAI, holisticPrompt, imageParts)).trim();
    } catch (_) {
      // フォールバック
    }

    const flooredAiFeedback = allAiFeedback.map((item) => ({
      ...item,
      score: Math.floor(Math.max(0, Math.min(Math.max(0, Number(item.points) || 0), Number(item.score) || 0))),
      points: Math.max(0, Number(item.points) || 0),
    })).map((item) => ({
      ...item,
      correct: item.points > 0 && item.score >= item.points,
    }));

    return new Response(JSON.stringify({ aiFeedback: flooredAiFeedback, weaknessAnalysis }), {
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
  score?: number;
  correct?: boolean;
  relevance?: "matches" | "partial" | "unrelated" | string;
  relevanceReason?: string;
  offTopic?: boolean;
  explanation?: string;
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

function buildFallbackEssayExplanation(
  result: NewEssayResult,
  finalScore: number,
  totalPoints: number,
  correctAnswer: string
): string {
  const lines: string[] = [];

  lines.push(`【得点】${Math.floor(finalScore)} / ${totalPoints} 点`);
  if (correctAnswer) {
    lines.push(`【模範解答】${correctAnswer}`);
  }
  if (result.relevanceReason) {
    lines.push(`【設問適合】\n${result.relevanceReason}`);
  }
  if (result.explanation) {
    lines.push(`【採点理由】\n${result.explanation}`);
  }

  if (result.grammarErrors && result.grammarErrors.length > 0) {
    lines.push("\n【指摘された文法・表記エラー】");
    for (const err of result.grammarErrors.slice(0, 5)) {
      lines.push(`・${err.error} → ${err.correction}`);
    }
    if (result.grammarErrors.length > 5) {
      lines.push(`...他 ${result.grammarErrors.length - 5} 件`);
    }
  }

  if (result.overallComment) {
    lines.push(`\n【次に直すこと】\n${result.overallComment}`);
  }

  return lines.join("\n");
}

function buildNewEssayExplanation(
  result: NewEssayResult,
  scoringElements: Array<{ id: string; description: string; points: number; allowPartial: boolean; type: "content" | "logic" | "deduction" | "force_zero" | "character_count"; forceZeroOnFail?: boolean | null }>,
  finalScore: number,
  totalPoints: number,
  forceZeroTriggered = false
): string {
  const lines: string[] = [];

  let contentSum = 0;
  let logicSum = 0;
  let characterSum = 0;
  let deductionSum = 0;
  for (const elResult of result.elementResults || []) {
    const el = scoringElements.find(e => e.id === elResult.elementId);
    if (!el) continue;
    if (el.type === "force_zero") continue;
    const elementPoints = el.type === "deduction" ? -Math.abs(el.points) : el.points;
    let score = 0;
    if (elResult.status === "full") score = elementPoints;
    else if (elResult.status === "partial" && el.allowPartial) score = elementPoints / 2;

    if (el.type === "content") contentSum += score;
    else if (el.type === "logic") logicSum += score;
    else if (el.type === "deduction") deductionSum += score;
    else if (el.type === "character_count") characterSum += Math.max(0, score);
  }
  const grammarCount = result.grammarErrors?.length || 0;

  lines.push(`【得点内訳】内容: ${Math.floor(contentSum)}点 ／ 論理: ${Math.floor(logicSum)}点 ／ 文字数: ${Math.floor(characterSum)}点 ／ 条件減点: ${Math.floor(deductionSum)}点 ／ 文法減点: -${grammarCount}点`);
  if (forceZeroTriggered) {
    lines.push("強制0点条件に該当したため、最終得点は0点です。");
  }
  lines.push(`最終得点: ${Math.floor(finalScore)} / ${totalPoints} 点`);

  lines.push("\n【要素別の採点結果】");
  for (const elResult of result.elementResults || []) {
    const el = scoringElements.find(e => e.id === elResult.elementId);
    if (!el) continue;
    const mark = elResult.status === "full" ? "✅" : elResult.status === "partial" ? "△" : "❌";
    const typeLabel = el.type === "content" ? "内容" : el.type === "logic" ? "論理" : el.type === "character_count" ? "文字数" : el.type === "deduction" ? "減点" : "強制0点";
    const elementPoints = el.type === "deduction" ? -Math.abs(el.points) : el.points;
    let scoreText = `${elementPoints}点`;
    if (el.type === "force_zero") scoreText = elResult.status === "full" ? "強制0点" : "発動なし";
    else if (el.type === "character_count") {
      scoreText = elResult.status === "full"
        ? `条件OK${Number(el.points) ? `（+${Number(el.points)}点）` : ""}`
        : `条件外${el.forceZeroOnFail !== false ? "（強制0点）" : ""}`;
    }
    else if (elResult.status === "partial" && el.allowPartial) scoreText = `${Math.floor(elementPoints / 2)}点（部分点）`;
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
