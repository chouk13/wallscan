/**
 * Composition du devis (§5.2) en centimes : lignes papier par calepinage (`planRoom` par référence), colle et
 * consommables, pose (minimum facturé), préparation / dépose, déplacement, remise plafonnée, TVA par taux,
 * arrondi suisse aux 5 centimes. Puis `quoteRange` : le même devis à −tol / nominal / +tol (W et H ensemble).
 *
 * Tous les prix viennent des entrées (base de l'entreprise) ; aucun montant n'est écrit dans ce fichier.
 */
import type {
  Cents,
  LaborRate,
  LaborType,
  OpeningsRule,
  QuoteLineKind,
  QuoteSettings,
  Wallpaper,
  WallpaperPrice,
} from "@wallscan/core";
import { applyPercentBp, cents, mulRatio, roundToFiveCents, sub, sum, ZERO } from "@wallscan/core";
import type {
  QuoteInput,
  QuoteLineOutput,
  QuoteOutput,
  QuoteRange,
  StripComputation,
  WallInput,
} from "./contract.js";
import { computeRollsSimple } from "./simple.js";
import { planRoom } from "./strips.js";
import type { RoomPlan, StripPlanInput } from "./types.js";
import { fmtNum, plural } from "./units.js";
import { ENGINE_VERSION } from "./version.js";

/** Quantité × prix unitaire, la quantité ayant au plus deux décimales (m², rouleaux, pots) ; arrondi au centime half-up. */
export function lineTotal(unitPrice: Cents, qty: number): Cents {
  return mulRatio(unitPrice, Math.round(qty * 100), 100);
}

function validAt<T extends { validFrom: string; validTo?: string }>(
  rates: readonly T[],
  quoteDate: string,
): T | undefined {
  const day = quoteDate.slice(0, 10);
  const valid = rates.filter(
    (r) =>
      r.validFrom.slice(0, 10) <= day && (r.validTo === undefined || day <= r.validTo.slice(0, 10)),
  );
  valid.sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0));
  return valid[0];
}

export function deductThresholdM2(rule: OpeningsRule): number {
  switch (rule.kind) {
    case "subtract_all":
      return 0;
    case "subtract_above_m2":
      return rule.thresholdM2;
    case "ignore":
      return Number.POSITIVE_INFINITY;
  }
}

function toStripInput(
  w: WallInput,
  wp: Wallpaper,
  price: WallpaperPrice,
  s: QuoteSettings,
): StripPlanInput {
  const settings: StripPlanInput["settings"] = {
    cutTopCm: s.cutMarginTopCm,
    cutBottomCm: s.cutMarginBottomCm,
    start: w.start ?? "left",
    deductAboveM2: deductThresholdM2(s.openingsRule),
    safetyRollIfPattern: s.safetyRollIfPattern ?? false,
  };
  if (w.centerAtCm !== undefined) settings.centerAtCm = w.centerAtCm;
  const wall: StripPlanInput["wall"] = {
    widthCm: w.widthCm,
    heightLeftCm: w.heightLeftCm ?? w.heightCm,
    heightRightCm: w.heightRightCm ?? w.heightCm,
    openings: w.openingsV2 ?? [],
    baseboard: w.baseboard ?? { enabled: false, heightCm: null },
  };
  // Les ouvertures sans position (Phase 0) ne sont utilisées que si aucune liste positionnée n'est fournie (pas de double déduction).
  if (w.openingsV2 === undefined) wall.areaOnlyOpenings = w.openings;
  return {
    wall,
    paper: {
      rollWidthCm: wp.rollWidthCm,
      rollLengthCm: wp.rollLengthCm,
      patternRepeatCm: wp.patternRepeatCm,
      matchType: wp.matchType,
      offsetCm: wp.offsetCm,
      saleUnit: wp.saleUnit ?? "roll",
      minOrderRolls: price.minOrderRolls,
    },
    settings,
  };
}

