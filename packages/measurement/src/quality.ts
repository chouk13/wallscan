/**
 * Contrôles de qualité de prise de vue et de cohérence (lot « moteur v2 ») : netteté de l'image (demande de reprise),
 * fusion robuste de plusieurs quads (aperçu en direct, rafale), cohérence avec une hauteur connue. Purs, déterministes,
 * jamais d'exception.
 */
import type { GrayImage, Pt, Quad } from "@wallscan/core";
import { noiseSigma } from "./image.js";

/** Médiane vraie (moyenne des deux valeurs centrales en nombre pair). */
const medianOf = (v: number[]): number => {
  const s = v.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------------------------------------------------------------------------------------------------------------------
// Netteté
// ---------------------------------------------------------------------------------------------------------------------

export type SharpnessVerdict = "sharp" | "soft" | "blurry";

export interface SharpnessResult {
  /** 1 / `blurPx` (px⁻¹) : plus grand = plus net ; 0 si aucun bord exploitable. */
  score: number;
  verdict: SharpnessVerdict;
  /** Largeur de flou estimée (écart-type gaussien équivalent, px), direction la moins nette ; +∞ sans bord. */
  blurPx: number;
  /** Nombre de bords mesurés (direction retenue). */
  edgePixels: number;
}

/**
 * Seuils sur la largeur de flou estimée `blurPx` (image de travail ≤ 2 048 px), d'après docs/quality-thresholds.md (banc de
 * réalisme : refus si flou ajouté σ ≥ 2 px ou bougé ≥ 8 px, avertissement entre σ 1–2 px / bougé 4–8 px) et calibrés sur
 * `bench/sharpness.ts` (mêmes dégradations, bruit ajouté APRÈS le flou) : flou d'optique nominal σ 0,6–1,2 px → blurPx
 * ≈ 0,8–1,6 ; σ ajouté 2 → ≈ 2,3–2,7 ; bougé 8 px → ≈ 2,6–3,2 (un bougé de L px vaut σ ≈ L / √(2π) pour cet estimateur).
 * Voir docs/reports/measurement-v2-engine.md pour les distributions mesurées.
 */
export const SHARPNESS_SOFT_BLUR_PX = 1.75;
export const SHARPNESS_BLURRY_BLUR_PX = 2.1;
/**
 * Lissage préalable σ = 1 px (noyau binomial [1 4 6 4 1] / 16, variance exactement 1 px², 3× plus rapide que le flou gaussien
 * générique) : divise le bruit de la dérivée par ≈ 3,5 ; retranché en quadrature de la largeur mesurée.
 */
const SHARPNESS_PRESMOOTH = 1;

/** Lissage binomial séparable 5 × 5 ; les 2 px de bord (jamais lus par `sharpness`, marge ≥ 12 px) restent à 0. */
function binomialSmooth(img: GrayImage): Float32Array {
  const w = img.width;
  const h = img.height;
  const d = img.data;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 2; x < w - 2; x++) {
      const i = r + x;
      tmp[i] = (d[i - 2] + d[i + 2] + 4 * (d[i - 1] + d[i + 1]) + 6 * d[i]) / 16;
    }
  }
  for (let y = 2; y < h - 2; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const i = r + x;
      out[i] = (tmp[i - 2 * w] + tmp[i + 2 * w] + 4 * (tmp[i - w] + tmp[i + w]) + 6 * tmp[i]) / 16;
    }
  }
  return out;
}
/** Demi-portée (px) de la mesure du contraste de part et d'autre du bord : couvre ±3 σ jusqu'à σ ≈ 2,7 px. */
const SHARPNESS_REACH = 8;
const SHARPNESS_MAX_SIGMA = SHARPNESS_REACH / 2.5;
const SHARPNESS_RAMP_SIGMA = 6;
/** Demi-fenêtre (px) du test de crête. */
const SHARPNESS_CREST = 3;
/** Bord retenu : contraste ≥ max(24 niveaux, 6 × bruit) et marche monotone (le contraste vaut ≥ 85 % de l'excursion). */
const SHARPNESS_MIN_CONTRAST = 24;
const SHARPNESS_CONTRAST_NOISE_K = 6;
const SHARPNESS_MONOTONIC = 0.85;
/** Sous 20 bords dans une direction, elle est ignorée ; aucune direction mesurable → « blurry » (reprise demandée). */
const SHARPNESS_MIN_EDGES = 20;
/** Pas d'échantillonnage des bords (px) : 1 pixel sur 2 en x et en y suffit et divise le temps par 4. */
const SHARPNESS_STRIDE = 2;

