@echo off
title Stockflow Help - Sync
color 0A
echo.
echo ============================================
echo   STOCKFLOW HELP - SYNC TOOL
echo ============================================
echo.
echo Choose sync mode:
echo   [1] Full Sync    - Regenerate ALL pages (use after major updates)
echo   [2] Delta Sync   - Only NEW items from sheet (faster, daily use)
echo.
set /p choice="Enter 1 or 2: "

if "%choice%"=="2" (
    echo.
    echo Running DELTA sync (new items only)...
    python tools\sync_stockflow.py --delta
) else (
    echo.
    echo Running FULL sync (all pages)...
    python tools\sync_stockflow.py
)

echo.
echo ============================================
echo   Sync Complete!
echo   Next: Run deploy.bat to push changes live.
echo ============================================
echo.
pause >nul
