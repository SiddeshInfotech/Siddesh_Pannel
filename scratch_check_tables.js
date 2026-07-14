const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
const supabaseUrl = envFile.match(/SUPABASE_URL=([^\n\r]+)/)[1];
const supabaseKey = envFile.match(/SUPABASE_SERVICE_ROLE_KEY=([^\n\r]+)/)[1];

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  // Let's run a query to information_schema if possible, or query some known tables
  // In Supabase, we can inspect tables by querying them, or if there's an RPC we can use it.
  const { data, error } = await supabase.rpc('get_tables');
  if (error) {
    console.log("RPC get_tables not available:", error.message);
  } else {
    console.log("Tables list:", data);
  }
}
check();
