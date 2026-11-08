import { describe, expect, it } from "vitest";
import type { GrayImage, Quad } from "@wallscan/core";
import { blurGray, makeGray } from "../src/image.js";
import {
  CONSISTENCY_CHECK_PCT, CONSISTENCY_OK_PCT, FUSE_MAX_SPREAD_PX, SHARPNESS_BLURRY_BLUR_PX, SHARPNESS_SOFT_BLUR_PX, consistency, fuseQuads, sharpness,
} from "../src/quality.js";
import { motionBlurH } from "../bench/blur.js";
import { gaussianNoise, mulberry32 } from "../bench/random.js";
import { rendered } from "./scenes.js";

/** Damier de cases 24 px (bords dans les deux directions), flou d'optique σ 0,8. */
function checker(w: number, h: number, lo: number, hi: number, cell = 24): GrayImage {
  const img = makeGray(w, h, lo);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0) img.data[y * w + x] = hi;
  return blurGray(img, 0.8);
}

describe("sharpness — largeur de flou estimée, robuste au bruit", () => {
  it("scène du banc : nette → sharp, σ 2 → blurry, bougé 8 px → blurry, bruit fort après flou sans effet", () => {
    const s = rendered({ reference: "a4", distanceCm: 420 });
    const sharp = sharpness(s.work);
    expect(sharp.verdict).toBe("sharp");
    expect(sharp.blurPx).toBeLessThan(SHARPNESS_SOFT_BLUR_PX);
    expect(sharp.score).toBeCloseTo(1 / sharp.blurPx, 10);
    expect(sharp.edgePixels).toBeGreaterThan(20);
    const b2 = sharpness(blurGray(s.work, 2));
    expect(b2.verdict).toBe("blurry");
    expect(b2.blurPx).toBeGreaterThanOrEqual(SHARPNESS_BLURRY_BLUR_PX);
    expect(sharpness(motionBlurH(s.work, 10)).verdict).toBe("blurry");
    // Bruit σ 8 ajouté APRÈS le flou : la netteté reste lisible (la variance du laplacien brute s'y trompait).
    const rng = mulberry32(4);
    const noisy = { ...s.work, data: new Uint8ClampedArray(s.work.data.length) };
    for (let i = 0; i < noisy.data.length; i++) noisy.data[i] = s.work.data[i] + 8 * gaussianNoise(rng);
    expect(sharpness(noisy).verdict).toBe("sharp");
    const noisyBlur = blurGray(s.work, 2);
    for (let i = 0; i < noisyBlur.data.length; i++) noisyBlur.data[i] = noisyBlur.data[i] + 8 * gaussianNoise(rng);
    expect(sharpness(noisyBlur).verdict).toBe("blurry");
    // Flou intermédiaire : soft.
    expect(sharpness(blurGray(s.work, 1.6)).verdict).toBe("soft");
  });

  it("indépendante de l'exposition ; bougé directionnel ; ROI", () => {
    const bright = checker(300, 240, 40, 220);
    const dim = checker(300, 240, 20, 130);
    const a = sharpness(bright).blurPx;
    expect(Math.abs(a - sharpness(dim).blurPx) / a).toBeLessThan(0.05);
    const moved = sharpness(motionBlurH(bright, 10));
    expect(moved.blurPx).toBeGreaterThan(2 * a);
    expect(moved.verdict).toBe("blurry");
    const half = makeGray(300, 240, 90);
    for (let y = 0; y < 240; y++) for (let x = 0; x < 150; x++) half.data[y * 300 + x] = bright.data[y * 300 + x];
    expect(sharpness(half, { x: 180, y: 20, w: 100, h: 200 })).toEqual({ score: 0, verdict: "blurry", blurPx: Number.POSITIVE_INFINITY, edgePixels: 0 });
    expect(sharpness(half, { x: -50, y: -50, w: 220, h: 400 }).verdict).toBe("sharp");
    expect(sharpness(half, { x: 10, y: 10, w: 1, h: 50 }).verdict).toBe("blurry");
  });

  it("une seule direction de bords ; bords très étalés comptés à la borne ; rampes ignorées ; image vide", () => {
    const stripes = makeGray(300, 200, 50);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 300; x++) if (Math.floor(x / 24) % 2 === 0) stripes.data[y * 300 + x] = 200;
    expect(sharpness(blurGray(stripes, 0.8)).verdict).toBe("sharp");
    // Bords σ 4 : au-delà de la portée ±8 px, comptés à la borne (≈ 3 px) → blurry.
    const wide = makeGray(400, 200, 50);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 400; x++) if (Math.floor(x / 40) % 2 === 0) wide.data[y * 400 + x] = 220;
    const w4 = sharpness(blurGray(wide, 4));
    expect(w4.verdict).toBe("blurry");
    expect(w4.blurPx).toBeGreaterThan(2.9);
    // Rampe linéaire douce (pas un bord) : aucune mesure.
    // Rampe linéaire exacte de 2 niveaux/px : contraste 32 sur ±8 px (retenu) mais σ équivalent = 16 / √(2π) ≈ 6,4 px > 6
    // → rampe, ignorée (une rampe linéaire donne toujours 6,4 px quelle que soit sa pente).
    const ramp = makeGray(110, 120, 0);
    for (let y = 0; y < 120; y++) for (let x = 0; x < 110; x++) ramp.data[y * 110 + x] = 20 + x * 2;
    expect(sharpness(ramp)).toEqual({ score: 0, verdict: "blurry", blurPx: Number.POSITIVE_INFINITY, edgePixels: 0 });
    expect(sharpness(makeGray(0, 0)).verdict).toBe("blurry");
    expect(sharpness(makeGray(200, 200, 120)).score).toBe(0);
  });
});

