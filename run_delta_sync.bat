@echo off
title Stockflow Help - Delta Sync
cd /d "%~dp0"
echo.
echo ============================================
echo   STOCKFLOW HELP - DELTA SYNC (new items only)
echo ============================================
echo.
echo Starting delta sync...
echo.
python tools\sync_stockflow.py --delta
echo.
echo ============================================
if errorlevel 1 (
    echo   SYNC FAILED - see error above
) else (
    echo   SYNC COMPLETE
)
echo ============================================
echo.
echo Press any key to close...
pause >nul
