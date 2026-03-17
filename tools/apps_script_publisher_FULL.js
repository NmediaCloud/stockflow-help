/**
 * Stockflow Publishing System — Apps Script
 *
 * Replaces local Python upload scripts (07/08/09) with a sheet-driven
 * publishing system that uploads directly from Google Drive to platforms.
 *
 * FEATURES:
 * - Checkbox (col A "Publish") triggers immediate upload
 * - Hourly auto-trigger checks schedule for due items
 * - YouTube resumable upload from Drive (handles >50MB)
 * - Status cell color coding (uploading=yellow, uploaded=green, failed=red)
 * - Retry by unchecking then rechecking failed items
 * - Google Calendar two-way sync
 *
 * SETUP:
 * 1. Open Master Sheet -> Extensions -> Apps Script
 * 2. Paste this entire script
 * 3. Run setupTriggers() once (or use Stockflow menu)
 * 4. Authorize when prompted (needs Drive, YouTube, Calendar scopes)
 *
 * COLUMNS (Publishing Schedule tab):
 * A: Publish (checkbox)    B: Status           C: Date
 * D: Day                   E: Time             F: Platform
 * G: Phase                 H: Format           I: Category
 * J: Subcategory           K: Collection        L: Drive Link
 * M: Drive File ID         N: Help Page URL     O: Stockflow URL
 * P: Published URL         Q: Published At      R: Notes
 */

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  SHEET_NAME: "Publishing Schedule",
  CONTENT_LIBRARY_SHEET: "Content Library",
  DRIVE_ROOT_FOLDER_ID: "1I2BpqMn5bAwOQwEJpzglZglDqujRI6D9",
  CALENDAR_NAME: "Stockflow Publishing",

  // Column indices (0-based) for Publishing Schedule
  COL: {
    PUBLISH: 0,       // A - checkbox
    STATUS: 1,        // B - status text
    DATE: 2,          // C - date
    DAY: 3,           // D - day name
    TIME: 4,          // E - time
    PLATFORM: 5,      // F - platform
    PHASE: 6,         // G - phase
    FORMAT: 7,        // H - format (W/S/V)
    CATEGORY: 8,      // I - category
    SUBCATEGORY: 9,   // J - subcategory
    COLLECTION: 10,   // K - collection
    DRIVE_LINK: 11,   // L - drive link
    DRIVE_FILE_ID: 12, // M - drive file ID
    HELP_PAGE_URL: 13, // N - help page URL
    STOCKFLOW_URL: 14, // O - stockflow URL
    PUBLISHED_URL: 15, // P - published URL
    PUBLISHED_AT: 16,  // Q - published at timestamp
    NOTES: 17          // R - notes
  },

  // Platform daily quotas
  QUOTAS: {
    "YouTube": 100,
    "TikTok": 10,
    "Instagram": 10,
    "LinkedIn": 5,
    "Twitter": 15,
    "Pinterest": 25,
    "Facebook": 10,
    "Reddit": 5,
    "Substack": 1,
    "WordPress": 3
  },

  // Status values
  STATUS: {
    PENDING: "",
    UPLOADING: "Uploading...",
    UPLOADED: "Uploaded",
    FAILED: "Failed",
    SCHEDULED: "Scheduled"
  }
};

// ============================================================
// MENU & TRIGGERS
// ============================================================

/**
 * Add custom menu on sheet open
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Stockflow")
    .addItem("Sync Drive -> Sheet", "syncDriveToSheet")
    .addSeparator()
    .addItem("Publish Selected", "publishSelected")
    .addItem("Publish All Due Now", "publishDueItems")
    .addItem("Publish Next YouTube", "publishNextYouTube")
    .addItem("Debug Publish (diagnose)", "debugPublishSelected")
    .addItem("Audit & Fix Status", "auditAndFixStatus")
    .addSeparator()
    .addItem("Sync to Calendar", "syncSheetToCalendar")
    .addItem("Setup Triggers", "setupTriggers")
    .addItem("Remove Triggers", "removeTriggers")
    .addSeparator()
    .addItem("Check YouTube Quota", "checkYouTubeQuota")
    .addItem("Sync Existing YouTube Uploads", "syncExistingYouTube")
    .addItem("Make All Videos Public", "makeAllVideosPublic")
    .addSeparator()
    .addItem("Preview WordPress Blog", "previewWordPressBlog")
    .addSeparator()
    .addItem("Generate AppScript Upload Sheet", "generateAppScriptSheet")
    .addItem("Generate FeedHive Export (S)", "generateFeedHiveSheetS")
    .addItem("Generate FeedHive Export (V)", "generateFeedHiveSheetV")
    .addToUi();
}

/**
 * Setup time-driven and calendar triggers
 * Run this ONCE after pasting the script
 */
function setupTriggers() {
  // Remove existing triggers first
  removeTriggers();

  // Hourly trigger to check scheduled items
  ScriptApp.newTrigger("publishDueItems")
    .timeBased()
    .everyHours(1)
    .create();

  // Calendar change trigger (for drag-to-reschedule)
  // Use user's primary email — forUserCalendar fails with secondary calendar IDs
  try {
    const userEmail = Session.getActiveUser().getEmail();
    ScriptApp.newTrigger("onCalendarChange")
      .forUserCalendar(userEmail)
      .onEventUpdated()
      .create();
    Logger.log("Calendar trigger set for: " + userEmail);
  } catch (err) {
    Logger.log("Calendar trigger skipped: " + err.message);
  }

  getOrCreateCalendar();

  Logger.log("Triggers set up successfully!");
  SpreadsheetApp.getUi().alert(
    "Triggers set up!\n\n" +
    "1. Hourly check for scheduled items\n" +
    "2. Calendar sync on event changes\n\n" +
    "The 'Publish' checkbox in column A will trigger immediate upload."
  );
}

/**
 * Remove all project triggers
 */
function removeTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    const handler = trigger.getHandlerFunction();
    if (handler === "publishDueItems" || handler === "onCalendarChange") {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

// ============================================================
// CHECKBOX TRIGGER (onEdit)
// ============================================================

/**
 * Fires on every edit in the spreadsheet
 * Watches the Publish checkbox column for changes
 */
function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;

  const row = e.range.getRow();
  const col = e.range.getColumn();

  // Column A (1-indexed = 1) is the Publish checkbox
  if (col !== 1 || row <= 1) return;

  const value = e.value;

  if (value === "TRUE") {
    // Checkbox checked -> publish immediately
    publishRow(sheet, row);
  } else if (value === "FALSE") {
    // Checkbox unchecked -> clear status for retry
    const statusCell = sheet.getRange(row, CONFIG.COL.STATUS + 1);
    const currentStatus = statusCell.getValue();
    if (currentStatus === CONFIG.STATUS.FAILED) {
      statusCell.setValue("");
      statusCell.setBackground(null);
      sheet.getRange(row, CONFIG.COL.PUBLISH + 1).setValue(false);
      sheet.getRange(row, CONFIG.COL.NOTES + 1).setValue("Ready for retry");
    }
  }
}

// ============================================================
// PUBLISHING ENGINE
// ============================================================

/**
 * Publish a single row by row number
 */
