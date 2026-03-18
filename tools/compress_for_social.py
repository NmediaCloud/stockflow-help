"""
Compress montage videos for social media upload.

Reads .mp4 files from W output/03_With-music, S output/03_With-music, V output/03_With-music,
compresses them and saves to "04 Compressed for Social media" subfolder
inside each output folder, preserving the folder tree.

Features:
  - CUDA (NVENC) hardware acceleration when available, CPU fallback
  - Append mode (skip existing) or Overwrite mode (redo all)
  - Interactive prompt at startup

Usage:
  python tools/compress_for_social.py                # interactive mode
  python tools/compress_for_social.py --format W     # only W format
  python tools/compress_for_social.py --dry-run      # preview without compressing

Requires: FFmpeg in PATH (with NVENC support for CUDA acceleration)
"""

import os
import sys
import subprocess
import shutil
import time
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
MARKETING_ROOT = Path("D:/Projects/2025/00 Stock Footages/Stockflow-help/Marketing content")
COMPRESSED_FOLDER_NAME = "04 Compressed for Social media"
SOURCE_SUBFOLDER = "03_With-music"

# Format-specific compression settings
COMPRESS_SETTINGS = {
    "W": {
        "folder": "W output",
        "resolution": "1920:1080",
        "bitrate": "4M",
        "maxrate": "5M",
        "bufsize": "8M",
        "crf": 28,       # CPU CRF
        "cq": 28,        # NVENC constant quality
    },
    "S": {
        "folder": "S output",
        "resolution": "1080:1080",
        "bitrate": "3M",
        "maxrate": "4M",
        "bufsize": "6M",
        "crf": 28,
        "cq": 28,
    },
    "V": {
        "folder": "V output",
        "resolution": "1080:1920",
        "bitrate": "3M",
        "maxrate": "4M",
        "bufsize": "6M",
        "crf": 28,
        "cq": 28,
    }
}


def check_ffmpeg():
    """Verify FFmpeg is available."""
    try:
        result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
        return result.returncode == 0
    except FileNotFoundError:
        return False


