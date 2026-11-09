"""Tests des importeurs (montants, dates, CSV, PDF générique). Données 100 % fictives."""
from __future__ import annotations

import pytest

from app.importers.banks import BoursobankParser, LclParser, TradeRepublicParser
from app.importers.base import normalize_label, parse_amount, parse_date
from app.importers.csv_import import parse_csv
from app.importers.pdf_generic import GenericPdfParser


@pytest.mark.parametrize("text,cents", [
    ("12,50", 1250), ("-12,50", -1250), ("1 234,56", 123456), ("1 234,56 €", 123456),
    ("1.234,56", 123456), ("1,234.56", 123456), ("-45.9", -4590), ("100", 10000),
    ("12,50-", -1250), ("+3,00", 300), ("(7,25)", -725), ("-1 000,00", -100000),
])
def test_parse_amount(text, cents):
    assert parse_amount(text) == cents


@pytest.mark.parametrize("bad", ["", "abc", "12,5,6", "--3"])
def test_parse_amount_rejects(bad):
    with pytest.raises(ValueError):
        parse_amount(bad)


def test_parse_date():
    assert parse_date("2026-03-05") == "2026-03-05"
    assert parse_date("05/03/2026") == "2026-03-05"
    assert parse_date("05.03.26") == "2026-03-05"
    assert parse_date("05/03", default_year=2025) == "2025-03-05"
    with pytest.raises(ValueError):
        parse_date("31/02/2026")


def test_normalize_label():
    assert normalize_label("CB Carrefour 02/03") == normalize_label("CB CARREFOUR 15/04") == "CB CARREFOUR"
    assert normalize_label("Prélèvement Électricité") == "PRELEVEMENT ELECTRICITE"
    assert "4970" not in normalize_label("CB 4970XXXXXX1234 AMAZON")


# --- CSV ---------------------------------------------------------------------------------
BOURSO_CSV = (
    "dateOp;dateVal;label;category;categoryParent;supplierFound;amount;comment;accountNum;accountLabel;accountbalance\n"
    '2026-03-03;2026-03-03;"CB CARREFOUR 02/03";"Alimentation";"Vie quotidienne";"carrefour";-45,90;;"00000";"Compte";1500,00\n'
    '2026-03-05;2026-03-05;"PRLV SEPA FREE MOBILE";"Telephone";"Abonnements";"free";-19,99;;"00000";"Compte";1500,00\n'
    '2026-03-10;2026-03-10;"VIR SACEM";"Revenus";"Revenus";"";"2 150,00";;"00000";"Compte";1500,00\n'
).encode("utf-8")


def test_csv_boursobank_preset():
    st, info = parse_csv(BOURSO_CSV)
    assert info["preset"] == "boursobank"
    assert [t.amount_cents for t in st.transactions] == [-4590, -1999, 215000]
    assert st.transactions[0].date == "2026-03-03"
    assert st.transactions[2].label == "VIR SACEM"
    assert (st.period_start, st.period_end) == ("2026-03-03", "2026-03-10")


def test_csv_generic_debit_credit_cp1252():
    raw = ("Date;Libellé;Débit;Crédit\n"
           "03/03/2026;Boulangerie;4,50;\n"
           "04/03/2026;Remboursement santé;;23,00\n"
           "pas une date;x;1;\n").encode("cp1252")
    st, info = parse_csv(raw)
    assert info["preset"] is None
    assert info["mapping"] == {"date": "Date", "label": "Libellé", "debit": "Débit", "credit": "Crédit"}
    assert [t.amount_cents for t in st.transactions] == [-450, 2300]
    assert st.warnings  # la ligne illisible est signalée


def test_csv_needs_mapping_when_unknown_columns():
    raw = b"col1,col2,col3\n2026-01-01,abc,12.00\n"
    st, info = parse_csv(raw)
    assert info["needs_mapping"] and not st.transactions
    st, info = parse_csv(raw, {"date": "col1", "label": "col2", "amount": "col3"})
    assert st.transactions[0].amount_cents == 1200


# --- PDF générique (sur du texte « mis en page » comme celui de pdfplumber) -----------------
PAGE = """
                 RELEVE DE COMPTE du 01/03/2026 au 31/03/2026
 Date    Valeur  Libellé                                   Débit          Crédit
                 SOLDE PRECEDENT AU 01/03/2026                            1 234,56
 03/03   03/03   CB CARREFOUR MARKET                       45,90
                 PARIS 11
 05/03   05/03   PRLV SEPA FREE MOBILE                     19,99
 10/03   10/03   VIR SACEM DROITS                                         2 150,00
                 TOTAL DES OPERATIONS                      65,89          2 150,00
                 NOUVEAU SOLDE AU 31/03/2026                              3 318,67
"""


def test_generic_pdf_columns_balances_and_multiline():
    st = GenericPdfParser().parse_pages([PAGE])
    assert [(t.date, t.amount_cents) for t in st.transactions] == [
        ("2026-03-03", -4590), ("2026-03-05", -1999), ("2026-03-10", 215000)]
    assert st.transactions[0].label == "CB CARREFOUR MARKET PARIS 11"
    assert st.opening_balance_cents == 123456
    assert st.closing_balance_cents == 331867
    assert st.opening_balance_cents + sum(t.amount_cents for t in st.transactions) == st.closing_balance_cents
    assert (st.period_start, st.period_end) == ("2026-03-01", "2026-03-31")
    assert not any(t.uncertain_sign for t in st.transactions)


def test_generic_pdf_without_columns_guesses_sign():
    page = """
 03/03/2026  CB BOULANGERIE      4,50
 04/03/2026  VIR RECU EMPLOYEUR  1 800,00
"""
    st = GenericPdfParser().parse_pages([page])
    assert [t.amount_cents for t in st.transactions] == [-450, 180000]
    assert all(t.uncertain_sign for t in st.transactions)
    assert st.warnings


def test_generic_pdf_year_rollover():
    page = """
 RELEVE du 15/12/2025 au 14/01/2026
 Date   Libellé          Débit      Crédit
 20/12  CB CADEAU        30,00
 05/01  CB GALETTE       12,00
"""
    st = GenericPdfParser().parse_pages([page])
    assert [t.date for t in st.transactions] == ["2025-12-20", "2026-01-05"]


def test_bank_detection():
    assert LclParser.detect("Crédit Lyonnais - LCL - relevé")
    assert BoursobankParser.detect("BoursoBank SA ...")
    assert TradeRepublicParser.detect("Trade Republic Bank GmbH")
    assert not LclParser.detect("BoursoBank")
