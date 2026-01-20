import { createClient } from '@supabase/supabase-js';
import { type Database } from '../types/supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase credentials missing. Please check your .env file.');
}

// Client com tipagem forte do banco
import { type SupabaseClient } from '@supabase/supabase-js';
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '') as SupabaseClient<Database>;
