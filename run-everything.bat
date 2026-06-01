@echo off
title Letterboxd Suite Manager
echo =====================================================================
echo                  LETTERBOXD ALL-IN-ONE RUNNER                         
echo =====================================================================
echo.

:: 1. Start the Database in a separate window
echo [1/3] Starting MySQL Database Server in a separate window...
start "Letterboxd Database Server" cmd /c "run-database.bat"

:: 2. Wait until the database is ready
echo [2/3] Waiting for the database server to become ready...
:wait_loop
.\mysql-9.7.0-winx64\bin\mysql.exe -h 127.0.0.1 -u netflix -pnetflix -e "SELECT 1;" >nul 2>&1
if %errorlevel% neq 0 (
    timeout /t 1 /nobreak >nul
    goto wait_loop
)

echo.
echo [3/3] Database is online and accepting connections!
echo.

:: 3. Ensure root user has no password (fixes VS Code Database Client "Access Denied")
echo [FIX] Ensuring root@localhost has open access for DB viewer...
.\mysql-9.7.0-winx64\bin\mysql.exe -h 127.0.0.1 -u netflix -pnetflix -e "ALTER USER 'root'@'localhost' IDENTIFIED BY ''; ALTER USER 'root'@'127.0.0.1' IDENTIFIED BY ''; ALTER USER 'root'@'%%' IDENTIFIED BY ''; FLUSH PRIVILEGES;" >nul 2>&1
echo [OK]  Database viewer (root@localhost) is ready!
echo.
echo =====================================================================
echo                STARTING LETTERBOXD WEB APPLICATION                    
echo =====================================================================
echo.
echo Website will be available at: http://localhost:3500
echo.

:: 3. Run the Web Server in the current window
cd /d "%~dp0"
set PATH=%~dp0node-v24.16.0-win-x64;%PATH%
call npm.cmd start

pause
