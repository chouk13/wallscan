/**
 * Génération aléatoire (graine fixe) de scènes de murs avec vérité terrain : dimensions, plinthe, ouvertures,
 * référence, pose de caméra, distorsion, bruit. Voir docs/reports/measurement-synthetic-bench.md.
 */
import type { OpeningKindV2, Pt, Quad } from "@wallscan/core";
import { focalPxFromEquiv, makeCamera, projectWall, type CameraParams } from "./camera.js";
import { mulberry32, pick, randInt, uniform, type Rng } from "./random.js";
import { MIRE, type Layer, type SceneSpec, type SheetSpec } from "./raster.js";

export type WallTone = "white" | "light" | "dark";

export interface GroundTruthOpening {
  kind: OpeningKindV2;
  /** Nu du mur : bord extérieur du cadre (cm). */
  rect: { x: number; y: number; w: number; h: number };
}

export interface GroundTruth {
  W: number;
  H: number;
  wallTone: WallTone;
  baseboardCm: number | null;
  openings: GroundTruthOpening[];
  reference: { kind: "a4" | "mire"; code: number; sizeCm: { w: number; h: number }; quadFull: Quad } | null;
  wallQuadFull: Quad;
  k1: number;
  camera: CameraParams;
  floorPattern: SceneSpec["floorPattern"];
  distanceCm: number;
  anglesDeg: { yaw: number; pitch: number; roll: number };
  focalMmEquiv: number;
  /** Référence en pixels (côté court) dans l'image pleine résolution. */
  referenceShortSidePx: number | null;
  /** Centre de la référence (cm). */
  referenceCenterCm: Pt | null;
}

export interface BenchCase {
  index: number;
  seed: number;
  scene: SceneSpec;
  truth: GroundTruth;
}

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Placed, b: Placed, margin = 0): boolean =>
  a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y;

function contrastAway(rng: Rng, base: number, min: number, lo: number, hi: number): number {
  // Teinte éloignée d'au moins `min` niveaux de `base`, dans [lo, hi].
  for (let i = 0; i < 50; i++) {
    const v = uniform(rng, lo, hi);
    if (Math.abs(v - base) >= min) return v;
  }
  return base - min >= lo ? base - min : base + min;
}

export interface GenerateOptions {
  reference?: "a4" | "mire" | "none";
  wallTone?: WallTone;
  imageLongSide?: number;
}

