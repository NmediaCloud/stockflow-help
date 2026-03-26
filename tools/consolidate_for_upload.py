"""
Consolidate compressed montages into one flat folder with descriptive names.

Reads from:
  W output/04 Compressed for Social media/category/subcategory/collection.mp4
  S output/04 Compressed for Social media/...
  V output/04 Compressed for Social media/...

Outputs to:
  Marketing content/Social_Upload/
    W/Food-Beverage_Food-Menu_Biriyani_W.mp4
    S/Food-Beverage_Food-Menu_Biriyani_S.mp4
    V/Food-Beverage_Food-Menu_Biriyani_V.mp4

Naming: {Category}_{Subcategory}_{Collection}_{Format}.mp4
Spaces replaced with dashes, underscores separate hierarchy levels.

Usage:
  python tools/consolidate_for_upload.py              # consolidate all
  python tools/consolidate_for_upload.py --format W   # only W
  python tools/consolidate_for_upload.py --dry-run    # preview
  python tools/consolidate_for_upload.py --overwrite  # redo all
"""

import os
import sys
import shutil
import time
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────
MARKETING_ROOT = Path("D:/Projects/2025/00 Stock Footages/Stockflow-help/Marketing content")
COMPRESSED_FOLDER_NAME = "04 Compressed for Social media"
OUTPUT_FOLDER = MARKETING_ROOT / "Social_Upload"

FORMAT_FOLDERS = {
    "W": "W output",
    "S": "S output",
    "V": "V output"
}


def build_name_from_path(file_path, compressed_root, format_code):
    """
    Build descriptive filename from folder path.

    Input:  food-beverage/food-menu/biriyani.mp4
    Output: Food Beverage_Food Menu_Biriyani_W.mp4

    Input:  microscopic/algae/blue-green-algae.mp4
    Output: Microscopic_Algae_Blue Green Algae_W.mp4
    """
    relative = file_path.relative_to(compressed_root)
    parts = list(relative.parts)

    # Last part is the filename
    filename_stem = parts[-1].replace(".mp4", "")

    # Remaining parts are category/subcategory folders
    folder_parts = parts[:-1]

    # Convert slug-style to Title-Case-With-Dashes (no spaces)
    def slug_to_title_dash(slug):
        return "-".join(w.capitalize() for w in slug.replace("-", " ").replace("_", " ").split())

    name_parts = [slug_to_title_dash(p) for p in folder_parts]
    name_parts.append(slug_to_title_dash(filename_stem))
    name_parts.append(format_code)

    return "_".join(name_parts) + ".mp4"


def process_format(format_code, dry_run=False, overwrite=False):
    """Consolidate all compressed files for a format."""
    folder_name = FORMAT_FOLDERS[format_code]
    compressed_root = MARKETING_ROOT / folder_name / COMPRESSED_FOLDER_NAME

    if not compressed_root.exists():
        print(f"\n  [{format_code}] No compressed folder found: {compressed_root}")
        return 0, 0

    mp4_files = sorted(compressed_root.rglob("*.mp4"))
    if not mp4_files:
        print(f"\n  [{format_code}] No .mp4 files found")
        return 0, 0

    print(f"\n  [{format_code}] Found {len(mp4_files)} compressed files")

    copied = 0
    skipped = 0

    for i, src_file in enumerate(mp4_files, 1):
        new_name = build_name_from_path(src_file, compressed_root, format_code)
        format_dir = OUTPUT_FOLDER / format_code
        format_dir.mkdir(parents=True, exist_ok=True)
        dest_file = format_dir / new_name

        # Skip if exists and not overwriting
        if not overwrite and dest_file.exists():
            skipped += 1
            continue

        bar_len = 30
        filled = int(bar_len * i / len(mp4_files))
        bar = '#' * filled + '-' * (bar_len - filled)
        pct = int(100 * i / len(mp4_files))

        sys.stdout.write(f'\r  [{bar}] {pct:3d}%  {new_name[:50]:<50}')
        sys.stdout.flush()

        if dry_run:
            if i <= 10:  # Show first 10 examples
                src_size = os.path.getsize(src_file) / (1024 * 1024)
                print(f"\n    [DRY] {src_file.name} -> {new_name} ({src_size:.1f} MB)")
            copied += 1
            continue

        shutil.copy2(src_file, dest_file)
        copied += 1

    print(f"\n  [{format_code}] Copied: {copied} | Skipped: {skipped}")
    return copied, skipped


def main():
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    overwrite = "--overwrite" in args

    format_filter = None
    if "--format" in args:
        idx = args.index("--format")
        if idx + 1 < len(args):
            format_filter = args[idx + 1].upper()

    print("=" * 55)
    print("  Consolidate Compressed Files for Upload")
    print("=" * 55)
    print(f"  Output: {OUTPUT_FOLDER}")

    if dry_run:
        print("  [DRY RUN - no files will be copied]")

    # Create output folder
    if not dry_run:
        OUTPUT_FOLDER.mkdir(parents=True, exist_ok=True)

    # Prompt mode if not specified
    if not dry_run and not overwrite:
        print("\n  Mode:")
        print("    1 = Append (skip existing, add new only)")
        print("    2 = Overwrite (redo all)")
        choice = input("\n  Enter 1 or 2 (default=1): ").strip()
        if choice == "2":
            confirm = input("  This will overwrite existing files. Continue? (y/n): ").strip().lower()
            if confirm != "y":
                print("  Cancelled.")
                return
            overwrite = True

    # Prompt format if not specified
    if not format_filter and not dry_run:
        print("\n  Which format?")
        print("    1 = W (Widescreen)")
        print("    2 = S (Square)")
        print("    3 = V (Vertical)")
        print("    4 = ALL")
        fmt_choice = input("\n  Enter 1-4 (default=4): ").strip()
        fmt_map = {"1": "W", "2": "S", "3": "V"}
        if fmt_choice in fmt_map:
            format_filter = fmt_map[fmt_choice]

    formats = [format_filter] if format_filter else ["W", "S", "V"]
    total_copied = 0
    total_skipped = 0
    start_time = time.time()

    for fmt in formats:
        if fmt not in FORMAT_FOLDERS:
            print(f"\n  Unknown format: {fmt}")
            continue
        c, s = process_format(fmt, dry_run, overwrite)
        total_copied += c
        total_skipped += s

    elapsed = time.time() - start_time

    print(f"\n{'=' * 55}")
    print(f"  {'DRY RUN ' if dry_run else ''}Summary")
    print(f"  Copied:  {total_copied}")
    print(f"  Skipped: {total_skipped}")
    print(f"  Time:    {int(elapsed)}s")

    if not dry_run and total_copied > 0:
        # Count total files in output
        total_files = len(list(OUTPUT_FOLDER.rglob("*.mp4")))
        total_size = sum(f.stat().st_size for f in OUTPUT_FOLDER.rglob("*.mp4")) / (1024 * 1024 * 1024)
        print(f"\n  Social Upload folder: {total_files} files ({total_size:.1f} GB)")
        print(f"  Ready for GCS upload!")


if __name__ == "__main__":
    main()
