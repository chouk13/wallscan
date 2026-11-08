/**
 * Affinage du quad du mur sur l'image PLEINE RÉSOLUTION par ajustement de droites (lot « moteur v2 ») :
 * pour chaque côté, 40 à 120 profils perpendiculaires à l'arête, transition localisée en sous-pixel (parabole sur la dérivée,
 * polarité libre puis majoritaire), droite robuste (RANSAC déterministe puis moindres carrés itératifs avec rejet à 2,5 σ),
 * coins = intersections des droites. Un coin tapé au doigt est à ±3 px ; l'intersection de deux droites ajustées sur
 * ~1 000 px d'arête est à quelques dixièmes de pixel. Déterministe, jamais d'exception : un côté non ajustable garde la droite
 * du quad d'entrée et vaut `null` dans `lines`.
 */
import type { GrayImage, Pt, Quad } from "@wallscan/core";
import { distortPoint, undistortPoint, type ImageSize } from "./distortion.js";
import { bilinear, noiseSigma } from "./image.js";
import { dist, fitLineTLS, intersectLines, lineFromPointDir, lineThrough, pointLineDistance } from "./linalg.js";
import { innerNormal } from "./refine.js";

/** Côtés du quad dans l'ordre TL→TR (plafond), TR→BR (droite), BR→BL (sol), BL→TL (gauche). */
export const WALL_SIDES = ["ceiling", "right", "floor", "left"] as const;
export type WallSide = (typeof WALL_SIDES)[number];

/** Bornes du nombre de profils par côté (contrat) et densité par défaut : un profil tous les 12 px d'arête. */
export const WALL_REFINE_SAMPLES_MIN = 40;
export const WALL_REFINE_SAMPLES_MAX = 120;
const SAMPLE_SPACING_PX = 12;
/** Rayon de recherche par défaut le long de la normale (px pleine résolution) : couvre un coin tapé à ±3 px avec marge. */
export const WALL_REFINE_SEARCH_PX = 6;
/** Résidu RMS maximal (px) d'un côté ajusté : au-delà, l'arête n'est pas une droite (occlusion, autre arête, distorsion). */
export const WALL_REFINE_MAX_RESIDUAL_PX = 2;
/** Fraction minimale de profils inliers (sur les profils demandés), et plancher absolu. */
const MIN_INLIER_FRACTION = 0.35;
const MIN_INLIERS = 12;
/** Les inliers doivent couvrir au moins 30 % du côté : sinon l'orientation de la droite est mal contrainte. */
const MIN_SPAN_FRACTION = 0.3;
/** Profils pris entre 5 % et 95 % du côté : près des coins, l'arête voisine entre dans la fenêtre. */
const SPAN_START = 0.05;
const SPAN_END = 0.95;
/** Demi-largeur tangentielle (px) du profil moyenné : 5 lignes moyennées → bruit divisé par √5. */
const TANGENTIAL_HALF_PX = 2;
/** Tolérance (px) des hypothèses RANSAC et plancher de σ (px) du rejet à 2,5 σ (σ trop petit sur un bord parfait). */
const RANSAC_TOL_PX = 1;
const SIGMA_FLOOR_PX = 0.2;
const REJECT_K = 2.5;
/**
 * Seuil de dérivée par défaut : max(1, 1 × bruit). Le profil est moyenné sur 5 lignes puis lissé [1 2 1] : l'écart-type de
 * sa dérivée vaut ≈ 0,3 × le bruit pixel ; le seuil est donc à ≈ 3,5 σ de la dérivée (les pics de bruit isolés restants
 * sont éliminés par le consensus RANSAC). Le seuil v1 (2 × bruit, profil brut) perdait les angles de mur peu contrastés.
 */
const MIN_STRENGTH_FLOOR = 1;
const MIN_STRENGTH_NOISE_K = 1;
/** Un amas d'échantillons bien plus faible que la médiane (< 40 %) est une arête voisine ou du bruit. */
const WEAK_EDGE_RATIO = 0.4;

