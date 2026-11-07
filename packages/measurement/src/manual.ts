/**
 * packages/measurement/manual — Phase 0 : contrat + méthode manuelle + règle d'ouvertures (conservé tel quel).
 * AR native et objet de référence : Phase 1/2 (`measurement-engineer`).
 */
import type { Opening, OpeningsRule, WallMeasurement, Result } from "@wallscan/core";
import { err, ok } from "@wallscan/core";

/** Sous ce seuil, l'UI affiche « Mesure à vérifier avant d'envoyer le devis ». */
export const CONFIDENCE_VERIFY_THRESHOLD = 0.8;

/** Dimensions physiques d'objets de référence (mm). Porte CH : À CONFIRMER par le vendeur. */
export const REFERENCE_OBJECTS_MM = {
  a4_sheet: { width: 210, height: 297 },
  ch_socket_type_j_plate: { width: 85, height: 85 },
  ch_door_standard_2000x800: { width: 800, height: 2000 },
  ch_door_standard_2100x900: { width: 900, height: 2100 },
} as const;
export type ReferenceObjectKey = keyof typeof REFERENCE_OBJECTS_MM;

export function needsVerification(m: Pick<WallMeasurement, "confidence">): boolean {
  return m.confidence < CONFIDENCE_VERIFY_THRESHOLD;
}

export function openingAreaM2(o: Opening): number {
  return (o.widthCm * o.heightCm) / 10_000;
}

/** Surface à déduire selon la règle d'organisation (paramétrable, §4.1). */
export function deductibleOpeningsM2(openings: readonly Opening[], rule: OpeningsRule): number {
  switch (rule.kind) {
    case "ignore":
      return 0;
    case "subtract_all":
      return openings.reduce((s, o) => s + openingAreaM2(o), 0);
    case "subtract_above_m2":
      return openings.reduce((s, o) => {
        const a = openingAreaM2(o);
        return a > rule.thresholdM2 ? s + a : s;
      }, 0);
  }
}

export interface ManualInput {
  widthCm: number;
  heightCm: number;
  openings?: readonly Opening[];
}

/** Saisie manuelle : toujours disponible, jamais bloquante. Confiance = 1 (le vendeur est la source). */
export function manualMeasurement(input: ManualInput, rule: OpeningsRule): Result<WallMeasurement> {
  const { widthCm, heightCm } = input;
  if (!Number.isFinite(widthCm) || widthCm <= 0) return err("Largeur invalide");
  if (!Number.isFinite(heightCm) || heightCm <= 0) return err("Hauteur invalide");
  const openings = [...(input.openings ?? [])];
  for (const o of openings) {
    if (o.widthCm <= 0 || o.heightCm <= 0) return err("Ouverture invalide");
    if (o.widthCm > widthCm || o.heightCm > heightCm) return err("Ouverture plus grande que le mur");
  }
  const gross = (widthCm * heightCm) / 10_000;
  const areaM2 = round2(gross - deductibleOpeningsM2(openings, rule));
  return ok({ widthCm, heightCm, areaM2, openings, method: "manual", confidence: 1, correctedByUser: false });
}

/** Correction par le vendeur, quelle que soit la méthode d'origine ; tracée via `correctedByUser`. */
export function applyCorrection(
  original: WallMeasurement,
  correction: Partial<Pick<WallMeasurement, "widthCm" | "heightCm" | "openings">>,
  rule: OpeningsRule,
): Result<WallMeasurement> {
  const r = manualMeasurement(
    {
      widthCm: correction.widthCm ?? original.widthCm,
      heightCm: correction.heightCm ?? original.heightCm,
      openings: correction.openings ?? original.openings,
    },
    rule,
  );
  if (!r.ok) return r;
  return ok({ ...r.value, method: original.method, confidence: 1, correctedByUser: true });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
