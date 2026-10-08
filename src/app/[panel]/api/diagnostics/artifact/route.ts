import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import { getClientIp } from '@/lib/sanitize';
import { authenticateDevice } from '@/lib/diagnostics/deviceAuth';
import { diagDb, rateLimit } from '@/lib/diagnostics/server';
import { LIMITS, sniffArtifact } from '@/lib/diagnostics/core';

// POST /api/diagnostics/artifact?kind=DUMP|SCREENSHOT|LOG&crash_id=<uuid>
// Body = raw bytes. Headers: X-Activation-Key, X-Device-Fingerprint, X-Product-Id.
// Validated by size + MAGIC BYTES (never trusts extension/MIME); stored in the PRIVATE
// 'diagnostics' bucket under a server-generated path — the client never chooses a path.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bad = (status: number, msg: string) => NextResponse.json({ error: msg }, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind') ?? '';
  const crashId = req.nextUrl.searchParams.get('crash_id') ?? '';
  if (!['DUMP', 'SCREENSHOT', 'LOG'].includes(kind) || !UUID.test(crashId)) return bad(400, 'Bad request.');
  const max = LIMITS.artifactBytes[kind as 'DUMP'];
  if (Number(req.headers.get('content-length') ?? 0) > max) return bad(413, 'Payload too large.');

  const fp = req.headers.get('x-device-fingerprint') ?? '';
  if (!(await rateLimit(`artifact-ip:${getClientIp(req.headers)}`, 3600_000, 30, true)) || !(await rateLimit(`artifact-fp:${fp}`, 3600_000, 10, true))) {
    return bad(429, 'Rate limited.');
  }
  const identity = await authenticateDevice(req.headers.get('x-activation-key') ?? '', fp, req.headers.get('x-product-id') ?? undefined);
  if (!identity) return bad(401, 'Request rejected.');

  const db = diagDb();
  // The crash must exist, belong to THIS device, and be ingested first.
  const { data: crash } = await db.from('diag_crashes').select('id, issue_id, panel, machine_id').eq('id', crashId).maybeSingle();
  if (!crash || crash.panel !== identity.panel || crash.machine_id !== identity.machineId) return bad(404, 'Unknown crash.');
  const { count } = await db.from('diag_artifacts').select('id', { count: 'exact', head: true }).eq('crash_id', crashId);
  if ((count ?? 0) >= 5) return bad(409, 'Artifact limit reached.');

  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length === 0 || buf.length > max) return bad(413, 'Payload too large.');
  const mime = sniffArtifact(kind, buf);
  if (!mime) return bad(415, 'Unsupported file.');

  const sha256 = createHash('sha256').update(buf).digest('hex');
  const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : mime === 'text/plain' ? 'txt' : 'dmp';
  const path = `${identity.panel}/${crashId}/${randomUUID()}.${ext}`;
  const up = await db.storage.from('diagnostics').upload(path, buf, { contentType: mime, upsert: false });
  if (up.error) return bad(503, 'Storage unavailable.');
  const { error } = await db.from('diag_artifacts').insert({
    panel: identity.panel, issue_id: crash.issue_id, crash_id: crashId, kind, storage_path: path, size_bytes: buf.length, sha256, mime,
  });
  if (error) {
    await db.storage.from('diagnostics').remove([path]); // never leave an unreferenced object
    return bad(503, 'Storage unavailable.');
  }
  return NextResponse.json({ ok: true, sha256 });
}
