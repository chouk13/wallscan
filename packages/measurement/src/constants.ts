/** Constantes de la mesure photo (docs/specs/mesure-photo-v1.md §2). */
import type { ReferenceKind } from "@wallscan/core";

/** Feuille A4 : 210 × 297 mm. */
export const A4_CM = { w: 21.0, h: 29.7 } as const;
/** Mire WallScan : cadre noir extérieur 190 × 277 mm (docs/specs/mire.md). */
export const MIRE_OUTER_CM = { w: 19.0, h: 27.7 } as const;

/**
 * Géométrie de la mire (cm). Repère « cadre » : origine au coin haut-gauche du bord EXTÉRIEUR du cadre noir, mire en portrait.
 * Feuille A4 portrait 21 × 29,7 ; cadre extérieur 19 × 27,7 à 1 cm des bords de la feuille, épaisseur 1 cm ;
 * quatre carrés de repère 2 × 2 à 3 cm des bords extérieurs du cadre ; code 4 × 4 cellules de 1,5 cm centré.
 */
export const MIRE_LAYOUT = {
  sheetW: 21,
  sheetH: 29.7,
  frameMargin: 1,
  frameW: 19,
  frameH: 27.7,
  frameT: 1,
  cornerSquare: 2,
  cornerInset: 3,
  codeCell: 1.5,
  codeCells: 4,
} as const;

/** Cellules du code (ligne par ligne, 16) : coins = (noir, blanc, blanc, blanc) pour l'orientation, 12 cellules = id 6 bits + complément. */
export const MIRE_PAYLOAD_CELLS = [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14] as const;

export function mireCodeCells(code: number): boolean[] {
  const cells = new Array<boolean>(16).fill(false);
  cells[0] = true;
  for (let b = 0; b < 6; b++) {
    const bit = ((code >> b) & 1) === 1;
    cells[MIRE_PAYLOAD_CELLS[b]] = bit;
    cells[MIRE_PAYLOAD_CELLS[b + 6]] = !bit;
  }
  return cells;
}

/** Décode 16 cellules (true = noir) ; `null` si l'orientation ou le complément ne correspondent pas. */
export function decodeMireCells(cells: readonly boolean[]): number | null {
  if (!cells[0] || cells[3] || cells[12] || cells[15]) return null;
  let code = 0;
  for (let b = 0; b < 6; b++) {
    const bit = cells[MIRE_PAYLOAD_CELLS[b]];
    if (cells[MIRE_PAYLOAD_CELLS[b + 6]] === bit) return null;
    if (bit) code |= 1 << b;
  }
  return code;
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