function publishRow(sheet, row) {
  const data = sheet.getRange(row, 1, 1, 18).getValues()[0];
  const statusCell = sheet.getRange(row, CONFIG.COL.STATUS + 1);
  const notesCell = sheet.getRange(row, CONFIG.COL.NOTES + 1);

  const platform = data[CONFIG.COL.PLATFORM];
  const driveFileId = data[CONFIG.COL.DRIVE_FILE_ID];
  const driveLink = data[CONFIG.COL.DRIVE_LINK];
  const format = data[CONFIG.COL.FORMAT];
  const category = data[CONFIG.COL.CATEGORY];
  const subcategory = data[CONFIG.COL.SUBCATEGORY];
  const collection = data[CONFIG.COL.COLLECTION];

  // Validate
  if (!platform) {
    statusCell.setValue(CONFIG.STATUS.FAILED);
    statusCell.setBackground("#f4c7c3");
    notesCell.setValue("No platform specified");
    return;
  }

  if (!driveFileId && !driveLink) {
    statusCell.setValue(CONFIG.STATUS.FAILED);
    statusCell.setBackground("#f4c7c3");
    notesCell.setValue("No Drive file ID or link");
    return;
  }

  // Extract file ID from link if needed
  let fileId = driveFileId;
  if (!fileId && driveLink) {
    const match = driveLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) fileId = match[1];
  }

  if (!fileId) {
    statusCell.setValue(CONFIG.STATUS.FAILED);
    statusCell.setBackground("#f4c7c3");
    notesCell.setValue("Could not extract Drive file ID");
    return;
  }

  // Set uploading status
  statusCell.setValue(CONFIG.STATUS.UPLOADING);
  statusCell.setBackground("#fff2cc"); // light yellow
  SpreadsheetApp.flush();

  // Check daily quota
  if (!checkQuota(sheet, platform)) {
    statusCell.setValue(CONFIG.STATUS.FAILED);
    statusCell.setBackground("#f4c7c3");
    notesCell.setValue("Daily quota reached for " + platform);
    return;
  }

  try {
    let result;

    switch (platform.toLowerCase()) {
      case "youtube":
        result = uploadToYouTube(fileId, {
          format, category, subcategory, collection,
          helpPageUrl: data[CONFIG.COL.HELP_PAGE_URL],
          stockflowUrl: data[CONFIG.COL.STOCKFLOW_URL]
        });
        break;
      // Future platforms
      case "tiktok":
      case "instagram":
      case "linkedin":
      case "twitter":
      case "pinterest":
      case "facebook":
      case "reddit":
      case "substack":
      case "wordpress":
        result = { success: false, error: platform + " upload not yet implemented" };
        break;
      default:
        result = { success: false, error: "Unknown platform: " + platform };
    }

    if (result.success) {
      statusCell.setValue(CONFIG.STATUS.UPLOADED);
      statusCell.setBackground("#b7e1cd"); // light green

      if (result.url) {
        sheet.getRange(row, CONFIG.COL.PUBLISHED_URL + 1).setValue(result.url);
      }
      sheet.getRange(row, CONFIG.COL.PUBLISHED_AT + 1).setValue(new Date());
      notesCell.setValue("Published successfully");

      // Auto-check the checkbox
      sheet.getRange(row, CONFIG.COL.PUBLISH + 1).setValue(true);

    } else {
      statusCell.setValue(CONFIG.STATUS.FAILED);
      statusCell.setBackground("#f4c7c3");
      notesCell.setValue(result.error || "Unknown error");
    }

  } catch (error) {
    statusCell.setValue(CONFIG.STATUS.FAILED);
    statusCell.setBackground("#f4c7c3");
    notesCell.setValue("Error: " + error.message);
    Logger.log("Publish error row " + row + ": " + error.message);
  }
}

/**
 * Publish all items that are due now (hourly trigger)
 */
function publishDueItems() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return;

  const now = new Date();
  const data = sheet.getDataRange().getValues();
  let published = 0;

  const quotaUsed = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[CONFIG.COL.STATUS];
    const platform = row[CONFIG.COL.PLATFORM];
    const dateVal = row[CONFIG.COL.DATE];
    const timeVal = row[CONFIG.COL.TIME];
    const isChecked = row[CONFIG.COL.PUBLISH];

    // Skip already handled
    if (status === CONFIG.STATUS.UPLOADED ||
        status === CONFIG.STATUS.UPLOADING ||
        isChecked === true) {
      continue;
    }

    if (!dateVal || !timeVal) continue;

    const scheduledDate = parseScheduledDateTime(dateVal, timeVal);
    if (!scheduledDate || scheduledDate > now) continue;

    // Check quota
    if (!quotaUsed[platform]) quotaUsed[platform] = 0;
    const maxQuota = CONFIG.QUOTAS[platform] || 5;
    if (quotaUsed[platform] >= maxQuota) {
      Logger.log("Quota reached for " + platform + ", skipping row " + (i + 1));
      continue;
    }

    const rowNum = i + 1;
    Logger.log("Publishing scheduled item: row " + rowNum + " - " + platform);
    publishRow(sheet, rowNum);
    quotaUsed[platform]++;
    published++;

    Utilities.sleep(2000);
  }

  if (published > 0) {
    Logger.log("Hourly trigger published " + published + " items");
  }
}

/**
 * Check if a value is truthy as a checkbox (handles boolean true, string "TRUE", etc.)
 */
function isCheckboxChecked_(value) {
  if (value === true) return true;
  if (typeof value === "string" && value.toUpperCase() === "TRUE") return true;
  return false;
}

/**
 * Publish all rows where checkbox is checked but status is not Uploaded
 */
function publishSelected() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const name = sheet.getName();
  if (name !== CONFIG.SHEET_NAME && name !== "AppScript Upload") {
    SpreadsheetApp.getUi().alert("Switch to 'Publishing Schedule' or 'AppScript Upload' tab first.");
    return;
  }

  const data = sheet.getDataRange().getValues();
  let count = 0;

  for (let i = 1; i < data.length; i++) {
    const isChecked = data[i][CONFIG.COL.PUBLISH];
    const status = data[i][CONFIG.COL.STATUS];

    if (isCheckboxChecked_(isChecked) && status !== CONFIG.STATUS.UPLOADED) {
      publishRow(sheet, i + 1);
      count++;
      Utilities.sleep(2000);
    }
  }

  SpreadsheetApp.getUi().alert("Published " + count + " items.");
}

/**
 * Debug: show what publishSelected() sees for checked rows
 * Run this from Stockflow menu to diagnose "Published 0 items"
 */
function debugPublishSelected() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    SpreadsheetApp.getUi().alert("Sheet '" + CONFIG.SHEET_NAME + "' not found!");
    return;
  }

  const data = sheet.getDataRange().getValues();
  const checkedRows = [];
  let totalRows = data.length - 1;

  for (let i = 1; i < data.length; i++) {
    const val = data[i][CONFIG.COL.PUBLISH];
    const status = data[i][CONFIG.COL.STATUS];

    if (isCheckboxChecked_(val)) {
      checkedRows.push(
        "Row " + (i + 1) + ": Publish=" + JSON.stringify(val) +
        " (type: " + typeof val + "), Status=\"" + status + "\"" +
        (status === CONFIG.STATUS.UPLOADED ? " [SKIP: already uploaded]" : " [ELIGIBLE]")
      );
    }
  }

  const msg = "Total data rows: " + totalRows + "\n" +
    "Checked rows found: " + checkedRows.length + "\n\n" +
    (checkedRows.length > 0
      ? checkedRows.slice(0, 20).join("\n")
      : "No checked rows found! Column A values in first 5 data rows:\n" +
        data.slice(1, 6).map(function(r, i) {
          return "Row " + (i + 2) + ": " + JSON.stringify(r[0]) + " (type: " + typeof r[0] + ")";
        }).join("\n"));

  SpreadsheetApp.getUi().alert(msg);
}

/**
 * Audit and fix status mismatches across all rows.
 * - Row has Published URL but status != Uploaded → set Uploaded
 * - Row has status Uploaded but no Published URL → clear status
 * - Shows summary of all statuses
 */
function auditAndFixStatus() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  let fixed = 0;
  let cleared = 0;
  const statusCounts = {};

  for (let i = 1; i < data.length; i++) {
    const status = data[i][CONFIG.COL.STATUS] || "";
    const pubUrl = data[i][CONFIG.COL.PUBLISHED_URL] || "";
    const platform = data[i][CONFIG.COL.PLATFORM] || "";
    const rowNum = i + 1;

    // Fix: has URL but wrong status
    if (pubUrl && status !== CONFIG.STATUS.UPLOADED) {
      sheet.getRange(rowNum, CONFIG.COL.STATUS + 1).setValue(CONFIG.STATUS.UPLOADED);
      sheet.getRange(rowNum, CONFIG.COL.STATUS + 1).setBackground("#b7e1cd");
      sheet.getRange(rowNum, CONFIG.COL.PUBLISH + 1).setValue(true);
      fixed++;
    }

    // Fix: marked Uploaded but no URL and no publish date
    if (status === CONFIG.STATUS.UPLOADED && !pubUrl && !data[i][CONFIG.COL.PUBLISHED_AT]) {
      sheet.getRange(rowNum, CONFIG.COL.STATUS + 1).setValue("");
      sheet.getRange(rowNum, CONFIG.COL.STATUS + 1).setBackground(null);
      sheet.getRange(rowNum, CONFIG.COL.PUBLISH + 1).setValue(false);
      sheet.getRange(rowNum, CONFIG.COL.NOTES + 1).setValue("Status cleared by audit");
      cleared++;
    }

    // Count statuses
    const s = sheet.getRange(rowNum, CONFIG.COL.STATUS + 1).getValue() || "(empty)";
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  let msg = "Status Audit Complete\n\n";
  msg += "Total rows: " + (data.length - 1) + "\n";
  msg += "Fixed (URL exists, status wrong): " + fixed + "\n";
  msg += "Cleared (Uploaded but no URL): " + cleared + "\n\n";
  msg += "Status breakdown:\n";
  for (const s in statusCounts) {
    msg += "  " + s + ": " + statusCounts[s] + "\n";
  }

  SpreadsheetApp.getUi().alert(msg);
}