export interface RefineWallQuadOptions {
  /** Rayon de recherche le long de la normale (px), défaut 6. */
  searchPx?: number;
  /** Nombre de profils par côté, borné à [40 ; 120] ; défaut : longueur / 12 px. */
  samples?: number;
  /** Distorsion k1 (modèle de division, normalisé sur `full`) : droites ajustées dans l'espace non distordu. */
  k1?: number;
  /** Seuil minimal de dérivée (niveaux/px) ; défaut : max(1, bruit) (profil moyenné, voir MIN_STRENGTH_NOISE_K). */
  minStrength?: number;
}

export interface WallEdgeLine {
  /** Point et direction unitaire de la droite (espace non distordu si k1 ≠ 0), direction orientée comme le côté. */
  p: Pt;
  d: Pt;
  inliers: number;
  /** RMS des distances des inliers à la droite (px). */
  residualPx: number;
}

export interface WallQuadRefinement {
  quad: Quad;
  lines: Record<WallSide, WallEdgeLine | null>;
  /** Pire RMS (px) parmi les côtés ajustés ; 0 si aucun. */
  residualPx: number;
  /** 0–1 : moyenne par côté de (couverture des inliers) × (1 − résidu / 4 px) ; un côté non ajusté compte 0. */
  confidence: number;
  /** Vrai si les 4 côtés sont ajustés et les 4 coins acceptés. */
  refined: boolean;
}

export interface QuadEdgeSamples {
  side: WallSide;
  /** Points de transition retenus (coordonnées de l'image, distordues), dans l'ordre du côté. */
  points: Pt[];
  /** Nombre de profils demandés. */
  requested: number;
  /** Polarité retenue (+1 : intérieur plus clair) ; 0 si aucun point. */
  polarity: number;
}

interface ProfileEdge {
  p: Pt;
  strength: number;
}

/**
 * Transition le long de `n` autour de `s` : profil moyenné sur ±2 px le long de `d`, lissé [1 2 1], dérivée centrée,
 * maximum de |dérivée| (polarité libre) affiné par parabole. `null` sous `minStrength`.
 */
export function profileEdge(img: GrayImage, s: Pt, n: Pt, d: Pt, r: number, minStrength: number): ProfileEdge | null {
  const step = 0.5;
  const count = Math.round((2 * r) / step) + 1;
  const pad = 2;
  const len = count + 2 * pad;
  const prof = new Float64Array(len);
  const taps = 2 * TANGENTIAL_HALF_PX + 1;
  for (let i = 0; i < len; i++) {
    const t = -r + (i - pad) * step;
    let acc = 0;
    for (let u = -TANGENTIAL_HALF_PX; u <= TANGENTIAL_HALF_PX; u++) acc += bilinear(img, s.x + t * n.x + u * d.x, s.y + t * n.y + u * d.y);
    prof[i] = acc / taps;
  }
  const sm = (i: number): number => (prof[i - 1] + 2 * prof[i] + prof[i + 1]) / 4;
  const deriv = new Float64Array(count);
  let best = 0;
  for (let i = 0; i < count; i++) {
    deriv[i] = (sm(i + pad + 1) - sm(i + pad - 1)) / (2 * step);
    if (Math.abs(deriv[i]) > Math.abs(deriv[best])) best = i;
  }
  const peak = Math.abs(deriv[best]);
  if (!(peak >= minStrength)) return null;
  let offset = 0;
  if (best > 0 && best < count - 1) {
    // `best` est le PREMIER maximum strict : y0 < peak et y2 ≤ peak, donc den < 0 (jamais nul).
    const y0 = Math.abs(deriv[best - 1]);
    const y2 = Math.abs(deriv[best + 1]);
    const den = y0 - 2 * peak + y2;
    offset = Math.max(-1, Math.min(1, (0.5 * (y0 - y2)) / den));
  }
  const t = -r + (best + offset) * step;
  return { p: { x: s.x + t * n.x, y: s.y + t * n.y }, strength: deriv[best] };
}

