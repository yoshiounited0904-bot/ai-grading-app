
// Manual test for sanitizeJson function from adminGeminiService.js (REFINE VERSION)
const sanitizeJson = (jsonString) => {
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
    // Skip brackets inside strings (very basic check)
    // Actually, proper JSON parsing would be needed for full robustness, 
    // but for simple truncation this is much better.
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

const testCases = [
  {
    name: "Regular JSON",
    input: '{"id": "1", "label": "test"}',
    expected: true
  },
  {
    name: "Truncated String",
    input: '{"id": "1", "explanation": "This is a truncated string',
    expected: true
  },
  {
    name: "Truncated Array with trailing comma",
    input: '{"questions": [{"id": "1"},',
    expected: true
  },
  {
    name: "Broken Array mid-object",
    input: '{"questions": [{"id": "1", "explanation": "Thinking...',
    expected: true
  },
  {
    name: "Conversational prefix",
    input: 'Here is the JSON: ```json\n{"id": "1"}\n``` Hope this helps!',
    expected: true
  }
];

console.log("Running sanitizeJson tests...");
testCases.forEach(tc => {
  const sanitized = sanitizeJson(tc.input);
  try {
    JSON.parse(sanitized);
    console.log(`✅ PASS: ${tc.name}`);
    console.log(`   Result: ${sanitized}`);
  } catch (err) {
    console.log(`❌ FAIL: ${tc.name}`);
    console.log(`   Source: ${tc.input}`);
    console.log(`   Sanitized: ${sanitized}`);
    console.log(`   Error: ${err.message}`);
  }
});
