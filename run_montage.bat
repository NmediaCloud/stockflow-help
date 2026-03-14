@echo off
setlocal enabledelayedexpansion
title Stockflow - Montage Builder
color 0A

cd /d "%~dp0"

:menu
echo.
echo ============================================
echo   STOCKFLOW - MONTAGE BUILDER
echo ============================================
echo.
echo   1. Build a single collection  (~1 min video)
echo   2. Build a full subcategory   (~3 min video)
echo   3. Build a full category      (~6 min video)
echo   4. Build ALL collections      (skips existing)
echo   5. Build ALL subcategories    (skips existing)
echo   6. Build ALL categories       (skips existing)
echo   7. List all available targets
echo   8. Exit
echo.
set /p "CHOICE=  Select [1-8]: "

if "%CHOICE%"=="1" goto collection
if "%CHOICE%"=="2" goto subcategory
if "%CHOICE%"=="3" goto category
if "%CHOICE%"=="4" goto all_collections
if "%CHOICE%"=="5" goto all_subcategories
if "%CHOICE%"=="6" goto all_categories
if "%CHOICE%"=="7" goto list
if "%CHOICE%"=="8" exit /b 0
echo   Invalid choice. Try again.
goto menu

:list
echo.
python "Marketing content\montage_builder.py" --list
echo.
pause
goto menu

:collection
echo.
echo   Enter the collection name (e.g. Chicken Dinner):
set /p "NAME=  Name: "
if "!NAME!"=="" (
    echo   No name entered.
    goto menu
)
echo.
echo   Force rebuild even if file exists? [y/N]
set /p "FORCE=  Force: "
if /i "!FORCE!"=="y" (
    python "Marketing content\montage_builder.py" --level collection --name "!NAME!" --force
) else (
    python "Marketing content\montage_builder.py" --level collection --name "!NAME!"
)
echo.
pause
goto menu

:subcategory
echo.
echo   Enter the subcategory name (e.g. Food Menu):
set /p "NAME=  Name: "
if "!NAME!"=="" (
    echo   No name entered.
    goto menu
)
echo.
echo   Force rebuild even if files exist? [y/N]
set /p "FORCE=  Force: "
if /i "!FORCE!"=="y" (
    python "Marketing content\montage_builder.py" --level subcategory --name "!NAME!" --force
) else (
    python "Marketing content\montage_builder.py" --level subcategory --name "!NAME!"
)
echo.
pause
goto menu

:category
echo.
echo   Enter the category name (e.g. Microscopic):
set /p "NAME=  Name: "
if "!NAME!"=="" (
    echo   No name entered.
    goto menu
)
echo.
echo   Force rebuild even if files exist? [y/N]
set /p "FORCE=  Force: "
if /i "!FORCE!"=="y" (
    python "Marketing content\montage_builder.py" --level category --name "!NAME!" --force
) else (
    python "Marketing content\montage_builder.py" --level category --name "!NAME!"
)
echo.
pause
goto menu

:all_collections
echo.
echo   Building ALL collections (existing files will be skipped)...
echo.
python "Marketing content\montage_builder.py" --level collection --all
echo.
pause
goto menu

:all_subcategories
echo.
echo   Building ALL subcategories (existing files will be skipped)...
echo.
python "Marketing content\montage_builder.py" --level subcategory --all
echo.
pause
goto menu

:all_categories
echo.
echo   Building ALL categories (existing files will be skipped)...
echo.
python "Marketing content\montage_builder.py" --level category --all
echo.
pause
goto menu
