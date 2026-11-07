/**
 * Géométrie du calepinage, en millimètres entiers : position des lés, hauteur utile (trapèze, plinthes),
 * découpe d'un lé en morceaux autour des ouvertures, déductions de surface.
 * Aucune notion de prix ici.
 */
import type { Opening, OpeningKindV2, StripStart } from "@wallscan/core";
import type { PieceReason, StripSkipReason } from "./types.js";
import { mod } from "./units.js";

export interface WallGeometry {
  widthMm: number;
  heightLeftMm: number;
  heightRightMm: number;
  /** 0 si l'option plinthes est désactivée. */
  baseboardMm: number;
}

/** Ouverture positionnée, en mm, rectangle normalisé (w et h > 0). */
export interface OpeningMm {
  id: string;
  kind: OpeningKindV2;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StripSpan {
  index: number;
  xFromMm: number;
  xToMm: number;
}

export interface PieceMm {
  pieceIndex: number;
  fromMm: number;
  toMm: number;
  usefulMm: number;
  lengthMm: number;
  patternStartMm: number;
  reason: PieceReason;
  openingIds: readonly string[];
}

export interface PatternSpec {
  repeatMm: number;
  /** Position du motif au plafond pour ce lé. */
  phaseMm: number;
}

/** Ouvertures qui coupent un lé en morceaux. Les radiateurs sont devant le mur : le papier passe derrière. */
const SPLITTING_KINDS: ReadonlySet<OpeningKindV2> = new Set([
  "window",
  "door",
  "french_door",
  "niche",
  "excluded",
]);

/** Bas du papier (mm depuis le plafond) à l'abscisse x : hauteur interpolée (trapèze) moins la plinthe. */
export function paperBottomAt(g: WallGeometry, xMm: number): number {
  const h = g.heightLeftMm + ((g.heightRightMm - g.heightLeftMm) * xMm) / g.widthMm;
  return Math.round(h) - g.baseboardMm;
}

/** Hauteur utile d'un lé : le papier doit couvrir le point le plus haut de son intervalle. */
export function stripHeightMm(g: WallGeometry, span: StripSpan): number {
  return Math.max(paperBottomAt(g, span.xFromMm), paperBottomAt(g, span.xToMm));
}

/**
 * Position des lés. `left` : premier lé au coin gauche. `centered` : un lé centré sur `centerAtMm`
 * (ou l'axe du mur), puis des lés vers la gauche et vers la droite jusqu'à couvrir le mur.
 * Les lés sont indexés de gauche à droite ; `anchorIndex` est le lé de référence (phase du raccord).
 */
export function layoutStrips(
  widthMm: number,
  rollWidthMm: number,
  start: StripStart,
  centerAtMm?: number,
): { spans: StripSpan[]; anchorIndex: number } {
  const spans: StripSpan[] = [];
  if (start === "left") {
    const count = Math.ceil(widthMm / rollWidthMm);
    for (let i = 0; i < count; i++) {
      spans.push({
        index: i,
        xFromMm: i * rollWidthMm,
        xToMm: Math.min((i + 1) * rollWidthMm, widthMm),
      });
    }
    return { spans, anchorIndex: 0 };
  }
  const center = Math.min(widthMm, Math.max(0, Math.round(centerAtMm ?? widthMm / 2)));
  const half = Math.round(rollWidthMm / 2);
  const first = center - half;
  const leftCount = first > 0 ? Math.ceil(first / rollWidthMm) : 0;
  const rightEdge = first + rollWidthMm;
  const rightCount = rightEdge < widthMm ? Math.ceil((widthMm - rightEdge) / rollWidthMm) : 0;
  const x0 = first - leftCount * rollWidthMm;
  const count = leftCount + 1 + rightCount;
  for (let i = 0; i < count; i++) {
    spans.push({
      index: i,
      xFromMm: Math.max(0, x0 + i * rollWidthMm),
      xToMm: Math.min(widthMm, x0 + (i + 1) * rollWidthMm),
    });
  }
  return { spans, anchorIndex: leftCount };
}

interface Interval {
  start: number;
  end: number;
  ids: string[];
  kinds: OpeningKindV2[];
}

/** Ouvertures qui couvrent toute la largeur du lé : elles seules autorisent une découpe en morceaux. */
export function coveringOpenings(span: StripSpan, openings: readonly OpeningMm[]): OpeningMm[] {
  return openings.filter(
    (o) => SPLITTING_KINDS.has(o.kind) && o.x <= span.xFromMm && o.x + o.w >= span.xToMm,
  );
}

function mergedIntervals(covering: readonly OpeningMm[], heightMm: number): Interval[] {
  const raw: Interval[] = [];
  for (const o of covering) {
    const start = Math.max(0, o.y);
    const end = Math.min(heightMm, o.y + o.h);
    if (end > start) raw.push({ start, end, ids: [o.id], kinds: [o.kind] });
  }
  raw.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const it of raw) {
    const last = merged[merged.length - 1];
    if (last && it.start <= last.end) {
      last.end = Math.max(last.end, it.end);
      last.ids.push(...it.ids);
      last.kinds.push(...it.kinds);
    } else {
      merged.push({ start: it.start, end: it.end, ids: [...it.ids], kinds: [...it.kinds] });
    }
  }
  return merged;
}

