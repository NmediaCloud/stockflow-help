@echo off
title Stockflow - Drive Upload + Master Sheet
color 0B
echo.
echo ============================================
echo   STOCKFLOW - DRIVE UPLOAD + MASTER SHEET
echo ============================================
echo.
echo   Upload:
echo     1.  W upload          Widescreen 16:9
echo     2.  S upload          Square 1:1
echo     3.  V upload          Vertical 9:16
echo     4.  All upload        All formats
echo.
echo   Force (overwrite existing):
echo     5.  W force           Force widescreen
echo     6.  S force           Force square
echo     7.  V force           Force vertical
echo     8.  All force         Force all formats
echo.
echo   Check (compare local vs Drive):
echo     9.  W check           Check widescreen
echo     10. S check           Check square
echo     11. V check           Check vertical
echo     12. All check         Check all formats
echo.
echo   Other:
echo     13. Dry run           Preview what would upload
echo     14. Sheet only        Only update Master Sheet
echo.
set /p CHOICE="  Enter choice (1-14): "
echo.

set FMT=
set EXTRA=

if "%CHOICE%"=="1" set FMT=W
if "%CHOICE%"=="2" set FMT=S
if "%CHOICE%"=="3" set FMT=V
if "%CHOICE%"=="4" set FMT=all
if "%CHOICE%"=="5" set FMT=W& set EXTRA=--force
if "%CHOICE%"=="6" set FMT=S& set EXTRA=--force
if "%CHOICE%"=="7" set FMT=V& set EXTRA=--force
if "%CHOICE%"=="8" set FMT=all& set EXTRA=--force
if "%CHOICE%"=="9" set FMT=W& set EXTRA=--check
if "%CHOICE%"=="10" set FMT=S& set EXTRA=--check
if "%CHOICE%"=="11" set FMT=V& set EXTRA=--check
if "%CHOICE%"=="12" set FMT=all& set EXTRA=--check
if "%CHOICE%"=="13" set FMT=all& set EXTRA=--dry-run
if "%CHOICE%"=="14" set FMT=all& set EXTRA=--sheet-only

if not defined FMT (
    echo   Invalid choice. Defaulting to W.
    set FMT=W
)

echo   Format: %FMT%
if defined EXTRA echo   Option: %EXTRA%
echo.

python tools/upload_to_drive.py --format %FMT% %EXTRA%
echo.
pause
