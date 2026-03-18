"""
FeedHive CSV Generator — Per-Platform Optimized Posts
=====================================================
Generates separate FeedHive-ready CSV files for W, S, V formats.
Each collection gets ONE ROW PER PLATFORM with:
  - Custom text tailored to platform character limits
  - Custom hashtags from collection_tags.json (max per platform)
  - Platform-specific social account name
  - Smart scheduling with platform daily limits

Usage:
  python tools/generate_feedhive_csv.py W          # Generate W format CSV
  python tools/generate_feedhive_csv.py S          # Generate S format CSV
  python tools/generate_feedhive_csv.py V          # Generate V format CSV
  python tools/generate_feedhive_csv.py all        # Generate all three
  python tools/generate_feedhive_csv.py W --start 2026-03-25   # Custom start date
  python tools/generate_feedhive_csv.py W --preview  # Preview first 5 rows, no file written
"""

import csv
import json
import sys
import os
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
TAGS_FILE = SCRIPT_DIR / "collection_tags.json"
OUTPUT_DIR = SCRIPT_DIR / "../feedhive_exports"

# Content Library (Publishing Master sheet, AppScript Upload tab)
MASTER_SHEET_ID = "12wLctBPz5p7MMLwyCdGymVgH_uHfDXL7uZ-TtTwL3_w"
APPSCRIPT_UPLOAD_GID = "2024755580"
CONTENT_LIBRARY_URL = f"https://docs.google.com/spreadsheets/d/{MASTER_SHEET_ID}/export?format=csv&gid=0"

# Original data source (for tag regeneration)
ORIGINAL_SHEET_URL = "https://docs.google.com/spreadsheets/d/12eyXAI9-hT0TFSx2HhVDUWHXo4X9QVT-vSPmGQBx6c8/export?format=csv&gid=65282458"

# ── FeedHive Social Account Names (must match FeedHive exactly) ──
ACCOUNTS = {
    "youtube":   "Stockflowmedia - Nmediaservices",
    "instagram": "stockflow.media - Nmedia.services",
    "linkedin":  "Nmediaservices: Stockflow.media",
    "linkedin2": "Nmediaservices.com",
    "facebook":  "Nmediaservices",
    "tiktok":    "Stockflow.media",
    "pinterest": "nmediananda",
    "x":         "Stockflow.media",
}

# ── Platform Config ──────────────────────────────────────────────
PLATFORM_CONFIG = {
    "x": {
        "max_chars": 280,
        "max_tags": 3,
        "tag_style": "hashtag",  # #keyword
        "tone": "short",
        "daily_limit": 5,
        "post_times": ["07:00", "10:00", "13:00", "16:00", "19:00"],
    },
    "linkedin": {
        "max_chars": 3000,
        "max_tags": 5,
        "tag_style": "hashtag",
        "tone": "professional",
        "daily_limit": 2,
        "post_times": ["08:30", "12:00"],
    },
    "instagram": {
        "max_chars": 2200,
        "max_tags": 25,
        "tag_style": "hashtag",
        "tone": "discovery",
        "daily_limit": 3,
        "post_times": ["09:00", "13:00", "18:00"],
    },
    "facebook": {
        "max_chars": 5000,
        "max_tags": 5,
        "tag_style": "hashtag",
        "tone": "conversational",
        "daily_limit": 3,
        "post_times": ["10:00", "14:00", "19:00"],
    },
    "tiktok": {
        "max_chars": 2200,
        "max_tags": 8,
        "tag_style": "hashtag",
        "tone": "trending",
        "daily_limit": 3,
        "post_times": ["08:00", "12:30", "19:00"],
    },
    "pinterest": {
        "max_chars": 500,
        "max_tags": 15,
        "tag_style": "hashtag",
        "tone": "keyword",
        "daily_limit": 5,
        "post_times": ["09:00", "11:00", "14:00", "17:00", "20:00"],
    },
    "youtube": {
        "max_chars": 100,
        "max_tags": 8,
        "tag_style": "hashtag",
        "tone": "shorts",
        "daily_limit": 2,
        "post_times": ["10:00", "16:00"],
    },
}

# ── Format → Platform mapping ──────────────────────────────────
FORMAT_PLATFORMS = {
    "W": ["x", "linkedin", "facebook"],
    "S": ["instagram", "facebook", "linkedin", "x"],
    "V": ["tiktok", "pinterest", "instagram", "facebook", "linkedin", "x", "youtube"],
}

