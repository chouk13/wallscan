import { describe, expect, it } from "vitest";
import type { Pt, Quad } from "@wallscan/core";
import { distortPoint } from "../src/distortion.js";
import { estimateRadialDistortion, estimateRadialDistortionFromPolylines, lineDistortionLeverPx } from "../src/distortionEstimate.js";
import { makeGray } from "../src/image.js";
import { measurePhoto } from "../src/pipeline.js";
import { sampleQuadEdges } from "../src/wallRefine.js";
import { proposeWallCorners } from "../src/wallCorners.js";
import { quadCenter } from "../src/segment.js";
import { gaussianNoise, mulberry32 } from "../bench/random.js";
import { quadErr, rendered } from "./scenes.js";

const size = { w: 2048, h: 1536 };
/** Droite non distordue de a à b, échantillonnée en `n` points puis distordue par k1 (+ bruit gaussien σ px). */
function distortedLine(a: Pt, b: Pt, n: number, k1: number, sigma = 0, seed = 1): Pt[] {
  const rng = mulberry32(seed);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = distortPoint({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, k1, size);
    out.push({ x: p.x + sigma * gaussianNoise(rng), y: p.y + sigma * gaussianNoise(rng) });
  }
  return out;
}

describe("k1 sur polylignes échantillonnées", () => {
  it("nominal : 4 arêtes + montant de porte, k1 retrouvé à ±0,0005 (bruit 0,15 px)", () => {
    for (const k1 of [0.018, -0.012, 0.004]) {
      const lines = [
        distortedLine({ x: 150, y: 120 }, { x: 1900, y: 140 }, 100, k1, 0.15, 1),
        distortedLine({ x: 1900, y: 140 }, { x: 1880, y: 1400 }, 100, k1, 0.15, 2),
        distortedLine({ x: 1880, y: 1400 }, { x: 160, y: 1390 }, 100, k1, 0.15, 3),
        distortedLine({ x: 160, y: 1390 }, { x: 150, y: 120 }, 100, k1, 0.15, 4),
        distortedLine({ x: 400, y: 700 }, { x: 405, y: 1390 }, 60, k1, 0.15, 5),
      ];
      const est = estimateRadialDistortionFromPolylines(lines, size);
      expect(Math.abs(est.k1 - k1)).toBeLessThan(0.0005);
      expect(est.linesUsed).toBe(5);
      expect(est.residualPct).toBeLessThan(0.05);
    }
  });

  it("pondération par longueur : une longue arête l'emporte sur une courte arête bruitée", () => {
    const long = distortedLine({ x: 100, y: 100 }, { x: 1950, y: 110 }, 60, 0.015, 0.1, 1);
    const longB = distortedLine({ x: 1950, y: 1450 }, { x: 100, y: 1440 }, 60, 0.015, 0.1, 2);
    const shortNoisy = distortedLine({ x: 300, y: 300 }, { x: 640, y: 1250 }, 200, 0.015, 1.2, 3);
    const est = estimateRadialDistortionFromPolylines([long, longB, shortNoisy], size);
    expect(Math.abs(est.k1 - 0.015)).toBeLessThan(0.001);
  });

  it("dégradé / vide : lignes trop courtes, trop peu de points, passant par le centre, aberrantes", () => {
    expect(estimateRadialDistortionFromPolylines([], size)).toEqual({ k1: 0, residualPct: 0, linesUsed: 0 });
    const few = distortedLine({ x: 100, y: 100 }, { x: 1900, y: 100 }, 12, 0.01);
    const short = distortedLine({ x: 100, y: 100 }, { x: 200, y: 100 }, 40, 0.01);
    // Droites radiales : restent droites quel que soit k1 → aucune information (levier < 0,5 px).
    const radial = distortedLine({ x: 100, y: 768 }, { x: 1948, y: 768 }, 80, 0.01);
    const radial2 = distortedLine({ x: 1024, y: 50 }, { x: 1024, y: 1486 }, 80, 0.01);
    expect(lineDistortionLeverPx(radial, size)).toBeLessThan(0.5);
    expect(estimateRadialDistortionFromPolylines([few, short, radial, radial2], size).linesUsed).toBe(0);
    // Polyligne dont la plupart des points sont aberrants : moins de 20 inliers après la parabole → ignorée.
    const rng = mulberry32(9);
    const junk = Array.from({ length: 40 }, (_, i) => ({ x: 100 + i * 45, y: 200 + (i % 3 === 0 ? 0 : 60 * rng()) }));
    expect(estimateRadialDistortionFromPolylines([junk], size).linesUsed).toBe(0);
  });

  it("levier : cas limites", () => {
    expect(lineDistortionLeverPx([{ x: 0, y: 0 }, { x: 10, y: 0 }], size)).toBe(0);
    expect(lineDistortionLeverPx([{ x: 5, y: 5 }, { x: 9, y: 9 }, { x: 5, y: 5 }], size)).toBe(0);
    const top = distortedLine({ x: 100, y: 80 }, { x: 1950, y: 80 }, 50, 0);
    expect(lineDistortionLeverPx(top, size)).toBeGreaterThan(3);
  });

  it("scène rendue : arêtes pleine résolution au moins aussi précises que le chemin v1", () => {
    for (const k1 of [0.016, -0.014]) {
      const s = rendered({ reference: "mire", k1, yawDeg: 5, pitchDeg: -6, distanceCm: 420 });
      const p = proposeWallCorners(s.work, { inside: quadCenter(s.refQuad!) })!;
      const polys = sampleQuadEdges(s.full, p.quad, { searchPx: 6 }).map((e) => e.points);
      const est = estimateRadialDistortionFromPolylines(polys, { w: s.full.width, h: s.full.height });
      const v1 = estimateRadialDistortion(s.work, p.lines);
      expect(Math.abs(est.k1 - k1)).toBeLessThan(0.002);
      expect(Math.abs(est.k1 - k1)).toBeLessThanOrEqual(Math.abs(v1.k1 - k1) + 0.0005);
    }
  });
});

