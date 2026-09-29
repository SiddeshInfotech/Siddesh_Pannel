#!/usr/bin/env python3
"""
One-question wrapper around encrypt_videos.py.

You give ONE root folder and the MASTER key. It walks every nested subfolder
under the root, finds all .mp4 videos, and encrypts them (per-subject key
hierarchy, exactly like mode 3 of encrypt_videos.py). The encrypted .enc files
are written to a sibling folder "<root>_ENCRYPTED", mirroring the original
nested structure. Your original videos are never modified.

Run this via Encrypt_Videos.bat (which installs dependencies first).
"""

import os
import sys

# Force UTF-8 console output. encrypt_videos.py prints emoji; on a fresh Windows
# console (cp1252) that raises UnicodeEncodeError and aborts the batch. errors=
# 'replace' keeps it printing even on legacy code pages.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass

# Reuse the audited crypto + hierarchy logic from the main script so both stay
# in lock-step with the app/server key derivation. Importing does NOT run its
# menu (that is guarded by __main__).
from encrypt_videos import (
    derive_scope_passphrase,
    canonical_subject,
    run_batch,
    DEFAULT_WORKERS,
)


def main():
    print("====================================================")
    print("       LMS OFFLINE VIDEO ENCRYPTION (ROOT MODE)")
    print("   Give one ROOT folder -> all nested videos encrypt")
    print("====================================================")

    master = input("\n[KEY] Enter MASTER key (must equal server LMS_MASTER_CEK): ").strip()
    if not master:
        print("[ERROR] Master key cannot be empty.")
        sys.exit(1)

    root = input("\n[DIR] Enter the ROOT folder to encrypt (all nested videos): ").strip().strip('"')
    if not os.path.isdir(root):
        print(f"[ERROR] '{root}' is not a valid folder.")
        sys.exit(1)

    # Destination = sibling folder next to the root, structure mirrored, originals kept.
    root = os.path.normpath(root)
    dest_root = root + "_ENCRYPTED"

    workers_in = input(f"\n[CFG] Parallel workers [{DEFAULT_WORKERS}]: ").strip()
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

    print("\n[SCAN] Scanning every nested folder under the root for .mp4 files...")
    jobs = []
    scope_cache = {}
    for dirpath, _, files in os.walk(root):
        for file in files:
            if file.lower().endswith('.mp4'):
                full_input = os.path.join(dirpath, file)

                # Hierarchy expected: class_<n>/medium_<medium>/<subject>/<unit>/<file>.mp4
                # The subject sits at index 2 (below the medium). Deriving the scope
                # from the wrong level would produce a key the app cannot match.
                rel_path = os.path.relpath(full_input, root)
                parts = rel_path.replace('\\', '/').split('/')

                if len(parts) >= 4:
                    class_folder = parts[0]
                    subject_folder = parts[2]

                    scope_id = f"{class_folder}/{canonical_subject(subject_folder)}"
                    if scope_id not in scope_cache:
                        scope_cache[scope_id] = derive_scope_passphrase(master, scope_id)
                    scope_passphrase = scope_cache[scope_id]

                    rel_dir = os.path.dirname(rel_path)
                    enc_filename = os.path.splitext(file)[0] + ".enc"
                    out_dir = os.path.join(dest_root, rel_dir)
                    os.makedirs(out_dir, exist_ok=True)
                    full_output = os.path.join(out_dir, enc_filename)

                    jobs.append((full_input, full_output, scope_passphrase))
                else:
                    print(f"[SKIP] {rel_path} (not under class_<n>/<medium>/<subject>/<unit>/)")

    if not jobs:
        print("[ERROR] No .mp4 files found in any nested folder under the root.")
        sys.exit(1)

    total_gb = sum(os.path.getsize(i) for i, _, _ in jobs) / (1024 ** 3)
    print(f"\n[INFO] Found {len(jobs)} video(s), {total_gb:.2f} GB total.")
    print(f"[INFO] Encrypting -> {dest_root}")
    print(f"[INFO] Using {workers} parallel workers (already-done files skip).\n")

    stats = run_batch(jobs, workers)
    print(f"\n[DONE] {stats['ok'] + stats['skipped']} of {len(jobs)} file(s) ready in:")
    print(f"       {dest_root}")
    print("====================================================")


if __name__ == '__main__':
    main()
