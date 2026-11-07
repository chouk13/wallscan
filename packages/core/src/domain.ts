/**
 * Types de domaine partagés (miroir du schéma §3). Aucune logique ici.
 * Les montants sont des `Cents`, les dimensions des entiers en mm ou des nombres en cm selon le champ.
 */
import type { Cents, Currency, BasisPoints } from "./money.js";

export type Id = string; // uuid

export type Role = "admin" | "seller" | "client";
export type Locale = "fr" | "de" | "it" | "en";

export type MatchType = "free" | "straight" | "offset" | "half_drop";

export interface Wallpaper {
  id: Id;
  orgId: Id;
  collectionId: Id;
  sku: string;
  name: string;
  colorName?: string;
  rollWidthCm: number;
  rollLengthCm: number;
  patternRepeatCm: number;
  matchType: MatchType;
  offsetCm: number;
  textureUrl?: string;
  textureScalePxPerCm?: number;
  thumbnailUrl?: string;
  active: boolean;
  /** Unité de vente (colonne `wallpapers.sale_unit`). Absent = au rouleau. Au m² : `salePricePerRoll` est le prix du m². */
  saleUnit?: "roll" | "m2";
}

export interface WallpaperPrice {
  priceListId: Id;
  wallpaperId: Id;
  purchasePrice?: Cents; // jamais exposé au rôle client
  salePricePerRoll: Cents;
  minOrderRolls: number;
  currency: Currency;
}

/** `pose_panoramique` : type dédié (migration 0002) ; à défaut, `QuoteSettings.laborPanoramicM2Cents`. */
export type LaborType = "pose_standard" | "pose_raccord" | "pose_panoramique" | "preparation" | "depose";
export type LaborUnit = "m2" | "hour" | "forfait";

export interface LaborRate {
  id: Id;
  type: LaborType;
  unit: LaborUnit;
  price: Cents;
  validFrom: string; // ISO date
  validTo?: string;
}

export interface Consumable {
  id: Id;
  name: string;
  unit: string;
  price: Cents;
  coverageM2PerUnit: number;
}

export interface TaxRate {
  id: Id;
  country: string;
  rateBp: BasisPoints; // 8,1 % = 810
  validFrom: string;
  validTo?: string;
  label: string;
}

export type OpeningType = "door" | "window" | "other";

export interface Opening {
  type: OpeningType;
  widthCm: number;
  heightCm: number;
}

export type MeasurementMethod = "ar" | "lidar" | "reference_object" | "manual";

export interface WallMeasurement {
  widthCm: number;
  heightCm: number;
  areaM2: number;
  openings: Opening[];
  method: MeasurementMethod;
  /** 0..1 — sous 0.8 l'UI exige une vérification avant envoi du devis. */
  confidence: number;
  correctedByUser: boolean;
}

export type OpeningsRule =
  | { kind: "subtract_all" }
  | { kind: "subtract_above_m2"; thresholdM2: number }
  | { kind: "ignore" };

/** Paramètres de devis d'une organisation (`organizations.quote_settings`). Tous `À CONFIRMER` avec Soufflet. */
export interface QuoteSettings {
  cutMarginTopCm: number;
  cutMarginBottomCm: number;
  openingsRule: OpeningsRule;
  roundTotalToFiveCents: boolean;
  defaultValidityDays: number;
  organizationInstalls: boolean;
  // --- Champs optionnels (miroir de `organizations.quote_settings` du seed v2) ; données, jamais des constantes de code.
  /** Rouleau de réserve ajouté quand le papier a un raccord. Absent = faux. */
  safetyRollIfPattern?: boolean;
  /** Surface minimale facturée par ligne de main-d'œuvre (m²). Absent = pas de minimum. */
  laborMinimumM2?: number;
  /** Forfait de déplacement systématique (centimes). 0 ou absent = aucune ligne. */
  travelFlatFeeCents?: Cents;
  /** Forfait de déplacement hors canton (centimes), facturé si l'option est cochée. */
  travelOutsideCantonCents?: Cents;
  /** Plafond de remise (%) au-delà duquel une validation / un motif est requis. */
  discountMaxPct?: number;
  /** Lignes auxquelles la remise s'applique. Absent = ["wallpaper"]. */
  discountAppliesTo?: readonly QuoteLineKind[];
  /** Tarif de pose panoramique au m² (centimes) si aucun `labor_rates.type = pose_panoramique` n'existe. */
  laborPanoramicM2Cents?: Cents;
}

