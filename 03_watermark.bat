@echo off
setlocal enabledelayedexpansion
title Stockflow - Add Watermark to Montages
color 0D

cd /d "%~dp0"

set "PROJECT_DIR=%~dp0"
set "WM_VERTICAL=%PROJECT_DIR%Marketing content\watermark\V.webp"
set "WM_HORIZONTAL=%PROJECT_DIR%Marketing content\watermark\W.webp"
set "WM_SQUARE=%PROJECT_DIR%Marketing content\watermark\S.webp"

echo.
echo ============================================
echo   STOCKFLOW - ADD WATERMARK TO MONTAGES
echo ============================================
echo.
echo   Scans all format folders (W, S, V)
echo   Skips files that already exist
echo.

set "TOTAL_COUNT=0"
set "TOTAL_SKIPPED=0"

for %%F in (W S V) do (
    call :process_format "%%F"
)

echo.
echo ============================================
echo   WATERMARKING COMPLETE
echo   Processed: !TOTAL_COUNT!  Skipped: !TOTAL_SKIPPED!
echo ============================================
echo.
endlocal
pause
exit /b 0

:process_format
set "FMT=%~1"
set "SRC_DIR=%PROJECT_DIR%Marketing content\%FMT% output\01_Rendered"
set "DEST_DIR=%PROJECT_DIR%Marketing content\%FMT% output\02_Watermarked"

if not exist "%SRC_DIR%" exit /b 0

echo ------------------------------------------
echo   Processing: %FMT% output
echo ------------------------------------------

if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"

for /r "%SRC_DIR%" %%G in (*.mp4) do (
    call :process_file "%%G"
)
exit /b 0

:process_file
set "CLIP=%~1"
set "REL=%CLIP%"
call set "REL=%%REL:!SRC_DIR!\=%%"
set "OUTPUT=!DEST_DIR!\!REL!"

for %%R in ("!OUTPUT!") do (
    if not exist "%%~dpR" mkdir "%%~dpR"
)

if exist "!OUTPUT!" (
    echo   Skipping: !REL!
    set /a TOTAL_SKIPPED+=1
    exit /b 0
)

echo   Processing: !REL!

set "V_WIDTH="
set "V_HEIGHT="
for /f "usebackq delims=" %%A in (`ffprobe -v error -select_streams v:0 -show_entries stream^=width -of csv^=p^=0 "!CLIP!"`) do set "V_WIDTH=%%A"
for /f "usebackq delims=" %%B in (`ffprobe -v error -select_streams v:0 -show_entries stream^=height -of csv^=p^=0 "!CLIP!"`) do set "V_HEIGHT=%%B"

if not defined V_WIDTH exit /b 0
if not defined V_HEIGHT exit /b 0

if !V_WIDTH! GTR !V_HEIGHT! (
    set "WATERMARK=!WM_HORIZONTAL!"
) else if !V_WIDTH! LSS !V_HEIGHT! (
    set "WATERMARK=!WM_VERTICAL!"
) else (
    set "WATERMARK=!WM_SQUARE!"
)

ffmpeg -y -i "!CLIP!" -i "!WATERMARK!" ^
-filter_complex "[1:v]scale=!V_WIDTH!:!V_HEIGHT![wm];[0:v][wm]overlay=0:0" ^
-c:v h264_nvenc -preset p5 -tune hq -profile:v high ^
-rc vbr -cq 19 -bf 2 -pix_fmt yuv420p -c:a copy ^
"!OUTPUT!"

if not errorlevel 1 (
    echo   Done: !REL!
    set /a TOTAL_COUNT+=1
) else (
    echo   FAILED: !REL!
)
exit /b 0
