/**
 * Exam CSV Service
 * 
 * 外部AIとの連携用CSV（小問解説CSV・大問詳細解説CSV）のエクスポート・インポートおよびバージョン管理
 */

// CSVヘッダー定義（エクスポート時に使用）
export const QUESTION_CSV_HEADERS = [
    { key: 'exam_id', label: '試験ID' },
    { key: 'section_id', label: '大問ID' },
    { key: 'question_id', label: '小問ID' },
    { key: 'section_label', label: '表示用大問番号' },
    { key: 'question_label', label: '表示用小問番号' },
    { key: 'question_type', label: '問題形式' },
    { key: 'correct_answer', label: '正答' },
    { key: 'alternative_answers', label: '別解' },
    { key: 'grading_instructions', label: '採点指示' },
    { key: 'points', label: '配点' },
    { key: 'explanation', label: '小問解説' },
    { key: 'explanation_version', label: '解説バージョン' },
    { key: 'explanation_updated_at', label: '解説更新日時' }
];

export const SECTION_CSV_HEADERS = [
    { key: 'exam_id', label: '試験ID' },
    { key: 'section_id', label: '大問ID' },
    { key: 'section_label', label: '表示用大問番号' },
    { key: 'section_analysis', label: '大問詳細解説' },
    { key: 'section_analysis_version', label: '解説バージョン' },
    { key: 'section_analysis_updated_at', label: '解説更新日時' }
];

/**
 * RFC 4180 準拠のCSVセルエスケープ
 * - カンマ、改行、ダブルクォートを含む場合はダブルクォートで囲み、内部の " は "" に変換
 */
export const escapeCsvCell = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val);
    return `"${str.replace(/"/g, '""')}"`;
};

/**
 * RFC 4180 準拠のCSVパーサー
 * - 改行、カンマ、ダブルクォート、UTF-8 BOM、Markdownを完全に保持
 */
export const parseCsvText = (text) => {
    const rows = [];
    let curRow = [];
    let curCell = '';
    let inQuote = false;

    const cleanText = String(text || '').replace(/^\uFEFF/, '');

    for (let i = 0; i < cleanText.length; i++) {
        const ch = cleanText[i];
        const next = cleanText[i + 1];

        if (ch === '"') {
            if (inQuote && next === '"') {
                curCell += '"';
                i++;
            } else {
                inQuote = !inQuote;
            }
        } else if (ch === ',' && !inQuote) {
            curRow.push(curCell);
            curCell = '';
        } else if ((ch === '\r' || ch === '\n') && !inQuote) {
            if (ch === '\r' && next === '\n') i++;
            curRow.push(curCell);
            if (curRow.some(c => c.trim() !== '')) {
                rows.push(curRow);
            }
            curRow = [];
            curCell = '';
        } else {
            curCell += ch;
        }
    }
    if (curCell !== '' || curRow.length > 0) {
        curRow.push(curCell);
        if (curRow.some(c => c.trim() !== '')) {
            rows.push(curRow);
        }
    }
    return rows;
};

/**
 * ヘッダー行からカラムインデックスを柔軟に解決（英字・日本語対応）
 */
const resolveHeaderMap = (headerRow) => {
    const normalized = headerRow.map(h => String(h || '').trim().toLowerCase().replace(/[\s_・]/g, ''));
    const getIndex = (candidateKeywords) => {
        return normalized.findIndex(h => candidateKeywords.some(kw => {
            const cleanKw = kw.toLowerCase().replace(/[\s_・]/g, '');
            return h === cleanKw || h.includes(cleanKw);
        }));
    };
    return { getIndex };
};

/**
 * 文字列の同一性判定（改行コードの正規化）
 */
