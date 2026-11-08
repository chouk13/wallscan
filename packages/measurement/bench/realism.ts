/**
 * Banc de « réalisme terrain » : robustesse de `measurePhoto` aux conditions réelles de prise de vue d'un client sur son
 * téléphone. Une scène synthétique (rasteriseur du banc, vérité connue) est rendue, puis une dégradation contrôlée est
 * appliquée (3 niveaux). 40 scènes par condition, graines fixes, mêmes scènes pour toutes les conditions (appariées).
 *
 * node dist/realism.mjs [--n=20] [--seed=20261108] [--json=…] [--out=…] [--before=…json] [--only=blur,pitch-10]
 *                       [--scene=7 --only=blur-2 --verbose=1]   (rejeu d'un cas)
 * Voir docs/reports/measurement-realism-bench.md. Critère bloquant : 0 fausse mesure silencieuse
 * (erreur > 5 % sans avertissement de fiabilité).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import type { GrayImage, Pt, Quad } from "@wallscan/core";
import * as WS from "../src/index.js";
import { WARN } from "../src/constants.js";
import { makeCamera, projectWall } from "./camera.js";
import { gaussianNoise, mulberry32, uniform } from "./random.js";
import { renderScene, type Layer, type SceneSpec } from "./raster.js";
import { generateCase } from "./scene.js";
import type { CameraParams } from "./camera.js";
import { fmt, summarize } from "./stats.js";

/** Côté long de l'image de travail (le pipeline de production travaille à 2048 px ; le banc rend directement à 2048). */
const LONG_SIDE = 2048;
const SHEET_LONG_CM = 29.7;

// ------------------------------------------------------------------------------------------------------------------
// Conditions
// ------------------------------------------------------------------------------------------------------------------

interface Degradation {
  /** σ du flou gaussien ajouté (px), composé avec le flou d'objectif de la scène. */
  blurSigma?: number;
  /** Longueur du flou de bougé horizontal (px). */
  motionPx?: number;
  /** Inclinaison du téléphone (°, signe tiré au hasard par scène). */
  pitchDeg?: number;
  rollDeg?: number;
  /** Distorsion radiale non annoncée (modèle de division du repo : k1 < 0 = barillet). */
  k1?: number;
  /** Exposition en IL appliquée en lumière linéaire (gamma 2,2) avec écrêtage. */
  exposureIL?: number;
  vignette?: number;
  /** σ du bruit gaussien final (niveaux sur 255). */
  noiseSigma?: number;
  /** Feuille gondolée : amplitude (mm) de la déformation sinusoïdale dans le plan image. */
  warpMm?: number;
  /** Feuille collée de travers (°, signe aléatoire). */
  skewDeg?: number;
  /** Meuble sombre couvrant X % de la surface du mur, posé au sol. */
  furniturePct?: number;
  /** La feuille (grand côté, 29,7 cm) occupe X % du grand côté de l'image. */
  sheetPct?: number;
}

interface Condition {
  id: string;
  group: string;
  groupLabel: string;
  label: string;
  deg: Degradation;
}

const CONDITIONS: Condition[] = [
  { id: "nominal", group: "nominal", groupLabel: "Nominal (témoin)", label: "aucune dégradation", deg: {} },
];
const add = (group: string, groupLabel: string, levels: Array<[string, string, Degradation]>): void => {
  for (const [suffix, label, deg] of levels) CONDITIONS.push({ id: `${group}-${suffix}`, group, groupLabel, label, deg });
};
add("blur", "Flou gaussien", [["1", "σ 1 px", { blurSigma: 1 }], ["2", "σ 2 px", { blurSigma: 2 }], ["3", "σ 3 px", { blurSigma: 3 }]]);
add("motion", "Flou de bougé horizontal", [["4", "4 px", { motionPx: 4 }], ["8", "8 px", { motionPx: 8 }], ["14", "14 px", { motionPx: 14 }]]);
add("pitch", "Inclinaison (pitch)", [["5", "5°", { pitchDeg: 5 }], ["10", "10°", { pitchDeg: 10 }], ["15", "15°", { pitchDeg: 15 }]]);
add("roll", "Roulis", [["2", "2°", { rollDeg: 2 }], ["5", "5°", { rollDeg: 5 }], ["8", "8°", { rollDeg: 8 }]]);
add("k1", "Distorsion radiale non annoncée", [["005", "k1 −0,05", { k1: -0.05 }], ["012", "k1 −0,12", { k1: -0.12 }], ["025", "k1 −0,25", { k1: -0.25 }]]);
add("expo", "Exposition", [["under", "sous-exposition −1,5 IL", { exposureIL: -1.5 }], ["over", "surexposition +1 IL (feuille saturée)", { exposureIL: 1 }], ["vignette", "vignettage 30 %", { vignette: 0.3 }]]);
add("noise", "Bruit gaussien", [["4", "σ 4", { noiseSigma: 4 }], ["8", "σ 8", { noiseSigma: 8 }], ["14", "σ 14", { noiseSigma: 14 }]]);
add("warp", "Feuille gondolée", [["2", "2 mm", { warpMm: 2 }], ["4", "4 mm", { warpMm: 4 }], ["8", "8 mm", { warpMm: 8 }]]);
add("skew", "Feuille collée de travers", [["3", "3°", { skewDeg: 3 }], ["7", "7°", { skewDeg: 7 }]]);
add("furniture", "Mur masqué par un meuble", [["10", "10 % du mur", { furniturePct: 0.1 }], ["25", "25 % du mur", { furniturePct: 0.25 }]]);
add("dist", "Distance (taille de la feuille)", [["3", "3 % du grand côté", { sheetPct: 0.03 }], ["5", "5 % du grand côté", { sheetPct: 0.05 }], ["9", "9 % visé (plafonné par le cadrage du mur entier)", { sheetPct: 0.09 }]]);

// ------------------------------------------------------------------------------------------------------------------
// Construction d'un cas
// ------------------------------------------------------------------------------------------------------------------

interface BuiltCase {
  scene: SceneSpec;
  truth: { W: number; H: number; refKind: "a4" | "mire"; refQuad: Quad; sheetQuad: Quad };
  params: Record<string, number | string>;
  sceneIndex: number;
  seed: number;
}

const rad = (d: number): number => (d * Math.PI) / 180;

