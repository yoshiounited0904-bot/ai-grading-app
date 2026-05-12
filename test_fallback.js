const { GoogleGenerativeAI } = require("@google/generative-ai");

const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-pro",
  "gemini-1.5-pro"
];

const generateContentWithFallback = async (genAI, requestData, maxRetriesPerModel = 2, initialDelay = 100) => {
  let lastError;
  let errors = [];
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
        lastError = error;
        errors.push({ model: modelName, error: error.message });
        break; // Break inner loop, try next model in the outer loop
      }
    }
  }
  console.log("All models failed. Errors:", errors);
  throw lastError; // If all models fail, throw the last error
};

const genAI = new GoogleGenerativeAI("DUMMY_KEY");
generateContentWithFallback(genAI, { contents: [{ role: "user", parts: [{ text: "Hello" }] }] })
  .catch(e => console.log("Final thrown error:", e.message));
