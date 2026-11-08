/** Constantes de la mesure photo (docs/specs/mesure-photo-v1.md §2). */
import type { ReferenceKind } from "@wallscan/core";

/** Feuille A4 : 210 × 297 mm. */
export const A4_CM = { w: 21.0, h: 29.7 } as const;
/** Mire WallScan : cadre noir extérieur 190 × 277 mm (docs/specs/mire.md). */
export const MIRE_OUTER_CM = { w: 19.0, h: 27.7 } as const;

/**
 * Géométrie de la mire IMPRIMÉE (cm) — `mire-wallscan.pdf` v1, vérifiée au banc d'impression (`scripts/build-mire.py`) et sur la
 * première photo réelle du 2026-11-08. Repère « cadre » : origine au coin haut-gauche du bord EXTÉRIEUR du cadre noir, mire en portrait.
 * Feuille A4 portrait 21 × 29,7 ; cadre extérieur 19 × 27,7 à 1 cm des bords de la feuille, épaisseur 1 cm ;
 * quatre repères de 1,5 cm (un carré en haut à gauche, trois disques) à 2 cm des bords extérieurs du cadre (centres à 2,75 cm) ;
 * code 5 × 5 cellules de 1 cm centré sur le cadre, motif fixe `MIRE_CODE_PATTERN`.
 */
export const MIRE_LAYOUT = {
  sheetW: 21,
  sheetH: 29.7,
  frameMargin: 1,
  frameW: 19,
  frameH: 27.7,
  frameT: 1,
  /** Côté des repères d'angle (cm) et retrait de leur bord extérieur depuis le bord extérieur du cadre (cm). */
  cornerSquare: 1.5,
  cornerInset: 2,
  codeCell: 1,
  codeCells: 5,
} as const;

/** Motif du code imprimé (25 cellules, ligne par ligne depuis le haut-gauche en portrait, 1 = noir). */
export const MIRE_CODE_PATTERN = "1011001001110100010110111";
/** Nombre maximal de cellules divergentes tolérées à la lecture (bruit, flou). */
export const MIRE_CODE_MAX_ERRORS = 2;

/** Cellules du code pour la mire v1 : motif fixe (l'identifiant est ignoré, une seule mire est imprimée). */
export function mireCodeCells(_code = 0): boolean[] {
  return Array.from(MIRE_CODE_PATTERN, (ch) => ch === "1");
}

/**
 * Décode 25 cellules (true = noir) lues dans l'orientation du quad testé : `0` si le motif imprimé est reconnu
 * (≤ `MIRE_CODE_MAX_ERRORS` cellules divergentes), `null` sinon. Le motif diffère de ses trois rotations d'au moins 9 cellules,
 * donc l'orientation retenue par `decodeMire` est sans ambiguïté.
 */
export function decodeMireCells(cells: readonly boolean[]): number | null {
  if (cells.length !== MIRE_CODE_PATTERN.length) return null;
  let errors = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] !== (MIRE_CODE_PATTERN[i] === "1")) errors++;
  return errors <= MIRE_CODE_MAX_ERRORS ? 0 : null;
}

/** Incertitude (px, 1σ) sur les coins de la référence selon la méthode (§2.3 étape 8). */
export const REF_CORNER_SIGMA_PX: Record<ReferenceKind, number> = { mire: 0.5, a4: 1.5, manual_a4: 4 };
/** Incertitude (px, 1σ) sur les coins du mur. */
export const WALL_CORNER_SIGMA_PX = 3;
/** Distorsion résiduelle après correction (%). */
export const DISTORTION_RESIDUAL_PCT = 0.3;
/** Plage de focales balayée pour les contrôles géométriques quand l'EXIF manque : 22–35 mm équivalent 24 × 36. */
export const FOCAL_SWEEP_MM_EQUIV = { min: 22, max: 35 } as const;
/** Largeur maximale de l'image redressée (px). */
export const MAX_RECTIFIED_WIDTH_PX = 2048;
/** Sous cette taille apparente (px) la référence est trop petite pour être fiable. */
export const REFERENCE_MIN_SIDE_PX = 40;

/** Seuils des contrôles (%). */
export const CHECK_REFERENCE_ASPECT_PCT = 1.5;
export const CHECK_OPPOSITE_SIDES_PCT = 1.0;
export const CHECK_TRAPEZOID_PCT = 2.0;
export const CHECK_DISTORTION_PCT = 2.0;

