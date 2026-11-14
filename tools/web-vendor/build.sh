#!/bin/bash
# Reconstruit docs/vendor à partir des versions figées dans package.json.
set -euo pipefail
cd "$(dirname "$0")"
npm install --no-audit --no-fund --silent
OUT=../../docs/vendor
mkdir -p "$OUT/cmaps" "$OUT/standard_fonts"
npx esbuild firebase-entry.js --bundle --format=esm --minify --legal-comments=external \
  --target=es2020 --outfile="$OUT/firebase.js"
# Liquid Glass + React. La bibliothèque injecte ses styles dans des balises <style> : la CSP de l'app
# l'interdit (style-src 'self'). On coupe cette injection à la construction et on charge à la place
# sa feuille de styles complète, copiée dans vendor/ (balise <link> dans index.html).
node build-liquidglass.mjs "$OUT"
cp node_modules/@onlymoein/liquidglass/dist/styles.css "$OUT/liquidglass.css"
cp node_modules/@onlymoein/liquidglass/LICENSE "$OUT/liquidglass-LICENSE.txt"
cp node_modules/pdfjs-dist/build/pdf.min.mjs "$OUT/pdf.min.mjs"
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs "$OUT/pdf.worker.min.mjs"
cp node_modules/pdfjs-dist/cmaps/*.bcmap "$OUT/cmaps/"
cp node_modules/pdfjs-dist/standard_fonts/* "$OUT/standard_fonts/"
cp node_modules/pdfjs-dist/LICENSE "$OUT/pdfjs-LICENSE.txt"
echo "OK : $(du -sh "$OUT" | cut -f1)"