export interface SplitResult {
  heightMm: number;
  pieces: PieceMm[];
  skipped?: StripSkipReason;
  /** Intervalles verticaux occupés par des ouvertures couvrantes (pour la trace). */
  intervals: Interval[];
}

/**
 * Découpe d'un lé : un morceau par zone de mur libre entre le plafond, les ouvertures couvrantes et le bas du papier.
 * Chaque morceau reçoit les marges de coupe haut et bas et sa position dans le motif.
 */
export function splitStrip(
  span: StripSpan,
  g: WallGeometry,
  openings: readonly OpeningMm[],
  cutTopMm: number,
  cutBottomMm: number,
  pattern: PatternSpec | null,
): SplitResult {
  const heightMm = stripHeightMm(g, span);
  const covering = coveringOpenings(span, openings);
  const intervals = mergedIntervals(covering, heightMm);
  const pieces: PieceMm[] = [];
  const push = (
    fromMm: number,
    toMm: number,
    reason: PieceReason,
    openingIds: readonly string[],
  ): void => {
    const usefulMm = toMm - fromMm;
    pieces.push({
      pieceIndex: pieces.length,
      fromMm,
      toMm,
      usefulMm,
      lengthMm: usefulMm + cutTopMm + cutBottomMm,
      patternStartMm: pattern ? mod(pattern.phaseMm + fromMm, pattern.repeatMm) : 0,
      reason,
      openingIds,
    });
  };
  if (intervals.length === 0) {
    push(0, heightMm, "full", []);
    return { heightMm, pieces, intervals };
  }
  let cursor = 0;
  for (let k = 0; k < intervals.length; k++) {
    const it = intervals[k]!;
    if (it.start > cursor) {
      const prev = intervals[k - 1];
      push(
        cursor,
        it.start,
        k === 0 ? "above_opening" : "between",
        prev ? [...prev.ids, ...it.ids] : it.ids,
      );
    }
    cursor = it.end;
  }
  const last = intervals[intervals.length - 1]!;
  if (cursor < heightMm) push(cursor, heightMm, "below_opening", last.ids);
  if (pieces.length === 0) {
    const skipped: StripSkipReason = intervals.some((it) => it.kinds.includes("french_door"))
      ? "french_door"
      : "full_height_opening";
    return { heightMm, pieces, skipped, intervals };
  }
  return { heightMm, pieces, intervals };
}

export interface DeductionLine {
  label: string;
  areaMm2: number;
  deducted: boolean;
  why: "excluded" | "radiator" | "above_threshold" | "below_threshold";
}

