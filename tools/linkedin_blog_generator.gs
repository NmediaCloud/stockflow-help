/**
 * Stockflow LinkedIn Blog Generator — Apps Script
 * Generates professional article-style posts for LinkedIn (Nmediaservices.com)
 * Separate from FeedHive social posts — unique content angle
 *
 * Data source: Original Stockfootage sheet (clip descriptions + tags)
 * Output: "LinkedIn Blog Export" sheet tab → CSV for FeedHive
 * Account: Nmediaservices.com (LinkedIn Blog)
 *
 * Content is UNIQUE from:
 *   - Help pages (detailed collection reference)
 *   - WordPress (short promotional with YouTube embed)
 *   - FeedHive social posts (short captions with hashtags)
 */

// ============================================================
// LINKEDIN BLOG CONFIGURATION
// ============================================================
const LB_CONFIG = {
  // LinkedIn Blog account in FeedHive
  ACCOUNT_NAME: "Nmediaservices.com",

  // GCS base URL for video
  GCS_BASE: "https://storage.googleapis.com/stockflow-social",
  DEFAULT_BATCH: "Batch01",

  // Stockflow URLs
  STOCKFLOW_BASE: "https://stockflow.media/",
  HELP_BASE: "https://help.stockflow.media/collections/",

  // Original data sheet for clip descriptions
  DATA_SHEET_ID: "12eyXAI9-hT0TFSx2HhVDUWHXo4X9QVT-vSPmGQBx6c8",
  DATA_TAB_GID: "926087255",  // Stockflow-social_Batch01

  // Daily limit (from Control Panel, fallback)
  DEFAULT_DAILY_LIMIT: 2,

  // Post times
  POST_TIMES: ["08:30", "17:00"],

  // Only W format for LinkedIn Blog articles
  FORMAT: "W"
};

// ============================================================
// INDUSTRY TEMPLATES — Unique professional angle per category
// ============================================================
const INDUSTRY_TEMPLATES = {
  "Microscopic": {
    industries: ["science communication", "documentary production", "medical education", "academic research"],
    context: "In science communication and documentary filmmaking, the difference between amateur and broadcast-quality output often comes down to one thing: authentic, high-resolution microscopic visuals. Professional-grade microscopy footage is notoriously difficult and expensive to capture independently, requiring specialized equipment and expertise that most production teams simply don't have access to.",
    audience: [
      "Documentary filmmakers seeking authentic B-roll for science and nature productions",
      "Science educators creating engaging lecture content and online courses",
      "Medical professionals building training materials and patient education resources",
      "Corporate teams producing pharmaceutical and biotech marketing content",
      "YouTube creators covering science, biology, and technology topics",
      "Museum and exhibition designers creating immersive visual displays"
    ],
    workflow: "Import the 4K MP4 files directly into your NLE timeline — Premiere Pro, DaVinci Resolve, or Final Cut Pro. The footage works exceptionally well as B-roll overlays with transparency blending. For presentations and educational materials, the 8K JPEG images drop directly into PowerPoint, Google Slides, or Canva at full resolution without quality loss.",
    differentiator: "Every clip in this collection was captured using professional-grade microscopy equipment with precise color calibration. Unlike generic stock footage, these assets maintain scientific accuracy while delivering cinematic visual quality — making them suitable for both educational and commercial applications."
  },
  "Food & Beverage": {
    industries: ["restaurant marketing", "food media production", "hospitality branding", "culinary content creation"],
    context: "In the food and hospitality industry, visual content drives purchasing decisions. Studies show that 72% of diners choose restaurants based on food photography, and social media engagement for food brands correlates directly with visual quality. Professional food footage has become essential infrastructure for any serious food business.",
    audience: [
      "Restaurant chains and hospitality brands building marketing campaigns",
      "Food bloggers and YouTube creators producing recipe and review content",
      "Advertising agencies developing campaigns for food and beverage clients",
      "Delivery app platforms needing high-quality menu visuals",
      "Social media managers running food brand accounts across platforms",
      "Cookbook publishers and editorial teams creating print and digital layouts"
    ],
    workflow: "These assets are shot with cinematic lighting and professional color grading, ready for immediate use. Import MP4 footage into your video editor for social media ads, menu boards, or promotional reels. Use the JPEG images in Canva for social posts, in InDesign for menu printing, or in Photoshop for composite advertising visuals.",
    differentiator: "This collection features carefully styled food photography with consistent lighting and composition across all clips. Each asset maintains a cohesive visual language — making it easy to build a unified brand presence across multiple platforms and materials."
  },
  "default": {
    industries: ["content creation", "digital marketing", "visual media production", "creative design"],
    context: "In today's content-driven landscape, the demand for high-quality visual assets has never been higher. Whether you're producing social media content, building marketing campaigns, or creating educational materials, having access to professional-grade footage and images is no longer optional — it's the baseline for credibility.",
    audience: [
      "Content creators and YouTubers building their visual libraries",
      "Marketing teams producing campaign assets across platforms",
      "Designers creating presentations, posters, and digital layouts",
      "Educators developing course materials and training resources",
      "Filmmakers and editors seeking specialized B-roll footage",
      "Social media managers maintaining consistent posting schedules"
    ],
    workflow: "All assets are delivered in industry-standard formats. MP4 video files import directly into any major editing platform. JPEG images work across all design tools from Canva to Adobe Creative Suite. Multiple aspect ratios (16:9, 9:16, 1:1) ensure compatibility with every platform and use case.",
    differentiator: "These assets are professionally produced with consistent quality standards across the entire collection. Royalty-free licensing with no attribution required means you can use them freely across all commercial and personal projects without restrictions."
  }
};

