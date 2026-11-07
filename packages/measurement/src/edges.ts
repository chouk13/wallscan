/**
 * Carte d'arêtes (Canny allégé : Sobel → suppression des non-maxima → hystérésis) et transformée de Hough
 * probabiliste (segments), en TypeScript pur, déterministe (générateur à graine fixe).
 */
import type { GrayImage, Pt } from "@wallscan/core";
import { gaussianBlurF32, sobel, toFloat, type Gradient } from "./image.js";

export interface EdgeMap {
  width: number;
  height: number;
  edges: Uint8Array;
  gradient: Gradient;
  /** Seuil haut utilisé. */
  high: number;
}

/** Suppression des non-maxima + hystérésis. Seuils automatiques : haut = max(minHigh, k · médiane du gradient). */
export function cannyLite(img: GrayImage, sigma = 1.0, minHigh = 2.5, lowRatio = 0.4): EdgeMap {
  const w = img.width;
  const h = img.height;
  const sm = gaussianBlurF32(toFloat(img), w, h, sigma);
  const g = sobel(sm, w, h);
  // Médiane approchée du gradient (sous-échantillon).
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000)));
  for (let y = 1; y < h - 1; y += step) for (let x = 1; x < w - 1; x += step) sample.push(g.mag[y * w + x]);
  sample.sort((a, b) => a - b);
  const med = sample.length > 0 ? sample[Math.floor(sample.length / 2)] : 0;
  const high = Math.max(minHigh, 6 * med + 1);
  const low = high * lowRatio;
  const nms = new Uint8Array(w * h); // 0 : rien, 1 : faible, 2 : fort
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = g.mag[i];
      if (m < low) continue;
      const gx = g.gx[i];
      const gy = g.gy[i];
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
      nms[i] = m >= high ? 2 : 1;
    }
  }
  // Hystérésis : propagation depuis les pixels forts.
  const edges = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  for (let i = 0; i < nms.length; i++) {
    if (nms[i] !== 2 || edges[i] !== 0) continue;
    let sp = 0;
    stack[sp++] = i;
    edges[i] = 1;
    while (sp > 0) {
      const j = stack[--sp];
      const x = j % w;
      const y = (j - x) / w;
      // Les maxima sont à ≥ 1 px du bord : les voisins sont toujours dans l'image.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const k = (y + dy) * w + x + dx;
          if (nms[k] !== 0 && edges[k] === 0) {
            edges[k] = 1;
            stack[sp++] = k;
          }
        }
      }
    }
  }
  return { width: w, height: h, edges, gradient: g, high };
}

export interface Segment {
  a: Pt;
  b: Pt;
  /** Nombre de pixels d'arête sur le segment. */
  support: number;
  /** Angle de la direction (rad, [0, π[). */
  angle: number;
  /** Pixels d'arête du segment (centres), pour un ajustement précis de la droite. */
  pixels: Pt[];
}

export interface HoughOptions {
  rhoRes?: number;
  thetaResDeg?: number;
  threshold?: number;
  minLength?: number;
  maxGap?: number;
  seed?: number;
  maxSegments?: number;
}

