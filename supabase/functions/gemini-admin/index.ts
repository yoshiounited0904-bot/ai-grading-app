import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";
import { corsHeaders } from "../_shared/cors.ts";

// ---------------------------------------------------------------------------
// Model list for retry/fallback
// ---------------------------------------------------------------------------
const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-pro",
  "gemini-1.5-pro",
];

// ---------------------------------------------------------------------------
// Subject-specific scoring rules (ported from adminGeminiService.js)
// ---------------------------------------------------------------------------
const ENGLISH_RULES = `
【最重要前提】
 • 採点は AIが自動で行うこと を前提とする
  • 「総合判断」「感覚的評価」は禁止
  • 配点理由は一切出力しないでください。純粋な数値データのみを生成してください。
  • 配点は 満点からの減点方式のみ を用いる

⸻

【0. 問題タイプの定義（絶対固定）】

本プロンプトでは、英語長文中の設問を以下のように定義する。
この定義は以後すべての配点設計の前提とする。

⸻

① 内容一致問題（最重要）

以下をすべて満たす問題を 内容一致問題 と定義する。
 • 選択肢が 完全な英文 である
 • 「本文全体」または「複数段落を統合した内容理解」を問う
 • 一部の語句理解では解けず、本文の論旨・主張・評価を把握していないと判断できない

※ 完全な英文とは
「主語・述語を持ち、一文として意味の不足がない英文」を指す。

⸻

② 説明問題

以下を満たす問題を 説明問題 と定義する。
 • 選択肢が 完全な英文 である
 • 傍線部説明・理由説明・言い換えなど
 • 基本的には 局所的な本文理解 に基づいて解ける

※ 本文全体の主張理解を必須としない点で、内容一致問題と区別する。

⸻

③ 非完全英文選択肢問題・長文外大問（低優先）

以下を満たす問題をまとめて、低優先問題と定義する。
 • 単語挿入問題
 • 接続詞挿入問題
 • 空所補充で、選択肢が句・語レベル
 • 主語・述語を持たず、単独では意味が完結しない選択肢
 • 長文問題以外の大問（文法・語法・発音等）

⸻

【1. 配点優先順位（絶対遵守）】

配点の重みは、必ず以下の順で高く設定せよ。
 1. 内容一致問題
 2. 説明問題
 3. 非完全英文選択肢問題・長文外大問

この優先順位を逆転させる配点設計は禁止とする。
`;

const SOCIAL_RULES = `
あなたは、大学入試の社会科目の問題において、配点設計および採点構造を運用する専門担当者である。
ただし、設問パターンの分類・配点の序列・論述の採点原理は、すでにユーザーによって厳密に定義されている。

あなたの役割は、
以下に示すユーザー定義を一切変更・補正・一般化せず、そのまま適用することである。

⸻

【0. ユーザー定義（絶対固定）】

① 設問の大分類（2種）

社会の設問は、以下の二つに大別される。
 • 選択問題：マークシート形式
 • 記述問題：受験生が自分の言葉で記入する形式

⸻

② 設問の小分類（5パターン）

A．選択問題（適当なものを1つ選択）
 • マークシート形式
 • 正解は1つ

B．選択問題（適当なものを2つ選択）
 • マークシート形式
 • 正解は2つ同時に選ばせる

C．記述問題（歴史用語）
 • 一般的な歴史用語・制度名・人物名などを答えさせる

D．論述問題（短）
 • 20字以内程度の短文論述
 • 限定された因果・理由・意義を簡潔に述べさせる

E．論述問題（長）
 • 30字以上の論述
 • 複数要素を含む説明・因果関係の整理が必要

⸻

③ 配点の序列（小 → 大）

配点は、必ず以下の順序関係を保つこと。
 1. 選択問題（適当なもの1つ選択）
 2. 記述問題（歴史用語）
 3. 選択問題（適当なもの2つ選択）
 4. 論述問題（短）
 5. 論述問題（長）

※ この大小関係は絶対に逆転させてはならない

⸻

④ 論述問題の採点原理（固定）

論述問題は、以下の原理で採点される。
 • 模範回答は、あらかじめ複数の**「要素」**に分解される
 • 各要素は同価値とする
 • 回答に含まれた要素の数に応じて、比例配点を行う

例：
 • 要素が3つある論述問題
 • 回答が2要素のみ満たしている場合
→ 得点は満点の 3分の2

※ 表現の巧拙は評価対象としない
※ 要素充足のみを基準とする

【2. 内部実行ルール（出力しないが必ず実行）】

2-1. 設問分類

・各設問を、上記A〜Eのいずれかに必ず分類する
・複数該当しそうな場合でも、最も厳密に当てはまる1つのみを採用
・新たな設問タイプの創設は禁止

⸻

2-2. 配点割当

・配点は、
　③で定義された序列を絶対条件として割り振る

・同一タイプ内で複数設問がある場合のみ、以下を考慮して微調整してよい：
　- 必要な知識量
　- 思考の段階数
　- 論述であれば要素数

※ ただし、
　タイプ間の配点逆転は禁止

⸻

2-3. 論述問題の要素設計

・論述問題については、必ず：
　- 模範回答を要素に分解
　- 要素数を明示

・採点は、
　要素充足率＝得点率
　として扱う

⸻

【3. 出力形式（厳守）】

以下の順序で出力する。

⸻

① 設問一覧と分類
	•	設問番号
	•	設問内容（簡潔）
	•	A〜Eのどれに該当するか

⸻

② 配点一覧
	•	設問番号
	•	設問タイプ
	•	配点

⸻

③ 配点理由

各設問について、
ユーザー定義の序列を主語にして
なぜこの配点になっているかを文章で説明する。

⸻

④ 論述問題の採点設計（該当する場合）
	•	各論述問題の要素分解
	•	要素数
	•	満点時の要素充足条件

⸻

⑤ 全体チェック
	•	配点の大小関係が定義通り守られているか
	•	論述が最も得点差を生む構造になっているか

⸻

【4. 禁止事項】

・設問パターンの再分類
・配点序列への異議・一般論の挿入
・「実際の入試では〜」といった相対化
・表現力・日本語のうまさを採点基準に含めること
`;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const sanitizeJson = (jsonString: string): string => {
  if (!jsonString) return "";
  let clean = jsonString.trim();

  const firstBrace = clean.indexOf("{");
  const firstBracket = clean.indexOf("[");
  let startIndex = -1;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
  }
  if (startIndex !== -1) {
    const lastBrace = clean.lastIndexOf("}");
    const lastBracket = clean.lastIndexOf("]");
    const endIndex = lastBrace > lastBracket ? lastBrace : lastBracket;
    if (endIndex !== -1 && endIndex > startIndex) {
      clean = clean.substring(startIndex, endIndex + 1);
    }
  }

  clean = clean.replace(/```json/g, "").replace(/```/g, "").trim();
  clean = clean.replace(/,\s*$/g, "");
  clean = clean.replace(/,\s*([\}\]])/g, "$1");

  const quoteCount = (clean.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) clean += '"';

  const stack: string[] = [];
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === "}" && stack[stack.length - 1] === "}") stack.pop();
    else if (char === "]" && stack[stack.length - 1] === "]") stack.pop();
  }
  while (stack.length > 0) clean += stack.pop();
  return clean;
};

