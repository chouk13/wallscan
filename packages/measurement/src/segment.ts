/**
 * Segmentation légère : seuillage adaptatif (moyenne locale par image intégrale), composantes connexes (8-connexité),
 * enveloppe convexe (chaîne monotone d'Andrew), approximation d'un quadrilatère par les diagonales.
 */
import type { GrayImage, Pt, Quad } from "@wallscan/core";
import { boxMean, integralImage } from "./image.js";
import { dist, lineThrough, pointLineDistance } from "./linalg.js";

/**
 * Masque binaire : `bright` → pixel > moyenne locale + offset ; sinon pixel < min(moyenne − offset, ratio · moyenne).
 * Le seuil relatif (`darkRatio`, défaut 0,55) évite d'absorber un mur sombre dans le masque « sombre » (cadre noir cherché).
 * La fenêtre (côté impair, px) doit être nettement plus grande que l'objet cherché.
 */
export function adaptiveMask(img: GrayImage, window: number, offset: number, bright: boolean, darkRatio = 0.55): Uint8Array {
  const w = img.width;
  const h = img.height;
  const integral = integralImage(img);
  const half = Math.max(1, Math.floor(window / 2));
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = y - half;
    const y1 = y + half + 1;
    for (let x = 0; x < w; x++) {
      const mean = boxMean(integral, w, h, x - half, y0, x + half + 1, y1);
      const v = img.data[y * w + x];
      mask[y * w + x] = bright ? (v > mean + offset ? 1 : 0) : v < Math.min(mean - offset, darkRatio * mean) ? 1 : 0;
    }
  }
  return mask;
}

export interface Component {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Pixels de bord (ayant un 4-voisin hors composante), en coordonnées de centre de pixel. */
  boundary: Pt[];
  /** Somme des positions (pour le centroïde). */
  cx: number;
  cy: number;
}

/**
 * Composantes connexes (8-connexité) d'un masque. Les composantes dont le côté de boîte dépasse `maxSide` ou dont l'aire
 * est inférieure à `minArea` sont ignorées (mais entièrement parcourues).
 */
export function connectedComponents(mask: Uint8Array, width: number, height: number, minArea: number, maxSide: number): Component[] {
  const labels = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  const out: Component[] = [];
  let next = 1;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || labels[start] !== 0) continue;
    const label = next++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let sx = 0;
    let sy = 0;
    const boundary: Pt[] = [];
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % width;
      const y = (i - x) / width;
      area++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      let isBoundary = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (mask[j] === 0) {
            if (dx === 0 || dy === 0) isBoundary = true;
            continue;
          }
          if (labels[j] === 0) {
            labels[j] = label;
            stack[sp++] = j;
          }
        }
      }
      if (isBoundary) boundary.push({ x: x + 0.5, y: y + 0.5 });
    }
    if (area < minArea) continue;
    if (maxX - minX + 1 > maxSide || maxY - minY + 1 > maxSide) continue;
    out.push({ area, minX, minY, maxX, maxY, boundary, cx: sx / area + 0.5, cy: sy / area + 0.5 });
  }
  return out;
}

/** Enveloppe convexe (sens horaire en repère image y vers le bas), sans points colinéaires. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function polygonArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Ordonne 4 points en TL, TR, BR, BL (sens horaire à partir du coin de plus petit x + y). */
export function orderQuad(pts: readonly Pt[]): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = pts.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0;
  for (let i = 1; i < 4; i++) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
  return [sorted[start], sorted[(start + 1) % 4], sorted[(start + 2) % 4], sorted[(start + 3) % 4]];
}

/**
 * Quadrilatère approchant une enveloppe convexe : diagonale = paire de sommets la plus éloignée, puis sommets les plus
 * éloignés de cette diagonale de part et d'autre. `null` si moins de 4 sommets ou aire nulle.
 */
export function quadFromHull(hull: readonly Pt[]): Quad | null {
  if (hull.length < 4) return null;
  let a = 0;
  let c = 0;
  let best = -1;
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      const d = dist(hull[i], hull[j]);
      if (d > best) {
        best = d;
        a = i;
        c = j;
      }
    }
  }
  if (!(best > 0)) return null;
  const diag = lineThrough(hull[a], hull[c]);
  let b = -1;
  let d = -1;
  let bestPos = 0;
  let bestNeg = 0;
  for (let i = 0; i < hull.length; i++) {
    const s = pointLineDistance(diag, hull[i]);
    if (s > bestPos) {
      bestPos = s;
      b = i;
    } else if (s < bestNeg) {
      bestNeg = s;
      d = i;
    }
  }
  if (b < 0 || d < 0) return null;
  return orderQuad([hull[a], hull[b], hull[c], hull[d]]);
}

/** Longueurs moyennes des côtés horizontaux et verticaux d'un quad ordonné. */
export function quadSides(q: Quad): { w: number; h: number } {
  return { w: (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, h: (dist(q[0], q[3]) + dist(q[1], q[2])) / 2 };
}

/** Centre (moyenne des coins). */
export function quadCenter(q: Quad): Pt {
  return { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
}
