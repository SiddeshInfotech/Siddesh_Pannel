const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
const supabaseUrl = env.match(/NEXT_PUBLIC_SUPABASE_URL=([^\n]+)/)[1];
const supabaseKey = env.match(/SUPABASE_SERVICE_ROLE_KEY=([^\n]+)/)[1];

const supabase = createClient(supabaseUrl, supabaseKey);

async function reset() {
  const { data, error } = await supabase.from('admin_users').update({ mfa_enabled: false, totp_secret: null }).eq('email', 'admin@lms.com');
  console.log("Reset MFA:", error || data);
}
reset();
