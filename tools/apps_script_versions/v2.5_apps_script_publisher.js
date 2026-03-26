/**
 * Stockflow Publishing System — Apps Script
 */
// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  SHEET_NAME: "Publishing Schedule",
  CONTENT_LIBRARY_SHEET: "Content Library",
  DRIVE_ROOT_FOLDER_ID: "1I2BpqMn5bAwOQwEJpzglZglDqujRI6D9",
  CALENDAR_NAME: "Stockflow Publishing",
  // WordPress.com REST API
  WORDPRESS_SITE: "stockflowmedia.wordpress.com",
  WORDPRESS_USER: "stockflowmedia@gmail.com", // <-- FIXED: Uses WordPress username
  WP_POST_EMAIL: "vazo350voye@post.wordpress.com",
  WORDPRESS_APP_PASSWORD_KEY: "WP_APP_PASSWORD",
  // Column indices (0-based) for AppScript Upload tab
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
  // Column indices (0-based) for Content Library tab
  LIB_COL: {
    FORMAT: 0,           // A - W/S/V
    CONTENT_TYPE: 1,     // B - Montage/Clip/UGC
    CATEGORY: 2,         // C
    SUBCATEGORY: 3,      // D
    COLLECTION: 4,       // E
    FILENAME: 5,         // F
    FILE_SIZE: 6,        // G
    DRIVE_LINK: 7,       // H
    DRIVE_FILE_ID: 8,    // I
    UPLOAD_STATUS: 9,    // J
    HELP_URL: 10,        // K
    STOCKFLOW_URL: 11,   // L
    NOTES: 12            // M
  },
  // Platform daily quotas
  QUOTAS: {
    "YouTube": 6,
    "TikTok": 10,
    "Instagram": 10,
    "LinkedIn": 2,
    "Twitter": 15,
    "Pinterest": 25,
    "Facebook": 10,
    "Reddit": 0,
    "WordPress": 6
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
    .addItem("Test WordPress Connection", "testWordPressConnection")
    .addSeparator()
    .addItem("Generate AppScript Upload Sheet", "generateAppScriptSheet")
    .addItem("Generate FeedHive Export (S)", "generateFeedHiveSheetS")
    .addItem("Generate FeedHive Export (V)", "generateFeedHiveSheetV")
    .addItem("Generate Feedhive Export (W)", "generateFeedHiveSheetW")
    .addSeparator()
    .addItem("Configure Auto-Publish", "configureAutoPublish")
    .addItem("View Auto-Publish Status", "viewAutoPublishStatus")
    .addItem("Check Script Identity", "checkScriptIdentity")
    .addToUi();
}
function setupTriggers() {
  removeTriggers();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger("onCheckboxEdit")
    .forSpreadsheet(ss)
    .onEdit()
    .create();
  ScriptApp.newTrigger("publishDueItems")
    .timeBased()
    .everyHours(1)
    .create();
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
    "Triggers set up!\n\n1. Checkbox listener (installable trigger) for immediate publishing\n2. Hourly check for scheduled items\n3. Calendar sync on event changes"
  );
}
function removeTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  const autoHandlers = ["autoPublishYouTube", "autoPublishWordPress", "autoPublishReddit"];
  for (const trigger of triggers) {
    const handler = trigger.getHandlerFunction();
    if (handler === "publishDueItems" || handler === "onCalendarChange" ||
        handler === "onCheckboxEdit" || handler === "onEdit" ||
        autoHandlers.includes(handler)) {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}
// ============================================================
// AUTO-PUBLISH SYSTEM (per-platform configurable automation)
// ============================================================
const AUTO_PLATFORMS = ["YouTube", "WordPress", "Reddit"];

/**
 * Configure auto-publish for each platform independently.
 * Stores settings in Script Properties as JSON.
 * dailyLimit = 0 means disabled.
 */
function configureAutoPublish() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  // Step 1: Pick platform
  const platformChoice = ui.prompt(
    "Configure Auto-Publish",
    "Which platform?\n\n" +
    "1 = YouTube\n2 = WordPress\n3 = Reddit\n4 = ALL (view/reset)\n\nEnter number:",
    ui.ButtonSet.OK_CANCEL
  );
  if (platformChoice.getSelectedButton() !== ui.Button.OK) return;
  const choice = parseInt(platformChoice.getResponseText().trim());
  if (choice === 5) {
    // Reset all
    const confirm = ui.alert("Reset All", "Set all platforms to 0 (disabled)?", ui.ButtonSet.YES_NO);
    if (confirm === ui.Button.YES) {
      for (const p of AUTO_PLATFORMS) {
        props.setProperty("AUTO_" + p.toUpperCase(), JSON.stringify({ dailyLimit: 0, intervalMinutes: 60, startDate: "" }));
        removeAutoTrigger_(p);
      }
      ui.alert("All auto-publish disabled.");
    }
    return;
  }
  const platform = AUTO_PLATFORMS[choice - 1];
  if (!platform) { ui.alert("Invalid choice."); return; }

  // Load current settings
  const currentRaw = props.getProperty("AUTO_" + platform.toUpperCase());
  const current = currentRaw ? JSON.parse(currentRaw) : { dailyLimit: 0, intervalMinutes: 60, startDate: "" };

  // Step 2: Daily limit
  const limitPrompt = ui.prompt(
    "Auto-Publish: " + platform,
    "Current daily limit: " + current.dailyLimit + "\n\n" +
    "Enter new daily limit (0 = OFF, 1-50):\n" +
    "(How many uploads per day for " + platform + ")",
    ui.ButtonSet.OK_CANCEL
  );
  if (limitPrompt.getSelectedButton() !== ui.Button.OK) return;
  const newLimit = parseInt(limitPrompt.getResponseText().trim());
  if (isNaN(newLimit) || newLimit < 0) { ui.alert("Invalid number."); return; }

  if (newLimit === 0) {
    // Disable
    const offConfig = { dailyLimit: 0, intervalMinutes: 60, startDate: "" };
    props.setProperty("AUTO_" + platform.toUpperCase(), JSON.stringify(offConfig));
    removeAutoTrigger_(platform);
    stampSchedulerInfo_(platform, offConfig);
    ui.alert(platform + " auto-publish DISABLED.");
    return;
  }

  // Step 3: Interval
  const intervalPrompt = ui.prompt(
    "Auto-Publish: " + platform + " — Interval",
    "Current interval: " + current.intervalMinutes + " minutes\n\n" +
    "How often should the trigger run? (minutes)\n" +
    "30 = every 30 min\n60 = every hour (recommended)\n120 = every 2 hours\n\n" +
    "The system will spread " + newLimit + " uploads across these intervals within the day.",
    ui.ButtonSet.OK_CANCEL
  );
  if (intervalPrompt.getSelectedButton() !== ui.Button.OK) return;
  const newInterval = parseInt(intervalPrompt.getResponseText().trim());
  if (isNaN(newInterval) || newInterval < 10) { ui.alert("Minimum interval is 10 minutes."); return; }

  // Step 4: Start date
  const tomorrow = new Date(Date.now() + 86400000);
  const defaultDate = Utilities.formatDate(tomorrow, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const datePrompt = ui.prompt(
    "Auto-Publish: " + platform + " — Start Date",
    "When should auto-publishing start?\n\n" +
    "Enter date (YYYY-MM-DD) or leave blank for tomorrow (" + defaultDate + "):",
    ui.ButtonSet.OK_CANCEL
  );
  if (datePrompt.getSelectedButton() !== ui.Button.OK) return;
  const dateInput = datePrompt.getResponseText().trim();
  let startDate = defaultDate;
  if (dateInput) {
    const parsed = new Date(dateInput + "T00:00:00");
    if (isNaN(parsed.getTime())) { ui.alert("Invalid date."); return; }
    startDate = dateInput;
  }

  // Save config
  const config = { dailyLimit: newLimit, intervalMinutes: newInterval, startDate: startDate };
  props.setProperty("AUTO_" + platform.toUpperCase(), JSON.stringify(config));

  // Setup trigger
  setupAutoTrigger_(platform, newInterval);

  // Stamp the sheet with scheduler info
  stampSchedulerInfo_(platform, config);

  ui.alert(
    platform + " Auto-Publish Configured!\n\n" +
    "Daily limit: " + newLimit + " uploads\n" +
    "Interval: every " + newInterval + " minutes\n" +
    "Start date: " + startDate + "\n\n" +
    "The trigger is now active. Set limit to 0 to disable."
  );
}

/**
 * View current auto-publish status for all platforms
 */
function viewAutoPublishStatus() {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("AppScript Upload") || ss.getSheetByName(CONFIG.SHEET_NAME);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let msg = "Auto-Publish Status\n" + "═".repeat(30) + "\n\n";

  for (const platform of AUTO_PLATFORMS) {
    const raw = props.getProperty("AUTO_" + platform.toUpperCase());
    const config = raw ? JSON.parse(raw) : { dailyLimit: 0, intervalMinutes: 60, startDate: "" };

    // Count today's uploads
    let todayCount = 0;
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][CONFIG.COL.PLATFORM] === platform &&
            data[i][CONFIG.COL.STATUS] === CONFIG.STATUS.UPLOADED) {
          const pubDate = data[i][CONFIG.COL.PUBLISHED_AT];
          if (pubDate instanceof Date) {
            const pubDay = new Date(pubDate);
            pubDay.setHours(0, 0, 0, 0);
            if (pubDay.getTime() === today.getTime()) todayCount++;
          }
        }
      }
    }

    const status = config.dailyLimit > 0 ? "ON" : "OFF";
    msg += platform + ": " + status + "\n";
    if (config.dailyLimit > 0) {
      msg += "  Limit: " + todayCount + "/" + config.dailyLimit + " today\n";
      msg += "  Interval: " + config.intervalMinutes + " min\n";
      msg += "  Start: " + config.startDate + "\n";
    }
    msg += "\n";
  }

  SpreadsheetApp.getUi().alert(msg);
}

