"""Lance l'app avec un GARDE RÉSEAU : toute connexion sortante est bloquée ET signalée.

Usage (audit) :  .venv/bin/python tools/network_guard.py --no-browser
Puis utilisez l'app normalement. La moindre tentative de connexion vers une
adresse autre que la machine locale est écrite dans le terminal (« BLOQUÉ »)
et dans data/network_guard.log, et échoue.
"""
from __future__ import annotations

import ipaddress
import socket
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
LOG = ROOT / "data" / "network_guard.log"

_connect, _connect_ex, _getaddrinfo = socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo


def _local(host) -> bool:
    if host in (None, "", "localhost"):
        return True
    try:
        return ipaddress.ip_address(str(host).split("%")[0]).is_loopback
    except ValueError:
        return False


def _block(what: str):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    msg = f"BLOQUÉ : {what}\n" + "".join(traceback.format_stack(limit=8))
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(msg + "\n")
    print(msg, file=sys.stderr)
    raise PermissionError(f"Connexion sortante bloquée par le garde réseau : {what}")


def connect(self, address):
    if not isinstance(address, (str, bytes)) and not _local(address[0]):
        _block(f"connexion vers {address!r}")
    return _connect(self, address)


def connect_ex(self, address):
    if not isinstance(address, (str, bytes)) and not _local(address[0]):
        _block(f"connexion vers {address!r}")
    return _connect_ex(self, address)


def getaddrinfo(host, *args, **kwargs):
    if not _local(host):
        _block(f"résolution DNS de {host!r}")
    return _getaddrinfo(host, *args, **kwargs)


socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo = connect, connect_ex, getaddrinfo

if __name__ == "__main__":
    from app.__main__ import main

    print("Garde réseau actif : toute connexion sortante sera bloquée et signalée.", file=sys.stderr)
    main()
