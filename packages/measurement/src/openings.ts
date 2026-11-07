/**
 * Propositions d'ouvertures dans l'image redressée : rectangles alignés sur les axes bordés d'arêtes, classés en
 * fenêtre (zone claire / contrastée, ne touche pas le sol), porte (70–100 cm de large, part du sol, 180–230 cm),
 * porte-fenêtre (part du sol, ≥ 85 % de la hauteur), radiateur (bas, 30–90 cm de haut). Toute proposition porte
 * `source: "auto"` et une confiance ; rien n'est déduit sans confirmation.
 */
import type { GrayImage, OpeningKindV2, OpeningV2, RectCm, WallSurvey } from "@wallscan/core";
import { downsampleBox, gaussianBlurF32, median, noiseSigma, sobel, toFloat } from "./image.js";

interface Run {
  /** Coordonnée fixe (y pour horizontal, x pour vertical). */
  pos: number;
  lo: number;
  hi: number;
  strength: number;
}

/** Séries d'arêtes alignées : parcours ligne par ligne (horizontal) ou colonne par colonne (vertical). */
export function runs(flag: Uint8Array, strength: Float32Array, w: number, h: number, horizontal: boolean, minLen: number): Run[] {
  const out: Run[] = [];
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  for (let p = 0; p < outer; p++) {
    let start = -1;
    let gap = 0;
    let sum = 0;
    let count = 0;
    const flush = (end: number): void => {
      if (start >= 0 && end - start >= minLen) out.push({ pos: p, lo: start, hi: end, strength: sum / Math.max(1, count) });
      start = -1;
      sum = 0;
      count = 0;
    };
    for (let q = 0; q < inner; q++) {
      const i = horizontal ? p * w + q : q * w + p;
      if (flag[i]) {
        if (start < 0) start = q;
        sum += strength[i];
        count++;
        gap = 0;
      } else if (start >= 0) {
        gap++;
        if (gap > 2) {
          flush(q - gap);
          gap = 0;
        }
      }
    }
    if (start >= 0) flush(inner - gap);
  }
  // Fusion des séries voisines (même arête étalée sur 2–3 lignes par le flou) : on garde la plus forte.
  out.sort((a, b) => b.strength - a.strength);
  const kept: Run[] = [];
  for (const r of out) {
    const dup = kept.some((k) => Math.abs(k.pos - r.pos) <= 2 && Math.min(k.hi, r.hi) - Math.max(k.lo, r.lo) > 0.6 * Math.min(k.hi - k.lo, r.hi - r.lo));
    if (!dup) kept.push(r);
  }
  return kept;
}

interface RectPx {
  x: number;
  y: number;
  w: number;
  h: number;
  coverage: number;
}

const coverOf = (r: Run, lo: number, hi: number): number => Math.max(0, Math.min(r.hi, hi) - Math.max(r.lo, lo)) / Math.max(1, hi - lo);