/**
 * Create a time-driven trigger for a specific platform
 */
function setupAutoTrigger_(platform, intervalMinutes) {
  removeAutoTrigger_(platform);
  const handlerName = "autoPublish" + platform;
  const trigger = ScriptApp.newTrigger(handlerName).timeBased();
  // Apps Script only allows everyMinutes(1,5,10,15,30) — use everyHours for longer
  if (intervalMinutes <= 5) trigger.everyMinutes(5);
  else if (intervalMinutes <= 10) trigger.everyMinutes(10);
  else if (intervalMinutes <= 15) trigger.everyMinutes(15);
  else if (intervalMinutes <= 30) trigger.everyMinutes(30);
  else if (intervalMinutes <= 60) trigger.everyHours(1);
  else if (intervalMinutes <= 120) trigger.everyHours(2);
  else if (intervalMinutes <= 240) trigger.everyHours(4);
  else if (intervalMinutes <= 360) trigger.everyHours(6);
  else trigger.everyHours(12);
  trigger.create();
  Logger.log("Auto-publish trigger created: " + handlerName + " every " + intervalMinutes + " min");
}

/**
 * Remove existing auto-publish trigger for a platform
 */
function removeAutoTrigger_(platform) {
  const handlerName = "autoPublish" + platform;
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

/**
 * Stamp scheduler info into empty columns for visual feedback.
 * C = Start Date, D = Daily Limit, E = Interval, G = Auto Status
 */
function stampSchedulerInfo_(platform, config) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("AppScript Upload") || ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][CONFIG.COL.PLATFORM] !== platform) continue;
    // Skip rows already published
    if (data[i][CONFIG.COL.STATUS] === CONFIG.STATUS.UPLOADED) continue;

    const rowNum = i + 1;
    if (config.dailyLimit > 0) {
      sheet.getRange(rowNum, CONFIG.COL.DATE + 1).setValue(config.startDate);       // C: Start Date
      sheet.getRange(rowNum, CONFIG.COL.DAY + 1).setValue(config.dailyLimit + "/day"); // D: Daily Limit
      sheet.getRange(rowNum, CONFIG.COL.TIME + 1).setValue(config.intervalMinutes + " min"); // E: Interval
      sheet.getRange(rowNum, CONFIG.COL.PHASE + 1).setValue("AUTO ON");             // G: Status
      sheet.getRange(rowNum, CONFIG.COL.PHASE + 1).setBackground("#d9ead3");        // light green
    } else {
      sheet.getRange(rowNum, CONFIG.COL.DATE + 1).setValue("");
      sheet.getRange(rowNum, CONFIG.COL.DAY + 1).setValue("");
      sheet.getRange(rowNum, CONFIG.COL.TIME + 1).setValue("");
      sheet.getRange(rowNum, CONFIG.COL.PHASE + 1).setValue("MANUAL");
      sheet.getRange(rowNum, CONFIG.COL.PHASE + 1).setBackground(null);
    }
  }
}

/**
 * After a row is published by auto-publish, update columns C/D/E with actual values.
 */
function stampPublishedRow_(sheet, rowNum) {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  sheet.getRange(rowNum, CONFIG.COL.DATE + 1).setValue(now);                    // C: Actual publish date
  sheet.getRange(rowNum, CONFIG.COL.DAY + 1).setValue(days[now.getDay()]);      // D: Actual day
  sheet.getRange(rowNum, CONFIG.COL.TIME + 1).setValue(hours + ":" + minutes);  // E: Actual time
  sheet.getRange(rowNum, CONFIG.COL.PHASE + 1).setValue("DONE");                // G: Done
  sheet.getRange(rowNum, CONFIG.COL.PHASE + 1).setBackground("#b7e1cd");        // green
}

/**
 * Core auto-publish processor — called by each platform's trigger function.
 * Finds unpublished rows for the platform and publishes up to the remaining daily limit.
 */
