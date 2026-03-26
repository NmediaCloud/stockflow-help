@echo off
echo ================================================
echo   Upload to Google Cloud Storage
echo ================================================
echo.
python "%~dp0tools\upload_to_gcs.py" %*
echo.
pause
