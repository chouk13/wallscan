/**
 * Pipeline automatique de mesure depuis une photo (sans intervention humaine) :
 * référence → coins du mur → distorsion → affinage → rectification → image redressée → plinthe → ouvertures.
 * Chaque étape peut échouer sans exception : le résultat porte `failure` et les étapes disponibles.
 * L'UI peut court-circuiter une étape en fournissant les coins (mur, référence) placés par l'utilisateur.
 */
import type { GrayImage, OpeningV2, Pt, Quad, ReferenceKind, WallSurvey } from "@wallscan/core";
import {
  CONFIDENCE_CAP_REFUSAL, CONFIDENCE_CAP_WARNING, K1_EXTREME, K1_STRONG, REF_CORNER_SIGMA_PX, REFERENCE_CENTER_BOX, REFUSAL_WARNINGS,
} from "./constants.js";
import { applyHomography, invertHomography, scaleHomography, translateHomography } from "./homography.js";
import { distortPoint } from "./distortion.js";
import { estimateRadialDistortion, estimateRadialDistortionFromPolylines, type DistortionEstimate } from "./distortionEstimate.js";
import { findHorizontalStep, proposeBaseboard, type BaseboardProposal } from "./baseboard.js";
import { WARN } from "./constants.js";
import { proposeOpenings } from "./openings.js";
import { imageToWallCm, rectify, referenceSizeCm } from "./rectify.js";
import { detectReference, type ReferenceDetection, type ReferenceHint } from "./reference.js";
import { refineCornersDetailed } from "./refine.js";
import { quadCenter } from "./segment.js";
import { proposeWallCorners, type WallCornersProposal } from "./wallCorners.js";
import { warpToPlane } from "./warp.js";
import { refineWallQuad, sampleQuadEdgesDense, type WallQuadRefinement } from "./wallRefine.js";
import { sharpness, type SharpnessResult } from "./quality.js";

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
  /**
   * Affinage des coins du mur par droites ajustées sur l'image pleine résolution (`refineWallQuad`, nécessite `full`).
   * Défaut : activé pour les coins détectés automatiquement, désactivé pour `wallQuad` fourni (intention de l'utilisateur) ;
   * `true` l'active aussi sur des coins placés à la main (coins tapés à ±3 px → intersection de droites).
   */
  refineWallQuad?: boolean;
  /** Contrôle de netteté de l'image de travail (`sharpness`, codes `image_soft` / `image_blurry`). Défaut : activé. */
  checkSharpness?: boolean;
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
  /** Affinage pleine résolution des coins du mur (repère pleine résolution : quad, droites, résidus en px de `full`). */
  wallRefinement: WallQuadRefinement | null;
  /** Netteté de l'image de travail (null si désactivée). */
  sharpness: SharpnessResult | null;
  /**
   * Confiance globale de la mesure (0–1) : min(confiance de la référence, confiance des coins du mur), plafonnée à 0,5 en
   * présence d'un code de refus (`REFUSAL_WARNINGS`, `reference_ambiguous`) et à 0,79 pour tout autre avertissement sauf les codes informatifs (`baseboard_height_required`, `reference_small`) ; `reference_scale_suspect` vaut 0,79, pas 0,5 —
   * autre avertissement de fiabilité (hors `baseboard_height_required`) : < 0,8 ⇒ bannière « Mesure à vérifier ». 0 sans mesure.
   */
  confidence: number;
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
    wallRefinement: null,
    sharpness: null,
    confidence: 0,
    timingsMs: timings,
    failure: null,
  };

  // 0. Netteté de l'image de travail (codes ajoutés au survey en fin de pipeline).
  let t0 = performance.now();
  if (input.checkSharpness !== false) result.sharpness = sharpness(work);
  tick("sharpness", t0);

  // 1. Référence.
  t0 = performance.now();
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
      if (det.candidates) r.candidates = det.candidates;
      if (det.ambiguous !== undefined) r.ambiguous = det.ambiguous;
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

  // 3. Distorsion puis affinage des coins. Avec l'image pleine résolution : arêtes du mur échantillonnées en sous-pixel sur
  // l'originale (40–120 profils par côté) → k1 sur ces polylignes (pondérées par la longueur) → droites ajustées dans
  // l'espace non distordu → coins = intersections. Sans elle (ou si l'affinage échoue) : chemin v1 sur l'image de travail.
  t0 = performance.now();
  const factor = input.fullFactor ?? 1;
  const full = input.full;
  const wantRefine = input.wallQuad ? input.refineWallQuad === true : input.refineWallQuad !== false;
  // Fenêtre de recherche : coin proposé (affiné sur l'image de travail) à ~1 px de travail, coin tapé à ±3 px → 2 × facteur + 4.
  const searchPx = 2 * factor + 4;
  const fullQuad: Quad | null = wall && full && wantRefine ? (wall.quad.map((p) => ({ x: p.x * factor, y: p.y * factor })) as Quad) : null;
  let k1 = 0;
  if (input.distortion) {
    result.distortion = input.distortion;
    k1 = input.distortion.k1;
  } else {
    let est: DistortionEstimate | null = null;
    if (fullQuad && full) {
      const polylines = sampleQuadEdgesDense(full, fullQuad, { searchPx }).map((l) => l.map((p) => ({ x: p.x / factor, y: p.y / factor })));
      const poly = estimateRadialDistortionFromPolylines(polylines, imageSize);
      if (poly.linesUsed >= 2) est = poly;
    }
    if (!est && wall && wall.lines.length >= 2) est = estimateRadialDistortion(work, wall.lines);
    if (est) {
      result.distortion = est;
      k1 = est.k1;
    }
  }
  let refinedFull = false;
  if (wall && fullQuad && full) {
    const r = refineWallQuad(full, fullQuad, { searchPx, k1 });
    result.wallRefinement = r;
    if (r.refined) {
      wall = { ...wall, quad: r.quad.map((p) => ({ x: p.x / factor, y: p.y / factor })) as Quad };
      result.wallCorners = wall;
      refinedFull = true;
    }
  }
  if (wall && !input.wallQuad && k1 !== 0 && !refinedFull) {
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
  survey = withQualityWarnings(survey, result, refQuad);
  result.survey = survey;
  result.confidence = measureConfidence(survey, result);
  return result;
}

