@echo off
echo ================================================
echo   Sync YouTube URLs to Help Pages
echo ================================================
echo.
echo This will inject YouTube iframes into help pages
echo based on Published URLs in the AppScript Upload sheet.
echo.
python tools/sync_youtube_to_help.py %*
echo.
pause