/**
 * Netteté robuste au bruit : sur l'image lissée (σ 1), pour chaque bord net isolé (maximum local du gradient dans sa
 * direction dominante, marche monotone de contraste C sur ±8 px), la largeur gaussienne équivalente vaut
 * σ = C / (√(2π) · pic du gradient) ; on retranche le lissage en quadrature et on prend la médiane par direction (x, y),
 * puis la direction la plus floue (le bougé n'étale qu'une direction). Indépendante de l'exposition (C et le gradient sont
 * proportionnels au contraste) ; le bruit, lissé puis noyé dans des marches ≥ 10 σ, ne biaise plus la mesure comme le faisait
 * la variance du laplacien brute. `roi` (px, recadrée à l'image) restreint la mesure.
 */
export function sharpness(img: GrayImage, roi?: { x: number; y: number; w: number; h: number }): SharpnessResult {
  const blurry: SharpnessResult = { score: 0, verdict: "blurry", blurPx: Number.POSITIVE_INFINITY, edgePixels: 0 };
  const W = img.width;
  const H = img.height;
  const R = SHARPNESS_REACH;
  const M = R + SHARPNESS_CREST + 1;
  const x0 = Math.max(M, Math.floor(roi?.x ?? 0));
  const y0 = Math.max(M, Math.floor(roi?.y ?? 0));
  const x1 = Math.min(W - M, Math.ceil(roi ? roi.x + roi.w : W));
  const y1 = Math.min(H - M, Math.ceil(roi ? roi.y + roi.h : H));
  if (!(x1 - x0 >= 3) || !(y1 - y0 >= 3)) return blurry;
  const sm = binomialSmooth(img);
  const minC = Math.max(SHARPNESS_MIN_CONTRAST, SHARPNESS_CONTRAST_NOISE_K * noiseSigma(img));
  const k = 1 / Math.sqrt(2 * Math.PI);
  const widths: [number[], number[]] = [[], []];
  for (let y = y0; y < y1; y += SHARPNESS_STRIDE) {
    for (let x = x0; x < x1; x += SHARPNESS_STRIDE) {
      const i = y * W + x;
      const gx = (sm[i + 1] - sm[i - 1]) / 2;
      const gy = (sm[i + W] - sm[i - W]) / 2;
      const ax = Math.abs(gx);
      const ay = Math.abs(gy);
      // Direction dominante (x : bord vertical) et pas correspondant dans le tableau.
      const dir = ax >= ay ? 0 : 1;
      const g = dir === 0 ? ax : ay;
      const step = dir === 0 ? 1 : W;
      const lo = sm[i - R * step];
      const hi = sm[i + R * step];
      const c = Math.abs(hi - lo);
      if (c < minC) continue;
      // Tests du moins cher au plus cher (la plupart des pixels sont plats et sortent ici).
      if ((c * k) / g > SHARPNESS_RAMP_SIGMA) continue; // g = 0 → +∞ : écarté
      // Crête du bord : gradient maximal sur ±3 px le long de sa direction (un pixel plat voisin d'un bord voit le gradient
      // croître vers le bord et est écarté).
      let crest = true;
      for (let t = -SHARPNESS_CREST; t <= SHARPNESS_CREST && crest; t++) {
        if (t !== 0 && Math.abs(sm[i + (t + 1) * step] - sm[i + (t - 1) * step]) / 2 > g) crest = false;
      }
      if (!crest) continue;
      let mn = Number.POSITIVE_INFINITY;
      let mx = Number.NEGATIVE_INFINITY;
      for (let t = -R; t <= R; t++) {
        const v = sm[i + t * step];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (c < SHARPNESS_MONOTONIC * (mx - mn)) continue;
      const sigmaTot = (c * k) / g;
      // σ > 6 px (écarté plus haut) : ce n'est pas un bord mais une rampe douce (dégradé d'éclairage, fond entre deux bords
      // proches) — sur le banc, population séparée des vrais bords (1–2 px nets, ≤ 5,7 px même pour un bougé de 14 px). Entre
      // 3,2 et 6 px : bord réel trop étalé pour la portée ±8 px, compté à la borne (il reste « flou »).
      const st = Math.min(SHARPNESS_MAX_SIGMA, sigmaTot);
      widths[dir].push(Math.sqrt(Math.max(0, st * st - SHARPNESS_PRESMOOTH * SHARPNESS_PRESMOOTH)));
    }
  }
  let blurPx = -1;
  let used = 0;
  for (const wv of widths) {
    if (wv.length < SHARPNESS_MIN_EDGES) continue;
    const med = medianOf(wv);
    if (med > blurPx) {
      blurPx = med;
      used = wv.length;
    }
  }
  if (blurPx < 0) return blurry;
  // Plancher 0,25 px : en deçà, la mesure est limitée par l'échantillonnage (score borné à 4).
  const b = Math.max(0.25, blurPx);
  const verdict: SharpnessVerdict = b >= SHARPNESS_BLURRY_BLUR_PX ? "blurry" : b >= SHARPNESS_SOFT_BLUR_PX ? "soft" : "sharp";
  return { score: 1 / b, verdict, blurPx: b, edgePixels: used };
}

// ---------------------------------------------------------------------------------------------------------------------
// Fusion de quads
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Écart maximal par défaut (px, image de travail) d'un coin au coin médian : au-delà, ce n'est pas la même détection
 * (autre ligne retenue, coin happé par une arête voisine) ; un tremblement de main en direct reste sous ~5 px.
 */
export const FUSE_MAX_SPREAD_PX = 8;

export interface FusedQuad {
  quad: Quad;
  /** Médiane des distances des coins retenus au coin médian (px). */
  spreadPx: number;
  /** Nombre de quads retenus. */
  used: number;
}

function medianQuad(quads: readonly Quad[]): Quad {
  const out: Pt[] = [];
  for (let c = 0; c < 4; c++) out.push({ x: medianOf(quads.map((q) => q[c].x)), y: medianOf(quads.map((q) => q[c].y)) });
  return out as Quad;
}

const maxCornerDist = (q: Quad, m: Quad): number => Math.max(...q.map((p, c) => Math.hypot(p.x - m[c].x, p.y - m[c].y)));

/**
 * Fusion robuste : médiane coin par coin (x et y séparément), rejet des quads dont un coin est à plus de `maxSpreadPx` du
 * coin médian, médiane recalculée sur les quads retenus. `null` si moins de 2 quads valides (finis et non rejetés).
 */
export function fuseQuads(quads: readonly Quad[], opts: { maxSpreadPx?: number } = {}): FusedQuad | null {
  const maxSpread = opts.maxSpreadPx ?? FUSE_MAX_SPREAD_PX;
  const valid = quads.filter((q) => q.length === 4 && q.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  if (valid.length < 2) return null;
  const first = medianQuad(valid);
  const kept = valid.filter((q) => maxCornerDist(q, first) <= maxSpread);
  if (kept.length < 2) return null;
  const quad = medianQuad(kept);
  const dists: number[] = [];
  for (const q of kept) for (let c = 0; c < 4; c++) dists.push(Math.hypot(q[c].x - quad[c].x, q[c].y - quad[c].y));
  return { quad, spreadPx: medianOf(dists), used: kept.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cohérence avec une hauteur connue
// ---------------------------------------------------------------------------------------------------------------------

/** Seuils (%) : ≤ 1,5 % cohérent (dans l'incertitude d'une mire) ; ≤ 4 % à vérifier (≈ 10 cm sur 2,5 m : erreur de saisie fréquente). */
export const CONSISTENCY_OK_PCT = 1.5;
export const CONSISTENCY_CHECK_PCT = 4;

export type ConsistencyVerdict = "ok" | "check" | "mismatch";

/**
 * Compare la hauteur mesurée à une hauteur connue (saisie par le client ou le vendeur : contrôle, jamais mesure).
 * `deltaPct` est signé (mesure − connue) / connue × 100 ; hauteur connue invalide → `NaN` et « check ».
 */
export function consistency(survey: { heightCm: number }, knownHeightCm: number): { deltaPct: number; verdict: ConsistencyVerdict } {
  if (!(knownHeightCm > 0) || !Number.isFinite(knownHeightCm) || !Number.isFinite(survey.heightCm)) return { deltaPct: Number.NaN, verdict: "check" };
  const deltaPct = ((survey.heightCm - knownHeightCm) / knownHeightCm) * 100;
  const a = Math.abs(deltaPct);
  return { deltaPct, verdict: a <= CONSISTENCY_OK_PCT ? "ok" : a <= CONSISTENCY_CHECK_PCT ? "check" : "mismatch" };
}
