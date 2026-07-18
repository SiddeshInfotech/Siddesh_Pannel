import { scrypt, randomBytes } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

async function main() {
  const users = [
    { email: 'admin1@lms.com', password: 'admin123@@90!!90' },
    { email: 'admin2@lms.com', password: 'admin123@@90!!90' },
    { email: 'admin3@lms.com', password: 'admin123@@90!!90' },
    { email: 'admin4@lms.com', password: 'admin123@@90!!90' },
    { email: 'admin5@lms.com', password: 'admin123@@90!!90' }
  ];

  console.log('--- START SQL ---');
  for (const user of users) {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = await scryptAsync(user.password, salt, 64);
    const hash = derivedKey.toString('hex');

    const sql = `INSERT INTO admin_users (email, password_hash, salt, mfa_enabled)
VALUES ('${user.email}', '${hash}', '${salt}', false);`;
    console.log(sql);
  }
  console.log('--- END SQL ---');
}

main();
