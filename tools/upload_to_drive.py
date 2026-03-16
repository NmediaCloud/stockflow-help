"""
Phase 1: Upload montage videos to Google Drive + populate Master Sheet.

Uploads final montages from 'Marketing content/{format} output/03_With-music/'
to the shared Google Drive folder 'Stockflow_Media_publish', mirroring
the category/subcategory/collection folder structure.

Supports three formats: W (widescreen 16:9), S (square 1:1), V (vertical 9:16)

Usage:
    python tools/upload_to_drive.py                # Upload W format (default)
    python tools/upload_to_drive.py --format S     # Upload S format
    python tools/upload_to_drive.py --format V     # Upload V format
    python tools/upload_to_drive.py --format all   # Upload all formats
    python tools/upload_to_drive.py --check        # Compare local vs Drive (no upload)
    python tools/upload_to_drive.py --dry-run      # Preview what would be uploaded
    python tools/upload_to_drive.py --force         # Re-upload everything
    python tools/upload_to_drive.py --sheet-only    # Only update the Master Sheet

Credentials:
    Place your Google OAuth2 credentials file at:
        Marketing content/google_credentials.json
    On first run, a browser window will open for authorization.
    The token is saved to: Marketing content/google_token.json
"""

import os
import sys
import json
import time
import argparse
from pathlib import Path

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

# ── Config ───────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = (SCRIPT_DIR / "..").resolve()
MARKETING_DIR = PROJECT_ROOT / "Marketing content"
CREDENTIALS_FILE = MARKETING_DIR / "google_credentials.json"
TOKEN_FILE = MARKETING_DIR / "google_token.json"
UPLOAD_TRACKER = SCRIPT_DIR / "drive_upload_tracker.json"

# Format output directories
FORMAT_DIRS = {
    "W": MARKETING_DIR / "W output" / "03_With-music",
    "S": MARKETING_DIR / "S output" / "03_With-music",
    "V": MARKETING_DIR / "V output" / "03_With-music",
}

# Google Drive target folder
DRIVE_ROOT_FOLDER_ID = "1I2BpqMn5bAwOQwEJpzglZglDqujRI6D9"

# Scopes: Drive (upload) + Sheets (master sheet)
SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]


def progress(label, current, total, start_time=None):
    bar_len = 30
    filled = int(bar_len * current / total) if total else 0
    bar = "#" * filled + "-" * (bar_len - filled)
    pct = int(100 * current / total) if total else 0
    eta = ""
    if start_time and current > 0:
        elapsed = time.time() - start_time
        remaining = (elapsed / current) * (total - current)
        if remaining > 60:
            eta = f"  ETA: {int(remaining/60)}m {int(remaining%60)}s"
        else:
            eta = f"  ETA: {int(remaining)}s"
    sys.stdout.write(f"\r  [{bar}] {pct:3d}%  {label[:40]:<40}{eta:<20}")
    sys.stdout.flush()
    if current == total:
        elapsed = time.time() - start_time if start_time else 0
        print(f"  Done in {int(elapsed)}s")


# ── Auth ─────────────────────────────────────────────────────────────────
def get_google_creds():
    """Authenticate with Google APIs using OAuth2."""
    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                print(f"\n  ERROR: Credentials file not found at:")
                print(f"    {CREDENTIALS_FILE}")
                print(f"\n  To set up Google API access:")
                print(f"    1. Go to https://console.cloud.google.com/apis/credentials")
                print(f"    2. Create an OAuth 2.0 Client ID (Desktop application)")
                print(f"    3. Download the JSON and save as:")
                print(f"       Marketing content/google_credentials.json")
                print(f"    4. Enable 'Google Drive API' and 'Google Sheets API'")
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(
                str(CREDENTIALS_FILE), SCOPES
            )
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "w") as f:
            f.write(creds.to_json())
    return creds


# ── Upload tracker ───────────────────────────────────────────────────────
def load_tracker():
    if UPLOAD_TRACKER.exists():
        with open(UPLOAD_TRACKER, "r") as f:
            data = json.load(f)
        # Ensure required keys exist
        if "uploaded_files" not in data:
            data["uploaded_files"] = {}
        if "drive_folders" not in data:
            data["drive_folders"] = {}
        return data
    return {"uploaded_files": {}, "drive_folders": {}}


def save_tracker(tracker):
    with open(UPLOAD_TRACKER, "w") as f:
        json.dump(tracker, f, indent=2)