/** Retourne `null` si la contrainte (feuille à X % du côté long) rend le mur non cadrable : la scène est alors remplacée. */
function buildCase(sceneIndex: number, cond: Condition, baseSeed: number): BuiltCase | null {
  const refKind = sceneIndex % 2 === 0 ? "a4" : "mire";
  const base = generateCase(sceneIndex, baseSeed, { reference: refKind, imageLongSide: LONG_SIDE });
  const seed = base.seed;
  const rng = mulberry32(seed ^ 0x51ed270b);
  const sc = base.scene;
  const sheet = sc.sheet;
  if (!sheet) throw new Error("scène sans feuille");
  const d = cond.deg;
  const sign = (): number => (rng() < 0.5 ? -1 : 1);
  const W = sc.W;
  const H = sc.H;
  // Pose « nominale » d'un client : téléphone tenu à peu près droit, léger lacet, distorsion de téléphone standard.
  const yaw = uniform(rng, -10, 10);
  const pitch = d.pitchDeg !== undefined ? sign() * (d.pitchDeg + uniform(rng, -0.5, 0.5)) : uniform(rng, -3, 3);
  const roll = d.rollDeg !== undefined ? sign() * (d.rollDeg + uniform(rng, -0.3, 0.3)) : uniform(rng, -1.5, 1.5);
  const k1 = d.k1 !== undefined ? d.k1 : uniform(rng, -0.02, 0.02);
  const camX = W / 2 + uniform(rng, -0.3, 0.3) * W;
  const camY = H - uniform(rng, 100, 170);
  const f = sc.camera.focalPx;
  const imageW = sc.camera.imageW;
  const imageH = sc.camera.imageH;
  const long = Math.max(imageW, imageH);
  const fits = (p: CameraParams): boolean => {
    const cam = makeCamera(p);
    const pts = [projectWall(cam, 0, 0), projectWall(cam, W, 0), projectWall(cam, W, H), projectWall(cam, 0, H)];
    if (pts.some((q) => q === null)) return false;
    const mx = imageW * 0.025;
    const my = imageH * 0.025;
    return (pts as Pt[]).every((q) => q.x >= mx && q.x <= imageW - mx && q.y >= my && q.y <= imageH - my);
  };
  const mk = (dist: number): CameraParams => ({ imageW, imageH, focalPx: f, k1, position: [camX, camY, -dist], yawDeg: yaw, pitchDeg: pitch, rollDeg: roll });
  let camera: CameraParams | null = null;
  let dist = 0;
  if (d.sheetPct !== undefined) {
    // Cible : feuille à X % du grand côté. Si le mur entier ne tient pas dans le cadre à cette distance (cas du 9 % : un mur de
    // 2,3–3 m de haut cadré en entier limite la feuille à ≈ 8 %), on recule au minimum nécessaire : « le plus gros réalisable ».
    const d0 = (f * SHEET_LONG_CM) / (d.sheetPct * long);
    for (dist = d0; dist < d0 * 1.5 && !camera; dist += 2) {
      const p = mk(dist);
      if (fits(p)) camera = p;
    }
    if (!camera) return null;
  } else {
    for (dist = uniform(rng, 250, 500); dist < 1600 && !camera; dist += 10) {
      const p = mk(dist);
      if (fits(p)) camera = p;
    }
    if (!camera) return null;
  }
  const cam = makeCamera(camera);
  const proj = (x: number, y: number): Pt => {
    const p = projectWall(cam, x, y);
    if (!p) throw new Error("projection impossible");
    return p;
  };
  // Feuille : rotation éventuelle, coins de vérité.
  const angleDeg = d.skewDeg !== undefined ? sign() * d.skewDeg : sheet.angleDeg;
  const scx = sheet.x + sheet.w / 2;
  const scy = sheet.y + sheet.h / 2;
  const a = rad(angleDeg);
  const corners = (rw: number, rh: number): Quad =>
    ([[-rw / 2, -rh / 2], [rw / 2, -rh / 2], [rw / 2, rh / 2], [-rw / 2, rh / 2]] as Array<[number, number]>).map(([lx, ly]) => proj(scx + lx * Math.cos(a) - ly * Math.sin(a), scy + lx * Math.sin(a) + ly * Math.cos(a))) as Quad;
  const portrait = sheet.h >= sheet.w;
  const refW = refKind === "mire" ? (portrait ? 19 : 27.7) : sheet.w;
  const refH = refKind === "mire" ? (portrait ? 27.7 : 19) : sheet.h;
  const refQuad = corners(refW, refH);
  const sheetQuad = corners(sheet.w, sheet.h);

  const layers: Layer[] = sc.layers.slice();
  if (d.furniturePct !== undefined) {
    const h = Math.min(120, (d.furniturePct * H) / 0.5);
    const fw = Math.max((d.furniturePct * W * H) / h, 0);
    const w = Math.min(fw, W * 0.9);
    const x = uniform(rng, W * 0.05, Math.max(W * 0.05, W - w - W * 0.05));
    const tone = uniform(rng, 35, 70);
    layers.push({ x, y: H - h, w, h, shade: (px, py) => tone + 8 * Math.sin(px / 23) + 6 * ((py - (H - h)) / h) });
  }
  const lensBlur = sc.blurSigma;
  const blurSigma = d.blurSigma ? Math.hypot(lensBlur, d.blurSigma) : lensBlur;
  const scene: SceneSpec = {
    ...sc,
    camera,
    layers,
    sheet: { ...sheet, angleDeg },
    blurSigma,
    noiseSigma: 0,
    lighting: { ...sc.lighting, vignette: d.vignette ?? sc.lighting.vignette },
  };
  const noise = d.noiseSigma ?? (d.exposureIL !== undefined && d.exposureIL < 0 ? 5 : sc.noiseSigma);
  const sheetShortPx = Math.min(Math.hypot(sheetQuad[1].x - sheetQuad[0].x, sheetQuad[1].y - sheetQuad[0].y), Math.hypot(sheetQuad[3].x - sheetQuad[0].x, sheetQuad[3].y - sheetQuad[0].y));
  const sheetLongPx = Math.max(Math.hypot(sheetQuad[1].x - sheetQuad[0].x, sheetQuad[1].y - sheetQuad[0].y), Math.hypot(sheetQuad[3].x - sheetQuad[0].x, sheetQuad[3].y - sheetQuad[0].y));
  return {
    scene,
    truth: { W, H, refKind, refQuad, sheetQuad },
    sceneIndex,
    seed,
    params: {
      W: +W.toFixed(1), H: +H.toFixed(1), ref: refKind, yaw: +yaw.toFixed(2), pitch: +pitch.toFixed(2), roll: +roll.toFixed(2), k1: +k1.toFixed(4),
      distCm: Math.round(dist), sheetAngle: +angleDeg.toFixed(2), blurTotal: +blurSigma.toFixed(2), noise: +noise.toFixed(2),
      sheetShortPx: Math.round(sheetShortPx), sheetLongPctOfLongSide: +((sheetLongPx / long) * 100).toFixed(2),
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------
// Dégradations dans l'espace image
// ------------------------------------------------------------------------------------------------------------------

function toFloat(img: GrayImage): Float32Array {
  const out = new Float32Array(img.data.length);
  for (let i = 0; i < out.length; i++) out[i] = img.data[i];
  return out;
}

/** Flou de bougé horizontal : moyenne glissante sur `len` pixels. */
function motionBlur(src: Float32Array, w: number, h: number, len: number): Float32Array {
  const out = new Float32Array(src.length);
  const half = Math.floor(len / 2);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      let c = 0;
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x - half + len - 1);
      for (let k = x0; k <= x1; k++) {
        s += src[row + k];
        c++;
      }
      out[row + x] = s / c;
    }
  }
  return out;
}