export function proposeOpenings(rectified: GrayImage, scalePxPerCm: number, survey: WallSurvey): OpeningV2[] {
  if (!(scalePxPerCm > 0) || rectified.width < 20 || rectified.height < 20 || !(survey.widthCm > 0) || !(survey.heightCm > 0)) return [];
  // Travail à ≈ 1 px/cm.
  const factor = Math.max(1, Math.round(scalePxPerCm));
  const img = factor > 1 ? downsampleBox(rectified, factor) : rectified;
  const s = scalePxPerCm / factor; // px/cm effectif
  const w = img.width;
  const h = img.height;
  const sm = gaussianBlurF32(toFloat(img), w, h, 1);
  const g = sobel(sm, w, h);
  const noise = noiseSigma(img);
  const thr = Math.max(4, 3 * noise);
  const hFlag = new Uint8Array(w * h);
  const vFlag = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const ax = Math.abs(g.gx[i]);
    const ay = Math.abs(g.gy[i]);
    if (ay >= thr && ay >= 1.5 * ax) hFlag[i] = 1;
    if (ax >= thr && ax >= 1.5 * ay) vFlag[i] = 1;
  }
  const minLen = Math.round(30 * s);
  const hRuns = runs(hFlag, g.mag, w, h, true, minLen);
  const vRuns = runs(vFlag, g.mag, w, h, false, minLen);
  // Le sol (bord inférieur de l'image redressée) sert de côté bas aux portes et portes-fenêtres.
  hRuns.push({ pos: h - 1, lo: 0, hi: w, strength: Number.POSITIVE_INFINITY });
  const minW = 40 * s;
  const minH = 30 * s;
  const cands: RectPx[] = [];
  for (let i = 0; i < vRuns.length; i++) {
    for (let j = 0; j < vRuns.length; j++) {
      const L = vRuns[i];
      const R = vRuns[j];
      if (R.pos - L.pos < minW) continue;
      const yLo = Math.max(L.lo, R.lo);
      const yHi = Math.min(L.hi, R.hi);
      if (yHi - yLo < minH) continue;
      for (const T of hRuns) {
        if (T.pos < yLo - 3 || T.pos > yHi) continue;
        if (coverOf(T, L.pos, R.pos) < 0.7) continue;
        for (const B of hRuns) {
          // Le sol (bord bas de l'image) tolère 12 cm de marge : les arêtes verticales s'affaiblissent à la jonction.
          const slack = B.strength === Number.POSITIVE_INFINITY ? Math.max(3, 12 * s) : 3;
          if (B.pos - T.pos < minH || B.pos > yHi + slack) continue;
          if (coverOf(B, L.pos, R.pos) < 0.7) continue;
          const cL = coverOf(L, T.pos, B.pos);
          const cR = coverOf(R, T.pos, B.pos);
          const coverage = (cL + cR + coverOf(T, L.pos, R.pos) + coverOf(B, L.pos, R.pos)) / 4;
          cands.push({ x: L.pos + 0.5, y: T.pos + 0.5, w: R.pos - L.pos, h: B.pos - T.pos, coverage });
        }
      }
    }
  }
  // Déduplication : du plus grand au plus petit, on écarte les rectangles trop semblables ou emboîtés dans un retenu.
  cands.sort((a, b) => b.w * b.h - a.w * a.h);
  const kept: RectPx[] = [];
  for (const c of cands) {
    const dup = kept.some((k) => {
      const ix = Math.max(0, Math.min(k.x + k.w, c.x + c.w) - Math.max(k.x, c.x));
      const iy = Math.max(0, Math.min(k.y + k.h, c.y + c.h) - Math.max(k.y, c.y));
      const inter = ix * iy;
      const iou = inter / (k.w * k.h + c.w * c.h - inter);
      const nested = inter >= 0.9 * c.w * c.h;
      return iou > 0.5 || nested;
    });
    if (!dup) kept.push(c);
  }
  const wallMedian = median(img.data);
  const H = survey.heightCm;
  const out: OpeningV2[] = [];
  let n = 0;
  for (const c of kept) {
    const rect: RectCm = { x: c.x / s, y: c.y / s, w: c.w / s, h: c.h / s };
    const bottomGap = H - (rect.y + rect.h);
    // Statistiques intérieures (boîte réduite de 15 %).
    const ix0 = Math.max(0, Math.round(c.x + c.w * 0.15));
    const ix1 = Math.min(w, Math.round(c.x + c.w * 0.85));
    const iy0 = Math.max(0, Math.round(c.y + c.h * 0.15));
    const iy1 = Math.min(h, Math.round(c.y + c.h * 0.85));
    let sum = 0;
    let sq = 0;
    let cnt = 0;
    for (let y = iy0; y < iy1; y++) {
      for (let x = ix0; x < ix1; x++) {
        const v = img.data[y * w + x];
        sum += v;
        sq += v * v;
        cnt++;
      }
    }
    const mean = sum / Math.max(1, cnt);
    const std = Math.sqrt(Math.max(0, sq / Math.max(1, cnt) - mean * mean));
    let kind: OpeningKindV2 | null = null;
    let fit = 0;
    if (bottomGap <= 8 && rect.h >= 0.85 * H && rect.w >= 70 && rect.w <= 260) {
      kind = "french_door";
      fit = 0.9;
    } else if (bottomGap <= 8 && rect.w >= 65 && rect.w <= 110 && rect.h >= 180 && rect.h <= 230) {
      kind = "door";
      fit = 1;
    } else if (bottomGap <= 25 && rect.h >= 30 && rect.h <= 90 && rect.w >= 40 && rect.w <= 200) {
      kind = "radiator";
      fit = 0.8;
    } else if (bottomGap >= 25 && rect.w >= 40 && rect.w <= 300 && rect.h >= 40 && rect.h <= 220 && (Math.abs(mean - wallMedian) >= 10 || std >= 12)) {
      // Intérieur plus clair que le mur : fenêtre typique ; plus sombre ou contrasté : fenêtre avec vue (ou cadre), à confirmer.
      kind = "window";
      fit = mean - wallMedian >= 10 ? 1 : 0.6;
    }
    if (!kind) continue;
    n++;
    out.push({ id: `auto-${n}`, kind, rect, confidence: Math.max(0, Math.min(1, c.coverage * fit)), source: "auto" });
  }
  return out;
}
