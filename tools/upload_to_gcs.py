"""
Upload social media videos from Stockflow-social/ to Google Cloud Storage.
Supports batch folders: Batch01/Montages/W|S|V/, Batch01/Clips/W|S|V/

Usage:
  python tools/upload_to_gcs.py                        # upload all (append, auto-detect batches)
  python tools/upload_to_gcs.py --batch Batch01        # upload specific batch only
  python tools/upload_to_gcs.py --overwrite             # re-upload everything
  python tools/upload_to_gcs.py --dry-run               # preview without uploading
"""

import os
import sys
import time
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = (SCRIPT_DIR / "..").resolve()
STOCKFLOW_SOCIAL_DIR = PROJECT_ROOT / "Marketing content" / "Stockflow-social"
GCS_CREDENTIALS = PROJECT_ROOT / "Marketing content" / "gcs_service_account.json"
BUCKET_NAME = "stockflow-social"
GCS_BASE_URL = f"https://storage.googleapis.com/{BUCKET_NAME}"
# Content types to scan
CONTENT_TYPES = ["Montages", "Clips", "UGC"]
FORMATS = ["W", "S", "V"]


def progress_bar(current, total, label="", start_time=None):
    bar_len = 30
    filled = int(bar_len * current / total) if total else 0
    bar = '#' * filled + '-' * (bar_len - filled)
    pct = int(100 * current / total) if total else 0
    eta = ''
    if start_time and current > 0:
        elapsed = time.time() - start_time
        remaining = (elapsed / current) * (total - current)
        if remaining > 60:
            eta = f'  ETA: {int(remaining/60)}m {int(remaining%60)}s'
        else:
            eta = f'  ETA: {int(remaining)}s'
    sys.stdout.write(f'\r  [{bar}] {pct:3d}%  {label[:40]:<40}{eta:<20}')
    sys.stdout.flush()
    if current == total:
        elapsed = time.time() - start_time if start_time else 0
        print(f'  Done in {int(elapsed)}s')


