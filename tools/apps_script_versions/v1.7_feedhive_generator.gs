/**
 * Stockflow FeedHive Generator — Apps Script
 * Generates per-platform FeedHive export tabs + Pinterest CSV
 * Reads: Content Library (Montages) + Stockfootage sheet (Clips)
 *
 * Tabs generated:
 *   - FeedHive Export (W) → X, Facebook, LinkedIn (both accounts)
 *   - FeedHive Export (S) → Instagram, Facebook, LinkedIn, X
 *   - FeedHive Export (V) → TikTok, Instagram, Facebook, LinkedIn, YouTube Shorts
 *   - Pinterest Export (V) → Pinterest direct bulk upload
 */

// ============================================================
// FEEDHIVE CONFIGURATION
// ============================================================
const FH_CONFIG = {
  // GCS bucket base URL
  GCS_BASE: "https://storage.googleapis.com/stockflow-social",

  // Default batch
  DEFAULT_BATCH: "Batch01",

  // Clips data source (Stockfootage spreadsheet)
  CLIPS_SHEET_ID: "12eyXAI9-hT0TFSx2HhVDUWHXo4X9QVT-vSPmGQBx6c8",
  CLIPS_TAB_GID: "926087255",  // Stockflow-social_Batch01

  // Stockflow website base
  STOCKFLOW_BASE: "https://stockflow.media/",

  // FeedHive social account names (must match exactly in FeedHive)
  ACCOUNTS: {
    YOUTUBE:      "Stockflowmedia - Nmediaservices",
    INSTAGRAM:    "stockflow.media - Nmedia.services",
    LINKEDIN_VID: "Nmediaservices: Stockflow.media",
    LINKEDIN_BLOG:"Nmediaservices.com",
    FACEBOOK:     "Nmediaservices",
    TIKTOK:       "Stockflow.media",
    PINTEREST:    "nmediaservices",
    X_TWITTER:    "Stockflow.media"
  },

  // Platform-to-account mapping per format
  FORMAT_ACCOUNTS: {
    "W": ["Stockflow.media", "Nmediaservices", "Nmediaservices: Stockflow.media", "Nmediaservices.com"],
    "S": ["stockflow.media - Nmedia.services", "Nmediaservices", "Nmediaservices: Stockflow.media", "Stockflow.media"],
    "V": ["Stockflow.media", "stockflow.media - Nmedia.services", "Nmediaservices", "Nmediaservices: Stockflow.media", "Stockflowmedia - Nmediaservices"]
  },

  // Daily limits per format (bottleneck determines schedule)
  DAILY_LIMITS: {
    "W": 2,   // LinkedIn bottleneck (2/day)
    "S": 3,   // Instagram bottleneck (3/day)
    "V": 3    // TikTok bottleneck (3/day)
  },

  // Post times per format (based on bottleneck platform)
  POST_TIMES: {
    "W": ["08:30", "12:00"],
    "S": ["09:00", "13:00", "18:00"],
    "V": ["08:00", "12:30", "19:00"]
  },

  // Pinterest config
  PINTEREST: {
    DAILY_LIMIT: 5,
    POST_TIMES: ["08:00", "11:00", "14:00", "17:00", "20:00"],
    THUMBNAIL: "00:02",
    DEFAULT_BOARD: "Stock Footage"
  },

  // Platform text limits
  TEXT_LIMITS: {
    TWITTER: 280,
    LINKEDIN: 3000,
    INSTAGRAM: 2200,
    FACEBOOK: 2200,
    TIKTOK: 2200,
    PINTEREST: 500,
    YOUTUBE: 500
  },

  // Content priority order
  CONTENT_PRIORITY: ["Montages", "Clips", "UGC"],

  // Display name mapping: Platform → FeedHive account name
  DISPLAY_NAMES: {
    "YouTube":        "YouTube (Stockflowmedia - Nmediaservices)",
    "Instagram":      "Instagram (stockflow.media - Nmedia.services)",
    "LinkedIn Video": "LinkedIn (Nmediaservices: Stockflow.media)",
    "LinkedIn Blog":  "LinkedIn (Nmediaservices.com)",
    "Facebook":       "Facebook (Nmediaservices)",
    "TikTok":         "TikTok (Stockflow.media)",
    "Pinterest":      "Pinterest (nmediaservices)",
    "X/Twitter":      "X/Twitter (Stockflow.media)"
  }
};

// ============================================================
// PINTEREST BOARD MAPPING
// ============================================================
const PINTEREST_BOARDS = {
  "Microscopic":     "Microscopic World",
  "Food Beverage":   "Food & Beverage",
  "Food & Beverage": "Food & Beverage"
};

function getPinterestBoard_(category, subcategory) {
  if (PINTEREST_BOARDS[category]) return PINTEREST_BOARDS[category];
  return category || FH_CONFIG.PINTEREST.DEFAULT_BOARD;
}

// ============================================================
// CONTROL PANEL
// ============================================================
const CONTROL_PANEL_SHEET = "Control Panel";

/**
 * Create or reset the Control Panel sheet with default values
 */
