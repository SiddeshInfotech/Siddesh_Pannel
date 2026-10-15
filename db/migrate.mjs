#!/usr/bin/env node
// ============================================================================
// Database migration runner — used by the CI/CD pipeline (.github/workflows/deploy.yml)
// and by hand. Applies db/migrations/*.sql in filename order, each exactly once.
//
//   node db/migrate.mjs check             validate the files only (no database; used by CI)
//   node db/migrate.mjs status            list applied / pending migrations
//   node db/migrate.mjs up                apply every pending migration
//   node db/migrate.mjs baseline <file>   record <file> as applied WITHOUT running it
//                                              (for a migration already run by hand)
//
// Env: DATABASE_URL  Postgres connection string (Supabase: the SESSION pooler, port 5432, or
//                    the direct connection — NOT the transaction pooler on 6543).
//      DB_CA_CERT    optional PEM of the server CA; when set, the TLS certificate is verified.
//
// Rules: each file runs in ONE transaction together with its bookkeeping row, so a failed
// migration leaves nothing behind. Files must therefore not contain their own BEGIN/COMMIT.
// An applied file must never be edited (its checksum is checked) — add a new file instead.
// The connection string is never printed.
// ============================================================================

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const LOCK_KEY = 726_360_001; // pg_advisory_lock id: one migration run at a time per database

// Errors are thrown (not process.exit) so `finally` always closes the connection cleanly.
const die = (msg) => { throw new Error(msg); };

function connectionConfig() {
  const raw = process.env.DATABASE_URL;
  if (!raw) die('DATABASE_URL is not set.');
  let url;
  try { url = new URL(raw); } catch { die('DATABASE_URL is not a valid URL.'); }
  if (url.port === '6543') die('DATABASE_URL uses the transaction pooler (6543); use the session pooler (5432) or the direct connection.');
  // pg lets sslmode in the URL override the ssl option below — strip it so TLS is decided here.
  for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(k);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  let ssl = false;
  if (process.env.DB_CA_CERT) ssl = { ca: process.env.DB_CA_CERT, rejectUnauthorized: true };
  else if (!local) {
    ssl = { rejectUnauthorized: false };
    console.warn('migrate: TLS on, certificate NOT verified (set DB_CA_CERT to verify).');
  }
  return { connectionString: url.toString(), ssl, application_name: 'siddesh-migrate' };
}

function migrationFiles() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      // Normalise line endings so a Windows checkout has the same checksum as CI.
      const sql = readFileSync(join(DIR, name), 'utf8').replace(/\r\n/g, '\n');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

/** Statement-level BEGIN/COMMIT/ROLLBACK would end the runner's transaction early. */
export function ownTransactionControl(sql) {
  const code = sql.replace(/--[^\n]*/g, '');
  // (Not `END;` — that also closes plpgsql blocks.)
  return /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)\s*;/im.test(code);
}

async function main() {
  const [cmd = 'status', arg] = process.argv.slice(2);
  if (!['check', 'status', 'up', 'baseline'].includes(cmd)) die(`unknown command "${cmd}" (check | status | up | baseline <file>)`);

  const files = migrationFiles();
  for (const f of files) {
    if (!/^\d{8}_\d{2}_[a-z0-9_]+\.sql$/.test(f.name)) die(`${f.name}: name must be YYYYMMDD_NN_description.sql (lower-case).`);
    if (ownTransactionControl(f.sql)) die(`${f.name} contains BEGIN/COMMIT — remove it, the runner wraps each file in a transaction.`);
  }
  if (cmd === 'check') { console.log(`${files.length} migration file(s) OK.`); return; } // offline (CI)

  const client = new pg.Client(connectionConfig());
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      applied_by text,
      baseline   boolean NOT NULL DEFAULT false
    )`);
    await client.query('ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY'); // server-only

    const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations');
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

    for (const [name, sum] of applied) {
      const f = files.find((x) => x.name === name);
      if (f && f.checksum !== sum) die(`${name} was changed after it was applied. Revert it and add a new migration instead.`);
    }
    const pending = files.filter((f) => !applied.has(f.name));
    const by = process.env.GITHUB_ACTOR ? `${process.env.GITHUB_ACTOR}@${(process.env.GITHUB_SHA ?? '').slice(0, 7)}` : 'manual';

    if (cmd === 'status') {
      for (const f of files) console.log(`${applied.has(f.name) ? 'applied ' : 'PENDING '} ${f.name}`);
      console.log(`${pending.length} pending.`);
      return;
    }

    if (cmd === 'baseline') {
      const f = files.find((x) => x.name === arg);
      if (!f) die(`baseline: no migration named "${arg}".`);
      if (applied.has(f.name)) { console.log(`${f.name} is already recorded.`); return; }
      await client.query('INSERT INTO schema_migrations (filename, checksum, applied_by, baseline) VALUES ($1, $2, $3, true)', [f.name, f.checksum, by]);
      console.log(`recorded ${f.name} as applied (not run).`);
      return;
    }

    if (!pending.length) { console.log('Database is up to date.'); return; }
    for (const f of pending) {
      process.stdout.write(`applying ${f.name} … `);
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '15s'"); // never queue behind live traffic for long
        await client.query("SET LOCAL statement_timeout = '10min'");
        await client.query(f.sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum, applied_by) VALUES ($1, $2, $3)', [f.name, f.checksum, by]);
        await client.query('COMMIT');
        console.log('done');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log('FAILED');
        die(`${f.name}: ${err.message} — rolled back, nothing from this file was applied.`);
      }
    }
    console.log(`${pending.length} migration(s) applied.`);
  } finally {
    await client.end().catch(() => {});
  }
}

// Only run when executed directly (tests import ownTransactionControl).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`migrate: ${err.message}`);
    process.exitCode = 1;
  });
}