function autoPublishPlatform_(platform) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty("AUTO_" + platform.toUpperCase());
  if (!raw) return;
  const config = JSON.parse(raw);

  // Check if enabled
  if (!config.dailyLimit || config.dailyLimit <= 0) return;

  // Check start date
  if (config.startDate) {
    const startDate = new Date(config.startDate + "T00:00:00");
    const now = new Date();
    if (now < startDate) {
      Logger.log("Auto-publish " + platform + ": waiting for start date " + config.startDate);
      return;
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("AppScript Upload") || ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    Logger.log("Auto-publish " + platform + ": No AppScript Upload sheet found. Stopping.");
    return;
  }

  const data = sheet.getDataRange().getValues();

  // SAFETY: Check if any rows exist for this platform at all
  let totalPlatformRows = 0;
  let unpublishedRows = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let todayCount = 0;

  for (let i = 1; i < data.length; i++) {
    if (data[i][CONFIG.COL.PLATFORM] !== platform) continue;
    totalPlatformRows++;
    if (data[i][CONFIG.COL.STATUS] !== CONFIG.STATUS.UPLOADED) unpublishedRows++;
    if (data[i][CONFIG.COL.STATUS] === CONFIG.STATUS.UPLOADED) {
      const pubDate = data[i][CONFIG.COL.PUBLISHED_AT];
      if (pubDate instanceof Date) {
        const pubDay = new Date(pubDate);
        pubDay.setHours(0, 0, 0, 0);
        if (pubDay.getTime() === today.getTime()) todayCount++;
      }
    }
  }

  // No rows for this platform — auto-disable trigger
  if (totalPlatformRows === 0) {
    Logger.log("Auto-publish " + platform + ": No rows found in sheet. Auto-disabling trigger.");
    const offConfig = { dailyLimit: 0, intervalMinutes: 60, startDate: "" };
    props.setProperty("AUTO_" + platform.toUpperCase(), JSON.stringify(offConfig));
    removeAutoTrigger_(platform);
    return;
  }

  // All rows already published — auto-disable trigger
  if (unpublishedRows === 0) {
    Logger.log("Auto-publish " + platform + ": All " + totalPlatformRows + " rows published. Auto-disabling trigger.");
    const offConfig = { dailyLimit: 0, intervalMinutes: 60, startDate: "" };
    props.setProperty("AUTO_" + platform.toUpperCase(), JSON.stringify(offConfig));
    removeAutoTrigger_(platform);
    return;
  }

  const remaining = config.dailyLimit - todayCount;
  if (remaining <= 0) {
    Logger.log("Auto-publish " + platform + ": daily limit reached (" + todayCount + "/" + config.dailyLimit + ")");
    return;
  }

  // Calculate how many to publish this batch (spread across intervals)
  const batchesPerDay = Math.floor(1440 / (config.intervalMinutes || 60)); // 1440 min/day
  const perBatch = Math.max(1, Math.ceil(config.dailyLimit / batchesPerDay));
  const batchSize = Math.min(perBatch, remaining);

  Logger.log("Auto-publish " + platform + ": " + todayCount + "/" + config.dailyLimit + " today, " + unpublishedRows + " remaining, publishing up to " + batchSize + " this batch");

  // Find and publish eligible rows
  let published = 0;
  for (let i = 1; i < data.length; i++) {
    if (published >= batchSize) break;

    const row = data[i];
    if (row[CONFIG.COL.PLATFORM] !== platform) continue;
    if (row[CONFIG.COL.STATUS] === CONFIG.STATUS.UPLOADED) continue;
    if (row[CONFIG.COL.STATUS] === CONFIG.STATUS.UPLOADING) continue;
    if (!row[CONFIG.COL.DRIVE_FILE_ID] && !row[CONFIG.COL.DRIVE_LINK]) continue;

    publishRow(sheet, i + 1);
    // Check if it actually succeeded before stamping
    const newStatus = sheet.getRange(i + 1, CONFIG.COL.STATUS + 1).getValue();
    if (newStatus === CONFIG.STATUS.UPLOADED) {
      stampPublishedRow_(sheet, i + 1);
    }
    published++;
    if (published < batchSize) Utilities.sleep(3000); // 3s pause between uploads
  }

  Logger.log("Auto-publish " + platform + ": published " + published + " items this batch");
}

// Per-platform trigger handler functions
function autoPublishYouTube() { autoPublishPlatform_("YouTube"); }
function autoPublishWordPress() { autoPublishPlatform_("WordPress"); }
function autoPublishLinkedIn() { autoPublishPlatform_("LinkedIn"); }
function autoPublishReddit() { autoPublishPlatform_("Reddit"); }

