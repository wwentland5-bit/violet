@echo off
REM ============================================================
REM  Build Violet into an installer + portable .exe
REM  Double-click this file. First run downloads tools (~5 min).
REM ============================================================
cd /d "%~dp0"
echo.
echo  [1/2] Installing / updating packages...
call npm install
if errorlevel 1 (
  echo.
  echo  npm install failed. Is Node.js installed? Get it from https://nodejs.org
  pause
  exit /b 1
)
echo.
echo  [2/2] Building Violet.exe ...
call npm run dist
if errorlevel 1 (
  echo.
  echo  Build failed. Scroll up for the red error text.
  pause
  exit /b 1
)
echo.
echo  Done! Opening the dist folder:
echo    Violet-Setup-x.x.x.exe   = installer (Start menu + desktop shortcut)
echo    Violet-Portable-x.x.x.exe = runs without installing
start "" "%~dp0dist"
pause
