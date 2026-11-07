import { describe, expect, it } from "vitest";
import type {
  Consumable,
  LaborRate,
  QuoteSettings,
  TaxRate,
  Wallpaper,
  WallpaperPrice,
} from "@wallscan/core";
import { cents } from "@wallscan/core";
import {
  computeQuote,
  deductThresholdM2,
  ENGINE_VERSION,
  lineTotal,
  quoteRange,
  type QuoteInput,
  type StripComputation,
  type WallInput,
} from "../src/index.js";
import { omit, op } from "./helpers.js";

const SETTINGS: QuoteSettings = {
  cutMarginTopCm: 5,
  cutMarginBottomCm: 5,
  openingsRule: { kind: "subtract_above_m2", thresholdM2: 2 },
  roundTotalToFiveCents: true,
  defaultValidityDays: 30,
  organizationInstalls: true,
  safetyRollIfPattern: true,
  laborMinimumM2: 8,
  travelFlatFeeCents: cents(0),
  travelOutsideCantonCents: cents(8000),
  discountMaxPct: 15,
  discountAppliesTo: ["wallpaper"],
  laborPanoramicM2Cents: cents(9500),
};
const TAX: TaxRate[] = [
  {
    id: "t-old",
    country: "CH",
    rateBp: 770,
    validFrom: "2018-01-01",
    validTo: "2023-12-31",
    label: "TVA 7,7 %",
  },
  { id: "t", country: "CH", rateBp: 810, validFrom: "2024-01-01", label: "TVA 8,1 %" },
];
const LABOR: LaborRate[] = [
  { id: "l1", type: "pose_standard", unit: "m2", price: cents(5500), validFrom: "2026-01-01" },
  {
    id: "l1-old",
    type: "pose_standard",
    unit: "m2",
    price: cents(5000),
    validFrom: "2020-01-01",
    validTo: "2025-12-31",
  },
  { id: "l2", type: "pose_raccord", unit: "m2", price: cents(7000), validFrom: "2026-01-01" },
  { id: "l3", type: "preparation", unit: "m2", price: cents(1800), validFrom: "2026-01-01" },
  { id: "l4", type: "depose", unit: "m2", price: cents(1400), validFrom: "2026-01-01" },
];
const GLUE: Consumable[] = [
  { id: "c1", name: "Colle intissé 1 kg", unit: "pot", price: cents(2400), coverageM2PerUnit: 25 },
];

const wp = (id: string, o: Partial<Wallpaper> = {}): Wallpaper => ({
  id,
  orgId: "org",
  collectionId: "col",
  sku: `SKU-${id}`,
  name: `Papier ${id}`,
  colorName: "bleu",
  rollWidthCm: 53,
  rollLengthCm: 1005,
  patternRepeatCm: 0,
  matchType: "free",
  offsetCm: 0,
  active: true,
  saleUnit: "roll",
  ...o,
});
const price = (
  wallpaperId: string,
  salePricePerRoll: number,
  minOrderRolls = 1,
): WallpaperPrice => ({
  priceListId: "pl",
  wallpaperId,
  salePricePerRoll: cents(salePricePerRoll),
  minOrderRolls,
  currency: "CHF",
});
const FREE = { wallpaper: wp("free"), price: price("free", 15900) };
const STRAIGHT = {
  wallpaper: wp("straight", { patternRepeatCm: 64, matchType: "straight" }),
  price: price("straight", 19900),
};
const PANO = {
  wallpaper: wp("pano", { rollWidthCm: 70, rollLengthCm: 0, saleUnit: "m2" }),
  price: price("pano", 18900),
};

const w1: WallInput = { wallId: "w1", widthCm: 400, heightCm: 250, openings: [] };

function base(o: Partial<QuoteInput> = {}): QuoteInput {
  return {
    quoteDate: "2026-03-15",
    currency: "CHF",
    settings: SETTINGS,
    walls: [w1],
    wallpaperByWall: { w1: FREE },
    laborRates: LABOR,
    consumables: GLUE,
    taxRates: TAX,
    options: { preparation: false, depose: false },
    ...o,
  };
}
const line = (q: ReturnType<typeof computeQuote>, description: string) =>
  q.lines.find((l) => l.description === description);

