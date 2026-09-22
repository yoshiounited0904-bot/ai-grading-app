import assert from 'assert';
import {
    exportQuestionsCsv,
    previewImportQuestionsCsv,
    applyImportQuestionsCsv,
    exportSectionsAnalysisCsv,
    previewImportSectionsAnalysisCsv,
    applyImportSectionsAnalysisCsv,
    parseCsvText
} from '../src/services/examCsvService.js';

console.log("--- Starting Exam CSV Service Unit Tests ---");

const initialStructure = [
    {
        id: '1',
        label: '第1問',
        allocatedPoints: 30,
        sectionAnalysis: '大問1の詳細解説です。\n\n複数段落と「引用符」と、カンマを含むMarkdown文です。',
        section_analysis_version: 1,
        section_analysis_updated_at: '2026-09-22T00:00:00.000Z',
        questions: [
            {
                id: '1-1',
                label: '問1',
                type: 'selection',
                correctAnswer: 'ア',
                alternativeAnswers: ['イ'],
                gradingInstruction: '部分点なし',
                points: 10,
                explanation: '問1の初期解説です。',
                explanation_version: 1,
                explanation_updated_at: '2026-09-22T00:00:00.000Z'
            },
            {
                id: '1-2',
                label: '問2',
                type: 'descriptive',
                correctAnswer: '高地性集落',
                points: 20,
                explanation: '問2の初期解説です。',
                explanation_version: 1,
                explanation_updated_at: '2026-09-22T00:00:00.000Z'
            }
        ]
    },
    {
        id: '2',
        label: '第2問',
        allocatedPoints: 30,
        sectionAnalysis: '大問2の詳細解説です。',
        section_analysis_version: 1,
        section_analysis_updated_at: '2026-09-22T00:00:00.000Z',
        questions: [
            {
                id: '2-1',
                label: '問1',
                type: 'selection',
                correctAnswer: 'ウ',
                points: 15,
                explanation: '大問2の問1初期解説です。',
                explanation_version: 1,
                explanation_updated_at: '2026-09-22T00:00:00.000Z'
            }
        ]
    }
];

const examId = 'waseda-commerce-2026-japanese';

// =========================================================================
// Test 1: 小問1問だけの更新で、他の小問や詳細解説・配点・正答が変わらない
// =========================================================================
console.log("\n[Test 1] Single Question Explanation Update");
const qExport = exportQuestionsCsv({ examId, structure: initialStructure });
const qRows = parseCsvText(qExport.content);
assert.strictEqual(qRows.length, 4, "Should have 1 header row + 3 question rows");

// Update only question 1-1 explanation in CSV
const modifiedCsvRows = [
    qRows[0].map(c => `"${c}"`).join(','),
    `"${examId}","1","1-1","第1問","問1","selection","ア","イ","部分点なし","10","更新された問1の解説です。","1","2026-09-22T00:00:00.000Z"`
];
const qPreview1 = previewImportQuestionsCsv({
    csvText: modifiedCsvRows.join('\r\n'),
    currentExamId: examId,
    currentStructure: initialStructure
});

assert.strictEqual(qPreview1.readyCount, 1);
assert.strictEqual(qPreview1.errorCount, 0);

const qApplied1 = applyImportQuestionsCsv({ previewResult: qPreview1, currentStructure: initialStructure });
assert.strictEqual(qApplied1.updatedCount, 1);

// Verify Question 1-1 updated
const updatedQ11 = qApplied1.newStructure[0].questions[0];
assert.strictEqual(updatedQ11.explanation, "更新された問1の解説です。");
assert.strictEqual(updatedQ11.explanation_version, 2, "Version bumped from 1 to 2");
assert.strictEqual(updatedQ11.points, 10, "Points must remain 10");
assert.strictEqual(updatedQ11.correctAnswer, 'ア', "Answer must remain 'ア'");

// Verify Question 1-2 UNCHANGED
const q12 = qApplied1.newStructure[0].questions[1];
assert.strictEqual(q12.explanation, "問2の初期解説です。");
assert.strictEqual(q12.explanation_version, 1);
assert.strictEqual(q12.points, 20);

// Verify Section Analysis UNCHANGED
assert.strictEqual(qApplied1.newStructure[0].sectionAnalysis, initialStructure[0].sectionAnalysis);
assert.strictEqual(qApplied1.newStructure[0].section_analysis_version, 1);

console.log("✓ Test 1 passed: Only targeted question updated, version bumped, others intact");

// =========================================================================
// Test 2: 大問1つだけの詳細解説更新で、小問解説・他の大問が変わらない
// =========================================================================
console.log("\n[Test 2] Single Section Detailed Analysis Update");
const sExport = exportSectionsAnalysisCsv({ examId, structure: initialStructure });
const sRows = parseCsvText(sExport.content);
assert.strictEqual(sRows.length, 3, "Should have 1 header row + 2 section rows");

const newAnalysisText = "# 大問1の完全解説\n\n1. 設問準備フェーズ\n本文の根拠と「引用符」、カンマを含む更新テキスト脈脈。";
const modifiedSecCsv = [
    sRows[0].map(c => `"${c}"`).join(','),
    `"${examId}","1","第1問","${newAnalysisText.replace(/"/g, '""')}","1","2026-09-22T00:00:00.000Z"`
];

const sPreview1 = previewImportSectionsAnalysisCsv({
    csvText: modifiedSecCsv.join('\r\n'),
    currentExamId: examId,
    currentStructure: initialStructure
});

