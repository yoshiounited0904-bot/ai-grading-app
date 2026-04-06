import { GoogleGenerativeAI } from "@google/generative-ai";

const MODELS = {
  PRIMARY: "gemini-2.0-flash",
  FALLBACK: "gemini-1.5-flash"
};

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

⸻

【1. 内部実行ルール（出力しないが必ず実行）】

1-1. 設問分類
・各設問を、上記A〜Eのいずれかに必ず分類する
・複数該当しそうな場合でも、最も厳密に当てはまる1つのみを採用
・新たな設問タイプの創設は禁止

⸻

1-2. 配点割当
・配点は、③で定義された序列を絶対条件として割り振る
・同一タイプ内で複数設問がある場合のみ、以下を考慮して微調整してよい：
　- 必要な知識量
　- 思考の段階数
　- 論述であれば要素数
※ ただし、タイプ間の配点逆転は禁止

⸻

1-3. 論述問題の要素設計
・論述問題については、必ず：
　- 模範回答を要素に分解
　- 要素数と要素充足条件を内部的に検討し、適切な配点を割り当てること（テキストとしての出力は不要）
`;

export const sanitizeJson = (jsonString) => {
  if (!jsonString) return "";

  let clean = jsonString.trim();

  // Primary rescue: Find the first and last JSON-like characters to strip conversational filler
  const firstBrace = clean.indexOf('{');
  const firstBracket = clean.indexOf('[');
  let startIndex = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
  }

  if (startIndex !== -1) {
    const lastBrace = clean.lastIndexOf('}');
    const lastBracket = clean.lastIndexOf(']');
    let endIndex = -1;
    if (lastBrace > lastBracket) {
      endIndex = lastBrace;
    } else {
      endIndex = lastBracket;
    }

    if (endIndex !== -1 && endIndex > startIndex) {
      clean = clean.substring(startIndex, endIndex + 1);
    }
  }

  // Remove markdown code blocks if present (legacy fallback)
  clean = clean.replace(/```json/g, "").replace(/```/g, "").trim();

  // Rescue for truncation: Add missing closing brackets/braces
  const openBraces = (clean.match(/\{/g) || []).length;
  const closeBraces = (clean.match(/\}/g) || []).length;
  if (openBraces > closeBraces) {
    clean += "}".repeat(openBraces - closeBraces);
  }

  const openBrackets = (clean.match(/\[/g) || []).length;
  const closeBrackets = (clean.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    clean += "]".repeat(openBrackets - closeBrackets);
  }

  return clean;
};

// --- RETRY UTILITY FOR 429 ERRORS ---
const withRetry = async (fn, maxRetries = 10, initialDelay = 5000) => {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      // Check for 429 in various formats
      const isRateLimit = (error.status === 429) ||
        (error.message?.includes("429")) ||
        (error.message?.includes("Resource exhausted")) ||
        (error.message?.includes("Too many requests"));

      if (isRateLimit && attempt < maxRetries) {
        // Exponential backoff: 5s, 10s, 20s, 40s...
        const delay = initialDelay * Math.pow(2, attempt - 1);
        console.warn(`[GeminiService] Rate limit hit (429/TooManyRequests). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
};

// Helper function to convert File to base64 and preserve mimeType
// For images, we resize/compress them to avoid payload size errors
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const isImage = file.type.startsWith('image/');

    if (isImage) {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const reader = new FileReader();

      reader.onload = (e) => {
        img.onload = () => {
          // Max dimensions
          const MAX_WIDTH = 1600;
          const MAX_HEIGHT = 1600;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;

          // Draw image
          ctx.drawImage(img, 0, 0, width, height);

          // Get high quality jpeg (smaller than uncompressed image)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          const base64String = dataUrl.split(',')[1];
          resolve({ data: base64String, mimeType: 'image/jpeg' });
        };
        img.onerror = () => reject(new Error('Failed to load image for compression'));
        img.src = e.target.result;
      };
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);

    } else {
      // For PDFs
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = reader.result.split(',')[1];
        resolve({ data: base64String, mimeType: file.type });
      };
      reader.onerror = error => reject(error);
    }
  });
};