describe("pipeline v2 : affinage pleine résolution des coins du mur", () => {
  it("coins proposés automatiquement : affinés sur l'originale, k1 sur les arêtes pleine résolution", () => {
    const s = rendered({ reference: "a4", k1: 0.012, yawDeg: -5, pitchDeg: 4, distanceCm: 420, imageW: 4096, imageH: 3072 });
    expect(s.factor).toBe(2);
    const res = measurePhoto({ work: s.work, full: s.full, fullFactor: s.factor, proposeOpenings: false });
    expect(res.failure).toBeNull();
    expect(res.wallRefinement).not.toBeNull();
    expect(res.wallRefinement!.refined).toBe(true);
    expect(quadErr(res.wallCorners!.quad, s.wallQuad)).toBeLessThan(0.5);
    expect(Math.abs(res.distortion!.k1 - 0.012)).toBeLessThan(0.002);
    expect(res.survey!.widthCm).toBeGreaterThan(0);
    // Désactivation explicite : pas d'affinage pleine résolution.
    const off = measurePhoto({ work: s.work, full: s.full, fullFactor: s.factor, proposeOpenings: false, refineWallQuad: false });
    expect(off.wallRefinement).toBeNull();
  });

  it("coins tapés par l'utilisateur : conservés par défaut, affinés sur demande", () => {
    const s = rendered({ reference: "mire", distanceCm: 420 });
    const rng = mulberry32(3);
    const typed = s.wallQuad.map((p) => ({ x: p.x + 3 * gaussianNoise(rng), y: p.y + 3 * gaussianNoise(rng) })) as Quad;
    const kept = measurePhoto({ work: s.work, full: s.full, fullFactor: s.factor, wallQuad: typed, proposeOpenings: false, proposeBaseboard: false });
    expect(kept.wallRefinement).toBeNull();
    expect(kept.wallCorners!.quad).toEqual(typed);
    const ref = measurePhoto({ work: s.work, full: s.full, fullFactor: s.factor, wallQuad: typed, refineWallQuad: true, proposeOpenings: false, proposeBaseboard: false });
    expect(ref.wallRefinement!.refined).toBe(true);
    expect(quadErr(ref.wallCorners!.quad, s.wallQuad)).toBeLessThan(0.6);
    expect(quadErr(typed, s.wallQuad)).toBeGreaterThan(2);
    // Originale sans arête : affinage impossible, coins tapés conservés, pas de distorsion estimée (aucune ligne v1).
    const flat = makeGray(s.work.width, s.work.height, 120);
    const none = measurePhoto({ work: s.work, full: flat, fullFactor: 1, wallQuad: typed, refineWallQuad: true, proposeOpenings: false, proposeBaseboard: false });
    expect(none.wallRefinement!.refined).toBe(false);
    expect(none.wallCorners!.quad).toEqual(typed);
    expect(none.distortion).toBeNull();
  });
});
