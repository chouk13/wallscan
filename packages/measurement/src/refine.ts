/**
 * Affinage sous-pixel : profils d'intensité le long de la normale, position du maximum de dérivée (parabole),
 * ajustement robuste de droites, intersection des 4 droites d'un quad, aimantation d'une poignée sur l'arête voisine.
 */
import type { GrayImage, Pt, Quad } from "@wallscan/core";
import { distortPoint, undistortPoint, type ImageSize } from "./distortion.js";
import { bilinear, gaussianBlurF32, noiseSigma, sobel, toFloat } from "./image.js";
import { dist, fitLineTLS, intersectLines, lineFromPointDir, pointLineDistance } from "./linalg.js";

export interface EdgeSample {
  /** Position sous-pixel du bord. */
  p: Pt;
  /** Amplitude signée de la dérivée au bord (niveaux de gris par px). */
  strength: number;
}

/**
 * Cherche le bord le long de la normale `n` (unitaire) autour de `s` : maximum de `sign · dI/dt` sur t ∈ [−r, r]
 * (pas 0,5 px, interpolation bilinéaire, parabole autour du maximum). `sign = 0` : polarité libre (|dI/dt|).
 * `null` si la dérivée maximale est sous `minStrength`.
 */
export function findEdgeAlongNormal(img: GrayImage, s: Pt, n: Pt, r: number, sign: number, minStrength: number): EdgeSample | null {
  if (!(r >= 0.5)) return null;
  const step = 0.5;
  const count = Math.round((2 * r) / step) + 1;
  const prof = new Float64Array(count + 2);
  for (let i = 0; i < count + 2; i++) {
    const t = -r - step + i * step;
    prof[i] = bilinear(img, s.x + t * n.x, s.y + t * n.y);
  }
  // Dérivée centrée : d[i] = prof[i+2] − prof[i], associée à t = −r + i·step.
  let best = -1;
  let bestVal = 0;
  const deriv = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const d = (prof[i + 2] - prof[i]) / (2 * step);
    deriv[i] = d;
    const v = sign === 0 ? Math.abs(d) : sign * d;
    if (v > bestVal) {
      bestVal = v;
      best = i;
    }
  }
  if (best < 0 || bestVal < minStrength) return null;
  let offset = 0;
  if (best > 0 && best < count - 1) {
    const y0 = sign === 0 ? Math.abs(deriv[best - 1]) : sign * deriv[best - 1];
    const y1 = bestVal;
    const y2 = sign === 0 ? Math.abs(deriv[best + 1]) : sign * deriv[best + 1];
    const den = y0 - 2 * y1 + y2;
    if (den < -1e-9) offset = Math.max(-1, Math.min(1, (0.5 * (y0 - y2)) / den));
  }
  const t = -r + (best + offset) * step;
  return { p: { x: s.x + t * n.x, y: s.y + t * n.y }, strength: deriv[best] };
}

export interface RobustLine {
  p: Pt;
  d: Pt;
  inliers: number;
  rms: number;
}

/** Ajustement TLS avec rejet des points aberrants (2 passes : seuil max(1 px, 2,5·MAD)). `null` si < 4 points. */
export function fitLineRobust(points: readonly Pt[], minInliers = 4): RobustLine | null {
  if (points.length < minInliers) return null;
  let current = points.slice();
  let fit = fitLineTLS(current);
  if (!fit) return null;
  // Trois passes de rejet, de plus en plus strictes : un premier ajustement biaisé par un point aberrant lointain a des
  // résidus tous décalés ; le seuil large de la première passe ne rejette que l'aberrant.
  const floors = [2.5, 1.2, 1];
  for (let pass = 0; pass < 3; pass++) {
    const line = lineFromPointDir(fit.p, fit.d);
    const res = current.map((p) => Math.abs(pointLineDistance(line, p)));
    const sorted = res.slice().sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const mad = sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[Math.floor(sorted.length / 2)];
    const thr = Math.max(floors[pass], (pass === 0 ? 3 : 2.5) * mad * 1.4826, pass === 0 ? 2 * med : 0);
    const kept = current.filter((_, i) => res[i] <= thr);
    if (kept.length < minInliers) break;
    current = kept;
    const next = fitLineTLS(current);
    if (!next) break;
    fit = next;
  }
  const line = lineFromPointDir(fit.p, fit.d);
  let ss = 0;
  for (const p of current) {
    const d = pointLineDistance(line, p);
    ss += d * d;
  }
  return { p: fit.p, d: fit.d, inliers: current.length, rms: Math.sqrt(ss / current.length) };
}

