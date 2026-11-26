@echo off
title OpenJarvis - HEX AI (127.0.0.1:8000)
echo Starting OpenJarvis on 127.0.0.1:8000 ...
echo Wait for "Uvicorn running", then use the HEX chat panel. Keep this window open.
cd /d "D:\Claude\OpenJarvis"
uv run jarvis serve --host 127.0.0.1 --port 8000 --engine ollama --model qwen3:8b --agent simple
pause
