import crypto from 'crypto';

// NC-1/F2: wrap a value to the device's hardware-backed public key (RSA-OAEP).
// oaepHash 'sha1' (OAEP digest + MGF1 = SHA-1) matches the Android app's OAEPParameterSpec —
// required because Android Keystore hard-wires MGF1 to SHA-1 on many devices. Windows/TPM uses
// 'sha256'. Output is single base64. Returns null if the public key can't be parsed.
// Shared by /api/activate (CEK wrapping) and the managed-panel proof-of-possession challenge.
export function wrapToPublicKey(plaintext: string, spkiBase64: string, oaepHash: 'sha1' | 'sha256' = 'sha1'): string | null {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(spkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    // Android (oaepHash 'sha1'): Android Keystore hard-wires MGF1 to SHA-1 on many
    // devices, so SHA-256 OAEP fails on-device with IllegalBlockSizeException.
    // Windows/TPM (oaepHash 'sha256'): the TPM NCryptDecrypt path uses standard
    // OAEP-SHA256. The hash is chosen per platform by the caller. Both securely wrap
    // a 32-byte CEK; only the device's private half (Keystore / TPM) can unwrap.
    const enc = crypto.publicEncrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash },
      Buffer.from(plaintext, 'utf8')
    );
    return enc.toString('base64');
  } catch {
    return null;
  }
}
