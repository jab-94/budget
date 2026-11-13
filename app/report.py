"""Rapport mensuel en PDF, chiffré par mot de passe (AES-256), pour le consulter sur iPhone.

Le PDF est entièrement produit en mémoire avec reportlab, puis chiffré avec pypdf.
L'app « Fichiers » de l'iPhone demande le mot de passe à l'ouverture.
Rien n'est envoyé nulle part : le fichier est téléchargé, ou écrit (déjà chiffré)
dans le dossier du coffre, par exemple iCloud Drive/Budget/Rapports.
"""
from __future__ import annotations

import io
from datetime import date

from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas

from . import dashboard, income, insights

W, H = A4
M = 36  # marge

# Couleurs (thème clair de l'app)
INK = (0.06, 0.09, 0.16)
MUTED = (0.39, 0.45, 0.55)
FAINT = (0.58, 0.64, 0.72)
LINE = (0.90, 0.91, 0.93)
SOFT = (0.96, 0.97, 0.98)
SERIES_1 = (0.165, 0.471, 0.839)   # revenus  #2a78d6
SERIES_2 = (0.922, 0.408, 0.204)   # dépenses #eb6834
GOOD = (0.024, 0.478, 0.024)
WARN = (0.54, 0.35, 0.0)
BAD = (0.71, 0.14, 0.14)

MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
          "septembre", "octobre", "novembre", "décembre"]
MONTHS_SHORT = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"]

# Les polices standard du PDF (Helvetica) ne connaissent pas certains caractères.
_REPLACE = {" ": " ", " ": " ", "−": "-", "≈": "~", "→": "->", "–": "-", "—": "-",
            "✓": "", "✕": "", "▲": "+", "▼": "-", "…": "...", "’": "'"}


def _t(s: str) -> str:
    for a, b in _REPLACE.items():
        s = s.replace(a, b)
    return s.encode("cp1252", "replace").decode("cp1252")


def eur(cents: int, signed: bool = False) -> str:
    sign = "-" if cents < 0 else ("+" if signed and cents > 0 else "")
    e, c = divmod(abs(int(cents)), 100)
    return f"{sign}{e:,}".replace(",", " ") + f",{c:02d} €"


def month_label(m: str) -> str:
    return f"{MONTHS[int(m[5:7]) - 1]} {m[:4]}"


def _hex(color: str | None, default=FAINT):
    if not color or len(color) != 7:
        return default
    return tuple(int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))


class Page:
    """Petit utilitaire de mise en page (de haut en bas)."""

    def __init__(self, c: canvas.Canvas):
        self.c = c
        self.y = H - M

    def text(self, x, s, size=9, color=INK, bold=False, right=False):
        self.c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        self.c.setFillColorRGB(*color)
        (self.c.drawRightString if right else self.c.drawString)(x, self.y, _t(s))

    def para(self, x, s, width, size=7.5, color=MUTED, leading=10):
        """Texte qui passe à la ligne au lieu d'être coupé."""
        for line in simpleSplit(_t(s), "Helvetica", size, width):
            self.text(x, line, size, color)
            self.y -= leading
        self.y += leading

    def section(self, title):
        self.y -= 22
        self.text(M, title, 11, bold=True)
        self.y -= 6
        self.c.setStrokeColorRGB(*LINE)
        self.c.line(M, self.y, W - M, self.y)
        self.y -= 14

    def need(self, height):
        if self.y - height < M + 20:
            self.footer()
            self.c.showPage()
            self.y = H - M

    def footer(self):
        self.c.setFont("Helvetica", 7)
        self.c.setFillColorRGB(*FAINT)
        self.c.drawString(M, M - 14, _t("Généré sur votre ordinateur par Budget local — document chiffré, aucune donnée envoyée."))


