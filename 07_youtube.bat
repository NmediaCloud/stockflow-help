@echo off
title Stockflow - YouTube Upload
color 0E

echo.
echo ============================================
echo   STOCKFLOW - YOUTUBE UPLOAD (W 16:9)
echo ============================================
echo.
echo   Uploads collections + subcategories
echo   Category montages excluded by default
echo   Skips already uploaded files
echo.
echo   Options:
echo     --dry-run            Preview what will upload
echo     --force              Re-upload everything
echo     --limit N            Upload only N videos
echo     --include-categories Also upload category montages
echo     --publish            Make unlisted videos public
echo.

python tools/upload_to_youtube.py %*

echo.
pause