function createControlPanel() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONTROL_PANEL_SHEET);

  if (sheet) {
    var confirm = SpreadsheetApp.getUi().alert(
      "Control Panel exists. Reset to defaults?",
      SpreadsheetApp.getUi().ButtonSet.YES_NO
    );
    if (confirm !== SpreadsheetApp.getUi().Button.YES) return;
    sheet.clear();
  } else {
    sheet = ss.insertSheet(CONTROL_PANEL_SHEET);
  }

  // Headers
  var headers = ["Platform", "Account Name", "Enabled", "Daily Limit", "Max Safe", "Formats", "Status", "Notes"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight("bold").setBackground("#1a1a2e").setFontColor("#ffffff");

  // Default data
  var data = [
    ["YouTube",        "Stockflowmedia - Nmediaservices",  true,  3, 6,  "W,V",  "Active", "YouTube Shorts for V"],
    ["Instagram",      "stockflow.media - Nmedia.services", true, 3, 5,  "S,V",  "Active", "Reels for V, Feed for S"],
    ["LinkedIn",       "Nmediaservices: Stockflow.media",   true, 2, 3,  "W,V,S","Active", "Video posts"],
    ["LinkedIn Blog",  "Nmediaservices.com",                true, 2, 3,  "W",    "Active", "Blog-style posts"],
    ["Facebook",       "Nmediaservices",                    true, 3, 5,  "W,S,V","Active", "All formats"],
    ["TikTok",         "Stockflow.media",                   true, 3, 5,  "V",    "Active", "Vertical only"],
    ["X/Twitter",      "Stockflow.media",                   true, 3, 10, "W,S",  "Active", "Short text + video"],
    ["Pinterest",      "nmediaservices",                    true, 5, 10, "V",    "Active", "Direct bulk upload"],
    ["Reddit",         "Stockflowmedia",                   false, 0, 1,  "W",    "Manual", "Email reminder only"]
  ];

  sheet.getRange(2, 1, data.length, headers.length).setValues(data);

  // Format checkboxes in column C
  sheet.getRange(2, 3, data.length, 1).insertCheckboxes();

  // Color enabled rows green, disabled grey
  for (var i = 0; i < data.length; i++) {
    var rowNum = i + 2;
    if (data[i][2] === false) {
      sheet.getRange(rowNum, 1, 1, headers.length).setBackground("#f0f0f0");
    } else {
      sheet.getRange(rowNum, 1, 1, headers.length).setBackground("#e8f5e9");
    }
  }

  // Freeze header, auto-resize
  sheet.setFrozenRows(1);
  for (var c = 1; c <= headers.length; c++) sheet.autoResizeColumn(c);

  // Column widths
  sheet.setColumnWidth(2, 280); // Account Name
  sheet.setColumnWidth(8, 200); // Notes

  // --- CONTENT TYPE FILTERS ---
  var filterStartRow = data.length + 3; // gap after platform rows
  sheet.getRange(filterStartRow, 1, 1, 3).setValues([["CONTENT FILTERS", "", ""]])
    .setFontWeight("bold").setBackground("#2d3436").setFontColor("#ffffff");

  var ctHeaders = ["Content Type", "Enabled", "Notes"];
  sheet.getRange(filterStartRow + 1, 1, 1, 3).setValues([ctHeaders])
    .setFontWeight("bold").setBackground("#636e72").setFontColor("#ffffff");

  var ctData = [
    ["Montages", true,  "Collection montage videos"],
    ["Clips",    false, "Individual preview clips"],
    ["UGC",      false, "User-generated content (future)"]
  ];
  sheet.getRange(filterStartRow + 2, 1, ctData.length, 3).setValues(ctData);
  sheet.getRange(filterStartRow + 2, 2, ctData.length, 1).insertCheckboxes();

  // Color content type rows
  for (var ct = 0; ct < ctData.length; ct++) {
    var ctRow = filterStartRow + 2 + ct;
    sheet.getRange(ctRow, 1, 1, 3).setBackground(ctData[ct][1] ? "#e8f5e9" : "#f0f0f0");
  }

  // --- FORMAT FILTERS ---
  var fmtStartRow = filterStartRow + ctData.length + 3;
  sheet.getRange(fmtStartRow, 1, 1, 3).setValues([["FORMAT FILTERS", "", ""]])
    .setFontWeight("bold").setBackground("#2d3436").setFontColor("#ffffff");

  var fmtHeaders = ["Format", "Enabled", "Description"];
  sheet.getRange(fmtStartRow + 1, 1, 1, 3).setValues([fmtHeaders])
    .setFontWeight("bold").setBackground("#636e72").setFontColor("#ffffff");

  var fmtData = [
    ["W", true,  "Widescreen 16:9"],
    ["S", true,  "Square 1:1"],
    ["V", true,  "Vertical 9:16"]
  ];
  sheet.getRange(fmtStartRow + 2, 1, fmtData.length, 3).setValues(fmtData);
  sheet.getRange(fmtStartRow + 2, 2, fmtData.length, 1).insertCheckboxes();

  // Color format rows
  for (var fm = 0; fm < fmtData.length; fm++) {
    var fmRow = fmtStartRow + 2 + fm;
    sheet.getRange(fmRow, 1, 1, 3).setBackground(fmtData[fm][1] ? "#e8f5e9" : "#f0f0f0");
  }

  SpreadsheetApp.getUi().alert(
    "Control Panel created!\n\n" +
    "PLATFORM CONTROLS (rows 2-10):\n" +
    "  • Checkboxes to enable/disable accounts\n" +
    "  • Daily Limit controls posting frequency\n\n" +
    "CONTENT FILTERS (rows " + (filterStartRow+2) + "-" + (filterStartRow+4) + "):\n" +
    "  • Montages / Clips / UGC on/off\n\n" +
    "FORMAT FILTERS (rows " + (fmtStartRow+2) + "-" + (fmtStartRow+4) + "):\n" +
    "  • W / S / V on/off"
  );
}

/**
 * Read Control Panel settings — returns map of account name → { enabled, limit, formats }
 */
function readControlPanel_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONTROL_PANEL_SHEET);
  var settings = {
    accounts: {},          // accountName → { enabled, limit, platform, formats }
    platforms: {},         // platformName → { enabled, limit, accountName, formats }
    enabledAccounts: {},   // format → [accountName, ...]
    enabledContentTypes: {},// contentType → true/false
    enabledFormats: {}     // format → true/false
  };

  if (!sheet) {
    // No control panel — use defaults
    settings.enabledAccounts = FH_CONFIG.FORMAT_ACCOUNTS;
    settings.enabledContentTypes = { "Montages": true, "Clips": true, "UGC": true };
    settings.enabledFormats = { "W": true, "S": true, "V": true };
    return settings;
  }

  var data = sheet.getDataRange().getValues();
  var section = "platforms"; // track which section we're reading

  for (var i = 1; i < data.length; i++) {
    var col0 = String(data[i][0] || "").trim();
    var col1 = String(data[i][1] || "").trim();
    var col2 = data[i][2];

    // Detect section headers
    if (col0 === "CONTENT FILTERS") { section = "content"; continue; }
    if (col0 === "FORMAT FILTERS") { section = "format"; continue; }
    if (col0 === "Content Type" || col0 === "Format" || col0 === "Platform") continue; // skip sub-headers
    if (!col0) continue; // skip empty rows

    if (section === "platforms") {
      var platform = col0;
      var accountName = col1;
      var enabled = col2 === true;
      var dailyLimit = parseInt(data[i][3]) || 0;
      var formats = (data[i][5] || "").split(",").map(function(f) { return f.trim(); });

      settings.accounts[accountName] = {
        enabled: enabled,
        limit: dailyLimit,
        platform: platform,
        formats: formats
      };

      settings.platforms[platform] = {
        enabled: enabled,
        limit: dailyLimit,
        accountName: accountName,
        formats: formats
      };
    } else if (section === "content") {
      // Content Type filter: col0 = type name, col1 (B) = checkbox
      var ctEnabled = data[i][1];
      settings.enabledContentTypes[col0] = (ctEnabled === true);
    } else if (section === "format") {
      // Format filter: col0 = W/S/V, col1 (B) = checkbox
      var fmtEnabled = data[i][1];
      settings.enabledFormats[col0] = (fmtEnabled === true);
    }
  }

  // Default content types if none found
  if (Object.keys(settings.enabledContentTypes).length === 0) {
    settings.enabledContentTypes = { "Montages": true, "Clips": true, "UGC": true };
  }
  if (Object.keys(settings.enabledFormats).length === 0) {
    settings.enabledFormats = { "W": true, "S": true, "V": true };
  }

  // Build enabled accounts per format (only for enabled formats)
  for (var fmt of ["W", "S", "V"]) {
    settings.enabledAccounts[fmt] = [];
    if (!settings.enabledFormats[fmt]) continue; // format disabled
    for (var acctName in settings.accounts) {
      var acct = settings.accounts[acctName];
      if (acct.enabled && acct.limit > 0 && acct.formats.indexOf(fmt) !== -1) {
        settings.enabledAccounts[fmt].push(acctName);
      }
    }
  }

  return settings;
}

