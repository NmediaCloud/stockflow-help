"""
Upload Stockflow-social/ folder structure to Google Drive.
Mirrors the local batch folder structure exactly.

Only scans inside Batch folders (Batch01, Batch02, etc.)
Supports append (skip existing) or overwrite mode.

Usage:
    python tools/upload_to_drive_batch.py                    # Interactive prompts
    python tools/upload_to_drive_batch.py --batch Batch01    # Upload specific batch
    python tools/upload_to_drive_batch.py --batch all        # Upload all batches
    python tools/upload_to_drive_batch.py --overwrite        # Re-upload everything
    python tools/upload_to_drive_batch.py --dry-run          # Preview only
"""

import os
import sys
import json
import argparse
from pathlib import Path

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

# ── Config ─────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = (SCRIPT_DIR / "..").resolve()
MARKETING_DIR = PROJECT_ROOT / "Marketing content"
SOURCE_DIR = MARKETING_DIR / "Stockflow-social"
CREDENTIALS_FILE = MARKETING_DIR / "google_credentials.json"
TOKEN_FILE = MARKETING_DIR / "google_token.json"

DRIVE_ROOT_FOLDER_ID = "1I2BpqMn5bAwOQwEJpzglZglDqujRI6D9"

SCOPES = [
    "https://www.googleapis.com/auth/drive",
]


def get_drive_service():
    """Authenticate and return Drive API service."""
    creds = None
    if TOKEN_FILE.exists():
        with open(TOKEN_FILE, "r") as f:
            token_data = json.load(f)
        creds = Credentials(
            token=token_data.get("token"),
            refresh_token=token_data.get("refresh_token"),
            token_uri="https://oauth2.googleapis.com/token",
            client_id=token_data.get("client_id"),
            client_secret=token_data.get("client_secret"),
            scopes=SCOPES,
        )
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "w") as f:
            json.dump({
                "token": creds.token,
                "refresh_token": creds.refresh_token,
                "client_id": creds.client_id,
                "client_secret": creds.client_secret,
            }, f)
    return build("drive", "v3", credentials=creds)


def find_or_create_folder(service, name, parent_id):
    """Find a folder by name under parent, or create it."""
    query = f"name='{name}' and '{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
    results = service.files().list(q=query, fields="files(id, name)", spaces="drive").execute()
    files = results.get("files", [])
    if files:
        return files[0]["id"]
    # Create folder
    metadata = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    folder = service.files().create(body=metadata, fields="id").execute()
    return folder["id"]


def list_drive_files(service, folder_id):
    """List all files in a Drive folder (non-recursive)."""
    files = {}
    page_token = None
    while True:
        results = service.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            fields="nextPageToken, files(id, name, mimeType)",
            spaces="drive",
            pageToken=page_token,
        ).execute()
        for f in results.get("files", []):
            files[f["name"]] = {"id": f["id"], "mimeType": f["mimeType"]}
        page_token = results.get("nextPageToken")
        if not page_token:
            break
    return files


def upload_file(service, local_path, parent_id, existing_id=None):
    """Upload a file to Drive. If existing_id, update it."""
    filename = os.path.basename(local_path)

    # Determine MIME type
    ext = os.path.splitext(filename)[1].lower()
    mime_map = {
        ".mp4": "video/mp4",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".json": "application/json",
        ".csv": "text/csv",
        ".txt": "text/plain",
    }
    mime_type = mime_map.get(ext, "application/octet-stream")

    media = MediaFileUpload(str(local_path), mimetype=mime_type, resumable=True)

    if existing_id:
        # Update existing file
        request = service.files().update(fileId=existing_id, media_body=media)
    else:
        # Create new file
        metadata = {"name": filename, "parents": [parent_id]}
        request = service.files().create(body=metadata, media_body=media, fields="id")

    response = None
    while response is None:
        status, response = request.next_chunk()

    return response.get("id", existing_id)


