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

const JAPANESE_RULES = `
あなたは、大学入試の国語（現代文・古文・漢文）の問題構造と配点を設計する専門担当者である。

【最重要前提】
・国語は本文読解・文脈把握・選択肢処理・抜き出し・現代語訳・記述説明を混在して扱う。
・問題本文、設問文、解答画像、既存の正解データを最優先し、推測で設問数や正解を補わない。
・配点は、最終的に指定満点へ一致するよう調整する。

【問題タイプの分類】
1. selection
   ・選択肢から1つ選ぶ問題。
   ・選択肢番号、記号、語句の対応を誤って correctAnswer にしない。

2. selection_multi
   ・複数選択、組み合わせ、すべて選べ、正しいものを2つ選べ等の問題。

3. descriptive
   ・漢字、語句、文法、古語、句法、現代語訳、抜き出し、短い記述、本文中の語句を答える問題。
   ・「番号だけ答える」設問は、括弧内の語句ではなく番号を正解にする。

4. essay
   ・理由説明、内容説明、要約、本文根拠を用いた記述、複数要素を含む論述問題。
   ・採点基準が必要な問題として扱い、可能なら scoringElements を要素化する。

【配点の基本方針】
・選択問題は低〜中配点、複数選択は単一選択より重め。
・漢字、語句、文法、古語、句法などの短答は低〜中配点。
・抜き出し、現代語訳、説明記述は中〜高配点。
・要約、理由説明、内容説明、論述は最も得点差が出やすい問題として高めに配点する。
・大問ごとの指定配点がある場合は、各小問 points の合計を必ずその指定配点に一致させる。

【現代文の注意】
・本文根拠、指示語、接続語、対比、因果、筆者の主張、選択肢のズレを重視する。
・本文にない一般論や受験アドバイスを解答根拠にしない。

【古文の注意】
・主語補足、敬語、助動詞、古語、係り結び、和歌、文脈を重視する。
・現代語訳問題は、逐語訳だけでなく文脈上の意味を確認する。

【漢文の注意】
・句法、返り点、書き下し、重要語、文脈上の意味を重視する。
・句法名だけで終わらせず、設問の正解にどうつながるかを扱う。
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

const cleanExplanationOpening = (text: string): string => {
  let cleaned = String(text || "")
    .replace(/```markdown\n?|```\n?|```/g, "")
    .replace(/\*/g, "")
    .trim();

  cleaned = cleaned.replace(
    /^(?:本解説では|この解説では|以下では)[\s\S]{0,160}?(?:詳細な解説を行う。|解説する。|説明する。)\s*/u,
    "",
  );
  cleaned = cleaned.replace(/^(?:全体解説|大問全体の解説|大問分析|詳細解説)\s*[①-⑳0-9０-９]*\s*[\n:：-]*/u, "");
  cleaned = cleaned.replace(/^【\s*(?:解説|詳細解説|全体解説|大問分析)\s*】\s*/u, "");
  cleaned = cleaned.replace(/^#+\s*(?:解説|詳細解説|全体解説|大問分析)\s*[①-⑳0-9０-９]*\s*\n+/u, "");
  cleaned = cleaned.replace(/^(?:①|1[.)．、])\s*(?:解答|正解)\s*\n+/u, "");

  return cleaned.trim();
};

const cleanSectionAnalysisOutput = (text: string, preserveAdminFormat = false): string => {
  if (!preserveAdminFormat) {
    return cleanExplanationOpening(text);
  }

  return String(text || "")
    .replace(/^```(?:markdown)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/\*/g, "")
    .trim();
};

const JAPANESE_READING_ANALYSIS_COMMON_PROMPT = `
【国語長文詳細解説・本番共通プロンプト】
目的は、答えだけでなく、受験生が同じ手順で再現できる読解・設問処理の過程を言語化することである。

【最重要方針】
・本文を読む前に、設問を確認し、何を探すべきか、どの表現に注意すべきか、どの情報が根拠になりそうかを予測する。
・本文読解中は、設問由来の観点を保持しながら、根拠になり得る箇所を追跡する。
・正解を後付けで説明するのではなく、設問確認、本文読解、根拠発見、選択肢検討、解答決定の順に思考過程を再現する。
・本文中の語句・文・段落を引用し、その引用がなぜ根拠になるのかを一対一で説明する。
・抽象と具体、対比、因果、条件、言い換え、列挙、指示語、接続語、段落の役割を必ず確認する。
・背景知識、作者知識、作品知識、一般論で本文根拠を補強しない。

【出力順】
以下の順番を守る。
1. 解答一覧
2. 設問準備フェーズ
3. 読みながら解くプロセス
4. 設問ごとの解答プロセス
5. 本文の論理構造
6. 完全解説

【完全解説の書き方】
・各段落について、読む前に保持している設問上の仮説、本文の引用、直後の理解、指示語・対比・因果・言い換えによる更新、解けるようになった設問、まだ保留すべき設問を順に説明する。
・選択肢問題では、本文から先に解答の核を作り、その後に選択肢と照合する。ただし、文章全体の内容一致では、選択肢を先に見て確認観点を用意してよい。
・誤答選択肢は、単に「本文と違う」とせず、本文のどの箇所・論理とズレるのかを明示する。
`;

const JAPANESE_READING_ANALYSIS_TYPE_PROMPTS: Record<string, string> = {
  lineExplanation: `
【設問タイプ別プロンプト: 傍線部説明】
・傍線部の直前直後だけでなく、傍線部を成立させている指示語、比喩、言い換え、対比、因果を確認する。
・傍線部中の抽象語を本文中の具体表現に戻して説明する。
・選択肢は、傍線部の中心内容、理由、対象、評価のどこが一致・不一致かで判定する。
`,
  reason: `
【設問タイプ別プロンプト: 理由説明】
・「なぜ」と問われている対象を明確にし、理由を表す接続語、因果関係、前段落からの流れを確認する。
・理由と結果を逆にしない。本文中で結果として述べられた内容を理由として扱わない。
・選択肢は、原因、結果、対象、筆者の評価の取り違えを中心に判定する。
`,
  demonstrative: `
【設問タイプ別プロンプト: 指示語】
・指示語の直前だけで決めず、文法的に受けられる範囲と文脈上の意味を両方確認する。
・指示語が受ける内容を、本文の表現に即して過不足なく言い換える。
・選択肢は、範囲の広すぎ、狭すぎ、対象違い、因果の混入を確認する。
`,
  blank: `
【設問タイプ別プロンプト: 空所補充】
・空所前後の接続関係、文末表現、品詞、主語・述語、対比・因果・言い換えを確認する。
・空所に入れる前に、本文の流れから必要な意味方向を予測する。
・選択肢は、意味が合うだけでなく、文法・接続・論理の流れまで一致するかで判定する。
`,
  sentenceOrdering: `
【設問タイプ別プロンプト: 文整序】
・指示語、接続語、同義反復、時系列、抽象から具体への流れ、原因から結果への流れを確認する。
・各文の役割を、導入、具体例、補足、逆接、結論などに分けて説明する。
・正しい順序だけでなく、誤った順序だとどの照応・論理が崩れるかを説明する。
`,
  extraction: `
【設問タイプ別プロンプト: 抜き出し】
・設問条件、字数条件、品詞条件、文末条件を先に確認する。
・本文中の候補箇所を複数比較し、条件に合うものだけを残す。
・抜き出した語句・文が、設問の要求にどう対応しているかを明示する。
`,
  overallContent: `
【設問タイプ別プロンプト: 文章全体の内容一致】
・選択肢を先に確認し、本文中で検証すべき観点を作る。
・本文全体の主張、段落ごとの役割、対立軸、筆者の評価を整理してから判定する。
・誤答選択肢は、本文にない断定、主張の逆転、部分内容の一般化、段落限定情報の全体化を確認する。
`,
  structure: `
【設問タイプ別プロンプト: 本文構成】
・各段落の役割を、問題提起、具体例、反論、譲歩、転換、結論などに分ける。
・段落同士の関係を、対比、因果、具体化、言い換え、補足として説明する。
・構成問題では、内容そのものだけでなく、文章内での機能を根拠にする。
`,
};

const JAPANESE_READING_ANALYSIS_TYPE_LABELS: Record<string, string> = {
  lineExplanation: "傍線部説明",
  reason: "理由説明",
  demonstrative: "指示語",
  blank: "空所補充",
  sentenceOrdering: "文整序",
  extraction: "抜き出し",
  overallContent: "文章全体の内容一致",
  structure: "本文構成",
};

const stringifyJapaneseQuestionField = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(stringifyJapaneseQuestionField).filter(Boolean).join(" ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return "";
    }
  }
  return "";
};

const buildJapaneseQuestionDetectionText = (question: Record<string, unknown>): string => {
  const fields = [
    question.label,
    question.prompt,
    question.questionText,
    question.question,
    question.instruction,
    question.passageReference,
    question.answerFormat,
    question.type,
    question.options,
  ];

  return fields.map(stringifyJapaneseQuestionField).filter(Boolean).join("\n");
};

const detectJapaneseReadingAnalysisTypes = (question: Record<string, unknown>): string[] => {
  const text = buildJapaneseQuestionDetectionText(question);
  const detected = new Set<string>();
  const addIf = (key: string, pattern: RegExp) => {
    if (pattern.test(text)) detected.add(key);
  };

  addIf("reason", /なぜ|どうして|理由|原因|のはなぜ|によるもの|どういう理由/u);
  addIf("lineExplanation", /傍線|下線|波線|線部|どういうこと|どういう意味|説明せよ|内容を説明|「[^」]+」とは/u);
  addIf("demonstrative", /指示語|これ|それ|あれ|この|その|あの|何を指す|何を示す|指している|示している/u);
  addIf("blank", /空欄|空らん|空所|穴埋め|補充|入る|あてはまる|当てはまる|空所[Ａ-ＺA-Z]|空欄[Ａ-ＺA-Z]/u);
  addIf("sentenceOrdering", /文整序|整序|並べ替え|並び替え|順序|順に|配列|並べよ|正しい順/u);
  addIf("extraction", /抜き出|抜出|本文中から|本文から|書き抜|字で|字以内|字以内で|字数|初めと終わり|該当する語句/u);
  addIf("overallContent", /内容一致|本文全体|全体の内容|正しいもの|正しくないもの|一致するもの|一致しないもの|本文の内容|述べたもの|述べているもの|本文に合う/u);
  addIf("structure", /構成|段落|文章の展開|論理構造|本文の流れ|要旨|主旨|主題|筆者の主張|趣旨|段落の役割/u);

  const questionType = String(question.type || "").toLowerCase();
  const hasOptions = Array.isArray(question.options) && question.options.length > 0;
  if (detected.size === 0 && (hasOptions || questionType.includes("select") || questionType.includes("choice"))) {
    detected.add("overallContent");
  }
  if (detected.size === 0 && (questionType.includes("descriptive") || questionType.includes("writing") || questionType.includes("free"))) {
    detected.add("lineExplanation");
  }
  if (detected.size === 0) {
    detected.add("lineExplanation");
  }

  const priority = [
    "reason",
    "lineExplanation",
    "demonstrative",
    "blank",
    "sentenceOrdering",
    "extraction",
    "overallContent",
    "structure",
  ];

  return priority.filter((key) => detected.has(key));
};

const buildJapaneseQuestionTypePromptSection = (questions: Array<Record<string, unknown>>): string => {
  if (!Array.isArray(questions) || questions.length === 0) {
    return `【小問ごとの設問タイプ判定】
小問データが不足しているため、下記の全タイプ別プロンプトを参照し、問題画像・解答画像から設問タイプを判定して適用する。

${Object.values(JAPANESE_READING_ANALYSIS_TYPE_PROMPTS).join("\n")}`;
  }

  const questionTypeEntries = questions.map((question) => ({
    label: stringifyJapaneseQuestionField(question.label || question.id || "小問"),
    types: detectJapaneseReadingAnalysisTypes(question),
  }));
  const usedTypes = Array.from(new Set(questionTypeEntries.flatMap((entry) => entry.types)));
  const typeSummary = questionTypeEntries
    .map((entry) => {
      const labels = entry.types.map((type) => JAPANESE_READING_ANALYSIS_TYPE_LABELS[type] || type).join(" / ");
      return `・${entry.label}: ${labels}`;
    })
    .join("\n");
  const promptBody = usedTypes
    .map((type) => JAPANESE_READING_ANALYSIS_TYPE_PROMPTS[type])
    .filter(Boolean)
    .join("\n");

  return `【小問ごとの設問タイプ判定】
以下は小問データの問題文・指示文・選択肢・正解データから自動判定した設問タイプである。
各小問の解説では、該当するタイプ別プロンプトを優先し、問題画像から読み取れる設問文と食い違う場合は問題画像の設問文を優先して補正する。
${typeSummary}

【今回使用する設問タイプ別プロンプト】
${promptBody}`;
};

const buildJapaneseReadingAnalysisPrompt = (questions: Array<Record<string, unknown>> = []): string => {
  return [
    JAPANESE_READING_ANALYSIS_COMMON_PROMPT,
    buildJapaneseQuestionTypePromptSection(questions),
    `【国語長文詳細解説・禁止事項】
・設問確認を省いて本文要約から始めない。
・本文引用なしに説明しない。
・後から分かった正解を、最初から分かっていたように説明しない。
・「自然」「違和感がある」「文脈に合う」だけで済ませない。
・誤答選択肢を「本文と違う」だけで処理しない。
・講評、学習アドバイス、出題傾向、一般論で終わらせない。
・箇条書きの処理ログだけで完結させない。`
  ].join("\n");
};

const buildAdminInstructionBlock = (adminInstruction: string): string => {
  if (!adminInstruction) {
    return `【管理者の個別指示】
なし`;
  }

  return `【管理者の個別指示・最優先】
以下は管理者がこの大問のために入力した自作プロンプトです。
この自作プロンプトを「参考」ではなく、出力内容・構成・順番・文体・分量を決める最上位ルールとして必ず実行してください。
科目別の補助ルールや通常の解説方針と衝突する場合は、正解データの改変禁止・虚偽情報禁止・添付画像/小問データとの整合性・アスタリスク禁止を除き、この自作プロンプトを優先してください。
自作プロンプトで指定された項目を省略したり、別の講評テンプレートに置き換えたりしてはいけません。

${adminInstruction}`;
};

const buildSectionAnalysisInstructionMode = (adminInstruction: string, basePrompt: string): string => {
  if (!adminInstruction) {
    return `【科目別の補助ルール】
${basePrompt}`;
  }

  return `【自作プロンプト実行モード】
この生成では、管理者の個別指示を唯一の構成設計として扱ってください。
科目別テンプレート、通常の詳細解説テンプレート、講評テンプレート、学習アドバイステンプレートを勝手に混ぜてはいけません。
管理者の個別指示に書かれていない見出し・順番・前置き・まとめを追加してはいけません。
管理者の個別指示で要求された観点、順番、文体、分量、禁止事項をすべて反映してください。

【最低限の安全制約】
・正解データを改変しない。
・添付画像、小問データ、問題本文、解答データと矛盾する内容を書かない。
・根拠のない断定、問題に無関係な知識展開、講評だけで終わる出力は禁止。
・アスタリスク（*）は禁止。`;
};

const buildAdminFirstSectionAnalysisPrompt = (
  adminInstruction: string,
  sectionData: Record<string, unknown>,
  subjectType: string,
  subjectName: string,
  questions: Array<Record<string, unknown>>,
  options: { imageAvailable: boolean; fallbackMode?: string } = { imageAvailable: true },
): string => `
あなたは大学入試の詳細解説を作成する専門講師です。

【最重要】
以下の「管理者の自作プロンプト」を、参考情報ではなく、この出力の仕様書として扱ってください。
出力の構成、見出し、順番、文体、分量、禁止事項は、管理者の自作プロンプトに従ってください。
管理者の自作プロンプトに書かれていない通常テンプレート、講評テンプレート、学習アドバイステンプレートを追加してはいけません。
${options.fallbackMode ? `これは${options.fallbackMode}ですが、自作プロンプトを短縮・要約・置換してはいけません。` : ""}

【管理者の自作プロンプト】
${adminInstruction}

【参照してよい根拠】
・添付された問題画像、解答画像
・下記の対象データ、小問データ、正解データ
・高校範囲の一般的な知識。ただし、問題の解説に直接必要な範囲に限る。

【対象】
科目: ${subjectName || subjectType || "未設定"}
大問: 第${sectionData.id}問（${sectionData.label || ""}）
${options.imageAvailable ? "" : "注意: この生成では画像を直接参照できません。下記の小問データと正解データから断定できる内容だけを書いてください。"}

【小問データ・正解データ】
${JSON.stringify(questions.map((q) => ({
    id: q.id,
    label: q.label,
    type: q.type,
    options: q.options,
    correctAnswer: q.correctAnswer,
    points: q.points,
    explanation: q.explanation,
    gradingInstruction: q.gradingInstruction,
    scoringElements: q.scoringElements,
  })), null, 2)}

【大問データ】
${JSON.stringify({
    id: sectionData.id,
    label: sectionData.label,
    questionType: sectionData.questionType,
    allocatedPoints: sectionData.allocatedPoints,
    instruction: sectionData.instruction,
    sectionAnalysis: sectionData.sectionAnalysis,
  }, null, 2)}

【守るべき最低限の安全制約】
・正解データを勝手に変更しない。
・問題画像、解答画像、小問データ、正解データと矛盾する内容を書かない。
・根拠のない断定や、問題に無関係な知識展開をしない。
・アスタリスク（*）は使用しない。
・コードブロックで囲まない。
・詳細解説本文のみを返す。
`;

const hasUsableExplanation = (value: unknown): boolean =>
  typeof value === "string" &&
  value.trim() !== "" &&
  !value.includes("AI生成中") &&
  !value.includes("AI生成エラー");

const isJapaneseSubject = (subjectType: unknown): boolean => {
  const normalized = String(subjectType || "").trim().toLowerCase();
  if (!normalized) return false;
  if (["japanese", "kokugo", "modern_japanese", "classical_japanese", "kanbun"].includes(normalized)) {
    return true;
  }
  return /国語|現代文|古文|漢文|小論文/u.test(normalized);
};

const JAPANESE_UNVERIFIABLE_EXPLANATION = "本文・設問画像から根拠箇所を確認できないため、要確認です。";
const QUESTION_EXPLANATION_UNVERIFIABLE = "設問本文・選択肢・正解根拠を確認できないため、要確認です。";

const genericQuestionExplanationPatterns = [
  /この(?:設問|問題|本問)は[、,\s]*(?:与えられた|特定の|文脈|文章全体|語句|表現|正しい|最も)/u,
  /(?:文法的|意味的)に(?:最も)?適切な(?:表現|語|選択肢)/u,
  /(?:語句|表現)が持つニュアンス/u,
  /文章全体の(?:論理|意味)的なつながり/u,
  /選択肢(?:の)?(?:細部|内容)まで(?:注意深く)?(?:検討|確認)/u,
  /(?:読解力|理解しているか|力を試|問うものです)/u,
  /正解となるのは、?主語と述語の一致/u,
  /選択肢\d+が正解(?:である|となる)のは/u,
  /文脈に沿った適切な(?:接続詞|副詞|表現)/u,
  /最も自然で(?:文脈|意味)に合う/u,
];

const isGenericQuestionExplanation = (value: unknown): boolean => {
  const text = String(value || "").trim();
  if (!text) return false;
  return genericQuestionExplanationPatterns.some((pattern) => pattern.test(text));
};

const normalizeEvidenceText = (value: unknown): string =>
  String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[「」『』【】\[\]（）()、。，．・,:;：；'"“”‘’!?！？]/g, "")
    .toLowerCase();

const collectEvidenceStrings = (value: unknown, acc: string[] = []): string[] => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) acc.push(trimmed);
    return acc;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectEvidenceStrings(item, acc));
    return acc;
  }
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectEvidenceStrings(item, acc));
  }
  return acc;
};

const questionEvidenceSourceText = (questionData: unknown): string => {
  if (!questionData || typeof questionData !== "object") return "";
  const q = questionData as Record<string, unknown>;
  const sourceFields = [
    q.questionText,
    q.prompt,
    q.instruction,
    q.text,
    q.evidenceHint,
    q.sourceExcerpt,
    q.correctAnswer,
    q.answer,
    q.modelAnswer,
    q.options,
    q.choices,
    q.choiceTexts,
  ];
  return collectEvidenceStrings(sourceFields).join("\n");
};

const hasMeaningfulQuestionEvidenceSource = (questionData: unknown): boolean => {
  const normalized = normalizeEvidenceText(questionEvidenceSourceText(questionData));
  if (normalized.length < 12) return false;
  const withoutDigits = normalized.replace(/[0-9０-９]/g, "");
  const withoutChoiceLetters = withoutDigits.replace(/^[a-zａ-ｚアイウエオ]+$/u, "");
  return /[ぁ-んァ-ヶ一-龥A-Za-z]{3,}/u.test(withoutChoiceLetters);
};

const evidenceQuoteAppearsInQuestionSource = (evidenceQuote: unknown, questionData: unknown): boolean => {
  const quote = normalizeEvidenceText(evidenceQuote);
  if (quote.length < 2) return false;
  if (/^(?:本文中の該当箇所|該当箇所|本文|設問文|選択肢|解答画像|要確認|不明)$/u.test(String(evidenceQuote || "").trim())) {
    return false;
  }
  const source = normalizeEvidenceText(questionEvidenceSourceText(questionData));
  if (!source) return false;
  return source.includes(quote) || quote.includes(source);
};

const hasExtractedQuestionEvidence = (questionData: unknown): boolean => {
  if (!questionData || typeof questionData !== "object") return false;
  const q = questionData as Record<string, unknown>;
  const questionText = normalizeEvidenceText(q.questionText || q.prompt || q.instruction || q.text);
  const choiceText = normalizeEvidenceText(q.choiceTexts || q.choices);
  const sourceExcerpt = normalizeEvidenceText(q.sourceExcerpt || q.evidenceHint || q.evidenceQuote);
  return questionText.length >= 8 || choiceText.length >= 8 || sourceExcerpt.length >= 8;
};

const questionExplanationQualityRules = (subjectType: unknown): string => `
【小問解説の品質ルール（全科目共通）】
・「この問題は〜力を試します」「文法的または意味的に最も適切」「選択肢を注意深く検討」のような一般論は禁止。
・必ず、正解欄の値・選択肢・設問本文・解答画像のうち少なくとも1つの具体語句を使い、「なぜその正解になるか」を説明すること。
・根拠語句が確認できない場合は、推測で作らず evidenceQuote を空欄にし、explanation を「${isJapaneseSubject(subjectType) ? JAPANESE_UNVERIFIABLE_EXPLANATION : QUESTION_EXPLANATION_UNVERIFIABLE}」にすること。
・画像だけを見て根拠を推測しないこと。設問構造データ内で確認できる語句を evidenceQuote に入れられない場合は、解説を確定させないこと。
・正解番号だけ、または選択肢番号だけを根拠に解説を作らないこと。問題文・選択肢文・模範解答の具体語句と照合できない場合は要確認にすること。
・選択問題では、正解番号だけでなく、その選択肢が本文・設問条件・文法条件のどれに合うのかを具体的に書くこと。
・歴史など知識問題では、人物名・出来事名・年代・制度名など、正解に直結する固有語を使って説明すること。
・英語では、実際の英文・空所・選択肢に含まれる語句を根拠にし、単なる「文脈に合う」「自然である」だけで終わらせないこと。
`;

const japaneseQuestionExplanationRules = (subjectType: unknown): string => {
  if (!isJapaneseSubject(subjectType)) return "";

  return `
【国語の小問解説・絶対ルール】
・本文、設問文、選択肢、解答画像から確認できる内容だけで解説すること。
・設問構造データ内に本文・設問文・選択肢文・模範解答などの照合可能な文字情報がない場合は、画像からそれらしい解説を作らず、explanation を「${JAPANESE_UNVERIFIABLE_EXPLANATION}」にすること。
・各小問の出力には必ず evidenceQuote を含めること。evidenceQuote には、本文・設問文・選択肢・解答画像から実際に読める短い根拠語句をそのまま入れること。
・evidenceQuote は「本文中の該当箇所」「第○段落」「傍線部付近」などの場所説明だけでは不可。画像内で読める具体的な語句・一文の短い引用にすること。
・解説は必ず「設問条件」「本文中の根拠」「正解になる理由」の対応で書くこと。本文根拠なしの一般論、受験アドバイス、作者・作品知識、出典説明で補わないこと。
・本文根拠が画像から確認できない場合は、推測で作らず evidenceQuote を空欄にし、explanation を「${JAPANESE_UNVERIFIABLE_EXPLANATION}」にすること。
・「問題が公表されている」「公表された問題」「出典は」「著作権」「大学が公開している」など、問題の公開状況やメタ情報を解説に書かないこと。
・設問文や選択肢を長く写さないこと。引用する場合は根拠確認に必要な短い語句だけにすること。
・段落番号や傍線番号が画像から読めない場合は、存在しない番号を作らず「本文中の該当箇所」と書くこと。
・選択問題では、正解選択肢が本文のどの表現・論理と合うかを述べ、誤答は本文にない断定、因果の逆転、範囲のずれ、言い換え不成立などのズレとして説明すること。
・漢字の書き取りなど自動採点不可の問題は、採点根拠を本文から捏造せず、自己採点対象であることだけを簡潔に書くこと。
`;
};

const cleanQuestionExplanationOutput = (text: unknown, subjectType: unknown): string => {
  const cleaned = cleanExplanationOpening(String(text || ""));
  const unverified = isJapaneseSubject(subjectType)
    ? JAPANESE_UNVERIFIABLE_EXPLANATION
    : QUESTION_EXPLANATION_UNVERIFIABLE;

  if (isGenericQuestionExplanation(cleaned)) return unverified;
  if (!isJapaneseSubject(subjectType)) return cleaned;

  if (/(?:問題.{0,12}(?:公表|公開)|(?:公表|公開)され(?:た|ている)問題|出典|著作権|転載|配布)/u.test(cleaned)) {
    return JAPANESE_UNVERIFIABLE_EXPLANATION;
  }

  return cleaned;
};

const hasConcreteJapaneseEvidenceQuote = (value: unknown): boolean => {
  const quote = String(value || "").trim();
  if (quote.length < 2) return false;
  if (quote.length > 180) return false;
  if (/^(?:本文中の該当箇所|該当箇所|本文|設問文|選択肢|解答画像|第[一二三四五六七八九十\d]+段落|傍線部(?:付近)?|要確認|不明)$/u.test(quote)) {
    return false;
  }
  return true;
};

const applyQuestionExplanationGuard = (
  generated: Record<string, unknown>,
  subjectType: unknown,
  sourceQuestion?: unknown,
): Record<string, unknown> => {
  const explanation = cleanQuestionExplanationOutput(generated.explanation, subjectType);
  if (!isJapaneseSubject(subjectType)) {
    const evidenceQuote = String(generated.evidenceQuote || generated.evidence || "").trim();
    if (
      explanation === QUESTION_EXPLANATION_UNVERIFIABLE ||
      !hasMeaningfulQuestionEvidenceSource(sourceQuestion) ||
      !evidenceQuoteAppearsInQuestionSource(evidenceQuote, sourceQuestion)
    ) {
      return {
        explanation: QUESTION_EXPLANATION_UNVERIFIABLE,
        evidenceQuote: "",
        needsReview: true,
        explanationIssue: "generic_or_missing_evidence",
      };
    }
    return {
      explanation,
      evidenceQuote,
      needsReview: false,
      explanationIssue: "",
    };
  }

  const evidenceQuote = String(generated.evidenceQuote || generated.evidence || "").trim();
  if (
    explanation === JAPANESE_UNVERIFIABLE_EXPLANATION ||
    !hasMeaningfulQuestionEvidenceSource(sourceQuestion) ||
    !hasConcreteJapaneseEvidenceQuote(evidenceQuote) ||
    !evidenceQuoteAppearsInQuestionSource(evidenceQuote, sourceQuestion)
  ) {
    return {
      explanation: JAPANESE_UNVERIFIABLE_EXPLANATION,
      evidenceQuote: "",
      needsReview: true,
      explanationIssue: "missing_japanese_evidence",
    };
  }

  return {
    explanation,
    evidenceQuote,
    needsReview: false,
    explanationIssue: "",
  };
};

const normalizeEvidenceQuestionPatch = (
  original: Record<string, unknown>,
  extracted: Record<string, unknown>,
): Record<string, unknown> => {
  const cleanString = (value: unknown) => String(value || "").trim();
  const cleanObject = (value: unknown): Record<string, string> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [String(key).trim(), cleanString(item)])
        .filter(([key, item]) => key && item),
    );
  };

  const questionText = cleanString(
    extracted.questionText || extracted.prompt || extracted.instruction || original.questionText || original.prompt || original.instruction,
  );
  const choiceTexts = cleanObject(extracted.choiceTexts || extracted.choices || original.choiceTexts || original.choices);
  const sourceExcerpt = cleanString(extracted.sourceExcerpt || extracted.evidenceHint || original.sourceExcerpt || original.evidenceHint);
  const evidenceQuote = cleanString(extracted.evidenceQuote || extracted.evidence || original.evidenceQuote);
  const extractionIssue = cleanString(extracted.extractionIssue || extracted.issue);
  const confidence = cleanString(extracted.evidenceConfidence || extracted.confidence);

  const hasEvidence = Boolean(
    normalizeEvidenceText(questionText).length >= 8 ||
      normalizeEvidenceText(choiceTexts).length >= 8 ||
      normalizeEvidenceText(sourceExcerpt).length >= 8 ||
      normalizeEvidenceText(evidenceQuote).length >= 2,
  );

  return {
    ...original,
    ...(questionText ? { questionText } : {}),
    ...(Object.keys(choiceTexts).length > 0 ? { choiceTexts } : {}),
    ...(sourceExcerpt ? { sourceExcerpt, evidenceHint: sourceExcerpt } : {}),
    ...(evidenceQuote ? { evidenceQuote } : {}),
    evidenceConfidence: confidence || (hasEvidence ? "medium" : "low"),
    needsReview: Boolean(original.needsReview) || !hasEvidence || Boolean(extractionIssue),
    explanationIssue: !hasEvidence
      ? "missing_question_evidence"
      : extractionIssue || String(original.explanationIssue || ""),
  };
};

const isUnresolvedCorrectAnswer = (value: unknown): boolean => {
  const text = String(value ?? "").trim();
  if (!text) return true;
  if (["要確認", "未確認", "不明", "不明確", "要修正", "確認中"].includes(text)) return true;
  return /^要確認[（(]/u.test(text);
};

const resolvedCorrectAnswerPatch = (
  existing: Record<string, unknown>,
  generated: Record<string, unknown>,
): Record<string, unknown> => {
  if (!isUnresolvedCorrectAnswer(existing.correctAnswer) || isUnresolvedCorrectAnswer(generated.correctAnswer)) {
    return {};
  }

  const patch: Record<string, unknown> = {
    correctAnswer: String(generated.correctAnswer).trim(),
    needsReview: false,
  };
  if (existing.answerIssue === "unresolved" || existing.answerIssue === "missing_answer") {
    patch.answerIssue = "";
  }
  return patch;
};

const findQuestionIndex = (
  questions: Array<Record<string, unknown>>,
  target: Record<string, unknown>,
  fallbackIndex = -1,
): number => {
  const targetId = String(target?.id ?? "").trim();
  const byId = questions.findIndex((question) => String(question?.id ?? "").trim() === targetId);
  if (byId !== -1) return byId;

  const targetLabel = String(target?.label ?? "").trim();
  const byLabel = questions.findIndex((question) => String(question?.label ?? "").trim() === targetLabel);
  if (byLabel !== -1) return byLabel;

  return fallbackIndex >= 0 && fallbackIndex < questions.length ? fallbackIndex : -1;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireStringField = (record: Record<string, unknown>, field: string, context: string) => {
  if (typeof record[field] !== "string" || !(record[field] as string).trim()) {
    throw new Error(`${context}: ${field} が空、または文字列ではありません。`);
  }
};

const requireNumberField = (
  record: Record<string, unknown>,
  field: string,
  context: string,
  requirePositive = false,
) => {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context}: ${field} が数値ではありません。`);
  }
  if (requirePositive && value <= 0) {
    throw new Error(`${context}: ${field} が1以上ではありません。`);
  }
  return value;
};

