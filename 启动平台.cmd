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
if not exist "dist\index.html" (
  echo 首次启动：正在准备平台文件……
  where npm >nul 2>nul
  if errorlevel 1 (
    echo 找不到 npm。请安装 Node.js 22.18 或更新版本，安装时保留 npm，然后重新启动。
    pause
    exit /b 1
  )
  if not exist "node_modules" (
    echo 正在安装依赖，首次运行需要联网，请稍候……
    call npm install
    if errorlevel 1 (
      echo 依赖安装失败。请检查网络连接后重试。
      pause
      exit /b 1
    )
  )
  echo 正在构建平台……
  call npm run build
  if errorlevel 1 (
    echo 构建失败。请确认已安装 Node.js 22.18 或更新版本，并检查终端错误信息。
    pause
    exit /b 1
  )
)
"%COMPARE_NODE%" serve.mjs --open
pause
