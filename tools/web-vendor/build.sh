#!/bin/bash
# Reconstruit docs/vendor à partir des versions figées dans package.json.
set -euo pipefail
cd "$(dirname "$0")"
npm install --no-audit --no-fund --silent
OUT=../../docs/vendor
mkdir -p "$OUT/cmaps" "$OUT/standard_fonts"
npx esbuild firebase-entry.js --bundle --format=esm --minify --legal-comments=external \
  --target=es2020 --outfile="$OUT/firebase.js"
cp node_modules/pdfjs-dist/build/pdf.min.mjs "$OUT/pdf.min.mjs"
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs "$OUT/pdf.worker.min.mjs"
cp node_modules/pdfjs-dist/cmaps/*.bcmap "$OUT/cmaps/"
cp node_modules/pdfjs-dist/standard_fonts/* "$OUT/standard_fonts/"
cp node_modules/pdfjs-dist/LICENSE "$OUT/pdfjs-LICENSE.txt"
echo "OK : $(du -sh "$OUT" | cut -f1)"