const validateSectionData = (
  section: unknown,
  context: string,
  requirePositivePoints = false,
  targetPoints: number | null = null,
  expectedQuestionCount: number | null = null,
  allowZeroQuestionPoints = false,
) => {
  if (!isRecord(section)) {
    throw new Error(`${context}: 大問データがJSONオブジェクトではありません。`);
  }
  requireStringField(section, "id", context);
  const allocatedPoints = requireNumberField(section, "allocatedPoints", context, requirePositivePoints);

  const questions = section.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error(`${context}: 小問が1件も抽出されていません。`);
  }
  if (
    expectedQuestionCount !== null &&
    questions.length < expectedQuestionCount &&
    getQuestionNumberCoverage(questions.filter(isRecord)) < expectedQuestionCount
  ) {
    throw new Error(`${context}: 小問が ${questions.length} 件しか抽出されていません。期待小問数 ${expectedQuestionCount} 件を下回るため、生成結果を破棄しました。問題画像の範囲または期待小問数を確認してください。`);
  }

  const questionPointTotal = questions.reduce((sum, question, qIdx) => {
    const qContext = `${context} 小問${qIdx + 1}`;
    if (!isRecord(question)) {
      throw new Error(`${qContext}: 小問データがJSONオブジェクトではありません。`);
    }
    requireStringField(question, "id", qContext);
    if (question.correctAnswer === undefined || question.correctAnswer === null || question.correctAnswer === "") {
      throw new Error(`${qContext}: correctAnswer が空です。`);
    }
    const points = requireNumberField(question, "points", qContext, false);
    if (requirePositivePoints && allowZeroQuestionPoints && points < 0) {
      throw new Error(`${qContext}: points が0以上ではありません。`);
    }
    if (requirePositivePoints && !allowZeroQuestionPoints && points <= 0) {
      throw new Error(`${qContext}: points が1以上ではありません。`);
    }
    return sum + points;
  }, 0);

  if (requirePositivePoints && questionPointTotal !== allocatedPoints) {
    throw new Error(`${context}: 小問配点合計 ${questionPointTotal} 点が大問配点 ${allocatedPoints} 点と一致しません。`);
  }
  if (targetPoints !== null && allocatedPoints !== targetPoints) {
    throw new Error(`${context}: 大問配点 ${allocatedPoints} 点が目標配点 ${targetPoints} 点と一致しません。`);
  }
};

const validateSectionsData = (
  sections: unknown,
  maxScore: number,
  context: string,
  requirePositivePoints = false,
) => {
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error(`${context}: 大問データが空です。`);
  }
  let allocatedTotal = 0;
  sections.forEach((section, idx) => {
    validateSectionData(section, `${context} 第${idx + 1}問`, requirePositivePoints);
    allocatedTotal += (section as Record<string, unknown>).allocatedPoints as number;
  });
  if (requirePositivePoints && allocatedTotal !== maxScore) {
    throw new Error(`${context}: 大問配点合計 ${allocatedTotal} 点が満点 ${maxScore} 点と一致しません。`);
  }
};

