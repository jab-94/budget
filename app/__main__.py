"""Lanceur : `python -m app`

Démarre le serveur sur 127.0.0.1 UNIQUEMENT, puis ouvre le navigateur local.
"""
from __future__ import annotations

import argparse
import ipaddress
import logging
import threading
import webbrowser

import uvicorn

from . import config
from .safe_logging import setup_logging


def _assert_loopback(host: str) -> None:
    if not ipaddress.ip_address(host).is_loopback:
        raise SystemExit("Refus de démarrer : l'app ne doit écouter que sur 127.0.0.1.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Budget local (100 % hors ligne)")
    parser.add_argument("--port", type=int, default=config.DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true", help="ne pas ouvrir le navigateur")
    args = parser.parse_args()

    _assert_loopback(config.HOST)
    setup_logging()
    url = f"http://{config.HOST}:{args.port}/"
    logging.getLogger("budget").info("Budget local disponible sur %s", url)
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    uvicorn.run(
        "app.main:app",
        host=config.HOST,
        port=args.port,
        access_log=False,  # les URL ne doivent pas finir dans un journal
        log_config=None,  # on garde notre configuration filtrée
        server_header=False,
        proxy_headers=False,
    )


if __name__ == "__main__":
    main()
