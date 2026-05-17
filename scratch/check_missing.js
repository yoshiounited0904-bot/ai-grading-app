import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function main() {
  const { data, error } = await supabase.from('exams').select('id, university, faculty, is_published, updated_at');
  const published = data.filter(e => e.is_published);
  console.log("Recently published exams:");
  published.sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));
  console.log(published.slice(0, 10).map(e => `${e.university} - ${e.faculty} (id: ${e.id})`));
}
main();