def build_pdf(conn, month: str | None = None) -> tuple[bytes, str]:
    """Construit le rapport (non chiffré) ; renvoie (octets, mois)."""
    d = dashboard.dashboard(conn, month, 6)
    month = d["month"]
    ins = insights.insights(conn, month)
    inc = income.analysis(conn, month)

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(_t(f"Budget — {month_label(month)}"))
    c.setAuthor("Budget local")
    p = Page(c)

    # En-tête
    p.text(M, f"Budget — {month_label(month)}", 20, bold=True)
    p.y -= 16
    p.text(M, f"Rapport généré le {date.today().strftime('%d/%m/%Y')}"
              + (f" · opérations connues jusqu'au {ins['as_of'][8:10]}/{ins['as_of'][5:7]}" if ins.get("as_of") else ""),
           8.5, MUTED)

    # Chiffres clés
    t = d["totals"]
    tiles = [("Solde du mois", t["net_cents"]), ("Revenus", t["income_cents"]), ("Dépenses", t["expense_cents"])]
    if ins.get("remaining"):
        tiles.append(("Reste à vivre (prév.)", ins["remaining"]["remaining_cents"]))
    elif inc.get("reference") and inc["enough_history"]:
        tiles.append(("Revenu prudent", inc["reference"]["prudent_cents"]))
    p.y -= 22
    tw = (W - 2 * M - (len(tiles) - 1) * 8) / len(tiles)
    for i, (name, val) in enumerate(tiles):
        x = M + i * (tw + 8)
        c.setFillColorRGB(*SOFT)
        c.roundRect(x, p.y - 34, tw, 48, 8, stroke=0, fill=1)
        c.setFont("Helvetica", 8)
        c.setFillColorRGB(*MUTED)
        c.drawString(x + 10, p.y, _t(name))
        c.setFont("Helvetica-Bold", 15)
        c.setFillColorRGB(*(BAD if val < 0 else INK))
        c.drawString(x + 10, p.y - 22, _t(eur(val)))
    p.y -= 40
    if d["savings_rate"] is not None:
        p.y -= 8
        rate = d["savings_rate"]
        p.text(M, (f"{rate:.0f} % des revenus mis de côté" if rate >= 0 else "Dépenses supérieures aux revenus")
               + " (hors virements entre vos comptes et placements).", 8.5, GOOD if rate >= 0 else BAD)

    # Dépenses par catégorie
    p.section("Dépenses par catégorie")
    cats = d["expenses_by_category"][:10]
    mx = max([x["amount_cents"] for x in cats] or [1])
    bar_x, bar_w = M + 130, 200
    for x in cats:
        p.need(18)
        c.setFillColorRGB(*_hex(x["color"]))
        c.circle(M + 4, p.y + 3, 3, stroke=0, fill=1)
        p.text(M + 12, x["name"], 9)
        c.setFillColorRGB(*SOFT)
        c.roundRect(bar_x, p.y, bar_w, 6, 3, stroke=0, fill=1)
        c.setFillColorRGB(*SERIES_2)
        c.roundRect(bar_x, p.y, max(3, bar_w * x["amount_cents"] / mx), 6, 3, stroke=0, fill=1)
        p.text(bar_x + bar_w + 85, eur(x["amount_cents"]), 9, bold=True, right=True)
        if x["budget_status"]:
            label = {"ok": "dans le budget", "warn": f"{x['budget_pct']:.0f} % du budget",
                     "over": f"dépassé de {eur(x['amount_cents'] - x['budget_cents'])}"}[x["budget_status"]]
            p.text(W - M, label, 7.5, {"ok": GOOD, "warn": WARN, "over": BAD}[x["budget_status"]], right=True)
        p.y -= 16
    if not cats:
        p.text(M, "Aucune dépense ce mois-ci.", 9, MUTED)

    # Évolution sur 6 mois
    p.section("Revenus et dépenses — 6 derniers mois")
    p.need(120)
    series = d["series"]
    ch_h, ch_w = 90, W - 2 * M - 60
    top = max([s["income_cents"] for s in series] + [s["expense_cents"] for s in series] + [1])
    base_y = p.y - ch_h
    c.setStrokeColorRGB(*LINE)
    c.line(M + 50, base_y, M + 50 + ch_w, base_y)
    band = ch_w / len(series)
    for i, s in enumerate(series):
        x0 = M + 50 + i * band
        bw = min(14, band / 3)
        for j, (k, col) in enumerate((("income_cents", SERIES_1), ("expense_cents", SERIES_2))):
            h = ch_h * s[k] / top
            if h > 0:
                c.setFillColorRGB(*col)
                c.rect(x0 + band / 2 - bw - 1 + j * (bw + 2), base_y, bw, h, stroke=0, fill=1)
        c.setFont("Helvetica-Bold" if s["month"] == month else "Helvetica", 7.5)
        c.setFillColorRGB(*MUTED)
        c.drawCentredString(x0 + band / 2, base_y - 11, _t(MONTHS_SHORT[int(s["month"][5:7]) - 1]))
    c.setFont("Helvetica", 7.5)
    c.drawRightString(M + 44, base_y + ch_h - 4, _t(eur(top)))
    c.drawRightString(M + 44, base_y - 2, "0 €")
    p.y = base_y - 26
    c.setFillColorRGB(*SERIES_1)
    c.rect(M + 50, p.y, 8, 8, stroke=0, fill=1)
    p.text(M + 62, "Revenus", 8, MUTED)
    c.setFillColorRGB(*SERIES_2)
    c.rect(M + 120, p.y, 8, 8, stroke=0, fill=1)
    p.text(M + 132, "Dépenses", 8, MUTED)

    # Salaire variable
    if inc.get("reference") and inc["enough_history"]:
        ref = inc["reference"]
        p.section("Salaire variable")
        p.need(30)
        p.text(M, f"Moyenne 3 mois : {eur(ref['avg3_cents'])}   ·   moyenne {inc['history_months']} mois : "
                  f"{eur(ref['avg6_cents'])}   ·   référence prudente : {eur(ref['prudent_cents'])}", 9)
        p.y -= 13
        p.text(M, "Référence prudente = le plus petit de (moyenne - 20 %) et du montant dépassé ~3 mois sur 4.", 7.5, MUTED)

    # À venir
    # « À venir » n'a de sens que pour le mois en cours (dernier mois connu).
    if ins.get("upcoming") and ins.get("as_of", "")[:7] == month:
        p.section("Prélèvements à venir (31 jours)")
        for u in ins["upcoming"][:8]:
            p.need(14)
            p.text(M, f"{u['next_date'][8:10]}/{u['next_date'][5:7]}", 9, MUTED)
            p.text(M + 40, u["key"].title(), 9)
            p.text(W - M, ("~ " if u["variable"] else "") + eur(-u["amount_cents"] if u["is_expense"] else u["amount_cents"]),
                   9, bold=True, right=True)
            p.y -= 14

    # Suggestions
    if ins.get("suggestions"):
        p.section("Suggestions d'économies")
        for s in ins["suggestions"][:6]:
            p.need(40)
            tag = {"bad": "IMPORTANT", "warn": "À SURVEILLER", "info": "INFO"}[s["severity"]]
            p.text(M, tag, 7, {"bad": BAD, "warn": WARN, "info": SERIES_1}[s["severity"]], bold=True)
            p.text(M + 70, s["title"][:80], 9, bold=True)
            if s.get("yearly_saving_cents"):
                p.text(W - M, f"~ {eur(s['yearly_saving_cents'])}/an", 8, GOOD, right=True)
            p.y -= 12
            p.para(M + 70, s["detail"], W - 2 * M - 70)
            p.y -= 14

    p.footer()
    c.save()
    return buf.getvalue(), month


def encrypt_pdf(pdf: bytes, password: str) -> bytes:
    reader = PdfReader(io.BytesIO(pdf))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.add_metadata({"/Title": "Budget", "/Producer": "Budget local"})
    writer.encrypt(user_password=password, owner_password=None, algorithm="AES-256")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