describe("computeQuote — composition en centimes", () => {
  it("mur 400 × 250 uni : papier 3 rouleaux, colle 1 pot, pose 10 m², TVA 8,1 %, arrondi 5 ct", () => {
    const q = computeQuote(base());
    expect(q.engineVersion).toBe(ENGINE_VERSION);
    expect(q.blockers).toEqual([]);
    expect(q.lines.map((l) => [l.description, l.qty, l.unit, l.lineTotal])).toEqual([
      ["Papier free bleu — SKU-free", 3, "rouleau", 47700],
      ["Colle intissé 1 kg", 1, "pot", 2400],
      ["Pose sans raccord", 10, "m²", 55000],
    ]);
    expect(q.subtotal).toBe(105100);
    expect(q.taxTotal).toBe(8513); // 105100 × 8,1 % = 8513,1
    expect(q.total).toBe(113615); // 113613 arrondi aux 5 ct
    expect(q.roundingCents).toBe(2);
    expect(q.billableAreaM2).toBe(10);
    expect(q.lines[0]!.wallId).toBe("w1");
    expect(q.lines[0]!.taxAmount).toBe(3864); // 47700 × 8,1 % = 3863,7
    const comp = q.lines[0]!.computation as StripComputation;
    expect(comp.rollCount).toBe(3);
    expect(comp.simpleRollCount).toBe(3);
    expect(comp.plan.walls).toHaveLength(1);
    expect(comp.trace.length).toBeGreaterThan(3);
  });
  it("tarifs choisis à la date du devis (TVA 7,7 % et pose 50.– en 2023)", () => {
    const q = computeQuote(base({ quoteDate: "2023-06-01T10:00:00Z" }));
    expect(line(q, "Pose sans raccord")!.unitPrice).toBe(5000);
    expect(q.lines.every((l) => l.taxRateBp === 770)).toBe(true);
    expect(q.blockers).toEqual([]);
  });
  it("minimum de pose : surface relevée à 8 m² avec trace", () => {
    const q = computeQuote(
      base({ walls: [{ wallId: "w1", widthCm: 200, heightCm: 200, openings: [] }] }),
    );
    const pose = line(q, "Pose sans raccord")!;
    expect(pose.qty).toBe(8);
    expect(pose.lineTotal).toBe(44000);
    expect(pose.computation.trace.some((t) => t.includes("Minimum de pose 8 m²"))).toBe(true);
  });
  it("options : préparation, dépose, déplacement hors canton et forfait de déplacement", () => {
    const q = computeQuote(
      base({
        settings: { ...SETTINGS, travelFlatFeeCents: cents(3000) },
        options: { preparation: true, depose: true, travelOutsideCanton: true },
      }),
    );
    expect(line(q, "Préparation du support")!.lineTotal).toBe(18000);
    expect(line(q, "Dépose de l'ancien papier")!.lineTotal).toBe(14000);
    expect(line(q, "Déplacement")!.lineTotal).toBe(3000);
    expect(line(q, "Déplacement hors canton")!.lineTotal).toBe(8000);
    expect(q.blockers).toEqual([]);
  });
  it("sans pose (option ou organisation) : ni main-d'œuvre ni déplacement", () => {
    const a = computeQuote(
      base({
        options: { preparation: true, depose: true, install: false, travelOutsideCanton: true },
      }),
    );
    expect(a.lines.filter((l) => l.kind === "labor")).toEqual([]);
    expect(a.blockers).toEqual([]);
    const b = computeQuote(base({ settings: { ...SETTINGS, organizationInstalls: false } }));
    expect(b.lines.filter((l) => l.kind === "labor")).toEqual([]);
  });
  it("plusieurs murs, même papier : une ligne papier (pièce chaînée, pas de wallId) ; papiers différents : une ligne et une pose par type", () => {
    const w2: WallInput = { wallId: "w2", widthCm: 300, heightCm: 250, openings: [] };
    const same = computeQuote(
      base({ walls: [w1, w2], wallpaperByWall: { w1: STRAIGHT, w2: STRAIGHT } }),
    );
    const paperLine = same.lines.filter((l) => l.kind === "wallpaper");
    expect(paperLine).toHaveLength(1);
    expect(paperLine[0]!.wallId).toBeUndefined();
    expect(paperLine[0]!.qty).toBe(6); // 14 lés, 3 par rouleau → 5 + réserve
    expect(line(same, "Pose avec raccord")!.qty).toBe(17.5);
    const mixed = computeQuote(
      base({ walls: [w1, w2], wallpaperByWall: { w1: FREE, w2: STRAIGHT } }),
    );
    expect(mixed.lines.filter((l) => l.kind === "wallpaper")).toHaveLength(2);
    expect(line(mixed, "Pose sans raccord")!.qty).toBe(10);
    expect(line(mixed, "Pose avec raccord")!.qty).toBe(8); // 7,5 m² → minimum 8
  });
  it("panoramique au m² : quantité en m² de décor, pose panoramique depuis les paramètres puis depuis un tarif dédié", () => {
    const q = computeQuote(base({ wallpaperByWall: { w1: PANO } }));
    const paperLine = q.lines[0]!;
    expect(paperLine.unit).toBe("m²");
    expect(paperLine.qty).toBe(10.92);
    expect(paperLine.lineTotal).toBe(206388);
    expect(paperLine.description).toContain("décor sur mesure");
    const pose = line(q, "Pose panoramique")!;
    expect(pose.lineTotal).toBe(95000);
    expect(pose.computation.trace[0]).toContain("paramètres de l'organisation");
    const dedicated = computeQuote(
      base({
        wallpaperByWall: { w1: PANO },
        laborRates: [
          ...LABOR,
          {
            id: "lp",
            type: "pose_panoramique",
            unit: "m2",
            price: cents(11000),
            validFrom: "2026-01-01",
          },
        ],
      }),
    );
    expect(line(dedicated, "Pose panoramique")!.lineTotal).toBe(110000);
    const forfait = computeQuote(
      base({
        wallpaperByWall: { w1: PANO },
        laborRates: [
          {
            id: "lp",
            type: "pose_panoramique",
            unit: "forfait",
            price: cents(150000),
            validFrom: "2026-01-01",
          },
        ],
      }),
    );
    expect(line(forfait, "Pose panoramique")!.qty).toBe(1);
    expect(line(forfait, "Pose panoramique")!.unit).toBe("forfait");
    expect(line(forfait, "Pose panoramique")!.lineTotal).toBe(150000);
  });
  it("remise en % sur la marchandise, plafond vendeur et plafond organisation", () => {
    const ok = computeQuote(base({ discount: { type: "pct", value: 10, sellerLimitPct: 15 } }));
    expect(ok.discountTotal).toBe(4770);
    expect(ok.requiresAdminApproval).toBe(false);
    expect(ok.lines.at(-1)!.kind).toBe("discount");
    expect(ok.lines.at(-1)!.lineTotal).toBe(-4770);
    expect(ok.subtotal).toBe(105100);
    expect(ok.taxTotal).toBe(8127); // (105100 − 4770) × 8,1 % = 8126,73
    expect(ok.total).toBe(108455); // 100330 + 8127 = 108457 → 108455
    expect(ok.warnings).toEqual([]);
    const over = computeQuote(base({ discount: { type: "pct", value: 20, sellerLimitPct: 15 } }));
    expect(over.requiresAdminApproval).toBe(true);
    expect(over.warnings.some((w) => w.includes("validation admin"))).toBe(true);
    expect(over.warnings.some((w) => w.includes("motif obligatoire"))).toBe(true);
    const half = computeQuote(base({ discount: { type: "pct", value: 12.5, sellerLimitPct: 15 } }));
    expect(half.discountTotal).toBe(5963); // 47700 × 12,5 % = 5962,5 → half-up
  });
  it("remise en montant : plafonnée à la base, approbation si > plafond vendeur", () => {
    const a = computeQuote(base({ discount: { type: "amount", value: 5000, sellerLimitPct: 15 } }));
    expect(a.discountTotal).toBe(5000);
    expect(a.requiresAdminApproval).toBe(false);
    const b = computeQuote(base({ discount: { type: "amount", value: 5000, sellerLimitPct: 5 } }));
    expect(b.requiresAdminApproval).toBe(true);
    const capped = computeQuote(
      base({ discount: { type: "amount", value: 999999, sellerLimitPct: 100 } }),
    );
    expect(capped.discountTotal).toBe(47700);
    expect(capped.requiresAdminApproval).toBe(false);
  });
  it("remise nulle ou sans base : aucune ligne de remise", () => {
    expect(
      computeQuote(base({ discount: { type: "pct", value: 0, sellerLimitPct: 15 } })).lines.some(
        (l) => l.kind === "discount",
      ),
    ).toBe(false);
    const noBase = computeQuote(
      base({ wallpaperByWall: {}, discount: { type: "pct", value: 10, sellerLimitPct: 15 } }),
    );
    expect(noBase.lines.some((l) => l.kind === "discount")).toBe(false);
    expect(noBase.blockers).toContain("wallpaper_missing:w1");
    const otherKinds = computeQuote(
      base({
        settings: { ...SETTINGS, discountAppliesTo: ["wallpaper", "labor"] },
        discount: { type: "pct", value: 10, sellerLimitPct: 15 },
      }),
    );
    expect(otherKinds.discountTotal).toBe(10270); // 10 % de 47700 + 55000
    expect(otherKinds.lines.at(-1)!.description).toContain("wallpaper, labor");
  });
  it("sans arrondi aux 5 centimes : total = net + TVA, roundingCents 0", () => {
    const q = computeQuote(base({ settings: { ...SETTINGS, roundTotalToFiveCents: false } }));
    expect(q.total).toBe(113613);
    expect(q.roundingCents).toBe(0);
  });
  it("bloquants : TVA absente, tarif de pose absent, unité horaire, consommable sans couverture, déplacement sans tarif", () => {
    const noTax = computeQuote(base({ quoteDate: "2010-01-01" }));
    expect(noTax.blockers).toContain("tax_rate_missing");
    expect(noTax.taxTotal).toBe(0);
    expect(noTax.warnings.at(-1)).toContain("Devis incomplet");
    const noLabor = computeQuote(base({ laborRates: [] }));
    expect(noLabor.blockers).toContain("labor_rate_missing:pose_standard");
    const hourly = computeQuote(
      base({
        laborRates: [
          {
            id: "h",
            type: "pose_standard",
            unit: "hour",
            price: cents(8000),
            validFrom: "2026-01-01",
          },
        ],
      }),
    );
    expect(hourly.blockers).toContain("labor_unit_unsupported:pose_standard");
    const badGlue = computeQuote(base({ consumables: [{ ...GLUE[0]!, coverageM2PerUnit: 0 }] }));
    expect(badGlue.blockers).toContain("consumable_coverage_invalid:c1");
    const bare: QuoteSettings = omit(SETTINGS, [
      "travelOutsideCantonCents",
      "laborPanoramicM2Cents",
    ]);
    const travel = computeQuote(
      base({
        settings: bare,
        options: { preparation: false, depose: false, travelOutsideCanton: true },
      }),
    );
    expect(travel.blockers).toContain("travel_rate_missing");
    const noPanoRate = computeQuote(base({ wallpaperByWall: { w1: PANO }, settings: bare }));
    expect(noPanoRate.blockers).toContain("labor_rate_missing:pose_panoramique");
  });
  it("calepinage refusé (plinthes sans hauteur) : bloquant, avertissement, aucune ligne papier ni pose", () => {
    const q = computeQuote(
      base({ walls: [{ ...w1, baseboard: { enabled: true, heightCm: null } }] }),
    );
    expect(q.blockers).toEqual(["calepinage:w1:baseboard_height_missing"]);
    expect(q.lines).toEqual([]);
    expect(q.total).toBe(0);
    expect(q.warnings[0]).toContain("Calepinage refusé");
  });
  it("règles d'ouvertures : tout déduire / ignorer / seuil ; ouvertures positionnées prioritaires sur les non positionnées", () => {
    expect(deductThresholdM2({ kind: "subtract_all" })).toBe(0);
    expect(deductThresholdM2({ kind: "ignore" })).toBe(Number.POSITIVE_INFINITY);
    expect(deductThresholdM2({ kind: "subtract_above_m2", thresholdM2: 2 })).toBe(2);
    const legacy: WallInput = {
      ...w1,
      openings: [{ type: "window", widthCm: 100, heightCm: 100 }],
    };
    expect(
      computeQuote(
        base({
          walls: [legacy],
          settings: { ...SETTINGS, openingsRule: { kind: "subtract_all" } },
        }),
      ).billableAreaM2,
    ).toBe(9);
    expect(
      computeQuote(
        base({ walls: [legacy], settings: { ...SETTINGS, openingsRule: { kind: "ignore" } } }),
      ).billableAreaM2,
    ).toBe(10);
    expect(computeQuote(base({ walls: [legacy] })).billableAreaM2).toBe(10); // 1 m² ≤ 2
    const both: WallInput = { ...legacy, openingsV2: [op("f", "window", 150, 15, 150, 150)] };
    expect(computeQuote(base({ walls: [both] })).billableAreaM2).toBe(7.75); // 2,25 m² déduite une seule fois
  });
  it("paramètres Phase 0 minimaux (sans champs optionnels) et papier sans saleUnit : valeurs par défaut", () => {
    const minimal: QuoteSettings = {
      cutMarginTopCm: 5,
      cutMarginBottomCm: 5,
      openingsRule: { kind: "subtract_above_m2", thresholdM2: 2 },
      roundTotalToFiveCents: true,
      defaultValidityDays: 30,
      organizationInstalls: true,
    };
    const noUnit: Wallpaper = omit(wp("straight", { patternRepeatCm: 64, matchType: "straight" }), [
      "saleUnit",
    ]);
    const q = computeQuote(
      base({
        settings: minimal,
        wallpaperByWall: { w1: { wallpaper: noUnit, price: price("straight", 19900) } },
        discount: { type: "pct", value: 10, sellerLimitPct: 15 },
      }),
    );
    expect(q.blockers).toEqual([]);
    expect(q.lines[0]!.unit).toBe("rouleau");
    expect(q.lines[0]!.qty).toBe(3); // pas de rouleau de réserve sans l'option
    expect(line(q, "Pose avec raccord")!.qty).toBe(10); // pas de minimum
    expect(q.discountTotal).toBe(5970); // 10 % de 3 × 19900, marchandise par défaut
    expect(q.warnings).toEqual([]);
  });
  it("lineTotal : quantité à deux décimales, arrondi au centime half-up", () => {
    expect(lineTotal(cents(5500), 7.21)).toBe(39655);
    expect(lineTotal(cents(333), 0.5)).toBe(167); // 166,5 → 167
  });
});