const normalizeChoiceLabel = (value: unknown): string => {
  const circledNumberMap: Record<string, string> = {
    "①": "1",
    "②": "2",
    "③": "3",
    "④": "4",
    "⑤": "5",
    "⑥": "6",
    "⑦": "7",
    "⑧": "8",
    "⑨": "9",
    "⑩": "10",
    "⑪": "11",
    "⑫": "12",
    "⑬": "13",
    "⑭": "14",
    "⑮": "15",
    "⑯": "16",
    "⑰": "17",
    "⑱": "18",
    "⑲": "19",
    "⑳": "20",
  };
  const label = String(value ?? "")
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g, (char) => circledNumberMap[char] || char)
    .normalize("NFKC")
    .trim();
  if (label === "力") return "カ";
  if (label === "才") return "オ";
  if (label === "工") return "エ";
  if (label === "口") return "ロ";
  if (label === "夕") return "タ";
  if (label === "二") return "ニ";
  if (label === "卜") return "ト";
  if (label === "八") return "ハ";
  const fixes: Record<string, string> = { "力": "カ", "才": "オ", "工": "エ", "口": "ロ", "夕": "タ", "二": "ニ", "卜": "ト", "八": "ハ" };
  return label.replace(/(^|[（(【\[\s,、])([力才工口夕二卜八])(?=($|[）)】\]\s,、.:：]))/g, (_match, prefix, choice) =>
    `${prefix}${fixes[choice] || choice}`);
};

const completeAlphabetOptions = (options: string[]): string[] => {
  const uniqueOptions = Array.from(new Set(options));
  const allSingleLowerAlphabet = uniqueOptions.every((option) => /^[a-z]$/.test(option));
  if (allSingleLowerAlphabet && uniqueOptions.length === 25) {
    return "abcdefghijklmnopqrstuvwxyz".split("");
  }
  const allSingleUpperAlphabet = uniqueOptions.every((option) => /^[A-Z]$/.test(option));
  if (allSingleUpperAlphabet && uniqueOptions.length === 25) {
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  }
  return uniqueOptions;
};

const completeOneMissingFromSequence = (options: string[], sequence: string[], minLength = 3): string[] => {
  const uniqueOptions = Array.from(new Set(options));
  if (uniqueOptions.length < minLength || !uniqueOptions.every((option) => sequence.includes(option))) {
    return uniqueOptions;
  }

  const indexes = uniqueOptions.map((option) => sequence.indexOf(option));
  const start = Math.min(...indexes);
  const end = Math.max(...indexes);
  const expected = sequence.slice(start, end + 1);
  if (expected.length === uniqueOptions.length + 1) {
    const missingCount = expected.filter((option) => !uniqueOptions.includes(option)).length;
    if (missingCount === 1) return expected;
  }
  return uniqueOptions;
};

const completeOneMissingNumericOptions = (options: string[]): string[] => {
  const uniqueOptions = Array.from(new Set(options));
  if (uniqueOptions.length < 3 || !uniqueOptions.every((option) => /^[0-9]+$/.test(option))) {
    return uniqueOptions;
  }

  const numbers = uniqueOptions.map((option) => Number(option)).sort((a, b) => a - b);
  const start = numbers[0];
  const end = numbers[numbers.length - 1];
  const expected = Array.from({ length: end - start + 1 }, (_item, idx) => String(start + idx));
  if (expected.length === uniqueOptions.length + 1) {
    const missingCount = expected.filter((option) => !uniqueOptions.includes(option)).length;
    if (missingCount === 1) return expected;
  }
  return uniqueOptions;
};

const completeLikelyMissingOption = (options: string[]): string[] => {
  const uniqueLength = Array.from(new Set(options)).length;
  const alphabetCompleted = completeAlphabetOptions(options);
  if (alphabetCompleted.length !== uniqueLength) return alphabetCompleted;

  const lowerCompleted = completeOneMissingFromSequence(options, "abcdefghijklmnopqrstuvwxyz".split(""));
  if (lowerCompleted.length !== uniqueLength) return lowerCompleted;

  const upperCompleted = completeOneMissingFromSequence(options, "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
  if (upperCompleted.length !== uniqueLength) return upperCompleted;

  const katakanaCompleted = completeOneMissingFromSequence(
    options,
    "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン".split(""),
  );
  if (katakanaCompleted.length !== uniqueLength) return katakanaCompleted;

  return completeOneMissingNumericOptions(options);
};

const normalizeOptions = (options: unknown): string[] => {
  let normalized: string[] = [];
  if (Array.isArray(options)) {
    normalized = options.map((option) => normalizeChoiceLabel(option)).filter(Boolean);
  } else if (typeof options === "string") {
    normalized = options.split(",").map((option) => normalizeChoiceLabel(option)).filter(Boolean);
  }
  return completeLikelyMissingOption(normalized);
};

const MAX_AUTO_CHOICE_NUMBER = 10;

const isSmallChoiceNumber = (value: unknown): boolean => {
  const num = Number(value);
  return Number.isInteger(num) && num >= 1 && num <= MAX_AUTO_CHOICE_NUMBER;
};

const isLargeSequentialNumericOptions = (options: string[]): boolean => {
  if (options.length <= MAX_AUTO_CHOICE_NUMBER) return false;
  return options.every((option, idx) => String(option).trim() === String(idx + 1));
};

const normalizeChoiceAnswer = (answer: unknown): string => {
  if (Array.isArray(answer)) {
    return answer.map((item) => normalizeChoiceLabel(item)).filter(Boolean).join(",");
  }
  return normalizeChoiceLabel(answer);
};

const normalizeAlternativeAnswers = (answers: unknown): unknown => {
  if (!Array.isArray(answers)) return answers;
  return answers.map((answer) => normalizeChoiceLabel(answer)).filter(Boolean);
};

const splitAnswerParts = (answer: unknown): string[] => {
  if (Array.isArray(answer)) {
    return answer.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(answer ?? "")
    .split(/[,\u3001]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const hasNonEmptyText = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;

const hasQuestionScoringElements = (question: Record<string, unknown>): boolean => {
  const elements = question.scoringElements;
  if (!Array.isArray(elements)) return false;
  return elements.some((item) => {
    if (!isRecord(item)) return false;
    if (
      item.type === "character_count" &&
      item.description === "答案の文字数が指定範囲内である" &&
      !item.minChars &&
      !item.maxChars &&
      (Number(item.points) || 0) === 0
    ) {
      return false;
    }
    return hasNonEmptyText(item.description) || Number.isFinite(Number(item.points));
  });
};

const normalizeGeneratedScoringElement = (item: Record<string, unknown>, idx: number): Record<string, unknown> => {
  const type = ["content", "logic", "character_count", "deduction", "force_zero"].includes(String(item.type))
    ? String(item.type)
    : "content";
  const rawPoints = Number(item.points);
  const points = type === "force_zero"
    ? 0
    : type === "deduction"
      ? -Math.abs(Number.isFinite(rawPoints) ? rawPoints : 1)
      : Math.max(0, Number.isFinite(rawPoints) ? rawPoints : 0);
  return {
    id: String(item.id || `e${idx + 1}`),
    description: String(item.description || "").trim(),
    points,
    allowPartial: type === "character_count" ? false : Boolean(item.allowPartial),
    type,
    minChars: Number.isFinite(Number(item.minChars)) && Number(item.minChars) > 0 ? Number(item.minChars) : null,
    maxChars: Number.isFinite(Number(item.maxChars)) && Number(item.maxChars) > 0 ? Number(item.maxChars) : null,
    forceZeroOnFail: type === "character_count" ? item.forceZeroOnFail !== false : Boolean(item.forceZeroOnFail),
  };
};

const ensureEssayCharacterCountElement = (question: Record<string, unknown>): Record<string, unknown> => {
  if (String(question.type || "").toLowerCase() !== "essay") return question;
  const elements = Array.isArray(question.scoringElements)
    ? question.scoringElements.filter(isRecord).map((item, idx) => normalizeGeneratedScoringElement(item, idx))
    : [];
  if (!elements.some((item) => item.type === "character_count")) {
    if (elements.length >= 20) elements.pop();
    elements.push({
      id: `e${elements.length + 1}`,
      description: "答案の文字数が指定範囲内である",
      points: 0,
      allowPartial: false,
      type: "character_count",
      minChars: null,
      maxChars: null,
      forceZeroOnFail: true,
    });
  }
  return { ...question, scoringElements: elements };
};

const inferGeneratedQuestionType = (question: Record<string, unknown>, options: string[]): string => {
  const currentType = String(question.type || "").toLowerCase();
  const autoNormalizableTypes = ["", "selection", "selection_multi", "ordering", "descriptive", "essay", "writing"];
  if (!autoNormalizableTypes.includes(currentType)) return String(question.type || "");
  if (currentType === "descriptive") return "descriptive";

  const answerParts = splitAnswerParts(question.correctAnswer);
  const answerIssue = String(question.answerIssue || "");
  const textBlob = [
    question.label,
    question.question,
    question.prompt,
    question.instruction,
    question.explanation,
  ].filter(Boolean).join(" ");
  const hasOrderingSignal = currentType === "ordering" ||
    ["並び替え", "並べ替え", "並べかえ", "整序", "語順", "正しい順", "順番", "並べ"].some((keyword) => textBlob.includes(keyword));
  const hasEssaySignal = currentType === "essay" || currentType === "writing" ||
    hasNonEmptyText(question.gradingInstruction) ||
    hasNonEmptyText(question.gradingCriteria) ||
    hasQuestionScoringElements(question) ||
    ["自由記述", "論述", "小論文", "作文", "英作文", "要約", "あなたの考え", "自分の考え"].some((keyword) => textBlob.includes(keyword));

  if (hasEssaySignal) return "essay";
  if (options.length > 0 && answerParts.length > 1 && hasOrderingSignal) return "ordering";
  if (options.length > 0 && answerParts.length > 1 && answerIssue !== "single_choice_multiple_answers") return "selection_multi";
  if (options.length > 0) return "selection";
  return "descriptive";
};

const isGeneratedKanjiQuestion = (question: Record<string, unknown>): boolean => {
  const text = [
    question.answerIssue,
    question.answerFormat,
    question.label,
    question.prompt,
    question.questionText,
    question.question,
    question.instruction,
    question.explanation,
  ].map((value) => String(value ?? "").normalize("NFKC")).join("\n");
  return text.includes("漢字") &&
    /漢字(?:で|に|を|の|問題|表記|直|書|改|答|記せ|記し|記入|書き|なお|変換)|漢字に改め|漢字で答|漢字で書|漢字表記/u.test(text);
};

const coerceGeneratedQuestion = (question: Record<string, unknown>, fallbackIndex: number) => {
  const next = { ...question };
  next.id = String(next.id || fallbackIndex + 1);
  next.label = String(next.label || `問${fallbackIndex + 1}`);
  next.correctAnswer = next.correctAnswer === undefined || next.correctAnswer === null
    ? ""
    : Array.isArray(next.correctAnswer)
      ? next.correctAnswer.join(",")
      : String(next.correctAnswer);
  next.points = Number.isFinite(Number(next.points)) && Number(next.points) > 0
    ? Math.round(Number(next.points))
    : 1;
  next.explanation = typeof next.explanation === "string" ? next.explanation : "";
  let options = normalizeOptions(next.options);
  if (isLargeSequentialNumericOptions(options)) {
    options = [];
  }
  next.type = inferGeneratedQuestionType(next, options);
  next.correctAnswer = normalizeChoiceAnswer(next.correctAnswer);
  if (Array.isArray(next.alternativeAnswers)) {
    next.alternativeAnswers = normalizeAlternativeAnswers(next.alternativeAnswers);
  }
  if (options.length > 0 || ["selection", "selection_multi", "ordering"].includes(String(next.type))) {
    next.options = options;
  } else {
    delete next.options;
  }
  if (isGeneratedKanjiQuestion(next)) {
    next.answerIssue = "kanji_self_grade";
    next.answerFormat = "kanji_self_grade";
  }
  return ensureEssayCharacterCountElement(next);
};

const normalizeGeneratedSection = (
  section: Record<string, unknown>,
  sectionIndex: string | number,
  targetPoints: number | null,
) => {
  const next = { ...section };
  next.id = String(next.id || sectionIndex);
  next.label = String(next.label || `第${sectionIndex}問`);
  next.sectionAnalysis = typeof next.sectionAnalysis === "string" ? next.sectionAnalysis : "";

  const questions = Array.isArray(next.questions)
    ? next.questions.filter(isRecord).map((question, idx) => coerceGeneratedQuestion(question, idx))
    : [];

  if (questions.length > 0) {
    const desiredTotal = targetPoints && targetPoints > 0
      ? targetPoints
      : Number.isFinite(Number(next.allocatedPoints)) && Number(next.allocatedPoints) > 0
        ? Math.round(Number(next.allocatedPoints))
        : questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);

    let currentTotal = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);
    if (desiredTotal > 0 && currentTotal !== desiredTotal) {
      if (currentTotal <= 0 || questions.some((q) => !Number.isFinite(Number(q.points)) || Number(q.points) <= 0)) {
        const base = Math.floor(desiredTotal / questions.length);
        let remainder = desiredTotal - base * questions.length;
        questions.forEach((q) => {
          q.points = Math.max(1, base + (remainder > 0 ? 1 : 0));
          remainder -= 1;
        });
      } else {
        const sorted = [...questions].sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0));
        while (currentTotal < desiredTotal) {
          sorted[0].points = (Number(sorted[0].points) || 0) + 1;
          currentTotal += 1;
        }
        let guard = 0;
        while (currentTotal > desiredTotal && guard < 10000) {
          const target = sorted.find((q) => (Number(q.points) || 0) > 1);
          if (!target) break;
          target.points = (Number(target.points) || 0) - 1;
          currentTotal -= 1;
          guard += 1;
        }
      }
    }

    next.allocatedPoints = desiredTotal > 0
      ? desiredTotal
      : questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);
  } else {
    next.allocatedPoints = targetPoints && targetPoints > 0
      ? targetPoints
      : Number.isFinite(Number(next.allocatedPoints))
        ? Number(next.allocatedPoints)
        : 0;
  }

  next.questions = questions;
  return next;
};

const normalizeQuestionKey = (value: unknown): string => String(value ?? "")
  .normalize("NFKC")
  .replace(/^(設問|小問|問)/, "")
  .replace(/[()（）\[\]【】.\s]/g, "")
  .trim()
  .toLowerCase();

const extractQuestionNumbers = (value: unknown): number[] => {
  const text = String(value ?? "").normalize("NFKC");
  const numbers = Array.from(text.matchAll(/\d+/g))
    .map((match) => Number(match[0]))
    .filter((num) => Number.isInteger(num) && num > 0);
  return Array.from(new Set(numbers));
};

const makeGroupedQuestionLabel = (numbers: number[]): string =>
  numbers.map((num) => `(${num})`).join("");

const parseChoiceNumberAnswer = (value: unknown): { answer: string; answerNote: string; isChoiceNumber: boolean } => {
  const text = String(value ?? "").normalize("NFKC").trim();
  const match = text.match(/^([0-9]{1,2})\s*[（(]\s*([^）)]+?)\s*[）)]$/u);
  if (!match) {
    return { answer: text, answerNote: "", isChoiceNumber: false };
  }
  return {
    answer: match[1],
    answerNote: match[2].trim(),
    isChoiceNumber: true,
  };
};

const getQuestionNumberCoverage = (questions: Array<Record<string, unknown>>): number => {
  const covered = new Set<number>();
  questions.forEach((question) => {
    const numbers = extractQuestionNumbers(`${String(question.id ?? "")} ${String(question.label ?? "")}`);
    if (numbers.length > 0) {
      numbers.forEach((num) => covered.add(num));
    } else {
      covered.add(covered.size + 1);
    }
  });
  return covered.size;
};

const normalizeDetectedAnswerItems = (
  detectedItems: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> => {
  const baseItems = detectedItems.map((item, idx) => {
    const rawId = String(item.id || item.label || idx + 1).trim();
    const numbers = extractQuestionNumbers(rawId);
    const groupedId = numbers.length >= 2 ? numbers.join("-") : rawId;
    const defaultLabel = rawId && !/^[0-9０-９]+$/u.test(rawId.normalize("NFKC"))
      ? rawId
      : `問${rawId || idx + 1}`;
    const answerParts = parseChoiceNumberAnswer(item.answer || item.correctAnswer || "");
    const explicitChoiceNumber = item.answerFormat === "choice_number" || item.type === "selection";
    const choiceNumber = (answerParts.isChoiceNumber || explicitChoiceNumber) && isSmallChoiceNumber(answerParts.answer);
    return {
      id: groupedId || String(idx + 1),
      label: numbers.length >= 2 ? makeGroupedQuestionLabel(numbers) : String(item.label || defaultLabel).trim(),
      answer: answerParts.answer,
      answerNote: String(item.answerText || item.answerNote || answerParts.answerNote || "").trim(),
      answerFormat: choiceNumber ? "choice_number" : "",
    };
  });
  const maxChoiceNumber = Math.max(
    0,
    ...baseItems
      .filter((item) => item.answerFormat === "choice_number")
      .map((item) => Number(item.answer))
      .filter((num) => Number.isInteger(num) && num > 0),
  );
  const choiceOptions = maxChoiceNumber >= 2 && maxChoiceNumber <= MAX_AUTO_CHOICE_NUMBER
    ? Array.from({ length: maxChoiceNumber }, (_item, idx) => String(idx + 1))
    : [];
  const normalized = baseItems.map((item) => item.answerFormat === "choice_number"
    ? { ...item, type: "selection", options: choiceOptions }
    : item);

  const hasExplicitGroup = normalized.some((item) => extractQuestionNumbers(item.id).length >= 2);
  if (hasExplicitGroup || normalized.length < 4 || normalized.length % 2 !== 0) {
    return normalized;
  }

  const mergeablePairs: Array<Record<string, unknown>> = [];
  for (let i = 0; i < normalized.length; i += 2) {
    const first = normalized[i];
    const second = normalized[i + 1];
    const firstNums = extractQuestionNumbers(first.id);
    const secondNums = extractQuestionNumbers(second.id);
    const sameAnswer = String(first.answer || "").trim() !== "" &&
      String(first.answer || "").trim() === String(second.answer || "").trim();
    const consecutive = firstNums.length === 1 && secondNums.length === 1 && secondNums[0] === firstNums[0] + 1;
    if (!sameAnswer || !consecutive) {
      return normalized;
    }
    const numbers = [firstNums[0], secondNums[0]];
    mergeablePairs.push({
      id: numbers.join("-"),
      label: makeGroupedQuestionLabel(numbers),
      answer: first.answer,
      answerNote: first.answerNote,
      answerFormat: first.answerFormat,
      type: first.type,
      options: first.options,
    });
  }

  return mergeablePairs;
};

const buildRequiredQuestionItems = (
  detectedItems: Array<Record<string, unknown>>,
  expectedQuestionCount: number | null,
): Array<Record<string, unknown>> => {
  const detected = normalizeDetectedAnswerItems(detectedItems);

  const hasGroupedDetected = detected.some((item) => extractQuestionNumbers(item.id).length >= 2);
  if (hasGroupedDetected) return detected;
  const hasNonNumericDetected = detected.some((item) => {
    const key = normalizeQuestionKey(item.id);
    return key && !/^\d+$/u.test(key);
  });
  if (hasNonNumericDetected && (!expectedQuestionCount || detected.length >= expectedQuestionCount)) {
    return detected;
  }

  const requiredCount = hasGroupedDetected
    ? detected.length
    : Math.max(expectedQuestionCount || 0, detected.length);
  if (requiredCount <= 0) return detected;

  const byNumericId = new Map<number, Record<string, unknown>>();
  detected.forEach((item) => {
    const numericId = Number(normalizeQuestionKey(item.id));
    if (Number.isInteger(numericId) && numericId >= 1 && numericId <= requiredCount) {
      byNumericId.set(numericId, item);
    }
  });

  const required: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= requiredCount; i += 1) {
    const detectedItem = byNumericId.get(i) || (!expectedQuestionCount ? detected[i - 1] : null);
    required.push({
      id: String(detectedItem?.id || i),
      label: String(detectedItem?.label || `問${i}`),
      answer: String(detectedItem?.answer || ""),
      answerNote: String(detectedItem?.answerNote || ""),
      answerFormat: String(detectedItem?.answerFormat || ""),
      type: detectedItem?.type,
      options: detectedItem?.options,
    });
  }
  return required;
};

