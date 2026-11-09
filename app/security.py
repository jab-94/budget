"""En-têtes de sécurité et contrôles d'accès du serveur local.

1. Content-Security-Policy stricte : le navigateur refuse de charger ou d'envoyer
   quoi que ce soit ailleurs qu'à l'app elle-même (pas de CDN, pas de police
   externe, pas de requête vers Internet, même si du code tentait de le faire).
2. Contrôle de l'en-tête Host : bloque le « DNS rebinding » (un site web qui
   essaierait de parler à l'app locale en se faisant passer pour elle).
3. Jeton de session : chaque appel /api doit porter un jeton secret, généré au
   lancement et injecté dans la page. Un autre site ouvert dans le navigateur
   ne peut pas le lire, donc ne peut pas piloter l'app.
"""
from __future__ import annotations

import secrets

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse

from .config import ALLOWED_HOST_NAMES

CSP = "; ".join(
    [
        "default-src 'self'",
        "connect-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "object-src 'none'",
        "frame-src 'none'",
        "worker-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
    ]
)

SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cache-Control": "no-store",
}

SESSION_TOKEN = secrets.token_urlsafe(32)
TOKEN_HEADER = "X-Budget-Token"


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        host = (request.headers.get("host") or "").rsplit(":", 1)[0].strip("[]")
        if host not in ALLOWED_HOST_NAMES and host != "testserver":
            return PlainTextResponse("Hôte refusé.", status_code=403)

        if request.url.path.startswith("/api/"):
            if not secrets.compare_digest(request.headers.get(TOKEN_HEADER, ""), SESSION_TOKEN):
                return JSONResponse({"detail": "Jeton de session invalide."}, status_code=403)

        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers[k] = v
        return response
