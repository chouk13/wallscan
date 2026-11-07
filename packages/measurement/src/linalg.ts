/**
 * Algèbre linéaire minimale, pure, déterministe : matrices 3 × 3 ligne par ligne, points homogènes,
 * valeurs propres d'une matrice symétrique (Jacobi cyclique). Aucune exception : `null` en cas de dégénérescence.
 */
import type { Pt } from "@wallscan/core";

/** Matrice 3 × 3, 9 valeurs ligne par ligne : [a b c ; d e f ; g h i]. */
export type Mat3 = number[];

export const EPS = 1e-12;

export function mat3Identity(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

/** Produit a · b. */
export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}

export function mat3Det(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** Inverse par la comatrice ; `null` si la matrice est singulière (relativement à sa norme). */
export function mat3Inv(m: Mat3): Mat3 | null {
  const det = mat3Det(m);
  let norm = 0;
  for (let i = 0; i < 9; i++) norm += m[i] * m[i];
  if (!Number.isFinite(det) || Math.abs(det) < EPS * Math.max(1, norm)) return null;
  const inv = 1 / det;
  return [
    (m[4] * m[8] - m[5] * m[7]) * inv,
    (m[2] * m[7] - m[1] * m[8]) * inv,
    (m[1] * m[5] - m[2] * m[4]) * inv,
    (m[5] * m[6] - m[3] * m[8]) * inv,
    (m[0] * m[8] - m[2] * m[6]) * inv,
    (m[2] * m[3] - m[0] * m[5]) * inv,
    (m[3] * m[7] - m[4] * m[6]) * inv,
    (m[1] * m[6] - m[0] * m[7]) * inv,
    (m[0] * m[4] - m[1] * m[3]) * inv,
  ];
}

/** Produit matrice · vecteur homogène (x, y, w). */
export function mat3ApplyH(m: Mat3, x: number, y: number, w: number): [number, number, number] {
  return [
    m[0] * x + m[1] * y + m[2] * w,
    m[3] * x + m[4] * y + m[5] * w,
    m[6] * x + m[7] * y + m[8] * w,
  ];
}

/**
 * Applique une transformation projective à un point (division par w). Si w ≈ 0 (point à l'infini),
 * w est remplacé par ±1e-12 : le résultat est fini mais énorme — l'appelant filtre avec `Number.isFinite` / bornes.
 */
export function mat3ApplyPt(m: Mat3, p: Pt): Pt {
  const [x, y, w] = mat3ApplyH(m, p.x, p.y, 1);
  const ws = Math.abs(w) < EPS ? (w < 0 ? -EPS : EPS) : w;
  return { x: x / ws, y: y / ws };
}

export function mat3Transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function mat3Scale(m: Mat3, s: number): Mat3 {
  return m.map((v) => v * s);
}

/**
 * Valeurs et vecteurs propres d'une matrice symétrique n × n (ligne par ligne) par rotations de Jacobi cycliques.
 * Retour : `values[k]` et `vectors` (colonne k = vecteur propre k, stocké ligne par ligne : vectors[i*n+k]).
 */
export function symmetricEigen(a: readonly number[], n: number): { values: number[]; vectors: number[] } {
  const m = a.slice();
  const v = new Array<number>(n * n).fill(0);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += m[p * n + q] * m[p * n + q];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = m[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = m[p * n + p];
        const aqq = m[q * n + q];
        const theta = (aqq - app) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = m[k * n + p];
          const akq = m[k * n + q];
          m[k * n + p] = c * akp - s * akq;
          m[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = m[p * n + k];
          const aqk = m[q * n + k];
          m[p * n + k] = c * apk - s * aqk;
          m[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p];
          const vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = new Array<number>(n);
  for (let i = 0; i < n; i++) values[i] = m[i * n + i];
  return { values, vectors: v };
}

/** Vecteur propre associé à la plus petite valeur propre d'une matrice symétrique n × n. */
export function smallestEigenvector(a: readonly number[], n: number): number[] {
  const { values, vectors } = symmetricEigen(a, n);
  let best = 0;
  for (let i = 1; i < n; i++) if (values[i] < values[best]) best = i;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = vectors[i * n + best];
  return out;
}

/** Droite homogène passant par deux points (a × b). */
export function lineThrough(a: Pt, b: Pt): [number, number, number] {
  return [a.y - b.y, b.x - a.x, a.x * b.y - a.y * b.x];
}

/** Intersection de deux droites homogènes ; `null` si parallèles (point à l'infini). */
export function intersectLines(l1: readonly number[], l2: readonly number[]): Pt | null {
  const x = l1[1] * l2[2] - l1[2] * l2[1];
  const y = l1[2] * l2[0] - l1[0] * l2[2];
  const w = l1[0] * l2[1] - l1[1] * l2[0];
  const scale = Math.hypot(l1[0], l1[1]) * Math.hypot(l2[0], l2[1]);
  if (!(Math.abs(w) > 1e-9 * Math.max(scale, EPS))) return null;
  return { x: x / w, y: y / w };
}

/** Intersection homogène (sans division) : utile pour les points de fuite, potentiellement à l'infini. */
export function intersectLinesH(l1: readonly number[], l2: readonly number[]): [number, number, number] {
  return [l1[1] * l2[2] - l1[2] * l2[1], l1[2] * l2[0] - l1[0] * l2[2], l1[0] * l2[1] - l1[1] * l2[0]];
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Ajustement d'une droite par moindres carrés totaux (axe principal). Retour : point moyen + direction unitaire,
 * ou `null` si moins de 2 points distincts.
 */
export function fitLineTLS(pts: readonly Pt[]): { p: Pt; d: Pt } | null {
  const n = pts.length;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx + syy < EPS) return null;
  // Vecteur propre principal de [[sxx, sxy], [sxy, syy]].
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let dx: number;
  let dy: number;
  if (Math.abs(sxy) > EPS) {
    dx = l1 - syy;
    dy = sxy;
  } else if (sxx >= syy) {
    dx = 1;
    dy = 0;
  } else {
    dx = 0;
    dy = 1;
  }
  const len = Math.hypot(dx, dy);
  return { p: { x: mx, y: my }, d: { x: dx / len, y: dy / len } };
}

/** Droite homogène à partir d'un point et d'une direction. */
export function lineFromPointDir(p: Pt, d: Pt): [number, number, number] {
  return lineThrough(p, { x: p.x + d.x, y: p.y + d.y });
}

/** Distance signée d'un point à une droite homogène normalisée. */
export function pointLineDistance(l: readonly number[], p: Pt): number {
  const n = Math.hypot(l[0], l[1]);
  return (l[0] * p.x + l[1] * p.y + l[2]) / (n > EPS ? n : EPS);
}
