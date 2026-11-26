@echo off
chcp 65001 >nul
title J.A.R.V.I.S. agent
cd /d "%~dp0"

if not exist node_modules (
  echo 第一次執行，正在安裝套件...
  call npm.cmd install || goto :fail
)

rem 等 agent 啟動後自動用 Chrome（或預設瀏覽器）打開
start "" /b cmd /c "timeout /t 4 >nul & start chrome http://localhost:4000 || start http://localhost:4000"

call npm.cmd run agent
:fail
echo.
echo agent 已停止。按任意鍵關閉視窗。
pause >nul