/**
 * Get the bottleneck daily limit for a format (minimum across enabled accounts)
 */
function getFormatDailyLimit_(settings, formatCode) {
  var minLimit = 999;
  for (var acctName in settings.accounts) {
    var acct = settings.accounts[acctName];
    if (acct.enabled && acct.limit > 0 && acct.formats.indexOf(formatCode) !== -1) {
      if (acct.limit < minLimit) minLimit = acct.limit;
    }
  }
  return minLimit === 999 ? 3 : minLimit;
}

// ============================================================
// MENU ITEMS (called from main Code.gs onOpen)
// ============================================================
function generateFeedHiveSheetW() {
  generateFeedHivePerPlatform_("W", "FeedHive Export (W)", "#2a9d8f");
}

function generateFeedHiveSheetS() {
  generateFeedHivePerPlatform_("S", "FeedHive Export (S)", "#e8710a");
}

function generateFeedHiveSheetV() {
  generateFeedHivePerPlatform_("V", "FeedHive Export (V)", "#9334e8");
}

function generatePinterestExport() {
  generatePinterestTab_();
}

/**
 * Generate consolidated FeedHive export — all formats interleaved
 */
function generateFeedHiveAll() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = readControlPanel_();

  // --- Step 1: Mode ---
  var modeResponse = ui.alert(
    "FeedHive — All Formats (W+S+V)",
    "Choose mode:\n\nYES = Fresh (overwrite)\nNO = Append (add new only)",
    ui.ButtonSet.YES_NO_CANCEL
  );
  if (modeResponse === ui.Button.CANCEL) return;
  var mode = (modeResponse === ui.Button.YES) ? "fresh" : "append";

  // --- Step 2: Start date ---
  var tomorrow = new Date(Date.now() + 86400000);
  var defaultStr = Utilities.formatDate(tomorrow, Session.getScriptTimeZone(), "yyyy-MM-dd");
  var dateResponse = ui.prompt("Schedule",
    "Start date (YYYY-MM-DD):\n\nDefault: " + defaultStr,
    ui.ButtonSet.OK_CANCEL);
  if (dateResponse.getSelectedButton() !== ui.Button.OK) return;
  var dateInput = dateResponse.getResponseText().trim();
  var startDate = dateInput ? new Date(dateInput + "T00:00:00") : tomorrow;
  if (isNaN(startDate.getTime())) { ui.alert("Invalid date."); return; }

  // --- Step 2b: Skip test entries? ---
  var skipTest = false;
  var testSheet = ss.getSheetByName("FeedHive Test");
  if (testSheet && testSheet.getLastRow() > 1) {
    var skipResponse = ui.alert(
      "Test entries found",
      "Skip items already in FeedHive Test sheet?\n\nYES = Exclude test entries\nNO = Include everything",
      ui.ButtonSet.YES_NO
    );
    skipTest = (skipResponse === ui.Button.YES);
  }

  // Build test title set for exclusion
  var testTitles = {};
  if (skipTest && testSheet) {
    var testData = testSheet.getDataRange().getValues();
    for (var t = 1; t < testData.length; t++) {
      var testTitle = (testData[t][1] || "").replace("TEST_", "");
      if (testTitle) testTitles[testTitle] = true;
    }
  }

  // --- Step 3: Gather ALL content across formats ---
  var allItems = [];
  var formats = ["W", "S", "V"];

  for (var f = 0; f < formats.length; f++) {
    var fmt = formats[f];
    var enabledAccts = settings.enabledAccounts[fmt] || [];
    if (enabledAccts.length === 0) continue;

    var content = gatherAllContent_(fmt, settings);
    for (var c = 0; c < content.length; c++) {
      content[c].format = fmt;
      content[c].socialAccounts = enabledAccts.join(", ");
    }
    allItems = allItems.concat(content);
  }

  if (allItems.length === 0) {
    ui.alert("No content found. Check Content Library and Control Panel.");
    return;
  }

  // --- Step 4: Handle sheet ---
  var tabName = "FeedHive Export (All)";
  var headers = ["Text", "Title", "Media URLs", "Labels", "Social Medias", "Scheduled"];
  var target = ss.getSheetByName(tabName);
  var existingTitles = {};
  var existingRowCount = 0;
  var lastScheduledDate = null;

  if (mode === "append" && target) {
    var existingData = target.getDataRange().getValues();
    for (var i = 1; i < existingData.length; i++) {
      var title = existingData[i][1] || "";
      if (title) { existingTitles[title] = true; existingRowCount++; }
      var sched = existingData[i][5] || "";
      if (sched) {
        var parsed = new Date(String(sched).replace(" ", "T") + ":00");
        if (!isNaN(parsed.getTime()) && (!lastScheduledDate || parsed > lastScheduledDate)) lastScheduledDate = parsed;
      }
    }
    if (!dateInput && lastScheduledDate) startDate = new Date(lastScheduledDate.getTime() + 86400000);
  }

  if (mode === "fresh" || !target) {
    if (target && mode === "fresh") target.clear();
    if (!target) target = ss.insertSheet(tabName);
    target.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight("bold").setBackground("#1a1a2e").setFontColor("#ffffff");
  }

  // --- Step 5: Expand to per-account rows ---
  // Each content item × each enabled account = one row
  // This ensures per-account daily limits are respected
  var expandedRows = [];  // { content, accountName, platform, format, titleKey }

  for (var j = 0; j < allItems.length; j++) {
    var item = allItems[j];
    var fmt = item.format;
    var enabledAccts = settings.enabledAccounts[fmt] || [];

    for (var a = 0; a < enabledAccts.length; a++) {
      var acctName = enabledAccts[a];
      var acctInfo = settings.accounts[acctName] || {};
      var platformName = acctInfo.platform || acctName;
      var titleKey = (item.collection || item.filename) + "_" + fmt + "_" + platformName;

      // Skip if already exists (append mode)
      if (mode === "append" && existingTitles[titleKey]) continue;
      // Skip test entries if requested
      if (skipTest && testTitles[titleKey]) continue;

      expandedRows.push({
        content: item,
        accountName: acctName,
        platform: platformName,
        format: fmt,
        titleKey: titleKey,
        dailyLimit: acctInfo.limit || 3
      });
    }
  }

  // --- Step 6: Schedule per-account with parallel timelines ---
  // Each account runs its own independent timeline
  var acctDayOffset = {};   // accountName → current day offset
  var acctSlotIndex = {};   // accountName → current slot index within day
  var acctTimes = {
    "default": ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "16:00", "17:00", "18:00", "19:00"]
  };

  // Sort by format priority (Montages before Clips) then round-robin accounts
  expandedRows.sort(function(a, b) {
    if (a.content.priority !== b.content.priority) return a.content.priority - b.content.priority;
    if (a.accountName < b.accountName) return -1;
    if (a.accountName > b.accountName) return 1;
    return 0;
  });

  var newRows = [];
  for (var k = 0; k < expandedRows.length; k++) {
    var er = expandedRows[k];
    var acct = er.accountName;

    // Initialize account tracking
    if (acctDayOffset[acct] === undefined) { acctDayOffset[acct] = 0; acctSlotIndex[acct] = 0; }

    var times = acctTimes[acct] || acctTimes["default"];
    var limit = er.dailyLimit;

    // Calculate schedule for this account
    var dayOff = acctDayOffset[acct];
    var slotIdx = acctSlotIndex[acct];

    var d = new Date(startDate.getTime() + dayOff * 86400000);
    var dateKey = d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
    var timeSlot = times[slotIdx % times.length];

    var scheduleStr = dateKey + " " + timeSlot;

    // Advance slot for this account
    slotIdx++;
    if (slotIdx >= limit) {
      slotIdx = 0;
      dayOff++;
    }
    acctDayOffset[acct] = dayOff;
    acctSlotIndex[acct] = slotIdx;

    // Build row
    var text = buildPostText_(er.content, er.platform, er.format);

    newRows.push([
      text,                           // Text
      er.titleKey,                    // Title (unique: collection_format_platform)
      er.content.gcsUrl,              // Media URLs
      er.content.category || "General", // Labels
      er.accountName,                 // Social Medias (ONE account per row)
      scheduleStr                     // Scheduled
    ]);
  }

  // --- Step 7: Write ---
  if (newRows.length > 0) {
    var writeRow = (mode === "fresh") ? 2 : existingRowCount + 2;
    target.getRange(writeRow, 1, newRows.length, headers.length).setValues(newRows);
  }

  target.setFrozenRows(1);
  for (var col = 1; col <= headers.length; col++) target.autoResizeColumn(col);

  // --- Summary with display names ---
  var totalRows = (mode === "fresh") ? newRows.length : existingRowCount + newRows.length;
  var fmtCounts = { "W": 0, "S": 0, "V": 0 };
  var typeCounts = { "Montage": 0, "Clip": 0 };
  var acctCounts = {};
  for (var m = 0; m < expandedRows.length; m++) {
    fmtCounts[expandedRows[m].format] = (fmtCounts[expandedRows[m].format] || 0) + 1;
    typeCounts[expandedRows[m].content.type] = (typeCounts[expandedRows[m].content.type] || 0) + 1;
    var pn = expandedRows[m].platform;
    acctCounts[pn] = (acctCounts[pn] || 0) + 1;
  }

  var accountDisplay = buildAccountDisplay_(settings);

  // Calculate end date
  var maxDayOffset = 0;
  for (var acctKey in acctDayOffset) {
    if (acctDayOffset[acctKey] > maxDayOffset) maxDayOffset = acctDayOffset[acctKey];
  }
  var endDate = new Date(startDate.getTime() + maxDayOffset * 86400000);
  var endDateStr = endDate.getFullYear() + "-" +
    String(endDate.getMonth() + 1).padStart(2, "0") + "-" +
    String(endDate.getDate()).padStart(2, "0");

  var msg = "FeedHive Export (All) Generated!\n\n";
  msg += "Mode: " + mode + "\n";
  msg += "W: " + fmtCounts["W"] + " | S: " + fmtCounts["S"] + " | V: " + fmtCounts["V"] + "\n";
  msg += "Montages: " + (typeCounts["Montage"] || 0) + " | Clips: " + (typeCounts["Clip"] || 0) + "\n";
  msg += "Total rows: " + newRows.length + " (1 row per account per video)\n\n";
  msg += "Posting to:\n" + accountDisplay + "\n";
  msg += "Schedule: " + Utilities.formatDate(startDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
  msg += " → " + endDateStr + "\n";
  msg += "Duration: ~" + maxDayOffset + " days";

  Logger.log(msg);
  ui.alert(msg);
}

