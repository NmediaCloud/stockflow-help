"""
Preview Clips Pipeline — All-in-one
Downloads preview clips from GCS, adds watermark + music + compress in ONE FFmpeg pass.
Outputs to W/S/V output/02_Social_Clips_from_Preview/ with proper naming.

Usage:
  python tools/preview_clips_pipeline.py              # append mode (skip existing)
  python tools/preview_clips_pipeline.py --overwrite   # re-process everything
  python tools/preview_clips_pipeline.py --dry-run     # preview without processing
  python tools/preview_clips_pipeline.py --limit 10    # process only 10 clips (for testing)
"""

import csv
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = (SCRIPT_DIR / "..").resolve()
MARKETING_DIR = PROJECT_ROOT / "Marketing content"

# Output folders
OUTPUT_DIRS = {
    "W": MARKETING_DIR / "00_Preview_Clips_Social-feed" / "W",
    "S": MARKETING_DIR / "00_Preview_Clips_Social-feed" / "S",
    "V": MARKETING_DIR / "00_Preview_Clips_Social-feed" / "V",
}

# Watermark files
WATERMARKS = {
    "W": MARKETING_DIR / "watermark" / "W.webp",
    "S": MARKETING_DIR / "watermark" / "S.webp",
    "V": MARKETING_DIR / "watermark" / "V.webp",
}

# Music file
MUSIC_FILE = MARKETING_DIR / "music" / "Medical Virus animation.mp3"

# Original data sheet
SHEET_URL = "https://docs.google.com/spreadsheets/d/12eyXAI9-hT0TFSx2HhVDUWHXo4X9QVT-vSPmGQBx6c8/export?format=csv&gid=65282458"

# Temp download folder
TEMP_DIR = MARKETING_DIR / "temp_preview_downloads"

# Compression settings per format
COMPRESS_SETTINGS = {
    "W": {"scale": "1920:1080", "bitrate": "3M"},
    "S": {"scale": "1080:1080", "bitrate": "2.5M"},
    "V": {"scale": "1080:1920", "bitrate": "2.5M"},
}


def progress_bar(current, total, label="", start_time=None):
    bar_len = 30
    filled = int(bar_len * current / total) if total else 0
    bar = '#' * filled + '-' * (bar_len - filled)
    pct = int(100 * current / total) if total else 0
    eta = ''
    if start_time and current > 0:
        elapsed = time.time() - start_time
        remaining = (elapsed / current) * (total - current)
        if remaining > 60:
            eta = f'  ETA: {int(remaining // 60)}m {int(remaining % 60)}s'
        else:
            eta = f'  ETA: {int(remaining)}s'
    sys.stdout.write(f'\r  [{bar}] {pct:3d}%  {label[:40]:<40}{eta:<20}')
    sys.stdout.flush()
    if current == total:
        elapsed = time.time() - start_time if start_time else 0
        print(f'  Done in {int(elapsed)}s')


def sanitize_name(text):
    """Replace spaces with dashes, remove special chars."""
    return re.sub(r'[^a-zA-Z0-9_-]', '', text.replace('&', '').replace('  ', ' ').replace(' ', '-'))


def detect_format(width, height):
    """Detect W/S/V from resolution."""
    if width > height:
        return "W"
    elif width < height:
        return "V"
    else:
        return "S"


def detect_format_from_filename(filename):
    """Try to detect format from preview filename patterns."""
    fn = filename.upper()
    if '_W_' in fn or '_W.' in fn or fn.endswith('_W'):
        return "W"
    elif '_V_' in fn or '_V.' in fn or '_V1_' in fn or '_V2_' in fn:
        return "V"  # Could be V format or version — check resolution later
    elif '_S_' in fn or '_S.' in fn:
        return "S"
    return None


