@echo off
REM Double-cliquez pour lancer Budget local (Windows).
REM Au premier lancement, ou apres une mise a jour qui ajoute une bibliotheque,
REM les bibliotheques sont installees automatiquement (Internet necessaire cette fois-la).
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Premier lancement : preparation de lenvironnement...
  py -m venv .venv || python -m venv .venv || goto :nopython
)
".venv\Scripts\python.exe" tools\deps.py || goto :fin
".venv\Scripts\python.exe" -m app
goto :fin
:nopython
echo Python introuvable : installez-le depuis python.org (cochez "Add python.exe to PATH").
:fin
pause
