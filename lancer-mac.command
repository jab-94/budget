#!/bin/bash
# Double-cliquez pour lancer Budget local (Mac).
cd "$(dirname "$0")" || exit 1
exec .venv/bin/python -m app