function sample(src: Float32Array, w: number, h: number, x: number, y: number): number {
  const xx = Math.min(w - 1.001, Math.max(0, x));
  const yy = Math.min(h - 1.001, Math.max(0, y));
  const x0 = Math.floor(xx);
  const y0 = Math.floor(yy);
  const fx = xx - x0;
  const fy = yy - y0;
  const i = y0 * w + x0;
  return (src[i] * (1 - fx) + src[i + 1] * fx) * (1 - fy) + (src[i + w] * (1 - fx) + src[i + w + 1] * fx) * fy;
}

/** Feuille gondolée : champ de déplacement sinusoïdal 2D localisé autour de la feuille (le bord de la feuille ondule aussi). */
function warpSheet(src: Float32Array, w: number, h: number, sheetQuad: Quad, ampPx: number, phase: number): Float32Array {
  const xs = sheetQuad.map((p) => p.x);
  const ys = sheetQuad.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const margin = Math.ceil(3 * ampPx) + 8;
  const lambda = 0.55 * Math.max(x1 - x0, y1 - y0);
  const out = src.slice();
  for (let y = Math.max(0, Math.floor(y0 - margin)); y <= Math.min(h - 1, Math.ceil(y1 + margin)); y++) {
    for (let x = Math.max(0, Math.floor(x0 - margin)); x <= Math.min(w - 1, Math.ceil(x1 + margin)); x++) {
      const outside = Math.max(x0 - x, x - x1, y0 - y, y - y1, 0);
      const taper = outside >= margin ? 0 : 1 - outside / margin;
      const dx = ampPx * taper * Math.sin((2 * Math.PI * y) / lambda + phase);
      const dy = ampPx * taper * Math.sin((2 * Math.PI * x) / lambda + 1.7 * phase);
      out[y * w + x] = sample(src, w, h, x + dx, y + dy);
    }
  }
  return out;
}

function degrade(c: BuiltCase, cond: Condition): { image: GrayImage; renderMs: number } {
  const r = renderScene(c.scene);
  const w = r.image.width;
  const h = r.image.height;
  const d = cond.deg;
  const rng = mulberry32(c.seed ^ 0xa5a5a5a5);
  let buf = toFloat(r.image);
  if (d.warpMm !== undefined) {
    const q = c.truth.sheetQuad;
    const wCm = c.scene.sheet?.w ?? 21;
    const hCm = c.scene.sheet?.h ?? 29.7;
    const pxPerCm = Math.sqrt(Math.abs(areaOf(q)) / (wCm * hCm));
    buf = warpSheet(buf, w, h, q, (d.warpMm / 10) * pxPerCm, uniform(rng, 0, 6.28));
  }
  if (d.motionPx !== undefined) buf = motionBlur(buf, w, h, d.motionPx);
  if (d.exposureIL !== undefined) {
    const gain = Math.pow(2, d.exposureIL);
    for (let i = 0; i < buf.length; i++) {
      const lin = Math.pow(Math.min(1, Math.max(0, buf[i] / 255)), 2.2) * gain;
      buf[i] = 255 * Math.pow(Math.min(1, lin), 1 / 2.2);
    }
  }
  const sigma = Number(c.params.noise);
  const out = new Uint8ClampedArray(buf.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[i] + gaussianNoise(rng) * sigma;
  return { image: { width: w, height: h, data: out }, renderMs: r.renderMs };
}

const centerOf = (q: Quad): [number, number] => [Math.round(q.reduce((a, p) => a + p.x, 0) / 4), Math.round(q.reduce((a, p) => a + p.y, 0) / 4)];

function areaOf(q: Quad): number {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// ------------------------------------------------------------------------------------------------------------------
// Évaluation
// ------------------------------------------------------------------------------------------------------------------

/** Avertissements de fiabilité : tout sauf la demande (informative) de hauteur de plinthe. */
const isReliabilityWarning = (w: string): boolean => w !== WARN.baseboardHeightRequired;

type Outcome = "measured" | "declared_failure" | "crash";

interface CaseRecord {
  cond: string;
  scene: number;
  seed: number;
  outcome: Outcome;
  failure: string | null;
  errW: number | null;
  errH: number | null;
  warnings: string[];
  uncertaintyPct: number | null;
  displayTolerancePct: number | null;
  refFound: boolean;
  refKindOk: boolean;
  refCornerErrPx: number | null;
  /** Centre de la référence trouvée vs vérité (px) et dimensions rendues (cm), pour diagnostiquer les fausses détections. */
  refCenter: [number, number] | null;
  refTruthCenter: [number, number];
  measuredCm: [number, number] | null;
  wallCornerErrPx: number | null;
  k1Est: number | null;
  ms: number;
  sharpness: number | null;
  params: Record<string, number | string>;
  error?: string;
}

const quadErr = (a: Quad, b: Quad): number => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));

function evaluate(c: BuiltCase, cond: Condition): CaseRecord {
  const { image } = degrade(c, cond);
  const rec: CaseRecord = {
    cond: cond.id, scene: c.sceneIndex, seed: c.seed, outcome: "declared_failure", failure: null, errW: null, errH: null, warnings: [],
    uncertaintyPct: null, displayTolerancePct: null, refFound: false, refKindOk: false, refCornerErrPx: null, refCenter: null, refTruthCenter: centerOf(c.truth.refQuad), measuredCm: null, wallCornerErrPx: null, k1Est: null,
    ms: 0, sharpness: null, params: c.params,
  };
  // Sonde optionnelle : `sharpness` (autre agent) — enregistrée si elle existe et renvoie un nombre.
  const sharp = (WS as Record<string, unknown>).sharpness;
  if (typeof sharp === "function") {
    try {
      const v: unknown = (sharp as (i: GrayImage) => unknown)(image);
      if (typeof v === "number") rec.sharpness = v;
      else if (v && typeof v === "object" && typeof (v as { score?: unknown }).score === "number") rec.sharpness = (v as { score: number }).score;
    } catch {
      rec.sharpness = null;
    }
  }
  const t0 = performance.now();
  try {
    const res = WS.measurePhoto({ work: image, proposeOpenings: false });
    rec.ms = performance.now() - t0;
    rec.failure = res.failure;
    if (res.reference) {
      rec.refFound = true;
      rec.refKindOk = res.reference.kind === c.truth.refKind;
      rec.refCornerErrPx = quadErr(res.reference.quad, c.truth.refQuad);
      rec.refCenter = centerOf(res.reference.quad);
    }
    if (res.wallCorners) {
      const wq: Quad = [
        projectTruth(c, 0, 0),
        projectTruth(c, c.truth.W, 0),
        projectTruth(c, c.truth.W, c.truth.H),
        projectTruth(c, 0, c.truth.H),
      ];
      rec.wallCornerErrPx = quadErr(res.wallCorners.quad, wq);
    }
    rec.k1Est = res.distortion?.k1 ?? null;
    if (res.survey && res.failure === null) {
      rec.outcome = "measured";
      rec.measuredCm = [res.survey.widthCm, res.survey.heightCm];
      rec.errW = (Math.abs(res.survey.widthCm - c.truth.W) / c.truth.W) * 100;
      rec.errH = (Math.abs(res.survey.heightCm - c.truth.H) / c.truth.H) * 100;
      rec.warnings = res.survey.checks.warnings;
      rec.uncertaintyPct = res.survey.uncertaintyPct;
      rec.displayTolerancePct = res.survey.displayTolerancePct;
    }
  } catch (e) {
    rec.ms = performance.now() - t0;
    rec.outcome = "crash";
    rec.error = e instanceof Error ? e.message : String(e);
  }
  return rec;
}