# ── Base tags always included ──────────────────────────────────
BASE_TAGS = ["stockfootage", "royaltyfree", "stockvideo"]
TRENDING_TAGS = {
    "tiktok": ["fyp", "viral", "4k"],
    "instagram": ["stockvideo", "4kvideo", "8kimages", "videography", "filmmaking", "contentcreator"],
    "youtube": ["shorts", "4k", "stockvideo"],
}


def load_collection_tags():
    """Load pre-generated collection tags from JSON."""
    if not TAGS_FILE.exists():
        print(f"  Tags file not found: {TAGS_FILE}")
        print(f"  Run: python tools/generate_feedhive_csv.py --rebuild-tags")
        return {}
    with open(TAGS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def rebuild_tags():
    """Rebuild collection_tags.json from original Google Sheets data."""
    from collections import defaultdict
    print("Rebuilding collection tags from original data source...")
    req = urllib.request.Request(ORIGINAL_SHEET_URL, headers={'User-Agent': 'Mozilla/5.0'})
    response = urllib.request.urlopen(req)
    data = response.read().decode('utf-8')
    reader = csv.DictReader(data.splitlines())

    collection_tags = defaultdict(set)
    collection_meta = defaultdict(lambda: {"descriptions": set(), "category": "", "subcategory": ""})

    for row in reader:
        sub = (row.get('Sub') or '').strip()
        if not sub:
            continue
        # Collect tags + keywords
        tags = (row.get('Tags') or '')
        keywords = (row.get('Keywords') or '')
        combined = tags + ', ' + keywords
        for tag in combined.split(','):
            tag = tag.strip().lower().replace(' ', '')
            if tag and len(tag) > 2 and len(tag) < 40:
                collection_tags[sub].add(tag)
        # Collect descriptions
        desc = (row.get('Description') or '').strip()
        if desc:
            collection_meta[sub]["descriptions"].add(desc[:200])
        # Category info
        collection_meta[sub]["category"] = (row.get('Category') or '').strip()
        collection_meta[sub]["subcategory"] = (row.get('Catagory_Sub') or row.get('Category_Sub') or '').strip()

    result = {}
    for sub in sorted(collection_tags.keys()):
        result[sub] = {
            "tags": sorted(list(collection_tags[sub])),
            "tag_count": len(collection_tags[sub]),
            "category": collection_meta[sub]["category"],
            "subcategory": collection_meta[sub]["subcategory"],
            "description": list(collection_meta[sub]["descriptions"])[:3],  # Keep top 3 descriptions
        }

    with open(TAGS_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"  Saved {len(result)} collections to {TAGS_FILE}")
    return result


def fetch_content_library(format_code):
    """Fetch Content Library from Google Sheets and return collection data."""
    print(f"  Fetching Content Library (format={format_code})...")
    # Use the Content Library tab (gid=0)
    url = f"https://docs.google.com/spreadsheets/d/{MASTER_SHEET_ID}/export?format=csv&gid=0"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    response = urllib.request.urlopen(req)
    data = response.read().decode('utf-8')
    reader = csv.DictReader(data.splitlines())

    collections = {}
    for row in reader:
        fmt = (row.get('Format') or '').strip()
        if fmt != format_code:
            continue
        collection = (row.get('Collection') or '').strip()
        if not collection or collection in collections:
            continue
        collections[collection] = {
            "category": (row.get('Category') or '').strip(),
            "subcategory": (row.get('Subcategory') or '').strip(),
            "collection": collection,
            "drive_file_id": (row.get('Drive File ID') or '').strip(),
            "stockflow_url": (row.get('Stockflow URL') or 'https://stockflow.media').strip(),
            "help_url": (row.get('Help URL') or '').strip(),
        }
    print(f"  Found {len(collections)} unique collections")
    return collections


def get_tags_for_platform(collection_name, platform, all_tags):
    """Pick the right number and style of tags for a platform."""
    config = PLATFORM_CONFIG[platform]
    max_tags = config["max_tags"]

    # Get collection-specific tags
    tag_data = all_tags.get(collection_name, {})
    available = tag_data.get("tags", [])

    # Start with base tags
    selected = list(BASE_TAGS)

    # Add platform trending tags
    if platform in TRENDING_TAGS:
        selected.extend(TRENDING_TAGS[platform])

    # Add category/subcategory as tags
    cat = tag_data.get("category", "").lower().replace(" ", "").replace("&", "")
    subcat = tag_data.get("subcategory", "").lower().replace(" ", "").replace("&", "")
    if cat and cat not in selected:
        selected.append(cat)
    if subcat and subcat not in selected:
        selected.append(subcat)

    # Fill remaining slots from collection tags
    for tag in available:
        if tag not in selected:
            selected.append(tag)
        if len(selected) >= max_tags:
            break

    # Deduplicate and limit
    seen = set()
    deduped = []
    for t in selected:
        t_clean = t.replace(" ", "").replace("-", "").lower()
        if t_clean not in seen and len(t_clean) > 2:
            seen.add(t_clean)
            deduped.append(t_clean)
    return deduped[:max_tags]


def build_post_text(collection_data, platform, tags, all_tags):
    """Build platform-optimized post text."""
    config = PLATFORM_CONFIG[platform]
    name = collection_data["collection"].replace("_", " ")
    url = collection_data["stockflow_url"]
    help_url = collection_data["help_url"]
    category = collection_data["category"]

    # Get a description if available
    tag_data = all_tags.get(collection_data["collection"], {})
    descriptions = tag_data.get("description", [])
    desc = descriptions[0] if descriptions else ""

    # Build hashtag string
    hashtags = " ".join(["#" + t for t in tags])

    if platform == "x":
        # Twitter: ultra short, link, 2-3 tags
        text = f"{name} — Premium stock footage.\nRoyalty-free, instant download.\n{url}"
        remaining = 280 - len(text) - 1
        if remaining > len(hashtags):
            text += "\n" + hashtags
        elif remaining > 20:
            short_tags = " ".join(["#" + t for t in tags[:2]])
            text += "\n" + short_tags
        if len(text) > 280:
            text = text[:277] + "..."

    elif platform == "linkedin":
        # LinkedIn: professional, longer, 5 tags
        text = f"{name} — Premium Stock Footage Collection\n\n"
        if desc:
            text += f"{desc}\n\n"
        text += f"This collection features professionally captured {category.lower()} footage available in 4K video and 8K images.\n\n"
        text += f"All assets are royalty-free with no attribution required.\n\n"
        text += f"Browse & License: {url}\n"
        if help_url:
            text += f"Collection Details: {help_url}\n"
        text += f"\n{hashtags}"

    elif platform == "instagram":
        # Instagram: visual, emoji-friendly, hashtag heavy
        text = f"{name}\n\n"
        if desc:
            text += f"{desc}\n\n"
        text += f"Premium {category.lower()} stock footage & images.\n"
        text += f"4K video | 8K images | Royalty-free\n\n"
        text += f"Link in bio or visit stockflow.media\n\n"
        text += hashtags

    elif platform == "facebook":
        # Facebook: conversational, medium length
        text = f"New collection added: {name}\n\n"
        if desc:
            text += f"{desc}\n\n"
        text += f"Browse the full {name} collection — 4K video and 8K images, royalty-free.\n\n"
        text += f"{url}\n\n"
        text += hashtags

    elif platform == "tiktok":
        # TikTok: short, trendy, hashtag-driven
        text = f"{name} — Stock footage you need\n"
        text += f"4K quality | Royalty-free | Instant download\n\n"
        text += f"{url}\n\n"
        text += hashtags

    elif platform == "pinterest":
        # Pinterest: keyword-rich description for search
        text = f"{name} — Premium {category.lower()} stock footage and images.\n"
        text += f"Download royalty-free 4K video and 8K images.\n"
        text += f"Perfect for content creators, filmmakers, and designers.\n"
        text += f"{url}\n\n"
        text += hashtags
        if len(text) > 500:
            text = text[:497] + "..."

    elif platform == "youtube":
        # YouTube Shorts: very short title-style
        text = f"{name} | {category} Stock Footage #shorts\n"
        text += hashtags
        if len(text) > 100:
            text = f"{name} #shorts " + " ".join(["#" + t for t in tags[:3]])

    else:
        text = f"{name} — Stock footage. {url}\n{hashtags}"

    return text


def build_schedule(start_date, total_rows, platforms):
    """Build schedule respecting per-platform daily limits."""
    # Find bottleneck: platform with fewest daily slots
    min_slots = float('inf')
    best_times = ["09:00", "13:00"]
    for p in platforms:
        config = PLATFORM_CONFIG.get(p, {})
        limit = config.get("daily_limit", 3)
        times = config.get("post_times", ["10:00"])
        if limit < min_slots:
            min_slots = limit
            best_times = times[:limit]

    # Each collection needs len(platforms) rows, but they share the same time slot
    collections_per_day = len(best_times)
    schedule = []
    day_offset = 0
    slot_index = 0

    for i in range(total_rows):
        d = start_date + timedelta(days=day_offset)
        time_str = best_times[slot_index]
        schedule.append(f"{d.strftime('%Y-%m-%d')} {time_str}")
        slot_index += 1
        if slot_index >= len(best_times):
            slot_index = 0
            day_offset += 1

    return schedule


def generate_csv(format_code, start_date=None, preview=False):
    """Generate FeedHive CSV for a given format."""
    print(f"\n{'='*50}")
    print(f"  Generating FeedHive CSV — {format_code} format")
    print(f"{'='*50}")

    platforms = FORMAT_PLATFORMS.get(format_code, [])
    if not platforms:
        print(f"  Unknown format: {format_code}")
        return

    # Load tags
    all_tags = load_collection_tags()
    if not all_tags:
        print("  No tags found. Rebuilding...")
        all_tags = rebuild_tags()

    # Fetch collections
    collections = fetch_content_library(format_code)
    if not collections:
        print("  No collections found!")
        return

    # Default start date: tomorrow
    if not start_date:
        start_date = datetime.now() + timedelta(days=1)
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)

    # Build rows: one per collection per platform
    rows = []
    collection_list = sorted(collections.keys())

    # Schedule: one slot per collection (all platforms share the same time)
    schedule = build_schedule(start_date, len(collection_list), platforms)

    for idx, coll_name in enumerate(collection_list):
        coll = collections[coll_name]
        sched_time = schedule[idx] if idx < len(schedule) else ""

        for platform in platforms:
            tags = get_tags_for_platform(coll_name, platform, all_tags)
            text = build_post_text(coll, platform, tags, all_tags)
            account = ACCOUNTS.get(platform, "")

            # Media URL
            media_url = ""
            if coll["drive_file_id"]:
                media_url = f"https://drive.google.com/uc?export=download&id={coll['drive_file_id']}"

            rows.append({
                "Text": text,
                "Title": f"{coll_name}_{format_code}_{platform}",
                "Media URLs": media_url,
                "Labels": coll["category"] or "General",
                "Social Medias": account,
                "Scheduled": sched_time,
            })

    print(f"\n  Collections: {len(collection_list)}")
    print(f"  Platforms: {', '.join(platforms)}")
    print(f"  Total rows: {len(rows)} ({len(collection_list)} x {len(platforms)})")
    print(f"  Start date: {start_date.strftime('%Y-%m-%d')}")

    # Preview mode
    if preview:
        print(f"\n  === PREVIEW (first 5 rows) ===")
        for i, row in enumerate(rows[:5]):
            print(f"\n  --- Row {i+1} ---")
            print(f"  Title: {row['Title']}")
            print(f"  Account: {row['Social Medias']}")
            print(f"  Scheduled: {row['Scheduled']}")
            print(f"  Text ({len(row['Text'])} chars):")
            print(f"    {row['Text'][:200]}...")
        return

    # Write CSV
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now().strftime("%Y%m%d")
    filename = f"feedhive_{format_code}_{date_str}.csv"
    filepath = OUTPUT_DIR / filename

    with open(filepath, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["Text", "Title", "Media URLs", "Labels", "Social Medias", "Scheduled"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n  Saved: {filepath}")
    print(f"  Import this CSV into FeedHive!")

    # Tag stats
    tag_counts = {}
    for platform in platforms:
        counts = []
        for coll_name in collection_list:
            tags = get_tags_for_platform(coll_name, platform, all_tags)
            counts.append(len(tags))
        avg = sum(counts) / len(counts) if counts else 0
        tag_counts[platform] = f"{avg:.0f} avg tags"
    print(f"\n  Tag density per platform:")
    for p, count in tag_counts.items():
        print(f"    {p}: {count}")


def main():
    args = sys.argv[1:]

    if not args or args[0] == "--help":
        print(__doc__)
        return

    if args[0] == "--rebuild-tags":
        rebuild_tags()
        return

    # Parse arguments
    format_code = args[0].upper()
    start_date = None
    preview = "--preview" in args

    if "--start" in args:
        idx = args.index("--start")
        if idx + 1 < len(args):
            start_date = datetime.strptime(args[idx + 1], "%Y-%m-%d")

    if format_code == "ALL":
        for fc in ["W", "S", "V"]:
            generate_csv(fc, start_date, preview)
    else:
        generate_csv(format_code, start_date, preview)


if __name__ == "__main__":
    main()
