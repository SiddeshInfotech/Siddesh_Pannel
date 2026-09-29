#!/usr/bin/env python3
"""
LMS Enterprise Video Encryption Utility
Algorithm: AES-256-CTR (Counter Mode) + HMAC-SHA256 Integrity Verification
Secure Chunking: 8MB RAM buffer per worker for high throughput
Safe & Resumable: writes to .enc.part then atomically renames to .enc, so an
interrupted run never leaves a broken video; a re-run skips finished files and
re-encrypts only the interrupted/missing ones. Batch modes run in parallel.
Author: Antigravity AI
"""

import os
import sys
import base64
import hashlib
import hmac
import secrets
import threading
import time
import concurrent.futures
from typing import Tuple

# Attempt to import pycryptodome or cryptography package
try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
    HAS_CRYPTOGRAPHY = True
except ImportError:
    try:
        from Crypto.Cipher import AES  # type: ignore
        from Crypto.Util import Counter  # type: ignore
        HAS_CRYPTOGRAPHY = False
    except ImportError:
        print("❌ ERROR: Cryptography library is missing!")
        print("Please install one of the required libraries using pip:")
        print("   pip install cryptography")
        print("   OR")
        print("   pip install pycryptodome")
        sys.exit(1)

CHUNK_SIZE = 8 * 1024 * 1024  # 8MB chunks: keeps disk I/O sequential and AES-NI saturated
DEFAULT_WORKERS = os.cpu_count() or 4           # parallel files; AES/SHA release the GIL so threads scale

_print_lock = threading.Lock()
LOG_FILE = "encryption_log.txt"

def _log(msg: str):
    """Thread-safe print so parallel workers don't interleave lines, logs to file as well."""
    with _print_lock:
        print(msg, flush=True)
        try:
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(msg + "\n")
        except:
            pass

# SHA-256 of the production signing fingerprint (lms-release-prod.jks,
# EA:CA:2B:84:...:6E:29). The app derives this same value at runtime from the
# running APK's signature (SecurityChecks.getContentKeyBinding). Folding it into
# the key derivation binds every encrypted file to the genuine signing key: a
# repackaged/re-signed APK computes a different binding -> wrong key -> the file
# will not decrypt. Keep this in lock-step with the app constant.
CONTENT_KEY_BINDING = bytes.fromhex(
    "f599c227b72ad56f51d50eeda30d568e83c118650572ca9f7259ae0a67a3b726"
)

def derive_keys(passphrase: str, salt: bytes) -> Tuple[bytes, bytes]:
    """
    Derives cryptographically separated keys for AES encryption and HMAC integrity
    from a single passphrase using PBKDF2-HMAC-SHA256, bound to the APK signature.
    """
    master_seed = hashlib.pbkdf2_hmac('sha256', passphrase.encode('utf-8'), salt, 100000)
    bound = hashlib.sha256(master_seed + CONTENT_KEY_BINDING).digest()
    aes_key = hashlib.sha256(bound + b"enc").digest()
    hmac_key = hashlib.sha256(bound + b"hmac").digest()
    return aes_key, hmac_key


LAB_SCOPE_BY_FOLDER = {
    'electronics': 'course_1',
    'robotics': 'course_2',
    'iot': 'course_3',
    'ai': 'course_4',
    'drone': 'course_5',
    '3d-printing': 'course_6',
    '3d_printing': 'course_6',
    '3d printing': 'course_6',
    'ar': 'course_7',
    'vr': 'course_8',
    'mr': 'course_9',
    # Added 2026-09-11 — keep in lock-step with the app's LAB_SCOPE_BY_PATH_SEGMENT
    # (DeviceActivation.kt) and the server's LAB_COURSES (Siddesh_Pannel src/lib/labCourses.ts).
    'scratch': 'course_10',
    'scratch-programming': 'course_10',
    'scratch_programming': 'course_10',
    'c-programming': 'course_11',
    'c_programming': 'course_11',
    'c programming': 'course_11',
}