/** Nombre de profils pour un côté de longueur `len` (borné au contrat 40–120). */
export function wallRefineSampleCount(len: number, samples?: number): number {
  const wanted = samples ?? Math.round(len / SAMPLE_SPACING_PX);
  return Math.max(WALL_REFINE_SAMPLES_MIN, Math.min(WALL_REFINE_SAMPLES_MAX, Math.round(wanted)));
}

export interface EdgePolylineOptions {
  searchPx?: number;
  /** Seuil de dérivée (niveaux/px), fourni par l'appelant (calculé une fois par image). */
  minStrength: number;
  /** Nombre de profils (≥ 2). */
  count: number;
  /** Portion du segment échantillonnée (défaut 5 %–95 %). */
  spanStart?: number;
  spanEnd?: number;
}

/**
 * Transitions le long du segment a → b (profils perpendiculaires, polarité majoritaire, amplitudes faibles écartées).
 * Brique commune de `sampleQuadEdges` (40–120 profils) et de l'échantillonnage dense pour la distorsion.
 */
export function sampleEdgePolyline(img: GrayImage, a: Pt, b: Pt, opts: EdgePolylineOptions): { points: Pt[]; polarity: number } {
  const r = Math.max(1, opts.searchPx ?? WALL_REFINE_SEARCH_PX);
  const minStrength = opts.minStrength;
  const len = dist(a, b);
  // Segment trop court (< 20 px) ou non fini : rien à ajuster.
  if (!(len >= 20) || !Number.isFinite(len) || !(opts.count >= 2)) return { points: [], polarity: 0 };
  const t0 = opts.spanStart ?? SPAN_START;
  const t1 = opts.spanEnd ?? SPAN_END;
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = innerNormal(a, b);
  const found: ProfileEdge[] = [];
  for (let j = 0; j < opts.count; j++) {
    const t = t0 + ((t1 - t0) * j) / (opts.count - 1);
    const e = profileEdge(img, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, n, d, r, minStrength);
    if (e) found.push(e);
  }
  // Polarité majoritaire le long de la normale intérieure (signe de la dérivée), puis cohérence d'amplitude.
  let pos = 0;
  for (const e of found) if (e.strength > 0) pos++;
  const polarity = found.length === 0 ? 0 : pos * 2 >= found.length ? 1 : -1;
  const same = found.filter((e) => Math.sign(e.strength) === polarity);
  const mags = same.map((e) => Math.abs(e.strength)).sort((x, y) => x - y);
  const med = mags.length > 0 ? mags[Math.floor(mags.length / 2)] : 0;
  return { points: same.filter((e) => Math.abs(e.strength) >= WEAK_EDGE_RATIO * med).map((e) => e.p), polarity };
}

/**
 * Échantillonne les transitions le long des 4 côtés du quad (40–120 profils par côté, voir `sampleEdgePolyline`).
 * Sert à `refineWallQuad`.
 */
export function sampleQuadEdges(img: GrayImage, quad: Quad, opts: RefineWallQuadOptions = {}): QuadEdgeSamples[] {
  const minStrength = opts.minStrength ?? Math.max(MIN_STRENGTH_FLOOR, MIN_STRENGTH_NOISE_K * noiseSigma(img));
  const out: QuadEdgeSamples[] = [];
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const len = dist(a, b);
    const requested = len >= 20 && Number.isFinite(len) ? wallRefineSampleCount(len, opts.samples) : 0;
    const e = sampleEdgePolyline(img, a, b, { count: requested, minStrength, ...(opts.searchPx !== undefined ? { searchPx: opts.searchPx } : {}) });
    out.push({ side: WALL_SIDES[i], points: e.points, requested, polarity: e.polarity });
  }
  return out;
}

