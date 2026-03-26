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
    "W": 2,   // LinkedIn bottleneck
    "S": 3,   // Instagram bottleneck
    "V": 3    // TikTok bottleneck
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
  CONTENT_PRIORITY: ["Montages", "Clips", "UGC"]
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

// ============================================================
// CORE: GATHER ALL CONTENT (Montages + Clips)
// ============================================================
function gatherAllContent_(formatCode) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var allContent = [];

  // --- 1. Montages from Content Library ---
  var lib = ss.getSheetByName("Content Library");
  if (lib) {
    var libData = lib.getDataRange().getValues();
    var LC = CONFIG.LIB_COL;
    var seen = {};

    for (var i = 1; i < libData.length; i++) {
      var r = libData[i];
      var fmt = (r[LC.FORMAT] || "").toUpperCase();
      if (fmt !== formatCode) continue;

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
  try {
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
  var allContent = gatherAllContent_(formatCode);
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

  var msg = "FeedHive Export (" + formatCode + ") Generated!\n\n";
  msg += "Mode: " + mode + "\n";
  msg += "Montages: " + montageCount + "\n";
  msg += "Clips: " + clipCount + "\n";
  msg += "New rows added: " + newRows.length + "\n";
  msg += "Total rows in sheet: " + totalRows + "\n";
  msg += "Social accounts: " + socialAccounts + "\n";
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
  var allContent = gatherAllContent_("V");
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
