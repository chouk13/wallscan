/**
 * Formule simple §5.1 (PROMPT-MAITRE) : hauteur de lé arrondie au raccord, lés = ceil(largeur / largeur de lé),
 * lés par rouleau, rouleaux. C'est la règle « à la main » de l'entreprise : elle sert de référence et de borne
 * supérieure au calepinage lé par lé (`planStrips` ne commande jamais plus de rouleaux qu'elle).
 */
import type { MatchType } from "@wallscan/core";
import type { RollsComputation } from "./contract.js";
import { fmtCm, fmtM, fmtNum, plural, toMm, mmToCm } from "./units.js";

export interface SimpleRollsArgs {
  /** Nombre de lés à poser (déjà calculé : ceil(largeur / largeur de lé), ou lés du calepinage). */
  stripCount: number;
  /** Hauteur utile à couvrir (cm) : hauteur du mur, plinthe déduite ; sur un trapèze, la plus grande. */
  heightCm: number;
  cutTopCm: number;
  cutBottomCm: number;
  rollLengthCm: number;
  patternRepeatCm: number;
  matchType: MatchType;
  offsetCm: number;
  minOrderRolls: number;
  safetyRollIfPattern: boolean;
  /** Surface facturable (m²), calculée par l'appelant selon la règle d'ouvertures. */
  billableAreaM2: number;
}

/** Décalage vertical entre lés alternés : demi-raccord par défaut pour le raccord sauté, `offsetCm` sinon. */
export function dropMm(matchType: MatchType, repeatMm: number, offsetMm: number): number {
  if (matchType === "half_drop") return offsetMm > 0 ? offsetMm : Math.round(repeatMm / 2);
  if (matchType === "offset") return offsetMm;
  return 0;
}

export function hasPattern(matchType: MatchType, repeatMm: number): boolean {
  return matchType !== "free" && repeatMm > 0;
}

/** Hauteur de lé de la formule simple (mm) : utile + marges, arrondie au multiple du raccord, + décalage alterné. */
export function simpleStripHeightMm(
  a: Pick<
    SimpleRollsArgs,
    "heightCm" | "cutTopCm" | "cutBottomCm" | "patternRepeatCm" | "matchType" | "offsetCm"
  >,
): number {
  const repeatMm = toMm(a.patternRepeatCm);
  let h = toMm(a.heightCm) + toMm(a.cutTopCm) + toMm(a.cutBottomCm);
  if (hasPattern(a.matchType, repeatMm)) {
    h = Math.ceil(h / repeatMm) * repeatMm + dropMm(a.matchType, repeatMm, toMm(a.offsetCm));
  }
  return h;
}

export function computeRollsSimple(a: SimpleRollsArgs): RollsComputation {
  const trace: string[] = [];
  const repeatMm = toMm(a.patternRepeatCm);
  const rawMm = toMm(a.heightCm) + toMm(a.cutTopCm) + toMm(a.cutBottomCm);
  trace.push(
    `Hauteur de lé : ${fmtCm(toMm(a.heightCm))} de mur + ${fmtCm(toMm(a.cutTopCm))} en haut + ${fmtCm(toMm(a.cutBottomCm))} en bas = ${fmtCm(rawMm)}`,
  );
  let stripMm = rawMm;
  if (hasPattern(a.matchType, repeatMm)) {
    const rounded = Math.ceil(rawMm / repeatMm) * repeatMm;
    const kind =
      a.matchType === "half_drop" ? "sauté" : a.matchType === "offset" ? "décalé" : "droit";
    trace.push(
      `Raccord ${kind} de ${fmtCm(repeatMm)} : la hauteur de lé passe au multiple supérieur, ${fmtCm(rounded)}`,
    );
    stripMm = rounded;
    const drop = dropMm(a.matchType, repeatMm, toMm(a.offsetCm));
    if (drop > 0) {
      stripMm += drop;
      trace.push(
        `Raccord ${kind} : ${fmtCm(drop)} de plus sur un lé sur deux, on compte ${fmtCm(stripMm)} pour chaque lé`,
      );
    }
  } else if (a.matchType !== "free") {
    trace.push("Raccord déclaré sans hauteur de raccord : traité comme une pose libre");
  }
  trace.push(`Lés : ${plural(a.stripCount, "lé")}`);
  const rollMm = toMm(a.rollLengthCm);
  const stripsPerRoll = stripMm > 0 ? Math.floor(rollMm / stripMm) : 0;
  let rollCount = 0;
  if (stripsPerRoll === 0) {
    trace.push(
      `Lés par rouleau : un rouleau de ${fmtM(rollMm)} ne contient pas un lé de ${fmtCm(stripMm)} — formule simple inapplicable`,
    );
  } else {
    trace.push(
      `Lés par rouleau : un rouleau de ${fmtM(rollMm)} donne ${stripsPerRoll} lés de ${fmtCm(stripMm)}`,
    );
    rollCount = Math.ceil(a.stripCount / stripsPerRoll);
    trace.push(
      `Rouleaux : ${a.stripCount} lés à ${stripsPerRoll} par rouleau, soit ${plural(rollCount, "rouleau", "rouleaux")}`,
    );
    if (a.safetyRollIfPattern && hasPattern(a.matchType, repeatMm)) {
      rollCount += 1;
      trace.push(`Motif à raccord : un rouleau de réserve en plus, ${rollCount} au total`);
    }
    if (rollCount < a.minOrderRolls) {
      rollCount = a.minOrderRolls;
      trace.push(
        `Minimum de commande du fournisseur : ${plural(rollCount, "rouleau", "rouleaux")}`,
      );
    }
  }
  trace.push(`Surface facturée : ${fmtNum(a.billableAreaM2, 2)} m²`);
  return {
    stripHeightCm: mmToCm(stripMm),
    stripCount: a.stripCount,
    stripsPerRoll,
    rollCount,
    billableAreaM2: a.billableAreaM2,
    trace,
  };
}
