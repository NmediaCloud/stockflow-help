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
        "days": "daily",
        "priority": 1,         # Phase 3
        "source_format": "W",  # Use W (widescreen) montages
    },
    "TikTok": {
        "times": ["11:00", "19:00"],
        "days": "daily",
        "priority": 2,         # Phase 4
        "source_format": "V",  # Use V (vertical) montages
    },
    "Instagram": {
        "times": ["08:00", "17:00"],
        "days": "daily",
        "priority": 2,         # Phase 4
        "source_format": "S",  # Use S (square) montages — separate from V
    },
    "LinkedIn": {
        "times": ["10:00"],
        "days": "weekdays",
        "priority": 2,         # Phase 4
        "source_format": "W",
    },
    "Twitter": {
        "times": ["12:00", "18:00"],
        "days": "daily",
        "priority": 3,         # Phase 5
        "source_format": "W",
    },
    "Pinterest": {
        "times": ["20:00"],
        "days": "daily",
        "priority": 3,         # Phase 5
        "source_format": "V",
    },
    "Reddit": {
        "times": ["08:00"],
        "days": "weekdays",
        "priority": 3,         # Phase 5
        "source_format": "W",
    },
    "Facebook": {
        "times": ["13:00", "16:00"],
        "days": "daily",
        "priority": 4,         # Phase 7
        "source_format": "S",
    },
    "Substack": {
        "times": ["07:00"],
        "days": "weekdays",
        "priority": 5,         # Phase 8
        "source_format": "W",  # Blog embed uses widescreen
    },
    "WordPress": {
        "times": ["10:00"],
        "days": "weekdays",
        "priority": 5,         # Phase 8
        "source_format": "W",
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
            "format": row[0],         # A: Format (W/S/V)
            "category": row[1],       # B: Category
            "subcategory": row[2],    # C: Subcategory
            "collection": row[3],     # D: Collection
            "filename": row[4],       # E: Filename
            "file_size_mb": row[5],   # F: File Size (MB)
            "drive_link": row[6],     # G: Drive Link
            "drive_file_id": row[7],  # H: Drive File ID
            "help_url": row[17],
            "stockflow_url": row[18],
        })
    return montages


def is_weekday(date):
    return date.weekday() < 5  # Mon=0, Fri=4


def generate_schedule(montages, start_date, posts_per_day=2):
    """
    Generate a publishing schedule.

    Strategy:
    - Each platform gets only montages matching its source_format (W/S/V)
    - YouTube (W) gets published first, other platforms follow with offset
    - Same collection cascades across platforms over days
    """
    schedule = []

    # Group montages by format
    by_format = {"W": [], "S": [], "V": []}
    for m in montages:
        fmt = m.get("format", "")
        if fmt in by_format:
            by_format[fmt].append(m)

    # Group montages by collection name for cross-platform linking
    # Each collection should cascade: YouTube day 0, TikTok day +1, etc.
    collections_w = {m["collection"]: m for m in by_format["W"]}
    collections_s = {m["collection"]: m for m in by_format["S"]}
    collections_v = {m["collection"]: m for m in by_format["V"]}

    # Use W montages as the base timeline (YouTube publishes first)
    base_montages = by_format["W"]

    platform_offsets = {
        "YouTube": 0,       # Day 0 -- W format
        "TikTok": 1,        # Day +1 -- V format
        "Instagram": 1,     # Day +1 -- S format (separate from V)
        "LinkedIn": 2,      # Day +2 -- W format
        "Twitter": 3,       # Day +3 -- W format
        "Pinterest": 3,     # Day +3 -- V format
        "Reddit": 4,        # Day +4 -- W format
        "Facebook": 5,      # Day +5 -- S format
        "Substack": 6,      # Day +6 -- W format (blog embed)
        "WordPress": 6,     # Day +6 -- W format
    }

    # Assign base dates for each W montage
    montage_dates = []
    date_cursor = start_date
    batch = 0
    for i, m in enumerate(base_montages):
        montage_dates.append(date_cursor)
        batch += 1
        if batch >= posts_per_day:
            batch = 0
            date_cursor += timedelta(days=1)

    # Generate schedule entries
    for i, w_montage in enumerate(base_montages):
        base_date = montage_dates[i]
        collection_name = w_montage["collection"]

        # Find matching S and V montages for this collection
        s_montage = collections_s.get(collection_name)
        v_montage = collections_v.get(collection_name)

        for platform, config in PLATFORM_SCHEDULE.items():
            source_fmt = config["source_format"]

            # Pick the right montage for this platform's format
            if source_fmt == "W":
                montage = w_montage
            elif source_fmt == "V":
                montage = v_montage
            elif source_fmt == "S":
                montage = s_montage
            else:
                continue

            # Skip if no montage exists in this format
            if not montage:
                continue

            offset = platform_offsets[platform]
            pub_date = base_date + timedelta(days=offset)

            # Skip weekends for weekday-only platforms
            if config["days"] == "weekdays":
                while not is_weekday(pub_date):
                    pub_date += timedelta(days=1)

            # Pick a time slot (rotate through available times)
            time_slot = config["times"][i % len(config["times"])]

            phase = f"Phase {config['priority'] + 2}"

            schedule.append({
                "date": pub_date.strftime("%Y-%m-%d"),
                "day_of_week": pub_date.strftime("%A"),
                "time": time_slot,
                "platform": platform,
                "phase": phase,
                "format": source_fmt,
                "category": montage["category"],
                "subcategory": montage["subcategory"],
                "collection": montage["collection"],
                "drive_link": montage.get("drive_link", ""),
                "drive_file_id": montage.get("drive_file_id", ""),
                "help_url": montage.get("help_url", ""),
                "stockflow_url": montage.get("stockflow_url", ""),
                "status": "Scheduled",
            })

    # Sort by date, then time, then platform priority
    platform_order = {p: c["priority"] for p, c in PLATFORM_SCHEDULE.items()}
    schedule.sort(key=lambda x: (x["date"], x["time"], platform_order.get(x["platform"], 99)))

    return schedule


def write_schedule_to_sheet(sheets_service, spreadsheet_id, schedule):
    """Write the schedule to the Publishing Schedule tab."""

    headers = [
        "Publish",
        "Status",
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
        "Drive File ID",
        "Help Page URL",
        "Stockflow URL",
        "Published URL",
        "Published At",
        "Notes",
    ]

    rows = [headers]
    for entry in schedule:
        rows.append([
            False,                    # Publish (checkbox)
            "",                       # Status
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
            entry.get("drive_file_id", ""),  # Drive File ID
            entry["help_url"],
            entry["stockflow_url"],
            "",                       # Published URL
            "",                       # Published At
            "",                       # Notes
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
