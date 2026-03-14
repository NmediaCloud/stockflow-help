<# :
@cls
@echo off
:: Set the working directory to the folder where this .bat file lives
cd /d "%~dp0"

:: Run the PowerShell script and bypass execution policies
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ((Get-Content '%~f0' -Raw))"

:: Pause so you can read the output before the window closes
pause
exit /b
#>

# --- POWERSHELL SCRIPT STARTS HERE ---
# DEEP FOLDER VERSION - Scans all subfolders recursively
# Mirrors folder structure in Watermarked_Images\

Add-Type -AssemblyName System.Drawing

# ==========================================
#  CHANGE THESE SETTINGS IF NEEDED
# ==========================================
$wmVertical = "D:\Projects\2025\00 Stock Footages\Stockflow-help\Marketing content\watermark\V.webp"
$wmHorizontal = "D:\Projects\2025\00 Stock Footages\Stockflow-help\Marketing content\watermark\W.webp"
$wmSquare = "D:\Projects\2025\00 Stock Footages\Stockflow-help\Marketing content\watermark\S.webp"
$maxDimension = 1920 # Max width (or height for vertical images)

# Source folder to scan
$srcBase = "D:\Projects\2025\00 Stock Footages\Stockflow-help\Marketing content\W output\01_Rendered"
$outBase = "D:\Projects\2025\00 Stock Footages\Stockflow-help\Marketing content\W output\02_Watermarked"

if (!(Test-Path $outBase)) { New-Item -ItemType Directory -Path $outBase | Out-Null }

# Recursively find all images, excluding Watermarked folders
$images = Get-ChildItem -Path $srcBase -Recurse -File | Where-Object {
    $_.Extension -match '\.(jpg|jpeg|png|webp)$' -and
    $_.FullName -notmatch '\\02_Watermarked|\\03_With-music'
}

if ($images.Count -eq 0) {
    Write-Host "No images found in $srcBase (recursive)." -ForegroundColor Yellow
    exit
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host " Auto-Resizing Image Watermark - Deep Folder Mode"
Write-Host " Source: $srcBase"
Write-Host " Output: $outBase"
Write-Host "==========================================`n" -ForegroundColor Cyan

$count = 0
$skipped = 0

foreach ($file in $images) {
    # Get relative path from srcBase
    $relPath = $file.FullName.Substring($srcBase.Length + 1)
    $outPath = Join-Path -Path $outBase -ChildPath $relPath

    # Create subfolder if needed
    $outDir = Split-Path -Path $outPath -Parent
    if (!(Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

    if (Test-Path $outPath) {
        Write-Host "  Skipping (exists): $relPath" -ForegroundColor DarkGray
        $skipped++
        continue
    }

    try {
        # 1. Read image dimensions
        $img = [System.Drawing.Image]::FromFile($file.FullName)
        $width = $img.Width
        $height = $img.Height
        $img.Dispose()

        if ($width -gt $height) {
            $watermark = $wmHorizontal
            $format = "Horizontal"
        } elseif ($width -lt $height) {
            $watermark = $wmVertical
            $format = "Vertical"
        } else {
            $watermark = $wmSquare
            $format = "Square"
        }

        # 2. Calculate New Dimensions (Scale down if larger than $maxDimension)
        $targetWidth = $width
        $targetHeight = $height

        if ($width -ge $height -and $width -gt $maxDimension) {
            $targetWidth = $maxDimension
            $targetHeight = [math]::Round($height * ($maxDimension / [double]$width))
        } elseif ($height -gt $width -and $height -gt $maxDimension) {
            $targetHeight = $maxDimension
            $targetWidth = [math]::Round($width * ($maxDimension / [double]$height))
        }

        $resizeTag = ""
        if ($targetWidth -ne $width) {
            $resizeTag = "(Resized to ${targetWidth}x${targetHeight})"
        }

        Write-Host "Processing: $relPath $resizeTag -> $format" -ForegroundColor White

        # 3. FFmpeg watermark overlay
        $ffmpegArgs = @(
            "-y", "-v", "error",
            "-i", "`"$($file.FullName)`"",
            "-i", "`"$watermark`"",
            "-filter_complex", "`"[0:v]scale=${targetWidth}:${targetHeight}[bg];[1:v]scale=${targetWidth}:${targetHeight}[wm];[bg][wm]overlay=0:0`"",
            "-q:v", "2",
            "`"$outPath`""
        )

        $cmdString = $ffmpegArgs -join " "
        $process = Start-Process -FilePath "ffmpeg" -ArgumentList $cmdString -Wait -NoNewWindow -PassThru

        if ($process.ExitCode -eq 0) {
            Write-Host "  [OK] Saved: $relPath" -ForegroundColor Green
            $count++
        } else {
            Write-Host "  [X] FFmpeg error: $relPath" -ForegroundColor Red
        }

    } catch {
        Write-Host "  [X] Failed: $relPath" -ForegroundColor Red
    }
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host " Watermarking Complete!"
Write-Host " Processed: $count files"
Write-Host " Skipped: $skipped files (already exist)"
Write-Host " Output: $outBase"
Write-Host "==========================================" -ForegroundColor Cyan