export function generateCase(index: number, baseSeed: number, opts: GenerateOptions = {}): BenchCase {
  const seed = (baseSeed + index * 7919) >>> 0;
  const rng = mulberry32(seed);
  const W = uniform(rng, 250, 550);
  const H = uniform(rng, 230, 300);
  const wallTone: WallTone = opts.wallTone ?? pick(rng, ["white", "white", "white", "light", "light", "light", "light", "dark", "dark", "dark"]);
  const wallShade = wallTone === "white" ? uniform(rng, 222, 242) : wallTone === "light" ? uniform(rng, 150, 210) : uniform(rng, 45, 120);
  const ceilingShade = contrastAway(rng, wallShade, 12, 200, 250);
  const floorShade = contrastAway(rng, wallShade, 25, 80, 215);
  const sideShadeLeft = contrastAway(rng, wallShade, 14, Math.max(30, wallShade * 0.7), Math.min(250, wallShade * 1.3 + 10));
  const sideShadeRight = contrastAway(rng, wallShade, 14, Math.max(30, wallShade * 0.7), Math.min(250, wallShade * 1.3 + 10));
  const hasBaseboard = rng() < 0.85;
  const baseboardH = hasBaseboard ? uniform(rng, 5, 14) : 0;
  const baseboardShade = hasBaseboard ? contrastAway(rng, wallShade, 8, 225, 252) : 0;

  const layers: Layer[] = [];
  const openings: GroundTruthOpening[] = [];
  const placed: Placed[] = [];
  // Zone réservée à la référence (centre du mur, hauteur des yeux).
  const refZone: Placed = { x: W / 2 - 45, y: H - 160 - 40, w: 90, h: 80 };
  placed.push(refZone);

  const tryPlace = (w: number, h: number, yTop: number, margin: number): Placed | null => {
    for (let i = 0; i < 40; i++) {
      const x = uniform(rng, 25, W - w - 25);
      const cand = { x, y: yTop, w, h };
      if (x < 25 || x + w > W - 25) continue;
      if (placed.some((p) => overlaps(p, cand, margin))) continue;
      placed.push(cand);
      return cand;
    }
    return null;
  };

  // Fenêtres (0–2).
  const nWindows = pick(rng, [0, 1, 1, 1, 2, 2]);
  const windows: Placed[] = [];
  for (let i = 0; i < nWindows; i++) {
    const w = uniform(rng, 60, Math.min(180, W * 0.45));
    const h = uniform(rng, 80, Math.min(150, H - 130));
    const sill = uniform(rng, 80, 110);
    const yTop = H - sill - h;
    if (yTop < 20) continue;
    const r = tryPlace(w, h, yTop, 20);
    if (!r) continue;
    windows.push(r);
    openings.push({ kind: "window", rect: { ...r } });
    const frameShade = rng() < 0.75 ? uniform(rng, 232, 250) : uniform(rng, 40, 80);
    const bright = rng() < 0.6;
    const glassBase = bright ? uniform(rng, 238, 255) : uniform(rng, 110, 200);
    const glassGrad = bright ? 0 : uniform(rng, -40, 40);
    const barX = rng() < 0.5 ? r.x + r.w / 2 : -1;
    const frameT = 6;
    layers.push({ x: r.x, y: r.y, w: r.w, h: r.h, shade: () => frameShade });
    layers.push({
      x: r.x + frameT,
      y: r.y + frameT,
      w: r.w - 2 * frameT,
      h: r.h - 2 * frameT,
      shade: (x, y) => {
        let s = glassBase + glassGrad * ((y - r.y) / r.h) + glassGrad * 0.5 * ((x - r.x) / r.w);
        if (barX > 0 && Math.abs(x - barX) < 2) s = frameShade;
        return s;
      },
    });
  }
  // Porte (0–1), partant du sol.
  const hasDoor = rng() < 0.45;
  if (hasDoor) {
    const w = uniform(rng, 70, 100);
    const h = uniform(rng, 200, Math.min(215, H - 15));
    const r = tryPlace(w, h, H - h, 25);
    if (r) {
      openings.push({ kind: "door", rect: { ...r } });
      const doorShade = rng() < 0.5 ? contrastAway(rng, wallShade, 20, 215, 248) : contrastAway(rng, wallShade, 25, 85, 150);
      const frameShade = contrastAway(rng, doorShade, 18, 60, 250);
      const frameT = 6;
      layers.push({ x: r.x, y: r.y, w: r.w, h: r.h, shade: () => frameShade });
      layers.push({ x: r.x + frameT, y: r.y + frameT, w: r.w - 2 * frameT, h: r.h - frameT, shade: () => doorShade });
      // Poignée.
      layers.push({ x: r.x + r.w - 16, y: r.y + r.h - 105, w: 3, h: 12, shade: () => 50 });
    }
  }
  // Radiateur sous une fenêtre (50 %).
  if (windows.length > 0 && rng() < 0.5) {
    const win = windows[0];
    const w = Math.min(win.w, uniform(rng, 60, 140));
    const h = uniform(rng, 50, 65);
    const bottom = H - 12;
    const r: Placed = { x: win.x + (win.w - w) / 2, y: bottom - h, w, h };
    if (r.y > win.y + win.h + 5 && !placed.some((p) => p !== win && overlaps(p, r, 5))) {
      placed.push(r);
      openings.push({ kind: "radiator", rect: { ...r } });
      const finA = uniform(rng, 215, 240);
      const finB = finA - uniform(rng, 15, 30);
      layers.push({ x: r.x, y: r.y, w: r.w, h: r.h, shade: (x) => (Math.floor((x - r.x) / 3.3) % 2 === 0 ? finA : finB) });
    }
  }
  // Prises (0–2) et cadre (0–1) : distracteurs.
  const nSockets = randInt(rng, 0, 2);
  for (let i = 0; i < nSockets; i++) {
    const r = tryPlace(8.5, 8.5, H - 30 - 8.5, 10);
    const socketShade = rng() < 0.7 ? 245 : wallShade * 0.9;
    if (r) layers.push({ ...r, shade: () => socketShade });
  }
  if (rng() < 0.4) {
    const w = uniform(rng, 30, 60);
    const h = uniform(rng, 40, 80);
    const r = tryPlace(w, h, uniform(rng, 40, 100), 15);
    if (r) {
      const frameShade = uniform(rng, 30, 80);
      const a = uniform(rng, 90, 200);
      const b = uniform(rng, 90, 200);
      layers.push({ ...r, shade: () => frameShade });
      layers.push({ x: r.x + 3, y: r.y + 3, w: r.w - 6, h: r.h - 6, shade: (x, y) => a + (b - a) * ((x - r.x) / r.w) * 0.5 + (b - a) * ((y - r.y) / r.h) * 0.5 });
    }
  }

  // Référence.
  const refKindRoll = opts.reference ?? (rng() < 0.5 ? "a4" : "mire");
  let sheet: SheetSpec | null = null;
  let reference: GroundTruth["reference"] = null;
  if (refKindRoll !== "none") {
    const portrait = rng() < 0.85;
    const sw = portrait ? MIRE.sheetW : MIRE.sheetH;
    const sh = portrait ? MIRE.sheetH : MIRE.sheetW;
    const sx = W / 2 - sw / 2 + uniform(rng, -20, 20);
    const sy = H - 160 + uniform(rng, -10, 10) - sh / 2;
    const code = randInt(rng, 0, 63);
    sheet = { x: sx, y: sy, w: sw, h: sh, angleDeg: uniform(rng, -2, 2), kind: refKindRoll, code, shade: uniform(rng, 246, 253) };
    const rw = refKindRoll === "mire" ? (portrait ? MIRE.frame.w : MIRE.frame.h) : sw;
    const rh = refKindRoll === "mire" ? (portrait ? MIRE.frame.h : MIRE.frame.w) : sh;
    reference = { kind: refKindRoll, code, sizeCm: { w: rw, h: rh }, quadFull: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] };
    // Les coins exacts (avec rotation) sont calculés après la caméra.
  }

  // Caméra : on tire des poses jusqu'à ce que le mur entier soit visible avec marge.
  const imageChoices: Array<[number, number]> = [[4000, 3000], [4000, 3000], [4000, 3000], [4032, 3024], [3264, 2448], [3000, 4000]];
  let [imageW, imageH] = pick(rng, imageChoices);
  if (opts.imageLongSide) {
    const long = Math.max(imageW, imageH);
    const s = opts.imageLongSide / long;
    imageW = Math.round(imageW * s);
    imageH = Math.round(imageH * s);
  }
  const focalMm = uniform(rng, 24, 28);
  const focalPx = focalPxFromEquiv(focalMm, Math.max(imageW, imageH));
  const k1 = uniform(rng, -0.02, 0.02);
  let camera: CameraParams | null = null;
  let distance = 0;
  let angles = { yaw: 0, pitch: 0, roll: 0 };
  for (let attempt = 0; attempt < 200 && !camera; attempt++) {
    const d = uniform(rng, 250, 500) + attempt * 2;
    const yaw = uniform(rng, -15, 15);
    const pitch = uniform(rng, -15, 15);
    const roll = uniform(rng, -15, 15);
    const camX = W / 2 + uniform(rng, -0.3, 0.3) * W;
    const camY = H - uniform(rng, 100, 170);
    const params: CameraParams = { imageW, imageH, focalPx, k1, position: [camX, camY, -d], yawDeg: yaw, pitchDeg: pitch, rollDeg: roll };
    const cam = makeCamera(params);
    const corners = [projectWall(cam, 0, 0), projectWall(cam, W, 0), projectWall(cam, W, H), projectWall(cam, 0, H)];
    if (corners.some((c) => c === null)) continue;
    const pts = corners as Pt[];
    const mx = imageW * 0.025;
    const my = imageH * 0.025;
    if (pts.some((p) => p.x < mx || p.x > imageW - mx || p.y < my || p.y > imageH - my)) continue;
    const spanX = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    if (spanX < 0.45 * imageW) continue;
    camera = params;
    distance = d;
    angles = { yaw, pitch, roll };
  }
  if (!camera) {
    // Repli déterministe : vue frontale éloignée.
    const d = 600;
    camera = { imageW, imageH, focalPx, k1, position: [W / 2, H / 2, -d], yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
    distance = d;
  }
  const cam = makeCamera(camera);
  const proj = (x: number, y: number): Pt => {
    const p = projectWall(cam, x, y);
    if (!p) throw new Error("projection impossible");
    return p;
  };
  const wallQuadFull: Quad = [proj(0, 0), proj(W, 0), proj(W, H), proj(0, H)];
  let referenceShortSidePx: number | null = null;
  let referenceCenterCm: Pt | null = null;
  if (sheet && reference) {
    const cx = sheet.x + sheet.w / 2;
    const cy = sheet.y + sheet.h / 2;
    const a = (sheet.angleDeg * Math.PI) / 180;
    const rw = reference.sizeCm.w;
    const rh = reference.sizeCm.h;
    const local: Array<[number, number]> = [[-rw / 2, -rh / 2], [rw / 2, -rh / 2], [rw / 2, rh / 2], [-rw / 2, rh / 2]];
    reference.quadFull = local.map(([lx, ly]) => proj(cx + lx * Math.cos(a) - ly * Math.sin(a), cy + lx * Math.sin(a) + ly * Math.cos(a))) as Quad;
    const q = reference.quadFull;
    const sideA = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
    const sideB = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
    referenceShortSidePx = Math.min(sideA, sideB);
    referenceCenterCm = { x: cx, y: cy };
  }

  const floorPattern = pick(rng, ["none", "none", "perpendicular", "perpendicular", "parallel"] as const);
  const scene: SceneSpec = {
    W,
    H,
    wallShade,
    ceilingShade,
    floorShade,
    sideShadeLeft,
    sideShadeRight,
    baseboard: hasBaseboard ? { h: baseboardH, shade: baseboardShade } : null,
    layers,
    sheet,
    lighting: { gx: uniform(rng, -0.12, 0.12), gy: uniform(rng, -0.12, 0.12), vignette: uniform(rng, 0, 0.15) },
    floorPattern,
    floorSeamSpacing: uniform(rng, 12, 25),
    noiseSigma: uniform(rng, 1.5, 4),
    blurSigma: uniform(rng, 0.6, 1.2),
    camera,
    seed,
  };
  return {
    index,
    seed,
    scene,
    truth: {
      W,
      H,
      wallTone,
      baseboardCm: hasBaseboard ? baseboardH : null,
      openings,
      reference,
      wallQuadFull,
      k1,
      camera,
      floorPattern,
      distanceCm: distance,
      anglesDeg: angles,
      focalMmEquiv: focalMm,
      referenceShortSidePx,
      referenceCenterCm,
    },
  };
}

