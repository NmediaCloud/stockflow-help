"""
Stockflow Montage Builder
=========================
Three-tier video montage pipeline:
  Collection (~1 min) → Subcategory (~3 min) → Category (~6 min)

Supports 3 aspect ratios:
  W = Widescreen 16:9 (1920x1080) → YouTube, LinkedIn, Facebook
  S = Square 1:1 (1080x1080)      → Instagram, Facebook, Pinterest
  V = Vertical 9:16 (1080x1920)   → TikTok, Instagram Reels, YouTube Shorts

Usage:
  python montage_builder.py --list
  python montage_builder.py --level collection --name "Chicken Dinner"
  python montage_builder.py --level collection --name "Chicken Dinner" --format S
  python montage_builder.py --level collection --all --format V
  python montage_builder.py --level collection --all --format all
  python montage_builder.py --level subcategory --name "Food Menu"
  python montage_builder.py --level category --name "Food & Beverage"
"""

import os
import sys
import csv
import json
import re
import shutil
import subprocess
import tempfile
import argparse
import urllib.request
import urllib.parse
import time as _time
from pathlib import Path
from datetime import datetime

# Fix Windows console encoding for Unicode
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# ─── Paths ───────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent.resolve()
CONFIG_FILE = SCRIPT_DIR / "montage_config.json"
PROJECT_ROOT = (SCRIPT_DIR / "..").resolve()

# Format presets: W=Widescreen, S=Square, V=Vertical
FORMAT_PRESETS = {
    "W": {"resolution": "1920x1080", "aspect": "16:9", "output_suffix": "W output",
           "label": "Widescreen (16:9)"},
    "S": {"resolution": "1080x1080", "aspect": "1:1", "output_suffix": "S output",
           "label": "Square (1:1)"},
    "V": {"resolution": "1080x1920", "aspect": "9:16", "output_suffix": "V output",
           "label": "Vertical (9:16)"},
}

# ─── Utilities ───────────────────────────────────────────────────────────────

def load_config():
    """Load config with defaults for missing keys."""
    defaults = {
        "sheet_url": "",
        "ffmpeg_path": "ffmpeg",
        "ffprobe_path": "ffprobe",
        "output_dir": "output",
        "temp_dir": "temp",
        "resolution": "1920x1080",
        "fps": 25,
        "crf": 18,
        "preset": "fast",
        "collection_target_secs": 60,
        "subcategory_target_secs": 180,
        "category_target_secs": 360,
        "clip_duration": 3,
        "title_card_duration": 4,
        "divider_card_duration": 2,
        "transition_duration": 0.4,
        "collection_transition": "wipeleft",
        "subcategory_transition": "fade",
        "category_transition": "smoothup",
        "font_path": "C:/Windows/Fonts/arialbd.ttf",
        "font_path_light": "C:/Windows/Fonts/arial.ttf",
        "title_font_size": 72,
        "subtitle_font_size": 36,
        "divider_font_size": 56,
        "music_dir": "music",
        "music_volume_db": -18,
        "music_fade_in": 2,
        "music_fade_out": 3,
        "watermark_dir": "watermark",
        "youtube_credentials_path": "youtube_credentials.json",
        "youtube_token_path": "youtube_token.json",
        "youtube_privacy": "unlisted",
        "youtube_category_id": "27",
        "montages_json_path": "../tools/category_montages.json",
        "auto_sync_after_upload": False,
    }
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            user = json.load(f)
        defaults.update(user)

    # Resolve relative paths against SCRIPT_DIR
    for key in ["output_dir", "temp_dir", "music_dir", "watermark_dir",
                "youtube_credentials_path", "youtube_token_path", "montages_json_path"]:
        p = Path(defaults[key])
        if not p.is_absolute():
            defaults[key] = str((SCRIPT_DIR / p).resolve())
    return defaults


def sanitize_slug(text):
    slug = text.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    return slug.strip('-')


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
            eta = f'  ETA: {int(remaining//60)}m {int(remaining%60)}s'
        else:
            eta = f'  ETA: {int(remaining)}s'
    sys.stdout.write(f'\r  [{bar}] {pct:3d}%  {label[:40]:<40}{eta:<20}')
    sys.stdout.flush()
    if current == total:
        elapsed = _time.time() - start_time if start_time else 0
        print(f'  Done in {int(elapsed)}s')


def print_phase(num, total, desc):
    print(f"\n{'='*60}")
    print(f"  Phase {num}/{total}: {desc}")
    print(f"{'='*60}\n")



def detect_media_type(filepath):
    """Returns 'video', 'image_static', or 'image_animated'."""
    ext = Path(filepath).suffix.lower()
    if ext in ('.mp4', '.mov', '.avi', '.mkv'):
        return 'video'
    elif ext == '.webp':
        return 'image_animated'  # treat all webp as potentially animated
    elif ext in ('.jpg', '.jpeg', '.png', '.bmp', '.tiff'):
        return 'image_static'
    return 'video'  # fallback


def get_duration(filepath, config):
    """Get media duration in seconds using ffprobe."""
    try:
        result = subprocess.run(
            [config["ffprobe_path"], "-v", "quiet", "-print_format", "json",
             "-show_format", str(filepath)],
            capture_output=True, text=True, timeout=30
        )
        data = json.loads(result.stdout)
        return float(data.get("format", {}).get("duration", 0))
    except Exception:
        return 0


