import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function main() {
  const { data, error } = await supabase.from('exams').select('university, faculty, subject, is_published');
  console.log(data.filter(e => e.is_published).map(e => `${e.university} - ${e.faculty} - ${e.subject}`));
}
main();