export interface SimpleSceneOptions {
  W?: number;
  H?: number;
  wallShade?: number;
  reference?: "a4" | "mire" | "none";
  referenceLandscape?: boolean;
  referenceAngleDeg?: number;
  code?: number;
  baseboardCm?: number | null;
  /** Teinte du sol (défaut : 110 sur mur clair, 205 sur mur sombre). */
  floorShade?: number;
  window?: { x: number; y: number; w: number; h: number } | null;
  /** Teinte du vitrage (défaut 252 : ciel surexposé). */
  windowGlassShade?: number;
  door?: { x: number; w: number; h: number } | null;
  radiator?: { x: number; y: number; w: number; h: number } | null;
  imageW?: number;
  imageH?: number;
  focalMm?: number;
  k1?: number;
  distanceCm?: number;
  yawDeg?: number;
  pitchDeg?: number;
  rollDeg?: number;
  noiseSigma?: number;
  blurSigma?: number;
  floorPattern?: SceneSpec["floorPattern"];
  seed?: number;
}

/** Scène déterministe et simple pour les tests unitaires (pas de tirage aléatoire). */
export function simpleScene(o: SimpleSceneOptions = {}): { scene: SceneSpec; truth: GroundTruth } {
  const W = o.W ?? 400;
  const H = o.H ?? 250;
  const wallShade = o.wallShade ?? 150;
  const imageW = o.imageW ?? 2048;
  const imageH = o.imageH ?? 1536;
  const focalPx = focalPxFromEquiv(o.focalMm ?? 26, Math.max(imageW, imageH));
  const k1 = o.k1 ?? 0;
  const camera: CameraParams = {
    imageW,
    imageH,
    focalPx,
    k1,
    position: [W / 2, H * 0.55, -(o.distanceCm ?? 380)],
    yawDeg: o.yawDeg ?? 0,
    pitchDeg: o.pitchDeg ?? 0,
    rollDeg: o.rollDeg ?? 0,
  };
  const layers: Layer[] = [];
  const openings: GroundTruthOpening[] = [];
  if (o.window) {
    const r = o.window;
    openings.push({ kind: "window", rect: { ...r } });
    const glass = o.windowGlassShade ?? 252;
    layers.push({ x: r.x, y: r.y, w: r.w, h: r.h, shade: () => 245 });
    layers.push({ x: r.x + 6, y: r.y + 6, w: r.w - 12, h: r.h - 12, shade: () => glass });
  }
  if (o.door) {
    const r = { x: o.door.x, y: H - o.door.h, w: o.door.w, h: o.door.h };
    openings.push({ kind: "door", rect: { ...r } });
    layers.push({ x: r.x, y: r.y, w: r.w, h: r.h, shade: () => 235 });
    layers.push({ x: r.x + 6, y: r.y + 6, w: r.w - 12, h: r.h - 6, shade: () => 110 });
  }
  if (o.radiator) {
    const r = o.radiator;
    openings.push({ kind: "radiator", rect: { ...r } });
    layers.push({ x: r.x, y: r.y, w: r.w, h: r.h, shade: (x) => (Math.floor((x - r.x) / 3.3) % 2 === 0 ? 235 : 210) });
  }
  const refKind = o.reference ?? "a4";
  let sheet: SheetSpec | null = null;
  let reference: GroundTruth["reference"] = null;
  const cam = makeCamera(camera);
  const proj = (x: number, y: number): Pt => {
    const p = projectWall(cam, x, y);
    if (!p) throw new Error("projection impossible");
    return p;
  };
  let referenceShortSidePx: number | null = null;
  let referenceCenterCm: Pt | null = null;
  if (refKind !== "none") {
    const portrait = !o.referenceLandscape;
    const sw = portrait ? MIRE.sheetW : MIRE.sheetH;
    const sh = portrait ? MIRE.sheetH : MIRE.sheetW;
    const sx = W / 2 - sw / 2;
    const sy = H - 160 - sh / 2;
    const code = o.code ?? 22;
    sheet = { x: sx, y: sy, w: sw, h: sh, angleDeg: o.referenceAngleDeg ?? 0, kind: refKind, code, shade: 250 };
    const rw = refKind === "mire" ? (portrait ? MIRE.frame.w : MIRE.frame.h) : sw;
    const rh = refKind === "mire" ? (portrait ? MIRE.frame.h : MIRE.frame.w) : sh;
    const cx = sx + sw / 2;
    const cy = sy + sh / 2;
    const a = ((o.referenceAngleDeg ?? 0) * Math.PI) / 180;
    const local: Array<[number, number]> = [[-rw / 2, -rh / 2], [rw / 2, -rh / 2], [rw / 2, rh / 2], [-rw / 2, rh / 2]];
    const quadFull = local.map(([lx, ly]) => proj(cx + lx * Math.cos(a) - ly * Math.sin(a), cy + lx * Math.sin(a) + ly * Math.cos(a))) as Quad;
    reference = { kind: refKind, code, sizeCm: { w: rw, h: rh }, quadFull };
    referenceShortSidePx = Math.min(Math.hypot(quadFull[1].x - quadFull[0].x, quadFull[1].y - quadFull[0].y), Math.hypot(quadFull[3].x - quadFull[0].x, quadFull[3].y - quadFull[0].y));
    referenceCenterCm = { x: cx, y: cy };
  }
  const baseboardCm = o.baseboardCm === undefined ? 8 : o.baseboardCm;
  const scene: SceneSpec = {
    W,
    H,
    wallShade,
    ceilingShade: 235,
    floorShade: o.floorShade ?? (wallShade > 160 ? 110 : 205),
    sideShadeLeft: Math.min(250, wallShade * 1.2),
    sideShadeRight: Math.max(30, wallShade * 0.8),
    baseboard: baseboardCm !== null ? { h: baseboardCm, shade: 245 } : null,
    layers,
    sheet,
    lighting: { gx: 0.05, gy: -0.05, vignette: 0.05 },
    floorPattern: o.floorPattern ?? "none",
    floorSeamSpacing: 18,
    noiseSigma: o.noiseSigma ?? 2,
    blurSigma: o.blurSigma ?? 0.8,
    camera,
    seed: o.seed ?? 7,
  };
  return {
    scene,
    truth: {
      W,
      H,
      wallTone: wallShade > 220 ? "white" : wallShade > 140 ? "light" : "dark",
      baseboardCm,
      openings,
      reference,
      wallQuadFull: [proj(0, 0), proj(W, 0), proj(W, H), proj(0, H)],
      k1,
      camera,
      floorPattern: scene.floorPattern,
      distanceCm: -camera.position[2],
      anglesDeg: { yaw: camera.yawDeg, pitch: camera.pitchDeg, roll: camera.rollDeg },
      focalMmEquiv: o.focalMm ?? 26,
      referenceShortSidePx,
      referenceCenterCm,
    },
  };
}
