/**
 * FeedHive Generator — Per-Platform Optimized Posts
 * ==================================================
 * Separate Apps Script file for generating FeedHive CSV-ready sheets.
 * Each collection gets ONE ROW PER PLATFORM with:
 *   - Custom text tailored to platform character limits
 *   - Custom hashtags aggregated from original data source
 *   - Platform-specific social account name
 *   - Smart scheduling with platform daily limits
 *
 * Lives in same project as Code.gs — shares CONFIG, menu, spreadsheet.
 */

// ============================================================
// FEEDHIVE CONFIGURATION
// ============================================================

// Original data source (for tag aggregation)
const ORIGINAL_DATA_URL = "https://docs.google.com/spreadsheets/d/12eyXAI9-hT0TFSx2HhVDUWHXo4X9QVT-vSPmGQBx6c8/export?format=csv&gid=65282458";

// FeedHive Social Account names (must match FeedHive exactly)
const FH_ACCOUNTS = {
  "youtube":   "Stockflowmedia - Nmediaservices",
  "instagram": "stockflow.media - Nmedia.services",
  "linkedin":  "Nmediaservices: Stockflow.media",
  "facebook":  "Nmediaservices",
  "tiktok":    "Stockflow.media",
  "pinterest": "nmediananda",
  "x":         "Stockflow.media"
};

// Format → Platform mapping
const FH_FORMAT_PLATFORMS = {
  "W": ["x", "linkedin", "facebook"],
  "S": ["instagram", "facebook", "linkedin", "x"],
  "V": ["tiktok", "pinterest", "instagram", "facebook", "linkedin", "x", "youtube"]
};

// Platform limits and optimal posting times
const FH_PLATFORM_CONFIG = {
  "x":         { maxChars: 280,  maxTags: 3,  dailyLimit: 5, times: ["07:00","10:00","13:00","16:00","19:00"] },
  "linkedin":  { maxChars: 3000, maxTags: 5,  dailyLimit: 2, times: ["08:30","12:00"] },
  "instagram": { maxChars: 2200, maxTags: 25, dailyLimit: 3, times: ["09:00","13:00","18:00"] },
  "facebook":  { maxChars: 5000, maxTags: 5,  dailyLimit: 3, times: ["10:00","14:00","19:00"] },
  "tiktok":    { maxChars: 2200, maxTags: 8,  dailyLimit: 3, times: ["08:00","12:30","19:00"] },
  "pinterest": { maxChars: 500,  maxTags: 15, dailyLimit: 5, times: ["09:00","11:00","14:00","17:00","20:00"] },
  "youtube":   { maxChars: 100,  maxTags: 8,  dailyLimit: 2, times: ["10:00","16:00"] }
};

// Base tags always included
const FH_BASE_TAGS = ["stockfootage", "royaltyfree", "stockvideo"];

// Platform-specific trending/boost tags
const FH_TRENDING_TAGS = {
  "tiktok":    ["fyp", "viral", "4k"],
  "instagram": ["4kvideo", "8kimages", "videography", "filmmaking", "contentcreator", "digitalart"],
  "youtube":   ["shorts", "4k"],
  "pinterest": ["aesthetic", "inspiration", "creative"],
  "x":         [],
  "linkedin":  ["videoproduction", "contentmarketing"],
  "facebook":  ["videocontent"]
};

// ============================================================
// TAG AGGREGATION (from original data source)
// ============================================================

/**
 * Fetch and aggregate tags from the original data sheet.
 * Groups by Sub (collection name), combines Tags + Keywords columns.
 * Caches in script properties for 24h to avoid repeated fetches.
 */
