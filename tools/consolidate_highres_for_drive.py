"""
Consolidate uncompressed montages from 03_With-music folders
into Stockflow-social/Batch01/Montages-Highres/W/S/V/
with clean dash naming convention.

Source: W output/03_With-music/, S output/03_With-music/, V output/03_With-music/
Output: Stockflow-social/Batch01/Montages-Highres/W/, S/, V/

Naming: food-beverage/food-menu/biriyani.mp4 → Food-Beverage_Food-Menu_Biriyani_W.mp4
"""

import os
import sys
import shutil
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
MARKETING = (SCRIPT_DIR / "../Marketing content").resolve()

FORMATS = ["W", "S", "V"]
OUTPUT_BASE = MARKETING / "Stockflow-social" / "Batch01" / "Montages-Highres"


def title_case_dash(text):
    """Convert 'food-beverage' to 'Food-Beverage'."""
    return "-".join(word.capitalize() for word in text.split("-"))


def build_clean_name(rel_path, fmt):
    """
    Convert relative path to clean name.
    food-beverage/food-menu/biriyani.mp4 → Food-Beverage_Food-Menu_Biriyani_W.mp4
    food-beverage/food-beverage_category.mp4 → Food-Beverage_Food-Beverage-Category_W.mp4
    microscopic/bacteria/bacteria.mp4 → Microscopic_Bacteria_Bacteria_W.mp4
    """
    parts = rel_path.parts
    filename = rel_path.stem  # without .mp4

    if len(parts) == 1:
        # Top level: category file (e.g., food-beverage_category.mp4)
        name = title_case_dash(filename.replace("_", "-"))
        return f"{name}_{fmt}.mp4"
    elif len(parts) == 2:
        # category/file.mp4
        category = title_case_dash(parts[0])
        name = title_case_dash(filename.replace("_", "-"))
        return f"{category}_{name}_{fmt}.mp4"
    elif len(parts) == 3:
        # category/subcategory/file.mp4
        category = title_case_dash(parts[0])
        subcategory = title_case_dash(parts[1])
        name = title_case_dash(filename.replace("_", "-"))
        return f"{category}_{subcategory}_{name}_{fmt}.mp4"
    else:
        # Deeper nesting — join all parent dirs
        dirs = [title_case_dash(p) for p in parts[:-1]]
        name = title_case_dash(filename.replace("_", "-"))
        return "_".join(dirs) + f"_{name}_{fmt}.mp4"


def main():
    mode = "append"
    if "--overwrite" in sys.argv:
        mode = "overwrite"
    if "--dry-run" in sys.argv:
        dry_run = True
    else:
        dry_run = False

    print()
    print("=" * 56)
    print("  STOCKFLOW - Consolidate High-Res for Drive Upload")
    print("=" * 56)
    print()
    print(f"  Mode: {'DRY RUN' if dry_run else mode.upper()}")
    print(f"  Output: {OUTPUT_BASE}")
    print()

    total_copied = 0
    total_skipped = 0
    total_failed = 0

    for fmt in FORMATS:
        src_dir = MARKETING / f"{fmt} output" / "03_With-music"
        out_dir = OUTPUT_BASE / fmt

        if not src_dir.exists():
            print(f"  [{fmt}] Source not found: {src_dir}")
            continue

        # Create output dir
        if not dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)

        # If overwrite, clear the output folder
        if mode == "overwrite" and out_dir.exists() and not dry_run:
            for f in out_dir.glob("*.mp4"):
                f.unlink()
            print(f"  [{fmt}] Cleared output folder")

        # Find all mp4 files
        mp4_files = sorted(src_dir.rglob("*.mp4"))
        if not mp4_files:
            print(f"  [{fmt}] No MP4 files found in {src_dir}")
            continue

        print(f"  [{fmt}] Found {len(mp4_files)} files")
        print(f"  {'─' * 50}")

        for mp4 in mp4_files:
            rel = mp4.relative_to(src_dir)
            new_name = build_clean_name(rel, fmt)
            dest = out_dir / new_name

            # Replace spaces with dashes in final name
            new_name_dashed = new_name.replace(" ", "-")
            dest = out_dir / new_name_dashed

            if dest.exists() and mode == "append":
                total_skipped += 1
                continue

            size_mb = mp4.stat().st_size / (1024 * 1024)
            tag = "[DRY] " if dry_run else ""
            print(f"    {tag}{rel} → {new_name_dashed}  ({size_mb:.1f} MB)")

            if not dry_run:
                try:
                    shutil.copy2(mp4, dest)
                    total_copied += 1
                except Exception as e:
                    print(f"    FAILED: {e}")
                    total_failed += 1
            else:
                total_copied += 1

    print()
    print("=" * 56)
    print(f"  {'DRY RUN ' if dry_run else ''}Summary")
    print(f"  Copied:  {total_copied}")
    print(f"  Skipped: {total_skipped}")
    if total_failed:
        print(f"  Failed:  {total_failed}")
    print("=" * 56)

    # Show counts per format
    if not dry_run:
        print()
        for fmt in FORMATS:
            out_dir = OUTPUT_BASE / fmt
            if out_dir.exists():
                count = len(list(out_dir.glob("*.mp4")))
                print(f"  {fmt}: {count} files")
    print()


if __name__ == "__main__":
    main()
