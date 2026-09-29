// Runs Next.js as the Lab-Admin app (ADMIN_PANEL=lab → basePath /lab-admin, build dir
// .next-lab, its own login cookie). Same code as LMS-Admin; see src/lib/appPanel.ts.
// Usage (via package.json): npm run dev:lab | npm run build:lab | npm run start:lab
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ADMIN_PANEL: 'lab' },
});
child.on('exit', (code) => process.exit(code ?? 1));
