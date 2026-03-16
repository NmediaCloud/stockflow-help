"""
Phase 3: Upload montage videos to YouTube.

Uploads final montages from 'Marketing content/W output/03_With-music/'
to the YouTube channel @StockflowMedia with auto-generated metadata.

Usage:
    python tools/upload_to_youtube.py                  # Upload all (skip already uploaded)
    python tools/upload_to_youtube.py --dry-run         # Preview what would be uploaded
    python tools/upload_to_youtube.py --force            # Re-upload everything
    python tools/upload_to_youtube.py --limit 5          # Upload only first 5
    python tools/upload_to_youtube.py --update-sheet     # Only update Master Sheet (no uploads)
    python tools/upload_to_youtube.py --publish           # Make all unlisted videos public
    python tools/upload_to_youtube.py --publish --publish-limit 3  # Publish only 3

Note: YouTube API has a daily upload quota. Default quota allows ~6 uploads/day.
      Request quota increase at: https://support.google.com/youtube/contact/yt_api_form
"""

import os
import sys
import json
import time
import argparse
import urllib.parse
from pathlib import Path

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError

# ── Config ───────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = (SCRIPT_DIR / "..").resolve()
MARKETING_DIR = PROJECT_ROOT / "Marketing content"
OUTPUT_DIR = MARKETING_DIR / "W output" / "03_With-music"
CREDENTIALS_FILE = MARKETING_DIR / "google_credentials.json"
YOUTUBE_TOKEN_FILE = MARKETING_DIR / "youtube_token.json"
UPLOAD_TRACKER = SCRIPT_DIR / "drive_upload_tracker.json"

# YouTube needs its own scope (separate from Drive/Sheets)
YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/spreadsheets",
]

# Stockflow website base URL
STOCKFLOW_BASE = "https://stockflow.media/"
HELP_BASE = "https://help.stockflow.media/collections/"

# YouTube category IDs
# 22 = People & Blogs, 27 = Education, 28 = Science & Technology
CATEGORY_MAP = {
    "microscopic": "28",      # Science & Technology
    "food-beverage": "22",    # People & Blogs
}
DEFAULT_CATEGORY = "22"


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
def get_youtube_creds():
    """Authenticate with YouTube API using separate token file."""
    creds = None
    if YOUTUBE_TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(YOUTUBE_TOKEN_FILE), YOUTUBE_SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                print(f"\n  ERROR: Credentials file not found at:")
                print(f"    {CREDENTIALS_FILE}")
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(
                str(CREDENTIALS_FILE), YOUTUBE_SCOPES
            )
            creds = flow.run_local_server(port=0)
        with open(YOUTUBE_TOKEN_FILE, "w") as f:
            f.write(creds.to_json())
    return creds


# ── Tracker ──────────────────────────────────────────────────────────────
def load_tracker():
    if UPLOAD_TRACKER.exists():
        with open(UPLOAD_TRACKER, "r") as f:
            return json.load(f)
    return {"uploaded_files": {}, "drive_folders": {}}


def save_tracker(tracker):
    with open(UPLOAD_TRACKER, "w") as f:
        json.dump(tracker, f, indent=2)