// ============================================================
// MENU ITEM
// ============================================================
function generateLinkedInBlogExport() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Read Control Panel for settings
  var settings = null;
  try { settings = readControlPanel_(); } catch(e) { settings = null; }

  // Check if LinkedIn Blog is enabled in Control Panel
  var dailyLimit = LB_CONFIG.DEFAULT_DAILY_LIMIT;
  if (settings && settings.platforms["LinkedIn Blog"]) {
    if (!settings.platforms["LinkedIn Blog"].enabled) {
      ui.alert("LinkedIn Blog (Nmediaservices.com) is disabled in Control Panel.");
      return;
    }
    dailyLimit = settings.platforms["LinkedIn Blog"].limit || dailyLimit;
  }

  // --- Step 1: Mode ---
  var modeResponse = ui.alert(
    "LinkedIn Blog Export",
    "Professional articles for Nmediaservices.com\n\n" +
    "YES = Fresh (overwrite)\nNO = Append (add new only)",
    ui.ButtonSet.YES_NO_CANCEL
  );
  if (modeResponse === ui.Button.CANCEL) return;
  var mode = (modeResponse === ui.Button.YES) ? "fresh" : "append";

  // --- Step 2: Start date ---
  var tomorrow = new Date(Date.now() + 86400000);
  var defaultStr = Utilities.formatDate(tomorrow, Session.getScriptTimeZone(), "yyyy-MM-dd");
  var dateResponse = ui.prompt("Schedule",
    "Start date (YYYY-MM-DD):\n\nDefault: " + defaultStr + "\n" + dailyLimit + " articles/day",
    ui.ButtonSet.OK_CANCEL);
  if (dateResponse.getSelectedButton() !== ui.Button.OK) return;
  var dateInput = dateResponse.getResponseText().trim();
  var startDate = dateInput ? new Date(dateInput + "T00:00:00") : tomorrow;
  if (isNaN(startDate.getTime())) { ui.alert("Invalid date."); return; }

  // --- Step 3: Gather collections from Content Library ---
  var collections = gatherBlogCollections_();
  if (collections.length === 0) {
    ui.alert("No enabled Montage collections found in Content Library.\n\nCheck column C (Enabled) checkboxes.");
    return;
  }

  // --- Step 4: Fetch clip descriptions for enrichment ---
  var clipDescriptions = fetchCollectionDescriptions_();

  // --- Step 5: Handle sheet ---
  var tabName = "LinkedIn Blog Export";
  var headers = ["Entry ID", "Enabled", "Published", "Text", "Title", "Media URLs", "Labels", "Social Medias", "Scheduled", "Batch"];
  var target = ss.getSheetByName(tabName);
  var existingEntryIDs = {};
  var existingRowCount = 0;

  if (mode === "append" && target) {
    var existingData = target.getDataRange().getValues();
    for (var i = 1; i < existingData.length; i++) {
      var entryId = existingData[i][0] || "";
      if (entryId) { existingEntryIDs[entryId] = true; existingRowCount++; }
    }
  }

  if (mode === "fresh" || !target) {
    if (target && mode === "fresh") target.clear();
    if (!target) target = ss.insertSheet(tabName);
    target.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight("bold").setBackground("#0077B5").setFontColor("#ffffff");
  }

  // --- Step 6: Build article rows ---
  var newRows = [];
  var dayOffset = 0;
  var slotIndex = 0;
  var times = LB_CONFIG.POST_TIMES.slice(0, dailyLimit);
  var batchName = LB_CONFIG.DEFAULT_BATCH;

  for (var j = 0; j < collections.length; j++) {
    var coll = collections[j];

    // Entry ID = help URL (unique per collection, never repeats)
    var slug = coll.collection.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    var entryId = LB_CONFIG.HELP_BASE + slug + "/";

    // Skip if already exists
    if (existingEntryIDs[entryId]) continue;

    // Get enrichment data
    var descriptions = clipDescriptions[coll.collection] || [];

    // Build the article
    var article = buildLinkedInArticle_(coll, descriptions);

    // Schedule
    var d = new Date(startDate.getTime() + dayOffset * 86400000);
    var dateStr = d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0") + " " + times[slotIndex % times.length];

    slotIndex++;
    if (slotIndex >= times.length) { slotIndex = 0; dayOffset++; }

    // GCS URL for W format video
    var gcsUrl = LB_CONFIG.GCS_BASE + "/" + batchName + "/Montages/W/" + coll.filename;

    newRows.push([
      entryId,                    // A: Entry ID (help URL — unique key)
      true,                       // B: Enabled (checkbox — checked by default)
      false,                      // C: Published (checkbox — unchecked)
      article.body,               // D: Text (full article)
      article.title,              // E: Title
      gcsUrl,                     // F: Media URLs
      coll.category || "General", // G: Labels
      LB_CONFIG.ACCOUNT_NAME,     // H: Social Medias
      dateStr,                    // I: Scheduled
      batchName                   // J: Batch
    ]);
  }

  // --- Step 7: Write ---
  if (newRows.length > 0) {
    var writeRow = (mode === "fresh") ? 2 : existingRowCount + 2;
    target.getRange(writeRow, 1, newRows.length, headers.length).setValues(newRows);

    // Insert checkboxes for Enabled (B) and Published (C)
    target.getRange(writeRow, 2, newRows.length, 1).insertCheckboxes(); // B: Enabled
    target.getRange(writeRow, 3, newRows.length, 1).insertCheckboxes(); // C: Published
  }

  target.setFrozenRows(1);
  for (var col = 1; col <= headers.length; col++) target.autoResizeColumn(col);
  target.setColumnWidth(1, 300); // Entry ID column wider
  target.setColumnWidth(4, 400); // Text column wider

  // --- Summary ---
  var totalRows = (mode === "fresh") ? newRows.length : existingRowCount + newRows.length;
  var endDate = new Date(startDate.getTime() + dayOffset * 86400000);
  var endDateStr = endDate.getFullYear() + "-" +
    String(endDate.getMonth() + 1).padStart(2, "0") + "-" +
    String(endDate.getDate()).padStart(2, "0");

  var skippedCount = collections.length - newRows.length;

  var msg = "LinkedIn Blog Export Generated!\n\n";
  msg += "Mode: " + mode + "\n";
  msg += "Batch: " + batchName + "\n";
  msg += "New articles: " + newRows.length + "\n";
  if (skippedCount > 0) msg += "Skipped (already in sheet): " + skippedCount + "\n";
  msg += "Total in sheet: " + totalRows + "\n";
  msg += "Account: LinkedIn Blog (Nmediaservices.com): " + dailyLimit + "/day\n\n";
  msg += "Schedule: " + Utilities.formatDate(startDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
  msg += " to " + endDateStr + "\n";
  msg += "Duration: ~" + dayOffset + " days\n\n";
  msg += "Entry ID = Help page URL (unique, no duplicates)\n";
  msg += "Check Published (col C) after FeedHive upload";

  Logger.log(msg);
  ui.alert(msg);
}

