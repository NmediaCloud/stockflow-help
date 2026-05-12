@echo off
cd /d "%~dp0"
chcp 65001 >nul
set PYTHONIOENCODING=utf-8

echo Launching control panel... (log: stockflow_panel.log)
python tools\control_panel.py 2> stockflow_panel.log
set RC=%ERRORLEVEL%

echo.
echo ============================================
echo Exit code: %RC%
echo ============================================
if exist stockflow_panel.log (
    echo --- stockflow_panel.log ---
    type stockflow_panel.log
)
echo.
pause