/**
 * Generate test CSV — one entry per account per format
 */
function generateFeedHiveTest() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = readControlPanel_();

  var tabName = "FeedHive Test";
  var headers = ["Text", "Title", "Media URLs", "Labels", "Social Medias", "Scheduled"];
  var target = ss.getSheetByName(tabName);

  if (target) target.clear();
  else target = ss.insertSheet(tabName);

  target.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight("bold").setBackground("#ff6b6b").setFontColor("#ffffff");

  var testRows = [];
  var formats = ["W", "S", "V"];
  var now = new Date();
  var timeSlot = 0;
  var testTimes = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];

  for (var f = 0; f < formats.length; f++) {
    var fmt = formats[f];
    var enabledAccts = settings.enabledAccounts[fmt] || [];
    if (enabledAccts.length === 0) continue;

    var content = gatherAllContent_(fmt, settings);
    if (content.length === 0) continue;

    // Take first item only
    var firstItem = content[0];
    var text = buildPostText_(firstItem, "combined", fmt);
    var titleKey = "TEST_" + (firstItem.collection || firstItem.filename) + "_" + fmt + "_" + firstItem.type;

    var schedDate = now.getFullYear() + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-" +
      String(now.getDate()).padStart(2, "0") + " " +
      (testTimes[timeSlot] || "09:00");
    timeSlot++;

    testRows.push([
      text,
      titleKey,
      firstItem.gcsUrl,
      firstItem.category || "General",
      enabledAccts.join(", "),
      schedDate
    ]);
  }

  if (testRows.length > 0) {
    target.getRange(2, 1, testRows.length, headers.length).setValues(testRows);
  }

  target.setFrozenRows(1);
  for (var col = 1; col <= headers.length; col++) target.autoResizeColumn(col);

  var accountDisplay = buildAccountDisplay_(settings);

  var msg = "FeedHive TEST Generated!\n\n";
  msg += "Test entries: " + testRows.length + "\n";
  msg += "Formats tested: " + formats.filter(function(fmt) {
    return (settings.enabledAccounts[fmt] || []).length > 0;
  }).join(", ") + "\n\n";
  msg += "Accounts included:\n" + accountDisplay + "\n";
  msg += "⚠️ Download this sheet as CSV and import to FeedHive to verify.\n";
  msg += "Once verified, run 'Generate FeedHive Export (All)' for the full export.";

  ui.alert(msg);
}

/**
 * Build friendly account display string with daily limits
 */