/** Échantillonnage dense pour la distorsion : un profil tous les 3 px, 3 %–97 % du côté (la flèche croît comme L²). */
const DISTORTION_SPACING_PX = 3;
const DISTORTION_SPAN_START = 0.03;
const DISTORTION_SPAN_END = 0.97;
const DISTORTION_MAX_SAMPLES = 1500;

/** Polylignes denses le long des 4 côtés du quad (même repère que `img`), pour `estimateRadialDistortionFromPolylines`. */
export function sampleQuadEdgesDense(img: GrayImage, quad: Quad, opts: { searchPx?: number } = {}): Pt[][] {
  const minStrength = Math.max(MIN_STRENGTH_FLOOR, MIN_STRENGTH_NOISE_K * noiseSigma(img));
  const out: Pt[][] = [];
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const count = Math.min(DISTORTION_MAX_SAMPLES, Math.round(dist(a, b) / DISTORTION_SPACING_PX));
    const e = sampleEdgePolyline(img, a, b, {
      count, minStrength, spanStart: DISTORTION_SPAN_START, spanEnd: DISTORTION_SPAN_END, ...(opts.searchPx !== undefined ? { searchPx: opts.searchPx } : {}),
    });
    out.push(e.points);
  }
  return out;
}

/**
 * Droite robuste : hypothèses RANSAC déterministes (paires i, i + n/2), consensus à 1 px, puis moindres carrés totaux
 * itératifs avec rejet à 2,5 σ (σ = 1,4826 × médiane des |résidus|, plancher 0,2 px). `null` si moins de `minInliers`
 * inliers ou si les inliers couvrent moins de `minSpan` le long de la droite.
 */
