import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { createContentGrant } from '../contentGrant';

const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const signing = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const input = {
  productId: 'LMS_SCHOOL_WINDOWS', fingerprint: 'test-device',
  activationKeyId: 'test-licence',
  publicKeyBase64: rsa.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  issuedAt: '2026-10-09T00:00:00Z', expiresAt: '2027-10-09T00:00:00Z',
  wrappedScopes: { 'class_1/English': 'd3JhcHBlZA==' },
};
const sign = (text: string) => crypto.sign('sha256', Buffer.from(text), signing.privateKey).toString('base64');
describe('content grants', () => {
  it('binds the signed envelopes to the RSA recipient and Windows product', () => {
    const result = createContentGrant(input, sign)!;
    expect(crypto.verify('sha256', Buffer.from(result.grant_str), signing.publicKey, Buffer.from(result.grant_signature, 'base64'))).toBe(true);
    const grant = JSON.parse(result.grant_str);
    expect(grant.recipient_sha256).toBe(crypto.createHash('sha256').update(rsa.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'));
    expect(grant.product_id).toBe('LMS_SCHOOL_WINDOWS');
    expect(grant.scopes).toEqual(input.wrappedScopes);
    expect(grant.wk0).toBeUndefined();
  });
  it('invalidates the signature after envelope substitution', () => {
    const result = createContentGrant(input, sign)!;
    const changed = result.grant_str.replace('d3JhcHBlZA==', 'c3Vic3RpdHV0ZWQ=');
    expect(crypto.verify('sha256', Buffer.from(changed), signing.publicKey, Buffer.from(result.grant_signature, 'base64'))).toBe(false);
  });
  it('does not change the separate Lab protocol', () => {
    expect(createContentGrant({ ...input, productId: 'LMS_LAB_WINDOWS' }, sign)).toBeNull();
  });
  it('rejects a master envelope disguised as a scope', () => {
    expect(() => createContentGrant({ ...input, wrappedScopes: { wk0: 'd3JhcHBlZA==' } }, sign)).toThrow();
  });
  it('rejects non-RSA recipients and reversed expiry', () => {
    const pub = signing.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    expect(() => createContentGrant({ ...input, publicKeyBase64: pub }, sign)).toThrow();
    expect(() => createContentGrant({ ...input, expiresAt: input.issuedAt }, sign)).toThrow();
  });
});
