========================================================
  FeedHive MCP Integration — Future Reference
========================================================
  Status: SAVED FOR LATER (not yet implemented)
  Source: https://docs.feedhive.com/automation-integrations/mcp
  Saved: 2026-03-18

PURPOSE
-------
FeedHive has an MCP (Model Context Protocol) API that allows
direct posting via API instead of CSV export → manual import.

This would replace the current workflow:
  CURRENT:  Generate FeedHive CSV → Download → Import into FeedHive
  FUTURE:   Apps Script calls FeedHive API → posts auto-published

WHEN TO IMPLEMENT
-----------------
Once the CSV workflow feels too manual, or when you want full
automation without touching FeedHive's web UI.


========================================================
  TECHNICAL DETAILS
========================================================

ENDPOINT
  https://mcp.feedhive.com

AUTHENTICATION
  Header: Authorization: Bearer fh_your_api_key_here
  Get key: FeedHive → Settings → Account → API Key
  Key prefix: must start with "fh_"

PROTOCOL
  JSON-RPC 2.0 over HTTPS POST


========================================================
  API METHODS
========================================================

1. INITIALIZE (start session)
   Request:
   {
     "jsonrpc": "2.0",
     "id": 1,
     "method": "initialize",
     "params": {
       "protocolVersion": "2024-11-05",
       "capabilities": {},
       "clientInfo": { "name": "stockflow-publisher", "version": "1.0.0" }
     }
   }

2. TOOLS/LIST (get available triggers)
   Request:
   {
     "jsonrpc": "2.0",
     "id": 2,
     "method": "tools/list"
   }

   Response includes all configured triggers as tools:
   - name: "trigger_{triggerId}"
   - description: from trigger config
   - inputSchema: dynamic per trigger (text, imageUrl, etc.)

3. TOOLS/CALL (fire a trigger)
   Request:
   {
     "jsonrpc": "2.0",
     "id": 3,
     "method": "tools/call",
     "params": {
       "name": "trigger_abc123",
       "arguments": {
         "text": "Post content here",
         "imageUrl": "https://example.com/image.png"
       }
     }
   }


========================================================
  INTEGRATION PLAN (when ready)
========================================================

OPTION A: From Apps Script
  - Add uploadToFeedHive() function in apps_script_publisher.js
  - Store FeedHive API key in Script Properties
  - Use UrlFetchApp.fetch() to call the MCP endpoint
  - Add "FeedHive" as a platform in publishRow() switch

OPTION B: From Local Python
  - Create tools/publish_to_feedhive.py
  - Read from AppScript Upload sheet (same as sync_youtube_to_help.py)
  - Post directly to FeedHive for each platform (Instagram, TikTok, etc.)

RECOMMENDED: Option B (separate script) — keeps publisher clean
  NOTE: User prefers FeedHive as a SEPARATE script, not mixed into
  apps_script_publisher.js. Either a standalone Apps Script project
  or a local Python script (tools/feedhive_publisher.py).

SETUP STEPS (when ready):
  1. Create triggers in FeedHive for each platform (Instagram, TikTok, etc.)
  2. Get API key from FeedHive Settings → Account
  3. Store as Script Property: FEEDHIVE_API_KEY
  4. List triggers to get trigger IDs
  5. Map: Instagram → trigger_xxx, TikTok → trigger_yyy, etc.
  6. Build uploadToFeedHive(platform, text, mediaUrl)
  7. Add to publishRow() switch case


========================================================
  ERROR CODES
========================================================
  -32700  Parse error (malformed JSON)
  -32600  Invalid request (missing JSON-RPC fields)
  -32601  Method not found
  -32602  Invalid params (missing required fields)
  -32603  Internal error (execution failure)
  401     Unauthorized (bad/missing API key)


========================================================
  PLATFORMS VIA FEEDHIVE
========================================================
  Current CSV export covers:
  - Instagram (S format)
  - Facebook (S format)
  - TikTok (V format)
  - Pinterest (V format)
  - Twitter (W format)
  - LinkedIn (W format — also direct via Apps Script)

  All of these could be posted via MCP triggers instead of CSV.


========================================================
  NOTES
========================================================
  - Triggers must be configured in FeedHive web UI first
  - Each trigger maps to one platform/action
  - Input schema is dynamic — check tools/list for required fields
  - Media URLs must be publicly accessible (Drive download links work)
  - Rate limits: check FeedHive plan limits per platform
