@echo off
cd /d "%~dp0"
echo CS Prefab Configurator
echo Open http://localhost:8078/prefab in your browser.
echo Keep this window open. Press Ctrl+C to stop.
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 scripts\serve.py --port 8078
) else (
  python scripts\serve.py --port 8078
)
pause