# ── Video metadata ───────────────────────────────────────────────────────
def build_video_metadata(category, subcategory, collection, cat_display, sub_display, col_display):
    """Generate YouTube title, description, and tags for a montage."""

    title = f"{col_display} - Premium {sub_display} Stock Footage | Stockflow.media"
    # YouTube title max 100 chars
    if len(title) > 100:
        title = f"{col_display} - {sub_display} Stock Footage | Stockflow"
    if len(title) > 100:
        title = f"{col_display} Stock Footage | Stockflow.media"[:100]

    # Build URLs (properly encoded)
    help_url = f"{HELP_BASE}{collection}/"
    params = urllib.parse.urlencode({
        "cat": cat_display, "sub": sub_display, "collection": col_display
    })
    stockflow_url = f"{STOCKFLOW_BASE}?{params}"

    description = (
        f"Browse premium {col_display} stock footage from Stockflow.media\n"
        f"\n"
        f"Category: {cat_display} - {sub_display} - {col_display}\n"
        f"Available in 4K, HD formats (16:9, 9:16, 1:1)\n"
        f"Instant download, affordable pricing from $1\n"
        f"\n"
        f"Browse this collection: {stockflow_url}\n"
        f"Learn more: {help_url}\n"
        f"\n"
        f"Stockflow.media - Premium Stock Footage Marketplace\n"
        f"Website: https://stockflow.media\n"
        f"Help and Guides: https://help.stockflow.media"
    )

    tags = [
        col_display,
        sub_display,
        cat_display,
        "stock footage",
        "4K stock footage",
        f"{col_display} stock footage",
        f"{sub_display} stock footage",
        "stock video",
        "Stockflow",
        "stockflow.media",
        "premium stock footage",
        "royalty free footage",
        "video clips",
    ]

    # Add category-specific tags
    if category == "microscopic":
        tags.extend(["microscopic footage", "microscopy", "science footage",
                     "educational video", "microscope video"])
    elif category == "food-beverage":
        tags.extend(["food footage", "food video", "cooking footage",
                     "restaurant footage", "food photography"])

    # YouTube tags max 500 chars total
    tags_str = ",".join(tags)
    while len(tags_str) > 500 and tags:
        tags.pop()
        tags_str = ",".join(tags)

    yt_category = CATEGORY_MAP.get(category, DEFAULT_CATEGORY)

    return {
        "title": title,
        "description": description,
        "tags": tags,
        "category_id": yt_category,
    }


# ── Scan local files ────────────────────────────────────────────────────
def scan_montages():
    """Scan the output directory and return list of montage info dicts."""
    montages = []
    if not OUTPUT_DIR.exists():
        print(f"  ERROR: Output directory not found: {OUTPUT_DIR}")
        return montages

    for mp4_file in sorted(OUTPUT_DIR.rglob("*.mp4")):
        rel = mp4_file.relative_to(OUTPUT_DIR)
        parts = rel.parts

        if len(parts) == 3:
            # category/subcategory/filename.mp4
            category, subcategory, filename = parts
            collection = filename.replace(".mp4", "")

            # Subcategory montage (e.g. food-menu_montage.mp4)
            if filename.endswith("_montage.mp4"):
                video_type = "subcategory"
                collection = ""
            else:
                video_type = "collection"

        elif len(parts) == 2:
            # category/filename.mp4 (category montage)
            category, filename = parts

            if filename.endswith("_category.mp4"):
                video_type = "category"
                subcategory = ""
                collection = ""
            else:
                video_type = "collection"
                subcategory = ""
                collection = filename.replace(".mp4", "")
        else:
            continue

        cat_display = category.replace("-", " ").title()
        sub_display = subcategory.replace("-", " ").title() if subcategory else ""
        col_display = collection.replace("-", " ").title() if collection else ""

        file_size_mb = mp4_file.stat().st_size / (1024 * 1024)

        montages.append({
            "local_path": str(mp4_file),
            "relative_path": str(rel),
            "category": category,
            "category_display": cat_display,
            "subcategory": subcategory,
            "subcategory_display": sub_display,
            "collection": collection,
            "collection_display": col_display,
            "filename": filename,
            "file_size_mb": round(file_size_mb, 1),
            "video_type": video_type,
        })

    return montages


# ── YouTube upload ───────────────────────────────────────────────────────
def upload_video(youtube, local_path, metadata):
    """Upload a single video to YouTube. Returns video ID."""
    body = {
        "snippet": {
            "title": metadata["title"],
            "description": metadata["description"],
            "tags": metadata["tags"],
            "categoryId": metadata["category_id"],
        },
        "status": {
            "privacyStatus": "unlisted",  # Start as unlisted, change to public later
            "selfDeclaredMadeForKids": False,
        },
    }

    media = MediaFileUpload(
        local_path,
        mimetype="video/mp4",
        resumable=True,
        chunksize=10 * 1024 * 1024,  # 10MB chunks
    )

    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media,
    )

    response = None
    while response is None:
        status, response = request.next_chunk()

    video_id = response["id"]
    return video_id


