import os
import csv
import json
import urllib.request
import urllib.parse
import re
import shutil
import sys
from pathlib import Path

import time as _time

def progress(label, current, total, start_time=None):
    bar_len = 30
    filled = int(bar_len * current / total) if total else 0
    bar = '#' * filled + '-' * (bar_len - filled)
    pct = int(100 * current / total) if total else 0
    eta = ''
    if start_time and current > 0:
        elapsed = _time.time() - start_time
        remaining = (elapsed / current) * (total - current)
        if remaining > 60:
            eta = f'  ETA: {int(remaining/60)}m {int(remaining%60)}s'
        else:
            eta = f'  ETA: {int(remaining)}s'
    sys.stdout.write(f'\r  [{bar}] {pct:3d}%  {label[:40]:<40}{eta:<20}')
    sys.stdout.flush()
    if current == total:
        elapsed = _time.time() - start_time if start_time else 0
        print(f'  Done in {int(elapsed)}s')

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
    """Generates one Reddit post per Category_Sub with subreddit targeting."""
    print("\nGenerating Reddit feed...")

    # Subreddit targeting by parent category
    SUBREDDIT_MAP = {
        "microscopic": [
            "r/biology", "r/microbiology", "r/microscopy",
            "r/science", "r/educationalgifs",
        ],
        "food": [
            "r/foodporn", "r/food", "r/videos",
            "r/Cooking", "r/GifRecipes",
        ],
        "pathology": [
            "r/Pathology", "r/medicine", "r/biology",
            "r/science", "r/medicalschool",
        ],
        "algae": ["r/biology", "r/microscopy", "r/botany", "r/science"],
        "fungi": ["r/mycology", "r/biology", "r/microscopy"],
        "worm": ["r/biology", "r/Parasitology", "r/microscopy"],
        "parasite": ["r/Parasitology", "r/biology", "r/medicine"],
        "cancer": ["r/oncology", "r/medicine", "r/biology", "r/science"],
        "default": ["r/biology", "r/science", "r/microscopy", "r/educationalgifs"],
    }

    def get_subreddits(cat_name, cat_sub_name):
        key = cat_name.lower()
        sub_key = cat_sub_name.lower()
        if "food" in key or "beverage" in key:
            return SUBREDDIT_MAP["food"]
        for kw in ["parasite", "cancer", "pathology", "algae", "fungi", "worm"]:
            if kw in sub_key:
                return SUBREDDIT_MAP[kw]
        if "microscopic" in key or "micro" in key:
            return SUBREDDIT_MAP["microscopic"]
        return SUBREDDIT_MAP["default"]

    lines = ["# Reddit Feed — Stockflow.media\n"]
    lines.append("> One post per subcategory. Copy the title + post text into the listed subreddits.\n")
    lines.append("---\n")

    total = sum(len(v) for v in hierarchy.values())
    done = 0
    for cat_name, cat_subs in sorted(hierarchy.items()):
        for cat_sub_name, subs in sorted(cat_subs.items()):
            done += 1
            progress(f"Reddit: {cat_sub_name}", done, total)

            cat_sub_slug = sanitize_slug(cat_sub_name)
            total_items = sum(len(sub_groups[s]) for s in subs if s in sub_groups)
            website_url = build_website_url(cat_name, cat_sub_name)
            help_url = f"{HELP_BASE}subcategories/{cat_sub_slug}/"
            subreddits = get_subreddits(cat_name, cat_sub_name)

            highlights = sorted(list(subs))[:5]
            highlight_lines = "\n".join(f"> • {h}" for h in highlights)
            if len(subs) > 5:
                highlight_lines += f"\n> • ...and {len(subs) - 5} more"

            lines.append(f"## {cat_name} — {cat_sub_name}\n")
            lines.append(f"**Post to:** {' | '.join(subreddits)}\n")
            lines.append(f"**Reddit Title:**")
            lines.append(f"> {cat_sub_name} – Premium Stock {cat_name} Visuals | {total_items} assets in 4K/8K\n")
            lines.append(f"**Reddit Post:**")
            lines.append(f"> I just published a new **{cat_sub_name}** collection in the {cat_name} stock library at Stockflow.media.")
            lines.append(f">")
            lines.append(f"> This pack includes {total_items} assets covering:")
            lines.append(f">")
            lines.append(highlight_lines)
            lines.append(f">")
            lines.append(f"> Available as 4K/8K video (MP4) and high-res images (JPEG), in 16:9, 9:16, and 1:1 formats.")
            lines.append(f">")
            lines.append(f"> 🌐 Browse: {website_url}")
            lines.append(f"> 📖 Details & previews: {help_url}")
            lines.append(f">")
            lines.append(f"> All assets are royalty-free. No attribution required.")
            lines.append("\n---\n")

    with open(REDDIT_FEED_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"\nReddit feed written to: {REDDIT_FEED_FILE}")

