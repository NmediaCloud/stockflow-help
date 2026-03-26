@echo off
echo ================================================
echo   Consolidate Compressed Files for Upload
echo ================================================
echo.
echo   Renames and copies all compressed montages into
echo   one flat "Social Upload" folder with descriptive names.
echo   Format: Category_Subcategory_Collection_W/S/V.mp4
echo.
python tools\consolidate_for_upload.py %*
echo.
pause
