@echo off
title Stockflow Help - Sync
cd /d "%~dp0"
echo.
echo ============================================
echo   STOCKFLOW HELP - FULL SYNC
echo ============================================
echo.
echo Starting sync...
echo.
python tools\sync_stockflow.py
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