export type QuoteStatus = "draft" | "sent" | "viewed" | "accepted" | "refused" | "expired";
export type QuoteLineKind = "wallpaper" | "labor" | "consumable" | "discount" | "custom";

// ---------------------------------------------------------------------------------------------
// Mesure depuis une photo (docs/specs/mesure-photo-v1.md, docs/specs/measurement-api.md §1)
// ---------------------------------------------------------------------------------------------

/** Point : pixels (image de travail) ou cm (plan du mur) selon le contexte. */
export interface Pt {
  x: number;
  y: number;
}

/** Quadrilatère ordonné : haut-gauche, haut-droit, bas-droit, bas-gauche. */
export type Quad = [Pt, Pt, Pt, Pt];

/** Image en niveaux de gris, 1 octet par pixel, ligne par ligne (centre du pixel i en i + 0,5). */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Référence d'échelle : mire WallScan, feuille A4 détectée, feuille A4 tapée à la main. */
export type ReferenceKind = "mire" | "a4" | "manual_a4";

export type OpeningKindV2 = "window" | "door" | "french_door" | "radiator" | "niche" | "excluded";

/** Rectangle en cm, origine en haut à gauche du mur. */
export interface RectCm {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OpeningV2 {
  id: string;
  kind: OpeningKindV2;
  rect: RectCm;
  confidence: number;
  source: "auto" | "user";
}

/** Origine de la hauteur de plinthe : mesurée sur la photo, proposée automatiquement, saisie. Jamais de défaut. */
export type BaseboardSource = "measured" | "auto" | "user";

export interface WallSurvey {
  /** Moyenne des côtés opposés. */
  widthCm: number;
  heightCm: number;
  /** Trapèze si l'écart dépasse 2 %. */
  heightLeftCm: number;
  heightRightCm: number;
  /** Incertitude réelle, propagée (quadratique). */
  uncertaintyPct: number;
  /** 3 si la référence a été détectée automatiquement, 5 si elle a été tapée à la main. */
  displayTolerancePct: 3 | 5;
  reference: ReferenceKind;
  /** Échelle de l'image redressée. */
  scalePxPerCm: number;
  /** 9 valeurs (ligne par ligne) : image de travail (coordonnées non distordues) → plan du mur (cm). */
  homography: number[];
  openings: OpeningV2[];
  /** Hauteur réelle (mesurée ou saisie) ou `null` tant qu'elle n'est ni mesurée ni saisie. */
  baseboard: { enabled: boolean; heightCm: number | null; source: BaseboardSource | null };
  checks: { oppositeSidesPct: number; referenceAspectPct: number; distortionPct: number; warnings: string[] };
  /** Coefficient k1 (modèle de division, rayon normalisé par la demi-diagonale) appliqué avant l'homographie. Absent = 0. */
  distortionK1?: number;
  /** Taille de l'image de travail dans laquelle l'homographie et k1 s'appliquent. */
  imageSize?: { w: number; h: number };
}

// ---------------------------------------------------------------------------------------------
// Calepinage (docs/specs/measurement-api.md §3) — ajouts quote-engineer, Phase 1. `OpeningV2` : voir ci-dessus.
// ---------------------------------------------------------------------------------------------

/** Unité de vente d'une référence : au rouleau, ou au m² (panoramiques / décors imprimés sur mesure). */
export type SaleUnit = "roll" | "m2";

/**
 * Plinthes : la hauteur est TOUJOURS réelle (mesurée ou saisie), jamais une valeur par défaut.
 * `enabled` vrai avec `heightCm` null = option demandée sans hauteur → le calepinage refuse (`baseboard_height_missing`).
 */
export interface BaseboardInput {
  enabled: boolean;
  heightCm: number | null;
}

/** Départ du calepinage : premier lé au coin gauche, ou lé centré (axe du mur ou point choisi). */
export type StripStart = "left" | "centered";
