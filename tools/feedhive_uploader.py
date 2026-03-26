"""
FeedHive Uploader — Upload posts from CSV via FeedHive MCP API

Reads CSV files from the FeedHive CSV folder and uploads them
to FeedHive using their MCP (Model Context Protocol) API.

Usage:
  python tools/feedhive_uploader.py                    # interactive mode
  python tools/feedhive_uploader.py --list-triggers    # see available triggers
  python tools/feedhive_uploader.py --upload FILE.csv  # upload specific CSV
  python tools/feedhive_uploader.py --dry-run           # preview without uploading
  python tools/feedhive_uploader.py --test-connection   # test API connection

Setup:
  1. Get your FeedHive API key from Settings > Account
  2. Set environment variable: set FEEDHIVE_API_KEY=fh_your_key_here
     Or create a file: tools/.feedhive_key (just the key, one line)

FeedHive MCP Docs: https://docs.feedhive.com/automation-integrations/mcp
"""

import csv
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime

# -- Configuration ----------------------------------------------
SCRIPT_DIR = Path(__file__).parent.resolve()
CSV_FOLDER = (SCRIPT_DIR / "../FeedHive CSV").resolve()
KEY_FILE = SCRIPT_DIR / ".feedhive_key"
MCP_ENDPOINT = "https://mcp.feedhive.com"

# -- API Key Management ----------------------------------------
def get_api_key():
    """Get FeedHive API key from env var or key file."""
    # Try environment variable first
    key = os.environ.get("FEEDHIVE_API_KEY", "").strip()
    if key:
        return key
    # Try key file
    if KEY_FILE.exists():
        key = KEY_FILE.read_text(encoding='utf-8').strip()
        if key:
            return key
    return None


# -- MCP JSON-RPC Client --------------------------------------
def mcp_request(method, params=None, api_key=None):
    """Send a JSON-RPC 2.0 request to FeedHive MCP endpoint."""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method
    }
    if params:
        payload["params"] = params

    data = json.dumps(payload).encode('utf-8')
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + api_key
    }

    req = urllib.request.Request(MCP_ENDPOINT, data=data, headers=headers, method="POST")

    try:
        response = urllib.request.urlopen(req)
        result = json.loads(response.read().decode('utf-8'))
        return result
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8') if e.fp else ""
        print(f"  HTTP Error {e.code}: {e.reason}")
        if error_body:
            print(f"  Response: {error_body[:500]}")
        return {"error": {"code": e.code, "message": e.reason, "body": error_body}}
    except urllib.error.URLError as e:
        print(f"  Connection Error: {e.reason}")
        return {"error": {"code": -1, "message": str(e.reason)}}


def initialize(api_key):
    """Initialize MCP session."""
    return mcp_request("initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {
            "name": "stockflow-feedhive-uploader",
            "version": "1.0.0"
        }
    }, api_key)


def list_triggers(api_key):
    """List all available FeedHive triggers."""
    return mcp_request("tools/list", None, api_key)


def call_trigger(api_key, trigger_name, arguments):
    """Call a specific FeedHive trigger with arguments."""
    return mcp_request("tools/call", {
        "name": trigger_name,
        "arguments": arguments
    }, api_key)


# -- CSV Reader ------------------------------------------------
def read_csv_file(filepath):
    """Read a FeedHive CSV file and return list of post dicts."""
    posts = []
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            post = {
                "text": row.get("Text", "").strip(),
                "title": row.get("Title", "").strip(),
                "media_urls": row.get("Media URLs", "").strip(),
                "labels": row.get("Labels", "").strip(),
                "social_medias": row.get("Social Medias", "").strip(),
                "scheduled": row.get("Scheduled", "").strip()
            }
            if post["text"]:  # skip empty rows
                posts.append(post)
    return posts


def list_csv_files():
    """List all CSV files in the FeedHive CSV folder."""
    if not CSV_FOLDER.exists():
        print(f"CSV folder not found: {CSV_FOLDER}")
        return []
    files = sorted(CSV_FOLDER.glob("*.csv"))
    return files


# -- Upload Logic ----------------------------------------------
def upload_posts(api_key, posts, trigger_name, dry_run=False):
    """Upload posts to FeedHive via MCP trigger."""
    total = len(posts)
    success = 0
    failed = 0

    for i, post in enumerate(posts, 1):
        print(f"\n[{i}/{total}] {post['title'] or post['text'][:50]}...")

        if dry_run:
            print(f"  [DRY RUN] Would upload:")
            print(f"    Text: {post['text'][:80]}...")
            print(f"    Media: {post['media_urls'] or 'none'}")
            print(f"    Social: {post['social_medias'] or 'all'}")
            print(f"    Scheduled: {post['scheduled'] or 'now'}")
            success += 1
            continue

        # Build trigger arguments
        arguments = {
            "text": post["text"]
        }
        if post["media_urls"]:
            arguments["media_urls"] = post["media_urls"]
        if post["social_medias"]:
            arguments["social_medias"] = post["social_medias"]
        if post["scheduled"]:
            arguments["scheduled"] = post["scheduled"]
        if post["labels"]:
            arguments["labels"] = post["labels"]
        if post["title"]:
            arguments["title"] = post["title"]

        result = call_trigger(api_key, trigger_name, arguments)

        if "error" in result:
            print(f"  FAILED: {result['error'].get('message', 'Unknown error')}")
            failed += 1
        elif result.get("result"):
            content = result["result"].get("content", [])
            if content:
                print(f"  SUCCESS: {content[0].get('text', 'Done')}")
            else:
                print(f"  SUCCESS")
            success += 1
        else:
            print(f"  UNKNOWN RESPONSE: {json.dumps(result)[:200]}")
            failed += 1

    return success, failed