def lab_scope_id_for_course(name: str) -> str:
    """Map a Lab course folder to backend scope, failing closed on unknown folders."""
    normalized = name.lower().strip().replace('\\', '/').strip('/')
    scope_id = LAB_SCOPE_BY_FOLDER.get(normalized)
    if scope_id is None:
        raise ValueError(
            f"Unknown Lab course folder '{name}'. Expected one of: "
            + ', '.join(sorted(LAB_SCOPE_BY_FOLDER))
        )
    return scope_id


def derive_scope_passphrase(master: str, scope_id: str) -> str:
    """
    Per-subject passphrase = base64(HMAC-SHA256(master, "lms-scope:" + scope_id)).
    MUST match the server (api/activate/route.ts deriveScopePassphrase) and the
    app, so content encrypts/decrypts under the same per-subject key.
    """
    mac = hmac.new(master.encode('utf-8'),
                   ('lms-scope:' + scope_id).encode('utf-8'),
                   hashlib.sha256).digest()
    return base64.b64encode(mac).decode('ascii')

def encrypt_file_cryptography(input_path: str, output_path: str, salt: bytes, aes_key: bytes, hmac_key: bytes) -> bytes:
    """
    Encrypts a file using the 'cryptography' library (AES-256-CTR) and calculates HMAC-SHA256.
    """
    iv = secrets.token_bytes(16)  # Unique random 16-byte Initial Value
    
    backend = default_backend()
    cipher = Cipher(algorithms.AES(aes_key), modes.CTR(iv), backend=backend)
    encryptor = cipher.encryptor()

    hmac_calculator = hmac.new(hmac_key, digestmod=hashlib.sha256)
    hmac_calculator.update(salt)
    hmac_calculator.update(iv)

    with open(input_path, 'rb') as f_in, open(output_path, 'wb') as f_out:
        # 1. Prepend the 16-byte salt
        f_out.write(salt)
        # 2. Prepend the 16-byte unique IV
        f_out.write(iv)
        # 3. Write 32-byte placeholder for HMAC
        f_out.write(b'\x00' * 32)
        
        # 4. Encrypt and stream chunk-by-chunk
        while True:
            chunk = f_in.read(CHUNK_SIZE)
            if not chunk:
                break
            enc_chunk = encryptor.update(chunk)
            f_out.write(enc_chunk)
            hmac_calculator.update(enc_chunk)
        
        final_block = encryptor.finalize()
        if final_block:
            f_out.write(final_block)
            hmac_calculator.update(final_block)
            
        # 5. Write final HMAC value at offset 32 (16 salt + 16 iv)
        final_hmac = hmac_calculator.digest()
        f_out.seek(32)
        f_out.write(final_hmac)
        
    return iv

def encrypt_file_pycryptodome(input_path: str, output_path: str, salt: bytes, aes_key: bytes, hmac_key: bytes) -> bytes:
    """
    Encrypts a file using the 'pycryptodome' library (AES-256-CTR) and calculates HMAC-SHA256.
    """
    iv = secrets.token_bytes(16)  # Unique random 16-byte Initial Value
    iv_int = int.from_bytes(iv, byteorder='big')
    
    ctr = Counter.new(128, initial_value=iv_int)
    cipher = AES.new(aes_key, AES.MODE_CTR, counter=ctr)

    hmac_calculator = hmac.new(hmac_key, digestmod=hashlib.sha256)
    hmac_calculator.update(salt)
    hmac_calculator.update(iv)

    with open(output_path, 'wb+') as f_out, open(input_path, 'rb') as f_in:
        # 1. Prepend the 16-byte salt
        f_out.write(salt)
        # 2. Prepend the 16-byte unique IV
        f_out.write(iv)
        # 3. Write 32-byte placeholder for HMAC
        f_out.write(b'\x00' * 32)
        
        # 4. Encrypt and stream chunk-by-chunk
        while True:
            chunk = f_in.read(CHUNK_SIZE)
            if not chunk:
                break
            enc_chunk = cipher.encrypt(chunk)
            f_out.write(enc_chunk)
            hmac_calculator.update(enc_chunk)
            
        # 5. Write final HMAC value at offset 32
        final_hmac = hmac_calculator.digest()
        f_out.seek(32)
        f_out.write(final_hmac)
        
    return iv