/**
 * Find and publish the next eligible YouTube row (not yet uploaded).
 * Checks the box, publishes it, and reports which row.
 */
function publishNextYouTube() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const name = sheet.getName();
  if (name !== CONFIG.SHEET_NAME && name !== "AppScript Upload") {
    SpreadsheetApp.getUi().alert("Switch to 'Publishing Schedule' or 'AppScript Upload' tab first.");
    return;
  }

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const status = data[i][CONFIG.COL.STATUS];
    const platform = data[i][CONFIG.COL.PLATFORM];
    const driveFileId = data[i][CONFIG.COL.DRIVE_FILE_ID];

    if (!isCheckboxChecked_(data[i][CONFIG.COL.PUBLISH]) &&
        status !== CONFIG.STATUS.UPLOADED &&
        platform === "YouTube" &&
        driveFileId) {
      const rowNum = i + 1;
      const collection = data[i][CONFIG.COL.COLLECTION];
      // Check the box
      sheet.getRange(rowNum, CONFIG.COL.PUBLISH + 1).setValue(true);
      // Publish it
      publishRow(sheet, rowNum);
      SpreadsheetApp.getUi().alert(
        "Published Row " + rowNum + ": " + collection + "\n" +
        "Platform: YouTube\nDrive File ID: " + driveFileId
      );
      return;
    }
  }

  SpreadsheetApp.getUi().alert("No eligible YouTube rows found to publish.");
}

// ============================================================
// YOUTUBE UPLOAD
// ============================================================

/**
 * Upload a video file from Drive to YouTube
 * Uses resumable upload for large files (>50MB)
 */
function uploadToYouTube(driveFileId, meta) {
  try {
    const file = DriveApp.getFileById(driveFileId);
    const fileName = file.getName();
    const fileSize = file.getSize();

    const title = buildYouTubeTitle(meta, fileName);
    const description = buildYouTubeDescription(meta);
    const tags = buildYouTubeTags(meta);

    Logger.log("Uploading to YouTube: " + title + " (" + (fileSize / 1024 / 1024).toFixed(1) + " MB)");

    // For files <= 50MB, use simple blob upload
    if (fileSize <= 50 * 1024 * 1024) {
      return youtubeSimpleUpload(file, title, description, tags);
    } else {
      return youtubeResumableUpload(file, fileSize, title, description, tags);
    }

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Simple YouTube upload for files <= 50MB
 */
function youtubeSimpleUpload(file, title, description, tags) {
  const blob = file.getBlob();

  const resource = {
    snippet: {
      title: title,
      description: description,
      tags: tags,
      categoryId: "22"
    },
    status: {
      privacyStatus: "public",
      selfDeclaredMadeForKids: false
    }
  };

  const video = YouTube.Videos.insert(resource, "snippet,status", blob);

  return {
    success: true,
    url: "https://www.youtube.com/watch?v=" + video.id,
    videoId: video.id
  };
}

/**
 * Resumable YouTube upload for files > 50MB
 * Streams chunks from Drive to YouTube
 */
function youtubeResumableUpload(file, fileSize, title, description, tags) {
  const accessToken = ScriptApp.getOAuthToken();

  // Step 1: Initialize resumable upload
  const metadata = {
    snippet: {
      title: title,
      description: description,
      tags: tags,
      categoryId: "22"
    },
    status: {
      privacyStatus: "public",
      selfDeclaredMadeForKids: false
    }
  };

  const initResponse = UrlFetchApp.fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": fileSize,
        "X-Upload-Content-Type": "video/mp4"
      },
      payload: JSON.stringify(metadata),
      muteHttpExceptions: true
    }
  );

  if (initResponse.getResponseCode() !== 200) {
    return { success: false, error: "Init failed: " + initResponse.getContentText() };
  }

  const uploadUrl = initResponse.getHeaders()["Location"] || initResponse.getHeaders()["location"];
  if (!uploadUrl) {
    return { success: false, error: "No upload URL returned" };
  }

  // Step 2: Upload in chunks from Drive
  const downloadUrl = "https://www.googleapis.com/drive/v3/files/" + file.getId() + "?alt=media";
  const CHUNK_SIZE = 32 * 1024 * 1024; // 32MB chunks
  let offset = 0;

  while (offset < fileSize) {
    const end = Math.min(offset + CHUNK_SIZE, fileSize);

    // Download chunk from Drive
    const driveResponse = UrlFetchApp.fetch(downloadUrl, {
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Range": "bytes=" + offset + "-" + (end - 1)
      },
      muteHttpExceptions: true
    });

    const chunkBlob = driveResponse.getBlob();

    // Upload chunk to YouTube
    const uploadResponse = UrlFetchApp.fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Range": "bytes " + offset + "-" + (end - 1) + "/" + fileSize
      },
      payload: chunkBlob,
      muteHttpExceptions: true
    });

    const code = uploadResponse.getResponseCode();

    if (code === 200 || code === 201) {
      const result = JSON.parse(uploadResponse.getContentText());
      return {
        success: true,
        url: "https://www.youtube.com/watch?v=" + result.id,
        videoId: result.id
      };
    } else if (code === 308) {
      offset = end;
      Logger.log("Uploaded " + Math.round(offset / fileSize * 100) + "%");
    } else {
      return {
        success: false,
        error: "Upload chunk failed (HTTP " + code + "): " + uploadResponse.getContentText()
      };
    }
  }

  return { success: false, error: "Upload ended without completion" };
}

/**
 * Build YouTube video title
 */
function buildYouTubeTitle(meta, fileName) {
  const parts = [];
  if (meta.collection) parts.push(meta.collection);
  if (meta.subcategory && meta.subcategory !== meta.collection) parts.push(meta.subcategory);
  if (meta.category) parts.push(meta.category);

  let title = parts.join(" | ");

  const formatLabels = { "W": "4K", "S": "Square", "V": "Vertical" };
  const label = formatLabels[meta.format] || meta.format;
  if (label) title += " - " + label + " Stock Footage";

  if (title.length > 100) title = title.substring(0, 97) + "...";

  return title || fileName.replace(".mp4", "");
}

/**
 * Build YouTube video description
 */
function buildYouTubeDescription(meta) {
  let desc = "Premium stock footage from Stockflow.media\n\n";

  if (meta.collection) desc += "Collection: " + meta.collection + "\n";
  if (meta.subcategory) desc += "Category: " + meta.subcategory + "\n";
  if (meta.category) desc += "Theme: " + meta.category + "\n";
  desc += "\n";

  if (meta.stockflowUrl) {
    desc += "Browse & License: " + meta.stockflowUrl + "\n";
  } else {
    desc += "Browse & License: https://stockflow.media\n";
  }

  if (meta.helpPageUrl) {
    desc += "Details: " + meta.helpPageUrl + "\n";
  }

  desc += "\n#stockfootage #stockvideo #stockflow";

  return desc;
}

/**
 * Build YouTube tags
 */
function buildYouTubeTags(meta) {
  const tags = ["stock footage", "stock video", "stockflow", "royalty free"];

  if (meta.category) tags.push(meta.category.replace(/-/g, " "));
  if (meta.subcategory) tags.push(meta.subcategory.replace(/-/g, " "));
  if (meta.collection) tags.push(meta.collection.replace(/-/g, " "));

  const formatTags = { "W": "4K video", "S": "square video", "V": "vertical video" };
  if (meta.format && formatTags[meta.format]) tags.push(formatTags[meta.format]);

  return tags;
}

// ============================================================
// WORDPRESS PUBLISHING
// ============================================================

/**
 * Category-specific SEO content blocks for blog posts.
 * Each category has tailored keywords, audience, and use cases.
 */