# -- Main Flow -------------------------------------------------
def main():
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    test_only = "--test-connection" in args
    list_only = "--list-triggers" in args

    print("=" * 50)
    print("  FeedHive Uploader — Stockflow.media")
    print("=" * 50)

    # Get API key
    api_key = get_api_key()
    if not api_key:
        print("\nNo API key found!")
        print("Set it via:")
        print("  1. Environment variable: set FEEDHIVE_API_KEY=fh_your_key")
        print(f"  2. Key file: {KEY_FILE}")
        key_input = input("\nOr paste your API key now: ").strip()
        if not key_input:
            print("Aborted.")
            return
        api_key = key_input
        # Save for next time
        save = input("Save key for future use? (y/n): ").strip().lower()
        if save == 'y':
            KEY_FILE.write_text(api_key, encoding='utf-8')
            print(f"Saved to {KEY_FILE}")

    if not api_key.startswith("fh_"):
        print(f"\nWarning: API key should start with 'fh_' (yours starts with '{api_key[:3]}...')")

    # Initialize
    print("\nConnecting to FeedHive MCP...")
    init_result = initialize(api_key)
    if "error" in init_result:
        print(f"Connection failed: {init_result['error'].get('message', 'Unknown')}")
        return
    server_info = init_result.get("result", {}).get("serverInfo", {})
    print(f"  Connected: {server_info.get('name', 'FeedHive')} v{server_info.get('version', '?')}")

    if test_only:
        print("\nConnection test passed!")
        return

    # List triggers
    print("\nFetching available triggers...")
    triggers_result = list_triggers(api_key)
    if "error" in triggers_result:
        print(f"Failed to list triggers: {triggers_result['error'].get('message', 'Unknown')}")
        return

    tools = triggers_result.get("result", {}).get("tools", [])
    if not tools:
        print("No triggers found! Set up triggers in FeedHive first:")
        print("  FeedHive → Settings → Automation → Create Trigger")
        return

    print(f"  Found {len(tools)} trigger(s):")
    for i, tool in enumerate(tools, 1):
        print(f"    {i}. {tool['name']}: {tool.get('description', 'No description')}")
        schema = tool.get("inputSchema", {})
        props = schema.get("properties", {})
        if props:
            print(f"       Accepts: {', '.join(props.keys())}")

    if list_only:
        return

    # Select trigger
    if len(tools) == 1:
        selected_trigger = tools[0]["name"]
        print(f"\n  Using trigger: {selected_trigger}")
    else:
        choice = input(f"\nSelect trigger (1-{len(tools)}): ").strip()
        idx = int(choice) - 1
        if idx < 0 or idx >= len(tools):
            print("Invalid choice.")
            return
        selected_trigger = tools[idx]["name"]

    # Find CSV files
    specific_file = None
    for arg in args:
        if arg.startswith("--upload"):
            continue
        if arg.endswith(".csv"):
            specific_file = Path(arg)
            break
    if "--upload" in args:
        idx = args.index("--upload")
        if idx + 1 < len(args):
            specific_file = Path(args[idx + 1])

    if specific_file:
        csv_files = [specific_file]
    else:
        csv_files = list_csv_files()

    if not csv_files:
        print(f"\nNo CSV files found in: {CSV_FOLDER}")
        return

    print(f"\nCSV files found:")
    for i, f in enumerate(csv_files, 1):
        print(f"  {i}. {f.name}")

    if len(csv_files) > 1:
        choice = input(f"\nSelect CSV (1-{len(csv_files)}, or 'all'): ").strip()
        if choice.lower() == 'all':
            selected_files = csv_files
        else:
            idx = int(choice) - 1
            selected_files = [csv_files[idx]]
    else:
        selected_files = csv_files

    # Read and upload
    total_success = 0
    total_failed = 0

    for csv_file in selected_files:
        print(f"\n{'-' * 40}")
        print(f"Processing: {csv_file.name}")
        posts = read_csv_file(csv_file)
        print(f"  Posts found: {len(posts)}")

        if not posts:
            print("  Skipping — no posts in file.")
            continue

        if dry_run:
            print("  [DRY RUN MODE]")

        s, f = upload_posts(api_key, posts, selected_trigger, dry_run)
        total_success += s
        total_failed += f

    # Summary
    print(f"\n{'=' * 50}")
    print(f"{'DRY RUN ' if dry_run else ''}Upload Complete!")
    print(f"  Success: {total_success}")
    print(f"  Failed:  {total_failed}")
    print(f"  Total:   {total_success + total_failed}")


if __name__ == "__main__":
    main()
