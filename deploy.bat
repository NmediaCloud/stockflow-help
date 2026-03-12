@echo off
title Stockflow Help - GitHub Deploy
color 0A

echo.
echo ============================================
echo   STOCKFLOW HELP - GITHUB DEPLOY TOOL
echo ============================================
echo.

echo [1/6] Checking Git installation...
git --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Git is not installed. 
    echo  Download from: https://git-scm.com/download/win
    pause
    exit /b 1
)
echo  OK - Git found.
echo.

echo [2/6] Initializing Git repository (if needed)...
if not exist ".git" (
    git init
    echo  OK - Git initialized.
) else (
    echo  OK - Git already initialized.
)
echo.

echo [3/6] Connecting to GitHub remote...
git remote get-url origin >nul 2>&1
if errorlevel 1 (
    git remote add origin https://github.com/NmediaCloud/stockflow-help.git
    echo  OK - Remote added.
) else (
    echo  OK - Remote already configured.
)
echo.

echo [4/6] Staging all files for commit...
git add .
echo  OK - Files staged.
echo.

echo [5/6] Committing changes...
git commit -m "Deploy: Stockflow help docs update"
echo  OK - Committed.
echo.

echo [6/6] Deploying to GitHub Pages...
echo  This will push the code AND build the live site.
echo  This step may take 30-60 seconds...
echo.
mkdocs gh-deploy --force
echo.

echo ============================================
echo   DEPLOY COMPLETE!
echo   Live site: https://nmediacloud.github.io/stockflow-help/
echo   (Custom domain help.stockflow.media once DNS is configured)
echo ============================================
echo.
pause