var CATEGORY_SEO = {
  "Microscopic": {
    audience: "science educators, documentary filmmakers, medical professionals, research institutions, and content creators",
    useCase: "educational videos, scientific presentations, documentary B-roll, research papers, classroom materials, and social media content",
    keywords: "microscopic stock footage, microscopy video, science stock video, laboratory footage, microscope video, cellular footage",
    intro: "Explore the hidden world under the microscope with this stunning collection of professionally captured microscopic footage. Every frame reveals intricate biological structures, cellular processes, and microorganisms in breathtaking detail.",
    whyChoose: "Our microscopic footage is captured using professional-grade microscopy equipment, delivering exceptional clarity and detail that brings the invisible world to life. Each clip is carefully color-graded and stabilized for immediate use in professional productions."
  },
  "Food Beverage": {
    audience: "food bloggers, restaurant owners, advertising agencies, social media managers, culinary content creators, and hospitality brands",
    useCase: "restaurant promotions, food delivery app content, social media marketing, cooking shows, recipe videos, menu displays, and advertising campaigns",
    keywords: "food stock footage, culinary video, restaurant footage, food photography, cooking stock video, food B-roll, cinematic food video",
    intro: "Elevate your food content with this mouthwatering collection of professionally shot culinary footage. Every clip captures the textures, colors, and artistry of cuisine in stunning cinematic quality.",
    whyChoose: "Our food footage is shot with cinematic lighting and professional color grading, capturing the appetizing details that make viewers hungry. Each clip is ready for commercial use in ads, social media, and digital menus."
  }
};

/**
 * Build a WordPress blog post HTML for a collection.
 * Generates SEO-optimized content with YouTube embed, preview images, and CTAs.
 *
 * @param {Object} meta - Row data: collection, category, subcategory, format, helpPageUrl, stockflowUrl
 * @param {string} youtubeUrl - YouTube video URL (from the uploaded YouTube row for this collection)
 * @returns {Object} {title, content, excerpt, tags, categories}
 */
function buildWordPressBlog(meta, youtubeUrl) {
  var collection = meta.collection || "Untitled";
  var category = meta.category || "";
  var subcategory = meta.subcategory || "";
  var helpUrl = meta.helpPageUrl || "";
  var stockflowUrl = meta.stockflowUrl || "https://stockflow.media";

  // Clean collection name for display (replace underscores with spaces)
  var displayName = collection.replace(/_/g, " ").replace(/\b\w/g, function(l) { return l.toUpperCase(); });
  var displaySub = subcategory.replace(/_/g, " ");
  var displayCat = category.replace(/_/g, " ");

  // Get category-specific SEO content
  var seo = CATEGORY_SEO[category] || CATEGORY_SEO["Microscopic"];

  // Build YouTube embed (responsive)
  var youtubeEmbed = "";
  if (youtubeUrl) {
    var videoId = youtubeUrl.match(/[?&]v=([^&]+)/);
    if (videoId) {
      youtubeEmbed = '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;max-width:100%;margin:20px 0;">' +
        '<iframe src="https://www.youtube.com/embed/' + videoId[1] + '?rel=0" ' +
        'style="position:absolute;top:0;left:0;width:100%;height:100%;" ' +
        'frameborder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" ' +
        'allowfullscreen></iframe></div>';
    }
  }

  // --- Build the blog post HTML ---
  var html = "";

  // Hero section with YouTube embed
  html += "<h2>Preview: " + displayName + " Stock Footage</h2>\n";
  if (youtubeEmbed) {
    html += youtubeEmbed + "\n";
  }
  html += "<p><em>Watch the full montage above to preview every clip and image in this collection.</em></p>\n\n";

  // Introduction
  html += "<h2>About the " + displayName + " Collection</h2>\n";
  html += "<p>" + seo.intro + "</p>\n";
  html += "<p>The <strong>" + displayName + "</strong> collection is part of our <strong>" + displaySub + "</strong> series ";
  html += "within the <strong>" + displayCat + "</strong> category. ";
  html += "Perfect for " + seo.audience + " looking for premium, ready-to-use visual assets.</p>\n\n";

  // What's included
  html += "<h2>What's Included</h2>\n";
  html += "<p>This collection includes a curated set of professional assets:</p>\n";
  html += "<ul>\n";
  html += "<li><strong>4K MP4 Video</strong> — Widescreen (16:9) montage footage, ready for editing and production</li>\n";
  html += "<li><strong>8K JPEG Images</strong> — Ultra-high-resolution stills (up to 7680x4320) for print, web, and digital campaigns</li>\n";
  html += "<li><strong>Vertical Video (9:16)</strong> — Optimized for TikTok, Instagram Reels, and YouTube Shorts</li>\n";
  html += "<li><strong>Square Format (1:1)</strong> — Perfect for Instagram posts, Facebook, and social media ads</li>\n";
  html += "</ul>\n";
  html += "<p>All assets are <strong>royalty-free</strong> with no attribution required — use them in unlimited projects, forever.</p>\n\n";

  // Who is this for
  html += "<h2>Who Is This For?</h2>\n";
  html += "<p>The " + displayName + " collection is ideal for:</p>\n";
  html += "<ul>\n";

  if (category === "Microscopic") {
    html += "<li><strong>Documentary Filmmakers</strong> — Professional B-roll for science and nature documentaries</li>\n";
    html += "<li><strong>Science Educators</strong> — Engaging visuals for lectures, online courses, and presentations</li>\n";
    html += "<li><strong>Medical & Research Professionals</strong> — High-quality imagery for papers, posters, and conferences</li>\n";
    html += "<li><strong>Content Creators</strong> — Eye-catching footage for YouTube, TikTok, and social media science content</li>\n";
    html += "<li><strong>Designers</strong> — 8K images for posters, Canva designs, book covers, and digital art</li>\n";
  } else {
    html += "<li><strong>Restaurant & Hospitality Brands</strong> — Cinematic footage for menus, apps, and promotions</li>\n";
    html += "<li><strong>Food Bloggers & Influencers</strong> — Premium B-roll for recipe videos and reviews</li>\n";
    html += "<li><strong>Advertising Agencies</strong> — Commercial-grade visuals for food campaigns and social ads</li>\n";
    html += "<li><strong>Social Media Managers</strong> — Ready-to-post content in every format (widescreen, vertical, square)</li>\n";
    html += "<li><strong>Delivery & E-commerce Platforms</strong> — Appetizing imagery for listings and banners</li>\n";
  }

  html += "</ul>\n\n";

  // How to use
  html += "<h2>How to Use This Footage</h2>\n";
  html += "<p>Getting started with " + displayName + " footage is simple:</p>\n";
  html += "<ol>\n";
  html += "<li><strong>Browse the collection</strong> — View all available clips and images with full previews</li>\n";
  html += "<li><strong>Choose your format</strong> — Select widescreen, vertical, or square based on your project needs</li>\n";
  html += "<li><strong>Download instantly</strong> — All assets are available for immediate download after purchase</li>\n";
  html += "<li><strong>Use anywhere</strong> — Royalty-free license covers all commercial and personal use</li>\n";
  html += "</ol>\n\n";

  // Why choose Stockflow
  html += "<h2>Why Choose Stockflow.media?</h2>\n";
  html += "<p>" + seo.whyChoose + "</p>\n";
  html += "<ul>\n";
  html += "<li>Multi-format delivery — every collection includes 4K video, 8K images, vertical, and square formats</li>\n";
  html += "<li>No subscription required — pay only for what you need</li>\n";
  html += "<li>Royalty-free, no attribution — use in unlimited projects</li>\n";
  html += "<li>Instant download — no waiting, no approval process</li>\n";
  html += "</ul>\n\n";

  // CTAs
  html += "<h2>Get the " + displayName + " Collection</h2>\n";
  html += '<p><a href="' + stockflowUrl + '" target="_blank" rel="noopener"><strong>Browse & Download on Stockflow.media</strong></a></p>\n';
  if (helpUrl) {
    html += '<p><a href="' + helpUrl + '" target="_blank" rel="noopener">View Full Collection Details & Previews</a></p>\n';
  }
  html += "\n";

  // Related / Footer
  html += "<hr>\n";
  html += "<p><em>Stockflow.media is a premium stock footage library specializing in " + displayCat.toLowerCase() + " visuals. ";
  html += "Browse our full library at <a href=\"https://stockflow.media\" target=\"_blank\" rel=\"noopener\">stockflow.media</a>.</em></p>\n";

  // --- Build SEO title ---
  var title = displayName + " Stock Footage & Images | " + displaySub + " | Stockflow.media";
  if (title.length > 70) {
    title = displayName + " Stock Footage | " + displaySub;
  }

  // --- Build excerpt (meta description) ---
  var excerpt = "Download premium " + displayName.toLowerCase() + " stock footage in 4K video and 8K images. ";
  excerpt += "Royalty-free " + displaySub.toLowerCase() + " assets for " + seo.useCase.split(",").slice(0, 2).join(" and") + ". ";
  excerpt += "Part of the " + displayCat + " collection on Stockflow.media.";

  // --- Build tags ---
  var tags = [
    displayName.toLowerCase(),
    displaySub.toLowerCase(),
    displayCat.toLowerCase(),
    "stock footage",
    "stock video",
    "royalty free",
    "4k video",
    "8k images"
  ];

  return {
    title: title,
    content: html,
    excerpt: excerpt,
    tags: tags,
    categories: [displayCat, displaySub]
  };
}