def trans_encrypt_cryptography(input_enc_path: str, output_enc_path: str, passphrase_a: str, passphrase_b: str):
    """
    Decrypts Key A file (checking integrity first) and encrypts with Key B using 'cryptography'.
    """
    backend = default_backend()
    
    # Read Salt-A and IV-A first
    with open(input_enc_path, 'rb') as f_verify:
        salt_a = f_verify.read(16)
        iv_a = f_verify.read(16)
        expected_hmac = f_verify.read(32)
        if len(salt_a) < 16 or len(iv_a) < 16 or len(expected_hmac) < 32:
            raise IOError("Corrupted file header in source file.")
        
        # Derive Key-A dynamically using Salt-A
        key_a_aes, key_a_hmac = derive_keys(passphrase_a, salt_a)
        
        hmac_verify = hmac.new(key_a_hmac, digestmod=hashlib.sha256)
        hmac_verify.update(salt_a)
        hmac_verify.update(iv_a)
        while True:
            chunk = f_verify.read(CHUNK_SIZE)
            if not chunk:
                break
            hmac_verify.update(chunk)
            
        if not hmac.compare_digest(hmac_verify.digest(), expected_hmac):
            raise ValueError("Integrity check failed: Source file has been tampered or key is incorrect.")

    # Derive Key-B using a new random Salt-B
    salt_b = secrets.token_bytes(16)
    key_b_aes, key_b_hmac = derive_keys(passphrase_b, salt_b)
    iv_b = secrets.token_bytes(16)

    # Proceed to decrypt A and encrypt B
    with open(input_enc_path, 'rb') as f_in:
        f_in.seek(64) # Skip Salt-A + IV-A + HMAC
        cipher_dec = Cipher(algorithms.AES(key_a_aes), modes.CTR(iv_a), backend=backend)
        decryptor = cipher_dec.decryptor()
        
        cipher_enc = Cipher(algorithms.AES(key_b_aes), modes.CTR(iv_b), backend=backend)
        encryptor = cipher_enc.encryptor()
        
        hmac_new = hmac.new(key_b_hmac, digestmod=hashlib.sha256)
        hmac_new.update(salt_b)
        hmac_new.update(iv_b)
        
        with open(output_enc_path, 'wb+') as f_out:
            f_out.write(salt_b)
            f_out.write(iv_b)
            f_out.write(b'\x00' * 32)
            
            while True:
                chunk = f_in.read(CHUNK_SIZE)
                if not chunk:
                    break
                decrypted = decryptor.update(chunk)
                enc_chunk = encryptor.update(decrypted)
                f_out.write(enc_chunk)
                hmac_new.update(enc_chunk)
                
            final_block = encryptor.finalize()
            if final_block:
                f_out.write(final_block)
                hmac_new.update(final_block)
                
            final_hmac = hmac_new.digest()
            f_out.seek(32)
            f_out.write(final_hmac)