function projectTruth(c: BuiltCase, x: number, y: number): Pt {
  const p = projectWall(makeCamera(c.scene.camera), x, y);
  if (!p) throw new Error("projection impossible");
  return p;
}

const worstErr = (r: CaseRecord): number => Math.max(r.errW ?? 0, r.errH ?? 0);
const isSilent = (r: CaseRecord): boolean => r.outcome === "measured" && worstErr(r) > 5 && !r.warnings.some(isReliabilityWarning);

// ------------------------------------------------------------------------------------------------------------------
// Exécution (workers)
// ------------------------------------------------------------------------------------------------------------------

interface Args {
  n: number;
  seed: number;
  out: string | null;
  json: string | null;
  fromJson: string | null;
  before: string | null;
  only: string[] | null;
  scene: number | null;
  verbose: boolean;
}

function parseArgs(): Args {
  const a: Args = { n: 40, seed: 20261108, out: null, json: null, fromJson: null, before: null, only: null, scene: null, verbose: false };
  for (const arg of process.argv.slice(2)) {
    const m = /^--(\w+)=(.*)$/.exec(arg);
    if (!m) continue;
    if (m[1] === "n") a.n = Number(m[2]);
    else if (m[1] === "seed") a.seed = Number(m[2]);
    else if (m[1] === "out") a.out = m[2];
    else if (m[1] === "json") a.json = m[2];
    else if (m[1] === "fromJson") a.fromJson = m[2];
    else if (m[1] === "before") a.before = m[2];
    else if (m[1] === "only") a.only = m[2].split(",");
    else if (m[1] === "scene") a.scene = Number(m[2]);
    else if (m[1] === "verbose") a.verbose = m[2] !== "0";
  }
  return a;
}

/** Les n premières scènes réalisables pour la condition (les scènes non cadrables à X % sont remplacées par les suivantes). */
function buildScenes(cond: Condition, n: number, seed: number): { cases: BuiltCase[]; skipped: number } {
  const cases: BuiltCase[] = [];
  let skipped = 0;
  for (let i = 0; cases.length < n && i < n * 40; i++) {
    const c = buildCase(i, cond, seed);
    if (c) cases.push(c);
    else skipped++;
  }
  return { cases, skipped };
}

interface Job {
  cond: string;
  scene: number;
}
interface WorkerMessage {
  records: CaseRecord[];
}

function runJobs(jobs: Job[], seed: number, verbose: boolean): CaseRecord[] {
  const out: CaseRecord[] = [];
  const byId = new Map(CONDITIONS.map((c) => [c.id, c]));
  for (const j of jobs) {
    const cond = byId.get(j.cond) as Condition;
    const built = buildCase(j.scene, cond, seed);
    if (!built) continue;
    const rec = evaluate(built, cond);
    out.push(rec);
    if (verbose) console.log(describe(rec));
  }
  return out;
}

function describe(r: CaseRecord): string {
  return `${r.cond} #${r.scene} seed=${r.seed} ${r.outcome}${r.failure ? `(${r.failure})` : ""} W=${fmt(r.errW ?? Number.NaN)}% H=${fmt(r.errH ?? Number.NaN)}% ref=${r.refFound ? (r.refKindOk ? "ok" : "MAUVAIS TYPE") : "non"} refErr=${fmt(r.refCornerErrPx ?? Number.NaN, 1)}px refAt=${JSON.stringify(r.refCenter)}/truth=${JSON.stringify(r.refTruthCenter)} mesuré=${r.measuredCm ? r.measuredCm.map((v) => v.toFixed(0)).join("×") : "—"} wallErr=${fmt(r.wallCornerErrPx ?? Number.NaN, 1)}px warn=[${r.warnings.join(",")}] ${r.ms.toFixed(0)}ms ${isSilent(r) ? "SILENCIEUSE " : ""}${JSON.stringify(r.params)}`;
}

// ------------------------------------------------------------------------------------------------------------------
// Rapport
// ------------------------------------------------------------------------------------------------------------------

/**
 * Section rédigée à la main d'après le run du 2026-11-08 (n = 20, graine 20261108). Elle est réécrite à l'identique à chaque
 * génération du rapport : à relire et mettre à jour quand les chiffres ci-dessus changent.
 */
