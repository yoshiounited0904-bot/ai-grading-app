import { supabase } from './supabaseClient'
import { notifyAdmin } from './notificationService';

export const reportGradingError = async (userId, reportData) => {
    const payload = {
        user_id: userId,
        exam_result_id: reportData.examResultId || null,
        exam_id: reportData.examId || null,
        university_name: reportData.universityName,
        faculty_name: reportData.facultyName || null,
        exam_subject: reportData.examSubject,
        exam_year: reportData.examYear || null,
        question_id: reportData.questionId,
        user_answer: reportData.userAnswer,
        correct_answer: reportData.correctAnswer,
        ai_explanation: reportData.aiExplanation,
        user_comment: reportData.userComment,
        status: 'new',
        admin_memo: '',
        created_at: new Date().toISOString()
    };

    let { data, error } = await supabase
        .from('grading_reports')
        .insert([payload])
        .select()
        .single();

    if (error && (
        error.message?.includes('exam_result_id') ||
        error.message?.includes('exam_id') ||
        error.message?.includes('faculty_name') ||
        error.message?.includes('exam_year') ||
        error.message?.includes('status') ||
        error.message?.includes('admin_memo')
    )) {
        const result = await supabase
            .from('grading_reports')
            .insert([{
            user_id: userId,
            university_name: reportData.universityName,
            exam_subject: reportData.examSubject,
            question_id: reportData.questionId,
            user_answer: reportData.userAnswer,
            correct_answer: reportData.correctAnswer,
            ai_explanation: reportData.aiExplanation,
            user_comment: reportData.userComment,
            created_at: new Date().toISOString()
            }])
            .select()
            .single();
        data = result.data;
        error = result.error;
    }

    if (error) {
        error.message = `grading_reports への保存に失敗しました: ${error.message}`;
    } else {
        notifyAdmin('grading_report', {
            id: data?.id || null,
            ...payload
        });
    }

    return { data, error }
}

export const getGradingReports = async () => {
    let { data, error } = await supabase
        .from('grading_reports')
        .select('*, exam_results(*)')
        .order('created_at', { ascending: false });

    if (error && (
        error.message?.includes('relationship') ||
        error.message?.includes('Could not find') ||
        error.message?.includes('exam_results')
    )) {
        const fallback = await supabase
            .from('grading_reports')
            .select('*')
            .order('created_at', { ascending: false });
        data = fallback.data;
        error = fallback.error;
    }

    return { data, error };
};

export const updateGradingReport = async (id, updates) => {
    const { data, error } = await supabase
        .from('grading_reports')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    return { data, error };
};

export const deleteGradingReport = async (id) => {
    const { error } = await supabase
        .from('grading_reports')
        .delete()
        .eq('id', id);

    return { error };
};
