@echo off
title Letterboxd MySQL Database Server
echo ===================================================
echo   LETTERBOXD PORTABLE DATABASE SERVER (MySQL)      
echo ===================================================
echo.
echo Starting database server on localhost:3306...
echo.
echo NOTE: If a Windows Firewall prompt appears, you can 
echo       simply click "Cancel". It will still work!
echo.
echo [Close this window or press Ctrl+C to STOP the database]
echo.
cd /d "%~dp0"
.\mysql-9.7.0-winx64\bin\mysqld.exe --console
pause