interface Group {
  wallpaper: Wallpaper;
  price: WallpaperPrice;
  wallIds: string[];
  inputs: StripPlanInput[];
}

function laborTypeFor(wp: Wallpaper): LaborType {
  if ((wp.saleUnit ?? "roll") === "m2") return "pose_panoramique";
  return wp.matchType === "free" ? "pose_standard" : "pose_raccord";
}

const LABOR_LABELS: Record<LaborType, string> = {
  pose_standard: "Pose sans raccord",
  pose_raccord: "Pose avec raccord",
  pose_panoramique: "Pose panoramique",
  preparation: "Préparation du support",
  depose: "Dépose de l'ancien papier",
};

function wallpaperDescription(wp: Wallpaper): string {
  const color = wp.colorName ? ` ${wp.colorName}` : "";
  const unit = (wp.saleUnit ?? "roll") === "m2" ? " (décor sur mesure, au m²)" : "";
  return `${wp.name}${color} — ${wp.sku}${unit}`;
}

/** Calcul « simple » agrégé pour remplir le contrat Phase 0 (`RollsComputation`) à côté du plan complet. */
function stripComputation(plan: RoomPlan, g: Group, s: QuoteSettings): StripComputation {
  const stripCount = plan.walls.reduce((n, w) => n + w.stripCount, 0);
  const maxHeightCm = plan.walls.reduce(
    (m, w) => Math.max(m, ...w.strips.map((x) => x.heightCm)),
    0,
  );
  const simple = computeRollsSimple({
    stripCount,
    heightCm: maxHeightCm,
    cutTopCm: s.cutMarginTopCm,
    cutBottomCm: s.cutMarginBottomCm,
    rollLengthCm: g.wallpaper.rollLengthCm,
    patternRepeatCm: g.wallpaper.patternRepeatCm,
    matchType: g.wallpaper.matchType,
    offsetCm: g.wallpaper.offsetCm,
    minOrderRolls: g.price.minOrderRolls,
    safetyRollIfPattern: s.safetyRollIfPattern ?? false,
    billableAreaM2: plan.billableAreaM2,
  });
  const out: StripComputation = {
    stripHeightCm: simple.stripHeightCm,
    stripCount,
    stripsPerRoll: simple.stripsPerRoll,
    rollCount: plan.rollCount,
    billableAreaM2: plan.billableAreaM2,
    trace: plan.trace,
    simpleRollCount: simple.rollCount,
    plan,
  };
  if (plan.m2Decor !== undefined) out.m2Decor = plan.m2Decor;
  return out;
}

