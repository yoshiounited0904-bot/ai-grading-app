import { supabase } from './supabaseClient';
import { universities } from '../data/mockData';
import universityBaseData from '../data/universityBaseData.json';
import { inferSubjectIdFromLabel } from '../config/subjectConfig';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const withSupabaseTimeout = (promise, label, ms = 45000) => Promise.race([
    promise,
    new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label}がタイムアウトしました。Supabase接続またはネットワークを確認してください。`)), ms);
    })
]);

const isTransientSupabaseError = (error) => {
    const message = String(error?.message || error?.details || error || '').toLowerCase();
    const status = Number(error?.status || error?.code);
    return [408, 429, 500, 502, 503, 504, 522, 523, 524].includes(status) ||
        /522|timeout|timed out|load failed|failed to fetch|network|gateway|temporarily|resource/i.test(message);
};

const runSupabaseQuery = async (queryFactory, label, { retries = 2, timeoutMs = 45000 } = {}) => {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const result = await withSupabaseTimeout(queryFactory(), label, timeoutMs);
            if (!result?.error) return result;

            lastError = result.error;
            if (!isTransientSupabaseError(result.error) || attempt === retries) {
                return result;
            }
        } catch (error) {
            lastError = error;
            if (!isTransientSupabaseError(error) || attempt === retries) {
                return { data: null, error };
            }
        }

        await sleep(800 * (attempt + 1));
    }

    return { data: null, error: lastError || new Error(`${label}に失敗しました。`) };
};

const safeDecodeURIComponent = (value = '') => {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
};

const uniqueNonEmpty = (items = []) => [...new Set(
    items
        .map(item => String(item || '').trim())
        .filter(Boolean)
)];

const stripExamIdNoise = (value = '') => safeDecodeURIComponent(value)
    .replace(/^#\s*/, '')
    .replace(/^copy_\d+_/, '')
    .trim();

const normalizeExamLookupText = (value = '') => stripExamIdNoise(value)
    .normalize('NFKC')
    .replace(/[／/]/g, '_')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, '')
    .toLowerCase();

const getUniversityBaseDataId = (item) => (
    item?.id ||
    [item?.university, item?.year, item?.faculty, item?.subject].filter(Boolean).join('_')
);

const getAdminExamIdCandidates = (id) => {
    const raw = String(id || '').trim();
    const decoded = safeDecodeURIComponent(raw);
    const stripped = stripExamIdNoise(decoded);
    const withoutCopy = decoded.replace(/^copy_\d+_/, '').trim();
    const withoutHash = decoded.replace(/^#\s*/, '').trim();

    return uniqueNonEmpty([
        raw,
        decoded,
        stripped,
        withoutCopy,
        withoutHash,
        encodeURIComponent(decoded),
        encodeURIComponent(stripped)
    ]);
};

const parseExamIdentityFromId = (id) => {
    const decoded = stripExamIdNoise(id);
    const baseDataMatch = universityBaseData.find(item =>
        normalizeExamLookupText(getUniversityBaseDataId(item)) === normalizeExamLookupText(decoded)
    );

    if (baseDataMatch) {
        return {
            university: baseDataMatch.university || '',
            facultyId: baseDataMatch.faculty_id || baseDataMatch.facultyId || '',
            faculty: baseDataMatch.faculty || '',
            year: baseDataMatch.year ? Number(baseDataMatch.year) : null,
            subject: baseDataMatch.subject || '',
            subject_en: inferSubjectIdFromLabel(baseDataMatch.subject_en, baseDataMatch.subject, '')
        };
    }

    const match = decoded.match(/^(.*?)-(fac[^-]+)-(.+?)-((?:19|20)\d{2})-([a-z_]+)$/i);
    if (!match) return null;

    const [, university, facultyId, faculty, year, subjectEn] = match;
    return {
        university,
        facultyId,
        faculty,
        year: Number(year),
        subject: '',
        subject_en: inferSubjectIdFromLabel(subjectEn, '', subjectEn)
    };
};

const pickMatchingExamRow = (rows = [], id, identity) => {
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const targetId = normalizeExamLookupText(id);
    const targetFacultyId = normalizeExamLookupText(identity?.facultyId);
    const targetFaculty = normalizeExamLookupText(identity?.faculty);

    return rows.find(row => normalizeExamLookupText(row.id) === targetId) ||
        rows.find(row => targetFacultyId && normalizeExamLookupText(row.faculty_id) === targetFacultyId) ||
        rows.find(row => targetFaculty && normalizeExamLookupText(row.faculty) === targetFaculty) ||
        (rows.length === 1 ? rows[0] : null);
};

export const importAogakuData = async () => {
    let count = 0;
    
    for (const item of universityBaseData) {
        const uniName = item.university || '青山学院大学';
        
        // Resolve university_id (2260 for Aoyama, 2680 for Chuo, 3050 for Hosei, 2270 for Meiji, 2250 for Waseda, 2280 for Rikkyo, 2390 for Keio, fallback to passnavi url extraction)
        let uniId = 2260;
        if (uniName === '中央大学') uniId = 2680;
        else if (uniName === '法政大学') uniId = 3050;
        else if (uniName === '明治大学') uniId = 2270;
        else if (uniName === '青山学院大学') uniId = 2260;
        else if (uniName === '早稲田大学') uniId = 2250;
        else if (uniName === '立教大学') uniId = 2280;
        else if (uniName === '慶應義塾大学') uniId = 2390;
        else {
            const passnaviMatch = (item.sources || []).find(s => s.includes('passnavi.obunsha.co.jp/univ/'));
            if (passnaviMatch) {
                const match = passnaviMatch.match(/univ\/(\d+)/);
                if (match) uniId = parseInt(match[1]);
            }
        }

        const safeFac = item.faculty.replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '').toLowerCase();
        let uniPrefix = 'aoyama-';
        if (uniName === '中央大学') uniPrefix = 'chuo-';
        else if (uniName === '法政大学') uniPrefix = 'hosei-';
        else if (uniName === '明治大学') uniPrefix = 'meiji-';
        else if (uniName === '早稲田大学') uniPrefix = 'waseda-';
        else if (uniName === '立教大学') uniPrefix = 'rikkyo-';
        else if (uniName === '慶應義塾大学') uniPrefix = 'keio-';

        const examYear = item.year || 2025;
        const examSubject = item.subject_en || 'english';
        const examId = `${uniPrefix}${safeFac}-${examYear}-${examSubject}`.toLowerCase();
        
        // Generate a stable faculty ID based on the safe faculty name to prevent random regenerations
        const stableFacId = `fac-${safeFac.substring(0, 10)}`;

        const record = {
            id: examId,
            university: uniName,
            university_id: uniId,
            faculty: item.faculty,
            faculty_id: stableFacId,
            year: examYear,
            subject: item.subject,
            subject_en: examSubject,
            type: 'pdf',
            max_score: item.maxScore || 100,
            duration_minutes: item.duration || item.durationMinutes || 60,
            passing_lines: item.passingLines || {},
            is_published: false,
            master_status: 'working',
            structure: []
        };

        // SAFETY SHIELD: Retrieve existing exam first so we NEVER overwrite detailed structure or PDF paths
        const { data: existing } = await supabase
            .from('exams')
            .select('structure, pdf_path, master_status, is_published, faculty_id')
            .eq('id', examId)
            .maybeSingle();

        if (existing) {
            record.structure = existing.structure || [];
            record.pdf_path = existing.pdf_path || '';
            record.master_status = existing.master_status || 'working';
            record.is_published = existing.is_published !== undefined ? existing.is_published : false;
            record.faculty_id = existing.faculty_id || stableFacId;
        }

        const { error } = await supabase
            .from('exams')
            .upsert(record, { onConflict: 'id' });

        if (!error) {
            count++;
        } else {
            console.error("Failed to insert university data", record.id, error.message);
        }
    }
    
    return count;
};

export const importMockData = async () => {
    let count = 0;
    for (const uni of universities) {
        for (const faculty of uni.faculties) {
            if (!faculty.exams) continue;

            for (const exam of faculty.exams) {
                const record = {
                    id: exam.id || `${uni.id}-${faculty.id}-${exam.year}-${exam.subject}`,
                    university: uni.name,
                    // If ID is string like 'hosei', make it a random int or hash, as DB expects INTEGER
                    university_id: typeof uni.id === 'string' ? Math.floor(Math.random() * 10000) : uni.id,
                    faculty: faculty.name,
                    faculty_id: faculty.id,
                    year: exam.year,
                    subject: exam.subject,
                    subject_en: exam.subjectEn || exam.subject,
                    type: exam.type || 'text',
                    pdf_path: exam.pdfPath || null,
                    max_score: exam.maxScore || 100,
                    detailed_analysis: exam.detailedAnalysis || null,
                    is_published: true,
                    structure: exam.structure || []
                };

                const { error } = await supabase
                    .from('exams')
                    .upsert(record, { onConflict: 'id' });

                if (!error) {
                    count++;
                } else {
                    console.error("Failed to insert", record.id, error.message);
                }
            }
        }
    }
    return count;
};

export const getAdminExams = async () => {
    // Dashboard list should stay lightweight. Fetch heavy structure JSON only on demand.
    return runSupabaseQuery(
        () => (
            supabase
                .from('exams')
                .select(`
                    id, 
                    university, 
                    university_id, 
                    faculty, 
                    faculty_id, 
                    year, 
                    subject, 
                    subject_en, 
                    type, 
                    pdf_path, 
                    max_score, 
                    duration_minutes,
                    master_status, 
                    unimplemented_items, 
                    admin_comment,
                    is_completed,
                    is_published,
                    is_ai_checked,
                    ai_checked_at,
                    created_at,
                    updated_at
                `)
                .limit(1500)
        ),
        '試験一覧の取得'
    );
};

export const getAdminExamsWithStructure = async () => {
    return runSupabaseQuery(
        () => (
            supabase
                .from('exams')
                .select(`
                    id, 
                    university, 
                    university_id, 
                    faculty, 
                    faculty_id, 
                    year, 
                    subject, 
                    subject_en, 
                    type, 
                    pdf_path, 
                    max_score, 
                    duration_minutes,
                    structure,
                    master_status, 
                    unimplemented_items, 
                    admin_comment,
                    is_completed,
                    is_published,
                    is_ai_checked,
                    ai_checked_at,
                    created_at,
                    updated_at
                `)
                .order('created_at', { ascending: false })
                .limit(1500)
        ),
        '試験詳細一覧（structure含む）の取得'
    );
};

export const getAdminExamStructureSummaries = async (ids = null) => {
    return runSupabaseQuery(() => {
        let query = supabase
            .from('exams')
            .select('id, max_score, structure');

        if (Array.isArray(ids) && ids.length > 0) {
            query = query.in('id', ids);
        }

        return query;
    }, '問題数・配点集計の取得');
};

export const getAdminExamById = async (id) => {
    const candidates = getAdminExamIdCandidates(id);
    const exactResult = await runSupabaseQuery(
        () => supabase
            .from('exams')
            .select('*')
            .in('id', candidates)
            .limit(Math.max(candidates.length, 1)),
        '試験データ詳細の取得'
    );

    const exactRows = Array.isArray(exactResult.data) ? exactResult.data : [];
    const exactMatch = pickMatchingExamRow(exactRows, id, null);
    if (exactMatch) {
        return { data: exactMatch, error: null };
    }

    const identity = parseExamIdentityFromId(id);
    if (!identity?.university || !identity?.year || !identity?.subject_en) {
        return {
            data: null,
            error: exactResult.error || new Error(`試験データが見つかりませんでした: ${id}`)
        };
    }

    const fallbackResult = await runSupabaseQuery(
        () => supabase
            .from('exams')
            .select('*')
            .eq('university', identity.university)
            .eq('year', identity.year)
            .eq('subject_en', identity.subject_en)
            .limit(80),
        '試験データ詳細の補完取得'
    );

    const fallbackRows = Array.isArray(fallbackResult.data) ? fallbackResult.data : [];
    const fallbackMatch = pickMatchingExamRow(fallbackRows, id, identity);
    if (fallbackMatch) {
        return { data: fallbackMatch, error: null };
    }

    return {
        data: null,
        error: fallbackResult.error || exactResult.error || new Error(`試験データが見つかりませんでした: ${id}`)
    };
};

export const saveAdminExam = async (examData) => {
    const payload = {
        ...examData,
        updated_at: new Date().toISOString()
    };

    return runSupabaseQuery(
        async () => {
            // 1. セキュアな RPC 関数 (admin_save_exam) を優先試行
            try {
                const { data: rpcData, error: rpcError } = await supabase.rpc('admin_save_exam', { p_exam: payload });
                if (!rpcError && rpcData) {
                    return { data: [rpcData], error: null };
                }
                // RPC 関数が未作成、または引数不一致の場合は直接 upsert へフォールバック
                if (rpcError && rpcError.code !== '42883' && !rpcError.message?.includes('function')) {
                    console.warn('[adminExamService] admin_save_exam RPC returned error, falling back to direct upsert:', rpcError);
                }
            } catch (rpcEx) {
                console.warn('[adminExamService] RPC call exception, trying direct upsert:', rpcEx);
            }

            // 2. 直接 upsert フォールバック
            return supabase
                .from('exams')
                .upsert([payload])
                .select('id, updated_at');
        },
        '試験データの保存',
        { retries: 3, timeoutMs: 60000 }
    );
};

export const deleteAdminExam = async (id) => {
    const { error } = await runSupabaseQuery(
        () => supabase
            .from('exams')
            .delete()
            .eq('id', id),
        '試験データの削除'
    );
    return { error };
};

export const deleteAdminExamsBulk = async (ids) => {
    const { error } = await runSupabaseQuery(
        () => supabase
            .from('exams')
            .delete()
            .in('id', ids),
        '試験データの一括削除'
    );
    return { error };
};

export const updateAdminComment = async (id, comment, unimplemented_items = null) => {
    const updates = { updated_at: new Date().toISOString() };
    if (comment !== null) updates.admin_comment = comment;
    if (unimplemented_items !== null) updates.unimplemented_items = unimplemented_items;

    return runSupabaseQuery(
        () => supabase
            .from('exams')
            .update(updates)
            .eq('id', id)
            .select('id, updated_at'),
        '共有メモの保存'
    );
};

export const updateAdminFields = async (id, updates) => {
    return runSupabaseQuery(
        () => supabase
            .from('exams')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select('id, updated_at'),
        '試験データの更新',
        { retries: 3, timeoutMs: 60000 }
    );
};

export const uploadAnalysisImage = async (file, examId) => {
    const fileExt = file.name.split('.').pop().toLowerCase();
    const sanitizedId = String(examId || 'unknown')
        .normalize('NFKC')
        .replace(/[^\w\-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    const fileName = `analysis_${sanitizedId}_${Date.now()}.${fileExt}`;
    const filePath = `analysis/${fileName}`;

    const { data, error } = await supabase.storage
        .from('exam-images')
        .upload(filePath, file, { upsert: true });

    if (error) {
        console.error("Storage upload error:", error);
        return { error };
    }

    const { data: { publicUrl } } = supabase.storage
        .from('exam-images')
        .getPublicUrl(filePath);

    return { publicUrl };
};

export const uploadExamPdf = async (file, examId) => {
    // Unique filename using examId and timestamp to prevent collisions
    const fileExt = file.name.split('.').pop().toLowerCase();
    // Sanitize examId: convert full-width numbers/letters to ASCII, strip any remaining invalid chars
    const sanitizedId = examId
        .normalize('NFKC')                // converts １ → 1, Ａ → A, etc.
        .replace(/[^\w\-]/g, '_')         // replace anything not alphanumeric/-/_ with _
        .replace(/_+/g, '_')              // collapse multiple underscores
        .replace(/^_|_$/g, '');           // trim leading/trailing underscores
    const fileName = `${sanitizedId}_${Date.now()}.${fileExt}`;
    const filePath = `public/${fileName}`;

    const { data, error } = await supabase.storage
        .from('exam-pdfs')
        .upload(filePath, file, { upsert: true });

    if (error) {
        console.error("Storage upload error:", error);
        return { error };
    }

    const { data: { publicUrl } } = supabase.storage
        .from('exam-pdfs')
        .getPublicUrl(filePath);

    return { publicUrl };
};

export const duplicateAdminExam = async (examId, count = 1) => {
    // 1. Get full source data
    const { data: source, error: fetchError } = await getAdminExamById(examId);
    if (fetchError) return { error: fetchError };

    // 2. Prepare new data (clone and modify)
    // We remove id and created_at to let Supabase generate new ones
    const { id, created_at, updated_at, ...cleanData } = source;
    
    const duplicates = [];
    for (let i = 0; i < count; i++) {
        duplicates.push({
            ...cleanData,
            subject: count > 1 ? `${cleanData.subject}(コピー${i + 1})` : `${cleanData.subject}(コピー)`,
            master_status: 'working', // Reset status for the copy
            is_published: false,
            id: `copy_${Date.now()}_${Math.floor(Math.random() * 10000)}_${i}` 
        });
    }

    // 3. Insert as new records
    const { data, error } = await supabase
        .from('exams')
        .insert(duplicates)
        .select();

    return { data, error };
};
