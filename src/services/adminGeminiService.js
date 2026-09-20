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
const DEFAULT_PDF_IMAGE_OPTIONS = Object.freeze({
  maxPages: 6,
  scale: 0.7,
  quality: 0.5
});

const SECTION_ANALYSIS_PDF_IMAGE_OPTIONS = Object.freeze({
  maxPages: 3,
  scale: 0.55,
  quality: 0.42
});

const getPdfImageOptions = (conversionOptions = {}) => ({
  ...DEFAULT_PDF_IMAGE_OPTIONS,
  ...(conversionOptions.pdf || {})
});

const resolveSupabaseStorageFetchUrl = async (source) => {
  const rawUrl = String(source || '').trim();
  if (!rawUrl) return rawUrl;

  try {
    const url = new URL(rawUrl);
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/exam-pdfs\/(.+)$/);
    if (!match) return rawUrl;

    const objectPath = decodeURIComponent(match[1]);
    const { data, error } = await supabase.storage
      .from('exam-pdfs')
      .createSignedUrl(objectPath, 7200);

    if (error || !data?.signedUrl) {
      console.warn('Failed to create signed URL for exam PDF:', error);
      return rawUrl;
    }

    return data.signedUrl;
  } catch {
    return rawUrl;
  }
};

const anySourceToBase64 = async (source, conversionOptions = {}) => {
  if (!source) return null;

  // Case 1: source is already a File/Blob object
  if (source instanceof File || source instanceof Blob) {
    if (source.type === 'application/pdf') {
      const { convertPdfToImages } = await import('../utils/pdfUtils');
      const images = await convertPdfToImages(source, () => {}, null, getPdfImageOptions(conversionOptions));
      return images.map(img => img.inlineData).filter(Boolean);
    }

    return new Promise((resolve, reject) => {
      const isImage = source.type.startsWith('image/');
      if (isImage) {
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const reader = new FileReader();

        reader.onload = (e) => {
          img.onload = () => {
            const MAX_WIDTH = 1200;
            const MAX_HEIGHT = 1200;
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
            const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
            const base64String = dataUrl.split(',')[1];
            canvas.width = 0;
            canvas.height = 0;
            img.onload = null;
            img.onerror = null;
            img.src = '';
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
      const fetchUrl = await resolveSupabaseStorageFetchUrl(source);
      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const blob = await response.blob();

      if (blob.type === 'application/pdf') {
        const { convertPdfToImages } = await import('../utils/pdfUtils');
        const images = await convertPdfToImages(blob, () => {}, null, getPdfImageOptions(conversionOptions));
        return images.map(img => img.inlineData).filter(Boolean);
      }

      // If it's an image, use the recursive logic above to compress it
      return anySourceToBase64(blob, conversionOptions);
    } catch (err) {
      console.error(`Failed to fetch source from URL: ${source}`, err);
      throw new Error(`ファイルを取得できませんでした: ${source}`);
    }
  }

  return null;
};

const sourcesToBase64 = async (sources = [], conversionOptions = {}) => {
  const converted = [];
  for (const source of sources || []) {
    const item = await anySourceToBase64(source, conversionOptions);
    if (Array.isArray(item)) {
      converted.push(...item);
    } else if (item) {
      converted.push(item);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return converted;
};

const isRetriableAdminGenerationError = (error) => {
  const message = String(error?.message || error || '');
  return /compute resources|temporar|timeout|timed out|failed to fetch|network|Edge Function HTTP 5\d\d/i.test(message);
};

const invokeGeminiAdminWithRetry = async (body, { retries = 1, delayMs = 1400 } = {}) => {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await invokeGeminiAdmin(body);
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetriableAdminGenerationError(error)) {
        throw error;
      }
      console.warn('[AdminGeminiService] Retrying admin generation after transient failure:', error);
      await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw lastError;
};

const withAdminGenerationLock = async (task) => {
  if (typeof navigator !== 'undefined' && navigator?.locks?.request) {
    return navigator.locks.request('smashai-admin-ai-generation', { mode: 'exclusive' }, task);
  }

  if (typeof localStorage === 'undefined') {
    return task();
  }

  const lockKey = 'smashai-admin-ai-generation-lock.v1';
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const waitDeadline = Date.now() + 20 * 60 * 1000;

  while (Date.now() < waitDeadline) {
    const now = Date.now();
    let current = null;
    try {
      current = JSON.parse(localStorage.getItem(lockKey) || 'null');
    } catch {
      current = null;
    }

    if (!current?.owner || Number(current.expiresAt) < now) {
      localStorage.setItem(lockKey, JSON.stringify({
        owner,
        expiresAt: now + 20 * 60 * 1000
      }));
      try {
        const confirmed = JSON.parse(localStorage.getItem(lockKey) || 'null');
        if (confirmed?.owner === owner) break;
      } catch {
        break;
      }
    }

    await sleep(1000);
  }

  try {
    return await task();
  } finally {
    try {
      const current = JSON.parse(localStorage.getItem(lockKey) || 'null');
      if (current?.owner === owner) {
        localStorage.removeItem(lockKey);
      }
    } catch {
      localStorage.removeItem(lockKey);
    }
  }
};

const estimateRequestSizeMb = (body) => {
  try {
    return new Blob([JSON.stringify(body)]).size / 1024 / 1024;
  } catch {
    return 0;
  }
};

const decodeJwtPayload = (token) => {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const getGeminiAdminAuthHeaders = async () => {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  let accessToken = '';

  try {
    const { data: refreshed } = await supabase.auth.refreshSession();
    accessToken = refreshed?.session?.access_token || '';
  } catch (refreshError) {
    console.warn('[AdminGeminiService] Session refresh failed before Edge Function call:', refreshError);
  }

  if (!accessToken) {
    try {
      const { data } = await supabase.auth.getSession();
      accessToken = data?.session?.access_token || '';
    } catch (sessionError) {
      console.warn('[AdminGeminiService] Session lookup failed before Edge Function call:', sessionError);
    }
  }

  const tokenSource = accessToken ? 'session' : 'none';
  const token = accessToken || '';
  const payload = decodeJwtPayload(token);

  return {
    tokenSource,
    tokenPayload: payload ? {
      ref: payload.ref || '',
      role: payload.role || '',
      iss: payload.iss || '',
      iat: payload.iat || '',
      exp: payload.exp || ''
    } : null,
    token,
    anonKey
  };
};

// ---------------------------------------------------------------------------
// Internal helper: invoke the Edge Function and unwrap the result
// ---------------------------------------------------------------------------
const invokeGeminiAdmin = async (body) => {
  const requestSizeMb = estimateRequestSizeMb(body);
  if (requestSizeMb > 8) {
    throw new Error(`Edge Functionに送るデータが大きすぎます（約${requestSizeMb.toFixed(1)}MB）。大問PDFのページ数を減らすか、問題PDFをさらに分割してください。`);
  }

  const { tokenSource, tokenPayload, token, anonKey } = await getGeminiAdminAuthHeaders();
  if (!token) {
    throw new Error('管理者ログインセッションが取得できませんでした。ページを再読み込みして、管理者アカウントでログインし直してください。');
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const headers = {
    'Content-Type': 'application/json',
    ...(anonKey ? { apikey: anonKey } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  const response = await fetch(`${supabaseUrl}/functions/v1/gemini-admin`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  let payload = null;
  let responseText = '';
  try {
    responseText = await response.text();
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    let detail = '';
    if (payload && typeof payload === 'object') {
      detail = payload.error || payload.message || '';
    }
    const rawMessage = detail || responseText || `Edge Function HTTP ${response.status}`;

    const authHint = /invalid jwt/i.test(rawMessage)
      ? `\n\n送信JWT: ${tokenSource}${tokenPayload ? ` / ref=${tokenPayload.ref || '-'} / role=${tokenPayload.role || '-'} / iat=${tokenPayload.iat || '-'}` : ''}\nSupabaseの管理者ログインJWTが無効です。アプリ側ではログイン情報を削除していません。まずページを再読み込みし、それでも直らない場合だけ管理者アカウントでログインし直してください。`
      : '';
    const sizeText = requestSizeMb ? `（送信データ約${requestSizeMb.toFixed(1)}MB）` : '';
    throw new Error(`${rawMessage}${sizeText}${authHint}`);
  }

  if (payload?.error) throw new Error(payload.error);
  return payload?.data;
};

// ---------------------------------------------------------------------------
// Exported service functions
// ---------------------------------------------------------------------------

export const extractExamMetadata = async (questionFiles = []) => {
  try {
    if (!questionFiles || questionFiles.length === 0) {
      throw new Error("問題PDFがありません。");
    }

    const questionFilesData = await sourcesToBase64(questionFiles);
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
      ? await sourcesToBase64(questionFiles)
      : [];

    const questionFilesBySectionData = {};
    for (const [sectionIndex, files] of Object.entries(questionFilesBySection || {})) {
      if (files && files.length > 0) {
        questionFilesBySectionData[sectionIndex] = await sourcesToBase64(files);
      } else {
        questionFilesBySectionData[sectionIndex] = [];
      }
    }

    const answerFilesBySectionData = {};
    for (const [sectionIndex, files] of Object.entries(answerFilesBySection || {})) {
      if (files && files.length > 0) {
        answerFilesBySectionData[sectionIndex] = await sourcesToBase64(files);
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

export const regenerateQuestionExplanation = async (questionData, questionFiles = [], answerFiles = [], subjectType = '') => {
  try {
    const questionFilesData = await sourcesToBase64(questionFiles);
    const answerFilesData = await sourcesToBase64(answerFiles);

    return await invokeGeminiAdmin({
      operation: 'regenerateExplanation',
      subjectType,
      questionData,
      questionFilesData,
      answerFilesData,
    });
  } catch (error) {
    console.error("Error regenerating explanation:", error);
    throw error;
  }
};

const isUsableExplanation = (value) => (
  typeof value === 'string' &&
  value.trim() !== '' &&
  !value.includes('AI生成中') &&
  !value.includes('AI生成エラー')
);

const isUnresolvedCorrectAnswer = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return true;
  if (['要確認', '未確認', '不明', '不明確', '要修正', '確認中'].includes(text)) return true;
  return /^要確認[（(]/u.test(text);
};

const buildResolvedCorrectAnswerPatch = (existingQuestion, generatedQuestion) => {
  if (!isUnresolvedCorrectAnswer(existingQuestion?.correctAnswer) || isUnresolvedCorrectAnswer(generatedQuestion?.correctAnswer)) {
    return {};
  }

  const patch = {
    correctAnswer: String(generatedQuestion.correctAnswer).trim(),
    needsReview: false,
  };
  if (existingQuestion?.answerIssue === 'unresolved' || existingQuestion?.answerIssue === 'missing_answer') {
    patch.answerIssue = '';
  }
  return patch;
};

const findQuestionIndex = (questions, target, fallbackIndex = -1) => {
  const byId = questions.findIndex(orig => String(orig?.id ?? '').trim() === String(target?.id ?? '').trim());
  if (byId !== -1) return byId;

  const byLabel = questions.findIndex(orig => String(orig?.label ?? '').trim() === String(target?.label ?? '').trim());
  if (byLabel !== -1) return byLabel;

  return fallbackIndex >= 0 && fallbackIndex < questions.length ? fallbackIndex : -1;
};

export const regenerateDetailedAnalysis = async (subjectType, examData, questionFiles = [], answerFiles = []) => {
  try {
    const questionFilesData = await sourcesToBase64(questionFiles);
    const answerFilesData = await sourcesToBase64(answerFiles);

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
    const questionFilesData = await sourcesToBase64(questionFiles);
    const answerFilesData = await sourcesToBase64(answerFiles);

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
    return await withAdminGenerationLock(async () => {
      const questions = Array.isArray(sectionData?.questions) ? sectionData.questions : [];
      const makeSlimSectionData = (targetQuestions) => ({
        id: sectionData?.id,
        label: sectionData?.label,
        allocatedPoints: sectionData?.allocatedPoints,
        questionType: sectionData?.questionType,
        instruction: sectionData?.instruction,
        sectionAnalysis: sectionData?.sectionAnalysis,
        questions: targetQuestions.map((q) => ({
          id: q?.id,
          label: q?.label,
          prompt: q?.prompt,
          questionText: q?.questionText,
          question: q?.question,
          instruction: q?.instruction,
          passageReference: q?.passageReference,
          answerFormat: q?.answerFormat,
          type: q?.type,
          options: q?.options,
          correctAnswer: q?.correctAnswer,
          points: q?.points,
          explanation: q?.explanation,
          gradingInstruction: q?.gradingInstruction,
          scoringElements: q?.scoringElements,
          wordLimit: q?.wordLimit,
          forceZeroRules: q?.forceZeroRules,
          answerIssue: q?.answerIssue,
          needsReview: q?.needsReview
        }))
      });

      const slimSectionData = makeSlimSectionData(questions);
      const sectionAnalysisConversionOptions = {
        pdf: SECTION_ANALYSIS_PDF_IMAGE_OPTIONS
      };
      const questionFilesData = await sourcesToBase64(questionFiles, sectionAnalysisConversionOptions);
      const answerFilesData = await sourcesToBase64(answerFiles, sectionAnalysisConversionOptions);

      return await invokeGeminiAdminWithRetry({
        operation: 'generateSectionAnalysis',
        subjectType,
        sectionData: slimSectionData,
        questionFilesData,
        answerFilesData,
        specialInstruction,
        subjectName,
      });
    });
  } catch (error) {
    console.error("Error generating section detailed analysis:", error);
    throw error;
  }
};

export const generateSingleSectionData = async (subjectType, sectionIndex, questionFiles, answerFiles, instruction, targetPoints, expectedQuestionCount = null, includeExplanations = true, allowLargeSectionSkeletonFallback = true) => {
  try {
    return await withAdminGenerationLock(async () => {
      console.log(`[AdminGeminiService] Generating section ${sectionIndex} data...`);

      const questionFilesData = await sourcesToBase64(questionFiles);
      const answerFilesData = await sourcesToBase64(answerFiles);

      return await invokeGeminiAdmin({
        operation: 'generateSingleSection',
        subjectType,
        sectionIndex,
        questionFilesData,
        answerFilesData,
        instruction,
        targetPoints,
        expectedQuestionCount,
        includeExplanations,
        allowLargeSectionSkeletonFallback,
      });
    });
  } catch (error) {
    console.error(`[AdminGeminiService] Failed to generate section ${sectionIndex}:`, error);
    throw error;
  }
};

export const generateSectionQuestionsExplanations = async (subjectType, sectionData, questionFiles = [], answerFiles = [], options = {}) => {
  try {
    return await withAdminGenerationLock(async () => {
      const questionFilesData = await sourcesToBase64(questionFiles);
      const answerFilesData = await sourcesToBase64(answerFiles);
      const originalQuestions = Array.isArray(sectionData?.questions) ? sectionData.questions : [];
      const updatedQuestions = [...originalQuestions];
      const chunkSize = 5;

      if (originalQuestions.length === 0) return sectionData;

      for (let i = 0; i < originalQuestions.length; i += chunkSize) {
        const chunk = originalQuestions.slice(i, i + chunkSize);

        let unresolvedQuestions = [...chunk];
        for (let attempt = 1; attempt <= 2 && unresolvedQuestions.length > 0; attempt += 1) {
          try {
            const chunkResult = await invokeGeminiAdmin({
              operation: 'generateSectionQA',
              subjectType,
              sectionData: {
                ...sectionData,
                questions: unresolvedQuestions.map(q => ({ ...q, explanation: '' }))
              },
              questionFilesData,
              answerFilesData,
            });

            const chunkQuestions = Array.isArray(chunkResult?.questions) ? chunkResult.questions : [];
            chunkQuestions.forEach((question, resultIndex) => {
              if (!isUsableExplanation(question?.explanation)) return;
              const targetIndex = findQuestionIndex(updatedQuestions, question, i + resultIndex);
              if (targetIndex !== -1) {
                updatedQuestions[targetIndex] = {
                  ...updatedQuestions[targetIndex],
                  ...buildResolvedCorrectAnswerPatch(updatedQuestions[targetIndex], question),
                  explanation: question.explanation.trim()
                };
              }
            });

            unresolvedQuestions = chunk.filter((question, chunkIndex) => {
              const targetIndex = findQuestionIndex(updatedQuestions, question, i + chunkIndex);
              return targetIndex === -1 || !isUsableExplanation(updatedQuestions[targetIndex]?.explanation);
            });
          } catch (chunkError) {
            if (attempt >= 2) break;
            console.warn(`[AdminGeminiService] Explanation chunk retry ${attempt} failed:`, chunkError);
          }
        }

        if (unresolvedQuestions.length > 0) {
          for (const question of unresolvedQuestions) {
            const explanation = await invokeGeminiAdmin({
              operation: 'regenerateExplanation',
              subjectType,
              questionData: question,
              questionFilesData,
              answerFilesData,
            });
            if (!isUsableExplanation(explanation)) {
              throw new Error(`小問 ${question?.label || question?.id || ''} の解説が生成されませんでした。`);
            }
            const targetIndex = findQuestionIndex(updatedQuestions, question);
            if (targetIndex !== -1) {
              updatedQuestions[targetIndex] = {
                ...updatedQuestions[targetIndex],
                explanation: explanation.trim()
              };
            }
          }
        }

        if (typeof options.onChunk === 'function') {
          await options.onChunk({
            ...sectionData,
            questions: updatedQuestions
          }, {
            start: i,
            end: Math.min(i + chunkSize, originalQuestions.length),
            total: originalQuestions.length
          });
        }
      }

      const missingQuestions = updatedQuestions.filter(question => !isUsableExplanation(question?.explanation));
      if (missingQuestions.length > 0) {
        throw new Error(`${missingQuestions.length}件の小問解説が未生成です: ${missingQuestions.map(q => q?.label || q?.id).filter(Boolean).join(', ')}`);
      }

      return {
        ...sectionData,
        questions: updatedQuestions
      };
    });
  } catch (error) {
    console.error(`[AdminGeminiService] Failed to generate explanations for section:`, error);
    throw error;
  }
};

export const extractSectionVocabulary = async (questionFiles = []) => {
  try {
    const questionFilesData = await sourcesToBase64(questionFiles);
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

export const consultScoringElements = async (examMeta, questionData, userMessage, history = [], questionFiles = [], answerFiles = []) => {
  try {
    const questionFilesData = await sourcesToBase64(questionFiles);
    const answerFilesData = await sourcesToBase64(answerFiles);

    return await invokeGeminiAdmin({
      operation: 'consultScoringElements',
      examMeta,
      questionData,
      userMessage,
      history,
      questionFilesData,
      answerFilesData,
    });
  } catch (error) {
    console.error(`[AdminGeminiService] Failed to consult scoring elements:`, error);
    throw error;
  }
};

export const transformRubricToScoringElements = async (examMeta, questionData, sourceRubric, questionFiles = [], answerFiles = []) => {
  try {
    const questionFilesData = await sourcesToBase64(questionFiles);
    const answerFilesData = await sourcesToBase64(answerFiles);

    return await invokeGeminiAdmin({
      operation: 'transformRubricToScoringElements',
      examMeta,
      questionData,
      sourceRubric,
      questionFilesData,
      answerFilesData,
    });
  } catch (error) {
    console.error(`[AdminGeminiService] Failed to transform rubric:`, error);
    throw error;
  }
};

export const generateEssayModelAnswer = async ({
  mode = 'with_original',
  examMeta = {},
  questionData = {},
  sectionContext = {},
  questionFiles = [],
  answerFiles = []
}) => {
  try {
    const questionFilesData = await sourcesToBase64(questionFiles);
    const answerFilesData = await sourcesToBase64(answerFiles);

    return await invokeGeminiAdmin({
      operation: 'generateEssayModelAnswer',
      mode,
      examMeta,
      questionData,
      sectionContext,
      questionFilesData,
      answerFilesData,
    });
  } catch (error) {
    console.error(`[AdminGeminiService] Failed to generate essay model answer:`, error);
    throw error;
  }
};

