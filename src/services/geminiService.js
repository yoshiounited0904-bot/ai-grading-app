import { GoogleGenerativeAI } from "@google/generative-ai";
import { gradeObjectively } from "../utils/gradingEngine";

const MODELS = {
    PRIMARY: "gemini-2.5-flash",
    FALLBACK: "gemini-1.5-flash"
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const sanitizeJson = (text) => {
    // Remove markdown code blocks if present
    let cleaned = text.replace(/```json /g, '').replace(/```/g, '').trim();

    // Find the first { and last } to handle any stray text
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    return cleaned;
};

const generateWithRetry = async (genAI, prompt, imageParts, config = {}) => {
    let currentModelName = MODELS.PRIMARY;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            const model = genAI.getGenerativeModel({
                model: currentModelName,
                ...config
            });

            const result = await model.generateContent([prompt, ...imageParts]);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.warn(`Attempt ${attempts + 1} failed with model ${currentModelName}:`, error.message);

            // Check for overload (503) or other transient errors
            if (error.message.includes('503') || error.message.includes('overloaded')) {
                attempts++;
                if (attempts < maxAttempts) {
                    // Exponential backoff: 1s, 2s, 4s...
                    const delay = 1000 * Math.pow(2, attempts - 1);
                    console.log(`Retrying in ${delay}ms...`);
                    await wait(delay);

                    // Switch to fallback model on last attempt or if primary fails twice
                    if (attempts >= 1 && currentModelName === MODELS.PRIMARY) {
                        console.log(`Switching to fallback model: ${MODELS.FALLBACK}`);
                        currentModelName = MODELS.FALLBACK;
                    }
                    continue;
                }
            }
            throw error;
        }
    }
};

export const analyzeExamWithGemini = async (apiKey, imageParts) => {
    try {
        const genAI = new GoogleGenerativeAI(apiKey);

        const prompt = `
        You are an expert university entrance exam analyzer.
        
        **CRITICAL INSTRUCTION: OUTPUT MUST BE IN JAPANESE.**

        Analyze the provided images of a university entrance exam.
        Your goal is to extract the EXACT structure of the **ANSWER SHEET** (解答用紙).

        **Reasoning Steps (Chain of Thought):**
        1.  **Scan for Sections**: Identify all big headers (I, II, III, A, B...).
        2.  **Count ANSWER SLOTS (Crucial)**: 
            *   Do not just count question numbers. Count the number of **blanks** or **boxes** where a student needs to write an answer.
            *   **Example**: If "Question 1" has 2 blanks (e.g., "fill in (a) and (b)"), you MUST create **2 separate entries** (e.g., "1(a)", "1(b)").
            *   **Example**: If "Question 2" is a single multiple-choice question, that is 1 entry.
        3.  **Determine Type**: For each slot, decide if it is "selection" (choices provided) or "text" (writing).

        **Output Format (JSON Only):**
        {
            "structure": [
                {
                    "id": "section1",
                    "label": "I (Reading Comprehension)", 
                    "type": "selection" | "text",
                    "count": 10, // Total number of answer slots in this section
                    "options": ["a", "b", "c", "d"], 
                    "questions": [ 
                        // EXPLICITLY LIST ALL ANSWER SLOTS
                        { "id": "I-1-a", "label": "1(a)", "type": "text" }, 
                        { "id": "I-1-b", "label": "1(b)", "type": "text" },
                        { "id": "I-2", "label": "2", "type": "selection", "options": ["a", "b", "c", "d"] }
                    ]
                }
            ],
            "answers": {
                "I-1-a": "answer"
            }
        }
        
        IMPORTANT: Return ONLY the JSON string.
        `;

        const text = await generateWithRetry(genAI, prompt, imageParts, {
            generationConfig: {
                responseMimeType: "application/json"
            }
        });
        const jsonString = sanitizeJson(text);
        try {
            return JSON.parse(jsonString);
        } catch (parseError) {
            console.error("JSON Parse Error (Analysis). Raw string (first 500 chars):", jsonString.substring(0, 500));
            throw parseError;
        }
    } catch (error) {
        console.error("Error analyzing exam with Gemini:", error);
        throw error;
    }
};