const HAND_WRITTEN_MD = `## Constats (rédigés d'après le run du 2026-11-08, n = 20)

1. **Seul défaut bloquant : une fausse référence A4 acceptée sans avertissement** (4 cas, une seule scène : n° 14, graine 20371974, A4, mur 464,6 × 248,8 cm). Quand la vraie feuille est trop dégradée pour être trouvée (flou σ 3, bougé 14 px, gondolage 8 mm, roulis 8°), le détecteur retient un autre rectangle clair de proportion A4, à ≈ 500 px de la vraie feuille, et le moteur rend **153 × 81 cm** au lieu de 465 × 249 (−67 %) sans aucun avertissement : les coins du mur sont justes (< 3 px) et la fausse feuille a le bon rapport d'aspect, donc aucun des contrôles actuels ne se déclenche. La même scène en nominal est mesurée à 0,02 %. Rejeu : \`node dist/realism.mjs --only=blur-3 --scene=14 --verbose=1\`. Les quatre mesures rendent une hauteur de mur de 81 cm : une **garde de plausibilité** sur le résultat (hauteur hors [180 ; 450] cm, largeur hors [100 ; 1200] cm → avertissement bloquant « mesure à vérifier ») les aurait toutes annoncées. Les mêmes dégradations sur une mire (scène 13) donnent une fausse mire à 76 % d'erreur, annoncée uniquement parce que son rapport d'aspect est faux (\`reference_aspect_mismatch\`) : la protection est fortuite.
2. **Erreurs 5–12 % annoncées par un seul avertissement faible.** Scène 17 (mire) : les coins du bas du mur sont faux de ≈ 100 px (ligne de plinthe prise pour le sol), erreur 12 % dans 4 conditions (tangage 5°, roulis 2° et 5°, distance 5 %) ; scène 0 en tangage 10°–15° : coins faux de ≈ 49 px, erreurs 5–7 %. Dans tous ces cas seul \`floor_line_ambiguous\` (± \`uncertainty_above_display_tolerance\`) prévient : c'est correct, mais l'interface doit le traiter comme bloquant pour l'envoi du devis, pas comme un conseil.
3. **La précision ne se dégrade pas** avec le tangage (≤ 15°), le roulis (≤ 8°), la feuille de travers (≤ 7°), le vignettage 30 %, le bruit (≤ σ 14) ni la distance : quand une mesure est rendue, elle est dans 3 % (surexposition +1 IL : jusqu'à 4,2 %, 56 % des mesures sous 3 %). **C'est la détection qui s'effondre**, d'où des refus : flou σ ≥ 2 px (11/20 sans référence), bougé ≥ 8 px (11/20), gondolage ≥ 4 mm (10/20, 13/20 à 8 mm), distorsion k1 ≤ −0,12 (12/20 puis 19/20), bruit σ 14 (13/20), meuble (18/20 sans coins du mur : le bas du mur est caché, refus correct mais très fréquent). Ces refus sont déclarés, donc acceptables, mais le vendeur retombe sur la saisie manuelle.
4. **Distorsion non annoncée** : biais systématique sur W de 1,3 % (k1 −0,05) à 1,7 % (−0,12), p95 3,2 % : la correction de distorsion est sous-dimensionnée pour les ultra grand-angle, mais sans fausse mesure.
5. **\`sharpness\` ne discrimine pas dans ce banc** : sur les 60 images floues gaussiennes et 60 de bougé, aucune ne passe sous le seuil « blurry » (0,26) ; les 60 flous gaussiens (σ 1 à 3) sont tous « soft », mais 11/20 des images nominales aussi (bougé : 58/60). Un seuil de refus à 0,5 écarte 55 images sur 640 dont 17 bonnes mesures et seulement 4 des 16 mesures > 5 %. Piste : dans ce banc le bruit est ajouté **après** le flou (comme sur un capteur), ce qui gonfle les dérivées secondes ; le seuil a été calibré sur bench/sharpness.ts, à recaler avec le bruit après flou et sur de vraies photos JPEG.
6. **Moteur inchangé** : \`measurePhoto\` n'appelle pas encore \`sharpness\`, \`refineWallQuad\` ni \`fuseQuads\` au moment du run « après » : les colonnes avant/après sont identiques (écarts de la condition « distance » dus au remplacement de scènes non cadrables, pas au moteur).
7. Limites du banc : images de travail à 2048 px rendues directement (pas de JPEG, pas de rolling shutter, pas de HDR, pas de reflets), une seule teinte de feuille, un seul type de meuble ; 20 scènes par condition donnent une borne haute à 95 % de ≈ 14 % de fausses mesures silencieuses par condition (≈ 0,5 % sur les 640 cas, mais les 4 cas observés sont **un seul défaut de scène** : la variété des scènes compte plus que le nombre de dégradations ; relancer avec \`--n=40\` ou plus avant toute conclusion de type « 0 »).

## Seuils proposés (quand le module doit refuser la photo plutôt que mesurer)

Principe : on refuse (demande de reprise ou de saisie manuelle) quand le banc montre que **la détection échoue plus d'une fois sur deux** ou qu'une mesure fausse peut passer ; on avertit quand la précision se dégrade mais reste < 5 %. Les valeurs sont exprimées sur l'image de travail (2048 px côté long) et sont des **propositions à valider** par \`measurement-engineer\` ; un seuil ne doit jamais être abaissé pour faire passer le banc (ADR si irréaliste).

| Grandeur | Mesure sans réserve | Avertir (conseil de reprise) | Refuser la photo | Preuve dans le banc |
|---|---|---|---|---|
| Flou gaussien ajouté (σ, px) | ≤ 1 | 1 à 2 | ≥ 2 | σ 1 : 3/20 refus (= nominal), p95 0,9 % ; σ 2 : 11/20 refus + 1 mesure à 46 % ; σ 3 : 16/20 + 1 silencieuse |
| Flou de bougé horizontal (px) | ≤ 4 | 4 à 8 | ≥ 8 | 4 px : 5/20 refus, p95 1,3 % ; 8 px : 11/20 + 1 mesure à 46 % ; 14 px : 16/20 + 1 silencieuse |
| Inclinaison (tangage) | ≤ 15° | — | non justifié jusqu'à 15° | p95 pire 1,5–2,7 % à 5°, 10°, 15° ; au-delà de 15° non testé |
| Roulis | ≤ 8° | — | non justifié jusqu'à 8° | p95 pire ≤ 2,6 % hors scène 14 ; au-delà de 8° non testé |
| Feuille collée de travers | ≤ 7° | — | non justifié | p95 pire 0,15 % à 3° et 7° |
| Taille de la feuille (petit côté, px) | ≥ 55 | 40 à 55 | < 40 (= \`REFERENCE_MIN_SIDE_PX\`) | 3 % du grand côté (petit côté 42 px) : 5/20 refus, p95 1,1 % ; la précision ne dépend pas de la taille, la détection oui |
| Taille de la feuille (grand côté / grand côté de l'image) | ≥ 3 % | — | < 3 % (non testé : refuser par prudence) | 3 % à 6,6 % testés, p95 pire ≤ 2,1 % ; le cadrage du mur entier plafonne la feuille à ≈ 6,6 % (min 6,1 %) |
| Gondolage de la feuille | ≤ 2 mm | 2 à 4 mm | ≥ 4 mm (invérifiable en pratique : demander de plaquer la feuille) | 2 mm : 2/20 refus ; 4 mm : 10/20 ; 8 mm : 13/20 + 1 silencieuse |
| Distorsion radiale (k1 estimé, valeur absolue) | ≤ 0,05 | 0,05 à 0,10 | > 0,10 | k1 −0,05 : biais 1,3 % ; −0,12 : 12/20 refus, p95 3,2 % ; −0,25 : 19/20 refus |
| Meuble masquant le bas du mur | — | — | coins bas du mur non trouvés (déjà le cas) | 10 % et 25 % : 18/20 refus, aucune fausse mesure |
| Bruit gaussien (σ, niveaux/255) | ≤ 8 | 8 à 14 | > 14 (non testé) | σ 14 : 13/20 refus mais p95 pire 1,6 % |
| Surexposition (feuille saturée) | pas de saturation | feuille ≥ 255 sur > 30 % de ses pixels | — | +1 IL : 11/20 refus, p95 pire 4,2 % |
| **Plausibilité du résultat (nouveau)** | hauteur ∈ [180 ; 450] cm et largeur ∈ [100 ; 1200] cm | — | hors bornes → « mesure à vérifier », envoi du devis bloqué | les 4 fausses mesures silencieuses rendent 81 cm de haut |

Critères du banc en CI (une régression bloque le merge) :
1. **0 fausse mesure silencieuse** sur l'ensemble des conditions, \`--n=40\` au moins (bloquant).
2. Dans les conditions « sans réserve » (flou ≤ 1 px, bougé ≤ 4 px, tangage ≤ 15°, roulis ≤ 8°, travers ≤ 7°, k1 ≥ −0,05, bruit ≤ σ 8, gondolage ≤ 2 mm, vignettage, sous-exposition, distance 3–9 %) : p95 de max(W, H) ≤ 3 % sur les mesures rendues et refus déclarés ≤ 40 % (nominal : 15 %).
3. Aucun crash (exception) dans aucune condition.
4. Toute mesure > 5 % porte au moins un avertissement de fiabilité ; la part des mesures > 5 % ne reposant que sur \`floor_line_ambiguous\` est suivie (cible : 0 une fois la ligne de plinthe fiabilisée).
`;

