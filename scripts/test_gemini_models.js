import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.VITE_GEMINI_API_KEY_V2 || process.env.VITE_GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

async function testModels() {
    console.log("Testing Gemini API access...");
    
    // Attempt 1: List models (this might fail depending on permissions)
    try {
        // Note: listModels is not always straightforward in the SDK,
        // so we'll try a simple generation with different model names.
        const trialModels = ["gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-1.5-pro", "gemini-2.0-flash-exp"];
        
        for (const modelName of trialModels) {
            console.log(`\nTrying model: ${modelName}...`);
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent("Hello, are you active? Reply in one word.");
                const response = await result.response;
                console.log(`✅ ${modelName} Success: ${response.text().trim()}`);
            } catch (err) {
                console.error(`❌ ${modelName} Failed: ${err.message}`);
            }
        }
    } catch (err) {
        console.error("General API Error:", err.message);
    }
}

testModels();
