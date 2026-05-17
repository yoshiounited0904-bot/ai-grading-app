import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function testPublish() {
  const { data, error } = await supabase
    .from('exams')
    .update({ is_published: true })
    .match({ id: 'keio-econ-eng-2025' }); // Use a known ID

  if (error) {
    console.log("Error (expected if column missing):", error.message);
  } else {
    console.log("Success! Column exists.");
  }
}

testPublish();