function buildAccountDisplay_(settings) {
  var display = "";
  var acctMap = {
    "Stockflowmedia - Nmediaservices":  "YouTube",
    "stockflow.media - Nmedia.services":"Instagram",
    "Nmediaservices: Stockflow.media":  "LinkedIn",
    "Nmediaservices.com":               "LinkedIn Blog",
    "Nmediaservices":                   "Facebook",
    "Stockflow.media":                  "X/Twitter or TikTok"
  };

  for (var acctName in settings.accounts) {
    var acct = settings.accounts[acctName];
    if (!acct.enabled || acct.limit <= 0) continue;
    var platformLabel = acct.platform || acctMap[acctName] || acctName;
    display += "  • " + platformLabel + " (" + acctName + "): " + acct.limit + "/day\n";
  }

  if (!display) {
    // Fallback if no Control Panel
    display = "  (Using default accounts — create Control Panel for custom settings)\n";
  }

  return display;
}

/**
 * Build interleaved schedule across formats
 * Round-robins W→S→V slots within daily limits
 */
function buildInterleavedSchedule_(startDate, items, settings) {
  var schedule = [];

  // Each format has its own time slots (parallel across platforms)
  var formatTimes = {
    "W": ["08:30", "12:00"],              // LinkedIn bottleneck: 2/day
    "S": ["09:00", "13:00", "18:00"],     // Instagram bottleneck: 3/day
    "V": ["08:00", "12:30", "19:00"]      // TikTok bottleneck: 3/day
  };

  // Track per-format day offsets independently (parallel scheduling)
  var formatDayOffset = { "W": 0, "S": 0, "V": 0 };
  var formatSlotIndex = { "W": 0, "S": 0, "V": 0 };

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var fmt = item.format;
    var times = formatTimes[fmt] || ["09:00", "13:00"];
    var dailyLimit = getFormatDailyLimit_(settings, fmt);

    // Use this format's own day offset (independent of other formats)
    var dayOff = formatDayOffset[fmt];
    var slotIdx = formatSlotIndex[fmt];

    var d = new Date(startDate.getTime() + dayOff * 86400000);
    var dateKey = d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");

    schedule.push(dateKey + " " + times[slotIdx]);

    // Advance slot, wrap to next day if needed
    slotIdx++;
    if (slotIdx >= Math.min(times.length, dailyLimit)) {
      slotIdx = 0;
      dayOff++;
    }

    formatDayOffset[fmt] = dayOff;
    formatSlotIndex[fmt] = slotIdx;

    var found = true;

    if (!found) schedule.push(""); // fallback
  }

  return schedule;
}

// ============================================================
// CORE: GATHER ALL CONTENT (Montages + Clips)
// ============================================================
function gatherAllContent_(formatCode, settings) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var allContent = [];
  var enabledCT = (settings && settings.enabledContentTypes) || { "Montages": true, "Clips": true };

  // --- 1. Montages from Content Library ---
  if (!enabledCT["Montages"]) {
    Logger.log("Montages disabled in Control Panel — skipping");
  }
  var lib = ss.getSheetByName("Content Library");
  if (lib && enabledCT["Montages"]) {
    var libData = lib.getDataRange().getValues();
    var LC = CONFIG.LIB_COL;
    var seen = {};

    for (var i = 1; i < libData.length; i++) {
      var r = libData[i];
      var fmt = (r[LC.FORMAT] || "").toUpperCase();
      if (fmt !== formatCode) continue;

      // Row-level filters: C (Enabled) must be checked, D (Published) must NOT be checked
      var isEnabled = r[LC.ENABLED];
      var isPublished = r[LC.PUBLISHED];
      if (isEnabled !== true) continue;         // Skip if not enabled
      if (isPublished === true) continue;        // Skip if already published

      var contentType = (r[LC.CONTENT_TYPE] || "").toLowerCase();
      if (contentType && contentType !== "montages" && contentType !== "montage") continue;

      var collection = r[LC.COLLECTION] || "";
      if (!collection || seen[collection]) continue;
      seen[collection] = true;

      var category = r[LC.CATEGORY] || "";
      var subcategory = r[LC.SUBCATEGORY] || "";
      var filename = r[LC.FILENAME] || "";

      var gcsUrl = buildGcsUrl_(filename, formatCode, "Montages");
      var stockflowUrl = buildStockflowUrl_(category, subcategory, collection);

      allContent.push({
        type: "Montage",
        category: category,
        subcategory: subcategory,
        collection: collection,
        filename: filename,
        gcsUrl: gcsUrl,
        stockflowUrl: stockflowUrl,
        helpUrl: r[LC.HELP_URL] || "",
        description: "",
        tags: "",
        keywords: "",
        priority: 1
      });
    }
  }

  // --- 2. Clips from Stockfootage sheet ---
  if (!enabledCT["Clips"]) {
    Logger.log("Clips disabled in Control Panel — skipping");
  }
  try {
    if (!enabledCT["Clips"]) throw new Error("Clips disabled");
    var clipsData = fetchClipsData_(formatCode);
    for (var j = 0; j < clipsData.length; j++) {
      var clip = clipsData[j];
      allContent.push({
        type: "Clip",
        category: clip.category,
        subcategory: clip.subcategory,
        collection: clip.collection,
        filename: clip.filename,
        gcsUrl: clip.gcsUrl,
        stockflowUrl: clip.stockflowUrl,
        helpUrl: "",
        description: clip.description,
        tags: clip.tags,
        keywords: clip.keywords,
        priority: 2
      });
    }
  } catch (e) {
    Logger.log("Clips fetch skipped: " + e.message);
  }

  // Sort by priority (Montages first, then Clips)
  allContent.sort(function(a, b) { return a.priority - b.priority; });

  return allContent;
}

// ============================================================
// FETCH CLIPS FROM STOCKFOOTAGE SHEET
// ============================================================
function fetchClipsData_(formatCode) {
  var clips = [];

  // Map format code to sheet format value
  var formatMap = { "W": "16:9", "S": "1:1", "V": "9:16" };
  var targetFormat = formatMap[formatCode];

  var url = "https://docs.google.com/spreadsheets/d/" +
    FH_CONFIG.CLIPS_SHEET_ID + "/export?format=csv&gid=" + FH_CONFIG.CLIPS_TAB_GID;

  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    Logger.log("Failed to fetch clips sheet: " + response.getResponseCode());
    return clips;
  }

  var csv = Utilities.parseCsv(response.getContentText());
  if (csv.length < 2) return clips;

  var headers = csv[0];
  var colIndex = {};
  for (var i = 0; i < headers.length; i++) {
    colIndex[headers[i].trim()] = i;
  }

  var seen = {};

  for (var i = 1; i < csv.length; i++) {
    var row = csv[i];
    var format = row[colIndex["Format"]] || "";
    if (format !== targetFormat) continue;

    var fileId = row[colIndex["File_ID"]] || "";
    var category = row[colIndex["Category"]] || "";
    var subcategory = row[colIndex["Catagory_Sub"]] || row[colIndex["Category_Sub"]] || "";
    var collection = row[colIndex["Sub"]] || "";
    var description = row[colIndex["Description"]] || "";
    var tags = row[colIndex["Tags"]] || "";
    var keywords = row[colIndex["Keywords"]] || "";

    if (!fileId || seen[fileId]) continue;
    seen[fileId] = true;

    // Build filename matching GCS naming convention
    var cleanCat = category.replace(/[& ]/g, "-").replace(/--+/g, "-");
    var cleanSub = subcategory.replace(/[ ]/g, "-");
    var cleanColl = collection.replace(/[ ]/g, "-");
    var filename = cleanCat + "_" + cleanSub + "_" + cleanColl + "_" + fileId + "_" + formatCode + ".mp4";

    var gcsUrl = buildGcsUrl_(filename, formatCode, "Clips");
    var stockflowUrl = buildStockflowUrl_(category, subcategory, collection);

    clips.push({
      category: category,
      subcategory: subcategory,
      collection: collection,
      filename: filename,
      gcsUrl: gcsUrl,
      stockflowUrl: stockflowUrl,
      description: description,
      tags: tags,
      keywords: keywords
    });
  }

  Logger.log("Fetched " + clips.length + " clips for format " + formatCode);
  return clips;
}

