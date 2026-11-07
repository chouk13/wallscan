import { describe, expect, it } from "vitest";
import type { Pt, Quad } from "@wallscan/core";
import { makeGray } from "../src/image.js";
import { adaptiveMask, connectedComponents, convexHull, orderQuad, polygonArea, quadCenter, quadFromHull, quadSides } from "../src/segment.js";

function withRect(w: number, h: number, bg: number, rect: [number, number, number, number], shade: number) {
  const img = makeGray(w, h, bg);
  const [x0, y0, rw, rh] = rect;
  for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) img.data[y * w + x] = shade;
  return img;
}

describe("segmentation", () => {
  it("masque adaptatif clair / sombre et composantes connexes", () => {
    const img = withRect(60, 40, 100, [10, 10, 12, 16], 200);
    const bright = adaptiveMask(img, 31, 10, true);
    const comps = connectedComponents(bright, 60, 40, 10, 100);
    expect(comps.length).toBe(1);
    const c = comps[0];
    expect(c.area).toBe(12 * 16);
    expect([c.minX, c.minY, c.maxX, c.maxY]).toEqual([10, 10, 21, 25]);
    expect(c.boundary.length).toBe(2 * 12 + 2 * 16 - 4);
    expect(c.cx).toBeCloseTo(16, 9);
    const dark = adaptiveMask(withRect(60, 40, 200, [10, 10, 12, 16], 20), 31, 10, false);
    expect(connectedComponents(dark, 60, 40, 10, 100).length).toBe(1);
    // Filtres : aire minimale, côté maximal.
    expect(connectedComponents(bright, 60, 40, 1000, 100).length).toBe(0);
    expect(connectedComponents(bright, 60, 40, 10, 8).length).toBe(0);
    // Composante touchant le bord de l'image : pixels de bord comptés.
    const edge = adaptiveMask(withRect(30, 30, 100, [0, 0, 5, 5], 200), 15, 10, true);
    const ec = connectedComponents(edge, 30, 30, 1, 100);
    expect(ec.length).toBeGreaterThanOrEqual(1);
    expect(ec[0].boundary.some((p) => p.x === 0.5 && p.y === 0.5)).toBe(true);
  });

  it("enveloppe convexe, aire, ordre des coins", () => {
    expect(convexHull([{ x: 0, y: 0 }, { x: 1, y: 1 }]).length).toBe(2);
    const pts: Pt[] = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }, { x: 2, y: 1 }, { x: 2, y: 0 }];
    const hull = convexHull(pts);
    expect(hull.length).toBe(4);
    expect(polygonArea(hull)).toBe(12);
    const q = orderQuad([{ x: 4, y: 3 }, { x: 0, y: 3 }, { x: 4, y: 0 }, { x: 0, y: 0 }]);
    expect(q[0]).toEqual({ x: 0, y: 0 });
    expect(q[1]).toEqual({ x: 4, y: 0 });
    expect(q[2]).toEqual({ x: 4, y: 3 });
    expect(q[3]).toEqual({ x: 0, y: 3 });
    expect(quadSides(q)).toEqual({ w: 4, h: 3 });
    expect(quadCenter(q)).toEqual({ x: 2, y: 1.5 });
  });

  it("quad depuis l'enveloppe : diagonale puis sommets extrêmes ; dégénérescences", () => {
    expect(quadFromHull([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    const same = [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }];
    expect(quadFromHull(same)).toBeNull();
    // Points alignés : aucun sommet hors de la diagonale.
    expect(quadFromHull([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }])).toBeNull();
    // Un seul côté de la diagonale.
    expect(quadFromHull([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 1 }])).toBeNull();
    const hull: Pt[] = [{ x: 0, y: 0 }, { x: 10, y: 1 }, { x: 11, y: 8 }, { x: 1, y: 7 }, { x: 5, y: 0.2 }];
    const q = quadFromHull(hull) as Quad;
    expect(q).not.toBeNull();
    expect(polygonArea(q)).toBeGreaterThan(60);
  });
});
