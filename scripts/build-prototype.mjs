// Construit la version autonome du prototype (apps/web/public/prototype → dist/) :
//  - inline les bundles IIFE des moteurs quand ils existent (packages/measurement/dist/wsmeasure.iife.js → globale WSMeasure,
//    packages/quote-engine/dist/wsquote.iife.js → globale WSQuote), sinon inline la doublure vendor/stubs.js (qui ne définit
//    que les globales absentes : un seul moteur réel + la doublure pour l'autre fonctionne) ;
//  - la page source index.html (non construite) charge vendor/ws*.iife.js (fichiers de garde vides) puis vendor/stubs.js :
//    elle tourne donc toujours sur les doublures ; seule dist/index.html embarque les moteurs réels ;
//  - inline patterns.js ; copie embed.js, manifest, icônes, la mire (PDF + HTML) ; génère apps/mobile-test/src/prototype-html.ts.
// Usage : node scripts/build-prototype.mjs [--bundles]
//   --bundles : lance d'abord `pnpm run build:bundle` dans chaque package qui définit ce script (script racine `pnpm build:prototype`).
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "apps/web/public/prototype");
const args = process.argv.slice(2);
const read = (p) => readFileSync(p, "utf8");
const rel = (p) => relative(root, p);
// Un bundle inliné ne doit pas contenir « </script> » : on l'échappe (équivalent en JS dans une chaîne, un gabarit ou une regex).
const inline = (code, label, id) => `<script${id ? ` id="${id}"` : ""}>/* ${label} */\n${code.replace(/<\/script/gi, "<\\/script")}\n</script>`;

const BUNDLES = [
  // id : la page relit le texte de ce <script> pour lancer le moteur de mesure dans un Web Worker (guidage en direct du viseur).
  { pkg: "packages/measurement", dist: "packages/measurement/dist/wsmeasure.iife.js", global: "WSMeasure", vendor: "vendor/wsmeasure.iife.js", tag: '<script src="./vendor/wsmeasure.iife.js"></script>', id: "ws-measure-src" },
  { pkg: "packages/quote-engine", dist: "packages/quote-engine/dist/wsquote.iife.js", global: "WSQuote", vendor: "vendor/wsquote.iife.js", tag: '<script src="./vendor/wsquote.iife.js"></script>' },
];
const STUB_TAG = '<script src="./vendor/stubs.js"></script>';
const PATTERNS_TAG = '<script src="./patterns.js"></script>';

// 1. Bundles des packages (si demandé et si le script existe)
if (args.includes("--bundles")) {
  for (const b of BUNDLES) {
    const pj = join(root, b.pkg, "package.json");
    const scripts = existsSync(pj) ? JSON.parse(read(pj)).scripts || {} : {};
    if (scripts["build:bundle"]) {
      console.log(`→ ${b.pkg} : pnpm run build:bundle`);
      execSync("pnpm run build:bundle", { cwd: join(root, b.pkg), stdio: "inherit" });
    } else console.log(`→ ${b.pkg} : pas de script build:bundle (doublure vendor/stubs.js)`);
  }
}

// 2. index.html : moteurs réels ou doublure, puis motifs
let html = read(join(dir, "index.html"));
if (!html.startsWith("<!DOCTYPE html>")) throw new Error("index.html doit commencer par <!DOCTYPE html>");
const placeholder = (b) => `// Emplacement du bundle IIFE réel de ${b.pkg} (globale ${b.global}).\n// Remplacé par \`pnpm build:prototype\` quand ${b.dist} existe ; sinon vendor/stubs.js prend le relais.\n`;
const engines = [];
for (const b of BUNDLES) {
  if (!html.includes(b.tag)) throw new Error(`balise manquante dans index.html : ${b.tag}`);
  const dist = join(root, b.dist);
  if (existsSync(dist)) {
    const code = read(dist);
    if (!code.includes(b.global)) console.warn(`attention : ${b.dist} ne mentionne pas la globale ${b.global}`);
    html = html.replace(b.tag, () => inline(code, `${b.dist} → ${b.global}`, b.id));
    engines.push(`${b.global} : bundle réel (${rel(dist)}, ${(code.length / 1024).toFixed(1)} Ko)`);
  } else {
    html = html.replace(b.tag, "");
    engines.push(`${b.global} : doublure`);
  }
  // vendor/ws*.iife.js reste un fichier de garde dans les sources : la page non construite (index.html) tourne sur la doublure,
  // dist/index.html embarque les moteurs réels.
  if (!existsSync(join(dir, b.vendor))) writeFileSync(join(dir, b.vendor), placeholder(b));
}
if (!html.includes(STUB_TAG)) throw new Error(`balise manquante dans index.html : ${STUB_TAG}`);
const allReal = engines.every((e) => e.includes("bundle réel"));
html = html.replace(STUB_TAG, () => (allReal ? "" : inline(read(join(dir, "vendor/stubs.js")), "vendor/stubs.js — doublures WSMeasure / WSQuote (ne définit que les globales absentes)")));
if (!html.includes(PATTERNS_TAG)) throw new Error(`balise manquante dans index.html : ${PATTERNS_TAG}`);
html = html.replace(PATTERNS_TAG, () => inline(read(join(dir, "patterns.js")), "patterns.js"));
if (/<script src="\.\//.test(html)) throw new Error("il reste une balise <script src> relative dans dist/index.html");

// 3. dist/
mkdirSync(join(dir, "dist"), { recursive: true });
writeFileSync(join(dir, "dist/index.html"), html);
for (const f of ["embed.js", "manifest.webmanifest", "mire-wallscan.pdf", "mire.html"]) if (existsSync(join(dir, f))) copyFileSync(join(dir, f), join(dir, "dist", f));
if (existsSync(join(dir, "icons"))) { mkdirSync(join(dir, "dist/icons"), { recursive: true }); for (const f of readdirSync(join(dir, "icons"))) copyFileSync(join(dir, "icons", f), join(dir, "dist/icons", f)); }
if (!existsSync(join(dir, "mire-wallscan.pdf"))) console.warn("attention : mire-wallscan.pdf absent (python3 scripts/build-mire.py)");

// 4. Wrapper Expo/WebView
const mobileSrc = join(root, "apps/mobile-test/src");
if (existsSync(join(root, "apps/mobile-test"))) {
  mkdirSync(mobileSrc, { recursive: true });
  writeFileSync(join(mobileSrc, "prototype-html.ts"), `// Généré par scripts/build-prototype.mjs — ne pas éditer.\nexport const PROTOTYPE_HTML = ${JSON.stringify(html)};\n`);
}
console.log(`dist/index.html : ${(html.length / 1024).toFixed(1)} Ko — ${engines.join(" · ")}`);