export interface Deductions {
  grossMm2: number;
  /** Surface déduite = aire de l'UNION des ouvertures déduites (un chevauchement n'est compté qu'une fois). */
  deductedMm2: number;
  /** Somme brute des surfaces déduites ; > `deductedMm2` quand des ouvertures déduites se chevauchent. */
  deductedSumMm2: number;
  lines: DeductionLine[];
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Aire de l'union de rectangles alignés (compression de coordonnées ; exact en entiers). */
export function unionArea(boxes: readonly Box[]): number {
  const xs = [...new Set(boxes.flatMap((b) => [b.x0, b.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(boxes.flatMap((b) => [b.y0, b.y1]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const cx = (xs[i]! + xs[i + 1]!) / 2;
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      if (boxes.some((b) => b.x0 < cx && cx < b.x1 && b.y0 < cy && cy < b.y1)) {
        area += (xs[i + 1]! - xs[i]!) * (ys[j + 1]! - ys[j]!);
      }
    }
  }
  return area;
}

/**
 * Surface brute à tapisser (plinthe déduite, trapèze = hauteur moyenne) et ouvertures déduites :
 * `excluded` toujours, `radiator` jamais, les autres si leur surface dépasse strictement le seuil.
 * Les rectangles sont rognés au mur ; sur un trapèze, le bas du papier est pris en moyenne sur la largeur de l'ouverture.
 * Les ouvertures non positionnées (Phase 0) sont ajoutées telles quelles : sans position, pas de détection de chevauchement.
 */
export function computeDeductions(
  g: WallGeometry,
  openings: readonly OpeningMm[],
  areaOnly: readonly Opening[],
  deductAboveMm2: number,
): Deductions {
  const grossMm2 = (g.widthMm * (g.heightLeftMm + g.heightRightMm)) / 2 - g.widthMm * g.baseboardMm;
  const lines: DeductionLine[] = [];
  const boxes: Box[] = [];
  for (const o of openings) {
    const cx0 = Math.max(0, o.x);
    const cx1 = Math.min(g.widthMm, o.x + o.w);
    let areaMm2 = 0;
    let box: Box | null = null;
    if (cx1 > cx0) {
      const meanBottom = (paperBottomAt(g, cx0) + paperBottomAt(g, cx1)) / 2;
      const cy0 = Math.max(0, o.y);
      const cy1 = Math.min(meanBottom, o.y + o.h);
      if (cy1 > cy0) {
        areaMm2 = (cx1 - cx0) * (cy1 - cy0);
        box = { x0: cx0, x1: cx1, y0: cy0, y1: cy1 };
      }
    }
    const line = classify(o.id, o.kind, areaMm2, deductAboveMm2);
    lines.push(line);
    if (line.deducted && box) boxes.push(box);
  }
  let deductedMm2 = unionArea(boxes);
  for (const o of areaOnly) {
    const areaMm2 = Math.round(o.widthCm * 10) * Math.round(o.heightCm * 10);
    const line = classify(
      `${o.type} ${o.widthCm} × ${o.heightCm} cm (position inconnue)`,
      "window",
      areaMm2,
      deductAboveMm2,
    );
    lines.push(line);
    if (line.deducted) deductedMm2 += areaMm2;
  }
  const deductedSumMm2 = lines.reduce((s, l) => (l.deducted ? s + l.areaMm2 : s), 0);
  deductedMm2 = Math.min(deductedMm2, grossMm2);
  return { grossMm2, deductedMm2, deductedSumMm2, lines };
}

function classify(
  label: string,
  kind: OpeningKindV2,
  areaMm2: number,
  deductAboveMm2: number,
): DeductionLine {
  if (kind === "excluded") return { label, areaMm2, deducted: true, why: "excluded" };
  if (kind === "radiator") return { label, areaMm2, deducted: false, why: "radiator" };
  if (areaMm2 > deductAboveMm2) return { label, areaMm2, deducted: true, why: "above_threshold" };
  return { label, areaMm2, deducted: false, why: "below_threshold" };
}