# ── Drive operations ────────────────────────────────────────────────────
def find_or_create_folder(drive_service, folder_name, parent_id, tracker):
    """Find or create a folder in Google Drive. Cache folder IDs in tracker."""
    cache_key = f"{parent_id}/{folder_name}"
    if cache_key in tracker["drive_folders"]:
        return tracker["drive_folders"][cache_key]

    # Search for existing folder
    query = (
        f"name='{folder_name}' and '{parent_id}' in parents "
        f"and mimeType='application/vnd.google-apps.folder' and trashed=false"
    )
    results = drive_service.files().list(q=query, fields="files(id, name)").execute()
    files = results.get("files", [])

    if files:
        folder_id = files[0]["id"]
    else:
        # Create folder
        metadata = {
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        }
        folder = drive_service.files().create(body=metadata, fields="id").execute()
        folder_id = folder["id"]
        print(f"    Created folder: {folder_name}")

    tracker["drive_folders"][cache_key] = folder_id
    save_tracker(tracker)
    return folder_id


def upload_file(drive_service, local_path, parent_folder_id, filename):
    """Upload a single file to Google Drive. Returns file ID and web link."""
    metadata = {"name": filename, "parents": [parent_folder_id]}
    media = MediaFileUpload(
        str(local_path), mimetype="video/mp4", resumable=True, chunksize=10 * 1024 * 1024
    )
    request = drive_service.files().create(
        body=metadata, media_body=media, fields="id, webViewLink"
    )

    response = None
    while response is None:
        status, response = request.next_chunk()

    return response["id"], response.get("webViewLink", "")


def list_drive_files(drive_service, folder_id, tracker):
    """Recursively list all MP4 files in a Drive folder. Returns dict of relative_path -> file_id."""
    drive_files = {}

    def _scan(parent_id, path_prefix=""):
        # List files
        query = f"'{parent_id}' in parents and trashed=false"
        page_token = None
        while True:
            results = drive_service.files().list(
                q=query, fields="nextPageToken, files(id, name, mimeType, size)",
                pageToken=page_token, pageSize=100
            ).execute()
            for f in results.get("files", []):
                rel = f"{path_prefix}{f['name']}" if path_prefix else f["name"]
                if f["mimeType"] == "application/vnd.google-apps.folder":
                    _scan(f["id"], f"{rel}/")
                elif f["name"].endswith(".mp4"):
                    drive_files[rel] = {
                        "id": f["id"],
                        "size": int(f.get("size", 0)),
                    }
            page_token = results.get("nextPageToken")
            if not page_token:
                break

    _scan(folder_id)
    return drive_files


# ── Scan local files ────────────────────────────────────────────────────
def scan_montages(formats=None):
    """Scan output directories and return list of montage info dicts.

    Args:
        formats: List of format codes to scan, e.g. ["W"], ["W", "S", "V"]
                 Defaults to ["W"] if None.
    """
    if formats is None:
        formats = ["W"]

    montages = []
    for fmt in formats:
        output_dir = FORMAT_DIRS.get(fmt)
        if not output_dir:
            print(f"  WARNING: Unknown format '{fmt}', skipping")
            continue
        if not output_dir.exists():
            print(f"  WARNING: Output directory not found for {fmt}: {output_dir}")
            continue

        for mp4_file in sorted(output_dir.rglob("*.mp4")):
            rel = mp4_file.relative_to(output_dir)
            parts = rel.parts  # e.g. ('microscopic', 'algae', 'algae-bloom.mp4')

            if len(parts) == 3:
                category, subcategory, filename = parts
                collection = filename.replace(".mp4", "")
            elif len(parts) == 2:
                category, filename = parts
                subcategory = ""
                collection = filename.replace(".mp4", "")
            else:
                continue

            # Convert slugs to display names
            cat_display = category.replace("-", " ").title()
            sub_display = subcategory.replace("-", " ").title() if subcategory else ""
            col_display = collection.replace("-", " ").title()

            file_size_mb = mp4_file.stat().st_size / (1024 * 1024)

            # Tracker key includes format prefix so W/S/V don't clash
            tracker_key = f"{fmt}/{rel}"

            montages.append({
                "local_path": str(mp4_file),
                "relative_path": str(rel),
                "tracker_key": tracker_key,
                "format": fmt,
                "category": category,
                "category_display": cat_display,
                "subcategory": subcategory,
                "subcategory_display": sub_display,
                "collection": collection,
                "collection_display": col_display,
                "filename": filename,
                "file_size_mb": round(file_size_mb, 1),
            })

    return montages