def upload_folder_recursive(service, local_dir, drive_parent_id, overwrite=False, dry_run=False, stats=None):
    """Recursively upload a local folder to Drive."""
    if stats is None:
        stats = {"uploaded": 0, "skipped": 0, "folders_created": 0}

    # List existing Drive files in this folder
    drive_files = list_drive_files(service, drive_parent_id)

    # Process all items in the local directory
    items = sorted(os.listdir(local_dir))

    for item in items:
        local_path = os.path.join(local_dir, item)

        if os.path.isdir(local_path):
            # It's a folder — find or create on Drive
            if item in drive_files and drive_files[item]["mimeType"] == "application/vnd.google-apps.folder":
                subfolder_id = drive_files[item]["id"]
            else:
                if dry_run:
                    print(f"  [DRY] Create folder: {item}/")
                    stats["folders_created"] += 1
                    continue
                subfolder_id = find_or_create_folder(service, item, drive_parent_id)
                stats["folders_created"] += 1
                print(f"  + Folder: {item}/")

            # Recurse into subfolder
            upload_folder_recursive(service, local_path, subfolder_id, overwrite, dry_run, stats)

        elif os.path.isfile(local_path):
            size_mb = os.path.getsize(local_path) / (1024 * 1024)

            if item in drive_files and not overwrite:
                stats["skipped"] += 1
                continue

            existing_id = drive_files.get(item, {}).get("id") if overwrite else None

            if dry_run:
                action = "OVERWRITE" if existing_id else "UPLOAD"
                print(f"  [DRY] {action}: {item} ({size_mb:.1f} MB)")
                stats["uploaded"] += 1
                continue

            try:
                action = "↑" if not existing_id else "⟳"
                print(f"  {action} {item} ({size_mb:.1f} MB)...", end="", flush=True)
                upload_file(service, local_path, drive_parent_id, existing_id)
                print(" ✓")
                stats["uploaded"] += 1
            except Exception as e:
                print(f" FAILED: {e}")

    return stats


def get_batch_folders():
    """Find all Batch folders in Stockflow-social/."""
    if not SOURCE_DIR.exists():
        return []
    batches = []
    for item in sorted(SOURCE_DIR.iterdir()):
        if item.is_dir() and item.name.lower().startswith("batch"):
            batches.append(item.name)
    return batches


def main():
    parser = argparse.ArgumentParser(description="Upload Stockflow-social batches to Google Drive")
    parser.add_argument("--batch", help="Batch folder name (e.g., Batch01) or 'all'")
    parser.add_argument("--overwrite", action="store_true", help="Re-upload existing files")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, no uploads")
    args = parser.parse_args()

    # Find available batches
    batches = get_batch_folders()
    if not batches:
        print("No batch folders found in:", SOURCE_DIR)
        return

    # Interactive mode if no --batch flag
    if not args.batch:
        print("  Batches found:")
        for i, b in enumerate(batches, 1):
            # Count files
            file_count = sum(1 for _ in Path(SOURCE_DIR / b).rglob("*") if _.is_file())
            print(f"    {i}. {b} ({file_count} files)")
        print(f"    {len(batches) + 1}. ALL batches")
        print()

        choice = input("  Select batch (1-{}): ".format(len(batches) + 1)).strip()
        try:
            idx = int(choice)
            if idx == len(batches) + 1:
                selected_batches = batches
            elif 1 <= idx <= len(batches):
                selected_batches = [batches[idx - 1]]
            else:
                print("Invalid choice.")
                return
        except ValueError:
            print("Invalid choice.")
            return

        print()
        print("  Mode:")
        print("    1. Append (skip existing files)")
        print("    2. Overwrite (re-upload all)")
        print("    3. Dry run (preview only)")
        print()
        mode = input("  Select mode (1-3): ").strip()
        if mode == "2":
            args.overwrite = True
        elif mode == "3":
            args.dry_run = True
    else:
        if args.batch.lower() == "all":
            selected_batches = batches
        else:
            if args.batch in batches:
                selected_batches = [args.batch]
            else:
                print(f"Batch '{args.batch}' not found. Available: {', '.join(batches)}")
                return

    # Connect to Drive
    print()
    print("Connecting to Google Drive...")
    service = get_drive_service()
    print("  Connected ✓")
    print()

    # Upload each selected batch
    total_stats = {"uploaded": 0, "skipped": 0, "folders_created": 0}

    for batch_name in selected_batches:
        local_batch_dir = SOURCE_DIR / batch_name
        print(f"{'=' * 50}")
        print(f"  Batch: {batch_name}")
        print(f"{'=' * 50}")

        # Find or create batch folder on Drive
        batch_folder_id = find_or_create_folder(service, batch_name, DRIVE_ROOT_FOLDER_ID)

        # Upload recursively
        stats = upload_folder_recursive(
            service, str(local_batch_dir), batch_folder_id,
            overwrite=args.overwrite, dry_run=args.dry_run
        )

        total_stats["uploaded"] += stats["uploaded"]
        total_stats["skipped"] += stats["skipped"]
        total_stats["folders_created"] += stats["folders_created"]
        print()

    # Summary
    prefix = "[DRY RUN] " if args.dry_run else ""
    print(f"{prefix}Upload Complete!")
    print(f"  Files uploaded: {total_stats['uploaded']}")
    print(f"  Files skipped: {total_stats['skipped']}")
    print(f"  Folders created: {total_stats['folders_created']}")


if __name__ == "__main__":
    main()