def upload_montages(dry_run=False, force=False, limit=None, include_categories=False):
    """Upload collection + subcategory montage videos to YouTube.
    Category montages are excluded by default (use --include-categories to include them).
    """
    montages = scan_montages()
    if not montages:
        print("  No montage files found.")
        return []

    # Exclude category montages by default
    if not include_categories:
        excluded = [m for m in montages if m["video_type"] == "category"]
        montages = [m for m in montages if m["video_type"] != "category"]
        if excluded:
            print(f"  Excluding {len(excluded)} category montages (use --include-categories to include)")

    tracker = load_tracker()

    # Initialize youtube_uploads in tracker if not present
    if "youtube_uploads" not in tracker:
        tracker["youtube_uploads"] = {}

    # Filter already uploaded (unless force)
    if not force:
        to_upload = [
            m for m in montages
            if m["relative_path"] not in tracker["youtube_uploads"]
        ]
    else:
        to_upload = montages

    if limit:
        to_upload = to_upload[:limit]

    print(f"\n  Found {len(montages)} total montages, {len(to_upload)} to upload")
    total_size = sum(m["file_size_mb"] for m in to_upload)
    print(f"  Total upload size: {total_size:.1f} MB")

    if dry_run:
        print("\n  [DRY RUN] Would upload:")
        for m in to_upload[:20]:
            meta = build_video_metadata(
                m["category"], m["subcategory"], m["collection"],
                m["category_display"], m["subcategory_display"], m["collection_display"]
            )
            print(f"    {m['relative_path']}")
            print(f"      Title: {meta['title']}")
        if len(to_upload) > 20:
            print(f"    ... and {len(to_upload) - 20} more")
        return montages

    if not to_upload:
        print("  All files already uploaded. Use --force to re-upload.")
        return montages

    # Authenticate
    creds = get_youtube_creds()
    youtube = build("youtube", "v3", credentials=creds)

    print(f"\n  Uploading to YouTube channel @StockflowMedia")
    print(f"  Note: YouTube API quota may limit uploads to ~6/day")
    start_time = time.time()
    uploaded_count = 0

    for i, m in enumerate(to_upload):
        metadata = build_video_metadata(
            m["category"], m["subcategory"], m["collection"],
            m["category_display"], m["subcategory_display"], m["collection_display"]
        )

        try:
            video_id = upload_video(youtube, m["local_path"], metadata)

            video_url = f"https://www.youtube.com/watch?v={video_id}"
            tracker["youtube_uploads"][m["relative_path"]] = {
                "video_id": video_id,
                "video_url": video_url,
                "title": metadata["title"],
                "uploaded_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            save_tracker(tracker)
            uploaded_count += 1
            progress("Uploading", i + 1, len(to_upload), start_time)

        except HttpError as e:
            error_reason = e.error_details[0]["reason"] if e.error_details else str(e)
            if "quotaExceeded" in str(e) or "uploadLimitExceeded" in str(e):
                print(f"\n\n  YouTube quota exceeded after {uploaded_count} uploads.")
                print(f"  Re-run tomorrow to continue from where you left off.")
                break
            else:
                print(f"\n  ERROR uploading {m['filename']}: {error_reason}")
                continue

    print(f"\n  Successfully uploaded {uploaded_count} videos")
    return montages


# ── Update Master Sheet ──────────────────────────────────────────────────
def get_sheets_creds():
    """Get Drive/Sheets credentials (separate from YouTube creds)."""
    token_file = MARKETING_DIR / "google_token.json"
    scopes = [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets",
    ]
    creds = None
    if token_file.exists():
        creds = Credentials.from_authorized_user_file(str(token_file), scopes)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
    return creds


def update_master_sheet():
    """Write YouTube video IDs and URLs back to the Master Sheet."""
    tracker = load_tracker()
    spreadsheet_id = tracker.get("master_sheet_id")
    if not spreadsheet_id:
        print("  ERROR: No Master Sheet found. Run Phase 1 first.")
        return

    youtube_uploads = tracker.get("youtube_uploads", {})
    if not youtube_uploads:
        print("  No YouTube uploads to sync.")
        return

    # Use Drive/Sheets token (not YouTube token) for sheet access
    creds = get_sheets_creds()
    if not creds:
        print("  ERROR: No Sheets credentials found. Run Phase 1 first.")
        return
    sheets_service = build("sheets", "v4", credentials=creds)

    # Read current Content Library to match rows
    result = sheets_service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range="Content Library!A2:S",
    ).execute()
    rows = result.get("values", [])

    # Build updates: columns I (YouTube URL), J (Video ID), K (YouTube Upload Status)
    updates = []
    matched = 0
    for row_idx, row in enumerate(rows):
        while len(row) < 19:
            row.append("")

        # Match by filename (column D, index 3)
        filename = row[3] if len(row) > 3 else ""
        # Find matching upload by looking for filename in relative paths
        for rel_path, upload_info in youtube_uploads.items():
            if rel_path.endswith(filename):
                cell_row = row_idx + 2  # +2 for header + 0-index
                updates.append({
                    "range": f"Content Library!I{cell_row}:K{cell_row}",
                    "values": [[
                        upload_info["video_url"],
                        upload_info["video_id"],
                        "Uploaded",
                    ]]
                })
                matched += 1
                break

    if updates:
        body = {
            "valueInputOption": "RAW",
            "data": updates,
        }
        sheets_service.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id, body=body
        ).execute()
        print(f"  Updated {matched} rows in Master Sheet with YouTube data")
    else:
        print("  No matching rows found to update")