# ── Check: compare local vs Drive ────────────────────────────────────────
def check_drive_diff(formats):
    """Compare local files vs Drive files. Shows what's missing on each side."""
    montages = scan_montages(formats)
    if not montages:
        print("  No local montages found.")
        return

    creds = get_google_creds()
    drive_service = build("drive", "v3", credentials=creds)
    tracker = load_tracker()

    for fmt in formats:
        fmt_montages = [m for m in montages if m["format"] == fmt]
        if not fmt_montages:
            continue

        fmt_label = {"W": "Widescreen", "S": "Square", "V": "Vertical"}[fmt]
        print(f"\n  ── {fmt_label} ({fmt}) ──")

        # Find or create format folder on Drive
        fmt_folder_name = f"{fmt} output"
        fmt_folder_id = find_or_create_folder(
            drive_service, fmt_folder_name, DRIVE_ROOT_FOLDER_ID, tracker
        )

        # List all files on Drive under this format folder
        print(f"  Scanning Drive folder '{fmt_folder_name}'...")
        drive_files = list_drive_files(drive_service, fmt_folder_id, tracker)

        # Build set of local relative paths (normalize to forward slashes)
        local_paths = {m["relative_path"].replace("\\", "/") for m in fmt_montages}
        drive_paths = {p.replace("\\", "/") for p in drive_files.keys()}

        # Files on local but NOT on Drive
        only_local = sorted(local_paths - drive_paths)
        # Files on Drive but NOT local
        only_drive = sorted(drive_paths - local_paths)
        # Files on both
        on_both = sorted(local_paths & drive_paths)

        print(f"  Local: {len(local_paths)} files")
        print(f"  Drive: {len(drive_paths)} files")
        print(f"  Matched: {len(on_both)} files")

        if only_local:
            print(f"\n  Missing on Drive ({len(only_local)} files) — will upload:")
            for p in only_local[:15]:
                print(f"    + {p}")
            if len(only_local) > 15:
                print(f"    ... and {len(only_local) - 15} more")

        if only_drive:
            print(f"\n  Missing locally ({len(only_drive)} files) — only on Drive:")
            for p in only_drive[:15]:
                print(f"    - {p}")
            if len(only_drive) > 15:
                print(f"    ... and {len(only_drive) - 15} more")

        if not only_local and not only_drive:
            print(f"  All synced!")


