// Produces the deployed CSS and JS: same code, comments and whitespace
// removed. Top-level identifiers are deliberately left alone so the classic
// scripts keep finding each other on window.
import esbuild from "esbuild";
import fs from "node:fs";

const css = fs.readFileSync("styles.css", "utf8") + "\n" + fs.readFileSync("styles.extra.css", "utf8");
const minCss = await esbuild.transform(css, { loader: "css", minify: true });
fs.writeFileSync("styles.min.css", minCss.code);

for (const name of ["film-engine", "main"]) {
  const code = fs.readFileSync(`${name}.js`, "utf8");
  const out = await esbuild.transform(code, {
    loader: "js",
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: false,
    legalComments: "none",
  });
  fs.writeFileSync(`${name}.min.js`, out.code);
}

const kb = (f) => Math.round(fs.statSync(f).size / 1024) + "KB";
console.log("styles.css", kb("styles.css"), "->", "styles.min.css", kb("styles.min.css"));
console.log("film-engine.js", kb("film-engine.js"), "->", kb("film-engine.min.js"));
console.log("main.js", kb("main.js"), "->", kb("main.min.js"));