// ============================================================
// EXPORT CSV-READY TAB (only unpublished, FeedHive columns only)
// ============================================================
function exportLinkedInBlogCSV() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var source = ss.getSheetByName("LinkedIn Blog Export");

  if (!source) {
    ui.alert("LinkedIn Blog Export sheet not found.\n\nRun 'Generate LinkedIn Blog Export' first.");
    return;
  }

  var data = source.getDataRange().getValues();
  // Source columns: A=EntryID, B=Enabled, C=Published, D=Text, E=Title, F=MediaURLs, G=Labels, H=SocialMedias, I=Scheduled, J=Batch

  var csvHeaders = ["Text", "Title", "Media URLs", "Labels", "Social Medias", "Scheduled"];
  var csvRows = [];

  for (var i = 1; i < data.length; i++) {
    var enabled = data[i][1];     // B: Enabled
    var published = data[i][2];   // C: Published

    // Only include: Enabled = checked AND Published = unchecked
    if (enabled !== true) continue;
    if (published === true) continue;

    csvRows.push([
      data[i][3],   // D: Text
      data[i][4],   // E: Title
      data[i][5],   // F: Media URLs
      data[i][6],   // G: Labels
      data[i][7],   // H: Social Medias
      data[i][8]    // I: Scheduled
    ]);
  }

  if (csvRows.length === 0) {
    ui.alert("No unpublished entries found.\n\nAll enabled rows are already marked as Published.");
    return;
  }

  // Write to CSV-ready tab
  var tabName = "LinkedIn Blog CSV Ready";
  var target = ss.getSheetByName(tabName);
  if (target) target.clear();
  else target = ss.insertSheet(tabName);

  target.getRange(1, 1, 1, csvHeaders.length).setValues([csvHeaders])
    .setFontWeight("bold").setBackground("#0077B5").setFontColor("#ffffff");
  target.getRange(2, 1, csvRows.length, csvHeaders.length).setValues(csvRows);

  target.setFrozenRows(1);
  for (var col = 1; col <= csvHeaders.length; col++) target.autoResizeColumn(col);

  ui.alert(
    "LinkedIn Blog CSV Ready!\n\n" +
    "Rows exported: " + csvRows.length + "\n\n" +
    "Download: File → Download → CSV\n" +
    "Import to FeedHive\n" +
    "Then check Published (col C) in LinkedIn Blog Export"
  );
}

