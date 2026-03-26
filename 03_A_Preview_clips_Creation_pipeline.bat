@echo off
echo ================================================
echo   Preview Clips Pipeline
echo   Download + Watermark + Music + Compress
echo ================================================
echo.
echo   Downloads preview clips from GCS
echo   Adds watermark, music, and compresses
echo   Outputs to W/S/V output\02_Social_Clips_from_Preview\
echo.

set /p "MODE=Append (A) or Overwrite (O)? [A]: "
if /i "%MODE%"=="O" (
    python "%~dp0tools\preview_clips_pipeline.py" --overwrite %*
) else (
    python "%~dp0tools\preview_clips_pipeline.py" %*
)

echo.
pause
