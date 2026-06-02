import { supabase } from './supabaseClient';
import { universities } from '../data/mockData';
import universityBaseData from '../data/universityBaseData.json';

export const importAogakuData = async () => {
    let count = 0;
    
    for (const item of universityBaseData) {
        const uniName = item.university || '青山学院大学';
        
        // Resolve university_id (2260 for Aoyama, 2680 for Chuo, 3050 for Hosei, 2270 for Meiji, fallback to passnavi url extraction)
        let uniId = 2260;
        if (uniName === '中央大学') uniId = 2680;
        else if (uniName === '法政大学') uniId = 3050;
        else if (uniName === '明治大学') uniId = 2270;
        else if (uniName === '青山学院大学') uniId = 2260;
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
        const examId = `${uniPrefix}${safeFac}-2025-${item.subject_en || 'english'}`.toLowerCase();
        
        // Generate a stable faculty ID based on the safe faculty name to prevent random regenerations
        const stableFacId = `fac-${safeFac.substring(0, 10)}`;

        const record = {
            id: examId,
            university: uniName,
            university_id: uniId,
            faculty: item.faculty,
            faculty_id: stableFacId,
            year: 2025,
            subject: item.subject,
            subject_en: item.subject_en || 'english',
            type: 'pdf',
            max_score: item.maxScore || 100,
            duration_minutes: item.duration || item.durationMinutes || 60,
            passing_lines: item.passingLines || {},
            is_published: true,
            master_status: '未着手',
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
            record.master_status = existing.master_status || '未着手';
            record.is_published = existing.is_published !== undefined ? existing.is_published : true;
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
    // Optimization: Select only metadata columns needed for the list view.
    // Exclude heavy columns: 'detailed_analysis', 'weakness_analysis', 'structure'
    const { data, error } = await supabase
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
            master_status, 
            unimplemented_items, 
            admin_comment,
            is_completed,
            is_published,
            created_at,
            updated_at
        `)
        .order('university', { ascending: true });
    return { data, error };
};

export const getAdminExamById = async (id) => {
    const { data, error } = await supabase
        .from('exams')
        .select('*')
        .eq('id', id)
        .single();
    return { data, error };
};

export const saveAdminExam = async (examData) => {
    const { data, error } = await supabase
        .from('exams')
        .upsert([{
            ...examData,
            updated_at: new Date().toISOString()
        }])
        .select();
    return { data, error };
};

export const deleteAdminExam = async (id) => {
    const { error } = await supabase
        .from('exams')
        .delete()
        .eq('id', id);
    return { error };
};

export const deleteAdminExamsBulk = async (ids) => {
    const { error } = await supabase
        .from('exams')
        .delete()
        .in('id', ids);
    return { error };
};

export const updateAdminComment = async (id, comment, unimplemented_items = null) => {
    const updates = { updated_at: new Date().toISOString() };
    if (comment !== null) updates.admin_comment = comment;
    if (unimplemented_items !== null) updates.unimplemented_items = unimplemented_items;

    const { data, error } = await supabase
        .from('exams')
        .update(updates)
        .eq('id', id)
        .select();
    return { data, error };
};

export const updateAdminFields = async (id, updates) => {
    const { data, error } = await supabase
        .from('exams')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select();
    return { data, error };
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
            is_published: true, // Make sure duplicates are published by default
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
