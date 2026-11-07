import { describe, expect, it } from "vitest";
import { LOCALES, makeT, missingKeys, t } from "../src/index.js";

describe("i18n", () => {
  it("toutes les locales couvrent toutes les clés FR", () => {
    const missing = missingKeys();
    for (const l of LOCALES) expect(missing[l], `locale ${l}`).toEqual([]);
  });
  it("interpole les paramètres", () => {
    expect(t("fr", "quote.why_rolls", { count: 7 })).toBe("Pourquoi 7 rouleaux ?");
    expect(t("de", "quote.why_rolls", { count: 7 })).toBe("Warum 7 Rollen?");
  });
  it("retombe sur la clé si paramètre manquant", () => {
    expect(t("en", "quote.why_rolls")).toBe("Why {count} rolls?");
    expect(makeT("it")("common.save")).toBe("Salva");
  });
});
