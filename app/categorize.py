"""Catégorisation automatique par règles locales (aucune IA, aucun appel externe).

Ordre de décision pour une opération NON classée à la main :
  1. règles de l'utilisateur (créées à la main ou à partir d'une correction),
     par priorité puis de la plus récente à la plus ancienne ;
  2. virement entre deux comptes de l'utilisateur (même montant en sens
     opposé, à 3 jours près, libellé de virement) -> « Virements internes » ;
  3. nature fournie par la source (ex. Trade Republic : investissement, frais…) ;
  4. règles par défaut, de la plus précise (motif le plus long) à la moins précise.

Une opération classée à la main (category_locked = 1) n'est jamais modifiée.

Motifs :
  - mot-clé : comparé au libellé NORMALISÉ (majuscules, sans accents, sans
    dates ni références), sur des mots entiers : « UBER » ne trouve pas « UBEREATS »
    mais trouve « UBER BV » ;
  - expression régulière : appliquée au libellé brut, sans tenir compte de la casse.
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from datetime import date

from .importers.base import normalize_label

# --- Catégories ajoutées à l'étape 3 (créées une seule fois, même dans un coffre existant)
EXTRA_CATEGORIES = [
    ("Shopping", "expense", "#c46fb5"),
    ("Espèces", "expense", "#a58b5c"),
    ("Revenus financiers", "income", "#3f9bc4"),
    ("Investissement", "transfer", "#7f8fa6"),
]

# --- Règles par défaut : (catégorie, signe ou None, [mots-clés]) ---------------------------
# signe "+" = seulement les entrées d'argent, "-" = seulement les sorties.
DEFAULT_RULES: list[tuple[str, str | None, list[str]]] = [
    ("Alimentation", None, [
        "CARREFOUR", "LECLERC", "AUCHAN", "INTERMARCHE", "LIDL", "ALDI", "MONOPRIX", "FRANPRIX",
        "CASINO", "SUPER U", "HYPER U", "MAGASINS U", "PICARD", "BIOCOOP", "NATURALIA", "GRAND FRAIS",
        "NETTO", "LEADER PRICE", "G20", "SPAR", "PROXI", "BOULANGERIE", "BOUCHERIE", "PRIMEUR",
        "FROMAGERIE", "LA VIE CLAIRE", "THIRIET",
    ]),
    ("Restaurants", None, [
        "RESTAURANT", "MCDONALD", "MC DONALD", "BURGER KING", "KFC", "QUICK", "DELIVEROO", "UBER EATS",
        "JUST EAT", "STARBUCKS", "BRASSERIE", "PIZZA", "SUSHI", "CAFE", "BISTRO", "PAUL",
    ]),
    ("Transports", None, [
        "SNCF", "OUIGO", "TRAINLINE", "RATP", "NAVIGO", "IDF MOBILITES", "UBER", "BOLT", "HEETCH",
        "G7", "TAXI", "BLABLACAR", "LIME", "VELIB", "ESSO", "SHELL", "AVIA", "STATION", "CARBURANT",
        "PEAGE", "VINCI AUTOROUTES", "SANEF", "APRR", "ASF", "PARKING", "INDIGO", "AIR FRANCE",
        "TRANSAVIA", "EASYJET", "RYANAIR", "VUELING",
    ]),
    ("Abonnements", None, [
        "NETFLIX", "SPOTIFY", "DEEZER", "DISNEY", "CANAL", "AMAZON PRIME", "PRIME VIDEO", "APPLE COM BILL",
        "ICLOUD", "YOUTUBE", "FREE MOBILE", "FREE TELECOM", "FREEBOX", "ORANGE", "SOSH", "SFR",
        "RED BY SFR", "BOUYGUES", "B AND YOU", "OPENAI", "ADOBE", "MICROSOFT", "GOOGLE STORAGE",
        "AUDIBLE", "MOLOTOV",
    ]),
    ("Logement", None, [
        "LOYER", "EDF", "ENGIE", "VEOLIA", "SUEZ", "EAU DE PARIS", "SYNDIC", "FONCIA", "NEXITY",
        "ASSURANCE HABITATION", "GAZ", "ELECTRICITE", "OHM ENERGIE", "MINT ENERGIE", "EKWATEUR",
    ]),
    ("Santé", None, [
        "PHARMACIE", "PHARMA", "MEDECIN", "DOCTEUR", "DOCTOLIB", "CPAM", "AMELI", "MUTUELLE",
        "HARMONIE", "ALAN", "DENTISTE", "DENTAIRE", "OPTIQUE", "OPTICIEN", "KINE", "LABORATOIRE",
        "HOPITAL", "CLINIQUE", "OSTEO",
    ]),
    ("Loisirs", None, [
        "FNAC", "CULTURA", "DECATHLON", "CINEMA", "UGC", "PATHE", "GAUMONT", "MK2", "STEAM",
        "PLAYSTATION", "NINTENDO", "BASIC FIT", "FITNESS PARK", "NEONESS", "AIRBNB", "BOOKING",
        "TICKETMASTER", "FNAC SPECTACLES", "MUSEE", "LIBRAIRIE",
    ]),
    ("Shopping", None, [
        "AMAZON", "AMZN", "ZALANDO", "VINTED", "IKEA", "LEROY MERLIN", "CASTORAMA", "DARTY",
        "BOULANGER", "ZARA", "H M", "UNIQLO", "KIABI", "SEPHORA", "ACTION", "LA REDOUTE", "CDISCOUNT",
        "ALIEXPRESS", "SHEIN", "APPLE STORE",
    ]),
    ("Espèces", "-", ["RETRAIT", "RETRAIT DAB", "DAB"]),
    ("Frais bancaires", "-", [
        "COTISATION", "FRAIS", "COMMISSION", "AGIOS", "INTERETS DEBITEURS", "FRAIS TENUE",
        "OPTION", "OFFRE GROUPEE",
    ]),
    ("Impôts", None, [
        "DGFIP", "IMPOT", "IMPOTS", "TRESOR PUBLIC", "TAXE FONCIERE", "TAXE HABITATION", "URSSAF",
        "PRELEVEMENT A LA SOURCE",
    ]),
    ("Salaire", "+", ["SALAIRE", "PAIE", "REMUNERATION"]),
    ("Droits d'auteur", "+", [
        "SACEM", "SACD", "SCAM", "ADAGP", "SOFIA", "DROITS D AUTEUR", "DROIT D AUTEUR", "EDITIONS",
        "ROYALTIES",
    ]),
    # « REMBOURSEMENT » n'est volontairement PAS une règle : trop ambigu (sécu, ami, commerçant…).
    ("Autres revenus", "+", ["CAF", "FRANCE TRAVAIL", "POLE EMPLOI"]),
    ("Virements internes", None, ["VIR INTERNE", "VIREMENT INTERNE", "VIR CPTE A CPTE", "VIREMENT DE COMPTE A COMPTE"]),
]

# Nature fournie par la source -> catégorie
HINT_CATEGORY = {
    "investissement": "Investissement",
    "dividende": "Revenus financiers",
    "interets": "Revenus financiers",  # intérêts reçus ; un intérêt débité va en frais (voir plus bas)
    "frais": "Frais bancaires",
    "impot": "Impôts",
}

TRANSFER_WORDS = re.compile(r"\b(VIR|VIREMENT|TRANSFER|TRANSFERT|INPAYMENT|PAYOUT)\b")

# Mots génériques à ignorer pour proposer un motif à partir d'un libellé.
_NOISE_WORDS = {
    "CB", "CARTE", "PAIEMENT", "PAIEMT", "ACHAT", "PRLV", "PRELEVEMENT", "SEPA", "VIR", "VIREMENT",
    "INST", "INSTANTANE", "RECU", "EMIS", "DE", "DU", "DES", "LA", "LE", "LES", "A", "AU", "EN",
    "PAR", "POUR", "FACTURE", "FAC", "X", "EUR", "FR", "SAS", "SA", "SARL", "CARD", "TRANSACTION",
    "BUY", "TRADE", "INCOMING", "TRANSFER", "FROM", "TO", "ECH", "REF", "MANDAT",
}


@dataclass
class Rule:
    id: int
    pattern: str
    is_regex: bool
    category_id: int
    sign: str | None
    origin: str
    _compiled: re.Pattern | None = None
    _norm: str = ""

    def prepare(self) -> "Rule":
        if self.is_regex:
            self._compiled = re.compile(self.pattern, re.IGNORECASE)
        else:
            self._norm = normalize_label(self.pattern)
        return self

    def matches(self, label: str, norm_padded: str, amount_cents: int) -> bool:
        if self.sign == "+" and amount_cents < 0 or self.sign == "-" and amount_cents > 0:
            return False
        if self.is_regex:
            return bool(self._compiled and self._compiled.search(label))
        return bool(self._norm) and f" {self._norm} " in norm_padded


def validate_pattern(pattern: str, is_regex: bool) -> str:
    """Renvoie le motif nettoyé ou lève ValueError (message affichable)."""
    pattern = (pattern or "").strip()
    if not pattern or len(pattern) > 200:
        raise ValueError("Motif vide ou trop long (200 caractères maximum).")
    if is_regex:
        try:
            re.compile(pattern)
        except re.error:
            raise ValueError("Expression régulière invalide.") from None
    elif not normalize_label(pattern):
        raise ValueError("Ce mot-clé ne contient aucune lettre utilisable.")
    return pattern


def suggest_pattern(label: str) -> str:
    """Propose un mot-clé à partir d'un libellé : « PRLV SEPA FREE MOBILE » -> « FREE MOBILE ».

    Le motif est un morceau CONTINU du libellé normalisé (on retire seulement les
    mots génériques en début et en fin) : il trouve donc toujours l'opération dont
    il est issu. « CB BOULANGERIE DES AMIS » -> « BOULANGERIE DES AMIS ».
    """
    words = normalize_label(label).split()
    useful = lambda w: w not in _NOISE_WORDS and not w.isdigit()  # noqa: E731
    start = next((i for i, w in enumerate(words) if useful(w)), None)
    if start is None:
        return " ".join(words[:3])
    chunk = words[start : start + 3]
    while chunk and not useful(chunk[-1]):
        chunk.pop()
    return " ".join(chunk)


# --- Initialisation (une seule fois par coffre) ---------------------------------------------------
DEFAULTS_VERSION = 2


def seed_defaults(conn: sqlite3.Connection) -> None:
    """Installe/met à jour les catégories et règles par défaut, une étape à la fois.

    Chaque étape ne s'exécute qu'une fois par coffre : une règle par défaut que
    l'utilisateur a supprimée n'est jamais recréée.
    """
    row = conn.execute("SELECT value FROM meta WHERE key='defaults_version'").fetchone()
    version = int(row[0]) if row is not None else 0
    if version >= DEFAULTS_VERSION:
        return
    if version < 1:
        _seed_v1(conn)
    if version < 2:
        # v2 : « REMBOURSEMENT » retiré (un remboursement CPAM doit réduire la dépense Santé).
        conn.execute("DELETE FROM rules WHERE origin='default' AND pattern='REMBOURSEMENT'")
    conn.execute(
        "INSERT INTO meta(key, value) VALUES ('defaults_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(DEFAULTS_VERSION),),
    )


def _seed_v1(conn: sqlite3.Connection) -> None:
    conn.executemany("INSERT OR IGNORE INTO categories(name, kind, color) VALUES (?,?,?)", EXTRA_CATEGORIES)
    ids = {r[1]: r[0] for r in conn.execute("SELECT id, name FROM categories")}
    rows = []
    for cat, sign, words in DEFAULT_RULES:
        if cat not in ids:
            continue
        rows += [(w, 0, ids[cat], 100, 0, sign, "default") for w in words]
    conn.executemany(
        "INSERT INTO rules(pattern, is_regex, category_id, priority, created_from_correction, sign, origin) "
        "VALUES (?,?,?,?,?,?,?)",
        rows,
    )


# --- Moteur -------------------------------------------------------------------------------------
def load_rules(conn: sqlite3.Connection) -> tuple[list[Rule], list[Rule]]:
    """(règles utilisateur ordonnées, règles par défaut ordonnées). Les regex invalides sont ignorées."""
    user, defaults = [], []
    for r in conn.execute(
        "SELECT id, pattern, is_regex, category_id, sign, origin, priority FROM rules "
        "ORDER BY priority ASC, id DESC"
    ):
        try:
            rule = Rule(r["id"], r["pattern"], bool(r["is_regex"]), r["category_id"], r["sign"], r["origin"]).prepare()
        except re.error:
            continue
        (defaults if r["origin"] == "default" else user).append(rule)
    # Par défaut : le motif le plus précis (le plus long) d'abord.
    defaults.sort(key=lambda x: -len(x._norm or x.pattern))
    return user, defaults


def find_internal_pairs(rows: list[sqlite3.Row]) -> set[int]:
    """Ids des opérations formant un virement entre deux comptes de l'utilisateur."""
    candidates = [r for r in rows if r["hint"] == "virement" or TRANSFER_WORDS.search(normalize_label(r["label"]))]
    by_amount: dict[int, list] = {}
    for r in candidates:
        by_amount.setdefault(abs(r["amount_cents"]), []).append(r)
    paired: set[int] = set()
    for group in by_amount.values():
        outs = sorted((r for r in group if r["amount_cents"] < 0), key=lambda r: r["date"])
        ins = sorted((r for r in group if r["amount_cents"] > 0), key=lambda r: r["date"])
        for o in outs:
            for i in ins:
                if i["id"] in paired or i["account_id"] == o["account_id"]:
                    continue
                gap = abs((date.fromisoformat(i["date"]) - date.fromisoformat(o["date"])).days)
                if gap <= 3:
                    paired.update((o["id"], i["id"]))
                    break
    return paired