interface Stats {
  n: number;
  measured: number;
  declared: number;
  crash: number;
  wP50: number;
  wP95: number;
  hP50: number;
  hP95: number;
  worstP95: number;
  lt3: number;
  lt5: number;
  silent: number;
  announcedBad: number;
  refRate: number;
  msP50: number;
}

function stats(rs: CaseRecord[]): Stats {
  const m = rs.filter((r) => r.outcome === "measured");
  const pct = (k: number, tot: number): number => (tot === 0 ? Number.NaN : (k / tot) * 100);
  const sw = summarize(m.map((r) => r.errW as number));
  const sh = summarize(m.map((r) => r.errH as number));
  const sx = summarize(m.map(worstErr));
  return {
    n: rs.length,
    measured: m.length,
    declared: rs.filter((r) => r.outcome === "declared_failure").length,
    crash: rs.filter((r) => r.outcome === "crash").length,
    wP50: sw.p50, wP95: sw.p95, hP50: sh.p50, hP95: sh.p95, worstP95: sx.p95,
    lt3: pct(m.filter((r) => worstErr(r) < 3).length, m.length),
    lt5: pct(m.filter((r) => worstErr(r) < 5).length, m.length),
    silent: rs.filter(isSilent).length,
    announcedBad: m.filter((r) => worstErr(r) > 5 && r.warnings.some(isReliabilityWarning)).length,
    refRate: pct(rs.filter((r) => r.refFound && r.refKindOk && (r.refCornerErrPx as number) < 6).length, rs.length),
    msP50: summarize(rs.map((r) => r.ms)).p50,
  };
}