# ── Main upload ──────────────────────────────────────────────────────────
def upload_montages(formats, dry_run=False, force=False):
    """Upload montage videos to Google Drive."""
    montages = scan_montages(formats)
    if not montages:
        print("  No montage files found.")
        return []

    tracker = load_tracker()
    creds = get_google_creds()
    drive_service = build("drive", "v3", credentials=creds)

    # Filter already uploaded (unless force)
    if not force:
        # First pass: check local tracker
        to_upload = [
            m for m in montages if m["tracker_key"] not in tracker["uploaded_files"]
        ]

        # Second pass: check actual Drive for files not in tracker
        if to_upload:
            print("  Checking Drive for existing files...")
            drive_existing = {}
            for fmt in formats:
                fmt_folder_name = f"{fmt} output"
                fmt_folder_id = find_or_create_folder(
                    drive_service, fmt_folder_name, DRIVE_ROOT_FOLDER_ID, tracker
                )
                fmt_files = list_drive_files(drive_service, fmt_folder_id, tracker)
                for rel_path, info in fmt_files.items():
                    # Normalize path separators
                    normalized = rel_path.replace("\\", "/")
                    drive_existing[f"{fmt}/{normalized}"] = info

            # Skip files that exist on Drive, backfill tracker
            still_needed = []
            backfilled = 0
            for m in to_upload:
                drive_key = f"{m['format']}/{m['relative_path'].replace(chr(92), '/')}"
                if drive_key in drive_existing:
                    # File exists on Drive — backfill tracker
                    info = drive_existing[drive_key]
                    tracker["uploaded_files"][m["tracker_key"]] = {
                        "drive_file_id": info["id"],
                        "drive_link": f"https://drive.google.com/file/d/{info['id']}/view?usp=drivesdk",
                        "format": m["format"],
                        "uploaded_at": "manual",
                        "file_size_mb": m["file_size_mb"],
                    }
                    backfilled += 1
                else:
                    still_needed.append(m)

            if backfilled > 0:
                save_tracker(tracker)
                print(f"  Found {backfilled} files already on Drive (tracker updated)")

            to_upload = still_needed
    else:
        to_upload = montages

    print(f"\n  Found {len(montages)} total montages, {len(to_upload)} to upload")
    total_size = sum(m["file_size_mb"] for m in to_upload)
    print(f"  Total upload size: {total_size:.1f} MB")

    # Show format breakdown
    for fmt in formats:
        fmt_total = len([m for m in montages if m["format"] == fmt])
        fmt_upload = len([m for m in to_upload if m["format"] == fmt])
        print(f"    {fmt}: {fmt_upload}/{fmt_total} to upload")

    if dry_run:
        print("\n  [DRY RUN] Would upload:")
        for m in to_upload[:20]:
            print(f"    [{m['format']}] {m['relative_path']} ({m['file_size_mb']} MB)")
        if len(to_upload) > 20:
            print(f"    ... and {len(to_upload) - 20} more")
        return montages

    if not to_upload:
        print("  All files already uploaded. Use --force to re-upload.")
        return montages

    print(f"\n  Uploading to Drive folder: Stockflow_Media_publish")
    start_time = time.time()

    for i, m in enumerate(to_upload):
        # Create format folder first: root > "W output" (or S/V)
        fmt_folder_name = f"{m['format']} output"
        fmt_folder_id = find_or_create_folder(
            drive_service, fmt_folder_name, DRIVE_ROOT_FOLDER_ID, tracker
        )

        # Create folder hierarchy: format > category > subcategory
        # Use slug names (matching local folders) for Drive folder names
        cat_folder_id = find_or_create_folder(
            drive_service, m["category"], fmt_folder_id, tracker
        )

        if m["subcategory"]:
            sub_folder_id = find_or_create_folder(
                drive_service, m["subcategory"], cat_folder_id, tracker
            )
            target_folder_id = sub_folder_id
        else:
            target_folder_id = cat_folder_id

        # Upload the file
        file_id, web_link = upload_file(
            drive_service, m["local_path"], target_folder_id, m["filename"]
        )

        # Track the upload using format-prefixed key
        tracker["uploaded_files"][m["tracker_key"]] = {
            "drive_file_id": file_id,
            "drive_link": web_link,
            "format": m["format"],
            "uploaded_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "file_size_mb": m["file_size_mb"],
        }
        save_tracker(tracker)

        progress("Uploading", i + 1, len(to_upload), start_time)

    return montages


