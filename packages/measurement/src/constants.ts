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
} as const;
export type WarningCode = (typeof WARN)[keyof typeof WARN];
