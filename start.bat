@echo off
title Page Tracker
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install it from https://nodejs.org & pause & exit /b 1)
rem The server opens the browser itself once it is ready (--open)
node server.js --open
echo.
echo Page Tracker stopped.
pause
