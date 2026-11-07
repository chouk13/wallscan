/**
 * Estimation de la distorsion radiale k1 (modèle de division) par redressement des longues lignes : les arêtes sont
 * suivies le long des segments fournis, puis k1 minimise la somme des carrés des résidus de droites ajustées aux points
 * non distordus (grille + section dorée). Déterministe, jamais d'exception.
 */
import type { GrayImage, Pt } from "@wallscan/core";
import { undistortPoint, type ImageSize } from "./distortion.js";
import { noiseSigma } from "./image.js";
import { dist, fitLineTLS, lineFromPointDir, pointLineDistance } from "./linalg.js";
import { findEdgeAlongNormal } from "./refine.js";

export interface DistortionEstimate {
  k1: number;
  /** Courbure résiduelle moyenne des lignes après correction : max |résidu| / longueur (%). */
  residualPct: number;
}

/** Suit l'arête le long d'un segment (pas 4 px, fenêtre ±6 px recentrée sur l'offset précédent). */
export function trackEdge(img: GrayImage, a: Pt, b: Pt, minStrength: number): Pt[] {
  const len = dist(a, b);
  if (len < 20) return [];
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -d.y, y: d.x };
  const step = 4;
  const count = Math.floor(len / step);
  const pts: Pt[] = [];
  let offset = 0;
  let polarity = 0;
  for (let i = 0; i <= count; i++) {
    const t = i * step;
    const s = { x: a.x + d.x * t + n.x * offset, y: a.y + d.y * t + n.y * offset };
    const e = findEdgeAlongNormal(img, s, n, 6, polarity, minStrength);
    if (!e) continue;
    if (polarity === 0) polarity = e.strength >= 0 ? 1 : -1;
    offset += (e.p.x - s.x) * n.x + (e.p.y - s.y) * n.y;
    // La flèche d'une distorsion plausible reste sous 30 px : au-delà, on suit une autre arête.
    if (Math.abs(offset) > 30) break;
    pts.push(e.p);
  }
  return pts;
}

/** Rejette les points à plus de 1,5 px d'une parabole ajustée dans le repère local du segment. */
export function parabolaInliers(pts: Pt[], a: Pt, b: Pt): Pt[] {
  if (pts.length < 6) return pts;
  const len = dist(a, b);
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -d.y, y: d.x };
  // Moindres carrés u = c0 + c1 t + c2 t² (équations normales 3 × 3).
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, su0 = 0, su1 = 0, su2 = 0;
  const loc = pts.map((p) => {
    const t = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / len;
    const u = (p.x - a.x) * n.x + (p.y - a.y) * n.y;
    return { t, u };
  });
  for (const { t, u } of loc) {
    const t2 = t * t;
    s0 += 1; s1 += t; s2 += t2; s3 += t2 * t; s4 += t2 * t2;
    su0 += u; su1 += u * t; su2 += u * t2;
  }
  const m = [s0, s1, s2, s1, s2, s3, s2, s3, s4];
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (Math.abs(det) < 1e-12) return pts;
  const inv = [
    (m[4] * m[8] - m[5] * m[7]) / det, (m[2] * m[7] - m[1] * m[8]) / det, (m[1] * m[5] - m[2] * m[4]) / det,
    (m[5] * m[6] - m[3] * m[8]) / det, (m[0] * m[8] - m[2] * m[6]) / det, (m[2] * m[3] - m[0] * m[5]) / det,
    (m[3] * m[7] - m[4] * m[6]) / det, (m[1] * m[6] - m[0] * m[7]) / det, (m[0] * m[4] - m[1] * m[3]) / det,
  ];
  const c0 = inv[0] * su0 + inv[1] * su1 + inv[2] * su2;
  const c1 = inv[3] * su0 + inv[4] * su1 + inv[5] * su2;
  const c2 = inv[6] * su0 + inv[7] * su1 + inv[8] * su2;
  return pts.filter((_, i) => Math.abs(loc[i].u - (c0 + c1 * loc[i].t + c2 * loc[i].t * loc[i].t)) <= 1.5);
}

