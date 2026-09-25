@echo off
rem Starts the ME-5 editor: runs the backend in this window and opens the editor in the browser.
rem Close this window (or press Ctrl+C) to stop the server.
setlocal
rem Portable Python in tools\python (see tools\setup-python.cmd).
set "PY=%~dp0tools\python\python.exe"
set "URL=http://localhost:8000/"
rem Health checks go to 127.0.0.1: "localhost" tries IPv6 first, which uvicorn does not listen on.
set "CHECK=http://127.0.0.1:8000/api/params"
title ME-5 Editor

if not exist "%PY%" (
  echo Portable Python not found in tools\python. Set it up once by running:
  echo   tools\setup-python.cmd
  pause
  exit /b 1
)

rem Already running (e.g. from VS Code): just open the page.
curl -s -o nul "%CHECK%" && (
  start "" "%URL%"
  exit /b 0
)

rem Open the browser once the server answers (gives up after ~30 s).
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest -UseBasicParsing '%CHECK%' -TimeoutSec 1 | Out-Null; Start-Process '%URL%'; break } catch { Start-Sleep -Milliseconds 500 } }"

echo ME-5 editor: %URL%
echo Close this window to stop the server.
echo.
cd /d "%~dp0backend"
"%PY%" -m uvicorn app.main:app --port 8000
if errorlevel 1 pause
