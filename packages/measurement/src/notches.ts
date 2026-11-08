/**
 * Décrochements au plafond (poutre, retombée, coffrage) dans l'image REDRESSÉE du mur : une bande horizontale collée au
 * plafond, bornée en bas par une arête horizontale nette, dont la teinte ou la texture diffère du mur en dessous, et qui
 * court sur une partie ou toute la largeur. On ne mesure pas la profondeur (une photo seule ne le peut pas) : on propose la
 * zone à exclure du papier, en cm dans le plan du mur, avec une confiance. Rien n'est déduit sans confirmation.
 *
 * Tout est exprimé en pixels de l'image redressée ; l'appelant fournit les bornes (profondeur min/max, portée min) en pixels,
 * ce qui permet d'utiliser le même détecteur en direct dans le viseur (échelle inconnue, bornes en fraction de hauteur).
 */
import type { GrayImage } from "@wallscan/core";
import { gaussianBlurF32, noiseSigma, sobel, toFloat } from "./image.js";

export interface NotchParams {
  /** Profondeur minimale / maximale de la bande sous le plafond (px). */
  minDepthPx: number;
  maxDepthPx: number;
  /** Portée horizontale minimale (px) et trou maximal toléré dans l'arête (px). */
  minSpanPx: number;
  maxGapPx: number;
}

export interface NotchProposal {
  /** Rectangle en pixels de l'image redressée, `y` = 0 (collé au plafond). */
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
  /** Contraste de l'arête basse (niveaux) et écart de teinte bande / mur (niveaux). */
  edgeContrast: number;
  shadeDelta: number;
}

/** Plus longue suite de colonnes marquées, trous ≤ maxGap tolérés. */
export function longestRun(flags: Uint8Array, maxGap: number): { lo: number; hi: number; filled: number } | null {
  let best: { lo: number; hi: number; filled: number } | null = null;
  let start = -1;
  let gap = 0;
  let filled = 0;
  const flush = (end: number): void => {
    if (start >= 0 && (!best || end - start > best.hi - best.lo)) best = { lo: start, hi: end, filled };
    start = -1;
    gap = 0;
    filled = 0;
  };
  for (let x = 0; x < flags.length; x++) {
    if (flags[x]) {
      if (start < 0) start = x;
      filled++;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap > maxGap) flush(x - gap + 1);
    }
  }
  if (start >= 0) flush(flags.length - gap);
  return best;
}

export function proposeCeilingNotches(rect: GrayImage, p: NotchParams): NotchProposal[] {
  const w = rect.width;
  const h = rect.height;
  if (w < 24 || h < 24 || p.maxDepthPx <= p.minDepthPx) return [];
  const noise = noiseSigma(rect);
  const blurred = gaussianBlurF32(toFloat(rect), w, h, 1.2);
  const g = sobel(blurred, w, h);
  const thr = Math.max(8, 3.5 * noise);
  const yMax = Math.min(h - 3, Math.round(p.maxDepthPx));
  const yMin = Math.max(2, Math.round(p.minDepthPx));
  // Profil : par ligne, part des colonnes où l'arête est horizontale et forte.
  const rowScore = new Float32Array(h);
  for (let y = yMin; y <= yMax; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (Math.abs(g.gy[i]) > thr && Math.abs(g.gy[i]) > 1.5 * Math.abs(g.gx[i])) n++;
    }
    rowScore[y] = n / w;
  }
  const out: NotchProposal[] = [];
  const used = new Uint8Array(h);
  // Pics du profil, du plus fort au plus faible, séparés d'au moins minDepth / 2.
  const order: number[] = [];
  for (let y = yMin; y <= yMax; y++) if (rowScore[y] >= 0.2) order.push(y);
  order.sort((a, b) => rowScore[b] - rowScore[a]);
  for (const y of order) {
    if (used[y]) continue;
    for (let k = Math.max(0, y - Math.round(p.minDepthPx / 2)); k <= Math.min(h - 1, y + Math.round(p.minDepthPx / 2)); k++) used[k] = 1;
    // Colonnes portant l'arête dans une bande de ±2 px.
    const flags = new Uint8Array(w);
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const i = (y + dy) * w + x; // y ∈ [2, h-3] : toujours dans l'image
        if (Math.abs(g.gy[i]) > thr && Math.abs(g.gy[i]) > 1.5 * Math.abs(g.gx[i])) on = 1;
      }
      flags[x] = on;
    }
    const run = longestRun(flags, p.maxGapPx)!; // ≥ 20 % des colonnes marquées sur cette ligne : jamais nul
    if (run.hi - run.lo < p.minSpanPx) continue;
    // Teinte et texture : bande au-dessus de l'arête (en retrait de 3 px) contre mur en dessous sur la même portée.
    const band = stats(rect, run.lo, run.hi, 1, Math.max(2, y - 3));
    const below = stats(rect, run.lo, run.hi, Math.min(h - 2, y + 3), Math.min(h - 1, y + 3 + Math.max(6, Math.round(p.minDepthPx))));
    const shadeDelta = Math.abs(band.mean - below.mean);
    let edge = 0;
    for (let x = run.lo; x < run.hi; x++) edge += Math.abs(g.gy[y * w + x]);
    const edgeContrast = edge / Math.max(1, run.hi - run.lo);
    const textureDelta = Math.abs(band.std - below.std);
    if (shadeDelta < 6 && textureDelta < 4) continue; // même mur des deux côtés : simple trait, pas un décrochement
    const span = (run.hi - run.lo) / w;
    const confidence = Math.min(
      0.95,
      0.25 + 0.3 * Math.min(1, run.filled / Math.max(1, run.hi - run.lo)) + 0.25 * Math.min(1, shadeDelta / 25) + 0.15 * Math.min(1, edgeContrast / 30) + 0.05 * span,
    );
    out.push({ x: run.lo, y: 0, w: run.hi - run.lo, h: y, confidence, edgeContrast, shadeDelta });
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, 2);
}

function stats(img: GrayImage, x0: number, x1: number, y0: number, y1: number): { mean: number; std: number } {
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = img.data[y * img.width + x];
      s += v;
      s2 += v * v;
      n++;
    }
  }
  const mean = s / n; // les appelants passent toujours une boîte non vide
  return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}