def get_video_duration(filepath):
    """Get video duration in seconds using ffprobe."""
    try:
        cmd = [
            'ffprobe', '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'csv=p=0',
            str(filepath)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return float(result.stdout.strip())
    except Exception:
        pass
    return 10.0  # default 10 seconds


def get_video_resolution(filepath):
    """Get video width and height using ffprobe."""
    try:
        cmd = [
            'ffprobe', '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height',
            '-of', 'csv=p=0',
            str(filepath)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            parts = result.stdout.strip().split(',')
            if len(parts) == 2:
                return int(parts[0]), int(parts[1])
    except Exception:
        pass
    return None, None


def download_file(url, dest_path):
    """Download a file from URL to local path."""
    try:
        # Fix URL: use googleapis.com instead of storage.cloud.google.com
        url = url.replace('storage.cloud.google.com', 'storage.googleapis.com')
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as response:
            with open(dest_path, 'wb') as f:
                f.write(response.read())
        return True
    except Exception as e:
        return False


def process_clip(input_path, output_path, fmt, dry_run=False):
    """
    Single FFmpeg pass: watermark + music + compress.
    Uses CUDA (h264_nvenc) for speed.
    """
    if dry_run:
        return True

    watermark = WATERMARKS.get(fmt)
    settings = COMPRESS_SETTINGS.get(fmt, COMPRESS_SETTINGS["W"])

    # Get input resolution and duration for watermark scaling and audio fade
    width, height = get_video_resolution(input_path)
    if not width or not height:
        return False

    # Get video duration
    duration = get_video_duration(input_path)

    # Build FFmpeg command — single pass
    temp_output = str(output_path) + ".tmp.mp4"

    cmd = ['ffmpeg', '-y', '-i', str(input_path)]

    # Add watermark input
    if watermark and watermark.exists():
        cmd.extend(['-i', str(watermark)])

    # Add music input
    if MUSIC_FILE.exists():
        cmd.extend(['-i', str(MUSIC_FILE)])

    # Build filter complex
    filters = []

    if watermark and watermark.exists():
        # Scale watermark to match video, overlay
        filters.append(f"[1:v]scale={width}:{height}[wm]")
        filters.append(f"[0:v][wm]overlay=0:0,scale={settings['scale']}[vout]")
        video_stream = "[vout]"
    else:
        filters.append(f"[0:v]scale={settings['scale']}[vout]")
        video_stream = "[vout]"

    if MUSIC_FILE.exists():
        # Music: low volume, fade in/out, match video length
        music_idx = 2 if (watermark and watermark.exists()) else 1
        filters.append(f"[{music_idx}:a]volume=-10dB[aout]")
        audio_map = ['-map', '[aout]']
    else:
        audio_map = []

    cmd.extend(['-filter_complex', ';'.join(filters)])
    cmd.extend(['-map', video_stream])
    cmd.extend(audio_map)
    cmd.extend([
        '-c:v', 'h264_nvenc',
        '-preset', 'p5',
        '-tune', 'hq',
        '-b:v', settings['bitrate'],
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-shortest',
        '-movflags', '+faststart',
        temp_output
    ])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode == 0 and os.path.exists(temp_output):
            os.rename(temp_output, str(output_path))
            return True
        else:
            # Cleanup temp
            if os.path.exists(temp_output):
                os.remove(temp_output)
            return False
    except Exception:
        if os.path.exists(temp_output):
            os.remove(temp_output)
        return False


def main():
    dry_run = '--dry-run' in sys.argv
    overwrite = '--overwrite' in sys.argv
    limit = None
    if '--limit' in sys.argv:
        idx = sys.argv.index('--limit')
        if idx + 1 < len(sys.argv):
            limit = int(sys.argv[idx + 1])

    print("=" * 55)
    print("  Preview Clips Pipeline — Download + Watermark + Music + Compress")
    print("=" * 55)
    if dry_run:
        print("  MODE: DRY RUN\n")
    elif overwrite:
        print("  MODE: OVERWRITE\n")
    else:
        print("  MODE: APPEND (skip existing)\n")

    # Create output dirs
    for d in OUTPUT_DIRS.values():
        d.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    # Check prerequisites
    if not MUSIC_FILE.exists():
        print(f"  WARNING: Music file not found: {MUSIC_FILE}")
    for fmt, wm in WATERMARKS.items():
        if not wm.exists():
            print(f"  WARNING: Watermark not found for {fmt}: {wm}")

    # Fetch sheet data
    print("  Fetching original data sheet...")
    req = urllib.request.Request(SHEET_URL, headers={'User-Agent': 'Mozilla/5.0'})
    response = urllib.request.urlopen(req)
    csv_data = response.read().decode('utf-8')
    reader = csv.DictReader(csv_data.splitlines())
    rows = [r for r in reader if r.get('Preview_URL', '').strip().endswith('.mp4')]
    print(f"  Found {len(rows)} MP4 preview clips in sheet")

    if limit:
        rows = rows[:limit]
        print(f"  Limited to {limit} clips for testing")

    # Process clips
    processed = 0
    skipped = 0
    failed = 0
    start_time = time.time()
    total = len(rows)

    for i, row in enumerate(rows):
        file_id = row.get('File_ID', '').strip()
        category = row.get('Category', '').strip()
        cat_sub = row.get('Catagory_Sub', row.get('Category_Sub', '')).strip()
        collection = row.get('Sub', '').strip()
        preview_url = row.get('Preview_URL', '').strip()
        resolution = row.get('Resolution', '').strip()
        assets_format = row.get('Assets Format', row.get('Format', '')).strip()

        if not preview_url or not file_id:
            skipped += 1
            continue

        # Build output filename: Category_Subcategory_Collection_FileID_Format.mp4
        cat_clean = sanitize_name(category)
        sub_clean = sanitize_name(cat_sub)
        coll_clean = sanitize_name(collection)

        # Detect format from filename or resolution
        fmt = detect_format_from_filename(os.path.basename(preview_url))
        if not fmt and resolution:
            parts = resolution.split('x')
            if len(parts) == 2:
                try:
                    w, h = int(parts[0]), int(parts[1])
                    fmt = detect_format(w, h)
                except ValueError:
                    pass
        if not fmt:
            fmt = "W"  # default

        output_name = f"{cat_clean}_{sub_clean}_{coll_clean}_{file_id}_{fmt}.mp4"
        output_path = OUTPUT_DIRS[fmt] / output_name

        # Skip if exists (append mode)
        if not overwrite and output_path.exists():
            skipped += 1
            progress_bar(i + 1, total, f"skip: {output_name[:35]}", start_time)
            continue

        progress_bar(i + 1, total, f"{output_name[:35]}", start_time)

        if dry_run:
            processed += 1
            continue

        # Download preview clip to temp
        temp_file = TEMP_DIR / f"temp_{file_id}.mp4"
        if not download_file(preview_url, temp_file):
            failed += 1
            continue

        # If format detection was from filename, verify with actual resolution
        if temp_file.exists():
            w, h = get_video_resolution(temp_file)
            if w and h:
                actual_fmt = detect_format(w, h)
                if actual_fmt != fmt:
                    # Re-route to correct format folder
                    fmt = actual_fmt
                    output_name = f"{cat_clean}_{sub_clean}_{coll_clean}_{file_id}_{fmt}.mp4"
                    output_path = OUTPUT_DIRS[fmt] / output_name
                    if not overwrite and output_path.exists():
                        skipped += 1
                        temp_file.unlink()
                        continue

        # Process: watermark + music + compress in one pass
        success = process_clip(temp_file, output_path, fmt, dry_run)

        if success:
            processed += 1
        else:
            failed += 1

        # Cleanup temp
        if temp_file.exists():
            temp_file.unlink()

    progress_bar(total, total, "Complete", start_time)

    # Cleanup temp dir
    if TEMP_DIR.exists() and not any(TEMP_DIR.iterdir()):
        TEMP_DIR.rmdir()

    # Summary
    print(f"\n{'=' * 55}")
    print(f"  Pipeline Complete!")
    print(f"  Processed: {processed}")
    print(f"  Skipped:   {skipped}")
    print(f"  Failed:    {failed}")
    print(f"  Total:     {total}")
    for fmt, d in OUTPUT_DIRS.items():
        count = len(list(d.glob('*.mp4'))) if d.exists() else 0
        print(f"  {fmt} clips: {count}")
    print(f"{'=' * 55}")


if __name__ == "__main__":
    main()
