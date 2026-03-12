import os
import csv
import json
import urllib.request
import urllib.parse
import re
import shutil
import sys
from pathlib import Path

def progress(label, current, total):
    bar_len = 30
    filled = int(bar_len * current / total) if total else 0
    bar = '█' * filled + '░' * (bar_len - filled)
    pct = int(100 * current / total) if total else 0
    sys.stdout.write(f'\r  [{bar}] {pct:3d}%  {label[:40]:<40}')
    sys.stdout.flush()
    if current == total:
        print()  # newline when done

# Configuration
SHEET_URL = "https://docs.google.com/spreadsheets/d/12eyXAI9-hT0TFSx2HhVDUWHXo4X9QVT-vSPmGQBx6c8/export?format=csv&gid=65282458"
STOCKFLOW_BASE = "https://stockflow.media/"
HELP_BASE = "https://help.stockflow.media/"

SCRIPT_DIR = Path(__file__).parent.resolve()
DOCS_PATH = (SCRIPT_DIR / "../docs").resolve()
MKDOCS_YML = (SCRIPT_DIR / "../mkdocs.yml").resolve()
REDDIT_FEED_FILE = SCRIPT_DIR / "reddit_feed.md"

def sanitize_slug(text):
    slug = text.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    return slug.strip('-')

def build_website_url(cat, cat_sub):
    """Builds the live Stockflow.media URL for a given category/subcategory."""
    params = urllib.parse.urlencode({'cat': cat, 'sub': cat_sub})
    return f"{STOCKFLOW_BASE}?{params}"

