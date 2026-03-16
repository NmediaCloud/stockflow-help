@echo off
title Stockflow - Publish YouTube Videos
color 0A

echo.
echo ============================================
echo   STOCKFLOW - PUBLISH YOUTUBE VIDEOS
echo ============================================
echo.
echo   Makes unlisted YouTube videos public
echo.
echo   Options:
echo     --publish-limit N    Only publish N videos
echo.

python tools/upload_to_youtube.py --publish %*

echo.
pause
