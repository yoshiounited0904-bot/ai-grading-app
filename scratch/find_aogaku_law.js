import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function findAogakuLaw() {
  const { data, error } = await supabase
    .from('exams')
    .select('id, university, faculty, subject, max_score, duration_minutes, passing_lines')
    .ilike('university', '%青山学院%')
    .ilike('faculty', '%法学部%');

  if (error) {
    console.error(error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

findAogakuLaw();