const isTextContentEqual = (textA, textB) => {
    const normalize = (t) => String(t || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    return normalize(textA) === normalize(textB);
};

// ==============================================================================
// 1. 小問解説CSV (Question Explanation CSV)
// ==============================================================================

/**
 * 小問解説CSVのエクスポート
 */
export const exportQuestionsCsv = ({ examId, structure = [], university = '', faculty = '', year = '', subject = '' }) => {
    const headers = QUESTION_CSV_HEADERS.map(h => h.key);
    const rows = [];

    (structure || []).forEach(section => {
        const secId = String(section.id || '');
        const secLabel = section.label || `第${secId}問`;

        (section.questions || []).forEach((q) => {
            const qId = String(q.id || '');
            const qLabel = q.label || qId;
            const qType = q.type || 'selection';
            const correctAnswer = q.correctAnswer ?? q.answer ?? '';
            const altAnswers = Array.isArray(q.alternativeAnswers) ? q.alternativeAnswers.join('|') : (q.alternativeAnswers || '');
            const gradingInstructions = q.gradingInstruction || '';
            const points = q.points ?? '';
            const explanation = q.explanation || '';
            const version = q.explanation_version || q.explanationVersion || 1;
            const updatedAt = q.explanation_updated_at || q.explanationUpdatedAt || '';

            rows.push([
                examId || '',
                secId,
                qId,
                secLabel,
                qLabel,
                qType,
                correctAnswer,
                altAnswers,
                gradingInstructions,
                points,
                explanation,
                version,
                updatedAt
            ]);
        });
    });

    const csvContent = [
        headers.map(escapeCsvCell).join(','),
        ...rows.map(row => row.map(escapeCsvCell).join(','))
    ].join('\r\n');

    const cleanUni = (university || '').replace(/[\\/:*?"<>|]/g, '_');
    const cleanFac = (faculty || '').replace(/[\\/:*?"<>|]/g, '_');
    const cleanYear = year ? `${year}年度_` : '';
    const cleanSub = (subject || '').replace(/[\\/:*?"<>|]/g, '_');
    const filename = `${cleanUni}_${cleanFac}_${cleanYear}${cleanSub}_小問解説.csv`.replace(/^_+|_+$/g, '');

    return {
        filename: filename || 'questions_explanations.csv',
        content: csvContent,
        blob: new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    };
};

/**
 * 小問解説CSVの取り込み前検証（プレビュー）
 */
export const previewImportQuestionsCsv = ({ csvText, currentExamId, currentStructure = [] }) => {
    const rows = parseCsvText(csvText);
    if (rows.length < 2) {
        throw new Error('CSVデータが空か、有効なデータ行が存在しません。');
    }

    const { getIndex } = resolveHeaderMap(rows[0]);
    const examIdIdx = getIndex(['examid', '試験id', 'exam']);
    const secIdIdx = getIndex(['sectionid', '大問id', 'section']);
    const qIdIdx = getIndex(['questionid', '小問id', '問題id', 'question']);
    const expIdx = getIndex(['explanation', '小問解説', '解説']);
    const verIdx = getIndex(['explanationversion', '解説バージョン', 'バージョン', 'version']);
    const updatedIdx = getIndex(['explanationupdatedat', '解説更新日時', '更新日時', 'updatedat']);

    if (secIdIdx === -1 || qIdIdx === -1 || expIdx === -1) {
        throw new Error('CSVに必要な列（大問ID / section_id、小問ID / question_id、小問解説 / explanation）が見つかりません。');
    }

    // 現在の小問マップを作成: `${secId}__${qId}` -> { question, section }
    const currentQuestionMap = new Map();
    const currentSectionSet = new Set();
    currentStructure.forEach(sec => {
        const secId = String(sec.id || '');
        currentSectionSet.add(secId);
        (sec.questions || []).forEach(q => {
            const qId = String(q.id || '');
            currentQuestionMap.set(`${secId}__${qId}`, {
                section: sec,
                question: q
            });
        });
    });

    const items = [];
    const seenQuestionIds = new Set();
    let readyCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    const errors = [];

    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const rowNum = r + 1;
        const rowExamId = examIdIdx !== -1 ? String(row[examIdIdx] || '').trim() : '';
        const secId = String(row[secIdIdx] || '').trim();
        const qId = String(row[qIdIdx] || '').trim();
        const csvExplanation = String(row[expIdx] || '').trim();
        const rawCsvVersion = verIdx !== -1 ? String(row[verIdx] || '').trim() : '';
        const csvVersion = rawCsvVersion ? parseInt(rawCsvVersion, 10) : null;
        const csvUpdatedAt = updatedIdx !== -1 ? String(row[updatedIdx] || '').trim() : '';

        // 行全体の空行判定
        if (!secId && !qId && !csvExplanation) continue;

        const item = {
            rowNum,
            examId: rowExamId,
            sectionId: secId,
            questionId: qId,
            status: 'pending', // 'ready' | 'skip' | 'error'
            reason: '',
            beforeExplanation: '',
            afterExplanation: csvExplanation,
            currentVersion: 1,
            csvVersion: csvVersion || 1,
            nextVersion: 1,
            currentUpdatedAt: ''
        };

        // 1. 試験IDの検証（指定されている場合）
        if (rowExamId && currentExamId && rowExamId !== currentExamId) {
            item.status = 'error';
            item.reason = `試験ID不一致（CSV: "${rowExamId}", 対象: "${currentExamId}"）`;
            errorCount++;
            errors.push(`行 ${rowNum}: ${item.reason}`);
            items.push(item);
            continue;
        }

        // 2. IDの存在・重複検証
        if (!secId || !qId) {
            item.status = 'error';
            item.reason = '大問IDまたは小問IDが空欄です';
            errorCount++;
            errors.push(`行 ${rowNum}: ${item.reason}`);
            items.push(item);
            continue;
        }

        const key = `${secId}__${qId}`;
        if (seenQuestionIds.has(key)) {
            item.status = 'error';
            item.reason = `重複ID: 大問 "${secId}" の小問 "${qId}" がCSV内に複数行存在します`;
            errorCount++;
            errors.push(`行 ${rowNum}: ${item.reason}`);
            items.push(item);
            continue;
        }
        seenQuestionIds.add(key);

        const found = currentQuestionMap.get(key);
        if (!found) {
            item.status = 'error';
            if (!currentSectionSet.has(secId)) {
                item.reason = `存在しない大問ID: "${secId}"（所属不一致・新規自動追加は禁止されています）`;
            } else {
                item.reason = `大問 "${secId}" 内に存在しない小問ID: "${qId}"（新規自動追加は禁止されています）`;
            }
            errorCount++;
            errors.push(`行 ${rowNum}: ${item.reason}`);
            items.push(item);
            continue;
        }

        const currentQ = found.question;
        const currentVersion = currentQ.explanation_version || currentQ.explanationVersion || 1;
        const currentExplanation = currentQ.explanation || '';
        item.beforeExplanation = currentExplanation;
        item.currentVersion = currentVersion;
        item.currentUpdatedAt = currentQ.explanation_updated_at || currentQ.explanationUpdatedAt || '';

        // 3. 解説バージョンの整合性チェック
        if (csvVersion !== null && !isNaN(csvVersion) && csvVersion !== currentVersion) {
            item.status = 'error';
            item.reason = `エクスポート後に解説が更新されています（CSV: v${csvVersion}, 現在のシステム: v${currentVersion}）`;
            errorCount++;
            errors.push(`行 ${rowNum} [${secId}-${qId}]: ${item.reason}`);
            items.push(item);
            continue;
        }

        // 4. 内容変更の検証
        if (!csvExplanation) {
            item.status = 'skip';
            item.reason = 'CSVの解説が空欄のため更新をスキップ（既存解説を保持）';
            skipCount++;
            items.push(item);
            continue;
        }

        if (isTextContentEqual(currentExplanation, csvExplanation)) {
            item.status = 'skip';
            item.reason = '既存の小問解説と同一内容のためスキップ（バージョン維持）';
            skipCount++;
            items.push(item);
            continue;
        }

        // 5. 更新対象
        item.status = 'ready';
        item.nextVersion = currentVersion + 1;
        item.reason = `更新可能（v${currentVersion} → v${item.nextVersion}）`;
        readyCount++;
        items.push(item);
    }

    return {
        type: 'question',
        totalRows: items.length,
        readyCount,
        skipCount,
        errorCount,
        items,
        errors,
        canApply: readyCount > 0
    };
};

/**
 * 検証済み小問解説の適用
 */
export const applyImportQuestionsCsv = ({ previewResult, currentStructure = [] }) => {
    if (!previewResult || previewResult.type !== 'question') {
        throw new Error('無効な小問解説プレビュー結果です。');
    }

    // 更新マップを作成: `${secId}__${qId}` -> item
    const updateMap = new Map();
    previewResult.items.forEach(item => {
        if (item.status === 'ready') {
            updateMap.set(`${item.sectionId}__${item.questionId}`, item);
        }
    });

    const now = new Date().toISOString();
    let updatedCount = 0;

    const newStructure = (currentStructure || []).map(section => {
        const secId = String(section.id || '');
        return {
            ...section,
            questions: (section.questions || []).map(q => {
                const qId = String(q.id || '');
                const updateItem = updateMap.get(`${secId}__${qId}`);
                if (updateItem) {
                    updatedCount++;
                    return {
                        ...q,
                        explanation: updateItem.afterExplanation,
                        explanation_version: updateItem.nextVersion,
                        explanation_updated_at: now
                    };
                }
                return q;
            })
        };
    });

    return {
        newStructure,
        updatedCount,
        skippedCount: previewResult.skipCount,
        errorCount: previewResult.errorCount
    };
};

// ==============================================================================
// 2. 大問詳細解説CSV (Section Detailed Analysis CSV)
// ==============================================================================

/**
 * 大問詳細解説CSVのエクスポート
 */
export const exportSectionsAnalysisCsv = ({ examId, structure = [], university = '', faculty = '', year = '', subject = '' }) => {
    const headers = SECTION_CSV_HEADERS.map(h => h.key);
    const rows = [];

    (structure || []).forEach(section => {
        const secId = String(section.id || '');
        const secLabel = section.label || `第${secId}問`;
        const sectionAnalysis = section.sectionAnalysis || '';
        const version = section.section_analysis_version || section.sectionAnalysisVersion || 1;
        const updatedAt = section.section_analysis_updated_at || section.sectionAnalysisUpdatedAt || '';

        rows.push([
            examId || '',
            secId,
            secLabel,
            sectionAnalysis,
            version,
            updatedAt
        ]);
    });

    const csvContent = [
        headers.map(escapeCsvCell).join(','),
        ...rows.map(row => row.map(escapeCsvCell).join(','))
    ].join('\r\n');

    const cleanUni = (university || '').replace(/[\\/:*?"<>|]/g, '_');
    const cleanFac = (faculty || '').replace(/[\\/:*?"<>|]/g, '_');
    const cleanYear = year ? `${year}年度_` : '';
    const cleanSub = (subject || '').replace(/[\\/:*?"<>|]/g, '_');
    const filename = `${cleanUni}_${cleanFac}_${cleanYear}${cleanSub}_大問詳細解説.csv`.replace(/^_+|_+$/g, '');

    return {
        filename: filename || 'sections_analysis.csv',
        content: csvContent,
        blob: new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    };
};

/**
 * 大問詳細解説CSVの取り込み前検証（プレビュー）
 */
export const previewImportSectionsAnalysisCsv = ({ csvText, currentExamId, currentStructure = [] }) => {
    const rows = parseCsvText(csvText);
    if (rows.length < 2) {
        throw new Error('CSVデータが空か、有効なデータ行が存在しません。');
    }

    const { getIndex } = resolveHeaderMap(rows[0]);
    const examIdIdx = getIndex(['examid', '試験id', 'exam']);
    const secIdIdx = getIndex(['sectionid', '大問id', 'section']);
    const analysisIdx = getIndex(['sectionanalysis', '大問詳細解説', '詳細解説', '大問解説', '大問総評', 'analysis']);
    const verIdx = getIndex(['sectionanalysisversion', 'analysisversion', '解説バージョン', 'バージョン', 'version']);
    const updatedIdx = getIndex(['sectionanalysisupdatedat', 'analysisupdatedat', '解説更新日時', '更新日時', 'updatedat']);

    if (secIdIdx === -1 || analysisIdx === -1) {
        throw new Error('CSVに必要な列（大問ID / section_id、大問詳細解説 / section_analysis）が見つかりません。');
    }

    // 現在の大問マップを作成: secId -> section
    const currentSectionMap = new Map();
    currentStructure.forEach(sec => {
        const secId = String(sec.id || '');
        currentSectionMap.set(secId, sec);
    });

    const items = [];
    const seenSectionIds = new Set();
    let readyCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    const errors = [];

    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const rowNum = r + 1;
        const rowExamId = examIdIdx !== -1 ? String(row[examIdIdx] || '').trim() : '';
        const secId = String(row[secIdIdx] || '').trim();
        const csvAnalysis = String(row[analysisIdx] || '').trim();
        const rawCsvVersion = verIdx !== -1 ? String(row[verIdx] || '').trim() : '';
        const csvVersion = rawCsvVersion ? parseInt(rawCsvVersion, 10) : null;
        const csvUpdatedAt = updatedIdx !== -1 ? String(row[updatedIdx] || '').trim() : '';

        // 空行判定
        if (!secId && !csvAnalysis) continue;

        const item = {
            rowNum,
            examId: rowExamId,
            sectionId: secId,
            status: 'pending',
            reason: '',
            beforeAnalysis: '',
            afterAnalysis: csvAnalysis,
            currentVersion: 1,
            csvVersion: csvVersion || 1,
            nextVersion: 1,
            currentUpdatedAt: ''
        };

        // 1. 試験IDの検証
        if (rowExamId && currentExamId && rowExamId !== currentExamId) {
            item.status = 'error';
            item.reason = `試験ID不一致（CSV: "${rowExamId}", 対象: "${currentExamId}"）`;
            errorCount++;
            errors.push(`行 ${rowNum}: ${item.reason}`);
            items.push(item);
            continue;
        }

        // 2. 大問IDの存在・重複検証
        if (!secId) {
            item.status = 'error';
            item.reason = '大問IDが空欄です';
            errorCount++;
            errors.push(`行 ${rowNum}: ${item.reason}`);
            items.push(item);
            continue;
        }

        if (seenSectionIds.has(secId)) {
            item.status = 'error';
            item.reason = `重複ID: 大問 "${secId}" がCSV内に複数行存在します`;
            errorCount++;
            errors.push(`行 ${rowNum}: ${item.reason}`);
            items.push(item);
            continue;
        }
        seenSectionIds.add(secId);

        const currentSec = currentSectionMap.get(secId);
        if (!currentSec) {
            item.status = 'error';
            item.reason = `存在しない大問ID: "${secId}"（新規大問の自動追加は禁止されています）`;
            errorCount++;
            errors.push(`行 ${rowNum}: ${item.reason}`);
            items.push(item);
            continue;
        }

        const currentVersion = currentSec.section_analysis_version || currentSec.sectionAnalysisVersion || 1;
        const currentAnalysis = currentSec.sectionAnalysis || '';
        item.beforeAnalysis = currentAnalysis;
        item.currentVersion = currentVersion;
        item.currentUpdatedAt = currentSec.section_analysis_updated_at || currentSec.sectionAnalysisUpdatedAt || '';

        // 3. バージョン整合性チェック
        if (csvVersion !== null && !isNaN(csvVersion) && csvVersion !== currentVersion) {
            item.status = 'error';
            item.reason = `エクスポート後に解説が更新されています（CSV: v${csvVersion}, 現在のシステム: v${currentVersion}）`;
            errorCount++;
            errors.push(`行 ${rowNum} [大問 ${secId}]: ${item.reason}`);
            items.push(item);
            continue;
        }

        // 4. 内容変更の検証
        if (!csvAnalysis) {
            item.status = 'skip';
            item.reason = 'CSVの詳細解説が空欄のため更新をスキップ（既存解説を保持）';
            skipCount++;
            items.push(item);
            continue;
        }

        if (isTextContentEqual(currentAnalysis, csvAnalysis)) {
            item.status = 'skip';
            item.reason = '既存の大問詳細解説と同一内容のためスキップ（バージョン維持）';
            skipCount++;
            items.push(item);
            continue;
        }

        // 5. 更新対象
        item.status = 'ready';
        item.nextVersion = currentVersion + 1;
        item.reason = `更新可能（v${currentVersion} → v${item.nextVersion}）`;
        readyCount++;
        items.push(item);
    }

    return {
        type: 'section',
        totalRows: items.length,
        readyCount,
        skipCount,
        errorCount,
        items,
        errors,
        canApply: readyCount > 0
    };
};

/**
 * 検証済み大問詳細解説の適用
 */
export const applyImportSectionsAnalysisCsv = ({ previewResult, currentStructure = [] }) => {
    if (!previewResult || previewResult.type !== 'section') {
        throw new Error('無効な大問詳細解説プレビュー結果です。');
    }

    const updateMap = new Map();
    previewResult.items.forEach(item => {
        if (item.status === 'ready') {
            updateMap.set(item.sectionId, item);
        }
    });

    const now = new Date().toISOString();
    let updatedCount = 0;

    const newStructure = (currentStructure || []).map(section => {
        const secId = String(section.id || '');
        const updateItem = updateMap.get(secId);
        if (updateItem) {
            updatedCount++;
            return {
                ...section,
                sectionAnalysis: updateItem.afterAnalysis,
                section_analysis_version: updateItem.nextVersion,
                section_analysis_updated_at: now
            };
        }
        return section;
    });

    return {
        newStructure,
        updatedCount,
        skippedCount: previewResult.skipCount,
        errorCount: previewResult.errorCount
    };
};
