/**
 * Pipeline automatique de mesure depuis une photo (sans intervention humaine) :
 * référence → coins du mur → distorsion → affinage → rectification → image redressée → plinthe → ouvertures.
 * Chaque étape peut échouer sans exception : le résultat porte `failure` et les étapes disponibles.
 * L'UI peut court-circuiter une étape en fournissant les coins (mur, référence) placés par l'utilisateur.
 */
import type { GrayImage, OpeningV2, Pt, Quad, ReferenceKind, WallSurvey } from "@wallscan/core";
import { REF_CORNER_SIGMA_PX } from "./constants.js";
import { applyHomography, invertHomography, scaleHomography, translateHomography } from "./homography.js";
import { distortPoint } from "./distortion.js";
import { estimateRadialDistortion, type DistortionEstimate } from "./distortionEstimate.js";
import { findHorizontalStep, proposeBaseboard, type BaseboardProposal } from "./baseboard.js";
import { WARN } from "./constants.js";
import { proposeOpenings } from "./openings.js";
import { rectify, referenceSizeCm } from "./rectify.js";
import { detectReference, type ReferenceDetection, type ReferenceHint } from "./reference.js";
import { refineCornersDetailed } from "./refine.js";
import { quadCenter } from "./segment.js";
import { proposeWallCorners, type WallCornersProposal } from "./wallCorners.js";
import { warpToPlane } from "./warp.js";

export interface MeasurePhotoInput {
  /** Image de travail (côté long ≤ 2048 px). */
  work: GrayImage;
  /** Image originale (pleine résolution) pour l'affinage de la référence ; `fullFactor` = facteur de réduction entier. */
  full?: GrayImage;
  fullFactor?: number;
  referenceHint?: ReferenceHint;
  /** Coins du mur placés par l'utilisateur (coordonnées de l'image de travail) : remplace la détection automatique. */
  wallQuad?: Quad;
  /** Référence placée par l'utilisateur : remplace la détection automatique. */
  reference?: { quad: Quad; kind: ReferenceKind };
  /** Focale en px (EXIF) si connue. */
  focalPx?: number;
  /** Distorsion connue (profil d'objectif) : remplace l'estimation sur les lignes du mur. */
  distortion?: DistortionEstimate;
  /** Échelle de l'image redressée utilisée pour plinthe et ouvertures (px/cm, défaut 2). */
  rectifiedScalePxPerCm?: number;
  /** Désactive la proposition d'ouvertures / de plinthe (défaut : activées). */
  proposeOpenings?: boolean;
  proposeBaseboard?: boolean;
}

export type MeasureFailure = "no_reference" | "no_wall_corners" | "degenerate_geometry";

export interface AutoSurveyResult {
  survey: WallSurvey | null;
  reference: (ReferenceDetection & { sigmaPx: number; manual: boolean }) | null;
  wallCorners: WallCornersProposal | null;
  distortion: DistortionEstimate | null;
  rectified: GrayImage | null;
  rectifiedScalePxPerCm: number;
  baseboard: BaseboardProposal | null;
  openings: OpeningV2[];
  timingsMs: Record<string, number>;
  failure: MeasureFailure | null;
}

