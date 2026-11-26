@echo off
rem HEX one-click launcher: Ollama + OpenJarvis + local agent + browser
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-hex.ps1"