// ============================================================
// GATHER COLLECTIONS FROM CONTENT LIBRARY
// ============================================================
function gatherBlogCollections_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lib = ss.getSheetByName("Content Library");
  if (!lib) return [];

  var data = lib.getDataRange().getValues();
  var LC = CONFIG.LIB_COL;
  var collections = [];
  var seen = {};

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var fmt = (r[LC.FORMAT] || "").toUpperCase();
    if (fmt !== "W") continue;

    var contentType = (r[LC.CONTENT_TYPE] || "").toLowerCase();
    if (contentType && contentType !== "montages" && contentType !== "montage") continue;

    var enabled = r[LC.ENABLED];
    var published = r[LC.PUBLISHED];
    if (enabled !== true) continue;
    if (published === true) continue;

    var collection = r[LC.COLLECTION] || "";
    if (!collection || seen[collection]) continue;
    seen[collection] = true;

    collections.push({
      category: r[LC.CATEGORY] || "",
      subcategory: r[LC.SUBCATEGORY] || "",
      collection: collection,
      filename: r[LC.FILENAME] || "",
      helpUrl: r[LC.HELP_URL] || "",
      stockflowUrl: r[LC.STOCKFLOW_URL] || ""
    });
  }

  return collections;
}

// ============================================================
// FETCH CLIP DESCRIPTIONS FROM ORIGINAL DATA SHEET
// ============================================================
function fetchCollectionDescriptions_() {
  var descMap = {}; // collection → [description1, description2, ...]

  try {
    var url = "https://docs.google.com/spreadsheets/d/" +
      LB_CONFIG.DATA_SHEET_ID + "/export?format=csv&gid=" + LB_CONFIG.DATA_TAB_GID;
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return descMap;

    var csv = Utilities.parseCsv(response.getContentText());
    if (csv.length < 2) return descMap;

    var headers = csv[0];
    var colIndex = {};
    for (var i = 0; i < headers.length; i++) {
      colIndex[headers[i].trim()] = i;
    }

    for (var j = 1; j < csv.length; j++) {
      var row = csv[j];
      var collection = row[colIndex["Sub"]] || "";
      var desc = row[colIndex["Description"]] || "";
      var tags = row[colIndex["Tags"]] || "";

      if (!collection) continue;
      if (!descMap[collection]) descMap[collection] = { descriptions: [], tags: [] };
      if (desc && descMap[collection].descriptions.length < 5) {
        descMap[collection].descriptions.push(desc);
      }
      if (tags && descMap[collection].tags.length === 0) {
        descMap[collection].tags = tags.split(",").map(function(t) { return t.trim(); }).filter(Boolean);
      }
    }
  } catch (e) {
    Logger.log("Description fetch error: " + e.message);
  }

  return descMap;
}