function fetchCollectionTags_() {
  const props = PropertiesService.getScriptProperties();
  const cacheKey = "FH_TAGS_CACHE";
  const cacheTimeKey = "FH_TAGS_CACHE_TIME";

  // Check cache (valid for 24 hours)
  const cachedTime = props.getProperty(cacheTimeKey);
  if (cachedTime) {
    const age = Date.now() - parseInt(cachedTime);
    if (age < 24 * 60 * 60 * 1000) {
      const cached = props.getProperty(cacheKey);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (e) {
          Logger.log("Cache parse error, refetching...");
        }
      }
    }
  }

  Logger.log("Fetching tags from original data source...");
  const response = UrlFetchApp.fetch(ORIGINAL_DATA_URL, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    Logger.log("Failed to fetch original data: " + response.getResponseCode());
    return {};
  }

  const csvData = response.getContentText();
  const rows = Utilities.parseCsv(csvData);
  const headers = rows[0];

  // Find column indices
  const colSub = headers.indexOf("Sub");
  const colTags = headers.indexOf("Tags");
  const colKeywords = headers.indexOf("Keywords");
  const colDescription = headers.indexOf("Description");
  const colCategory = headers.indexOf("Category");
  const colCategorySub = headers.indexOf("Catagory_Sub") !== -1 ? headers.indexOf("Catagory_Sub") : headers.indexOf("Category_Sub");

  if (colSub === -1) {
    Logger.log("Sub column not found!");
    return {};
  }

  const tagMap = {};  // collection → { tags: Set, descriptions: [], category, subcategory }

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sub = (r[colSub] || "").trim();
    if (!sub) continue;

    if (!tagMap[sub]) {
      tagMap[sub] = { tags: {}, descriptions: [], category: "", subcategory: "" };
    }

    // Aggregate tags + keywords
    const tagStr = (colTags !== -1 ? r[colTags] || "" : "") + ", " + (colKeywords !== -1 ? r[colKeywords] || "" : "");
    const tagParts = tagStr.split(",");
    for (let t = 0; t < tagParts.length; t++) {
      const tag = tagParts[t].trim().toLowerCase().replace(/\s+/g, "");
      if (tag && tag.length > 2 && tag.length < 40) {
        tagMap[sub].tags[tag] = true;
      }
    }

    // Collect first description
    if (colDescription !== -1 && tagMap[sub].descriptions.length < 2) {
      const desc = (r[colDescription] || "").trim();
      if (desc && desc.length > 20) {
        tagMap[sub].descriptions.push(desc.substring(0, 200));
      }
    }

    // Category info
    if (colCategory !== -1 && !tagMap[sub].category) {
      tagMap[sub].category = (r[colCategory] || "").trim();
    }
    if (colCategorySub !== -1 && !tagMap[sub].subcategory) {
      tagMap[sub].subcategory = (r[colCategorySub] || "").trim();
    }
  }

  // Convert to serializable format
  const result = {};
  for (const sub in tagMap) {
    result[sub] = {
      tags: Object.keys(tagMap[sub].tags).sort(),
      tagCount: Object.keys(tagMap[sub].tags).length,
      description: tagMap[sub].descriptions[0] || "",
      category: tagMap[sub].category,
      subcategory: tagMap[sub].subcategory
    };
  }

  // Cache it (script properties has 500KB limit, so we compress)
  try {
    const jsonStr = JSON.stringify(result);
    if (jsonStr.length < 450000) {
      props.setProperty(cacheKey, jsonStr);
      props.setProperty(cacheTimeKey, String(Date.now()));
      Logger.log("Tags cached: " + Object.keys(result).length + " collections, " + jsonStr.length + " bytes");
    } else {
      Logger.log("Tags too large to cache: " + jsonStr.length + " bytes");
    }
  } catch (e) {
    Logger.log("Cache save error: " + e.message);
  }

  Logger.log("Loaded tags for " + Object.keys(result).length + " collections");
  return result;
}

/**
 * Force refresh the tag cache
 */
function refreshTagCache() {
  PropertiesService.getScriptProperties().deleteProperty("FH_TAGS_CACHE");
  PropertiesService.getScriptProperties().deleteProperty("FH_TAGS_CACHE_TIME");
  const tags = fetchCollectionTags_();
  SpreadsheetApp.getUi().alert("Tag cache refreshed!\n\nCollections: " + Object.keys(tags).length);
}

// ============================================================
// PER-PLATFORM TAG SELECTION
// ============================================================

/**
 * Pick optimized tags for a specific platform from the tag pool
 */
function getTagsForPlatform_(collectionName, platform, allTags) {
  const config = FH_PLATFORM_CONFIG[platform];
  const maxTags = config.maxTags;

  const tagData = allTags[collectionName] || {};
  const available = tagData.tags || [];

  // Build tag list: base → trending → category → collection-specific
  const selected = [];
  const seen = {};

  function addTag(t) {
    const clean = t.replace(/[^a-z0-9]/g, "").toLowerCase();
    if (clean && clean.length > 2 && !seen[clean]) {
      seen[clean] = true;
      selected.push(clean);
    }
  }

  // 1. Base tags
  for (const t of FH_BASE_TAGS) addTag(t);

  // 2. Platform trending tags
  const trending = FH_TRENDING_TAGS[platform] || [];
  for (const t of trending) addTag(t);

  // 3. Category + subcategory
  if (tagData.category) addTag(tagData.category.replace(/[- &]/g, ""));
  if (tagData.subcategory) addTag(tagData.subcategory.replace(/[- &]/g, ""));

  // 4. Collection name as tag
  addTag(collectionName.replace(/[- _]/g, ""));

  // 5. Fill from collection tag pool
  for (const t of available) {
    if (selected.length >= maxTags) break;
    addTag(t);
  }

  return selected.slice(0, maxTags);
}

