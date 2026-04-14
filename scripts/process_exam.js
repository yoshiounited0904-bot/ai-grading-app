import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.VITE_GEMINI_API_KEY);

async function processExam(questionPdfPath, answerPdfPath, outputId) {
  if (!process.env.VITE_GEMINI_API_KEY) {
    console.error("Error: VITE_GEMINI_API_KEY is not set in .env file.");
    process.exit(1);
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-pro",
    tools: [
      {
        googleSearchRetrieval: {},
      },
    ],
  });

  console.log(`Processing Question PDF: ${questionPdfPath}`);
  console.log(`Processing Answer PDF: ${answerPdfPath}`);

  const questionPdfData = fs.readFileSync(questionPdfPath);
  const answerPdfData = fs.readFileSync(answerPdfPath);

  const prompt = `
あなたは大学入試のデータ作成エキスパートです。
添付された「問題PDF」と「解答PDF」を分析し、さらにGoogle検索を使用して正確な配点情報を取得した上で、アプリで使用する試験マスターデータをJSON形式で作成してください。

【実行手順】
1. Google検索を使用して、この試験（${outputId}に関連する大学・学部・科目・年度）の「満点」および「大問ごとの配点分布」を調査してください。
2. 検索結果とPDFの内容を照らし合わせ、最も正確と思われる配点を各設問に割り振ってください。

【出力JSONの構造】
{
  "id": "${outputId}",
  "university": "大学名",
  "universityId": "大学ID (数値: 1:慶應, 2:早稲田, 3:法政 など)",
  "faculty": "学部名",
  "facultyId": "学部ID (英字: law, commerce, econ など)",
  "year": 2025,
  "subject": "科目名",
  "type": "pdf",
  "pdfPath": "/exam_data/${path.basename(questionPdfPath)}",
  "timeLimit": 60,
  "maxScore": 200, // 検索結果に基づく満点
  "structure": [
    {
      "id": "大問ID (I, II, III...)",
      "label": "大問ラベル (第1問など)",
      "title": "大問のタイトル/説明",
      "type": "selection | text",
      "questions": [
        {
          "id": "小問ID (I-1, I-2...)",
          "label": "小問ラベル ((1), (2)...)",
          "type": "selection | text",
          "options": ["1", "2", "3", "4"], // 選択式の場合のみ
          "correctAnswer": "正解",
          "points": 5, // 検索結果と問題数から算出した正確な配点
          "gradingCriteria": { // 記述式の場合のみ
            "keywords": ["必須キーワード1", "必須キーワード2"],
            "minLength": 20,
            "maxLength": 100,
            "description": "採点基準の詳細説明"
          }
        }
      ]
    }
  ]
}

【採点基準の作成ルール（重要）】
1. 記述式問題（type: "text"）については、解答PDFの解説や正解例を参考に、キーワード、文字数、論理構成の基準を必ず含めてください。
2. 配点（points）は、検索で得られた大問ごとの合計点と、その中の設問数から適切に割り振ってください。

JSONのみを出力してください。解説などのテキストは不要です。
`;

  try {
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "application/pdf",
          data: questionPdfData.toString('base64')
        }
      },
      {
        inlineData: {
          mimeType: "application/pdf",
          data: answerPdfData.toString('base64')
        }
      },
      { text: prompt }
    ]);

    const responseText = result.response.text();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("Could not find JSON in Gemini response.");
    }

    const examJson = JSON.parse(jsonMatch[0]);
    const outputPath = path.join(process.cwd(), 'src/data/exams', `${outputId}.json`);

    fs.writeFileSync(outputPath, JSON.stringify(examJson, null, 2));
    console.log(`Successfully generated: ${outputPath}`);

  } catch (error) {
    console.error("Error processing exam:", error);
  }
}

// CLI usage: node scripts/process_exam.js <question_pdf> <answer_pdf> <output_id>
const args = process.argv.slice(2);
if (args.length < 3) {
  console.log("Usage: node scripts/process_exam.js <question_pdf_path> <answer_pdf_path> <output_id>");
  process.exit(1);
}

processExam(args[0], args[1], args[2]);
