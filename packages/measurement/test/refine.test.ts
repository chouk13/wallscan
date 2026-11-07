import { describe, expect, it } from "vitest";
import type { Pt, Quad } from "@wallscan/core";
import { blurGray, makeGray } from "../src/image.js";
import { findEdgeAlongNormal, fitLineRobust, innerNormal, refineCorners, refineCornersDetailed, smoothFloat, snapToEdge } from "../src/refine.js";
import { rendered } from "./scenes.js";

/** Image avec un rectangle clair aux bords sous-pixel (couverture analytique), légèrement floutée. */
function rectImage(w: number, h: number, x0: number, y0: number, x1: number, y1: number, bg = 60, fg = 220) {
  const img = makeGray(w, h, bg);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.max(0, Math.min(x + 1, x1) - Math.max(x, x0));
      const cy = Math.max(0, Math.min(y + 1, y1) - Math.max(y, y0));
      img.data[y * w + x] = bg + (fg - bg) * cx * cy;
    }
  }
  return blurGray(img, 0.7);
}

describe("affinage sous-pixel", () => {
  it("bord le long de la normale : position sous-pixel, polarité, seuil", () => {
    const img = rectImage(60, 40, 10.3, 8.6, 40.7, 30.2);
    // Bord gauche (x = 10,3) : normale +x, intérieur plus clair → signe +1.
    const e = findEdgeAlongNormal(img, { x: 12, y: 20 }, { x: 1, y: 0 }, 5, 1, 2)!;
    expect(e).not.toBeNull();
    expect(Math.abs(e.p.x - 10.3)).toBeLessThan(0.3);
    expect(e.strength).toBeGreaterThan(20);
    // Polarité opposée : rien (dérivée négative absente dans la fenêtre).
    expect(findEdgeAlongNormal(img, { x: 12, y: 20 }, { x: 1, y: 0 }, 1.5, -1, 2)).toBeNull();
    // Polarité libre.
    const free = findEdgeAlongNormal(img, { x: 12, y: 20 }, { x: 1, y: 0 }, 5, 0, 2)!;
    expect(Math.abs(free.p.x - 10.3)).toBeLessThan(0.3);
    // Zone uniforme : sous le seuil ; rayon invalide : null sans exception.
    expect(findEdgeAlongNormal(img, { x: 25, y: 20 }, { x: 1, y: 0 }, 3, 0, 2)).toBeNull();
    expect(findEdgeAlongNormal(img, { x: 12, y: 20 }, { x: 1, y: 0 }, 0, 1, 2)).toBeNull();
    expect(findEdgeAlongNormal(img, { x: 12, y: 20 }, { x: 1, y: 0 }, -3, 1, 2)).toBeNull();
    // Maximum sur le bord de la fenêtre : pas d'interpolation.
    const edgeOfWindow = findEdgeAlongNormal(img, { x: 7.3, y: 20 }, { x: 1, y: 0 }, 3, 1, 2)!;
    expect(edgeOfWindow).not.toBeNull();
    // Bord droit avec polarité -1 (intérieur = côté +x plus sombre).
    const right = findEdgeAlongNormal(img, { x: 39, y: 20 }, { x: 1, y: 0 }, 5, -1, 2)!;
    expect(Math.abs(right.p.x - 40.7)).toBeLessThan(0.3);
  });

  it("ajustement robuste : rejet des aberrants, cas limites", () => {
    const pts: Pt[] = [];
    for (let i = 0; i < 20; i++) pts.push({ x: i, y: 2 * i + 1 });
    pts.push({ x: 10, y: 80 }); // aberrant
    const f = fitLineRobust(pts)!;
    expect(f.inliers).toBe(20);
    expect(f.rms).toBeLessThan(1e-9);
    expect(Math.abs(f.d.y / f.d.x - 2)).toBeLessThan(1e-9);
    expect(fitLineRobust([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    // Tous les points confondus : TLS impossible.
    expect(fitLineRobust([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }])).toBeNull();
    // Points identiques sauf un : après rejet, trop peu d'inliers → on garde l'ajustement courant.
    const mostlySame = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 5 }];
    expect(fitLineRobust(mostlySame)).not.toBeNull();
    // Nuage où le rejet laisse exactement des points confondus : ajustement suivant impossible, on s'arrête proprement.
    const degenerate = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0.001 }];
    expect(fitLineRobust(degenerate, 4)).not.toBeNull();
    expect(innerNormal({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 1 });
    expect(innerNormal({ x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: -0, y: 1 });
  });

  it("refineCorners : quad grossier → coins sous-pixel ; côtés sans bord gardent leur droite", () => {
    const img = rectImage(120, 90, 20.4, 15.7, 90.2, 70.6);
    const coarse: Quad = [{ x: 18, y: 17 }, { x: 92, y: 14 }, { x: 89, y: 72 }, { x: 22, y: 69 }];
    const r = refineCornersDetailed(img, coarse, { radiusPx: 5 });
    expect(r.sides.every((s) => s.refined)).toBe(true);
    const truth: Quad = [{ x: 20.4, y: 15.7 }, { x: 90.2, y: 15.7 }, { x: 90.2, y: 70.6 }, { x: 20.4, y: 70.6 }];
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(r.quad[i].x - truth[i].x)).toBeLessThan(0.2);
      expect(Math.abs(r.quad[i].y - truth[i].y)).toBeLessThan(0.2);
    }
    expect(r.sides[0].polarity).toBe(1);
    const q2 = refineCorners(img, coarse, 5);
    expect(Math.abs(q2[2].x - 90.2)).toBeLessThan(0.2);
    // Image uniforme : aucun bord, quad inchangé.
    const flat = makeGray(120, 90, 100);
    const r2 = refineCornersDetailed(flat, coarse, { radiusPx: 5 });
    expect(r2.sides.every((s) => !s.refined)).toBe(true);
    expect(r2.quad).toEqual(coarse);
    // Côté dégénéré (longueur < 6 px) : non affiné, et intersection trop éloignée → coin d'origine.
    const tiny: Quad = [{ x: 50, y: 40 }, { x: 53, y: 40 }, { x: 53, y: 43 }, { x: 50, y: 43 }];
    const r3 = refineCornersDetailed(img, tiny, { radiusPx: 3 });
    expect(r3.quad).toEqual(tiny);
    // Seuil et nombre d'échantillons imposés.
    const r4 = refineCornersDetailed(img, coarse, { radiusPx: 5, minStrength: 1, maxSamples: 10, polarity: 1 });
    expect(r4.sides.every((s) => s.refined)).toBe(true);
  });

  it("refineCorners avec distorsion : coins de la mire retrouvés sur une scène rendue", () => {
    const s = rendered({ reference: "mire", k1: 0.015, yawDeg: 6, pitchDeg: -4 });
    const coarse = s.refQuad!.map((p) => ({ x: p.x + 1.5, y: p.y - 1 })) as Quad;
    const r = refineCornersDetailed(s.work, coarse, { radiusPx: 4, k1: 0.015, polarity: -1 });
    for (let i = 0; i < 4; i++) expect(Math.hypot(r.quad[i].x - s.refQuad![i].x, r.quad[i].y - s.refQuad![i].y)).toBeLessThan(0.4);
    const r0 = refineCorners(s.work, coarse, 4, 0.015);
    expect(Math.hypot(r0[0].x - s.refQuad![0].x, r0[0].y - s.refQuad![0].y)).toBeLessThan(0.5);
  });

  it("snapToEdge : coin → intersection, bord → point sous-pixel, rien → inchangé", () => {
    const img = rectImage(120, 90, 20.4, 15.7, 90.2, 70.6);
    const corner = snapToEdge(img, { x: 25, y: 20 }, 12);
    expect(Math.abs(corner.x - 20.4)).toBeLessThan(0.6);
    expect(Math.abs(corner.y - 15.7)).toBeLessThan(0.6);
    const edge = snapToEdge(img, { x: 24, y: 40 }, 8);
    expect(Math.abs(edge.x - 20.4)).toBeLessThan(0.6);
    expect(Math.abs(edge.y - 40)).toBeLessThan(2);
    const far = snapToEdge(img, { x: 55, y: 40 }, 6);
    expect(far).toEqual({ x: 55, y: 40 });
    expect(snapToEdge(img, { x: -50, y: -50 }, 3)).toEqual({ x: -50, y: -50 });
    // Bord horizontal (orientation verticale du gradient) et bord diagonal.
    const top = snapToEdge(img, { x: 50, y: 18 }, 8);
    expect(Math.abs(top.y - 15.7)).toBeLessThan(0.6);
    const diag = makeGray(80, 80, 50);
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if (x + y > 80) diag.data[y * 80 + x] = 200;
    const d = snapToEdge(blurGray(diag, 0.8), { x: 42, y: 42 }, 8);
    expect(Math.abs(d.x + d.y - 81)).toBeLessThan(1.5);
    const anti = makeGray(80, 80, 50);
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if (x - y > 0) anti.data[y * 80 + x] = 200;
    const a = snapToEdge(blurGray(anti, 0.8), { x: 42, y: 38 }, 8);
    expect(Math.abs(a.x - a.y - 1)).toBeLessThan(1.5);
    expect(smoothFloat(img, 1).length).toBe(120 * 90);
  });
});
