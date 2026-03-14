@echo off
setlocal enabledelayedexpansion
title Stockflow - Add Music to Montages
color 0B

echo.
echo ============================================
echo   STOCKFLOW - ADD MUSIC TO MONTAGES
echo ============================================
echo.
echo   Reads from: Marketing content\W output\02_Watermarked\
echo   Outputs to: Marketing content\W output\03_With-music\
echo.

cd /d "%~dp0"

:: Use absolute paths to avoid issues with spaces
set "PROJECT_DIR=%~dp0"
set "MUSIC_DIR=%PROJECT_DIR%Marketing content\music"
set "SRC_DIR=%PROJECT_DIR%Marketing content\W output\02_Watermarked"
set "DEST_DIR=%PROJECT_DIR%Marketing content\W output\03_With-music"

if not exist "%MUSIC_DIR%" mkdir "%MUSIC_DIR%"

:: Check for cached music
set "CACHED="
for %%f in ("%MUSIC_DIR%\*.mp3" "%MUSIC_DIR%\*.wav" "%MUSIC_DIR%\*.m4a") do (
    if exist "%%f" (
        set "CACHED=%%~ff"
        echo   Found cached music: %%~nxf
    )
)

:: Prompt user
echo.
if defined CACHED (
    echo   Press ENTER to reuse cached music, or provide a new path/URL:
) else (
    echo   Drag and drop an MP3 file here, or paste a YouTube Audio Library URL:
)
echo.
set /p "MUSIC_INPUT=  Music source: "

:: Use cached if empty input
if "!MUSIC_INPUT!"=="" (
    if defined CACHED (
        set "MUSIC_INPUT=!CACHED!"
        echo   Using cached music
    ) else (
        echo   No music file provided. Exiting.
        pause
        exit /b 1
    )
)

:: Remove surrounding quotes if dragged
set "MUSIC_INPUT=!MUSIC_INPUT:"=!"

:: Check if it's a URL (download with yt-dlp)
echo "!MUSIC_INPUT!" | findstr /i "youtube.com youtu.be" >nul
if not errorlevel 1 (
    echo.
    echo   Downloading audio from YouTube...
    yt-dlp -x --audio-format mp3 -o "%MUSIC_DIR%\yt_audio.%%(ext)s" "!MUSIC_INPUT!"
    set "MUSIC_INPUT=%MUSIC_DIR%\yt_audio.mp3"
    echo   Downloaded to: %MUSIC_DIR%\yt_audio.mp3
) else (
    :: Copy to music dir for caching
    if not "!MUSIC_INPUT!"=="!CACHED!" (
        copy "!MUSIC_INPUT!" "%MUSIC_DIR%\" >nul 2>&1
        echo   Cached music to %MUSIC_DIR%\
    )
)

:: Check if Watermarked folder has any MP4s
if not exist "%SRC_DIR%" (
    echo.
    echo   Folder not found: %SRC_DIR%
    echo   Run Watermark_Mp4_DeepFolders.bat first!
    pause
    exit /b 1
)

set "HAS_FILES="
for /r "%SRC_DIR%" %%f in (*.mp4) do set "HAS_FILES=1"

if not defined HAS_FILES (
    echo.
    echo   No watermarked videos found in 02_Watermarked\
    echo   Run Watermark_Mp4_DeepFolders.bat first!
    pause
    exit /b 1
)

echo.
echo   Adding music to watermarked montages...
echo   Music: !MUSIC_INPUT!
echo.

set "COUNT=0"
set "SKIPPED=0"
set "FAILED=0"

for /r "%SRC_DIR%" %%v in (*.mp4) do (

    :: Get relative path by removing SRC_DIR prefix
    set "FULL_PATH=%%v"
    set "REL=%%v"
    call set "REL=%%REL:!SRC_DIR!\=%%"

    :: Build output path
    set "OUT_FILE=!DEST_DIR!\!REL!"

    :: Skip if already exists
    if exist "!OUT_FILE!" (
        echo   Skipping: !REL!
        set /a SKIPPED+=1
    ) else (
        :: Create matching subfolder
        for %%r in ("!OUT_FILE!") do (
            if not exist "%%~dpr" mkdir "%%~dpr"
        )

        echo   Processing: !REL!

        ffmpeg -y -i "%%v" -i "!MUSIC_INPUT!" -filter_complex "[1:a]volume=-18dB,afade=t=in:st=0:d=2,afade=t=out:d=3[music]" -map 0:v -map "[music]" -c:v copy -c:a aac -b:a 192k -shortest "!OUT_FILE!"

        if errorlevel 1 (
            echo   FAILED: !REL!
            set /a FAILED+=1
        ) else (
            echo   Done: !REL!
            set /a COUNT+=1
        )
    )
)

echo.
echo ==========================================
echo   MUSIC ADDED TO !COUNT! MONTAGES!
echo   Skipped: !SKIPPED! (already exist)
if !FAILED! GTR 0 echo   Failed: !FAILED!
echo   Output: !DEST_DIR!
echo ==========================================
echo.
endlocal
pause
