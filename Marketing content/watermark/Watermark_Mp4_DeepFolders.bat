@echo off
setlocal EnableDelayedExpansion

REM ==========================================
REM  DEEP FOLDER VERSION - Scans all subfolders
REM  Mirrors folder structure in Watermarked\
REM  Original files are NOT modified
REM ==========================================

REM ==========================================
REM  CHANGE THESE THREE PATHS ONLY
REM ==========================================
set "WM_VERTICAL=D:\Projects\2025\00 Stock Footages\Stockflow-help\Marketing content\watermark\V.webp"
set "WM_HORIZONTAL=D:\Projects\2025\00 Stock Footages\Stockflow-help\Marketing content\watermark\W.webp"
set "WM_SQUARE=D:\Projects\2025\00 Stock Footages\Stockflow-help\Marketing content\watermark\S.webp"

REM Source folder to scan
set "SRC_BASE=D:\Projects\2025\00 Stock Footages\Stockflow-help\Marketing content\W output\01_Rendered"
set "OUT_BASE=D:\Projects\2025\00 Stock Footages\Stockflow-help\Marketing content\W output\02_Watermarked"

if not exist "%OUT_BASE%" mkdir "%OUT_BASE%"

echo.
echo ==========================================
echo  RTX 3050 NVENC - Deep Folder Mode
echo  Source: %SRC_BASE%
echo  Output: %OUT_BASE%
echo ==========================================
echo.

set "COUNT=0"
set "SKIPPED=0"

for /r "%SRC_BASE%" %%F in (*.mp4) do (

    set "FPATH=%%F"

    REM Skip files already inside Watermarked folder
    echo "!FPATH!" | findstr /i "\\02_Watermarked\\ \\03_With-music\\" >nul
    if errorlevel 1 (

        REM Get relative path from SRC_BASE
        set "REL=!FPATH:%SRC_BASE%\=!"

        REM Build output path (mirror folder structure)
        set "OUTPUT=%OUT_BASE%\!REL!"

        REM Create subfolder if needed
        for %%R in ("!OUTPUT!") do (
            if not exist "%%~dpR" mkdir "%%~dpR"
        )

        REM Skip if already watermarked
        if exist "!OUTPUT!" (
            echo  Skipping (exists^): !REL!
            set /a SKIPPED+=1
        ) else (

            echo ------------------------------------------
            echo  Processing: !REL!

            set "V_WIDTH="
            set "V_HEIGHT="

            for /f "usebackq delims=" %%A in (`ffprobe -v error -select_streams v:0 -show_entries stream^=width -of csv^=p^=0 "%%F"`) do set "V_WIDTH=%%A"
            for /f "usebackq delims=" %%B in (`ffprobe -v error -select_streams v:0 -show_entries stream^=height -of csv^=p^=0 "%%F"`) do set "V_HEIGHT=%%B"

            if defined V_WIDTH if defined V_HEIGHT (

                echo  Video Resolution: !V_WIDTH!x!V_HEIGHT!

                if !V_WIDTH! GTR !V_HEIGHT! (
                    set "WATERMARK=!WM_HORIZONTAL!"
                    echo  Format: Horizontal
                ) else if !V_WIDTH! LSS !V_HEIGHT! (
                    set "WATERMARK=!WM_VERTICAL!"
                    echo  Format: Vertical
                ) else (
                    set "WATERMARK=!WM_SQUARE!"
                    echo  Format: Square
                )

                ffmpeg -y -i "%%F" -i "!WATERMARK!" ^
                -filter_complex "[1:v]scale=!V_WIDTH!:!V_HEIGHT![wm];[0:v][wm]overlay=0:0" ^
                -c:v h264_nvenc ^
                -preset p5 ^
                -tune hq ^
                -profile:v high ^
                -rc vbr ^
                -cq 19 ^
                -bf 2 ^
                -pix_fmt yuv420p ^
                -c:a copy ^
                "!OUTPUT!"

                if not errorlevel 1 (
                    echo  Done: !REL!
                    set /a COUNT+=1
                ) else (
                    echo  FAILED: !REL!
                )

            ) else (
                echo  Failed reading resolution - skipping.
            )
        )
    )
)

echo.
echo ==========================================
echo  Watermarking Complete!
echo  Processed: !COUNT! files
echo  Skipped: !SKIPPED! files (already exist^)
echo  Output: %OUT_BASE%
echo ==========================================
pause