export function measurePhoto(input: MeasurePhotoInput): AutoSurveyResult {
  const timings: Record<string, number> = {};
  const tick = (label: string, t0: number): void => {
    timings[label] = Math.round((performance.now() - t0) * 10) / 10;
  };
  const work = input.work;
  const imageSize = { w: work.width, h: work.height };
  const result: AutoSurveyResult = {
    survey: null,
    reference: null,
    wallCorners: null,
    distortion: null,
    rectified: null,
    rectifiedScalePxPerCm: input.rectifiedScalePxPerCm ?? 2,
    baseboard: null,
    openings: [],
    timingsMs: timings,
    failure: null,
  };

  // 1. Référence.
  let t0 = performance.now();
  let refKind: ReferenceKind | null = null;
  let refQuad: Quad | null = null;
  let sigmaPx = 0;
  if (input.reference) {
    refKind = input.reference.kind;
    refQuad = input.reference.quad;
    sigmaPx = REF_CORNER_SIGMA_PX[refKind];
    result.reference = { kind: refKind === "mire" ? "mire" : "a4", quad: refQuad, confidence: 1, sigmaPx, manual: true };
  } else {
    const det = detectReference(work, input.referenceHint ?? {});
    if (det) {
      refKind = det.kind;
      refQuad = det.quad;
      sigmaPx = REF_CORNER_SIGMA_PX[det.kind];
      // Affinage sur l'image pleine résolution quand elle est disponible.
      const factor = input.fullFactor ?? 1;
      if (input.full && factor > 1) {
        const fullQuad = det.quad.map((p) => ({ x: p.x * factor, y: p.y * factor })) as Quad;
        const refined = refineCornersDetailed(input.full, fullQuad, { radiusPx: 2 * factor + 2, maxSamples: 64, polarity: det.kind === "mire" ? -1 : 1 });
        if (refined.sides.every((s) => s.refined)) {
          refQuad = refined.quad.map((p) => ({ x: p.x / factor, y: p.y / factor })) as Quad;
          sigmaPx = sigmaPx / factor;
        }
      }
      const r: ReferenceDetection & { sigmaPx: number; manual: boolean } = { kind: det.kind, quad: refQuad, confidence: det.confidence, sigmaPx, manual: false };
      if (det.code !== undefined) r.code = det.code;
      result.reference = r;
    }
  }
  tick("reference", t0);

  // 2. Coins du mur.
  t0 = performance.now();
  const inside: Pt | undefined = refQuad ? quadCenter(refQuad) : undefined;
  let wall: WallCornersProposal | null = null;
  if (input.wallQuad) wall = { quad: input.wallQuad, confidence: 1, lines: [] };
  else wall = proposeWallCorners(work, inside ? { inside } : {});
  result.wallCorners = wall;
  tick("wallCorners", t0);

  // 3. Distorsion (lignes longues du mur) puis ré-affinage des coins dans l'espace non distordu.
  t0 = performance.now();
  let k1 = 0;
  if (input.distortion) {
    result.distortion = input.distortion;
    k1 = input.distortion.k1;
  } else if (wall && wall.lines.length >= 2) {
    const est = estimateRadialDistortion(work, wall.lines);
    result.distortion = est;
    k1 = est.k1;
  }
  if (wall && !input.wallQuad && k1 !== 0) {
    const refined = refineCornersDetailed(work, wall.quad, { radiusPx: 8, k1, maxSamples: 96 });
    wall = { ...wall, quad: refined.quad };
    result.wallCorners = wall;
  }
  tick("distortion", t0);

  if (!refQuad || !refKind) {
    result.failure = "no_reference";
    return result;
  }
  if (!wall) {
    result.failure = "no_wall_corners";
    return result;
  }

  // 4. Rectification (fonction : on peut la rejouer une fois si le bas du mur est corrigé).
  const rectifyWith = (wallQuad: Quad): WallSurvey =>
    rectify({
      wallQuad,
      refQuad: refQuad as Quad,
      refSizeCm: referenceSizeCm(refKind as ReferenceKind, refQuad as Quad),
      refKind: refKind as ReferenceKind,
      k1,
      imageSize,
      refCornerSigmaPx: sigmaPx,
      ...(input.focalPx !== undefined ? { focalPx: input.focalPx } : {}),
      ...(result.distortion ? { distortionResidualPct: Math.max(0.3, result.distortion.residualPct) } : {}),
    });
  t0 = performance.now();
  let survey = rectifyWith(wall.quad);
  tick("rectify", t0);
  if (survey.widthCm <= 0) {
    result.survey = survey;
    result.failure = "degenerate_geometry";
    return result;
  }

  // 5. Image redressée, plinthe, contrôle du bas du mur, ouvertures.
  t0 = performance.now();
  const s = Math.min(result.rectifiedScalePxPerCm, survey.scalePxPerCm);
  result.rectifiedScalePxPerCm = s;
  let rectified = warpToPlane(work, scaleHomography(survey.homography, s), Math.round(survey.widthCm * s), Math.round(survey.heightCm * s), k1);
  tick("warp", t0);
  t0 = performance.now();
  let bb = input.proposeBaseboard !== false ? proposeBaseboard(rectified, s, survey) : null;
  // Bas du mur : une ligne de marche nette 3–30 cm sous le bord inférieur retenu, sans plinthe trouvée au-dessus, et une
  // bande uniforme entre les deux = le bas retenu est un haut de plinthe. On descend le sol (jamais en silence : avertissement
  // `floor_line_ambiguous`, l'UI demande confirmation). Avec une plinthe déjà trouvée au-dessus, la ligne du dessous est un
  // joint ou un motif de sol : rien à faire.
  const floorCheck = checkFloorBelow(work, survey, s, k1);
  if (floorCheck && bb === null && !input.wallQuad) {
    const d = floorCheck.distanceCm;
    const lowered = lowerFloor(survey, wall.quad, d, imageSize);
    const survey2 = rectifyWith(lowered);
    if (survey2.widthCm > 0) {
      survey = survey2;
      wall = { ...wall, quad: lowered };
      result.wallCorners = wall;
      rectified = warpToPlane(work, scaleHomography(survey.homography, s), Math.round(survey.widthCm * s), Math.round(survey.heightCm * s), k1);
      bb = input.proposeBaseboard !== false ? proposeBaseboard(rectified, s, survey) : null;
    }
    survey = { ...survey, checks: { ...survey.checks, warnings: [...survey.checks.warnings, WARN.floorAmbiguous] } };
  } else if (floorCheck && bb === null) {
    survey = { ...survey, checks: { ...survey.checks, warnings: [...survey.checks.warnings, WARN.floorAmbiguous] } };
  }
  result.rectified = rectified;
  result.baseboard = bb;
  if (bb) survey = { ...survey, baseboard: { enabled: false, heightCm: bb.heightCm, source: "auto" } };
  if (result.distortion && result.distortion.k1 === 0 && result.distortion.residualPct > 0.3) {
    survey = { ...survey, checks: { ...survey.checks, warnings: [...survey.checks.warnings, WARN.distortionUnknown] } };
  }
  tick("baseboard", t0);
  t0 = performance.now();
  if (input.proposeOpenings !== false) {
    result.openings = proposeOpenings(rectified, s, survey);
    survey = { ...survey, openings: result.openings };
  }
  tick("openings", t0);
  result.survey = survey;
  return result;
}