// Helper function to create lightweight exam data without explanation fields
const createLightweightExamData = (examData) => {
    const lightweight = { ...examData };
    if (lightweight.structure && Array.isArray(lightweight.structure)) {
        lightweight.structure = lightweight.structure.map(section => {
            const lightSection = { ...section };
            if (lightSection.questions && Array.isArray(lightSection.questions)) {
                lightSection.questions = lightSection.questions.map(q => {
                    const { explanation, ...rest } = q;  // Remove explanation
                    return rest;
                });
            }
            return lightSection;
        });
    }
    return lightweight;
};

export const gradeExamWithGemini = async (apiKey, examData, userAnswers, imageParts) => {
    try {
        // Step 1: Programmatic Grading for Objective Questions
        const { score: objScore, questionFeedback: initialFeedback, pendingAiGrading } = gradeObjectively(examData, userAnswers);

        // If no AI grading is needed, use simple programmatic weakness analysis
        if (pendingAiGrading.length === 0) {
            const simpleWeakness = generateSimpleWeakness(objScore, examData.maxScore, initialFeedback);
            return {
                score: objScore,
                maxScore: examData.maxScore || 100,
                passProbability: calculatePassProbability(objScore, examData.maxScore, examData.passing_lines),
                weaknessAnalysis: simpleWeakness,
                questionFeedback: initialFeedback,
                detailedAnalysis: examData.detailedAnalysis || ""
            };
        }

        // Step 2: AI Grading for Subjective Questions (D, E, etc.)
        const genAI = new GoogleGenerativeAI(apiKey);
        const isEnglish = examData.subjectEn === "english";

        const aiPrompt = `
        You are an expert university entrance exam grader.
        Grade the following SUBJECTIVE questions based on the Master Data criteria.
        
        **Master Data Criteria:**
        ${JSON.stringify(pendingAiGrading.map(q => ({
            id: q.id,
            correctAnswer: q.correctAnswer,
            points: q.points,
            instruction: q.gradingInstruction // Custom instruction from admin
        })))}
        
        **User Answers:**
        ${JSON.stringify(pendingAiGrading.map(q => ({ id: q.id, answer: q.userAnswer })))}
        
        **Rules:**
        1. Social Studies (types D, E): Use "Element-Based Grading". Score proportionally to the number of elements satisfied.
        2. English: Grade based on accuracy and keywords.
        3. Output MUST be Japanese.
        
        Return JSON format:
        {
            "aiFeedback": [
                { "id": "question_id", "score": number, "correct": boolean, "explanation": "feedback in Japanese" }
            ],
            "generalWeakness": "Brief overall advice"
        }
        `;

        const text = await generateWithRetry(genAI, aiPrompt, imageParts, {
            generationConfig: { responseMimeType: "application/json" }
        });
        const aiResult = JSON.parse(sanitizeJson(text));

        // Step 3: Merge Results
        let totalScore = objScore;
        const finalFeedback = initialFeedback.map(f => {
            if (f.isSubjective) {
                const aiItem = aiResult.aiFeedback.find(ai => ai.id === f.id);
                if (aiItem) {
                    totalScore += aiItem.score;
                    return { ...f, score: aiItem.score, correct: aiItem.correct, explanation: aiItem.explanation };
                }
            }
            return f;
        });

        const maxScore = examData.maxScore || initialFeedback.length * 5; // Fallback

        return {
            score: totalScore,
            maxScore: maxScore,
            passProbability: calculatePassProbability(totalScore, maxScore, examData.passing_lines),
            weaknessAnalysis: aiResult.generalWeakness,
            questionFeedback: finalFeedback,
            detailedAnalysis: examData.detailedAnalysis || ""
        };

    } catch (error) {
        console.error("Error in Hybrid Grading:", error);
        throw new Error("採点中にエラーが発生しました: " + error.message);
    }
};

const calculatePassProbability = (score, max, passingLines) => {
    if (passingLines) {
        if (score >= (passingLines.A || 0)) return "A";
        if (score >= (passingLines.B || 0)) return "B";
        if (score >= (passingLines.C || 0)) return "C";
        if (score >= (passingLines.D || 0)) return "D";
        return "E";
    }

    const ratio = score / max;
    if (ratio >= 0.8) return "A";
    if (ratio >= 0.7) return "B";
    if (ratio >= 0.6) return "C";
    if (ratio >= 0.4) return "D";
    return "E";
};