assert.strictEqual(sPreview1.readyCount, 1);
assert.strictEqual(sPreview1.errorCount, 0);

const sApplied1 = applyImportSectionsAnalysisCsv({ previewResult: sPreview1, currentStructure: initialStructure });
assert.strictEqual(sApplied1.updatedCount, 1);

// Verify Section 1 updated
assert.strictEqual(sApplied1.newStructure[0].sectionAnalysis, newAnalysisText);
assert.strictEqual(sApplied1.newStructure[0].section_analysis_version, 2, "Section analysis version bumped to 2");

// Verify Section 2 UNCHANGED
assert.strictEqual(sApplied1.newStructure[1].sectionAnalysis, "大問2の詳細解説です。");
assert.strictEqual(sApplied1.newStructure[1].section_analysis_version, 1);

// Verify Questions in Section 1 UNCHANGED
assert.strictEqual(sApplied1.newStructure[0].questions[0].explanation, "問1の初期解説です。");
assert.strictEqual(sApplied1.newStructure[0].questions[0].explanation_version, 1);

console.log("✓ Test 2 passed: Only targeted section analysis updated, version bumped, questions intact");

// =========================================================================
// Test 3: 複数行・カンマ・引用符を含む長文が欠落せず往復できる（Round-trip）
// =========================================================================
console.log("\n[Test 3] Complex Text Round-Trip Guarantee");
const roundTripStruct = sApplied1.newStructure;
const exportedAgain = exportSectionsAnalysisCsv({ examId, structure: roundTripStruct });
const parsedAgain = parseCsvText(exportedAgain.content);
assert.strictEqual(parsedAgain[1][3], newAnalysisText, "Exported analysis text matches original complex text exactly");

// Re-importing exact same export should be detected as identical, skip, no version bump
const previewIdentical = previewImportSectionsAnalysisCsv({
    csvText: exportedAgain.content,
    currentExamId: examId,
    currentStructure: roundTripStruct
});
assert.strictEqual(previewIdentical.readyCount, 0, "No changes should be ready");
assert.strictEqual(previewIdentical.skipCount, 2, "Both sections should be skipped as identical");
assert.strictEqual(previewIdentical.errorCount, 0, "No errors");

console.log("✓ Test 3 passed: Complex multi-line / quote / comma markdown preserved identically & skipped on re-import");

// =========================================================================
// Test 4: 不明なID・重複ID・所属不一致・試験ID不一致の検出
// =========================================================================
console.log("\n[Test 4] Validation of unknown IDs, duplicates, and mismatches");
const badCsvRows = [
    sRows[0].map(c => `"${c}"`).join(','),
    // Row 1: Duplicate ID
    `"${examId}","1","第1問","解説A","1",""`,
    `"${examId}","1","第1問","解説B","1",""`,
    // Row 3: Unknown section ID
    `"${examId}","99","第99問","解説C","1",""`,
    // Row 4: Exam ID mismatch
    `"other-exam-id","2","第2問","解説D","1",""`
];

const badPreview = previewImportSectionsAnalysisCsv({
    csvText: badCsvRows.join('\r\n'),
    currentExamId: examId,
    currentStructure: initialStructure
});

assert.strictEqual(badPreview.errorCount, 3, "Should detect 3 errors");
assert(badPreview.errors.some(e => e.includes('重複ID')), "Should report duplicate ID");
assert(badPreview.errors.some(e => e.includes('存在しない大問ID')), "Should report non-existent ID");
assert(badPreview.errors.some(e => e.includes('試験ID不一致')), "Should report exam ID mismatch");

console.log("✓ Test 4 passed: Detected duplicate IDs, unknown IDs, and exam ID mismatches");

// =========================================================================
// Test 5: 空欄やCSVに存在しない行によって既存データが消えない
// =========================================================================
console.log("\n[Test 5] Empty fields and missing rows preservation");
const emptyFieldCsv = [
    qRows[0].map(c => `"${c}"`).join(','),
    // Only question 1-1 with empty explanation
    `"${examId}","1","1-1","第1問","問1","selection","ア","イ","部分点なし","10","","1",""`
];

const emptyPreview = previewImportQuestionsCsv({
    csvText: emptyFieldCsv.join('\r\n'),
    currentExamId: examId,
    currentStructure: initialStructure
});

assert.strictEqual(emptyPreview.readyCount, 0);
assert.strictEqual(emptyPreview.skipCount, 1);
assert.strictEqual(emptyPreview.items[0].status, 'skip');

console.log("✓ Test 5 passed: Empty explanation in CSV skipped without erasing existing data");

// =========================================================================
// Test 6: 解説バージョンの整合性（競合検知）
// =========================================================================
console.log("\n[Test 6] Version Conflict Detection");
// Try importing with old version (v1) when system is already at v2
const conflictCsv = [
    qRows[0].map(c => `"${c}"`).join(','),
    `"${examId}","1","1-1","第1問","問1","selection","ア","イ","部分点なし","10","競合する新解説","1",""`
];

const conflictPreview = previewImportQuestionsCsv({
    csvText: conflictCsv.join('\r\n'),
    currentExamId: examId,
    currentStructure: qApplied1.newStructure // Question 1-1 is already at v2!
});

assert.strictEqual(conflictPreview.errorCount, 1);
assert(conflictPreview.errors[0].includes('エクスポート後に解説が更新されています'), "Should detect stale export version");

console.log("✓ Test 6 passed: Stale export version correctly flagged as conflict error");

console.log("\n ALL 6 EXAM CSV SERVICE TESTS PASSED SUCCESSFULLY! 🎉\n");
