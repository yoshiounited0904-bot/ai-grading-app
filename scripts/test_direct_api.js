import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const apiKey = process.env.VITE_GEMINI_API_KEY_V2 || process.env.VITE_GEMINI_API_KEY;

async function testEndpoint(version, model) {
    const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${apiKey}`;
    console.log(`\nTesting ${version} with model ${model}...`);
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: "Hello" }] }]
            })
        });

        const data = await response.json();
        if (response.ok) {
            console.log(`✅ ${version}/${model} Success!`);
        } else {
            console.error(`❌ ${version}/${model} Failed (${response.status}):`, data.error?.message || JSON.stringify(data));
        }
    } catch (err) {
        console.error(`❌ ${version}/${model} Network Error:`, err.message);
    }
}

async function runTests() {
    if (!apiKey) {
        console.error("API Key not found in .env");
        return;
    }

    // Test combinations
    await testEndpoint('v1beta', 'gemini-2.5-flash');
    await testEndpoint('v1beta', 'gemini-flash-latest');
    await testEndpoint('v1', 'gemini-2.5-flash');
    await testEndpoint('v1', 'gemini-2.5-pro');
}

runTests();
