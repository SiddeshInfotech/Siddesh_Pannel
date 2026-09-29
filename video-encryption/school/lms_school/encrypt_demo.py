#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LMS FAST Mode-3 (per-subject) content encryptor  —  SELF-CONTAINED & PORTABLE.

Encrypts every .mp4 under a content ROOT laid out as:
    <ROOT>/<class>/<subject>/.../<file>.mp4
      e.g.  1st/Maths/धडा १ - माझे गाव.mp4
            1st/Maths/धडा २० - ३१ ते ९९ ची ओळख/Part 1.mp4   (part sub-folders OK)
            4th/Aple Jag/धडा ११ – माझा महाराष्ट्र Part 2.mp4

Each file is encrypted with the PER-SUBJECT key the Android app expects:
    scope = class_<n>/<CanonicalSubject>     (class_1/Math, class_4/EVS, ...)
The scope is taken from ONLY the first two path parts (<class>/<subject>), so any
depth of chapter sub-folder under a subject still gets the right key, and the
output mirrors the input folder tree (parts stay inside their chapter folder).

Portable: copy THIS ONE FILE to any machine with Python 3 + `cryptography`
(or `pycryptodome`). No other project file is needed.

Crypto (AES-256-CTR + HMAC-SHA256 + APK-signature binding) is identical to the
project's encrypt_videos.py "mode 3", so the app decrypts these files. Only the
encryption MODE was taken from that script — none of its path/interactive code.

USAGE
  Interactive (just run it):
      python encrypt_demo.py
  With args (good for automation / another machine):
      python encrypt_demo.py "<SRC_ROOT>" "<DEST_ROOT>" [workers]
  Master key resolution order: $LMS_MASTER_CEK env var, else hidden prompt.
