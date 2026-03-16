@echo off
setlocal enabledelayedexpansion
title Stockflow - Add Music to Montages
color 0B

cd /d "%~dp0"

set "PROJECT_DIR=%~dp0"
set "MUSIC_DIR=%PROJECT_DIR%Marketing content\music"

echo.
echo ============================================
echo   STOCKFLOW - ADD MUSIC TO MONTAGES
echo ============================================
echo.
echo   Scans all format folders (W, S, V)
echo   Skips files that already exist
echo.

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

echo.

set "TOTAL_COUNT=0"
set "TOTAL_SKIPPED=0"
set "TOTAL_FAILED=0"

for %%F in (W S V) do (
    call :process_format "%%F"
)

echo.
echo ============================================
echo   MUSIC ADDITION COMPLETE
echo   Processed: !TOTAL_COUNT!  Skipped: !TOTAL_SKIPPED!
if !TOTAL_FAILED! GTR 0 echo   Failed: !TOTAL_FAILED!
echo ============================================
echo.
endlocal
pause
exit /b 0

:process_format
set "FMT=%~1"
set "SRC_DIR=%PROJECT_DIR%Marketing content\%FMT% output\02_Watermarked"
set "DEST_DIR=%PROJECT_DIR%Marketing content\%FMT% output\03_With-music"

if not exist "%SRC_DIR%" exit /b 0

set "HAS_FILES="
for /r "%SRC_DIR%" %%f in (*.mp4) do set "HAS_FILES=1"
if not defined HAS_FILES exit /b 0

echo ------------------------------------------
echo   Processing: %FMT% output
echo ------------------------------------------

if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"

for /r "%SRC_DIR%" %%v in (*.mp4) do (
    call :process_file "%%v"
)
exit /b 0

:process_file
set "CLIP=%~1"
set "REL=%CLIP%"
call set "REL=%%REL:!SRC_DIR!\=%%"
set "OUT_FILE=!DEST_DIR!\!REL!"

if exist "!OUT_FILE!" (
    echo   Skipping: !REL!
    set /a TOTAL_SKIPPED+=1
    exit /b 0
)

for %%r in ("!OUT_FILE!") do (
    if not exist "%%~dpr" mkdir "%%~dpr"
)

echo   Processing: !REL!

ffmpeg -y -i "!CLIP!" -i "!MUSIC_INPUT!" -filter_complex "[1:a]volume=-18dB,afade=t=in:st=0:d=2,afade=t=out:d=3[music]" -map 0:v -map "[music]" -c:v copy -c:a aac -b:a 192k -shortest "!OUT_FILE!"

if errorlevel 1 (
    echo   FAILED: !REL!
    set /a TOTAL_FAILED+=1
) else (
    echo   Done: !REL!
    set /a TOTAL_COUNT+=1
)
exit /b 0