export function fitEdgeLine(pts: readonly Pt[], minInliers: number, minSpan = 0): WallEdgeLine | null {
  const n = pts.length;
  if (n < Math.max(2, minInliers)) return null;
  const half = Math.floor(n / 2);
  const stride = Math.max(1, Math.floor(half / 40));
  let bestCount = 0;
  let bestLine: [number, number, number] | null = null;
  for (let i = 0; i < half; i += stride) {
    const a = pts[i];
    const b = pts[i + half];
    if (dist(a, b) < 1e-6) continue;
    const line = lineThrough(a, b);
    let count = 0;
    for (const p of pts) if (Math.abs(pointLineDistance(line, p)) <= RANSAC_TOL_PX) count++;
    if (count > bestCount) {
      bestCount = count;
      bestLine = line;
    }
  }
  if (!bestLine || bestCount < minInliers) return null;
  const seed = bestLine;
  let current = pts.filter((p) => Math.abs(pointLineDistance(seed, p)) <= RANSAC_TOL_PX);
  // ≥ 2 points distincts : les deux points de l'hypothèse retenue sont dans le consensus.
  let fit = fitLineTLS(current) as { p: Pt; d: Pt };
  for (let it = 0; it < 10; it++) {
    const line = lineFromPointDir(fit.p, fit.d);
    const res = pts.map((p) => Math.abs(pointLineDistance(line, p)));
    const sorted = res.slice().sort((x, y) => x - y);
    const sigma = Math.max(SIGMA_FLOOR_PX, 1.4826 * sorted[Math.floor(sorted.length / 2)]);
    const next = pts.filter((_, k) => res[k] <= REJECT_K * sigma);
    if (next.length < minInliers) return null;
    const changed = next.length !== current.length;
    current = next;
    const f = fitLineTLS(current);
    /* v8 ignore next -- ≥ minInliers points issus de profils distincts le long du côté : jamais tous confondus */
    if (!f) return null;
    fit = f;
    if (!changed) break;
  }
  const line = lineFromPointDir(fit.p, fit.d);
  let ss = 0;
  let tMin = Number.POSITIVE_INFINITY;
  let tMax = Number.NEGATIVE_INFINITY;
  for (const p of current) {
    const r = pointLineDistance(line, p);
    ss += r * r;
    const t = (p.x - fit.p.x) * fit.d.x + (p.y - fit.p.y) * fit.d.y;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  if (tMax - tMin < minSpan) return null;
  return { p: fit.p, d: fit.d, inliers: current.length, residualPx: Math.sqrt(ss / current.length) };
}

const emptyLines = (): Record<WallSide, WallEdgeLine | null> => ({ ceiling: null, right: null, floor: null, left: null });

/** Affinage du quad du mur (pixels pleine résolution) par droites ajustées ; voir l'en-tête du module. */
export function refineWallQuad(full: GrayImage, quadPx: Quad, opts: RefineWallQuadOptions = {}): WallQuadRefinement {
  const copy = quadPx.map((p) => ({ x: p.x, y: p.y })) as Quad;
  const k1 = opts.k1 ?? 0;
  const finite = quadPx.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!finite || full.width < 8 || full.height < 8 || !Number.isFinite(k1)) {
    return { quad: copy, lines: emptyLines(), residualPx: 0, confidence: 0, refined: false };
  }
  const size: ImageSize = { w: full.width, h: full.height };
  const searchPx = Math.max(1, opts.searchPx ?? WALL_REFINE_SEARCH_PX);
  const und = (p: Pt): Pt => (k1 !== 0 ? undistortPoint(p, k1, size) : p);
  const samples = sampleQuadEdges(full, quadPx, opts);
  const lines = emptyLines();
  const homog: Array<[number, number, number]> = [];
  let confidence = 0;
  let residualPx = 0;
  for (let i = 0; i < 4; i++) {
    const s = samples[i];
    const a = und(quadPx[i]);
    const b = und(quadPx[(i + 1) % 4]);
    const minInliers = Math.max(MIN_INLIERS, Math.ceil(MIN_INLIER_FRACTION * s.requested));
    const fit = fitEdgeLine(s.points.map(und), minInliers, MIN_SPAN_FRACTION * dist(a, b));
    if (fit && fit.residualPx <= WALL_REFINE_MAX_RESIDUAL_PX) {
      // Direction orientée comme le côté a → b (lisibilité ; sans effet sur l'intersection).
      const sameWay = fit.d.x * (b.x - a.x) + fit.d.y * (b.y - a.y) >= 0;
      const d = sameWay ? fit.d : { x: -fit.d.x, y: -fit.d.y };
      lines[WALL_SIDES[i]] = { p: fit.p, d, inliers: fit.inliers, residualPx: fit.residualPx };
      homog.push(lineFromPointDir(fit.p, d));
      residualPx = Math.max(residualPx, fit.residualPx);
      confidence += Math.min(1, fit.inliers / (0.6 * s.requested)) * (1 - fit.residualPx / (2 * WALL_REFINE_MAX_RESIDUAL_PX));
    } else {
      homog.push(lineThrough(a, b));
    }
  }
  let allCorners = true;
  // Un coin qui bouge de plus de 3 × la fenêtre de recherche (≥ 12 px) n'est pas l'affinage du coin donné : on le garde.
  const maxMove = Math.max(12, 3 * searchPx);
  const out: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    const prevSide = (i + 3) % 4;
    const fitted = lines[WALL_SIDES[i]] !== null || lines[WALL_SIDES[prevSide]] !== null;
    const q = fitted ? intersectLines(homog[prevSide], homog[i]) : null;
    const p = q ? (k1 !== 0 ? distortPoint(q, k1, size) : q) : null;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && dist(p, quadPx[i]) <= maxMove) out.push(p);
    else {
      out.push({ x: quadPx[i].x, y: quadPx[i].y });
      if (fitted) allCorners = false;
    }
  }
  const allSides = WALL_SIDES.every((k) => lines[k] !== null);
  return { quad: out as Quad, lines, residualPx, confidence: confidence / 4, refined: allSides && allCorners };
}