// ============================================================
// PER-PLATFORM TEXT BUILDERS
// ============================================================

function buildPostText_(collectionData, platform, tags, allTags) {
  const config = FH_PLATFORM_CONFIG[platform];
  const name = collectionData.collection.replace(/_/g, " ");
  const url = collectionData.stockflowUrl;
  const helpUrl = collectionData.helpUrl;
  const category = collectionData.category;

  const tagData = allTags[collectionData.collection] || {};
  const desc = tagData.description || "";

  const hashtags = tags.map(function(t) { return "#" + t; }).join(" ");

  var text = "";

  switch (platform) {
    case "x":
      text = name + " — Premium stock footage.\nRoyalty-free, instant download.\n" + url;
      var remaining = 280 - text.length - 1;
      if (remaining > hashtags.length) {
        text += "\n" + hashtags;
      } else if (remaining > 15) {
        text += "\n" + tags.slice(0, 2).map(function(t) { return "#" + t; }).join(" ");
      }
      if (text.length > 280) text = text.substring(0, 277) + "...";
      break;

    case "linkedin":
      text = name + " — Premium Stock Footage Collection\n\n";
      if (desc) text += desc + "\n\n";
      text += "This collection features professionally captured " + category.toLowerCase() + " footage available in 4K video and 8K images.\n\n";
      text += "All assets are royalty-free with no attribution required.\n\n";
      text += "Browse & License: " + url + "\n";
      if (helpUrl) text += "Collection Details: " + helpUrl + "\n";
      text += "\n" + hashtags;
      break;

    case "instagram":
      text = name + "\n\n";
      if (desc) text += desc + "\n\n";
      text += "Premium " + category.toLowerCase() + " stock footage & images.\n";
      text += "4K video | 8K images | Royalty-free\n\n";
      text += "Link in bio or visit stockflow.media\n\n";
      text += hashtags;
      if (text.length > 2200) text = text.substring(0, 2197) + "...";
      break;

    case "facebook":
      text = "New collection added: " + name + "\n\n";
      if (desc) text += desc + "\n\n";
      text += "Browse the full " + name + " collection — 4K video and 8K images, royalty-free.\n\n";
      text += url + "\n\n";
      text += hashtags;
      break;

    case "tiktok":
      text = name + " — Stock footage you need\n";
      text += "4K quality | Royalty-free | Instant download\n\n";
      text += url + "\n\n";
      text += hashtags;
      if (text.length > 2200) text = text.substring(0, 2197) + "...";
      break;

    case "pinterest":
      text = name + " — Premium " + category.toLowerCase() + " stock footage and images.\n";
      text += "Download royalty-free 4K video and 8K images.\n";
      text += "Perfect for content creators, filmmakers, and designers.\n";
      text += url + "\n\n";
      text += hashtags;
      if (text.length > 500) text = text.substring(0, 497) + "...";
      break;

    case "youtube":
      text = name + " | " + category + " Stock Footage #shorts\n";
      text += hashtags;
      if (text.length > 100) {
        text = name + " #shorts " + tags.slice(0, 3).map(function(t) { return "#" + t; }).join(" ");
      }
      break;

    default:
      text = name + " — Stock footage. " + url + "\n" + hashtags;
  }

  return text;
}

// ============================================================
// SCHEDULE BUILDER
// ============================================================

function buildFhSchedule_(startDate, totalCollections, platforms) {
  // Find bottleneck platform (fewest daily slots)
  var minSlots = Infinity;
  var bestTimes = ["09:00", "13:00"];

  for (var p = 0; p < platforms.length; p++) {
    var config = FH_PLATFORM_CONFIG[platforms[p]];
    if (config && config.dailyLimit < minSlots) {
      minSlots = config.dailyLimit;
      bestTimes = config.times.slice(0, config.dailyLimit);
    }
  }

  var schedule = [];
  var dayOffset = 0;
  var slotIndex = 0;

  for (var i = 0; i < totalCollections; i++) {
    var d = new Date(startDate.getTime() + dayOffset * 86400000);
    var dateStr = d.getFullYear() + "-" +
      ("0" + (d.getMonth() + 1)).slice(-2) + "-" +
      ("0" + d.getDate()).slice(-2) + " " +
      bestTimes[slotIndex];
    schedule.push(dateStr);

    slotIndex++;
    if (slotIndex >= bestTimes.length) {
      slotIndex = 0;
      dayOffset++;
    }
  }

  return schedule;
}

