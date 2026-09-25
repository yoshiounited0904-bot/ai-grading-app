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

/**
 * 試験IDの整合性検証（柔軟マッチング）
 */
const isExamIdMatching = (rowExamId, currentExamId, examObj = {}) => {
    if (!rowExamId || !currentExamId) return true;
    const cleanRow = String(rowExamId).trim().toLowerCase().replace(/[\s_-]/g, '');
    const cleanCurrent = String(currentExamId).trim().toLowerCase().replace(/[\s_-]/g, '');
    if (cleanRow === cleanCurrent) return true;

    // 大学名・学部・年度・科目の連結文字列との部分一致検証
    const uni = String(examObj.university || '').trim();
    const fac = String(examObj.faculty || '').trim();
    const yr = String(examObj.year || '').trim();
    const sub = String(examObj.subject || '').trim();
    if (uni || fac || yr || sub) {
        const normalizeStr = (s) => String(s || '').toLowerCase().replace(/[\s_・\-年度]/g, '');
        const normRow = normalizeStr(rowExamId);
        const joinedName = normalizeStr([uni, fac, yr, sub].filter(Boolean).join(''));
        if (normRow.includes(joinedName) || joinedName.includes(normRow)) {
            return true;
        }
        if (uni && fac && normRow.includes(normalizeStr(uni)) && normRow.includes(normalizeStr(fac))) {
            return true;
        }
    }

    return false;
};

// ==============================================================================
// 1. 小問解説CSV (Question Explanation CSV)
// ==============================================================================

/**
 * 小問解説CSVのエクスポート
 */
