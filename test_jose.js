const { SignJWT, jwtVerify, importPKCS8, importSPKI } = require('jose');
const fs = require('fs');

async function test() {
  const env = fs.readFileSync('.env', 'utf8');
  const match = env.match(/PRIVATE_KEY=\"?([^\"]+)\"?/);
  const privateKeyPem = match[1].replace(/\\n/g, '\n');

  function extractPublicKeyFromPrivateKey(privKeyPem) {
    const base64 = privKeyPem
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s+/g, '');
    
    const binaryString = atob(base64);
    const der = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      der[i] = binaryString.charCodeAt(i);
    }
    let pubKeyOffset = -1;
    for (let i = 0; i < der.length - 4; i++) {
      if (der[i] === 0x03 && der[i+1] === 0x42 && der[i+2] === 0x00 && der[i+3] === 0x04) {
        pubKeyOffset = i;
        break;
      }
    }
    if (pubKeyOffset === -1) throw new Error('Could not find public key coordinates in private key DER');
    const bitStringLength = 2 + 66; 
    const bitString = der.subarray(pubKeyOffset, pubKeyOffset + bitStringLength);
    const spkiPrefix = new Uint8Array([
      0x30, 0x59, 
      0x30, 0x13, 
      0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 
      0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 
    ]);
    const spkiDer = new Uint8Array(spkiPrefix.length + bitString.length);
    spkiDer.set(spkiPrefix, 0);
    spkiDer.set(bitString, spkiPrefix.length);
    let bin = '';
    for (let i = 0; i < spkiDer.length; i++) {
      bin += String.fromCharCode(spkiDer[i]);
    }
    const spkiBase64 = btoa(bin);
    const matches = spkiBase64.match(/.{1,64}/g);
    const formattedBase64 = matches ? matches.join('\n') : spkiBase64;
    return '-----BEGIN PUBLIC KEY-----\n' + formattedBase64 + '\n-----END PUBLIC KEY-----\n';
  }

  const publicKeyPem = extractPublicKeyFromPrivateKey(privateKeyPem);
  
  try {
    const signingKey = await importPKCS8(privateKeyPem, 'ES256');
    const token = await new SignJWT({ email: 'test@test.com', purpose: 'mfa-challenge', nonce: '123' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuedAt()
      .setIssuer('siddesh-lms-admin')
      .setAudience('siddesh-lms-client')
      .setExpirationTime('2m')
      .sign(signingKey);
      
    console.log("Token signed successfully:", token);
    
    const verificationKey = await importSPKI(publicKeyPem, 'ES256');
    const { payload } = await jwtVerify(token, verificationKey, {
      issuer: 'siddesh-lms-admin',
      audience: 'siddesh-lms-client',
    });
    console.log("Token verified successfully:", payload);
  } catch (err) {
    console.error("Verification failed:", err);
  }
}

test();
