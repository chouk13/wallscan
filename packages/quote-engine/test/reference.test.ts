import { describe, expect, it } from "vitest";
import type {
  Consumable,
  LaborRate,
  MatchType,
  Opening,
  QuoteSettings,
  TaxRate,
  Wallpaper,
  WallpaperPrice,
} from "@wallscan/core";
import { cents } from "@wallscan/core";
import { computeQuote, computeRollsSimple, planStrips, type QuoteInput } from "../src/index.js";
import cases from "./reference/cases.json" with { type: "json" };
import { op, wall, input } from "./helpers.js";

interface RefCase {
  id: string;
  wall: { widthCm: number; heightCm: number; openings: Opening[] };
  wallpaper: {
    rollWidthCm: number;
    rollLengthCm: number;
    patternRepeatCm: number;
    matchType: MatchType;
    offsetCm: number;
    minOrderRolls: number;
    salePricePerRoll: number;
  };
  expected: {
    stripHeightCm: number;
    stripCount: number;
    stripsPerRoll: number;
    rollCount: number;
    billableAreaM2: number;
    lines?: Record<string, number>;
    subtotal?: number;
    taxTotal?: number;
    total?: number;
  };
}
const refs = cases as RefCase[];

/** Règle « Léa » (README) : marges 5 + 5, ouvertures > 2 m² déduites, réserve si raccord. */
const SETTINGS: QuoteSettings = {
  cutMarginTopCm: 5,
  cutMarginBottomCm: 5,
  openingsRule: { kind: "subtract_above_m2", thresholdM2: 2 },
  roundTotalToFiveCents: true,
  defaultValidityDays: 30,
  organizationInstalls: true,
  safetyRollIfPattern: true,
  laborMinimumM2: 8,
  travelOutsideCantonCents: cents(8000),
  discountMaxPct: 15,
};
const TAX: TaxRate[] = [
  { id: "t", country: "CH", rateBp: 810, validFrom: "2024-01-01", label: "TVA 8,1 %" },
];
const LABOR: LaborRate[] = [
  { id: "l1", type: "pose_standard", unit: "m2", price: cents(3800), validFrom: "2026-01-01" },
  { id: "l2", type: "pose_raccord", unit: "m2", price: cents(4600), validFrom: "2026-01-01" },
  { id: "l3", type: "preparation", unit: "m2", price: cents(1800), validFrom: "2026-01-01" },
  { id: "l4", type: "depose", unit: "m2", price: cents(1400), validFrom: "2026-01-01" },
];
const GLUE: Consumable[] = [
  { id: "c1", name: "Colle intissé 1 kg", unit: "pot", price: cents(1900), coverageM2PerUnit: 25 },
];

function legacyArea(c: RefCase): number {
  const gross = (c.wall.widthCm * c.wall.heightCm) / 10_000;
  const ded = c.wall.openings.reduce((s, o) => {
    const a = (o.widthCm * o.heightCm) / 10_000;
    return a > 2 ? s + a : s;
  }, 0);
  return Math.round((gross - ded) * 100) / 100;
}

function toWallpaper(c: RefCase): { wallpaper: Wallpaper; price: WallpaperPrice } {
  const wallpaper: Wallpaper = {
    id: `wp-${c.id}`,
    orgId: "org",
    collectionId: "col",
    sku: `SKU-${c.id}`,
    name: `Référence ${c.id}`,
    rollWidthCm: c.wallpaper.rollWidthCm,
    rollLengthCm: c.wallpaper.rollLengthCm,
    patternRepeatCm: c.wallpaper.patternRepeatCm,
    matchType: c.wallpaper.matchType,
    offsetCm: c.wallpaper.offsetCm,
    active: true,
    saleUnit: "roll",
  };
  const price: WallpaperPrice = {
    priceListId: "pl",
    wallpaperId: wallpaper.id,
    salePricePerRoll: cents(c.wallpaper.salePricePerRoll),
    minOrderRolls: c.wallpaper.minOrderRolls,
    currency: "CHF",
  };
  return { wallpaper, price };
}

function quoteInputFor(c: RefCase): QuoteInput {
  return {
    quoteDate: "2026-03-15",
    currency: "CHF",
    settings: SETTINGS,
    walls: [
      {
        wallId: "w1",
        widthCm: c.wall.widthCm,
        heightCm: c.wall.heightCm,
        openings: c.wall.openings,
      },
    ],
    wallpaperByWall: { w1: toWallpaper(c) },
    laborRates: LABOR,
    consumables: GLUE,
    taxRates: TAX,
    options: { preparation: false, depose: false, install: true, travelOutsideCanton: true },
  };
}

