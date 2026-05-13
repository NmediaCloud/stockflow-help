@echo off
title Stockflow Help - GitHub Deploy
color 0A
setlocal

echo.
echo ============================================
echo   STOCKFLOW HELP - GITHUB DEPLOY TOOL
echo ============================================
echo.

echo [1/4] %TIME%  Staging files...
git add .
if errorlevel 1 goto :fail
echo   Done.
echo.

echo [2/4] %TIME%  Committing...
git commit -m "Deploy: Stockflow help docs update"
rem commit returns 1 when nothing to commit -- not a failure for us
echo.

echo [3/4] %TIME%  Pushing source to master...
git push origin master
if errorlevel 1 goto :fail
echo.

echo [4/4] %TIME%  Building site + deploying to gh-pages (1-3 min)...
echo   You will see mkdocs INFO lines as pages build.
echo.
mkdocs gh-deploy --force --verbose
if errorlevel 1 goto :fail

echo.
echo ============================================
echo   DEPLOY COMPLETE!  %TIME%
echo   Live: https://help.stockflow.media
echo ============================================
echo.
pause
exit /b 0

:fail
echo.
echo ============================================
echo   *** DEPLOY FAILED at %TIME% ***
echo   See error above. gh-pages NOT updated.
echo ============================================
echo.
pause
exit /b 1
