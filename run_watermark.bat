@echo off
setlocal enabledelayedexpansion
title Stockflow - Add Watermark to Montages
color 0D

echo.
echo ============================================
echo   STOCKFLOW - ADD WATERMARK TO MONTAGES
echo ============================================
echo.

cd /d "%~dp0"

:: Check for cached watermark
set "WM_DIR=montage\watermark"
if not exist "%WM_DIR%" mkdir "%WM_DIR%"
set "WM_CACHED="
for %%f in (%WM_DIR%\*.png) do (
    if exist "%%f" (
        set "WM_CACHED=%%f"
        echo   Found cached watermark: %%f
    )
)

:: Prompt user
echo.
if defined WM_CACHED (
    echo   Press ENTER to reuse cached watermark, or drag a new PNG:
) else (
    echo   Drag and drop your watermark PNG here:
)
echo.
set /p "WM_INPUT=  Watermark PNG: "

:: Use cached if empty
if "!WM_INPUT!"=="" (
    if defined WM_CACHED (
        set "WM_INPUT=!WM_CACHED!"
        echo   Using cached: !WM_CACHED!
    ) else (
        echo   No watermark file provided. Exiting.
        pause
        exit /b 1
    )
)

:: Remove surrounding quotes
set "WM_INPUT=!WM_INPUT:"=!"

:: Cache the watermark
if not "!WM_INPUT!"=="!WM_CACHED!" (
    copy "!WM_INPUT!" "%WM_DIR%\logo.png" >nul 2>&1
    set "WM_INPUT=%WM_DIR%\logo.png"
    echo   Cached watermark to %WM_DIR%\logo.png
)

:: Determine source: prefer with-music versions, fallback to raw output
set "SRC_BASE="
for /r "montage\output\with-music" %%f in (*.mp4) do set "SRC_BASE=montage\output\with-music"

if not defined SRC_BASE (
    set "SRC_BASE=montage\output"
    echo   No music versions found, using raw montages from montage\output\
) else (
    echo   Using music versions from montage\output\with-music\
)

:: Process all videos recursively, mirror folder structure into ready\
set "BASE=%CD%\!SRC_BASE!\"
set "DEST=montage\output\ready"

echo.
echo   Applying watermark to all montages...
echo.

set "COUNT=0"
for /r "!SRC_BASE!" %%v in (*.mp4) do (
    set "FPATH=%%v"
    :: Skip files in with-music or ready if we're scanning raw output
    set "SKIP="
    if "!SRC_BASE!"=="montage\output" (
        echo "!FPATH!" | findstr /i "\\with-music\\ \\ready\\" >nul
        if not errorlevel 1 set "SKIP=1"
    )

    if not defined SKIP (
        set "REL=!FPATH:*!SRC_BASE!\=!"

        :: Create matching subfolder
        for %%r in ("%DEST%\!REL!") do (
            if not exist "%%~dpr" mkdir "%%~dpr"
        )

        echo   Processing: !REL!

        ffmpeg -y -i "%%v" -i "!WM_INPUT!" -filter_complex "[1:v]format=yuva420p,colorchannelmixer=aa=0.7[wm];[0:v][wm]overlay=W-w-20:H-h-20[vout]" -map "[vout]" -map 0:a? -c:v libx264 -crf 18 -preset fast -c:a copy "%DEST%\!REL!" 2>nul

        echo   Done: !REL!
        set /a COUNT+=1
        set "SKIP="
    )
    set "SKIP="
)

echo.
echo ============================================
echo   WATERMARK APPLIED TO !COUNT! MONTAGES!
echo   Output: %DEST%\
echo   These are upload-ready!
echo ============================================
echo.
endlocal
pause