def check_cuda():
    """Check if NVENC (CUDA) hardware encoding is available."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True, text=True
        )
        return "h264_nvenc" in result.stdout
    except Exception:
        return False


def get_file_size_mb(filepath):
    """Get file size in MB."""
    return os.path.getsize(filepath) / (1024 * 1024)


def compress_video(input_path, output_path, settings, use_cuda=False):
    """Compress a single video using FFmpeg with CUDA or CPU."""
    scale_filter = f"scale={settings['resolution']}:force_original_aspect_ratio=decrease,pad={settings['resolution']}:(ow-iw)/2:(oh-ih)/2"

    if use_cuda:
        # NVENC hardware encoding — much faster
        cmd = [
            "ffmpeg",
            "-hwaccel", "cuda",
            "-hwaccel_output_format", "cuda",
            "-i", str(input_path),
            "-vf", f"hwdownload,format=nv12,{scale_filter},hwupload_cuda",
            "-c:v", "h264_nvenc",
            "-preset", "p4",           # balanced speed/quality
            "-rc", "vbr",
            "-cq", str(settings["cq"]),
            "-b:v", settings["bitrate"],
            "-maxrate", settings["maxrate"],
            "-bufsize", settings["bufsize"],
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            "-y",
            str(output_path)
        ]
    else:
        # CPU encoding — slower but universal
        cmd = [
            "ffmpeg",
            "-i", str(input_path),
            "-vf", scale_filter,
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", str(settings["crf"]),
            "-b:v", settings["bitrate"],
            "-maxrate", settings["maxrate"],
            "-bufsize", settings["bufsize"],
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            "-y",
            str(output_path)
        ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600
        )
        # If CUDA failed, retry with CPU
        if result.returncode != 0 and use_cuda:
            return compress_video(input_path, output_path, settings, use_cuda=False)
        return result.returncode == 0, result.stderr
    except subprocess.TimeoutExpired:
        return False, "Timeout (>10 min)"
    except Exception as e:
        return False, str(e)


def find_source_folder(format_code):
    """Find the 03_With-music folder for a given format."""
    settings = COMPRESS_SETTINGS[format_code]
    folder_name = settings["folder"]

    # Primary: Marketing content / W output / 03_With-music
    source_with_music = MARKETING_ROOT / folder_name / SOURCE_SUBFOLDER
    if source_with_music.exists():
        return source_with_music

    # Fallback: Marketing content / W output (root level .mp4s)
    source_root = MARKETING_ROOT / folder_name
    if source_root.exists():
        return source_root

    return None


def process_format(format_code, mode="append", dry_run=False, use_cuda=False):
    """Process all videos for a given format."""
    settings = COMPRESS_SETTINGS[format_code]
    source_folder = find_source_folder(format_code)

    if not source_folder:
        print(f"\n  [{format_code}] Source folder not found")
        print(f"  Looked for: {MARKETING_ROOT / settings['folder'] / SOURCE_SUBFOLDER}")
        return 0, 0, 0

    # Output goes inside the format's output folder (not inside 03_With-music)
    output_base = MARKETING_ROOT / settings["folder"] / COMPRESSED_FOLDER_NAME

    encoder = "CUDA/NVENC" if use_cuda else "CPU/x264"
    print(f"\n  [{format_code}] Source: {source_folder}")
    print(f"  Output: {output_base}")
    print(f"  Encoder: {encoder} | Resolution: {settings['resolution']} | Bitrate: {settings['bitrate']}")

    # Handle overwrite mode
    if mode == "overwrite" and output_base.exists() and not dry_run:
        print(f"  Clearing existing compressed files...")
        shutil.rmtree(output_base)

    # Find all .mp4 files recursively
    mp4_files = sorted(source_folder.rglob("*.mp4"))

    # Exclude files already in compressed folders
    mp4_files = [f for f in mp4_files if COMPRESSED_FOLDER_NAME not in str(f)]

    if not mp4_files:
        print(f"  No .mp4 files found.")
        return 0, 0, 0

    print(f"  Found {len(mp4_files)} videos")

    compressed = 0
    skipped = 0
    failed = 0
    total_input_size = 0
    total_output_size = 0
    start_time = time.time()

    for i, input_file in enumerate(mp4_files, 1):
        # Build output path preserving subfolder structure
        relative = input_file.relative_to(source_folder)
        output_dir = output_base / relative.parent
        output_file = output_dir / relative.name

        # Skip if already exists (append mode)
        if mode == "append" and output_file.exists():
            skipped += 1
            continue

        input_size = get_file_size_mb(input_file)
        total_input_size += input_size

        # Progress bar
        elapsed = time.time() - start_time
        eta = ""
        if compressed > 0:
            avg_time = elapsed / compressed
            remaining = avg_time * (len(mp4_files) - i)
            if remaining > 60:
                eta = f"  ETA: {int(remaining/60)}m {int(remaining%60)}s"
            else:
                eta = f"  ETA: {int(remaining)}s"

        bar_len = 30
        filled = int(bar_len * i / len(mp4_files))
        bar = '#' * filled + '-' * (bar_len - filled)
        pct = int(100 * i / len(mp4_files))

        sys.stdout.write(f'\r  [{bar}] {pct:3d}%  {relative.name[:35]:<35} {input_size:6.1f}MB{eta:<20}')
        sys.stdout.flush()

        if dry_run:
            compressed += 1
            continue

        # Create output directory
        output_dir.mkdir(parents=True, exist_ok=True)

        success, error = compress_video(input_file, output_file, settings, use_cuda)

        if success and output_file.exists():
            output_size = get_file_size_mb(output_file)
            total_output_size += output_size
            reduction = ((input_size - output_size) / input_size * 100) if input_size > 0 else 0
            compressed += 1
        else:
            failed += 1
            print(f"\n    FAILED: {relative.name}")
            if error:
                last_line = error.strip().split('\n')[-1]
                print(f"    {last_line[:100]}")

    elapsed = time.time() - start_time
    print(f"\n  Done in {int(elapsed)}s — Compressed: {compressed} | Skipped: {skipped} | Failed: {failed}")

    if total_input_size > 0 and total_output_size > 0:
        reduction = ((total_input_size - total_output_size) / total_input_size * 100)
        print(f"  Size: {total_input_size:.0f} MB → {total_output_size:.0f} MB ({reduction:.0f}% reduction)")

    return compressed, skipped, failed


def prompt_mode():
    """Ask user for append or overwrite mode."""
    print("\n  Choose mode:")
    print("    1 = Append (skip existing, compress new only)")
    print("    2 = Overwrite (delete existing, redo all)")
    print()
    choice = input("  Enter 1 or 2 (default=1): ").strip()
    if choice == "2":
        confirm = input("  This will DELETE all existing compressed files. Continue? (y/n): ").strip().lower()
        if confirm != "y":
            print("  Cancelled.")
            return None
        return "overwrite"
    return "append"


def main():
    args = sys.argv[1:]
    dry_run = "--dry-run" in args

    # Parse format filter
    format_filter = None
    if "--format" in args:
        idx = args.index("--format")
        if idx + 1 < len(args):
            format_filter = args[idx + 1].upper()

    print("=" * 55)
    print("  Compress Montages for Social Media")
    print("=" * 55)

    if dry_run:
        print("  [DRY RUN — no files will be compressed]")

    # Check FFmpeg
    if not dry_run and not check_ffmpeg():
        print("\n  FFmpeg not found! Install it or add to PATH.")
        print("  Download: https://ffmpeg.org/download.html")
        return

    # Check CUDA
    use_cuda = check_cuda()
    if use_cuda:
        print("  CUDA/NVENC detected — using GPU acceleration")
    else:
        print("  CUDA not available — using CPU encoding")

    # Prompt format if not specified
    if not format_filter and not dry_run:
        print("\n  Which format to compress?")
        print("    1 = W (Widescreen 16:9)")
        print("    2 = S (Square 1:1)")
        print("    3 = V (Vertical 9:16)")
        print("    4 = ALL")
        fmt_choice = input("\n  Enter 1-4 (default=4): ").strip()
        fmt_map = {"1": "W", "2": "S", "3": "V"}
        if fmt_choice in fmt_map:
            format_filter = fmt_map[fmt_choice]

    # Prompt mode
    if not dry_run:
        mode = prompt_mode()
        if mode is None:
            return
    else:
        mode = "append"

    formats = [format_filter] if format_filter else ["W", "S", "V"]
    total_compressed = 0
    total_skipped = 0
    total_failed = 0

    for fmt in formats:
        if fmt not in COMPRESS_SETTINGS:
            print(f"\n  Unknown format: {fmt}")
            continue
        c, s, f = process_format(fmt, mode, dry_run, use_cuda)
        total_compressed += c
        total_skipped += s
        total_failed += f

    print(f"\n{'=' * 55}")
    print(f"  {'DRY RUN ' if dry_run else ''}Summary")
    print(f"  Compressed: {total_compressed}")
    print(f"  Skipped:    {total_skipped}")
    print(f"  Failed:     {total_failed}")

    if not dry_run and total_compressed > 0:
        print(f"\n  Compressed files saved to '{COMPRESSED_FOLDER_NAME}/'")
        print(f"  inside each format output folder.")
        print(f"\n  Next: Upload to Drive → Update Content Library → Regenerate FeedHive CSVs")


if __name__ == "__main__":
    main()
