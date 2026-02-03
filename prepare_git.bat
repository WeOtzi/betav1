@echo off
chcp 65001 >nul
echo ============================================
echo   Initializing Git Repository for WeOtzi
echo ============================================
echo.

cd /d "%~dp0"

echo [1/3] Initializing git repository...
git init
if %errorlevel% neq 0 (
    echo ERROR: Failed to initialize git repository
    pause
    exit /b 1
)

echo.
echo [2/3] Adding all files...
git add .
if %errorlevel% neq 0 (
    echo ERROR: Failed to add files
    pause
    exit /b 1
)

echo.
echo [3/3] Creating initial commit...
git commit -m "Initial commit: We Otzi unified web application"
if %errorlevel% neq 0 (
    echo ERROR: Failed to create commit
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Git repository initialized successfully!
echo ============================================
echo.
echo Next steps:
echo Run these commands to push to GitHub:
echo.
echo    git remote add origin https://github.com/WeOtzi/betav1.git
echo    git branch -M main
echo    git push -u origin main
echo.
pause