/**
 * Codes d'avertissement (clés i18n, jamais de texte UI en dur). Correspondance FR indicative :
 * degenerate_geometry → « géométrie invalide, replacer les coins » ; reference_orientation_invalid → « référence mal orientée » ;
 * reference_aspect_mismatch → « feuille pas à plat ou mal taquée » ; wall_corners_inconsistent → « coin mal placé » ;
 * wall_trapezoid → « mur non rectangulaire (deux hauteurs) » ; reference_too_small → « référence trop petite sur la photo » ;
 * uncertainty_above_display_tolerance → « précision insuffisante » ; distortion_high → « distorsion forte (grand-angle ?) » ;
 * geometry_check_unavailable → « contrôle géométrique impossible » ; baseboard_height_required → « hauteur de plinthe à mesurer ou saisir » ;
 * floor_line_ambiguous → « une autre ligne horizontale existe juste sous le bas du mur : vérifier que le bas est bien le sol » ;
 * distortion_not_estimated → « distorsion de l'objectif non corrigée (lignes du mur peu nettes) ».
 * Moteur v2 (2026-11-08, seuils docs/quality-thresholds.md « Banc de réalisme ») :
 * measure_implausible → « dimensions hors des bornes d'un mur : mesure à vérifier, envoi du devis bloqué » ;
 * reference_ambiguous → « plusieurs objets ressemblent à la feuille : confirmer laquelle » ;
 * reference_scale_suspect → « la feuille paraît trop grande ou trop petite par rapport au mur » ;
 * reference_small → « feuille petite sur la photo : se rapprocher » (40–55 px ; < 40 px = reference_too_small) ;
 * image_soft → « photo un peu floue : reprise conseillée » ; image_blurry → « photo floue : reprendre la photo » ;
 * distortion_strong → « objectif très déformant (grand-angle) » ; distortion_extreme → « ultra grand-angle : reprendre en ×1 ».
 */
export const WARN = {
  degenerate: "degenerate_geometry",
  referenceOrientation: "reference_orientation_invalid",
  referenceAspect: "reference_aspect_mismatch",
  wallCorners: "wall_corners_inconsistent",
  trapezoid: "wall_trapezoid",
  referenceSmall: "reference_too_small",
  uncertaintyHigh: "uncertainty_above_display_tolerance",
  distortionHigh: "distortion_high",
  geometryCheckUnavailable: "geometry_check_unavailable",
  baseboardHeightRequired: "baseboard_height_required",
  floorAmbiguous: "floor_line_ambiguous",
  distortionUnknown: "distortion_not_estimated",
  measureImplausible: "measure_implausible",
  referenceAmbiguous: "reference_ambiguous",
  referenceScaleSuspect: "reference_scale_suspect",
  referenceSmallWarn: "reference_small",
  imageSoft: "image_soft",
  imageBlurry: "image_blurry",
  distortionStrong: "distortion_strong",
  distortionExtreme: "distortion_extreme",
} as const;

/**
 * Codes qui valent REFUS de la photo (docs/quality-thresholds.md, colonne « Refuser ») : l'UI demande une reprise et bloque
 * l'envoi du devis tant que la mesure n'a pas été corrigée ou confirmée. Les autres codes sont des avertissements.
 */
export const REFUSAL_WARNINGS: readonly string[] = [
  WARN.measureImplausible, WARN.imageBlurry, WARN.referenceSmall, WARN.distortionExtreme, WARN.degenerate,
];

/**
 * Plausibilité d'un mur intérieur (cm) : hauteur 150–450, largeur 40–1 500 (docs/quality-thresholds.md). Hors bornes →
 * `measure_implausible`. Une fausse référence (autre rectangle clair pris pour la feuille) donne typiquement −60 à −70 %
 * (ex. 153 × 81 cm), toujours hors bornes. Bornes élargies le 2026-11-08 après la première photo réelle : un pan de mur
 * d'entrée de 87 cm entre un angle et une armoire est courant, de même qu'un mur sous rampant de 1,5 m.
 */
export const PLAUSIBLE_HEIGHT_CM = { min: 150, max: 450 } as const;
export const PLAUSIBLE_WIDTH_CM = { min: 40, max: 1500 } as const;
/**
 * Cohérence feuille / mur : f = grand côté de la référence (cm) / hauteur du mur rectifié (cm), c.-à-d. la part de la hauteur
 * du mur redressé occupée par la feuille. A4 : f > 14 % ⇔ mur < 2,12 m ; f < 4 % ⇔ mur > 7,4 m → `reference_scale_suspect`.
 * (Équivaut à des bornes sur H exprimées en proportion d'image ; plus serré que la plausibilité côté bas, pour signaler tôt
 * une feuille confondue avec un objet plus grand qu'elle.)
 */
export const REF_WALL_FRACTION = { min: 0.04, max: 0.14 } as const;
/** Petit côté de la feuille (px, image de travail) : < 40 refus (`reference_too_small`), 40–55 avertissement (`reference_small`). */
export const REFERENCE_WARN_SIDE_PX = 55;
/** |k1| (modèle de division) : > 0,05 `distortion_strong`, > 0,10 `distortion_extreme` (refus). */
export const K1_STRONG = 0.05;
export const K1_EXTREME = 0.1;
/** Ambiguïté de référence : un second candidat au score > 70 % du meilleur. */
export const REFERENCE_AMBIGUITY_RATIO = 0.7;
/** La référence doit être dans le tiers central du mur en largeur et dans [15 % ; 85 %] en hauteur (yeux à 1,4–1,7 m). */
export const REFERENCE_CENTER_BOX = { xMin: 1 / 3, xMax: 2 / 3, yMin: 0.15, yMax: 0.85 } as const;
/** Plafonds de confiance de la mesure : code de refus → 0,5 ; autre avertissement de fiabilité → 0,79 (bannière < 0,8). */
export const CONFIDENCE_CAP_REFUSAL = 0.5;
export const CONFIDENCE_CAP_WARNING = 0.79;
export type WarningCode = (typeof WARN)[keyof typeof WARN];
