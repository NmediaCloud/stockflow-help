========================================================
  Stockflow Publishing System — Apps Script
  README & Operations Guide
========================================================

OVERVIEW
--------
Google Apps Script that automates publishing stock footage
content across multiple platforms from a single Google Sheet.

Script Location: Google Apps Script project "Stockflow Social Media"
Sheet: Stockflow Publishing Master
Account: stockflowmedia@gmail.com
Local backup: tools/apps_script_publisher.js
Version history: tools/apps_script_versions/


========================================================
  ARCHITECTURE
========================================================

  Content Library (source of truth)
        |
        v
  AppScript Upload (derived — one row per collection per platform)
        |
        +--→ YouTube (video upload via API)
        +--→ WordPress (blog post via email)
        +--→ LinkedIn (native video post via API)
        +--→ Reddit (manual checkbox — email reminders optional)
        |
  FeedHive Export S/V/W (CSV for social media scheduler)
        |
        +--→ Instagram, Facebook, TikTok, Pinterest, Twitter


SHEET TABS
----------
| Tab                 | Purpose                                      |
|---------------------|----------------------------------------------|
| Content Library     | Master data — all 739 montages (W/S/V)       |
| AppScript Upload    | Derived — YouTube/WordPress/LinkedIn/Reddit  |
| FeedHive Export (S) | Square format — Instagram, Facebook, etc.    |
| FeedHive Export (V) | Vertical format — TikTok, Pinterest, etc.    |
| FeedHive Export (W) | Widescreen format — Twitter, LinkedIn, etc.  |


========================================================
  APPSCRIPT UPLOAD COLUMNS
========================================================

| Col | Letter | Name           | Purpose                          |
|-----|--------|----------------|----------------------------------|
| 0   | A      | Publish        | Checkbox — triggers upload       |
| 1   | B      | Status         | Uploading.../Uploaded/Failed     |
| 2   | C      | Date           | Scheduled date                   |
| 3   | D      | Day            | Day name (auto)                  |
| 4   | E      | Time           | Scheduled time                   |
| 5   | F      | Platform       | YouTube/WordPress/LinkedIn/Reddit|
| 6   | G      | Phase          | (reserved)                       |
| 7   | H      | Format         | W/S/V                            |
| 8   | I      | Category       | Microscopic / Food Beverage      |
| 9   | J      | Subcategory    | Bacteria / Fungi / etc.          |
| 10  | K      | Collection     | Collection name                  |
| 11  | L      | Drive Link     | Google Drive URL                 |
| 12  | M      | Drive File ID  | Drive file ID for API access     |
| 13  | N      | Help Page URL  | help.stockflow.media page        |
| 14  | O      | Stockflow URL  | stockflow.media deep link        |
| 15  | P      | Published URL  | Live URL after publishing        |
| 16  | Q      | Published At   | Timestamp of publish             |
| 17  | R      | Notes          | Status messages / errors         |


========================================================
  MENU REFERENCE (Stockflow menu)
========================================================

PUBLISHING
  Sync Drive -> Sheet        Scan Drive folders, update Content Library
  Publish Selected           Publish all checked rows
  Publish All Due Now        Publish rows past their scheduled date/time
  Publish Next YouTube       Find and publish next unpublished YouTube row
  Debug Publish (diagnose)   Diagnostic tool
  Audit & Fix Status         Fix mismatched statuses (URL but no "Uploaded")

CALENDAR
  Sync to Calendar           Push sheet rows to Google Calendar events
  Setup Triggers             Install checkbox + hourly + calendar triggers
  Remove Triggers            Remove all project triggers

YOUTUBE
  Check YouTube Quota        Show today's upload count vs daily limit
  Sync Existing YouTube      Match channel videos back to sheet rows
  Make All Videos Public     Set all unlisted videos to public

WORDPRESS
  Preview WordPress Blog     Preview tool
  Test WordPress Connection  Verify WordPress API connection

GENERATORS
  Generate AppScript Upload  Build/append the AppScript Upload tab
  Generate FeedHive (S)      Square format export for FeedHive
  Generate FeedHive (V)      Vertical format export for FeedHive
  Generate FeedHive (W)      Widescreen format export for FeedHive

AUTOMATION
  Configure Auto-Publish     Set per-platform daily limits, intervals, start dates
  View Auto-Publish Status   Show current automation status for all platforms
  Check Script Identity      Show which Google account and YouTube channel is active


========================================================
  DAILY QUOTAS (CONFIG.QUOTAS)
========================================================