/**
 * Find the YouTube URL for a collection by searching the sheet.
 * Looks for a YouTube row with the same collection name that has a Published URL.
 *
 * @param {Sheet} sheet - The sheet to search
 * @param {string} collection - Collection name to match
 * @returns {string} YouTube URL or empty string
 */
function findYouTubeUrlForCollection_(sheet, collection) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][CONFIG.COL.PLATFORM] === "YouTube" &&
        data[i][CONFIG.COL.COLLECTION] === collection &&
        data[i][CONFIG.COL.PUBLISHED_URL]) {
      return data[i][CONFIG.COL.PUBLISHED_URL];
    }
  }
  return "";
}

/**
 * Preview the WordPress blog HTML for the first WordPress row.
 * Outputs to log so you can review before enabling actual publishing.
 */
function previewWordPressBlog() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][CONFIG.COL.PLATFORM] === "WordPress") {
      var meta = {
        collection: data[i][CONFIG.COL.COLLECTION],
        category: data[i][CONFIG.COL.CATEGORY],
        subcategory: data[i][CONFIG.COL.SUBCATEGORY],
        format: data[i][CONFIG.COL.FORMAT],
        helpPageUrl: data[i][CONFIG.COL.HELP_PAGE_URL],
        stockflowUrl: data[i][CONFIG.COL.STOCKFLOW_URL]
      };

      var youtubeUrl = findYouTubeUrlForCollection_(sheet, meta.collection);
      var blog = buildWordPressBlog(meta, youtubeUrl);

      Logger.log("=== TITLE ===");
      Logger.log(blog.title);
      Logger.log("\n=== EXCERPT ===");
      Logger.log(blog.excerpt);
      Logger.log("\n=== TAGS ===");
      Logger.log(blog.tags.join(", "));
      Logger.log("\n=== CATEGORIES ===");
      Logger.log(blog.categories.join(", "));
      Logger.log("\n=== CONTENT ===");
      Logger.log(blog.content);
      Logger.log("\n=== YouTube URL ===");
      Logger.log(youtubeUrl || "(not yet uploaded)");

      SpreadsheetApp.getUi().alert(
        "Blog Preview: " + blog.title + "\n\n" +
        "YouTube: " + (youtubeUrl || "Not yet uploaded") + "\n" +
        "Excerpt: " + blog.excerpt.substring(0, 100) + "...\n\n" +
        "Full HTML logged. Check: Extensions > Apps Script > Executions"
      );
      return;
    }
  }

  SpreadsheetApp.getUi().alert("No WordPress rows found on this sheet.");
}

// ============================================================
// QUOTA MANAGEMENT
// ============================================================

/**
 * Check if platform quota allows more uploads today
 */
function checkQuota(sheet, platform) {
  const data = sheet.getDataRange().getValues();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let todayCount = 0;

  for (let i = 1; i < data.length; i++) {
    if (data[i][CONFIG.COL.PLATFORM] === platform &&
        data[i][CONFIG.COL.STATUS] === CONFIG.STATUS.UPLOADED) {
      const pubDate = data[i][CONFIG.COL.PUBLISHED_AT];
      if (pubDate instanceof Date) {
        const pubDay = new Date(pubDate);
        pubDay.setHours(0, 0, 0, 0);
        if (pubDay.getTime() === today.getTime()) {
          todayCount++;
        }
      }
    }
  }

  const maxQuota = CONFIG.QUOTAS[platform] || 5;
  return todayCount < maxQuota;
}

/**
 * Show YouTube quota usage for today
 */
function checkYouTubeQuota() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i][CONFIG.COL.PLATFORM] === "YouTube" &&
        data[i][CONFIG.COL.STATUS] === CONFIG.STATUS.UPLOADED) {
      const pubDate = data[i][CONFIG.COL.PUBLISHED_AT];
      if (pubDate instanceof Date) {
        const pubDay = new Date(pubDate);
        pubDay.setHours(0, 0, 0, 0);
        if (pubDay.getTime() === today.getTime()) count++;
      }
    }
  }

  SpreadsheetApp.getUi().alert(
    "YouTube Quota Today\n\n" +
    "Uploaded: " + count + " / " + CONFIG.QUOTAS["YouTube"] + "\n" +
    "Remaining: " + (CONFIG.QUOTAS["YouTube"] - count)
  );
}

// ============================================================
// GOOGLE CALENDAR SYNC
// ============================================================

/**
 * Get or create the Stockflow Publishing calendar
 */
function getOrCreateCalendar() {
  const calendars = CalendarApp.getCalendarsByName(CONFIG.CALENDAR_NAME);
  if (calendars.length > 0) return calendars[0];

  const cal = CalendarApp.createCalendar(CONFIG.CALENDAR_NAME, {
    color: CalendarApp.Color.ORANGE
  });
  Logger.log("Created calendar: " + CONFIG.CALENDAR_NAME);
  return cal;
}

/**
 * Sync sheet rows to calendar events
 * Sheet is the source of truth for bulk changes
 */
function syncSheetToCalendar() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return;

  const cal = getOrCreateCalendar();
  const data = sheet.getDataRange().getValues();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  const platformColors = {
    "YouTube": CalendarApp.EventColor.RED,
    "TikTok": CalendarApp.EventColor.CYAN,
    "Instagram": CalendarApp.EventColor.MAUVE,
    "LinkedIn": CalendarApp.EventColor.BLUE,
    "Twitter": CalendarApp.EventColor.PALE_BLUE,
    "Pinterest": CalendarApp.EventColor.RED,
    "Facebook": CalendarApp.EventColor.BLUE,
    "Reddit": CalendarApp.EventColor.ORANGE,
    "Substack": CalendarApp.EventColor.GREEN,
    "WordPress": CalendarApp.EventColor.GRAY
  };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const dateVal = row[CONFIG.COL.DATE];
    const timeVal = row[CONFIG.COL.TIME];
    const platform = row[CONFIG.COL.PLATFORM];
    const format = row[CONFIG.COL.FORMAT];
    const collection = row[CONFIG.COL.COLLECTION] || row[CONFIG.COL.SUBCATEGORY] || "";

    if (!dateVal || !platform) {
      skipped++;
      continue;
    }

    const scheduledDate = parseScheduledDateTime(dateVal, timeVal);
    if (!scheduledDate) {
      skipped++;
      continue;
    }

    const eventTitle = "[" + platform + "] " + (format ? format + " " : "") + collection;

    const status = row[CONFIG.COL.STATUS] || "Pending";
    let eventDesc = "Status: " + status + "\n";
    eventDesc += "Row: " + (i + 1) + "\n";
    if (row[CONFIG.COL.DRIVE_LINK]) eventDesc += "Drive: " + row[CONFIG.COL.DRIVE_LINK] + "\n";
    if (row[CONFIG.COL.PUBLISHED_URL]) eventDesc += "Published: " + row[CONFIG.COL.PUBLISHED_URL] + "\n";

    const endDate = new Date(scheduledDate.getTime() + 30 * 60 * 1000);

    const dayStart = new Date(scheduledDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const existingEvents = cal.getEvents(dayStart, dayEnd, { search: eventTitle });

    if (existingEvents.length > 0) {
      const event = existingEvents[0];
      event.setTime(scheduledDate, endDate);
      event.setDescription(eventDesc);
      if (platformColors[platform]) {
        event.setColor(platformColors[platform]);
      }
      updated++;
    } else {
      const event = cal.createEvent(eventTitle, scheduledDate, endDate, {
        description: eventDesc
      });
      if (platformColors[platform]) {
        event.setColor(platformColors[platform]);
      }
      event.setTag("sheetRow", String(i + 1));
      created++;
    }
  }

  const msg = "Calendar sync complete!\n\n" +
    "Created: " + created + "\n" +
    "Updated: " + updated + "\n" +
    "Skipped: " + skipped;

  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}

/**
 * Calendar event changed (drag to reschedule)
 * Updates the sheet row with new date/time immediately
 */