def main():
    import sys
    delta_mode = "--delta" in sys.argv

    SNAPSHOT_FILE = SCRIPT_DIR / "previous_data.json"

    print("Fetching data from Google Sheets...")
    req = urllib.request.Request(SHEET_URL, headers={'User-Agent': 'Mozilla/5.0'})
    response = urllib.request.urlopen(req)
    csv_data = response.read().decode('utf-8')
    
    reader = csv.DictReader(csv_data.splitlines())
    current_data = [row for row in reader if row.get("File_ID") and row.get("File_ID").strip()]

    # --- Delta sync: compare against previous snapshot ---
    prev_ids = set()
    if SNAPSHOT_FILE.exists():
        try:
            with open(SNAPSHOT_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                prev_ids = {str(x) for x in data if isinstance(x, str)}
        except Exception:
            print("Note: previous_data.json was corrupted, starting fresh.")
            prev_ids = set()

    current_ids = {row["File_ID"].strip() for row in current_data}
    new_ids = current_ids - prev_ids
    new_rows = [r for r in current_data if r.get("File_ID", "").strip() in new_ids]

    if delta_mode:
        if not new_ids:
            print(f"Delta sync: No new items found. {len(current_ids)} items already up to date.")
        else:
            print(f"Delta sync: {len(new_ids)} new items found out of {len(current_ids)} total.")
    else:
        print(f"Full sync: {len(current_ids)} items ({len(new_ids)} new since last run)")

    # Save updated snapshot
    with open(SNAPSHOT_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted(list(current_ids)), f, indent=2)

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
    
    # Clean Collections & Blog but keep manually authored files
    MANUAL_BLOG_FILES = {
        "collection-1.md", "collection-2.md",
        "general-usage.md", "documentary-visuals.md",
        "8k-images-print.md", "social-media-posts.md",
        # Static SEO blog posts (never auto-delete)
        "canva-science-backgrounds.md", "youtube-science-footage.md",
        "education-biology-footage.md", "social-media-science-content.md",
        "podcast-science-backgrounds.md", "research-presentation-visuals.md",
    }
    for folder in ["collections", "blog"]:
        for f in (DOCS_PATH / folder).glob("*.md"):
             if f.name not in MANUAL_BLOG_FILES:
                 f.unlink()

    # Generate the Markdown Pages and build the nav lists
    categories_nav = []
    collections_nav = []
    blog_nav = []
    total_cats = sum(len(v) for v in hierarchy.values())
    cat_done = 0
    cat_start = _time.time()
    print(f"\nPhase 1/4: Generating {total_cats} category/subcategory pages...")

    for cat_name, cat_subs in sorted(hierarchy.items()):
        cat_slug = sanitize_slug(cat_name)
        cat_md = f"# Category: {cat_name}\n\nExplore the subcategories below:\n\n"
        
        cat_nav_block = [f"      - {cat_name}:"]
        cat_nav_block.append(f"          - {cat_name} Overview: categories/{cat_slug}.md")
        
        for cat_sub_name, subs in sorted(cat_subs.items()):
            cat_sub_slug = sanitize_slug(cat_sub_name)
            cat_md += f"* **[{cat_sub_name}](../subcategories/{cat_sub_slug}.md)** - Contains {len(subs)} collections.\n"
            cat_done += 1
            progress(f"Category: {cat_name} > {cat_sub_name}", cat_done, total_cats, cat_start)
            
            # Generate Subcategory Page with breadcrumb
            cat_slug_for_link = sanitize_slug(cat_name)
            total_sub_assets = sum(len(sub_groups.get(s, [])) for s in subs)
            subcat_md  = f"---\n"
            subcat_md += f"title: \"{cat_sub_name} Stock Footage and Images | Stockflow.media\"\n"
            subcat_md += f"description: \"Browse {total_sub_assets} professional 4K/8K {cat_sub_name} assets from the {cat_name} library — royalty-free footage and images for creators, educators, and designers.\"\n"
            subcat_md += f"---\n\n"
            subcat_md += f"# {cat_sub_name}\n\n"
            subcat_md += f"[Home](../index.md) / [{cat_name}](../categories/{cat_slug_for_link}.md) / **{cat_sub_name}**\n\n"
            subcat_md += f"---\n\nExplore the **{len(subs)} collections** in this subcategory:\n\n"
            for sub_name in sorted(list(subs)):
                sub_slug = sanitize_slug(sub_name)
                count = len(sub_groups[sub_name])
                subcat_md += f"* **[{sub_name}](../collections/{sub_slug}.md)** — {count} assets\n"
                
            with open(DOCS_PATH / "subcategories" / f"{cat_sub_slug}.md", "w", encoding="utf-8") as f:
                f.write(subcat_md)
                
            cat_nav_block.append(f"          - {cat_sub_name}: subcategories/{cat_sub_slug}.md")
            
        with open(DOCS_PATH / "categories" / f"{cat_slug}.md", "w", encoding="utf-8") as f:
            f.write(cat_md)
            
        categories_nav.extend(cat_nav_block)

    # Generate Collections and Blogs safely
    total_subs = len(sub_groups)
    sub_done = 0
    coll_start = _time.time()
    print(f"\nPhase 2/4: Generating {total_subs} collection pages...")
    for sub_name, items in sorted(sub_groups.items()):
        sub_done += 1
        progress(f"Collection: {sub_name}", sub_done, total_subs, coll_start)
        slug = sanitize_slug(sub_name)
        
        # Determine parent category for website link
        parent_cat = "Unknown"
        parent_cat_sub = "Unknown"
        for cat_name, cat_subs in hierarchy.items():
            for cat_sub_name, subs in cat_subs.items():
                if sub_name in subs:
                    parent_cat = cat_name
                    parent_cat_sub = cat_sub_name

        cat_slug_for_link = sanitize_slug(parent_cat)
        cat_sub_slug_for_link = sanitize_slug(parent_cat_sub)
        website_url = build_website_url(parent_cat, parent_cat_sub)

        # Collection with breadcrumb
        collection_md  = f"---\n"
        collection_md += f"title: \"{sub_name} Stock Footage and Images | {parent_cat_sub} | Stockflow.media\"\n"
        collection_md += f"description: \"Download {len(items)} professional {sub_name} assets — 4K MP4 video and 8K JPEG images. Royalty-free, no attribution required. Part of the {parent_cat_sub} collection.\"\n"
        collection_md += f"---\n\n"
        collection_md += f"# {sub_name}\n\n"
        collection_md += f"[Home](../index.md) / [{parent_cat}](../categories/{cat_slug_for_link}.md) / [{parent_cat_sub}](../subcategories/{cat_sub_slug_for_link}.md) / **{sub_name}**\n\n"
        collection_md += f"[Browse on Stockflow.media]({website_url}){{ .md-button .md-button--primary }}\n\n"
        collection_md += f"This collection contains **{len(items)} assets** available in multiple resolutions and aspect ratios.\n\n---\n\n"

        for item in items:
            title = item.get("Title", "Untitled")
            desc = item.get("Description", "")
            res = item.get("Resolution", "")
            fmt = item.get("Format", "")
            preview_url = (item.get("Preview_URL") or "").strip()
            
            collection_md += f"## {title}\n"
            collection_md += f"**Resolution:** {res} | **Format:** {fmt}\n\n"
            if preview_url:
                if preview_url.lower().endswith(".mp4"):
                    collection_md += f'<video controls width="100%" style="max-width:720px;">\n'
                    collection_md += f'  <source src="{preview_url}" type="video/mp4">\n'
                    collection_md += f'  <a href="{preview_url}">Preview video</a>\n'
                    collection_md += f'</video>\n\n'
                else:
                    collection_md += f"![{title}]({preview_url})\n\n"
            if desc:
                collection_md += f"{desc}\n\n"
            collection_md += "---\n\n"
            
        with open(DOCS_PATH / "collections" / f"{slug}.md", "w", encoding="utf-8") as f:
            f.write(collection_md)
            
        collections_nav.append(f"      - {sub_name}: collections/{slug}.md")
        
        # --- Blog showcase: 8-section use-case SEO format ---
        # Determine category-specific use case context
        is_microscopic = "microscopic" in parent_cat.lower() or "micro" in parent_cat.lower()
        is_food = "food" in parent_cat.lower() or "beverage" in parent_cat.lower()

        if is_microscopic:
            use_case_intro = f"**{sub_name}** visuals bring the invisible world to life — ideal for science communicators, educators, documentary makers, and digital designers."
            use_case_list = [
                "Science documentaries and biology explainer videos",
                "Educational YouTube Shorts, Instagram Reels, and TikTok content",
                "University lectures, online courses, and e-learning modules",
                "Science posters, museum displays, and exhibition banners",
                "Canva educational templates and presentation backgrounds",
                "Video podcasts covering biology, health, and technology topics",
            ]
            software_tip = "Import MP4 files directly into **Premiere Pro**, **DaVinci Resolve**, **Final Cut Pro**, or **CapCut** as B-roll overlays. Drop JPEG images into **Canva**, **PowerPoint**, or **Google Slides** as background visuals."
        elif is_food:
            use_case_intro = f"**{sub_name}** footage captures food at its most cinematic — ideal for restaurant brands, food bloggers, delivery apps, and culinary content creators."
            use_case_list = [
                "Instagram Reels, TikTok food videos, and YouTube Shorts",
                "Restaurant ads, delivery app promotions, and brand storytelling",
                "Food blog visuals, cookbook pages, and menu photography",
                "Food documentary B-roll and culinary travel content",
                "Menu printing, poster design, and in-store display boards",
                "Canva social media templates for food and hospitality brands",
            ]
            software_tip = "Import MP4 footage into **Premiere Pro**, **DaVinci Resolve**, or **iMovie** for food video production. Use JPEG assets in **Canva**, **Adobe InDesign**, or **Photoshop** for print and social media design."
        else:
            use_case_intro = f"**{sub_name}** assets are versatile visual tools for content creators, marketers, and designers across multiple platforms and project types."
            use_case_list = [
                "Social media videos: YouTube Shorts, Instagram Reels, TikTok",
                "Documentary B-roll, explainer videos, and brand storytelling",
                "Canva designs, presentation backgrounds, and digital marketing",
                "Print design: posters, banners, editorial layouts",
                "Website hero sections and landing page backgrounds",
                "Video podcast visual environments and motion backgrounds",
            ]
            software_tip = "Import MP4 files into **Premiere Pro**, **DaVinci Resolve**, **Final Cut Pro**, or **CapCut**. Use JPEG images in **Canva**, **PowerPoint**, **Google Slides**, or **Adobe InDesign**."

        # Pick first 3 items with image previews for the blog
        preview_items = [i for i in items if (i.get("Preview_URL") or "").strip() and not (i.get("Preview_URL") or "").strip().lower().endswith(".mp4")][:3]

        blog_md  = f"---\n"
        blog_md += f"title: \"How to Use {sub_name} Footage in Creative Projects | Stockflow.media\"\n"
        blog_md += f"description: \"{use_case_intro[:160]}\"\n"
        blog_md += f"---\n\n"
        blog_md += f"# How to Use {sub_name} Visuals in Your Creative Projects\n\n"
        blog_md += f"[Home](../index.md) / [{parent_cat}](../categories/{cat_slug_for_link}.md) / [{parent_cat_sub}](../subcategories/{cat_sub_slug_for_link}.md) / **{sub_name}**\n\n"
        blog_md += f"[Browse the {sub_name} Collection]({website_url}){{ .md-button .md-button--primary }}\n\n"
        blog_md += "---\n\n"

        # Section 1: Introduction
        blog_md += f"## Introduction\n\n{use_case_intro}\n\n"
        blog_md += f"This guide explores how to use the **{sub_name}** collection — {len(items)} premium assets available in 4K/8K — across real creative workflows.\n\n"

        # Section 2: Preview highlights
        if preview_items:
            blog_md += f"## Visual Highlights\n\n"
            for item in preview_items:
                title = item.get("Title", "Untitled")
                preview_url = item.get("Preview_URL", "").strip()
                desc = item.get("Description", "")
                blog_md += f"### {title}\n"
                blog_md += f"![{title}]({preview_url})\n\n"
                if desc:
                    blog_md += f"{desc}\n\n"

        # Section 3: Why these visuals are useful
        blog_md += f"## Why {sub_name} Visuals Are in Demand\n\n"
        blog_md += f"High-quality {sub_name.lower()} footage is notoriously difficult to capture independently. "
        blog_md += f"Stock visuals from Stockflow.media give you instant access to professionally shot, royalty-free assets — "
        blog_md += f"saving hours of production time and thousands in equipment costs.\n\n"
        blog_md += f"All **{len(items)} assets** in this collection are:\n\n"
        blog_md += "- Royalty-free — no attribution required\n"
        blog_md += "- Available in multiple aspect ratios (16:9, 9:16, 1:1)\n"
        blog_md += "- Up to 8K resolution for print and up to 4K for video\n"
        blog_md += "- Instant download after purchase\n\n"

        # Section 4: Use cases
        blog_md += f"## Common Use Cases\n\n"
        for uc in use_case_list:
            blog_md += f"- {uc}\n"
        blog_md += "\n"

        # Section 5: Editing software workflow
        blog_md += f"## How to Use in Your Editing Software\n\n"
        blog_md += f"{software_tip}\n\n"
        blog_md += "**Recommended workflow:**\n\n"
        blog_md += "1. Download the asset from [Stockflow.media]({website_url})\n"
        blog_md += "2. Import into your editing timeline or design canvas\n"
        blog_md += "3. Resize or trim to fit your project format\n"
        blog_md += "4. Add text overlays, voiceover, or music as needed\n\n"

        # Section 6: Supported formats
        blog_md += f"## Supported File Formats\n\n"
        blog_md += "| Format | Use Case | Max Resolution |\n"
        blog_md += "|---|---|---|\n"
        blog_md += "| **MP4 Video** | Social media, YouTube, documentaries | Up to 4K (3840×2160) |\n"
        blog_md += "| **JPEG Image** | Print, Canva, presentations | Up to 8K (7680×4320) |\n"
        blog_md += "| **Aspect Ratios** | 16:9, 9:16, 1:1 | All resolutions |\n\n"

        # Section 7: Platform-specific tips
        blog_md += f"## Platform-Specific Tips\n\n"
        blog_md += "| Platform | Best Format | Recommended Ratio |\n"
        blog_md += "|---|---|---|\n"
        blog_md += "| YouTube | MP4 | 16:9 |\n"
        blog_md += "| Instagram Reels / TikTok | MP4 | 9:16 |\n"
        blog_md += "| Instagram Feed / LinkedIn | JPEG or MP4 | 1:1 |\n"
        blog_md += "| Canva | JPEG or MP4 | Any |\n"
        blog_md += "| PowerPoint / Google Slides | JPEG | 16:9 |\n"
        blog_md += "| Print (A1 Poster+) | JPEG 8K | Any |\n\n"

        # Section 8: CTA
        blog_md += f"## Explore the Full {sub_name} Collection\n\n"
        blog_md += f"Ready to add **{sub_name}** visuals to your next project?\n\n"
        blog_md += f"[Browse {sub_name} on Stockflow.media]({website_url}){{ .md-button .md-button--primary }}\n"
        blog_md += f"[View Collection Details](../collections/{slug}.md){{ .md-button }}\n"

        with open(DOCS_PATH / "blog" / f"{slug}-showcase.md", "w", encoding="utf-8") as f:
            f.write(blog_md)
            
        blog_nav.append(f"      - {sub_name} Guide: blog/{slug}-showcase.md")

    # Generate Reddit feed
    print("\nPhase 3/4: Generating Reddit feed...")
    generate_reddit_feed(hierarchy, sub_groups)

    # Update mkdocs.yml gracefully
    print("\nPhase 4/4: Updating mkdocs.yml navigation...")
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
        new_yaml.append("      - Video:")
        new_yaml.append("          - Using MP4 Video Footage: guides/video-mp4.md")
        new_yaml.append("          - Using Audio (MP3) Assets: guides/audio-mp3.md")
        new_yaml.append("      - Images:")
        new_yaml.append("          - Using JPEG Images: guides/image-jpeg.md")
        new_yaml.append("          - Using PNG Images: guides/image-png.md")
        new_yaml.append("          - Animated WebP Guide: guides/image-webp-animated.md")
        new_yaml.append("      - Design Files:")
        new_yaml.append("          - Using Vector Files: guides/vector-files.md")
        new_yaml.append("  - Blog:")
        new_yaml.append("      - End Usage Scenarios: blog/general-usage.md")
        new_yaml.append("      - Usage in Documentaries: blog/documentary-visuals.md")
        new_yaml.append("      - 8K Images for Print: blog/8k-images-print.md")
        new_yaml.append("      - Social Media Visuals: blog/social-media-posts.md")
        # Static SEO strategy blog posts — manually authored, always included
        new_yaml.append("      - Science Footage for Canva: blog/canva-science-backgrounds.md")
        new_yaml.append("      - YouTube Science Channels: blog/youtube-science-footage.md")
        new_yaml.append("      - Biology Lessons & E-Learning: blog/education-biology-footage.md")
        new_yaml.append("      - Social Media Science Content: blog/social-media-science-content.md")
        new_yaml.append("      - Video Podcast Backgrounds: blog/podcast-science-backgrounds.md")
        new_yaml.append("      - Research & Conference Visuals: blog/research-presentation-visuals.md")
        new_yaml.extend(blog_nav)

        with open(MKDOCS_YML, "w", encoding="utf-8") as f:
            f.write("\n".join(new_yaml))
            
        print("Re-generated mkdocs.yml navigating hierarchy successfully.")

if __name__ == "__main__":
    try:
        main()
        print("\n" + "="*50)
        print("  SYNC COMPLETE - All pages generated successfully")
        print("="*50)
    except Exception as e:
        print(f"\n\nERROR: {e}")
        import traceback
        traceback.print_exc()
        print("\nSync failed. See error above.")
        sys.exit(1)
