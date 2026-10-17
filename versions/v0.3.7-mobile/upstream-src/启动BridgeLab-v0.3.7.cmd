@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.12 or newer, then open this file again.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo Build missing. Please run npm install and npm run build first.
  pause
  exit /b 1
)
if not defined BRIDGELAB_PORT set "BRIDGELAB_PORT=5197"
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 1200; Start-Process 'http://localhost:%BRIDGELAB_PORT%'"
node scripts\serve.mjs
pause
