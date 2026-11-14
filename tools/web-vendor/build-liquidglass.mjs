// Construit vendor/liquidglass.js (React + @onlymoein/liquidglass) avec esbuild.
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const out = process.argv[2];
const noInlineStyles = {
  name: "liquidglass-no-inline-styles",
  setup(b) {
    b.onLoad({ filter: /@onlymoein[\\/]liquidglass[\\/]dist[\\/]index\.js$/ }, async (args) => {
      const src = await readFile(args.path, "utf8");
      const marker = 'function insert([name, css]) {';
      if (!src.includes(marker)) throw new Error("liquidglass : fonction d'injection de styles introuvable (version changée ?)");
      // Les styles viennent de vendor/liquidglass.css : on n'en injecte aucun.
      return { contents: src.replace(marker, `${marker}\n\treturn;`), loader: "js" };
    });
  },
};
await build({
  entryPoints: ["liquidglass-entry.js"], bundle: true, format: "esm", minify: true, target: "es2020",
  legalComments: "external", outfile: `${out}/liquidglass.js`, define: { "process.env.NODE_ENV": '"production"' },
  plugins: [noInlineStyles], logLevel: "warning",
});
