import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function checkPassingLines() {
  const { data, error } = await supabase
    .from('exams')
    .select('id, university, faculty, passing_lines, duration_minutes')
    .not('passing_lines', 'is', null)
    .limit(5);

  if (error) {
    console.error(error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

checkPassingLines();