export interface RefineOptions {
  /** Rayon de recherche le long de la normale (px). */
  radiusPx?: number;
  /** Distorsion k1 : les droites sont ajustées dans l'espace non distordu, les coins re-distordus. */
  k1?: number;
  /** Seuil minimal de dérivée (niveaux/px) ; défaut : max(2, 2 × bruit). */
  minStrength?: number;
  /** Nombre maximal d'échantillons par côté. */
  maxSamples?: number;
  /** Polarité imposée (+1 : intérieur plus clair, −1 : plus sombre) ; défaut : estimée sur l'image à r + 1,5 px. */
  polarity?: 1 | -1;
}

export interface RefinedQuad {
  quad: Quad;
  /** Par côté : nombre d'inliers, RMS (px), polarité. */
  sides: Array<{ inliers: number; rms: number; polarity: number; refined: boolean }>;
}

/** Normale intérieure du côté a → b d'un quad ordonné TL, TR, BR, BL (y vers le bas). */
export function innerNormal(a: Pt, b: Pt): Pt {
  const len = dist(a, b);
  if (len < 1e-9) return { x: 0, y: 1 };
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

/**
 * Polarité (signe de intérieur − extérieur) d'un côté, estimée sur l'image : d'abord tout près du bord supposé (±1,5 px,
 * fiable quand le quad initial est précis, p. ex. cadre fin de la mire), sinon à r + 1,5 px (quad initial grossier).
 */
function sidePolarity(img: GrayImage, a: Pt, b: Pt, n: Pt, r: number, minStrength: number): number {
  const k = 5;
  let nearIn = 0;
  let nearOut = 0;
  let farIn = 0;
  let farOut = 0;
  for (let i = 1; i <= k; i++) {
    const t = i / (k + 1);
    const sx = a.x + (b.x - a.x) * t;
    const sy = a.y + (b.y - a.y) * t;
    nearIn += bilinear(img, sx + n.x * 1.5, sy + n.y * 1.5);
    nearOut += bilinear(img, sx - n.x * 1.5, sy - n.y * 1.5);
    farIn += bilinear(img, sx + n.x * (r + 1.5), sy + n.y * (r + 1.5));
    farOut += bilinear(img, sx - n.x * (r + 1.5), sy - n.y * (r + 1.5));
  }
  const near = (nearIn - nearOut) / k;
  if (Math.abs(near) >= Math.max(3, minStrength)) return near > 0 ? 1 : -1;
  return farIn >= farOut ? 1 : -1;
}

/**
 * Affinage sous-pixel des 4 coins d'un quad : pour chaque côté, échantillons le long du côté (8 %–92 %), bord trouvé le
 * long de la normale, droite robuste ; coins = intersections des 4 droites. Un côté sans ajustement fiable garde sa
 * droite initiale. Déterministe, jamais d'exception.
 */
export function refineCornersDetailed(img: GrayImage, quad: Quad, opts: RefineOptions = {}): RefinedQuad {
  const r = opts.radiusPx ?? 6;
  const k1 = opts.k1 ?? 0;
  const size: ImageSize = { w: img.width, h: img.height };
  const minStrength = opts.minStrength ?? Math.max(2, 2 * noiseSigma(img));
  const maxSamples = opts.maxSamples ?? 64;
  const lines: Array<[number, number, number]> = [];
  const sides: RefinedQuad["sides"] = [];
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const len = dist(a, b);
    const n = innerNormal(a, b);
    const polarity = opts.polarity ?? sidePolarity(img, a, b, n, r, minStrength);
    let count = Math.min(maxSamples, Math.max(8, Math.floor(len / 3)));
    if (len < 6) count = 0;
    let fit: RobustLine | null = null;
    let centerA = a;
    let centerB = b;
    for (let pass = 0; pass < 2 && count > 0; pass++) {
      // Second passage : recentré sur la droite trouvée, rayon réduit (seule l'arête la plus proche compte).
      const radius = pass === 0 ? r : Math.max(2.5, r / 2);
      const samples: EdgeSample[] = [];
      for (let j = 0; j < count; j++) {
        const t = 0.08 + (0.84 * j) / (count - 1);
        const s = { x: centerA.x + (centerB.x - centerA.x) * t, y: centerA.y + (centerB.y - centerA.y) * t };
        const e = findEdgeAlongNormal(img, s, n, radius, polarity, minStrength);
        if (e) samples.push(e);
      }
      // Cohérence d'amplitude : on écarte les bords bien plus faibles que la médiane (arête voisine, bruit).
      const strengths = samples.map((e) => Math.abs(e.strength)).sort((x, y) => x - y);
      const medStrength = strengths.length > 0 ? strengths[Math.floor(strengths.length / 2)] : 0;
      const pts: Pt[] = [];
      for (const e of samples) {
        if (Math.abs(e.strength) < 0.4 * medStrength) continue;
        pts.push(k1 !== 0 ? undistortPoint(e.p, k1, size) : e.p);
      }
      const f = fitLineRobust(pts, 5);
      if (!f) break;
      fit = f;
      if (k1 !== 0) break;
      // Recentre le second passage sur la droite trouvée (projection de a et b).
      centerA = projectOnLine(f, a);
      centerB = projectOnLine(f, b);
    }
    if (fit) {
      lines.push(lineFromPointDir(fit.p, fit.d));
      sides.push({ inliers: fit.inliers, rms: fit.rms, polarity, refined: true });
    } else {
      const au = k1 !== 0 ? undistortPoint(a, k1, size) : a;
      const bu = k1 !== 0 ? undistortPoint(b, k1, size) : b;
      lines.push(lineFromPointDir(au, { x: bu.x - au.x, y: bu.y - au.y }));
      sides.push({ inliers: 0, rms: Number.NaN, polarity, refined: false });
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    const prev = lines[(i + 3) % 4];
    const cur = lines[i];
    const p = intersectLines(prev, cur);
    const original = quad[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || dist(p, original) > Math.max(4 * r, 24)) {
      out.push({ x: original.x, y: original.y });
      sides[i].refined = false;
    } else {
      out.push(k1 !== 0 ? distortPoint(p, k1, size) : p);
    }
  }
  return { quad: out as Quad, sides };
}

function projectOnLine(l: RobustLine, p: Pt): Pt {
  const t = (p.x - l.p.x) * l.d.x + (p.y - l.p.y) * l.d.y;
  return { x: l.p.x + t * l.d.x, y: l.p.y + t * l.d.y };
}

/** API publique : `refineCorners(img, quad, radiusPx?, k1?)`. */
export function refineCorners(img: GrayImage, quad: Quad, radiusPx = 6, k1 = 0): Quad {
  return refineCornersDetailed(img, quad, { radiusPx, k1 }).quad;
}

/**
 * Aimantation d'une poignée : dans un rayon `radiusPx`, cherche les maxima de gradient (suppression des non-maxima) ;
 * si deux orientations dominantes (un coin) → intersection des deux droites ; sinon le bord le plus fort pondéré par la
 * proximité, affiné en sous-pixel le long de son gradient. Sans bord : le point est rendu inchangé.
 */
export function snapToEdge(img: GrayImage, p: Pt, radiusPx = 12): Pt {
  const r = Math.max(2, Math.round(radiusPx));
  const x0 = Math.max(0, Math.floor(p.x) - r - 2);
  const y0 = Math.max(0, Math.floor(p.y) - r - 2);
  const x1 = Math.min(img.width, Math.floor(p.x) + r + 3);
  const y1 = Math.min(img.height, Math.floor(p.y) + r + 3);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 5 || h < 5) return { x: p.x, y: p.y };
  const win = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) win[y * w + x] = img.data[(y0 + y) * img.width + x0 + x];
  const sm = gaussianBlurF32(win, w, h, 1);
  const g = sobel(sm, w, h);
  const noise = noiseSigma(img);
  const thr = Math.max(3, 2.5 * noise);
  interface Cand {
    x: number;
    y: number;
    mag: number;
    m1: number;
    m2: number;
    angle: number;
    score: number;
  }
  const cands: Cand[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = g.mag[i];
      if (m < thr) continue;
      const gx = g.gx[i];
      const gy = g.gy[i];
      // Suppression des non-maxima le long du gradient (4 directions).
      const ax = Math.abs(gx);
      const ay = Math.abs(gy);
      let m1: number;
      let m2: number;
      if (ax > 2.414 * ay) {
        m1 = g.mag[i - 1];
        m2 = g.mag[i + 1];
      } else if (ay > 2.414 * ax) {
        m1 = g.mag[i - w];
        m2 = g.mag[i + w];
      } else if (gx * gy > 0) {
        m1 = g.mag[i - w - 1];
        m2 = g.mag[i + w + 1];
      } else {
        m1 = g.mag[i - w + 1];
        m2 = g.mag[i + w - 1];
      }
      if (m < m1 || m < m2) continue;
      const cx = x0 + x + 0.5;
      const cy = y0 + y + 0.5;
      const d = Math.hypot(cx - p.x, cy - p.y);
      if (d > r) continue;
      cands.push({ x: cx, y: cy, mag: m, m1, m2, angle: Math.atan2(gy, gx), score: m / (1 + d / r) });
    }
  }
  if (cands.length === 0) return { x: p.x, y: p.y };
  // Deux orientations dominantes ? Histogramme d'orientation modulo π (12 classes).
  const bins = 12;
  const hist = new Array<number>(bins).fill(0);
  for (const c of cands) {
    let a = c.angle;
    if (a < 0) a += Math.PI;
    if (a >= Math.PI) a -= Math.PI;
    hist[Math.min(bins - 1, Math.floor((a / Math.PI) * bins))] += c.mag;
  }
  let b1 = 0;
  for (let i = 1; i < bins; i++) if (hist[i] > hist[b1]) b1 = i;
  let b2 = -1;
  for (let i = 0; i < bins; i++) {
    const dBin = Math.min(Math.abs(i - b1), bins - Math.abs(i - b1));
    if (dBin >= 3 && (b2 < 0 || hist[i] > hist[b2])) b2 = i;
  }
  const inBin = (c: Cand, b: number): boolean => {
    let a = c.angle;
    if (a < 0) a += Math.PI;
    if (a >= Math.PI) a -= Math.PI;
    const bin = Math.min(bins - 1, Math.floor((a / Math.PI) * bins));
    const dBin = Math.min(Math.abs(bin - b), bins - Math.abs(bin - b));
    return dBin <= 1;
  };
  if (b2 >= 0 && hist[b2] > 0.25 * hist[b1]) {
    const g1 = cands.filter((c) => inBin(c, b1));
    const g2 = cands.filter((c) => inBin(c, b2));
    const l1 = fitLineRobust(g1, 4);
    const l2 = fitLineRobust(g2, 4);
    if (l1 && l2) {
      const q = intersectLines(lineFromPointDir(l1.p, l1.d), lineFromPointDir(l2.p, l2.d));
      if (q && dist(q, p) <= 1.5 * r) return q;
    }
  }
  let best = cands[0];
  for (const c of cands) if (c.score > best.score) best = c;
  // Sous-pixel le long du gradient : parabole sur les magnitudes des deux voisins (maximum local, donc den ≤ 0).
  const den = best.m1 - 2 * best.mag + best.m2;
  const offset = den < -1e-9 ? Math.max(-1, Math.min(1, (0.5 * (best.m1 - best.m2)) / den)) : 0;
  const step = Math.abs(Math.cos(best.angle)) > 0.5 && Math.abs(Math.sin(best.angle)) > 0.5 ? Math.SQRT2 : 1;
  const n = { x: Math.cos(best.angle), y: Math.sin(best.angle) };
  return { x: best.x + n.x * offset * step, y: best.y + n.y * offset * step };
}

/** Conversion utilitaire : image en flottants lissés (pour les détecteurs). */
export function smoothFloat(img: GrayImage, sigma: number): Float32Array {
  return gaussianBlurF32(toFloat(img), img.width, img.height, sigma);
}