describe("devis de référence A–F (règle « Léa », simulés)", () => {
  it("6 cas, identifiants uniques", () => {
    expect(refs.length).toBe(6);
    expect(new Set(refs.map((c) => c.id)).size).toBe(6);
  });

  for (const c of refs) {
    it(`cas ${c.id} — formule simple §5.1 : ${c.expected.rollCount} rouleaux`, () => {
      const r = computeRollsSimple({
        stripCount: Math.ceil(c.wall.widthCm / c.wallpaper.rollWidthCm),
        heightCm: c.wall.heightCm,
        cutTopCm: 5,
        cutBottomCm: 5,
        rollLengthCm: c.wallpaper.rollLengthCm,
        patternRepeatCm: c.wallpaper.patternRepeatCm,
        matchType: c.wallpaper.matchType,
        offsetCm: c.wallpaper.offsetCm,
        minOrderRolls: c.wallpaper.minOrderRolls,
        safetyRollIfPattern: true,
        billableAreaM2: legacyArea(c),
      });
      expect(r.stripHeightCm).toBe(c.expected.stripHeightCm);
      expect(r.stripCount).toBe(c.expected.stripCount);
      expect(r.stripsPerRoll).toBe(c.expected.stripsPerRoll);
      expect(r.rollCount).toBe(c.expected.rollCount);
      expect(r.billableAreaM2).toBe(c.expected.billableAreaM2);
      expect(r.trace.length).toBeGreaterThan(3);
    });

    it(`cas ${c.id} — calepinage avec ouvertures non positionnées : mêmes rouleaux que la formule simple`, () => {
      const plan = planStrips(
        input(
          wall(c.wall.widthCm, c.wall.heightCm, [], { areaOnlyOpenings: c.wall.openings }),
          { ...c.wallpaper },
          { deductAboveM2: 2 },
        ),
      );
      expect(plan.error).toBeUndefined();
      expect(plan.rollCount).toBe(c.expected.rollCount);
      expect(plan.simpleRollCount).toBe(c.expected.rollCount);
      expect(plan.stripCount).toBe(c.expected.stripCount);
      expect(plan.billableAreaM2).toBe(c.expected.billableAreaM2);
    });
  }

  it("cas A et B — devis complet au centime (lignes, TVA 8,1 %, arrondi 5 ct)", () => {
    for (const c of refs.filter((x) => x.expected.lines)) {
      const q = computeQuote(quoteInputFor(c));
      expect(q.blockers).toEqual([]);
      const byKind = Object.fromEntries(q.lines.map((l) => [l.description, l.lineTotal]));
      const lines = c.expected.lines!;
      expect(byKind[`Référence ${c.id} — SKU-${c.id}`]).toBe(lines["wallpaper"]);
      expect(byKind["Colle intissé 1 kg"]).toBe(lines["consumable_colle"]);
      expect(byKind["Pose sans raccord"] ?? byKind["Pose avec raccord"]).toBe(
        lines["labor_pose_standard"] ?? lines["labor_pose_raccord"],
      );
      expect(byKind["Déplacement hors canton"]).toBe(lines["travel"]);
      expect(q.subtotal).toBe(c.expected.subtotal);
      expect(q.taxTotal).toBe(c.expected.taxTotal);
      expect(q.total).toBe(c.expected.total);
      expect(q.discountTotal).toBe(0);
      expect(q.billableAreaM2).toBe(c.expected.billableAreaM2);
    }
  });

  it("écart documenté : les cas C et D positionnés demandent MOINS de rouleaux (morceaux au-dessus/en dessous)", () => {
    // C : porte 90 × 210 à x = 200, au sol. Formule simple 3 rouleaux ; calepinage 2 (le morceau de 60 cm au-dessus de la porte tient dans une chute).
    const cC = refs.find((x) => x.id === "C")!;
    const planC = planStrips(
      input(
        wall(350, 260, [op("porte", "door", 200, 50, 90, 210)]),
        { ...cC.wallpaper },
        { deductAboveM2: 2 },
      ),
    );
    expect(planC.simpleRollCount).toBe(cC.expected.rollCount); // 3, valeur « à la main » conservée
    expect(planC.rollCount).toBe(2);
    expect(planC.billableAreaM2).toBe(cC.expected.billableAreaM2);
    // D : fenêtre 180 × 140 à x = 160, haut à 10 cm du plafond, raccord 32. Formule simple 5 (4 + réserve) ; calepinage 4 (3 + réserve).
    const cD = refs.find((x) => x.id === "D")!;
    const planD = planStrips(
      input(
        wall(500, 245, [op("fenetre", "window", 160, 10, 180, 140)]),
        { ...cD.wallpaper },
        { deductAboveM2: 2 },
      ),
    );
    expect(planD.simpleRollCount).toBe(cD.expected.rollCount); // 5
    expect(planD.rollCount).toBe(4);
    expect(planD.billableAreaM2).toBe(cD.expected.billableAreaM2);
    expect(planD.strips.filter((s) => s.pieces.length === 2)).toHaveLength(2);
  });
});
