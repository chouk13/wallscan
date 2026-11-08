import { describe, expect, it } from "vitest";
import type { Quad } from "@wallscan/core";
import { decodeMireCells, mireCodeCells } from "../src/constants.js";
import { makeGray } from "../src/image.js";
import { decodeMire, detectReference } from "../src/reference.js";
import { quadCenter } from "../src/segment.js";
import { quadErr, rendered } from "./scenes.js";

describe("code de la mire", () => {
  it("motif imprimé reconnu, rotations rejetées, tolérance de 2 cellules", () => {
    const cells = mireCodeCells();
    expect(cells).toHaveLength(25);
    expect(decodeMireCells(cells)).toBe(0);
    expect(decodeMireCells(cells.map((v, i) => (i < 2 ? !v : v)))).toBe(0); // 2 erreurs tolérées
    expect(decodeMireCells(cells.map((v, i) => (i < 3 ? !v : v)))).toBeNull(); // 3 erreurs : rejet
    expect(decodeMireCells(cells.slice(0, 16))).toBeNull();
    // Les trois rotations du motif diffèrent d'au moins 9 cellules : jamais décodées à tort.
    const rot = (c: boolean[]): boolean[] => c.map((_, i) => c[(i % 5) * 5 + (4 - Math.floor(i / 5))]);
    let r = cells;
    for (let k = 0; k < 3; k++) {
      r = rot(r);
      let diff = 0;
      for (let i = 0; i < 25; i++) if (r[i] !== cells[i]) diff++;
      expect(diff).toBeGreaterThanOrEqual(9);
      expect(decodeMireCells(r)).toBeNull();
    }
  });
});

describe("détection de la référence", () => {
  it("mire portrait : détectée, coins sous-pixel, code lu", () => {
    const s = rendered({ reference: "mire", code: 37 });
    const d = detectReference(s.work)!;
    expect(d).not.toBeNull();
    expect(d.kind).toBe("mire");
    expect(d.code).toBe(0);
    expect(d.confidence).toBeGreaterThan(0.7);
    expect(quadErr(d.quad, s.refQuad!)).toBeLessThan(0.5);
    // Avec indication de nature et de position.
    const h = detectReference(s.work, { kind: "mire", near: quadCenter(s.refQuad!) })!;
    expect(h.kind).toBe("mire");
    // Demander une feuille A4 sur une mire : l'intérieur blanc de la mire (proportions 1,51) est encadré de noir → refusé.
    expect(detectReference(s.work, { kind: "a4" })).toBeNull();
  });

  it("mire paysage et tournée : orientation retrouvée", () => {
    const s = rendered({ reference: "mire", referenceLandscape: true, code: 5, yawDeg: 8, pitchDeg: 5, rollDeg: 4 });
    const d = detectReference(s.work)!;
    expect(d.kind).toBe("mire");
    expect(d.code).toBe(0);
    expect(quadErr(d.quad, s.refQuad!)).toBeLessThan(0.6);
    const r = rendered({ reference: "mire", referenceAngleDeg: 2, code: 63, rollDeg: -6 });
    const dr = detectReference(r.work)!;
    expect(dr.code).toBe(0);
    expect(quadErr(dr.quad, r.refQuad!)).toBeLessThan(0.6);
  });

  it("feuille A4 : détectée sur mur clair et foncé, pas sur mur blanc bruité, pas sur image vide", () => {
    for (const wallShade of [90, 180]) {
      const s = rendered({ reference: "a4", wallShade, yawDeg: -5, pitchDeg: 3 });
      const d = detectReference(s.work)!;
      expect(d).not.toBeNull();
      expect(d.kind).toBe("a4");
      expect(d.code).toBeUndefined();
      expect(quadErr(d.quad, s.refQuad!)).toBeLessThan(0.6);
      expect(d.confidence).toBeGreaterThan(0.5);
    }
    const white = rendered({ reference: "a4", wallShade: 248, noiseSigma: 4 });
    const dw = detectReference(white.work);
    expect(dw === null || dw.kind === "a4").toBe(true);
    expect(detectReference(makeGray(400, 300, 120))).toBeNull();
    expect(detectReference(makeGray(20, 20, 120))).toBeNull();
    const none = rendered({ reference: "none" });
    expect(detectReference(none.work)).toBeNull();
    expect(detectReference(none.work, { kind: "manual_a4" })).toBeNull();
    // Fenêtre à cadre clair aux proportions d'une feuille : structure intérieure (cadre → vitre) → refusée.
    const win = rendered({ reference: "none", wallShade: 70, distanceCm: 470, window: { x: 170, y: 60, w: 45, h: 64 }, windowGlassShade: 200 });
    expect(detectReference(win.work, { kind: "a4" })).toBeNull();
  });

  it("décodage direct : quad dégénéré, contraste insuffisant", () => {
    const s = rendered({ reference: "mire", code: 9 });
    expect(decodeMire(s.work, s.refQuad!)!.code).toBe(0);
    const degenerate: Quad = [{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }];
    expect(decodeMire(s.work, degenerate)).toBeNull();
    const wall: Quad = [{ x: 300, y: 300 }, { x: 380, y: 300 }, { x: 380, y: 416 }, { x: 300, y: 416 }];
    expect(decodeMire(s.work, wall)).toBeNull();
    // Quad décalé d'un demi-cadre : échantillons incohérents.
    const shifted = s.refQuad!.map((p) => ({ x: p.x + 6, y: p.y })) as Quad;
    expect(decodeMire(s.work, shifted)).toBeNull();
    // Cadre correct mais code effacé (feuille blanche au centre) : le motif ne correspond pas → rejet.
    const blank = { width: s.work.width, height: s.work.height, data: new Uint8ClampedArray(s.work.data) };
    const c = quadCenter(s.refQuad!);
    const r = Math.hypot(s.refQuad![1].x - s.refQuad![0].x, s.refQuad![1].y - s.refQuad![0].y) * 0.2;
    for (let y = Math.floor(c.y - r); y <= c.y + r; y++) for (let x = Math.floor(c.x - r); x <= c.x + r; x++) blank.data[y * blank.width + x] = 250;
    expect(decodeMire(blank, s.refQuad!)).toBeNull();
  });
});
