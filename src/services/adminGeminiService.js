import { GoogleGenerativeAI } from "@google/generative-ai";

const MODELS = {
  PRIMARY: "gemini-2.0-flash",
  FALLBACK: "gemini-1.5-flash"
};

const ENGLISH_RULES = `
【最重要前提】
 • 採点は AIが自動で行うこと を前提とする
 • 「総合判断」「感覚的評価」は禁止
 • 設問タイプごとに、配点が異なる理由を必ず言語化すること
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
　- 要素数と要素充足条件を "gradingCriteria" または "explanation" 内に明記する
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

export const generateExamMasterData = async (apiKey, subjectType, questionFiles, answerFiles, extraInfo) => {
  try {
    const trimmedKey = apiKey?.trim();
    console.log("[AdminGeminiService] Using model:", MODELS.PRIMARY);

    if (!trimmedKey) {
      console.error("[AdminGeminiService] CRITICAL: apiKey parameter is empty or undefined");
      throw new Error("Gemini API Key is not set. .env.localファイルを確認し、開発サーバーを再起動（Ctrl+Cして npm run dev）してください。");
    }

    let genAI;
    try {
      genAI = new GoogleGenerativeAI(trimmedKey);
    } catch (err) {
      console.error("[AdminGeminiService] Failed to initialize GoogleGenerativeAI:", err);
      throw new Error("Gemini APIの初期化に失敗しました。APIキーの形式が正しくない可能性があります。");
    }

    let model;
    try {
      model = genAI.getGenerativeModel({
        model: MODELS.PRIMARY,
        // tools: [{ googleSearch: {} }]
      });
    } catch (err) {
      console.error("[AdminGeminiService] Failed to get generative model:", err);
      throw new Error(`モデル "${MODELS.PRIMARY}" の読み込みに失敗しました。`);
    }

    const isEnglish = subjectType === 'english';
    const isSocial = subjectType === 'social';

    let subjectSpecificRules = "";
    if (isEnglish) {
      subjectSpecificRules = ENGLISH_RULES + `
※ 重要: 本システムでは最終出力として必ず指定された JSON 形式が必要です。
上記の【出力形式（厳守）】の要件に従った思考プロセス（分類、配点理由、要素分解、全体チェック）は、必ず最終JSON形式の「説明用フィールド」（例：detailedAnalysisやexplanationなど）に含めて出力してください。
さらに、【最重要事項】として、計算されたすべての小問配点の合計が、入力として指定された満点（${extraInfo?.maxScore || '指定なし'}点）と完全に一致するように調整してください。
`;
    } else if (isSocial) {
      subjectSpecificRules = SOCIAL_RULES + `
※ 重要: 本システムでは最終出力として必ず指定された JSON 形式が必要です。
上記の【出力形式（厳守）】の要件に従った思考プロセス（分類、配点理由、要素分解、全体チェック）は、必ず最終JSON形式の「説明用フィールド」（例：detailedAnalysisやexplanationなど）に含めて出力してください。
さらに、【最重要事項】として、計算されたすべての小問配点の合計が、入力として指定された満点（${extraInfo?.maxScore || '指定なし'}点）と完全に一致するように調整してください。
`;
    } else {
      subjectSpecificRules = `
一般的な科目として、設問の難易度や形式に応じて常識的な配点を行ってください。
ただし、以下の条件を必ず守ること：
1. 最終的な合計点は全体で指定された満点（maxScore）と一致するよう調整すること。
2. 特定の1問に10点以上の異常に高い配点を割り振らないこと。極端な偏りを防ぎ、問題数に応じて自然に点数を分散させること。
`;
    }

    const questionFileDataArray = await Promise.all(questionFiles.map(file => fileToBase64(file)));
    const answerFileDataArray = await Promise.all(answerFiles.map(file => fileToBase64(file)));

    const questionInlineData = questionFileDataArray.map(fd => ({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    const answerInlineData = answerFileDataArray.map(fd => ({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    const outputId = extraInfo.id;

    // --- STAGE 0: FULL OCR TRANSCRIPTION (The Foundation) ---
    console.log(`[Stage 0] Transcribing all documents to text...`);
    const totalFilesCount = questionFiles.length + answerFiles.length;
    const ocrPrompt = `
あなたはプロのデータ入力スペシャリスト兼入試分析官です。
今回、合計【${totalFilesCount}枚】のファイル（問題と解答）が提供されています。
これら【${totalFilesCount}枚】すべての画像を端から端まで詳細に読み取り、試験内容を「絶対に途中で省略・欠落させず、すべて正確に」マークダウン形式のテキストとして書き出してください。

【出力要件】
1. ページの順序を守り、ページ番号または「第1問」「問題」などの見出しで区切ること。
2. 小問の記号（問1、(a)、1..等）や選択肢の内容を正確に書き起こすこと。
3. 表や特殊な配置も、可能な限りテキストで理解できるように記述すること。
4. 本文、設問、解答のすべてを含めること。
5. 出力はテキストのみとしてください（Markdown形式が好ましい）。

このテキストは、以降のすべての詳細解析の「唯一のソース」となります。
`;

    const ocrResult = await withRetry(() => model.generateContent({
      contents: [{
        role: 'user', parts: [
          ...questionInlineData.map(d => ({ inlineData: d.inlineData })),
          ...answerInlineData.map(d => ({ inlineData: d.inlineData })),
          { text: ocrPrompt }
        ]
      }],
      generationConfig: {
        maxOutputTokens: 8192,
      }
    }));

    const transcribedText = ocrResult.response.text();
    console.log(`[Stage 0] Transcription complete. Length: ${transcribedText.length} characters.`);

    // --- STEP 1a: OVERVIEW EXTRACTION (Using transcribed text) ---
    console.log(`[Step 1/3] Extracting high-level exam structure for ${outputId}...`);
    const step1aPrompt = `
