"""
Phase 2: Generate Publishing Schedule in the Master Sheet.

Reads the Content Library tab and creates a staggered posting schedule
across platforms with optimal posting times.

Usage:
    python tools/generate_schedule.py                          # Generate schedule starting tomorrow
    python tools/generate_schedule.py --start 2026-03-14       # Custom start date
    python tools/generate_schedule.py --pace 3                 # Posts per day (default: 2)
    python tools/generate_schedule.py --preview                # Preview without writing to sheet
"""

import os
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime, timedelta
import random

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# ── Config ───────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = (SCRIPT_DIR / "..").resolve()
MARKETING_DIR = PROJECT_ROOT / "Marketing content"
TOKEN_FILE = MARKETING_DIR / "google_token.json"
CREDENTIALS_FILE = MARKETING_DIR / "google_credentials.json"
UPLOAD_TRACKER = SCRIPT_DIR / "drive_upload_tracker.json"

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]

# ── Platform config ──────────────────────────────────────────────────────
# Optimal posting times per platform (hour, minute) in local time
# Based on general social media best practices
PLATFORM_SCHEDULE = {
    "YouTube": {
        "times": ["09:00", "14:00"],
        "days": "daily",       # Post every day
        "priority": 1,         # Publish first (Phase 3)
        "format": "Widescreen (16:9)",
    },
    "TikTok": {
        "times": ["11:00", "19:00"],
        "days": "daily",
        "priority": 2,         # Phase 4 via FeedHive
        "format": "Vertical (9:16)",
    },
    "Instagram": {
        "times": ["08:00", "17:00"],
        "days": "daily",
        "priority": 2,         # Phase 4 via FeedHive
        "format": "Vertical (9:16) + Square (1:1)",
    },
    "LinkedIn": {
        "times": ["10:00"],
        "days": "weekdays",    # Business hours only
        "priority": 2,         # Phase 4 via FeedHive
        "format": "Widescreen (16:9)",
    },
    "Twitter": {
        "times": ["12:00", "18:00"],
        "days": "daily",
        "priority": 3,         # Phase 5
        "format": "Widescreen (16:9)",
    },
    "Pinterest": {
        "times": ["20:00"],
        "days": "daily",
        "priority": 3,         # Phase 5
        "format": "Vertical (9:16)",
    },
    "Reddit": {
        "times": ["08:00"],
        "days": "weekdays",
        "priority": 3,         # Phase 5
        "format": "Widescreen (16:9)",
    },
    "Facebook": {
        "times": ["13:00", "16:00"],
        "days": "daily",
        "priority": 4,         # Phase 7
        "format": "Square (1:1)",
    },
    "Substack": {
        "times": ["07:00"],
        "days": "weekdays",    # Newsletter on weekday mornings
        "priority": 5,         # Phase 8
        "format": "Blog + YouTube embed",
    },
    "WordPress": {
        "times": ["10:00"],
        "days": "weekdays",    # SEO blog posts on weekdays
        "priority": 5,         # Phase 8
        "format": "Blog + YouTube embed",
    },
}

# Category colors for visual grouping
CATEGORY_COLORS = {
    "Microscopic": {"red": 0.85, "green": 0.92, "blue": 1.0},    # Light blue
    "Food Beverage": {"red": 1.0, "green": 0.93, "blue": 0.85},  # Light orange
}


def get_google_creds():
    """Authenticate with Google APIs."""
    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                print(f"  ERROR: Credentials not found at {CREDENTIALS_FILE}")
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "w") as f:
            f.write(creds.to_json())
    return creds


def load_tracker():
    """Load the upload tracker for sheet ID."""
    if UPLOAD_TRACKER.exists():
        with open(UPLOAD_TRACKER, "r") as f:
            return json.load(f)
    return {}


def read_content_library(sheets_service, spreadsheet_id):
    """Read all rows from the Content Library tab."""
    result = sheets_service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range="Content Library!A2:S",  # Skip header
    ).execute()
    rows = result.get("values", [])

    montages = []
    for row in rows:
        # Pad row to ensure all columns exist
        while len(row) < 19:
            row.append("")
        montages.append({
            "category": row[0],
            "subcategory": row[1],
            "collection": row[2],
            "filename": row[3],
            "file_size_mb": row[4],
            "drive_link": row[5],
            "drive_file_id": row[6],
            "help_url": row[16],
            "stockflow_url": row[17],
        })
    return montages


def is_weekday(date):
    return date.weekday() < 5  # Mon=0, Fri=4


