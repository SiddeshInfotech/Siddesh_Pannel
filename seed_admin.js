const { createClient } = require('@supabase/supabase-js');
const { scryptSync, randomBytes } = require('crypto');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
const supabaseUrl = env.match(/NEXT_PUBLIC_SUPABASE_URL=([^\n]+)/)[1];
const supabaseKey = env.match(/SUPABASE_SERVICE_ROLE_KEY=([^\n]+)/)[1];

const supabase = createClient(supabaseUrl, supabaseKey);

function hashPasswordSync(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, 64);
  return {
    hash: derivedKey.toString('hex'),
    salt,
  };
}

async function seedAdmin() {
  const email = 'admin@lms.com';
  const password = 'admin123@@90!!90';
  
  const { hash, salt } = hashPasswordSync(password);
  
  const { data, error } = await supabase.from('admin_users').insert([{
    email: email,
    password_hash: hash,
    salt: salt,
    mfa_enabled: false,
    totp_secret: null,
    mfa_failures: 0,
    mfa_locked_until: null,
  }]).select();

  if (error) {
    console.error("Error inserting admin user:", error);
  } else {
    console.log("Admin user successfully seeded!", data);
  }
}

seedAdmin();
