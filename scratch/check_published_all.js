import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function main() {
  const { data, error } = await supabase.from('exams').select('id, university, faculty, faculty_id, subject, is_published');
  
  const wasedaKeio = data.filter(e => e.university.includes('早稲田') || e.university.includes('慶應'));
  console.log("Published:");
  console.log(wasedaKeio.filter(e => e.is_published).map(e => `${e.university} - ${e.faculty}`));
  
  console.log("\nNot Published:");
  console.log(wasedaKeio.filter(e => !e.is_published).map(e => `${e.university} - ${e.faculty}`));
}
main();
