"""Stockflow unified control panel.

Reads pipeline state from the filesystem + the public sheet CSV and lets you
sequentially run the existing .bat files. Calls bats via subprocess so all
existing prompts/colors/pauses behave exactly as before.
"""
from __future__ import annotations

import csv
import io
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt
from rich.table import Table

ROOT = Path(__file__).resolve().parent.parent
MC = ROOT / "Marketing content"
DOCS = ROOT / "docs"
TRACKER = ROOT / "tools" / "drive_upload_tracker.json"
SHEET_ID = "12wLctBPz5p7MMLwyCdGymVgH_uHfDXL7uZ-TtTwL3_w"
SHEET_GID = "2024755580"  # AppScript Upload tab
SHEET_CSV = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={SHEET_GID}"

STAGES = {
    "01_Rendered": "Rendered",
    "02_Watermarked": "Watermarked",
    "03_With-music": "Music",
    "04 Compressed for Social media": "Compressed",
}

console = Console()


def count_mp4s(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for _ in path.rglob("*.mp4"))


def stage_counts(fmt: str) -> dict[str, int]:
    base = MC / f"{fmt} output"
    return {label: count_mp4s(base / folder) for folder, label in STAGES.items()}


def consolidated_count() -> int:
    """mp4s under Stockflow-social/*/Montages (ready for Drive upload)."""
    base = MC / "Stockflow-social"
    if not base.exists():
        return 0
    return sum(count_mp4s(b / "Montages") for b in base.iterdir() if b.is_dir())


def drive_uploaded_count() -> int:
    if not TRACKER.exists():
        return 0
    try:
        return len(json.loads(TRACKER.read_text()).get("uploaded_files", {}))
    except Exception:
        return 0


def fetch_sheet() -> list[dict] | None:
    try:
        with urllib.request.urlopen(SHEET_CSV, timeout=10) as r:
            text = r.read().decode("utf-8", errors="replace")
        return list(csv.DictReader(io.StringIO(text)))
    except Exception as e:
        console.print(f"[yellow]Could not fetch sheet ({e}). Sheet stats unavailable.[/]")
        return None


def youtube_pending(rows: list[dict] | None) -> tuple[int, int]:
    """Returns (yt_rows_with_url, yt_rows_blank)."""
    if not rows:
        return (0, 0)
    yt = [r for r in rows if (r.get("Platform") or "").strip().lower() == "youtube"]
    with_url = sum(1 for r in yt if (r.get("Published URL") or "").strip())
    blank = len(yt) - with_url
    return (with_url, blank)


def docs_collection_count() -> int:
    d = DOCS / "collections"
    return len(list(d.glob("*.md"))) if d.exists() else 0


def sheet_collections(rows: list[dict] | None) -> set[str]:
    if not rows:
        return set()
    return {(r.get("Collection") or "").strip() for r in rows if (r.get("Collection") or "").strip()}


def drive_w_count() -> int:
    """W-format files uploaded to Drive (per tracker)."""
    if not TRACKER.exists():
        return 0
    try:
        files = json.loads(TRACKER.read_text()).get("uploaded_files", {})
        return sum(1 for k, v in files.items() if v.get("format") == "W")
    except Exception:
        return 0


def consolidated_w_count() -> int:
    """W-format mp4s in Stockflow-social/*/Montages/W/."""
    base = MC / "Stockflow-social"
    if not base.exists():
        return 0
    n = 0
    for batch in base.iterdir():
        w_dir = batch / "Montages" / "W"
        if w_dir.exists():
            n += count_mp4s(w_dir)
    return n


def docs_iframe_count() -> int:
    """Count collection/blog md files containing a YouTube iframe."""
    n = 0
    for sub in ("collections", "blog"):
        d = DOCS / sub
        if not d.exists():
            continue
        for md in d.glob("*.md"):
            try:
                if "youtube.com/embed/" in md.read_text(encoding="utf-8", errors="ignore"):
                    n += 1
            except Exception:
                pass
    return n