def main():
    has_flags = any(arg.startswith('--') for arg in sys.argv[1:])

    print("=" * 50)
    print("  GCS Upload — Stockflow Social Media")
    print("=" * 50)

    # Check prerequisites first
    if not STOCKFLOW_SOCIAL_DIR.exists():
        print(f"ERROR: Stockflow-social folder not found: {STOCKFLOW_SOCIAL_DIR}")
        return

    if not GCS_CREDENTIALS.exists():
        print(f"ERROR: GCS credentials not found: {GCS_CREDENTIALS}")
        print("Download service account key from Google Cloud Console.")
        return

    # Discover batch folders early (needed for interactive menu)
    all_batch_dirs = sorted([d for d in STOCKFLOW_SOCIAL_DIR.iterdir() if d.is_dir() and d.name.startswith("Batch")])
    if not all_batch_dirs:
        print(f"No Batch folders found in {STOCKFLOW_SOCIAL_DIR}")
        return

    # ── Interactive mode (no flags) ──
    if not has_flags:
        print(f"\n  Batches found:")
        for i, d in enumerate(all_batch_dirs, 1):
            # Count files in this batch
            count = sum(1 for ct in CONTENT_TYPES for fmt in FORMATS
                       for _ in (d / ct / fmt).glob('*.mp4') if (d / ct / fmt).exists())
            print(f"    {i}. {d.name}  ({count} files)")
        print(f"    {len(all_batch_dirs) + 1}. ALL batches")

        try:
            choice = input(f"\n  Select batch (1-{len(all_batch_dirs) + 1}): ").strip()
            batch_idx = int(choice) - 1
        except (ValueError, KeyboardInterrupt):
            print("\n  Cancelled.")
            return

        if batch_idx < 0 or batch_idx > len(all_batch_dirs):
            print("  Invalid choice.")
            return

        if batch_idx < len(all_batch_dirs):
            batch_filter = all_batch_dirs[batch_idx].name
        else:
            batch_filter = None  # ALL

        # Mode selection
        print(f"\n  Upload mode:")
        print(f"    1. Append (skip existing)")
        print(f"    2. Overwrite (re-upload all)")
        print(f"    3. Dry run (preview only)")

        try:
            mode_choice = input(f"\n  Select mode (1-3): ").strip()
        except KeyboardInterrupt:
            print("\n  Cancelled.")
            return

        if mode_choice == "1":
            dry_run, overwrite = False, False
        elif mode_choice == "2":
            dry_run, overwrite = False, True
        elif mode_choice == "3":
            dry_run, overwrite = True, False
        else:
            print("  Invalid choice.")
            return
    else:
        # ── Flag mode ──
        dry_run = '--dry-run' in sys.argv
        overwrite = '--overwrite' in sys.argv
        batch_filter = None
        for arg in sys.argv[1:]:
            if arg.startswith('--batch'):
                if '=' in arg:
                    batch_filter = arg.split('=')[1]
                else:
                    idx = sys.argv.index(arg)
                    if idx + 1 < len(sys.argv):
                        batch_filter = sys.argv[idx + 1]

    # Show mode
    if dry_run:
        print(f"\n  MODE: DRY RUN (no uploads)")
    elif overwrite:
        print(f"\n  MODE: OVERWRITE (re-upload all)")
    else:
        print(f"\n  MODE: APPEND (skip existing)")

    # Import GCS library
    try:
        from google.cloud import storage
    except ImportError:
        print("ERROR: google-cloud-storage not installed.")
        print("Run: pip install google-cloud-storage")
        return

    # Connect to GCS
    print("Connecting to Google Cloud Storage...")
    client = storage.Client.from_service_account_json(str(GCS_CREDENTIALS))
    bucket = client.bucket(BUCKET_NAME)

    if not bucket.exists():
        print(f"  Creating bucket: {BUCKET_NAME}")
        bucket = client.create_bucket(BUCKET_NAME, location='US')
        # Make publicly readable
        policy = bucket.get_iam_policy(requested_policy_version=3)
        policy.bindings.append({'role': 'roles/storage.objectViewer', 'members': ['allUsers']})
        bucket.set_iam_policy(policy)
    print(f"  Bucket: {BUCKET_NAME} ✓")

    # Build list of existing blobs (for append mode)
    existing_blobs = set()
    if not overwrite and not dry_run:
        print("  Checking existing files on GCS...")
        for blob in bucket.list_blobs():
            existing_blobs.add(blob.name)
        print(f"  Existing files on GCS: {len(existing_blobs)}")

    # Apply batch filter
    batch_dirs = all_batch_dirs
    if batch_filter:
        batch_dirs = [d for d in batch_dirs if d.name == batch_filter]
        if not batch_dirs:
            print(f"ERROR: Batch folder '{batch_filter}' not found in {STOCKFLOW_SOCIAL_DIR}")
            return

    print(f"  Uploading: {', '.join(d.name for d in batch_dirs)}")

    # Collect all files to upload
    files_to_upload = []
    for batch_dir in batch_dirs:
        batch_name = batch_dir.name
        for content_type in CONTENT_TYPES:
            content_path = batch_dir / content_type
            if not content_path.exists():
                continue
            for fmt_dir in FORMATS:
                fmt_path = content_path / fmt_dir
                if not fmt_path.exists():
                    continue
                for f in sorted(fmt_path.glob('*.mp4')):
                    # GCS path mirrors local: Batch01/Montages/W/filename.mp4
                    gcs_path = f"{batch_name}/{content_type}/{fmt_dir}/{f.name}"
                    files_to_upload.append({
                        'local_path': f,
                        'gcs_path': gcs_path,
                        'size_mb': f.stat().st_size / (1024 * 1024)
                    })

    if not files_to_upload:
        print("\nNo .mp4 files found in Stockflow-social/Batch*/Montages|Clips|UGC/W|S|V/")
        return

    # Filter out existing (append mode)
    if not overwrite:
        before = len(files_to_upload)
        files_to_upload = [f for f in files_to_upload if f['gcs_path'] not in existing_blobs]
        skipped = before - len(files_to_upload)
        if skipped > 0:
            print(f"  Skipping {skipped} already uploaded files")

    total = len(files_to_upload)
    if total == 0:
        print("\nAll files already uploaded! Nothing to do.")
        return

    total_size = sum(f['size_mb'] for f in files_to_upload)
    print(f"\nFiles to upload: {total}")
    print(f"Total size: {total_size:.1f} MB")
    print(f"{'─' * 50}")

    # Upload
    uploaded = 0
    failed = 0
    start_time = time.time()

    for i, file_info in enumerate(files_to_upload):
        progress_bar(i, total, file_info['gcs_path'], start_time)

        if dry_run:
            uploaded += 1
            continue

        try:
            blob = bucket.blob(file_info['gcs_path'])
            blob.upload_from_filename(str(file_info['local_path']), content_type='video/mp4')
            uploaded += 1
        except Exception as e:
            failed += 1
            print(f"\n    FAILED: {file_info['gcs_path']} — {e}")

    progress_bar(total, total, "Complete", start_time)

    # Summary
    print(f"\n{'=' * 50}")
    print(f"  Upload Complete!")
    print(f"  Uploaded: {uploaded}")
    print(f"  Failed:   {failed}")
    print(f"  Skipped:  {len(existing_blobs) if not overwrite else 0}")
    print(f"  Total on GCS: {uploaded + len(existing_blobs)}")
    print(f"\n  Base URL: {GCS_BASE_URL}/")
    print(f"  Example:  {GCS_BASE_URL}/{files_to_upload[0]['gcs_path'] if files_to_upload else 'Batch01/Montages/W/example.mp4'}")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    main()
