import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function main() {
  const { data, error } = await supabase.from('exams').select('university, university_id, faculty').in('university', ['早稲田大学', '慶應義塾大学']);
  const map = {};
  data.forEach(e => {
    map[e.university] = map[e.university] || new Set();
    map[e.university].add(e.university_id);
  });
  console.log(map);
}
main();
