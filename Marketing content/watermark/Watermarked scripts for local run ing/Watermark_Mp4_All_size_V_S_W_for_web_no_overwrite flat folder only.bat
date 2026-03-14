@echo off
setlocal EnableDelayedExpansion

REM ==========================================
REM 🔧 CHANGE THESE THREE PATHS ONLY
REM ==========================================
set "WM_VERTICAL=D:\Projects\2025\00 Stock Footages\Stockflow-help\montage\watermark\V.webp"
set "WM_HORIZONTAL=D:\Projects\2025\00 Stock Footages\Stockflow-help\montage\watermark\W.webp"
set "WM_SQUARE=D:\Projects\2025\00 Stock Footages\Stockflow-help\montage\watermark\S.webp"

REM ==========================================
REM Create Output Folder
REM ==========================================
if not exist "Watermarked" mkdir "Watermarked"

echo.
echo ==========================================
echo RTX 3050 NVENC Safe Multi-Thread Mode
echo ==========================================
echo.

for %%F in (*.mp4) do (

    set "OUTPUT=Watermarked\%%~nF_watermarked.mp4"

    REM Skip if already exists
    if exist "!OUTPUT!" (
        echo ⏭ Skipping (already exists): %%F
    ) else (

        echo ------------------------------------------
        echo Processing: %%F

        set "V_WIDTH="
        set "V_HEIGHT="

        for /f "usebackq delims=" %%A in (`ffprobe -v error -select_streams v:0 -show_entries stream^=width -of csv^=p^=0 "%%F"`) do set "V_WIDTH=%%A"
        for /f "usebackq delims=" %%B in (`ffprobe -v error -select_streams v:0 -show_entries stream^=height -of csv^=p^=0 "%%F"`) do set "V_HEIGHT=%%B"

        if defined V_WIDTH if defined V_HEIGHT (

            echo Video Resolution: !V_WIDTH!x!V_HEIGHT!

            if !V_WIDTH! GTR !V_HEIGHT! (
                set "WATERMARK=!WM_HORIZONTAL!"
                echo Format: Horizontal
            ) else if !V_WIDTH! LSS !V_HEIGHT! (
                set "WATERMARK=!WM_VERTICAL!"
                echo Format: Vertical
            ) else (
                set "WATERMARK=!WM_SQUARE!"
                echo Format: Square
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

        ) else (
            echo ❌ Failed reading resolution — skipping.
        )
    )
)

echo.
echo ==========================================
echo ✅ Multi-thread Safe Processing Complete!
echo ==========================================
pause