// ============================================================
// CHECKBOX TRIGGER (onCheckboxEdit)
// ============================================================
function onCheckboxEdit(e) {
  const sheet = e.source.getActiveSheet();
  const sheetName = sheet.getName();
  if (sheetName !== CONFIG.SHEET_NAME && sheetName !== "AppScript Upload") return;
  const row = e.range.getRow();
  const col = e.range.getColumn();
  if (col !== 1 || row <= 1) return;
  const value = e.value;
  if (value === "TRUE") {
    publishRow(sheet, row);
  } else if (value === "FALSE") {
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
  statusCell.setValue(CONFIG.STATUS.UPLOADING);
  statusCell.setBackground("#fff2cc");
  SpreadsheetApp.flush();
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
      case "wordpress":
        result = uploadToWordPress(fileId, {
          format, category, subcategory, collection,
          helpPageUrl: data[CONFIG.COL.HELP_PAGE_URL],
          stockflowUrl: data[CONFIG.COL.STOCKFLOW_URL]
        });
        break;
      case "linkedin":
        result = uploadToLinkedIn(fileId, {
          format, category, subcategory, collection,
          helpPageUrl: data[CONFIG.COL.HELP_PAGE_URL],
          stockflowUrl: data[CONFIG.COL.STOCKFLOW_URL]
        });
        break;
      default:
        result = { success: false, error: platform + " upload not yet implemented" };
    }
    if (result.success) {
      statusCell.setValue(CONFIG.STATUS.UPLOADED);
      statusCell.setBackground("#b7e1cd");
      if (result.url) {
        sheet.getRange(row, CONFIG.COL.PUBLISHED_URL + 1).setValue(result.url);
      }
      sheet.getRange(row, CONFIG.COL.PUBLISHED_AT + 1).setValue(new Date());
      notesCell.setValue("Published successfully");
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
  }
}
function publishDueItems() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("AppScript Upload") || ss.getSheetByName(CONFIG.SHEET_NAME);
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
    if (status === CONFIG.STATUS.UPLOADED || status === CONFIG.STATUS.UPLOADING || isChecked === true) continue;
    if (!dateVal || !timeVal) continue;
    const scheduledDate = parseScheduledDateTime(dateVal, timeVal);
    if (!scheduledDate || scheduledDate > now) continue;
    if (!quotaUsed[platform]) quotaUsed[platform] = 0;
    const maxQuota = CONFIG.QUOTAS[platform] || 5;
    if (quotaUsed[platform] >= maxQuota) continue;
    publishRow(sheet, i + 1);
    quotaUsed[platform]++;
    published++;
    Utilities.sleep(2000);
  }
}
function isCheckboxChecked_(value) {
  if (value === true) return true;
  if (typeof value === "string" && value.toUpperCase() === "TRUE") return true;
  return false;
}
function publishSelected() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const data = sheet.getDataRange().getValues();
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (isCheckboxChecked_(data[i][CONFIG.COL.PUBLISH]) && data[i][CONFIG.COL.STATUS] !== CONFIG.STATUS.UPLOADED) {
      publishRow(sheet, i + 1);
      count++;
      Utilities.sleep(2000);
    }
  }
  SpreadsheetApp.getUi().alert("Published " + count + " items.");
}
function debugPublishSelected() {
  SpreadsheetApp.getUi().alert("Debug tool active");
}
function auditAndFixStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("AppScript Upload") || ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  let fixed = 0, cleared = 0;
  for (let i = 1; i < data.length; i++) {
    const status = data[i][CONFIG.COL.STATUS] || "";
    const pubUrl = data[i][CONFIG.COL.PUBLISHED_URL] || "";
    const rowNum = i + 1;
    if (pubUrl && status !== CONFIG.STATUS.UPLOADED) {
      sheet.getRange(rowNum, CONFIG.COL.STATUS + 1).setValue(CONFIG.STATUS.UPLOADED).setBackground("#b7e1cd");
      sheet.getRange(rowNum, CONFIG.COL.PUBLISH + 1).setValue(true);
      fixed++;
    }
    if (status === CONFIG.STATUS.UPLOADED && !pubUrl && !data[i][CONFIG.COL.PUBLISHED_AT]) {
      sheet.getRange(rowNum, CONFIG.COL.STATUS + 1).setValue("").setBackground(null);
      sheet.getRange(rowNum, CONFIG.COL.PUBLISH + 1).setValue(false);
      cleared++;
    }
  }
  SpreadsheetApp.getUi().alert(`Status Audit Complete\nFixed: ${fixed}\nCleared: ${cleared}`);
}
function publishNextYouTube() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (!isCheckboxChecked_(data[i][CONFIG.COL.PUBLISH]) && data[i][CONFIG.COL.STATUS] !== CONFIG.STATUS.UPLOADED && data[i][CONFIG.COL.PLATFORM] === "YouTube" && data[i][CONFIG.COL.DRIVE_FILE_ID]) {
      const rowNum = i + 1;
      sheet.getRange(rowNum, CONFIG.COL.PUBLISH + 1).setValue(true);
      publishRow(sheet, rowNum);
      SpreadsheetApp.getUi().alert("Published Row " + rowNum);
      return;
    }
  }
  SpreadsheetApp.getUi().alert("No eligible YouTube rows found.");
}
// ============================================================
// YOUTUBE UPLOAD
// ============================================================
function uploadToYouTube(driveFileId, meta) {
  try {
    const file = DriveApp.getFileById(driveFileId);
    const fileName = file.getName();
    const fileSize = file.getSize();
    const title = buildYouTubeTitle(meta, fileName);
    const description = buildYouTubeDescription(meta);
    const tags = buildYouTubeTags(meta);
    if (fileSize <= 50 * 1024 * 1024) {
      return youtubeSimpleUpload(file, title, description, tags);
    } else {
      return youtubeResumableUpload(file, fileSize, title, description, tags);
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}
function youtubeSimpleUpload(file, title, description, tags) {
  const blob = file.getBlob();
  const resource = {
    snippet: { title: title, description: description, tags: tags, categoryId: "22" },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false }
  };
  const video = YouTube.Videos.insert(resource, "snippet,status", blob);
  return { success: true, url: "https://www.youtube.com/watch?v=" + video.id, videoId: video.id };
}
function youtubeResumableUpload(file, fileSize, title, description, tags) {
  const accessToken = ScriptApp.getOAuthToken();
  const metadata = {
    snippet: { title: title, description: description, tags: tags, categoryId: "22" },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false }
  };
  const initResponse = UrlFetchApp.fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": fileSize, "X-Upload-Content-Type": "video/mp4" },
      payload: JSON.stringify(metadata),
      muteHttpExceptions: true
    }
  );
  if (initResponse.getResponseCode() !== 200) return { success: false, error: "Init failed: " + initResponse.getContentText() };
  const uploadUrl = initResponse.getHeaders()["Location"] || initResponse.getHeaders()["location"];

  const downloadUrl = "https://www.googleapis.com/drive/v3/files/" + file.getId() + "?alt=media";
  const CHUNK_SIZE = 32 * 1024 * 1024;
  let offset = 0;
  while (offset < fileSize) {
    const end = Math.min(offset + CHUNK_SIZE, fileSize);
    const driveResponse = UrlFetchApp.fetch(downloadUrl, {
      headers: { "Authorization": "Bearer " + accessToken, "Range": "bytes=" + offset + "-" + (end - 1) },
      muteHttpExceptions: true
    });
    const chunkBlob = driveResponse.getBlob();
    const uploadResponse = UrlFetchApp.fetch(uploadUrl, {
      method: "PUT",
      headers: { "Authorization": "Bearer " + accessToken, "Content-Range": "bytes " + offset + "-" + (end - 1) + "/" + fileSize },
      payload: chunkBlob,
      muteHttpExceptions: true
    });
    const code = uploadResponse.getResponseCode();
    if (code === 200 || code === 201) {
      const result = JSON.parse(uploadResponse.getContentText());
      return { success: true, url: "https://www.youtube.com/watch?v=" + result.id, videoId: result.id };
    } else if (code === 308) {
      offset = end;
    } else {
      return { success: false, error: "Upload chunk failed" };
    }
  }
  return { success: false, error: "Upload ended without completion" };
}
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
function buildYouTubeDescription(meta) {
  let desc = "Premium stock footage from Stockflow.media\n\n";
  if (meta.collection) desc += "Collection: " + meta.collection + "\n";
  if (meta.subcategory) desc += "Category: " + meta.subcategory + "\n";
  if (meta.category) desc += "Theme: " + meta.category + "\n\n";
  desc += "Browse & License: " + (meta.stockflowUrl || "https://stockflow.media") + "\n";
  if (meta.helpPageUrl) desc += "Details: " + meta.helpPageUrl + "\n";
  desc += "\n#stockfootage #stockvideo #stockflow";
  return desc;
}
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
var CATEGORY_SEO = {
  "Microscopic": {
    audience: "science educators, documentary filmmakers, medical professionals",
    useCase: "educational videos, scientific presentations, documentary B-roll",
    keywords: "microscopic stock footage, microscopy video, science stock video",
    intro: "Explore the hidden world under the microscope with this stunning collection of professionally captured microscopic footage.",
    whyChoose: "Our microscopic footage is captured using professional-grade microscopy equipment, delivering exceptional clarity."
  },
  "Food Beverage": {
    audience: "food bloggers, restaurant owners, advertising agencies",
    useCase: "restaurant promotions, food delivery app content, social media marketing",
    keywords: "food stock footage, culinary video, restaurant footage",
    intro: "Elevate your food content with this mouthwatering collection of professionally shot culinary footage.",
    whyChoose: "Our food footage is shot with cinematic lighting and professional color grading."
  }
};
function testWordPressConnection() {
  var appPassword = PropertiesService.getScriptProperties().getProperty(CONFIG.WORDPRESS_APP_PASSWORD_KEY);
  if (!appPassword) return SpreadsheetApp.getUi().alert("WP_APP_PASSWORD not set.");
  var apiUrl = "https://public-api.wordpress.com/rest/v1.1/sites/" + CONFIG.WORDPRESS_SITE;
  var authHeader = "Basic " + Utilities.base64Encode(CONFIG.WORDPRESS_USER + ":" + appPassword);
  var response = UrlFetchApp.fetch(apiUrl, { method: "get", headers: { "Authorization": authHeader }, muteHttpExceptions: true });
  var body = JSON.parse(response.getContentText());
  if (response.getResponseCode() === 200) SpreadsheetApp.getUi().alert("WordPress connected!\n\nSite: " + body.name);
  else SpreadsheetApp.getUi().alert("WordPress connection failed:\n" + (body.message || body.error));
}
function findYouTubeUrlForCollection_(sheet, collection) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][CONFIG.COL.PLATFORM] === "YouTube" && data[i][CONFIG.COL.COLLECTION] === collection && data[i][CONFIG.COL.PUBLISHED_URL]) {
      return data[i][CONFIG.COL.PUBLISHED_URL];
    }
  }
  return "";
}
function previewWordPressBlog() {
  SpreadsheetApp.getUi().alert("Preview tool active.");
}
// ============================================================
// QUOTA & CALENDAR
// ============================================================
/**
 * Show YouTube quota usage for today
 */
function checkYouTubeQuota() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("AppScript Upload") || ss.getSheetByName(CONFIG.SHEET_NAME);
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("AppScript Upload") || ss.getSheetByName(CONFIG.SHEET_NAME);
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("AppScript Upload") || ss.getSheetByName(CONFIG.SHEET_NAME);
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
// DRIVE SYNC — Batch-aware (Stockflow-social/BatchXX/)
// ============================================================
const CONTENT_TYPES = ["Montages", "Clips", "UGC"];  // Priority order
const FORMAT_CODES = ["W", "S", "V"];

