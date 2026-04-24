@echo off
setlocal
title OBP Launcher
cd /d "%~dp0"

REM --- Require node on PATH ---
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Node.js was not found on PATH.
    echo  Install it from https://nodejs.org/ and try again.
    echo.
    pause
    exit /b 1
)

REM --- Is port 5173 already listening? (skip starting a second server) ---
set "PORT_BUSY=0"
for /f "tokens=*" %%L in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do set "PORT_BUSY=1"

if "%PORT_BUSY%"=="1" (
    echo.
    echo  Server already running on port 5173 — reusing it.
) else (
    echo.
    echo  Starting OBP server in a new window...
    start "OBP Server (close this window to stop)" cmd /k "node server.js"

    echo  Waiting for server to boot...
    REM Poll /api/ping up to ~15 seconds using PowerShell (ships with Windows)
    for /l %%i in (1,1,15) do (
        powershell -NoProfile -Command "try { if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri 'http://localhost:5173/api/ping').StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
        if not errorlevel 1 goto :ready
        timeout /t 1 /nobreak >nul
    )
    echo  (Server didn't respond yet — opening the browser anyway.)
    :ready
)

echo.
echo  Opening http://localhost:5173/ ...
start "" "http://localhost:5173/"

endlocal
exit /b 0
