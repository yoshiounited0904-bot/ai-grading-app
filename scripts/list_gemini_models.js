import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const apiKey = process.env.VITE_GEMINI_API_KEY_V2 || process.env.VITE_GEMINI_API_KEY;

async function listModels() {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    console.log("Fetching available models from v1beta...");
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (response.ok) {
            console.log("\n✅ Available Models:");
            if (data.models && data.models.length > 0) {
                data.models.forEach(m => {
                    console.log(`- ${m.name} (Methods: ${m.supportedGenerationMethods.join(", ")})`);
                });
            } else {
                console.log("No models found for this key.");
            }
        } else {
            console.error(`❌ Failed to fetch models (${response.status}):`, data.error?.message || JSON.stringify(data));
        }
    } catch (err) {
        console.error("❌ Network Error:", err.message);
    }
}

listModels();