describe("fuseQuads — fusion robuste", () => {
  const base: Quad = [{ x: 100, y: 80 }, { x: 900, y: 90 }, { x: 910, y: 600 }, { x: 95, y: 610 }];
  const noisy = (seed: number, sigma: number): Quad => {
    const rng = mulberry32(seed);
    return base.map((p) => ({ x: p.x + sigma * gaussianNoise(rng), y: p.y + sigma * gaussianNoise(rng) })) as Quad;
  };

  it("nominal : médiane coin par coin, aberrant rejeté, écart = médiane des distances", () => {
    const quads = [noisy(1, 1), noisy(2, 1), noisy(3, 1), noisy(4, 1), noisy(5, 1)];
    const outlier = base.map((p, i) => (i === 2 ? { x: p.x + 40, y: p.y - 25 } : p)) as Quad;
    const f = fuseQuads([...quads, outlier])!;
    expect(f.used).toBe(5);
    expect(f.spreadPx).toBeGreaterThan(0);
    expect(f.spreadPx).toBeLessThan(3);
    for (let c = 0; c < 4; c++) expect(Math.hypot(f.quad[c].x - base[c].x, f.quad[c].y - base[c].y)).toBeLessThan(2);
    // Nombre pair : moyenne des deux valeurs centrales.
    const two = fuseQuads([base, base.map((p) => ({ x: p.x + 2, y: p.y })) as Quad])!;
    expect(two.quad[0].x).toBe(101);
    expect(two.spreadPx).toBe(1);
    expect(two.used).toBe(2);
    // Seuil fourni : 1 px rejette tout le monde.
    expect(fuseQuads(quads, { maxSpreadPx: 0.1 })).toBeNull();
    expect(FUSE_MAX_SPREAD_PX).toBe(8);
  });

  it("dégradé / vide : < 2 quads valides → null ; quads non finis ignorés", () => {
    expect(fuseQuads([])).toBeNull();
    expect(fuseQuads([base])).toBeNull();
    const nan = base.map((p, i) => (i === 0 ? { x: Number.NaN, y: p.y } : p)) as Quad;
    expect(fuseQuads([base, nan])).toBeNull();
    expect(fuseQuads([base, nan, base])!.used).toBe(2);
    // Deux détections incompatibles (autre ligne retenue) : aucune n'est la bonne → null.
    const far = base.map((p) => ({ x: p.x, y: p.y + 30 })) as Quad;
    expect(fuseQuads([base, far])).toBeNull();
  });
});

describe("consistency — hauteur connue", () => {
  it("seuils 1,5 % / 4 %, écart signé", () => {
    expect(consistency({ heightCm: 251 }, 250)).toEqual({ deltaPct: 0.4, verdict: "ok" });
    expect(consistency({ heightCm: 250 * (1 + CONSISTENCY_OK_PCT / 100) }, 250).verdict).toBe("ok");
    const c = consistency({ heightCm: 242 }, 250);
    expect(c.verdict).toBe("check");
    expect(c.deltaPct).toBeCloseTo(-3.2, 10);
    expect(consistency({ heightCm: 250 * (1 + CONSISTENCY_CHECK_PCT / 100) }, 250).verdict).toBe("check");
    expect(consistency({ heightCm: 270 }, 250).verdict).toBe("mismatch");
    expect(consistency({ heightCm: 0 }, 250)).toEqual({ deltaPct: -100, verdict: "mismatch" });
  });

  it("entrées invalides : NaN et « check »", () => {
    for (const known of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = consistency({ heightCm: 250 }, known);
      expect(Number.isNaN(r.deltaPct)).toBe(true);
      expect(r.verdict).toBe("check");
    }
    expect(consistency({ heightCm: Number.NaN }, 250).verdict).toBe("check");
  });
});
