/**
 * Homographie plane : DLT normalisée (Hartley) à partir de n ≥ 4 correspondances (moindres carrés au-delà de 4),
 * inversion, application. Convention : H ligne par ligne, p' ∝ H · (x, y, 1)ᵀ.
 */
import type { Pt, Quad } from "@wallscan/core";
import { mat3ApplyPt, mat3Inv, mat3Mul, smallestEigenvector, type Mat3 } from "./linalg.js";

interface Normalization {
  t: Mat3;
  tInv: Mat3;
  pts: Pt[];
}

/** Translate le centroïde à l'origine et ramène la distance moyenne à √2. */
function normalizePoints(pts: readonly Pt[]): Normalization | null {
  const n = pts.length;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let mean = 0;
  for (const p of pts) mean += Math.hypot(p.x - cx, p.y - cy);
  mean /= n;
  if (!(mean > 1e-12)) return null;
  const s = Math.SQRT2 / mean;
  const t: Mat3 = [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
  const tInv: Mat3 = [1 / s, 0, cx, 0, 1 / s, cy, 0, 0, 1];
  return { t, tInv, pts: pts.map((p) => ({ x: (p.x - cx) * s, y: (p.y - cy) * s })) };
}

/**
 * Homographie src → dst par DLT normalisée. `null` si moins de 4 points, tailles différentes, points non finis
 * ou configuration dégénérée (3 points alignés parmi 4, etc.).
 */
export function homographyFromPoints(src: readonly Pt[], dst: readonly Pt[]): Mat3 | null {
  const n = src.length;
  if (n < 4 || dst.length !== n) return null;
  for (let i = 0; i < n; i++) {
    const a = src[i];
    const b = dst[i];
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return null;
  }
  const ns = normalizePoints(src);
  const nd = normalizePoints(dst);
  if (!ns || !nd) return null;
  // AᵀA (9 × 9) accumulée ligne par ligne : deux lignes par correspondance.
  const ata = new Array<number>(81).fill(0);
  const row = new Array<number>(9);
  const accumulate = (): void => {
    for (let i = 0; i < 9; i++) {
      const ri = row[i];
      if (ri === 0) continue;
      for (let j = 0; j < 9; j++) ata[i * 9 + j] += ri * row[j];
    }
  };
  for (let i = 0; i < n; i++) {
    const { x, y } = ns.pts[i];
    const { x: u, y: v } = nd.pts[i];
    row[0] = -x; row[1] = -y; row[2] = -1; row[3] = 0; row[4] = 0; row[5] = 0; row[6] = u * x; row[7] = u * y; row[8] = u;
    accumulate();
    row[0] = 0; row[1] = 0; row[2] = 0; row[3] = -x; row[4] = -y; row[5] = -1; row[6] = v * x; row[7] = v * y; row[8] = v;
    accumulate();
  }
  const h = smallestEigenvector(ata, 9);
  const H = mat3Mul(mat3Mul(nd.tInv, h), ns.t);
  return normalizeHomography(H);
}

/** Met H[8] à 1 quand c'est possible, sinon norme de Frobenius unitaire. `null` si non finie ou singulière. */
export function normalizeHomography(H: Mat3): Mat3 | null {
  let norm = 0;
  for (let i = 0; i < 9; i++) {
    if (!Number.isFinite(H[i])) return null;
    norm += H[i] * H[i];
  }
  norm = Math.sqrt(norm);
  if (!(norm > 1e-300)) return null;
  const out = Math.abs(H[8]) > 1e-9 * norm ? H.map((v) => v / H[8]) : H.map((v) => v / norm);
  return mat3Inv(out) ? out : null;
}

export function homographyQuadToQuad(a: Quad, b: Quad): Mat3 | null {
  return homographyFromPoints(a, b);
}

export function applyHomography(H: Mat3, p: Pt): Pt {
  return mat3ApplyPt(H, p);
}

export function applyHomographyToQuad(H: Mat3, q: Quad): Quad {
  return [applyHomography(H, q[0]), applyHomography(H, q[1]), applyHomography(H, q[2]), applyHomography(H, q[3])];
}

export function invertHomography(H: Mat3): Mat3 | null {
  const inv = mat3Inv(H);
  return inv ? normalizeHomography(inv) : null;
}

/** Compose une mise à l'échelle isotrope en sortie : S · H (plan cm → plan px quand s = px/cm). */
export function scaleHomography(H: Mat3, s: number): Mat3 {
  return [H[0] * s, H[1] * s, H[2] * s, H[3] * s, H[4] * s, H[5] * s, H[6], H[7], H[8]];
}

/** Compose une translation en sortie : T · H (décale l'origine du plan de (tx, ty)). */
export function translateHomography(H: Mat3, tx: number, ty: number): Mat3 {
  return [H[0] + tx * H[6], H[1] + tx * H[7], H[2] + tx * H[8], H[3] + ty * H[6], H[4] + ty * H[7], H[5] + ty * H[8], H[6], H[7], H[8]];
}

/** Rectangle (0,0)-(w,h) sous forme de Quad. */
export function rectQuad(w: number, h: number, x = 0, y = 0): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** Homographie quad → carré unité [0,1]². */
export function quadToUnitSquare(q: Quad): Mat3 | null {
  return homographyFromPoints(q, rectQuad(1, 1));
}

/** Erreur maximale de reprojection (px) de H sur des correspondances : contrôle de cohérence. */
export function reprojectionError(H: Mat3, src: readonly Pt[], dst: readonly Pt[]): number {
  let worst = 0;
  for (let i = 0; i < src.length; i++) {
    const p = applyHomography(H, src[i]);
    worst = Math.max(worst, Math.hypot(p.x - dst[i].x, p.y - dst[i].y));
  }
  return worst;
}
