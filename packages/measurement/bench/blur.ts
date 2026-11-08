/** Flous synthétiques du banc (calibration de `sharpness`). */
import type { GrayImage } from "@wallscan/core";
import { bilinear } from "../src/image.js";

/** Flou de bougé : moyenne de 13 échantillons sur un segment de `lengthPx` dans la direction `angleDeg`. */
export function motionBlur(img: GrayImage, lengthPx: number, angleDeg: number): GrayImage {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const taps = 13;
  const out = new Uint8ClampedArray(img.width * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      let s = 0;
      for (let k = 0; k < taps; k++) {
        const t = (k / (taps - 1) - 0.5) * lengthPx;
        s += bilinear(img, x + 0.5 + t * dx, y + 0.5 + t * dy);
      }
      out[y * img.width + x] = s / taps;
    }
  }
  return { width: img.width, height: img.height, data: out };
}

/** Bougé horizontal exact (moyenne glissante sur `len` px, bords répliqués), comme bench/realism.ts. */
export function motionBlurH(img: GrayImage, len: number): GrayImage {
  const w = img.width;
  const out = new Uint8ClampedArray(img.data.length);
  const half = len / 2;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let wsum = 0;
      for (let t = Math.floor(x - half); t <= Math.ceil(x + half); t++) {
        // Poids = recouvrement du pixel t avec la fenêtre [x − L/2, x + L/2] (centres en t + 0,5).
        const wt = Math.max(0, Math.min(t + 1, x + 0.5 + half) - Math.max(t, x + 0.5 - half));
        if (wt <= 0) continue;
        s += wt * img.data[y * w + Math.max(0, Math.min(w - 1, t))];
        wsum += wt;
      }
      out[y * w + x] = s / wsum;
    }
  }
  return { width: w, height: img.height, data: out };
}