"""

import os
import sys
import base64
import hashlib
import hmac
import secrets
import getpass
import threading
import time
import concurrent.futures

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
    HAS_CRYPTOGRAPHY = True
except ImportError:
    try:
        from Crypto.Cipher import AES        # type: ignore
        from Crypto.Util import Counter      # type: ignore
        HAS_CRYPTOGRAPHY = False
    except ImportError:
        print("ERROR: install a crypto lib:  pip install cryptography   (or pycryptodome)")
        sys.exit(1)

CHUNK_SIZE = 8 * 1024 * 1024          # 8MB streaming chunks (AES-NI friendly)
DEFAULT_WORKERS = max(4, os.cpu_count() or 4)

# SHA-256 of the production signing fingerprint (must match the app constant
# SecurityChecks.getContentKeyBinding). Binds every file to the genuine APK.
CONTENT_KEY_BINDING = bytes.fromhex(
    "f599c227b72ad56f51d50eeda30d568e83c118650572ca9f7259ae0a67a3b726"
)

_print_lock = threading.Lock()
def _log(msg):
    with _print_lock:
        print(msg, flush=True)

# ---------------------------------------------------------------- key hierarchy
def derive_keys(passphrase, salt):
    master_seed = hashlib.pbkdf2_hmac('sha256', passphrase.encode('utf-8'), salt, 100000)
    bound = hashlib.sha256(master_seed + CONTENT_KEY_BINDING).digest()
    aes_key = hashlib.sha256(bound + b"enc").digest()
    hmac_key = hashlib.sha256(bound + b"hmac").digest()
    return aes_key, hmac_key

def canonical_subject(name):
    n = name.lower()
    if 'marathi' in n or 'मराठी' in name:
        return 'Marathi'
    if 'english' in n or 'इंग्रजी' in name:
        return 'English'
    if 'math' in n or 'गणित' in name:            # matches Math AND Maths
        return 'Math'
    if ('evs' in n or 'environment' in n or 'aple' in n or 'jag' in n
            or 'परिसर' in name or 'सभोवत' in name):   # "Aple Jag" folder -> EVS
        return 'EVS'
    return name.strip()

CLASS_MAP = {"1st": "class_1", "2nd": "class_2", "3rd": "class_3", "4th": "class_4"}

def app_scope_id(class_folder, subject_folder):
    cls = CLASS_MAP.get(class_folder.strip().lower(), class_folder)
    return "%s/%s" % (cls, canonical_subject(subject_folder))

def derive_scope_passphrase(master, scope_id):
    mac = hmac.new(master.encode('utf-8'),
                   ('lms-scope:' + scope_id).encode('utf-8'),
                   hashlib.sha256).digest()
    return base64.b64encode(mac).decode('ascii')

# ------------------------------------------------------------------- encryption
def _encrypt_cryptography(inp, out, salt, aes_key, hmac_key):
    iv = secrets.token_bytes(16)
    cipher = Cipher(algorithms.AES(aes_key), modes.CTR(iv), backend=default_backend())
    enc = cipher.encryptor()
    h = hmac.new(hmac_key, digestmod=hashlib.sha256)
    h.update(salt); h.update(iv)
    with open(inp, 'rb') as fi, open(out, 'wb') as fo:
        fo.write(salt); fo.write(iv); fo.write(b'\x00' * 32)
        while True:
            chunk = fi.read(CHUNK_SIZE)
            if not chunk:
                break
            ec = enc.update(chunk)
            fo.write(ec); h.update(ec)
        fin = enc.finalize()
        if fin:
            fo.write(fin); h.update(fin)
        fo.seek(32); fo.write(h.digest())

def _encrypt_pycryptodome(inp, out, salt, aes_key, hmac_key):
    iv = secrets.token_bytes(16)
    ctr = Counter.new(128, initial_value=int.from_bytes(iv, 'big'))
    cipher = AES.new(aes_key, AES.MODE_CTR, counter=ctr)
    h = hmac.new(hmac_key, digestmod=hashlib.sha256)
    h.update(salt); h.update(iv)
    with open(out, 'wb+') as fo, open(inp, 'rb') as fi:
        fo.write(salt); fo.write(iv); fo.write(b'\x00' * 32)
        while True:
            chunk = fi.read(CHUNK_SIZE)
            if not chunk:
                break
            ec = cipher.encrypt(chunk)
            fo.write(ec); h.update(ec)
        fo.seek(32); fo.write(h.digest())

def _ready(inp, out):
    """A finished .enc is exactly source size + 64 header bytes -> skip (resume)."""
    try:
        return os.path.isfile(out) and os.path.getsize(out) == os.path.getsize(inp) + 64
    except OSError:
        return False

def process_file(inp, out, passphrase):
    if _ready(inp, out):
        return "skipped"
    part = out + ".part"
    try:
        salt = secrets.token_bytes(16)
        aes_key, hmac_key = derive_keys(passphrase, salt)
        if HAS_CRYPTOGRAPHY:
            _encrypt_cryptography(inp, part, salt, aes_key, hmac_key)
        else:
            _encrypt_pycryptodome(inp, part, salt, aes_key, hmac_key)
        os.replace(part, out)             # atomic: .enc appears only when complete
        return "ok"
    except BaseException as e:
        try:
            if os.path.exists(part):
                os.remove(part)
        except OSError:
            pass
        if isinstance(e, Exception):
            _log("  FAILED %s: %s" % (os.path.basename(inp), e))
            return "failed"
        raise

def run_batch(jobs, workers):
    t0 = time.time()
    stats = {"ok": 0, "skipped": 0, "failed": 0}
    total = len(jobs)
    done_bytes = 0
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=workers)
    futures = {pool.submit(process_file, i, o, p): i for i, o, p in jobs}
    try:
        for fut in concurrent.futures.as_completed(futures):
            st = fut.result()
            stats[st] += 1
            if st == "ok":
                done_bytes += os.path.getsize(futures[fut])
            n = stats["ok"] + stats["skipped"] + stats["failed"]
            if n % 10 == 0 or n == total:
                _log("   [%d/%d]  ok=%d skip=%d fail=%d" %
                     (n, total, stats["ok"], stats["skipped"], stats["failed"]))
    except (KeyboardInterrupt, SystemExit):
        pool.shutdown(wait=False, cancel_futures=True)
        print("\nInterrupted. Re-run with the same SRC/DEST to RESUME (finished files skip).")
        raise SystemExit(130)
    pool.shutdown(wait=True)
    dt = max(time.time() - t0, 0.001)
    gb = done_bytes / (1024 ** 3)
    print("\nDone in %.0fs  |  encrypted %d, skipped %d, failed %d  |  %.2f GB @ %.0f MB/s" %
          (dt, stats["ok"], stats["skipped"], stats["failed"], gb, (done_bytes / 1048576) / dt))
    if stats["failed"]:
        print("Some files FAILED — re-run to retry just those.")
    return stats

# ------------------------------------------------------------------------- main
def main():
    src = sys.argv[1] if len(sys.argv) > 1 else input("SRC content root (contains 1st/2nd/3rd/4th): ").strip().strip('"')
    dest = sys.argv[2] if len(sys.argv) > 2 else input("DEST root for encrypted .enc output: ").strip().strip('"')
    workers = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else DEFAULT_WORKERS

    if not os.path.isdir(src):
        print("ERROR: SRC '%s' is not a directory." % src); sys.exit(1)
    if not dest:
        print("ERROR: DEST is empty."); sys.exit(1)

    master = os.environ.get("LMS_MASTER_CEK") or input("MASTER key (LMS_MASTER_CEK) [VISIBLE]: ").strip()
    if not master:
        print("ERROR: master key cannot be empty."); sys.exit(1)

    jobs = []
    scope_cache = {}
    scope_count = {}
    skipped_paths = 0
    for dirpath, _, files in os.walk(src):
        for f in files:
            if not f.lower().endswith(".mp4"):
                continue
            full = os.path.join(dirpath, f)
            rel = os.path.relpath(full, src)
            parts = rel.replace("\\", "/").split("/")
            if len(parts) < 2:
                skipped_paths += 1
                _log("  SKIP (not <class>/<subject>/...): %s" % rel)
                continue
            scope = app_scope_id(parts[0], parts[1])
            if scope not in scope_cache:
                scope_cache[scope] = derive_scope_passphrase(master, scope)
                scope_count[scope] = 0
            scope_count[scope] += 1
            out = os.path.join(dest, os.path.dirname(rel), os.path.splitext(f)[0] + ".enc")
            os.makedirs(os.path.dirname(out), exist_ok=True)
            jobs.append((full, out, scope_cache[scope]))

    if not jobs:
        print("ERROR: no .mp4 files found under SRC."); sys.exit(1)

    print("\nScope -> file count (must read class_<n>/<subject>):")
    for s in sorted(scope_count):
        print("   %-16s %d" % (s, scope_count[s]))
    total_gb = sum(os.path.getsize(i) for i, _, _ in jobs) / (1024 ** 3)
    print("\nEncrypting %d file(s), %.2f GB, with %d workers  (SRC=%s  DEST=%s)\n"
          % (len(jobs), total_gb, workers, src, dest))
    run_batch(jobs, workers)
    print("\nDeploy: copy the DEST tree so it lands under the app content root, e.g.")
    print("   /storage/emulated/0/School Content/Final Logo Videos/1st/Maths/....enc")

if __name__ == "__main__":
    main()
