import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkSchema() {
    console.log('--- Database Schema Check ---');
    
    // Check 'exams' table info by trying to fetch one record
    const { data, error, status } = await supabase
        .from('exams')
        .select('*')
        .limit(1);

    if (error) {
        console.error('❌ Error accessing exams table:', error.message);
        return;
    }

    if (data && data.length > 0) {
        const columns = Object.keys(data[0]);
        console.log('✅ Columns found in "exams" table:');
        columns.forEach(col => console.log(`- ${col}`));
        
        const required = ['detailed_analysis', 'weakness_analysis', 'structure'];
        const missing = required.filter(col => !columns.includes(col));
        
        if (missing.length > 0) {
            console.warn('\n⚠️  MISSING COLUMNS detected:');
            missing.forEach(m => console.log(`  - ${m}`));
            console.log('\nPlease run the SQL provided in the instructions to add these columns.');
        } else {
            console.log('\n🎉 All required persistence columns exist.');
        }
    } else {
        console.log('No data found in exams table, cannot verify columns via select.');
    }

    // Test UPDATE permission (dry run/attempt)
    console.log('\n--- Permission Check ---');
    const testId = data?.[0]?.id;
    if (testId) {
        const { error: updateError } = await supabase
            .from('exams')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', testId);
            
        if (updateError) {
            console.error('❌ UPDATE permission denied:', updateError.message);
            if (updateError.message.includes('policy')) {
                console.log('Cause: RLS Policy is missing or restrictive.');
            }
        } else {
            console.log('✅ UPDATE permission verified (RLS is OK).');
        }
    }
}

checkSchema();
