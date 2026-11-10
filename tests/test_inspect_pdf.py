"""Le script de masquage ne doit laisser passer aucune donnée personnelle."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from inspect_pdf import mask_line  # noqa: E402


def test_mask_hides_personal_data():
    line = "M. Jean MARTIN 12 rue des Lilas IBAN FR76 3000 6000 0112 CB CARREFOUR 45,90 SOLDE 1 234,56"
    out = mask_line(line)
    for secret in ("Jean", "MARTIN", "Lilas", "FR76", "3000", "CARREFOUR", "45,90", "1 234,56", "12"):
        assert secret not in out
    assert "SOLDE" in out and "CB" in out and "99,99" in out


def test_mask_csv_keeps_only_generic_types(tmp_path, capsys):
    from inspect_pdf import inspect_csv

    f = tmp_path / "export.csv"
    f.write_text("date,type,description,amount,account holder\n"
                 "2026-03-05,CARD_TRANSACTION,Carrefour Paris,-45.90,Camille D\n"
                 "2026-03-07,TRANSFER_INCOMING,Jean Martin,500.00,MARTIN\n", encoding="utf-8")
    inspect_csv(str(f))
    out = capsys.readouterr().out
    for secret in ("Carrefour", "Jean", "Martin", "MARTIN", "45.90", "500", "holder"):
        assert secret not in out
    assert "CARD_TRANSACTION" in out and "TRANSFER_INCOMING" in out and "amount" in out
