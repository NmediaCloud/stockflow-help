@echo off
echo Starting Stockflow Documentation Sync...
cd tools
python sync_stockflow.py
echo.
echo Sync Complete! Press any key to exit.
pause >nul