function onCalendarChange(e) {
  const cal = getOrCreateCalendar();
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return;

  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

  const futureEnd = new Date();
  futureEnd.setMonth(futureEnd.getMonth() + 6);
  const events = cal.getEvents(new Date(), futureEnd);

  for (const event of events) {
    const lastUpdated = event.getLastUpdated();
    if (lastUpdated < fiveMinAgo) continue;

    let rowNum = null;
    const rowTag = event.getTag("sheetRow");
    if (rowTag) {
      rowNum = parseInt(rowTag);
    } else {
      const descMatch = event.getDescription().match(/Row: (\d+)/);
      if (descMatch) rowNum = parseInt(descMatch[1]);
    }

    if (!rowNum || rowNum <= 1) continue;

    const newStart = event.getStartTime();
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    sheet.getRange(rowNum, CONFIG.COL.DATE + 1).setValue(newStart);
    sheet.getRange(rowNum, CONFIG.COL.DAY + 1).setValue(days[newStart.getDay()]);

    const hours = String(newStart.getHours()).padStart(2, "0");
    const minutes = String(newStart.getMinutes()).padStart(2, "0");
    sheet.getRange(rowNum, CONFIG.COL.TIME + 1).setValue(hours + ":" + minutes);

    Logger.log("Calendar drag: Updated row " + rowNum + " to " + newStart);
  }
}

// ============================================================
// DRIVE SYNC (from previous script)
// ============================================================

const FORMAT_FOLDERS = ["W output", "S output", "V output"];
const FORMAT_MAP = {"W output": "W", "S output": "S", "V output": "V"};

/**
 * Scan Drive folders and update Content Library sheet
 */
function syncDriveToSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.CONTENT_LIBRARY_SHEET);

  if (!sheet) {
    SpreadsheetApp.getUi().alert("Content Library tab not found!");
    return;
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const colFormat = headers.indexOf("Format");
  const colFilename = headers.indexOf("Filename");
  const colDriveLink = headers.indexOf("Drive Link");
  const colDriveFileId = headers.indexOf("Drive File ID");
  const colUploadStatus = headers.indexOf("Upload Status");

  if (colFormat === -1 || colFilename === -1) {
    SpreadsheetApp.getUi().alert("Required columns not found! Need: Format, Filename");
    return;
  }

  Logger.log("Scanning Drive folders...");

  const driveIndex = {};
  const rootFolder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);

  for (const fmtName of FORMAT_FOLDERS) {
    const fmt = FORMAT_MAP[fmtName];
    const fmtFolders = rootFolder.getFoldersByName(fmtName);

    if (!fmtFolders.hasNext()) {
      Logger.log("Folder not found: " + fmtName);
      continue;
    }

    const fmtFolder = fmtFolders.next();
    Logger.log("Scanning: " + fmtName);
    scanFolderRecursive(fmtFolder, fmt, driveIndex);
  }

  Logger.log("Found " + Object.keys(driveIndex).length + " files on Drive");

  let updated = 0;
  let alreadyDone = 0;

  for (let i = 1; i < data.length; i++) {
    const fmt = data[i][colFormat];
    const filename = data[i][colFilename];
    const currentStatus = data[i][colUploadStatus];

    if (!fmt || !filename) continue;

    const key = fmt + "|" + filename;

    if (driveIndex[key]) {
      const info = driveIndex[key];

      if (currentStatus !== "Uploaded" || !data[i][colDriveLink]) {
        const row = i + 1;
        if (colDriveLink !== -1) sheet.getRange(row, colDriveLink + 1).setValue(info.link);
        if (colDriveFileId !== -1) sheet.getRange(row, colDriveFileId + 1).setValue(info.fileId);
        if (colUploadStatus !== -1) sheet.getRange(row, colUploadStatus + 1).setValue("Uploaded");
        updated++;
      } else {
        alreadyDone++;
      }
    }
  }

  const msg = "Sync complete!\n\n" +
    "Files on Drive: " + Object.keys(driveIndex).length + "\n" +
    "Rows updated: " + updated + "\n" +
    "Already up to date: " + alreadyDone;

  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}

function scanFolderRecursive(folder, fmt, index) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    if (name.endsWith(".mp4")) {
      const key = fmt + "|" + name;
      index[key] = {
        link: file.getUrl(),
        fileId: file.getId()
      };
    }
  }

  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    scanFolderRecursive(subfolders.next(), fmt, index);
  }
}

// ============================================================
// YOUTUBE BACK-SYNC (existing uploads → sheet)
// ============================================================

/**
 * Scan the YouTube channel for all uploaded videos, match them back to
 * rows in Publishing Schedule (and AppScript Upload if it exists),
 * then mark matched rows as Uploaded with the YouTube URL.
 *
 * Matching logic (tried in order):
 *   1. Video title contains the collection name (fuzzy)
 *   2. Video description contains the Drive file ID
 *   3. Video description contains the help page URL
 *
 * Requires: YouTube Data API v3 service enabled in Apps Script.
 */
function syncExistingYouTube() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  // --- Step 1: Fetch ALL videos from the channel ---
  const videos = fetchAllChannelVideos_();
  if (videos.length === 0) {
    ui.alert("No videos found on the channel.\n\nMake sure the YouTube Data API service is enabled:\nServices (+) → YouTube Data API v3");
    return;
  }

  Logger.log("Found " + videos.length + " videos on the channel");

  // --- Step 2: Build lookup indexes from videos ---
  // Normalize: lowercase, strip hyphens/underscores/spaces for fuzzy match
  const normalize = function(s) {
    return String(s || "").toLowerCase().replace(/[-_ ]+/g, " ").trim();
  };

  // Index by normalized title words and by description content
  const videosByNormTitle = {};   // normalized collection name → video
  const videosByDriveId = {};     // drive file ID found in description → video
  const videosByHelpUrl = {};     // help page URL in description → video

  for (const v of videos) {
    const normTitle = normalize(v.title);
    videosByNormTitle[normTitle] = v;

    // Scan description for Drive file IDs (alphanumeric 20+ chars)
    const driveIdMatches = (v.description || "").match(/[a-zA-Z0-9_-]{20,}/g) || [];
    for (const did of driveIdMatches) {
      videosByDriveId[did] = v;
    }

    // Scan description for help.stockflow.media URLs
    const urlMatches = (v.description || "").match(/https?:\/\/help\.stockflow\.media[^\s)"]*/g) || [];
    for (const url of urlMatches) {
      videosByHelpUrl[url] = v;
    }
  }

  // --- Step 3: Update sheets ---
  const sheetsToUpdate = [CONFIG.SHEET_NAME, "AppScript Upload"];
  let totalMatched = 0;
  let totalSkipped = 0;
  let totalAlready = 0;
  const matchedCollections = [];

  for (const sheetName of sheetsToUpdate) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const platform = row[CONFIG.COL.PLATFORM];
      if (platform !== "YouTube") continue;

      const status = row[CONFIG.COL.STATUS];
      // Skip if already marked as Uploaded with a Published URL
      if (status === CONFIG.STATUS.UPLOADED && row[CONFIG.COL.PUBLISHED_URL]) {
        totalAlready++;
        continue;
      }

      const collection = row[CONFIG.COL.COLLECTION] || "";
      const driveFileId = row[CONFIG.COL.DRIVE_FILE_ID] || "";
      const helpUrl = row[CONFIG.COL.HELP_PAGE_URL] || "";
      const rowNum = i + 1;

      // Try matching
      let matched = null;
      let matchMethod = "";

      // Method 1: Collection name in video title
      if (collection) {
        const normColl = normalize(collection);
        // Exact normalized match
        for (const normTitle in videosByNormTitle) {
          if (normTitle.indexOf(normColl) !== -1 || normColl.indexOf(normTitle.split("|")[0].trim()) !== -1) {
            matched = videosByNormTitle[normTitle];
            matchMethod = "title";
            break;
          }
        }
        // Also try: collection words all present in title
        if (!matched) {
          const collWords = normColl.split(" ").filter(function(w) { return w.length > 2; });
          for (const v of videos) {
            const vNorm = normalize(v.title);
            const allFound = collWords.every(function(w) { return vNorm.indexOf(w) !== -1; });
            if (allFound && collWords.length >= 2) {
              matched = v;
              matchMethod = "title-words";
              break;
            }
          }
        }
      }

      // Method 2: Drive file ID in description
      if (!matched && driveFileId && videosByDriveId[driveFileId]) {
        matched = videosByDriveId[driveFileId];
        matchMethod = "driveId";
      }

      // Method 3: Help page URL in description
      if (!matched && helpUrl && videosByHelpUrl[helpUrl]) {
        matched = videosByHelpUrl[helpUrl];
        matchMethod = "helpUrl";
      }

      if (matched) {
        const youtubeUrl = "https://www.youtube.com/watch?v=" + matched.videoId;

        // Update Published URL
        sheet.getRange(rowNum, CONFIG.COL.PUBLISHED_URL + 1).setValue(youtubeUrl);

        // Update Status
        sheet.getRange(rowNum, CONFIG.COL.STATUS + 1).setValue(CONFIG.STATUS.UPLOADED);
        sheet.getRange(rowNum, CONFIG.COL.STATUS + 1).setBackground("#b7e1cd");

        // Update Published At (use video publish date)
        if (matched.publishedAt) {
          sheet.getRange(rowNum, CONFIG.COL.PUBLISHED_AT + 1).setValue(new Date(matched.publishedAt));
        }

        // Update Notes
        sheet.getRange(rowNum, CONFIG.COL.NOTES + 1).setValue(
          "YouTube sync (" + matchMethod + ")"
        );

        // Check the Publish checkbox
        sheet.getRange(rowNum, CONFIG.COL.PUBLISH + 1).setValue(true);

        totalMatched++;
        if (sheetName === CONFIG.SHEET_NAME) {
          matchedCollections.push(collection || "(row " + rowNum + ")");
        }

        Logger.log("[" + sheetName + "] Row " + rowNum + " → " + youtubeUrl + " (via " + matchMethod + ")");
      } else {
        totalSkipped++;
      }
    }
  }

  // --- Step 4: Summary ---
  let msg = "YouTube Back-Sync Complete!\n\n";
  msg += "Channel videos found: " + videos.length + "\n";
  msg += "Sheet rows matched: " + totalMatched + "\n";
  msg += "Already up to date: " + totalAlready + "\n";
  msg += "Unmatched YouTube rows: " + totalSkipped + "\n";

  if (matchedCollections.length > 0 && matchedCollections.length <= 20) {
    msg += "\nMatched collections:\n";
    for (const c of matchedCollections) {
      msg += "  • " + c + "\n";
    }
  }

  Logger.log(msg);
  ui.alert(msg);
}

