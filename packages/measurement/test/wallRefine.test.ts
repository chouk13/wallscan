import { describe, expect, it } from "vitest";
import type { GrayImage, Pt, Quad } from "@wallscan/core";
import { blurGray, makeGray } from "../src/image.js";
import {
  WALL_REFINE_SAMPLES_MAX, WALL_REFINE_SAMPLES_MIN, fitEdgeLine, profileEdge, refineWallQuad, sampleQuadEdges, wallRefineSampleCount,
} from "../src/wallRefine.js";
import { gaussianNoise, mulberry32 } from "../bench/random.js";
import { quadErr, rendered } from "./scenes.js";

/** Image où `inside(x, y)` vaut la couverture (0–1) du pixel par la région claire ; flou d'optique 0,7 px, bruit optionnel. */
function regionImage(w: number, h: number, cover: (x: number, y: number) => number, bg = 60, fg = 200, noise = 0, seed = 1): GrayImage {
  const img = makeGray(w, h, bg);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data[y * w + x] = bg + (fg - bg) * cover(x, y);
  const out = blurGray(img, 0.7);
  if (noise > 0) {
    const rng = mulberry32(seed);
    for (let i = 0; i < out.data.length; i++) out.data[i] = out.data[i] + noise * gaussianNoise(rng);
  }
  return out;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** Couverture analytique du pixel (x, y) par le rectangle [x0, x1] × [y0, y1]. */
const rectCover = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number): number =>
  clamp01(Math.min(x + 1, x1) - Math.max(x, x0)) * clamp01(Math.min(y + 1, y1) - Math.max(y, y0));

const R = { x0: 100.3, y0: 80.6, x1: 700.7, y1: 520.2 };
const truth: Quad = [{ x: R.x0, y: R.y0 }, { x: R.x1, y: R.y0 }, { x: R.x1, y: R.y1 }, { x: R.x0, y: R.y1 }];
const jitter = (q: Quad, sigma: number, seed: number): Quad => {
  const rng = mulberry32(seed);
  return q.map((p) => ({ x: p.x + sigma * gaussianNoise(rng), y: p.y + sigma * gaussianNoise(rng) })) as Quad;
};

