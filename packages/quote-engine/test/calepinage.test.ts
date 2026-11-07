import { describe, expect, it } from "vitest";
import { planRoom, planStrips, type StripPlanInput } from "../src/index.js";
import data from "./reference/calepinage.json" with { type: "json" };

interface WallCase {
  id: string;
  label: string;
  explanation: string;
  input: StripPlanInput;
  expected: {
    rollCount: number;
    rollsUsed: number;
    simpleRollCount: number;
    stripCount: number;
    pieceCount: number;
    billableAreaM2: number;
    wasteTotalCm?: number;
    m2Decor?: number;
    error?: string;
    phaseOutCm?: number;
    waitCm?: number;
    skipped?: number[];
    skipReason?: string;
    stripHeightCm?: number;
    stripHeights?: number[];
    leftStartRollCount?: number;
    firstStrip?: [number, number];
    lastStrip?: [number, number];
    centerStrip?: [number, number, number];
    pieceReasons?: string[];
    allPiecesFull?: boolean;
    traceIncludes?: string;
  };
}

interface RoomCase {
  id: string;
  inputs: StripPlanInput[];
  expected: {
    rollCount: number;
    rollsUsed: number;
    separateRollCount: number;
    billableAreaM2: number;
    wallRollCounts: number[];
    phaseIn: number[];
    wall2Phases?: number[];
  };
}

const walls = data.walls as unknown as WallCase[];
const rooms = data.rooms as unknown as RoomCase[];

describe("calepinage : cas de référence calculés à la main", () => {
  it("au moins 12 cas de murs, identifiants uniques, explications présentes", () => {
    expect(walls.length).toBeGreaterThanOrEqual(12);
    expect(new Set(walls.map((c) => c.id)).size).toBe(walls.length);
    for (const c of walls) expect(c.explanation.length).toBeGreaterThan(40);
  });

  for (const c of walls) {
    it(`${c.id} — ${c.label}`, () => {
      const plan = planStrips(c.input);
      const e = c.expected;
      expect(plan.error).toBe(e.error);
      expect(plan.rollCount).toBe(e.rollCount);
      expect(plan.rollsUsed).toBe(e.rollsUsed);
      expect(plan.simpleRollCount).toBe(e.simpleRollCount);
      expect(plan.stripCount).toBe(e.stripCount);
      expect(plan.pieceCount).toBe(e.pieceCount);
      expect(plan.billableAreaM2).toBe(e.billableAreaM2);
      if (e.wasteTotalCm !== undefined) expect(plan.wasteTotalCm).toBeCloseTo(e.wasteTotalCm, 6);
      if (e.m2Decor !== undefined) expect(plan.m2Decor).toBe(e.m2Decor);
      else expect(plan.m2Decor).toBeUndefined();
      if (e.phaseOutCm !== undefined) expect(plan.phaseOutCm).toBe(e.phaseOutCm);
      if (e.waitCm !== undefined) {
        const waits = plan.rolls
          .flatMap((r) => r.cuts.map((x) => x.wasteBeforeCm))
          .filter((w) => w > 0);
        expect(waits.length).toBeGreaterThan(0);
        for (const w of waits) expect(w).toBe(e.waitCm);
      }
      if (e.skipped) {
        expect(plan.strips.filter((s) => s.skipped).map((s) => s.index)).toEqual(e.skipped);
        for (const i of e.skipped) {
          expect(plan.strips[i]!.skipped).toBe(e.skipReason);
          expect(plan.strips[i]!.pieces).toEqual([]);
        }
      }
      if (e.stripHeightCm !== undefined)
        for (const s of plan.strips) expect(s.heightCm).toBe(e.stripHeightCm);
      if (e.stripHeights) expect(plan.strips.map((s) => s.heightCm)).toEqual(e.stripHeights);
      if (e.leftStartRollCount !== undefined) {
        expect(
          planStrips({ ...c.input, settings: { ...c.input.settings, start: "left" } }).rollCount,
        ).toBe(e.leftStartRollCount);
      }
      if (e.firstStrip)
        expect([plan.strips[0]!.xFromCm, plan.strips[0]!.xToCm]).toEqual(e.firstStrip);
      if (e.lastStrip)
        expect([plan.strips.at(-1)!.xFromCm, plan.strips.at(-1)!.xToCm]).toEqual(e.lastStrip);
      if (e.centerStrip) {
        const s = plan.strips[e.centerStrip[0]]!;
        expect([s.xFromCm, s.xToCm]).toEqual([e.centerStrip[1], e.centerStrip[2]]);
      }
      if (e.pieceReasons) {
        const split = plan.strips.find((s) => s.pieces.length > 1)!;
        expect(split.pieces.map((p) => p.reason)).toEqual(e.pieceReasons);
      }
      if (e.allPiecesFull)
        expect(plan.strips.every((s) => s.pieces.every((p) => p.reason === "full"))).toBe(true);
      if (e.traceIncludes) expect(plan.trace.some((t) => t.includes(e.traceIncludes!))).toBe(true);
      // Invariants communs
      if (!plan.error) {
        expect(plan.rollCount).toBeGreaterThanOrEqual(plan.rollsUsed);
        if (plan.simpleRollCount > 0)
          expect(plan.rollCount).toBeLessThanOrEqual(plan.simpleRollCount);
        expect(plan.trace.length).toBeGreaterThan(5);
      }
      // Déterminisme : même entrée → même sortie (structurelle)
      expect(JSON.stringify(planStrips(c.input))).toBe(JSON.stringify(plan));
    });
  }

  for (const c of rooms) {
    it(`pièce ${c.id}`, () => {
      const room = planRoom(c.inputs);
      expect(room.error).toBeUndefined();
      expect(room.rollCount).toBe(c.expected.rollCount);
      expect(room.rollsUsed).toBe(c.expected.rollsUsed);
      expect(room.separateRollCount).toBe(c.expected.separateRollCount);
      expect(room.billableAreaM2).toBe(c.expected.billableAreaM2);
      expect(room.walls.map((w) => w.rollCount)).toEqual(c.expected.wallRollCounts);
      expect(room.walls.map((w) => w.strips[0]!.phaseCm)).toEqual(c.expected.phaseIn);
      if (c.expected.wall2Phases)
        expect(room.walls[1]!.strips.map((s) => s.phaseCm)).toEqual(c.expected.wall2Phases);
      expect(room.rolls.every((r) => r.cuts.every((x) => x.wallIndex !== undefined))).toBe(true);
      expect(room.rollCount).toBeLessThanOrEqual(room.separateRollCount);
    });
  }
});
