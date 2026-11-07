import type { OpeningKindV2, OpeningV2 } from "@wallscan/core";
import type {
  StripPlanInput,
  StripPlanPaper,
  StripPlanSettings,
  StripPlanWall,
} from "../src/index.js";

export const paper = (o: Partial<StripPlanPaper> = {}): StripPlanPaper => ({
  rollWidthCm: 53,
  rollLengthCm: 1005,
  patternRepeatCm: 0,
  matchType: "free",
  offsetCm: 0,
  saleUnit: "roll",
  minOrderRolls: 1,
  ...o,
});

export const settings = (o: Partial<StripPlanSettings> = {}): StripPlanSettings => ({
  cutTopCm: 5,
  cutBottomCm: 5,
  start: "left",
  deductAboveM2: 1,
  safetyRollIfPattern: true,
  ...o,
});

export const wall = (
  widthCm: number,
  heightCm: number,
  openings: OpeningV2[] = [],
  o: Partial<StripPlanWall> = {},
): StripPlanWall => ({
  widthCm,
  heightLeftCm: heightCm,
  heightRightCm: heightCm,
  openings,
  baseboard: { enabled: false, heightCm: null },
  ...o,
});

export const op = (
  id: string,
  kind: OpeningKindV2,
  x: number,
  y: number,
  w: number,
  h: number,
): OpeningV2 => ({
  id,
  kind,
  rect: { x, y, w, h },
  confidence: 1,
  source: "user",
});

export const input = (
  w: StripPlanWall,
  p: Partial<StripPlanPaper> = {},
  s: Partial<StripPlanSettings> = {},
): StripPlanInput => ({
  wall: w,
  paper: paper(p),
  settings: settings(s),
});

/** Générateur pseudo-aléatoire déterministe (mulberry32) pour les tests paramétriques. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: () => number, items: readonly T[]): T =>
  items[Math.floor(r() * items.length)]!;
export const int = (r: () => number, min: number, max: number): number =>
  min + Math.floor(r() * (max - min + 1));

/** Copie d'un objet sans certaines clés (les champs optionnels absents, pas `undefined`, pour `exactOptionalPropertyTypes`). */
export function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of keys) delete out[k as string];
  return out as Omit<T, K>;
}