export function computeQuote(input: QuoteInput): QuoteOutput {
  const s = input.settings;
  const warnings: string[] = [];
  const blockers: string[] = [];
  const lines: QuoteLineOutput[] = [];

  const tax = validAt(input.taxRates, input.quoteDate);
  if (!tax) blockers.push("tax_rate_missing");
  const taxBp = tax?.rateBp ?? 0;

  // --- Papier peint : un calepinage de pièce par référence (murs groupés, motif chaîné, empaquetage commun).
  const groups: Group[] = [];
  for (const w of input.walls) {
    const ref = input.wallpaperByWall[w.wallId];
    if (!ref) {
      blockers.push(`wallpaper_missing:${w.wallId}`);
      continue;
    }
    let g = groups.find((x) => x.wallpaper.id === ref.wallpaper.id);
    if (!g) {
      g = { wallpaper: ref.wallpaper, price: ref.price, wallIds: [], inputs: [] };
      groups.push(g);
    }
    g.wallIds.push(w.wallId);
    g.inputs.push(toStripInput(w, ref.wallpaper, ref.price, s));
  }

  let areaCenti = 0; // surface facturable totale en centièmes de m² (entier)
  const laborAreas = new Map<LaborType, number>();
  for (const g of groups) {
    const plan = planRoom(g.inputs);
    if (plan.error) {
      blockers.push(`calepinage:${g.wallIds.join("+")}:${plan.error}`);
      warnings.push(`Calepinage refusé (${g.wallIds.join(", ")}) : ${plan.trace.at(-1)!}`); // un refus porte toujours une trace
      continue;
    }
    const centi = Math.round(plan.billableAreaM2 * 100);
    areaCenti += centi;
    const lt = laborTypeFor(g.wallpaper);
    laborAreas.set(lt, (laborAreas.get(lt) ?? 0) + centi);
    const m2 = (g.wallpaper.saleUnit ?? "roll") === "m2";
    const qty = m2 ? plan.m2Decor! : plan.rollCount; // m2Decor toujours défini en vente au m²
    const line: QuoteLineOutput = {
      kind: "wallpaper",
      wallpaperId: g.wallpaper.id,
      description: wallpaperDescription(g.wallpaper),
      qty,
      unit: m2 ? "m²" : "rouleau",
      unitPrice: g.price.salePricePerRoll,
      taxRateBp: taxBp,
      lineTotal: lineTotal(g.price.salePricePerRoll, qty),
      taxAmount: ZERO,
      computation: stripComputation(plan, g, s),
    };
    if (g.wallIds.length === 1) line.wallId = g.wallIds[0]!;
    lines.push(line);
  }

  // --- Consommables : une ligne par consommable fourni, arrondi à l'unité supérieure.
  for (const c of input.consumables) {
    const coverageCenti = Math.round(c.coverageM2PerUnit * 100);
    if (coverageCenti <= 0) {
      blockers.push(`consumable_coverage_invalid:${c.id}`);
      continue;
    }
    const qty = Math.ceil(areaCenti / coverageCenti);
    if (qty === 0) continue;
    lines.push({
      kind: "consumable",
      description: c.name,
      qty,
      unit: c.unit,
      unitPrice: c.price,
      taxRateBp: taxBp,
      lineTotal: lineTotal(c.price, qty),
      taxAmount: ZERO,
      computation: {
        trace: [
          `${c.name} : une unité couvre ${fmtNum(c.coverageM2PerUnit, 2)} m² → ${qty} × ${c.unit} pour ${fmtNum(areaCenti / 100, 2)} m²`,
        ],
      },
    });
  }

  // --- Main-d'œuvre.
  const install = input.options.install ?? s.organizationInstalls;
  const minCenti = Math.round((s.laborMinimumM2 ?? 0) * 100);
  const pushLabor = (type: LaborType, centi: number): void => {
    const rate = validAt(
      input.laborRates.filter((r) => r.type === type),
      input.quoteDate,
    );
    const trace: string[] = [];
    let unit: LaborRate["unit"];
    let price: Cents;
    if (rate) {
      unit = rate.unit;
      price = rate.price;
    } else if (type === "pose_panoramique" && s.laborPanoramicM2Cents !== undefined) {
      unit = "m2";
      price = s.laborPanoramicM2Cents;
      trace.push(
        "Tarif panoramique pris dans les paramètres de l'organisation (aucun tarif dédié)",
      );
    } else {
      blockers.push(`labor_rate_missing:${type}`);
      return;
    }
    if (unit === "hour") {
      blockers.push(`labor_unit_unsupported:${type}`);
      return;
    }
    const qtyCenti = Math.max(centi, minCenti);
    if (qtyCenti > centi)
      trace.push(
        `Minimum de pose ${fmtNum(minCenti / 100, 2)} m² appliqué (surface ${fmtNum(centi / 100, 2)} m²)`,
      );
    const qty = unit === "forfait" ? 1 : qtyCenti / 100;
    trace.push(
      unit === "forfait"
        ? `${LABOR_LABELS[type]} : forfait`
        : `${LABOR_LABELS[type]} : ${fmtNum(qty, 2)} m² × ${fmtNum(price / 100, 2)}`,
    );
    lines.push({
      kind: "labor",
      description: LABOR_LABELS[type],
      qty,
      unit: unit === "forfait" ? "forfait" : "m²",
      unitPrice: price,
      taxRateBp: taxBp,
      lineTotal: lineTotal(price, qty),
      taxAmount: ZERO,
      computation: { trace },
    });
  };
  if (install && areaCenti > 0) {
    for (const type of ["pose_standard", "pose_raccord", "pose_panoramique"] as const) {
      const centi = laborAreas.get(type);
      if (centi) pushLabor(type, centi);
    }
    if (input.options.preparation) pushLabor("preparation", areaCenti);
    if (input.options.depose) pushLabor("depose", areaCenti);
    if (s.travelFlatFeeCents !== undefined && s.travelFlatFeeCents > 0) {
      lines.push({
        kind: "labor",
        description: "Déplacement",
        qty: 1,
        unit: "forfait",
        unitPrice: s.travelFlatFeeCents,
        taxRateBp: taxBp,
        lineTotal: s.travelFlatFeeCents,
        taxAmount: ZERO,
        computation: { trace: ["Forfait de déplacement de l'organisation"] },
      });
    }
    if (input.options.travelOutsideCanton) {
      if (s.travelOutsideCantonCents !== undefined && s.travelOutsideCantonCents > 0) {
        lines.push({
          kind: "labor",
          description: "Déplacement hors canton",
          qty: 1,
          unit: "forfait",
          unitPrice: s.travelOutsideCantonCents,
          taxRateBp: taxBp,
          lineTotal: s.travelOutsideCantonCents,
          taxAmount: ZERO,
          computation: { trace: ["Forfait hors canton de l'organisation"] },
        });
      } else {
        blockers.push("travel_rate_missing");
      }
    }
  }

  // --- Remise (sur les lignes autorisées, marchandise par défaut), plafonnée par le vendeur.
  const subtotal = sum(lines.map((l) => l.lineTotal));
  let discountTotal: Cents = ZERO;
  let requiresAdminApproval = false;
  const d = input.discount;
  if (d && d.value > 0) {
    const appliesTo: readonly QuoteLineKind[] = s.discountAppliesTo ?? ["wallpaper"];
    const base = sum(lines.filter((l) => appliesTo.includes(l.kind)).map((l) => l.lineTotal));
    if (base > 0) {
      const trace: string[] = [];
      let description: string;
      if (d.type === "pct") {
        const bp = Math.round(d.value * 100);
        discountTotal = applyPercentBp(base, bp);
        requiresAdminApproval = d.value > d.sellerLimitPct;
        description = `Remise ${fmtNum(d.value, 2)} % sur ${appliesTo.length === 1 && appliesTo[0] === "wallpaper" ? "la marchandise" : appliesTo.join(", ")}`;
        trace.push(
          `${fmtNum(d.value, 2)} % de ${fmtNum(base / 100, 2)} = ${fmtNum(discountTotal / 100, 2)}`,
        );
        if (s.discountMaxPct !== undefined && d.value > s.discountMaxPct)
          warnings.push(
            `Remise ${fmtNum(d.value, 2)} % au-delà du plafond de l'organisation (${fmtNum(s.discountMaxPct, 2)} %) : motif obligatoire`,
          );
      } else {
        discountTotal = cents(Math.min(Math.round(d.value), base));
        requiresAdminApproval = discountTotal * 10_000 > base * Math.round(d.sellerLimitPct * 100);
        description = "Remise sur la marchandise";
        trace.push(
          `Remise de ${fmtNum(discountTotal / 100, 2)} sur une base de ${fmtNum(base / 100, 2)}`,
        );
      }
      if (requiresAdminApproval) {
        warnings.push(
          `Remise au-delà du plafond vendeur (${fmtNum(d.sellerLimitPct, 2)} %) : validation admin requise`,
        );
        trace.push(`Plafond vendeur ${fmtNum(d.sellerLimitPct, 2)} % dépassé → validation admin`);
      }
      lines.push({
        kind: "discount",
        description,
        qty: 1,
        unit: "",
        unitPrice: cents(-discountTotal),
        taxRateBp: taxBp,
        lineTotal: cents(-discountTotal),
        taxAmount: ZERO,
        computation: { trace },
      });
    }
  }

  // --- TVA : par ligne (information) et par taux sur la base nette (montant retenu).
  const byRate = new Map<number, Cents>();
  for (const l of lines) {
    l.taxAmount = applyPercentBp(l.lineTotal, l.taxRateBp);
    byRate.set(l.taxRateBp, sum([byRate.get(l.taxRateBp) ?? ZERO, l.lineTotal]));
  }
  const taxTotal = sum([...byRate.entries()].map(([bp, base]) => applyPercentBp(base, bp)));
  const net = sub(subtotal, discountTotal);
  let total = sum([net, taxTotal]);
  let roundingCents: Cents = ZERO;
  if (s.roundTotalToFiveCents) {
    const rounded = roundToFiveCents(total);
    roundingCents = sub(rounded, total);
    total = rounded;
  }
  if (blockers.length > 0)
    warnings.push(`Devis incomplet, ne pas envoyer : ${blockers.join(", ")}`);
  return {
    engineVersion: ENGINE_VERSION,
    lines,
    subtotal,
    discountTotal,
    taxTotal,
    total,
    requiresAdminApproval,
    warnings,
    roundingCents,
    billableAreaM2: areaCenti / 100,
    blockers,
  };
}

