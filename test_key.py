import re
import base64
import os

def test_key_extraction():
    try:
        with open('.env', 'r') as f:
            env_content = f.read()
            
        match = re.search(r'PRIVATE_KEY="?([^"]+)"?', env_content)
        if not match:
            print("No PRIVATE_KEY found in .env")
            return
            
        private_key_pem = match.group(1).replace('\\n', '\n')
        
        base64_str = private_key_pem.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace('\n', '').replace(' ', '')
        
        der = bytearray(base64.b64decode(base64_str))
        
        pub_key_offset = -1
        for i in range(len(der) - 4):
            if der[i] == 0x03 and der[i+1] == 0x42 and der[i+2] == 0x00 and der[i+3] == 0x04:
                pub_key_offset = i
                break
                
        if pub_key_offset == -1:
            print("Failed: Could not find public key coordinates in private key DER")
            return
            
        bit_string_length = 2 + 66
        bit_string = der[pub_key_offset:pub_key_offset + bit_string_length]
        
        spki_prefix = bytearray([
            0x30, 0x59,
            0x30, 0x13,
            0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
            0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
        ])
        
        spki_der = spki_prefix + bit_string
        spki_base64 = base64.b64encode(spki_der).decode('utf-8')
        
        chunks = [spki_base64[i:i+64] for i in range(0, len(spki_base64), 64)]
        formatted_base64 = '\n'.join(chunks)
        
        pub_key = '-----BEGIN PUBLIC KEY-----\n' + formatted_base64 + '\n-----END PUBLIC KEY-----\n'
        print("Success! Extracted Public Key:")
        print(pub_key)
        
    except Exception as e:
        print(f"Exception: {e}")

test_key_extraction()
