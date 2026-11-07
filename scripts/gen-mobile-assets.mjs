#!/usr/bin/env node
// Génère les icônes/splash de apps/mobile-test et les icônes PWA du prototype.
// Zéro dépendance : rastérisation vectorielle maison (sur-échantillonnage) + encodeur PNG sur zlib (Node ≥ 18).
// Déterministe : même script → mêmes octets, quel que soit l'OS (aucune police système utilisée, la lettre est un tracé).
//
//   node scripts/gen-mobile-assets.mjs            # écrit tous les fichiers
//   node scripts/gen-mobile-assets.mjs --check    # vérifie que les fichiers sur disque sont à jour (CI)
//
// Marque : fond graphite #161616, « W » papier #F3F2EE, carré laiton #B08D57.
// La géométrie respecte la zone sûre des icônes adaptatives Android (cercle de ⌀ 66/108) et du splash Android 12 (⌀ 2/3).

import { deflateSync, crc32 as zlibCrc32 } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

// ------------------------------------------------------------------ couleurs
const GRAPHITE = [0x16, 0x16, 0x16];
const PAPER = [0xf3, 0xf2, 0xee];
const BRASS = [0xb0, 0x8d, 0x57];

// ------------------------------------------------------------------ géométrie (canevas unitaire 0..1)
// Groupe « W + carré » centré ; coins extrêmes à r ≈ 0,29 du centre (< 0,3055 = zone sûre adaptative).
const W_BOX = { x: 0.242, y: 0.37, w: 0.41, h: 0.26 };
const STROKE = 0.072; // épaisseur horizontale des fûts
const SQUARE = { x: 0.686, y: 0.558, s: 0.072 }; // aligné sur la ligne de base du W

/** Fûts du W : parallélogrammes à coupes horizontales (W géométrique à sommets plats). */
function wBars(scale = 1, cx = 0.5, cy = 0.5) {
  const b = W_BOX;
  const s = STROKE;
  // points de centre-ligne, en coordonnées du canevas unitaire
  const TL = [b.x + s / 2, b.y];
  const TM = [b.x + b.w / 2, b.y + 0.14 * b.h];
  const TR = [b.x + b.w - s / 2, b.y];
  const B1 = [b.x + 0.27 * b.w, b.y + b.h];
  const B2 = [b.x + 0.73 * b.w, b.y + b.h];
  const bar = (top, bot) => [
    [top[0] - s / 2, top[1]],
    [top[0] + s / 2, top[1]],
    [bot[0] + s / 2, bot[1]],
    [bot[0] - s / 2, bot[1]],
  ];
  const bars = [bar(TL, B1), bar(TM, B1), bar(TM, B2), bar(TR, B2)];
  return bars.map((q) => q.map(([x, y]) => [cx + (x - 0.5) * scale, cy + (y - 0.5) * scale]));
}
function squareQuad(scale = 1, cx = 0.5, cy = 0.5) {
  const q = SQUARE;
  const pts = [
    [q.x, q.y],
    [q.x + q.s, q.y],
    [q.x + q.s, q.y + q.s],
    [q.x, q.y + q.s],
  ];
  return pts.map(([x, y]) => [cx + (x - 0.5) * scale, cy + (y - 0.5) * scale]);
}

/** Point dans un quadrilatère convexe (test des produits vectoriels, orientation quelconque). */
function inQuad(q, px, py) {
  let pos = false;
  let neg = false;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % 4];
    const c = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (c > 0) pos = true;
    else if (c < 0) neg = true;
    if (pos && neg) return false;
  }
  return true;
}

// ------------------------------------------------------------------ rastérisation
/**
 * @param {number} size côté en px
 * @param {{background: number[] | null, scale?: number}} opts background null → transparent
 */
