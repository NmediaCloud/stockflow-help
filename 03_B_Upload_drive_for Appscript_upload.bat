@echo off
title Stockflow - Drive Upload (Batch)
color 0B
echo.
echo ================================================
echo   STOCKFLOW - DRIVE UPLOAD (Batch Structure)
echo ================================================
echo.
echo   Source: Marketing content\Stockflow-social\
echo   Target: Google Drive (Stockflow-social)
echo.

python tools/upload_to_drive_batch.py %*

echo.
pause