def generate_schedule(montages, start_date, posts_per_day=2):
    """
    Generate a publishing schedule.

    Strategy:
    - YouTube gets published first (1 montage per day at optimal time)
    - Other platforms follow in waves, offset by 1-2 days per platform
    - This means each montage appears on YouTube first, then cascades
      to other platforms over the following days
    """
    schedule = []
    current_date = start_date
    montage_index = 0

    # Phase 1: YouTube schedule (primary — 2-3 per day)
    # Phase 2+: Other platforms follow with offset
    platform_offsets = {
        "YouTube": 0,       # Day 0 — publish here first
        "TikTok": 1,        # Day +1
        "Instagram": 1,     # Day +1 (same day as TikTok, different time)
        "LinkedIn": 2,      # Day +2
        "Twitter": 3,       # Day +3
        "Pinterest": 3,     # Day +3
        "Reddit": 4,        # Day +4
        "Facebook": 5,      # Day +5
        "Substack": 6,      # Day +6 (after YouTube embed is ready)
        "WordPress": 6,     # Day +6 (same day, different time)
    }

    # Assign each montage a "base date" — the day it first goes to YouTube
    montage_dates = []
    date_cursor = start_date
    batch = 0
    for i, m in enumerate(montages):
        montage_dates.append(date_cursor)
        batch += 1
        if batch >= posts_per_day:
            batch = 0
            date_cursor += timedelta(days=1)
            # Skip to next day

    # Now generate rows for all platforms
    for i, montage in enumerate(montages):
        base_date = montage_dates[i]

        for platform, config in PLATFORM_SCHEDULE.items():
            offset = platform_offsets[platform]
            pub_date = base_date + timedelta(days=offset)

            # Skip weekends for weekday-only platforms
            if config["days"] == "weekdays":
                while not is_weekday(pub_date):
                    pub_date += timedelta(days=1)

            # Pick a time slot (rotate through available times)
            time_slot = config["times"][i % len(config["times"])]

            phase = f"Phase {config['priority'] + 2}"  # Phase 3=YouTube, 4=FeedHive, etc.

            schedule.append({
                "date": pub_date.strftime("%Y-%m-%d"),
                "day_of_week": pub_date.strftime("%A"),
                "time": time_slot,
                "platform": platform,
                "phase": phase,
                "format": config["format"],
                "category": montage["category"],
                "subcategory": montage["subcategory"],
                "collection": montage["collection"],
                "drive_link": montage["drive_link"],
                "help_url": montage["help_url"],
                "stockflow_url": montage["stockflow_url"],
                "status": "Scheduled",
            })

    # Sort by date, then time, then platform priority
    platform_order = {p: c["priority"] for p, c in PLATFORM_SCHEDULE.items()}
    schedule.sort(key=lambda x: (x["date"], x["time"], platform_order.get(x["platform"], 99)))

    return schedule


def write_schedule_to_sheet(sheets_service, spreadsheet_id, schedule):
    """Write the schedule to the Publishing Schedule tab."""

    headers = [
        "Date",
        "Day",
        "Time",
        "Platform",
        "Phase",
        "Format",
        "Category",
        "Subcategory",
        "Collection",
        "Drive Link",
        "Help Page URL",
        "Stockflow URL",
        "Status",
        "Published URL",
        "Notes",
    ]

    rows = [headers]
    for entry in schedule:
        rows.append([
            entry["date"],
            entry["day_of_week"],
            entry["time"],
            entry["platform"],
            entry["phase"],
            entry["format"],
            entry["category"],
            entry["subcategory"],
            entry["collection"],
            entry["drive_link"],
            entry["help_url"],
            entry["stockflow_url"],
            entry["status"],
            "",  # Published URL
            "",  # Notes
        ])

    # Write data
    body = {"values": rows}
    sheets_service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range="Publishing Schedule!A1",
        valueInputOption="RAW",
        body=body,
    ).execute()

    # ── Format the sheet ─────────────────────────────────────────────
    # Get actual sheet ID for Publishing Schedule tab
    sheet_meta = sheets_service.spreadsheets().get(
        spreadsheetId=spreadsheet_id, fields="sheets.properties"
    ).execute()

    pub_sheet_id = None
    for sheet in sheet_meta["sheets"]:
        if sheet["properties"]["title"] == "Publishing Schedule":
            pub_sheet_id = sheet["properties"]["sheetId"]
            break

    if pub_sheet_id is None:
        print("  WARNING: Could not find Publishing Schedule tab for formatting")
        return

    requests = [
        # Bold + dark header row
        {
            "repeatCell": {
                "range": {
                    "sheetId": pub_sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": {"red": 0.2, "green": 0.2, "blue": 0.2},
                        "textFormat": {
                            "bold": True,
                            "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0},
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
                    "sheetId": pub_sheet_id,
                    "gridProperties": {"frozenRowCount": 1},
                },
                "fields": "gridProperties.frozenRowCount",
            }
        },
        # Auto-resize columns
        {
            "autoResizeDimensions": {
                "dimensions": {
                    "sheetId": pub_sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": 0,
                    "endIndex": len(headers),
                }
            }
        },
    ]

    # ── Color-code rows by category ──────────────────────────────────
    for row_idx, entry in enumerate(schedule, start=1):  # +1 for header
        cat = entry["category"]
        if cat in CATEGORY_COLORS:
            color = CATEGORY_COLORS[cat]
            requests.append({
                "repeatCell": {
                    "range": {
                        "sheetId": pub_sheet_id,
                        "startRowIndex": row_idx,
                        "endRowIndex": row_idx + 1,
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "backgroundColor": color,
                        }
                    },
                    "fields": "userEnteredFormat.backgroundColor",
                }
            })

    # Batch update in chunks (API limit)
    chunk_size = 500
    for i in range(0, len(requests), chunk_size):
        chunk = requests[i:i + chunk_size]
        sheets_service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id, body={"requests": chunk}
        ).execute()

    print(f"  Schedule written: {len(schedule)} entries across {len(headers)} columns")