export function estimateRadialDistortion(img: GrayImage, lines: Array<{ a: Pt; b: Pt }>): DistortionEstimate {
  const size: ImageSize = { w: img.width, h: img.height };
  const minLen = 0.15 * Math.min(img.width, img.height);
  const minStrength = Math.max(2, 2 * noiseSigma(img));
  const tracks: Array<{ pts: Pt[]; len: number }> = [];
  for (const l of lines) {
    const len = dist(l.a, l.b);
    if (len < minLen) continue;
    const pts = parabolaInliers(trackEdge(img, l.a, l.b, minStrength), l.a, l.b);
    if (pts.length >= 20) tracks.push({ pts, len });
  }
  if (tracks.length === 0) return { k1: 0, residualPct: 0 };
  const kMin = -0.06;
  const kMax = 0.06;
  const costOf = (subset: Array<{ pts: Pt[]; len: number }>, k: number): number => {
    let total = 0;
    for (const tr of subset) {
      const u = tr.pts.map((p) => undistortPoint(p, k, size));
      const fit = fitLineTLS(u) as { p: Pt; d: Pt }; // ≥ 20 points non confondus
      const line = lineFromPointDir(fit.p, fit.d);
      for (const q of u) {
        const r = pointLineDistance(line, q);
        total += r * r;
      }
    }
    return total;
  };
  /** Minimisation 1-D : grille puis section dorée. */
  const minimize = (subset: Array<{ pts: Pt[]; len: number }>): number => {
    let bestK = 0;
    let bestC = Number.POSITIVE_INFINITY;
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const k = kMin + ((kMax - kMin) * i) / steps;
      const c = costOf(subset, k);
      if (c < bestC) {
        bestC = c;
        bestK = k;
      }
    }
    let lo = Math.max(kMin, bestK - (kMax - kMin) / steps);
    let hi = Math.min(kMax, bestK + (kMax - kMin) / steps);
    const phi = (Math.sqrt(5) - 1) / 2;
    for (let it = 0; it < 30; it++) {
      const k1a = hi - phi * (hi - lo);
      const k1b = lo + phi * (hi - lo);
      const ca = costOf(subset, k1a);
      const cb = costOf(subset, k1b);
      if (ca < cb) hi = k1b;
      else lo = k1a;
      const better = ca < cb ? [k1a, ca] : [k1b, cb];
      if (better[1] < bestC) {
        bestC = better[1];
        bestK = better[0];
      }
    }
    return bestK;
  };
  // Consensus : estimation par ligne, médiane, puis estimation jointe sur les lignes cohérentes (± 0,01).
  const perLineRaw = tracks.map((tr) => minimize([tr]));
  const perLine = perLineRaw.slice().sort((a, b) => a - b);
  const med = perLine[Math.floor(perLine.length / 2)];
  const consistent = tracks.filter((_, i) => Math.abs(perLineRaw[i] - med) <= 0.01);
  let bestK = minimize(consistent);
  // Optimum au bord de la plage de recherche : l'arête suivie n'est pas une droite distordue (autre arête, bruit) →
  // on ne corrige pas (k1 = 0) et on rapporte la courbure brute, que l'appelant peut signaler.
  const unreliable = Math.abs(bestK) >= 0.045;
  if (unreliable) bestK = 0;
  // Résidu : courbure restante (max |résidu| / longueur) moyenne sur les lignes retenues.
  let residual = 0;
  for (const tr of consistent) {
    const u = tr.pts.map((p) => undistortPoint(p, bestK, size));
    const fit = fitLineTLS(u) as { p: Pt; d: Pt };
    const line = lineFromPointDir(fit.p, fit.d);
    let worst = 0;
    for (const q of u) worst = Math.max(worst, Math.abs(pointLineDistance(line, q)));
    residual += (worst / tr.len) * 100;
  }
  return { k1: bestK, residualPct: residual / consistent.length };
}