/**
 * Fetch ALL uploaded videos from the authorized user's YouTube channel.
 * Pages through results (50 per page) until all are retrieved.
 * Returns array of {videoId, title, description, publishedAt}
 */
function fetchAllChannelVideos_() {
  const videos = [];

  try {
    // Get the uploads playlist for the authenticated user's channel
    const channelResponse = YouTube.Channels.list("contentDetails", {
      mine: true
    });

    if (!channelResponse.items || channelResponse.items.length === 0) {
      Logger.log("No channel found for authenticated user");
      return videos;
    }

    const uploadsPlaylistId = channelResponse.items[0].contentDetails.relatedPlaylists.uploads;
    Logger.log("Uploads playlist: " + uploadsPlaylistId);

    // Page through all playlist items
    let nextPageToken = null;

    do {
      const params = {
        playlistId: uploadsPlaylistId,
        maxResults: 50
      };
      if (nextPageToken) params.pageToken = nextPageToken;

      const response = YouTube.PlaylistItems.list("snippet", params);

      if (response.items) {
        for (const item of response.items) {
          const snippet = item.snippet;
          videos.push({
            videoId: snippet.resourceId.videoId,
            title: snippet.title || "",
            description: snippet.description || "",
            publishedAt: snippet.publishedAt || ""
          });
        }
      }

      nextPageToken = response.nextPageToken || null;
    } while (nextPageToken);

  } catch (error) {
    Logger.log("YouTube fetch error: " + error.message);
    SpreadsheetApp.getUi().alert(
      "Error fetching YouTube videos:\n\n" + error.message +
      "\n\nMake sure YouTube Data API v3 is enabled:\nApps Script Editor → Services (+) → YouTube Data API v3"
    );
  }

  return videos;
}

/**
 * Make all unlisted videos on the Stockflow Media channel public.
 * Fetches all videos, checks privacy status, and sets unlisted → public.
 */
function makeAllVideosPublic() {
  const ui = SpreadsheetApp.getUi();
  // First fetch all videos from the authenticated user's channel
  const videos = fetchAllChannelVideos_();
  if (videos.length === 0) {
    ui.alert("No videos found on your channel.");
    return;
  }

  // Confirm with user
  const confirm = ui.alert(
    "Make Videos Public",
    "Found " + videos.length + " videos on the channel.\n\n" +
    "This will set ALL unlisted videos to PUBLIC.\nContinue?",
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  let madePublic = 0;
  let alreadyPublic = 0;
  let errors = 0;

  // Process in batches of 50 video IDs
  const batchSize = 50;
  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    const ids = batch.map(v => v.videoId).join(",");

    try {
      // Get current status for this batch
      const statusResponse = YouTube.Videos.list("status", { id: ids });

      if (statusResponse.items) {
        for (const item of statusResponse.items) {
          const currentPrivacy = item.status.privacyStatus;

          if (currentPrivacy === "public") {
            alreadyPublic++;
            continue;
          }

          // Update to public
          try {
            YouTube.Videos.update(
              {
                id: item.id,
                status: {
                  privacyStatus: "public",
                  selfDeclaredMadeForKids: false
                }
              },
              "status"
            );
            madePublic++;
            Logger.log("Set public: " + item.id);
          } catch (updateErr) {
            errors++;
            Logger.log("Failed to update " + item.id + ": " + updateErr.message);
          }
        }
      }
    } catch (batchErr) {
      Logger.log("Batch error: " + batchErr.message);
      errors += batch.length;
    }
  }

  ui.alert(
    "Make Videos Public — Complete",
    "Videos found: " + videos.length + "\n" +
    "Set to public: " + madePublic + "\n" +
    "Already public: " + alreadyPublic + "\n" +
    "Errors: " + errors +
    (errors > 0 ? "\n\nCheck Execution Log for details. The script may not have permission to modify videos on this channel." : ""),
    ui.ButtonSet.OK
  );
}

// ============================================================
// DERIVED SHEET GENERATORS
// ============================================================

/**
 * AppScript Upload platforms — these are handled by this script directly.
 * YouTube (W), WordPress (W), Substack (W), LinkedIn (W), Reddit (W)
 */
const APPSCRIPT_PLATFORMS = ["YouTube", "WordPress", "Substack", "LinkedIn", "Reddit"];

/**
 * FeedHive S platforms — Square format, one row per collection.
 * Instagram, Facebook, LinkedIn, Twitter
 */
const FEEDHIVE_S_PLATFORMS = ["Instagram", "Facebook", "LinkedIn", "Twitter"];

/**
 * FeedHive V platforms — Vertical format, one row per collection.
 * TikTok, Pinterest, Instagram, Facebook, LinkedIn, YouTube (Shorts)
 */
const FEEDHIVE_V_PLATFORMS = ["TikTok", "Pinterest", "Instagram", "Facebook", "LinkedIn", "YouTube"];

/**
 * Build FeedHive S description — max 280 chars (Twitter-safe).
 * Punchy, hashtag-heavy, one CTA link.
 */
function buildFeedHiveDescS_(collection, category, subcategory, stockflowUrl) {
  var name = collection.replace(/_/g, " ");
  var text = name + " — Premium stock footage & 8K images.";
  text += "\nRoyalty-free, instant download.";
  text += "\n" + stockflowUrl;

  // Add hashtags if space permits
  var tags = "\n#stockfootage #royaltyfree";
  if (category) tags += " #" + category.replace(/[- &]/g, "").toLowerCase();
  if (subcategory) tags += " #" + subcategory.replace(/[- &]/g, "").toLowerCase();

  if ((text + tags).length <= 280) {
    text += tags;
  }

  // Hard cap at 280
  if (text.length > 280) text = text.substring(0, 277) + "...";
  return text;
}

/**
 * Build FeedHive V description — max 500 chars (Pinterest-safe).
 * More descriptive, includes use cases.
 */
function buildFeedHiveDescV_(collection, category, subcategory, stockflowUrl, helpPageUrl) {
  var name = collection.replace(/_/g, " ");
  var catLower = (category || "").toLowerCase();

  var text = name + " — Professional stock footage in 4K video & 8K images.";

  if (catLower === "microscopic") {
    text += "\nPerfect for science documentaries, educational content, and research presentations.";
  } else {
    text += "\nPerfect for restaurant marketing, food blogs, and social media campaigns.";
  }

  text += "\nRoyalty-free. No attribution required. Instant download.";
  text += "\n\nBrowse: " + stockflowUrl;

  var tags = "\n#stockfootage #stockvideo #royaltyfree";
  if (category) tags += " #" + category.replace(/[- &]/g, "").toLowerCase();
  if (subcategory) tags += " #" + subcategory.replace(/[- &]/g, "").toLowerCase();
  tags += " #4kvideo #8kimages";

  if ((text + tags).length <= 500) {
    text += tags;
  }

  // Hard cap at 500
  if (text.length > 500) text = text.substring(0, 497) + "...";
  return text;
}