// ============================================================
// URL BUILDERS
// ============================================================
function buildGcsUrl_(filename, formatCode, contentType) {
  return FH_CONFIG.GCS_BASE + "/" + FH_CONFIG.DEFAULT_BATCH + "/" +
    contentType + "/" + formatCode + "/" + filename;
}

function buildStockflowUrl_(category, subcategory, collection) {
  var params = [];
  if (category) params.push("cat=" + encodeURIComponent(category).replace(/%20/g, "+"));
  if (subcategory) params.push("sub=" + encodeURIComponent(subcategory).replace(/%20/g, "+"));
  if (collection) params.push("collection=" + encodeURIComponent(collection).replace(/%20/g, "+"));
  return FH_CONFIG.STOCKFLOW_BASE + "?" + params.join("&");
}

// ============================================================
// PER-PLATFORM TEXT BUILDERS
// ============================================================
function buildPostText_(content, platform, formatCode) {
  var name = content.collection.replace(/_/g, " ").replace(/-/g, " ");
  var cat = content.category.replace(/_/g, " ");
  var sub = content.subcategory.replace(/_/g, " ");
  var url = content.stockflowUrl;
  var desc = content.description || "";
  var baseTags = buildHashtags_(content);

  // For FeedHive combined posts, use a universal format
  var text = "";
  var isMicro = cat.toLowerCase().indexOf("microscop") !== -1;

  if (content.type === "Montage") {
    text = name + " — Premium " + cat.toLowerCase() + " stock footage.\n";
    text += "4K video & 8K images. Royalty-free.\n\n";
    if (isMicro) {
      text += "Perfect for science documentaries, educational content, and research presentations.\n\n";
    } else {
      text += "Perfect for restaurant marketing, food blogs, and social media campaigns.\n\n";
    }
    text += "Browse & download: " + url + "\n\n";
    text += baseTags.slice(0, 15).join(" ");
  } else {
    // Clip - use description from sheet
    if (desc) {
      text = desc.substring(0, 200) + "\n\n";
    } else {
      text = name + " — " + cat + " stock footage\n\n";
    }
    text += "Download: " + url + "\n\n";
    text += baseTags.slice(0, 15).join(" ");
  }

  // Enforce reasonable limit
  if (text.length > 2000) text = text.substring(0, 1997) + "...";
  return text;
}

// ============================================================
// HASHTAG BUILDER
// ============================================================
function buildHashtags_(content) {
  var tags = [];

  // Base tags
  tags.push("#stockfootage", "#royaltyfree");

  // Category tags
  var cat = (content.category || "").toLowerCase();
  if (cat.indexOf("microscop") !== -1) {
    tags.push("#microscopy", "#science", "#biology", "#micro", "#microscope");
    tags.push("#sciencevideo", "#biologylab", "#microworld", "#cellbiology");
  } else if (cat.indexOf("food") !== -1) {
    tags.push("#foodvideo", "#foodphotography", "#culinary", "#foodie", "#foodcontent");
    tags.push("#restaurantmarketing", "#foodblogger", "#cheflife", "#foodstyling");
  }

  // Subcategory tags
  var sub = (content.subcategory || "").toLowerCase().replace(/[- ]/g, "");
  if (sub) tags.push("#" + sub);

  // Collection tags
  var coll = (content.collection || "").toLowerCase().replace(/[- ]/g, "");
  if (coll) tags.push("#" + coll);

  // Tags from sheet data (clips have rich tags)
  if (content.tags) {
    var sheetTags = content.tags.split(",").map(function(t) {
      var clean = t.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      return clean ? "#" + clean : "";
    }).filter(function(t) { return t.length > 2; });
    tags = tags.concat(sheetTags);
  }

  // Keywords from sheet data
  if (content.keywords) {
    var kwTags = content.keywords.split(",").map(function(k) {
      var clean = k.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      return clean ? "#" + clean : "";
    }).filter(function(k) { return k.length > 2; });
    tags = tags.concat(kwTags);
  }

  // Generic SEO tags
  tags.push("#stockvideo", "#4kvideo", "#8kimages", "#videography");
  tags.push("#contentcreator", "#filmmaking", "#broll", "#visualcontent");

  // Deduplicate
  var unique = [];
  var seen = {};
  for (var i = 0; i < tags.length; i++) {
    if (!seen[tags[i]] && tags[i].length > 2) {
      seen[tags[i]] = true;
      unique.push(tags[i]);
    }
  }

  return unique;
}

// ============================================================
// FEEDHIVE SCHEDULE BUILDER
// ============================================================
function buildFeedHiveSchedule_(startDate, totalItems, formatCode) {
  var times = FH_CONFIG.POST_TIMES[formatCode] || ["09:00", "13:00"];
  var schedule = [];
  var dayOffset = 0;
  var slotIndex = 0;

  for (var i = 0; i < totalItems; i++) {
    var d = new Date(startDate.getTime() + dayOffset * 86400000);
    var dateStr = d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0") + " " + times[slotIndex];
    schedule.push(dateStr);
    slotIndex++;
    if (slotIndex >= times.length) {
      slotIndex = 0;
      dayOffset++;
    }
  }

  return schedule;
}

function buildPinterestSchedule_(startDate, totalItems) {
  var times = FH_CONFIG.PINTEREST.POST_TIMES;
  var schedule = [];
  var dayOffset = 0;
  var slotIndex = 0;

  for (var i = 0; i < totalItems; i++) {
    var d = new Date(startDate.getTime() + dayOffset * 86400000);
    var dateStr = d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0") + "T" + times[slotIndex] + ":00";
    schedule.push(dateStr);
    slotIndex++;
    if (slotIndex >= times.length) {
      slotIndex = 0;
      dayOffset++;
    }
  }

  return schedule;
}

