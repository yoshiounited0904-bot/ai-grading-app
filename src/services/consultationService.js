import { supabase } from './supabaseClient';
import { notifyAdmin } from './notificationService';

export const createLineMatchCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 5; i += 1) {
        suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    return `SE-${suffix}`;
};

export const buildLineMatchMessage = (request) => {
    const method = request.preferredMethod === 'zoom_no_camera' ? 'Zoom（顔出しなし）' : 'LINE';
    return [
        '答案相談を申し込みました。',
        `照合コード: ${request.lineMatchCode}`,
        `予約名: ${request.studentName}`,
        request.lineDisplayName ? `LINE表示名: ${request.lineDisplayName}` : '',
        request.grade ? `学年: ${request.grade}` : '',
        `希望相談方法: ${method}`
    ].filter(Boolean).join('\n');
};

export const saveConsultationRequest = async (requestData) => {
    const lineMatchCode = requestData.lineMatchCode || createLineMatchCode();
    const lineMatchMessage = requestData.lineMatchMessage || buildLineMatchMessage({
        ...requestData,
        lineMatchCode
    });

    const payload = {
        user_id: requestData.userId || null,
        exam_result_id: requestData.examResultId || null,
        exam_id: requestData.examId || null,
        student_name: requestData.studentName,
        grade: requestData.grade || null,
        email: requestData.email || null,
        line_display_name: requestData.lineDisplayName || null,
        preferred_method: requestData.preferredMethod || 'line',
        preferred_time_1: requestData.preferredTime1 || null,
        preferred_time_2: requestData.preferredTime2 || null,
        preferred_time_3: requestData.preferredTime3 || null,
        consultation_message: requestData.consultationMessage || null,
        university_name: requestData.universityName || null,
        faculty_name: requestData.facultyName || null,
        exam_subject: requestData.examSubject || null,
        exam_year: requestData.examYear || null,
        score: requestData.score ?? null,
        max_score: requestData.maxScore ?? null,
        pass_probability: requestData.passProbability || null,
        weakness_summary: requestData.weaknessSummary || null,
        wrong_question_count: requestData.wrongQuestionCount ?? null,
        chat_summary: requestData.chatSummary || null,
        chat_history: requestData.chatHistory || null,
        section_focus: requestData.sectionFocus || null,
        consultation_context: requestData.consultationContext || null,
        line_match_code: lineMatchCode,
        line_match_message: lineMatchMessage,
        line_matched: false,
        status: 'new',
        source: requestData.source || 'result_cta',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    let insertPayload = { ...payload };
    let { data, error } = await supabase
        .from('consultation_requests')
        .insert([insertPayload])
        .select()
        .single();

    const optionalColumnFallbacks = [
        'chat_history',
        'consultation_context',
        'section_focus',
        'chat_summary'
    ];

    for (const column of optionalColumnFallbacks) {
        if (!error?.message?.includes(column)) continue;
        insertPayload = { ...insertPayload };
        delete insertPayload[column];
        const result = await supabase
            .from('consultation_requests')
            .insert([insertPayload])
            .select()
            .single();
        data = result.data;
        error = result.error;
        if (!error) break;
    }

    if (error) {
        error.message = `consultation_requests への保存に失敗しました: ${error.message}`;
    } else {
        notifyAdmin('consultation_request', {
            id: data?.id,
            ...payload
        });
    }

    return { data, error, lineMatchCode, lineMatchMessage };
};

export const getConsultationRequests = async () => {
    const { data, error } = await supabase.functions.invoke('admin-consultation-requests', {
        body: { action: 'list' }
    });

    return { data: data?.consultations || [], error };
};

export const updateConsultationRequest = async (id, updates) => {
    const { data, error } = await supabase.functions.invoke('admin-consultation-requests', {
        body: {
            action: 'update',
            id,
            updates
        }
    });

    return { data: data?.consultation || null, error };
};

export const deleteConsultationRequest = async (id) => {
    const { data, error } = await supabase.functions.invoke('admin-consultation-requests', {
        body: {
            action: 'delete',
            id
        }
    });

    if (error) return { error };

    if (!data?.deletedId) {
        return {
            error: new Error('削除対象が見つからない、または削除権限がないため、データベース上では削除されませんでした。')
        };
    }

    return { data, error: null };
};
