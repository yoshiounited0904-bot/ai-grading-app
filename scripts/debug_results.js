import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function debugData() {
    console.log("Fetching raw result data...");
    const { data, error } = await supabase.from('exam_results').select('*').limit(3).order('created_at', { ascending: false });
    
    if (error) {
        console.error("DB Error:", error);
        return;
    }
    
    console.log("Raw Records Found:", data.length);
    data.forEach((r, i) => {
        console.log(`\n[Record ${i+1}] ${r.university_name}:`);
        console.log(`- faculty_name: ${r.faculty_name}`);
        console.log(`- exam_subject: ${r.exam_subject}`);
        console.log("- All Keys:", Object.keys(r).join(", "));
    });
}
debugData();
