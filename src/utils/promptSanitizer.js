const MAX_ANSWER_LENGTH = 2000;

// Patterns commonly used in prompt injection attacks
const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
    /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
    /forget\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
    /you\s+are\s+now\s+(a\s+)?(?:different|new|another)/gi,
    /system\s*:/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
    /<<<.*?>>>/gs,
];

/**
 * Sanitizes user-provided text before embedding in an AI prompt.
 * Strips injection patterns and enforces length limits.
 */
export const sanitizeUserAnswer = (answer) => {
    if (answer === null || answer === undefined) return '';
    let text = String(answer).slice(0, MAX_ANSWER_LENGTH);
    for (const pattern of INJECTION_PATTERNS) {
        text = text.replace(pattern, '[REMOVED]');
    }
    // Escape XML-like delimiters used in prompt structure so they can't break out
    text = text.replace(/<user_answer>/gi, '&lt;user_answer&gt;');
    text = text.replace(/<\/user_answer>/gi, '&lt;/user_answer&gt;');
    return text;
};

/**
 * Wraps sanitized user content in a labeled delimiter block.
 * Instructs the model to treat the content strictly as data.
 */
export const wrapAsUserData = (label, content) => {
    const sanitized = sanitizeUserAnswer(content);
    return `<${label}>\n${sanitized}\n</${label}>`;
};