// ============================================================
// BUILD LINKEDIN ARTICLE
// ============================================================
function buildLinkedInArticle_(collection, enrichment) {
  var name = collection.collection.replace(/_/g, " ").replace(/-/g, " ");
  var cat = collection.category.replace(/_/g, " ");
  var sub = collection.subcategory.replace(/_/g, " ");

  // Select industry template
  var template = INDUSTRY_TEMPLATES[cat] || INDUSTRY_TEMPLATES["default"];
  if (cat.toLowerCase().indexOf("microscop") !== -1) template = INDUSTRY_TEMPLATES["Microscopic"];
  if (cat.toLowerCase().indexOf("food") !== -1) template = INDUSTRY_TEMPLATES["Food & Beverage"];

  // Build URLs
  var stockflowUrl = collection.stockflowUrl;
  if (!stockflowUrl) {
    stockflowUrl = LB_CONFIG.STOCKFLOW_BASE + "?cat=" +
      encodeURIComponent(cat).replace(/%20/g, "+") + "&sub=" +
      encodeURIComponent(sub).replace(/%20/g, "+") + "&collection=" +
      encodeURIComponent(name).replace(/%20/g, "+");
  }
  var helpUrl = collection.helpUrl;
  if (!helpUrl) {
    var slug = collection.collection.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    helpUrl = LB_CONFIG.HELP_BASE + slug + "/";
  }

  // Get descriptions from enrichment data
  var descriptions = [];
  var tags = [];
  if (enrichment && enrichment.descriptions) descriptions = enrichment.descriptions;
  if (enrichment && enrichment.tags) tags = enrichment.tags;

  // === BUILD THE ARTICLE ===
  var article = "";

  // --- Title line ---
  article += "How " + name + " Footage Transforms " + template.industries[0] + " Projects\n\n";

  // --- Section 1: Industry Context ---
  article += template.context + "\n\n";

  // --- Section 2: What Makes This Collection Stand Out ---
  article += "About the " + name + " Collection\n\n";
  if (sub) {
    article += "The " + name + " collection is part of our " + sub + " library within the " + cat + " category. ";
  }
  article += "This collection delivers broadcast-ready assets that meet the quality standards of professional productions.\n\n";

  // Add clip descriptions if available
  if (descriptions.length > 0) {
    article += "Featured assets include:\n\n";
    for (var d = 0; d < Math.min(descriptions.length, 3); d++) {
      var desc = descriptions[d];
      if (desc.length > 150) desc = desc.substring(0, 147) + "...";
      article += "- " + desc + "\n";
    }
    article += "\n";
  }

  // --- Section 3: Who Benefits ---
  article += "Who Benefits from This Collection\n\n";
  for (var a = 0; a < template.audience.length; a++) {
    article += "- " + template.audience[a] + "\n";
  }
  article += "\n";

  // --- Section 4: Technical Workflow ---
  article += "Integration into Your Workflow\n\n";
  article += template.workflow + "\n\n";

  // --- Section 5: What's Included ---
  article += "What's Included\n\n";
  article += "- 4K MP4 Video (3840x2160) — 16:9 widescreen\n";
  article += "- 8K JPEG Images (7680x4320) — print-ready resolution\n";
  article += "- Vertical Video (1080x1920) — optimized for mobile and social\n";
  article += "- Square Format (2160x2160) — ideal for social feeds\n";
  article += "- Royalty-free license — no attribution required\n";
  article += "- Instant download — no waiting, no approval process\n\n";

  // --- Section 6: Quality Differentiator ---
  article += "Why Stockflow.media\n\n";
  article += template.differentiator + "\n\n";

  // --- Section 7: CTA ---
  article += "Get the " + name + " Collection\n\n";
  article += "Browse and download: " + stockflowUrl + "\n";
  article += "Full collection details: " + helpUrl + "\n\n";

  // --- Tags (plain text, no emojis) ---
  var tagList = ["#stockfootage", "#royaltyfree", "#stockvideo"];
  if (cat.toLowerCase().indexOf("microscop") !== -1) {
    tagList.push("#microscopy", "#science", "#biology", "#documentary", "#sciencecommunication");
  } else if (cat.toLowerCase().indexOf("food") !== -1) {
    tagList.push("#foodvideo", "#restaurantmarketing", "#foodphotography", "#culinary", "#hospitality");
  }
  tagList.push("#contentcreation", "#videoproduction", "#4kvideo");

  // Add collection-specific tags
  var collTag = "#" + name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (collTag.length > 3) tagList.push(collTag);
  if (sub) {
    var subTag = "#" + sub.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (subTag.length > 3) tagList.push(subTag);
  }

  // Add tags from data sheet
  if (tags.length > 0) {
    for (var t = 0; t < Math.min(tags.length, 5); t++) {
      var tag = "#" + tags[t].toLowerCase().replace(/[^a-z0-9]/g, "");
      if (tag.length > 3 && tagList.indexOf(tag) === -1) tagList.push(tag);
    }
  }

  article += tagList.join(" ");

  // LinkedIn limit is 3000 chars for posts (125K for articles, but FeedHive posts as regular post)
  if (article.length > 3000) {
    article = article.substring(0, 2950) + "\n\n" + tagList.slice(0, 5).join(" ");
  }

  return {
    body: article,
    title: "How " + name + " Footage Transforms " + template.industries[0] + " Projects"
  };
}
