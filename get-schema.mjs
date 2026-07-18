import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env');
const envFile = fs.readFileSync(envPath, 'utf8');
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
});

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: p } = await supabaseAdmin.from('payments').select('*').limit(1);
  const { data: k } = await supabaseAdmin.from('activation_keys').select('*').limit(1);
  
  console.log('Payments:', p ? Object.keys(p[0] || {}) : 'null');
  console.log('Keys:', k ? Object.keys(k[0] || {}) : 'null');
}
main();