# ── Publish (unlisted → public) ──────────────────────────────────────────
def publish_videos(limit=None):
    """Change unlisted videos to public."""
    tracker = load_tracker()
    youtube_uploads = tracker.get("youtube_uploads", {})
    if not youtube_uploads:
        print("  No YouTube uploads found.")
        return

    creds = get_youtube_creds()
    youtube = build("youtube", "v3", credentials=creds)

    to_publish = [
        (rel, info) for rel, info in youtube_uploads.items()
        if not info.get("published")
    ]

    if limit:
        to_publish = to_publish[:limit]

    print(f"\n  {len(to_publish)} videos to publish (unlisted -> public)")

    if not to_publish:
        print("  All videos already published.")
        return

    published = 0
    for rel, info in to_publish:
        video_id = info["video_id"]
        try:
            youtube.videos().update(
                part="status",
                body={
                    "id": video_id,
                    "status": {
                        "privacyStatus": "public",
                        "selfDeclaredMadeForKids": False,
                    },
                },
            ).execute()
            tracker["youtube_uploads"][rel]["published"] = True
            save_tracker(tracker)
            published += 1
            print(f"  Published: {info.get('title', rel)}")
        except HttpError as e:
            print(f"  ERROR publishing {video_id}: {e}")

    print(f"\n  {published}/{len(to_publish)} videos made public")


# ── CLI ──────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Upload Stockflow montages to YouTube"
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview uploads")
    parser.add_argument("--force", action="store_true", help="Re-upload all")
    parser.add_argument("--limit", type=int, help="Limit number of uploads")
    parser.add_argument("--update-sheet", action="store_true", help="Only update Master Sheet")
    parser.add_argument("--publish", action="store_true", help="Make unlisted videos public")
    parser.add_argument("--publish-limit", type=int, help="Limit how many to publish")
    parser.add_argument("--include-categories", action="store_true", help="Also upload category montages")
    args = parser.parse_args()

    print("\n=== Stockflow Publishing Pipeline - Phase 3 (YouTube) ===\n")

    if args.publish:
        publish_videos(limit=args.publish_limit)
    elif args.update_sheet:
        update_master_sheet()
    else:
        montages = upload_montages(
            dry_run=args.dry_run,
            force=args.force,
            limit=args.limit,
            include_categories=args.include_categories,
        )
        if not args.dry_run and montages:
            print("\n--- Updating Master Sheet ---")
            update_master_sheet()

    print("\n=== Phase 3 Complete ===\n")


if __name__ == "__main__":
    main()
