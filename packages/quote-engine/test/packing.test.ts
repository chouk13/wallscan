import { describe, expect, it } from "vitest";
import { bestPacking, packPieces, sortForFfd, wasteOf, type PackPiece } from "../src/packing.js";

const piece = (
  lengthMm: number,
  patternStartMm = 0,
  stripIndex = 0,
  pieceIndex = 0,
  wallIndex = 0,
): PackPiece => ({
  wallIndex,
  stripIndex,
  pieceIndex,
  lengthMm,
  patternStartMm,
});

describe("empaquetage (mm)", () => {
  it("sans raccord : coupes enchaînées sans perte, nouveau rouleau quand ça ne tient plus", () => {
    const r = packPieces(
      [piece(2600, 0, 0), piece(2600, 0, 1), piece(2600, 0, 2), piece(2600, 0, 3)],
      { rollLengthMm: 10050, repeatMm: 0, cutTopMm: 50 },
      "natural",
    );
    expect(r.ok && r.rolls.length).toBe(2);
    if (r.ok) {
      expect(r.rolls[0]!.cuts.map((c) => c.startMm)).toEqual([0, 2600, 5200]);
      expect(r.rolls[0]!.cuts.every((c) => c.wasteBeforeMm === 0)).toBe(true);
      expect(wasteOf(r.rolls, 10050)).toBe(10050 * 2 - 4 * 2600);
    }
  });
  it("avec raccord : la première coupe d'un rouleau ne perd rien, les suivantes attendent la bonne phase", () => {
    // raccord 640, marge haute 50 : lé 1 phase 0 → origine 590 ; lé 2 phase 320 doit commencer à s ≡ 370 (mod 640), s ≥ 2650 → 2930
    const r = packPieces(
      [piece(2600, 0, 0), piece(2600, 320, 1)],
      { rollLengthMm: 10050, repeatMm: 640, cutTopMm: 50 },
      "natural",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rolls[0]!.originMm).toBe(590);
      expect(r.rolls[0]!.cuts[1]!.startMm).toBe(2880);
      expect(r.rolls[0]!.cuts[1]!.wasteBeforeMm).toBe(280);
    }
  });
  it("un morceau qui ne tient pas dans la chute (phase comprise) part sur un nouveau rouleau", () => {
    const r = packPieces(
      [piece(9000, 0, 0), piece(900, 0, 1)],
      { rollLengthMm: 10050, repeatMm: 640, cutTopMm: 50 },
      "natural",
    );
    expect(r.ok && r.rolls.length).toBe(2); // 9000 + attente 600 + 900 > 10050
    const free = packPieces(
      [piece(9000, 0, 0), piece(900, 0, 1)],
      { rollLengthMm: 10050, repeatMm: 0, cutTopMm: 50 },
      "natural",
    );
    expect(free.ok && free.rolls.length).toBe(1);
  });
  it("morceau plus long que le rouleau → erreur", () => {
    const r = packPieces([piece(11000)], { rollLengthMm: 10050, repeatMm: 0, cutTopMm: 50 }, "ffd");
    expect(r).toEqual({ ok: false, error: "piece_longer_than_roll" });
    expect(bestPacking([{ result: r, label: "x" }])).toEqual({ error: "piece_longer_than_roll" });
  });
  it("tri FFD : longueur décroissante puis mur, lé, morceau (déterministe)", () => {
    const sorted = sortForFfd([
      piece(100, 0, 1, 1, 1),
      piece(100, 0, 1, 0, 1),
      piece(100, 0, 0, 0, 1),
      piece(100, 0, 0, 0, 0),
      piece(300),
    ]);
    expect(sorted.map((p) => [p.lengthMm, p.wallIndex, p.stripIndex, p.pieceIndex])).toEqual([
      [300, 0, 0, 0],
      [100, 0, 0, 0],
      [100, 1, 0, 0],
      [100, 1, 1, 0],
      [100, 1, 1, 1],
    ]);
  });
  it("FFD place les grands morceaux d'abord et remplit les chutes", () => {
    const pieces = [piece(500, 0, 0, 0), piece(9000, 0, 1, 0), piece(1000, 0, 2, 0)];
    const natural = packPieces(
      pieces,
      { rollLengthMm: 10050, repeatMm: 0, cutTopMm: 50 },
      "natural",
    );
    const ffd = packPieces(pieces, { rollLengthMm: 10050, repeatMm: 0, cutTopMm: 50 }, "ffd");
    expect(natural.ok && natural.rolls.length).toBe(2);
    expect(ffd.ok && ffd.rolls.length).toBe(2);
    expect(ffd.ok && ffd.rolls[0]!.cuts[0]!.piece.lengthMm).toBe(9000);
  });
  it("bestPacking : le moins de rouleaux, puis le premier candidat", () => {
    const a = packPieces(
      [piece(6000), piece(6000, 0, 1)],
      { rollLengthMm: 10050, repeatMm: 0, cutTopMm: 50 },
      "natural",
    );
    const b = packPieces(
      [piece(5000), piece(5000, 0, 1)],
      { rollLengthMm: 10050, repeatMm: 0, cutTopMm: 50 },
      "natural",
    );
    const best = bestPacking([
      { result: a, label: "a" },
      { result: b, label: "b" },
    ]);
    expect("label" in best && best.label).toBe("b");
    const tie = bestPacking([
      { result: b, label: "first" },
      { result: b, label: "second" },
    ]);
    expect("label" in tie && tie.label).toBe("first");
    const withFail = bestPacking([
      { result: { ok: false, error: "piece_longer_than_roll" }, label: "ko" },
      { result: b, label: "ok" },
    ]);
    expect("label" in withFail && withFail.label).toBe("ok");
  });
});