export const generateExamMasterData = async (apiKey, subjectType, questionFiles, questionFilesBySection, answerFilesBySection, sectionInstructionsBySection, sectionPointsBySection, extraInfo) => {
  try {
    const trimmedKey = apiKey?.trim();
    console.log("[AdminGeminiService] Using model:", MODELS.PRIMARY);

    if (!trimmedKey) {
      console.error("[AdminGeminiService] CRITICAL: apiKey parameter is empty or undefined");
      throw new Error("Gemini API Key is not set. .env.localファイルを確認し、開発サーバーを再起動（Ctrl+Cして npm run dev）してください。");
    }

    const genAI = new GoogleGenerativeAI(trimmedKey);
    const model = genAI.getGenerativeModel({ model: MODELS.PRIMARY });

    const maxScore = extraInfo?.maxScore || 100;
    const isEnglish = subjectType === 'english';
    const isSocial = subjectType === 'social';

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
さらに、【最重要事項】として、計算されたすべての小問配点の合計가、入力として指定された満点（${maxScore}点）と完全に一致するように調整してください。
`;
    } else {
      subjectSpecificRules = `
一般的な科目として、設問の難易度や形式に応じて常識的な配点を行ってください。
ただし、以下の条件を必ず守ること：
1. 最終的な合計点は全体で指定された満点（${maxScore}）と一致するよう調整すること。
2. 特定の1問に10点以上の異常に高い配点を割り振らないこと。極端な偏りを防ぎ、問題数に応じて自然に点数を分散させること。
`;
    }

    // --- STAGE 0: COMMON OCR (Reference) ---
    let commonQuestionText = "";
    if (questionFiles && questionFiles.length > 0) {
      console.log(`[Stage 0] Transcribing common question documents...`);
      const qDataArray = await Promise.all(questionFiles.map(file => fileToBase64(file)));
      const qInlineData = qDataArray.map(fd => ({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));

      const qOcrPrompt = `提供された問題用紙の画像を正確にテキスト化してください。`;
      const qOcrResult = await withRetry(() => model.generateContent({
        contents: [{ role: 'user', parts: [...qInlineData, { text: qOcrPrompt }] }],
        generationConfig: { maxOutputTokens: 8192 }
      }));
      commonQuestionText = qOcrResult.response.text();
    }

    // --- STAGE 1: PER-SECTION PROCESSING ---
    const extractedSections = [];
    const sectionsCount = Object.keys(answerFilesBySection).length;

    for (const [sectionIndex, rawAnswerFiles] of Object.entries(answerFilesBySection)) {
      if (!rawAnswerFiles || rawAnswerFiles.length === 0) continue;

      console.log(`[Stage 1] Processing section ${sectionIndex} / ${sectionsCount} ...`);

      // 1a. OCR the answers for this section
      const aDataArray = await Promise.all(rawAnswerFiles.map(file => fileToBase64(file)));
      const aInlineData = aDataArray.map(fd => ({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
      const aOcrPrompt = `以下の画像は試験の「第${sectionIndex}問」の解答です。正確にテキスト化してください。`;
      const aOcrResult = await withRetry(() => model.generateContent({
        contents: [{ role: 'user', parts: [...aInlineData, { text: aOcrPrompt }] }],
        generationConfig: { maxOutputTokens: 2048 }
      }));
      const answerText = aOcrResult.response.text();

      // 1b. OCR the specific questions for this section (if provided)
      let sectionQuestionText = "";
      const rawQuestionFiles = questionFilesBySection[sectionIndex] || [];
      if (rawQuestionFiles.length > 0) {
        console.log(`[Stage 1] Transcribing specific questions for section ${sectionIndex}...`);
        const qDataArray = await Promise.all(rawQuestionFiles.map(file => fileToBase64(file)));
        const qInlineData = qDataArray.map(fd => ({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
        const sqOcrPrompt = `以下の画像は試験の「第${sectionIndex}問」の問題です。正確にテキスト化してください。`;
        const sqOcrResult = await withRetry(() => model.generateContent({
          contents: [{ role: 'user', parts: [...qInlineData, { text: sqOcrPrompt }] }],
          generationConfig: { maxOutputTokens: 4096 }
        }));
        sectionQuestionText = sqOcrResult.response.text();
      }

      // 1c. Extract structure
      const sectionInstruction = sectionInstructionsBySection[sectionIndex] || "";
      const extractPrompt = `
以下の試験素材を分析し、**第${sectionIndex}問**に関する設問構造と正解のみを抽出してください。

【第${sectionIndex}問 問題テキスト】
${sectionQuestionText || commonQuestionText || "（問題テキストなし）"}

【第${sectionIndex}問 解答テキスト】
${answerText}

${sectionInstruction ? `【個別指示】\n${sectionInstruction}\n` : ""}

【抽出条件と厳格ルール】
1. この大問（第${sectionIndex}問）の中に含まれる小問を全て抽出すること。
2. アスタリスク（*）記号を絶対に使用しないでください。
3. 以下のJSON構造（オブジェクト1つ）のみを出力してください（コードブロックなし）。
4. 選択問題の \`options\` 配列には、記号・番号（例: "1", "a", "ア" など）のみを含めてください。
5. 全ての小問の \`points\` は 0 に設定してください。

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

      const extractResult = await withRetry(() => model.generateContent({
        contents: [{ role: 'user', parts: [{ text: extractPrompt }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 }
      }), 5, 4000);

      const sectionRaw = extractResult.response.text();
      try {
        const parsedSection = JSON.parse(sanitizeJson(sectionRaw));
        // Ensure sectionAnalysis exists even if empty at first
        if (!parsedSection.sectionAnalysis) parsedSection.sectionAnalysis = "";
        extractedSections.push(parsedSection);
      } catch (err) {
        console.error(`[AdminGeminiService] Failed to parse section ${sectionIndex}:`, err);
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    console.log(`[Stage 1] Completed extraction for ${extractedSections.length} sections.`);

    // --- STAGE 2: GLOBAL POINTS ALLOCATION ---
    console.log(`[Stage 2] Allocating global points to sum up to ${maxScore}...`);
    const pointsPrompt = `
以下の試験マスターデータは、すべての設問と正解を抽出したものですが、配点（points）が全て0になっています。
科目別の厳格なルールに基づいて、各大問(allocatedPoints)および各小問(points)に適切な点数を割り当ててください。

【配点条件】
${sectionPointsBySection && Object.keys(sectionPointsBySection).some(k => sectionPointsBySection[k]) ? 
  "【大問の目標配点（絶対遵守）】\n各大問の `allocatedPoints` を以下の通り固定し、小問の `points` 合計がぴったりその値になるように割り振ってください。\n" + 
  Object.entries(sectionPointsBySection).filter(([k,v]) => v).map(([k,v]) => `・第${k}問: ${v}点`).join("\n") + "\n"
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

    const pointsResult = await withRetry(() => model.generateContent({
      contents: [{ role: 'user', parts: [{ text: pointsPrompt }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 }
    }));

    let fullSections = extractedSections; // Fallback
    try {
      fullSections = JSON.parse(sanitizeJson(pointsResult.response.text()));
    } catch (err) {
      console.error(`[AdminGeminiService] Failed to parse points allocation. Using 0 points fallback.`, err);
    }

    const structureData = {
      maxScore: maxScore,
      structure: fullSections
    };

    console.log(`[Stage 2] Points allocated successfully.`);

    // --- STEP 1.5: MATH NORMALIZATION FOR POINTS (REMOVED) ---
    // The automatic point normalization logic (+1/-1 adjustments) has been removed.
    // We now strictly rely on the rigorous AI Prompt rules provided by the user
    // to allocate the correct points and have them sum exactly to maxScore.

    // --- STEP 3: DETAILED ANALYSIS ---
    // Detailed per-question explanations are now generated on-demand
    // via the 'Regenerate' button in the Admin Editor. Skipping here for reliability.
    console.log(`[Step 3/3] Skipping detailed analysis - will be generated on-demand.`);
    const detailedAnalysis = "第1問から各設問の「再生成」ボタンを押して解説を生成してください。";

    // --- FINAL ASSEMBLY ---
    const finalJson = {
      id: extraInfo.id,
      university: extraInfo.university || '大学名',
      university_id: extraInfo.universityId || 0,
      faculty: extraInfo.faculty || '学部名',
      faculty_id: extraInfo.facultyId || 'faculty',
      year: extraInfo.year || 2025,
      subject: extraInfo.subject || '科目名',
      subject_en: subjectType,
      type: "pdf",
      // Assuming pdf is manually uploaded to a bucket later, or just a generic path
      pdf_path: `/exam_data/${questionFiles[0]?.name || 'unknown'}`,
      max_score: structureData.maxScore,
      detailed_analysis: detailedAnalysis,
      structure: structureData.structure
    };

    return finalJson;
  } catch (error) {
    console.error("Error generating exam master data:", error);
    throw error;
  }
};

export const regenerateQuestionExplanation = async (apiKey, questionData, questionFiles = [], answerFiles = []) => {
  try {
    const trimmedKey = apiKey?.trim();
    console.log("[AdminGeminiService] Explanation - Using model:", MODELS.PRIMARY);
    console.log("[AdminGeminiService] API Key check:", trimmedKey ? `Set (length: ${trimmedKey.length}, starts with: ${trimmedKey.substring(0, 7)}..., ends with: ...${trimmedKey.substring(trimmedKey.length - 4)})` : "Not found");

    if (!apiKey) {
      throw new Error("Gemini API Key is not set.");
    }

    let genAI;
    try {
      genAI = new GoogleGenerativeAI(trimmedKey);
    } catch (err) {
      throw new Error("Gemini APIの初期化に失敗しました。");
    }

    let model;
    try {
      model = genAI.getGenerativeModel({
        model: MODELS.PRIMARY,
        // tools: [{ googleSearch: {} }] // Allow web search just in case
      });
    } catch (err) {
      throw new Error(`モデル "${MODELS.PRIMARY}" の読み出しに失敗しました。`);
    }

    const imageParts = [];
    if (questionFiles && questionFiles.length > 0) {
      const qDataArray = await Promise.all(questionFiles.map(file => fileToBase64(file)));
      qDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }
    if (answerFiles && answerFiles.length > 0) {
      const aDataArray = await Promise.all(answerFiles.map(file => fileToBase64(file)));
      aDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }

    const prompt = `あなたは大学入試の専門講師です。以下の問題の解説を、簡潔に2〜3文で書いてください。

【対象の問題データ】
${JSON.stringify(questionData, null, 2)}

【要件】
1. なぜその答えになるのか、根拠（本文の該当箇所など）を1文で示すこと。
2. 選択問題の場合、誤りの選択肢が間違っている理由を1〜2文で簡潔に加えること。
3. アスタリスク（*）記号は一切使用禁止。見出しや強調も含め ** や * は使わないこと。
4. 长すぎる解説は不要。受験生が「なるほど」と思える最小限の説明で十分。
5. 必ず日本語で記述すること。

出力は解説本文のみ（プレーンテキスト）。
`;

    const result = await withRetry(() => model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }, ...imageParts] }],
      generationConfig: { maxOutputTokens: 8192 }
    }));

    const text = result.response.text();
    console.log("[AdminGeminiService] Raw Explanation Response:", text.substring(0, 500) + "...");

    // Clean up response (remove markdown code blocks if present)
    const cleanedText = text.replace(/```markdown\n?|```\n?|```/g, '').trim();
    return cleanedText;
  } catch (error) {
    console.error("Error regenerating explanation:", error);
    throw error;
  }
};

export const regenerateDetailedAnalysis = async (apiKey, subjectType, examData, questionFiles = [], answerFiles = []) => {
  try {
    const trimmedKey = apiKey?.trim();
    console.log("[AdminGeminiService] Detailed Analysis - Using model:", MODELS.PRIMARY);

    if (!trimmedKey) {
      throw new Error("Gemini API Key is not set.");
    }

    let genAI;
    try {
      genAI = new GoogleGenerativeAI(trimmedKey);
    } catch (err) {
      throw new Error("Gemini APIの初期化に失敗しました。");
    }

    let model;
    try {
      model = genAI.getGenerativeModel({ model: MODELS.PRIMARY });
    } catch (err) {
      throw new Error(`モデル "${MODELS.PRIMARY}" の読み出しに失敗しました。`);
    }

    const imageParts = [];
    if (questionFiles && questionFiles.length > 0) {
      const qDataArray = await Promise.all(questionFiles.map(file => fileToBase64(file)));
      qDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }
    if (answerFiles && answerFiles.length > 0) {
      const aDataArray = await Promise.all(answerFiles.map(file => fileToBase64(file)));
      aDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }

    let prompt = "";

    if (subjectType === 'english') {
      prompt = `あなたは、難関大学入試（早稲田・慶應レベル）の英語長文問題を解く専門家である。
目的は「答え」ではなく、受験生が同じやり方を再現できるレベルで、
設問準備・読解・解答の思考プロセスを口語体でなく文語体で完全に言語化することである。

────────────────
【最重要前提】

・設問準備 → 読解 → 設問処理は分離されていない
・解説は「実際に問題を解いている時系列」で書く
・本文解説では、必ず英文を引用しながら進める
・日本語の解説は、必ず直前に引用した英文に対応させる
・箇条書き・矢印・処理ログ風の書き方は禁止
・受験生が「英文 ↔ 解説」を往復できる文章にする

────────────────
【0. 入力】

以下が与えられる：
・本文（段落番号つき推奨）※添付画像を参照
・設問（番号つき・選択肢つき）※添付画像及び以下の構造データを参照
・（任意）ユーザー指定の正解 ※以下の構造データを参照

【試験データ構造】
${JSON.stringify({ maxScore: examData.max_score, structure: examData.structure }, null, 2)}

────────────────
【1. 内部実行ルール（※出力しないが必ず実行）】

### 1-1. 設問準備（読む前）

本文を読む前に、全設問を確認し、各設問について次のみを行う：

・設問タイプの把握（傍線部説明／定義／NOT／比喩／理由 など）
・「どの段落まで読めば解けるか」の見通し
・読解中に意識すべき観点（But／抽象→具体／評価語 など）

重要：
・この段階では答えを作らない
・やるのは「読み方の設計」だけ

### 1-2. 読解（解きながら読む）

各段落について、必ず以下の流れで処理する：

A. 段落に入る前に、今どの設問を意識しているかを確認  
B. 英文を **一文ずつ引用** する  
C. その英文を読んだ瞬間に頭の中で行っている判断を、日本語の文章で説明する  
D. 次の英文で、理解がどう修正・更新されたかを書く  
E. But／疑問文／言い換え／抽象↔具体が出た場合は、必ず意味づけを言語化する  
F. 段落を読み終えた時点で、
   ・段落の趣旨
   ・本文全体における役割
   を文章でまとめる
G. この時点で解ける設問があれば、
   「ここまで読めばこの設問に必要な情報はそろっている」
   という自然な日本語で示す

重要：
・いきなり段落要約から入らない
・必ず「英文 → 思考 → 英文 → 思考」の流れを守る

### 1-3. 選択肢処理

選択肢問題は、正解探しではなく「誤りの言語化」で処理する。

・各誤選択肢について、
  - 本文のどこがズレているか
  - ズレの種類（言い過ぎ／範囲ズレ／主語述語ズレ／抽象化しすぎ等）
を短い文章で明確に説明する。

────────────────
【2. 出力順（絶対厳守）】

以下の順番を必ず守る。

① 解答一覧  
② 設問準備フェーズ（文章で）  
③ 読みながら解くプロセス（段落ごと・英文引用必須）  
④ 設問ごとの解答プロセス  
⑤ 本文全文和訳  
⑥ 完全解説（①〜④を統合した時系列の最終版）

────────────────
【3. 各出力の詳細】

①【解答一覧】
・ユーザー指定の解答をそのまま列挙
・理由は書かない

②【設問準備フェーズ】
・箇条書きは禁止
・各設問について
  「この設問は何を聞いており、どこをどう読めば解けそうか」
  を文章で説明する

③【読みながら解くプロセス】
・必ず英文を引用しながら進める
・一文ごとに
  「この文を読んだ時点ではこう理解する」
  「次の文でこの理解がこう変わる」
  を書く
・設問との接続は自然な文章で行う

④【設問ごとの解答プロセス】
・どの段落・どの英文を根拠にしたかを明示
・他の選択肢がなぜ違うかを本文ベースで説明

⑤【本文全文和訳】
・自然な日本語
・逐語訳ではないが情報は落とさない
・解説は入れない

⑥【完全解説】
・設問準備 → 読解 → 解答が
  実際の頭の中でどう往復しているかを、
  一続きの文章として再構成する
・時系列を絶対に崩さない

────────────────
【4. 禁止事項】

・箇条書き中心の解説
・処理ログ風の羅列
・英文を示さずに日本語だけで説明すること
・参考書的なまとめ先行の解説
・「なんとなく」「感覚的に」などの曖昧表現
・アスタリスク（*）記号は一切使用しないこと（太字等はHTMLタグや他の記号で代用するか使用を控える）

以上のルールに従い、すべてMarkdownで記述し、コードブロック(\`\`\`markdown など)で全体を囲まず、直接本文のみを出力してください。
`;
    } else {
      prompt = `あなたは大学入試の専門講師です。提供された問題と解答のファイル、および抽出された構造データをもとに、試験の「全体詳細解説」を作成してください。

【試験データ構造】
${JSON.stringify({ maxScore: examData.max_score, structure: examData.structure }, null, 2)}

【要件】
1. 受験生が復習する際に役立つよう、大問ごとに丁寧な解説を記述すること。
2. アスタリスク（*）記号は一切使用禁止。** や * を見出し・強調に用いないこと。代わりに「①②③」「【】」などの記号を使うこと。
3. コードブロック表記（\`\`\`markdown など）で全体を囲まないこと。本文のみを出力すること。
4. **必ず日本語で記述すること。**

出力は解説本文のみを返してください。
`;
    }

    const result = await withRetry(() => model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }, ...imageParts] }],
      generationConfig: { maxOutputTokens: 65536 }
    }));

    const text = result.response.text();
    console.log("[AdminGeminiService] Raw Detailed Analysis length:", text.length);

    const cleanedText = text.replace(/```markdown\n?|```\n?|```/g, '').trim();
    return cleanedText;
  } catch (error) {
    console.error("Error regenerating detailed analysis:", error);
    throw error;
  }
};

export const regeneratePointsAllocation = async (apiKey, subjectType, examData, questionFiles = [], answerFiles = []) => {
  try {
    const trimmedKey = apiKey?.trim();
    console.log("[AdminGeminiService] Points Reallocation - Using model:", MODELS.PRIMARY);

    if (!trimmedKey) {
      throw new Error("Gemini API Key is not set.");
    }

    let genAI;
    try {
      genAI = new GoogleGenerativeAI(trimmedKey);
    } catch (err) {
      throw new Error("Gemini APIの初期化に失敗しました。");
    }

    let model;
    try {
      model = genAI.getGenerativeModel({
        model: MODELS.PRIMARY,
      });
    } catch (err) {
      throw new Error(`モデル "${MODELS.PRIMARY}" の読み出しに失敗しました。`);
    }

    const isEnglish = subjectType === 'english';
    const isSocial = subjectType === 'social';

    let subjectSpecificRules = "";
    if (isEnglish) {
      subjectSpecificRules = ENGLISH_RULES + `
※ 重要: 本システムでは最終出力として必ず JSON フォーマットが必要です。
この厳密なルールに基づいて配点（points）を再計算し、JSONの各設問の配点データに反映してください。文章等での回答は不要であり、純粋なJSONのみを返してください。
さらに、【最重要事項】として、再計算後のすべての小問の \`points\` の合計が、必ず指定された満点（${examData?.max_score || '指定なし'}点）と完全に一致するように調整してください。
`;
    } else if (isSocial) {
      subjectSpecificRules = SOCIAL_RULES + `
※ 重要: 本システムでは最終出力として必ず JSON フォーマットが必要です。
この厳密なルールに基づいて配点（points）を再計算し、JSONの各設問の配点データに反映してください。文章等での回答は不要であり、純粋なJSONのみを返してください。
さらに、【最重要事項】として、再計算後のすべての小問の \`points\` の合計が、必ず指定された満点（${examData?.max_score || '指定なし'}点）と完全に一致するように調整してください。
`;
    } else {
      subjectSpecificRules = `
一般的な科目として、設問の難易度や形式に応じて常識的な配点を行ってください。
ただし、以下の条件を必ず守ること：
1. 最終的な合計点は全体で指定された満点（maxScore）と一致するよう調整すること。
2. 特定の1問に10点以上の異常に高い配点を割り振らないこと。極端な偏りを防ぎ、問題数に応じて自然に点数を分散させること。
`;
    }

    // Prepare inputs
    const imageParts = [];
    if (questionFiles && questionFiles.length > 0) {
      const qDataArray = await Promise.all(questionFiles.map(file => fileToBase64(file)));
      qDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }
    if (answerFiles && answerFiles.length > 0) {
      const aDataArray = await Promise.all(answerFiles.map(file => fileToBase64(file)));
      aDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }

    // Clean up current structure to send to AI
    const currentStructure = examData.structure.map(sec => ({
      id: sec.id,
      label: sec.label,
      questions: sec.questions.map(q => ({
        id: q.id,
        label: q.label,
        type: q.type,
        options: q.options,
        correctAnswer: q.correctAnswer,
        points: parseInt(q.points) || 0
      }))
    }));

    const maxScore = parseInt(examData.max_score) || 100;

    const prompt = `あなたは大学入試の配点設計の専門家です。
現在入力されている試験の大問・小問構造データに対し、以下の【厳格ルール】に従って「配点（points）」だけを再計算し、更新されたJSON構造を返してください。既存の設問の定義（id, label, type, etc...）や並び順は一切変更せず、大問・小問の構造を完全に維持したまま返してください。

【厳格ルール】
${subjectSpecificRules}
3. 再計算後のすべての大問・小問の \`points\` の合計が、必ず指定された満点（${maxScore}点）と完全に一致するように調整してください。
4. すべての小問の \`points\` および大問の \`allocatedPoints\` は、必ず1以上の自然数（1, 2, 3...）にすること。小数点や「0点」は絶対に使用しないでください。
5. JSONのみを出力してください。Markdownのコードブロック（\`\`\`json など）は除外し、純粋なJSON文字列だけにすること。

【現在の構造データ（修正前）】
${JSON.stringify(currentStructure, null, 2)}
`;

    // Execute generation with retry logic (using JSON mime type structure to enforce schema if possible, or just parse response)
    const result = await withRetry(() => model.generateContent([
      prompt,
      ...imageParts
    ]));

    const text = result.response.text();
    const sanitizedText = sanitizeJson(text);

    let newStructure;
    try {
      newStructure = JSON.parse(sanitizedText);
    } catch (err) {
      console.error("[AdminGeminiService] Failed to parse reallocated points JSON:", err);
      throw new Error("配点の再生成結果（JSON）のパースに失敗しました。");
    }

    // --- STEP 1.5: MATH NORMALIZATION FOR POINTS (Safety check) ---
    // Ensure the AI actually summed it to maxScore exactly
    let currentTotal = 0;
    newStructure.forEach(sec => {
      sec.questions.forEach(q => {
        currentTotal += (parseInt(q.points) || 0);
      });
    });

    const targetTotal = maxScore;

    if (currentTotal > 0 && currentTotal !== targetTotal) {
      console.log(`[Points Reallocation] Normalizing points. AI Total: ${currentTotal}, Target: ${targetTotal}`);
      const ratio = targetTotal / currentTotal;
      let newTotal = 0;

      // First pass: proportional multiplication
      newStructure.forEach(sec => {
        sec.questions.forEach(q => {
          let orig = parseInt(q.points) || 0;
          let newVal = Math.max(1, Math.round(orig * ratio));
          q.points = newVal;
          newTotal += newVal;
        });
      });

      // Second pass: distribute the remaining difference
      let diff = targetTotal - newTotal;
      if (diff !== 0) {
        let flatQs = [];
        newStructure.forEach(sec => sec.questions.forEach(q => flatQs.push(q)));
        flatQs.sort((a, b) => b.points - a.points); // sort desc

        let i = 0;
        let safeguards = 0;
        while (diff > 0 && safeguards < 1000) {
          flatQs[i % flatQs.length].points += 1;
          diff--;
          i++;
          safeguards++;
        }

        i = 0; safeguards = 0;
        while (diff < 0 && safeguards < 1000) {
          if (flatQs[i % flatQs.length].points > 1) {
            flatQs[i % flatQs.length].points -= 1;
            diff++;
          }
          i++;
          safeguards++;
        }
      }
      console.log(`[Points Reallocation] Normalization complete.`);
    }

    // Merge new points back into the original structural data to preserve explanation strings etc.
    const mergedStructure = examData.structure.map((origSec, secIdx) => {
      const newSec = newStructure[secIdx] || origSec;
      return {
        ...origSec,
        sectionAnalysis: newSec.sectionAnalysis || origSec.sectionAnalysis || "",
        questions: origSec.questions.map((origQ, qIdx) => {
          const newQ = newSec.questions ? newSec.questions[qIdx] : null;
          return {
            ...origQ,
            points: newQ ? newQ.points : origQ.points
          };
        })
      };
    });

    return mergedStructure;
  } catch (error) {
    console.error("Error regenerating point allocation:", error);
    throw error;
  }
};