def git_dirty_count() -> int:
    try:
        out = subprocess.check_output(
            ["git", "status", "--porcelain"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
        )
        return sum(1 for line in out.splitlines() if line.strip())
    except Exception:
        return -1


def cname_ok() -> bool:
    p = DOCS / "CNAME"
    return p.exists() and "stockflow.media" in p.read_text(encoding="utf-8", errors="ignore")


# ----- next-step heuristic -----------------------------------------------------

def suggest_next(state: dict) -> str:
    if state["new_in_sheet"] > 0:
        return "1"
    if state["need_montage"] > 0:
        return "4"
    w = state["W"]
    if w["Rendered"] > w["Watermarked"]:
        return "5"
    if w["Watermarked"] > w["Music"]:
        return "6"
    if w["Music"] > w["Compressed"]:
        return "7"
    if state["need_consolidate"] > 0:
        return "8"
    if state["need_drive"] > 0:
        return "12"
    if state["need_iframe"] > 0:
        return "2"
    if state["git_dirty"] > 0:
        return "3"
    return "-"


# ----- rendering --------------------------------------------------------------

def render(state: dict) -> None:
    console.clear()
    console.print(
        Panel.fit(
            "[bold cyan]STOCKFLOW[/] - Master Control Panel",
            border_style="cyan",
        )
    )

    # What's new (delta-based, the actionable view)
    n = Table(title="What's new (pending work)", header_style="bold")
    n.add_column("Delta"); n.add_column("Count", justify="right"); n.add_column("Next step")
    deltas = [
        ("New collections in sheet (no md page yet)", state["new_in_sheet"], "01_A sync"),
        ("md pages without rendered montage (W)",     state["need_montage"],  "02_1 build"),
        ("Compressed but not consolidated",           state["need_consolidate"], "02_5 consolidate"),
        ("Consolidated but not on Drive (W)",         state["need_drive"],    "03_B Drive upload"),
        ("On Drive, awaiting Apps Script -> YT",      state["in_flight"],     "(wait)"),
        ("YT URLs not yet in help md",                state["need_iframe"],   "01_C inject"),
        ("Uncommitted files",                         state["git_dirty"],     "01_B deploy"),
    ]
    for label, count, step in deltas:
        style = "green" if count == 0 else ("yellow" if step.startswith("(") else "bold red")
        n.add_row(label, f"[{style}]{count}[/]", step)
    console.print(n)

    # Pipeline counts
    t = Table(title="Montage pipeline (mp4 counts per stage)", header_style="bold")
    t.add_column("Format")
    for label in STAGES.values():
        t.add_column(label, justify="right")
    t.add_column("Consolidated", justify="right")
    for fmt in ("W", "S", "V"):
        s = state[fmt]
        row = [fmt] + [str(s[lbl]) for lbl in STAGES.values()]
        # consolidated is shared across formats; only show against W
        row.append(str(state["consolidated"]) if fmt == "W" else "")
        t.add_row(*row)
    console.print(t)

    # Help/cloud status
    s = Table(title="Help site + cloud status", header_style="bold")
    s.add_column("Signal"); s.add_column("Value", justify="right")
    s.add_row("Drive uploads (tracker)", str(state["drive_uploaded"]))
    yt_url, yt_blank = state["yt_with_url"], state["yt_blank"]
    s.add_row("YouTube rows w/ Published URL", str(yt_url))
    s.add_row("YouTube rows pending (blank URL)", str(yt_blank))
    s.add_row("Help md files w/ iframe", str(state["docs_iframes"]))
    s.add_row("Iframe injection pending", str(max(0, yt_url - state["docs_iframes"])))
    s.add_row("Uncommitted files", str(state["git_dirty"]))
    s.add_row("CNAME present", "[green]yes[/]" if state["cname"] else "[red]MISSING[/]")
    console.print(s)

    # Menu
    m = Table(title="Steps", show_header=False, box=None)
    m.add_column("key", style="bold cyan"); m.add_column("desc")
    m.add_row("-- HELP (01) --", "")
    m.add_row("1", "01_A  Sync sheets -> markdown")
    m.add_row("2", "01_C  Inject YouTube iframes")
    m.add_row("3", "01_B  Commit + deploy to gh-pages")
    m.add_row("-- MONTAGE (02) --", "")
    m.add_row("4", "02_1  Build montages (interactive)")
    m.add_row("5", "02_2  Watermark")
    m.add_row("6", "02_3  Add music")
    m.add_row("7", "02_4  Compress for social")
    m.add_row("8", "02_5  Consolidate for upload")
    m.add_row("9", "02_6  Upload to GCS  (marketplace previews)")
    m.add_row("-- DISTRIBUTION (03) --", "")
    m.add_row("10", "02_3B Hi-res consolidate (Drive)")
    m.add_row("11", "03_A  Preview clips pipeline")
    m.add_row("12", "03_B  Upload to Drive (Apps Script picks up)")
    m.add_row("-- MACROS --", "")
    m.add_row("M1", "Push new montages: 02_2 -> 02_3 -> 02_4 -> 02_5 -> 03_B")
    m.add_row("M2", "Refresh help after Apps Script: 01_A -> 01_C -> 01_B")
    m.add_row("M3", "Marketplace previews: 02_6")
    m.add_row("R", "Refresh status")
    m.add_row("Q", "Quit")
    console.print(m)

    nxt = suggest_next(state)
    console.print(f"\n[bold]Next suggested:[/] [bold green]{nxt}[/]\n")


# ----- step runner ------------------------------------------------------------

# Direct Python invocations for non-interactive steps (skips the bat's trailing pause).
# Interactive steps (02_1 menu, 02_3 music prompt, 03_A append/overwrite) keep the bat.
DIRECT = {
    "1":  ["python", "tools/sync_stockflow.py"],
    "2":  ["python", "tools/sync_youtube_to_help.py"],
    "7":  ["python", "tools/compress_for_social.py", "--skip-existing"],
    "8":  ["python", "tools/consolidate_for_upload.py"],
    "9":  ["python", "tools/upload_to_gcs.py"],
    "10": ["python", "tools/consolidate_highres_for_drive.py"],
    "12": ["python", "tools/upload_to_drive_batch.py"],
}

BAT = {
    "1":  "01_A_Help_html_sync_Sheets.bat",
    "2":  "01_C_sync_youtube_to_help_after Appscritp Ytube upload.bat",
    "3":  "01_B_Help_Deploy after Sync, Publish.bat",
    "4":  "02_1_Montage_Creation.bat",
    "5":  "02_2_Montage_watermark.bat",
    "6":  "02_3_Montage_music.bat",
    "7":  "02_4_Compress_for_social.bat",
    "8":  "02_5_consolidate_for_upload.bat",
    "9":  "02_6_upload_to_gcs.bat",
    "10": "02_3B_Montage_Highres_Consolidate_Local.bat",
    "11": "03_A_Preview_clips_Creation_pipeline.bat",
    "12": "03_B_Upload_drive_for Appscript_upload.bat",
}

MACROS = {
    "M1": ["5", "6", "7", "8", "12"],
    "M2": ["1", "2", "3"],
    "M3": ["9"],
}


def run_bat(key: str) -> int:
    if key in DIRECT:
        cmd = DIRECT[key]
        console.print(f"\n[bold cyan]>> {' '.join(cmd)}[/]\n")
        return subprocess.call(cmd, cwd=ROOT)
    bat = ROOT / BAT[key]
    if not bat.exists():
        console.print(f"[red]Missing: {bat.name}[/]")
        return 1
    console.print(f"\n[bold cyan]>> Running {bat.name}[/]\n")
    return subprocess.call(["cmd", "/c", str(bat)], cwd=ROOT)


def run_macro(name: str) -> None:
    seq = MACROS[name]
    console.print(f"\n[bold]Macro {name}:[/] {' -> '.join(BAT[k] for k in seq)}")
    if Prompt.ask("Proceed?", choices=["y", "n"], default="y") != "y":
        return
    for k in seq:
        rc = run_bat(k)
        if rc != 0:
            console.print(f"[red]Step {k} returned {rc}. Stopping macro.[/]")
            return
    console.print("[green]Macro complete.[/]")


# ----- main loop --------------------------------------------------------------

def gather() -> dict:
    rows = fetch_sheet()
    yt_url, yt_blank = youtube_pending(rows)
    sheet_cols = sheet_collections(rows)
    docs_cols = docs_collection_count()
    cons_w = consolidated_w_count()
    drive_w = drive_w_count()
    w = stage_counts("W")
    iframes = docs_iframe_count()
    return {
        "W": w,
        "S": stage_counts("S"),
        "V": stage_counts("V"),
        "consolidated": consolidated_count(),
        "consolidated_w": cons_w,
        "drive_uploaded": drive_uploaded_count(),
        "drive_w": drive_w,
        "yt_with_url": yt_url,
        "yt_blank": yt_blank,
        "docs_iframes": iframes,
        "docs_cols": docs_cols,
        "sheet_cols": len(sheet_cols),
        "git_dirty": git_dirty_count(),
        "cname": cname_ok(),
        # deltas
        "new_in_sheet": max(0, len(sheet_cols) - docs_cols),  # need 01_A
        "need_montage": max(0, docs_cols - w["Rendered"]),    # need 02_1
        "need_consolidate": max(0, w["Compressed"] - cons_w), # need 02_5
        "need_drive": max(0, cons_w - drive_w),               # need 03_B
        "in_flight": max(0, drive_w - yt_url),                # waiting on Apps Script
        "need_iframe": max(0, yt_url - iframes),              # need 01_C
    }


def main() -> int:
    while True:
        with console.status("Reading pipeline state…"):
            state = gather()
        render(state)
        choice = Prompt.ask("Pick", default=suggest_next(state)).strip()
        if choice.lower() == "q":
            return 0
        if choice.lower() == "r":
            continue
        up = choice.upper()
        if up in MACROS:
            run_macro(up)
        elif choice in BAT:
            run_bat(choice)
        else:
            console.print(f"[yellow]Unknown choice: {choice}[/]")
            continue
        # Only pause for interactive bats (the bat's own pause already gave us a stop point
        # for its output; direct python calls flow straight back).
        if choice in BAT and choice not in DIRECT:
            continue  # bat already paused
        Prompt.ask("\n[dim]Press Enter to return to panel[/]", default="")


if __name__ == "__main__":
    sys.exit(main())