def trans_encrypt_pycryptodome(input_enc_path: str, output_enc_path: str, passphrase_a: str, passphrase_b: str):
    """
    Decrypts Key A file (checking integrity first) and encrypts with Key B using 'pycryptodome'.
    """
    # Read Salt-A and IV-A first
    with open(input_enc_path, 'rb') as f_verify:
        salt_a = f_verify.read(16)
        iv_a = f_verify.read(16)
        expected_hmac = f_verify.read(32)
        if len(salt_a) < 16 or len(iv_a) < 16 or len(expected_hmac) < 32:
            raise IOError("Corrupted file header in source file.")
        
        # Derive Key-A dynamically using Salt-A
        key_a_aes, key_a_hmac = derive_keys(passphrase_a, salt_a)
        
        hmac_verify = hmac.new(key_a_hmac, digestmod=hashlib.sha256)
        hmac_verify.update(salt_a)
        hmac_verify.update(iv_a)
        while True:
            chunk = f_verify.read(CHUNK_SIZE)
            if not chunk:
                break
            hmac_verify.update(chunk)
            
        if not hmac.compare_digest(hmac_verify.digest(), expected_hmac):
            raise ValueError("Integrity check failed: Source file has been tampered or key is incorrect.")

    # Derive Key-B using a new random Salt-B
    salt_b = secrets.token_bytes(16)
    key_b_aes, key_b_hmac = derive_keys(passphrase_b, salt_b)
    iv_b = secrets.token_bytes(16)
    iv_b_int = int.from_bytes(iv_b, byteorder='big')
    ctr_b = Counter.new(128, initial_value=iv_b_int)
    cipher_enc = AES.new(key_b_aes, AES.MODE_CTR, counter=ctr_b)

    with open(input_enc_path, 'rb') as f_in:
        f_in.seek(64) # Skip Salt-A + IV-A + HMAC
        iv_a_int = int.from_bytes(iv_a, byteorder='big')
        ctr_a = Counter.new(128, initial_value=iv_a_int)
        cipher_dec = AES.new(key_a_aes, AES.MODE_CTR, counter=ctr_a)
        
        hmac_new = hmac.new(key_b_hmac, digestmod=hashlib.sha256)
        hmac_new.update(salt_b)
        hmac_new.update(iv_b)
        
        with open(output_enc_path, 'wb+') as f_out:
            f_out.write(salt_b)
            f_out.write(iv_b)
            f_out.write(b'\x00' * 32)
            
            while True:
                chunk = f_in.read(CHUNK_SIZE)
                if not chunk:
                    break
                decrypted = cipher_dec.decrypt(chunk)
                enc_chunk = cipher_enc.encrypt(decrypted)
                f_out.write(enc_chunk)
                hmac_new.update(enc_chunk)
                
            final_hmac = hmac_new.digest()
            f_out.seek(32)
            f_out.write(final_hmac)

def encrypt_ready(input_path: str, output_path: str) -> bool:
    """
    True when the output .enc already exists and is COMPLETE for this source:
    a finished .enc is exactly the source size + 64 header bytes (16 salt +
    16 IV + 32 HMAC). Anything else — missing, wrong size, or a stray partial
    from an older run — gets re-encrypted.
    """
    try:
        return (os.path.isfile(output_path)
                and os.path.getsize(output_path) == os.path.getsize(input_path) + 64)
    except OSError:
        return False

def process_file(input_path: str, output_path: str, passphrase: str) -> str:
    """
    Encrypts a single file safely and resumably:
      - skips instantly if the .enc is already complete (resume support)
      - encrypts into <output>.enc.part, then atomically renames to .enc —
        a stopped/killed run can never leave a half-written .enc behind
    Returns "ok", "skipped" or "failed".
    """
    if encrypt_ready(input_path, output_path):
        _log(f"⏭️  Skipping (already encrypted): {os.path.basename(output_path)}")
        return "skipped"

    file_size_mb = os.path.getsize(input_path) / (1024 * 1024)
    _log(f"🔒 Encrypting with HMAC validation: {os.path.basename(input_path)} ({file_size_mb:.2f} MB)")
    part_path = output_path + ".part"
    try:
        salt = secrets.token_bytes(16)
        aes_key, hmac_key = derive_keys(passphrase, salt)
        if HAS_CRYPTOGRAPHY:
            encrypt_file_cryptography(input_path, part_path, salt, aes_key, hmac_key)
        else:
            encrypt_file_pycryptodome(input_path, part_path, salt, aes_key, hmac_key)
        os.replace(part_path, output_path)  # atomic: .enc appears only when complete
        
        # Total Safeguard: Verify the file size exactly matches the expected cryptographic envelope
        if not encrypt_ready(input_path, output_path):
            raise IOError("Post-encryption integrity check failed (size mismatch/truncation on disk).")
            
        _log(f"✅ Success! Encrypted package: {os.path.basename(output_path)}")
        return "ok"
    except BaseException as e:
        # Remove the partial file so a broken video can never be mistaken for done.
        try:
            if os.path.exists(part_path):
                os.remove(part_path)
        except OSError:
            pass
        if isinstance(e, Exception):
            _log(f"❌ Failed to encrypt {input_path}: {e}")
            return "failed"
        raise  # KeyboardInterrupt / SystemExit: propagate after cleanup