/** Ligne de marche sous le bord inférieur (3–30 cm), avec bande intermédiaire uniforme (écart-type des lignes < 8). */
export function checkFloorBelow(work: GrayImage, survey: WallSurvey, s: number, k1: number): { distanceCm: number } | null {
  const outW = Math.round(survey.widthCm * s);
  const bandH = Math.round(30 * s);
  const below = warpToPlane(work, scaleHomography(translateHomography(survey.homography, 0, -survey.heightCm), s), outW, bandH, k1);
  const step = findHorizontalStep(below, Math.round(3 * s), bandH - 2, 0.5);
  if (!step || step.contrast < 8) return null;
  // Uniformité de la bande entre le bord retenu (y = 0) et la ligne trouvée : moyennes de lignes stables.
  const rows: number[] = [];
  for (let y = 1; y < Math.floor(step.y) - 2; y++) {
    let sum = 0;
    for (let x = 0; x < below.width; x++) sum += below.data[y * below.width + x];
    rows.push(sum / Math.max(1, below.width));
  }
  const mean = rows.reduce((a, v) => a + v, 0) / Math.max(1, rows.length);
  const std = Math.sqrt(rows.reduce((a, v) => a + (v - mean) * (v - mean), 0) / Math.max(1, rows.length));
  if (rows.length < 2 || std > 8) return null;
  return { distanceCm: step.y / s };
}

/** Descend les coins du bas de `d` cm dans le plan du mur (via l'homographie inverse, distorsion comprise). */
function lowerFloor(survey: WallSurvey, quad: Quad, d: number, imageSize: { w: number; h: number }): Quad {
  const inv = invertHomography(survey.homography);
  /* v8 ignore next -- l'homographie d'un survey valide est inversible */
  if (!inv) return quad;
  const k1 = survey.distortionK1 ?? 0;
  const toImage = (x: number, y: number): Pt => distortPoint(applyHomography(inv, { x, y }), k1, imageSize);
  return [quad[0], quad[1], toImage(survey.widthCm, survey.heightCm + d), toImage(0, survey.heightCm + d)];
}
