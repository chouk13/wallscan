/**
 * Empaquetage des morceaux dans les rouleaux, en mm entiers, avec respect de la position du motif.
 *
 * Modèle du raccord : sur un rouleau, la position du motif à l'abscisse t vaut (origine + t) mod R.
 * L'origine d'un rouleau neuf est fixée par sa première coupe (on commence le rouleau là où il faut : aucune perte),
 * puis chaque morceau suivant ne peut commencer qu'à une abscisse où le motif tombe juste : la longueur sautée est la
 * « perte d'attente du raccord ». Sans raccord (R = 0), les coupes s'enchaînent sans perte.
 *
 * Deux ordres sont proposés : ordre naturel des lés (premier-ajustement) et premier-ajustement décroissant (FFD).
 * Le choix final appartient à l'appelant (`bestPacking`).
 */
import { mod } from "./units.js";

export interface PackPiece {
  wallIndex: number;
  stripIndex: number;
  pieceIndex: number;
  lengthMm: number;
  patternStartMm: number;
}

export interface PackOptions {
  rollLengthMm: number;
  /** 0 = sans raccord. */
  repeatMm: number;
  cutTopMm: number;
}

export interface PackedCut {
  piece: PackPiece;
  startMm: number;
  wasteBeforeMm: number;
}

export interface PackedRoll {
  cuts: PackedCut[];
  /** Fin de la dernière coupe. */
  cursorMm: number;
  /** Position du motif à l'abscisse 0 du rouleau ; null tant que le rouleau est vierge. */
  originMm: number | null;
}

export type PackOrder = "ffd" | "natural";

export type PackResult =
  | { ok: true; rolls: PackedRoll[]; order: PackOrder }
  | { ok: false; error: "piece_longer_than_roll" };

/** Abscisse de début de coupe d'un morceau sur un rouleau donné, ou null s'il ne tient pas. */
function fit(
  roll: PackedRoll,
  piece: PackPiece,
  o: PackOptions,
): { startMm: number; originMm: number } | null {
  let startMm: number;
  let originMm: number;
  if (o.repeatMm <= 0) {
    startMm = roll.cursorMm;
    originMm = 0;
  } else if (roll.originMm === null) {
    startMm = roll.cursorMm;
    originMm = mod(piece.patternStartMm - o.cutTopMm, o.repeatMm);
  } else {
    originMm = roll.originMm;
    const earliestTop = roll.cursorMm + o.cutTopMm;
    const wait = mod(piece.patternStartMm - originMm - earliestTop, o.repeatMm);
    startMm = roll.cursorMm + wait;
  }
  return startMm + piece.lengthMm <= o.rollLengthMm ? { startMm, originMm } : null;
}

function place(roll: PackedRoll, piece: PackPiece, startMm: number, originMm: number): void {
  roll.cuts.push({ piece, startMm, wasteBeforeMm: startMm - roll.cursorMm });
  roll.cursorMm = startMm + piece.lengthMm;
  roll.originMm = originMm;
}

/** Tri déterministe : longueur décroissante, puis ordre naturel (mur, lé, morceau). */
export function sortForFfd(pieces: readonly PackPiece[]): PackPiece[] {
  return [...pieces].sort(
    (a, b) =>
      b.lengthMm - a.lengthMm ||
      a.wallIndex - b.wallIndex ||
      a.stripIndex - b.stripIndex ||
      a.pieceIndex - b.pieceIndex,
  );
}

export function packPieces(
  pieces: readonly PackPiece[],
  o: PackOptions,
  order: PackOrder,
): PackResult {
  const rolls: PackedRoll[] = [];
  const ordered = order === "ffd" ? sortForFfd(pieces) : [...pieces];
  for (const piece of ordered) {
    if (piece.lengthMm > o.rollLengthMm) return { ok: false, error: "piece_longer_than_roll" };
    let placed = false;
    for (const roll of rolls) {
      const f = fit(roll, piece, o);
      if (f) {
        place(roll, piece, f.startMm, f.originMm);
        placed = true;
        break;
      }
    }
    if (!placed) {
      const roll: PackedRoll = { cuts: [], cursorMm: 0, originMm: null };
      const f = fit(roll, piece, o)!; // un rouleau vierge accepte tout morceau ≤ longueur du rouleau
      place(roll, piece, f.startMm, f.originMm);
      rolls.push(roll);
    }
  }
  return { ok: true, rolls, order };
}

export function wasteOf(rolls: readonly PackedRoll[], rollLengthMm: number): number {
  return rolls.reduce(
    (s, r) => s + rollLengthMm - r.cuts.reduce((t, c) => t + c.piece.lengthMm, 0),
    0,
  );
}

/**
 * Meilleur empaquetage parmi des candidats : le moins de rouleaux, puis le premier candidat dans l'ordre d'appel
 * (l'appelant place en tête la variante qu'il préfère à nombre de rouleaux égal). Déterministe.
 */
export function bestPacking(
  candidates: readonly { result: PackResult; label: string }[],
): { rolls: PackedRoll[]; label: string } | { error: "piece_longer_than_roll" } {
  let best: { rolls: PackedRoll[]; label: string } | null = null;
  for (const c of candidates) {
    if (!c.result.ok) continue;
    if (!best || c.result.rolls.length < best.rolls.length)
      best = { rolls: c.result.rolls, label: c.label };
  }
  return best ?? { error: "piece_longer_than_roll" };
}
