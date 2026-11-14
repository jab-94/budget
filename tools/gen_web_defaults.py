"""Régénère docs/js/defaults.js à partir de la version Python (source unique des valeurs par défaut).

Usage : .venv/bin/python tools/gen_web_defaults.py
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import categorize, db  # noqa: E402


def render() -> str:
    cats = [{"name": n, "kind": k, "color": c}
            for n, k, c in db.DEFAULT_CATEGORIES + categorize.EXTRA_CATEGORIES + categorize.CATEGORIES_V4]
    rules = [{"category": c, "sign": s, "patterns": w} for c, s, w in categorize.DEFAULT_RULES]
    dump = lambda v: json.dumps(v, ensure_ascii=False)  # noqa: E731
    return (
        "// Généré à partir de la version Python (app/db.py, app/categorize.py) : ne pas modifier à la main.\n"
        "// Régénérer avec : .venv/bin/python tools/gen_web_defaults.py\n"
        f"export const DEFAULT_CATEGORIES = {json.dumps(cats, ensure_ascii=False, indent=1)};\n"
        f"export const DEFAULT_RULES = {dump(rules)};\n"
        f"export const CATEGORIES_V4 = {dump([c[0] for c in categorize.CATEGORIES_V4])};\n"
        f"export const HINT_CATEGORY = {dump(categorize.HINT_CATEGORY)};\n"
        f"export const NOISE_WORDS = new Set({dump(sorted(categorize._NOISE_WORDS))});\n"
    )


if __name__ == "__main__":
    (ROOT / "docs/js/defaults.js").write_text(render(), encoding="utf-8")
