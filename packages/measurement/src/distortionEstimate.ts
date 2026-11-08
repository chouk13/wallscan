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
  /**
   * Optimum brut avant rejet (moteur v2) : égal à `k1` quand l'estimation est retenue ; quand elle est rejetée (optimum
   * ≥ 0,045, k1 forcé à 0), optimum recherché sur ±0,15 — sert aux codes `distortion_strong` / `distortion_extreme`.
   * Absent quand aucune ligne n'est exploitable.
   */
  rawK1?: number;
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

/**
 * Résidus (px) des points à la parabole u = c0 + c1 t + c2 t² ajustée dans le repère local du segment a → b
 * (t le long du segment normalisé, u le long de la normale). `null` si le système est singulier.
 */
export function parabolaResiduals(pts: readonly Pt[], a: Pt, b: Pt): number[] | null {
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
  if (!(Math.abs(det) >= 1e-12)) return null;
  const inv = [
    (m[4] * m[8] - m[5] * m[7]) / det, (m[2] * m[7] - m[1] * m[8]) / det, (m[1] * m[5] - m[2] * m[4]) / det,
    (m[5] * m[6] - m[3] * m[8]) / det, (m[0] * m[8] - m[2] * m[6]) / det, (m[2] * m[3] - m[0] * m[5]) / det,
    (m[3] * m[7] - m[4] * m[6]) / det, (m[1] * m[6] - m[0] * m[7]) / det, (m[0] * m[4] - m[1] * m[3]) / det,
  ];
  const c0 = inv[0] * su0 + inv[1] * su1 + inv[2] * su2;
  const c1 = inv[3] * su0 + inv[4] * su1 + inv[5] * su2;
  const c2 = inv[6] * su0 + inv[7] * su1 + inv[8] * su2;
  return loc.map(({ t, u }) => u - (c0 + c1 * t + c2 * t * t));
}

/** Rejette les points à plus de 1,5 px d'une parabole ajustée dans le repère local du segment. */
export function parabolaInliers(pts: Pt[], a: Pt, b: Pt): Pt[] {
  if (pts.length < 6) return pts;
  const res = parabolaResiduals(pts, a, b);
  if (!res) return pts;
  return pts.filter((_, i) => Math.abs(res[i]) <= 1.5);
}

/**
 * Rejet itératif autour de la parabole (chemin polylignes, points sous-pixel denses) : après le seuil fixe de 1,5 px,
 * 3 passes à max(0,25 px, 3 σ), σ = 1,4826 × médiane des |résidus|. Écarte une portion d'arête décalée de 0,5–1,5 px
 * (bas de porte, appui de fenêtre, ombre) que le seuil fixe laisse passer et qui fausserait la courbure.
 */
export function robustParabolaInliers(pts: Pt[], a: Pt, b: Pt): Pt[] {
  let cur = parabolaInliers(pts, a, b);
  for (let pass = 0; pass < 3 && cur.length >= 6; pass++) {
    const res = parabolaResiduals(cur, a, b);
    if (!res) break;
    const sorted = res.map(Math.abs).sort((x, y) => x - y);
    const thr = Math.max(0.25, 3 * 1.4826 * sorted[Math.floor(sorted.length / 2)]);
    const next = cur.filter((_, i) => Math.abs(res[i]) <= thr);
    if (next.length === cur.length) break;
    cur = next;
  }
  return cur;
}

export function estimateRadialDistortion(img: GrayImage, lines: Array<{ a: Pt; b: Pt }>): DistortionEstimate {
  const size: ImageSize = { w: img.width, h: img.height };
  const minLen = 0.15 * Math.min(img.width, img.height);
  const minStrength = Math.max(2, 2 * noiseSigma(img));
  const tracks: Track[] = [];
  for (const l of lines) {
    const len = dist(l.a, l.b);
    if (len < minLen) continue;
    const pts = parabolaInliers(trackEdge(img, l.a, l.b, minStrength), l.a, l.b);
    if (pts.length >= 20) tracks.push({ pts, len, w: 1 });
  }
  if (tracks.length === 0) return { k1: 0, residualPct: 0 };
  const est = fitK1(tracks, size);
  return { k1: est.k1, residualPct: est.residualPct, rawK1: est.rawK1 };
}

/** Ligne suivie : points (image distordue), longueur de corde (px), poids par point dans le coût. */
interface Track {
  pts: Pt[];
  len: number;
  w: number;
}

/** Plage de recherche de k1 (modèle de division) : au-delà de ±0,06 on sort des objectifs de téléphone hors ultra grand-angle. */
const K_MIN = -0.06;
const K_MAX = 0.06;
/** Consensus : estimations par ligne à ±0,01 de la médiane. */
const K_CONSENSUS = 0.01;
/** Optimum à ≥ 0,045 (75 % de la plage) : ce n'est pas une droite distordue → pas de correction. */
const K_UNRELIABLE = 0.045;
/** Plage élargie (±0,15) pour l'optimum brut `rawK1` : couvre l'ultra grand-angle (k1 ≈ −0,12 à −0,25 sur le banc). */
const K_WIDE = 0.15;

