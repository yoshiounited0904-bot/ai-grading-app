import { supabase } from './supabaseClient';

// ---------------------------------------------------------------------------
// sanitizeJson — kept on the client side so callers can still use it locally
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Helper function to convert either a File object or a URL string to base64.
// Must stay client-side because it uses FileReader, canvas, and Image APIs.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Internal helper: invoke the Edge Function and unwrap the result
// ---------------------------------------------------------------------------
const invokeGeminiAdmin = async (body) => {
  const { data, error } = await supabase.functions.invoke('gemini-admin', { body });
  if (error) throw new Error(error.message || 'Edge Function error');
  if (data?.error) throw new Error(data.error);
  return data?.data;
};

// ---------------------------------------------------------------------------
// Exported service functions
// ---------------------------------------------------------------------------

export const extractExamMetadata = async (questionFiles = []) => {
  try {
    if (!questionFiles || questionFiles.length === 0) {
      throw new Error("問題PDFがありません。");
    }

    const questionFilesData = (await Promise.all(questionFiles.map(file => anySourceToBase64(file)))).filter(Boolean);
    if (questionFilesData.length === 0) {
      throw new Error("問題PDFの読み込みに失敗しました。");
    }

    return await invokeGeminiAdmin({ operation: 'extractMetadata', questionFilesData });
  } catch (error) {
    console.error("[AdminGeminiService] Failed to extract exam metadata:", error);
    throw error;
  }
};

export const generateExamMasterData = async (subjectType, questionFiles, questionFilesBySection, answerFilesBySection, sectionInstructionsBySection, sectionPointsBySection, extraInfo) => {
  try {
    console.log("[AdminGeminiService] generateExamMasterData called");

    // Convert all file sources to base64 upfront on the client (uses browser APIs)
    const questionFilesData = questionFiles && questionFiles.length > 0
      ? (await Promise.all(questionFiles.map(f => anySourceToBase64(f)))).filter(Boolean)
      : [];

    const questionFilesBySectionData = {};
    for (const [sectionIndex, files] of Object.entries(questionFilesBySection || {})) {
      if (files && files.length > 0) {
        questionFilesBySectionData[sectionIndex] = (await Promise.all(files.map(f => anySourceToBase64(f)))).filter(Boolean);
      } else {
        questionFilesBySectionData[sectionIndex] = [];
      }
    }

    const answerFilesBySectionData = {};
    for (const [sectionIndex, files] of Object.entries(answerFilesBySection || {})) {
      if (files && files.length > 0) {
        answerFilesBySectionData[sectionIndex] = (await Promise.all(files.map(f => anySourceToBase64(f)))).filter(Boolean);
      } else {
        answerFilesBySectionData[sectionIndex] = [];
      }
    }

    return await invokeGeminiAdmin({
      operation: 'generateMasterData',
      subjectType,
      questionFilesData,
      questionFilesBySection: questionFilesBySectionData,
      answerFilesBySection: answerFilesBySectionData,
      sectionInstructionsBySection,
      sectionPointsBySection,
      extraInfo,
    });
  } catch (error) {
    console.error("Error generating exam master data:", error);
    throw error;
  }
};

export const regenerateQuestionExplanation = async (questionData, questionFiles = [], answerFiles = []) => {
  try {
    const questionFilesData = (await Promise.all(questionFiles.map(f => anySourceToBase64(f)))).filter(Boolean);
    const answerFilesData = (await Promise.all(answerFiles.map(f => anySourceToBase64(f)))).filter(Boolean);

    return await invokeGeminiAdmin({
      operation: 'regenerateExplanation',
      questionData,
      questionFilesData,
      answerFilesData,
    });
  } catch (error) {
    console.error("Error regenerating explanation:", error);
    throw error;
  }
};

export const regenerateDetailedAnalysis = async (subjectType, examData, questionFiles = [], answerFiles = []) => {
  try {
    const questionFilesData = (await Promise.all(questionFiles.map(f => anySourceToBase64(f)))).filter(Boolean);
    const answerFilesData = (await Promise.all(answerFiles.map(f => anySourceToBase64(f)))).filter(Boolean);

    return await invokeGeminiAdmin({
      operation: 'regenerateAnalysis',
      subjectType,
      examData,
      questionFilesData,
      answerFilesData,
    });
  } catch (error) {
    console.error("Error regenerating detailed analysis:", error);
    throw error;
  }
};

