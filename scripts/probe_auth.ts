
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Manual ENV parser
const envPath = path.resolve(process.cwd(), '.env.local');
let envs: Record<string, string> = {};

try {
    const file = fs.readFileSync(envPath, 'utf-8');
    file.split('\n').forEach(line => {
        const [key, val] = line.split('=');
        if (key && val) envs[key.trim()] = val.trim();
    });
} catch (e) {
    console.log("Could not read .env.local", e);
}

const supabaseUrl = envs['VITE_SUPABASE_URL'] || process.env.VITE_SUPABASE_URL;
const supabaseKey = envs['VITE_SUPABASE_ANON_KEY'] || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase Credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function probeAuth() {
    console.log("Probing Auth & Database Connection...");

    // 1. Try public read (if any)
    const { data: publicData, error: publicError } = await supabase.from('budgets').select('count').limit(1);
    console.log("Public Read Budgets:", publicError ? `Error: ${publicError.message}` : "Success (Count)");

    // 2. Try to Sign Up a Test User
    const email = `e2e_test_${Date.now()}@naborca.com`;
    const password = "Password123!";

    console.log(`Attempting SignUp: ${email}`);
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password
    });

    if (signUpError) {
        console.error("SignUp Error:", signUpError.message);
    } else {
        console.log("SignUp Success User ID:", signUpData.user?.id);
        if (signUpData.session) {
            console.log("Session received immediately! (Auto-Confirm ON)");
            console.log("CREDENTIALS_JSON:", JSON.stringify({ email, password }));
        } else {
            console.log("Alert: No Session. Email Verification likely required.");
            // Try to delete to clean up? No, can't delete without admin.
        }
    }
}

probeAuth();
