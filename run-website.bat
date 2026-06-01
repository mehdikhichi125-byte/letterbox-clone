@echo off
title Letterboxd Web Application Server
echo ===================================================
echo   LETTERBOXD WEB APPLICATION SERVER (Node.js)     
echo ===================================================
echo.
echo Starting Letterboxd server on http://localhost:3500...
echo.
echo NOTE: Make sure the database is running first by 
echo       double-clicking "run-database.bat"!
echo.
cd /d "%~dp0"
:: Temporarily add portable Node.js to the PATH environment variable
set PATH=%~dp0node-v24.16.0-win-x64;%PATH%
call npm.cmd start
pause
