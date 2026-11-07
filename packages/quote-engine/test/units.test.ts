import { describe, expect, it } from "vitest";
import { fmtCm, fmtM, fmtM2, fmtNum, mm2ToM2, mmToCm, mod, plural, toMm } from "../src/units.js";
import { computeRollsSimple, dropMm, hasPattern, simpleStripHeightMm } from "../src/simple.js";

describe("unités", () => {
  it("cm ↔ mm arrondis au millimètre", () => {
    expect(toMm(26.5)).toBe(265);
    expect(toMm(418.333)).toBe(4183);
    expect(mmToCm(4183)).toBe(418.3);
    expect(mm2ToM2(97_300_00)).toBe(9.73);
    expect(mm2ToM2(10_000_000)).toBe(10);
  });
  it("modulo positif", () => {
    expect(mod(-5, 64)).toBe(59);
    expect(mod(70, 64)).toBe(6);
  });
  it("formatage français déterministe", () => {
    expect(fmtNum(7.55)).toBe("7,55");
    expect(fmtNum(10)).toBe("10");
    expect(fmtNum(2.5, 1)).toBe("2,5");
    expect(fmtNum(3, 0)).toBe("3");
    expect(fmtNum(-0.001)).toBe("0");
    expect(fmtNum(0.125, 2)).toBe("0,13");
    expect(fmtCm(2605)).toBe("260,5 cm");
    expect(fmtM(10050)).toBe("10,05 m");
    expect(fmtM2(1_680_000)).toBe("1,68 m²");
    expect(plural(1, "lé")).toBe("1 lé");
    expect(plural(3, "lé")).toBe("3 lés");
    expect(plural(2, "rouleau", "rouleaux")).toBe("2 rouleaux");
  });
});

describe("formule simple §5.1", () => {
  const base = {
    stripCount: 8,
    heightCm: 250,
    cutTopCm: 5,
    cutBottomCm: 5,
    rollLengthCm: 1005,
    minOrderRolls: 1,
    safetyRollIfPattern: true,
    billableAreaM2: 10,
  } as const;
  it("décalage : demi-raccord par défaut pour le raccord sauté, offsetCm sinon, 0 pour droit/libre", () => {
    expect(dropMm("half_drop", 640, 0)).toBe(320);
    expect(dropMm("half_drop", 640, 265)).toBe(265);
    expect(dropMm("offset", 640, 200)).toBe(200);
    expect(dropMm("straight", 640, 200)).toBe(0);
    expect(dropMm("free", 640, 200)).toBe(0);
    expect(hasPattern("straight", 0)).toBe(false);
    expect(hasPattern("straight", 640)).toBe(true);
  });
  it("hauteur de lé : libre, droit, sauté, décalé", () => {
    expect(
      simpleStripHeightMm({
        heightCm: 250,
        cutTopCm: 5,
        cutBottomCm: 5,
        patternRepeatCm: 0,
        matchType: "free",
        offsetCm: 0,
      }),
    ).toBe(2600);
    expect(
      simpleStripHeightMm({
        heightCm: 250,
        cutTopCm: 5,
        cutBottomCm: 5,
        patternRepeatCm: 64,
        matchType: "straight",
        offsetCm: 0,
      }),
    ).toBe(3200);
    expect(
      simpleStripHeightMm({
        heightCm: 250,
        cutTopCm: 5,
        cutBottomCm: 5,
        patternRepeatCm: 53,
        matchType: "half_drop",
        offsetCm: 26.5,
      }),
    ).toBe(2915);
    expect(
      simpleStripHeightMm({
        heightCm: 250,
        cutTopCm: 5,
        cutBottomCm: 5,
        patternRepeatCm: 60,
        matchType: "offset",
        offsetCm: 20,
      }),
    ).toBe(3200);
  });
  it("raccord décalé : trace dédiée ; raccord sans hauteur : pose libre", () => {
    const off = computeRollsSimple({
      ...base,
      patternRepeatCm: 60,
      matchType: "offset",
      offsetCm: 20,
    });
    expect(off.stripHeightCm).toBe(320);
    expect(off.trace.some((t) => t.includes("Raccord décalé"))).toBe(true);
    const none = computeRollsSimple({
      ...base,
      patternRepeatCm: 0,
      matchType: "straight",
      offsetCm: 0,
    });
    expect(none.rollCount).toBe(3);
    expect(none.trace.some((t) => t.includes("traité comme une pose libre"))).toBe(true);
  });
  it("rouleau plus court qu'un lé : inapplicable (0 rouleau, trace)", () => {
    const r = computeRollsSimple({
      ...base,
      rollLengthCm: 300,
      patternRepeatCm: 64,
      matchType: "straight",
      offsetCm: 0,
    });
    expect(r.stripsPerRoll).toBe(0);
    expect(r.rollCount).toBe(0);
    expect(r.trace.some((t) => t.includes("inapplicable"))).toBe(true);
  });
  it("hauteur nulle sans marges : 0 lé par rouleau, pas de division par zéro", () => {
    const r = computeRollsSimple({
      ...base,
      heightCm: 0,
      cutTopCm: 0,
      cutBottomCm: 0,
      patternRepeatCm: 0,
      matchType: "free",
      offsetCm: 0,
    });
    expect(r.stripsPerRoll).toBe(0);
    expect(r.rollCount).toBe(0);
  });
  it("minimum de commande appliqué après la réserve", () => {
    const r = computeRollsSimple({
      ...base,
      stripCount: 2,
      patternRepeatCm: 64,
      matchType: "straight",
      offsetCm: 0,
      minOrderRolls: 5,
    });
    expect(r.rollCount).toBe(5);
  });
});