function report(records: CaseRecord[], args: Args, skipped: Record<string, number>, before: CaseRecord[] | null): string {
  const L: string[] = [];
  const date = new Date().toISOString().slice(0, 10);
  const n = args.n;
  const probes = ["measurePhoto", "detectReference", "proposeWallCorners", "rectify", "refineWallQuad", "sharpness", "fuseQuads"].map((k) => `${k}${typeof (WS as Record<string, unknown>)[k] === "function" ? " ✓" : " —"}`);
  L.push("# Banc de réalisme terrain — mesure d'un mur depuis une photo de téléphone");
  L.push("");
  L.push(`Généré le ${date} par \`pnpm -s --filter @wallscan/measurement bench:realism\` — ${n} scènes par condition, graine ${args.seed}, ${records.length} cas.`);
  L.push("");
  L.push("**Relancer** : `pnpm -s --filter @wallscan/measurement bench:realism` (écrit ce rapport et `dist/realism-results.json`). Durée mesurée : 10 à 13,5 min (3 runs) sur la machine de développement (2 cœurs partagés avec d'autres agents, charge 3–5) avec **n = 20 scènes par condition au lieu de 40** pour rester dans le budget ; ≈ 8 min estimées si les deux cœurs sont libres. `--n=40` pour la version complète (≈ 16–27 min). Comparer à un run antérieur : copier `dist/realism-results.json` vers `dist/realism-before.json`, relancer, puis `node dist/realism.mjs --n=20 --json=dist/realism-after.json --before=dist/realism-before.json --out=<rapport>`. Rejeu d'un cas : `node dist/realism.mjs --only=<condition> --scene=<n°> --verbose=1`.");
  L.push("");
  L.push("Runs consignés : « avant » = `src` tel qu'au début de la session (16:45, avant `quality.ts`/`wallRefine.ts`) ; « après » = `src` à 17:19 (`sharpness`, `refineWallQuad`, `fuseQuads` exportés mais non appelés par `measurePhoto`) ; un run intermédiaire à 17:01 a donné exactement les mêmes chiffres.");
  L.push("");
  L.push(`Exports de \`src/index.ts\` au moment du run : ${probes.join(", ")}.`);
  L.push("");
  L.push("## Protocole");
  L.push("");
  L.push("- Scènes : `generateCase` du banc synthétique (mur 250–550 × 230–300 cm, plinthe, 0–2 fenêtres, porte, radiateur, prises, cadre, A4 ou mire alternées), rendues par `renderScene` à **2048 px côté long** (le pipeline de production travaille à 2048 px ; pas d'affinage plein résolution ici, donc un peu plus sévère que `bench`). Les **mêmes " + n + " scènes** servent à toutes les conditions (comparaison appariée), sauf « distance » où une scène non cadrable avec la feuille à X % est remplacée par la suivante.");
  L.push("- Pose nominale « client » (hors dégradation) : lacet ±10°, tangage ±3°, roulis ±1,5°, k1 ∈ ±0,02, distance 2,5–5 m (augmentée si le mur ne tient pas dans le cadre), hauteur d'yeux 1–1,7 m. Une dégradation remplace seulement le paramètre concerné. Inclinaison et roulis modifient la **projection** (matrice de caméra), pas l'image ; signe tiré au hasard par scène.");
  L.push("- Dégradations dans l'image : flou gaussien composé au flou d'objectif (σ0,6–1,2 px) ; bougé = moyenne glissante horizontale ; exposition en lumière linéaire (γ 2,2) avec écrêtage, bruit σ 5 ajouté après la courbe en sous-exposition ; vignettage 30 % = atténuation `1 − 0,3·r²` (r = 1 au coin) ; bruit gaussien final de σ indiqué (nominal 1,5–4) ; feuille gondolée = déplacement sinusoïdal 2D (λ = 0,55 × grand côté de la feuille, amplitude en mm convertie par l'échelle locale, bord de la feuille compris) ; feuille de travers = rotation dans le plan du mur ; meuble = rectangle sombre au sol (teinte 35–70) couvrant X % de la **surface** du mur, hauteur ≤ 120 cm (sous la feuille) ; distance = caméra placée pour que le grand côté de la feuille (29,7 cm) occupe X % du grand côté de l'image.");
  L.push("- Distorsion k1 : modèle de division du dépôt (`src/distortion.ts`), k1 < 0 = barillet (ultra grand-angle). Le moteur n'est pas informé (pas de `distortion` en entrée) et estime k1 sur les lignes du mur.");
  L.push("- Pipeline : `measurePhoto({ work, proposeOpenings: false })` seul (les ouvertures ne changent pas W/H ; gain de temps), **sans aucune intervention** (ni coins, ni référence, ni focale EXIF).");
  L.push("- Erreur = |mesuré − vérité| / vérité sur W et H ; « pire » = max(W, H). Les colonnes `<3 %` et `<5 %` sont des taux **parmi les mesures rendues** ; l'échec déclaré (`failure` non nul : référence ou coins du mur non trouvés, géométrie dégénérée) est compté à part et reste acceptable puisqu'annoncé.");
  L.push("- **Fausse mesure silencieuse** = mesure rendue avec erreur > 5 % et **aucun avertissement de fiabilité** (`survey.checks.warnings` privé de `baseboard_height_required`, simple demande de saisie). Critère bloquant : doit être 0. « Annoncées » = erreur > 5 % avec au moins un avertissement.");
  L.push("");

  // Tableau par condition.
  const byCond = new Map<string, CaseRecord[]>();
  for (const r of records) byCond.set(r.cond, [...(byCond.get(r.cond) ?? []), r]);
  const prevBy = new Map<string, CaseRecord[]>();
  for (const r of before ?? []) prevBy.set(r.cond, [...(prevBy.get(r.cond) ?? []), r]);
  const st = new Map<string, Stats>();
  for (const c of CONDITIONS) if (byCond.has(c.id)) st.set(c.id, stats(byCond.get(c.id) as CaseRecord[]));

  const total = stats(records);
  L.push("## Verdict");
  L.push("");
  const silentCases = records.filter(isSilent);
  L.push(`- Fausses mesures silencieuses : **${total.silent}** sur ${records.length} cas — ${total.silent === 0 ? "critère bloquant respecté." : "**CRITÈRE BLOQUANT VIOLÉ** (liste ci-dessous)."}`);
  L.push(`- Crashs (exception dans le moteur) : ${total.crash}.`);
  L.push(`- Mesures rendues : ${total.measured} ; échecs déclarés : ${total.declared} ; mesures erronées > 5 % mais annoncées : ${total.announcedBad}.`);
  L.push("");

  L.push("## Résultats par condition et par niveau");
  L.push("");
  const cols = "| Niveau | n | Mesures | Échec déclaré | Crash | W p50 | W p95 | H p50 | H p95 | < 3 % | < 5 % | Annoncées > 5 % | **Silencieuses** | Réf. OK | t p50 |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const row = (label: string, s: Stats): string =>
    `| ${label} | ${s.n} | ${s.measured} | ${s.declared} | ${s.crash} | ${fmt(s.wP50)} % | ${fmt(s.wP95)} % | ${fmt(s.hP50)} % | ${fmt(s.hP95)} % | ${fmt(s.lt3, 0)} % | ${fmt(s.lt5, 0)} % | ${s.announcedBad} | **${s.silent}** | ${fmt(s.refRate, 0)} % | ${fmt(s.msP50, 0)} ms |`;
  const groups = [...new Set(CONDITIONS.map((c) => c.group))];
  for (const g of groups) {
    const conds = CONDITIONS.filter((c) => c.group === g && st.has(c.id));
    if (conds.length === 0) continue;
    L.push(`### ${conds[0].groupLabel}`);
    L.push("");
    if (skipped[conds[0].id]) L.push(`_${skipped[conds[0].id]} scène(s) non cadrables remplacées par les suivantes (mur trop large pour tenir dans le cadre à cette distance)._`);
    if (skipped[conds[0].id]) L.push("");
    L.push(cols);
    L.push(sep);
    for (const c of conds) L.push(row(c.label, st.get(c.id) as Stats));
    L.push("");
    if (g === "dist") {
      for (const c of conds) {
        const pcts = (byCond.get(c.id) as CaseRecord[]).map((r) => Number(r.params.sheetLongPctOfLongSide));
        const sp = (byCond.get(c.id) as CaseRecord[]).map((r) => Number(r.params.sheetShortPx));
        L.push(`- ${c.label} : grand côté de la feuille réellement à ${fmt(summarize(pcts).p50, 1)} % (min ${fmt(Math.min(...pcts), 1)} %) du grand côté de l'image, petit côté ${fmt(summarize(sp).p50, 0)} px (min ${fmt(Math.min(...sp), 0)} px).`);
      }
      L.push("");
    }
  }

  if (silentCases.length > 0) {
    L.push("## Fausses mesures silencieuses (à reproduire)");
    L.push("");
    L.push("| Condition | Scène | Graine | Erreur W / H | Paramètres |");
    L.push("|---|---|---|---|---|");
    for (const r of silentCases) L.push(`| ${r.cond} | ${r.scene} | ${r.seed} | ${fmt(r.errW as number)} % / ${fmt(r.errH as number)} % | \`${JSON.stringify(r.params)}\` |`);
    L.push("");
    L.push("Rejeu : `node dist/realism.mjs --only=<condition> --scene=<scène> --verbose=1` (`dist/realism.mjs` est construit par `bench:realism`).");
    L.push("");
  }

  const withSharp = records.filter((r) => r.sharpness !== null);
  if (withSharp.length > 0) {
    L.push("## Netteté mesurée par `sharpness` (score ≈ 1 / largeur du flou en px, image de travail)");
    L.push("");
    L.push("| Condition | Niveau | Score min | p50 | max | Mesure > 5 % ou échec déclaré parmi les scores < 0,5 |");
    L.push("|---|---|---|---|---|---|");
    for (const c of CONDITIONS) {
      if (!["nominal", "blur", "motion", "noise", "dist", "expo"].includes(c.group)) continue;
      const rs = (byCond.get(c.id) ?? []).filter((r) => r.sharpness !== null);
      if (rs.length === 0) continue;
      const sc = rs.map((r) => r.sharpness as number);
      const low = rs.filter((r) => (r.sharpness as number) < 0.5);
      const bad = low.filter((r) => r.outcome !== "measured" || worstErr(r) > 5).length;
      L.push(`| ${c.groupLabel} | ${c.label} | ${fmt(Math.min(...sc))} | ${fmt(summarize(sc).p50)} | ${fmt(Math.max(...sc))} | ${bad} / ${low.length} |`);
    }
    L.push("");
  }

  // Résumés.
  const ranked = CONDITIONS.filter((c) => st.has(c.id) && c.id !== "nominal")
    .map((c) => {
      const s = st.get(c.id) as Stats;
      // Score de dégradation : échecs déclarés + part de mesures > 5 % + p95 (borné).
      const bad = s.n === 0 ? 0 : (s.declared + s.crash) / s.n * 100 + (Number.isNaN(s.lt5) ? 0 : (100 - s.lt5) * (s.measured / s.n));
      return { c, s, bad };
    })
    .sort((a, b) => b.bad - a.bad);
  L.push("## Ce qui dégrade le plus la mesure");
  L.push("");
  L.push("Classement par part de scènes non mesurées correctement (échec déclaré + mesures ≥ 5 %), niveau par niveau :");
  L.push("");
  L.push("| # | Condition | Niveau | Échec déclaré | Mesures ≥ 5 % (sur n) | W/H p95 pire | Silencieuses |");
  L.push("|---|---|---|---|---|---|---|");
  ranked.slice(0, 12).forEach((x, i) => {
    const over5 = x.s.measured === 0 ? 0 : Math.round(((100 - x.s.lt5) / 100) * x.s.measured);
    L.push(`| ${i + 1} | ${x.c.groupLabel} | ${x.c.label} | ${x.s.declared} / ${x.s.n} | ${over5} / ${x.s.n} | ${fmt(x.s.worstP95)} % | ${x.s.silent} |`);
  });
  L.push("");
  const nom = st.get("nominal");
  if (nom) L.push(`Témoin nominal : ${nom.measured}/${nom.n} mesures, p95 pire(W,H) ${fmt(nom.worstP95)} %, < 3 % : ${fmt(nom.lt3, 0)} %, échec déclaré : ${nom.declared}.`);
  L.push("");
  L.push("## Ce qui est annoncé correctement");
  L.push("");
  L.push("Conditions où le moteur produit des mesures > 5 % **toutes accompagnées d'un avertissement**, ou refuse de mesurer (échec déclaré), et jamais de silencieuse :");
  L.push("");
  L.push("| Condition | Niveau | Échec déclaré | Mesures > 5 % annoncées | Silencieuses |");
  L.push("|---|---|---|---|---|");
  for (const c of CONDITIONS) {
    const s = st.get(c.id);
    if (!s || c.id === "nominal") continue;
    if (s.declared + s.announcedBad === 0) continue;
    L.push(`| ${c.groupLabel} | ${c.label} | ${s.declared} / ${s.n} | ${s.announcedBad} | ${s.silent} |`);
  }
  L.push("");
  // Avertissements les plus fréquents sur les mesures > 5 %.
  const wc = new Map<string, number>();
  for (const r of records) if (r.outcome === "measured" && worstErr(r) > 5) for (const w of r.warnings) wc.set(w, (wc.get(w) ?? 0) + 1);
  const failc = new Map<string, number>();
  for (const r of records) if (r.outcome === "declared_failure") failc.set(r.failure ?? "?", (failc.get(r.failure ?? "?") ?? 0) + 1);
  L.push(`Avertissements présents sur les mesures > 5 % : ${[...wc.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `\`${k}\` ×${v}`).join(", ") || "aucun"}.`);
  L.push(`Motifs d'échec déclaré : ${[...failc.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `\`${k}\` ×${v}`).join(", ") || "aucun"}.`);
  L.push("");

  if (before) {
    L.push("## Avant / après (même graine, mêmes scènes)");
    L.push("");
    L.push("| Condition | Niveau | Échec déclaré avant → après | pire p95 avant → après | < 5 % avant → après | Silencieuses avant → après |");
    L.push("|---|---|---|---|---|---|");
    for (const c of CONDITIONS) {
      const a = st.get(c.id);
      const pr = prevBy.get(c.id);
      if (!a || !pr) continue;
      const b = stats(pr);
      L.push(`| ${c.groupLabel} | ${c.label} | ${b.declared} → ${a.declared} | ${fmt(b.worstP95)} → ${fmt(a.worstP95)} % | ${fmt(b.lt5, 0)} → ${fmt(a.lt5, 0)} % | ${b.silent} → ${a.silent} |`);
    }
    L.push("");
  }
  L.push(HAND_WRITTEN_MD);
  return L.join("\n");
}