const rebalanceQuestionPoints = (questions: Array<Record<string, unknown>>, targetPoints: number | null) => {
  if (questions.length === 0) return questions;
  const desiredTotal = targetPoints && targetPoints > 0
    ? targetPoints
    : questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0) || questions.length;

  const base = Math.max(1, Math.floor(desiredTotal / questions.length));
  if (desiredTotal < questions.length) {
    let remaining = desiredTotal;
    return questions.map((question) => {
      const points = remaining > 0 ? 1 : 0;
      remaining -= points;
      return { ...question, points };
    });
  }

  let remainder = desiredTotal - base * questions.length;
  return questions.map((question) => {
    const points = base + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return { ...question, points: Math.max(1, points) };
  });
};

const forceRequiredQuestions = (
  section: Record<string, unknown>,
  requiredItems: Array<Record<string, unknown>>,
  targetPoints: number | null,
) => {
  if (requiredItems.length === 0) return section;

  const existingQuestions = Array.isArray(section.questions)
    ? section.questions.filter(isRecord)
    : [];
  const byId = new Map<string, Record<string, unknown>>();
  existingQuestions.forEach((question) => {
    byId.set(normalizeQuestionKey(question.id), question);
    byId.set(normalizeQuestionKey(question.label), question);
  });

  let missingCount = 0;
  const questions = requiredItems.map((item, idx) => {
    const requiredId = String(item.id || idx + 1).trim() || String(idx + 1);
    const existing = byId.get(normalizeQuestionKey(requiredId)) ||
      byId.get(normalizeQuestionKey(item.label)) ||
      {};
    const fallbackAnswer = String(item.answer || "").trim();
    const correctAnswer = String(
      item.answerFormat === "choice_number"
        ? fallbackAnswer || existing.correctAnswer || "要確認"
        : existing.correctAnswer || fallbackAnswer || "要確認"
    ).trim();
    if (!existing.correctAnswer && !fallbackAnswer) missingCount += 1;

    return coerceGeneratedQuestion({
      ...existing,
      id: requiredId,
      label: String(existing.label || item.label || `問${requiredId}`),
      type: item.type || existing.type,
      options: item.options || existing.options,
      correctAnswer,
      answerNote: item.answerNote || existing.answerNote,
      answerFormat: item.answerFormat || existing.answerFormat,
      points: Number(existing.points) || 1,
      explanation: existing.explanation || "",
      needsReview: Boolean((existing as Record<string, unknown>).needsReview) || correctAnswer === "要確認",
    }, idx);
  });

  const rebalancedQuestions = rebalanceQuestionPoints(questions, targetPoints);
  return {
    ...section,
    questions: rebalancedQuestions,
    allocatedPoints: targetPoints && targetPoints > 0
      ? targetPoints
      : rebalancedQuestions.reduce((sum, question) => sum + (Number(question.points) || 0), 0),
    generationWarnings: missingCount > 0
      ? [
        ...(Array.isArray(section.generationWarnings) ? section.generationWarnings : []),
        `${missingCount}件の正解を画像から確定できなかったため correctAnswer に「要確認」を入れています。`,
      ]
      : section.generationWarnings,
  };
};

const splitIntoChunks = <T,>(items: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
};

const validateGeneratedQuestionCount = (
  questions: Array<Record<string, unknown>>,
  expectedCount: number,
  context: string,
) => {
  if (questions.length !== expectedCount) {
    throw new Error(`${context}: 小問が ${questions.length} 件しか生成されていません。期待小問数 ${expectedCount} 件と一致しないため破棄しました。`);
  }
};

const buildFallbackQuestionsFromRequiredItems = (
  requiredItems: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> => requiredItems.map((item, idx) => coerceGeneratedQuestion({
  id: String(item.id || idx + 1),
  label: String(item.label || `問${idx + 1}`),
  type: item.type || (item.answerFormat === "choice_number" ? "selection" : "descriptive"),
  options: item.options || [],
  correctAnswer: String(item.answer || "要確認"),
  answerNote: item.answerNote || "",
  answerFormat: item.answerFormat || "",
  points: 1,
  explanation: "",
  needsReview: true,
}, idx));

const buildSequentialRequiredItems = (
  count: number,
): Array<Record<string, unknown>> => Array.from({ length: count }, (_item, idx) => ({
  id: String(idx + 1),
  label: `問${idx + 1}`,
  answer: "要確認",
  answerNote: "",
  answerFormat: "",
}));

async function generateSectionQuestionsInChunks(
  genAI: GoogleGenerativeAI,
  sectionIndex: string | number,
  subjectType: string,
  instruction: string,
  requiredItems: Array<Record<string, unknown>>,
  qInlineData: Array<Record<string, unknown>>,
  aInlineData: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const chunks = splitIntoChunks(requiredItems, 6);
  const generatedQuestions: Array<Record<string, unknown>> = [];

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const chunkPrompt = `
あなたは大学入試問題データの抽出担当です。
第${sectionIndex}問のうち、以下の requiredQuestions に listed された小問だけを抽出してください。

【この呼び出しで生成する小問】
${JSON.stringify(chunk.map((item, idx) => ({
  id: String(item.id || idx + 1),
  label: String(item.label || `問${item.id || idx + 1}`),
  correctAnswerHint: String(item.answer || ""),
  answerFormat: String(item.answerFormat || ""),
  optionsHint: item.options || [],
  answerNote: String(item.answerNote || ""),
})), null, 2)}

【絶対ルール】
1. 出力する questions は必ず ${chunk.length} 件。多くても少なくても不可。
2. requiredQuestions にない小問は出力しない。
3. requiredQuestions の順番通りに出力する。
4. id は requiredQuestions の id と完全一致させる。
5. correctAnswerHint がある場合、correctAnswer はそれを優先して使う。
6. answerFormat が "choice_number" の場合は、番号だけを答える選択問題です。type は必ず "selection"、correctAnswer は番号のみ、options は optionsHint を使うこと。
7. 問題文から、type と options をできる限り正確に抽出する。
8. 選択肢があり正解が1つなら "selection"、順不同の複数正解なら "selection_multi"、並び替えなら "ordering"、短答記述なら "descriptive"、自由記述・論述・英作文なら "essay"。
9. カタカナ選択肢の「カ」を漢字の「力」に、「オ」を漢字の「才」に誤変換しない。
10. points は仮で 1、explanation は空文字 "" にする。
11. Markdown、説明文、コードブロックは禁止。JSONオブジェクト1つのみ返す。
${instruction ? `\n【個別指示】\n${instruction}\n` : ""}

【出力形式】
{
  "questions": [
    {
      "id": "requiredQuestionsと同じID",
      "label": "問1",
      "type": "selection",
      "options": ["ア", "イ", "ウ", "エ"],
      "correctAnswer": "ア",
      "points": 1,
      "explanation": ""
    }
  ]
}
`;

    let chunkQuestions: Array<Record<string, unknown>> | null = null;
    let lastChunkError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const retryPrompt = attempt === 1
        ? chunkPrompt
        : `${chunkPrompt}

【再生成指示】
前回は小問数またはJSON形式が不正でした。
必ず questions を ${chunk.length} 件、requiredQuestions と同じ順番・同じIDで返してください。`;
      try {
        const result = await generateContentWithFallback(genAI, {
          contents: [{ role: "user", parts: [...qInlineData, ...aInlineData, { text: retryPrompt }] }],
          generationConfig: { maxOutputTokens: 4096 },
        }, 1, 1000, ["gemini-2.5-flash", "gemini-2.0-flash"]);

        const parsed = JSON.parse(sanitizeJson(result.response.text())) as Record<string, unknown>;
        const rawQuestions = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.questions)
            ? parsed.questions
            : [];
        const normalizedQuestions = rawQuestions
          .filter(isRecord)
          .map((question, idx) => coerceGeneratedQuestion({
            ...question,
            id: String(chunk[idx]?.id || question.id || idx + 1),
            type: chunk[idx]?.type || question.type,
            options: chunk[idx]?.options || question.options,
            correctAnswer: chunk[idx]?.answerFormat === "choice_number"
              ? chunk[idx]?.answer || "要確認"
              : question.correctAnswer || chunk[idx]?.answer || "要確認",
            answerNote: chunk[idx]?.answerNote || question.answerNote,
            answerFormat: chunk[idx]?.answerFormat || question.answerFormat,
            needsReview: Boolean(question.needsReview) || !question.correctAnswer && !chunk[idx]?.answer,
          }, idx));
        validateGeneratedQuestionCount(normalizedQuestions, chunk.length, `第${sectionIndex}問 チャンク${chunkIndex + 1}`);
        chunkQuestions = normalizedQuestions;
        break;
      } catch (error) {
        lastChunkError = error;
        console.warn(`Section ${sectionIndex} chunk ${chunkIndex + 1} attempt ${attempt} failed:`, (error as Error).message);
      }
    }

    if (!chunkQuestions) {
      console.warn(
        `Section ${sectionIndex} chunk ${chunkIndex + 1} failed; using needsReview fallback:`,
        lastChunkError instanceof Error ? lastChunkError.message : String(lastChunkError),
      );
      chunkQuestions = buildFallbackQuestionsFromRequiredItems(chunk);
    }
    generatedQuestions.push(...chunkQuestions);
  }

  return generatedQuestions;
}

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
          err.message = "AIの出力が途中で途切れました。生成結果を反映せず、入力PDFを大問ごとに分けるか再実行してください。";
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
  const isJapanese = subjectType === "japanese";
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
  } else if (isJapanese) {
    subjectSpecificRules = JAPANESE_RULES + `
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
${isJapanese ? `
【国語の追加抽出ルール】
・現代文/古文/漢文では、本文そのものではなく「設問」「問」「(一)」「1」「A」などの解答欄に対応する単位を小問として抽出してください。
・解答用紙に「解答一覧」「正解一覧」「配点表」がある場合、それは選択肢一覧ではなく正解データとして扱い、各設問へ正しく紐付けてください。
・記号選択は type: "selection"、複数選択は "selection_multi"、抜き出し・空欄補充・語句説明は "descriptive"、本文内容を自分の言葉で説明する設問は "essay" にしてください。
・漢字の書き取り・漢字表記・漢字に直す問題は、自動採点不能です。type は "descriptive"、answerIssue と answerFormat は必ず "kanji_self_grade" にしてください。
・解答欄が「1) 3」「問一 4」「設問A ②」のように番号だけの場合でも、省略せず必ず小問として作成してください。
・大問本文の段落や選択肢本文を、小問として数えないでください。
` : ""}

【抽出条件と厳格ルール】
1. この大問（第${sectionIndex}問）の中に含まれる小問を全て抽出すること。
2. アスタリスク（*）記号を絶対に使用しないでください。
3. 以下のJSON構造（オブジェクト1つ）のみを出力してください（コードブロックなし）。
4. 選択問題・並び替え問題の \`options\` 配列には、記号・番号（例: "1", "a", "ア" など）のみを含めてください。
5. 全ての小問の \`points\` は 0 に設定してください。
6. 全ての小問の \`explanation\` は必ず空文字 ("") に設定し、解説文は一切生成しないでください。
7. 画像からテキストを読み取る際は、誤字脱字に注意し、正確に抽出してください。
8. 語句・文・選択肢を正しい順番に並べ替える問題は、必ず \`type\` を "ordering" にしてください。この場合、\`correctAnswer\` は正しい順番をカンマ区切りで出力してください（例: "c,a,d,b"）。順序が採点対象ではない複数選択だけ "selection_multi" を使ってください。
9. 問題タイプは厳密に分類してください。選択肢があり正解が1つなら "selection"、選択肢があり順不同の複数正解なら "selection_multi"、選択肢を正しい順に並べるなら "ordering"、選択肢がない短答・語句記述なら "descriptive"、採点基準が必要な自由記述・論述・英作文なら "essay" にしてください。
10. カタカナ選択肢はOCRで漢字に誤変換しないでください。特に選択肢記号の「カ」は漢字の「力」ではなく必ず「カ」、「オ」は漢字の「才」ではなく必ず「オ」として出力してください。

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
      "answerIssue": "",
      "answerFormat": "",
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
    validateSectionData(parsedSection, `第${sectionIndex}問の構造抽出`, false);
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

  const fullSections = JSON.parse(sanitizeJson(pointsResult.response.text()));
  validateSectionsData(fullSections, maxScore, "配点生成結果", true);

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
  const subjectType = body.subjectType ?? (questionData as Record<string, unknown> | undefined)?.subjectType;
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  const answerFilesData = (body.answerFilesData as Array<{ data: string; mimeType: string }>) || [];

  const imageParts = [...toImageParts(questionFilesData), ...toImageParts(answerFilesData)];
  const unverifiedExplanation = isJapaneseSubject(subjectType)
    ? JAPANESE_UNVERIFIABLE_EXPLANATION
    : QUESTION_EXPLANATION_UNVERIFIABLE;
  const outputRule = `出力はJSONオブジェクト1つのみを返してください。
{
  "evidenceQuote": "本文・設問文・選択肢・解答画像から実際に読める短い根拠語句。確認できない場合は空欄",
  "explanation": "2〜3文以内の小問解説"
}
根拠引用が取れない場合は evidenceQuote を空欄、explanation を「${unverifiedExplanation}」にしてください。`;

  const prompt = `あなたは大学入試の専門講師です。
以下の設問について、【必ず2〜3文以内】の簡潔な解説を作成してください。

【対象の設問（構造データ）】
${JSON.stringify(questionData, null, 2)}

【絶対厳守のルール】
1. 文章は【2〜3文以内】に収めること。これを超えることは絶対に禁止です。
2. 「なぜ正解か」の根拠を本文の具体的な箇所（第◯段落など）を挙げて簡潔に説明すること。
3. 主要な誤答選択肢がなぜ間違いかを1文で触れること。
4. アスタリスク（*）などの記号による装飾は一切使用しないこと。
5. 正解番号だけから解説を作らないこと。該当小問の本文・設問文・選択肢文・模範解答の具体語句を確認できない場合は要確認にすること。
6. 複数小問が写った画像では、対象小問の番号と根拠箇所を特定できる場合だけ解説すること。
${questionExplanationQualityRules(subjectType)}
${japaneseQuestionExplanationRules(subjectType)}

${outputRule}
`;

  const result = await generateContentWithFallback(genAI, {
    contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
    generationConfig: { maxOutputTokens: 32768 },
  });

  try {
    const parsed = JSON.parse(sanitizeJson(result.response.text())) as Record<string, unknown>;
    return applyQuestionExplanationGuard(parsed, subjectType, questionData);
  } catch (_error) {
    return {
      explanation: unverifiedExplanation,
      evidenceQuote: "",
      needsReview: true,
      explanationIssue: "invalid_explanation_response",
    };
  }
}

async function handleExtractQuestionEvidence(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const subjectType = body.subjectType;
  const sectionData = (body.sectionData as Record<string, unknown>) || {};
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  const answerFilesData = (body.answerFilesData as Array<{ data: string; mimeType: string }>) || [];
  const questions = (sectionData.questions as Array<Record<string, unknown>>) || [];

  if (questions.length === 0) return sectionData;
  if (!isJapaneseSubject(subjectType)) return sectionData;

  const imageParts = [...toImageParts(questionFilesData), ...toImageParts(answerFilesData)];
  const updatedQuestions = [...questions];

  for (let i = 0; i < questions.length; i += 1) {
    const question = questions[i];
    if (hasExtractedQuestionEvidence(question)) continue;

    const slimQuestion = {
      id: question.id,
      label: question.label,
      type: question.type,
      options: question.options,
      correctAnswer: question.correctAnswer,
      points: question.points,
      questionText: question.questionText || question.prompt || question.instruction || question.text || "",
      choiceTexts: question.choiceTexts || question.choices || {},
      sourceExcerpt: question.sourceExcerpt || question.evidenceHint || "",
      evidenceQuote: question.evidenceQuote || "",
    };

    const prompt = `あなたは大学入試国語の問題データ整備担当です。
