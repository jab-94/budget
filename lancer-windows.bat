@echo off
REM Double-cliquez pour lancer Budget local (Windows).
cd /d "%~dp0"
.venv\Scripts\python.exe -m app
pause
