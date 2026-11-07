// Contrôle des motifs : charge patterns.js (script classique) dans un vm, génère les SVG du catalogue + références de test
// (nouvelles clés et clé inconnue → repli), mesure leur poids et écrit /tmp/patterns-check.html (tuile seule, mosaïque 3×3,
// échantillon 92×118, grand format). Vérifie aussi PATTERN_KEYS et le déterminisme (deux appels identiques).
// Usage : node scripts/patterns-check.mjs [sortie.html]
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
const src = readFileSync(new URL("../apps/web/public/prototype/patterns.js", import.meta.url), "utf8");
const ref = readFileSync(new URL("../docs/design/index-v2-reference.html", import.meta.url), "utf8");
const CATALOG = [...ref.matchAll(/^\s*(\{sku:"(?:CAS|ELI|DOM)-[^\n]*\}),?\s*$/gm)].map(m => vm.runInNewContext("(" + m[1] + ")"));
// Références de test (maisons du site Soufflet) — couleurs imposées par le brief ; TEST-INCONNU exerce le repli.
export const EXTRA = [
  { sku: "TEST-GRASS", brand: "Phillip Jeffries", name: "Herbe de rivière", color: "naturel", pat: "grasscloth", c1: "#E6DCC6", c2: "#9C8B66", w: 91, l: 732, rep: 0, match: "free", off: 0, unit: "roll" },
  { sku: "TEST-SCENIC", brand: "Iksel", name: "Jardin peint", color: "brume", pat: "pano-scenic", c1: "#EAE3D3", c2: "#5E6B4E", w: 70, l: 0, rep: 0, match: "free", off: 0, unit: "m2" },
  { sku: "TEST-RELIEF", brand: "Élitis", name: "Pétales en relief", color: "ivoire", pat: "relief", c1: "#EDE6DA", c2: "#CFC4B3", w: 70, l: 1005, rep: 0, match: "free", off: 0, unit: "roll" },
  { sku: "TEST-PALMS", brand: "MuralConcept", name: "Palmiers", color: "sépia", pat: "pano-palms", c1: "#E6DCC8", c2: "#5F6B52", w: 70, l: 0, rep: 0, match: "free", off: 0, unit: "m2" },
  { sku: "TEST-FLORAL", brand: "Isidore Leroy", name: "Roses", color: "fond bleu", pat: "floral", c1: "#6F9FBF", c2: "#E7C45A", w: 70, l: 1005, rep: 64, match: "half_drop", off: 32, unit: "roll" },
  { sku: "TEST-WAVES", brand: "Casamance", name: "Ondes", color: "cuivre", pat: "waves", c1: "#8E5A3C", c2: "#D9A070", w: 70, l: 1005, rep: 0, match: "free", off: 0, unit: "roll" },
  { sku: "TEST-INCONNU", brand: "—", name: "Clé inconnue", color: "repli c1", pat: "inconnu", c1: "#D7CFC0", c2: "#999999", w: 53, l: 1005, rep: 0, match: "free", off: 0, unit: "roll" },
];
const ctx = vm.createContext({});
vm.runInContext(src + "\nthis.svgTile=svgTile;this.tileCm=tileCm;this.isPano=isPano;this.PATTERN_KEYS=PATTERN_KEYS;", ctx);
const out = process.argv[2] || "/tmp/patterns-check.html";
let rows = "", report = [];
for (const p of [...CATALOG, ...EXTRA]) {
  const uri = ctx.svgTile(p), svg = decodeURIComponent(uri.replace("data:image/svg+xml;utf8,", ""));
  const bytes = Buffer.byteLength(svg), enc = uri.length;
  const same = ctx.svgTile(p) === uri;
  report.push({ sku: p.sku, pat: p.pat, bytes, enc, same, pano: ctx.isPano(p), tileCm: ctx.tileCm(p) });
  const pano = ctx.isPano(p);
  const bg = `background-image:url('${uri}')`;
  rows += `<section><h2>${p.sku} <small>${p.pat} · ${p.brand} ${p.name} ${p.color} · ${(bytes / 1024).toFixed(1)} Ko</small></h2>
  <div class="row">
   <div><div class="sw tile${pano ? " pano" : ""}" style="${bg}"></div><p>tuile seule</p></div>
   <div><div class="sw mosaic${pano ? " pano" : ""}" style="${bg}"></div><p>mosaïque 3×3</p></div>
   <div><div class="card"><div class="sw small" style="${bg};${pano ? "background-size:100% 100%" : "background-size:46px 46px"}"></div><div class="lbl"><b>${p.name}</b><span>${p.brand}</span></div></div><p>échantillon 92×118</p></div>
   <div><div class="sw big${pano ? " pano" : ""}" style="${bg}"></div><p>grand (${pano ? "mur" : "tuile ×2"})</p></div>
  </div></section>`;
}
const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Contrôle motifs</title><style>
body{margin:0;padding:16px;background:#161616;color:#F3F2EE;font:13px/1.4 system-ui}h2{font:500 15px system-ui;margin:12px 0 6px}small{opacity:.6;font-weight:400}
section{border-top:1px solid #333;padding-bottom:6px}.row{display:flex;gap:18px;align-items:flex-start}.row>div{text-align:center}p{margin:4px 0 0;opacity:.6}
.sw{background-color:#444;border-radius:3px}.tile{width:200px;height:200px;background-size:200px 200px;background-repeat:no-repeat}.tile.pano{width:400px;height:200px;background-size:100% 100%}
.mosaic{width:300px;height:300px;background-size:100px 100px;background-repeat:repeat}.mosaic.pano{width:400px;height:200px;background-size:100% 100%}
.big{width:420px;height:300px;background-size:210px 210px;background-repeat:repeat}.big.pano{width:600px;height:300px;background-size:100% 100%}
.card{width:92px;height:118px;background:#F3F2EE;border-radius:4px;padding:6px;box-sizing:border-box;box-shadow:0 10px 24px rgba(0,0,0,.45)}
.small{width:80px;height:72px;border-radius:2px;background-repeat:repeat}.lbl{color:#1F3D36;text-align:left;padding-top:4px}.lbl b{display:block;font-size:11px}.lbl span{font-size:10px;color:#5B6762}
</style></head><body><h1 style="font:500 18px system-ui;margin:0 0 8px">Contrôle des motifs — ${CATALOG.length} références</h1>${rows}</body></html>`;
writeFileSync(out, html);
const total = Buffer.byteLength(src), LIMIT = 64 * 1024;
console.table(report.map(r => ({ ...r, ok: r.bytes < 8192 && r.same })));
// Toutes les clés utilisées doivent être connues (sauf le repli volontaire), et PATTERN_KEYS doit être une liste non vide de chaînes.
const KEYS = ctx.PATTERN_KEYS, used = new Set([...CATALOG, ...EXTRA].map(p => p.pat).filter(k => k !== "inconnu"));
const missing = [...used].filter(k => !KEYS.includes(k));
console.log(`PATTERN_KEYS (${KEYS.length}) : ${KEYS.join(", ")}${missing.length ? ` — MANQUANTES : ${missing.join(", ")}` : ""}`);
console.log(`patterns.js : ${(total / 1024).toFixed(1)} Ko (${total} o) — limite ${LIMIT / 1024} Ko ${total < LIMIT ? "OK" : "DÉPASSÉE"}`);
console.log(`page de contrôle : ${out}`);
if (report.some(r => r.bytes >= 8192 || !r.same) || total >= LIMIT || missing.length || !Array.isArray(KEYS) || !KEYS.length) process.exitCode = 1;
