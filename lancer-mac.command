#!/bin/bash
# Double-cliquez pour lancer Budget local (Mac).
# Au premier lancement, ou après une mise à jour qui ajoute une bibliothèque,
# les bibliothèques sont installées automatiquement (Internet nécessaire cette fois-là).
cd "$(dirname "$0")" || exit 1
if [ ! -x .venv/bin/python ]; then
  echo "Premier lancement : préparation de l'environnement…"
  python3 -m venv .venv || { echo "Python 3 introuvable : installez-le depuis python.org"; read -r; exit 1; }
fi
.venv/bin/python tools/deps.py || { read -r; exit 1; }
exec .venv/bin/python -m app
