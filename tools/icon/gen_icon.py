# Génère l'icône « verre » de l'app (dalle pleine page : l'iPhone découpe lui-même les coins arrondis).
# Usage : python3 tools/icon/gen_icon.py dark > icone.html   (ou light), puis capture 1024x1024 de #ic.
import sys

dark = (sys.argv[1] if len(sys.argv) > 1 else "dark") == "dark"
R = 230  # rayon proche de la découpe iOS (~22,4 %)


def ring(color, inset, width, blur, op=1.0):
    x = inset
    w = 1024 - 2 * inset
    return (f'<rect x="{x}" y="{x}" width="{w}" height="{w}" rx="{max(R - inset, 40)}" fill="none" stroke="{color}" '
            f'stroke-width="{width}" stroke-opacity="{op}" filter="url(#{blur})"/>')


# Du bord vers l'intérieur : rouge-orangé, blanc, bleu (aberration chromatique du verre).
corner_tr = (ring("#ff5a1f", 10, 16, "b6", .9) + ring("#ff2f4a", 16, 22, "b14", .6) + ring("#ffffff", 30, 26, "b6", .95)
             + ring("#2b5bff", 54, 38, "b14", .95))
corner_bl = (ring("#ff5a1f", 10, 14, "b6", .85) + ring("#ff2f4a", 16, 20, "b14", .55) + ring("#ffffff", 30, 22, "b6", .9)
             + ring("#1fc8ff", 52, 36, "b14", .95))
bg = ('<stop offset="0" stop-color="#1b1e26"/><stop offset=".65" stop-color="#0b0c10"/><stop offset="1" stop-color="#050608"/>'
      if dark else '<stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#eef0f4"/><stop offset="1" stop-color="#e2e5eb"/>')
glyph = "url(#glyph)" if dark else "#0b0d12"
print(f'''<!doctype html><html><head><meta charset="utf-8"><style>html,body{{margin:0;background:#000}}svg{{display:block}}</style></head><body>
<svg id="ic" width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
<defs>
<radialGradient id="bg" cx="45%" cy="40%" r="80%">{bg}</radialGradient>
<linearGradient id="glyph" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#dde5f3"/></linearGradient>
<linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".35" stop-color="#fff" stop-opacity=".12"/><stop offset=".7" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#fff" stop-opacity=".45"/></linearGradient>
<filter id="b6" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="7"/></filter>
<filter id="b14" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="16"/></filter>
<filter id="b40" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="45"/></filter>
<mask id="mTR"><rect width="1024" height="1024" fill="#000"/><circle cx="1010" cy="10" r="470" fill="#fff" filter="url(#b40)"/></mask>
<mask id="mBL"><rect width="1024" height="1024" fill="#000"/><circle cx="10" cy="1010" r="450" fill="#fff" filter="url(#b40)"/></mask>
</defs>
<rect width="1024" height="1024" fill="url(#bg)"/>
<g mask="url(#mTR)">{corner_tr}</g>
<g mask="url(#mBL)">{corner_bl}</g>
<rect x="6" y="6" width="1012" height="1012" rx="{R - 6}" fill="none" stroke="url(#rim)" stroke-width="6"/>
<rect x="26" y="26" width="972" height="972" rx="{R - 24}" fill="none" stroke="#fff" stroke-opacity="{'.08' if dark else '.6'}" stroke-width="3"/>
<g font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-weight="800" font-size="640" text-anchor="middle">
<text x="498" y="740" fill="#ff3d2e" opacity="{'.5' if dark else '.3'}" filter="url(#b14)">€</text>
<text x="526" y="730" fill="#2b7bff" opacity="{'.6' if dark else '.4'}" filter="url(#b14)">€</text>
<text x="512" y="735" fill="{glyph}">€</text>
</g>
<path d="M200 40 Q512 10 824 40" stroke="#fff" stroke-opacity="{'.3' if dark else '.9'}" stroke-width="5" fill="none" filter="url(#b6)"/>
</svg></body></html>''')