def run_batch(jobs, workers: int = DEFAULT_WORKERS):
    """
    jobs: list of (input_path, output_path, passphrase) tuples.
    Encrypts files in parallel. Ctrl+C safe: queued files are cancelled, the
    in-flight file(s) finish cleanly (or their .part is discarded), and a
    re-run resumes exactly where it stopped — done files skip, the rest encrypt.
    Returns a stats dict: {"ok": n, "skipped": n, "failed": n}.
    """
    t0 = time.time()
    done_bytes = 0
    stats = {"ok": 0, "skipped": 0, "failed": 0}
    total = len(jobs)
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=workers)
    futures = {pool.submit(process_file, i, o, p): i for i, o, p in jobs}
    try:
        for fut in concurrent.futures.as_completed(futures):
            status = fut.result()
            stats[status] += 1
            if status == "ok":
                done_bytes += os.path.getsize(futures[fut])
            processed = stats["ok"] + stats["skipped"] + stats["failed"]
            _log(f"   [{processed}/{total}] done")
    except (KeyboardInterrupt, SystemExit):
        pool.shutdown(wait=False, cancel_futures=True)
        print("\n🛑 Interrupted. In-flight file(s) will finish or be discarded — no broken .enc is left.")
        print("   Re-run with the same inputs to RESUME: finished videos are skipped,")
        print("   the interrupted one is re-encrypted from scratch.")
        raise SystemExit(130)
    pool.shutdown(wait=True)
    elapsed = max(time.time() - t0, 0.001)
    gb = done_bytes / (1024 ** 3)
    speed = (done_bytes / (1024 * 1024)) / elapsed
    print(f"\n📊 Batch finished in {elapsed:,.0f}s — encrypted {stats['ok']} file(s) "
          f"({gb:.2f} GB @ {speed:.0f} MB/s), skipped {stats['skipped']} already done, "
          f"failed {stats['failed']}.")
    if stats["failed"]:
        print("⚠️ Some files FAILED — re-run the script to retry just those files.")
    return stats

def process_trans_file(input_path: str, output_path: str, passphrase_a: str, passphrase_b: str):
    """
    Trans-encrypts a single file (rotating Key-A to Key-B) entirely in-memory.
    """
    file_size_mb = os.path.getsize(input_path) / (1024 * 1024)
    print(f"🔄 Rotating Cryptographic Keys & Integrity Signatures: {os.path.basename(input_path)} ({file_size_mb:.2f} MB)")
    
    try:
        if HAS_CRYPTOGRAPHY:
            trans_encrypt_cryptography(input_path, output_path, passphrase_a, passphrase_b)
        else:
            trans_encrypt_pycryptodome(input_path, output_path, passphrase_a, passphrase_b)
            
        print(f"✅ Success! Re-encrypted package compiled: {os.path.basename(output_path)}")
    except Exception as e:
        print(f"❌ Failed key rotation for {input_path}: {str(e)}")

