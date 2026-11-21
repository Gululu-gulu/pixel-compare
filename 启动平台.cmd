@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "COMPARE_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  set "COMPARE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if not exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    echo 请先安装 Node.js 22.18 或更新版本，然后重新双击本文件。
    pause
    exit /b 1
  )
)
"%COMPARE_NODE%" serve.mjs --open
pause