function xorshift(seed: number): () => number {
  let s = seed >>> 0 || 0x1234567;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * Hough probabiliste progressive (à la OpenCV `HoughLinesP`) avec suivi de l'arête pendant la marche (recentrage ±1 px),
 * ce qui tolère la quantification angulaire et une légère courbure (distorsion).
 */
export function houghSegments(edgeMap: EdgeMap, opts: HoughOptions = {}): Segment[] {
  const w = edgeMap.width;
  const h = edgeMap.height;
  const rhoRes = opts.rhoRes ?? 1;
  const thetaRes = ((opts.thetaResDeg ?? 1) * Math.PI) / 180;
  const threshold = opts.threshold ?? 20;
  const minLength = opts.minLength ?? 30;
  const maxGap = opts.maxGap ?? 4;
  const maxSegments = opts.maxSegments ?? 400;
  const numTheta = Math.round(Math.PI / thetaRes);
  const maxRho = Math.ceil(Math.hypot(w, h));
  const numRho = Math.ceil((2 * maxRho) / rhoRes) + 1;
  const acc = new Int32Array(numTheta * numRho);
  const cosT = new Float64Array(numTheta);
  const sinT = new Float64Array(numTheta);
  for (let t = 0; t < numTheta; t++) {
    cosT[t] = Math.cos(t * thetaRes);
    sinT[t] = Math.sin(t * thetaRes);
  }
  const mask = new Uint8Array(edgeMap.edges);
  const points: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) points.push(i);
  // Mélange déterministe.
  const rnd = xorshift(opts.seed ?? 20261107);
  for (let i = points.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = points[i];
    points[i] = points[j];
    points[j] = tmp;
  }
  const rhoIndex = (x: number, y: number, t: number): number => Math.round((x * cosT[t] + y * sinT[t] + maxRho) / rhoRes);
  const segments: Segment[] = [];
  const maxDrift = 2.5; // px : tolérance d'écart à la droite votée (quantification angulaire), bloque le suivi des coins et des parallèles proches
  const walk = (x0: number, y0: number, dx: number, dy: number): { x: number; y: number; pts: number[] } => {
    // Marche depuis (x0, y0) dans la direction (dx, dy) (pas unitaire sur l'axe majeur) avec recentrage ±1 px borné.
    const pts: number[] = [];
    let x = x0;
    let y = y0;
    let lastX = x0;
    let lastY = y0;
    let gap = 0;
    let drift = 0;
    const major = Math.abs(dx) >= Math.abs(dy);
    for (let step = 1; step < Math.max(w, h); step++) {
      x += dx;
      y += dy;
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) break;
      let found = -1;
      let foundSgn = 0;
      for (let o = 0; o <= 2 && found < 0; o++) {
        for (let si = 0; si < (o === 0 ? 1 : 2); si++) {
          const sgn = o === 0 ? 0 : si === 0 ? -o : o;
          const xx = major ? xi : xi + sgn;
          const yy = major ? yi + sgn : yi;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = yy * w + xx;
          if (mask[k]) {
            found = k;
            foundSgn = sgn;
            break;
          }
        }
      }
      if (found >= 0 && Math.abs(drift + foundSgn * 0.5) <= maxDrift) {
        // Recentrage doux sur l'arête, borné par la dérive maximale.
        if (foundSgn !== 0) {
          drift += foundSgn * 0.5;
          if (major) y += foundSgn * 0.5;
          else x += foundSgn * 0.5;
        }
        pts.push(found);
        lastX = found % w;
        lastY = (found - lastX) / w;
        gap = 0;
      } else {
        gap++;
        if (gap > maxGap) break;
      }
    }
    return { x: lastX, y: lastY, pts };
  };
  for (const idx of points) {
    if (!mask[idx]) continue;
    const x = idx % w;
    const y = (idx - x) / w;
    // Vote.
    let bestT = -1;
    let bestV = 0;
    for (let t = 0; t < numTheta; t++) {
      const r = rhoIndex(x, y, t);
      const v = ++acc[t * numRho + r];
      if (v > bestV) {
        bestV = v;
        bestT = t;
      }
    }
    if (bestV < threshold) continue;
    // Direction de la droite : perpendiculaire à la normale (cos θ, sin θ).
    let dx = -sinT[bestT];
    let dy = cosT[bestT];
    const major = Math.abs(dx) >= Math.abs(dy);
    const scale = 1 / (major ? Math.abs(dx) : Math.abs(dy));
    dx *= scale;
    dy *= scale;
    const fwd = walk(x, y, dx, dy);
    const bwd = walk(x, y, -dx, -dy);
    const all = [idx, ...fwd.pts, ...bwd.pts];
    const a = { x: bwd.x + 0.5, y: bwd.y + 0.5 };
    const b = { x: fwd.x + 0.5, y: fwd.y + 0.5 };
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    // Retire les points du segment du masque et de l'accumulateur.
    for (const k of all) {
      mask[k] = 0;
      const px = k % w;
      const py = (k - px) / w;
      for (let t = 0; t < numTheta; t++) acc[t * numRho + rhoIndex(px, py, t)]--;
    }
    if (len >= minLength) {
      let angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (angle < 0) angle += Math.PI;
      if (angle >= Math.PI) angle -= Math.PI;
      const pixels: Pt[] = [];
      for (const k of all) {
        const px = k % w;
        pixels.push({ x: px + 0.5, y: (k - px) / w + 0.5 });
      }
      segments.push({ a, b, support: all.length, angle, pixels });
      if (segments.length >= maxSegments) break;
    }
  }
  return segments;
}
