import { describe, expect, it } from "vitest";
import { makeGray } from "../src/image.js";
import { longestRun, proposeCeilingNotches } from "../src/notches.js";

/** Mur redressé synthétique : fond texturé léger, poutre sombre collée au plafond sur [x0, x1), profondeur d. */
function wallWithBeam(w: number, h: number, x0: number, x1: number, d: number, shade = 150): ReturnType<typeof makeGray> {
  const img = makeGray(w, h, 225);
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inBeam = y < d && x >= x0 && x < x1;
      img.data[y * w + x] = Math.round((inBeam ? shade : 225) + (rnd() - 0.5) * 6);
    }
  return img;
}
const P = { minDepthPx: 10, maxDepthPx: 120, minSpanPx: 60, maxGapPx: 8 };

describe("décrochements au plafond", () => {
  it("poutre pleine largeur : proposée collée au plafond, bonne profondeur", () => {
    const img = wallWithBeam(400, 260, 0, 400, 40);
    const r = proposeCeilingNotches(img, P);
    expect(r).toHaveLength(1);
    expect(r[0].y).toBe(0);
    expect(r[0].x).toBeLessThanOrEqual(2);
    expect(r[0].w).toBeGreaterThanOrEqual(394);
    expect(Math.abs(r[0].h - 40)).toBeLessThanOrEqual(2);
    expect(r[0].confidence).toBeGreaterThan(0.6);
    expect(r[0].shadeDelta).toBeGreaterThan(50);
  });
  it("retombée partielle : portée horizontale retrouvée", () => {
    const img = wallWithBeam(400, 260, 120, 300, 55);
    const r = proposeCeilingNotches(img, P);
    expect(r).toHaveLength(1);
    expect(Math.abs(r[0].x - 120)).toBeLessThanOrEqual(3);
    expect(Math.abs(r[0].x + r[0].w - 300)).toBeLessThanOrEqual(3);
    expect(Math.abs(r[0].h - 55)).toBeLessThanOrEqual(2);
  });
  it("mur nu, simple trait de même teinte, image trop petite ou bornes incohérentes : rien", () => {
    expect(proposeCeilingNotches(wallWithBeam(400, 260, 0, 0, 0), P)).toEqual([]);
    const line = wallWithBeam(400, 260, 0, 0, 0);
    for (let x = 0; x < 400; x++) line.data[40 * 400 + x] = 120; // trait d'un pixel, même mur au-dessus et en dessous
    expect(proposeCeilingNotches(line, P)).toEqual([]);
    expect(proposeCeilingNotches(makeGray(10, 10, 0), P)).toEqual([]);
    expect(proposeCeilingNotches(wallWithBeam(400, 260, 0, 400, 40), { ...P, maxDepthPx: 5 })).toEqual([]);
    // bandes trop courtes : ignorées (une seule, ou trois morceaux séparés dont aucun n'atteint la portée minimale)
    expect(proposeCeilingNotches(wallWithBeam(400, 260, 10, 50, 40), P)).toEqual([]);
    const pieces = wallWithBeam(400, 260, 0, 0, 0);
    for (const [a, b] of [[20, 60], [150, 190], [300, 340]]) for (let y = 0; y < 40; y++) for (let x = a; x < b; x++) pieces.data[y * 400 + x] = 150;
    expect(proposeCeilingNotches(pieces, P)).toEqual([]);
  });
  it("deux décrochements de profondeurs différentes : au plus deux propositions, la plus sûre d'abord", () => {
    const img = wallWithBeam(400, 300, 0, 180, 40);
    for (let y = 0; y < 90; y++) for (let x = 220; x < 400; x++) img.data[y * 400 + x] = 120;
    const r = proposeCeilingNotches(img, P);
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].confidence).toBeGreaterThanOrEqual(r[i].confidence);
  });
  it("longestRun : trous tolérés, fin de tableau, aucun drapeau", () => {
    const f = new Uint8Array([0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1]);
    expect(longestRun(f, 0)).toEqual({ lo: 5, hi: 9, filled: 4 });
    expect(longestRun(f, 1)).toEqual({ lo: 5, hi: 11, filled: 5 });
    expect(longestRun(f, 3)).toEqual({ lo: 1, hi: 11, filled: 7 });
    expect(longestRun(new Uint8Array([1, 1, 1]), 0)).toEqual({ lo: 0, hi: 3, filled: 3 });
    expect(longestRun(new Uint8Array([0, 0]), 0)).toBeNull();
  });
});
