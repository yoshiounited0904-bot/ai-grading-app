import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixInconsistentIds() {
    console.log("Fixing inconsistent IDs for 早稲田大学...");
    
    // Update all '早稲田大学' to have university_id = 3
    const { data, error } = await supabase
        .from('exams')
        .update({ university_id: 3 })
        .eq('university', '早稲田大学');

    if (error) {
        console.error("Error updating IDs:", error);
    } else {
        console.log("Successfully unified Early Waseda IDs to 3.");
    }

    // Also check for other potential inconsistencies
    const { data: allExams, error: fetchError } = await supabase
        .from('exams')
        .select('university, university_id');
    
    if (fetchError) {
        console.error("Error fetching all exams:", fetchError);
        return;
    }

    const nameToIds = {};
    allExams.forEach(e => {
        if (!nameToIds[e.university]) nameToIds[e.university] = new Set();
        nameToIds[e.university].add(e.university_id);
    });

    for (const [name, ids] of Object.entries(nameToIds)) {
        if (ids.size > 1) {
            console.warn(`Inconsistency found in ${name}: IDs are ${Array.from(ids).join(', ')}`);
        }
    }
}

fixInconsistentIds();
