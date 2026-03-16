/**
 * Stockflow Drive Sync — Apps Script
 * Scans W/S/V output folders on Drive and updates Content Library
 *
 * SETUP:
 * 1. Open Master Sheet → Extensions → Apps Script
 * 2. Paste this entire script
 * 3. Click Run → syncDriveToSheet
 * 4. Authorize when prompted
 * 5. Takes ~1-2 min for 739 files
 */

// Root folder: Stockflow_Media_publish
const ROOT_FOLDER_ID = "1I2BpqMn5bAwOQwEJpzglZglDqujRI6D9";
const FORMAT_FOLDERS = ["W output", "S output", "V output"];
const FORMAT_MAP = {"W output": "W", "S output": "S", "V output": "V"};

function syncDriveToSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Content Library");

  if (!sheet) {
    SpreadsheetApp.getUi().alert("Content Library tab not found!");
    return;
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  // Find column indices
  const colFormat = headers.indexOf("Format");           // A
  const colFilename = headers.indexOf("Filename");       // E
  const colDriveLink = headers.indexOf("Drive Link");    // G
  const colDriveFileId = headers.indexOf("Drive File ID"); // H
  const colUploadStatus = headers.indexOf("Upload Status"); // I

  if (colFormat === -1 || colFilename === -1) {
    SpreadsheetApp.getUi().alert("Required columns not found! Need: Format, Filename");
    return;
  }

  Logger.log("Scanning Drive folders...");

  // Scan all format folders
  const driveIndex = {}; // key: "W|filename.mp4" → {link, fileId}
  const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);

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

  // Match and update rows
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

      // Only update if not already filled
      if (currentStatus !== "Uploaded" || !data[i][colDriveLink]) {
        const row = i + 1; // 1-indexed
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
  // Scan files in this folder
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

  // Recurse into subfolders
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    scanFolderRecursive(subfolders.next(), fmt, index);
  }
}

/**
 * Add a custom menu to run sync easily
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Stockflow")
    .addItem("Sync Drive → Sheet", "syncDriveToSheet")
    .addToUi();
}
