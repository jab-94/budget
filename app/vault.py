"""Coffre-fort chiffré : le fichier unique qui contient toute la base.

Format du fichier (binaire) :

    b"BLV1" | longueur de l'en-tête (4 octets, big-endian) | en-tête JSON | données chiffrées

- L'en-tête (non secret) contient les paramètres de dérivation de clé, le sel,
  le nonce, un numéro de révision et l'identifiant de l'appareil qui a écrit.
  Il est authentifié (AAD) : toute modification le rend invalide.
- Les données = la base SQLite sérialisée, chiffrée en AES-256-GCM.
- La clé est dérivée du mot de passe avec scrypt (coûteux exprès, pour rendre
  très lent un essai de mots de passe en masse si le fichier fuit d'iCloud).

La base n'est JAMAIS écrite en clair sur le disque : elle est déchiffrée en
mémoire, et réécrite chiffrée à chaque sauvegarde (écriture atomique).
"""
from __future__ import annotations

import json
import os
import struct
from dataclasses import dataclass
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

MAGIC = b"BLV1"
# Paramètres scrypt : ~0,5 s et 128 Mo par essai sur un ordinateur récent.
SCRYPT_N = 2**17
SCRYPT_R = 8
SCRYPT_P = 1


class VaultError(Exception):
    """Erreur générique du coffre (message toujours sans donnée personnelle)."""


class WrongPassword(VaultError):
    pass


class VaultConflict(VaultError):
    """Le fichier a été modifié ailleurs (autre ordinateur via iCloud) depuis l'ouverture."""


@dataclass
class VaultHeader:
    salt: bytes
    nonce: bytes
    revision: int
    device: str
    n: int = SCRYPT_N
    r: int = SCRYPT_R
    p: int = SCRYPT_P

    def to_bytes(self) -> bytes:
        return json.dumps(
            {
                "v": 1,
                "kdf": "scrypt",
                "n": self.n,
                "r": self.r,
                "p": self.p,
                "salt": self.salt.hex(),
                "nonce": self.nonce.hex(),
                "revision": self.revision,
                "device": self.device,
            },
            sort_keys=True,
        ).encode()

    @classmethod
    def from_bytes(cls, raw: bytes) -> "VaultHeader":
        d = json.loads(raw)
        if d.get("v") != 1 or d.get("kdf") != "scrypt":
            raise VaultError("Format de coffre non reconnu.")
        return cls(
            salt=bytes.fromhex(d["salt"]),
            nonce=bytes.fromhex(d["nonce"]),
            revision=int(d["revision"]),
            device=str(d["device"]),
            n=int(d["n"]),
            r=int(d["r"]),
            p=int(d["p"]),
        )


def derive_key(password: str, salt: bytes, n: int = SCRYPT_N, r: int = SCRYPT_R, p: int = SCRYPT_P) -> bytes:
    return Scrypt(salt=salt, length=32, n=n, r=r, p=p).derive(password.encode("utf-8"))


def _split(blob: bytes) -> tuple[bytes, VaultHeader, bytes]:
    if len(blob) < 8 or blob[:4] != MAGIC:
        raise VaultError("Ce fichier n'est pas un coffre Budget local.")
    (hlen,) = struct.unpack(">I", blob[4:8])
    raw_header = blob[8 : 8 + hlen]
    return raw_header, VaultHeader.from_bytes(raw_header), blob[8 + hlen :]


def read_header(path: Path) -> VaultHeader:
    _, header, _ = _split(Path(path).read_bytes())
    return header


class Vault:
    """Gère un fichier coffre. La clé dérivée reste en mémoire tant qu'il est ouvert."""

    def __init__(self, path: Path, device: str):
        self.path = Path(path)
        self.device = device
        self._key: bytes | None = None
        self._salt: bytes | None = None
        self._params = (SCRYPT_N, SCRYPT_R, SCRYPT_P)
        self.revision = 0

    # --- création / ouverture -------------------------------------------------
    def create(self, password: str, payload: bytes) -> None:
        if self.path.exists():
            raise VaultError("Un coffre existe déjà à cet emplacement.")
        self._salt = os.urandom(16)
        self._key = derive_key(password, self._salt)
        self.revision = 0
        self.save(payload, check_conflict=False)

    def open(self, password: str) -> bytes:
        raw_header, header, ciphertext = _split(self.path.read_bytes())
        key = derive_key(password, header.salt, header.n, header.r, header.p)
        try:
            payload = AESGCM(key).decrypt(header.nonce, ciphertext, MAGIC + raw_header)
        except InvalidTag:
            raise WrongPassword("Mot de passe incorrect.") from None
        self._key, self._salt = key, header.salt
        self._params = (header.n, header.r, header.p)
        self.revision = header.revision
        return payload

    @property
    def is_open(self) -> bool:
        return self._key is not None

    def close(self) -> None:
        self._key = None
        self._salt = None

    # --- sauvegarde -------------------------------------------------------------
    def disk_revision(self) -> int | None:
        try:
            return read_header(self.path).revision
        except FileNotFoundError:
            return None

    def save(self, payload: bytes, check_conflict: bool = True) -> None:
        if self._key is None or self._salt is None:
            raise VaultError("Coffre verrouillé.")
        if check_conflict:
            on_disk = self.disk_revision()
            if on_disk is not None and on_disk != self.revision:
                raise VaultConflict(
                    "Le coffre a été modifié sur un autre appareil depuis son ouverture."
                )
        n, r, p = self._params
        header = VaultHeader(
            salt=self._salt, nonce=os.urandom(12), revision=self.revision + 1, device=self.device, n=n, r=r, p=p
        )
        raw_header = header.to_bytes()
        ciphertext = AESGCM(self._key).encrypt(header.nonce, payload, MAGIC + raw_header)
        blob = MAGIC + struct.pack(">I", len(raw_header)) + raw_header + ciphertext

        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        with open(tmp, "wb") as f:
            f.write(blob)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.path)  # atomique : jamais de fichier à moitié écrit
        self.revision = header.revision

    def change_password(self, new_password: str, payload: bytes) -> None:
        self._salt = os.urandom(16)
        self._params = (SCRYPT_N, SCRYPT_R, SCRYPT_P)
        self._key = derive_key(new_password, self._salt)
        self.save(payload)


def find_icloud_conflict_copies(path: Path) -> list[str]:
    """iCloud crée des copies « budget 2.vault » quand deux appareils écrivent en même temps."""
    path = Path(path)
    if not path.parent.is_dir():
        return []
    stem, suffix = path.stem, path.suffix
    out = []
    for f in path.parent.iterdir():
        if f == path or f.suffix != suffix:
            continue
        if f.stem.startswith(stem + " ") or f.stem.startswith(stem + "-"):
            out.append(f.name)
    return sorted(out)