// Les codes ajoutés ici ne sont jamais produits par `rectify` : pas de doublon possible.
const addWarning = (survey: WallSurvey, code: string): WallSurvey => ({ ...survey, checks: { ...survey.checks, warnings: [...survey.checks.warnings, code] } });

/**
 * Codes de qualité constatés par le moteur (docs/quality-thresholds.md, banc de réalisme) : netteté, référence ambiguë ou
 * excentrée, distorsion forte / extrême (k1 appliqué, fourni, ou optimum brut rejeté).
 */
export function withQualityWarnings(
  survey: WallSurvey,
  result: Pick<AutoSurveyResult, "sharpness" | "reference" | "distortion">,
  refQuad: Quad,
): WallSurvey {
  let s = survey;
  const sh = result.sharpness;
  if (sh && sh.verdict === "blurry") s = addWarning(s, WARN.imageBlurry);
  else if (sh && sh.verdict === "soft") s = addWarning(s, WARN.imageSoft);
  const ref = result.reference;
  if (ref && !ref.manual) {
    // Centre de la référence dans le plan du mur, en fraction de W et H (indépendant de l'échelle, donc d'une fausse feuille).
    const c = imageToWallCm(s, quadCenter(refQuad));
    const u = c.x / s.widthCm;
    const v = c.y / s.heightCm;
    const b = REFERENCE_CENTER_BOX;
    const offCenter = !(u >= b.xMin && u <= b.xMax && v >= b.yMin && v <= b.yMax);
    if (ref.ambiguous === true || offCenter) s = addWarning(s, WARN.referenceAmbiguous);
  }
  const d = result.distortion;
  if (d) {
    const k = Math.max(Math.abs(d.k1), Math.abs(d.rawK1 ?? 0));
    if (k > K1_EXTREME) s = addWarning(s, WARN.distortionExtreme);
    else if (k > K1_STRONG) s = addWarning(s, WARN.distortionStrong);
  }
  return s;
}

/** Confiance globale plafonnée par les avertissements (voir `AutoSurveyResult.confidence`). */
function measureConfidence(survey: WallSurvey, result: AutoSurveyResult): number {
  let c = Math.min((result.reference as { confidence: number }).confidence, (result.wallCorners as WallCornersProposal).confidence);
  // Décision lead-architect 2026-11-08 : `reference_scale_suspect` seul (combles, murs bas) vaut avertissement, pas refus ;
  // `reference_small` (40–55 px) est informatif — au banc, ces mesures restent à 0,17 % en p95 — et ne plafonne pas la confiance.
  const severe = [...REFUSAL_WARNINGS, WARN.referenceAmbiguous];
  const informational: readonly string[] = [WARN.baseboardHeightRequired, WARN.referenceSmallWarn];
  const w = survey.checks.warnings;
  if (w.some((x) => severe.includes(x))) c = Math.min(c, CONFIDENCE_CAP_REFUSAL);
  else if (w.some((x) => !informational.includes(x))) c = Math.min(c, CONFIDENCE_CAP_WARNING);
  return c;
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
