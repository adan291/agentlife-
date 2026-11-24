@echo off
rem Double-click to start the AGENT LIFE hotel (engine, world-server, client) and open it in the browser.
rem Close this window or press Ctrl+C to stop everything. Options: see "pnpm hotel --help".
cd /d "%~dp0"
where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm is not installed. Install Node.js 22+ from https://nodejs.org, then run: npm install -g pnpm
  pause
  exit /b 1
)
call pnpm hotel %*
pause
