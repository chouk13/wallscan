import { describe, expect, it } from "vitest";
import type { OpeningKindV2, OpeningV2 } from "@wallscan/core";
import { computeRollsSimple, planRoom, planStrips, type StripPlanInput } from "../src/index.js";
import { input, int, pick, rng, settings as mkSettings, wall } from "./helpers.js";

const KINDS: OpeningKindV2[] = ["window", "door", "french_door", "radiator", "niche", "excluded"];

function randomInput(r: () => number): StripPlanInput {
  const W = int(r, 150, 700);
  const H = int(r, 220, 320);
  const trapezoid = r() < 0.3;
  const hL = trapezoid ? H + int(r, -8, 8) : H;
  const hR = trapezoid ? H + int(r, -8, 8) : H;
  const openings: OpeningV2[] = [];
  const n = int(r, 0, 3);
  for (let i = 0; i < n; i++) {
    const kind = pick(r, KINDS);
    const w = int(r, 30, Math.min(300, W));
    const h = kind === "french_door" ? Math.min(hL, hR) : int(r, 10, 220);
    const x = int(r, -20, W - w + 20);
    const y =
      kind === "door" || kind === "french_door"
        ? Math.min(hL, hR) - h
        : int(r, 0, Math.max(0, Math.min(hL, hR) - h));
    openings.push({ id: `o${i}`, kind, rect: { x, y, w, h }, confidence: 1, source: "user" });
  }
  const matchType = pick(r, ["free", "straight", "half_drop", "offset"] as const);
  const patternRepeatCm = matchType === "free" ? 0 : pick(r, [32, 53, 61, 64, 96]);
  const offsetCm =
    matchType === "half_drop"
      ? r() < 0.5
        ? patternRepeatCm / 2
        : 0
      : matchType === "offset"
        ? int(r, 1, patternRepeatCm - 1)
        : 0;
  const baseboard =
    r() < 0.3 ? { enabled: true, heightCm: int(r, 4, 15) } : { enabled: false, heightCm: null };
  const start = r() < 0.3 ? ("centered" as const) : ("left" as const);
  const s = mkSettings({
    start,
    deductAboveM2: pick(r, [0, 1, 2]),
    safetyRollIfPattern: r() < 0.5,
    cutTopCm: pick(r, [3, 5]),
    cutBottomCm: pick(r, [5, 8]),
  });
  if (start === "centered" && r() < 0.5) s.centerAtCm = int(r, 0, W);
  if (r() < 0.3) s.phaseOffsetCm = int(r, 0, 60);
  return input(
    { ...wall(W, H, openings), heightLeftCm: hL, heightRightCm: hR, baseboard },
    {
      rollWidthCm: pick(r, [52, 53, 70, 91, 100]),
      rollLengthCm: pick(r, [732, 1000, 1005]),
      patternRepeatCm,
      matchType,
      offsetCm,
      minOrderRolls: pick(r, [1, 1, 2]),
    },
    s,
  );
}

const mod = (a: number, m: number): number => ((a % m) + m) % m;