以下の画像（問題・解答）を確認し、対象小問に対応する「解説生成のための根拠データ」だけを抽出してください。

【対象小問】
${JSON.stringify(slimQuestion, null, 2)}

【抽出ルール】
1. 解説文はまだ作らないこと。根拠データだけを作ること。
2. 対象小問の設問文を読める範囲で questionText に入れること。
3. 選択問題の場合、選択肢本文を読める範囲で choiceTexts に {"1":"...", "2":"..."} の形で入れること。読めない選択肢は省略してよい。
4. 正解の根拠になる本文・設問・解答画像内の短い引用を evidenceQuote に入れること。
5. sourceExcerpt には、evidenceQuote の周辺文脈や設問条件など、解説生成に必要な短い根拠を入れること。
6. 対象小問を画像内で特定できない、または根拠が読めない場合は、questionText/sourceExcerpt/evidenceQuote を空欄にし、extractionIssue に理由を書くこと。
7. 存在しない本文・選択肢・根拠を作らないこと。推測で補完しないこと。
8. 出力はJSONオブジェクト1つのみ。

【出力形式】
{
  "id": "${String(question.id || "")}",
  "label": "${String(question.label || "")}",
  "questionText": "設問文。読めない場合は空欄",
  "choiceTexts": { "1": "選択肢1本文", "2": "選択肢2本文" },
  "sourceExcerpt": "根拠となる本文・設問・解答画像内の短い文脈",
  "evidenceQuote": "実際に読める短い根拠語句",
  "evidenceConfidence": "high|medium|low",
  "extractionIssue": "抽出できない場合だけ理由"
}`;

    try {
      const result = await generateContentWithFallback(genAI, {
        contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
        generationConfig: { maxOutputTokens: 4096 },
      }, 2, 1200, ["gemini-2.5-flash", "gemini-2.0-flash"]);

      const parsed = JSON.parse(sanitizeJson(result.response.text())) as Record<string, unknown>;
      updatedQuestions[i] = normalizeEvidenceQuestionPatch(question, parsed);
    } catch (error) {
      console.warn("[gemini-admin] Question evidence extraction failed:", error);
      updatedQuestions[i] = {
        ...question,
        needsReview: true,
        explanationIssue: "question_evidence_extraction_failed",
      };
    }
  }

  return {
    ...sectionData,
    questions: updatedQuestions,
  };
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
  const isJapanese = subjectType === "japanese";
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
  } else if (isJapanese) {
    subjectSpecificRules = JAPANESE_RULES + `
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
  const adminInstruction = specialInstruction.replace(/SECTION_ANALYSIS_COMPACT_BLOCK/g, "").trim();
  const subjectName = (body.subjectName as string) || "";
  const allQuestions = (sectionData.questions as Array<Record<string, unknown>>) || [];

  const imageParts = [...toImageParts(questionFilesData), ...toImageParts(answerFilesData)];

  if (specialInstruction.includes("SECTION_ANALYSIS_COMPACT_BLOCK")) {
    const questions = (sectionData.questions as Array<Record<string, unknown>>) || [];
    const adminInstructionBlock = buildAdminInstructionBlock(adminInstruction);
    const compactPrompt = adminInstruction
      ? buildAdminFirstSectionAnalysisPrompt(adminInstruction, sectionData, subjectType, subjectName, questions, {
          imageAvailable: false,
          fallbackMode: "全自動生成中のコンパクト生成",
        })
      : `
あなたは大学入試の専門講師です。
以下の小問データをもとに、各設問の正解根拠が分かる解説本文を作成してください。

【最優先命令】
${adminInstructionBlock}
${adminInstruction ? "\nこれは全自動生成中のコンパクト生成ですが、管理者の個別指示を省略・簡略化・別テンプレート化してはいけません。自作プロンプトの構成を維持してください。\n" : ""}

【対象】
科目: ${subjectName || subjectType || "未設定"}
大問: 第${sectionData.id}問（${sectionData.label || ""}）

【小問データ】
${JSON.stringify(questions.map((q) => ({
      id: q.id,
      label: q.label,
      type: q.type,
      correctAnswer: q.correctAnswer,
      points: q.points,
      answerIssue: q.answerIssue,
      needsReview: q.needsReview,
    })), null, 2)}

【出力ルール】
${adminInstruction ? "・出力形式、見出し、順番、分量は管理者の個別指示だけに従う。" : ""}
・講評、学習アドバイス、全体所感ではなく、設問ごとの解法根拠を中心に書く。
・各小問について、正解がなぜその答えになるかを簡潔に含める。
${adminInstruction ? "" : "・「① 解答」「② 問題の論点整理」などの番号付き構成は禁止。"}
・「分析ブロック」という語は禁止。
・共通テーマや注意点だけで終わらせない。
・画像は参照できないため、正解データと問題タイプから断定できる範囲だけを書く。
${adminInstruction ? "" : "・800字以内。"}
・アスタリスク（*）禁止。
${adminInstruction ? "・管理者の個別指示にない前置き、タイトル、汎用見出し、まとめ、講評を追加しない。" : ""}
・本文のみ返す。
`;
    const compactResult = await generateContentWithFallback(genAI, {
      contents: [{ role: "user", parts: [{ text: compactPrompt }] }],
      generationConfig: { maxOutputTokens: 4096 },
    }, 2, 1500, ["gemini-2.5-flash", "gemini-2.0-flash"]);

    return cleanSectionAnalysisOutput(compactResult.response.text(), Boolean(adminInstruction));
  }

  if (imageParts.length === 0) {
    throw new Error("詳細解説には問題画像または解答画像が必要です。画像なしの構造データだけでは、プロンプトに沿った根拠ある解説を生成しません。");
  }

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

【出力形式】

