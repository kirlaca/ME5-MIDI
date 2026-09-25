@echo off
rem Sets up a portable Python in tools\python for the ME-5 editor backend.
rem Nothing is installed on the system: everything lands in tools\python, which moves with the folder.
rem Needs internet only for the first run (and for package updates). Safe to run again.
setlocal
set "PYVER=3.12.10"
set "PYTAG=312"
set "DIR=%~dp0python"
set "PY=%DIR%\python.exe"
set "REQ=%~dp0..\backend\requirements.txt"
rem Windows' own curl/tar: they use the Windows certificate store (a Git curl on PATH may not).
set "CURL=%SystemRoot%\System32\curl.exe"
set "TAR=%SystemRoot%\System32\tar.exe"

if not exist "%PY%" (
  echo Downloading Python %PYVER% embeddable package...
  if not exist "%DIR%" mkdir "%DIR%"
  "%CURL%" -fL -o "%DIR%\python.zip" "https://www.python.org/ftp/python/%PYVER%/python-%PYVER%-embed-amd64.zip" || goto :fail
  "%TAR%" -xf "%DIR%\python.zip" -C "%DIR%" || goto :fail
  del "%DIR%\python.zip"
)

rem Search path: stdlib zip, the backend package, and site-packages ("import site").
(
  echo python%PYTAG%.zip
  echo .
  echo ..\..\backend
  echo import site
) > "%DIR%\python%PYTAG%._pth"

"%PY%" -m pip --version >nul 2>&1 || (
  echo Installing pip...
  "%CURL%" -fL -o "%DIR%\get-pip.py" "https://bootstrap.pypa.io/get-pip.py" || goto :fail
  "%PY%" "%DIR%\get-pip.py" --no-warn-script-location || goto :fail
  del "%DIR%\get-pip.py"
)

echo Installing backend packages...
"%PY%" -m pip install --no-warn-script-location --upgrade -r "%REQ%" || goto :fail

echo.
echo Portable Python ready in tools\python. Start the editor with start-editor.cmd.
pause
exit /b 0

:fail
echo.
echo Setup failed - see the messages above.
pause
exit /b 1