def generate_reddit_feed(hierarchy, sub_groups):
    """Generates one Reddit post per Category_Sub (subcategory)."""
    print("Generating Reddit feed...")
    lines = ["# Reddit Feed — Stockflow.media\n"]
    lines.append("> Copy and paste each block below into Reddit when sharing a new collection.\n")
    lines.append("---\n")

    for cat_name, cat_subs in sorted(hierarchy.items()):
        for cat_sub_name, subs in sorted(cat_subs.items()):
            cat_sub_slug = sanitize_slug(cat_sub_name)
            total_items = sum(len(sub_groups[s]) for s in subs if s in sub_groups)
            website_url = build_website_url(cat_name, cat_sub_name)
            help_url = f"{HELP_BASE}subcategories/{cat_sub_slug}/"

            # Build a short list of highlights (first 5 Subs)
            highlights = sorted(list(subs))[:5]
            highlight_text = "\n".join(f"• {h}" for h in highlights)
            if len(subs) > 5:
                highlight_text += f"\n• ...and {len(subs) - 5} more"

            lines.append(f"## {cat_name} — {cat_sub_name}\n")
            lines.append(f"**Reddit Title:**")
            lines.append(f"> {cat_sub_name} – Premium Stock {cat_name} Visuals | {total_items} assets in 4K/8K (Free to preview)\n")
            lines.append(f"**Reddit Post:**")
            lines.append(f"> I just published a new **{cat_sub_name}** collection in our {cat_name} stock library.")
            lines.append(f">")
            lines.append(f"> This pack includes {total_items} assets covering:")
            lines.append(f">")
            lines.append(highlight_text.replace('•', '> •'))
            lines.append(f">")
            lines.append(f"> Available as 4K/8K video (MP4), high-res images (JPEG), in widescreen, vertical, and square formats.")
            lines.append(f">")
            lines.append(f"> 🌐 Browse the collection: {website_url}")
            lines.append(f"> 📖 Full details & previews: {help_url}")
            lines.append(f">")
            lines.append(f"> All assets are royalty-free. No attribution required.")
            lines.append("\n---\n")

    with open(REDDIT_FEED_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Reddit feed written to: {REDDIT_FEED_FILE}")

def main():
    print("Fetching data from Google Sheets...")
    req = urllib.request.Request(SHEET_URL, headers={'User-Agent': 'Mozilla/5.0'})
    response = urllib.request.urlopen(req)
    csv_data = response.read().decode('utf-8')
    
    reader = csv.DictReader(csv_data.splitlines())
    current_data = [row for row in reader if row.get("File_ID") and row.get("File_ID").strip()]
    
    hierarchy = {}
    sub_groups = {}
    
    for row in current_data:
        cat = row.get("Category") or "Uncategorized"
        cat_sub = row.get("Catagory_Sub") or row.get("Category_Sub") or "General"
        sub_name = row.get("Sub") or "Misc"
        
        cat = cat.strip()
        cat_sub = cat_sub.strip()
        sub_name = sub_name.strip()
            
        if cat not in hierarchy:
            hierarchy[cat] = {}
        if cat_sub not in hierarchy[cat]:
            hierarchy[cat][cat_sub] = set()
            
        hierarchy[cat][cat_sub].add(sub_name)
        
        if sub_name not in sub_groups:
            sub_groups[sub_name] = []
        sub_groups[sub_name].append(row)

    # Sort underlying items
    for sub_name in sub_groups:
        sub_groups[sub_name].sort(key=lambda x: str(x["File_ID"]))

    # Prepare directories
    for folder in ["categories", "subcategories", "collections", "blog", "guides"]:
        (DOCS_PATH / folder).mkdir(parents=True, exist_ok=True)
        
    # Manually-maintained category pages (do NOT auto-delete these)
    MANUAL_CATEGORY_FILES = {"microscopic.md"}

    # Clean previous generated automatic files
    print("Cleaning previously generated directories...")
    for f in (DOCS_PATH / "categories").glob("*.md"):
        if f.name not in MANUAL_CATEGORY_FILES:
            f.unlink()
    for f in (DOCS_PATH / "subcategories").glob("*.md"):
        f.unlink()
    
    # Clean Collections & Blog but keep placeholders
    for folder in ["collections", "blog"]:
        for f in (DOCS_PATH / folder).glob("*.md"):
             if f.name not in ["collection-1.md", "collection-2.md", "general-usage.md", "documentary-visuals.md", "8k-images-print.md", "social-media-posts.md"]:
                 f.unlink()

    # Generate the Markdown Pages and build the nav lists
    categories_nav = []
    collections_nav = []
    blog_nav = []
    total_cats = sum(len(v) for v in hierarchy.values())
    cat_done = 0

    for cat_name, cat_subs in sorted(hierarchy.items()):
        cat_slug = sanitize_slug(cat_name)
        cat_md = f"# Category: {cat_name}\n\nExplore the subcategories below:\n\n"
        
        cat_nav_block = [f"      - {cat_name}:"]
        cat_nav_block.append(f"          - {cat_name} Overview: categories/{cat_slug}.md")
        
        for cat_sub_name, subs in sorted(cat_subs.items()):
            cat_sub_slug = sanitize_slug(cat_sub_name)
            cat_md += f"* **[{cat_sub_name}](../subcategories/{cat_sub_slug}.md)** - Contains {len(subs)} collections.\n"
            cat_done += 1
            progress(f"Category: {cat_name} > {cat_sub_name}", cat_done, total_cats)
            
            # Generate Subcategory Page
            subcat_md = f"# Subcategory: {cat_sub_name}\n\nExplore the collections below:\n\n"
            for sub_name in sorted(list(subs)):
                sub_slug = sanitize_slug(sub_name)
                count = len(sub_groups[sub_name])
                subcat_md += f"* **[{sub_name}](../collections/{sub_slug}.md)** ({count} items)\n"
                
            with open(DOCS_PATH / "subcategories" / f"{cat_sub_slug}.md", "w", encoding="utf-8") as f:
                f.write(subcat_md)
                
            cat_nav_block.append(f"          - {cat_sub_name}: subcategories/{cat_sub_slug}.md")
            
        with open(DOCS_PATH / "categories" / f"{cat_slug}.md", "w", encoding="utf-8") as f:
            f.write(cat_md)
            
        categories_nav.extend(cat_nav_block)

    # Generate Collections and Blogs safely
    print(f"\n⏳ Generating {len(sub_groups)} collection & blog pages...")
    total_subs = len(sub_groups)
    sub_done = 0
    for sub_name, items in sorted(sub_groups.items()):
        sub_done += 1
        progress(f"Collection: {sub_name}", sub_done, total_subs)
        slug = sanitize_slug(sub_name)
        
        # Determine parent category for website link
        parent_cat = "Unknown"
        parent_cat_sub = "Unknown"
        for cat_name, cat_subs in hierarchy.items():
            for cat_sub_name, subs in cat_subs.items():
                if sub_name in subs:
                    parent_cat = cat_name
                    parent_cat_sub = cat_sub_name

        website_url = build_website_url(parent_cat, parent_cat_sub)

        # Collection
        collection_md = f"# Collection: {sub_name}\n\n"
        collection_md += f"**Category:** {parent_cat} > {parent_cat_sub}\n\n"
        collection_md += f"[🌐 Browse this collection on Stockflow.media]({website_url}){{ .md-button .md-button--primary }}\n\n"
        collection_md += f"This collection contains **{len(items)} assets** available in multiple resolutions and aspect ratios.\n\n---\n\n"

        for item in items:
            title = item.get("Title", "Untitled")
            desc = item.get("Description", "")
            res = item.get("Resolution", "")
            fmt = item.get("Format", "")
            preview_url = item.get("Preview_URL", "")
            
            collection_md += f"## {title}\n"
            collection_md += f"**Resolution:** {res} | **Format:** {fmt}\n\n"
            if preview_url:
                collection_md += f"![Preview - {title}]({preview_url})\n\n"
            if desc:
                collection_md += f"{desc}\n\n"
            collection_md += "---\n\n"
            
        with open(DOCS_PATH / "collections" / f"{slug}.md", "w", encoding="utf-8") as f:
            f.write(collection_md)
            
        collections_nav.append(f"      - {sub_name}: collections/{slug}.md")
        
        # Blog showcase
        blog_md = f"# Showcase for {sub_name}\n\nDiscover our newest visually stunning additions in the **{sub_name}** category. Here are amazing ways to use these {len(items)} items across your media projects.\n\n"
        for item in items:
            title = item.get("Title", "Untitled")
            blog_md += f"### Highlight: {title}\n"
            blog_md += f"{item.get('Description', '')}\n\n"
            
        with open(DOCS_PATH / "blog" / f"{slug}-showcase.md", "w", encoding="utf-8") as f:
            f.write(blog_md)
            
        blog_nav.append(f"      - {sub_name} Showcase: blog/{slug}-showcase.md")

    # Generate Reddit feed
    generate_reddit_feed(hierarchy, sub_groups)

    # Update mkdocs.yml gracefully
    if MKDOCS_YML.exists():
        with open(MKDOCS_YML, "r", encoding="utf-8") as f:
             yaml_content = f.read()
             
        # Extract everything before Categories
        lines = yaml_content.splitlines()
        
        new_yaml = []
        for line in lines:
            if line.strip().startswith("- Categories:"):
                break
            new_yaml.append(line)
            
        # Append the new blocks
        new_yaml.append("  - Categories:")
        new_yaml.extend(categories_nav)
        new_yaml.append("  - Collections:")
        new_yaml.append("      - Collection 1 (Placeholder): collections/collection-1.md")
        new_yaml.append("      - Collection 2 (Placeholder): collections/collection-2.md")
        new_yaml.extend(collections_nav)
        new_yaml.append("  - Guides:")
        new_yaml.append("      - Using Video (MP4) Footage: guides/video-mp4.md")
        new_yaml.append("      - Using Audio (MP3) Assets: guides/audio-mp3.md")
        new_yaml.append("      - Using Vector Files: guides/vector-files.md")
        new_yaml.append("  - Blog:")
        new_yaml.append("      - End Usage Scenarios: blog/general-usage.md")
        new_yaml.append("      - Usage in Documentaries: blog/documentary-visuals.md")
        new_yaml.append("      - 8K Images for Print: blog/8k-images-print.md")
        new_yaml.append("      - Social Media Visuals: blog/social-media-posts.md")
        new_yaml.extend(blog_nav)

        with open(MKDOCS_YML, "w", encoding="utf-8") as f:
            f.write("\n".join(new_yaml))
            
        print("Re-generated mkdocs.yml navigating hierarchy successfully.")

if __name__ == "__main__":
    main()