def categorize_all(conn: sqlite3.Connection) -> int:
    """(Re)classe toutes les opérations non verrouillées. Renvoie le nombre de changements."""
    user_rules, default_rules = load_rules(conn)
    cat_ids = {r["name"]: r["id"] for r in conn.execute("SELECT id, name FROM categories")}
    rows = conn.execute(
        "SELECT id, account_id, date, label, amount_cents, hint, category_id, category_source, category_locked "
        "FROM transactions"
    ).fetchall()
    pairs = find_internal_pairs(rows)

    changes = []
    for r in rows:
        if r["category_locked"]:
            continue
        label, amount = r["label"], r["amount_cents"]
        norm = f" {normalize_label(label)} "
        cat, source = None, None

        rule = next((x for x in user_rules if x.matches(label, norm, amount)), None)
        if rule:
            cat, source = rule.category_id, "regle"
        elif r["id"] in pairs and "Virements internes" in cat_ids:
            cat, source = cat_ids["Virements internes"], "virement-interne"
        elif r["hint"] in HINT_CATEGORY:
            name = HINT_CATEGORY[r["hint"]]
            if r["hint"] == "interets" and amount < 0:
                name = "Frais bancaires"
            cat, source = cat_ids.get(name), "source"
        if cat is None:
            rule = next((x for x in default_rules if x.matches(label, norm, amount)), None)
            if rule:
                cat, source = rule.category_id, "defaut"

        if (cat, source) != (r["category_id"], r["category_source"]):
            changes.append((cat, source, r["id"]))

    conn.executemany("UPDATE transactions SET category_id=?, category_source=? WHERE id=?", changes)
    return len(changes)


def preview_rule(conn: sqlite3.Connection, pattern: str, is_regex: bool, sign: str | None) -> dict:
    """Combien d'opérations un motif toucherait (sans rien modifier)."""
    rule = Rule(0, pattern, is_regex, 0, sign, "user").prepare()
    count = locked = 0
    samples: list[str] = []
    for r in conn.execute("SELECT label, amount_cents, category_locked FROM transactions ORDER BY date DESC"):
        if rule.matches(r["label"], f" {normalize_label(r['label'])} ", r["amount_cents"]):
            count += 1
            locked += r["category_locked"]
            if len(samples) < 5 and r["label"] not in samples:
                samples.append(r["label"])
    return {"count": count, "locked": locked, "samples": samples}