def escape_ffmpeg_text(text):
    """Escape special characters for FFmpeg drawtext filter."""
    # FFmpeg drawtext needs colons and backslashes escaped
    text = text.replace("\\", "\\\\")
    text = text.replace(":", "\\:")
    text = text.replace("'", "\\'")
    return text


# ─── Phase 1: Fetch & Filter ────────────────────────────────────────────────

def fetch_sheet(config):
    """Fetch Google Sheets CSV data."""
    print("  Fetching data from Google Sheets...")
    req = urllib.request.Request(
        config["sheet_url"],
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    response = urllib.request.urlopen(req, timeout=60)
    csv_data = response.read().decode('utf-8')
    reader = csv.DictReader(csv_data.splitlines())
    rows = [row for row in reader if row.get("File_ID") and row.get("File_ID").strip()]
    print(f"  Fetched {len(rows)} total items from sheet.")
    return rows


def build_hierarchy(rows):
    """Build the 3-tier hierarchy from sheet data.
    Returns:
        hierarchy: {Category: {Subcategory: set(Collection_names)}}
        sub_groups: {Collection_name: [row, row, ...]}
        sub_to_cat: {Collection_name: (Category, Subcategory)}
    """
    hierarchy = {}
    sub_groups = {}
    sub_to_cat = {}

    for row in rows:
        cat = (row.get("Category") or "Uncategorized").strip()
        cat_sub = (row.get("Catagory_Sub") or row.get("Category_Sub") or "General").strip()
        sub_name = (row.get("Sub") or "Misc").strip()

        if cat not in hierarchy:
            hierarchy[cat] = {}
        if cat_sub not in hierarchy[cat]:
            hierarchy[cat][cat_sub] = set()
        hierarchy[cat][cat_sub].add(sub_name)

        if sub_name not in sub_groups:
            sub_groups[sub_name] = []
        sub_groups[sub_name].append(row)
        sub_to_cat[sub_name] = (cat, cat_sub)

    # Sort items within each collection
    for sub_name in sub_groups:
        sub_groups[sub_name].sort(key=lambda x: str(x.get("File_ID", "")))

    return hierarchy, sub_groups, sub_to_cat


def filter_by_format(items, aspect="16:9"):
    """Filter items to the specified aspect ratio (16:9, 1:1, or 9:16)."""
    filtered = []
    for row in items:
        fmt = (row.get("Format") or "").strip()
        if aspect in fmt:
            filtered.append(row)
    return filtered


# ─── Phase 2: Download ──────────────────────────────────────────────────────

def download_clips(items, temp_dir, config):
    """Download preview files from GCS. Returns list of local file paths."""
    downloaded = []
    total = len(items)
    start = _time.time()

    for i, row in enumerate(items):
        url = (row.get("Preview_URL") or "").strip()
        if not url:
            continue

        # Fix GCS URL: storage.cloud.google.com requires auth,
        # storage.googleapis.com is the public direct-download URL
        url = url.replace("storage.cloud.google.com", "storage.googleapis.com")
        # Encode spaces and special chars in URL path (keep scheme/host intact)
        url = urllib.parse.quote(url, safe=':/?&=@#%+')

        # Build filename from File_ID to avoid collisions
        file_id = row.get("File_ID", f"unknown_{i}").strip()
        ext = Path(url.split("?")[0]).suffix or ".mp4"
        local_name = f"{sanitize_slug(file_id)}{ext}"
        local_path = Path(temp_dir) / local_name

        progress(f"Downloading {local_name}", i, total, start)

        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=60) as resp:
                with open(local_path, 'wb') as f:
                    f.write(resp.read())
            downloaded.append({
                "path": str(local_path),
                "media_type": detect_media_type(str(local_path)),
                "title": row.get("Title", ""),
                "file_id": file_id,
            })
        except Exception as e:
            print(f"\n  Warning: Failed to download {url}: {e}")
            continue

    progress("Download complete", total, total, start)
    return downloaded


# ─── Phase 3: Smart Clip Selection ──────────────────────────────────────────

def select_clips(downloaded, target_secs, clip_duration):
    """Select clips to fit within target duration.
    Prefers MP4 videos over images (WebP/JPG/PNG).
    Returns (selected_clips, actual_clip_duration).
    If too many clips, we trim per-clip duration to fit.
    """
    if not downloaded:
        return [], clip_duration

    # Sort: videos first, then images
    videos = [c for c in downloaded if c["media_type"] == "video"]
    images = [c for c in downloaded if c["media_type"] != "video"]
    prioritized = videos + images

    target_count = max(1, int(target_secs / clip_duration))

    if len(prioritized) <= target_count:
        selected = prioritized
    else:
        # Take as many videos as possible, fill remainder with images
        if len(videos) >= target_count:
            # Enough videos — evenly sample from videos only
            step = len(videos) / target_count
            selected = [videos[int(i * step)] for i in range(target_count)]
        else:
            # Use all videos + sample from images to fill
            remaining = target_count - len(videos)
            step = len(images) / remaining if remaining > 0 else 1
            sampled_images = [images[int(i * step)] for i in range(remaining)]
            selected = videos + sampled_images

    # Adjust clip duration if we have too many clips
    total_clips = len(selected)
    if total_clips * clip_duration > target_secs * 1.2 and total_clips > 1:
        adjusted_duration = max(1.5, target_secs / total_clips)
    else:
        adjusted_duration = clip_duration

    print(f"  Selected {len(selected)} clips, {adjusted_duration:.1f}s each "
          f"→ ~{len(selected) * adjusted_duration:.0f}s total")
    return selected, adjusted_duration


