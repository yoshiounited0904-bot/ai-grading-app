import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testUpload() {
    console.log('--- Actual Upload Test ---');
    const dummyBlob = new Blob(['test content'], { type: 'text/plain' });
    const fileName = `test_connection_${Date.now()}.txt`;
    
    console.log(`Attempting to upload to: exam-images/${fileName}`);
    
    const { data, error } = await supabase.storage
        .from('exam-images')
        .upload(fileName, dummyBlob);

    if (error) {
        console.error('❌ UPLOAD FAILED.');
        console.error('Error Message:', error.message);
        console.error('Error Details:', JSON.stringify(error, null, 2));
        
        if (error.message === 'Bucket not found') {
            console.log('\n--- DIAGNOSIS ---');
            console.log('やっぱりバケットが見つかりません。');
            console.log(`接続先プロジェクト: ${supabaseUrl}`);
            console.log('原因として考えられること:');
            console.log('1. 名前のスペルミス (ハイフン - とアンダーバー _ の間違いなど)');
            console.log('2. 別のプロジェクト画面で作業している (URLの末尾が一致しているか要確認)');
        }
    } else {
        console.log('✅ UPLOAD SUCCESSFUL!');
        console.log('Bucket exists and permissions are correct.');
    }
}

testUpload();
