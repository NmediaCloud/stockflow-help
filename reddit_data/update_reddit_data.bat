@echo off
cd /d "%~dp0"
echo ----------------------------------------
echo Running Reddit Marketing Data Generation
echo ----------------------------------------
python generate_reddit_data.py
echo.
echo Press any key to exit...
pause >nul
