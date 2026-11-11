"""Génère les faux relevés PDF utilisés par les tests (données 100 % inventées).

Reproduit la STRUCTURE d'un relevé LCL observée sur un extrait masqué, pas son
contenu. À relancer seulement si on modifie le faux relevé :
    python tests/fixtures/make_fixtures.py      (nécessite reportlab)
"""
from pathlib import Path

from reportlab.pdfgen import canvas

OUT = Path(__file__).with_name("faux_releve_lcl.pdf")
X_DATE, X_LABEL, X_VAL, X_DEB, X_CRE = 40, 72, 330, 430, 510


def header(c, y):
    c.drawString(160, y, "RELEVE DE COMPTE"); y -= 14
    c.drawString(300, y, "du 01.03.2026 au 31.03.2026 - N° 123"); y -= 14
    return y


def row(c, y, d="", label="", val="", deb="", cre="", dot=False):
    if d: c.drawString(X_DATE, y, d)
    if label: c.drawString(X_LABEL, y, label)
    if val: c.drawString(X_VAL, y, val)
    if deb: c.drawRightString(X_DEB, y, deb)
    if cre: c.drawRightString(X_CRE, y, cre)
    if dot: c.drawString(X_CRE - 4, y, ".")
    return y - 13


def detail(c, y, text):
    c.drawString(X_LABEL + 10, y, text)
    return y - 13


def cols(c, y):
    c.drawString(X_DATE, y, "DATE"); c.drawString(150, y, "LIBELLE"); c.drawString(X_VAL, y, "VALEUR")
    c.drawRightString(X_DEB, y, "DEBIT"); c.drawRightString(X_CRE, y, "CREDIT")
    return y - 15


def footer(c, page, total):
    c.drawString(450, 60, f"Page {page} / {total}")
    c.setFont("Helvetica", 6)
    c.drawString(40, 45, "Crédit Lyonnais-SA au capital de 1 000 000 000 euros - SIREN 000 000 000 - RCS Lyon")
    c.setFont("Helvetica", 8)


def main():
    c = canvas.Canvas(str(OUT))
    c.setFont("Helvetica", 8)
    y = header(c, 800)
    for t in ("M JEAN DUPONT", "1 RUE DES EXEMPLES", "75000 PARIS", "IBAN : FR00 0000 0000 0000 0000 0000 X00"):
        c.drawString(50, y, t); y -= 13
    c.drawString(50, y, "ECRITURES DE LA PERIODE"); y -= 14
    y = cols(c, y)
    y = row(c, y, "01.03", "ANCIEN SOLDE", cre="1 234,56")
    y = row(c, y, "02.03", "INTERETS DEBITEURS AU 28 02 26", "02.03.26", deb="1,23", dot=True)
    y = detail(c, y, "TAUX 1,23€ AU 16,00%")
    y = row(c, y, "03.03", "VIR INST MARIE DURAND", "03.03.26", cre="50,00")
    y = detail(c, y, "REF.CLIENT:AB12CD34EF56GH78")
    y = detail(c, y, "NATURE DU VIREMENT:VIR1")
    # Libellé très long qui « déborde » jusqu'à la date de valeur, sans point.
    y = row(c, y, "05.03", "PRLV SEPA COMPAGNIE ASSURANCE DES PARTICULIERS DE FR", "05.03.26", deb="123,45")
    y = detail(c, y, "ID.CREANCIER:FR12ZZZ123456")
    y = detail(c, y, "LIBELLE:CONTRAT HABITATION")
    y = detail(c, y, "REF.MANDAT: 2026XYZ000123456789")
    footer(c, 1, 2)
    c.showPage(); c.setFont("Helvetica", 8)

    y = header(c, 800)
    c.drawString(50, y, "M JEAN DUPONT"); y -= 13
    c.drawString(50, y, "ECRITURES DE LA PERIODE"); y -= 14
    y = cols(c, y)
    y = row(c, y, "10.03", "VIREMENT SACEM", "10.03.26", cre="2 150,00")
    y = detail(c, y, "DE: SOC DES AUTEURS")
    y = row(c, y, "12.03", "VIR INST LOYER APPARTEMENT", "12.03.26", deb="850,00", dot=True)
    y = detail(c, y, "REF.CLIENT:LOYER")
    y = row(c, y, label="", deb="974,68", cre="2 200,00"); c.drawString(250, y + 13, "TOTAUX")
    y = row(c, y, "31.03", "SOLDE EN EUROS", cre="2 459,88")
    y -= 10
    c.drawString(50, y, "Total des frais au titre de la période du 01/03/2026 au 31/03/2026 : 2,00 € à prélever le 05/04/2026"); y -= 14
    c.drawString(50, y, "Récapitulatif des frais perçus du 01/01/2026 au 31/03/2026"); c.drawRightString(X_DEB, y, "DEBIT"); c.drawRightString(X_CRE, y, "CREDIT"); y -= 13
    c.drawString(50, y, "COMMISSION DE COMPTE ACTIVE"); c.drawRightString(X_DEB, y, "12,00"); c.drawRightString(X_CRE, y, "12,00"); y -= 13
    c.drawString(50, y, "(montant inclus dans votre solde)")
    footer(c, 2, 2)
    c.save()
    print("écrit :", OUT)