function raster(size, { background, scale = 1 }) {
  const bars = wBars(scale);
  const sq = squareQuad(scale);
  const ss = size >= 512 ? 4 : 8; // sous-échantillons par axe
  const inv = 1 / (ss * ss);
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cw = 0;
      let cs = 0;
      for (let j = 0; j < ss; j++) {
        const py = (y + (j + 0.5) / ss) / size;
        for (let i = 0; i < ss; i++) {
          const px = (x + (i + 0.5) / ss) / size;
          if (inQuad(sq, px, py)) cs++;
          else if (bars.some((q) => inQuad(q, px, py))) cw++;
        }
      }
      const aW = cw * inv;
      const aS = cs * inv;
      // composition : fond → W → carré (formes disjointes)
      let r, g, b, a;
      if (background) {
        [r, g, b] = background;
        a = 1;
      } else {
        r = g = b = 0;
        a = 0;
      }
      const over = (col, alpha) => {
        const na = alpha + a * (1 - alpha);
        if (na === 0) return;
        r = (col[0] * alpha + r * a * (1 - alpha)) / na;
        g = (col[1] * alpha + g * a * (1 - alpha)) / na;
        b = (col[2] * alpha + b * a * (1 - alpha)) / na;
        a = na;
      };
      over(PAPER, aW);
      over(BRASS, aS);
      const o = (y * size + x) * 4;
      out[o] = Math.round(r);
      out[o + 1] = Math.round(g);
      out[o + 2] = Math.round(b);
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

// ------------------------------------------------------------------ PNG
const crc32 =
  typeof zlibCrc32 === "function"
    ? (buf) => zlibCrc32(buf) >>> 0
    : (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
          let c = n;
          for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
          t[n] = c >>> 0;
        }
        return (buf) => {
          let c = 0xffffffff;
          for (const byte of buf) c = t[(c ^ byte) & 0xff] ^ (c >>> 8);
          return (c ^ 0xffffffff) >>> 0;
        };
      })();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filtre None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ SVG de référence (même géométrie, pour les designers)
function svgMark() {
  const S = 1024;
  const poly = (q, fill) => `<polygon fill="${fill}" points="${q.map(([x, y]) => `${(x * S).toFixed(1)},${(y * S).toFixed(1)}`).join(" ")}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <!-- WallScan — marque générée par scripts/gen-mobile-assets.mjs (source de vérité : ce script) -->
  <rect width="${S}" height="${S}" fill="#161616"/>
  <g id="W">${wBars().map((q) => poly(q, "#F3F2EE")).join("")}</g>
  ${poly(squareQuad(), "#B08D57")}
</svg>
`;
}

// ------------------------------------------------------------------ sorties
const mobileAssets = join(root, "apps/mobile-test/assets");
const pwaIcons = join(root, "apps/web/public/prototype/icons");

/** @type {Array<{file: string, size?: number, background?: number[] | null, scale?: number, svg?: boolean}>} */
const outputs = [
  // Expo — icône de lanceur (toutes plateformes), fond opaque
  { file: join(mobileAssets, "icon.png"), size: 1024, background: GRAPHITE },
  // Android adaptive icon : premier plan transparent (le fond vient de app.json → android.adaptiveIcon.backgroundColor)
  { file: join(mobileAssets, "adaptive-icon.png"), size: 1024, background: null },
  // Splash (plugin expo-splash-screen, resizeMode contain, fond #161616) — marque un peu plus grande, dans le cercle ⌀ 2/3 d'Android 12
  { file: join(mobileAssets, "splash-icon.png"), size: 1024, background: null, scale: 1.1 },
  // Favicon (si un jour la cible web Expo est activée)
  { file: join(mobileAssets, "favicon.png"), size: 48, background: GRAPHITE, scale: 1.5 },
  // SVG de référence
  { file: join(mobileAssets, "wallscan-mark.svg"), svg: true },
  // PWA (manifest.webmanifest du prototype)
  { file: join(pwaIcons, "icon-192.png"), size: 192, background: GRAPHITE, scale: 1.3 },
  { file: join(pwaIcons, "icon-512.png"), size: 512, background: GRAPHITE, scale: 1.3 },
  { file: join(pwaIcons, "icon-512-maskable.png"), size: 512, background: GRAPHITE }, // zone sûre respectée (scale 1)
  { file: join(pwaIcons, "apple-touch-icon.png"), size: 180, background: GRAPHITE, scale: 1.3 },
];

let stale = 0;
for (const o of outputs) {
  const bytes = o.svg ? Buffer.from(svgMark(), "utf8") : encodePng(raster(o.size, { background: o.background ?? null, scale: o.scale ?? 1 }), o.size);
  const rel = o.file.slice(root.length + 1);
  if (CHECK) {
    const same = existsSync(o.file) && Buffer.compare(readFileSync(o.file), bytes) === 0;
    if (!same) stale++;
    console.log(`${same ? "ok   " : "STALE"} ${rel}`);
    continue;
  }
  mkdirSync(dirname(o.file), { recursive: true });
  writeFileSync(o.file, bytes);
  console.log(`écrit ${rel} (${(bytes.length / 1024).toFixed(1)} Ko)`);
}
if (CHECK && stale) {
  console.error(`${stale} fichier(s) obsolète(s) : relancer node scripts/gen-mobile-assets.mjs`);
  process.exit(1);
}
