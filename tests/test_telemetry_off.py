"""Aucune télémétrie : FastAPI embarque OpenTelemetry, il doit être coupé et ne rien pouvoir envoyer."""
from __future__ import annotations

import importlib.util
import os


def test_fastapi_telemetry_explicitly_disabled():
    from app import main

    cfg = main.app._telemetry
    for key in ("tracing", "metrics", "logs", "operation_spans", "auto_configure"):
        assert cfg[key] is False, key
    assert not main.app._native_telemetry.enabled()
    assert os.environ.get("OTEL_SDK_DISABLED") == "true"
    assert "FASTAPI_OTEL_AUTO_CONFIGURE" not in os.environ


def test_no_telemetry_sender_installed():
    """Le SDK et les « exporters » OpenTelemetry (ceux qui envoient) ne doivent pas être installés."""
    for mod in ("opentelemetry.sdk", "opentelemetry.exporter", "sentry_sdk", "posthog", "segment", "mixpanel"):
        try:
            found = importlib.util.find_spec(mod) is not None
        except ModuleNotFoundError:
            found = False
        assert not found, f"paquet de télémétrie installé : {mod}"


def test_reportlab_cannot_fetch_urls():
    from reportlab import rl_config

    import app.report  # noqa: F401  (applique le verrouillage)

    assert not rl_config.trustedHosts and rl_config.trustedSchemes == ["file"]
