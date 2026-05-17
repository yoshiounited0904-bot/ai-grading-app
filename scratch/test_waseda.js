import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function main() {
    const { data: exams, error } = await supabase
        .from('exams')
        .select('*')
        .in('university', ['早稲田大学', '慶應義塾大学'])
        .eq('is_published', true);

    if (error) {
        console.error("Error:", error);
        return;
    }

    const mergedUniversities = [];

    exams.forEach(exam => {
        let university = mergedUniversities.find(u => u.id === exam.university_id || u.name === exam.university);

        if (!university) {
            university = {
                id: exam.university_id,
                name: exam.university,
                faculties: []
            };
            mergedUniversities.push(university);
        }

        let faculty = university.faculties.find(f => f.id === exam.faculty_id || f.name === exam.faculty);

        if (!faculty) {
            faculty = {
                id: exam.faculty_id || exam.faculty.toLowerCase(),
                name: exam.faculty,
                exams: []
            };
            university.faculties.push(faculty);
        }
        faculty.exams.push(exam);
    });

    mergedUniversities.forEach(u => {
        console.log(`\n=== ${u.name} ===`);
        u.faculties.forEach(f => {
            console.log(`  ${f.name} (ID: ${f.id}, Exams: ${f.exams.length})`);
        });
    });
}
main();
