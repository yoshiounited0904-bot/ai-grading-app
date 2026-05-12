import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkWaseda() {
    console.log("Checking for Waseda exams...");
    const { data, error } = await supabase
        .from('exams')
        .select('*')
        .ilike('university', '%早稲田%');

    if (error) {
        console.error("Error:", error);
        return;
    }

    if (!data || data.length === 0) {
        console.log("No Waseda exams found.");
    } else {
        console.log(`Found ${data.length} Waseda exams:`);
        data.forEach(exam => {
            console.log(`- ID: ${exam.id}, Univ: ${exam.university} (ID: ${exam.university_id}), Faculty: ${exam.faculty}, Year: ${exam.year}, Subject: ${exam.subject}`);
        });
    }
}

checkWaseda();