export const generateSectionDetailedAnalysis = async (apiKey, subjectType, sectionData, questionFiles = [], answerFiles = [], specialInstruction = "") => {
  try {
    const trimmedKey = apiKey?.trim();
    if (!trimmedKey) throw new Error("Gemini API Key is not set.");

    const genAI = new GoogleGenerativeAI(trimmedKey);
    const model = genAI.getGenerativeModel({ model: MODELS.PRIMARY });

    const imageParts = [];
    if (questionFiles && questionFiles.length > 0) {
      const qDataArray = await Promise.all(questionFiles.map(file => fileToBase64(file)));
      qDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }
    if (answerFiles && answerFiles.length > 0) {
      const aDataArray = await Promise.all(answerFiles.map(file => fileToBase64(file)));
      aDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }

    const questionType = sectionData.questionType || 'default';
    
    let basePrompt = "";
    if (subjectType === 'english') {
      if (questionType === 'grammar') {
        basePrompt = `あなたは、大学受験レベル（MARCH〜早慶）の英文法問題を解くプロ講師である。
目的は「正解を出すこと」ではなく、受験生が同じ思考を再現できるレベルで第${sectionData.id}問（${sectionData.label}）の解法を言語化することである。

【最重要前提】
・常に生徒目線で説明する
・解法は「再現可能」でなければならない
・必ず選択肢から先に見る
・正解理由だけでなく「誤答の削り方」を同時に扱う
・知識の説明ではなく「使い方」を説明する

【思考プロセス（内部実行ルール：必ず実行・出力に反映）】
① 選択肢分析（最初に必ずやる）
問題文を見る前に、選択肢を確認し、以下を判断する：
・何が問われているか（品詞／文型／時制／語法／語彙など）
・選択肢の違いはどこか（意味／形／用法）
・どの知識で切れそうか（例：自動詞/他動詞、前置詞、語法）
※この時点では答えを決めない
※「解き方の方針」を立てるだけ

② 問題文処理（文脈＋文構造）
問題文を読みながら、以下を処理する：
・文構造（主語・動詞・目的語・修飾）
・空所の役割（品詞・意味）
・文脈（前後関係・論理）
重要：
・「ここには何が入るべきか」を先に言語化する
・その後に選択肢と照合する

③ 選択肢処理（消去法中心）
各選択肢について必ず以下を行う：
・正しいかどうかの判断
・誤りの場合 → 「なぜダメか」を明確に言語化
誤りの分類：
・文法違反（形が違う）
・語法違反（使い方が違う）
・意味不一致（文脈に合わない）
・ニュアンス不適切（ズレている）

【出力順（厳守）】
① 正解
・記号 or 語句のみ
・理由は書かない

② 選択肢分析（解き方の設計）
・この問題は何を問う問題か
・選択肢の違いはどこにあるか
・どういう観点で判断するか

③ 問題文の思考プロセス
・文構造を明確にする
・空所に求められる条件を言語化
・「この時点ではこう考える」という形で説明

④ 選択肢の検討（最重要）
各選択肢について：
・正誤判断
・誤りの理由を明確化
・本文とのズレを具体的に説明
※必ず「なぜ切れるか」を書く
※正解だけ説明するのは禁止

⑤ 最終整理（再現性の言語化）
・この問題の本質（何を見抜く問題か）
・同じタイプの問題の解き方
・判断基準の一般化

【禁止事項】
・正解だけ説明する
・「なんとなく」「感覚的に」などの曖昧表現
・知識の羅列だけで終わる説明
・選択肢を見ずに解くこと
・誤答の理由を省略すること
・アスタリスク（*）記号は一切使用しないこと（太字等はHTMLタグや他の記号で代用するか使用を控える）

【出力スタイル】
・生徒が「次も解ける」ように説明する
・思考の流れを文章でつなぐ
・断定と仮説を区別する（例：「この時点では〜と考える」）
`;
      } else if (questionType === 'writing') {
        basePrompt = `あなたは難関大学入試の英語講師です。第${sectionData.id}問（${sectionData.label}）の英作文（和文英訳・自由英作文）問題について、解答のプロセスと思考法を解説してください。
【ルール】
1. 考え方のプロセスや、求められている構文・表現の意図を解説すること。
2. よくあるミスや、汎用性の高い表現を紹介すること。
3. アスタリスク（*）記号は一切使用禁止。** や * を見出し・強調に用いないこと。
`;
      } else if (questionType === 'conversation') {
        basePrompt = `あなたは難関大学入試の英語講師です。第${sectionData.id}問（${sectionData.label}）の会話文問題について、詳細な解説を作成してください。
【ルール】
1. 会話の状況設定や、登場人物の関係性を踏まえた解説を行うこと。
2. 口語表現や特有のイディオムがあれば明示し、前後の文脈からどのように正解を絞り込むかを言語化すること。
3. アスタリスク（*）記号は一切使用禁止。** や * を見出し・強調に用いないこと。
`;
      } else {
        basePrompt = `あなたは、難関大学入試（早稲田・慶應レベル）の英語長文問題を解く専門家である。
目的は「答え」ではなく、受験生が同じやり方を再現できるレベルで、第${sectionData.id}問（${sectionData.label}）の設問準備・読解・解答の思考プロセスを口語体でなく文語体で完全に言語化することである。

────────────────
【最重要前提】
・設問準備 → 読解 → 設問処理は分離されていない
・解説は「実際に問題を解いている時系列」で書く
・本文解説では、必ず英文を引用しながら進める
・日本語の解説は、必ず直前に引用した英文に対応させる
・箇条書き・矢印・処理ログ風の書き方は禁止
・受験生が「英文 ↔ 解説」を往復できる文章にする

────────────────
【1. 内部実行ルール（※出力しないが必ず実行）】

### 1-1. 設問準備（読む前）
本文を読む前に、全設問を確認し、各設問について次のみを行う：
・設問タイプの把握（傍線部説明／定義／NOT／比喩／理由 など）
・「どの段落まで読めば解けるか」の見通し
・読解中に意識すべき観点（But／抽象→具体／評価語 など）
重要：この段階では答えを作らない。やるのは「読み方の設計」だけ。

### 1-2. 読解（解きながら読む）
各段落について、必ず以下の流れで処理する：
A. 段落に入る前に、今どの設問を意識しているかを確認
B. 英文を **一文ずつ引用** する
C. その英文を読んだ瞬間に頭の中で行っている判断を、日本語の文章で説明する
D. 次の英文で、理解がどう修正・更新されたかを書く
E. But／疑問文／言い換え／抽象↔具体が出た場合は、必ず意味づけを言語化する
F. 段落を読み終えた時点で、段落の趣旨と本文全体における役割を文章でまとめる
G. この時点で解ける設問があれば、「ここまで読めばこの設問に必要な情報はそろっている」と自然な日本語で示す
重要：いきなり段落要約から入らない。必ず「英文 → 思考 → 英文 → 思考」の流れを守る。

### 1-3. 選択肢処理
選択肢問題は、正解探しではなく「誤りの言語化」で処理する。
・各誤選択肢について、本文のどこがズレているか、ズレの種類（言い過ぎ／範囲ズレ／主語述語ズレ／抽象化しすぎ等）を短い文章で明確に説明する。

────────────────
【2. 出力順（絶対厳守）】
以下の順番を必ず守る。
① 解答一覧
② 設問準備フェーズ（文章で）
③ 読みながら解くプロセス（段落ごと・英文引用必須）
④ 設問ごとの解答プロセス
⑤ 本文全文和訳
⑥ 完全解説（①〜④を統合した時系列の最終版）

────────────────
【3. 禁止事項】
・箇条書き中心の解説、処理ログ風の羅列
・英文を示さずに日本語だけで説明すること
・参考書的なまとめ先行の解説
・「なんとなく」「感覚的に」などの曖昧表現
・アスタリスク（*）記号は一切使用しないこと（太字等はHTMLタグや他の記号で代用するか使用を控える）
`;
      }
    } else if (subjectType === 'social') {
      basePrompt = `あなたは大学入試の社会科（日本史・世界史・地理）の専門講師です。第${sectionData.id}問（${sectionData.label}）について、各小問の背景知識や、資料・図表の読み方のポイントを詳細に解説してください。
【ルール】
1. 単なる正解の提示ではなく、なぜその知識が必要なのか、どう考えれば正解に辿りつくかを記述すること。
2. 誤選択肢がなぜ間違っているのか、歴史的事実に基づいて解説すること。
3. アスタリスク（*）記号は一切使用禁止。** や * を見出し・強調に用いないこと。
`;
    } else {
      basePrompt = `あなたは大学入試の専門講師です。第${sectionData.id}問（${sectionData.label}）について、各小問の解き方や考え方のプロセスを詳細に解説してください。
【ルール】
アスタリスク（*）記号は一切使用禁止。** や * を見出し・強調に用いないこと。`;
    }

    const finalPrompt = `
${basePrompt}

【対象データ（構造）】
${JSON.stringify(sectionData, null, 2)}

${specialInstruction ? `【ユーザーからの個別指示】\n${specialInstruction}\n` : ""}

【出力要件】
1. Markdown形式で記述すること。
2. アスタリスク（*）記号は使用禁止。
3. コードブロック（\`\`\`markdown）で囲まず、本文のみを出力すること。
4. **必ず日本語で記述すること。**

出力は解説本文（Markdown）のみを返してください。
`;

    const result = await withRetry(() => model.generateContent({
      contents: [{ role: 'user', parts: [{ text: finalPrompt }, ...imageParts] }],
      generationConfig: { maxOutputTokens: 65536 }
    }));

    const text = result.response.text();
    return text.replace(/```markdown\n?|```\n?|```/g, '').trim();
  } catch (error) {
    console.error("Error generating section detailed analysis:", error);
    throw error;
  }
};

export const generateSingleSectionData = async (apiKey, subjectType, sectionIndex, questionFiles, answerFiles, instruction, targetPoints) => {
  try {
    const trimmedKey = apiKey?.trim();
    if (!trimmedKey) throw new Error("Gemini API Key is not set.");
    console.log(`[AdminGeminiService] Generating section ${sectionIndex} data...`);

    const genAI = new GoogleGenerativeAI(trimmedKey);
    const model = genAI.getGenerativeModel({ model: MODELS.PRIMARY });

    const isEnglish = subjectType === 'english';
    const isSocial = subjectType === 'social';

    let subjectSpecificRules = "";
    if (isEnglish) {
      subjectSpecificRules = ENGLISH_RULES;
    } else if (isSocial) {
      subjectSpecificRules = SOCIAL_RULES;
    }

    // OCR Answer
    let answerText = "";
    if (answerFiles && answerFiles.length > 0) {
      const aDataArray = await Promise.all(answerFiles.map(file => fileToBase64(file)));
      const aInlineData = aDataArray.map(fd => ({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
      const aOcrPrompt = `以下の画像は試験の「第${sectionIndex}問」の解答です。正確にテキスト化してください。`;
      const aOcrResult = await withRetry(() => model.generateContent({
        contents: [{ role: 'user', parts: [...aInlineData, { text: aOcrPrompt }] }],
        generationConfig: { maxOutputTokens: 2048 }
      }));
      answerText = aOcrResult.response.text();
    }

    // OCR Question
    let questionText = "";
    if (questionFiles && questionFiles.length > 0) {
      const qDataArray = await Promise.all(questionFiles.map(file => fileToBase64(file)));
      const qInlineData = qDataArray.map(fd => ({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
      const qOcrPrompt = `以下の画像は試験の「第${sectionIndex}問」の問題です。正確にテキスト化してください。`;
      const qOcrResult = await withRetry(() => model.generateContent({
        contents: [{ role: 'user', parts: [...qInlineData, { text: qOcrPrompt }] }],
        generationConfig: { maxOutputTokens: 8192 }
      }));
      questionText = qOcrResult.response.text();
    }

    const targetPointsRule = targetPoints ? `\n【重要：目標配点】\nこの大問の小問群の \`points\` の合計がぴったり **${targetPoints}** 点 になるように必ず割り振ってください。（各小問の配点は1以上の自然数であること）\n` : `\n【配点ルール】\n問題数や難易度に合わせて自然な点数（1以上の自然数）を割り振ってください。\n`;

    const extractPrompt = `
以下の試験素材を分析し、**第${sectionIndex}問**に関する設問データ（構造、正解、配点、詳細解説）を一斉に生成してください。

【第${sectionIndex}問 問題テキスト】
${questionText || "（なし）"}

【第${sectionIndex}問 解答テキスト】
${answerText || "（なし）"}

${instruction ? `【個別指示】\n${instruction}\n` : ""}
${subjectSpecificRules}
${targetPointsRule}

【抽出条件と厳格ルール】
1. この大問（第${sectionIndex}問）の中に含まれる小問を全て抽出すること。
2. アスタリスク（*）記号を絶対に使用しないでください。
3. 選択問題の \`options\` 配列には、記号・番号（例: "1", "a", "ア" など）のみを含めてください。
4. 各小問の \`explanation\` および大問の \`sectionAnalysis\` は、**必ず日本語で** 記述してください。正解を導くための論理的で丁寧な解説と、誤答の理由を含めること。
5. 必ず以下のJSON構造（オブジェクト1つ）のみを出力してください。

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
      "explanation": "なぜこれが正解なのかの解説"
    }
  ]
}
`;

    const result = await withRetry(() => model.generateContent({
      contents: [{ role: 'user', parts: [{ text: extractPrompt }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 }
    }), 5, 5000);

    const sectionRaw = result.response.text();
    const parsedSection = JSON.parse(sanitizeJson(sectionRaw));
    if (!parsedSection.sectionAnalysis) parsedSection.sectionAnalysis = "";
    
    return parsedSection;

  } catch (error) {
    console.error(`[AdminGeminiService] Failed to generate section ${sectionIndex}:`, error);
    throw error;
  }
};
