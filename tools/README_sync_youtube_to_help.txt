========================================================
  sync_youtube_to_help.py — YouTube Embed Sync Tool
========================================================

PURPOSE
-------
Pulls YouTube video URLs from the Stockflow Publishing Master
spreadsheet (AppScript Upload tab) and injects/updates/removes
YouTube iframe embeds in the local help site markdown files.

This is a LOCAL Python script — it runs on your machine, not
in Google Apps Script. It reads from the sheet and writes to
the docs/ folder of the MkDocs help site.


DATA FLOW
---------
  Google Sheet (AppScript Upload tab)
        |
        | (CSV export via public URL)
        v
  sync_youtube_to_help.py
        |
        | (reads YouTube rows, matches by collection name)
        v
  docs/collections/{slug}.md    (collection pages)
  docs/blog/{slug}-showcase.md  (blog showcase pages)
        |
        v
  deploy.bat  →  live at help.stockflow.media


THREE STATES (per collection)
-----------------------------
  1. Collection has YouTube URL in sheet
     → INJECT or REPLACE iframe in the markdown file

  2. Collection NOT in sheet at all
     → DO NOTHING — leave any existing iframe untouched
     (Safe default: trimming the sheet won't wipe old embeds)

  3. Collection in sheet, Published URL is BLANK
     → REMOVE any existing iframe from the markdown file
     (Intentional delete signal — you must explicitly add
     the row with blank URL to trigger removal)


HOW IT WORKS
------------
1. Fetches the AppScript Upload tab as CSV from Google Sheets
   URL: https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid=2024755580

2. Filters for rows where Platform = "YouTube"

3. For each YouTube row:
   a. Converts collection name to a slug (same logic as sync_stockflow.py):
      "Bacteria" → "bacteria"
      "Blue Green Algae" → "blue-green-algae"

   b. Looks for two files:
      - docs/collections/{slug}.md
      - docs/blog/{slug}-showcase.md

   c. If Published URL exists:
      - Extracts the video ID (e.g., "dQw4w9WgXcQ" from the YouTube URL)
      - If file already has an iframe → replaces the src with new video ID
      - If file has no iframe → injects one after the "Browse on Stockflow.media" button

   d. If Published URL is blank:
      - Removes any existing YouTube iframe from the file
      - Cleans up extra blank lines

4. Prints a summary of what was changed


IFRAME TEMPLATE
---------------
The injected iframe matches the style used by sync_stockflow.py:

  <iframe width="100%" height="450"
    style="max-width: 800px; aspect-ratio: 16/9; border-radius: 8px; margin-bottom: 20px;"
    src="https://www.youtube.com/embed/{video_id}?rel=0"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen></iframe>


USAGE
-----
  # Preview changes (no files modified)
  python tools/sync_youtube_to_help.py --dry-run

  # Apply changes
  python tools/sync_youtube_to_help.py

  # Then deploy
  deploy.bat


WHEN TO RUN
-----------
- After all YouTube uploads are complete for a batch
- After re-uploading/replacing any YouTube video
- After intentionally blanking a Published URL to remove an embed
- Safe to run multiple times — idempotent (same input = same output)


REQUIREMENTS
------------
- Python 3.11+
- No external dependencies (uses only stdlib: csv, re, urllib, pathlib)
- The Google Sheet must be accessible (public or link-shared)
- Run from the project root: D:\Projects\2025\00 Stock Footages\Stockflow-help\


SHEET COLUMNS USED
------------------
From the AppScript Upload tab (gid=2024755580):
  - Platform (col F)     → filters for "YouTube" only
  - Collection (col K)   → matched to help page filename via slug
  - Published URL (col P) → YouTube URL to extract video ID from


FILE LOCATIONS
--------------
  Script:     tools/sync_youtube_to_help.py
  This README: tools/README_sync_youtube_to_help.txt
  Targets:    docs/collections/*.md, docs/blog/*-showcase.md
  Sheet ID:   12wLctBPz5p7MMLwyCdGymVgH_uHfDXL7uZ-TtTwL3_w
  Sheet GID:  2024755580 (AppScript Upload tab)
