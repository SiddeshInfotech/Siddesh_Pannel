const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
const supabaseUrl = env.match(/NEXT_PUBLIC_SUPABASE_URL=([^\n]+)/)[1];
const supabaseKey = env.match(/SUPABASE_SERVICE_ROLE_KEY=([^\n]+)/)[1];

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('activation_keys').select('*');
  console.log("Total keys:", data.length);
  const vpschool = data.filter(k => k.key && k.key.includes('VPSCHOOL'));
  console.log("VPSCHOOL keys:", vpschool);
}
check();
