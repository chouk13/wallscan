import { describe, expect, it } from "vitest";
import type { Pt } from "@wallscan/core";
import type { Segment } from "../src/edges.js";
import { makeGray } from "../src/image.js";
import { quadCenter } from "../src/segment.js";
import { chainSegments, extendChain, insideBandClean, proposeWallCorners, stepContrast, wallLineCandidates, type Chain } from "../src/wallCorners.js";
import { quadErr, rendered } from "./scenes.js";

const seg = (a: Pt, b: Pt): Segment => {
  let angle = Math.atan2(b.y - a.y, b.x - a.x);
  if (angle < 0) angle += Math.PI;
  if (angle >= Math.PI) angle -= Math.PI;
  const pixels: Pt[] = [];
  const n = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= n; i++) pixels.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  return { a, b, support: pixels.length, angle, pixels };
};

describe("coins du mur", () => {
  it("scène simple : quad proposé à moins d'un pixel, lignes nommées, confiance élevée", () => {
    const s = rendered({ reference: "mire", yawDeg: 8, pitchDeg: -5, rollDeg: 3, distanceCm: 460, window: { x: 60, y: 70, w: 120, h: 110 }, door: { x: 290, w: 85, h: 205 } });
    const p = proposeWallCorners(s.work, { inside: quadCenter(s.refQuad!) })!;
    expect(p).not.toBeNull();
    expect(quadErr(p.quad, s.wallQuad)).toBeLessThan(1.5);
    expect(p.confidence).toBeGreaterThan(0.7);
    expect(p.lines.map((l) => l.kind)).toEqual(["ceiling", "floor", "left", "right"]);
    // Sans indication : centre de l'image (le mur l'entoure).
    const q = proposeWallCorners(s.work)!;
    expect(quadErr(q.quad, s.wallQuad)).toBeLessThan(1.5);
  });

  it("joints de lames parallèles au mur et plinthe : le sol est choisi, pas un joint ni le haut de plinthe", () => {
    const s = rendered({ reference: "a4", wallShade: 120, floorPattern: "parallel", baseboardCm: 10, yawDeg: -6, pitchDeg: 4 });
    const p = proposeWallCorners(s.work, { inside: quadCenter(s.refQuad!) })!;
    expect(p).not.toBeNull();
    expect(quadErr(p.quad, s.wallQuad)).toBeLessThan(2);
    const c = wallLineCandidates(s.work, { inside: quadCenter(s.refQuad!) })!;
    expect(c.floors.length).toBeGreaterThanOrEqual(1);
    expect(c.chains.length).toBeGreaterThan(4);
  });

  it("entrées sans mur : null", () => {
    expect(proposeWallCorners(makeGray(40, 40, 100))).toBeNull();
    expect(wallLineCandidates(makeGray(40, 40, 100))).toBeNull();
    expect(proposeWallCorners(makeGray(400, 300, 100))).toBeNull();
    // Un seul rectangle clair sans plafond ni sol distincts : des lignes mais pas de quad cohérent autour du centre.
    const img = makeGray(400, 300, 100);
    for (let y = 100; y < 200; y++) for (let x = 0; x < 400; x++) img.data[y * 400 + x] = 200;
    const r = proposeWallCorners(img, { inside: { x: 200, y: 150 } });
    expect(r).toBeNull();
  });

  it("chaînage de segments : colinéaires fusionnés, parallèles et obliques séparés", () => {
    const segs: Segment[] = [
      seg({ x: 0, y: 100 }, { x: 100, y: 100.5 }),
      seg({ x: 120, y: 100.6 }, { x: 250, y: 101 }), // suite colinéaire
      seg({ x: 0, y: 110 }, { x: 250, y: 110 }), // parallèle proche mais recouvrante
      seg({ x: 300, y: 0 }, { x: 301, y: 200 }), // verticale
      seg({ x: 0, y: 0 }, { x: 100, y: 100 }), // oblique : ignorée
      seg({ x: 0, y: 150 }, { x: 60, y: 150 }),
      seg({ x: 200, y: 150 }, { x: 260, y: 150 }), // même droite, trou trop grand
    ];
    const chains = chainSegments(segs, 3, 50);
    const horizontals = chains.filter((c) => c.horizontal);
    expect(chains.some((c) => c.segments.length === 2)).toBe(true);
    expect(horizontals.length).toBe(4);
    expect(chains.filter((c) => !c.horizontal).length).toBe(1);
    // Angle incompatible : nouvelle chaîne.
    const tilted = chainSegments([seg({ x: 0, y: 100 }, { x: 100, y: 100 }), seg({ x: 110, y: 100 }, { x: 200, y: 110 })], 3, 50);
    expect(tilted.length).toBe(2);
  });

  it("contraste de marche, barres, bande intérieure, prolongement", () => {
    const w = 200;
    const h = 100;
    const img = makeGray(w, h, 100);
    for (let y = 50; y < h; y++) for (let x = 0; x < w; x++) img.data[y * w + x] = 180; // marche à y = 50
    for (let x = 0; x < w; x++) img.data[20 * w + x] = 30; // barre sombre à y = 20
    const step: Chain = { segments: [], p: { x: 100, y: 50 }, d: { x: 1, y: 0 }, tMin: -90, tMax: 90, length: 180, horizontal: true, contrast: 0, clean: 1 };
    expect(stepContrast(img, step, 6, 5)).toBeGreaterThan(70);
    const bar: Chain = { ...step, p: { x: 100, y: 20.5 } };
    expect(stepContrast(img, bar, 6, 5)).toBe(0);
    const nothing: Chain = { ...step, p: { x: 100, y: 80 } };
    expect(stepContrast(img, nothing, 6, 5)).toBe(0);
    // Marche incohérente (moitié de la longueur seulement).
    const half = makeGray(w, h, 100);
    for (let y = 50; y < h; y++) for (let x = 0; x < w / 2; x++) half.data[y * w + x] = 180;
    expect(stepContrast(half, step, 6, 5)).toBe(0);
    // Bande intérieure : propre au-dessus de la marche (vers le haut), sale si une barre est à 5 px.
    expect(insideBandClean(img, step, { x: 100, y: 10 }, 5)).toBeGreaterThan(0.9);
    const withBar = makeGray(w, h, 100);
    for (let y = 50; y < h; y++) for (let x = 0; x < w; x++) withBar.data[y * w + x] = 180;
    for (let x = 0; x < w; x++) withBar.data[45 * w + x] = 20;
    expect(insideBandClean(withBar, step, { x: 100, y: 10 }, 5)).toBeLessThan(0.2);
    expect(insideBandClean(withBar, step, { x: 100, y: 90 }, 5)).toBeGreaterThan(0.9);
    // Prolongement le long des pixels d'arête.
    const edges = new Uint8Array(w * h);
    for (let x = 20; x < 180; x++) edges[50 * w + x] = 1;
    const short: Chain = { ...step, tMin: -30, tMax: 30 };
    extendChain(edges, w, h, short);
    expect(short.tMax).toBeGreaterThan(40);
    expect(short.tMin).toBeLessThan(-40);
    // Chaîne au bord de l'image : la sonde sort du cadre et s'arrête.
    const border: Chain = { ...step, p: { x: 190, y: 50 }, tMin: -5, tMax: 5, length: 10 };
    extendChain(edges, w, h, border);
    expect(border.tMax).toBeLessThanOrEqual(10);
    // Chaîne verticale : lineAt / extent sur l'autre axe.
    const vert: Chain = { segments: [], p: { x: 50, y: 50 }, d: { x: 0, y: 1 }, tMin: -40, tMax: 40, length: 80, horizontal: false, contrast: 0, clean: 1 };
    expect(insideBandClean(img, vert, { x: 100, y: 50 }, 5)).toBeGreaterThan(0.5);
  });
});
