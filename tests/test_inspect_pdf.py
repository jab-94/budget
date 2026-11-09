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
