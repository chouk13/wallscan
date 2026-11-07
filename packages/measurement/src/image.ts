/**
 * Noyau image en TypeScript pur : niveaux de gris, réduction, flou gaussien séparable, gradient de Sobel,
 * image intégrale, interpolation bilinéaire, estimation du bruit. Convention : le pixel (i, j) couvre [i, i+1[ × [j, j+1[,
 * son centre est en (i + 0,5, j + 0,5) ; toutes les coordonnées continues suivent cette convention.
 */
import type { GrayImage } from "@wallscan/core";

export function makeGray(width: number, height: number, fill = 0): GrayImage {
  const data = new Uint8ClampedArray(Math.max(0, width * height));
  if (fill !== 0) data.fill(fill);
  return { width, height, data };
}

/** RGBA (4 octets/pixel) → gris (luma Rec. 601). */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const n = width * height;
  const out = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000; // Uint8ClampedArray arrondit
  }
  return { width, height, data: out };
}

/** Réduction par moyenne de blocs factor × factor (facteur entier ≥ 1). */
export function downsampleBox(img: GrayImage, factor: number): GrayImage {
  const f = Math.max(1, Math.floor(factor));
  if (f === 1) return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  const out = new Uint8ClampedArray(w * h);
  const inv = 1 / (f * f);
  const src = img.data;
  const sw = img.width;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) {
        let idx = (y * f + dy) * sw + x * f;
        for (let dx = 0; dx < f; dx++) s += src[idx++];
      }
      out[y * w + x] = s * inv;
    }
  }
  return { width: w, height: h, data: out };
}

/** Facteur de réduction entier pour que le côté long ≤ maxSide. */
export function workFactor(width: number, height: number, maxSide = 2048): number {
  return Math.max(1, Math.ceil(Math.max(width, height) / maxSide));
}

/** Image de travail : réduite d'un facteur entier pour que le côté long ≤ maxSide. */
export function workImage(img: GrayImage, maxSide = 2048): { img: GrayImage; factor: number } {
  const factor = workFactor(img.width, img.height, maxSide);
  return { img: factor === 1 ? img : downsampleBox(img, factor), factor };
}

export function toFloat(img: GrayImage): Float32Array {
  return Float32Array.from(img.data);
}

export function fromFloat(data: Float32Array, width: number, height: number): GrayImage {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0; i < out.length; i++) out[i] = data[i];
  return { width, height, data: out };
}

function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Flou gaussien séparable (bords répliqués). sigma ≤ 0 → copie. */
export function gaussianBlurF32(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
  if (sigma <= 0) return new Float32Array(src);
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  const clampTap = (v: number, max: number): number => (v < 0 ? 0 : v > max ? max : v);
  // Passe horizontale : intérieur sans test de bornes, bords répliqués.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const xEnd = width - r;
    for (let x = 0; x < width; x++) {
      let s = 0;
      if (x >= r && x < xEnd) {
        const base = row + x - r;
        for (let i = 0; i < k.length; i++) s += src[base + i] * k[i];
      } else {
        for (let i = -r; i <= r; i++) s += src[row + clampTap(x + i, width - 1)] * k[i + r];
      }
      tmp[row + x] = s;
    }
  }
  // Passe verticale.
  for (let y = 0; y < height; y++) {
    const inside = y >= r && y < height - r;
    for (let x = 0; x < width; x++) {
      let s = 0;
      if (inside) {
        let idx = (y - r) * width + x;
        for (let i = 0; i < k.length; i++, idx += width) s += tmp[idx] * k[i];
      } else {
        for (let i = -r; i <= r; i++) s += tmp[clampTap(y + i, height - 1) * width + x] * k[i + r];
      }
      out[y * width + x] = s;
    }
  }
  return out;
}

export function blurGray(img: GrayImage, sigma: number): GrayImage {
  return fromFloat(gaussianBlurF32(toFloat(img), img.width, img.height, sigma), img.width, img.height);
}