// Simple programmatic weakness analysis (no AI call)
const generateSimpleWeakness = (score, maxScore, feedback) => {
    const percentage = Math.round((score / maxScore) * 100);
    const wrongCount = feedback.filter(f => !f.correct).length;
    const totalCount = feedback.length;

    if (percentage >= 80) {
        return `得点率${percentage}%、素晴らしい結果です。間違えた${wrongCount}問を復習し、完璧を目指しましょう。詳細な解説を参考に、理解を深めてください。`;
    } else if (percentage >= 60) {
        return `得点率${percentage}%、合格ラインです。間違えた${wrongCount}問（全${totalCount}問中）の解説を読み、理解を深めましょう。特に選択肢の消去法の思考プロセスを意識してください。`;
    } else {
        return `得点率${percentage}%、基礎固めが必要です。詳細解説を熟読し、なぜその答えになるのかを論理的に理解しましょう。類似問題で練習を重ねてください。`;
    }
};


export const chatWithGemini = async (apiKey, userMessage, history, gradingResult) => {
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        // For chat, we'll stick to one model for consistency of session, 
        // but we can try to initialize with fallback if primary fails immediately?
        // Chat is stateful, so retry is harder. We will just try to use the primary, 
        // and if it fails on init, try fallback.

        let model;
        try {
            model = genAI.getGenerativeModel({ model: MODELS.PRIMARY });
        } catch (e) {
            model = genAI.getGenerativeModel({ model: MODELS.FALLBACK });
        }

        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{
                        text: `
# Role
あなたは入試採点ツールに常駐する「AI先生」です。
あなたの役割は、提示された入試問題に関する生徒の疑問に対し、正確かつ前向きなアドバイスを提供することです。

# Context (Grading Result)
採点結果データ:
${JSON.stringify(gradingResult)}

# Constraints（制約事項）
1. **回答範囲の制限**:
   - 入試問題の内容、解き方、解説に関する質問以外には一切回答しないでください。
   - 雑談、個人的な相談、入試に関係のない世間話などは「今は勉強に集中しましょう」と優しく、かつ断固として断ってください。
2. **回答のスタンス**:
   - 常にポジティブで励ますような口調を保ってください。
   - 生徒の「わからない」を否定せず、学習の意欲を高める言葉を添えてください。
3. **答えの出し方**:
   - すぐに答えを教えるのではなく、ヒントを与えて考えさせるような誘導を優先してください（状況に応じて調整）。
4. **禁止事項**:
   - 政治、宗教、不適切なトピック、公序良俗に反する話題には一切触れません。
   - 入試問題の改変や、問題自体の批判は行いません。

# Character Voice
- 一人称は「私」です。
- 丁寧語（です・ます調）を使用します。
- 生徒を「〇〇さん」または「あなた」と呼びます。
- 「素晴らしい着眼点ですね」「その調子です！」といったポジティブなフィードバックを積極的に行います。

# Error Handling（範囲外の質問への対応）
生徒が問題に関係のない質問をした場合は、以下のテンプレートに従って回答を終了してください。
「その質問についてお話ししたい気持ちはやまやまですが、今は目の前の問題に集中して、合格を勝ち取ることが一番大切です。さあ、問題の解説に戻りましょう！」

# Formatting Rules
- Markdownの記号（*や#）は使用しないでください。
- 太字や斜体などの装飾は行わないでください。
- 改行と空白を適切に使い、読みやすいテキストにしてください。
- リストが必要な場合は単純なハイフン（-）を使用してください。
` }],
                },
                {
                    role: "model",
                    parts: [{ text: "わかりました。生徒さんの質問に丁寧に答えます。" }],
                },
                ...history.map(msg => ({
                    role: msg.role === 'ai' ? 'model' : 'user',
                    parts: [{ text: msg.text }]
                }))
            ],
        });

        const result = await chat.sendMessage(userMessage);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error chatting with Gemini:", error);
        // Simple retry for chat message if it was a 503
        if (error.message.includes('503') || error.message.includes('overloaded')) {
            throw new Error("AIが混み合っています。少し時間を置いて再度お試しください。");
        }
        throw error;
    }
};
