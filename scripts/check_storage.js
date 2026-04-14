import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Error: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not found in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkStorage() {
    console.log('--- Supabase Storage Check ---');
    console.log(`URL: ${supabaseUrl}`);
    
    // Check if bucket exists
    const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
    
    if (bucketError) {
        console.error('Failed to list buckets:', bucketError.message);
        console.log('\nPossible causes:');
        console.log('1. Authentication error (Invalid Key)');
        console.log('2. Network connectivity issues');
        return;
    }

    const examBucket = buckets.find(b => b.name === 'exam-images');
    
    if (examBucket) {
        console.log('✅ Bucket "exam-images" found.');
        console.log(`   Public: ${examBucket.public ? 'YES' : 'NO (Action Required: Set to Public)'}`);
        
        if (!examBucket.public) {
            console.warn('\n⚠️  WARNING: Bucket is PRIVATE. Images will not display on the web.');
            console.log('Please go to Supabase Dashboard > Storage > exam-images > "Make public".');
        } else {
            console.log('\n🎉 Storage is correctly configured!');
        }
    } else {
        console.error('❌ Bucket "exam-images" NOT FOUND.');
        if (buckets.length > 0) {
            console.log('\nExisting buckets found:');
            buckets.forEach(b => console.log(`- ${b.name} (${b.public ? 'Public' : 'Private'})`));
            console.log('\nIf you meant one of these, please check the name settings.');
        } else {
            console.log('\nNo buckets found at all in this project.');
        }
        
        console.log('\nPlease create the bucket in your Supabase Dashboard:');
        console.log('1. Go to Storage');
        console.log('2. Click "New Bucket"');
        console.log('3. Name: exam-images (Must be EXACTLY this name)');
        console.log('4. Toggle "Public bucket" to ON');
    }
}

checkStorage();
