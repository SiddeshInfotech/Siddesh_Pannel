#!/usr/bin/env python3
"""
NEP Poster image encryption — same AES-256-CTR + HMAC-SHA256 + per-subject key
hierarchy as encrypt_videos.py, but for the NEP Posters image tree:

    NEP Posters/<1st|2nd|3rd|4th|4tj>/<English|Marathi|Maths|Aple...>/<file>.png

The app decrypts posters with the SAME per-subject scope key as the videos of
that class+subject (EncryptedDataSource, contentKey = CEK for class_<n>/Subject).
So each image is encrypted under scope  class_<n>/<canonical subject>  where:
    class = leading digit of the class folder ("1st"->1, "4tj"->4)
    subject folder -> English / Marathi / Math / EVS  (poster_subject below,
                      matching NepPosterResolver.subjectDirMatches in the app)

Encrypted output keeps the same name with a .enc extension and mirrors the tree.
Reuses encrypt_videos.py so the algorithm / CONTENT_KEY_BINDING / scope-passphrase
derivation stay in lock-step with the video pipeline and the app.
"""
import os, sys, importlib.util

# --- import the crypto core from encrypt_videos.py (without running its menu) ---
_here = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("encvid", os.path.join(_here, "encrypt_videos.py"))
encvid = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(encvid)   # safe: main() is guarded by __main__

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp")


def class_num(folder: str):
    """Leading digit of the class folder: '1st'->'1', '4tj'->'4'. None if absent."""
    for ch in folder:
        if ch.isdigit():
            return ch
    return None


def poster_subject(folder: str) -> str:
    """Folder name -> canonical subject, mirroring the app's NepPosterResolver."""
    d = folder.lower()
    if "english" in d:
        return "English"
    if ("marathi" in d) and ("aple" not in d):
        return "Marathi"
    if "math" in d:
        return "Math"
    if ("aple" in d or "jag" in d or "sabhov" in d or "evs" in d
            or "परिसर" in folder or "सभोवत" in folder):
        return "EVS"
    return encvid.canonical_subject(folder)


def build_jobs(root: str, dest_root: str, master: str, preview: bool):
    jobs = []
    scope_cache = {}
    skipped = []
    for dirpath, _, files in os.walk(root):
        for f in files:
            if not f.lower().endswith(IMAGE_EXT):
                continue
            full_in = os.path.join(dirpath, f)
            rel = os.path.relpath(full_in, root).replace("\\", "/").split("/")
            if len(rel) < 3:
                skipped.append("/".join(rel) + "  (need <class>/<subject>/<file>)")
                continue
            cn = class_num(rel[0])
            if cn is None:
                skipped.append("/".join(rel) + "  (no class digit)")
                continue
            scope_id = f"class_{cn}/{poster_subject(rel[1])}"
            if scope_id not in scope_cache:
                scope_cache[scope_id] = encvid.derive_scope_passphrase(master, scope_id)
            rel_dir = os.path.dirname(os.path.relpath(full_in, root))
            out_dir = os.path.join(dest_root, rel_dir)
            out_file = os.path.join(out_dir, os.path.splitext(f)[0] + ".enc")
            jobs.append((full_in, out_file, scope_cache[scope_id], scope_id))
            if not preview:
                os.makedirs(out_dir, exist_ok=True)
    return jobs, scope_cache, skipped


def main():
    print("=" * 52)
    print("        LMS NEP POSTER IMAGE ENCRYPTION")
    print("        [AES-256-CTR + HMAC-SHA256, per-subject]")
    print("=" * 52)
    master = input("\n🔑 Enter MASTER key (must equal server LMS_MASTER_CEK): ").strip()
    if not master:
        print("❌ Master key cannot be empty."); sys.exit(1)
    root = input("\n📂 Enter NEP Posters ROOT (contains 1st/ 2nd/ ...): ").strip().strip('"')
    if not os.path.isdir(root):
        print(f"❌ '{root}' is not a directory."); sys.exit(1)
    dest = input("💾 Enter DESTINATION folder for encrypted posters: ").strip().strip('"')
    if not dest:
        print("❌ Destination cannot be empty."); sys.exit(1)
    ans = input("👁  Preview scopes only (no encryption)? [y/N]: ").strip().lower()
    preview = ans == "y"

    jobs, scopes, skipped = build_jobs(root, dest, master, preview)
    print(f"\n📋 {len(jobs)} image(s) found, {len(scopes)} distinct scope(s).")
    counts = {}
    for _, _, _, sid in jobs:
        counts[sid] = counts.get(sid, 0) + 1
    for sid in sorted(counts):
        print(f"    {sid:18s} x{counts[sid]}")
    for s in skipped:
        print(f"    ⚠️ skipped {s}")
    if preview:
        print("\n👁  Preview only — nothing encrypted.")
        return
    if not jobs:
        print("❌ No images to encrypt."); sys.exit(1)

    batch = [(i, o, p) for (i, o, p, _s) in jobs]
    encvid.run_batch(batch, workers=encvid.DEFAULT_WORKERS)
    print("\n🎉 NEP poster encryption finished.")
    print("Copy the encrypted 'NEP Posters' tree next to 'videos' inside LMS_Content.")
    print("=" * 52)


if __name__ == "__main__":
    main()
