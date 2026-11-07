import { describe, expect, it } from "vitest";
import { ENGINE_VALIDATION_STATUS, ENGINE_VERSION } from "../src/index.js";

describe("quote-engine (Phase 0 : contrat)", () => {
  it("expose une version et un statut de validation explicite", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(ENGINE_VALIDATION_STATUS).toContain("NON VALIDÉ");
  });
});