/**
 * Scan Drive batch folders and populate/update Content Library sheet.
 * Prompts for batch name. Scans Montages → Clips → UGC in priority order.
 * Augments existing data (skips files already in sheet).
 */
function syncDriveToSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const sheet = ss.getSheetByName(CONFIG.CONTENT_LIBRARY_SHEET);
  if (!sheet) { ui.alert("Content Library tab not found!"); return; }

  const rootFolder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);

  // Find available batch folders
  const batchFolders = [];
  const folderIter = rootFolder.getFolders();
  while (folderIter.hasNext()) {
    const f = folderIter.next();
    if (f.getName().toLowerCase().startsWith("batch")) {
      batchFolders.push({ name: f.getName(), id: f.getId() });
    }
  }

  if (batchFolders.length === 0) {
    ui.alert("No Batch folders found in Drive!\n\nExpected: Stockflow-social/Batch01/");
    return;
  }

  // Prompt for batch selection
  let promptText = "Select batch to scan:\n\n";
  batchFolders.sort((a, b) => a.name.localeCompare(b.name));
  for (let i = 0; i < batchFolders.length; i++) {
    promptText += (i + 1) + " = " + batchFolders[i].name + "\n";
  }
  promptText += (batchFolders.length + 1) + " = ALL batches\n";

  const response = ui.prompt("Sync Drive → Sheet", promptText, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const choice = parseInt(response.getResponseText().trim());

  let selectedBatches = [];
  if (choice === batchFolders.length + 1) {
    selectedBatches = batchFolders;
  } else if (choice >= 1 && choice <= batchFolders.length) {
    selectedBatches = [batchFolders[choice - 1]];
  } else {
    ui.alert("Invalid choice.");
    return;
  }

  // Build index of existing filenames in sheet to skip duplicates
  const LC = CONFIG.LIB_COL;
  const existingData = sheet.getDataRange().getValues();
  const existingFiles = {};
  for (let i = 1; i < existingData.length; i++) {
    const fmt = existingData[i][LC.FORMAT] || "";
    const filename = existingData[i][LC.FILENAME] || "";
    if (fmt && filename) existingFiles[fmt + "|" + filename] = true;
  }
  const existingRowCount = existingData.length - 1; // minus header

  // Scan Drive and collect new files
  const newRows = [];
  let scannedTotal = 0;
  let skippedTotal = 0;

  for (const batch of selectedBatches) {
    const batchFolder = DriveApp.getFolderById(batch.id);
    Logger.log("Scanning batch: " + batch.name);

    for (const contentType of CONTENT_TYPES) {
      const ctFolders = batchFolder.getFoldersByName(contentType);
      if (!ctFolders.hasNext()) continue;
      const ctFolder = ctFolders.next();

      for (const fmt of FORMAT_CODES) {
        const fmtFolders = ctFolder.getFoldersByName(fmt);
        if (!fmtFolders.hasNext()) continue;
        const fmtFolder = fmtFolders.next();

        // Scan all files in this format folder
        const files = fmtFolder.getFiles();
        while (files.hasNext()) {
          const file = files.next();
          const fileName = file.getName();
          scannedTotal++;

          const key = fmt + "|" + fileName;
          if (existingFiles[key]) { skippedTotal++; continue; }
          existingFiles[key] = true;

          // Parse category/subcategory/collection from filename
          // Format: Category_Subcategory_Collection_W.mp4
          const parsed = parseFilenameToMeta_(fileName, fmt);

          const fileSizeMB = (file.getSize() / (1024 * 1024)).toFixed(1);

          newRows.push([
            fmt,                           // A: Format
            contentType,                   // B: Content Type (Montage/Clip/UGC)
            parsed.category,               // C: Category
            parsed.subcategory,            // D: Subcategory
            parsed.collection,             // E: Collection
            fileName,                      // F: Filename
            fileSizeMB,                    // G: File Size (MB)
            file.getUrl(),                 // H: Drive Link
            file.getId(),                  // I: Drive File ID
            "Uploaded",                    // J: Upload Status
            "",                            // K: Help Page URL (filled later)
            "",                            // L: Stockflow URL (filled later)
            batch.name                     // M: Notes (batch name)
          ]);
        }
      }
    }
  }

  // Write new rows to sheet
  if (newRows.length > 0) {
    const startRow = existingRowCount + 2; // after header + existing
    sheet.getRange(startRow, 1, newRows.length, newRows[0].length).setValues(newRows);
  }

  const msg = "Drive Sync Complete!\n\n" +
    "Batches scanned: " + selectedBatches.map(b => b.name).join(", ") + "\n" +
    "Files scanned: " + scannedTotal + "\n" +
    "New rows added: " + newRows.length + "\n" +
    "Skipped (already in sheet): " + skippedTotal;
  Logger.log(msg);
  ui.alert(msg);
}

/**
 * Parse a filename like "Food-Beverage_Food-Menu_Biriyani_W.mp4"
 * into { category, subcategory, collection }
 */
