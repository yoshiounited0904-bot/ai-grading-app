import { supabase } from '../services/supabaseClient';

const PUBLIC_EXAM_PAGE_SIZE = 1000;

const getUniversityRouteId = (universityName = '') => encodeURIComponent(String(universityName || '').trim());

const safelyDecodeRouteId = (routeId = '') => {
    try {
        return decodeURIComponent(String(routeId || ''));
    } catch {
        return String(routeId || '');
    }
};

const normalizeFacultyKey = (value = '') => {
    return String(value)
        .trim()
        .replace(/[（）]/g, (char) => (char === '（' ? '(' : ')'))
        .replace(/[／]/g, '/')
        .replace(/\s+/g, '')
        .replace(/学部(?=[(/]|$)/g, '');
};

const shouldPreferFacultyName = (currentName = '', nextName = '') => {
    if (!currentName) return true;
    if (!nextName) return false;
    const currentHasGakubu = currentName.includes('学部');
    const nextHasGakubu = nextName.includes('学部');
    if (currentHasGakubu !== nextHasGakubu) return !nextHasGakubu;
    return nextName.length < currentName.length;
};

const getFacultyDisplayId = (exam = {}) => {
    const facultyKey = normalizeFacultyKey(exam.faculty);
    return `${exam.faculty_id || 'faculty'}-${facultyKey || encodeURIComponent(exam.faculty || '')}`;
};

const fetchPublishedExamRows = async (selectColumns = '*', applyFilters = (query) => query) => {
    const rows = [];
    let from = 0;

    while (true) {
        let query = supabase
            .from('exams')
            .select(selectColumns)
            .eq('is_published', true)
            .order('university', { ascending: true })
            .order('faculty', { ascending: true })
            .order('year', { ascending: false })
            .range(from, from + PUBLIC_EXAM_PAGE_SIZE - 1);

        query = applyFilters(query);

        const { data, error } = await query;

        if (error) throw error;

        const page = Array.isArray(data) ? data : [];
        rows.push(...page);

        if (page.length < PUBLIC_EXAM_PAGE_SIZE) break;
        from += PUBLIC_EXAM_PAGE_SIZE;
    }

    return rows;
};

/**
 * Fetches a summary list of unique universities (lightweight).
 */
export const getUniversityList = async () => {
    try {
        const exams = await fetchPublishedExamRows('university, university_id, type, faculty, faculty_id');

        const mergedUniversities = [];

        exams.forEach(exam => {
            let university = mergedUniversities.find(u => u.name === exam.university);

            if (!university) {
                university = {
                    id: getUniversityRouteId(exam.university),
                    name: exam.university,
                    type: exam.type || "私立",
                    faculties: [],
                    universityDbIds: []
                };
                mergedUniversities.push(university);
            }

            if (exam.university_id && !university.universityDbIds.includes(exam.university_id)) {
                university.universityDbIds.push(exam.university_id);
            }

            const facultyKey = normalizeFacultyKey(exam.faculty);
            const existingFaculty = university.faculties.find(f =>
                f.name === exam.faculty ||
                normalizeFacultyKey(f.name) === facultyKey
            );

            if (!existingFaculty) {
                university.faculties.push({
                    id: getFacultyDisplayId(exam),
                    name: exam.faculty
                });
            } else if (shouldPreferFacultyName(existingFaculty.name, exam.faculty)) {
                existingFaculty.name = exam.faculty;
            }
        });

        // Sort by name for better UX
        return mergedUniversities.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    } catch (err) {
        console.error('Failed to get university list:', err);
        return [];
    }
};

/**
 * Fetches all exams and faculties for a specific university.
 */
export const getExamsForUniversity = async (universityId) => {
    try {
        const decodedUniversityId = safelyDecodeRouteId(universityId);
        const numericUniversityId = Number.parseInt(universityId, 10);
        const hasNumericUniversityId = Number.isFinite(numericUniversityId) && String(numericUniversityId) === String(universityId);

        const exams = await fetchPublishedExamRows('*', (query) => {
            if (hasNumericUniversityId) return query.eq('university_id', numericUniversityId);
            return query.eq('university', decodedUniversityId);
        });

        if (!exams || exams.length === 0) return null;

        const university = {
            id: getUniversityRouteId(exams[0].university),
            name: exams[0].university,
            type: exams[0].type || "私立",
            faculties: []
        };

        exams.forEach(exam => {
            const facultyKey = normalizeFacultyKey(exam.faculty);
            let faculty = university.faculties.find(f =>
                f.name === exam.faculty ||
                normalizeFacultyKey(f.name) === facultyKey
            );

            if (!faculty) {
                faculty = {
                    id: getFacultyDisplayId(exam),
                    name: exam.faculty,
                    exams: []
                };
                university.faculties.push(faculty);
            } else if (shouldPreferFacultyName(faculty.name, exam.faculty)) {
                faculty.name = exam.faculty;
            }

            const formattedExam = {
                id: exam.id,
                university: exam.university,
                universityId: exam.university_id,
                faculty: exam.faculty,
                facultyId: exam.faculty_id,
                year: exam.year,
                subject: exam.subject,
                subjectEn: exam.subject_en,
                type: exam.type,
                pdfPath: exam.pdf_path,
                maxScore: exam.max_score,
                score_cap: exam.score_cap,
                passing_lines: exam.passing_lines,
                detailedAnalysis: exam.detailed_analysis,
                structure: exam.structure,
                duration_minutes: exam.duration_minutes,
                master_status: exam.master_status,
                is_ai_checked: exam.is_ai_checked,
                ai_checked_at: exam.ai_checked_at,
                is_published: exam.is_published
            };

            if (!faculty.exams.find(e => e.id === formattedExam.id)) {
                faculty.exams.push(formattedExam);
            }
        });

        return university;
    } catch (err) {
        console.error('Failed to get exams for university:', err);
        return null;
    }
};

/**
 * Fetches exams from Supabase and builds the nested universities data structure.
 * DEPRECATED: Use getUniversityList or getExamsForUniversity instead for better performance.
 */
export const getUniversities = async () => {
    try {
        const exams = await fetchPublishedExamRows('*');

        const mergedUniversities = [];

        exams.forEach(exam => {
            let university = mergedUniversities.find(u => u.name === exam.university);

            if (!university) {
                // Create new university if it doesn't exist
                university = {
                    id: getUniversityRouteId(exam.university),
                    name: exam.university,
                    type: exam.type || "私立",
                    faculties: [],
                    universityDbIds: []
                };
                mergedUniversities.push(university);
            }

            if (exam.university_id && !university.universityDbIds.includes(exam.university_id)) {
                university.universityDbIds.push(exam.university_id);
            }

            const facultyKey = normalizeFacultyKey(exam.faculty);
            let faculty = university.faculties.find(f =>
                f.name === exam.faculty ||
                normalizeFacultyKey(f.name) === facultyKey
            );

            if (!faculty) {
                // Create new faculty if it doesn't exist
                faculty = {
                    id: getFacultyDisplayId(exam),
                    name: exam.faculty,
                    exams: []
                };
                university.faculties.push(faculty);
            } else if (shouldPreferFacultyName(faculty.name, exam.faculty)) {
                faculty.name = exam.faculty;
            }

            // Map DB fields back to the format components expect
            const formattedExam = {
                id: exam.id,
                university: exam.university,
                universityId: exam.university_id,
                faculty: exam.faculty,
                facultyId: exam.faculty_id,
                year: exam.year,
                subject: exam.subject,
                subjectEn: exam.subject_en,
                type: exam.type,
                pdfPath: exam.pdf_path,
                maxScore: exam.max_score,
                score_cap: exam.score_cap,
                passing_lines: exam.passing_lines,
                detailedAnalysis: exam.detailed_analysis,
                structure: exam.structure,
                duration_minutes: exam.duration_minutes,
                master_status: exam.master_status,
                is_ai_checked: exam.is_ai_checked,
                ai_checked_at: exam.ai_checked_at
            };

            // Add exam if not already present
            if (!faculty.exams.find(e => e.id === formattedExam.id)) {
                faculty.exams.push(formattedExam);
            }
        });

        return mergedUniversities;
    } catch (err) {
        console.error('Failed to fetch and process universities data:', err);
        return [];
    }
};
