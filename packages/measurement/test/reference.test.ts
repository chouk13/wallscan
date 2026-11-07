import { describe, expect, it } from "vitest";
import type { Quad } from "@wallscan/core";
import { decodeMireCells, mireCodeCells } from "../src/constants.js";
import { makeGray } from "../src/image.js";
import { decodeMire, detectReference } from "../src/reference.js";
import { quadCenter } from "../src/segment.js";
import { quadErr, rendered } from "./scenes.js";

describe("code de la mire", () => {
  it("encodage / décodage pour tous les identifiants, rejets", () => {
    for (let code = 0; code < 64; code++) expect(decodeMireCells(mireCodeCells(code))).toBe(code);
    const cells = mireCodeCells(22);
    expect(decodeMireCells(cells.map((v, i) => (i === 0 ? false : v)))).toBeNull(); // coin d'orientation manquant
    expect(decodeMireCells(cells.map((v, i) => (i === 3 ? true : v)))).toBeNull();
    expect(decodeMireCells(cells.map((v, i) => (i === 1 ? !v : v)))).toBeNull(); // complément violé
  });
});

describe("détection de la référence", () => {
  it("mire portrait : détectée, coins sous-pixel, code lu", () => {
    const s = rendered({ reference: "mire", code: 37 });
    const d = detectReference(s.work)!;
    expect(d).not.toBeNull();
    expect(d.kind).toBe("mire");
    expect(d.code).toBe(37);
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
    expect(d.code).toBe(5);
    expect(quadErr(d.quad, s.refQuad!)).toBeLessThan(0.6);
    const r = rendered({ reference: "mire", referenceAngleDeg: 2, code: 63, rollDeg: -6 });
    const dr = detectReference(r.work)!;
    expect(dr.code).toBe(63);
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
    expect(decodeMire(s.work, s.refQuad!)!.code).toBe(9);
    const degenerate: Quad = [{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }];
    expect(decodeMire(s.work, degenerate)).toBeNull();
    const wall: Quad = [{ x: 300, y: 300 }, { x: 380, y: 300 }, { x: 380, y: 416 }, { x: 300, y: 416 }];
    expect(decodeMire(s.work, wall)).toBeNull();
    // Quad décalé d'un demi-cadre : échantillons incohérents.
    const shifted = s.refQuad!.map((p) => ({ x: p.x + 6, y: p.y })) as Quad;
    expect(decodeMire(s.work, shifted)).toBeNull();
  });
});