// ------------------------------------------------------------------------------------------------------------------
// Point d'entrée
// ------------------------------------------------------------------------------------------------------------------

interface Saved {
  seed: number;
  n: number;
  skipped: Record<string, number>;
  records: CaseRecord[];
}

if (!isMainThread) {
  const { jobs, seed, verbose } = workerData as { jobs: Job[]; seed: number; verbose: boolean };
  const msg: WorkerMessage = { records: runJobs(jobs, seed, verbose) };
  parentPort?.postMessage(msg);
} else {
  const args = parseArgs();
  const finish = (saved: Saved, before: CaseRecord[] | null): void => {
    const md = report(saved.records, { ...args, seed: saved.seed, n: saved.n }, saved.skipped, before);
    if (args.out) {
      mkdirSync(dirname(args.out), { recursive: true });
      writeFileSync(args.out, md);
      console.log(`Rapport écrit : ${args.out}`);
    } else console.log(md);
  };
  const loadBefore = (): CaseRecord[] | null => (args.before ? (JSON.parse(readFileSync(args.before, "utf8")) as Saved).records : null);
  if (args.fromJson) {
    finish(JSON.parse(readFileSync(args.fromJson, "utf8")) as Saved, loadBefore());
  } else {
    const start = performance.now();
    const conds = CONDITIONS.filter((c) => !args.only || args.only.includes(c.id) || args.only.includes(c.group));
    const jobs: Job[] = [];
    const skipped: Record<string, number> = {};
    for (const c of conds) {
      if (args.scene !== null) {
        jobs.push({ cond: c.id, scene: args.scene });
        continue;
      }
      const { cases, skipped: sk } = buildScenes(c, args.n, args.seed);
      skipped[c.id] = sk;
      for (const k of cases) jobs.push({ cond: c.id, scene: k.sceneIndex });
    }
    const workers = Math.max(1, Math.min(cpus().length, 8));
    const chunks: Job[][] = Array.from({ length: workers }, () => []);
    jobs.forEach((j, i) => chunks[i % workers].push(j));
    const self = fileURLToPath(import.meta.url);
    const records: CaseRecord[] = [];
    await Promise.all(
      chunks
        .filter((ch) => ch.length > 0)
        .map(
          (ch) =>
            new Promise<void>((resolve, reject) => {
              const wk = new Worker(self, { workerData: { jobs: ch, seed: args.seed, verbose: args.verbose || args.scene !== null } });
              wk.on("message", (m: WorkerMessage) => records.push(...m.records));
              wk.on("error", reject);
              wk.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker ${code}`))));
            }),
        ),
    );
    records.sort((a, b) => (a.cond === b.cond ? a.scene - b.scene : a.cond < b.cond ? -1 : 1));
    console.log(`Total ${((performance.now() - start) / 1000).toFixed(0)} s sur ${workers} worker(s), ${records.length} cas`);
    const saved: Saved = { seed: args.seed, n: args.n, skipped, records };
    if (args.json && args.scene === null) writeFileSync(args.json, JSON.stringify(saved));
    if (args.scene === null) finish(saved, loadBefore());
  }
}
