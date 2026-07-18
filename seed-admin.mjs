import { scrypt, randomBytes } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

async function main() {
  const email = 'admin@lms.com';
  const password = 'admin123@@90!!90';

  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, 64);
  const hash = derivedKey.toString('hex');

  const sql = `
INSERT INTO admin_users (email, password_hash, salt, mfa_enabled)
VALUES ('${email}', '${hash}', '${salt}', false);
  `;
  console.log('--- START SQL ---');
  console.log(sql.trim());
  console.log('--- END SQL ---');
}

main();
