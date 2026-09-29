// Prints the SQL for ONE Lab-Admin login (lab_admin_users — Lab-Admin's own login table).
// Run the printed line in the Supabase SQL Editor, then sign in at /lab-admin.
//
// Usage: node seed-lab-admin.mjs <email>
// The password is ASKED for (typed twice, not echoed) instead of passed on the command line:
// PowerShell / cmd rewrite characters such as ( ) & % ^ $ in arguments, which silently saved a
// different password than the one typed at sign-in.
import { scrypt, randomBytes } from 'crypto';
import { promisify } from 'util';
import readline from 'readline';

const scryptAsync = promisify(scrypt);

// Line reader that does not echo what is typed (the prompt itself is still shown).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let muted = false;
rl._writeToOutput = (text) => { if (!muted) rl.output.write(text); };

// Buffered line queue: lines that arrive together (paste / piped input) are all kept.
const lines = rl[Symbol.asyncIterator]();

async function askHidden(question) {
  rl.output.write(question);
  muted = true;
  const { value } = await lines.next();
  muted = false;
  rl.output.write('\n');
  return value ?? '';
}

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Usage: node seed-lab-admin.mjs <email>   (you will be asked for the password)');
  process.exit(1);
}

const password = await askHidden('Password (12+ characters): ');
const confirm = await askHidden('Type it again: ');
rl.close();
if (password !== confirm) {
  console.error('Passwords do not match - nothing was printed.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('Password must be at least 12 characters - nothing was printed.');
  process.exit(1);
}

// Same scrypt format as the login route's verifyPassword (salt hex, 64-byte key hex).
const salt = randomBytes(16).toString('hex');
const hash = (await scryptAsync(password, salt, 64)).toString('hex');
const safeEmail = email.replace(/'/g, "''");

console.log('\n-- NEW account: run this');
console.log(`INSERT INTO lab_admin_users (email, password_hash, salt, mfa_enabled)
VALUES ('${safeEmail}', '${hash}', '${salt}', false);`);
console.log('\n-- ...or, if this email ALREADY exists, run this instead to set the new password');
console.log(`UPDATE lab_admin_users SET password_hash = '${hash}', salt = '${salt}',
  mfa_failures = 0, mfa_locked_until = NULL WHERE email = '${safeEmail}';`);
