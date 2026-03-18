"""
Sync YouTube URLs from the Stockflow Publishing Master sheet
into help page markdown files (collections + blog showcases).

Logic:
  - Collection has YouTube URL → replace/inject iframe
  - Collection NOT in sheet   → leave existing iframe untouched
  - Collection in sheet, URL blank → remove any existing iframe

Usage:
  python tools/sync_youtube_to_help.py
  python tools/sync_youtube_to_help.py --dry-run
"""

import csv
import re
import sys
import urllib.request
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────
SHEET_ID = "12wLctBPz5p7MMLwyCdGymVgH_uHfDXL7uZ-TtTwL3_w"
# AppScript Upload tab (gid=2024755580)
SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid=2024755580"

SCRIPT_DIR = Path(__file__).parent.resolve()
DOCS_PATH = (SCRIPT_DIR / "../docs").resolve()
COLLECTIONS_DIR = DOCS_PATH / "collections"
BLOG_DIR = DOCS_PATH / "blog"

# iframe template — matches the style used in sync_stockflow.py
IFRAME_TEMPLATE = (
    '<iframe width="100%" height="450" '
    'style="max-width: 800px; aspect-ratio: 16/9; border-radius: 8px; margin-bottom: 20px;" '
    'src="https://www.youtube.com/embed/{video_id}?rel=0" '
    'frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; '
    'gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>'
)

# Regex to match any YouTube iframe block (including wrapper divs)
IFRAME_PATTERN = re.compile(
    r'(<div[^>]*>)?\s*<iframe[^>]*youtube\.com/embed/[^>]*></iframe>\s*(</div>)?\n*',
    re.IGNORECASE
)


def sanitize_slug(text):
    """Same slug logic as sync_stockflow.py."""
    slug = text.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    return slug.strip('-')


def extract_video_id(url):
    """Extract YouTube video ID from various URL formats."""
    if not url:
        return None
    # https://www.youtube.com/watch?v=XXXXX
    match = re.search(r'[?&]v=([a-zA-Z0-9_-]{11})', url)
    if match:
        return match.group(1)
    # https://youtu.be/XXXXX
    match = re.search(r'youtu\.be/([a-zA-Z0-9_-]{11})', url)
    if match:
        return match.group(1)
    # https://www.youtube.com/embed/XXXXX
    match = re.search(r'youtube\.com/embed/([a-zA-Z0-9_-]{11})', url)
    if match:
        return match.group(1)
    return None


def fetch_youtube_data():
    """Fetch AppScript Upload sheet, return dict of collection → youtube_url."""
    print("Fetching AppScript Upload sheet...")
    req = urllib.request.Request(SHEET_URL, headers={'User-Agent': 'Mozilla/5.0'})
    response = urllib.request.urlopen(req)
    csv_data = response.read().decode('utf-8')

    reader = csv.DictReader(csv_data.splitlines())
    youtube_map = {}  # collection_name → published_url (or "")

    for row in reader:
        platform = (row.get("Platform") or "").strip()
        if platform != "YouTube":
            continue
        collection = (row.get("Collection") or "").strip()
        if not collection:
            continue
        published_url = (row.get("Published URL") or "").strip()
        # Store the URL (or empty string for intentional removal)
        youtube_map[collection] = published_url

    print(f"  Found {len(youtube_map)} YouTube rows")
    with_url = sum(1 for v in youtube_map.values() if v)
    blank_url = sum(1 for v in youtube_map.values() if not v)
    print(f"  With URL: {with_url} | Blank (remove signal): {blank_url}")
    return youtube_map


def update_markdown_file(filepath, video_id, action, dry_run=False):
    """
    Update a markdown file:
      action = "inject"  → add/replace iframe after the breadcrumb line
      action = "remove"  → remove any existing iframe
    Returns True if file was modified.
    """
    if not filepath.exists():
        return False

    content = filepath.read_text(encoding='utf-8')
    original = content
    has_iframe = bool(IFRAME_PATTERN.search(content))

    if action == "inject":
        iframe_html = IFRAME_TEMPLATE.format(video_id=video_id)
        if has_iframe:
            # Replace existing iframe
            content = IFRAME_PATTERN.sub(iframe_html + '\n\n', content, count=1)
        else:
            # Inject after the "Browse on Stockflow.media" button line (collection pages)
            # or after the breadcrumb line (blog pages)
            button_pattern = re.compile(
                r'(\[Browse[^\]]*\]\([^)]+\)\{[^}]*\}\s*\n)',
                re.IGNORECASE
            )
            match = button_pattern.search(content)
            if match:
                insert_pos = match.end()
                content = content[:insert_pos] + '\n' + iframe_html + '\n\n' + content[insert_pos:]
            else:
                # Fallback: inject after first "---" separator (after frontmatter)
                parts = content.split('---', 2)
                if len(parts) >= 3:
                    # After the second "---" (end of frontmatter)
                    content = parts[0] + '---' + parts[1] + '---\n\n' + iframe_html + '\n\n' + parts[2]

    elif action == "remove":
        if has_iframe:
            content = IFRAME_PATTERN.sub('', content)
            # Clean up any double blank lines left behind
            content = re.sub(r'\n{3,}', '\n\n', content)

    if content != original:
        if not dry_run:
            filepath.write_text(content, encoding='utf-8')
        return True
    return False


def main():
    dry_run = '--dry-run' in sys.argv
    if dry_run:
        print("=== DRY RUN — no files will be modified ===\n")

    youtube_map = fetch_youtube_data()
    if not youtube_map:
        print("No YouTube rows found in sheet. Nothing to do.")
        return

    injected = 0
    removed = 0
    skipped = 0
    not_found = 0
    unchanged = 0

    for collection_name, published_url in sorted(youtube_map.items()):
        slug = sanitize_slug(collection_name)
        collection_file = COLLECTIONS_DIR / f"{slug}.md"
        blog_file = BLOG_DIR / f"{slug}-showcase.md"

        video_id = extract_video_id(published_url)

        if published_url and video_id:
            # Inject/replace iframe
            action = "inject"
            for filepath in [collection_file, blog_file]:
                if filepath.exists():
                    modified = update_markdown_file(filepath, video_id, action, dry_run)
                    if modified:
                        tag = "[DRY] " if dry_run else ""
                        print(f"  {tag}✓ {action}: {filepath.name} ← {video_id}")
                        injected += 1
                    else:
                        unchanged += 1
                else:
                    not_found += 1

        elif not published_url:
            # Blank URL = intentional removal
            action = "remove"
            for filepath in [collection_file, blog_file]:
                if filepath.exists():
                    modified = update_markdown_file(filepath, None, action, dry_run)
                    if modified:
                        tag = "[DRY] " if dry_run else ""
                        print(f"  {tag}✗ {action}: {filepath.name}")
                        removed += 1
                    else:
                        unchanged += 1
                else:
                    not_found += 1
        else:
            skipped += 1

    print(f"\n{'DRY RUN ' if dry_run else ''}Summary:")
    print(f"  Iframes injected/updated: {injected}")
    print(f"  Iframes removed: {removed}")
    print(f"  Files unchanged: {unchanged}")
    print(f"  Files not found: {not_found}")
    print(f"  Rows skipped: {skipped}")

    if not dry_run and (injected > 0 or removed > 0):
        print(f"\nDone! Run deploy.bat to push changes live.")
    elif dry_run:
        print(f"\nRe-run without --dry-run to apply changes.")


if __name__ == "__main__":
    main()