describe("quoteRange — fourchette ± tolérance", () => {
  it("W et H à ± 3 % : totaux ordonnés, le seuil est franchi dès qu'une ligne au m² existe", () => {
    const r = quoteRange(base(), 3);
    expect(r.low.total).toBeLessThanOrEqual(r.mid.total);
    expect(r.mid.total).toBeLessThanOrEqual(r.high.total);
    expect(r.thresholdInside).toBe(true);
    expect(r.discreteChanges).toEqual([]); // 8 lés et 3 rouleaux dans toute la bande
    expect(r.mid.total).toBe(computeQuote(base()).total);
  });
  it("palier de rouleaux dans la bande : signalé dans discreteChanges", () => {
    const r = quoteRange(
      base({ walls: [{ wallId: "w1", widthCm: 310, heightCm: 250, openings: [] }] }),
      3,
    );
    expect(r.low.lines[0]!.qty).toBe(2);
    expect(r.high.lines[0]!.qty).toBe(3);
    expect(r.discreteChanges).toEqual(["Papier free bleu — SKU-free : 2 rouleaux → 3 rouleaux"]);
  });
  it("palier de colle dans la bande (25 m²)", () => {
    const r = quoteRange(
      base({ walls: [{ wallId: "w1", widthCm: 1000, heightCm: 250, openings: [] }] }),
      3,
    );
    expect(r.discreteChanges).toContain("Colle intissé 1 kg : 1 pot → 2 pots");
  });
  it("sans tolérance : fourchette plate", () => {
    const r = quoteRange(base(), 0);
    expect(r.thresholdInside).toBe(false);
    expect(r.low).toEqual(r.high);
  });
  it("les champs optionnels du mur sont mis à l'échelle (trapèze, point de centrage, ouvertures positionnées) ; la plinthe non", () => {
    const wallFull: WallInput = {
      wallId: "w1",
      widthCm: 400,
      heightCm: 250,
      heightLeftCm: 248,
      heightRightCm: 252,
      start: "centered",
      centerAtCm: 200,
      openings: [{ type: "door", widthCm: 90, heightCm: 210 }],
      openingsV2: [op("f", "window", 150, 15, 120, 140)],
      baseboard: { enabled: true, heightCm: 8 },
    };
    const r = quoteRange(
      base({
        walls: [wallFull],
        settings: { ...SETTINGS, openingsRule: { kind: "subtract_all" } },
      }),
      3,
    );
    const lowPlan = (r.low.lines[0]!.computation as StripComputation).plan.walls[0]!;
    const highPlan = (r.high.lines[0]!.computation as StripComputation).plan.walls[0]!;
    expect(lowPlan.strips[0]!.heightCm).toBeLessThan(highPlan.strips[0]!.heightCm);
    expect(lowPlan.billableAreaM2).toBeLessThan(highPlan.billableAreaM2);
    // ouverture positionnée mise à l'échelle : 120 × 140 × 1,03² ≈ 1,78 m² contre 1,68 au nominal
    expect(highPlan.deductedAreaM2).toBeGreaterThan(1.68);
    expect(lowPlan.deductedAreaM2).toBeLessThan(1.68);
  });
});