// Retry/fallback across MODELS list (mirrors client-side generateContentWithFallback)
const generateContentWithFallback = async (
  genAI: GoogleGenerativeAI,
  requestData: unknown,
  maxRetriesPerModel = 5,
  initialDelay = 5000,
  customModelList: string[] | null = null,
): Promise<{ response: { text: () => string } }> => {
  const errors: Array<{ model: string; error: Error }> = [];
  const modelList = customModelList || MODELS;
  for (const modelName of modelList) {
    const model = genAI.getGenerativeModel({ model: modelName });
    let attempt = 0;
    while (attempt < maxRetriesPerModel) {
      try {
        // deno-lint-ignore no-explicit-any
        const result = await (model as any).generateContent(requestData);
        return result;
      } catch (error: unknown) {
        const err = error as Error & { status?: number; response?: unknown };
        if (err.message?.includes("MAX_TOKENS") || err.message?.includes("finishReason: MAX_TOKENS")) {
          if (err.response) return err.response as { response: { text: () => string } };
        }
        attempt++;
        const isRetryable =
          err.status === 429 || err.status === 503 || err.status === 504 ||
          err.message?.includes("429") || err.message?.includes("503") ||
          err.message?.includes("Resource exhausted") ||
          err.message?.includes("Too many requests") ||
          err.message?.includes("overloaded") ||
          err.message?.includes("high demand") ||
          err.message?.includes("Load failed") ||
          err.message?.includes("fetch");
        if (isRetryable && attempt < maxRetriesPerModel) {
          const delay = Math.min(30000, initialDelay * Math.pow(2, attempt - 1));
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        errors.push({ model: modelName, error: err });
        break;
      }
    }
  }
  if (errors.length > 0) {
    const primary = errors[0].error;
    primary.message = `[All Fallback Models Failed] Primary Error: ${primary.message}`;
    throw primary;
  }
  throw new Error("Unknown error in generateContentWithFallback: All models failed.");
};

// Convert filesData array ({ data, mimeType }[]) to Gemini inlineData parts
const toImageParts = (filesData: Array<{ data: string; mimeType: string }>) =>
  filesData.map((fd) => ({ inlineData: { data: fd.data, mimeType: fd.mimeType } }));

// ---------------------------------------------------------------------------
// CORS / origin helper
// ---------------------------------------------------------------------------
const getAllowedOrigin = () => Deno.env.get("ALLOWED_ORIGIN") ?? "*";

// ---------------------------------------------------------------------------
// Operation handlers
// ---------------------------------------------------------------------------

async function handleExtractMetadata(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  if (questionFilesData.length === 0) throw new Error("問題PDFがありません。");

  const qInlineData = toImageParts(questionFilesData);

  const prompt = `
あなたは大学入試問題のメタデータ抽出担当です。
提供された問題PDFまたは画像から、試験の基本情報をできるだけ正確に抽出してください。

【抽出対象】
1. university: 大学名（例: 早稲田大学）
2. faculty: 学部名（例: 文学部）
3. year: 年度（西暦4桁。見つからない場合は null）
4. subject: 画面表示用の科目名（例: 英語、日本史、数学）
5. subject_en: 内部用科目ID。必ず以下のいずれかにすること
   - english
   - japanese_history
   - world_history
   - social
   - math
   - japanese
   - science
6. max_score: 満点（整数。見つからない場合は null）
7. duration_minutes: 制限時間（分。見つからない場合は null）

【科目IDの分類ルール】
- 英語、英文読解、英作文、リスニングなど → english
- 日本史 → japanese_history
- 世界史 → world_history
- 地理、政治経済、倫理、現代社会など → social
- 数学I/A、II/B、III/Cなど → math
- 現代文、古文、漢文、国語総合など → japanese
- 物理、化学、生物、地学など → science

【重要ルール】
- 推測しすぎず、見つからない項目は null にすること
- 年度は必ず西暦4桁で返すこと
- 科目名は日本語で返すこと
- 学部名が学科名まで含んでいる場合は、そのまま返してよい
- JSONオブジェクト1つのみを返すこと。コードブロックや説明文は禁止

【出力形式】
{
  "university": "大学名 or null",
  "faculty": "学部名 or null",
  "year": 2025,
  "subject": "英語",
  "subject_en": "english",
  "max_score": 100,
  "duration_minutes": 90
}
`;

  const result = await generateContentWithFallback(genAI, {
    contents: [{ role: "user", parts: [...qInlineData, { text: prompt }] }],
    generationConfig: { maxOutputTokens: 2048 },
  }, 5, 4000);

  const parsed = JSON.parse(sanitizeJson(result.response.text()));
  return {
    university: typeof parsed.university === "string" ? parsed.university.trim() : "",
    faculty: typeof parsed.faculty === "string" ? parsed.faculty.trim() : "",
    year: Number.isInteger(parsed.year) ? parsed.year : null,
    subject: typeof parsed.subject === "string" ? parsed.subject.trim() : "",
    subject_en: typeof parsed.subject_en === "string" ? parsed.subject_en.trim() : "",
    max_score: Number.isInteger(parsed.max_score) ? parsed.max_score : null,
    duration_minutes: Number.isInteger(parsed.duration_minutes) ? parsed.duration_minutes : null,
  };
}

async function handleGenerateMasterData(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const subjectType = body.subjectType as string;
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  // questionFilesBySection / answerFilesBySection: already base64 { data, mimeType }[]
  const questionFilesBySection = (body.questionFilesBySection as Record<string, Array<{ data: string; mimeType: string }>>) || {};
  const answerFilesBySection = (body.answerFilesBySection as Record<string, Array<{ data: string; mimeType: string }>>) || {};
  const sectionInstructionsBySection = (body.sectionInstructionsBySection as Record<string, string>) || {};
  const sectionPointsBySection = (body.sectionPointsBySection as Record<string, number | null>) || {};
  const extraInfo = (body.extraInfo as Record<string, unknown>) || {};

  const maxScore = (extraInfo?.maxScore as number) || 100;
  const isEnglish = subjectType === "english";
  const isSocial = ["social", "japanese_history", "world_history"].includes(subjectType);

  let subjectSpecificRules = "";
  if (isEnglish) {
    subjectSpecificRules = ENGLISH_RULES + `
※ 重要: 本システムでは最終出力として必ず指定された JSON 形式が必要です。
思考プロセスや配点理由などのテキストは一切出力せず、純粋なJSONのみを返してください。
さらに、【最重要事項】として、計算されたすべての小問配点の合計が、入力として指定された満点（${maxScore}点）と完全に一致するように調整してください。
`;
  } else if (isSocial) {
    subjectSpecificRules = SOCIAL_RULES + `
※ 重要: 本システムでは最終出力として必ず指定された JSON 形式が必要です。
思考プロセスや配点理由などのテキストは一切出力せず、純粋なJSONのみを返してください。
さらに、【最重要事項】として、計算されたすべての小問配点の合計が、入力として指定された満点（${maxScore}点）と完全に一致するように調整してください。
`;
  } else {
    subjectSpecificRules = `
一般的な科目として、設問の難易度や形式に応じて常識的な配点を行ってください。
ただし、以下の条件を必ず守ること：
1. 最終的な合計点は全体で指定された満点（${maxScore}）と一致するよう調整すること。
2. 特定の1問に10点以上の異常に高い配点を割り振らないこと。極端な偏りを防ぎ、問題数に応じて自然に点数を分散させること。
`;
  }

  // Stage 0: Common OCR
  let commonQuestionText = "";
  if (questionFilesData.length > 0) {
    const qInlineData = toImageParts(questionFilesData);
    const qOcrPrompt = `提供された問題用紙の画像を正確にテキスト化してください。`;
    const qOcrResult = await generateContentWithFallback(genAI, {
      contents: [{ role: "user", parts: [...qInlineData, { text: qOcrPrompt }] }],
      generationConfig: { maxOutputTokens: 8192 },
    });
    commonQuestionText = qOcrResult.response.text();
  }

  // Stage 1: Per-section processing
  const extractedSections: unknown[] = [];
  const sectionsCount = Object.keys(answerFilesBySection).length;

  for (const [sectionIndex, rawAnswerFilesData] of Object.entries(answerFilesBySection)) {
    if (!rawAnswerFilesData || rawAnswerFilesData.length === 0) continue;
    console.log(`[Stage 1] Processing section ${sectionIndex} / ${sectionsCount}...`);

    const aInlineData = toImageParts(rawAnswerFilesData);
    const rawQuestionFilesData = questionFilesBySection[sectionIndex] || [];
    const qInlineData = toImageParts(rawQuestionFilesData);
    const sectionInstruction = sectionInstructionsBySection[sectionIndex] || "";

    const extractPrompt = `
あなたは大学入試の専門家です。提供された画像（問題用紙および解答用紙）を詳細に分析し、**第${sectionIndex}問**に関する設問構造と正解を抽出してください。

【入力素材】
・添付画像のうち、解答が含まれるものを読み取ってください。
・添付画像のうち、問題が含まれるものを読み取り、解答と紐付けてください。
${commonQuestionText ? `・参考用共通テキスト: ${commonQuestionText.substring(0, 500)}...` : ""}

${sectionInstruction ? `【個別指示】\n${sectionInstruction}\n` : ""}

【抽出条件と厳格ルール】
1. この大問（第${sectionIndex}問）の中に含まれる小問を全て抽出すること。
2. アスタリスク（*）記号を絶対に使用しないでください。
3. 以下のJSON構造（オブジェクト1つ）のみを出力してください（コードブロックなし）。
4. 選択問題の \`options\` 配列には、記号・番号（例: "1", "a", "ア" など）のみを含めてください。
5. 全ての小問の \`points\` は 0 に設定してください。
6. 全ての小問の \`explanation\` は必ず空文字 ("") に設定し、解説文は一切生成しないでください。
7. 画像からテキストを読み取る際は、誤字脱字に注意し、正確に抽出してください。

【出力構造】
{
  "id": "${sectionIndex}",
  "label": "第${sectionIndex}問",
  "allocatedPoints": 0,
  "questions": [
    {
      "id": "小問ID",
      "label": "小問ラベル",
      "type": "selection",
      "options": ["a", "b", "c", "d"],
      "correctAnswer": "正解",
      "points": 0,
      "explanation": ""
    }
  ]
}
`;

    const extractResult = await generateContentWithFallback(genAI, {
      contents: [{ role: "user", parts: [...qInlineData, ...aInlineData, { text: extractPrompt }] }],
      generationConfig: { maxOutputTokens: 16384 },
    }, 5, 4000);

    const sectionRaw = extractResult.response.text();
    const parsedSection = JSON.parse(sanitizeJson(sectionRaw)) as Record<string, unknown>;
    if (!parsedSection.sectionAnalysis) parsedSection.sectionAnalysis = "";
    extractedSections.push(parsedSection);
  }

  // Stage 2: Points allocation
  const pointsPrompt = `
以下の試験マスターデータは、すべての設問と正解を抽出したものですが、配点（points）が全て0になっています。
科目別の厳格なルールに基づいて、各大問(allocatedPoints)および各小問(points)に適切な点数を割り当ててください。

【配点条件】
${sectionPointsBySection && Object.keys(sectionPointsBySection).some((k) => sectionPointsBySection[k])
    ? "【大問の目標配点（絶対遵守）】\n各大問の `allocatedPoints` を以下の通り固定し、小問の `points` 合計がぴったりその値になるように割り振ってください。\n" +
      Object.entries(sectionPointsBySection).filter(([, v]) => v).map(([k, v]) => `・第${k}問: ${v}点`).join("\n") + "\n"
    : ""}1. 小問の \`points\` の合計が \`allocatedPoints\` になり、全大問の \`allocatedPoints\` の合計が必ず **${maxScore}** 点になること。
2. すべての \`points\` と \`allocatedPoints\` は、必ず1以上の自然数（1, 2, 3...）にすること。小数点や「0点」は絶対に使用しないこと。
3. これまでに抽出された id, label, type, options, correctAnswer 等の構造は**一切変更してはいけません**。配点数値のみを更新してください。
${subjectSpecificRules}

【対象データ】
${JSON.stringify(extractedSections, null, 2)}

【出力要件】
1. 配点（points / allocatedPoints）を正しい数値で埋めた同じJSON構造の配列（リスト）のみを出力してください。
2. これまでに抽出された id, label, type, options, correctAnswer 等の構造は一切変更してはいけません。
3. 思考プロセスや配点理由などのテキスト解説は一切含めないでください。
`;

  const pointsResult = await generateContentWithFallback(genAI, {
    contents: [{ role: "user", parts: [{ text: pointsPrompt }] }],
    generationConfig: { maxOutputTokens: 16384 },
  });

  let fullSections = extractedSections;
  try {
    fullSections = JSON.parse(sanitizeJson(pointsResult.response.text()));
  } catch (_) {
    console.error("Failed to parse points allocation; using 0 fallback.");
  }

  const detailedAnalysis = "第1問から各設問の「再生成」ボタンを押して解説を生成してください。";

  const firstQFile = (questionFilesData[0] as { name?: string } | undefined);
  const finalJson = {
    id: extraInfo.id,
    university: extraInfo.university || "大学名",
    university_id: extraInfo.universityId || 0,
    faculty: extraInfo.faculty || "学部名",
    faculty_id: extraInfo.facultyId || "faculty",
    year: extraInfo.year || 2025,
    subject: extraInfo.subject || "科目名",
    subject_en: subjectType,
    type: "pdf",
    pdf_path: `/exam_data/${firstQFile?.name || "unknown"}`,
    max_score: maxScore,
    detailed_analysis: detailedAnalysis,
    structure: fullSections,
  };

  return finalJson;
}

async function handleRegenerateExplanation(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const questionData = body.questionData;
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  const answerFilesData = (body.answerFilesData as Array<{ data: string; mimeType: string }>) || [];

  const imageParts = [...toImageParts(questionFilesData), ...toImageParts(answerFilesData)];

  const prompt = `あなたは大学入試の専門講師です。
以下の設問について、【必ず2〜3文以内】の簡潔な解説を作成してください。

【対象の設問（構造データ）】
${JSON.stringify(questionData, null, 2)}

【絶対厳守のルール】
1. 文章は【2〜3文以内】に収めること。これを超えることは絶対に禁止です。
2. 「なぜ正解か」の根拠を本文の具体的な箇所（第◯段落など）を挙げて簡潔に説明すること。
3. 主要な誤答選択肢がなぜ間違いかを1文で触れること。
4. アスタリスク（*）などの記号による装飾は一切使用しないこと。

出力は解説本文のみ（プレーンテキスト）を返してください。
`;

  const result = await generateContentWithFallback(genAI, {
    contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
    generationConfig: { maxOutputTokens: 32768 },
  });

  return result.response.text().replace(/```markdown\n?|```\n?|```/g, "").replace(/\*/g, "").trim();
}

async function handleRegenerateAnalysis(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const subjectType = body.subjectType as string;
  const examData = body.examData as Record<string, unknown>;
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  const answerFilesData = (body.answerFilesData as Array<{ data: string; mimeType: string }>) || [];

  const imageParts = [...toImageParts(questionFilesData), ...toImageParts(answerFilesData)];

  const prompt = `あなたは大学入試の専門講師です。
提供された問題と解答のファイル、および試験データ構造をもとに、この試験の「全体講評（レビュー）」を作成してください。
※個別の問題の解き方（詳細な解説）は不要です。試験全体の傾向や難易度、対策に焦点を当ててください。

【試験データ構造】
${JSON.stringify({ maxScore: examData.max_score, structure: examData.structure }, null, 2)}

【記述要件】
以下の構成（見出し）で、受験生に向けた実践的な講評を作成してください。
■ 全体総評（全体の難易度、時間配分の厳しさなど）
■ 大問ごとの傾向と分析（各大問の特徴、出題形式、差がつくポイントなど）
■ 合格へのアドバイス・今後の対策（この大学・学部を志望する受験生が今後どのような勉強をすべきか）

【厳格ルール】
- アスタリスク（*）記号は一切使用禁止。見出し・強調には「■」「【】」などの記号を用いること（HTMLタグも不要）。
- コードブロック表記(\`\`\`markdown など)で全体を囲まないこと。本文のみを出力すること。
- 必ず日本語で記述すること。
- 丁寧で励みになる口調（〜です・〜ます調）で記述すること。
`;

  const result = await generateContentWithFallback(genAI, {
    contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
    generationConfig: { maxOutputTokens: 65536 },
  });

  return result.response.text().replace(/```markdown\n?|```\n?|```/g, "").replace(/\*/g, "").trim();
}

async function handleRegeneratePoints(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const subjectType = body.subjectType as string;
  const examData = body.examData as Record<string, unknown>;
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  const answerFilesData = (body.answerFilesData as Array<{ data: string; mimeType: string }>) || [];
  const sectionPointsBySection = (body.sectionPointsBySection as Record<string, number | null>) || {};

  const isEnglish = subjectType === "english";
  const isSocial = ["social", "japanese_history", "world_history"].includes(subjectType);
  const maxScore = parseInt(String(examData.max_score)) || 100;

  let subjectSpecificRules = "";
  if (isEnglish) {
    subjectSpecificRules = ENGLISH_RULES + `
※ 重要: 本システムでは最終出力として必ず JSON フォーマットが必要です。
この厳密なルールに基づいて配点（points）を再計算し、JSONの各設問の配点データに反映してください。文章等での回答は不要であり、純粋なJSONのみを返してください。
さらに、【最重要事項】として、再計算後のすべての小問の \`points\` の合計が、必ず指定された満点（${maxScore}点）と完全に一致するように調整してください。
`;
  } else if (isSocial) {
    subjectSpecificRules = SOCIAL_RULES + `
※ 重要: 本システムでは最終出力として必ず JSON フォーマットが必要です。
この厳密なルールに基づいて配点（points）を再計算し、JSONの各設問の配点データに反映してください。文章等での回答は不要であり、純粋なJSONのみを返してください。
さらに、【最重要事項】として、再計算後のすべての小問の \`points\` の合計が、必ず指定された満点（${maxScore}点）と完全に一致するように調整してください。
`;
  } else {
    subjectSpecificRules = `
一般的な科目として、設問の難易度や形式に応じて常識的な配点を行ってください。
ただし、以下の条件を必ず守ること：
1. 最終的な合計点は全体で指定された満点（maxScore）と一致するよう調整すること。
2. 特定の1問に10点以上の異常に高い配点を割り振らないこと。極端な偏りを防ぎ、問題数に応じて自然に点数を分散させること。
`;
  }

  const imageParts = [...toImageParts(questionFilesData), ...toImageParts(answerFilesData)];

  const structure = (examData.structure as Array<Record<string, unknown>>) || [];
  const currentStructure = structure.map((sec) => {
    const sectionNum = parseInt(String(sec.id));
    const targetPoints = sectionPointsBySection[sectionNum] ? parseInt(String(sectionPointsBySection[sectionNum])) : (parseInt(String(sec.allocatedPoints)) || null);
    return {
      id: sec.id,
      label: sec.label,
      allocatedPoints: targetPoints || 0,
      questions: (sec.questions as Array<Record<string, unknown>>).map((q) => ({
        id: q.id,
        label: q.label,
        type: q.type,
        options: q.options,
        correctAnswer: q.correctAnswer,
        points: parseInt(String(q.points)) || 0,
      })),
    };
  });

  const hasSectionTargets = currentStructure.some((sec) => sec.allocatedPoints > 0);
  const sectionTargetRules = hasSectionTargets
    ? `【大問ごとの目標配点（絶対遵守）】\n各大問の \`allocatedPoints\` を以下の通り固定し、小問の \`points\` 合計がぴったりその値になるように割り振ること。\n` +
      currentStructure.filter((sec) => sec.allocatedPoints > 0).map((sec) => `・${sec.label}: ${sec.allocatedPoints}点`).join("\n") + "\n"
    : "";

  const prompt = `あなたは大学入試の配点設計の専門家です。
現在入力されている試験の大問・小問構造データに対し、以下の【厳格ルール】に従って「配点（points）」だけを再計算し、更新されたJSON構造を返してください。既存の設問の定義（id, label, type, etc...）や並び順は一切変更せず、大問・小問の構造を完全に維持したまま返してください。

【厳格ルール】
${sectionTargetRules}${subjectSpecificRules}
3. 再計算後のすべての大問・小問の \`points\` の合計が、必ず指定された満点（${maxScore}点）と完全に一致するように調整してください。
4. すべての小問の \`points\` および大問の \`allocatedPoints\` は、必ず1以上の自然数（1, 2, 3...）にすること。小数点や「0点」は絶対に使用しないでください。
5. JSONのみを出力してください。Markdownのコードブロック（\`\`\`json など）は除外し、純粋なJSON文字列だけにすること。

【現在の構造データ（修正前）】
${JSON.stringify(currentStructure, null, 2)}
`;

  const result = await generateContentWithFallback(genAI, {
    contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
    generationConfig: { maxOutputTokens: 16384 },
  });

  let newStructure: Array<Record<string, unknown>>;
  try {
    newStructure = JSON.parse(sanitizeJson(result.response.text()));
  } catch (_) {
    throw new Error("配点の再生成結果（JSON）のパースに失敗しました。");
  }

  // Normalize points (same logic as client-side)
  const normalizeSectionPoints = (questions: Array<Record<string, unknown>>, sectionTarget: number) => {
    let secTotal = questions.reduce((sum, q) => sum + (parseInt(String(q.points)) || 0), 0);
    if (secTotal === sectionTarget || secTotal === 0) return;
    const ratio = sectionTarget / secTotal;
    let newSecTotal = 0;
    questions.forEach((q) => {
      q.points = Math.max(1, Math.round((parseInt(String(q.points)) || 0) * ratio));
      newSecTotal += q.points as number;
    });
    let diff = sectionTarget - newSecTotal;
    const sorted = [...questions].sort((a, b) => (b.points as number) - (a.points as number));
    let i = 0, guard = 0;
    while (diff > 0 && guard++ < 1000) { (sorted[i++ % sorted.length].points as number); sorted[i++ % sorted.length].points = (sorted[(i - 1) % sorted.length].points as number) + 1; diff--; }
    i = 0; guard = 0;
    while (diff < 0 && guard++ < 1000) {
      if ((sorted[i % sorted.length].points as number) > 1) { sorted[i % sorted.length].points = (sorted[i % sorted.length].points as number) - 1; diff++; }
      i++;
    }
  };

  newStructure.forEach((sec, secIdx) => {
    const origSec = currentStructure[secIdx];
    const target = origSec?.allocatedPoints ? parseInt(String(origSec.allocatedPoints)) : 0;
    if (target > 0 && (sec.questions as Array<Record<string, unknown>>)?.length > 0) {
      normalizeSectionPoints(sec.questions as Array<Record<string, unknown>>, target);
      sec.allocatedPoints = target;
    }
  });

  let currentTotal = 0;
  newStructure.forEach((sec) =>
    (sec.questions as Array<Record<string, unknown>>).forEach((q) => { currentTotal += parseInt(String(q.points)) || 0; })
  );

  if (currentTotal > 0 && currentTotal !== maxScore) {
    const allQs: Array<Record<string, unknown>> = [];
    newStructure.forEach((sec) => (sec.questions as Array<Record<string, unknown>>).forEach((q) => allQs.push(q)));
    const ratio = maxScore / currentTotal;
    let newTotal = 0;
    allQs.forEach((q) => { q.points = Math.max(1, Math.round((parseInt(String(q.points)) || 0) * ratio)); newTotal += q.points as number; });
    let diff = maxScore - newTotal;
    const sorted = [...allQs].sort((a, b) => (b.points as number) - (a.points as number));
    let i = 0, guard = 0;
    while (diff > 0 && guard++ < 1000) { sorted[i++ % sorted.length].points = (sorted[(i - 1 + sorted.length) % sorted.length].points as number) + 1; diff--; }
    i = 0; guard = 0;
    while (diff < 0 && guard++ < 1000) {
      if ((sorted[i % sorted.length].points as number) > 1) { sorted[i % sorted.length].points = (sorted[i % sorted.length].points as number) - 1; diff++; }
      i++;
    }
  }

  // Merge back into original structure
  const mergedStructure = structure.map((origSec, secIdx) => {
    const newSec = newStructure[secIdx] || origSec;
    return {
      ...origSec,
      sectionAnalysis: (newSec.sectionAnalysis as string) || (origSec.sectionAnalysis as string) || "",
      questions: (origSec.questions as Array<Record<string, unknown>>).map((origQ, qIdx) => {
        const newQ = (newSec.questions as Array<Record<string, unknown>>)?.[qIdx];
        return { ...origQ, points: newQ ? newQ.points : origQ.points };
      }),
    };
  });

  return mergedStructure;
}

async function handleGenerateSectionAnalysis(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const subjectType = body.subjectType as string;
  const sectionData = body.sectionData as Record<string, unknown>;
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  const answerFilesData = (body.answerFilesData as Array<{ data: string; mimeType: string }>) || [];
  const specialInstruction = (body.specialInstruction as string) || "";
  const subjectName = (body.subjectName as string) || "";

  const imageParts = [...toImageParts(questionFilesData), ...toImageParts(answerFilesData)];

  const questionType = (sectionData.questionType as string) || "default";
  let basePrompt = "";

  if (subjectType === "japanese_history" || (subjectType === "social" && subjectName && subjectName.includes("日本史"))) {
    basePrompt = `あなたは難関大学（早慶レベル）の日本史問題を解説する専門講師である。

最優先目的は「誤情報を出さないこと」であり、
知識の網羅性よりも正確性を優先する。

【前提】

外部の特定教材やデータベースは参照しない。
そのため、出力内容は厳密に制限する。

【最重要ルール】

① 問題文・選択肢・資料から論理的に導ける内容を最優先する

② 使用する知識は「高校日本史教科書レベルで確実に一般化されているもの」に限定する

③ 不要な知識拡張は禁止する

④ 日本史では、必ず以下の4点を確認する

・時代
・政治権力
・制度
・社会的背景

⑤ 時代・人物・制度・文化を混同しないことを最優先する

【知識使用制約】

以下の条件をすべて満たす場合のみ知識を使用してよい。

・高校日本史の基本事項として広く知られている
・早慶レベルで頻出である
・1〜2行で簡潔に説明できる
・問題の解答に直接必要である

以下は禁止する。

・細かい年号
・マイナー人物
・例外事例
・研究レベルの知識
・雑学的エピソード
・問題に直接関係しない知識展開
・日本史用語集のような羅列

【日本史特有の注意点】

日本史では、
単発暗記ではなく、
「政治構造」「土地制度」「支配構造」「社会変化」の流れを重視する。

特に以下の混同を避けること。

・時代ズレ
例：
奈良時代と平安時代、
室町時代と戦国時代、
明治と大正などの混同

・政治権力ズレ
例：
天皇・摂関家・院・幕府・藩・政府の役割混同

・制度ズレ
例：
班田収授法・荘園公領制・幕藩体制・地租改正などの混同

・文化ズレ
例：
国風文化・北山文化・化政文化などの混同

・外交ズレ
例：
遣唐使・勘合貿易・鎖国・開国体制の混同

・改革ズレ
例：
享保・寛政・天保改革の混同

【因果関係ルール】

・因果関係は最大3ステップまでとする

・明確に教科書レベルで成立する関係のみ使用する

・因果が曖昧な場合は接続しない

・因果関係を説明する場合は、
必ず以下の形に限定する。

「AによってBが起こり、その結果Cにつながる」

ただし、
A・B・Cのいずれかが教科書レベルで確実でない場合は説明しない。

【解説方針】

長文解説とするが、
情報量を無理に増やすのではなく、
既知情報を分解して丁寧に説明する。

解説の厚みは、以下の要素で出す。

・用語の定義
・時代背景
・政治構造
・社会構造
・制度の目的
・因果関係
・設問処理
・誤答分析
・同型問題への応用

【出力順】

以下の順番を必ず守る。

① 解答

② 問題の論点整理

③ 解答に必要な知識の提示

④ 解答プロセス

⑤ 誤答分析

⑥ 周辺知識（※条件付き）

⑦ 同型問題への応用

【各項目の出力ルール】

① 解答

・正解のみを簡潔に示す
・理由はここでは書かない
・ユーザー指定の正解がある場合はそれを前提にする

② 問題の論点整理

この問題が何を問うているかを整理する。

必ず以下を確認する。

・どの時代の問題か
・どの政治権力の問題か
・どの制度の問題か
・どのテーマの問題か

③ 解答に必要な知識の提示

解答に必要な知識だけを提示する。

・1項目につき1〜2行で説明する
・問題に不要な知識は出さない
・細かい年号は出さない

④ 解答プロセス

問題文・資料・選択肢をもとに、
どのように正解へ到達するかを説明する。

⑤ 誤答分析

誤答選択肢について、
なぜ誤りなのかを説明する。

⑥ 周辺知識（※条件付き）

周辺知識は、
以下の条件をすべて満たす場合のみ扱う。

・問題テーマと直接関係する
・同型問題で再利用できる
・高校日本史教科書レベルで確実である
・新しい論点を追加しない

⑦ 同型問題への応用

最後に、
この問題と同じタイプの問題を解く際の考え方を示す。

【禁止事項】

・曖昧な一般論
・知識の穴埋め
・推測による補完
・問題に無関係な知識展開
・冗長な説明
・細かすぎる年号の羅列
・用語集的な羅列
・人物だけで歴史を説明すること
・制度を切り離して説明すること
・因果関係を広げすぎること
・「覚えていれば解ける」で済ませること

【内部検証（必須）】

出力前に以下を必ず確認する。

1.
問題から逸脱していないか

2.
一般的教科書レベルを超えていないか

3.
因果関係に飛躍がないか

4.
誤答分析が問題文・選択肢・知識と整合しているか

5.
時代・人物・制度・文化を混同していないか

6.
周辺知識が問題テーマと直接関係しているか

7.
早慶レベルの受験生が再現できる解法になっているか`;
  } else if (subjectType === "world_history" || (subjectType === "social" && subjectName && subjectName.includes("世界史"))) {
    basePrompt = `あなたは難関大学（早慶レベル）の世界史問題を解説する専門講師である。
最優先目的は「誤情報を出さないこと」であり、
知識の網羅性よりも正確性を優先する。

【前提】

外部の特定教材やデータベースは参照しない。
そのため、出力内容は厳密に制限する。

【最重要ルール】

① 問題文・選択肢・資料から論理的に導ける内容を最優先する

② 使用する知識は「高校世界史教科書レベルで確実に一般化されているもの」に限定する

③ 不要な知識拡張は禁止

④ 世界史では、必ず以下の4点を確認する

・時代
・地域
・国家／王朝／勢力
・宗教／思想／交易圏

⑤ 年代・地域・王朝・人物・制度を混同しないことを最優先する

【知識使用制約】

以下の条件をすべて満たす場合のみ知識を使用してよい。

・世界史の基本事項として広く知られている
・早慶レベルで頻出の内容である
・1〜2行で簡潔に説明できる
・問題の解答に直接必要である

以下は禁止する。

・細かい年号
・マイナー人物
・例外事例
・研究レベルの知識
・エピソード・雑学
・問題に直接関係しない地域への展開
・世界史用語集的な知識羅列

【禁止事項】

・曖昧な一般論
・知識の穴埋め
・推測による補完
- 問題に無関係な知識展開
・冗長な説明
・細かすぎる年号の羅列
・用語集的な羅列
・世界史を一国史だけで説明すること
・地域や王朝を混同したまま説明すること
・因果関係を広げすぎること
・「覚えていれば解ける」で済ませること`;
  } else if (subjectType === "english") {
    if (questionType === "grammar") {
      basePrompt = `大学受験レベル（MARCH〜早慶）の英文法問題の解説を作成せよ。
対象：第${sectionData.id}問（${sectionData.label}）

目的は、受験生が同じ思考プロセスを再現できるように解法を言語化することである。

【解説方針】
・必ず選択肢から先に確認し、何が問われているか見当をつけること
・誤りの選択肢については、なぜ誤りか文法・語法根拠を明示すること
・正しい選択肢は簡潔に（1〜2文）、誤りの選択肢に解説の重心を置くこと
・知識の説明ではなく「その知識をどう使うか」を説明すること

【禁止事項】
・正解だけ説明して誤答を放置すること
・「なんとなく」「感覚的に」などの曖昧表現
・知識の羅列だけで終わる説明
・アスタリスク（*）記号は一切使用しないこと`;
    } else if (questionType === "writing") {
      basePrompt = `あなたは難関大学入試の英語講師です。第${sectionData.id}問（${sectionData.label}）の英作文（和文英訳・自由英作文）問題について、解答のプロセスと思考法を解説してください。
【ルール】
1. 考え方のプロセスや、求められている構文・表現の意図を解説すること。
2. よくあるミスや、汎用性の高い表現を紹介すること。
3. アスタリスク（*）記号は一切使用禁止。** や * を見出し・強調に用いないこと。`;
    } else if (questionType === "conversation") {
      basePrompt = `あなたは、難関大学入試レベルの英語会話文問題を解く専門講師である。
対象：第${sectionData.id}問（${sectionData.label}）の会話文問題

目的は、単に正解を示すことではない。
受験生が同じ手順で再現できるように、設問確認、選択肢分析、会話読解、空所処理、解答決定までの思考プロセスを完全に言語化することである。

【禁止事項】
・いきなり答えの理由から入ること
・空所前後だけを見て雑に決めること
・会話全体の流れを無視すること
・選択肢分析を省略すること
・英文を引用せずに説明すること
・正解選択肢だけ説明して誤答を放置すること
・「なんとなく自然」などの曖昧な説明
・後出しで都合よく説明すること
・前置詞問題をすべて熟語暗記だけで処理すること
・アスタリスク（*）記号は一切使用禁止。** や * を見出し・強調に用いないこと`;
    } else {
      basePrompt = `あなたは、難関大学入試（早稲田・慶應レベル）の英語長文問題を解く専門家である。
目的は「答え」ではなく、受験生が同じやり方を再現できるレベルで、第${sectionData.id}問（${sectionData.label}）の設問準備・読解・解答の思考プロセスを口語体でなく文語体で完全に言語化することである。

【禁止事項】
・箇条書き中心の解説、処理ログ風の羅列
・英文を示さずに日本語だけで説明すること
・参考書的なまとめ先行の解説
・「なんとなく」「感覚的に」などの曖昧表現
・アスタリスク（*）記号は一切使用しないこと`;
    }
  } else if (subjectType === "social") {
    basePrompt = `あなたは大学入試の社会科（日本史・世界史・地理）の専門講師です。第${sectionData.id}問（${sectionData.label}）について、各小問の背景知識や、資料・図表の読み方のポイントを詳細に解説してください。
【ルール】
1. 単なる正解の提示ではなく、なぜその知識が必要なのか、どう考えれば正解に辿りつくかを記述すること。
2. 誤選択肢がなぜ間違っているのか、歴史的事実に基づいて解説すること。
3. アスタリスク（*）記号は一切使用禁止。** や * を見出し・強調に用いないこと。`;
  } else {
    basePrompt = `あなたは大学入試の専門講師です。第${sectionData.id}問（${sectionData.label}）について、各小問の解き方や考え方のプロセスを詳細に解説してください。
【ルール】
アスタリスク（*）記号は一切使用禁止。** や * を見出し・強調に用いないこと。`;
  }

  const allQuestions = (sectionData.questions as Array<Record<string, unknown>>) || [];
  const answersNote = allQuestions.length > 0
    ? `\n【最重要】正解データについて（絶対遵守）\n以下の正解は管理者が確認済みの確定データです。解説中で各小問の正解を示す際は、必ず下記の値をそのまま使用すること。PDFの画像を独自に読み取って別の回答を導き出すことは絶対に禁止です。\n${allQuestions.map((q) => `・${q.label}（${q.id}）: 正解 = "${q.correctAnswer}"`).join("\n")}\n`
    : "";

  const finalPrompt = `
${basePrompt}
${answersNote}
【対象データ（構造）】
${JSON.stringify(sectionData, null, 2)}

${specialInstruction ? `【ユーザーからの個別指示】\n${specialInstruction}\n` : ""}

【文体・形式のルール（必須）】
・解説文（読む文章）として書くこと。授業口調・話し言葉は禁止。
・講師名・挨拶（「こんにちは」等）・締めの言葉（「お疲れ様でした」「応援しています」等）は一切不要。
・「皆さん」「聞いてください」「一緒に考えましょう」などの呼びかけ表現は使用しない。
・各問冒頭に「文全体をざっと読んでみましょう」等の定型導入を入れない。
・「→ Aは正しいので、誤りではありません。」のような全問共通の繰り返しパターンは避ける。
・全問共通のまとめ・総括・ポイント一覧は不要。各問の解説で完結させること。
・太字（##や見出し）は本当に重要な箇所のみ。乱用しない。
・感嘆符（！）の多用は避ける。

【出力要件】
1. Markdown形式で記述すること。
2. アスタリスク（*）記号は使用禁止。
3. コードブロック（\`\`\`markdown）で囲まず、本文のみを出力すること。
4. 必ず日本語で記述すること。

出力は解説本文（Markdown）のみを返してください。
`;

  const result = await generateContentWithFallback(genAI, {
    contents: [{ role: "user", parts: [{ text: finalPrompt }, ...imageParts] }],
    generationConfig: { maxOutputTokens: 65536 },
  });

  return result.response.text().replace(/```markdown\n?|```\n?|```/g, "").replace(/\*/g, "").trim();
}

async function handleGenerateSingleSection(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const subjectType = body.subjectType as string;
  const sectionIndex = body.sectionIndex as string | number;
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  const answerFilesData = (body.answerFilesData as Array<{ data: string; mimeType: string }>) || [];
  const instruction = (body.instruction as string) || "";
  const targetPoints = body.targetPoints as number | null;

  const isEnglish = subjectType === "english";
  const isSocial = ["social", "japanese_history", "world_history"].includes(subjectType);
  let subjectSpecificRules = "";
  if (isEnglish) subjectSpecificRules = ENGLISH_RULES;
  else if (isSocial) subjectSpecificRules = SOCIAL_RULES;

  const aInlineData = toImageParts(answerFilesData);
  const qInlineData = toImageParts(questionFilesData);

  const targetPointsRule = targetPoints
    ? `\n【重要：目標配点】\nこの大問の小問群の \`points\` の合計がぴったり **${targetPoints}** 点 になるように必ず割り振ってください。（各小問の配点は1以上の自然数であること）\n`
    : `\n【配点ルール】\n問題数や難易度に合わせて自然な点数（1以上の自然数）を割り振ってください。\n`;

  const structurePrompt = `
あなたは大学入試の専門家です。提供された画像（問題用紙および解答用紙）を詳細に分析し、**第${sectionIndex}問**に関する設問の構造・正解・配点のみを抽出してください。

【入力素材】
・添付画像から問題と解答の関係を読み取り、正確なデータを作成してください。
${instruction ? `【個別指示】\n${instruction}\n` : ""}
${subjectSpecificRules}
${targetPointsRule}

【抽出条件と厳格ルール】
1. この大問（第${sectionIndex}問）の中に含まれる小問を全て抽出すること。
2. アスタリスク（*）記号を絶対に使用しないでください。
3. 選択問題の \`options\` 配列には、記号・番号（例: "1", "a", "ア" など）のみを含めてください。
4. \`explanation\` フィールドは全て空文字列 "" にしてください。解説は別工程で生成します。
5. \`sectionAnalysis\` は空文字列 "" にしてください。
6. 必ず以下のJSON構造（オブジェクト1つ）のみを出力してください。
7. 画像からの読み取りミス（OCRミス）がないよう、特に記号や数値は慎重に確認してください。

【出力構造】
{
  "id": "${sectionIndex}",
  "label": "第${sectionIndex}問",
  "allocatedPoints": ${targetPoints || 0},
  "sectionAnalysis": "",
  "questions": [
    {
      "id": "小問ID",
      "label": "小問ラベル",
      "type": "selection",
      "options": ["a", "b", "c", "d"],
      "correctAnswer": "正解",
      "points": 5,
      "explanation": ""
    }
  ]
}
`;

  const structureResult = await generateContentWithFallback(genAI, {
    contents: [{ role: "user", parts: [...qInlineData, ...aInlineData, { text: structurePrompt }] }],
    generationConfig: { maxOutputTokens: 8192 },
  }, 5, 5000);

  const parsedSection = JSON.parse(sanitizeJson(structureResult.response.text())) as Record<string, unknown>;
  if (!parsedSection.sectionAnalysis) parsedSection.sectionAnalysis = "";

  // Stage 2: explanations in chunks
  const questions = (parsedSection.questions as Array<Record<string, unknown>>) || [];
  const chunkSize = 5;
  for (let i = 0; i < questions.length; i += chunkSize) {
    const chunk = questions.slice(i, i + chunkSize);
    const slimChunk = chunk.map((q) => ({
      id: q.id, label: q.label, type: q.type,
      options: q.options, correctAnswer: q.correctAnswer, points: q.points, explanation: "",
    }));
    const expPrompt = `あなたは大学入試の専門講師です。
以下の画像（問題・解答）を分析し、提供された設問構造の各小問に対する解説(explanation)のみを生成してください。

【厳格ルール】
1. id, label, type, options, correctAnswer, points は絶対に書き換えないこと。
2. 各小問の explanation を【2〜3文以内、約50〜100文字】で埋めてください。
3. 日本語で記述。アスタリスク（*）禁止。
4. 出力は解説を埋めた後の同じJSON構造（オブジェクト1つ）のみ。

【設問構造】
${JSON.stringify({ questions: slimChunk })}

【出力要件】
- ${chunk.length}個の小問すべてに解説を生成すること。
- 出力はJSONオブジェクト1つのみ。
`;
    try {
      const expResult = await generateContentWithFallback(genAI, {
        contents: [{ role: "user", parts: [{ text: expPrompt }, ...qInlineData, ...aInlineData] }],
        generationConfig: { maxOutputTokens: 16384 },
      }, 3, 3000);
      const expParsed = JSON.parse(sanitizeJson(expResult.response.text())) as Record<string, unknown>;
      const expQuestions = Array.isArray(expParsed) ? expParsed : ((expParsed.questions as Array<Record<string, unknown>>) || []);
      expQuestions.forEach((q) => {
        const idx = (parsedSection.questions as Array<Record<string, unknown>>).findIndex((orig) => orig.id === q.id);
        if (idx !== -1) (parsedSection.questions as Array<Record<string, unknown>>)[idx].explanation = q.explanation || "";
      });
    } catch (expError) {
      console.warn(`Explanation chunk ${i} failed:`, (expError as Error).message);
    }
  }

  return parsedSection;
}

async function handleGenerateSectionQA(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const sectionData = body.sectionData as Record<string, unknown>;
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  const answerFilesData = (body.answerFilesData as Array<{ data: string; mimeType: string }>) || [];

  const imageParts = [...toImageParts(questionFilesData), ...toImageParts(answerFilesData)];
  const questions = (sectionData.questions as Array<Record<string, unknown>>) || [];
  if (questions.length === 0) return sectionData;

  const emptyQuestions = questions.filter((q) => !q.explanation || String(q.explanation).trim() === "");
  if (emptyQuestions.length === 0) return sectionData;

  const chunkSize = 5;
  const updatedQuestions = [...questions];
  let overallSectionAnalysis = (sectionData.sectionAnalysis as string) || "";

  for (let i = 0; i < emptyQuestions.length; i += chunkSize) {
    const chunk = emptyQuestions.slice(i, i + chunkSize);
    const slimChunk = chunk.map((q) => ({
      id: q.id, label: q.label, type: q.type,
      options: q.options, correctAnswer: q.correctAnswer, points: q.points, explanation: "",
    }));
    const tempSectionData = {
      sectionNumber: sectionData.sectionNumber,
      sectionTitle: sectionData.sectionTitle,
      questions: slimChunk,
    };

    const prompt = `あなたは大学入試の専門講師です。
以下の画像（問題・解答）を分析し、提供された「設問構造（JSON）」の各小問に対応する **解説(explanation)のみ** を生成してください。
また、大問全体の読解ポイント(sectionAnalysis)も併せて作成してください。

【厳格ルール】
1. **既存の id, label, type, options, correctAnswer, points は絶対に書き換えないこと。**
2. 渡された JSON の各要素にある \`explanation\` フィールドを、論理的で丁寧な解説で埋めてください。
3. 【超重要】解説の長さは【各小問100文字程度】を目安にしてください。
4. 日本語で記述すること。
5. アスタリスク（*）記号は一切使用禁止。
6. 出力は、解説を埋めた後の「同じJSON構造のオブジェクト1つのみ」を返してください。

【対象の設問構造（現在のデータ）】
小問数: ${chunk.length}
${JSON.stringify(tempSectionData)}

【出力要件】
- ルートはオブジェクトであること（配列ではない）
- **重要：提供された ${chunk.length} 個の小問すべてについて、一つも漏らさずに解説を生成してください。**
- 各小問の "id" は絶対に提供されたものと同じものを使用すること。
- 出力はJSONオブジェクト1つのみ。
`;

    const result = await generateContentWithFallback(genAI, {
      contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
      generationConfig: { maxOutputTokens: 65536 },
    }, 5, 5000, ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-pro"]);

    const parsed = JSON.parse(sanitizeJson(result.response.text())) as Record<string, unknown>;
    let chunkQuestions: Array<Record<string, unknown>> = [];
    if (Array.isArray(parsed)) {
      chunkQuestions = parsed;
    } else if (parsed.questions && Array.isArray(parsed.questions)) {
      chunkQuestions = parsed.questions as Array<Record<string, unknown>>;
      if (parsed.sectionAnalysis) overallSectionAnalysis = parsed.sectionAnalysis as string;
    } else if (parsed.questions && typeof parsed.questions === "object") {
      chunkQuestions = Object.values(parsed.questions as object) as Array<Record<string, unknown>>;
      if (parsed.sectionAnalysis) overallSectionAnalysis = parsed.sectionAnalysis as string;
    }

    chunkQuestions.forEach((q) => {
      if (!q) return;
      const targetIndex = updatedQuestions.findIndex((origQ) => origQ.id === q.id);
      if (targetIndex !== -1) {
        updatedQuestions[targetIndex] = { ...updatedQuestions[targetIndex], explanation: q.explanation || "" };
      }
    });
  }

  return { ...sectionData, sectionAnalysis: overallSectionAnalysis, questions: updatedQuestions };
}

async function handleExtractVocabulary(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  if (questionFilesData.length === 0) throw new Error("問題の画像ファイルがありません。");

  const imageParts = toImageParts(questionFilesData);

  const prompt = `あなたは大学入試・英検指導の専門講師です。
提供された問題用紙の画像から、英語の長文や問題文を読み取り、この大問で出題された**「難易度の高い重要な英単語」**を抽出してください。

【厳格ルール】
1. 提供された文章の中から、受験生が知っておくべき重要な **「難単語」** を **漏れなくすべて** 抽出してください。
2. 基礎的すぎる単語は除外してください。
3. 単語とその日本語の意味をペアにしてリスト化すること。
4. 出力は以下のJSON配列形式のみとすること。これ以外の文章やマークダウン（\`\`\`json等）を含めないこと。
5. アスタリスク（*）記号は一切使用禁止。

【出力形式の例】
[
  { "word": "comprehensive", "meaning": "総合的な、包括的な" },
  { "word": "allocate", "meaning": "割り当てる" },
  ... (該当するすべての単語をリストに含める)
]
`;

  const result = await generateContentWithFallback(genAI, {
    contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
    generationConfig: { maxOutputTokens: 2048 },
  }, 5, 5000);

  return JSON.parse(sanitizeJson(result.response.text()));
}

async function handleConsultScoringElements(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const examMeta = (body.examMeta as Record<string, unknown>) || {};
  const questionData = (body.questionData as Record<string, unknown>) || {};
  const userMessage = body.userMessage as string;
  const history = (body.history as Array<{ role: "user" | "ai"; text: string }>) || [];

  const systemPrompt = `
# 役割
あなたは大学入試の「採点基準設計エキスパート」です。
現在、管理者が記述式・自由記述式問題（英作文など）の「採点要素（scoringElements）」を作成しています。
あなたの仕事は、管理者の意図や問題・模範解答に基づいて、客観的で公平な採点基準（要素）の設計をサポートすることです。

# 本システムの採点ルール（前提知識）
1. 自由記述問題（essay）は、管理者が定義した1〜7個の「採点要素（scoringElements）」に基づいてAIが自動で採点を行います。
2. 各要素は "full"（完全充足）、"partial"（部分充足・オプションで有効な場合のみ）、"none"（非充足）の3つのステータスで評価されます。
3. 答案全体の得点は、「満たした要素の合計点」から「文法エラー数（各-1点）」を引いた値になります（下限0点）。
4. したがって、採点要素は「客観的に見てAIが Yes / No を判定しやすい具体的な記述（チェック項目）」にする必要があります。

# 対象の設問情報
設問ID: ${questionData.id}
配点: ${questionData.points}点
問題文: ${questionData.label || "未入力"}
正解・模範解答: ${questionData.correctAnswer || "未入力"}
現在の採点基準・指示: ${questionData.gradingInstruction || "未入力"}
現在の採点要素設定: ${JSON.stringify(questionData.scoringElements || [])}

# 試験メタデータ
大学名: ${examMeta.university || "未入力"}
学部名: ${examMeta.faculty || "未入力"}
科目名: ${examMeta.subject || "未入力"}
年度: ${examMeta.year || "未入力"}

# あなたのタスク
ユーザー（管理者）からのチャットメッセージに答えてください。
メッセージの内容に応じて、以下の【A】または【B】の対応をしてください。

【A】ユーザーが「採点要素の提案」を求めている場合
- 採点要素（scoringElements）の具体的な箇条書き案と、その極めて簡潔な説明のみを提案してください。
- 合計点が設問の配点（${questionData.points}点）と一致するように配慮し、1〜7個の範囲内で提案してください。
- 以下の「重要制約事項」と「回答フォーマット例」に**超厳密に**従ってください。

【B】ユーザーが「理由の質問」「要素の修正」「その他の相談」をしている場合
- ユーザーの質問に対して、極めて簡潔に直接的な回答のみを行ってください。
- 挨拶や前置きは不要です。すぐに本題に入ってください。
- 出力は250文字以内に収めてください。

# 【A】の場合の重要制約事項（超厳守・違反した場合はペナルティ）
1. 前置き、挨拶、結びの言葉、アドバイス解説の文章は【完全に出力禁止】です。提案の箇条書きのみを出力してください。
2. JSON形式の直接出力は【完全禁止】です。
3. アスタリスク記号の使用は【完全禁止】です。「」や【】、数字の箇条書きを使用してください。
4. 【最大文字数制限】全体の出力は必ず250文字以内を目安としてください。
5. 【積極的な改行】可読性を重視し、各要素ごとに空行を挟むなど読みやすく整理してください。

# 【A】の場合の回答フォーマット例（この構造以外は出力禁止）
1. 【要素1】「but」から始まる（1点）
・説明：解答の先頭に接続詞「but」が正しく記述されていること。

2. 【要素2】「創造的であること」への言及（2点）
・説明：模範解答の「be creative」に対応する内容が含まれていること。

3. 【要素3】「問題解決」への言及（2点）
・説明：模範解答の「solve problems」に対応する内容が含まれていること。
`;

  // Gemini chat has role "user" and "model".
  // Translate incoming history to Gemini format.
  const chatHistory = [
    {
      role: "user",
      parts: [{ text: systemPrompt }],
    },
    {
      role: "model",
      parts: [{ text: "わかりました。採点基準の設計をサポートします。どのような相談でしょうか？" }],
    },
    ...history.map((msg) => ({
      role: msg.role === "ai" ? "model" : "user",
      parts: [{ text: msg.text }],
    })),
  ];

  let model;
  try {
    model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  } catch {
    model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
  }

  // deno-lint-ignore no-explicit-any
  const chat = (model as any).startChat({ history: chatHistory });
  const chatResult = await chat.sendMessage(userMessage);
  return chatResult.response.text();
}

// ---------------------------------------------------------------------------
// Main serve handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  const origin = getAllowedOrigin();
  const headers = { ...corsHeaders, "Access-Control-Allow-Origin": origin };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  // CORS origin check
  const requestOrigin = req.headers.get("origin") ?? "";
  if (origin !== "*" && requestOrigin !== origin) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    // Auth check
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
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Admin role check
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile || profile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden: Admin only" }), {
        status: 403,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
    const genAI = new GoogleGenerativeAI(apiKey);

    const body = (await req.json()) as Record<string, unknown>;
    const { operation } = body;

    let result: unknown;
    switch (operation) {
      case "extractMetadata":
        result = await handleExtractMetadata(genAI, body);
        break;
      case "generateMasterData":
        result = await handleGenerateMasterData(genAI, body);
        break;
      case "regenerateExplanation":
        result = await handleRegenerateExplanation(genAI, body);
        break;
      case "regenerateAnalysis":
        result = await handleRegenerateAnalysis(genAI, body);
        break;
      case "regeneratePoints":
        result = await handleRegeneratePoints(genAI, body);
        break;
      case "generateSectionAnalysis":
        result = await handleGenerateSectionAnalysis(genAI, body);
        break;
      case "generateSingleSection":
        result = await handleGenerateSingleSection(genAI, body);
        break;
      case "generateSectionQA":
        result = await handleGenerateSectionQA(genAI, body);
        break;
      case "extractVocabulary":
        result = await handleExtractVocabulary(genAI, body);
        break;
      case "consultScoringElements":
        result = await handleConsultScoringElements(genAI, body);
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown operation: ${operation}` }), {
          status: 400,
          headers: { ...headers, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ data: result }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[gemini-admin] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
