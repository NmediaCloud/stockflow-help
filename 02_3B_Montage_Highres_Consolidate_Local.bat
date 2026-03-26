@echo off
title Stockflow - Consolidate High-Res for Drive Upload
color 0B
cd /d "%~dp0"
python tools\consolidate_highres_for_drive.py %*
pause
