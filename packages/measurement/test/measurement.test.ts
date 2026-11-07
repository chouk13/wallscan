import { describe, expect, it } from "vitest";
import {
  applyCorrection, CONFIDENCE_VERIFY_THRESHOLD, deductibleOpeningsM2, manualMeasurement,
  needsVerification, openingAreaM2, REFERENCE_OBJECTS_MM,
} from "../src/index.js";

const door = { type: "door" as const, widthCm: 80, heightCm: 200 };
const smallWindow = { type: "window" as const, widthCm: 50, heightCm: 50 };

describe("measurement (Phase 0)", () => {
  it("seuil de vérification", () => {
    expect(CONFIDENCE_VERIFY_THRESHOLD).toBe(0.8);
    expect(needsVerification({ confidence: 0.79 })).toBe(true);
    expect(needsVerification({ confidence: 0.8 })).toBe(false);
    expect(REFERENCE_OBJECTS_MM.a4_sheet.height).toBe(297);
  });
  it("règles d'ouvertures", () => {
    expect(openingAreaM2(door)).toBe(1.6);
    expect(deductibleOpeningsM2([door, smallWindow], { kind: "ignore" })).toBe(0);
    expect(deductibleOpeningsM2([door, smallWindow], { kind: "subtract_all" })).toBeCloseTo(1.85);
    expect(deductibleOpeningsM2([door, smallWindow], { kind: "subtract_above_m2", thresholdM2: 1 })).toBe(1.6);
  });
  it("saisie manuelle valide", () => {
    const r = manualMeasurement({ widthCm: 400, heightCm: 250, openings: [door] }, { kind: "subtract_all" });
    expect(r.ok && r.value.areaM2).toBe(8.4);
    expect(r.ok && r.value.method).toBe("manual");
    expect(r.ok && r.value.confidence).toBe(1);
    const noOpen = manualMeasurement({ widthCm: 400, heightCm: 250 }, { kind: "ignore" });
    expect(noOpen.ok && noOpen.value.areaM2).toBe(10);
  });
  it("saisie manuelle invalide", () => {
    expect(manualMeasurement({ widthCm: 0, heightCm: 250 }, { kind: "ignore" }).ok).toBe(false);
    expect(manualMeasurement({ widthCm: 400, heightCm: Number.NaN }, { kind: "ignore" }).ok).toBe(false);
    expect(manualMeasurement({ widthCm: 400, heightCm: 250, openings: [{ ...door, widthCm: 0 }] }, { kind: "ignore" }).ok).toBe(false);
    expect(manualMeasurement({ widthCm: 400, heightCm: 250, openings: [{ ...door, heightCm: 300 }] }, { kind: "ignore" }).ok).toBe(false);
  });
  it("correction vendeur conserve la méthode et trace la correction", () => {
    const base = manualMeasurement({ widthCm: 400, heightCm: 250 }, { kind: "ignore" });
    if (!base.ok) throw new Error("setup");
    const ar = { ...base.value, method: "ar" as const, confidence: 0.6 };
    const fixed = applyCorrection(ar, { widthCm: 410 }, { kind: "ignore" });
    expect(fixed.ok && fixed.value.widthCm).toBe(410);
    expect(fixed.ok && fixed.value.method).toBe("ar");
    expect(fixed.ok && fixed.value.correctedByUser).toBe(true);
    expect(fixed.ok && fixed.value.areaM2).toBe(10.25);
    const bad = applyCorrection(ar, { heightCm: -1 }, { kind: "ignore" });
    expect(bad.ok).toBe(false);
  });
});