if __name__ == "__main__":
    main()


# --- Boursobank ---------------------------------------------------------------------------
OUT_BOURSO = Path(__file__).with_name("faux_releve_boursobank.pdf")
BX_DATE, BX_LABEL, BX_VAL, BX_DEB, BX_CRE = 40, 95, 300, 400, 480


def bourso_header(c, page, total):
    y = 800
    c.drawString(BX_DATE, y, "Date      N° compte      Devise      Période      Page"); y -= 12
    # Ligne d'infos qui commence par une date et contient un montant : PAS une opération.
    c.drawString(BX_DATE, y, f"01/04/2026 40618 80000 00012345678 90 EUR du 01/03/2026 au 31/03/2026 0,00 0,000000% {page}/{total}")
    y -= 12
    c.drawString(BX_DATE, y, "BoursoBank - SA au capital de 1 000 000,00 euros - www.boursobank.com"); y -= 30
    c.drawString(250, y, "MOUVEMENTS      EN  EUR"); y -= 14
    c.drawString(BX_DATE, y, "Date"); y -= 10
    c.drawString(BX_LABEL - 20, y, "Libellé"); c.drawString(BX_VAL, y, "Valeur")
    c.drawRightString(BX_DEB, y, "Débit"); c.drawRightString(BX_CRE, y, "Crédit"); y -= 10
    c.drawString(BX_DATE, y, "opération"); y -= 14
    return y


def brow(c, y, d, label, deb="", cre=""):
    c.drawString(BX_DATE, y, d); c.drawString(BX_LABEL, y, label); c.drawString(BX_VAL, y, d)
    if deb: c.drawRightString(BX_DEB, y, deb)
    if cre: c.drawRightString(BX_CRE, y, cre)
    return y - 12


def bdetail(c, y, text):
    c.drawString(BX_LABEL + 5, y, text)
    return y - 12


def bourso_legal(c):
    c.setFont("Helvetica", 6)
    c.drawString(60, 90, "Les opérations de votre compte sont soumises aux conditions générales en vigueur, disponibles sur demande auprès de nos services.")
    c.drawString(60, 82, "*Montant des frais et commissions perçus au cours de la période, détaillés dans le récapitulatif annuel des frais bancaires.")
    c.setFont("Helvetica", 8)


def make_bourso():
    c = canvas.Canvas(str(OUT_BOURSO))
    c.setFont("Helvetica", 8)
    y = bourso_header(c, 1, 2)
    c.drawString(250, y, "Solde au : 28/02/2026"); c.drawRightString(BX_CRE, y, "1.234,56"); y -= 14
    y = brow(c, y, "02/03/2026", "PRLV SEPA FREE MOBILE", deb="19,99")
    y = bdetail(c, y, "FREE MOBILE SAS")
    y = bdetail(c, y, "REF:ABC1234567890123456789")
    y = brow(c, y, "05/03/2026", "CARTE 03/03/26 BOULANGERIE CB*1234", deb="4,50")
    y = brow(c, y, "10/03/2026", "VIR SACEM", cre="2.150,00")
    y = bdetail(c, y, "SACEM DROITS")
    bourso_legal(c)
    c.showPage(); c.setFont("Helvetica", 8)

    y = bourso_header(c, 2, 2)
    y = brow(c, y, "12/03/2026", "VIR INST LOYER", deb="850,00")
    y = bdetail(c, y, "PROPRIETAIRE EXEMPLE")
    y = brow(c, y, "15/03/2026", "PRLV SEPA ASSURANCE-HABITATION", deb="123,45")
    y = bdetail(c, y, "COMPAGNIE EXEMPLE ASSURANCES")
    y = bdetail(c, y, "99-12345678-9ABC1DEF")
    y = bdetail(c, y, "RUM-12345678-123456789")
    y = bdetail(c, y, "ICS FR12ZZZ1234567890")
    y -= 6
    c.drawString(120, y, "Nouveau solde en EUR :"); c.drawRightString(BX_CRE, y, "2.386,62"); y -= 12
    c.drawRightString(BX_DEB, y, "0,00"); c.drawRightString(BX_CRE + 10, y, "0,00"); y -= 12
    c.drawString(120, y, "Frais bancaires et cotisations*:")
    bourso_legal(c)
    c.save()
    print("écrit :", OUT_BOURSO)


if __name__ == "__main__":
    make_bourso()
