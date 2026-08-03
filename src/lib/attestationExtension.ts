// attestationExtension.ts — minimal, defensive DER reader for the Android Key
// Attestation extension (OID 1.3.6.1.4.1.11129.2.1.17).
//
// We do NOT pull in a full ASN.1 library: this reads only the few fields we need
// and is written to FAIL SAFE — any malformed/unexpected structure returns null
// (or leaves a field undefined) rather than throwing, so the caller can fall back
// to the existing checks instead of rejecting a legitimate device.
//
// KeyDescription ::= SEQUENCE {
//   attestationVersion        INTEGER,
//   attestationSecurityLevel  ENUMERATED,        -- 0=Software 1=TEE 2=StrongBox
//   keymasterVersion          INTEGER,
//   keymasterSecurityLevel    ENUMERATED,
//   attestationChallenge      OCTET_STRING,       -- our request-bound challenge
//   uniqueId                  OCTET_STRING,
//   softwareEnforced          AuthorizationList,
//   teeEnforced               AuthorizationList,  -- origin lives here, tag [702]
// }

// DER of OID 1.3.6.1.4.1.11129.2.1.17 (tag 06, len 0a, then the value bytes).
const ATTEST_OID_BYTES = Buffer.from([
  0x06, 0x0a, 0x2b, 0x06, 0x01, 0x04, 0x01, 0xd6, 0x79, 0x02, 0x01, 0x11,
]);

// Keymaster Tag::ORIGIN = 702 → context-tag [702] = bytes BF 85 3E.
const ORIGIN_TAG = Buffer.from([0xbf, 0x85, 0x3e]);

export const SECURITY_LEVEL = { SOFTWARE: 0, TEE: 1, STRONGBOX: 2 } as const;
export const KEY_ORIGIN = { GENERATED: 0, DERIVED: 1, IMPORTED: 2, UNKNOWN: 3 } as const;

export interface ParsedAttestation {
  challenge: Buffer;
  securityLevel: number;       // attestationSecurityLevel
  origin?: number;             // from teeEnforced/softwareEnforced AuthorizationList
}

function readLen(buf: Buffer, p: number): { len: number; next: number } | null {
  if (p >= buf.length) return null;
  const b = buf[p++];
  if ((b & 0x80) === 0) return { len: b, next: p };
  const n = b & 0x7f;
  if (n === 0 || n > 4 || p + n > buf.length) return null; // reject indefinite/oversized
  let len = 0;
  for (let i = 0; i < n; i++) len = (len << 8) | buf[p++];
  return { len, next: p };
}

interface TLV { tag: number; tagLen: number; cstart: number; clen: number; end: number }

// Read one TLV starting at p. Handles multi-byte (high-tag-number) tags.
function readTLV(buf: Buffer, p: number): TLV | null {
  if (p >= buf.length) return null;
  const tagStart = p;
  const t = buf[p++];
  if ((t & 0x1f) === 0x1f) {
    // high-tag-number form: subsequent bytes until one without the 0x80 bit
    while (p < buf.length && (buf[p] & 0x80) !== 0) p++;
    p++; // final tag byte
  }
  const tagLen = p - tagStart;
  const lr = readLen(buf, p);
  if (!lr) return null;
  const end = lr.next + lr.len;
  if (end > buf.length) return null;
  return { tag: t, tagLen, cstart: lr.next, clen: lr.len, end };
}

function tagBytesMatch(buf: Buffer, at: number, pattern: Buffer): boolean {
  if (at + pattern.length > buf.length) return false;
  for (let i = 0; i < pattern.length; i++) if (buf[at + i] !== pattern[i]) return false;
  return true;
}

// Walk an AuthorizationList SEQUENCE looking for the [702] origin entry.
function findOrigin(buf: Buffer, list: TLV): number | undefined {
  let p = list.cstart;
  while (p < list.end) {
    const tagAt = p;
    const tlv = readTLV(buf, p);
    if (!tlv) return undefined;
    if (tagBytesMatch(buf, tagAt, ORIGIN_TAG)) {
      // [702] EXPLICIT → inner INTEGER
      const inner = readTLV(buf, tlv.cstart);
      if (inner && inner.tag === 0x02 && inner.clen >= 1) return buf[inner.cstart];
      return undefined;
    }
    p = tlv.end;
  }
  return undefined;
}

/**
 * Extract challenge / securityLevel / origin from a leaf attestation certificate DER.
 * Returns null if the extension is absent or cannot be parsed (caller falls back).
 */
export function parseAttestationExtension(leafDer: Buffer): ParsedAttestation | null {
  try {
    const oidIdx = leafDer.indexOf(ATTEST_OID_BYTES);
    if (oidIdx === -1) return null;

    const p = oidIdx + ATTEST_OID_BYTES.length;
    let tlv = readTLV(leafDer, p);
    if (!tlv) return null;
    if (tlv.tag === 0x01) {           // optional 'critical' BOOLEAN
      tlv = readTLV(leafDer, tlv.end);
      if (!tlv) return null;
    }
    if (tlv.tag !== 0x04) return null; // expect OCTET STRING wrapping KeyDescription
    const kd = leafDer.subarray(tlv.cstart, tlv.end);

    const seq = readTLV(kd, 0);
    if (!seq || seq.tag !== 0x30) return null;

    const fields: TLV[] = [];
    let q = seq.cstart;
    while (q < seq.end && fields.length < 8) {
      const f = readTLV(kd, q);
      if (!f) break;
      fields.push(f);
      q = f.end;
    }
    if (fields.length < 5) return null;

    // [1] attestationSecurityLevel ENUMERATED (single byte), [4] attestationChallenge.
    if (fields[1].clen < 1 || fields[4].clen < 1) return null;
    const securityLevel = kd[fields[1].cstart];
    const challenge = Buffer.from(kd.subarray(fields[4].cstart, fields[4].end));

    let origin: number | undefined;
    if (fields.length >= 8) origin = findOrigin(kd, fields[7]);   // teeEnforced
    if (origin === undefined && fields.length >= 7) origin = findOrigin(kd, fields[6]); // softwareEnforced

    return { challenge, securityLevel, origin };
  } catch {
    return null; // fail safe — never throw into the verifier
  }
}