export const exportQuestionsCsv = (params = {}) => {
    const {
        examId: rawExamId,
        id: rawId,
        structure = [],
        university = '',
        faculty = '',
        year = '',
        subject = ''
    } = params;

    const cleanUni = (university || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    const cleanFac = (faculty || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    const cleanYear = year ? (String(year).endsWith('年度') ? String(year) : `${year}年度`) : '';
    const cleanSub = (subject || '').replace(/[\\/:*?"<>|]/g, '_').trim();

    // A2セル（1行目のデータ行）をはじめ、全データ行の第1列（exam_id）に出力する識別用の試験ID
    const fallbackExamId = [cleanUni, cleanFac, cleanYear, cleanSub].filter(Boolean).join('_') || 'exam';
    const examId = String(rawExamId || rawId || fallbackExamId).trim();

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
                examId,
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

    const nameParts = [cleanUni || '大学', cleanFac || '学部', cleanYear, cleanSub || '科目'].filter(Boolean);
    const filename = `${nameParts.join('_')}_小問解説.csv`;

    return {
        filename: filename || 'questions_explanations.csv',
        content: csvContent,
        blob: new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    };
};

/**
 * IDの正規化（表記揺れ吸収：全角半角、記号、第X問、問Xなど）
 */
const normalizeId = (val) => {
    return String(val || '')
        .trim()
        .toLowerCase()
        .replace(/[第問大問（）\(\)\[\]【】\s_-]/g, '')
        .replace(/^[ivxlcdm]+/i, (match) => {
            const romanMap = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
            return romanMap[match.toLowerCase()] || match;
        });
};

/**
 * 小問解説CSVの取り込み前検証（プレビュー）
 */
export const previewImportQuestionsCsv = (arg1, arg2) => {
    let csvText = '';
    let currentExamId = '';
    let currentStructure = [];
    let examObj = {};

    if (typeof arg1 === 'object' && arg1 !== null && !Array.isArray(arg1) && arg1.csvText !== undefined) {
        csvText = arg1.csvText || '';
        examObj = arg1;
        currentExamId = arg1.currentExamId || arg1.examId || arg1.id || '';
        currentStructure = arg1.currentStructure || arg1.structure || [];
    } else {
        csvText = typeof arg1 === 'string' ? arg1 : '';
        examObj = (typeof arg2 === 'object' && arg2 !== null) ? arg2 : {};
        currentExamId = examObj.examId || examObj.id || (typeof arg2 === 'string' ? arg2 : '');
        currentStructure = examObj.structure || (Array.isArray(arg2) ? arg2 : []);
    }

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
        throw new Error('CSVに必要な列（大問ID / section_id、小問ID / question_id、小問解説 / explanation）が見つかりません。ヘッダー名をご確認ください。');
    }

    // 現在の小問マップを作成（完全一致用 + 正規化キー用）
    const currentQuestionMap = new Map();
    const currentSectionSet = new Set();
    currentStructure.forEach(sec => {
        const secId = String(sec.id || '');
        currentSectionSet.add(secId);
        currentSectionSet.add(normalizeId(secId));
        if (sec.label) currentSectionSet.add(normalizeId(sec.label));

        (sec.questions || []).forEach(q => {
            const qId = String(q.id || '');
            const info = { section: sec, question: q, exactKey: `${secId}__${qId}` };
            
            // 登録可能な全キーパターン
            const keysToRegister = new Set([
                `${secId}__${qId}`,
                `${normalizeId(secId)}__${normalizeId(qId)}`,
            ]);

            // ハイフン分割（例: 1-1 -> 1）
            if (qId.includes('-')) {
                const subPart = qId.split('-').pop();
                keysToRegister.add(`${normalizeId(secId)}__${normalizeId(subPart)}`);
            }
            // ラベル対応（例: 問1 -> 1）
            if (q.label) {
                keysToRegister.add(`${normalizeId(secId)}__${normalizeId(q.label)}`);
            }

            keysToRegister.forEach(k => {
                if (!currentQuestionMap.has(k)) {
                    currentQuestionMap.set(k, info);
                }
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
        if (rowExamId && currentExamId && !isExamIdMatching(rowExamId, currentExamId, examObj)) {
            item.status = 'error';
            item.reason = `試験ID不一致（CSV: "${rowExamId}", 対象: "${currentExamId}"）`;
            errorCount++;
            errors.push(`行 ${rowNum}: ${item.reason}`);
            items.push(item);
            continue;
        } else if (rowExamId && currentExamId && rowExamId !== currentExamId) {
            item.warning = `試験IDの表記が異なります（CSV: "${rowExamId}", 対象: "${currentExamId}"）`;
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
        const fuzzyKey = `${normalizeId(secId)}__${normalizeId(qId)}`;
        const subPart = qId.includes('-') ? qId.split('-').pop() : '';
        const subKey = subPart ? `${normalizeId(secId)}__${normalizeId(subPart)}` : '';

        const found = currentQuestionMap.get(key) || currentQuestionMap.get(fuzzyKey) || (subKey ? currentQuestionMap.get(subKey) : null);
        if (!found) {
            item.status = 'error';
            if (!currentSectionSet.has(secId) && !currentSectionSet.has(normalizeId(secId))) {
                item.reason = `存在しない大問ID: "${secId}"（所属不一致・新規自動追加は禁止されています）`;
            } else {
                item.reason = `大問 "${secId}" 内に存在しない小問ID: "${qId}"（新規自動追加は禁止されています）`;
            }
            errorCount++;
            errors.push(`行 ${rowNum}: ${item.reason}`);
            items.push(item);
            continue;
        }

        if (seenQuestionIds.has(found.exactKey)) {
            item.status = 'error';
            item.reason = `重複ID: 大問 "${secId}" の小問 "${qId}"（対象: ${found.exactKey}）がCSV内に複数行存在します`;
            errorCount++;
            errors.push(`行 ${rowNum}: ${item.reason}`);
            items.push(item);
            continue;
        }
        seenQuestionIds.add(found.exactKey);

        // 正確な内部IDを記録
        item.exactSectionId = String(found.section.id || '');
        item.exactQuestionId = String(found.question.id || '');

        const currentQ = found.question;
        const currentVersion = currentQ.explanation_version || currentQ.explanationVersion || 1;
        const currentExplanation = currentQ.explanation || '';
        item.beforeExplanation = currentExplanation;
        item.currentVersion = currentVersion;
        item.currentUpdatedAt = currentQ.explanation_updated_at || currentQ.explanationUpdatedAt || '';

        // 3. バージョン番号は読み込まずに無視（ナンバリングされた既存CSVもエラーなく取り込む）
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
            item.reason = '既存の小問解説と同一内容のためスキップ（内容変更なし）';
            skipCount++;
            items.push(item);
            continue;
        }

        // 5. 更新対象（バージョン自動繰り上げは行わず、解説内容のみを更新）
        item.status = 'ready';
        item.nextVersion = currentVersion;
        item.reason = '更新可能（小問解説を反映）';
        readyCount++;
        items.push(item);
    }

    return {
        type: 'question',
        totalRows: items.length,
        readyCount,
        skipCount,
        errorCount,
        summary: {
            updateCount: readyCount,
            skipCount,
            errorCount,
            totalRows: items.length
        },
        items,
        errors,
        canApply: readyCount > 0
    };
};

/**
 * 検証済み小問解説の適用
 */
export const applyImportQuestionsCsv = (arg1, arg2) => {
    let previewResult;
    let currentStructure = [];
    let currentExam = {};

    if (typeof arg1 === 'object' && arg1 !== null && arg1.previewResult !== undefined) {
        previewResult = arg1.previewResult;
        currentStructure = arg1.currentStructure || arg1.structure || [];
        currentExam = arg1.currentExam || {};
    } else {
        previewResult = arg1;
        if (typeof arg2 === 'object' && arg2 !== null) {
            currentExam = arg2;
            currentStructure = arg2.structure || (Array.isArray(arg2) ? arg2 : []);
        }
    }

    if (!previewResult || previewResult.type !== 'question') {
        throw new Error('無効な小問解説プレビュー結果です。');
    }

    // 更新マップを作成: `${secId}__${qId}` -> item
    const updateMap = new Map();
    previewResult.items.forEach(item => {
        if (item.status === 'ready') {
            const targetSec = item.exactSectionId || item.sectionId;
            const targetQ = item.exactQuestionId || item.questionId;
            updateMap.set(`${targetSec}__${targetQ}`, item);
            updateMap.set(`${normalizeId(targetSec)}__${normalizeId(targetQ)}`, item);
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
                const updateItem = updateMap.get(`${secId}__${qId}`) || updateMap.get(`${normalizeId(secId)}__${normalizeId(qId)}`);
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

    const nextExamData = {
        ...currentExam,
        structure: newStructure
    };

    return {
        newStructure,
        nextExamData,
        updatedCount,
        skippedCount: previewResult.skipCount,
        errorCount: previewResult.errorCount,
        stats: {
            updatedCount,
            skippedCount: previewResult.skipCount,
            errorCount: previewResult.errorCount
        }
    };
};

// ==============================================================================
// 2. 大問詳細解説CSV (Section Detailed Analysis CSV)
// ==============================================================================

/**
 * 大問詳細解説CSVのエクスポート
 */
export const exportSectionsAnalysisCsv = (params = {}) => {
    const {
        examId: rawExamId,
        id: rawId,
        structure = [],
        university = '',
        faculty = '',
        year = '',
        subject = ''
    } = params;

    const cleanUni = (university || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    const cleanFac = (faculty || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    const cleanYear = year ? (String(year).endsWith('年度') ? String(year) : `${year}年度`) : '';
    const cleanSub = (subject || '').replace(/[\\/:*?"<>|]/g, '_').trim();

    // A2セル（1行目のデータ行）をはじめ、全データ行の第1列（exam_id）に出力する識別用の試験ID
    const fallbackExamId = [cleanUni, cleanFac, cleanYear, cleanSub].filter(Boolean).join('_') || 'exam';
    const examId = String(rawExamId || rawId || fallbackExamId).trim();

    const headers = SECTION_CSV_HEADERS.map(h => h.key);
    const rows = [];

    (structure || []).forEach(section => {
        const secId = String(section.id || '');
        const secLabel = section.label || `第${secId}問`;
        const sectionAnalysis = section.sectionAnalysis || '';
        const version = section.section_analysis_version || section.sectionAnalysisVersion || 1;
        const updatedAt = section.section_analysis_updated_at || section.sectionAnalysisUpdatedAt || '';

        rows.push([
            examId,
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

    const nameParts = [cleanUni || '大学', cleanFac || '学部', cleanYear, cleanSub || '科目'].filter(Boolean);
    const filename = `${nameParts.join('_')}_大問詳細解説.csv`;

    return {
        filename: filename || 'sections_analysis.csv',
        content: csvContent,
        blob: new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    };
};

/**
 * 大問詳細解説CSVの取り込み前検証（プレビュー）
 */
export const previewImportSectionsAnalysisCsv = (arg1, arg2) => {
    let csvText = '';
    let currentExamId = '';
    let currentStructure = [];
    let examObj = {};

    if (typeof arg1 === 'object' && arg1 !== null && !Array.isArray(arg1) && arg1.csvText !== undefined) {
        csvText = arg1.csvText || '';
        examObj = arg1;
        currentExamId = arg1.currentExamId || arg1.examId || arg1.id || '';
        currentStructure = arg1.currentStructure || arg1.structure || [];
    } else {
        csvText = typeof arg1 === 'string' ? arg1 : '';
        examObj = (typeof arg2 === 'object' && arg2 !== null) ? arg2 : {};
        currentExamId = examObj.examId || examObj.id || (typeof arg2 === 'string' ? arg2 : '');
        currentStructure = examObj.structure || (Array.isArray(arg2) ? arg2 : []);
    }

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

    // 現在の大問マップを作成: secId -> section（完全一致用 + 正規化キー用）
    const currentSectionMap = new Map();
    currentStructure.forEach(sec => {
        const secId = String(sec.id || '');
        currentSectionMap.set(secId, sec);
        if (!currentSectionMap.has(normalizeId(secId))) {
            currentSectionMap.set(normalizeId(secId), sec);
        }
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

        // 1. 試験IDの検証（指定されている場合）
        if (rowExamId && currentExamId && !isExamIdMatching(rowExamId, currentExamId, examObj)) {
            item.status = 'error';
            item.reason = `試験ID不一致（CSV: "${rowExamId}", 対象: "${currentExamId}"）`;
            errorCount++;
            errors.push(`行 ${rowNum}: ${item.reason}`);
            items.push(item);
            continue;
        } else if (rowExamId && currentExamId && rowExamId !== currentExamId) {
            item.warning = `試験IDの表記が異なります（CSV: "${rowExamId}", 対象: "${currentExamId}"）`;
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

        const fuzzySec = normalizeId(secId);
        if (seenSectionIds.has(secId) || seenSectionIds.has(fuzzySec)) {
            item.status = 'error';
            item.reason = `重複ID: 大問 "${secId}" がCSV内に複数行存在します`;
            errorCount++;
            errors.push(`行 ${rowNum}: ${item.reason}`);
            items.push(item);
            continue;
        }
        seenSectionIds.add(secId);
        seenSectionIds.add(fuzzySec);

        const currentSec = currentSectionMap.get(secId) || currentSectionMap.get(fuzzySec);
        if (!currentSec) {
            item.status = 'error';
            item.reason = `存在しない大問ID: "${secId}"（新規大問の自動追加は禁止されています）`;
            errorCount++;
            errors.push(`行 ${rowNum}: ${item.reason}`);
            items.push(item);
            continue;
        }

        item.exactSectionId = String(currentSec.id || '');

        const currentVersion = currentSec.section_analysis_version || currentSec.sectionAnalysisVersion || 1;
        const currentAnalysis = currentSec.sectionAnalysis || '';
        item.beforeAnalysis = currentAnalysis;
        item.currentVersion = currentVersion;
        item.currentUpdatedAt = currentSec.section_analysis_updated_at || currentSec.sectionAnalysisUpdatedAt || '';

        // 3. バージョン番号は読み込まずに無視（ナンバリングされた既存CSVもエラーなく取り込む）
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
            item.reason = '既存の大問詳細解説と同一内容のためスキップ（内容変更なし）';
            skipCount++;
            items.push(item);
            continue;
        }

        // 5. 更新対象（バージョン自動繰り上げは行わず、解説内容のみを更新）
        item.status = 'ready';
        item.nextVersion = currentVersion;
        item.reason = '更新可能（大問詳細解説を反映）';
        readyCount++;
        items.push(item);
    }

    return {
        type: 'section',
        totalRows: items.length,
        readyCount,
        skipCount,
        errorCount,
        summary: {
            updateCount: readyCount,
            skipCount,
            errorCount,
            totalRows: items.length
        },
        items,
        errors,
        canApply: readyCount > 0
    };
};

/**
 * 検証済み大問詳細解説の適用
 */
export const applyImportSectionsAnalysisCsv = (arg1, arg2) => {
    let previewResult;
    let currentStructure = [];
    let currentExam = {};

    if (typeof arg1 === 'object' && arg1 !== null && arg1.previewResult !== undefined) {
        previewResult = arg1.previewResult;
        currentStructure = arg1.currentStructure || arg1.structure || [];
        currentExam = arg1.currentExam || {};
    } else {
        previewResult = arg1;
        if (typeof arg2 === 'object' && arg2 !== null) {
            currentExam = arg2;
            currentStructure = arg2.structure || (Array.isArray(arg2) ? arg2 : []);
        }
    }

    if (!previewResult || previewResult.type !== 'section') {
        throw new Error('無効な大問詳細解説プレビュー結果です。');
    }

    const updateMap = new Map();
    previewResult.items.forEach(item => {
        if (item.status === 'ready') {
            const targetSec = item.exactSectionId || item.sectionId;
            updateMap.set(targetSec, item);
            updateMap.set(normalizeId(targetSec), item);
        }
    });

    const now = new Date().toISOString();
    let updatedCount = 0;

    const newStructure = (currentStructure || []).map(section => {
        const secId = String(section.id || '');
        const updateItem = updateMap.get(secId) || updateMap.get(normalizeId(secId));
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

    const nextExamData = {
        ...currentExam,
        structure: newStructure
    };

    return {
        newStructure,
        nextExamData,
        updatedCount,
        skippedCount: previewResult.skipCount,
        errorCount: previewResult.errorCount,
        stats: {
            updatedCount,
            skippedCount: previewResult.skipCount,
            errorCount: previewResult.errorCount
        }
    };
};

/**
 * Reads a CSV File/Blob, automatically detecting UTF-8 (with or without BOM) vs Shift-JIS (CP932).
 * Prevents Japanese mojibake when CSVs are saved from Microsoft Excel.
 * @param {Blob|File} file 
 * @returns {Promise<string>} Decoded CSV text
 */
export const readCsvFileWithEncodingDetection = async (file) => {
    if (!file) throw new Error('ファイルが指定されていません。');
    
    let buffer;
    if (typeof file.arrayBuffer === 'function') {
        buffer = await file.arrayBuffer();
    } else {
        buffer = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
            reader.readAsArrayBuffer(file);
        });
    }

    const bytes = new Uint8Array(buffer);

    // 1. Check for UTF-8 BOM: 0xEF, 0xBB, 0xBF
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(bytes.subarray(3));
    }

    // 2. Try strict UTF-8
    try {
        const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true });
        return strictUtf8Decoder.decode(bytes);
    } catch {
        // 3. Fallback to Shift-JIS (CP932 / Windows-31J)
        try {
            const sjisDecoder = new TextDecoder('shift-jis');
            return sjisDecoder.decode(bytes);
        } catch {
            const fallbackDecoder = new TextDecoder('utf-8');
            return fallbackDecoder.decode(bytes);
        }
    }
};

/**
 * CSVテキストの内容から「小問解説CSV」か「大問詳細解説CSV」かを自動判別
 * @param {string} text 
 * @returns {'question'|'section'|'unknown'}
 */
export const detectCsvType = (text) => {
    try {
        const rows = parseCsvText(text);
        if (!rows || rows.length === 0) return 'unknown';
        const headerRow = rows[0].map(h => String(h || '').trim().toLowerCase().replace(/[\s_・]/g, ''));
        if (headerRow.some(h => h.includes('sectionanalysis') || h.includes('大問詳細解説'))) {
            return 'section';
        }
        if (headerRow.some(h => h.includes('explanation') || h.includes('小問解説') || h.includes('questionid') || h.includes('小問id'))) {
            return 'question';
        }
        return 'unknown';
    } catch {
        return 'unknown';
    }
};

/**
 * 小問解説CSVと大問詳細解説CSVの2ファイルを一括エクスポート
 */
export const exportBothCsvs = (examData) => {
    const qCsv = exportQuestionsCsv(examData);
    const secCsv = exportSectionsAnalysisCsv(examData);
    return {
        questions: qCsv,
        sections: secCsv,
        questionsCsv: qCsv,
        sectionsCsv: secCsv
    };
};

/**
 * 複数（または単一）のCSVテキストを自動判別して一括インポート
 * @param {Array<{ text: string, name?: string }>} csvEntries
 * @param {object} currentExam
 */
export const applyImportMultiCsvs = (csvEntries, currentExam) => {
    let workingExam = { ...(currentExam || {}) };
    let workingStructure = [...(workingExam.structure || [])];
    
    let totalQuestionsUpdated = 0;
    let totalQuestionsSkipped = 0;
    let totalQuestionsErrors = 0;
    
    let totalSectionsUpdated = 0;
    let totalSectionsSkipped = 0;
    let totalSectionsErrors = 0;

    const detailedErrors = [];

    for (const entry of csvEntries) {
        const text = entry.text || '';
        const name = entry.name || '';
        const type = detectCsvType(text);

        if (type === 'question') {
            const preview = previewImportQuestionsCsv(text, {
                ...workingExam,
                structure: workingStructure
            });
            if (preview.errors?.length > 0) {
                detailedErrors.push(...preview.errors);
            }
            const apply = applyImportQuestionsCsv(preview, {
                ...workingExam,
                structure: workingStructure
            });
            workingExam = apply.nextExamData;
            workingStructure = apply.newStructure;
            totalQuestionsUpdated += apply.stats.updatedCount;
            totalQuestionsSkipped += apply.stats.skippedCount;
            totalQuestionsErrors += apply.stats.errorCount;
        } else if (type === 'section') {
            const preview = previewImportSectionsAnalysisCsv(text, {
                ...workingExam,
                structure: workingStructure
            });
            if (preview.errors?.length > 0) {
                detailedErrors.push(...preview.errors);
            }
            const apply = applyImportSectionsAnalysisCsv(preview, {
                ...workingExam,
                structure: workingStructure
            });
            workingExam = apply.nextExamData;
            workingStructure = apply.newStructure;
            totalSectionsUpdated += apply.stats.updatedCount;
            totalSectionsSkipped += apply.stats.skippedCount;
            totalSectionsErrors += apply.stats.errorCount;
        } else {
            detailedErrors.push(`ファイル "${name || '不明'}" は小問解説または大問詳細解説のCSVとして認識できませんでした。`);
        }
    }

    return {
        nextExamData: workingExam,
        newStructure: workingStructure,
        stats: {
            questionsUpdated: totalQuestionsUpdated,
            questionsSkipped: totalQuestionsSkipped,
            questionsErrors: totalQuestionsErrors,
            sectionsUpdated: totalSectionsUpdated,
            sectionsSkipped: totalSectionsSkipped,
            sectionsErrors: totalSectionsErrors,
            totalUpdated: totalQuestionsUpdated + totalSectionsUpdated
        },
        errors: detailedErrors
    };
};
