@echo off
rem Opens the project in the portable VS Code under tools\vscode.
rem Its settings and extensions live in tools\vscode\data, separate from any installed VS Code.
if not exist "%~dp0tools\vscode\Code.exe" (
  echo Portable VS Code not found in tools\vscode - see "Portable VS Code" in README.md.
  pause
  exit /b 1
)
start "" "%~dp0tools\vscode\Code.exe" "%~dp0BOSSME5.code-workspace"
