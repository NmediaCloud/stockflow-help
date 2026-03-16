"""
One-time fix: Rename title-case Drive folders to lowercase slug format.
E.g., "Food Beverage" → "food-beverage", "Food Menu" → "food-menu"

Run: python tools/fix_drive_folders.py
"""

import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = (SCRIPT_DIR / "..").resolve()
MARKETING_DIR = PROJECT_ROOT / "Marketing content"
sys.path.insert(0, str(SCRIPT_DIR))

from upload_to_drive import get_google_creds, DRIVE_ROOT_FOLDER_ID

from googleapiclient.discovery import build


def slugify(name):
    """Convert 'Food Beverage' → 'food-beverage'"""
    return name.lower().replace(" ", "-")


def rename_folders_recursive(drive_service, parent_id, depth=0):
    """Recursively find and rename title-case folders to slug format."""
    query = (
        f"'{parent_id}' in parents "
        f"and mimeType='application/vnd.google-apps.folder' and trashed=false"
    )
    results = drive_service.files().list(
        q=query, fields="files(id, name)", pageSize=100
    ).execute()
    folders = results.get("files", [])

    for folder in folders:
        name = folder["name"]
        folder_id = folder["id"]
        slug = slugify(name)
        indent = "  " * (depth + 1)

        # Skip format folders (W output, S output, V output)
        if name in ("W output", "S output", "V output"):
            print(f"{indent}{name}/ (format folder - keeping as is)")
            rename_folders_recursive(drive_service, folder_id, depth + 1)
            continue

        # Rename if not already slug format
        if name != slug:
            print(f"{indent}{name}/ -> {slug}/")
            drive_service.files().update(
                fileId=folder_id,
                body={"name": slug}
            ).execute()
        else:
            print(f"{indent}{name}/ (already correct)")

        # Recurse into subfolders
        rename_folders_recursive(drive_service, folder_id, depth + 1)


def main():
    print("=== Drive Folder Rename: Title Case -> Slug ===\n")
    print(f"  Root: Stockflow_Media_publish ({DRIVE_ROOT_FOLDER_ID})\n")

    creds = get_google_creds()
    drive_service = build("drive", "v3", credentials=creds)

    rename_folders_recursive(drive_service, DRIVE_ROOT_FOLDER_ID)

    print("\n=== Done ===")


if __name__ == "__main__":
    main()
