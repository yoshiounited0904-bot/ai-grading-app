import { GoogleGenerativeAI } from "@google/generative-ai";

const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-pro",
  "gemini-1.5-pro"
];

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

  // Rescue for truncation: 
  
  // 1. If it ends with a comma, remove it as it breaks JSON.parse
  clean = clean.replace(/,\s*$/g, "");
  clean = clean.replace(/,\s*([\}\]])/g, "$1");

  // 2. Add missing closing quotes if it's truncated mid-string
  const quoteCount = (clean.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    clean += '"';
  }

  // 3. Add missing closing brackets/braces in the CORRECT order using a stack
  const stack = [];
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}') {
      if (stack[stack.length - 1] === '}') stack.pop();
    } else if (char === ']') {
      if (stack[stack.length - 1] === ']') stack.pop();
    }
  }

  // Append missing closers in reverse order
  while (stack.length > 0) {
    clean += stack.pop();
  }

  return clean;
};

// --- RETRY & FALLBACK UTILITY FOR 429/503 ERRORS ---
const generateContentWithFallback = async (genAI, requestData, maxRetriesPerModel = 5, initialDelay = 5000) => {
  const errors = [];
  for (const modelName of MODELS) {
    const model = genAI.getGenerativeModel({ model: modelName });
    let attempt = 0;
    while (attempt < maxRetriesPerModel) {
      try {
        console.log(`[GeminiService] Attempting generation with model: ${modelName} (Attempt ${attempt + 1}/${maxRetriesPerModel})`);
        return await model.generateContent(requestData);
      } catch (error) {
        attempt++;
        const isRetryable = (error.status === 429 || error.status === 503 || error.status === 504) ||
          (error.message?.includes("429")) ||
          (error.message?.includes("503")) ||
          (error.message?.includes("Resource exhausted")) ||
          (error.message?.includes("Too many requests")) ||
          (error.message?.includes("overloaded")) ||
          (error.message?.includes("high demand")) ||
          (error.message?.includes("Load failed")) ||
          (error.message?.includes("fetch"));

        if (isRetryable && attempt < maxRetriesPerModel) {
          const delay = Math.min(30000, initialDelay * Math.pow(2, attempt - 1));
          console.warn(`[GeminiService] Model ${modelName} hit error (${error.status || error.message}). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetriesPerModel})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        console.warn(`[GeminiService] Model ${modelName} failed after ${attempt} attempts. Error: ${error.message}`);
        errors.push({ model: modelName, error });
        break; // Break inner loop, try next model in the outer loop
      }
    }
  }
  
  // If we reach here, all models failed. Throw the first error (from primary model) but append info about others.
  if (errors.length > 0) {
    const primaryError = errors[0].error;
    primaryError.message = `[All Fallback Models Failed] Primary Error: ${primaryError.message} | Other models tried: ${errors.slice(1).map(e => e.model).join(", ")}`;
    throw primaryError;
  }
  throw new Error("Unknown error in generateContentWithFallback: All models failed but no errors caught.");
};

// Helper function to convert either a File object or a URL string to base64
const anySourceToBase64 = async (source) => {
  if (!source) return null;

  // Case 1: source is already a File/Blob object
  if (source instanceof File || source instanceof Blob) {
    return new Promise((resolve, reject) => {
      const isImage = source.type.startsWith('image/');
      if (isImage) {
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const reader = new FileReader();

        reader.onload = (e) => {
          img.onload = () => {
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
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const base64String = dataUrl.split(',')[1];
            resolve({ data: base64String, mimeType: 'image/jpeg' });
          };
          img.onerror = () => reject(new Error('Failed to load image for compression'));
          img.src = e.target.result;
        };
        reader.onerror = error => reject(error);
        reader.readAsDataURL(source);
      } else {
        const reader = new FileReader();
        reader.readAsDataURL(source);
        reader.onload = () => {
          const base64String = reader.result.split(',')[1];
          resolve({ data: base64String, mimeType: source.type });
        };
        reader.onerror = error => reject(error);
      }
    });
  }

  // Case 2: source is a URL string
  if (typeof source === 'string') {
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const blob = await response.blob();
      
      // If it's a PDF, we don't need further processing beyond base64
      if (blob.type === 'application/pdf') {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64String = reader.result.split(',')[1];
            resolve({ data: base64String, mimeType: blob.type });
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      
      // If it's an image, use the recursive logic above to compress it
      return anySourceToBase64(blob);
    } catch (err) {
      console.error(`Failed to fetch source from URL: ${source}`, err);
      throw new Error(`ファイルを取得できませんでした: ${source}`);
    }
  }

  return null;
};

export const generateExamMasterData = async (apiKey, subjectType, questionFiles, questionFilesBySection, answerFilesBySection, sectionInstructionsBySection, sectionPointsBySection, extraInfo) => {
  try {
    const trimmedKey = apiKey?.trim();
    console.log("[AdminGeminiService] Using model:", MODELS[0]);

    if (!trimmedKey) {
      console.error("[AdminGeminiService] CRITICAL: apiKey parameter is empty or undefined");
      throw new Error("Gemini API Key is not set. .env.localファイルを確認し、開発サーバーを再起動（Ctrl+Cして npm run dev）してください。");
    }

    const genAI = new GoogleGenerativeAI(trimmedKey);

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
      const qDataArray = (await Promise.all(questionFiles.map(file => anySourceToBase64(file)))).filter(Boolean);
      const qInlineData = qDataArray.map(fd => ({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));

      const qOcrPrompt = `提供された問題用紙の画像を正確にテキスト化してください。`;
      const qOcrResult = await generateContentWithFallback(genAI, {
        contents: [{ role: 'user', parts: [...qInlineData, { text: qOcrPrompt }] }],
        generationConfig: { maxOutputTokens: 8192 }
      });
      commonQuestionText = qOcrResult.response.text();
    }

    // --- STAGE 1: PER-SECTION PROCESSING ---
    const extractedSections = [];
    const sectionsCount = Object.keys(answerFilesBySection).length;

    for (const [sectionIndex, rawAnswerFiles] of Object.entries(answerFilesBySection)) {
      if (!rawAnswerFiles || rawAnswerFiles.length === 0) continue;

      console.log(`[Stage 1] Processing section ${sectionIndex} / ${sectionsCount} with multimodal AI...`);

      // 1a. Prepare Answer Images
      const aDataArray = await Promise.all(rawAnswerFiles.map(file => anySourceToBase64(file)));
      const aInlineData = aDataArray.map(fd => ({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));

      // 1b. Prepare Question Images
      const rawQuestionFiles = questionFilesBySection[sectionIndex] || [];
      const qDataArray = await Promise.all(rawQuestionFiles.map(file => anySourceToBase64(file)));
      const qInlineData = qDataArray.map(fd => ({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));

      // 1c. Consolidated Multimodal Prompt
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
        contents: [{ role: 'user', parts: [...qInlineData, ...aInlineData, { text: extractPrompt }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 }
      }, 5, 4000);

      const sectionRaw = extractResult.response.text();
      try {
        const parsedSection = JSON.parse(sanitizeJson(sectionRaw));
        if (!parsedSection.sectionAnalysis) parsedSection.sectionAnalysis = "";
        extractedSections.push(parsedSection);
      } catch (err) {
        console.error(`[AdminGeminiService] Failed to parse section ${sectionIndex}:`, err);
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
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

    const pointsResult = await generateContentWithFallback(genAI, {
      contents: [{ role: 'user', parts: [{ text: pointsPrompt }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 }
    });

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
    console.log("[AdminGeminiService] Explanation - Using model:", MODELS[0]);
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

    const imageParts = [];
    if (questionFiles && questionFiles.length > 0) {
      const qDataArray = (await Promise.all(questionFiles.map(file => anySourceToBase64(file)))).filter(Boolean);
      qDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }
    if (answerFiles && answerFiles.length > 0) {
      const aDataArray = (await Promise.all(answerFiles.map(file => anySourceToBase64(file)))).filter(Boolean);
      aDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }

    const prompt = `あなたは大学入試の専門講師です。
受験生が【2〜3分で読み切れて、かつ深く納得できる】、論理的で濃密な解説を作成してください。
必ず【添付されている画像（問題用紙および解答用紙）】を隅々まで読み取り、対象設問の根拠を特定してください。

【対象の設問（構造データ）】
${JSON.stringify(questionData, null, 2)}

【絶対厳守の構成ルール】
1. **具体的な根拠の引用**:
   - 「本文の記述から〜」といった抽象的な表現は【厳禁】です。
   - 必ず「第◯段落の◯行目」や「『〜〜』という記述」など、本文の具体的な箇所を明示的に引用してください。
2. **正解への論理プロセス**:
   - なぜその答えになるのか、思考のステップを2〜3分で理解できるよう簡潔かつ明快に記述してください。
3. **誤答の徹底分析**:
   - 正解の理由を述べるだけでなく、「主要な誤答選択肢がなぜ間違いなのか」についても具体的に（例：因果関係が逆、記述が不足、本文にない内容、など）触れてください。
4. **文章スタイル**:
   - 受験生が納得し、次の問題に活かせる教育的なトーン。
   - 改行は適切に行い（1〜3回程度）、読みやすさを重視してください。
   - アスタリスク（*）などの記号による装飾は一切使用しないでください。

【NG例（このような回答は絶対にしないでください）】
「本文の内容から判断すると、3が最も適切です。他の選択肢は本文の内容と一致しません。」
（理由：根拠が不明確で、受験生の学習に役立たないため）

出力は解説本文のみ（プレーンテキスト）を返してください。
`;

    const result = await generateContentWithFallback(genAI, {
      contents: [{ role: 'user', parts: [{ text: prompt }, ...imageParts] }],
      generationConfig: { maxOutputTokens: 8192 }
    });

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
    console.log("[AdminGeminiService] Detailed Analysis - Using model:", MODELS[0]);

    if (!trimmedKey) {
      throw new Error("Gemini API Key is not set.");
    }

    let genAI;
    try {
      genAI = new GoogleGenerativeAI(trimmedKey);
    } catch (err) {
      throw new Error("Gemini APIの初期化に失敗しました。");
    }

    const imageParts = [];
    if (questionFiles && questionFiles.length > 0) {
      const qDataArray = (await Promise.all(questionFiles.map(file => anySourceToBase64(file)))).filter(Boolean);
      qDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }
    if (answerFiles && answerFiles.length > 0) {
      const aDataArray = (await Promise.all(answerFiles.map(file => anySourceToBase64(file)))).filter(Boolean);
      aDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }

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
      contents: [{ role: 'user', parts: [{ text: prompt }, ...imageParts] }],
      generationConfig: { maxOutputTokens: 65536 }
    });

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
    console.log("[AdminGeminiService] Points Reallocation - Using model:", MODELS[0]);

    if (!trimmedKey) {
      throw new Error("Gemini API Key is not set.");
    }

    let genAI;
    try {
      genAI = new GoogleGenerativeAI(trimmedKey);
    } catch (err) {
      throw new Error("Gemini APIの初期化に失敗しました。");
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
      const qDataArray = (await Promise.all(questionFiles.map(file => anySourceToBase64(file)))).filter(Boolean);
      qDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }
    if (answerFiles && answerFiles.length > 0) {
      const aDataArray = (await Promise.all(answerFiles.map(file => anySourceToBase64(file)))).filter(Boolean);
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
    const result = await generateContentWithFallback(genAI, [
      prompt,
      ...imageParts
    ]);

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

export const generateSectionDetailedAnalysis = async (apiKey, subjectType, sectionData, questionFiles = [], answerFiles = [], specialInstruction = "", subjectName = "") => {
  try {
    const trimmedKey = apiKey?.trim();
    if (!trimmedKey) throw new Error("Gemini API Key is not set.");

    const genAI = new GoogleGenerativeAI(trimmedKey);

    const imageParts = [];
    if (questionFiles && questionFiles.length > 0) {
      const qDataArray = (await Promise.all(questionFiles.map(file => anySourceToBase64(file)))).filter(Boolean);
      qDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }
    if (answerFiles && answerFiles.length > 0) {
      const aDataArray = (await Promise.all(answerFiles.map(file => anySourceToBase64(file)))).filter(Boolean);
      aDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }

    const questionType = sectionData.questionType || 'default';
    
    let basePrompt = "";
    if (subjectName && subjectName.includes('日本史')) {
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

例：

・政治史
・外交史
・土地制度史
・経済史
・文化史
・宗教史
・社会史
・近代化政策
・戦後史

ただし、
問題文から判断できないことは断定しない。

③ 解答に必要な知識の提示

解答に必要な知識だけを提示する。

・1項目につき1〜2行で説明する
・問題に不要な知識は出さない
・細かい年号は出さない
・必要な場合のみ、
  「鎌倉初期」
  「幕末」
  「高度経済成長期」
などの大まかな時代区分を示す

④ 解答プロセス

問題文・資料・選択肢をもとに、
どのように正解へ到達するかを説明する。

必ず以下の順で処理する。

・まず時代を確認する
・次に政治権力を確認する
・次に制度・政策を確認する
・最後に設問要求に合わせて選択肢を処理する

説明では、

「この語句があるため、この時代に絞れる」
「この制度はこの政治権力と結びつく」
「この選択肢は人物は正しいが、時代が違う」

のように、
判断理由を明確にする。

また、
最初から正解を知っていたように説明してはいけない。

問題文・資料・選択肢を読む順番に沿って、

「この時点ではまだ断定できない」
「この情報で時代がほぼ確定する」
「この選択肢は一見正しそうだが、制度がズレる」

という認識変化を時系列で説明する。

⑤ 誤答分析

誤答選択肢について、
なぜ誤りなのかを説明する。

誤りの種類を必ず分類する。

分類例：

・時代ズレ
・人物混同
・制度混同
・文化混同
・政治権力混同
・因果関係の逆転
・範囲の言い過ぎ
・問題文条件不一致

誤答分析では、
「なんとなく違う」ではなく、
どこがどう違うかを短く明確に説明する。

⑥ 周辺知識（※条件付き）

周辺知識は、
以下の条件をすべて満たす場合のみ扱う。

・問題テーマと直接関係する
・同型問題で再利用できる
・高校日本史教科書レベルで確実である
・新しい論点を追加しない

扱う場合は、
「この問題から一般化できる知識」
として説明する。

禁止する周辺知識：

・問題と直接関係しない人物
・細かい文化史知識
・研究レベルの学説
・雑学
・用語集的な羅列

⑦ 同型問題への応用

最後に、
この問題と同じタイプの問題を解く際の考え方を示す。

必ず以下の観点で整理する。

・まず何を見るべきか
・どの混同に注意すべきか
・どの知識で判断するか

例：

「江戸時代の改革問題では、
まず将軍名と政策目的を確認する。
享保・寛政・天保改革は、
財政再建・農村統制・風紀統制など共通点もあるため、
人物・政策・時代背景をセットで整理することが重要である。」

【史料問題の扱い】

史料問題では、
まず以下を確認する。

・発言主体
・時代
・政治的立場
・制度との関係
・用語の特徴

史料から読み取れないことは断定しない。

また、
現代語訳的な説明だけで終わらせず、

「なぜこの表現になるのか」
まで必要最小限で説明する。

【文化史問題の扱い】

文化史問題では、
単なる作品暗記にしない。

必要な場合のみ、

・どの時代の文化か
・どの政治権力と関係するか
・どの社会層と結びつくか

を確認する。

ただし、
細かい美術史説明はしない。

【経済史問題の扱い】

経済史問題では、
制度と社会変化を接続する。

確認する観点：

・誰が利益を得たか
・支配構造がどう変化したか
・財政とどう結びつくか
・農村・都市へどう影響したか

ただし、
問題に不要な経済理論説明はしない。

【近現代史問題の扱い】

近現代史では、
細かい条約名や年号を増やしすぎない。

必要な場合のみ、

・中央集権化
・近代化
・帝国主義
・政党政治
・総力戦体制
・民主化
・高度経済成長

などの大きな流れと接続する。

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
    } else if (subjectName && subjectName.includes('世界史')) {
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

【世界史特有の注意点】

世界史では、単なる用語知識ではなく、
以下のズレを正確に処理すること。

・時代ズレ
例：古代／中世／近世／近代の混同

・地域ズレ
例：西アジア・中央アジア・南アジア・東南アジア・ヨーロッパ・中国の混同

・王朝ズレ
例：アッバース朝とウマイヤ朝、唐と宋、ローマ帝国とビザンツ帝国などの混同

・宗教ズレ
例：キリスト教、イスラーム、仏教、ヒンドゥー教、儒教の政治的役割の混同

・制度ズレ
例：科挙、封建制、荘園制、イクター制、マンサブダーリー制などの混同

・交易圏ズレ
例：地中海交易、インド洋交易、シルクロード、大西洋三角貿易などの混同

【因果関係ルール】

・因果関係は最大3ステップまでとする

・明確に教科書レベルで成立する関係のみ使用する

・因果が曖昧な場合は接続しない

・因果関係を説明する場合は、必ず以下の形で限定する

「AによってBが起こり、その結果Cにつながる」

ただし、A・B・Cのいずれかが教科書レベルで確実でない場合は説明しない。

【解説方針】

長文解説とするが、情報量を無理に増やすのではなく、
既知情報を分解して丁寧に説明する。

解説の厚みは、以下の要素で出す。

・用語の定義
・時代背景
・地域背景
・国家・王朝の位置づけ
・宗教・思想との関係
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
・ユーザー指定の正解がある場合は、それを前提にする

② 問題の論点整理

この問題が何を問うているかを整理する。

必ず以下を確認する。

・どの時代の問題か
・どの地域の問題か
- どの国家・王朝・勢力の問題か
・どのテーマの問題か
  例：政治史、外交史、社会経済史、文化史、宗教史、交易史、革命史など

ただし、問題文から判断できないことは断定しない。

③ 解答に必要な知識の提示

解答に必要な知識だけを提示する。

・1項目につき1〜2行で説明する
・問題に不要な知識は出さない
・細かい年号は出さない
・必要な場合のみ、おおまかな時代区分を示す
  例：「19世紀後半」「中世ヨーロッパ」「宋代」「イスラーム帝国期」など

④ 解答プロセス

問題文・選択肢・資料をもとに、
どのように正解へ到達するかを説明する。

必ず以下の順で処理する。

・まず時代を確認する
・次に地域を確認する
・次に国家・王朝・勢力を確認する
・最後に設問の要求に合わせて選択肢を処理する

説明では、

「この語句があるため、この時代・地域に絞れる」
「この選択肢は時代は近いが、地域が違う」
「この選択肢は人物は正しいが、政策が違う」

のように、判断理由を明確にする。

⑤ 誤答分析

誤答選択肢について、
なぜ誤りなのかを説明する。

誤りの種類を必ず分類する。

分類例：

・時代ズレ
・地域ズレ
・人物混同
・王朝混同
・制度混同
・宗教混同
・因果関係の逆転
・範囲の言い過ぎ
・問題文の条件不一致

誤答分析では、
「なんとなく違う」ではなく、
どこがどう違うのかを短く明確に説明する。

⑥ 周辺知識（※条件付き）

周辺知識は、以下の条件をすべて満たす場合のみ扱う。

・問題テーマと直接関係する
・同型問題で再利用できる
・高校世界史教科書レベルで確実である
・新しい論点を追加しない

扱う場合は、
「この問題から一般化できる知識」として説明する。

禁止する周辺知識：

・問題と直接関係しない地域への展開
・細かい文化史・人物史の追加
・用語集的な羅列
・研究レベルの補足
・雑学的説明

⑦ 同型問題への応用

最後に、この問題と同じタイプの問題を解くときの考え方を示す。

必ず以下の観点で整理する。

・まず何を見るべきか
・どの混同に注意すべきか
・どの知識を使えば判断できるか

例：

「イスラーム史の正誤問題では、まず王朝名と地域を確認する。ウマイヤ朝・アッバース朝・セルジューク朝・オスマン帝国は、時代も地域も役割も異なるため、人物や制度を混同しないことが重要である。」

【資料問題の扱い】

地図・史料・図版・年表がある場合は、
必ず資料から読み取れる情報を優先する。

資料問題では、以下を確認する。

・地図なら、地域・交易路・勢力範囲
・史料なら、発言者・時代・宗教・政治的立場
・図版なら、文化圏・宗教的特徴・様式
・年表なら、前後関係・因果関係・同時代性

資料から読み取れないことは断定しない。

【文化史問題の扱い】

文化史問題では、
単に作品名・人物名を暗記事項として扱わない。

必要な場合のみ、以下を確認する。

・どの時代の文化か
・どの地域の文化か
・どの宗教・思想と関係するか
・政治権力とどう関係するか

ただし、細かい作品解説や美術史的説明はしない。

【宗教史問題の扱い】

宗教史問題では、
教義そのものを深掘りしすぎない。

入試解説として必要な範囲で、

・成立地域
・拡大した地域
・政治権力との関係
・他宗教との対立や共存

を整理する。

【経済史・交易史問題の扱い】

経済史・交易史問題では、
必ず地域間のつながりを意識する。

ただし、説明は問題に必要な範囲に限定する。

確認する観点：

・どの地域とどの地域が結びついたか
・何が取引されたか
・どの国家・勢力が利益を得たか
・政治や社会にどのような影響を与えたか

【近現代史問題の扱い】

近現代史では、
細かい条約名・会議名・年号を不用意に増やさない。

必要な場合のみ、

・帝国主義
・ナショナリズム
・革命
・世界大戦
・冷戦
・脱植民地化

などの大きな構造と接続する。

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
・「覚えていれば解ける」で済ませること

【内部検証（必須）】

出力前に以下を必ず確認する。

1. 問題から逸脱していないか

2. 一般的教科書レベルを超えていないか

3. 因果関係に飛躍がないか

4. 誤答分析が問題文・選択肢・知識と整合しているか

5. 時代・地域・王朝・宗教・制度を混同していないか

6. 周辺知識が問題テーマと直接関係しているか

7. 早慶レベルの受験生が再現できる解法になっているか`;
    } else if (subjectType === 'english') {
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

    const result = await generateContentWithFallback(genAI, {
      contents: [{ role: 'user', parts: [{ text: finalPrompt }, ...imageParts] }],
      generationConfig: { maxOutputTokens: 65536 }
    });

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

    const isEnglish = subjectType === 'english';
    const isSocial = subjectType === 'social';

    let subjectSpecificRules = "";
    if (isEnglish) {
      subjectSpecificRules = ENGLISH_RULES;
    } else if (isSocial) {
      subjectSpecificRules = SOCIAL_RULES;
    }

    // 1. Prepare Answer Images
    const aDataArray = await Promise.all(answerFiles.map(file => anySourceToBase64(file)));
    const aInlineData = aDataArray.filter(Boolean).map(fd => ({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));

    // 2. Prepare Question Images
    const qDataArray = await Promise.all(questionFiles.map(file => anySourceToBase64(file)));
    const qInlineData = qDataArray.filter(Boolean).map(fd => ({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));

    const targetPointsRule = targetPoints ? `\n【重要：目標配点】\nこの大問の小問群の \`points\` の合計がぴったり **${targetPoints}** 点 になるように必ず割り振ってください。（各小問の配点は1以上の自然数であること）\n` : `\n【配点ルール】\n問題数や難易度に合わせて自然な点数（1以上の自然数）を割り振ってください。\n`;

    const extractPrompt = `
あなたは大学入試の専門家です。提供された画像（問題用紙および解答用紙）を詳細に分析し、**第${sectionIndex}問**に関する設問データ（構造、正解、配点、詳細解説）を一斉に生成してください。

【入力素材】
・添付画像から問題と解答の関係を読み取り、正確なデータを作成してください。
${instruction ? `【個別指示】\n${instruction}\n` : ""}
${subjectSpecificRules}
${targetPointsRule}

【抽出条件と厳格ルール】
1. この大問（第${sectionIndex}問）の中に含まれる小問を全て抽出すること。
2. アスタリスク（*）記号を絶対に使用しないでください。
3. 選択問題の \`options\` 配列には、記号・番号（例: "1", "a", "ア" など）のみを含めてください。
4. 【重要】各小問の \`explanation\` には、正解の根拠や他がダメな理由を【必ず2〜3文以内（約50〜100文字程度）】の非常に簡潔な文章で生成して埋めてください。大問全体の \`sectionAnalysis\` は必ず空文字 ("") に設定してください。
5. 必ず以下のJSON構造（オブジェクト1つ）のみを出力してください。
6. 画像からの読み取りミス（OCRミス）がないよう、特に記号や数値は慎重に確認してください。

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
      "explanation": "..."
    }
  ]
}
`;

    const result = await generateContentWithFallback(genAI, {
      contents: [{ role: 'user', parts: [...qInlineData, ...aInlineData, { text: extractPrompt }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 }
    }, 5, 5000);

    const sectionRaw = result.response.text();
    const parsedSection = JSON.parse(sanitizeJson(sectionRaw));
    if (!parsedSection.sectionAnalysis) parsedSection.sectionAnalysis = "";
    
    return parsedSection;

  } catch (error) {
    console.error(`[AdminGeminiService] Failed to generate section ${sectionIndex}:`, error);
    throw error;
  }
};

/**
 * Generates ONLY the 'explanation' fields for all questions in a section,
 * preserving the existing IDs, types, answers, and points.
 */
export const generateSectionQuestionsExplanations = async (apiKey, subjectType, sectionData, questionFiles = [], answerFiles = []) => {
  try {
    const trimmedKey = apiKey?.trim();
    if (!trimmedKey) throw new Error("Gemini API Key is not set.");

    const genAI = new GoogleGenerativeAI(trimmedKey);

    const imageParts = [];
    if (questionFiles && questionFiles.length > 0) {
      const qDataArray = (await Promise.all(questionFiles.map(file => anySourceToBase64(file)))).filter(Boolean);
      qDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }
    if (answerFiles && answerFiles.length > 0) {
      const aDataArray = (await Promise.all(answerFiles.map(file => anySourceToBase64(file)))).filter(Boolean);
      aDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    }

    const prompt = `あなたは大学入試の専門講師です。
以下の画像（問題・解答）を分析し、提供された「設問構造（JSON）」の各小問に対応する **解説(explanation)のみ** を生成してください。
また、大問全体の読解ポイント(sectionAnalysis)も併せて作成してください。

【厳格ルール】
1. **既存の id, label, type, options, correctAnswer, points は絶対に書き換えないこと。** 
2. 渡された JSON の各要素にある \`explanation\` フィールドを、論理的で丁寧な解説で埋めてください。
3. 【超重要】解説の長さは【各小問200〜400文字程度】を目安にしてください。「なぜ正解か」の根拠を本文の具体的箇所（第◯段落など）を挙げて説明し、「なぜ他が不正解か」についても論理的に記述してください。
4. 日本語で記述すること。
5. アスタリスク（*）記号は一切使用禁止。
6. 出力は、解説を埋めた後の「同じJSON構造のオブジェクト1つのみ」を返してください。

【対象の設問構造（現在のデータ）】
${JSON.stringify(sectionData, null, 2)}

【出力要件】
- JSONオブジェクト1つのみ
- 既存の構造を維持
`;

    const result = await generateContentWithFallback(genAI, {
      contents: [{ role: 'user', parts: [{ text: prompt }, ...imageParts] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 }
    }, 5, 5000);

    const sectionRaw = result.response.text();
    const parsed = JSON.parse(sanitizeJson(sectionRaw));
    
    return parsed;
  } catch (error) {
    console.error(`[AdminGeminiService] Failed to generate explanations for section:`, error);
    throw error;
  }
};

/**
 * Extracts Eiken Pre-1st grade level vocabulary from the given question files.
 */
export const extractSectionVocabulary = async (apiKey, questionFiles = []) => {
  try {
    const trimmedKey = apiKey?.trim();
    if (!trimmedKey) throw new Error("Gemini API Key is not set.");

    const genAI = new GoogleGenerativeAI(trimmedKey);

    const imageParts = [];
    if (questionFiles && questionFiles.length > 0) {
      const qDataArray = (await Promise.all(questionFiles.map(file => anySourceToBase64(file)))).filter(Boolean);
      qDataArray.forEach(fd => imageParts.push({ inlineData: { mimeType: fd.mimeType, data: fd.data } }));
    } else {
      throw new Error("問題の画像ファイルがありません。");
    }

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
      contents: [{ role: 'user', parts: [{ text: prompt }, ...imageParts] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2048 }
    }, 5, 5000);

    const sectionRaw = result.response.text();
    const parsed = JSON.parse(sanitizeJson(sectionRaw));
    
    return parsed;
  } catch (error) {
    console.error(`[AdminGeminiService] Failed to extract vocabulary:`, error);
    throw error;
  }
};