function parseFilenameToMeta_(filename, format) {
  // Remove extension and format suffix
  let name = filename.replace(/\.[^.]+$/, ""); // remove .mp4
  name = name.replace(new RegExp("_" + format + "$"), ""); // remove _W, _S, _V

  const parts = name.split("_");
  // Replace dashes back to spaces for display
  const clean = parts.map(p => p.replace(/-/g, " "));

  return {
    category: clean[0] || "",
    subcategory: clean[1] || "",
    collection: clean[2] || clean[0] || ""
  };
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
 * 1. Video title contains the collection name (fuzzy)
 * 2. Video description contains the Drive file ID
 * 3. Video description contains the help page URL
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
  const sheetsToUpdate = ["AppScript Upload", CONFIG.SHEET_NAME];
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
function fetchAllChannelVideos_() {
  const videos = [];
  try {
    const channelResponse = YouTube.Channels.list("contentDetails", { mine: true });
    if (!channelResponse.items || channelResponse.items.length === 0) return videos;
    const uploadsPlaylistId = channelResponse.items[0].contentDetails.relatedPlaylists.uploads;
    let nextPageToken = null;
    do {
      const response = YouTube.PlaylistItems.list("snippet", { playlistId: uploadsPlaylistId, maxResults: 50, pageToken: nextPageToken });
      if (response.items) {
        for (const item of response.items) {
          videos.push({ videoId: item.snippet.resourceId.videoId, title: item.snippet.title || "", description: item.snippet.description || "", publishedAt: item.snippet.publishedAt || "" });
        }
      }
      nextPageToken = response.nextPageToken || null;
    } while (nextPageToken);
  } catch (error) { Logger.log("YouTube fetch error: " + error.message); }
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
/**
 * Generate the "AppScript Upload" derived tab from Content Library.
 * Supports Append (add new collections only) or Total Refresh (wipe and rebuild).
 */
function generateAppScriptSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const lib = ss.getSheetByName(CONFIG.CONTENT_LIBRARY_SHEET);
  if (!lib) { ui.alert("Content Library tab not found!"); return; }

  // Step 1: Ask mode
  const modeResponse = ui.alert(
    "Generate AppScript Upload",
    "Choose mode:\n\nYES = Append (add new collections, keep existing)\nNO = Total Refresh (wipe and rebuild everything)",
    ui.ButtonSet.YES_NO_CANCEL
  );
  if (modeResponse === ui.Button.CANCEL) return;
  const isAppend = (modeResponse === ui.Button.YES);

  const tabName = "AppScript Upload";
  const headers = [
    "Publish", "Status", "Date", "Day", "Time", "Platform", "Phase",
    "Format", "Category", "Subcategory", "Collection", "Drive Link",
    "Drive File ID", "Help Page URL", "Stockflow URL", "Published URL",
    "Published At", "Notes"
  ];

  let target = ss.getSheetByName(tabName);
  const existingCollections = {};
  let existingRowCount = 0;

  if (isAppend && target) {
    // Build set of existing collections to skip
    const existingData = target.getDataRange().getValues();
    for (let i = 1; i < existingData.length; i++) {
      const coll = existingData[i][CONFIG.COL.COLLECTION] || "";
      if (coll) existingCollections[coll] = true;
      existingRowCount++;
    }
  } else {
    // Total Refresh
    if (target) target.clear();
    else target = ss.insertSheet(tabName);
    target.getRange(1, 1, 1, headers.length).setValues([headers]);
    target.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#4a86e8").setFontColor("#ffffff");
  }

  // Read Content Library (W format only)
  const libData = lib.getDataRange().getValues();
  const LC = CONFIG.LIB_COL;
  const collectionMap = {};
  for (let i = 1; i < libData.length; i++) {
    const r = libData[i];
    if ((r[LC.FORMAT] || "") !== "W") continue;
    // Only Montages go to AppScript Upload (Clips/UGC go to FeedHive only)
    const contentType = (r[LC.CONTENT_TYPE] || "").toLowerCase();
    if (contentType && contentType !== "montages" && contentType !== "montage") continue;
    const collection = r[LC.COLLECTION] || "";
    if (collectionMap[collection]) continue;
    if (isAppend && existingCollections[collection]) continue; // skip existing
    collectionMap[collection] = {
      category: r[LC.CATEGORY] || "",
      subcategory: r[LC.SUBCATEGORY] || "",
      collection: collection,
      driveLink: r[LC.DRIVE_LINK] || "",
      driveFileId: r[LC.DRIVE_FILE_ID] || "",
      helpUrl: r[LC.HELP_URL] || "",
      stockflowUrl: r[LC.STOCKFLOW_URL] || "https://stockflow.media"
    };
  }

  const newCollections = Object.values(collectionMap);
  const rows = [];
  const platformCounts = {};
  for (const c of newCollections) {
    for (const platform of APPSCRIPT_PLATFORMS) {
      rows.push([
        false, "", "", "", "", platform, "", "W",
        c.category, c.subcategory, c.collection,
        c.driveLink, c.driveFileId, c.helpUrl, c.stockflowUrl,
        "", "", ""
      ]);
      platformCounts[platform] = (platformCounts[platform] || 0) + 1;
    }
  }

  if (rows.length > 0) {
    const startRow = isAppend ? existingRowCount + 2 : 2;
    target.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
    target.getRange(startRow, 1, rows.length, 1).insertCheckboxes();
  }

  target.setFrozenRows(1);
  for (let c = 1; c <= Math.min(headers.length, 12); c++) target.autoResizeColumn(c);

  const mode = isAppend ? "Append" : "Total Refresh";
  const totalRows = isAppend ? existingRowCount + rows.length : rows.length;
  let summary = "AppScript Upload — " + mode + "\n\n";
  if (isAppend) summary += "Existing rows kept: " + existingRowCount + "\n";
  summary += "New collections added: " + newCollections.length + "\n";
  summary += "New rows added: " + rows.length + "\n";
  summary += "Total rows in sheet: " + totalRows + "\n\n";
  for (const p of APPSCRIPT_PLATFORMS) summary += p + ": " + (platformCounts[p] || 0) + " new\n";
  Logger.log(summary);
  ui.alert(summary);
}
// ============================================================
// APPSCRIPT UPLOAD PLATFORMS (FeedHive moved to feedhive_generator.gs)
// ============================================================
const APPSCRIPT_PLATFORMS = ["YouTube", "WordPress", "Reddit"];
function parseScheduledDateTime(dateVal, timeVal) {
  try {
    let d = new Date(dateVal);
    if (isNaN(d.getTime())) return null;
    if (timeVal) {
      if (timeVal instanceof Date) d.setHours(timeVal.getHours(), timeVal.getMinutes(), 0, 0);
      else {
        const timeParts = String(timeVal).match(/(\d{1,2}):(\d{2})/);
        if (timeParts) d.setHours(parseInt(timeParts[1]), parseInt(timeParts[2]), 0, 0);
      }
    }
    return d;
  } catch (e) { return null; }
}
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
 * Diagnostic tool: Check which Google Account and YouTube Channel the script is using
 */
function checkScriptIdentity() {
  try {
    const email = Session.getEffectiveUser().getEmail();
    let channelName = "No channel found";
    let channelId = "N/A";

    // Ping YouTube to see who we are logged in as
    const response = YouTube.Channels.list('snippet', {mine: true});
    if (response.items && response.items.length > 0) {
      channelName = response.items[0].snippet.title;
      channelId = response.items[0].id;
    }
    SpreadsheetApp.getUi().alert(
      "Script Identity Check\n\n" +
      "Google Account: " + (email || "Hidden for security") + "\n" +
      "Target YouTube Channel: " + channelName + "\n" +
      "Channel ID: " + channelId
    );
  } catch (error) {
    SpreadsheetApp.getUi().alert("Identity Check Failed: \n\n" + error.message);
  }
}
function uploadToWordPress(driveFileId, meta) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("AppScript Upload") || ss.getSheetByName(CONFIG.SHEET_NAME);

  var youtubeUrl = "";
  try {
    youtubeUrl = findYouTubeUrlForCollection_(sheet, meta.collection);
  } catch (e) { console.log("YouTube Search Error: " + e.message); }

  // CHECKPOINT: Don't publish WordPress until YouTube is uploaded for this collection
  if (!youtubeUrl) {
    return { success: false, error: "SKIP: Waiting for YouTube upload — " + meta.collection };
  }

  var blog = buildWordPressBlog(meta, youtubeUrl);
  var wpEmail = CONFIG.WP_POST_EMAIL;
  if (!wpEmail) return { success: false, error: "WP_POST_EMAIL missing in CONFIG" };
  // --- THE WORDPRESS URL PREDICTOR ---
  var date = new Date();
  var year = date.getFullYear();
  var month = ("0" + (date.getMonth() + 1)).slice(-2);
  var day = ("0" + date.getDate()).slice(-2);

  // Turns "Food Beverage - Stockflow Media" into "food-beverage-stockflow-media"
  var slug = blog.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  var predictedWpUrl = "https://stockflowmedia.wordpress.com/" + year + "/" + month + "/" + day + "/" + slug + "/";
  // ----------------------------------------
  var activeRow = sheet.getActiveCell().getRow();

  // Fill Column O (15) with the safe Stockflow URL
  sheet.getRange(activeRow, 15).setValue(blog.linkUrl);

  // Fill Column P (16) with the Predicted WordPress Blog URL
  sheet.getRange(activeRow, 16).setValue(predictedWpUrl);
  var finalHtml = blog.content +
                  "<br><br>" +
                  "<p>[category Stock Footage]</p>" +
                  "<p>[tags " + meta.collection.replace(/_/g, ", ") + "]</p>";
  try {
    MailApp.sendEmail({
      to: wpEmail,
      subject: blog.title,
      htmlBody: finalHtml
    });

    // Queue Reddit reminder if gap allows
    try { queueRedditReminder_(meta, youtubeUrl, predictedWpUrl); } catch (e) { Logger.log("Reddit reminder skipped: " + e.message); }

    // Returns the predicted URL to the status column so you can click it right away
    return { success: true, url: predictedWpUrl };
  } catch (e) {
    return { success: false, error: "Email Error: " + e.message };
  }
}