def main():
    print("====================================================")
    print("       LMS ENTERPRISE OFFLINE VIDEO ENCRYPTION      ")
    print("       [AES-256-CTR + HMAC-SHA256 HARDENING]        ")
    print("====================================================")

    # LMS_LAB_QUICKSTART: set by Run-LabEncryption.bat for the non-technical,
    # double-click-and-go flow. When set, mode is fixed to "3" (Per-Course Encrypt)
    # and the parallel-workers prompt is skipped (defaults applied) — so the ONLY
    # things the user ever types are the master key, source folder, and destination
    # folder, below. Manual/advanced use (running this script directly without the
    # .bat) is completely unchanged: the full interactive menu still appears.
    quickstart = os.environ.get("LMS_LAB_QUICKSTART") == "1"

    if quickstart:
        mode = "3"
        print("Mode: [3] Per-Course Encrypt (auto-selected for quick start)")
        print("====================================================")
    else:
        print("Select Utility Mode:")
        print("   [1] Encrypt raw MP4 videos (using Master Passphrase)")
        print("   [2] Trans-Encrypt existing .enc videos (Rotate Key-A to Key-B)")
        print("   [3] Per-Course Encrypt (key hierarchy: <course>/Day<N>/*.mp4)")
        print("====================================================")

        mode = input("⌨️ Select mode (1, 2 or 3): ").strip()
        if mode not in ["1", "2", "3"]:
            print("❌ Error: Invalid selection.")
            sys.exit(1)
        
    if mode == "1":
        # Raw MP4 Encryption Mode
        passphrase = input("\n🔑 Enter Master Passphrase/Key to derive AES & HMAC Keys: ").strip()
        if not passphrase:
            print("❌ Error: Passphrase cannot be empty.")
            sys.exit(1)
            
        target = input("\n📂 Enter path to raw MP4 file or folder of videos: ").strip()
        if not os.path.exists(target):
            print(f"❌ Error: Path '{target}' does not exist.")
            sys.exit(1)
            
        if os.path.isfile(target):
            if not target.lower().endswith('.mp4'):
                print("⚠️ Warning: File is not an MP4 video, but proceeding anyway.")
            output_file = os.path.splitext(target)[0] + ".enc"
            process_file(target, output_file, passphrase)
        elif os.path.isdir(target):
            files = [f for f in os.listdir(target) if f.lower().endswith('.mp4')]
            if not files:
                print("❌ No MP4 files found in the directory.")
                sys.exit(1)
                
            print(f"📋 Found {len(files)} MP4 video files in directory. Commencing batch encryption...")
            jobs = []
            for file in files:
                full_input = os.path.join(target, file)
                full_output = os.path.splitext(full_input)[0] + ".enc"
                jobs.append((full_input, full_output, passphrase))
            run_batch(jobs)
                
    elif mode == "2":
        # Trans-Encryption Mode
        passphrase_a = input("\n🔑 Enter OLD Passphrase/Key (Key-A): ").strip()
        passphrase_b = input("🔑 Enter NEW Passphrase/Key (Key-B): ").strip()
        
        if not passphrase_a or not passphrase_b:
            print("❌ Error: Passphrases cannot be empty.")
            sys.exit(1)
            
        target = input("\n📂 Enter path to Key-A encrypted .enc file or folder of .enc videos: ").strip()
        if not os.path.exists(target):
            print(f"❌ Error: Path '{target}' does not exist.")
            sys.exit(1)
            
        dest_folder = input("💾 Enter destination path to save newly encrypted Key-B videos: ").strip()
        if not os.path.exists(dest_folder):
            print("📋 Destination folder does not exist. Creating it now...")
            os.makedirs(dest_folder, exist_ok=True)
            
        if os.path.isfile(target):
            if not target.lower().endswith('.enc'):
                print("⚠️ Warning: File is not an .enc package, but proceeding anyway.")
            output_file = os.path.join(dest_folder, os.path.splitext(os.path.basename(target))[0] + ".enc")
            process_trans_file(target, output_file, passphrase_a, passphrase_b)
        elif os.path.isdir(target):
            files = [f for f in os.listdir(target) if f.lower().endswith('.enc')]
            if not files:
                print("❌ No .enc files found in the source directory.")
                sys.exit(1)
                
            print(f"📋 Found {len(files)} .enc files in directory. Commencing batch key rotation...")
            for file in files:
                full_input = os.path.join(target, file)
                full_output = os.path.join(dest_folder, file)
                process_trans_file(full_input, full_output, passphrase_a, passphrase_b)

    elif mode == "3":
        # Per-Course Encryption Mode (course_N key hierarchy — see LAB_SCOPE_BY_FOLDER)
        master = input("\n🔑 Enter MASTER key (must equal server LMS_MASTER_CEK): ").strip()
        if not master:
            print("❌ Error: Master key cannot be empty.")
            sys.exit(1)

        root = input("\n📂 Enter content ROOT (contains <course>/Day<N>/.../*.mp4): ").strip()
        if not os.path.isdir(root):
            print(f"❌ Error: '{root}' is not a directory.")
            sys.exit(1)

        dest_root = input("💾 Enter DESTINATION folder to save encrypted files: ").strip()
        if not dest_root:
            print("❌ Error: Destination cannot be empty.")
            sys.exit(1)

        if quickstart:
            workers = DEFAULT_WORKERS
            print(f"⚙️ Parallel workers: {workers} (auto)")
        else:
            workers_in = input(f"⚙️ Parallel workers [{DEFAULT_WORKERS}]: ").strip()
            workers = int(workers_in) if workers_in.isdigit() and int(workers_in) > 0 else DEFAULT_WORKERS

        # Sweep stale .part leftovers from a previous hard kill so junk never piles up.
        if os.path.isdir(dest_root):
            for dirpath, _, files in os.walk(dest_root):
                for f in files:
                    if f.endswith('.enc.part'):
                        try:
                            os.remove(os.path.join(dirpath, f))
                        except OSError:
                            pass

        print(f"📋 Scanning directory recursively for .mp4 files...")
        jobs = []
        scope_cache = {}
        for dirpath, _, files in os.walk(root):
            for file in files:
                if file.lower().endswith('.mp4'):
                    full_input = os.path.join(dirpath, file)

                    # Calculate the scope from the video's own first path segment.
                    # This must stay in lock-step with labScopeIdForVideoPath() in the app:
                    #   electronics/... -> course_1, ... ar/... -> course_7, etc.
                    rel_path = os.path.relpath(full_input, root)
                    parts = rel_path.replace('\\', '/').split('/')

                    if len(parts) >= 2:
                        course_folder = parts[0]
                        try:
                            scope_id = lab_scope_id_for_course(course_folder)
                        except ValueError as exc:
                            print(f"⚠️ Warning: Skipping {rel_path} ({exc})")
                            continue
                        if scope_id not in scope_cache:
                            scope_cache[scope_id] = derive_scope_passphrase(master, scope_id)
                        scope_passphrase = scope_cache[scope_id]

                        # Calculate destination path and recreate subdirectories
                        rel_dir = os.path.dirname(rel_path)
                        enc_filename = os.path.splitext(file)[0] + ".enc"
                        out_dir = os.path.join(dest_root, rel_dir)
                        os.makedirs(out_dir, exist_ok=True)
                        full_output = os.path.join(out_dir, enc_filename)

                        jobs.append((full_input, full_output, scope_passphrase))
                    else:
                        print(f"⚠️ Warning: Skipping {rel_path} (does not match <CourseName>/Day<N> hierarchy)")

        if not jobs:
            print("❌ No MP4 files found under the hierarchy.")
            sys.exit(1)
        total_gb = sum(os.path.getsize(i) for i, _, _ in jobs) / (1024 ** 3)
        print(f"📋 Found {len(jobs)} video(s), {total_gb:.2f} GB total. "
              f"Encrypting with {workers} parallel workers (already-done files skip)...")
        stats = run_batch(jobs, workers)
        print(f"\n📦 Per-course encryption complete: {stats['ok'] + stats['skipped']} of {len(jobs)} file(s) ready.")

    print("\n🎉 Cryptographic Job Finished Successfully!")
    print("====================================================")

if __name__ == '__main__':
    main()
