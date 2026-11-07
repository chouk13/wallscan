/**
 * Image redressée : rééchantillonnage inverse (bilinéaire) par l'homographie image → plan, avec distorsion optionnelle.
 */
import type { GrayImage } from "@wallscan/core";
import { distortPoint } from "./distortion.js";
import { invertHomography } from "./homography.js";
import { bilinear, makeGray } from "./image.js";
import type { Mat3 } from "./linalg.js";

/**
 * `H` : coordonnées (non distordues) de `img` → pixels de sortie. Pour obtenir l'image redressée d'un survey :
 * `warpToPlane(img, scaleHomography(survey.homography, s), round(W·s), round(H·s), survey.distortionK1)`.
 * Pixels hors source : 0. Homographie non inversible : image noire (jamais d'exception).
 */
export function warpToPlane(img: GrayImage, H: Mat3, outW: number, outH: number, k1 = 0): GrayImage {
  const w = Math.max(0, Math.floor(outW));
  const h = Math.max(0, Math.floor(outH));
  const out = makeGray(w, h);
  const inv = invertHomography(H);
  if (!inv || w === 0 || h === 0) return out;
  const size = { w: img.width, h: img.height };
  for (let v = 0; v < h; v++) {
    const y = v + 0.5;
    for (let u = 0; u < w; u++) {
      const x = u + 0.5;
      const den = inv[6] * x + inv[7] * y + inv[8];
      if (Math.abs(den) < 1e-12) continue;
      let sx = (inv[0] * x + inv[1] * y + inv[2]) / den;
      let sy = (inv[3] * x + inv[4] * y + inv[5]) / den;
      if (k1 !== 0) {
        const p = distortPoint({ x: sx, y: sy }, k1, size);
        sx = p.x;
        sy = p.y;
      }
      if (sx < 0 || sy < 0 || sx > img.width || sy > img.height) continue;
      out.data[v * w + u] = bilinear(img, sx, sy);
    }
  }
  return out;
}
