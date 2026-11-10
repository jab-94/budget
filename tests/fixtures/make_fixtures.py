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
