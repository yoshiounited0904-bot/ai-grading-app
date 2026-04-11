import { supabase } from '../services/supabaseClient';

/**
 * Fetches a summary list of unique universities (lightweight).
 */
export const getUniversityList = async () => {
    try {
        // Select only identifying and summary fields
        const { data: exams, error } = await supabase
            .from('exams')
            .select('university, university_id, type, faculty, faculty_id');

        if (error) {
            console.error('Error fetching university list:', error);
            return [];
        }

        const mergedUniversities = [];

        exams.forEach(exam => {
            let university = mergedUniversities.find(u => u.id === exam.university_id || u.name === exam.university);

            if (!university) {
                university = {
                    id: exam.university_id,
                    name: exam.university,
                    type: exam.type || "私立",
                    faculties: []
                };
                mergedUniversities.push(university);
            }

            if (!university.faculties.find(f => f.id === exam.faculty_id || f.name === exam.faculty)) {
                university.faculties.push({
                    id: exam.faculty_id,
                    name: exam.faculty
                });
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
        const { data: exams, error } = await supabase
            .from('exams')
            .select('*')
            .eq('university_id', universityId);

        if (error) {
            console.error(`Error fetching exams for university ${universityId}:`, error);
            return null;
        }

        if (!exams || exams.length === 0) return null;

        const university = {
            id: exams[0].university_id,
            name: exams[0].university,
            type: exams[0].type || "私立",
            faculties: []
        };

        exams.forEach(exam => {
            let faculty = university.faculties.find(f => f.id === exam.faculty_id || f.name === exam.faculty);

            if (!faculty) {
                faculty = {
                    id: exam.faculty_id || exam.faculty.toLowerCase(),
                    name: exam.faculty,
                    exams: []
                };
                university.faculties.push(faculty);
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
                detailedAnalysis: exam.detailed_analysis,
                structure: exam.structure,
                duration_minutes: exam.duration_minutes
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
        const { data: exams, error } = await supabase
            .from('exams')
            .select('*');

        if (error) {
            console.error('Error fetching exams from Supabase:', error);
            return [];
        }

        const mergedUniversities = [];

        exams.forEach(exam => {
            let university = mergedUniversities.find(u => u.id === exam.university_id || u.name === exam.university);

            if (!university) {
                // Create new university if it doesn't exist
                university = {
                    id: exam.university_id || Date.now(),
                    name: exam.university,
                    type: exam.type || "私立",
                    faculties: []
                };
                mergedUniversities.push(university);
            }

            let faculty = university.faculties.find(f => f.id === exam.faculty_id || f.name === exam.faculty);

            if (!faculty) {
                // Create new faculty if it doesn't exist
                faculty = {
                    id: exam.faculty_id || exam.faculty.toLowerCase(),
                    name: exam.faculty,
                    exams: []
                };
                university.faculties.push(faculty);
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
                detailedAnalysis: exam.detailed_analysis,
                structure: exam.structure,
                duration_minutes: exam.duration_minutes
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