export interface Gradient {
  width: number;
  height: number;
  gx: Float32Array;
  gy: Float32Array;
  mag: Float32Array;
}

/** Gradient de Sobel (normalisé : /8), bords à zéro. */
export function sobel(src: Float32Array, width: number, height: number): Gradient {
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const mag = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const a = src[i - width - 1];
      const b = src[i - width];
      const c = src[i - width + 1];
      const d = src[i - 1];
      const f = src[i + 1];
      const g = src[i + width - 1];
      const h = src[i + width];
      const k = src[i + width + 1];
      const dx = (c + 2 * f + k - (a + 2 * d + g)) / 8;
      const dy = (g + 2 * h + k - (a + 2 * b + c)) / 8;
      gx[i] = dx;
      gy[i] = dy;
      mag[i] = Math.hypot(dx, dy);
    }
  }
  return { width, height, gx, gy, mag };
}

/** Image intégrale (w+1) × (h+1) en Float64 : S(x, y) = somme des pixels [0, x[ × [0, y[. */
export function integralImage(img: GrayImage): Float64Array {
  const w = img.width;
  const h = img.height;
  const out = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    const src = y * w;
    const o0 = (y + 1) * (w + 1);
    const o1 = y * (w + 1);
    for (let x = 0; x < w; x++) {
      row += img.data[src + x];
      out[o0 + x + 1] = out[o1 + x + 1] + row;
    }
  }
  return out;
}

/** Moyenne sur [x0, x1[ × [y0, y1[ (bornes recadrées) à partir de l'image intégrale. */
export function boxMean(integral: Float64Array, width: number, height: number, x0: number, y0: number, x1: number, y1: number): number {
  const ax = Math.max(0, Math.min(width, x0));
  const ay = Math.max(0, Math.min(height, y0));
  const bx = Math.max(0, Math.min(width, x1));
  const by = Math.max(0, Math.min(height, y1));
  if (bx <= ax || by <= ay) return 0;
  const area = (bx - ax) * (by - ay);
  const s = width + 1;
  const sum = integral[by * s + bx] - integral[ay * s + bx] - integral[by * s + ax] + integral[ay * s + ax];
  return sum / area;
}

/** Interpolation bilinéaire en coordonnées continues (centre du pixel en i + 0,5), bords répliqués. */
export function bilinear(img: GrayImage, x: number, y: number): number {
  const w = img.width;
  const h = img.height;
  let fx = x - 0.5;
  let fy = y - 0.5;
  if (fx < 0) fx = 0;
  else if (fx > w - 1) fx = w - 1;
  if (fy < 0) fy = 0;
  else if (fy > h - 1) fy = h - 1;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const tx = fx - x0;
  const ty = fy - y0;
  const d = img.data;
  const a = d[y0 * w + x0];
  const b = d[y0 * w + x1];
  const c = d[y1 * w + x0];
  const e = d[y1 * w + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
}

/**
 * Écart-type du bruit estimé de façon robuste (médiane des |différences horizontales| / (0,6745·√2)) sur un
 * sous-échantillon régulier. Insensible aux bords tant qu'ils occupent moins de la moitié des échantillons.
 */
export function noiseSigma(img: GrayImage): number {
  const w = img.width;
  const h = img.height;
  if (w < 2 || h < 1) return 0;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000)));
  const diffs: number[] = [];
  for (let y = 0; y < h; y += step) {
    const row = y * w;
    for (let x = 0; x + 1 < w; x += step) diffs.push(Math.abs(img.data[row + x] - img.data[row + x + 1]));
  }
  diffs.sort((a, b) => a - b);
  const med = diffs[Math.floor(diffs.length / 2)];
  return med / (0.6745 * Math.SQRT2);
}

/** Médiane d'un tableau de nombres (copie triée) ; 0 si vide. */
export function median(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return 0;
  const arr = Array.from(values).sort((a, b) => a - b);
  return arr[Math.floor(n / 2)];
}