// ============================================================
// REDDIT REMINDER SYSTEM (email digest, not auto-post)
// ============================================================
const REDDIT_SUBREDDIT_MAP = {
  "microscopic": ["r/microscopy", "r/microbiology", "r/biology", "r/educationalgifs", "r/science"],
  "food": ["r/FoodPorn", "r/food", "r/foodphotography", "r/Cooking"],
  "pathology": ["r/Pathology", "r/medicine", "r/biology", "r/science"],
  "algae": ["r/biology", "r/microscopy", "r/botany"],
  "fungi": ["r/mycology", "r/biology", "r/microscopy"],
  "worm": ["r/biology", "r/Parasitology", "r/microscopy"],
  "parasite": ["r/Parasitology", "r/biology", "r/medicine"],
  "cancer": ["r/oncology", "r/medicine", "r/biology"],
  "bacteria": ["r/microbiology", "r/biology", "r/microscopy"],
  "default": ["r/biology", "r/science", "r/microscopy", "r/interestingasfuck"]
};

/**
 * Queue a Reddit reminder email if enough days have passed since the last one.
 * REDDIT_REMINDER_GAP_DAYS: Script Property (default 3)
 * REDDIT_LAST_REMINDER: Script Property (ISO date of last sent reminder)
 * REDDIT_REMINDER_EMAIL: Script Property (your email, defaults to session user)
 */
function queueRedditReminder_(meta, youtubeUrl, wpUrl) {
  const props = PropertiesService.getScriptProperties();
  const gapDays = parseInt(props.getProperty("REDDIT_REMINDER_GAP_DAYS") || "3");

  // 0 = disabled
  if (gapDays <= 0) return;

  // Check gap
  const lastRaw = props.getProperty("REDDIT_LAST_REMINDER");
  if (lastRaw) {
    const lastDate = new Date(lastRaw);
    const now = new Date();
    const diffDays = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < gapDays) return; // too soon
  }

  // Find target subreddits
  const catLower = (meta.category || "").toLowerCase();
  const subLower = (meta.subcategory || "").toLowerCase();
  let subreddits = REDDIT_SUBREDDIT_MAP["default"];
  for (const key of Object.keys(REDDIT_SUBREDDIT_MAP)) {
    if (key === "default") continue;
    if (catLower.includes(key) || subLower.includes(key)) {
      subreddits = REDDIT_SUBREDDIT_MAP[key];
      break;
    }
  }

  // Build the Reddit post content
  const collectionName = (meta.collection || "").replace(/_/g, " ");
  const redditTitle = collectionName + " — Premium Stock Footage & 8K Images | Royalty-Free";
  const redditBody =
    "Just published a new **" + collectionName + "** collection in our " + (meta.category || "") + " stock library.\n\n" +
    "This pack includes 4K video (MP4) and high-res 8K images (JPEG) in 16:9, 9:16, and 1:1 formats.\n\n" +
    (youtubeUrl ? "Preview video: " + youtubeUrl + "\n\n" : "") +
    "Browse & download: " + (meta.stockflowUrl || "https://stockflow.media") + "\n\n" +
    "All assets are royalty-free. No attribution required.";

  // Build submit links for each subreddit
  var submitLinks = "";
  for (const sub of subreddits) {
    const subName = sub.replace("r/", "");
    const submitUrl = "https://www.reddit.com/r/" + subName + "/submit?type=TEXT&title=" +
      encodeURIComponent(redditTitle) + "&text=" + encodeURIComponent(redditBody);
    submitLinks += "  " + sub + ": " + submitUrl + "\n\n";
  }

  // Send the email
  const recipientEmail = props.getProperty("REDDIT_REMINDER_EMAIL") || Session.getEffectiveUser().getEmail();

  const emailBody =
    "<h2>Reddit Post Ready: " + collectionName + "</h2>" +
    "<p><strong>Category:</strong> " + (meta.category || "") + " > " + (meta.subcategory || "") + "</p>" +
    (wpUrl ? "<p><strong>WordPress:</strong> <a href='" + wpUrl + "'>" + wpUrl + "</a></p>" : "") +
    (youtubeUrl ? "<p><strong>YouTube:</strong> <a href='" + youtubeUrl + "'>" + youtubeUrl + "</a></p>" : "") +
    "<hr>" +
    "<h3>Copy-Paste Title:</h3>" +
    "<pre>" + redditTitle + "</pre>" +
    "<h3>Copy-Paste Body:</h3>" +
    "<pre>" + redditBody + "</pre>" +
    "<hr>" +
    "<h3>Target Subreddits (click to open submit page):</h3>" +
    "<pre>" + submitLinks + "</pre>" +
    "<hr>" +
    "<p><em>Next reminder in " + gapDays + " days. Change REDDIT_REMINDER_GAP_DAYS in Script Properties to adjust.</em></p>";

  MailApp.sendEmail({
    to: recipientEmail,
    subject: "Reddit Post Ready: " + collectionName,
    htmlBody: emailBody
  });

  // Update last reminder timestamp
  props.setProperty("REDDIT_LAST_REMINDER", new Date().toISOString());
  Logger.log("Reddit reminder sent for: " + collectionName);
}