describe("refineWallQuad — affinage du quad par droites ajustées", () => {
  const img = regionImage(800, 600, rectCover(R.x0, R.y0, R.x1, R.y1), 60, 200, 3, 7);

  it("nominal : coins tapés à ±3 px → intersections de droites à < 0,15 px, 4 côtés ajustés", () => {
    for (const seed of [1, 2, 3]) {
      const typed = jitter(truth, 3, seed);
      const r = refineWallQuad(img, typed, { searchPx: 12 });
      expect(r.refined).toBe(true);
      expect(quadErr(r.quad, truth)).toBeLessThan(0.15);
      expect(quadErr(typed, truth)).toBeGreaterThan(1);
      for (const k of ["ceiling", "right", "floor", "left"] as const) {
        const l = r.lines[k]!;
        expect(l).not.toBeNull();
        expect(l.inliers).toBeGreaterThanOrEqual(40);
        expect(l.residualPx).toBeLessThan(0.5);
      }
      expect(r.residualPx).toBeLessThan(0.5);
      expect(r.confidence).toBeGreaterThan(0.8);
      // Directions orientées comme les côtés (TL→TR vers +x, BR→BL vers −x).
      expect(r.lines.ceiling!.d.x).toBeGreaterThan(0.99);
      expect(r.lines.floor!.d.x).toBeLessThan(-0.99);
    }
    // Options par défaut (fenêtre 6 px) et nombre de profils imposé.
    const d = refineWallQuad(img, jitter(truth, 1.5, 9), { samples: 50 });
    expect(d.refined).toBe(true);
    expect(quadErr(d.quad, truth)).toBeLessThan(0.2);
    expect(d.lines.ceiling!.inliers).toBeLessThanOrEqual(50);
    // Région sombre sur fond clair : polarité opposée, même précision.
    const dark = regionImage(800, 600, rectCover(R.x0, R.y0, R.x1, R.y1), 210, 40, 2, 3);
    const rd = refineWallQuad(dark, jitter(truth, 2, 4), { searchPx: 10 });
    expect(rd.refined).toBe(true);
    expect(quadErr(rd.quad, truth)).toBeLessThan(0.15);
    expect(sampleQuadEdges(dark, truth).every((s) => s.polarity === -1)).toBe(true);
    expect(sampleQuadEdges(img, truth).every((s) => s.polarity === 1)).toBe(true);
  });

  it("dégradé : côté sans arête → `null`, droite d'entrée conservée, `refined` faux", () => {
    // Région claire qui déborde à droite de l'image : pas de bord droit ; le côté droit du quad est placé dans le clair.
    const open = regionImage(800, 600, rectCover(R.x0, R.y0, 900, R.y1), 60, 200, 2, 5);
    const quad: Quad = [{ x: R.x0 + 1, y: R.y0 - 1 }, { x: 650, y: R.y0 + 1 }, { x: 650, y: R.y1 - 1 }, { x: R.x0 - 1, y: R.y1 + 1 }];
    const r = refineWallQuad(open, quad, { searchPx: 8 });
    expect(r.refined).toBe(false);
    expect(r.lines.right).toBeNull();
    expect(r.lines.ceiling).not.toBeNull();
    expect(r.lines.left).not.toBeNull();
    // Coins de droite : intersection du plafond / sol ajustés avec la droite d'entrée x = 650.
    expect(Math.abs(r.quad[1].x - 650)).toBeLessThan(0.05);
    expect(Math.abs(r.quad[1].y - R.y0)).toBeLessThan(0.15);
    expect(Math.abs(r.quad[0].x - R.x0)).toBeLessThan(0.15);
    expect(r.confidence).toBeLessThan(0.8);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("dégradé : arête en créneaux (résidu > 2 px) → côté rejeté", () => {
    // Bord haut en créneaux de 16 px : 40 % à y = 100,5, 40 % à 105,5, 20 % à 95,5 → aucune droite ne l'explique à 2 px.
    const edge = (x: number): number => {
      const b = Math.floor(x / 16) % 5;
      return b < 2 ? 100.5 : b === 3 ? 95.5 : 105.5;
    };
    const crenel = regionImage(600, 400, (x, y) => clamp01(y + 1 - edge(x + 0.5)) * rectCover(50.5, 0, 550.5, 350.5)(x, y), 60, 200);
    const quad: Quad = [{ x: 50.5, y: 100.5 }, { x: 550.5, y: 100.5 }, { x: 550.5, y: 350.5 }, { x: 50.5, y: 350.5 }];
    const r = refineWallQuad(crenel, quad, { searchPx: 8 });
    expect(r.lines.ceiling).toBeNull();
    expect(r.lines.floor).not.toBeNull();
    expect(r.refined).toBe(false);
  });

  it("dégradé : intersection lointaine (côtés adjacents presque parallèles) → coin d'entrée conservé", () => {
    // Bord haut : y = 100,5 pour x ≥ 200 ; à gauche, une arête parallèle au côté gauche du quad mais décalée de 1 px :
    // les deux droites ajustées se coupent à x ≈ 250, à 50 px du coin donné.
    const e = (x: number): number => (x >= 200 ? 100.5 : 101.5 + 0.02 * (200 - x));
    const kink = regionImage(420, 300, (x, y) => clamp01(y + 1 - e(x + 0.5)), 60, 200);
    const quad: Quad = [{ x: 200, y: 100.5 }, { x: 380, y: 100.5 }, { x: 380, y: 250 }, { x: 20, y: 100.5 + 0.02 * 180 }];
    const r = refineWallQuad(kink, quad);
    expect(r.lines.ceiling).not.toBeNull();
    expect(r.lines.left).not.toBeNull();
    expect(r.quad[0]).toEqual(quad[0]);
    expect(r.refined).toBe(false);
  });

  it("vide / invalide : image uniforme, quad non fini, image minuscule, k1 non fini → quad d'entrée, confiance 0", () => {
    const flat = makeGray(400, 300, 128);
    const q: Quad = [{ x: 50, y: 40 }, { x: 350, y: 40 }, { x: 350, y: 260 }, { x: 50, y: 260 }];
    const r = refineWallQuad(flat, q);
    expect(r.quad).toEqual(q);
    expect(r.quad).not.toBe(q);
    expect(r.lines).toEqual({ ceiling: null, right: null, floor: null, left: null });
    expect(r.confidence).toBe(0);
    expect(r.residualPx).toBe(0);
    expect(r.refined).toBe(false);
    const bad: Quad = [{ x: Number.NaN, y: 0 }, q[1], q[2], q[3]];
    expect(refineWallQuad(flat, bad).refined).toBe(false);
    expect(refineWallQuad(makeGray(4, 4, 0), q).confidence).toBe(0);
    expect(refineWallQuad(img, truth, { k1: Number.NaN }).quad).toEqual(truth);
    // Quad dégénéré (côtés < 20 px) : aucun profil.
    const tiny: Quad = [{ x: 100, y: 100 }, { x: 105, y: 100 }, { x: 105, y: 105 }, { x: 100, y: 105 }];
    expect(sampleQuadEdges(img, tiny).every((s) => s.points.length === 0 && s.requested === 0 && s.polarity === 0)).toBe(true);
    expect(refineWallQuad(img, tiny).refined).toBe(false);
  });

  it("distorsion : droites ajustées dans l'espace non distordu (scène rendue, k1 = 0,015)", () => {
    const s = rendered({ reference: "mire", k1: 0.015, yawDeg: 6, pitchDeg: -4, distanceCm: 430 });
    expect(s.factor).toBe(1);
    const typed = jitter(s.wallQuad, 3, 11);
    const r = refineWallQuad(s.full, typed, { searchPx: 12, k1: 0.015 });
    expect(r.refined).toBe(true);
    expect(quadErr(r.quad, s.wallQuad)).toBeLessThan(0.5);
    expect(r.residualPx).toBeLessThan(0.6);
  });
});

describe("briques de refineWallQuad", () => {
  it("wallRefineSampleCount : 1 profil / 12 px, borné à [40 ; 120]", () => {
    expect(wallRefineSampleCount(100)).toBe(WALL_REFINE_SAMPLES_MIN);
    expect(wallRefineSampleCount(960)).toBe(80);
    expect(wallRefineSampleCount(5000)).toBe(WALL_REFINE_SAMPLES_MAX);
    expect(wallRefineSampleCount(1000, 10)).toBe(40);
    expect(wallRefineSampleCount(1000, 500)).toBe(120);
  });

  it("profileEdge : transition sous-pixel, polarité libre, bord de fenêtre, sous le seuil", () => {
    const img = regionImage(80, 60, rectCover(30.4, 0, 200, 200));
    const n = { x: 1, y: 0 };
    const d = { x: 0, y: 1 };
    const e = profileEdge(img, { x: 32, y: 30 }, n, d, 6, 1)!;
    expect(Math.abs(e.p.x - 30.4)).toBeLessThan(0.1);
    expect(e.strength).toBeGreaterThan(0);
    const neg = profileEdge(img, { x: 32, y: 30 }, { x: -1, y: 0 }, d, 6, 1)!;
    expect(neg.strength).toBeLessThan(0);
    expect(Math.abs(neg.p.x - 30.4)).toBeLessThan(0.1);
    // Arête juste au bord de la fenêtre : maximum en extrémité, pas d'interpolation.
    const atEdge = profileEdge(img, { x: 33.4, y: 30 }, n, d, 3, 1)!;
    expect(atEdge).not.toBeNull();
    expect(profileEdge(img, { x: 60, y: 30 }, n, d, 4, 1)).toBeNull();
  });

  it("fitEdgeLine : aberrants rejetés, cas limites", () => {
    const pts: Pt[] = [];
    for (let i = 0; i < 40; i++) pts.push({ x: i * 10, y: 50 + 0.1 * i * 10 + (i % 2 === 0 ? 0.05 : -0.05) });
    pts.push({ x: 105, y: 90 }, { x: 205, y: 10 }, { x: 305, y: 130 });
    const f = fitEdgeLine(pts, 12)!;
    expect(f.inliers).toBe(40);
    expect(Math.abs(f.d.y / f.d.x - 0.1)).toBeLessThan(1e-3);
    expect(f.residualPx).toBeLessThan(0.06);
    // Trop peu de points ; points confondus (aucune hypothèse) ; nuage sans consensus ; étendue insuffisante.
    expect(fitEdgeLine(pts.slice(0, 5), 12)).toBeNull();
    expect(fitEdgeLine(Array.from({ length: 20 }, () => ({ x: 3, y: 3 })), 12)).toBeNull();
    const rng = mulberry32(5);
    const cloud = Array.from({ length: 40 }, () => ({ x: 400 * rng(), y: 400 * rng() }));
    expect(fitEdgeLine(cloud, 30)).toBeNull();
    expect(fitEdgeLine(pts, 12, 1000)).toBeNull();
    // 7 points sur la droite, 5 à 0,9 px : consensus RANSAC (tolérance 1 px) mais rejet à 2,5 σ → sous le minimum.
    const split: Pt[] = [];
    for (let i = 0; i < 7; i++) split.push({ x: i * 20, y: 0 });
    for (let i = 0; i < 5; i++) split.push({ x: 10 + i * 20, y: i % 2 === 0 ? 0.9 : -0.9 });
    expect(fitEdgeLine(split, 12)).toBeNull();
    expect(fitEdgeLine(split, 7)).not.toBeNull();
  });
});