function scaleWall(w: WallInput, pct: number): WallInput {
  const k = (v: number): number => (v * (100 + pct)) / 100;
  const out: WallInput = {
    ...w,
    widthCm: k(w.widthCm),
    heightCm: k(w.heightCm),
    openings: w.openings.map((o) => ({ ...o, widthCm: k(o.widthCm), heightCm: k(o.heightCm) })),
  };
  if (w.heightLeftCm !== undefined) out.heightLeftCm = k(w.heightLeftCm);
  if (w.heightRightCm !== undefined) out.heightRightCm = k(w.heightRightCm);
  if (w.centerAtCm !== undefined) out.centerAtCm = k(w.centerAtCm);
  if (w.openingsV2 !== undefined) {
    out.openingsV2 = w.openingsV2.map((o) => ({
      ...o,
      rect: { x: k(o.rect.x), y: k(o.rect.y), w: k(o.rect.w), h: k(o.rect.h) },
    }));
  }
  return out; // la hauteur de plinthe n'est pas mise à l'échelle : saisie ou mesurée localement, son erreur est négligeable
}

/**
 * Fourchette : W et H (et les ouvertures, mesurées dans la même image) à −tol %, nominal, +tol %.
 * `thresholdInside` = les totaux extrêmes diffèrent ; `discreteChanges` dit quelles quantités à paliers ont basculé.
 */
export function quoteRange(input: QuoteInput, tolerancePct: number): QuoteRange {
  const low = computeQuote({
    ...input,
    walls: input.walls.map((w) => scaleWall(w, -tolerancePct)),
  });
  const mid = computeQuote(input);
  const high = computeQuote({
    ...input,
    walls: input.walls.map((w) => scaleWall(w, tolerancePct)),
  });
  const discreteChanges: string[] = [];
  for (const hl of high.lines) {
    if ((hl.kind !== "wallpaper" && hl.kind !== "consumable") || hl.unit === "m²") continue;
    const ll = low.lines.find((l) => l.kind === hl.kind && l.description === hl.description);
    if (ll && ll.qty !== hl.qty) {
      const pl = hl.unit === "rouleau" ? "rouleaux" : `${hl.unit}s`;
      discreteChanges.push(
        `${hl.description} : ${plural(ll.qty, hl.unit, pl)} → ${plural(hl.qty, hl.unit, pl)}`,
      );
    }
  }
  return { low, mid, high, thresholdInside: low.total !== high.total, discreteChanges };
}