以下の試験内容（テキストデータ）を分析し、試験の全体構造（大問のIDとラベルのみ）を抽出してください。
満点は事前に「${extraInfo.maxScore}点」と指定されています。各大問に合計何点を配分すべきかを推測してください。

【解析対象データ】
${transcribedText}

【厳格ルール】
1. JSON形式のみを出力してください。
2. アスタリスク（*）記号を絶対に使用しないでください。
3. 全ての大問の 推測配分 (allocatedPoints) の合計が、必ず指定された満点（${extraInfo.maxScore}点）と一致するように調整してください。
${subjectSpecificRules}

【出力構造】
{
  "maxScore": ${extraInfo.maxScore},
  "sections": [
    {
      "id": "I",
      "label": "第1問（長文読解）",
      "allocatedPoints": 40
    }
  ]
}
`;

    const result1a = await withRetry(() => model.generateContent(step1aPrompt), 5, 3000);

    const overviewText = result1a.response.text();
    const overviewData = JSON.parse(sanitizeJson(overviewText));
    console.log(`[Step 1a] Structure found: ${overviewData.sections.length} sections. Total points: ${overviewData.maxScore}`);

    // Add a small delay between text-only requests
    await new Promise(resolve => setTimeout(resolve, 2000));

    // --- STEP 1b: ALL SECTIONS IN ONE REQUEST ---
    // Instead of sending one request per section (which causes 429 rate limit errors),
    // we send a single request asking the AI to extract all sections at once.
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log(`[Step 2/3] Extracting ALL ${overviewData.sections.length} sections in a single request...`);

    const sectionsSummary = overviewData.sections.map(s =>
      `- 大問 ${s.id}（${s.label}）: 合計 ${s.allocatedPoints} 点`
    ).join('\n');

    const step1bPrompt = `
以下の試験内容（テキストデータ）を分析し、すべての大問・小問について、正解と配点のみを抽出してください。

【解析対象データ】
${transcribedText}

【大問一覧と配点指示】
${sectionsSummary}

【厳格ルール】
1. 各大問の小問配点の合計は、上記で指定した点数と一致させること。
2. 小問の正解と配点のみ、explanationフィールドは必ず空文字列を設定すること。
3. アスタリスク（*）記号を絶対に使用しないでください。
4. 以下のJSON構造のみを出力してください（コードブロックなし）。
5. gradingCriteriaフィールドは一切含めないでください。
${subjectSpecificRules}

【出力構造】
[
  {
    "id": "I",
    "label": "大問ラベル",
    "allocatedPoints": 40,
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
]
`;

    const result1b = await withRetry(() => model.generateContent({
      contents: [{ role: 'user', parts: [{ text: step1bPrompt }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 }
    }), 10, 5000);
    const allSectionsRaw = result1b.response.text();
    const allSectionsSanitized = sanitizeJson(allSectionsRaw);

    let parsedSections;
    try {
      parsedSections = JSON.parse(allSectionsSanitized);
    } catch (err) {
      console.error('[AdminGeminiService] Failed to parse all sections. Raw length:', allSectionsSanitized.length);
      console.error('[AdminGeminiService] First 1000 chars:', allSectionsSanitized.substring(0, 1000));
      console.error('[AdminGeminiService] Last 200 chars:', allSectionsSanitized.slice(-200));
      throw new Error(`全セクションの解析に失敗しました。AIの回答が正しいJSON形式ではありません。(解析: ${err.message})`);
    }

    console.log(`[Step 2/3] Successfully extracted ${parsedSections.length} sections.`);

    // Support both flat (old) and the new sections-with-questions format
    const fullSections = parsedSections.map(sec => ({
      id: sec.id,
      label: sec.label,
      allocatedPoints: sec.allocatedPoints,
      questions: sec.questions || []
    }));

    const structureData = {
      maxScore: overviewData.maxScore,
      structure: fullSections
    };

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
      id: outputId,
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
3. アスタリスク（*）記号は使用禁止。マークダウンは使ってよい。
4. 长すぎる解説は不要。受験生が「なるほど」と思える最小限の説明で十分。

出力は解説本文のみ（マークダウン）。
`;

    // Use non-streaming for better error reporting and to avoid stream parsing issues
    const result = await withRetry(() => model.generateContent([
      prompt,
      ...imageParts
    ]));

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
      prompt = `あなたは大学入試の専門講師です。提供された問題と解答のファイル、および抽出された構造データをもとに、試験の「全体詳細解説（Markdown形式）」を作成してください。

【試験データ構造】
${JSON.stringify({ maxScore: examData.max_score, structure: examData.structure }, null, 2)}

【要件】
1. 受験生が復習する際に役立つよう、大問ごとに丁寧な解説を記述すること。
2. マークダウン形式（見出し、箇条書き、太字等）を用いて読みやすく構造化すること。
3. コードブロック表記（\`\`\`markdown など）で全体を囲まないこと。本文のみを出力すること。

出力は解説本文（Markdown）のみを返してください。
`;
    }

    const result = await withRetry(() => model.generateContent([
      prompt,
      ...imageParts
    ]));

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
4. JSONのみを出力してください。Markdownのコードブロック（\`\`\`json など）は除外し、純粋なJSON文字列だけにすること。

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
