@echo off
echo ================================================
echo   Compress Montages for Social Media
echo ================================================
echo.
echo   Output: "04 Compressed for Social media" inside each format folder
echo   Settings: 1080p, CRF 28, optimized bitrate
echo.
python tools\compress_for_social.py --skip-existing %*
echo.
pause