// ============================================================
// FEEDHIVE EXPORT GENERATOR (per format)
// ============================================================
function generateFeedHivePerPlatform_(formatCode, tabName, headerColor) {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = readControlPanel_();

  // Check if format is enabled
  if (settings.enabledFormats[formatCode] === false) {
    ui.alert("Format " + formatCode + " is disabled in Control Panel.");
    return;
  }

  // --- Step 1: Mode selection ---
  var modeResponse = ui.alert(
    "FeedHive — " + formatCode,
    "Choose mode:\n\nYES = Fresh (overwrite existing)\nNO = Append (add new only)",
    ui.ButtonSet.YES_NO_CANCEL
  );
  if (modeResponse === ui.Button.CANCEL) return;
  var mode = (modeResponse === ui.Button.YES) ? "fresh" : "append";

  // --- Step 2: Start date ---
  var tomorrow = new Date(Date.now() + 86400000);
  var defaultStr = Utilities.formatDate(tomorrow, Session.getScriptTimeZone(), "yyyy-MM-dd");
  var datePrompt = mode === "append"
    ? "Start date for NEW posts (YYYY-MM-DD):\n\nLeave blank = continue from last scheduled."
    : "Start date (YYYY-MM-DD):\n\nDefault: " + defaultStr;

  var dateResponse = ui.prompt("Schedule", datePrompt, ui.ButtonSet.OK_CANCEL);
  if (dateResponse.getSelectedButton() !== ui.Button.OK) return;
  var dateInput = dateResponse.getResponseText().trim();
  var startDate = dateInput ? new Date(dateInput + "T00:00:00") : tomorrow;
  if (isNaN(startDate.getTime())) { ui.alert("Invalid date."); return; }

  // --- Step 3: Gather content ---
  var allContent = gatherAllContent_(formatCode, settings);
  if (allContent.length === 0) {
    ui.alert("No content found for format " + formatCode);
    return;
  }

  // --- Step 4: Handle append mode ---
  var headers = ["Text", "Title", "Media URLs", "Labels", "Social Medias", "Scheduled"];
  var existingTitles = {};
  var existingRowCount = 0;
  var lastScheduledDate = null;

  var target = ss.getSheetByName(tabName);

  if (mode === "append" && target) {
    var existingData = target.getDataRange().getValues();
    for (var i = 1; i < existingData.length; i++) {
      var title = existingData[i][1] || "";
      if (title) {
        existingTitles[title] = true;
        existingRowCount++;
      }
      var sched = existingData[i][5] || "";
      if (sched) {
        var parsed = new Date(String(sched).replace(" ", "T") + ":00");
        if (!isNaN(parsed.getTime()) && (!lastScheduledDate || parsed > lastScheduledDate)) {
          lastScheduledDate = parsed;
        }
      }
    }
    if (!dateInput && lastScheduledDate) {
      startDate = new Date(lastScheduledDate.getTime() + 86400000);
    }
  }

  if (mode === "fresh" || !target) {
    if (target && mode === "fresh") target.clear();
    if (!target) target = ss.insertSheet(tabName);
    target.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight("bold").setBackground(headerColor).setFontColor("#ffffff");
  }

  // --- Step 5: Filter out existing ---
  var newContent = [];
  for (var j = 0; j < allContent.length; j++) {
    var c = allContent[j];
    var titleKey = (c.collection || c.filename) + "_" + formatCode + "_" + c.type;
    if (mode === "append" && existingTitles[titleKey]) continue;
    newContent.push(c);
  }

  // --- Step 6: Build schedule ---
  var schedule = buildFeedHiveSchedule_(startDate, newContent.length, formatCode);

  // --- Step 7: Build rows ---
  var socialAccounts = (FH_CONFIG.FORMAT_ACCOUNTS[formatCode] || []).join(", ");
  var newRows = [];

  for (var k = 0; k < newContent.length; k++) {
    var content = newContent[k];
    var text = buildPostText_(content, "combined", formatCode);
    var titleKey2 = (content.collection || content.filename) + "_" + formatCode + "_" + content.type;

    newRows.push([
      text,                           // Text
      titleKey2,                      // Title
      content.gcsUrl,                 // Media URLs
      content.category || "General",  // Labels
      socialAccounts,                 // Social Medias
      schedule[k] || ""               // Scheduled
    ]);
  }

  // --- Step 8: Write to sheet ---
  if (newRows.length > 0) {
    var writeRow = (mode === "fresh") ? 2 : existingRowCount + 2;
    target.getRange(writeRow, 1, newRows.length, headers.length).setValues(newRows);
  }

  target.setFrozenRows(1);
  for (var col = 1; col <= headers.length; col++) target.autoResizeColumn(col);

  // --- Summary ---
  var totalRows = (mode === "fresh") ? newRows.length : existingRowCount + newRows.length;
  var montageCount = 0;
  var clipCount = 0;
  for (var m = 0; m < newContent.length; m++) {
    if (newContent[m].type === "Montage") montageCount++;
    else clipCount++;
  }

  // Build friendly account display with daily limits
  var accountDisplay = "";
  var acctList = FH_CONFIG.FORMAT_ACCOUNTS[formatCode] || [];
  var acctMap = {
    "Stockflowmedia - Nmediaservices":  "YouTube (Stockflowmedia - Nmediaservices): 3/day",
    "stockflow.media - Nmedia.services":"Instagram (stockflow.media - Nmedia.services): 3/day",
    "Nmediaservices: Stockflow.media":  "LinkedIn (Nmediaservices: Stockflow.media): 2/day",
    "Nmediaservices.com":               "LinkedIn Blog (Nmediaservices.com): 2/day",
    "Nmediaservices":                   "Facebook (Nmediaservices): 3/day",
    "Stockflow.media":                  "X/Twitter (Stockflow.media): 3/day"
  };
  for (var a = 0; a < acctList.length; a++) {
    var friendly = acctMap[acctList[a]] || acctList[a];
    accountDisplay += "  • " + friendly + "\n";
  }

  var msg = "FeedHive Export (" + formatCode + ") Generated!\n\n";
  msg += "Mode: " + mode + "\n";
  msg += "Montages: " + montageCount + "\n";
  msg += "Clips: " + clipCount + "\n";
  msg += "New rows added: " + newRows.length + "\n";
  msg += "Total rows in sheet: " + totalRows + "\n\n";
  msg += "Posting to:\n" + accountDisplay + "\n";
  msg += "Schedule starts: " + (schedule[0] || "N/A");

  Logger.log(msg);
  ui.alert(msg);
}