${adminInstruction ? "・管理者の個別指示に前置き、タイトル、導入文の指定がある場合は、その指定を優先する。" : "・前置き、タイトル、挨拶、「本解説では」から始まる導入文は不要。"}
${adminInstruction ? "・管理者の個別指示に見出しや構成指定がある場合は、その指定を優先する。" : "・「全体解説①」「【解説】」「① 解答」「② 問題の論点整理」のような固定見出しは出さない。"}
${adminInstruction ? "" : "・最初の1行目から、設問の内容や正解根拠に入ること。"}
・必要に応じて段落を分けてよいが、各段落は読む文章として自然につなげる。
・正解、論点、必要知識、解答プロセス、誤答分析、応用の観点は、見出し化せず本文中に自然に含める。

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
  } else if (subjectType === "japanese") {
    basePrompt = `あなたは難関大学入試の国語（現代文・古文・漢文）を解説する専門講師である。
対象：第${sectionData.id}問（${sectionData.label}）

目的は、受験生が同じ手順で本文・設問・選択肢を処理できるように、正解根拠を本文に即して説明することである。

${buildJapaneseReadingAnalysisPrompt(allQuestions)}

【国語共通の最重要ルール】
・講評や学習アドバイスだけで終わらせず、各小問の正解に至る根拠を説明する。
・問題本文、設問文、選択肢、正解データを最優先する。
・本文から読めない一般論、作品知識、作者知識、雑学で正解を補強しない。
・正解データを勝手に変更しない。
・番号問題では、正解番号と括弧内の語句を混同しない。

【現代文の解説方針】
・指示語、接続語、対比、因果、言い換え、筆者の主張、段落関係を根拠にする。
・選択肢問題では、正解選択肢の根拠だけでなく、必要に応じて誤選択肢のズレを説明する。
・抜き出し問題では、設問条件と本文中の該当箇所がどう対応するかを説明する。

【古文の解説方針】
・主語補足、敬語、助動詞、古語、係り結び、和歌、文脈を必要な範囲で説明する。
・現代語訳は、単語対応だけでなく、文脈上の自然な意味を示す。
・登場人物や敬意の方向を混同しない。

【漢文の解説方針】
・句法、返り点、書き下し、重要語、文脈上の意味を根拠にする。
・句法名だけを羅列せず、それが正解にどうつながるかを説明する。

【出力形式】
${adminInstruction ? "・管理者の個別指示に見出しや構成指定がある場合は、その指定を優先する。" : "・上記の「出力順」を優先し、国語長文用の詳細解説として構成する。"}
・必要に応じて段落を分け、読む文章として自然につなげる。

【禁止事項】
・本文根拠のない一般論
・作品・作者・文学史への不要な脱線
・設問に無関係な知識展開
・講評だけで終わること
・「なんとなく自然」「感覚的に」などの曖昧表現
・アスタリスク（*）記号は一切使用禁止。** や * を見出し・強調に用いないこと`;
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

  const answersNote = allQuestions.length > 0
    ? `\n【最重要】正解データについて（絶対遵守）\n以下の正解は管理者が確認済みの確定データです。解説中で各小問の正解を示す際は、必ず下記の値をそのまま使用すること。PDFの画像を独自に読み取って別の回答を導き出すことは絶対に禁止です。\n${allQuestions.map((q) => `・${q.label}（${q.id}）: 正解 = "${q.correctAnswer}"`).join("\n")}\n`
    : "";
  const adminInstructionBlock = buildAdminInstructionBlock(adminInstruction);
  const instructionModeBlock = buildSectionAnalysisInstructionMode(adminInstruction, basePrompt);
  const instructionPriorityBlock = `【最優先命令】
この詳細解説生成では、以下の優先順位を必ず守ってください。
1. 管理者が入力した個別指示
2. 正解データ・小問データ・問題画像/解答画像
3. 科目別の一般ルール
4. 共通の文体・出力形式ルール

管理者の個別指示と科目別の一般ルールが衝突する場合は、正解データの改変禁止・虚偽情報禁止・アスタリスク禁止・本文のみ出力のルールを除き、管理者の個別指示を優先してください。
${adminInstructionBlock}`;

  const finalPrompt = adminInstruction
    ? buildAdminFirstSectionAnalysisPrompt(adminInstruction, sectionData, subjectType, subjectName, allQuestions, { imageAvailable: true })
    : `
${instructionPriorityBlock}

${instructionModeBlock}
${answersNote}
【対象データ（構造）】
${JSON.stringify(sectionData, null, 2)}

【文体・形式のルール（必須）】
${adminInstruction ? "・管理者の個別指示に出力形式、見出し、順番、分量の指定がある場合は、それを完全に実行する。" : ""}
${adminInstruction ? "・管理者の個別指示にない前置き、タイトル、導入文、まとめ、講評を追加しない。" : "・前置き、タイトル、挨拶、「本解説では」から始まる導入文は不要。最初から解説本文に入る。"}
${adminInstruction ? "・管理者の個別指示にない固定フォーマット見出しを追加しない。" : "・「全体解説①」「【解説】」「詳細解説」「大問分析」のような汎用見出しを冒頭に置かない。\n・「① 解答」「② 問題の論点整理」のような固定フォーマット見出しは使わない。"}
・全体講評、学習アドバイス、出題傾向の総評で終わらせない。
・各小問について、正解データと問題画像/解答画像に基づく「なぜその答えになるか」を必ず説明する。
・問題本文・選択肢・資料から読み取れる根拠を優先し、抽象的な評価文だけにしない。
・解説文（読む文章）として書くこと。授業口調・話し言葉は禁止。
・講師名・挨拶（「こんにちは」等）・締めの言葉（「お疲れ様でした」「応援しています」等）は一切不要。
・「皆さん」「聞いてください」「一緒に考えましょう」などの呼びかけ表現は使用しない。
・各問冒頭に「文全体をざっと読んでみましょう」等の定型導入を入れない。
・「→ Aは正しいので、誤りではありません。」のような全問共通の繰り返しパターンは避ける。
・全問共通のまとめ・総括・ポイント一覧は不要。各問の解説で完結させること。
・管理者の個別指示がない場合、## や ### などのMarkdown見出しは使わない。
・感嘆符（！）の多用は避ける。

【出力要件】
1. 管理者の個別指示がある場合はその出力形式だけに従う。ない場合は、読みやすい本文形式で記述すること。
2. アスタリスク（*）記号は使用禁止。
3. コードブロック（\`\`\`markdown）で囲まず、本文のみを出力すること。
4. 必ず日本語で記述すること。

出力は詳細解説本文のみを返してください。
`;

  const cleanAnalysisText = (text: string) =>
    cleanSectionAnalysisOutput(text, Boolean(adminInstruction));

  try {
    const result = await generateContentWithFallback(genAI, {
      contents: [{ role: "user", parts: [{ text: finalPrompt }, ...imageParts] }],
      generationConfig: { maxOutputTokens: 32768 },
    }, 3, 3000, ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"]);

    const text = cleanAnalysisText(result.response.text());
    if (!text) throw new Error("詳細解説の出力が空でした。");
    return text;
  } catch (primaryError) {
    console.warn(
      "Section analysis primary generation failed; trying compact fallback:",
      primaryError instanceof Error ? primaryError.message : String(primaryError),
    );
  }

const compactPrompt = adminInstruction
  ? buildAdminFirstSectionAnalysisPrompt(adminInstruction, sectionData, subjectType, subjectName, allQuestions, {
      imageAvailable: imageParts.length > 0,
      fallbackMode: "軽量フォールバック生成",
    })
  : `
あなたは大学入試の専門講師です。
以下の大問データと添付画像をもとに、各設問の正解根拠が分かる詳細解説本文を日本語で作成してください。

${instructionPriorityBlock}
${instructionModeBlock}
${adminInstruction ? "\n【重要】これはフォールバック生成ですが、管理者の個別指示を省略・簡略化・別テンプレート化してはいけません。自作プロンプトの構成を維持してください。\n" : ""}

【対象】
科目: ${subjectName || subjectType || "未設定"}
大問: 第${sectionData.id}問（${sectionData.label || ""}）

【小問データ】
${JSON.stringify({
    id: sectionData.id,
    label: sectionData.label,
    questionType: sectionData.questionType,
    questions: allQuestions.map((q) => ({
      id: q.id,
      label: q.label,
      type: q.type,
      correctAnswer: q.correctAnswer,
      points: q.points,
    })),
  }, null, 2)}

【出力ルール】
${adminInstruction ? "・出力形式、見出し、順番、分量は管理者の個別指示だけに従う。" : ""}
・各小問について、正解がなぜその答えになるかを説明する。
・講評、学習アドバイス、全体所感ではなく、設問ごとの解法根拠を中心に書く。
・正解データは上記の correctAnswer を優先し、画像から別解釈しない。
${adminInstruction ? "" : "・1200字以内。"}
・アスタリスク（*）禁止。
${adminInstruction ? "・管理者の個別指示にない前置き、タイトル、汎用見出し、まとめ、講評を追加しない。" : "・前置き、タイトル、汎用見出しは禁止。最初から解説本文に入る。"}
${adminInstruction ? "・管理者の個別指示にない固定フォーマット見出しを追加しない。" : "・「全体解説①」「【解説】」「① 解答」などの固定見出しは禁止。"}
・挨拶、講師名、締めの言葉は禁止。
・本文のみ返す。
`;

  try {
    const fallbackResult = await generateContentWithFallback(genAI, {
      contents: [{ role: "user", parts: [{ text: compactPrompt }, ...imageParts.slice(0, 1)] }],
      generationConfig: { maxOutputTokens: 8192 },
    }, 2, 2000, ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-pro"]);

    const fallbackText = cleanAnalysisText(fallbackResult.response.text());
    if (!fallbackText) throw new Error("詳細解説の軽量フォールバックも空でした。");
    return fallbackText;
  } catch (fallbackError) {
    console.warn(
      "Section analysis compact fallback failed; trying structure-only chunk fallback:",
      fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
    );
  }

  const questionChunks = splitIntoChunks(allQuestions, 6);
  if (questionChunks.length === 0) {
    throw new Error("詳細解説に必要な小問データがありません。先に大問構造を生成してください。");
  }
  const partialAnalyses: string[] = [];
  for (let chunkIndex = 0; chunkIndex < questionChunks.length; chunkIndex += 1) {
    const chunk = questionChunks[chunkIndex];
    const chunkPrompt = adminInstruction
      ? buildAdminFirstSectionAnalysisPrompt(adminInstruction, sectionData, subjectType, subjectName, chunk, {
          imageAvailable: false,
          fallbackMode: "分割フォールバック生成",
        })
      : `
あなたは大学入試の専門講師です。
以下の小問データだけをもとに、この範囲の各設問について正解根拠が分かる解説本文を日本語で作成してください。

${instructionPriorityBlock}
${instructionModeBlock}
${adminInstruction ? "\n【重要】これは分割フォールバック生成です。管理者の個別指示を省略・簡略化・別テンプレート化せず、この範囲に適用してください。\n" : ""}

【対象】
科目: ${subjectName || subjectType || "未設定"}
大問: 第${sectionData.id}問（${sectionData.label || ""}）
範囲: ${chunk[0]?.label || chunk[0]?.id || ""} 〜 ${chunk[chunk.length - 1]?.label || chunk[chunk.length - 1]?.id || ""}

【小問データ】
${JSON.stringify(chunk.map((q) => ({
      id: q.id,
      label: q.label,
      type: q.type,
      correctAnswer: q.correctAnswer,
      points: q.points,
    })), null, 2)}

【出力ルール】
${adminInstruction ? "・出力形式、見出し、順番、分量は管理者の個別指示だけに従う。" : ""}
・この範囲の各小問について、正解がなぜその答えになるかを説明する。
・講評、学習アドバイス、全体所感ではなく、設問ごとの解法根拠を中心に書く。
・画像は参照できないため、正解データと問題タイプから断定できる範囲だけを書く。
${adminInstruction ? "" : "・500字以内。"}
・アスタリスク（*）禁止。
${adminInstruction ? "・管理者の個別指示にない前置き、タイトル、汎用見出し、まとめ、講評を追加しない。" : "・前置き、タイトル、汎用見出しは禁止。最初から解説本文に入る。"}
${adminInstruction ? "・管理者の個別指示にない固定フォーマット見出しを追加しない。" : "・「全体解説①」「【解説】」「① 解答」などの固定見出しは禁止。"}
・本文のみ返す。
`;
    const chunkResult = await generateContentWithFallback(genAI, {
      contents: [{ role: "user", parts: [{ text: chunkPrompt }] }],
      generationConfig: { maxOutputTokens: 4096 },
    }, 2, 1500, ["gemini-2.5-flash", "gemini-2.0-flash"]);
    const chunkText = cleanAnalysisText(chunkResult.response.text());
    if (chunkText) partialAnalyses.push(chunkText);
  }

  if (partialAnalyses.length === 0) {
    throw new Error("詳細解説の分割フォールバックも空でした。");
  }

  const mergePrompt = adminInstruction
    ? `
あなたは大学入試の詳細解説を編集する専門講師です。

【最重要】
以下の「管理者の自作プロンプト」を、統合後の出力仕様として最優先してください。
部分解説の順番や内容を整えるだけにし、管理者の自作プロンプトにない講評・学習アドバイス・通常テンプレートを追加してはいけません。

【管理者の自作プロンプト】
${adminInstruction}

【対象】
科目: ${subjectName || subjectType || "未設定"}
大問: 第${sectionData.id}問（${sectionData.label || ""}）

【部分解説】
${partialAnalyses.map((text, idx) => `【部分${idx + 1}】\n${text}`).join("\n\n")}

【最低限の安全制約】
・正解データを勝手に変更しない。
・部分解説と矛盾する内容を書かない。
・根拠のない断定や、問題に無関係な知識展開をしない。
・アスタリスク（*）は使用しない。
・コードブロックで囲まない。
・詳細解説本文のみを返す。
`
    : `
あなたは大学入試の専門講師です。
以下の部分解説を統合し、各設問の正解根拠が自然につながる詳細解説本文にまとめてください。

${instructionPriorityBlock}
${instructionModeBlock}
${adminInstruction ? "\n【重要】統合時も管理者の個別指示の構成を最優先し、部分解説を勝手な講評テンプレートへ変換しないでください。\n" : ""}

【対象】
科目: ${subjectName || subjectType || "未設定"}
大問: 第${sectionData.id}問（${sectionData.label || ""}）

【部分分析】
${partialAnalyses.map((text, idx) => `【部分${idx + 1}】\n${text}`).join("\n\n")}

【出力ルール】
${adminInstruction ? "・出力形式、見出し、順番、分量は管理者の個別指示だけに従う。" : ""}
・重複を削り、各小問の正解根拠が伝わる解説本文としてまとめる。
・講評、学習アドバイス、全体所感ではなく、設問ごとの解法根拠を中心に書く。
${adminInstruction ? "" : "・1200字以内。"}
・アスタリスク（*）禁止。
${adminInstruction ? "・管理者の個別指示にない前置き、タイトル、汎用見出し、まとめ、講評を追加しない。" : "・前置き、タイトル、汎用見出しは禁止。最初から解説本文に入る。"}
${adminInstruction ? "・管理者の個別指示にない固定フォーマット見出しを追加しない。" : "・「全体解説①」「【解説】」「① 解答」などの固定見出しは禁止。"}
・挨拶、講師名、締めの言葉は禁止。
・本文のみ返す。
`;

  const mergeResult = await generateContentWithFallback(genAI, {
    contents: [{ role: "user", parts: [{ text: mergePrompt }] }],
    generationConfig: { maxOutputTokens: 8192 },
  }, 2, 1500, ["gemini-2.5-flash", "gemini-2.0-flash"]);

  const mergedText = cleanAnalysisText(mergeResult.response.text());
  if (!mergedText) throw new Error("大問分析の統合結果が空でした。");
  return mergedText;
}

async function handleGenerateSingleSection(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const subjectType = body.subjectType as string;
  const sectionIndex = body.sectionIndex as string | number;
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  const answerFilesData = (body.answerFilesData as Array<{ data: string; mimeType: string }>) || [];
  const instruction = (body.instruction as string) || "";
  const targetPoints = body.targetPoints as number | null;
  const includeExplanations = body.includeExplanations !== false;
  const allowLargeSectionSkeletonFallback = body.allowLargeSectionSkeletonFallback !== false;
  const rawExpectedQuestionCount = Number(body.expectedQuestionCount);
  const expectedQuestionCount = Number.isFinite(rawExpectedQuestionCount) && rawExpectedQuestionCount > 0
    ? Math.floor(rawExpectedQuestionCount)
    : null;

  const isEnglish = subjectType === "english";
  const isJapanese = subjectType === "japanese";
  const isSocial = ["social", "japanese_history", "world_history"].includes(subjectType);
  let subjectSpecificRules = "";
  if (isEnglish) subjectSpecificRules = ENGLISH_RULES;
  else if (isJapanese) subjectSpecificRules = JAPANESE_RULES;
  else if (isSocial) subjectSpecificRules = SOCIAL_RULES;

  const aInlineData = toImageParts(answerFilesData);
  const qInlineData = toImageParts(questionFilesData);

  if (!includeExplanations && allowLargeSectionSkeletonFallback && expectedQuestionCount !== null && expectedQuestionCount >= 20) {
    const requiredItems = Array.from({ length: expectedQuestionCount }, (_, idx) => ({
      id: String(idx + 1),
      label: `問${idx + 1}`,
      answer: "",
    }));
    const fastQuestions = rebalanceQuestionPoints(
      buildFallbackQuestionsFromRequiredItems(requiredItems),
      targetPoints || null,
    );
    return {
      id: String(sectionIndex),
      label: `第${sectionIndex}問`,
      allocatedPoints: targetPoints && targetPoints > 0
        ? targetPoints
        : fastQuestions.reduce((sum, question) => sum + (Number(question.points) || 0), 0),
      sectionAnalysis: "",
      questions: fastQuestions,
      generationWarnings: [
        `期待小問数が${expectedQuestionCount}件と多いため、compute上限回避のためAI画像解析を省略し、枠だけ高速作成しました。正解は「要確認」として後から入力してください。`,
      ],
    };
  }

  let detectedAnswerItems: Array<Record<string, unknown>> = [];
  if (aInlineData.length > 0) {
    try {
      const answerIndexPrompt = `
提供された解答画像から、第${sectionIndex}問に対応する小問番号と正解をすべて抽出してください。
${expectedQuestionCount ? `この大問には少なくとも ${expectedQuestionCount} 件の小問があります。出力の items は最低 ${expectedQuestionCount} 件にしてください。` : ""}

【重要】
・ここでいう「第${sectionIndex}問」は管理画面上の大問番号です。解答画像内に「II」「Ⅱ」「大問二」などの見出しがあり、その内部に「問1」「問2」「問3」または「設問1」「設問2」「設問3」などの設問群がある場合、それらはすべて第${sectionIndex}問に含まれる小問です。
・解答画像内の「問${sectionIndex}」「設問${sectionIndex}」だけを第${sectionIndex}問だと誤解しないでください。大問見出しの下にある問1、問2、問3... / 設問1、設問2、設問3...をすべて抽出してください。
・解答欄に 1, 2, 3... や (1), (2), 問1, 問2, 設問1, 設問2 のような番号が並んでいる場合、それぞれを独立した小問として抽出してください。
・横一列や表形式で複数の答えが並んでいる場合、1行を1問としてまとめず、番号ごとに分割してください。
・「(41)(42) 25」のように、複数の括弧番号が並び、その右側に1つの正解がある行は、省略せず1つの採点単位として抽出してください。この場合 id は "41-42"、answer は "25" のようにしてください。
・「(43)(44) 66」「(45)(46) 48」のような行が連続している場合、各行をすべて items に入れてください。
・「設問1 5」「設問2 3」「設問3 1」のような行が連続している場合、各行をすべて items に入れてください。設問2だけを代表として出力することは禁止です。
・「設問1 2（早良親王）」のように、小さい番号（通常1〜10）の右に括弧書きの語句がある行は、受験生が答えるのは番号だけです。この場合 answer は必ず "2" のような番号のみ、answerText は "早良親王"、answerFormat は "choice_number" にしてください。
・「設問2 3（平成天皇）」「設問3 5（承和の変）」のような形式も同じです。括弧内の語句を correctAnswer にしてはいけません。
・ただし「(1)(2) 50（帥升）」「(3)(4) 46（『後漢書』東夷伝）」「(9)(10) 74（山上憶良）」のような2桁以上の番号は、選択肢番号ではなく解答一覧・語句一覧の参照番号です。answer は "50" のように抽出してよいが、answerFormat は空文字、type/options は選択問題扱いにしないでください。
・「(A) ガリア」「(B) シトー」「(ア) 商鞅」のように、記号ラベルと語句が並ぶ行も解答一覧の一部です。A/B/C/ア/イ等のラベルを id とし、右側の語句を answer として items に入れてください。
・「設問(1) ゴッホ」「問1 2」「(1) 50」のような番号付き行も同様に、id と answer の対応として items に入れてください。
・「大問内に3つの設問群がある」場合でも、設問群ではなく個々の小問番号を抽出してください。
${isJapanese ? `・国語では、「問一」「問二」「一」「二」「（一）」「(二)」「A」「B」「空欄A」「傍線部(一)」なども小問IDとして扱ってください。
・国語の解答画像に、本文・設問文ではなく「正解」「解答」「配点」だけが表形式で並んでいる場合も、その表を正解一覧として読み取り、各行を items に入れてください。
・国語の選択問題で正解が「1」「2」「3」「4」「5」などの番号だけの場合、answer は番号だけにしてください。選択肢本文や根拠文を answer に混ぜないでください。
・国語の記述問題で模範解答が長文の場合は、読める範囲の模範解答を answer に入れてください。読めない場合でも小問IDは省略せず answer を空文字にしてください。` : ""}
・正解が読めない小問があっても、その小問番号自体は省略せず、answer は空文字にしてください。
・広告、ロゴ、ページ装飾は無視してください。

出力はJSONのみ:
{
  "items": [
    { "id": "小問番号", "answer": "正解番号または正解", "answerText": "番号の補足語句（あれば）", "answerFormat": "choice_number または空文字" }
  ]
}
`;
      const answerIndexResult = await generateContentWithFallback(genAI, {
        contents: [{ role: "user", parts: [...aInlineData, { text: answerIndexPrompt }] }],
        generationConfig: { maxOutputTokens: 8192 },
      }, 2, 2000, ["gemini-2.5-flash", "gemini-2.0-flash"]);
      const parsed = JSON.parse(sanitizeJson(answerIndexResult.response.text())) as Record<string, unknown>;
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
      detectedAnswerItems = rawItems
        .filter(isRecord)
        .filter((item) => String(item.id || "").trim() || String(item.answer || "").trim());
    } catch (error) {
      console.warn(`Answer index extraction failed for section ${sectionIndex}:`, (error as Error).message);
    }
  }

  const requiredQuestionItems = buildRequiredQuestionItems(detectedAnswerItems, expectedQuestionCount);
  const targetPointsRule = targetPoints
    ? `\n【重要：目標配点】\nこの大問の小問群の \`points\` の合計がぴったり **${targetPoints}** 点 になるように必ず割り振ってください。（各小問の配点は1以上の自然数であること）\n`
    : `\n【配点ルール】\n問題数や難易度に合わせて自然な点数（1以上の自然数）を割り振ってください。\n\`allocatedPoints\` は小問 \`points\` の合計値にしてください。0点は禁止です。\n`;
  const validationExpectedQuestionCount = requiredQuestionItems.length > 0
    ? requiredQuestionItems.length
    : Math.max(expectedQuestionCount || 0, detectedAnswerItems.length || 0) || null;
  const allowZeroQuestionPoints = Boolean(
    targetPoints &&
    validationExpectedQuestionCount &&
    targetPoints < validationExpectedQuestionCount
  );
  if (!includeExplanations && requiredQuestionItems.length > 0) {
    const fastQuestions = rebalanceQuestionPoints(
      buildFallbackQuestionsFromRequiredItems(requiredQuestionItems),
      targetPoints || null,
    );
    const unresolvedCount = fastQuestions.filter((question) =>
      String(question.correctAnswer || "").trim() === "要確認"
    ).length;
    const fastSection = {
      id: String(sectionIndex),
      label: `第${sectionIndex}問`,
      allocatedPoints: targetPoints && targetPoints > 0
        ? targetPoints
        : fastQuestions.reduce((sum, question) => sum + (Number(question.points) || 0), 0),
      sectionAnalysis: "",
      questions: fastQuestions,
      generationWarnings: [
        "高速生成のため、問題本文からの選択肢・問題タイプ推定は省略しました。必要に応じて後から手動修正または小問解説生成を行ってください。",
        ...(unresolvedCount > 0
          ? [`${unresolvedCount}件の正解を解答画像から確定できなかったため correctAnswer に「要確認」を入れています。`]
          : []),
      ],
    };
    validateSectionData(
      fastSection,
      `第${sectionIndex}問の高速生成`,
      true,
      targetPoints || null,
      validationExpectedQuestionCount,
      allowZeroQuestionPoints,
    );
    return fastSection;
  }
  const expectedQuestionRule = expectedQuestionCount
    ? `\n【最重要：期待小問数】\nこの大問には少なくとも **${expectedQuestionCount}件** の小問があります。\n\`questions\` 配列には、画像内の小問を省略せず、最低でも ${expectedQuestionCount} 件入れてください。\n1件だけ・一部だけ・代表例だけの出力は禁止です。\n読み取りが難しい小問も、問題番号・正解・配点を可能な限り抽出して、絶対に途中で打ち切らないでください。\n`
    : "";
  const detectedQuestionRule = detectedAnswerItems.length > 0
    ? `\n【最重要：解答画像から検出した小問候補】\n構造生成前の事前解析で、解答画像から少なくとも ${detectedAnswerItems.length} 件の小問候補を検出しています。\n以下の候補を、原則として questions 配列にすべて含めてください。小問を3問程度の設問群にまとめることは禁止です。\n${detectedAnswerItems.map((item, idx) => `・${idx + 1}. id候補="${String(item.id || "").trim()}" 正解候補="${String(item.answer || "").trim()}"`).join("\n")}\n`
    : "";
  const requiredQuestionRule = requiredQuestionItems.length > 0
    ? `\n【絶対固定：出力すべき小問リスト】\nquestions 配列は、以下の requiredQuestions と同じ件数・同じ順番・同じ id で出力してください。\nこのリストにある小問を省略、統合、要約、設問群化することは禁止です。\n${JSON.stringify(requiredQuestionItems.map((item) => ({
      id: String(item.id || ""),
      label: String(item.label || ""),
      correctAnswerHint: String(item.answer || ""),
      answerFormat: String(item.answerFormat || ""),
      optionsHint: item.options || [],
      answerNote: String(item.answerNote || ""),
    })), null, 2)}\n`
    : "";

  const structurePrompt = `
あなたは大学入試の専門家です。提供された画像（問題用紙および解答用紙）を詳細に分析し、**第${sectionIndex}問**に関する設問の構造・正解・配点のみを抽出してください。

【入力素材】
・添付画像から問題と解答の関係を読み取り、正確なデータを作成してください。
${instruction ? `【個別指示】\n${instruction}\n` : ""}
${subjectSpecificRules}
${targetPointsRule}
${expectedQuestionRule}
${detectedQuestionRule}
${requiredQuestionRule}

【抽出条件と厳格ルール】
1. この大問（第${sectionIndex}問）の中に含まれる小問を全て抽出すること。
2. 小問を「設問群」「段落」「表の行」単位にまとめず、採点対象になる最小単位に分割すること。
3. 解答画像に正解が10個あるなら、questions も原則10個にすること。3問程度で打ち切ることは禁止です。
3-1. 管理画面上の「第${sectionIndex}問」と、画像内に印字された「問${sectionIndex}」「設問${sectionIndex}」を混同しないでください。画像内に「II」「Ⅱ」などの大問見出しがあり、その中に「問1」「問2」または「設問1」「設問2」などがある場合、問1/設問1も問2/設問2もすべてこの大問の小問として抽出してください。
3-2. 「(41)(42) 25」のように、複数の括弧番号と1つの正解が並ぶ行は1つの採点単位として抽出してください。id例: "41-42"、label例: "(41)(42)"、correctAnswer例: "25"。
3-3. 「(41)(42)」「(43)(44)」のような番号付き行が連続している場合、途中の行を資料・凡例・解答一覧として無視せず、すべて questions に含めてください。
3-4. 「設問1 5」「設問2 3」「設問3 1」のような番号付き行が連続している場合、各行を独立した小問としてすべて questions に含めてください。設問2だけを抽出したり、設問1〜8を1問に統合したりすることは禁止です。
3-5. 「設問1 2（早良親王）」のように、解答が番号＋括弧内語句で示されている場合、受験生が答えるのは番号だけです。type は "selection"、correctAnswer は "2" のような番号のみ、options は ["1","2","3","4","5"] のような番号配列にしてください。括弧内語句を correctAnswer にしてはいけません。
3-6. 解答画像内の「(A) ガリア」「(B) シトー」「(ア) 商鞅」のような記号ラベル付きの行も、解答一覧に載っている採点対象です。questions に必ず含め、id/label は "A" / "B" / "ア" のようにラベルを維持してください。
3-7. 「設問(1) ゴッホ」「設問(2) ポトシ銀山」のような設問番号付きの行も、別の採点対象です。A〜Eの行と設問(1)〜の行を混同したり、片方だけに寄せたりしないでください。
4. アスタリスク（*）記号を絶対に使用しないでください。
5. 選択問題・並び替え問題の \`options\` 配列には、記号・番号（例: "1", "a", "ア" など）のみを含めてください。
6. \`explanation\` フィールドは全て空文字列 "" にしてください。解説は別工程で生成します。
7. \`sectionAnalysis\` は空文字列 "" にしてください。
8. 必ず以下のJSON構造（オブジェクト1つ）のみを出力してください。
9. 画像からの読み取りミス（OCRミス）がないよう、特に記号や数値は慎重に確認してください。
10. 語句・文・選択肢を正しい順番に並べ替える問題は、必ず \`type\` を "ordering" にしてください。この場合、\`correctAnswer\` は正しい順番をカンマ区切りで出力してください（例: "c,a,d,b"）。順序が採点対象ではない複数選択だけ "selection_multi" を使ってください。
11. 問題タイプは厳密に分類してください。選択肢があり正解が1つなら "selection"、選択肢があり順不同の複数正解なら "selection_multi"、選択肢を正しい順に並べるなら "ordering"、選択肢がない短答・語句記述なら "descriptive"、採点基準が必要な自由記述・論述・英作文なら "essay" にしてください。
12. カタカナ選択肢はOCRで漢字に誤変換しないでください。特に選択肢記号の「カ」は漢字の「力」ではなく必ず「カ」、「オ」は漢字の「才」ではなく必ず「オ」として出力してください。
${isJapanese ? `13. 漢字の書き取り・漢字表記・漢字に直す問題は、自動採点不能です。type は "descriptive" のまま、answerIssue と answerFormat に必ず "kanji_self_grade" を入れてください。` : ""}

【出力構造】
{
  "id": "${sectionIndex}",
  "label": "第${sectionIndex}問",
  "allocatedPoints": ${targetPoints || 20},
  "sectionAnalysis": "",
  "questions": [
    {
      "id": "小問ID",
      "label": "小問ラベル",
      "type": "selection",
      "options": ["a", "b", "c", "d"],
      "correctAnswer": "正解",
      "answerIssue": "",
      "answerFormat": "",
      "points": 5,
      "explanation": ""
    }
  ]
}
`;

  let parsedSection: Record<string, unknown> | null = null;
  if (requiredQuestionItems.length >= 4) {
    const chunkedQuestions = await generateSectionQuestionsInChunks(
      genAI,
      sectionIndex,
      subjectType,
      instruction,
      requiredQuestionItems,
      qInlineData,
      aInlineData,
    );
    validateGeneratedQuestionCount(chunkedQuestions, requiredQuestionItems.length, `第${sectionIndex}問 分割生成`);
    const rebalancedQuestions = rebalanceQuestionPoints(chunkedQuestions, targetPoints || null);
    const reviewCount = rebalancedQuestions.filter((question) => question.needsReview).length;
    parsedSection = {
      id: String(sectionIndex),
      label: `第${sectionIndex}問`,
      allocatedPoints: targetPoints && targetPoints > 0
        ? targetPoints
        : rebalancedQuestions.reduce((sum, question) => sum + (Number(question.points) || 0), 0),
      sectionAnalysis: "",
      questions: rebalancedQuestions,
      generationWarnings: reviewCount > 0
        ? [`${reviewCount}件の小問はAIが構造を確定できなかったため、正解ヒントを使った要確認データとして作成しました。`]
        : [],
    };
    validateSectionData(parsedSection, `第${sectionIndex}問の分割生成`, true, targetPoints || null, validationExpectedQuestionCount, allowZeroQuestionPoints);
  } else {
    let lastStructureError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const retryPrompt = attempt === 1
        ? structurePrompt
        : `${structurePrompt}

【再生成指示】
前回の出力はJSON形式・小問数・配点合計のいずれかで検証に失敗しました。
説明文やMarkdownは一切出さず、必ずJSONオブジェクト1つだけを返してください。
小問を省略せず、配点合計を目標配点に合わせてください。`;
      try {
        const structureResult = await generateContentWithFallback(genAI, {
          contents: [{ role: "user", parts: [...qInlineData, ...aInlineData, { text: retryPrompt }] }],
          generationConfig: { maxOutputTokens: 24576 },
        }, 3, 3000);

        const rawParsed = JSON.parse(sanitizeJson(structureResult.response.text())) as Record<string, unknown>;
        const normalizedBase = normalizeGeneratedSection(rawParsed, sectionIndex, targetPoints || null);
        if (validationExpectedQuestionCount !== null) {
          const baseQuestions = Array.isArray(normalizedBase.questions)
            ? normalizedBase.questions
            : [];
          if (baseQuestions.length < validationExpectedQuestionCount) {
            throw new Error(`第${sectionIndex}問の単独生成: 小問が ${baseQuestions.length} 件しか抽出されていません。期待小問数 ${validationExpectedQuestionCount} 件を下回るため、生成結果を破棄しました。`);
          }
        }
        const normalized = forceRequiredQuestions(normalizedBase, requiredQuestionItems, targetPoints || null);
        validateSectionData(normalized, `第${sectionIndex}問の単独生成`, true, targetPoints || null, validationExpectedQuestionCount, allowZeroQuestionPoints);
        parsedSection = normalized;
        break;
      } catch (error) {
        lastStructureError = error;
        console.warn(`Single section structure attempt ${attempt} failed:`, (error as Error).message);
      }
    }

    if (!parsedSection) {
      if (isJapanese && !includeExplanations && expectedQuestionCount !== null && expectedQuestionCount > 0) {
        const fallbackQuestions = rebalanceQuestionPoints(
          buildFallbackQuestionsFromRequiredItems(buildSequentialRequiredItems(expectedQuestionCount)),
          targetPoints || null,
        );
        const fallbackSection = {
          id: String(sectionIndex),
          label: `第${sectionIndex}問`,
          allocatedPoints: targetPoints && targetPoints > 0
            ? targetPoints
            : fallbackQuestions.reduce((sum, question) => sum + (Number(question.points) || 0), 0),
          sectionAnalysis: "",
          questions: fallbackQuestions,
          generationWarnings: [
            `国語の問題画像・解答画像から小問構造を確定できなかったため、期待小問数 ${expectedQuestionCount} 件にもとづく要確認の小問枠を作成しました。正解・形式・選択肢を確認して保存してください。`,
            lastStructureError instanceof Error ? `AI解析エラー: ${lastStructureError.message}` : "AI解析エラー: 詳細不明",
          ],
        };
        validateSectionData(
          fallbackSection,
          `第${sectionIndex}問の国語フォールバック生成`,
          true,
          targetPoints || null,
          expectedQuestionCount,
          allowZeroQuestionPoints,
        );
        parsedSection = fallbackSection;
      } else {
      throw lastStructureError instanceof Error
        ? lastStructureError
        : new Error(`第${sectionIndex}問の構造生成に失敗しました。`);
      }
    }
  }

  if (!includeExplanations) {
    return parsedSection;
  }

  // Stage 2: explanations in chunks
  const questions = (parsedSection.questions as Array<Record<string, unknown>>) || [];
  const chunkSize = 1;
  for (let i = 0; i < questions.length; i += chunkSize) {
    const chunk = questions.slice(i, i + chunkSize);
    let unresolvedChunk = [...chunk];
    for (let attempt = 1; attempt <= 2 && unresolvedChunk.length > 0; attempt += 1) {
      const slimChunk = unresolvedChunk.map((q) => ({
        id: q.id, label: q.label, type: q.type,
        options: q.options,
        choiceTexts: q.choiceTexts || q.choices || {},
        correctAnswer: q.correctAnswer,
        points: q.points,
        questionText: q.questionText || q.prompt || q.instruction || q.text || "",
        sourceExcerpt: q.sourceExcerpt || q.evidenceHint || "",
        evidenceHint: q.evidenceHint || q.sourceExcerpt || "",
        evidenceConfidence: q.evidenceConfidence || "",
        explanationIssue: q.explanationIssue || "",
        explanation: "",
        evidenceQuote: q.evidenceQuote || "",
      }));
      const expPrompt = `あなたは大学入試の専門講師です。
以下の画像（問題・解答）を分析し、提供された設問構造の各小問に対する解説(explanation)のみを生成してください。

【厳格ルール】
1. id, label, type, options, points は絶対に書き換えないこと。
2. correctAnswer は原則そのまま維持。ただし現在の correctAnswer が空欄・「要確認」・「不明」の場合だけ、解答画像から確定できる正解に更新してよい。
3. correctAnswer を更新した場合、explanation は更新後の正解と矛盾しない内容にすること。
4. 各小問の explanation を【2〜3文以内、約50〜100文字】で埋めてください。
5. 日本語で記述。アスタリスク（*）禁止。
6. 出力は解説を埋めた後の同じJSON構造（オブジェクト1つ）のみ。
7. 全科目で各小問に evidenceQuote を必ず入れること。根拠引用が取れない場合は evidenceQuote を空欄、explanation を「${isJapaneseSubject(subjectType) ? JAPANESE_UNVERIFIABLE_EXPLANATION : QUESTION_EXPLANATION_UNVERIFIABLE}」にすること。
8. 正解番号だけから解説を作らないこと。該当小問の本文・設問文・選択肢文・模範解答の具体語句を確認できない場合は要確認にすること。
9. 複数小問が写った画像では、対象小問の番号と根拠箇所を特定できる場合だけ解説すること。
10. 国語では、JSON内の questionText / choiceTexts / sourceExcerpt / evidenceQuote を主材料にすること。これらが不足している小問は、画像から推測して解説せず要確認にすること。
${questionExplanationQualityRules(subjectType)}
${japaneseQuestionExplanationRules(subjectType)}

【設問構造】
${JSON.stringify({ questions: slimChunk })}

【出力要件】
- ${unresolvedChunk.length}個の小問すべてに解説を生成すること。
- 出力はJSONオブジェクト1つのみ。
`;

      const expResult = await generateContentWithFallback(genAI, {
        contents: [{ role: "user", parts: [{ text: expPrompt }, ...qInlineData, ...aInlineData] }],
        generationConfig: { maxOutputTokens: 4096 },
      }, 1, 1000, ["gemini-2.5-flash", "gemini-2.0-flash"]);
      const expParsed = JSON.parse(sanitizeJson(expResult.response.text())) as Record<string, unknown>;
      const expQuestions = Array.isArray(expParsed) ? expParsed : ((expParsed.questions as Array<Record<string, unknown>>) || []);
      expQuestions.forEach((q, resultIndex) => {
        if (!q || !hasUsableExplanation(q.explanation)) return;
        const idx = findQuestionIndex(
          parsedSection.questions as Array<Record<string, unknown>>,
          q,
          i + resultIndex,
        );
        if (idx !== -1) {
          const targetQuestions = parsedSection.questions as Array<Record<string, unknown>>;
          targetQuestions[idx] = {
            ...targetQuestions[idx],
            ...resolvedCorrectAnswerPatch(targetQuestions[idx], q),
            ...applyQuestionExplanationGuard(q, subjectType, targetQuestions[idx]),
          };
        }
      });

      unresolvedChunk = chunk.filter((q, chunkIndex) => {
        const idx = findQuestionIndex(
          parsedSection.questions as Array<Record<string, unknown>>,
          q,
          i + chunkIndex,
        );
        return idx === -1 || !hasUsableExplanation((parsedSection.questions as Array<Record<string, unknown>>)[idx]?.explanation);
      });

      if (unresolvedChunk.length > 0 && attempt < 2) {
        console.warn(`Explanation chunk ${i} missing ${unresolvedChunk.length} item(s); retrying.`);
      }
    }

    if (unresolvedChunk.length > 0) {
      throw new Error(`第${sectionIndex}問で ${unresolvedChunk.length} 件の小問解説が生成されませんでした。`);
    }
  }

  const missingExplanations = (parsedSection.questions as Array<Record<string, unknown>>)
    .filter((question) => !hasUsableExplanation(question.explanation));
  if (missingExplanations.length > 0) {
    throw new Error(`第${sectionIndex}問で ${missingExplanations.length} 件の小問解説が未生成です。`);
  }

  return parsedSection;
}

async function handleGenerateSectionQA(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const subjectType = body.subjectType;
  const sectionData = body.sectionData as Record<string, unknown>;
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  const answerFilesData = (body.answerFilesData as Array<{ data: string; mimeType: string }>) || [];

  const imageParts = [...toImageParts(questionFilesData), ...toImageParts(answerFilesData)];
  const questions = (sectionData.questions as Array<Record<string, unknown>>) || [];
  if (questions.length === 0) return sectionData;

  const emptyQuestions = questions.filter((q) => !q.explanation || String(q.explanation).trim() === "");
  if (emptyQuestions.length === 0) return sectionData;

  const chunkSize = 1;
  const updatedQuestions = [...questions];

  if (isJapaneseSubject(subjectType)) {
    emptyQuestions.forEach((question) => {
      if (hasExtractedQuestionEvidence(question)) return;
      const targetIndex = findQuestionIndex(updatedQuestions, question);
      if (targetIndex === -1) return;
      updatedQuestions[targetIndex] = {
        ...updatedQuestions[targetIndex],
        explanation: JAPANESE_UNVERIFIABLE_EXPLANATION,
        evidenceQuote: "",
        needsReview: true,
        explanationIssue: "missing_question_evidence",
      };
    });
  }

  for (let i = 0; i < emptyQuestions.length; i += chunkSize) {
    const chunk = emptyQuestions
      .slice(i, i + chunkSize)
      .filter((question) => !isJapaneseSubject(subjectType) || hasExtractedQuestionEvidence(question));
    if (chunk.length === 0) continue;
    let unresolvedChunk = [...chunk];

    for (let attempt = 1; attempt <= 2 && unresolvedChunk.length > 0; attempt += 1) {
      const slimChunk = unresolvedChunk.map((q) => ({
        id: q.id, label: q.label, type: q.type,
        options: q.options,
        choiceTexts: q.choiceTexts || q.choices || {},
        correctAnswer: q.correctAnswer,
        points: q.points,
        questionText: q.questionText || q.prompt || q.instruction || q.text || "",
        sourceExcerpt: q.sourceExcerpt || q.evidenceHint || "",
        evidenceHint: q.evidenceHint || q.sourceExcerpt || "",
        evidenceConfidence: q.evidenceConfidence || "",
        explanationIssue: q.explanationIssue || "",
        explanation: "",
        evidenceQuote: q.evidenceQuote || "",
      }));
      const tempSectionData = {
        sectionNumber: sectionData.sectionNumber,
        sectionTitle: sectionData.sectionTitle,
        questions: slimChunk,
      };

      const prompt = `あなたは大学入試の専門講師です。
以下の画像（問題・解答）を分析し、提供された「設問構造（JSON）」の各小問に対応する **解説(explanation)のみ** を生成してください。

【厳格ルール】
1. **既存の id, label, type, options, points は絶対に書き換えないこと。**
2. correctAnswer は原則そのまま維持。ただし現在の correctAnswer が空欄・「要確認」・「不明」の場合だけ、解答画像から確定できる正解に更新してよい。
3. correctAnswer を更新した場合、explanation は更新後の正解と矛盾しない内容にすること。
4. 渡された JSON の各要素にある \`explanation\` フィールドを、論理的で丁寧な解説で埋めてください。
5. 【超重要】解説の長さは【各小問100文字程度】を目安にしてください。
6. 日本語で記述すること。
7. アスタリスク（*）記号は一切使用禁止。
8. 出力は、解説を埋めた後の「同じJSON構造のオブジェクト1つのみ」を返してください。
9. 全科目で各小問に evidenceQuote を必ず入れること。根拠引用が取れない場合は evidenceQuote を空欄、explanation を「${isJapaneseSubject(subjectType) ? JAPANESE_UNVERIFIABLE_EXPLANATION : QUESTION_EXPLANATION_UNVERIFIABLE}」にすること。
10. 正解番号だけから解説を作らないこと。該当小問の本文・設問文・選択肢文・模範解答の具体語句を確認できない場合は要確認にすること。
11. 複数小問が写った画像では、対象小問の番号と根拠箇所を特定できる場合だけ解説すること。
12. 国語では、JSON内の questionText / choiceTexts / sourceExcerpt / evidenceQuote を主材料にすること。これらが不足している小問は、画像から推測して解説せず要確認にすること。
${questionExplanationQualityRules(subjectType)}
${japaneseQuestionExplanationRules(subjectType)}

【対象の設問構造（現在のデータ）】
小問数: ${unresolvedChunk.length}
${JSON.stringify(tempSectionData)}

【出力要件】
- ルートはオブジェクトであること（配列ではない）
- **重要：提供された ${unresolvedChunk.length} 個の小問すべてについて、一つも漏らさずに解説を生成してください。**
- 各小問の "id" は絶対に提供されたものと同じものを使用すること。
- 出力はJSONオブジェクト1つのみ。
`;

      const result = await generateContentWithFallback(genAI, {
        contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
        generationConfig: { maxOutputTokens: 4096 },
      }, 1, 1000, ["gemini-2.5-flash", "gemini-2.0-flash"]);

      const parsed = JSON.parse(sanitizeJson(result.response.text())) as Record<string, unknown>;
      let chunkQuestions: Array<Record<string, unknown>> = [];
      if (Array.isArray(parsed)) {
        chunkQuestions = parsed;
      } else if (parsed.questions && Array.isArray(parsed.questions)) {
        chunkQuestions = parsed.questions as Array<Record<string, unknown>>;
      } else if (parsed.questions && typeof parsed.questions === "object") {
        chunkQuestions = Object.values(parsed.questions as object) as Array<Record<string, unknown>>;
      }

      chunkQuestions.forEach((q, resultIndex) => {
        if (!q || !hasUsableExplanation(q.explanation)) return;
        const targetIndex = findQuestionIndex(updatedQuestions, q, resultIndex);
        if (targetIndex !== -1) {
          updatedQuestions[targetIndex] = {
            ...updatedQuestions[targetIndex],
            ...resolvedCorrectAnswerPatch(updatedQuestions[targetIndex], q),
            ...applyQuestionExplanationGuard(q, subjectType, updatedQuestions[targetIndex]),
          };
        }
      });

      unresolvedChunk = chunk.filter((q) => {
        const targetIndex = findQuestionIndex(updatedQuestions, q);
        return targetIndex === -1 || !hasUsableExplanation(updatedQuestions[targetIndex]?.explanation);
      });

      if (unresolvedChunk.length > 0 && attempt < 2) {
        console.warn(`Section QA chunk ${i} missing ${unresolvedChunk.length} item(s); retrying.`);
      }
    }

    if (unresolvedChunk.length > 0) {
      throw new Error(`${unresolvedChunk.length}件の小問解説が生成されませんでした。`);
    }
  }

  const missingExplanations = updatedQuestions.filter((question) => !hasUsableExplanation(question.explanation));
  if (missingExplanations.length > 0) {
    throw new Error(`${missingExplanations.length}件の小問解説が未生成です。`);
  }

  return { ...sectionData, questions: updatedQuestions };
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
  const sectionContext = (questionData.sectionContext as Record<string, unknown>) || {};
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  const answerFilesData = (body.answerFilesData as Array<{ data: string; mimeType: string }>) || [];
  const imageParts = [...toImageParts(questionFilesData), ...toImageParts(answerFilesData)];

  const systemPrompt = `
# 役割
あなたは大学入試の「採点基準設計エキスパート」です。
現在、管理者が記述式・自由記述式問題（英作文など）の「採点要素（scoringElements）」を作成しています。
あなたの仕事は、管理者の意図や問題・模範解答に基づいて、客観的で公平な採点基準（要素）の設計をサポートすることです。

# 本システムの採点ルール（前提知識）
1. 自由記述問題（essay）は、管理者が定義した「採点要素（scoringElements）」に基づいてAIが自動で採点を行います。要素数は満点に合わせて削らず、必要な採点観点をすべて保持します。
2. 各要素は "full"（完全充足）、"partial"（部分充足・オプションで有効な場合のみ）、"none"（非充足）の3つのステータスで評価されます。
3. points は正の加点だけでなく、負の減点も設定できます。負の点数の要素は、条件を満たした場合に減点として扱われます。type が "deduction" の場合、points が正数でも採点時はマイナスとして扱われます。
4. type が "force_zero" の要素は、条件を満たした場合、他の採点要素に関係なく最終得点が強制的に0点になります。
5. type が "character_count" の要素は、minChars / maxChars に基づき、システム側で空白・改行を除いた文字数を機械判定します。条件を満たした場合は設定された points を加点できます。指定がなければ points は0にしてください。条件外は原則として forceZeroOnFail: true にして強制0点条件として扱います。
6. 答案全体の得点は、「満たした要素の合計点」から「文法エラー数（各-1点）」を引いた値になります（下限0点）。force_zero 条件が満たされた場合はこの計算を無視して0点です。
7. したがって、採点要素は「客観的に見てAIが Yes / No を判定しやすい具体的な記述（チェック項目）」にする必要があります。

# 対象の設問情報
設問ID: ${questionData.id}
配点: ${questionData.points}点
問題文: ${questionData.label || "未入力"}
正解・模範解答: ${questionData.correctAnswer || "未入力"}
現在の採点基準・指示: ${questionData.gradingInstruction || "未入力"}
現在の採点要素設定: ${JSON.stringify(questionData.scoringElements || [])}

# 同じ大問の文脈
大問ID: ${sectionContext.sectionId || "未入力"}
大問名: ${sectionContext.sectionLabel || "未入力"}
大問タイプ: ${sectionContext.questionType || "未入力"}
大問指示: ${sectionContext.instruction || "未入力"}
大問全体の詳細解説: ${sectionContext.sectionAnalysis || "未入力"}
同じ大問内の設問一覧: ${JSON.stringify(sectionContext.questions || [])}

# 添付資料
このメッセージには、利用可能な場合、対象大問の問題PDF画像と解答PDF画像が添付されています。
本文・資料・図表・設問文・解答一覧が必要な判断では、必ず添付画像の内容を優先して参照してください。
添付画像がない場合のみ、上記の保存済みテキスト情報で補ってください。

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
- 問題本文・資料・図表・設問文・解答一覧は、添付PDF画像を参照して判断してください。
- 対象設問だけでなく、同じ大問の文脈・設問一覧・模範解答の対応関係を確認し、別設問の正解例や解説を混同しないでください。
- 強制0点条件を除いた合計点は、原則として設問の配点（${questionData.points}点）と一致するように配慮してください。ただし、管理者の貼り付け基準や指示に「基準合計15点→9点満点」のような上限型がある場合は、要素合計が設問配点を超えても構いません。その場合は、最終得点は設問配点を上限にする前提で提案してください。
- 採点要素は、設問配点や満点に合わせて削らず、必要な観点を漏れなく提案してください。必要に応じて負の減点要素や強制0点条件も提案できます。
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

4. 【減点条件】指定語数を大きく下回る（-3点）
・説明：答案が指定語数の下限を明確に満たしていない場合。

5. 【強制0点条件】英語ではない答案（強制0点）
・説明：答案の大半が日本語など英語以外で書かれている場合。
`;

  // Gemini chat has role "user" and "model".
  // Translate incoming history to Gemini format.
  const chatHistory = [
    {
      role: "user",
      parts: [{ text: systemPrompt }, ...imageParts],
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

async function handleTransformRubricToScoringElements(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const examMeta = (body.examMeta as Record<string, unknown>) || {};
  const questionData = (body.questionData as Record<string, unknown>) || {};
  const sourceRubric = String(body.sourceRubric || "").trim();
  const questionPoints = Number(questionData.points) || 0;
  const sectionContext = (questionData.sectionContext as Record<string, unknown>) || {};
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  const answerFilesData = (body.answerFilesData as Array<{ data: string; mimeType: string }>) || [];
  const imageParts = [...toImageParts(questionFilesData), ...toImageParts(answerFilesData)];

  if (!sourceRubric) {
    throw new Error("変換する採点基準が空です。");
  }

  const prompt = `
あなたは大学入試の採点基準を、AI採点用の独自チェック項目に再設計する専門家です。

管理者が貼り付けた採点基準を、そのまま保存してはいけません。
事実・採点観点・配点思想だけを抽出し、文面・並び・注記表現をスマサイ独自の表現へ言い換え、AIが判定しやすい scoringElements に変換してください。

【重要な法務・運用ルール】
1. 貼り付け元の文章、見出し、注記、箇条書き表現をそのまま再利用しない。
2. 意味が同じでも、判定条件として抽象化・一般化した独自文にする。
3. 人名・用語・制度名などの歴史的事実や正答語句は、採点に必要な範囲で使ってよい。
4. 元資料名・企業名・教材名・「貼り付け資料」などの由来は出力しない。
5. 採点者が読んでも自然な、スマサイ独自の採点基準として保存できる形にする。

【対象の設問情報】
大学名: ${examMeta.university || "未入力"}
学部名: ${examMeta.faculty || "未入力"}
科目名: ${examMeta.subject || "未入力"}
年度: ${examMeta.year || "未入力"}
設問ID: ${questionData.id || "未入力"}
設問配点: ${questionPoints || "未入力"}点
問題文: ${questionData.label || "未入力"}
模範解答・正解例: ${questionData.correctAnswer || "未入力"}

【同じ大問の文脈】
大問ID: ${sectionContext.sectionId || "未入力"}
大問名: ${sectionContext.sectionLabel || "未入力"}
大問タイプ: ${sectionContext.questionType || "未入力"}
大問指示: ${sectionContext.instruction || "未入力"}
大問全体の詳細解説: ${sectionContext.sectionAnalysis || "未入力"}
同じ大問内の設問一覧: ${JSON.stringify(sectionContext.questions || [])}

【添付資料】
このリクエストには、利用可能な場合、対象大問の問題PDF画像と解答PDF画像が添付されています。
問題本文・資料・図表・設問文・解答一覧が必要な判断では、必ず添付画像の内容を優先して参照してください。
添付画像がない場合のみ、保存済みテキスト情報と貼り付け基準で補ってください。

【貼り付けられた採点基準】
${sourceRubric}

【変換ルール】
- scoringElements は、元の採点基準に含まれる採点観点を満点に合わせて削らず、必要な数だけ作成する。
- 元基準の合計点が設問配点を超える場合でも、超過分の採点要素を省略しない。最終得点は採点時に設問配点を上限にする。
- 問題本文・資料・図表・設問文・解答一覧は、添付PDF画像を参照して採点対象との対応を確認する。
- 対象設問と同じ大問内の設問一覧・模範解答の対応関係を確認し、別設問の正解例や解説を混同しない。
- 内容加点は type: "content"、論理構成は type: "logic"、文字数条件は type: "character_count"、減点条件は type: "deduction"、強制0点条件は type: "force_zero"。
- 各 description は「答案が〜している場合」のように、AIがYes/No判定しやすい条件文にする。
- 文字数条件は description に加えて minChars / maxChars を数値で設定する。下限だけなら minChars、上限だけなら maxChars、範囲なら両方を設定する。基準に配点がある場合は points に入れる。配点がない場合は points: 0。
- 文字数条件は、明示的に「参考」「警告のみ」と書かれていない限り forceZeroOnFail: true にする。
- points は数値。減点条件は負の数にする。force_zero は points: 0。
- 元基準に「基準合計○点→○点満点」のような上限指定がある場合、gradingInstruction に「要素合計後、最終得点は設問配点を上限にする」趣旨を独自表現で含める。
- 設問配点が分かる場合、最終得点は設問配点を超えない前提で設計する。
- ただし、設問配点を超える採点観点・要素点が元基準にある場合、それらは削除・統合して減らさず、独立した採点要素として保持する。
- 元文の特殊な言い回しや順番に依存せず、意味のまとまりで整理する。
- 部分点が自然な要素は allowPartial: true にする。
- 正答語句の表記揺れが考えられる場合は description に許容範囲を入れる。

【出力形式】
JSONのみを返してください。説明文、Markdown、コードブロックは禁止。
{
  "gradingInstruction": "スマサイ独自表現の採点指示。必要なら満点上限、表記揺れ許容、部分点方針を書く。",
  "scoringElements": [
    {
      "id": "e1",
      "description": "答案が判定条件を満たしている場合に加点する、独自表現の説明",
      "points": 1,
      "allowPartial": false,
      "type": "content",
      "minChars": null,
      "maxChars": null,
      "forceZeroOnFail": false
    }
  ]
}
`;

  const result = await generateContentWithFallback(genAI, {
    contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 },
  }, 3, 2000, ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"]);

  const parsed = JSON.parse(sanitizeJson(result.response.text()));
  const rawElements = Array.isArray(parsed.scoringElements) ? parsed.scoringElements : [];
  const scoringElements = rawElements
    .filter(isRecord)
    .map((item, idx) => normalizeGeneratedScoringElement({ ...item, id: `e${idx + 1}` }, idx))
    .filter((item: { description: string }) => item.description);

  if (scoringElements.length === 0) {
    throw new Error("採点要素に変換できませんでした。貼り付け内容を確認してください。");
  }

  return {
    gradingInstruction: String(parsed.gradingInstruction || "").trim() ||
      "各採点要素の充足状況を判定し、要素点の合計をもとに採点する。最終得点は設問配点を上限とする。",
    scoringElements: ensureEssayCharacterCountElement({
      type: "essay",
      scoringElements,
    }).scoringElements,
  };
}

async function handleGenerateEssayModelAnswer(genAI: GoogleGenerativeAI, body: Record<string, unknown>) {
  const mode = String(body.mode || "with_original"); // "with_original" (ボタンA) or "rubric_only" (ボタンB)
  const examMeta = (body.examMeta as Record<string, unknown>) || {};
  const questionData = (body.questionData as Record<string, unknown>) || {};
  const sectionContext = (questionData.sectionContext as Record<string, unknown>) || (body.sectionContext as Record<string, unknown>) || {};
  const questionFilesData = (body.questionFilesData as Array<{ data: string; mimeType: string }>) || [];
  const answerFilesData = (body.answerFilesData as Array<{ data: string; mimeType: string }>) || [];
  const imageParts = [...toImageParts(questionFilesData), ...toImageParts(answerFilesData)];

  const scoringElements = Array.isArray(questionData.scoringElements) ? questionData.scoringElements : [];
  const gradingInstruction = String(questionData.gradingInstruction || "").trim();
  const originalAnswer = String(questionData.correctAnswer || "").trim();
  const questionPoints = Number(questionData.points) || 0;

  if (scoringElements.length === 0 && !gradingInstruction) {
    throw new Error("採点基準（scoringElements または 採点指示）が設定されていません。先に採点基準を設定してください。");
  }

  if (mode === "with_original" && !originalAnswer) {
    throw new Error("元の模範解答が入力されていません。ボタンB（採点基準＋本文のみ）をご利用ください。");
  }

  // 文字数条件の抽出
  const charElement = scoringElements.find(
    (el: Record<string, unknown>) => el?.type === "character_count" || (el?.minChars != null || el?.maxChars != null)
  ) as Record<string, unknown> | undefined;
  const minChars = charElement?.minChars != null ? Number(charElement.minChars) : null;
  const maxChars = charElement?.maxChars != null ? Number(charElement.maxChars) : null;

  let charLimitNote = "";
  if (minChars != null && maxChars != null) {
    charLimitNote = `【文字数制限】必ず ${minChars}字以上 ${maxChars}字以内 で記述してください（厳守）。`;
  } else if (maxChars != null) {
    charLimitNote = `【文字数制限】必ず ${maxChars}字以内 で記述してください（厳守）。`;
  } else if (minChars != null) {
    charLimitNote = `【文字数制限】必ず ${minChars}字以上 で記述してください（厳守）。`;
  }

  const prompt = `
あなたは大学入試の模範解答作成の最高権威・予備校主任講師です。
大学入試の自由記述・記述問題において、受験生の手本となる【完全オリジナルな高品質模範解答】を作成してください。

${mode === "with_original" ? `
【作成モード: A（独自採点基準 ＋ 元の模範解答 ＋ 本文/問題文）】
提供されている元々の模範解答は外部・ネットからの転載資料であるため、著作権保護の観点から、
【元の模範解答の表現・文章構造・言い回し・語順をそのまま流用・コピーすることは絶対に禁止】します。
元の解答の「事実関係」「論点」「解答の着眼点」を正確に理解した上で、自社の独自採点基準（scoringElements）を満点獲得できるように、
【完全に新しい独自表現・洗練された構成】でゼロから書き直した、オリジナルの模範解答を作成してください。
` : `
【作成モード: B（独自採点基準 ＋ 本文/問題文 のみからゼロベース新規作成）】
元の模範解答には一切依存せず、問題文・本文・資料と独自採点基準（scoringElements）のみを元に、
満点答案となる模範解答をゼロベースで新規作成してください。
`}

【対象の設問情報】
大学名: ${examMeta.university || "未入力"}
学部名: ${examMeta.faculty || "未入力"}
科目名: ${examMeta.subject || "未入力"}
年度: ${examMeta.year || "未入力"}
設問ID: ${questionData.id || "未入力"}
配点: ${questionPoints || "未入力"}点
問題文: ${questionData.label || "未入力"}

【同じ大問の文脈】
大問ID: ${sectionContext.sectionId || "未入力"}
大問名: ${sectionContext.sectionLabel || "未入力"}
大問指示文: ${sectionContext.instruction || "未入力"}
大問解説: ${sectionContext.sectionAnalysis || "未入力"}

【添付資料】
利用可能な場合、対象大問の問題PDF画像と解答PDF画像が添付されています。
問題本文・資料・図表・設問文の詳細な文脈は、必ず添付画像の内容を最優先で参照してください。

【独自採点基準（scoringElements）】※これをすべて満点クリアする解答を作成すること
${JSON.stringify(scoringElements, null, 2)}
採点指示: ${gradingInstruction || "なし"}

${charLimitNote ? `\n${charLimitNote}\n` : ""}

${mode === "with_original" ? `
【参考: 元々の模範解答（※文章の丸写し・類似表現は禁止！着眼点のみ参考にすること）】
${originalAnswer}
` : ""}

【模範解答作成の厳守ルール】
1. 独自採点基準（scoringElements）に含まれるすべての加点要素（content, logic）を漏れなく自然な文章に盛り込むこと。
2. 減点条件（deduction）や強制0点条件（force_zero）に一切抵触しないこと。
3. 文字数指定・語数指定がある場合は、文字数を正確にカウントし、必ずその制限内に厳密に収めること。
4. 設問の解答言語（日本語での記述なら自然で簡潔・論理的な日本語、英語での自由英作文なら文法・構文的に正確で洗練された英語）に厳密に従うこと。
5. 入試の模範解答としてふさわしく、無駄な冗長さを排し、加点ポイントが明瞭に伝わる格調高い文体にすること。
${mode === "with_original" ? "6. 元々の模範解答と一文一文を比較しても、著作権上の同一性・類似性がない、独自の語彙・構文で表現されていること。" : ""}

【出力形式】
JSONのみを返してください。説明文、Markdown、コードブロックは禁止。
{
  "modelAnswer": "作成された完全オリジナルの模範解答本文（指定文字数・言語を厳守）",
  "charCount": 85,
  "satisfiedElements": [
    { "id": "e1", "summary": "この採点要素をどう満たしているかの簡潔な説明" }
  ],
  "reasoning": "なぜこの解答が独自採点基準を満たしているか、および工夫した点の簡潔な解説（100字程度）"
}
`;

  const result = await generateContentWithFallback(genAI, {
    contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4096 },
  }, 3, 2000, ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"]);

  const parsed = JSON.parse(sanitizeJson(result.response.text()));
  const modelAnswer = String(parsed.modelAnswer || "").trim();

  if (!modelAnswer) {
    throw new Error("模範解答を生成できませんでした。もう一度お試しください。");
  }

  return {
    modelAnswer,
    charCount: typeof parsed.charCount === "number" ? parsed.charCount : Array.from(modelAnswer).length,
    satisfiedElements: Array.isArray(parsed.satisfiedElements) ? parsed.satisfiedElements : [],
    reasoning: String(parsed.reasoning || "").trim(),
    mode,
  };
}

// ---------------------------------------------------------------------------
// Main serve handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  const { headers, isAllowed } = getCorsConfig(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  // CORS origin check
  if (!isAllowed) {
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
      case "extractQuestionEvidence":
        result = await handleExtractQuestionEvidence(genAI, body);
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
      case "transformRubricToScoringElements":
        result = await handleTransformRubricToScoringElements(genAI, body);
        break;
      case "generateEssayModelAnswer":
        result = await handleGenerateEssayModelAnswer(genAI, body);
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
