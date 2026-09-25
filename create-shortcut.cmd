@echo off
rem Creates an "ME-5 Editor" shortcut with the ME-5 icon, on the desktop and next to this file.
rem A .cmd file cannot carry its own icon, the shortcut can. Run it again if you move the folder.
setlocal
set "ROOT=%~dp0"
powershell -NoProfile -Command ^
  "$root = $env:ROOT.TrimEnd('\');" ^
  "$shell = New-Object -ComObject WScript.Shell;" ^
  "foreach ($dir in @([Environment]::GetFolderPath('Desktop'), $root)) {" ^
  "  $lnk = $shell.CreateShortcut((Join-Path $dir 'ME-5 Editor.lnk'));" ^
  "  $lnk.TargetPath = Join-Path $root 'start-editor.cmd';" ^
  "  $lnk.WorkingDirectory = $root;" ^
  "  $lnk.IconLocation = (Join-Path $root 'frontend\me5.ico') + ',0';" ^
  "  $lnk.Description = 'Boss ME-5 editor';" ^
  "  $lnk.Save();" ^
  "  Write-Host ('Created ' + $lnk.FullName)" ^
  "}"
if errorlevel 1 (
  echo Could not create the shortcut.
  pause
  exit /b 1
)
"%SystemRoot%\System32\timeout.exe" /t 3 >nul