// ============================================================
// MAIN GENERATOR
// ============================================================

/**
 * Core generator: reads Content Library + tags, outputs per-platform rows
 */
function generateFeedHiveTab_(formatCode, tabName, headerColor, startDate, mode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lib = ss.getSheetByName(CONFIG.CONTENT_LIBRARY_SHEET);
  if (!lib) return { error: "Content Library tab not found!" };

  const platforms = FH_FORMAT_PLATFORMS[formatCode];
  if (!platforms) return { error: "Unknown format: " + formatCode };

  // Fetch tags from original data
  const allTags = fetchCollectionTags_();

  const fhHeaders = ["Text", "Title", "Media URLs", "Labels", "Social Medias", "Scheduled"];

  // Handle append mode — track existing collections
  const existingCollections = {};
  var existingRowCount = 0;
  var lastScheduledDate = null;
  var target = ss.getSheetByName(tabName);

  if (mode === "append" && target) {
    const existingData = target.getDataRange().getValues();
    for (var i = 1; i < existingData.length; i++) {
      const title = existingData[i][1] || "";
      if (title) {
        // Extract collection name from title (format: CollectionName_W_platform)
        const collName = title.replace(/_[WSV]_[a-z]+$/i, "").replace(/_[WSV]$/, "");
        existingCollections[collName] = true;
        existingRowCount++;
      }
      const sched = existingData[i][5] || "";
      if (sched) {
        const parsed = new Date(String(sched).replace(" ", "T") + ":00");
        if (!isNaN(parsed.getTime()) && (!lastScheduledDate || parsed > lastScheduledDate)) {
          lastScheduledDate = parsed;
        }
      }
    }
  }

  // Fresh mode: clear or create sheet
  if (mode === "fresh" || !target) {
    if (target && mode === "fresh") target.clear();
    if (!target) target = ss.insertSheet(tabName);
    target.getRange(1, 1, 1, fhHeaders.length).setValues([fhHeaders])
      .setFontWeight("bold").setBackground(headerColor).setFontColor("#ffffff");
  }

  // Effective start date
  var effectiveStartDate = startDate ||
    (mode === "append" && lastScheduledDate ? new Date(lastScheduledDate.getTime() + 86400000) :
     new Date(Date.now() + 86400000));

  // Read Content Library
  const data = lib.getDataRange().getValues();
  const LC = CONFIG.LIB_COL;
  const collectionData = [];
  const seen = {};

  for (var i = 1; i < data.length; i++) {
    const r = data[i];
    while (r.length < 19) r.push("");
    if ((r[LC.FORMAT] || "") !== formatCode) continue;
    const collection = r[LC.COLLECTION] || "";
    if (seen[collection]) continue;
    if (mode === "append" && existingCollections[collection]) continue;
    seen[collection] = true;

    collectionData.push({
      collection: collection,
      subcategory: r[LC.SUBCATEGORY] || "",
      category: r[LC.CATEGORY] || "",
      driveFileId: r[LC.DRIVE_FILE_ID] || "",
      stockflowUrl: r[LC.STOCKFLOW_URL] || "https://stockflow.media",
      helpUrl: r[LC.HELP_URL] || ""
    });
  }

  // Build schedule (one slot per collection, all platforms share the time)
  const schedule = buildFhSchedule_(effectiveStartDate, collectionData.length, platforms);

  // Generate rows: one per collection per platform
  const newRows = [];
  var tagStats = {};

  for (var c = 0; c < collectionData.length; c++) {
    const coll = collectionData[c];
    const schedTime = schedule[c] || "";

    for (var p = 0; p < platforms.length; p++) {
      const platform = platforms[p];
      const tags = getTagsForPlatform_(coll.collection, platform, allTags);
      const text = buildPostText_(coll, platform, tags, allTags);
      const account = FH_ACCOUNTS[platform] || "";

      const mediaUrl = coll.driveFileId ?
        "https://drive.usercontent.google.com/download?id=" + coll.driveFileId : "";

      newRows.push([
        text,
        coll.collection + "_" + formatCode + "_" + platform,
        mediaUrl,
        coll.category || "General",
        account,
        schedTime
      ]);

      // Track tag stats
      if (!tagStats[platform]) tagStats[platform] = { total: 0, count: 0 };
      tagStats[platform].total += tags.length;
      tagStats[platform].count++;
    }
  }

  // Write rows
  if (newRows.length > 0) {
    const startRow = mode === "fresh" ? 2 : existingRowCount + 2;
    target.getRange(startRow, 1, newRows.length, fhHeaders.length).setValues(newRows);
  }

  target.setFrozenRows(1);
  for (var col = 1; col <= fhHeaders.length; col++) target.autoResizeColumn(col);

  // Build tag stats string
  var tagStatsStr = "";
  for (var plat in tagStats) {
    var avg = Math.round(tagStats[plat].total / tagStats[plat].count);
    tagStatsStr += "\n  " + plat + ": " + avg + " avg tags/post";
  }

  return {
    count: mode === "fresh" ? newRows.length : existingRowCount + newRows.length,
    newCount: newRows.length,
    existingCount: existingRowCount,
    collections: collectionData.length,
    platforms: platforms.length,
    mode: mode,
    effectiveStartDate: effectiveStartDate,
    tagStats: tagStatsStr
  };
}