# ─── Phase 4: FFmpeg Stitching ───────────────────────────────────────────────

def format_font_path(path):
    """Format font path for FFmpeg drawtext on Windows (escape the colon after drive letter)."""
    # C:/Windows/Fonts/arial.ttf → C\:/Windows/Fonts/arial.ttf
    p = path.replace("\\", "/")
    if len(p) >= 2 and p[1] == ":":
        p = p[0] + "\\:" + p[2:]
    return p


def overlay_title_on_clip(clip_path, text_main, text_sub, config, output_path, position="center"):
    """Overlay title text on a clip with semi-transparent dark strip that fades out.
    Text appears immediately and fades out after title_card_duration seconds.

    position: 'center' (collection), 'top' (category), 'bottom' (subcategory)
    """
    font_bold = format_font_path(config["font_path"])
    font_light = format_font_path(config["font_path_light"])
    main_escaped = escape_ffmpeg_text(text_main.upper())
    sub_escaped = escape_ffmpeg_text(text_sub)
    show_dur = config.get("title_card_duration", 1.5)
    fade_dur = config.get("overlay_fade_out", 0.5)
    fade_start = show_dur - fade_dur

    # Position the dark strip and text based on level
    if position == "top":
        # Category: upper third
        box_y = "(ih/6-60)"
        main_y = "(h/6-text_h-5)"
        sub_y = "(h/6+8)"
    elif position == "bottom":
        # Subcategory: lower third
        box_y = "(ih*5/6-60)"
        main_y = "(h*5/6-text_h-5)"
        sub_y = "(h*5/6+8)"
    else:
        # Collection: center (default)
        box_y = "(ih/2-80)"
        main_y = "(h/2-text_h-5)"
        sub_y = "(h/2+8)"

    filter_str = (
        # Dark semi-transparent strip behind text
        f"drawbox=x=0:y={box_y}:w=iw:h=120:"
        f"color=black@0.55:t=fill:"
        f"enable='between(t,0,{show_dur})',"
        # Main title text
        f"drawtext=text='{main_escaped}':"
        f"fontfile='{font_bold}':"
        f"fontsize={config['title_font_size']}:fontcolor=white:"
        f"x=(w-text_w)/2:y={main_y}:"
        f"alpha='if(lt(t,{fade_start}),1,max(0,(1-(t-{fade_start})/{fade_dur})))':"
        f"enable='between(t,0,{show_dur})',"
        # Subtitle text
        f"drawtext=text='{sub_escaped}':"
        f"fontfile='{font_light}':"
        f"fontsize={config['subtitle_font_size']}:fontcolor=0xDDDDDD:"
        f"x=(w-text_w)/2:y={sub_y}:"
        f"alpha='if(lt(t,{fade_start}),1,max(0,(1-(t-{fade_start})/{fade_dur})))':"
        f"enable='between(t,0,{show_dur})'"
    )

    cmd = [
        config["ffmpeg_path"], "-y",
        "-i", str(clip_path),
        "-vf", filter_str,
        "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq",
        "-rc", "vbr", "-cq", str(config["crf"]),
        "-c:a", "copy",
        str(output_path)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        print(f"  Warning: Title overlay failed, using clip without text: {result.stderr[-300:]}")
        # Fallback: just copy the original clip
        shutil.copy2(clip_path, output_path)
    return str(output_path)


def generate_title_card(text_main, text_sub, config, output_path, duration=3.0):
    """Generate a standalone black title card with text that fades in and out.
    Used as a separator before subcategory/category content to avoid overlapping titles.
    """
    font_bold = format_font_path(config["font_path"])
    font_light = format_font_path(config["font_path_light"])
    main_escaped = escape_ffmpeg_text(text_main.upper())
    sub_escaped = escape_ffmpeg_text(text_sub)
    w, h = config["resolution"].split("x")
    fade_in = 0.5
    fade_out = 0.5
    hold_end = duration - fade_out

    filter_str = (
        f"color=c=black:s={w}x{h}:d={duration}:r={config['fps']},"
        f"format=yuv420p,"
        # Main title text with fade in/out
        f"drawtext=text='{main_escaped}':"
        f"fontfile='{font_bold}':"
        f"fontsize={config['title_font_size']}:fontcolor=white:"
        f"x=(w-text_w)/2:y=(h/2-text_h-5):"
        f"alpha='if(lt(t,{fade_in}),t/{fade_in},if(lt(t,{hold_end}),1,max(0,1-(t-{hold_end})/{fade_out})))',"
        # Subtitle text with fade in/out
        f"drawtext=text='{sub_escaped}':"
        f"fontfile='{font_light}':"
        f"fontsize={config['subtitle_font_size']}:fontcolor=0xDDDDDD:"
        f"x=(w-text_w)/2:y=(h/2+8):"
        f"alpha='if(lt(t,{fade_in}),t/{fade_in},if(lt(t,{hold_end}),1,max(0,1-(t-{hold_end})/{fade_out})))'"
    )

    cmd = [
        config["ffmpeg_path"], "-y",
        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo",
        "-filter_complex", filter_str,
        "-map", "1:v", "-map", "0:a",
        "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq",
        "-rc", "vbr", "-cq", str(config["crf"]),
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        str(output_path)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        print(f"  Warning: Title card generation failed: {result.stderr[-300:]}")
        return None
    return str(output_path)


def overlay_divider_on_clip(clip_path, text, config, output_path):
    """Overlay divider text on a clip with semi-transparent strip that fades out."""
    font_bold = format_font_path(config["font_path"])
    text_escaped = escape_ffmpeg_text(text.upper())
    show_dur = config.get("divider_card_duration", 1.5)
    fade_dur = config.get("overlay_fade_out", 0.5)
    fade_start = show_dur - fade_dur

    filter_str = (
        # Dark semi-transparent strip
        f"drawbox=x=0:y=(ih/2-45):w=iw:h=90:"
        f"color=black@0.55:t=fill:"
        f"enable='between(t,0,{show_dur})',"
        # Divider text
        f"drawtext=text='{text_escaped}':"
        f"fontfile='{font_bold}':"
        f"fontsize={config['divider_font_size']}:fontcolor=white:"
        f"x=(w-text_w)/2:y=(h-text_h)/2:"
        f"alpha='if(lt(t,{fade_start}),1,max(0,(1-(t-{fade_start})/{fade_dur})))':"
        f"enable='between(t,0,{show_dur})'"
    )

    cmd = [
        config["ffmpeg_path"], "-y",
        "-i", str(clip_path),
        "-vf", filter_str,
        "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq",
        "-rc", "vbr", "-cq", str(config["crf"]),
        "-c:a", "copy",
        str(output_path)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        print(f"  Warning: Divider overlay failed, using clip without text: {result.stderr[-300:]}")
        shutil.copy2(clip_path, output_path)
    return str(output_path)


def normalize_clip(clip_info, clip_duration, config, output_path):
    """Normalize a single clip/image to standard format for concat."""
    w, h = config["resolution"].split("x")
    media_type = clip_info["media_type"]
    src = clip_info["path"]

    if media_type == "video":
        # Video: trim to clip_duration, scale to resolution
        filter_str = (
            f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,"
            f"setsar=1,fps={config['fps']},format=yuv420p"
        )
        cmd = [
            config["ffmpeg_path"], "-y",
            "-i", src,
            "-t", str(clip_duration),
            "-vf", filter_str,
            "-an",  # strip audio for now, music added later
            "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq",
            "-rc", "vbr", "-cq", str(config["crf"]),
            str(output_path)
        ]
    elif media_type == "image_animated":
        # Animated WebP: pure smooth zoom using scale expressions (no zoompan)
        # Upscale to 103%, then crop inward over time for shake-free zoom
        dur = clip_duration
        filter_str = (
            f"scale=-1:{int(int(h)*1.03)},"
            f"crop=w={w}:h={h}:x='(iw-{w})/2':y='(ih-{h})/2',"
            f"setsar=1,format=yuv420p"
        )
        cmd = [
            config["ffmpeg_path"], "-y",
            "-loop", "1",
            "-i", src,
            "-t", str(dur),
            "-vf", filter_str,
            "-r", str(config["fps"]),
            "-an",
            "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq",
            "-rc", "vbr", "-cq", str(config["crf"]),
            str(output_path)
        ]
    else:
        # Static image: pure smooth zoom using scale expressions (no zoompan)
        dur = clip_duration
        filter_str = (
            f"scale=-1:{int(int(h)*1.03)},"
            f"crop=w={w}:h={h}:x='(iw-{w})/2':y='(ih-{h})/2',"
            f"setsar=1,format=yuv420p"
        )
        cmd = [
            config["ffmpeg_path"], "-y",
            "-loop", "1",
            "-i", src,
            "-t", str(dur),
            "-vf", filter_str,
            "-r", str(config["fps"]),
            "-an",
            "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq",
            "-rc", "vbr", "-cq", str(config["crf"]),
            str(output_path)
        ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        print(f"\n  Warning: Failed to normalize {src}: {result.stderr[-300:]}")
        return None
    return str(output_path)


def stitch_with_transitions(clip_paths, transition_type, transition_dur, config, output_path):
    """Stitch normalized clips together using xfade transitions."""
    if not clip_paths:
        return None

    if len(clip_paths) == 1:
        shutil.copy2(clip_paths[0], output_path)
        return str(output_path)

    # Build xfade chain using filter_complex
    inputs = []
    for p in clip_paths:
        inputs.extend(["-i", str(p)])

    # Get durations of each clip
    durations = []
    for p in clip_paths:
        dur = get_duration(p, config)
        durations.append(dur if dur > 0 else 3.0)

    # Build xfade filter chain
    filter_parts = []
    # Alternate between transition types for variety
    transitions = [transition_type, "slideleft", "wiperight", "slideright"]
    current_offset = durations[0] - transition_dur
    prev_label = "[0:v]"

    for i in range(1, len(clip_paths)):
        t = transitions[i % len(transitions)]
        out_label = f"[xf{i}]" if i < len(clip_paths) - 1 else "[vout]"
        filter_parts.append(
            f"{prev_label}[{i}:v]xfade=transition={t}:"
            f"duration={transition_dur}:offset={current_offset:.4f}{out_label}"
        )
        prev_label = out_label if i < len(clip_paths) - 1 else None
        current_offset += durations[i] - transition_dur

    filter_complex = ";".join(filter_parts)

    cmd = [
        config["ffmpeg_path"], "-y",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq",
        "-rc", "vbr", "-cq", str(config["crf"]),
        "-pix_fmt", "yuv420p",
        "-r", str(config["fps"]),
        str(output_path)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        print(f"\n  xfade failed, falling back to concat demuxer...")
        return concat_clips(clip_paths, config, output_path)
    return str(output_path)


def concat_clips(clip_paths, config, output_path):
    """Fallback: simple concat using demuxer (no transitions)."""
    concat_file = Path(output_path).parent / "concat_list.txt"
    with open(concat_file, "w", encoding="utf-8") as f:
        for p in clip_paths:
            # FFmpeg concat demuxer needs forward slashes
            safe_path = str(p).replace("\\", "/")
            f.write(f"file '{safe_path}'\n")

    cmd = [
        config["ffmpeg_path"], "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_file),
        "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq",
        "-rc", "vbr", "-cq", str(config["crf"]),
        "-pix_fmt", "yuv420p",
        "-r", str(config["fps"]),
        str(output_path)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        print(f"  Concat error: {result.stderr[-500:]}")
        return None
    return str(output_path)


def add_silent_audio(video_path, config, output_path):
    """Add a silent audio track to a video that has none."""
    dur = get_duration(video_path, config)
    cmd = [
        config["ffmpeg_path"], "-y",
        "-i", str(video_path),
        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo",
        "-t", str(dur),
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        str(output_path)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        # If fails, just copy original
        shutil.copy2(video_path, output_path)
    return str(output_path)


# ─── Build Collection Montage ────────────────────────────────────────────────

def build_collection_montage(collection_name, items, cat_name, subcat_name,
                              config, temp_dir, force=False):
    """Build a single collection montage (~1 min).
    Skip if output file already exists (delete the file to force rebuild).
    Use --force to rebuild everything regardless.

    Output folder structure:
      output/{category}/{subcategory}/{collection}.mp4
    """
    cat_slug = sanitize_slug(cat_name)
    sub_slug = sanitize_slug(subcat_name)
    coll_slug = sanitize_slug(collection_name)
    out_dir = Path(config["output_dir"]) / cat_slug / sub_slug
    os.makedirs(out_dir, exist_ok=True)
    output_path = out_dir / f"{coll_slug}.mp4"

    # Simple delta: if file exists, skip. Delete it to rebuild.
    if not force and output_path.exists():
        print(f"\n  Skipping {collection_name}: {output_path.name} already exists")
        return str(output_path)

    aspect = config.get("_aspect", "16:9")
    matched_items = filter_by_format(items, aspect)
    print(f"\n  Building collection: {collection_name}")
    print(f"  Items available: {len(items)} ({len(matched_items)} in {aspect})")
    if not matched_items:
        print(f"  No {aspect} items found for {collection_name}, skipping.")
        return None

    # Download
    downloaded = download_clips(matched_items, temp_dir, config)
    if not downloaded:
        print(f"  No clips downloaded for {collection_name}, skipping.")
        return None

    # Select clips
    target = config["collection_target_secs"]
    clip_dur = config["clip_duration"]
    selected, actual_dur = select_clips(downloaded, target, clip_dur)

    if not selected:
        return None

    # Normalize all clips
    print(f"  Normalizing {len(selected)} clips...")
    normalized = []
    start = _time.time()
    for i, clip in enumerate(selected):
        progress(f"Normalizing clip {i+1}", i, len(selected), start)
        norm_path = Path(temp_dir) / f"norm_{coll_slug}_{i:03d}.mp4"
        result = normalize_clip(clip, actual_dur, config, norm_path)
        if result:
            normalized.append(result)
    progress("Normalization done", len(selected), len(selected), start)

    if not normalized:
        return None

    # Overlay title text on the first clip (transparent overlay, not separate card)
    subtitle = f"{subcat_name} | Stockflow.media"
    first_clip_overlay = Path(temp_dir) / f"titled_{coll_slug}_000.mp4"
    overlay_title_on_clip(normalized[0], collection_name, subtitle, config, first_clip_overlay)

    # Assemble: first clip with title overlay + remaining clips
    all_clips = [str(first_clip_overlay)]
    all_clips.extend(normalized[1:])

    print(f"  Stitching {len(all_clips)} segments with {config['collection_transition']} transitions...")
    stitched = Path(temp_dir) / f"stitched_{coll_slug}.mp4"
    result = stitch_with_transitions(
        all_clips, config["collection_transition"],
        config["transition_duration"], config, stitched
    )

    if result:
        # Copy to organized output folder
        os.makedirs(out_dir, exist_ok=True)
        shutil.copy2(result, output_path)
        dur = get_duration(str(output_path), config)
        print(f"  Collection montage saved: {output_path} ({dur:.1f}s)")
        return str(output_path)

    return None


# ─── Build Subcategory Montage ───────────────────────────────────────────────

def build_subcategory_montage(subcat_name, cat_name, collections, sub_groups,
                               config, temp_dir, force=False):
    """Build subcategory montage by combining collection montages (~3 min).
    Skip if output file already exists (delete to rebuild).

    Output: output/{category}/{subcategory}_montage.mp4
    """
    cat_slug = sanitize_slug(cat_name)
    sub_slug = sanitize_slug(subcat_name)
    out_dir = Path(config["output_dir"]) / cat_slug / sub_slug
    os.makedirs(out_dir, exist_ok=True)
    output_path = out_dir / f"{sub_slug}_montage.mp4"

    print(f"\n{'─'*50}")
    print(f"  Subcategory: {subcat_name} ({len(collections)} collections)")
    print(f"{'─'*50}")

    # Build each collection montage first (file-exists check inside)
    collection_videos = []
    for coll_name in sorted(collections):
        items = sub_groups.get(coll_name, [])
        if not items:
            continue

        coll_temp = Path(temp_dir) / sanitize_slug(coll_name)
        os.makedirs(coll_temp, exist_ok=True)

        video = build_collection_montage(
            coll_name, items, cat_name, subcat_name, config, str(coll_temp),
            force=force
        )
        if video:
            collection_videos.append((coll_name, video))

    if not collection_videos:
        print(f"  No collection videos built for {subcat_name}, skipping.")
        return None

    # Skip subcategory merge if output already exists
    if not force and output_path.exists():
        print(f"  Skipping subcategory merge: {output_path.name} already exists")
        return str(output_path)

    # Overlay subcategory title on first collection video (lower third - avoids collection title in center)
    first_coll_name, first_coll_video = collection_videos[0]
    title_overlay_path = Path(temp_dir) / f"titled_subcat_{sub_slug}.mp4"
    subtitle = f"{cat_name} Collection"
    overlay_title_on_clip(first_coll_video, subcat_name, subtitle, config, title_overlay_path, position="bottom")

    # Assemble: first collection (with subcategory title overlay) + remaining collections (with divider overlays)
    all_segments = [str(title_overlay_path)]

    for coll_name, coll_video in collection_videos[1:]:
        # Use collection video as-is (no internal divider titles)
        all_segments.append(str(coll_video))

    # Trim collections if total exceeds target
    target = config["subcategory_target_secs"]
    total_dur = sum(get_duration(s, config) for s in all_segments)
    print(f"  Raw subcategory duration: {total_dur:.0f}s (target: {target}s)")

    # Stitch with subcategory-level transitions (fade)
    print(f"  Stitching subcategory with {config['subcategory_transition']} transitions...")
    stitched = Path(temp_dir) / f"stitched_subcat_{sub_slug}.mp4"

    # For subcategory, use concat (simpler for pre-rendered clips)
    result = concat_clips(all_segments, config, stitched)

    if result:
        os.makedirs(out_dir, exist_ok=True)
        shutil.copy2(result, output_path)
        dur = get_duration(str(output_path), config)
        print(f"\n  Subcategory montage saved: {output_path} ({dur:.1f}s)")
        return str(output_path)

    return None


# ─── Build Category Montage ─────────────────────────────────────────────────

def build_category_montage(cat_name, hierarchy, sub_groups, config, temp_dir, force=False):
    """Build category montage by combining subcategory montages (~6 min).
    Skip if output file already exists (delete to rebuild).
    """
    cat_slug = sanitize_slug(cat_name)
    cat_dir = Path(config["output_dir"]) / cat_slug
    output_path = cat_dir / f"{cat_slug}_category.mp4"

    subcategories = hierarchy.get(cat_name, {})
    print(f"\n{'═'*60}")
    print(f"  Building category: {cat_name} ({len(subcategories)} subcategories)")
    print(f"{'═'*60}")

    # Build each subcategory montage (file-exists check inside)
    subcat_videos = []
    for subcat_name in sorted(subcategories.keys()):
        collections = subcategories[subcat_name]
        subcat_temp = Path(temp_dir) / sanitize_slug(subcat_name)
        os.makedirs(subcat_temp, exist_ok=True)

        video = build_subcategory_montage(
            subcat_name, cat_name, collections, sub_groups,
            config, str(subcat_temp), force=force
        )
        if video:
            subcat_videos.append((subcat_name, video))

    if not subcat_videos:
        print(f"  No subcategory videos built for {cat_name}.")
        return None

    # Skip category merge if output already exists
    if not force and output_path.exists():
        print(f"  Skipping category merge: {output_path.name} already exists")
        return str(output_path)

    # Overlay category title on first subcategory video (upper third - avoids other titles)
    first_subcat_name, first_subcat_video = subcat_videos[0]
    title_overlay_path = Path(temp_dir) / f"titled_cat_{cat_slug}.mp4"
    overlay_title_on_clip(first_subcat_video, cat_name, "Stockflow.media", config, title_overlay_path, position="top")

    # Assemble: first subcat (with category title overlay) + remaining subcats (with divider overlays)
    all_segments = [str(title_overlay_path)]

    for subcat_name, subcat_video in subcat_videos[1:]:
        # Use subcategory video as-is (no internal divider titles)
        all_segments.append(str(subcat_video))

    total_dur = sum(get_duration(s, config) for s in all_segments)
    print(f"\n  Raw category duration: {total_dur:.0f}s (target: {config['category_target_secs']}s)")

    # Stitch
    print(f"  Stitching category with concat...")
    stitched = Path(temp_dir) / f"stitched_cat_{cat_slug}.mp4"
    result = concat_clips(all_segments, config, stitched)

    if result:
        os.makedirs(cat_dir, exist_ok=True)
        shutil.copy2(result, output_path)
        dur = get_duration(str(output_path), config)
        print(f"\n  Category montage saved: {output_path} ({dur:.1f}s)")
        return str(output_path)

    return None


# ─── List Available ──────────────────────────────────────────────────────────

def list_available(hierarchy, sub_groups):
    """Print all available categories, subcategories, and collections."""
    print(f"\n{'═'*70}")
    print(f"  Available targets from Google Sheets")
    print(f"{'═'*70}\n")

    print(f"  {'LEVEL':<15} {'NAME':<35} {'ITEMS':>8}")
    print(f"  {'─'*15} {'─'*35} {'─'*8}")

    for cat in sorted(hierarchy.keys()):
        total = sum(len(sub_groups.get(s, [])) for subs in hierarchy[cat].values() for s in subs)
        print(f"  {'CATEGORY':<15} {cat:<35} {total:>8}")

        for subcat in sorted(hierarchy[cat].keys()):
            colls = hierarchy[cat][subcat]
            sub_total = sum(len(sub_groups.get(s, [])) for s in colls)
            print(f"  {'  SUBCATEGORY':<15} {subcat:<35} {sub_total:>8}")

            for coll in sorted(colls):
                items = sub_groups.get(coll, [])
                count = len(items)
                w = len(filter_by_format(items, "16:9"))
                s = len(filter_by_format(items, "1:1"))
                v = len(filter_by_format(items, "9:16"))
                print(f"  {'    COLLECTION':<15} {coll:<35} {w:>2}W {s:>2}S {v:>2}V /{count}")

    print(f"\n  Counts show: W(16:9) S(1:1) V(9:16) / total items")
    print()


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Stockflow Montage Builder",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python montage_builder.py --list
  python montage_builder.py --level collection --name "Chicken Dinner"
  python montage_builder.py --level subcategory --name "Food Menu"
  python montage_builder.py --level category --name "Food & Beverage"
  python montage_builder.py --level collection --all
  python montage_builder.py --level subcategory --all
  python montage_builder.py --level category --all
        """
    )
    parser.add_argument("--level", choices=["collection", "subcategory", "category"],
                        help="Build level")
    parser.add_argument("--name", help="Name of the collection/subcategory/category")
    parser.add_argument("--all", action="store_true",
                        help="Build ALL targets at the given level (skips existing)")
    parser.add_argument("--list", action="store_true", help="List all available targets")
    parser.add_argument("--dry-run", action="store_true",
                        help="Fetch and show plan without building")
    parser.add_argument("--force", action="store_true",
                        help="Rebuild even if output file already exists")
    parser.add_argument("--format", choices=["W", "S", "V", "all"], default="W",
                        help="Aspect ratio: W=16:9, S=1:1, V=9:16, all=build all three (default: W)")

    args = parser.parse_args()

    if not args.list and not args.level:
        parser.print_help()
        return

    if args.level and not args.all and not args.name and not args.list:
        print("  Error: Provide --name or --all")
        return

    # Handle --format all: loop over W, S, V
    if args.format == "all" and args.level:
        for fmt in ["W", "S", "V"]:
            print(f"\n{'#'*60}")
            print(f"  FORMAT: {FORMAT_PRESETS[fmt]['label']}")
            print(f"{'#'*60}")
            # Re-run with each format
            import copy
            saved_format = args.format
            args.format = fmt
            run_build(args)
            args.format = saved_format
        return

    run_build(args)


def run_build(args):
    """Execute the build with a specific format."""
    fmt_key = args.format
    preset = FORMAT_PRESETS[fmt_key]

    # Banner
    print()
    print("+" + "="*60 + "+")
    print(f"  STOCKFLOW MONTAGE BUILDER  [{preset['label']}]")
    print("+" + "="*60 + "+")
    print()

    config = load_config()

    # Apply format preset: override resolution and output_dir
    config["resolution"] = preset["resolution"]
    config["_aspect"] = preset["aspect"]
    config["output_dir"] = str(SCRIPT_DIR / preset["output_suffix"] / "01_Rendered")

    # Phase 1: Fetch
    print_phase(1, 4, "Fetching & filtering data")
    rows = fetch_sheet(config)
    hierarchy, sub_groups, sub_to_cat = build_hierarchy(rows)

    if args.list:
        list_available(hierarchy, sub_groups)
        return

    name = args.name
    level = args.level
    build_all = args.all
    force = args.force

    # ── Build targets list ──
    targets = []  # list of (name, level) tuples for building

    if build_all:
        if level == "collection":
            total = len(sub_groups)
            print(f"  Target: ALL {total} collections")
            for coll_name in sorted(sub_groups.keys()):
                targets.append(("collection", coll_name))
        elif level == "subcategory":
            all_subcats = []
            for cat, subcats in sorted(hierarchy.items()):
                for subcat_name in sorted(subcats.keys()):
                    all_subcats.append((cat, subcat_name))
            print(f"  Target: ALL {len(all_subcats)} subcategories")
            for cat, subcat_name in all_subcats:
                targets.append(("subcategory", subcat_name))
        elif level == "category":
            print(f"  Target: ALL {len(hierarchy)} categories")
            for cat_name in sorted(hierarchy.keys()):
                targets.append(("category", cat_name))
    else:
        # Single target — validate name exists
        if level == "collection":
            if name not in sub_groups:
                print(f"\n  Error: Collection '{name}' not found in sheet data.")
                print(f"  Use --list to see available collections.")
                return
            cat, subcat = sub_to_cat[name]
            items = sub_groups[name]
            aspect = config.get("_aspect", "16:9")
            matched = filter_by_format(items, aspect)
            print(f"  Target: {name} (Collection)")
            print(f"  Parent: {cat} → {subcat}")
            print(f"  Items: {len(matched)} in {aspect} out of {len(items)} total")
            targets.append(("collection", name))

        elif level == "subcategory":
            found_cat = None
            for cat, subcats in hierarchy.items():
                if name in subcats:
                    found_cat = cat
                    break
            if not found_cat:
                print(f"\n  Error: Subcategory '{name}' not found.")
                print(f"  Use --list to see available subcategories.")
                return
            colls = hierarchy[found_cat][name]
            print(f"  Target: {name} (Subcategory)")
            print(f"  Parent: {found_cat}")
            print(f"  Collections: {len(colls)}")
            targets.append(("subcategory", name))

        elif level == "category":
            if name not in hierarchy:
                print(f"\n  Error: Category '{name}' not found.")
                print(f"  Use --list to see available categories.")
                return
            subcats = hierarchy[name]
            total_colls = sum(len(c) for c in subcats.values())
            print(f"  Target: {name} (Category)")
            print(f"  Subcategories: {len(subcats)}")
            print(f"  Total collections: {total_colls}")
            targets.append(("category", name))

    if args.dry_run:
        print(f"\n  [DRY RUN] Would build {len(targets)} target(s). Exiting.")
        return

    # Create temp directory
    temp_base = Path(config["temp_dir"])
    os.makedirs(temp_base, exist_ok=True)

    results = []
    total_targets = len(targets)

    for idx, (target_level, target_name) in enumerate(targets, 1):
        temp_dir = tempfile.mkdtemp(dir=str(temp_base))
        try:
            if build_all:
                print(f"\n{'='*60}")
                print(f"  [{idx}/{total_targets}] {target_name}")
                print(f"{'='*60}")
            else:
                print_phase(2, 4, "Downloading clips from GCS")

            if target_level == "collection":
                cat, subcat = sub_to_cat[target_name]
                if not build_all:
                    print_phase(3, 4, f"Building collection montage: {target_name}")
                result = build_collection_montage(
                    target_name, sub_groups[target_name], cat, subcat,
                    config, temp_dir, force=force
                )

            elif target_level == "subcategory":
                found_cat = None
                for cat, subcats in hierarchy.items():
                    if target_name in subcats:
                        found_cat = cat
                        break
                if not build_all:
                    print_phase(3, 4, f"Building subcategory montage: {target_name}")
                result = build_subcategory_montage(
                    target_name, found_cat, hierarchy[found_cat][target_name],
                    sub_groups, config, temp_dir, force=force
                )

            elif target_level == "category":
                if not build_all:
                    print_phase(3, 4, f"Building category montage: {target_name}")
                result = build_category_montage(
                    target_name, hierarchy, sub_groups, config, temp_dir,
                    force=force
                )

            if result:
                results.append((target_name, result))

        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    # Summary
    if not build_all:
        print_phase(4, 4, "Summary")

    if results:
        if build_all:
            print(f"\n{'='*60}")
            print(f"  BUILD COMPLETE: {len(results)}/{total_targets} succeeded")
            print(f"{'='*60}")
        for target_name, result in results:
            dur = get_duration(result, config)
            size_mb = os.path.getsize(result) / (1024 * 1024)
            if build_all:
                print(f"  ✓ {target_name}: {dur:.1f}s, {size_mb:.1f} MB")
            else:
                print(f"  Output: {result}")
                print(f"  Duration: {dur:.1f}s ({dur/60:.1f} min)")
                print(f"  Size: {size_mb:.1f} MB")
        print(f"\n  Next steps:")
        print(f"    1. run_music.bat     → add background music")
        print(f"    2. run_watermark.bat  → add watermark")
        print(f"    3. Upload to YouTube")
    else:
        print(f"  Build failed. Check errors above.")


if __name__ == "__main__":
    main()