/**
 * Generate the "AppScript Upload" derived tab from the master Publishing Schedule.
 * Filters rows for YouTube, WordPress, and Substack only.
 * Mirrors the same column layout so publishRow() works on either tab.
 */
function generateAppScriptSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!master) {
    SpreadsheetApp.getUi().alert("Publishing Schedule tab not found!");
    return;
  }

  const tabName = "AppScript Upload";
  let target = ss.getSheetByName(tabName);
  if (target) {
    target.clear();
  } else {
    target = ss.insertSheet(tabName);
  }

  const data = master.getDataRange().getValues();
  const headers = data[0];

  // Write headers
  target.getRange(1, 1, 1, headers.length).setValues([headers]);
  target.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#4a86e8").setFontColor("#ffffff");

  // Filter rows for AppScript platforms — W format only (no S/V)
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const platform = data[i][CONFIG.COL.PLATFORM];
    const format = data[i][CONFIG.COL.FORMAT];
    if (APPSCRIPT_PLATFORMS.indexOf(platform) !== -1 && format === "W") {
      rows.push(data[i]);
    }
  }

  if (rows.length > 0) {
    target.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // Format column A as checkboxes
  if (rows.length > 0) {
    const checkRange = target.getRange(2, 1, rows.length, 1);
    checkRange.insertCheckboxes();
  }

  // Freeze header row
  target.setFrozenRows(1);

  // Auto-resize key columns
  for (let c = 1; c <= Math.min(headers.length, 12); c++) {
    target.autoResizeColumn(c);
  }

  const platformCounts = {};
  for (const row of rows) {
    const p = row[CONFIG.COL.PLATFORM];
    platformCounts[p] = (platformCounts[p] || 0) + 1;
  }

  let summary = "AppScript Upload sheet generated!\n\n";
  summary += "Total rows: " + rows.length + "\n\n";
  for (const p of APPSCRIPT_PLATFORMS) {
    summary += p + ": " + (platformCounts[p] || 0) + "\n";
  }

  Logger.log(summary);
  SpreadsheetApp.getUi().alert(summary);
}

/**
 * Helper: generate a FeedHive sheet tab for a given format (S or V).
 * One row per collection — description sized to fit all platforms in that format group.
 *
 * @param {string} formatCode - "S" or "V"
 * @param {string} tabName - Sheet tab name
 * @param {string[]} platforms - Platform list (for reference only, not written to CSV)
 * @param {string} headerColor - Background color for header
 */
function generateFeedHiveTab_(formatCode, tabName, platforms, headerColor) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!master) return { error: "Publishing Schedule tab not found!" };

  let target = ss.getSheetByName(tabName);
  if (target) {
    target.clear();
  } else {
    target = ss.insertSheet(tabName);
  }

  // FeedHive CSV headers
  const fhHeaders = ["Text", "Title", "Media URLs", "Labels", "Scheduled"];
  target.getRange(1, 1, 1, fhHeaders.length).setValues([fhHeaders]);
  target.getRange(1, 1, 1, fhHeaders.length).setFontWeight("bold").setBackground(headerColor).setFontColor("#ffffff");

  const data = master.getDataRange().getValues();
  const rows = [];
  const seen = {}; // Track collections to avoid duplicates (one row per collection)

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const format = r[CONFIG.COL.FORMAT] || "";
    if (format !== formatCode) continue;

    const collection = r[CONFIG.COL.COLLECTION] || "";
    // One row per collection per format — skip duplicates
    if (seen[collection]) continue;
    seen[collection] = true;

    const subcategory = r[CONFIG.COL.SUBCATEGORY] || "";
    const category = r[CONFIG.COL.CATEGORY] || "";
    const driveFileId = r[CONFIG.COL.DRIVE_FILE_ID] || "";
    const stockflowUrl = r[CONFIG.COL.STOCKFLOW_URL] || "https://stockflow.media";
    const helpPageUrl = r[CONFIG.COL.HELP_PAGE_URL] || "";
    const dateVal = r[CONFIG.COL.DATE];
    const timeVal = r[CONFIG.COL.TIME];

    // --- Text (post caption) — sized per format ---
    let text;
    if (formatCode === "S") {
      text = buildFeedHiveDescS_(collection, category, subcategory, stockflowUrl);
    } else {
      text = buildFeedHiveDescV_(collection, category, subcategory, stockflowUrl, helpPageUrl);
    }

    // --- Title (internal label) ---
    const title = collection + "_" + formatCode;

    // --- Media URLs (Drive direct download link) ---
    let mediaUrl = "";
    if (driveFileId) {
      mediaUrl = "https://drive.google.com/uc?export=download&id=" + driveFileId;
    }

    // --- Labels (category tag for FeedHive) ---
    const labels = category || "General";

    // --- Scheduled (YYYY-MM-DD HH:MM) ---
    let scheduled = "";
    const dt = parseScheduledDateTime(dateVal, timeVal);
    if (dt) {
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      const hh = String(dt.getHours()).padStart(2, "0");
      const mi = String(dt.getMinutes()).padStart(2, "0");
      scheduled = yyyy + "-" + mm + "-" + dd + " " + hh + ":" + mi;
    }

    rows.push([text, title, mediaUrl, labels, scheduled]);
  }

  if (rows.length > 0) {
    target.getRange(2, 1, rows.length, fhHeaders.length).setValues(rows);
  }

  // Freeze header, auto-resize
  target.setFrozenRows(1);
  for (let c = 1; c <= fhHeaders.length; c++) {
    target.autoResizeColumn(c);
  }

  return { count: rows.length, collections: Object.keys(seen).length };
}

/**
 * Generate "FeedHive Export (S)" — Square format.
 * One row per collection. Description max 280 chars (Twitter-safe).
 * Platforms: Instagram, Facebook, LinkedIn, Twitter
 */
function generateFeedHiveSheetS() {
  const result = generateFeedHiveTab_("S", "FeedHive Export (S)", FEEDHIVE_S_PLATFORMS, "#e8710a");
  if (result.error) {
    SpreadsheetApp.getUi().alert(result.error);
    return;
  }

  const summary = "FeedHive Export (S) generated!\n\n" +
    "Collections: " + result.collections + "\n" +
    "Rows: " + result.count + "\n" +
    "Max caption: 280 chars (Twitter-safe)\n\n" +
    "Platforms: Instagram, Facebook, LinkedIn, Twitter\n\n" +
    "To export: click this tab → File → Download → CSV (.csv)";

  Logger.log(summary);
  SpreadsheetApp.getUi().alert(summary);
}

/**
 * Generate "FeedHive Export (V)" — Vertical format.
 * One row per collection. Description max 500 chars (Pinterest-safe).
 * Platforms: TikTok, Pinterest, Instagram, Facebook, LinkedIn, YouTube (Shorts)
 */
function generateFeedHiveSheetV() {
  const result = generateFeedHiveTab_("V", "FeedHive Export (V)", FEEDHIVE_V_PLATFORMS, "#9334e8");
  if (result.error) {
    SpreadsheetApp.getUi().alert(result.error);
    return;
  }

  const summary = "FeedHive Export (V) generated!\n\n" +
    "Collections: " + result.collections + "\n" +
    "Rows: " + result.count + "\n" +
    "Max caption: 500 chars (Pinterest-safe)\n\n" +
    "Platforms: TikTok, Pinterest, Instagram, Facebook, LinkedIn, YouTube Shorts\n\n" +
    "To export: click this tab → File → Download → CSV (.csv)";

  Logger.log(summary);
  SpreadsheetApp.getUi().alert(summary);
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Parse date + time into a Date object
 */
function parseScheduledDateTime(dateVal, timeVal) {
  try {
    let d;
    if (dateVal instanceof Date) {
      d = new Date(dateVal);
    } else {
      d = new Date(dateVal);
    }

    if (isNaN(d.getTime())) return null;

    if (timeVal) {
      if (timeVal instanceof Date) {
        d.setHours(timeVal.getHours(), timeVal.getMinutes(), 0, 0);
      } else {
        const timeParts = String(timeVal).match(/(\d{1,2}):(\d{2})/);
        if (timeParts) {
          d.setHours(parseInt(timeParts[1]), parseInt(timeParts[2]), 0, 0);
        }
      }
    }

    return d;
  } catch (e) {
    return null;
  }
}
