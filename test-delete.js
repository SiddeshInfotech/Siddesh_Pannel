/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envFile = fs.readFileSync('d:/1st_To_4th/अन्न व निवारा/Siddesh_Pannel-main/.env', 'utf8');
envFile.split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if(k && v.length) {
    process.env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
  }
});

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testDelete() {
  const { data: vendors } = await supabase.from('vendors').select('vendor_id').limit(1);
  if (!vendors || vendors.length === 0) {
    console.log("No vendors found");
    return;
  }
  const target = vendors[0].vendor_id;
  console.log("Attempting to delete vendor:", target);

  const res = await supabase.from('vendors').delete().eq('vendor_id', target);
  console.log("Delete result error:", res.error);
}

testDelete();
