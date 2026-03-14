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

Add-Type -AssemblyName System.Drawing

# ==========================================
# 🔧 CHANGE THESE SETTINGS IF NEEDED
# ==========================================
$wmVertical = "D:\Projects\2025\00 Stock Footages\Stockflow-help\montage\watermark\V.webp"
$wmHorizontal = "D:\Projects\2025\00 Stock Footages\Stockflow-help\montage\watermark\W.webp"
$wmSquare = "D:\Projects\2025\00 Stock Footages\Stockflow-help\montage\watermark\S.webp"
$maxDimension = 1920 # Max width (or height for vertical images)

$outputFolder = Join-Path -Path (Get-Location).Path -ChildPath "Watermarked_Images"
if (!(Test-Path $outputFolder)) { New-Item -ItemType Directory -Path $outputFolder | Out-Null }

$images = Get-ChildItem -Path . -File | Where-Object { $_.Extension -match '\.(jpg|jpeg|png)$' }

if ($images.Count -eq 0) {
    Write-Host "No JPG or PNG images found in this folder." -ForegroundColor Yellow
    exit
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host " Auto-Resizing Image Watermark Mode"
Write-Host "==========================================`n" -ForegroundColor Cyan

foreach ($file in $images) {
    $outName = "$($file.BaseName)_watermarked$($file.Extension)"
    $outPath = Join-Path -Path $outputFolder -ChildPath $outName

    if (Test-Path $outPath) {
        Write-Host "⏭ Skipping (already exists): $($file.Name)" -ForegroundColor DarkGray
        continue
    }

    try {
        # 1. Native Windows Image Reading (Fast & Reliable)
        $img = [System.Drawing.Image]::FromFile($file.FullName)
        $width = $img.Width
        $height = $img.Height
        $img.Dispose() # Release the file lock immediately

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

        Write-Host "Processing: $($file.Name) $resizeTag -> $format" -ForegroundColor White

        # 3. Construct FFmpeg Command
        # [0:v] is the main image, [1:v] is the watermark. Both scale to the target size.
        $ffmpegArgs = @(
            "-y", "-v", "error",
            "-i", "`"$($file.FullName)`"",
            "-i", "`"$watermark`"",
            "-filter_complex", "`"[0:v]scale=${targetWidth}:${targetHeight}[bg];[1:v]scale=${targetWidth}:${targetHeight}[wm];[bg][wm]overlay=0:0`"",
            "-q:v", "2",
            "`"$outPath`""
        )
        
        # Flatten array into string for execution
        $cmdString = $ffmpegArgs -join " "
        
        $process = Start-Process -FilePath "ffmpeg" -ArgumentList $cmdString -Wait -NoNewWindow -PassThru

        if ($process.ExitCode -eq 0) {
            Write-Host "  [OK] Saved successfully." -ForegroundColor Green
        } else {
            Write-Host "  [X] FFmpeg encountered an error." -ForegroundColor Red
        }

    } catch {
        Write-Host "  [X] Failed to process $($file.Name)." -ForegroundColor Red
    }
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host " ✅ Image Watermarking Complete!"
Write-Host "==========================================" -ForegroundColor Cyan