# ── Master Sheet ─────────────────────────────────────────────────────────
def create_master_sheet(montages=None, formats=None):
    """Create or update the Master Publishing Sheet in Google Sheets."""
    if montages is None:
        montages = scan_montages(formats)

    tracker = load_tracker()
    creds = get_google_creds()
    sheets_service = build("sheets", "v4", credentials=creds)
    drive_service = build("drive", "v3", credentials=creds)

    # Check if Master Sheet already exists in the Drive folder
    sheet_name = "Stockflow Publishing Master"
    query = (
        f"name='{sheet_name}' and '{DRIVE_ROOT_FOLDER_ID}' in parents "
        f"and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
    )
    results = drive_service.files().list(q=query, fields="files(id, name)").execute()
    existing = results.get("files", [])

    if existing:
        spreadsheet_id = existing[0]["id"]
        print(f"\n  Found existing Master Sheet: {spreadsheet_id}")
    else:
        # Create new spreadsheet in the Drive folder
        spreadsheet = {
            "properties": {"title": sheet_name},
            "sheets": [
                {"properties": {"title": "Content Library", "index": 0}},
                {"properties": {"title": "Publishing Schedule", "index": 1}},
            ],
        }
        result = sheets_service.spreadsheets().create(body=spreadsheet).execute()
        spreadsheet_id = result["spreadsheetId"]

        # Move to Drive folder
        file = drive_service.files().get(fileId=spreadsheet_id, fields="parents").execute()
        previous_parents = ",".join(file.get("parents", []))
        drive_service.files().update(
            fileId=spreadsheet_id,
            addParents=DRIVE_ROOT_FOLDER_ID,
            removeParents=previous_parents,
            fields="id, parents",
        ).execute()
        print(f"\n  Created Master Sheet: {spreadsheet_id}")

    # ── Build Content Library rows ───────────────────────────────────
    headers = [
        "Format",
        "Category",
        "Subcategory",
        "Collection",
        "Filename",
        "File Size (MB)",
        "Drive Link",
        "Drive File ID",
        "Upload Status",
        "YouTube URL",
        "YouTube Video ID",
        "YouTube Upload Status",
        "FeedHive Exported",
        "Twitter Posted",
        "Pinterest Posted",
        "Reddit Posted",
        "Facebook Posted",
        "Help Page URL",
        "Stockflow URL",
        "Notes",
    ]

    rows = [headers]
    for m in montages:
        upload_info = tracker.get("uploaded_files", {}).get(m["tracker_key"], {})
        drive_link = upload_info.get("drive_link", "")
        drive_file_id = upload_info.get("drive_file_id", "")
        upload_status = "Uploaded" if upload_info else "Pending"

        # Build help page and stockflow URLs
        help_url = f"https://help.stockflow.media/collections/{m['collection']}/"
        stockflow_url = f"https://stockflow.media/?cat={m['category_display']}"
        if m["subcategory_display"]:
            stockflow_url += f"&sub={m['subcategory_display']}"
            stockflow_url += f"&collection={m['collection_display']}"

        rows.append([
            m["format"],
            m["category_display"],
            m["subcategory_display"],
            m["collection_display"],
            m["filename"],
            str(m["file_size_mb"]),
            drive_link,
            drive_file_id,
            upload_status,
            "",  # YouTube URL
            "",  # YouTube Video ID
            "",  # YouTube Upload Status
            "",  # FeedHive Exported
            "",  # Twitter Posted
            "",  # Pinterest Posted
            "",  # Reddit Posted
            "",  # Facebook Posted
            help_url,
            stockflow_url,
            "",  # Notes
        ])

    # Write to Content Library tab
    body = {"values": rows}
    sheets_service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range="Content Library!A1",
        valueInputOption="RAW",
        body=body,
    ).execute()

    # ── Format the header row ────────────────────────────────────────
    # Look up actual sheet ID (auto-assigned, may not be 0)
    sheet_meta = sheets_service.spreadsheets().get(
        spreadsheetId=spreadsheet_id, fields="sheets.properties"
    ).execute()
    sheet_id = sheet_meta["sheets"][0]["properties"]["sheetId"]
    requests = [
        # Bold header row
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {"bold": True},
                        "backgroundColor": {
                            "red": 0.2,
                            "green": 0.2,
                            "blue": 0.2,
                        },
                        "textFormat": {
                            "bold": True,
                            "foregroundColor": {
                                "red": 1.0,
                                "green": 1.0,
                                "blue": 1.0,
                            },
                        },
                    }
                },
                "fields": "userEnteredFormat(textFormat,backgroundColor)",
            }
        },
        # Freeze header row
        {
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {"frozenRowCount": 1},
                },
                "fields": "gridProperties.frozenRowCount",
            }
        },
        # Auto-resize columns
        {
            "autoResizeDimensions": {
                "dimensions": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": 0,
                    "endIndex": len(headers),
                }
            }
        },
    ]

    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id, body={"requests": requests}
    ).execute()

    sheet_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}"
    print(f"  Master Sheet URL: {sheet_url}")
    print(f"  Content Library: {len(rows) - 1} entries")

    # Save sheet ID to tracker for future phases
    tracker["master_sheet_id"] = spreadsheet_id
    tracker["master_sheet_url"] = sheet_url
    save_tracker(tracker)

    return spreadsheet_id


# ── CLI ──────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Upload Stockflow montages to Google Drive + Master Sheet"
    )
    parser.add_argument("--format", default="W", help="Format to upload: W, S, V, or all (default: W)")
    parser.add_argument("--dry-run", action="store_true", help="Preview uploads without executing")
    parser.add_argument("--force", action="store_true", help="Re-upload all files")
    parser.add_argument("--sheet-only", action="store_true", help="Only update the Master Sheet")
    parser.add_argument("--check", action="store_true", help="Compare local vs Drive (no upload)")
    args = parser.parse_args()

    # Parse format choice
    if args.format.lower() == "all":
        formats = ["W", "S", "V"]
    else:
        formats = [args.format.upper()]

    print("\n=== Stockflow Publishing Pipeline - Phase 1 ===")
    print(f"  Formats: {', '.join(formats)}\n")

    if args.check:
        check_drive_diff(formats)
    elif args.sheet_only:
        montages = scan_montages(formats)
        print(f"  Scanned {len(montages)} montage files")
        create_master_sheet(montages, formats)
    else:
        montages = upload_montages(formats, dry_run=args.dry_run, force=args.force)
        if not args.dry_run and montages:
            print("\n--- Updating Master Sheet ---")
            create_master_sheet(montages, formats)

    print("\n=== Phase 1 Complete ===\n")


if __name__ == "__main__":
    main()
