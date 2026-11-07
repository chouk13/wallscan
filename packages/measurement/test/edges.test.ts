import { describe, expect, it } from "vitest";
import { cannyLite, houghSegments } from "../src/edges.js";
import { blurGray, makeGray } from "../src/image.js";

/** Image 200 × 160 avec un rectangle clair (bords à 0° / 90°) et deux bandes diagonales (45° / 135°). */
function testImage() {
  const w = 200;
  const h = 160;
  const img = makeGray(w, h, 60);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 60;
      if (x >= 30 && x < 120 && y >= 30 && y < 100) v = 200;
      if (x + y > 280) v = 180; // diagonale (135° dans le repère image)
      if (x - y > 120) v = 20; // diagonale (45°)
      img.data[y * w + x] = v;
    }
  }
  return blurGray(img, 0.8);
}

describe("arêtes et Hough probabiliste", () => {
  it("Canny allégé : arêtes fines dans les quatre orientations, seuil automatique", () => {
    const img = testImage();
    const e = cannyLite(img, 1.0);
    expect(e.high).toBeGreaterThan(2);
    let count = 0;
    for (const v of e.edges) count += v;
    // Périmètre du rectangle (≈ 320) + deux diagonales (≈ 2 × 120) : arêtes fines d'un pixel.
    expect(count).toBeGreaterThan(400);
    expect(count).toBeLessThan(1200);
    // Une image plate n'a aucune arête (seuil minimal appliqué).
    const flat = cannyLite(makeGray(50, 50, 100));
    expect(flat.edges.every((v) => v === 0)).toBe(true);
    expect(flat.high).toBe(2.5);
  });

  it("Hough : segments longs retrouvés avec les bons angles ; options", () => {
    const img = testImage();
    const e = cannyLite(img, 1.0);
    const segs = houghSegments(e, { threshold: 15, minLength: 40, maxGap: 3 });
    expect(segs.length).toBeGreaterThanOrEqual(4);
    const angles = segs.map((s) => (s.angle * 180) / Math.PI);
    expect(angles.some((a) => a < 3 || a > 177)).toBe(true); // horizontale
    expect(angles.some((a) => Math.abs(a - 90) < 3)).toBe(true); // verticale
    expect(angles.some((a) => Math.abs(a - 45) < 4 || Math.abs(a - 135) < 4)).toBe(true);
    for (const s of segs) {
      expect(s.support).toBeGreaterThan(0);
      expect(s.pixels.length).toBe(s.support);
      expect(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)).toBeGreaterThanOrEqual(40);
    }
    // Limite du nombre de segments et seuil inaccessible.
    expect(houghSegments(e, { threshold: 15, minLength: 40, maxSegments: 1 }).length).toBe(1);
    expect(houghSegments(e, { threshold: 100000 }).length).toBe(0);
    expect(houghSegments(e, { threshold: 15, minLength: 10000 }).length).toBe(0);
    // Graine différente : résultat déterministe pour une graine donnée.
    const a = houghSegments(e, { threshold: 15, minLength: 40, seed: 5 });
    const b = houghSegments(e, { threshold: 15, minLength: 40, seed: 5 });
    expect(a).toEqual(b);
    expect(houghSegments(e, { threshold: 15, minLength: 40, seed: 0 }).length).toBeGreaterThan(0);
  });

  it("Hough : ligne courbe suivie avec recentrage borné, trous tolérés", () => {
    const w = 300;
    const h = 120;
    const img = makeGray(w, h, 50);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Bord légèrement courbe (sagitta 3 px) avec un trou de 2 px.
        const yEdge = 60 + 3 * Math.pow((x - 150) / 150, 2);
        if (y > yEdge && !(x >= 150 && x < 152)) img.data[y * w + x] = 200;
      }
    }
    const e = cannyLite(blurGray(img, 0.8), 1.0);
    const segs = houghSegments(e, { threshold: 20, minLength: 60, maxGap: 4 });
    expect(segs.length).toBeGreaterThanOrEqual(1);
    const longest = segs.reduce((a, b) => (Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) > Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y) ? b : a));
    expect(Math.hypot(longest.b.x - longest.a.x, longest.b.y - longest.a.y)).toBeGreaterThan(120);
  });
});
