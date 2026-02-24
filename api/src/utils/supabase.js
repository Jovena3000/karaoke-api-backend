const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY; // ⚠️ Use a service_role key (não a anon!)

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials não configuradas');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
