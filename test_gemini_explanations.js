import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";

// Load env
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

const apiKey = process.env.VITE_GEMINI_API_KEY_V2 || process.env.VITE_GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const sectionData = {
  "id": "1",
  "label": "第1問",
  "questions": [
    {
      "id": "1",
      "label": "問1",
      "type": "selection",
      "explanation": ""
    },
    {
      "id": "2",
      "label": "問2",
      "type": "selection",
      "explanation": ""
    }
  ]
};

const prompt = `あなたは大学入試の専門講師です。
提供された「設問構造（JSON）」の各小問に対応する **解説(explanation)のみ** を生成してください。
また、大問全体の読解ポイント(sectionAnalysis)も併せて作成してください。

【厳格ルール】
1. **既存の id, label, type, options, correctAnswer, points は絶対に書き換えないこと。** 
2. 渡された JSON の各要素にある \`explanation\` フィールドを、論理的で丁寧な解説（本文の根拠、誤答の理由）で埋めてください。
3. 日本語で記述すること。
4. アスタリスク（*）記号は一切使用禁止。
5. 出力は、解説を埋めた後の「同じJSON構造のオブジェクト1つのみ」を返してください。

【対象の設問構造（現在のデータ）】
${JSON.stringify(sectionData, null, 2)}

【出力要件】
- JSONオブジェクト1つのみ
- 既存の構造を維持
`;

async function run() {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const res = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" }
  });
  console.log("RESPONSE:", res.response.text());
}
run();
