@echo off
title Stockflow - Generate Publishing Schedule
color 0C

echo.
echo ============================================
echo   STOCKFLOW - PUBLISHING SCHEDULE
echo ============================================
echo.
echo   Generates scheduled posts across platforms
echo   (YouTube, TikTok, Instagram, LinkedIn, etc.)
echo.

python tools/generate_schedule.py %*

echo.
pause