// ============================================================
// PINTEREST CSV GENERATOR (V format only)
// ============================================================
function generatePinterestTab_() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = readControlPanel_();

  // --- Step 1: Mode selection ---
  var modeResponse = ui.alert(
    "Pinterest Export (V)",
    "Choose mode:\n\nYES = Fresh (overwrite)\nNO = Append (add new only)",
    ui.ButtonSet.YES_NO_CANCEL
  );
  if (modeResponse === ui.Button.CANCEL) return;
  var mode = (modeResponse === ui.Button.YES) ? "fresh" : "append";

  // --- Step 2: Start date ---
  var tomorrow = new Date(Date.now() + 86400000);
  var defaultStr = Utilities.formatDate(tomorrow, Session.getScriptTimeZone(), "yyyy-MM-dd");
  var dateResponse = ui.prompt("Pinterest Schedule",
    "Start date (YYYY-MM-DD):\n\nDefault: " + defaultStr + "\n5 pins/day",
    ui.ButtonSet.OK_CANCEL);
  if (dateResponse.getSelectedButton() !== ui.Button.OK) return;
  var dateInput = dateResponse.getResponseText().trim();
  var startDate = dateInput ? new Date(dateInput + "T00:00:00") : tomorrow;
  if (isNaN(startDate.getTime())) { ui.alert("Invalid date."); return; }

  // --- Step 3: Gather V content ---
  var allContent = gatherAllContent_("V", settings);
  if (allContent.length === 0) {
    ui.alert("No V format content found.");
    return;
  }

  // --- Step 4: Pinterest CSV headers (matches Pinterest bulk upload spec) ---
  var headers = ["Title", "Media URL", "Pinterest board", "Thumbnail",
                 "Description", "Link", "Publish date", "Keywords"];
  var tabName = "Pinterest Export (V)";
  var target = ss.getSheetByName(tabName);

  var existingTitles = {};
  var existingRowCount = 0;

  if (mode === "append" && target) {
    var existingData = target.getDataRange().getValues();
    for (var i = 1; i < existingData.length; i++) {
      var title = existingData[i][0] || "";
      if (title) {
        existingTitles[title] = true;
        existingRowCount++;
      }
    }
  }

  if (mode === "fresh" || !target) {
    if (target && mode === "fresh") target.clear();
    if (!target) target = ss.insertSheet(tabName);
    target.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight("bold").setBackground("#E60023").setFontColor("#ffffff");
  }

  // --- Step 5: Filter and build rows ---
  var newContent = [];
  for (var j = 0; j < allContent.length; j++) {
    var c = allContent[j];
    var pinTitle = buildPinterestTitle_(c);
    if (mode === "append" && existingTitles[pinTitle]) continue;
    newContent.push(c);
  }

  var schedule = buildPinterestSchedule_(startDate, newContent.length);
  var newRows = [];

  for (var k = 0; k < newContent.length; k++) {
    var content = newContent[k];
    var title = buildPinterestTitle_(content);
    var description = buildPinterestDescription_(content);
    var board = getPinterestBoard_(content.category, content.subcategory);
    var keywords = buildPinterestKeywords_(content);

    newRows.push([
      title,                              // Title (100 chars max)
      content.gcsUrl,                     // Media URL
      board,                              // Pinterest board
      FH_CONFIG.PINTEREST.THUMBNAIL,      // Thumbnail (00:02)
      description,                        // Description (500 chars max)
      content.stockflowUrl,               // Link (backlink to stockflow.media)
      schedule[k] || "",                  // Publish date
      keywords                            // Keywords
    ]);
  }

  // --- Step 6: Write ---
  if (newRows.length > 0) {
    var writeRow = (mode === "fresh") ? 2 : existingRowCount + 2;
    target.getRange(writeRow, 1, newRows.length, headers.length).setValues(newRows);
  }

  target.setFrozenRows(1);
  for (var col = 1; col <= headers.length; col++) target.autoResizeColumn(col);

  // --- Summary ---
  var boardsUsed = {};
  for (var b = 0; b < newRows.length; b++) {
    boardsUsed[newRows[b][2]] = true;
  }

  var msg = "Pinterest Export (V) Generated!\n\n";
  msg += "Mode: " + mode + "\n";
  msg += "Pins created: " + newRows.length + "\n";
  msg += "Total pins: " + ((mode === "fresh") ? newRows.length : existingRowCount + newRows.length) + "\n";
  msg += "Schedule: 5 pins/day starting " + (schedule[0] || "N/A") + "\n";
  msg += "Boards: " + Object.keys(boardsUsed).join(", ");

  Logger.log(msg);
  ui.alert(msg);
}

// ============================================================
// PINTEREST TEXT BUILDERS
// ============================================================
function buildPinterestTitle_(content) {
  var name = content.collection.replace(/_/g, " ").replace(/-/g, " ");
  var cat = content.category.replace(/_/g, " ");
  var title = name + " Stock Footage | " + cat;
  if (content.type === "Clip") title = name + " | " + cat + " Stock Video";
  if (title.length > 100) title = title.substring(0, 97) + "...";
  return title;
}

function buildPinterestDescription_(content) {
  var name = content.collection.replace(/_/g, " ").replace(/-/g, " ");
  var cat = content.category.replace(/_/g, " ");
  var sub = content.subcategory.replace(/_/g, " ");

  var desc = "Download premium " + name.toLowerCase() + " stock footage — ";
  desc += "4K video & 8K images. ";
  if (sub) desc += "Part of our " + sub + " collection. ";
  desc += "Royalty-free, no attribution required. ";
  desc += "Perfect for content creators, filmmakers, and designers. ";
  desc += "Instant download at stockflow.media";

  if (content.description) {
    desc = content.description.substring(0, 300) + " | " + desc;
  }

  if (desc.length > 500) desc = desc.substring(0, 497) + "...";
  return desc;
}

function buildPinterestKeywords_(content) {
  var kw = [];

  // From sheet data
  if (content.keywords) {
    kw = kw.concat(content.keywords.split(",").map(function(k) { return k.trim(); }).filter(Boolean));
  }
  if (content.tags) {
    kw = kw.concat(content.tags.split(",").map(function(t) { return t.trim(); }).filter(Boolean));
  }

  // Base keywords
  var cat = (content.category || "").toLowerCase();
  kw.push("stock footage", "royalty free", "4k video", "8k images");
  kw.push(content.collection.replace(/-/g, " ").toLowerCase());
  if (content.subcategory) kw.push(content.subcategory.replace(/-/g, " ").toLowerCase());

  if (cat.indexOf("microscop") !== -1) {
    kw.push("microscopy", "science", "biology", "microscope", "cell biology");
  } else if (cat.indexOf("food") !== -1) {
    kw.push("food photography", "culinary", "restaurant", "food video", "recipe");
  }

  // Deduplicate
  var unique = [];
  var seen = {};
  for (var i = 0; i < kw.length; i++) {
    var clean = kw[i].toLowerCase().trim();
    if (clean && !seen[clean]) {
      seen[clean] = true;
      unique.push(clean);
    }
  }

  return unique.join(", ");
}