function buildWordPressBlog(meta, youtubeUrl) {
  // 1. Clean up the title
  var rawName = meta.collection.replace(/_Category/g, "").trim();
  var collectionTitle = rawName;

  // 2. THE BULLETPROOF URL BUILDER
  var encodedCat = "";
  if (rawName === "Food Beverage") {
    // Specifically fixes the missing "&" for this one category
    encodedCat = "Food+%26+Beverage";
  } else {
    // Safely formats everything else (like "Biriyani" or "City Skyline")
    encodedCat = rawName.split(" ").join("+").split("_").join("+");
  }

  var finalStockflowUrl = "https://stockflow.media/?cat=" + encodedCat;
  // 3. THE VIDEO FIX (WordPress Shortcode)
  var videoHtml = (youtubeUrl && youtubeUrl !== "")
    ? "<p>[youtube=" + youtubeUrl.trim() + "]</p>"
    : "";
  var htmlContent =
    "<h2>Preview: " + collectionTitle + " Stock Footage</h2>" +
    videoHtml +
    "<h3>About the Collection</h3>" +
    "<p>Elevate your creative projects with this professionally shot footage.</p>" +
    "<p><a href='" + finalStockflowUrl + "'><strong>Browse & Download the Full Collection</strong></a></p>";
  return {
    title: collectionTitle + " - Stockflow Media",
    content: htmlContent,
    linkUrl: finalStockflowUrl
  };
}
// ============================================================
// LINKEDIN UPLOAD
// ============================================================
function uploadToLinkedIn(driveFileId, meta) {
  // IMPORTANT: Add these to your script or Script Properties
  const linkedInToken = 'YOUR_LINKEDIN_DEVELOPER_TOKEN';
  const linkedInAuthorUrn = 'urn:li:organization:YOUR_COMPANY_ID'; // e.g., urn:li:organization:12345678

  try {
    const file = DriveApp.getFileById(driveFileId);
    const fileSize = file.getSize();
    const driveToken = ScriptApp.getOAuthToken();
    const driveDownloadUrl = "https://www.googleapis.com/drive/v3/files/" + file.getId() + "?alt=media";
    // --- STEP 1: Initialize Upload ---
    const initPayload = {
      "initializeUploadRequest": {
        "owner": linkedInAuthorUrn,
        "fileSizeBytes": fileSize,
        "uploadCaptions": false,
        "uploadThumbnail": false
      }
    };
    const initOptions = {
      "method": "post",
      "headers": {
        "Authorization": "Bearer " + linkedInToken,
        "LinkedIn-Version": "202401", // LinkedIn requires a version header
        "X-Restli-Protocol-Version": "2.0.0"
      },
      "contentType": "application/json",
      "payload": JSON.stringify(initPayload),
      "muteHttpExceptions": true
    };
    const initResponse = UrlFetchApp.fetch("https://api.linkedin.com/rest/videos?action=initializeUpload", initOptions);
    if (initResponse.getResponseCode() !== 200) {
      return { success: false, error: "Init Failed: " + initResponse.getContentText() };
    }
    const initData = JSON.parse(initResponse.getContentText());
    const instructions = initData.value.uploadInstructions;
    const videoUrn = initData.value.video;
    const uploadToken = initData.value.uploadToken;
    const uploadedPartIds = [];
    // --- STEP 2: Upload Chunks (Using your Drive Range logic) ---
    for (let i = 0; i < instructions.length; i++) {
      const instruction = instructions[i];
      const start = instruction.firstByte;
      const end = instruction.lastByte;
      // Pull chunk from Drive
      const driveResponse = UrlFetchApp.fetch(driveDownloadUrl, {
        "headers": {
          "Authorization": "Bearer " + driveToken,
          "Range": "bytes=" + start + "-" + end
        },
        "muteHttpExceptions": true
      });
      const chunkBlob = driveResponse.getBlob();
      // Push chunk to LinkedIn
      const uploadResponse = UrlFetchApp.fetch(instruction.uploadUrl, {
        "method": "put",
        "headers": {
          "Content-Type": "application/octet-stream",
          "Authorization": "Bearer " + linkedInToken,
          "LinkedIn-Version": "202401"
        },
        "payload": chunkBlob,
        "muteHttpExceptions": true
      });
      if (uploadResponse.getResponseCode() !== 200 && uploadResponse.getResponseCode() !== 201) {
         return { success: false, error: "Chunk " + i + " Failed: " + uploadResponse.getContentText() };
      }
      // LinkedIn requires the ETag header from each chunk to finalize the video
      let etag = uploadResponse.getHeaders()["ETag"] || uploadResponse.getHeaders()["etag"];
      uploadedPartIds.push(etag.replace(/"/g, ''));
    }
    // --- STEP 3: Finalize Video Processing ---
    const finalizePayload = {
      "finalizeUploadRequest": {
        "video": videoUrn,
        "uploadToken": uploadToken,
        "uploadedPartIds": uploadedPartIds
      }
    };
    const finalizeOptions = {
      "method": "post",
      "headers": {
        "Authorization": "Bearer " + linkedInToken,
        "LinkedIn-Version": "202401",
        "X-Restli-Protocol-Version": "2.0.0"
      },
      "contentType": "application/json",
      "payload": JSON.stringify(finalizePayload),
      "muteHttpExceptions": true
    };
    const finalizeResponse = UrlFetchApp.fetch("https://api.linkedin.com/rest/videos?action=finalizeUpload", finalizeOptions);
    if (finalizeResponse.getResponseCode() !== 200) {
       return { success: false, error: "Finalize Failed: " + finalizeResponse.getContentText() };
    }
    // --- STEP 4: Publish the Native LinkedIn Post ---
    const collectionTitle = meta.collection ? meta.collection.replace(/_/g, " ") : "Stock Footage";
    const postText = "Preview our new " + collectionTitle + " collection.\n\nBrowse & License the full collection here: " + (meta.stockflowUrl || "https://stockflow.media") + "\n#stockfootage #videoediting";
    const postPayload = {
      "author": linkedInAuthorUrn,
      "commentary": postText,
      "visibility": "PUBLIC",
      "distribution": {
        "feedDistribution": "MAIN_FEED",
        "targetEntities": [],
        "thirdPartyDistributionChannels": []
      },
      "content": {
        "media": {
          "id": videoUrn
        }
      },
      "lifecycleState": "PUBLISHED",
      "isReshareDisabledByAuthor": false
    };
    const postOptions = {
      "method": "post",
      "headers": {
        "Authorization": "Bearer " + linkedInToken,
        "LinkedIn-Version": "202401",
        "X-Restli-Protocol-Version": "2.0.0"
      },
      "contentType": "application/json",
      "payload": JSON.stringify(postPayload),
      "muteHttpExceptions": true
    };
    const postResponse = UrlFetchApp.fetch("https://api.linkedin.com/rest/posts", postOptions);
    if (postResponse.getResponseCode() !== 201) {
       return { success: false, error: "Post Failed: " + postResponse.getContentText() };
    }
    const postData = JSON.parse(postResponse.getContentText());

    // Return the URL for your spreadsheet's "Published URL" column
    return { success: true, url: "https://www.linkedin.com/feed/update/" + postData.id };
  } catch (e) {
    return { success: false, error: "LinkedIn Error: " + e.message };
  }
}
// ============================================================
// REDDIT UPLOAD (Text + YouTube Encapsulation)
// ============================================================
function publishToReddit(title, textTemplate, youtubeUrl, subreddit) {
  const clientId = PropertiesService.getScriptProperties().getProperty('REDDIT_CLIENT_ID');
  const clientSecret = PropertiesService.getScriptProperties().getProperty('REDDIT_CLIENT_SECRET');
  const username = PropertiesService.getScriptProperties().getProperty('REDDIT_USERNAME');
  const password = PropertiesService.getScriptProperties().getProperty('REDDIT_PASSWORD');
  try {
    // --- STEP 1: Get Access Token ---
    const authUrl = "https://www.reddit.com/api/v1/access_token";
    const authPayload = {
      "grant_type": "password",
      "username": username,
      "password": password
    };

    // Reddit requires Basic Auth to get the token
    const authHeaders = {
      "Authorization": "Basic " + Utilities.base64Encode(clientId + ":" + clientSecret)
    };

    const authOptions = {
      "method": "post",
      "payload": authPayload,
      "headers": authHeaders,
      "muteHttpExceptions": true
    };
    const authResponse = UrlFetchApp.fetch(authUrl, authOptions);
    const authData = JSON.parse(authResponse.getContentText());
    const token = authData.access_token;
    if (!token) {
      return { success: false, error: "Reddit Auth Failed: " + authResponse.getContentText() };
    }
    // --- STEP 2: Submit the Post ---
    const submitUrl = "https://oauth.reddit.com/api/submit";

    // Combine your short template with the YouTube URL
    const fullText = textTemplate + "\n\nWatch here: " + youtubeUrl;
    const submitPayload = {
      "api_type": "json",
      "kind": "self", // 'self' creates a text post (which encapsulates the video)
      "sr": subreddit,
      "title": title,
      "text": fullText
    };

    const submitOptions = {
      "method": "post",
      "headers": {
        "Authorization": "Bearer " + token,
        // Reddit strictly requires a custom User-Agent
        "User-Agent": "AppsScript:StockflowPublisher:v1.0 (by /u/" + username + ")"
      },
      "payload": submitPayload,
      "muteHttpExceptions": true
    };
    const submitResponse = UrlFetchApp.fetch(submitUrl, submitOptions);
    const submitData = JSON.parse(submitResponse.getContentText());
    // Check for specific Reddit posting errors (like subreddit rules or rate limits)
    if (submitData.json && submitData.json.errors && submitData.json.errors.length > 0) {
      return { success: false, error: "Reddit Post Failed: " + JSON.stringify(submitData.json.errors) };
    }
    // Return the URL of the live Reddit post
    return { success: true, url: submitData.json.data.url };
  } catch (e) {
    return { success: false, error: "Reddit Error: " + e.message };
  }
}
