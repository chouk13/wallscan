/**
 * Contrat public du devis (Phase 0, enrichi en Phase 1 sans rupture).
 *
 * Invariants (non négociables) :
 *  - pur TypeScript, zéro I/O, zéro dépendance réseau, zéro Date.now() : la date est une entrée ;
 *  - déterministe : mêmes entrées → même sortie ;
 *  - montants en Cents ; taux en points de base ; aucune constante de prix dans le code ;
 *  - chaque ligne porte une `trace[]` lisible par le vendeur (« Pourquoi 7 rouleaux ? »).
 */
import type {
  BaseboardInput,
  BasisPoints,
  Cents,
  Consumable,
  Currency,
  LaborRate,
  Opening,
  OpeningV2,
  QuoteLineKind,
  QuoteSettings,
  StripStart,
  TaxRate,
  Wallpaper,
  WallpaperPrice,
} from "@wallscan/core";
import type { RoomPlan } from "./types.js";

export interface WallInput {
  wallId: string;
  widthCm: number;
  /** Hauteur (moyenne sur un trapèze). */
  heightCm: number;
  /** Ouvertures sans position (Phase 0) : déduites de la surface selon la règle, jamais découpées dans les lés. */
  openings: readonly Opening[];
  // --- Enrichissements calepinage (Phase 1, optionnels) ---
  /** Trapèze : hauteurs gauche/droite ; absentes = `heightCm` des deux côtés. */
  heightLeftCm?: number;
  heightRightCm?: number;
  /** Ouvertures positionnées et confirmées : découpe des lés en morceaux + déduction de surface. */
  openingsV2?: readonly OpeningV2[];
  /** Plinthes (hauteur réelle obligatoire si `enabled`). Absent = sans plinthes. */
  baseboard?: BaseboardInput;
  /** Départ du calepinage ; absent = coin gauche. */
  start?: StripStart;
  centerAtCm?: number;
}

export interface RollsComputation {
  stripHeightCm: number; // hauteur_le
  stripCount: number; // nb_les
  stripsPerRoll: number; // les_par_rouleau
  rollCount: number; // nb_rouleaux (après min_order_rolls / lots)
  billableAreaM2: number; // surface_facturable_m2
  trace: readonly string[];
}

/** Calcul d'une ligne papier peint par calepinage : formule simple conservée pour comparaison, plan complet joint. */
export interface StripComputation extends RollsComputation {
  /** Résultat de la formule simple §5.1 sur la même pose (comparaison « à la main » vs calepinage). */
  simpleRollCount: number;
  /** Surface de décor (m²) en vente au m². */
  m2Decor?: number;
  plan: RoomPlan;
}

export interface QuoteLineInput {
  kind: QuoteLineKind;
  wallId?: string;
  wallpaperId?: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: Cents;
  taxRateBp: BasisPoints;
}

export interface QuoteLineOutput extends QuoteLineInput {
  lineTotal: Cents;
  taxAmount: Cents;
  computation: RollsComputation | StripComputation | { trace: readonly string[] };
}

export interface QuoteOptions {
  preparation: boolean;
  depose: boolean;
  /** Pose par l'entreprise ; absent = `settings.organizationInstalls`. */
  install?: boolean;
  /** Déplacement hors canton (forfait `settings.travelOutsideCantonCents`). */
  travelOutsideCanton?: boolean;
}

export interface QuoteInput {
  /** Date du devis (ISO) : sélectionne price list, taux de TVA et tarifs valides. Jamais Date.now(). */
  quoteDate: string;
  currency: Currency;
  settings: QuoteSettings;
  walls: readonly WallInput[];
  wallpaperByWall: Readonly<Record<string, { wallpaper: Wallpaper; price: WallpaperPrice }>>;
  laborRates: readonly LaborRate[];
  consumables: readonly Consumable[];
  taxRates: readonly TaxRate[];
  options: QuoteOptions;
  discount?: { type: "pct" | "amount"; value: number; sellerLimitPct: number };
}

export interface QuoteOutput {
  engineVersion: string;
  lines: readonly QuoteLineOutput[];
  subtotal: Cents;
  discountTotal: Cents;
  taxTotal: Cents;
  total: Cents;
  /** Vrai si une remise dépasse le plafond vendeur → validation admin requise. */
  requiresAdminApproval: boolean;
  warnings: readonly string[];
  // --- Ajouts Phase 1 ---
  /** Écart d'arrondi aux 5 centimes appliqué au total TTC (0 si désactivé). */
  roundingCents: Cents;
  /** Surface facturable totale (m²), base des consommables et de la main-d'œuvre. */
  billableAreaM2: number;
  /** Non vide = le devis est incomplet (tarif manquant, calepinage refusé) et NE DOIT PAS être envoyé. */
  blockers: readonly string[];
}

export interface QuoteRange {
  low: QuoteOutput;
  mid: QuoteOutput;
  high: QuoteOutput;
  /** Contrat : les totaux à −tol et +tol diffèrent → afficher une fourchette. */
  thresholdInside: boolean;
  /** AJOUT — quantités discrètes qui changent dans la bande (rouleaux, pots…) : la vraie raison d'une fourchette. */
  discreteChanges: readonly string[];
}

/** Statut de validation du moteur, affiché dans le rapport de phase et l'admin. */
export const ENGINE_VALIDATION_STATUS =
  "NON VALIDÉ — moteur implémenté et testé sur cas simulés ; jeu de référence Soufflet (≥ 40 devis réels) manquant" as const;
