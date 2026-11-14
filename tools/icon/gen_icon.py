# Génère l'icône « verre » de l'app : python3 tools/icon/gen_icon.py dark > icone.html, puis capture 1024x1024.
import sys
mode = sys.argv[1]
dark = mode == "dark"
# Dalle agrandie (x=200..824)
X, W, R = 200, 624, 168
bg = ('<stop offset="0" stop-color="#16181f"/><stop offset=".6" stop-color="#08090c"/><stop offset="1" stop-color="#000"/>' if dark else
      '<stop offset="0" stop-color="#fbfbfd"/><stop offset=".7" stop-color="#eceef2"/><stop offset="1" stop-color="#dfe2e8"/>')
glyph_fill = "url(#glyph)" if dark else "#0b0d12"
glyph_stops = '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dde5f3"/>'
glass_op = (".10", ".03", ".08") if dark else (".55", ".25", ".45")
rim_col = "#fff" if dark else "#ffffff"
shadow = "" if dark else f'<rect x="{X}" y="{X+18}" width="{W}" height="{W}" rx="{R}" fill="#8a93a6" opacity=".35" filter="url(#b30)"/>'
def ring(color, width, blur, dx, dy, op=1):
    return (f'<rect x="{X+10}" y="{X+10}" width="{W-20}" height="{W-20}" rx="{R-8}" fill="none" stroke="{color}" '
            f'stroke-width="{width}" stroke-opacity="{op}" filter="url(#{blur})" transform="translate({dx} {dy})"/>')
trR = ring("#ff5a1f", 10, "b6", 7, -7) + ring("#ff2f4a", 16, "b14", 10, -9, .7)
tr = ring("#ff2f8f", 22, "b14", 2, 2, .8) + ring("#2b5bff", 34, "b14", -16, 12) + ring("#ffffff", 22, "b6", 0, 0, .95 if dark else .9)
blR = ring("#ff5a1f", 10, "b6", -7, 7) + ring("#ff2f4a", 16, "b14", -10, 9, .7)
bl = ring("#ff2f8f", 20, "b14", -2, 0, .7) + ring("#1fc8ff", 32, "b14", 16, -12) + ring("#ffffff", 18, "b6", 0, 0, .9 if dark else .85)
print(f'''<!doctype html><html><head><meta charset="utf-8"><style>html,body{{margin:0}}svg{{display:block}}</style></head><body>
<svg id="ic" width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
<defs>
<radialGradient id="bg" cx="50%" cy="42%" r="78%">{bg}</radialGradient>
<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="{glass_op[0]}"/><stop offset=".5" stop-color="#fff" stop-opacity="{glass_op[1]}"/><stop offset="1" stop-color="#fff" stop-opacity="{glass_op[2]}"/></linearGradient>
<linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{rim_col}" stop-opacity=".6"/><stop offset=".35" stop-color="{rim_col}" stop-opacity=".14"/><stop offset=".7" stop-color="{rim_col}" stop-opacity=".12"/><stop offset="1" stop-color="{rim_col}" stop-opacity=".5"/></linearGradient>
<linearGradient id="glyph" x1="0" y1="0" x2="0" y2="1">{glyph_stops}</linearGradient>
<filter id="b6" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="b14" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="b30" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="30"/></filter>
<clipPath id="sq"><rect x="{X}" y="{X}" width="{W}" height="{W}" rx="{R}"/></clipPath>
<mask id="mTR"><rect width="1024" height="1024" fill="#000"/><circle cx="830" cy="200" r="330" fill="#fff" filter="url(#b30)"/></mask>
<mask id="mBL"><rect width="1024" height="1024" fill="#000"/><circle cx="195" cy="830" r="310" fill="#fff" filter="url(#b30)"/></mask>
</defs>
<rect width="1024" height="1024" fill="url(#bg)"/>
{shadow}
<rect x="{X-22}" y="{X-22}" width="{W+44}" height="{W+44}" rx="{R+20}" fill="none" stroke="{'#fff' if dark else '#9aa3b5'}" stroke-opacity=".08" stroke-width="10" filter="url(#b14)"/>
<rect x="{X}" y="{X}" width="{W}" height="{W}" rx="{R}" fill="url(#glass)"/>
<g opacity="{'.85' if dark else '.6'}"><g mask="url(#mTR)">{trR}</g><g mask="url(#mBL)">{blR}</g></g>
<g clip-path="url(#sq)"><g mask="url(#mTR)">{tr}</g><g mask="url(#mBL)">{bl}</g></g>
<rect x="{X}" y="{X}" width="{W}" height="{W}" rx="{R}" fill="none" stroke="url(#rim)" stroke-width="5"/>
<rect x="{X+15}" y="{X+15}" width="{W-30}" height="{W-30}" rx="{R-14}" fill="none" stroke="{'#fff' if dark else '#ffffff'}" stroke-opacity="{'.10' if dark else '.7'}" stroke-width="2"/>
<g font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-weight="800" font-size="440" text-anchor="middle">
<text x="503" y="672" fill="#ff3d2e" opacity="{'.55' if dark else '.35'}" filter="url(#b14)">€</text>
<text x="523" y="664" fill="#2b7bff" opacity="{'.6' if dark else '.4'}" filter="url(#b14)">€</text>
<text x="512" y="668" fill="{glyph_fill}">€</text>
</g>
<path d="M290 216 Q512 192 734 216" stroke="#fff" stroke-opacity="{'.35' if dark else '.9'}" stroke-width="4" fill="none" filter="url(#b6)"/>
</svg></body></html>''')