| Platform   | Daily Limit | Notes                              |
|------------|-------------|------------------------------------|
| YouTube    | 6           | ~1,600 API units per upload        |
| WordPress  | 6           | Via post-by-email, no hard limit   |
| LinkedIn   | 2           | Algorithm penalizes >2-3/day       |
| Reddit     | 0 (manual)  | Manual checkbox, email reminders   |
| TikTok     | 10          | FeedHive managed                   |
| Instagram  | 10          | FeedHive managed                   |
| Pinterest  | 25          | FeedHive managed                   |
| Twitter    | 15          | FeedHive managed                   |
| Facebook   | 10          | FeedHive managed                   |


========================================================
  AUTO-PUBLISH SYSTEM
========================================================

HOW IT WORKS
  Each platform gets independent automation:
  - Daily limit: how many uploads per day (0 = disabled)
  - Interval: how often the trigger fires (30/60/120 min)
  - Start date: when auto-publishing begins

  The system spreads uploads across trigger intervals.
  Example: 6/day with 60 min interval = ~1 upload per trigger run.

SETUP
  1. Stockflow menu → Configure Auto-Publish
  2. Pick platform (1=YouTube, 2=WordPress, 3=LinkedIn, 4=Reddit)
  3. Set daily limit (0=OFF)
  4. Set interval in minutes
  5. Set start date (YYYY-MM-DD)

DISABLE
  Set daily limit to 0 → trigger is removed, platform stops.

VIEW STATUS
  Stockflow menu → View Auto-Publish Status
  Shows: ON/OFF, today's count vs limit, interval, start date.

SCRIPT PROPERTIES USED
  AUTO_YOUTUBE       JSON config for YouTube automation
  AUTO_WORDPRESS     JSON config for WordPress automation
  AUTO_LINKEDIN      JSON config for LinkedIn automation
  AUTO_REDDIT        JSON config for Reddit automation


========================================================
  REDDIT REMINDER SYSTEM
========================================================

Instead of auto-posting to Reddit (risky for new accounts),
the system sends you email reminders with ready-to-paste content.

TRIGGER
  Fires after each successful WordPress publish.
  Only sends if enough days have passed since last reminder.

EMAIL CONTENTS
  - Copy-paste Reddit title
  - Copy-paste Reddit body (with YouTube link)
  - Target subreddits based on category
  - Clickable submit links (opens Reddit submit page pre-filled)

SCRIPT PROPERTIES
  REDDIT_REMINDER_GAP_DAYS   Days between reminders (default: 3, 0=off)
  REDDIT_REMINDER_EMAIL      Your email address
  REDDIT_LAST_REMINDER       Auto-managed timestamp

GROWTH PLAN
  Week 1-2: Gap = 0 (off) — just build karma by commenting
  Week 3-4: Gap = 3 — one reminder every 3 days
  Month 2+: Gap = 1 — daily posting once karma is established


========================================================
  PLATFORM PUBLISHING DETAILS
========================================================

YOUTUBE
  Method: YouTube Data API v3 (simple upload <50MB, resumable >50MB)
  Auth: OAuth via Apps Script (mine: true)
  Privacy: Public
  Title format: "Collection | Subcategory | Category - 4K Stock Footage"
  Description: Links to stockflow.media and help page
  Tags: Auto-generated from category/subcategory/collection

WORDPRESS
  Method: Post-by-email (MailApp.sendEmail to WP_POST_EMAIL address)
  Content: HTML blog with YouTube embed (WordPress shortcode)
  URL: Predicted from slug + date
  Categories/Tags: Appended via WordPress shortcodes in email body

LINKEDIN
  Method: LinkedIn REST API v2 (native video upload)
  Flow: Initialize upload → chunked upload from Drive → finalize → publish post
  Auth: Developer token (stored in script)
  Requires: LinkedIn Company Page ID

REDDIT
  Method: Reddit API (OAuth2 password grant)
  Post type: Self/text post with YouTube link
  Auth: Client ID + Secret + Username + Password (Script Properties)
  CAUTION: Manual only until karma is established


========================================================
  SCRIPT PROPERTIES REFERENCE
========================================================

| Property                  | Required | Purpose                        |
|---------------------------|----------|--------------------------------|
| WP_APP_PASSWORD           | Yes      | WordPress application password |
| REDDIT_CLIENT_ID          | Later    | Reddit API client ID           |
| REDDIT_CLIENT_SECRET      | Later    | Reddit API client secret       |
| REDDIT_USERNAME           | Later    | Reddit account username        |
| REDDIT_PASSWORD           | Later    | Reddit account password        |
| REDDIT_REMINDER_GAP_DAYS  | Optional | Days between email reminders   |
| REDDIT_REMINDER_EMAIL     | Optional | Email for Reddit reminders     |
| AUTO_YOUTUBE              | Auto     | YouTube automation config      |
| AUTO_WORDPRESS            | Auto     | WordPress automation config    |
| AUTO_LINKEDIN             | Auto     | LinkedIn automation config     |
| AUTO_REDDIT               | Auto     | Reddit automation config       |