// ============================================================
// PROMPT & MENU FUNCTIONS
// ============================================================

function promptFeedHiveOptions_(formatLabel) {
  const ui = SpreadsheetApp.getUi();
  const modeResponse = ui.alert(
    "FeedHive — " + formatLabel,
    "Choose mode:\n\nYES = Append (add new collections only)\nNO = Total Refresh (overwrite)\nCANCEL = Cancel",
    ui.ButtonSet.YES_NO_CANCEL
  );
  if (modeResponse === ui.Button.CANCEL) return null;
  const mode = modeResponse === ui.Button.YES ? "append" : "fresh";

  const tomorrow = new Date(Date.now() + 86400000);
  const defaultStr = Utilities.formatDate(tomorrow, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const datePromptText = mode === "append" ?
    "Enter start date for NEW posts (YYYY-MM-DD):\n\nLeave blank = continue from last scheduled date." :
    "Enter start date for posting (YYYY-MM-DD):\n\nDefault: " + defaultStr + "\nLeave blank to use tomorrow.";

  const response = ui.prompt("FeedHive Schedule", datePromptText, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return null;
  const input = response.getResponseText().trim();

  if (!input) return { startDate: mode === "fresh" ? tomorrow : null, mode: mode };
  const startDate = new Date(input + "T00:00:00");
  if (isNaN(startDate.getTime())) { ui.alert("Invalid date format."); return null; }
  return { startDate: startDate, mode: mode };
}

function generateFeedHiveSheetW() {
  const opts = promptFeedHiveOptions_("Wide (W)");
  if (!opts) return;
  const result = generateFeedHiveTab_("W", "FeedHive Export (W)", "#2a9d8f", opts.startDate, opts.mode);
  if (result.error) return SpreadsheetApp.getUi().alert(result.error);
  SpreadsheetApp.getUi().alert(
    "FeedHive Export (W) — Per-Platform Generated!\n\n" +
    "Collections: " + result.collections + "\n" +
    "Platforms: " + result.platforms + "\n" +
    "Total rows: " + result.newCount + " (new)\n" +
    "Mode: " + result.mode + "\n" +
    "\nTag density:" + result.tagStats
  );
}

function generateFeedHiveSheetS() {
  const opts = promptFeedHiveOptions_("Square (S)");
  if (!opts) return;
  const result = generateFeedHiveTab_("S", "FeedHive Export (S)", "#e8710a", opts.startDate, opts.mode);
  if (result.error) return SpreadsheetApp.getUi().alert(result.error);
  SpreadsheetApp.getUi().alert(
    "FeedHive Export (S) — Per-Platform Generated!\n\n" +
    "Collections: " + result.collections + "\n" +
    "Platforms: " + result.platforms + "\n" +
    "Total rows: " + result.newCount + " (new)\n" +
    "Mode: " + result.mode + "\n" +
    "\nTag density:" + result.tagStats
  );
}

function generateFeedHiveSheetV() {
  const opts = promptFeedHiveOptions_("Vertical (V)");
  if (!opts) return;
  const result = generateFeedHiveTab_("V", "FeedHive Export (V)", "#9334e8", opts.startDate, opts.mode);
  if (result.error) return SpreadsheetApp.getUi().alert(result.error);
  SpreadsheetApp.getUi().alert(
    "FeedHive Export (V) — Per-Platform Generated!\n\n" +
    "Collections: " + result.collections + "\n" +
    "Platforms: " + result.platforms + "\n" +
    "Total rows: " + result.newCount + " (new)\n" +
    "Mode: " + result.mode + "\n" +
    "\nTag density:" + result.tagStats
  );
}
