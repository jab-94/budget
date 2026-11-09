"""Briques communes aux importeurs : structures de données, lecture des montants et des dates.

Tous les montants sont manipulés en CENTIMES (entiers) pour éviter les erreurs
d'arrondi : « 1 234,56 » devient 123456.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import date


class ImportErrorFr(Exception):
    """Erreur d'import, message affichable tel quel (jamais de donnée personnelle)."""


@dataclass
class ParsedTransaction:
    date: str  # AAAA-MM-JJ
    label: str
    amount_cents: int  # négatif = dépense
    uncertain_sign: bool = False  # vrai si le sens débit/crédit a été deviné


@dataclass
class ParsedStatement:
    source: str  # "pdf" | "csv"
    parser: str  # nom du parseur utilisé
    transactions: list[ParsedTransaction] = field(default_factory=list)
    opening_balance_cents: int | None = None
    closing_balance_cents: int | None = None
    period_start: str | None = None
    period_end: str | None = None
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# --- Montants ---------------------------------------------------------------------------
_SPACES = re.compile(r"[\s  ']")
AMOUNT_RE = re.compile(r"[-+]?\d{1,3}(?:[   .]\d{3})*(?:,\d{2})|[-+]?\d+(?:[.,]\d{1,2})?")


def parse_amount(text: str) -> int:
    """« -1 234,56 € » -> -123456. Accepte virgule ou point décimal, signe devant ou derrière."""
    if text is None:
        raise ValueError("montant vide")
    s = str(text).strip().replace("€", "").replace("EUR", "").strip()
    if not s:
        raise ValueError("montant vide")
    negative = False
    if s.startswith("(") and s.endswith(")"):
        negative, s = True, s[1:-1]
    if s.endswith("-"):
        negative, s = True, s[:-1]
    if s.startswith("-"):
        negative, s = True, s[1:]
    elif s.startswith("+"):
        s = s[1:]
    s = _SPACES.sub("", s)
    if "," in s and "." in s:
        # Le dernier séparateur est le séparateur décimal.
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    elif s.count(".") > 1:
        s = s.replace(".", "")
    if not re.fullmatch(r"\d+(\.\d{1,2})?", s):
        raise ValueError("montant illisible")
    whole, _, dec = s.partition(".")
    cents = int(whole) * 100 + int((dec + "00")[:2])
    return -cents if negative else cents


def format_cents(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    e, c = divmod(abs(cents), 100)
    return f"{sign}{e:,}".replace(",", " ") + f",{c:02d} €"


# --- Dates ------------------------------------------------------------------------------
_DATE_PATTERNS = [
    (re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})"), ("y", "m", "d")),
    (re.compile(r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$"), ("d", "m", "y")),
    (re.compile(r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$"), ("d", "m", "yy")),
]


def parse_date(text: str, default_year: int | None = None) -> str:
    s = str(text).strip()
    for pat, order in _DATE_PATTERNS:
        m = pat.match(s)
        if m:
            parts = dict(zip(order, m.groups()))
            y = int(parts.get("y") or 2000 + int(parts["yy"]))
            return date(y, int(parts["m"]), int(parts["d"])).isoformat()
    m = re.fullmatch(r"(\d{1,2})[/.](\d{1,2})", s)
    if m and default_year:
        return date(default_year, int(m.group(2)), int(m.group(1))).isoformat()
    raise ValueError("date illisible")


# --- Libellés ---------------------------------------------------------------------------
def normalize_label(label: str) -> str:
    """Majuscules sans accents, espaces simples, sans dates ni numéros variables.

    Sert à comparer deux libellés (doublons, récurrences, règles) :
    « CB Carrefour 02/03 » et « CB CARREFOUR 15/04 » -> « CB CARREFOUR ».
    """
    s = unicodedata.normalize("NFKD", label)
    s = "".join(c for c in s if not unicodedata.combining(c)).upper()
    s = re.sub(r"\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b", " ", s)  # dates
    s = re.sub(r"\b[A-Z]*\d[\dA-Z]{5,}\b", " ", s)  # références, numéros de carte
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()