export const regeneratePointsAllocation = async (subjectType, examData, questionFiles = [], answerFiles = [], sectionPointsBySection = {}) => {
  try {
    const questionFilesData = (await Promise.all(questionFiles.map(f => anySourceToBase64(f)))).filter(Boolean);
    const answerFilesData = (await Promise.all(answerFiles.map(f => anySourceToBase64(f)))).filter(Boolean);

    return await invokeGeminiAdmin({
      operation: 'regeneratePoints',
      subjectType,
      examData,
      questionFilesData,
      answerFilesData,
      sectionPointsBySection,
    });
  } catch (error) {
    console.error("Error regenerating point allocation:", error);
    throw error;
  }
};

export const generateSectionDetailedAnalysis = async (subjectType, sectionData, questionFiles = [], answerFiles = [], specialInstruction = "", subjectName = "") => {
  try {
    const questionFilesData = (await Promise.all(questionFiles.map(f => anySourceToBase64(f)))).filter(Boolean);
    const answerFilesData = (await Promise.all(answerFiles.map(f => anySourceToBase64(f)))).filter(Boolean);

    return await invokeGeminiAdmin({
      operation: 'generateSectionAnalysis',
      subjectType,
      sectionData,
      questionFilesData,
      answerFilesData,
      specialInstruction,
      subjectName,
    });
  } catch (error) {
    console.error("Error generating section detailed analysis:", error);
    throw error;
  }
};

export const generateSingleSectionData = async (subjectType, sectionIndex, questionFiles, answerFiles, instruction, targetPoints) => {
  try {
    console.log(`[AdminGeminiService] Generating section ${sectionIndex} data...`);

    const questionFilesData = (await Promise.all(questionFiles.map(f => anySourceToBase64(f)))).filter(Boolean);
    const answerFilesData = (await Promise.all(answerFiles.map(f => anySourceToBase64(f)))).filter(Boolean);

    return await invokeGeminiAdmin({
      operation: 'generateSingleSection',
      subjectType,
      sectionIndex,
      questionFilesData,
      answerFilesData,
      instruction,
      targetPoints,
    });
  } catch (error) {
    console.error(`[AdminGeminiService] Failed to generate section ${sectionIndex}:`, error);
    throw error;
  }
};

export const generateSectionQuestionsExplanations = async (subjectType, sectionData, questionFiles = [], answerFiles = []) => {
  try {
    const questionFilesData = (await Promise.all(questionFiles.map(f => anySourceToBase64(f)))).filter(Boolean);
    const answerFilesData = (await Promise.all(answerFiles.map(f => anySourceToBase64(f)))).filter(Boolean);

    return await invokeGeminiAdmin({
      operation: 'generateSectionQA',
      subjectType,
      sectionData,
      questionFilesData,
      answerFilesData,
    });
  } catch (error) {
    console.error(`[AdminGeminiService] Failed to generate explanations for section:`, error);
    throw error;
  }
};

export const extractSectionVocabulary = async (questionFiles = []) => {
  try {
    const questionFilesData = (await Promise.all(questionFiles.map(f => anySourceToBase64(f)))).filter(Boolean);
    if (questionFilesData.length === 0) {
      throw new Error("問題の画像ファイルがありません。");
    }

    return await invokeGeminiAdmin({
      operation: 'extractVocabulary',
      questionFilesData,
    });
  } catch (error) {
    console.error(`[AdminGeminiService] Failed to extract vocabulary:`, error);
    throw error;
  }
};

export const consultScoringElements = async (examMeta, questionData, userMessage, history = []) => {
  try {
    return await invokeGeminiAdmin({
      operation: 'consultScoringElements',
      examMeta,
      questionData,
      userMessage,
      history,
    });
  } catch (error) {
    console.error(`[AdminGeminiService] Failed to consult scoring elements:`, error);
    throw error;
  }
};
