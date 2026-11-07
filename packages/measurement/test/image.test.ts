import { describe, expect, it } from "vitest";
import {
  bilinear, blurGray, boxMean, downsampleBox, fromFloat, gaussianBlurF32, integralImage, makeGray, median, noiseSigma, sobel,
  toFloat, toGray, workFactor, workImage,
} from "../src/image.js";

describe("noyau image", () => {
  it("toGray : luma Rec. 601 arrondie", () => {
    const rgba = Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const g = toGray(rgba, 4, 1);
    expect(Array.from(g.data)).toEqual([76, 150, 29, 255]);
    expect(g.width).toBe(4);
  });

  it("réduction par blocs, facteur 1 = copie, image de travail", () => {
    const img = makeGray(4, 2);
    img.data.set([10, 20, 30, 40, 50, 60, 70, 80]);
    const half = downsampleBox(img, 2);
    expect(half.width).toBe(2);
    expect(Array.from(half.data)).toEqual([35, 55]);
    const copy = downsampleBox(img, 1);
    expect(copy.data).not.toBe(img.data);
    expect(Array.from(copy.data)).toEqual(Array.from(img.data));
    expect(workFactor(4000, 3000, 2048)).toBe(2);
    expect(workFactor(1000, 800)).toBe(1);
    const big = makeGray(4100, 100, 7);
    const w = workImage(big, 2048);
    expect(w.factor).toBe(3);
    expect(w.img.width).toBe(1366);
    const same = workImage(img, 2048);
    expect(same.img).toBe(img);
    expect(makeGray(2, 2, 9).data[3]).toBe(9);
  });

  it("flou gaussien : sigma nul = copie, bords répliqués, conservation de la moyenne", () => {
    const src = Float32Array.from([0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const same = gaussianBlurF32(src, 4, 4, 0);
    expect(same).not.toBe(src);
    expect(Array.from(same)).toEqual(Array.from(src));
    const b = gaussianBlurF32(src, 4, 4, 1);
    let sum = 0;
    for (const v of b) sum += v;
    expect(sum).toBeGreaterThan(80); // les bords répliqués perdent un peu, mais l'énergie reste
    expect(b[3]).toBeLessThan(100);
    const img = makeGray(10, 10, 100);
    img.data[55] = 0;
    const g = blurGray(img, 1.5);
    expect(g.data[55]).toBeGreaterThan(50);
    expect(g.data[0]).toBe(100);
    expect(fromFloat(toFloat(img), 10, 10).data[55]).toBe(0);
  });

  it("Sobel : marche verticale → gx, bords nuls", () => {
    const w = 6;
    const h = 5;
    const src = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src[y * w + x] = x >= 3 ? 100 : 0;
    const g = sobel(src, w, h);
    expect(g.gx[2 * w + 2]).toBeCloseTo(50, 6);
    expect(g.gy[2 * w + 2]).toBeCloseTo(0, 6);
    expect(g.mag[2 * w + 2]).toBeCloseTo(50, 6);
    expect(g.mag[0]).toBe(0);
  });

  it("image intégrale et moyenne de boîte (bornes recadrées, aire nulle)", () => {
    const img = makeGray(3, 2);
    img.data.set([1, 2, 3, 4, 5, 6]);
    const I = integralImage(img);
    expect(boxMean(I, 3, 2, 0, 0, 3, 2)).toBeCloseTo(3.5, 9);
    expect(boxMean(I, 3, 2, 1, 0, 2, 1)).toBe(2);
    expect(boxMean(I, 3, 2, -5, -5, 10, 10)).toBeCloseTo(3.5, 9);
    expect(boxMean(I, 3, 2, 2, 2, 1, 1)).toBe(0);
  });

  it("interpolation bilinéaire : centres de pixels, bords répliqués", () => {
    const img = makeGray(2, 2);
    img.data.set([0, 100, 200, 300 > 255 ? 255 : 300]);
    expect(bilinear(img, 0.5, 0.5)).toBe(0);
    expect(bilinear(img, 1.5, 0.5)).toBe(100);
    expect(bilinear(img, 1, 0.5)).toBe(50);
    expect(bilinear(img, -3, -3)).toBe(0);
    expect(bilinear(img, 10, 10)).toBe(255);
    expect(bilinear(img, 1, 1)).toBeCloseTo((0 + 100 + 200 + 255) / 4, 9);
  });

  it("bruit robuste et médiane", () => {
    expect(noiseSigma(makeGray(1, 1))).toBe(0);
    const flat = makeGray(50, 50, 100);
    expect(noiseSigma(flat)).toBe(0);
    const noisy = makeGray(60, 60, 100);
    for (let i = 0; i < noisy.data.length; i++) noisy.data[i] = 100 + ((i * 7919) % 11) - 5;
    expect(noiseSigma(noisy)).toBeGreaterThan(1);
    const large = makeGray(400, 400, 50);
    expect(noiseSigma(large)).toBe(0);
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median(Uint8ClampedArray.from([9, 1]))).toBe(9);
  });
});
