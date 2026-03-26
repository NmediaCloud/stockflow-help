@echo off
title Stockflow Help - GitHub Deploy
color 0A

echo.
echo ============================================
echo   STOCKFLOW HELP - GITHUB DEPLOY TOOL
echo ============================================
echo.

echo [1/4] Staging files...
git add .
echo  Done.
echo.

echo [2/4] Committing...
git commit -m "Deploy: Stockflow help docs update"
echo.

echo [3/4] Pushing source to master...
git push origin master
echo.

echo [4/4] Building site + deploying to gh-pages...
echo  This takes 1-3 minutes for 300+ pages...
echo.
mkdocs gh-deploy --force
echo.

echo ============================================
echo   DEPLOY COMPLETE!
echo   Live: https://help.stockflow.media
echo ============================================
echo.
pause
