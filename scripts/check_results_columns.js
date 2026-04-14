import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkColumns() {
    const { data, error } = await supabase.from('exam_results').select('*').limit(1);
    if (error) {
        console.error('Error:', error.message);
        return;
    }
    if (data && data.length > 0) {
        console.log('--- Columns in exam_results ---');
        Object.keys(data[0]).forEach(col => console.log(`- ${col}`));
    } else {
        console.log('No records found in exam_results.');
    }
}
checkColumns();