========================================================
  APPSSCRIPT.JSON — REQUIRED SCOPES
========================================================

{
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/userinfo.email"
  ]
}


========================================================
  GENERATE APPSCRIPT UPLOAD — APPEND vs TOTAL REFRESH
========================================================

When you run "Generate AppScript Upload Sheet":

  YES = Append
    - Scans Content Library for W format collections
    - Skips collections already in the sheet
    - Adds only NEW collections (× 4 platforms each)
    - Keeps all existing statuses, Published URLs, checkmarks
    - Use this when adding new collections

  NO = Total Refresh
    - Wipes the entire AppScript Upload sheet
    - Rebuilds from scratch using Content Library
    - All statuses and Published URLs are lost
    - Use this only for a complete reset


========================================================
  FEEDHIVE EXPORTS — FRESH vs APPEND
========================================================

Same pattern for FeedHive Export (S), (V), (W):

  YES = Fresh (overwrite existing sheet)
  NO  = Append (keep existing, add new collections only)

Start date prompt:
  - Fresh mode: defaults to tomorrow
  - Append mode: continues from last scheduled date

Smart scheduling:
  - Bottleneck platform determines posts per day
  - Posts spread across optimal time slots per platform


========================================================
  FIRST-TIME SETUP CHECKLIST
========================================================

1. Paste script into Apps Script editor
2. Set appsscript.json with required scopes (see above)
3. Add Script Properties:
   - WP_APP_PASSWORD (WordPress application password)
4. Run: Stockflow → Setup Triggers (authorize when prompted)
5. Run: Stockflow → Check Script Identity (verify YouTube channel)
6. Run: Stockflow → Generate AppScript Upload Sheet → NO (Total Refresh)
7. Delete any Substack rows manually if present
8. Run: Stockflow → Configure Auto-Publish (set YouTube=6, WordPress=6)
9. Set start date for auto-publishing
10. Monitor: Stockflow → View Auto-Publish Status


========================================================
  TESTING CHECKLIST
========================================================

1. Check Script Identity
   → Verify Google account and YouTube channel are correct
   → If wrong channel: revoke at myaccount.google.com/permissions, re-auth

2. Test one WordPress publish
   → Check one WordPress row's checkbox
   → Verify email goes out, blog appears on wordpress.com
   → Confirm predicted URL works

3. Test Configure Auto-Publish dialog
   → Set YouTube to 0 (just test the prompts work)
   → View Auto-Publish Status to confirm it saved

4. Run Audit & Fix Status
   → Clean up orphaned statuses from earlier testing

5. Test one YouTube upload (after channel is confirmed correct)
   → Check one YouTube row's checkbox
   → Verify video appears on correct channel

6. Test Append mode
   → Add a test collection to Content Library
   → Run Generate AppScript Upload → YES (Append)
   → Verify only the new collection was added


========================================================
  TROUBLESHOOTING
========================================================

"Specified permissions are not sufficient"
  → Add missing scope to appsscript.json
  → Revoke app at myaccount.google.com/permissions
  → Re-run any function to trigger fresh auth

YouTube uploading to wrong channel
  → Run Check Script Identity to see which channel
  → Revoke YouTube access at myaccount.google.com/permissions
  → Re-authorize from the correct Google account

WordPress "User cannot publish posts"
  → Verify the account is admin on wordpress.com
  → Check WP_APP_PASSWORD in Script Properties
  → Test with "Test WordPress Connection" menu item

Checkbox doesn't trigger publish
  → Run Setup Triggers (installs installable edit trigger)
  → The old onEdit simple trigger can't call external APIs

Daily quota reached
  → Wait until tomorrow, or increase in CONFIG.QUOTAS
  → View Auto-Publish Status shows today's count


========================================================
  LOCAL FILES
========================================================

| File                                    | Purpose                    |
|-----------------------------------------|----------------------------|
| tools/apps_script_publisher.js          | Main working file (latest) |
| tools/apps_script_versions/             | Version snapshots          |
| tools/apps_script_versions/VERSION_LOG  | Changelog                  |
| tools/sync_youtube_to_help.py           | YouTube URL → help pages   |
| tools/README_apps_script_publisher.txt  | This file                  |
| tools/README_sync_youtube_to_help.txt   | YouTube sync tool docs     |
