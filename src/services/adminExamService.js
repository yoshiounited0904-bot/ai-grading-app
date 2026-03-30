import { supabase } from './supabaseClient';
import { universities } from '../data/mockData';

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
    const { data, error } = await supabase
        .from('exams')
        .select('*')
        .order('created_at', { ascending: false });
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
