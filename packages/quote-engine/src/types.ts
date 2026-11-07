/**
 * Types publics du calepinage lé par lé (docs/specs/measurement-api.md §3) et de la fourchette de devis.
 * Les champs du contrat sont conservés tels quels ; les ajouts sont documentés comme tels.
 */
import type {
  BaseboardInput,
  MatchType,
  Opening,
  OpeningV2,
  SaleUnit,
  StripStart,
} from "@wallscan/core";

export interface StripPlanWall {
  widthCm: number;
  heightLeftCm: number;
  heightRightCm: number;
  /** Ouvertures positionnées et confirmées (cm, origine haut-gauche). */
  openings: readonly OpeningV2[];
  /** `enabled` sans `heightCm` → refus explicite (`baseboard_height_missing`), jamais de valeur par défaut. */
  baseboard: BaseboardInput;
  /**
   * AJOUT — ouvertures sans position (contrat Phase 0 : type + dimensions). Déduites de la surface facturable
   * selon la règle, mais jamais découpées dans les lés (on ne sait pas où elles sont).
   */
  areaOnlyOpenings?: readonly Opening[];
}

export interface StripPlanPaper {
  rollWidthCm: number;
  /** Longueur du rouleau ; ignorée (peut être 0) quand `saleUnit` = "m2". */
  rollLengthCm: number;
  patternRepeatCm: number;
  matchType: MatchType;
  /** Décalage du raccord sauté/décalé ; pour `half_drop`, 0 = demi-raccord. */
  offsetCm: number;
  saleUnit: SaleUnit;
  minOrderRolls: number;
}

export interface StripPlanSettings {
  cutTopCm: number;
  cutBottomCm: number;
  start: StripStart;
  /** Axe du lé central (cm depuis le coin gauche) en mode `centered` ; absent = milieu du mur. */
  centerAtCm?: number;
  /** Surface (m²) au-delà de laquelle une ouverture est déduite de la surface facturable (strictement supérieure). */
  deductAboveM2: number;
  safetyRollIfPattern: boolean;
  /** Position du motif (cm, 0 ≤ φ < raccord) attendue au plafond pour le premier lé : continuité depuis le mur précédent. */
  phaseOffsetCm?: number;
}

export interface StripPlanInput {
  wall: StripPlanWall;
  paper: StripPlanPaper;
  settings: StripPlanSettings;
}

export type PieceReason = "full" | "above_opening" | "below_opening" | "between";

export interface StripPiece {
  stripIndex: number;
  /** AJOUT — rang du morceau dans son lé (0 = le plus haut). */
  pieceIndex: number;
  /** Position verticale (cm depuis le plafond) du haut de la partie utile. */
  fromCm: number;
  /** Position verticale (cm depuis le plafond) du bas de la partie utile. */
  toCm: number;
  /** Longueur à prélever sur le rouleau : utile + marges haut et bas. */
  lengthCm: number;
  /** AJOUT — longueur utile (sans marges). */
  usefulCm: number;
  /** Position dans le motif (cm, 0 ≤ p < raccord) attendue en haut de la partie utile ; 0 sans raccord. */
  patternStartCm: number;
  reason: PieceReason;
  /** AJOUT — identifiants des ouvertures qui bordent le morceau (pour la trace et l'UI). */
  openingIds: readonly string[];
}

export type StripSkipReason = "french_door" | "full_height_opening";

export interface StripInfo {
  index: number;
  xFromCm: number;
  xToCm: number;
  /** AJOUT — hauteur utile du lé (max des hauteurs sur son intervalle, plinthe déduite). */
  heightCm: number;
  /** AJOUT — position du motif au plafond pour ce lé (cm) ; 0 sans raccord. */
  phaseCm: number;
  pieces: readonly StripPiece[];
  /** Lé entièrement couvert par une ouverture pleine hauteur : aucun papier. `french_door` = contrat ; autre pleine hauteur = ajout. */
  skipped?: StripSkipReason;
}

export interface RollCut {
  stripIndex: number;
  pieceIndex: number;
  lengthCm: number;
  /** AJOUT — position de début de coupe sur le rouleau (cm depuis le début du rouleau). */
  startCm: number;
  /** AJOUT — perte d'attente du raccord juste avant cette coupe (cm). */
  wasteBeforeCm: number;
  /** AJOUT — index du mur dans une pièce (`planRoom`) ; absent pour un mur seul. */
  wallIndex?: number;
}

export interface RollPlan {
  index: number;
  cuts: readonly RollCut[];
  /** Longueur non posée du rouleau : pertes de raccord + chute finale = longueur − Σ coupes. */
  wasteCm: number;
  /** AJOUT — longueur consommée jusqu'à la fin de la dernière coupe. */
  usedCm: number;
}

export type StripPlanError =
  "baseboard_height_missing" | "invalid_wall" | "invalid_paper" | "piece_longer_than_roll";

export interface StripPlan {
  strips: readonly StripInfo[];
  /** Plan de coupe des rouleaux réellement découpés (`rolls.length` = `rollsUsed` ≤ `rollCount`). */
  rolls: readonly RollPlan[];
  /** Rouleaux à commander : découpés + réserve éventuelle, puis minimum fournisseur. 0 en vente au m². */
  rollCount: number;
  /** AJOUT — rouleaux réellement découpés (hors réserve / minimum). */
  rollsUsed: number;
  /** AJOUT — résultat de la formule simple §5.1 appliquée au même nombre de lés et à la hauteur maximale (comparaison). */
  simpleRollCount: number;
  /** Vente au m² : surface de décor à commander (lés entiers × largeur × hauteur de lé avec marges). */
  m2Decor?: number;
  billableAreaM2: number;
  /** AJOUT — surface brute à tapisser (plinthe déduite) et surface des ouvertures déduites. */
  grossAreaM2: number;
  deductedAreaM2: number;
  wasteTotalCm: number;
  /** Position du motif attendue au plafond pour le premier lé du mur suivant (continuité du raccord). */
  phaseOutCm: number;
  /** AJOUT — nombre de lés posés (hors `skipped`) et de morceaux. */
  stripCount: number;
  pieceCount: number;
  /** AJOUT — lé de référence du raccord : 0 en départ gauche, le lé central en départ centré (porte `phaseOffsetCm`). */
  anchorIndex: number;
  trace: readonly string[];
  /** AJOUT — refus explicite : les autres champs sont vides/0 et `trace` explique. */
  error?: StripPlanError;
}

export interface RoomPlan {
  walls: readonly StripPlan[];
  rollCount: number;
  trace: readonly string[];
  /** AJOUT — empaquetage commun : rouleaux découpés, `cuts[].wallIndex` renseigné. */
  rolls: readonly RollPlan[];
  rollsUsed: number;
  /** AJOUT — somme des `rollCount` des murs pris isolément (ce que coûterait une commande mur par mur). */
  separateRollCount: number;
  m2Decor?: number;
  billableAreaM2: number;
  wasteTotalCm: number;
  error?: StripPlanError;
}
