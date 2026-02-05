const https = require('https');

const url = "https://cgebiryqfqheyazwtzzm.supabase.co/rest/v1/import_ocr_jobs?select=id,job_id,status,last_error,started_at,completed_at,locked_by,lock_expires_at,retry_count,updated_at&order=updated_at.desc&limit=50";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const options = {
    headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
    }
};

https.get(url, options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.table(json);
        } catch (e) {
            console.log("Raw Response:", data);
        }
    });
}).on("error", (err) => {
    console.log("Error: " + err.message);
});