/** k1 minimisant Σ poids × résidu² des droites ajustées aux points non distordus (grille + section dorée, consensus). */
function fitK1(tracks: Track[], size: ImageSize): DistortionEstimate & { linesUsed: number; rawK1: number } {
  const costOf = (subset: Track[], k: number): number => {
    let total = 0;
    for (const tr of subset) {
      const u = tr.pts.map((p) => undistortPoint(p, k, size));
      const fit = fitLineTLS(u) as { p: Pt; d: Pt }; // ≥ 20 points non confondus
      const line = lineFromPointDir(fit.p, fit.d);
      let s = 0;
      for (const q of u) {
        const r = pointLineDistance(line, q);
        s += r * r;
      }
      total += tr.w * s;
    }
    return total;
  };
  /** Minimisation 1-D : grille puis section dorée. */
  const minimize = (subset: Track[], kMin = K_MIN, kMax = K_MAX): number => {
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
  const consistent = tracks.filter((_, i) => Math.abs(perLineRaw[i] - med) <= K_CONSENSUS);
  let bestK = minimize(consistent);
  // Optimum au bord de la plage de recherche : l'arête suivie n'est pas une droite distordue (autre arête, bruit) →
  // on ne corrige pas (k1 = 0) et on rapporte la courbure brute, que l'appelant peut signaler.
  const unreliable = Math.abs(bestK) >= K_UNRELIABLE;
  // Optimum brut, pour signaler un ultra grand-angle : recherche élargie à ±0,15 seulement quand l'estimation est rejetée.
  const rawK1 = unreliable ? minimize(consistent, -K_WIDE, K_WIDE) : bestK;
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
  return { k1: bestK, residualPct: residual / consistent.length, linesUsed: consistent.length, rawK1 };
}

/** Résultat de l'estimation sur polylignes : nombre de lignes retenues par le consensus (0 = aucune ligne exploitable). */
export interface PolylineDistortionEstimate extends DistortionEstimate {
  linesUsed: number;
}

/**
 * Sensibilité d'une ligne à k1 (px) : flèche, après retrait de la composante affine, du déplacement normal induit par
 * k1 = 0,02. Une ligne qui passe par le centre de l'image (ou trop courte) reste droite quel que soit k1 : elle ne
 * renseigne pas sur la distorsion et brouillerait le consensus.
 */
export function lineDistortionLeverPx(pts: readonly Pt[], size: ImageSize): number {
  const a = pts[0];
  const b = pts[pts.length - 1];
  const len = dist(a, b);
  if (pts.length < 3 || len < 1e-9) return 0;
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -d.y, y: d.x };
  // (t, déplacement normal) pour k1 = 0,02, puis résidu max à la droite des moindres carrés (t → déplacement).
  const tv: Pt[] = pts.map((p) => {
    const u = undistortPoint(p, 0.02, size);
    return { x: (p.x - a.x) * d.x + (p.y - a.y) * d.y, y: (u.x - p.x) * n.x + (u.y - p.y) * n.y };
  });
  let st = 0, sv = 0, stt = 0, stv = 0;
  for (const q of tv) {
    st += q.x; sv += q.y; stt += q.x * q.x; stv += q.x * q.y;
  }
  const m = tv.length;
  // Les extrémités ont t = 0 et t = len > 0 : les t ne sont pas tous égaux, donc den > 0 (Cauchy-Schwarz).
  const den = m * stt - st * st;
  const slope = (m * stv - st * sv) / den;
  const icpt = (sv - slope * st) / m;
  let worst = 0;
  for (const q of tv) worst = Math.max(worst, Math.abs(q.y - (icpt + slope * q.x)));
  return worst;
}

/**
 * Une ligne dont la flèche induite par k1 = 0,02 est < 0,1 px (droite quasi radiale) n'informe pas sur k1 (voir
 * `lineDistortionLeverPx`). Seuil bas à dessein : sur le banc, le mur occupe le centre de l'image et ses arêtes n'ont que
 * 0,3–1 px de levier, mais restent informatives ensemble (moindres carrés) ; 0,5 px en écartait une sur quatre.
 */
const MIN_LEVER_PX = 0.1;

/**
 * Estimation de k1 sur des polylignes déjà échantillonnées (arêtes plafond / sol / côtés du mur affinées en pleine résolution,
 * haut de plinthe, montants de portes et fenêtres…), en coordonnées de l'image de taille `imageSize`. Chaque polyligne est
 * filtrée (parabole : 1,5 px puis rejet itératif à 3 σ, `robustParabolaInliers`), doit compter ≥ 20 points, mesurer ≥ 15 % du petit côté et être sensible à k1 ; son coût est
 * pondéré par sa longueur (poids par point = longueur / nombre de points : la densité d'échantillonnage n'intervient pas).
 */
export function estimateRadialDistortionFromPolylines(polylines: ReadonlyArray<readonly Pt[]>, imageSize: ImageSize): PolylineDistortionEstimate {
  const minLen = 0.15 * Math.min(imageSize.w, imageSize.h);
  const tracks: Track[] = [];
  for (const raw of polylines) {
    if (raw.length < 20) continue;
    const a = raw[0];
    const b = raw[raw.length - 1];
    const len = dist(a, b);
    if (len < minLen) continue;
    const pts = robustParabolaInliers(raw.slice(), a, b);
    if (pts.length < 20 || lineDistortionLeverPx(pts, imageSize) < MIN_LEVER_PX) continue;
    tracks.push({ pts, len, w: len / pts.length });
  }
  if (tracks.length === 0) return { k1: 0, residualPct: 0, linesUsed: 0 };
  return fitK1(tracks, imageSize);
}