def main():
    parser = argparse.ArgumentParser(description="Generate Publishing Schedule")
    parser.add_argument("--start", default="2026-03-14", help="Start date (YYYY-MM-DD)")
    parser.add_argument("--pace", type=int, default=2, help="Posts per day (default: 2)")
    parser.add_argument("--preview", action="store_true", help="Preview without writing")
    args = parser.parse_args()

    start_date = datetime.strptime(args.start, "%Y-%m-%d")

    print(f"\n=== Stockflow Publishing Pipeline - Phase 2 ===\n")
    print(f"  Start date: {start_date.strftime('%A, %B %d, %Y')}")
    print(f"  Pace: {args.pace} montages/day")

    # Load tracker for sheet ID
    tracker = load_tracker()
    spreadsheet_id = tracker.get("master_sheet_id")
    if not spreadsheet_id:
        print("  ERROR: No Master Sheet found. Run Phase 1 first.")
        sys.exit(1)

    # Authenticate
    creds = get_google_creds()
    sheets_service = build("sheets", "v4", credentials=creds)

    # Read content library
    montages = read_content_library(sheets_service, spreadsheet_id)
    print(f"  Loaded {len(montages)} montages from Content Library")

    # Generate schedule
    schedule = generate_schedule(montages, start_date, posts_per_day=args.pace)

    # Stats
    platforms = {}
    date_range = set()
    for entry in schedule:
        platforms[entry["platform"]] = platforms.get(entry["platform"], 0) + 1
        date_range.add(entry["date"])

    dates_sorted = sorted(date_range)
    end_date = datetime.strptime(dates_sorted[-1], "%Y-%m-%d")
    span_days = (end_date - start_date).days + 1

    print(f"\n  Schedule Summary:")
    print(f"  ---------------------------------")
    print(f"  Total posts:    {len(schedule)}")
    print(f"  Date range:     {dates_sorted[0]} to {dates_sorted[-1]} ({span_days} days)")
    print(f"  Unique dates:   {len(date_range)}")
    print(f"")
    print(f"  Posts per platform:")
    for p, count in sorted(platforms.items(), key=lambda x: PLATFORM_SCHEDULE[x[0]]["priority"]):
        phase = PLATFORM_SCHEDULE[p]["priority"] + 2
        print(f"    {p:<12} {count:>4} posts  (Phase {phase})")

    if args.preview:
        print(f"\n  [PREVIEW] First 20 entries:")
        for entry in schedule[:20]:
            print(f"    {entry['date']} {entry['time']}  {entry['platform']:<12} {entry['collection']}")
        print(f"\n  [PREVIEW] No changes written. Remove --preview to write.")
    else:
        print(f"\n  Writing to Master Sheet...")
        write_schedule_to_sheet(sheets_service, spreadsheet_id, schedule)
        print(f"\n  Master Sheet URL: {tracker.get('master_sheet_url', 'N/A')}")

    print(f"\n=== Phase 2 Complete ===\n")


if __name__ == "__main__":
    main()