describe("calepinage — invariants sur 400 murs aléatoires (graine fixe)", () => {
  const r = rng(20261107);
  const inputs = Array.from({ length: 400 }, () => randomInput(r));

  it("ne commande jamais plus de rouleaux que la formule simple (même lés) ni que la formule §5.1 (ceil(W / w)) en départ gauche", () => {
    let checked = 0;
    for (const inp of inputs) {
      const plan = planStrips(inp);
      if (plan.error) continue;
      checked++;
      if (plan.simpleRollCount > 0)
        expect(plan.rollCount).toBeLessThanOrEqual(plan.simpleRollCount);
      if (inp.settings.start === "left") {
        const bb = inp.wall.baseboard.enabled ? (inp.wall.baseboard.heightCm as number) : 0;
        const simple = computeRollsSimple({
          stripCount: Math.ceil(inp.wall.widthCm / inp.paper.rollWidthCm),
          heightCm: Math.max(inp.wall.heightLeftCm, inp.wall.heightRightCm) - bb,
          cutTopCm: inp.settings.cutTopCm,
          cutBottomCm: inp.settings.cutBottomCm,
          rollLengthCm: inp.paper.rollLengthCm,
          patternRepeatCm: inp.paper.patternRepeatCm,
          matchType: inp.paper.matchType,
          offsetCm: inp.paper.offsetCm,
          minOrderRolls: inp.paper.minOrderRolls,
          safetyRollIfPattern: inp.settings.safetyRollIfPattern,
          billableAreaM2: plan.billableAreaM2,
        });
        if (simple.rollCount > 0) expect(plan.rollCount).toBeLessThanOrEqual(simple.rollCount);
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it("Σ longueurs coupées ≤ rouleaux × longueur ; coupes disjointes et croissantes ; chaque morceau coupé exactement une fois", () => {
    for (const inp of inputs) {
      const plan = planStrips(inp);
      if (plan.error) continue;
      const L = inp.paper.rollLengthCm;
      const pieceKeys = new Set(
        plan.strips.flatMap((s) => s.pieces.map((p) => `${s.index}/${p.pieceIndex}`)),
      );
      const cutKeys: string[] = [];
      let total = 0;
      for (const roll of plan.rolls) {
        let cursor = 0;
        let used = 0;
        for (const c of roll.cuts) {
          expect(c.startCm).toBeGreaterThanOrEqual(cursor - 1e-9);
          expect(c.startCm - cursor).toBeCloseTo(c.wasteBeforeCm, 6);
          cursor = c.startCm + c.lengthCm;
          used += c.lengthCm;
          cutKeys.push(`${c.stripIndex}/${c.pieceIndex}`);
          expect(c.lengthCm).toBe(plan.strips[c.stripIndex]!.pieces[c.pieceIndex]!.lengthCm);
        }
        expect(cursor).toBeLessThanOrEqual(L + 1e-9);
        expect(roll.usedCm).toBeCloseTo(cursor, 6);
        expect(roll.wasteCm).toBeCloseTo(L - used, 6);
        total += used;
      }
      expect(total).toBeLessThanOrEqual(plan.rollsUsed * L + 1e-9);
      expect(cutKeys.length).toBe(pieceKeys.size);
      expect(new Set(cutKeys)).toEqual(pieceKeys);
      expect(plan.pieceCount).toBe(pieceKeys.size);
      expect(plan.wasteTotalCm).toBeCloseTo(
        plan.rolls.reduce((s, x) => s + x.wasteCm, 0),
        6,
      );
    }
  });

  it("position du motif respectée sur chaque coupe ; phases des lés alternées ; phase de sortie cohérente", () => {
    for (const inp of inputs) {
      const plan = planStrips(inp);
      if (plan.error) continue;
      const R = inp.paper.matchType === "free" ? 0 : inp.paper.patternRepeatCm;
      if (R === 0) {
        expect(
          plan.strips.every(
            (s) => s.phaseCm === 0 && s.pieces.every((p) => p.patternStartCm === 0),
          ),
        ).toBe(true);
        expect(plan.phaseOutCm).toBe(0);
        continue;
      }
      for (const s of plan.strips) {
        for (const p of s.pieces)
          expect(p.patternStartCm).toBeCloseTo(mod(s.phaseCm + p.fromCm, R), 6);
      }
      for (const roll of plan.rolls) {
        const first = roll.cuts[0]!;
        const origin = mod(
          plan.strips[first.stripIndex]!.pieces[first.pieceIndex]!.patternStartCm -
            inp.settings.cutTopCm,
          R,
        );
        for (const c of roll.cuts) {
          const p = plan.strips[c.stripIndex]!.pieces[c.pieceIndex]!;
          expect(mod(origin + c.startCm + inp.settings.cutTopCm, R)).toBeCloseTo(
            p.patternStartCm,
            6,
          );
          expect(c.wasteBeforeCm).toBeLessThan(R);
        }
      }
      expect(plan.phaseOutCm).toBeGreaterThanOrEqual(0);
      expect(plan.phaseOutCm).toBeLessThan(R);
    }
  });

  it("surfaces : 0 ≤ facturée ≤ brute ≤ largeur × hauteur max ; lés couvrent exactement le mur", () => {
    for (const inp of inputs) {
      const plan = planStrips(inp);
      if (plan.error) continue;
      expect(plan.billableAreaM2).toBeGreaterThanOrEqual(0);
      expect(plan.billableAreaM2).toBeLessThanOrEqual(plan.grossAreaM2 + 0.01);
      expect(plan.grossAreaM2).toBeLessThanOrEqual(
        (inp.wall.widthCm * Math.max(inp.wall.heightLeftCm, inp.wall.heightRightCm)) / 10_000 +
          0.01,
      );
      expect(plan.strips[0]!.xFromCm).toBe(0);
      expect(plan.strips.at(-1)!.xToCm).toBe(inp.wall.widthCm);
      for (let i = 1; i < plan.strips.length; i++)
        expect(plan.strips[i]!.xFromCm).toBe(plan.strips[i - 1]!.xToCm);
      expect(plan.stripCount).toBe(plan.strips.filter((s) => !s.skipped).length);
      expect(plan.rollCount).toBeGreaterThanOrEqual(plan.rollsUsed);
    }
  });

  it("déterminisme et absence d'exception sur des entrées dégénérées", () => {
    for (const inp of inputs.slice(0, 50)) {
      expect(JSON.stringify(planStrips(inp))).toBe(JSON.stringify(planStrips(inp)));
    }
    const weird: StripPlanInput[] = [
      input(wall(0.4, 0.4)),
      input(wall(10_000, 100)),
      input(wall(53, 250), { rollWidthCm: 53 }),
      input(wall(400, 250), { patternRepeatCm: 0.1, matchType: "straight" }),
      input(wall(400, 250), { patternRepeatCm: 5000, matchType: "half_drop" }),
      input(wall(400, 250), {}, { cutTopCm: 0, cutBottomCm: 0 }),
    ];
    for (const w of weird) expect(() => planStrips(w)).not.toThrow();
  });

  it("pièce : empaquetage commun ≤ somme des murs ; chaînage de phase", () => {
    const r2 = rng(42);
    for (let k = 0; k < 40; k++) {
      const first = randomInput(r2);
      if (first.paper.saleUnit !== "roll") continue;
      const walls = [
        first,
        { ...randomInput(r2), paper: first.paper },
        { ...randomInput(r2), paper: first.paper },
      ];
      const room = planRoom(walls);
      if (room.error) {
        expect(walls.some((w) => planStrips(w).error !== undefined)).toBe(true);
        continue;
      }
      expect(room.rollCount).toBeLessThanOrEqual(room.separateRollCount);
      expect(room.walls).toHaveLength(3);
      for (let i = 1; i < 3; i++) {
        const w = room.walls[i]!;
        expect(w.strips[w.anchorIndex]!.phaseCm).toBeCloseTo(room.walls[i - 1]!.phaseOutCm, 6);
      }
      const total = room.rolls.reduce(
        (s, roll) => s + roll.cuts.reduce((t, c) => t + c.lengthCm, 0),
        0,
      );
      expect(total).toBeLessThanOrEqual(room.rollsUsed * first.paper.rollLengthCm + 1e-9);
      expect(room.rolls.flatMap((roll) => roll.cuts).length).toBe(
        room.walls.reduce((s, w) => s + w.pieceCount, 0),
      );
    }
  });
});
