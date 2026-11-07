/**
 * Rasteriseur maison du banc synthétique (aucun canvas, aucune dépendance) : rend en niveaux de gris une pièce vue de
 * l'intérieur — mur du fond (plan z = 0) avec plinthe, fenêtres, portes, radiateur, prises, cadre, feuille A4 ou mire —
 * plafond, sol (lames) et murs latéraux, à travers une caméra sténopé avec distorsion radiale, éclairage dégradé,
 * vignettage, flou d'objectif et bruit gaussien. Anti-crénelage analytique : chaque arête est lissée sur l'empreinte
 * du pixel dans le plan (filtre boîte), donc une seule évaluation par pixel.
 */
import type { GrayImage } from "@wallscan/core";
import { gaussianBlurF32 } from "../src/image.js";
import { MIRE_LAYOUT, mireCodeCells } from "../src/constants.js";
import { makeCamera, type Camera, type CameraParams, type Vec3 } from "./camera.js";
import { gaussianNoise, mulberry32 } from "./random.js";

/** Rectangle axé dans le plan du mur (cm) avec une fonction de teinte interne. */
export interface Layer {
  x: number;
  y: number;
  w: number;
  h: number;
  shade: (x: number, y: number) => number;
}

export interface SheetSpec {
  /** Coin haut-gauche de la feuille (cm, repère mur), taille, rotation autour de son centre. */
  x: number;
  y: number;
  w: number;
  h: number;
  angleDeg: number;
  kind: "a4" | "mire";
  /** Identifiant codé dans la mire (0–63). */
  code: number;
  shade: number;
}

export interface SceneSpec {
  W: number;
  H: number;
  wallShade: number;
  ceilingShade: number;
  floorShade: number;
  sideShadeLeft: number;
  sideShadeRight: number;
  baseboard: { h: number; shade: number } | null;
  layers: Layer[];
  sheet: SheetSpec | null;
  lighting: { gx: number; gy: number; vignette: number };
  floorPattern: "none" | "perpendicular" | "parallel";
  floorSeamSpacing: number;
  noiseSigma: number;
  blurSigma: number;
  camera: CameraParams;
  seed: number;
}

/** Géométrie de la mire dans le repère feuille (origine = coin haut-gauche de la feuille A4 portrait). */
export const MIRE = {
  sheetW: MIRE_LAYOUT.sheetW,
  sheetH: MIRE_LAYOUT.sheetH,
  frame: { x: MIRE_LAYOUT.frameMargin, y: MIRE_LAYOUT.frameMargin, w: MIRE_LAYOUT.frameW, h: MIRE_LAYOUT.frameH, t: MIRE_LAYOUT.frameT },
  cornerSquare: MIRE_LAYOUT.cornerSquare,
  cornerInset: MIRE_LAYOUT.cornerInset,
  codeCell: MIRE_LAYOUT.codeCell,
  codeCells: MIRE_LAYOUT.codeCells,
} as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Couverture anti-crénelée d'un rectangle [x, x+w] × [y, y+h] au point (px, py) pour une empreinte fp. */
function rectCoverage(px: number, py: number, x: number, y: number, w: number, h: number, fp: number): number {
  const dx = Math.abs(px - (x + w / 2)) - w / 2;
  const dy = Math.abs(py - (y + h / 2)) - h / 2;
  const d = dx > dy ? dx : dy; // distance signée approchée (négative à l'intérieur)
  return clamp01(0.5 - d / fp);
}

function sheetShade(sheet: SheetSpec, lx: number, ly: number, fp: number, base: number): number {
  // Repère feuille : (lx, ly) ∈ [0, w] × [0, h] à l'intérieur.
  let s = base;
  const cov = rectCoverage(lx, ly, 0, 0, sheet.w, sheet.h, fp);
  if (cov <= 0) return base;
  let inner = sheet.shade;
  if (sheet.kind === "mire") {
    // La mire est dessinée dans le repère portrait ; en paysage, (w, h) sont échangés → on retourne au repère portrait.
    const portrait = sheet.h >= sheet.w;
    const px = portrait ? lx : ly;
    const py = portrait ? ly : sheet.w - lx;
    const f = MIRE.frame;
    const black = 18;
    const outer = rectCoverage(px, py, f.x, f.y, f.w, f.h, fp);
    const hole = rectCoverage(px, py, f.x + f.t, f.y + f.t, f.w - 2 * f.t, f.h - 2 * f.t, fp);
    inner = inner + (black - inner) * outer;
    inner = inner + (sheet.shade - inner) * hole;
    const sq = MIRE.cornerSquare;
    const ins = MIRE.cornerInset;
    const corners = [
      [f.x + ins, f.y + ins],
      [f.x + f.w - ins - sq, f.y + ins],
      [f.x + f.w - ins - sq, f.y + f.h - ins - sq],
      [f.x + ins, f.y + f.h - ins - sq],
    ];
    for (const [cx, cy] of corners) inner = inner + (black - inner) * rectCoverage(px, py, cx, cy, sq, sq, fp);
    const cells = mireCodeCells(sheet.code);
    const cell = MIRE.codeCell;
    const n = MIRE.codeCells;
    const gx0 = f.x + f.w / 2 - (n * cell) / 2;
    const gy0 = f.y + f.h / 2 - (n * cell) / 2;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!cells[r * n + c]) continue;
        inner = inner + (black - inner) * rectCoverage(px, py, gx0 + c * cell, gy0 + r * cell, cell, cell, fp);
      }
    }
  }
  s = s + (inner - s) * cov;
  return s;
}

/** Teinte du mur du fond en (x, y) cm pour une empreinte fp (cm/px). */
function wallShade(scene: SceneSpec, x: number, y: number, fp: number): number {
  const L = 1 + scene.lighting.gx * ((x - scene.W / 2) / scene.W) + scene.lighting.gy * ((y - scene.H / 2) / scene.H);
  let s = scene.wallShade;
  if (scene.baseboard) {
    const d = scene.H - scene.baseboard.h - y;
    if (d < fp) {
      const cov = d <= -fp ? 1 : 0.5 - d / fp; // en dessous du haut de plinthe
      s = s + (scene.baseboard.shade - s) * (cov > 1 ? 1 : cov);
    }
  }
  const layers = scene.layers;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (x < layer.x - fp || x > layer.x + layer.w + fp || y < layer.y - fp || y > layer.y + layer.h + fp) continue;
    const cov = rectCoverage(x, y, layer.x, layer.y, layer.w, layer.h, fp);
    if (cov > 0) s = s + (layer.shade(x, y) - s) * cov;
  }
  const sh = scene.sheet;
  if (sh && x > sh.x - 3 && x < sh.x + sh.w + 3 && y > sh.y - 3 && y < sh.y + sh.h + 3) {
    const cx = sh.x + sh.w / 2;
    const cy = sh.y + sh.h / 2;
    const a = (-sh.angleDeg * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    const lx = cx + dx * Math.cos(a) - dy * Math.sin(a) - sh.x;
    const ly = cy + dx * Math.sin(a) + dy * Math.cos(a) - sh.y;
    s = sheetShade(sh, lx, ly, fp, s);
  }
  return s * L;
}

function floorShade(scene: SceneSpec, x: number, z: number, fp: number): number {
  let s = scene.floorShade * (1 + 0.12 * (z / 400)); // plus sombre en s'éloignant de la caméra… vers le mur
  if (scene.floorPattern !== "none") {
    const coord = scene.floorPattern === "perpendicular" ? x : -z;
    const sp = scene.floorSeamSpacing;
    const frac = coord / sp - Math.floor(coord / sp);
    const dist = Math.min(frac, 1 - frac) * sp;
    const cov = clamp01(0.5 - (dist - 0.4) / fp); // joint de 0,8 cm
    s = s + (s * 0.55 - s) * cov;
  }
  return s;
}

export interface RenderResult {
  image: GrayImage;
  camera: Camera;
  renderMs: number;
}

/** Rend la scène à la résolution de la caméra. */
export function renderScene(scene: SceneSpec): RenderResult {
  const t0 = performance.now();
  const cam = makeCamera(scene.camera);
  const W = cam.imageW;
  const Hh = cam.imageH;
  const buf = new Float32Array(W * Hh);
  const C = cam.position;
  const R = cam.R;
  const f = cam.focalPx;
  const cx = W / 2;
  const cy = Hh / 2;
  const rNorm = Math.hypot(cx, cy);
  const k1 = cam.k1;
  const vig = scene.lighting.vignette;
  for (let j = 0; j < Hh; j++) {
    const v = j + 0.5;
    let prevOnWall = false;
    let prevX = 0;
    let prevY = 0;
    for (let i = 0; i < W; i++) {
      const u = i + 0.5;
      // Pixel distordu → non distordu.
      const ndx = (u - cx) / rNorm;
      const ndy = (v - cy) / rNorm;
      const r2 = ndx * ndx + ndy * ndy;
      const den = 1 + k1 * r2;
      const ux = cx + (ndx / den) * rNorm;
      const uy = cy + (ndy / den) * rNorm;
      // Rayon : direction caméra puis monde (Rᵀ d).
      const dcx = (ux - cx) / f;
      const dcy = (uy - cy) / f;
      const dx = R[0] * dcx + R[3] * dcy + R[6];
      const dy = R[1] * dcx + R[4] * dcy + R[7];
      const dz = R[2] * dcx + R[5] * dcy + R[8];
      let shade: number;
      let onWall = false;
      let px = 0;
      let py = 0;
      if (dz > 1e-9) {
        const t = -C[2] / dz;
        px = C[0] + t * dx;
        py = C[1] + t * dy;
        onWall = px >= 0 && px <= scene.W && py >= 0 && py <= scene.H;
      }
      if (onWall) {
        let fp: number;
        if (prevOnWall) {
          const ex = px - prevX;
          const ey = py - prevY;
          fp = Math.sqrt(ex * ex + ey * ey);
        } else {
          // Empreinte par différence finie vers le pixel suivant.
          const dcx2 = (ux + 1 - cx) / f;
          const dx2 = R[0] * dcx2 + R[3] * dcy + R[6];
          const dy2 = R[1] * dcx2 + R[4] * dcy + R[7];
          const dz2 = R[2] * dcx2 + R[5] * dcy + R[8];
          const t2 = -C[2] / dz2;
          const ex = C[0] + t2 * dx2 - px;
          const ey = C[1] + t2 * dy2 - py;
          fp = Math.sqrt(ex * ex + ey * ey);
        }
        if (fp < 1e-3) fp = 1e-3;
        shade = wallShade(scene, px, py, fp);
        prevX = px;
        prevY = py;
      } else {
        // Intersection avec les autres faces de la boîte : y = 0 (plafond), y = H (sol), x = 0, x = W (murs latéraux).
        let t = Number.POSITIVE_INFINITY;
        let face = -1;
        if (dy < -1e-9) {
          t = -C[1] / dy;
          face = 1;
        } else if (dy > 1e-9) {
          t = (scene.H - C[1]) / dy;
          face = 2;
        }
        if (dx < -1e-9) {
          const tx = -C[0] / dx;
          if (tx < t) {
            t = tx;
            face = 3;
          }
        } else if (dx > 1e-9) {
          const tx = (scene.W - C[0]) / dx;
          if (tx < t) {
            t = tx;
            face = 4;
          }
        }
        if (face < 0) {
          shade = 40;
        } else {
          const qx = C[0] + t * dx;
          const qy = C[1] + t * dy;
          const qz = C[2] + t * dz;
          const dlen = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const distCam = t * dlen;
          const cosang = (face <= 2 ? Math.abs(dy) : Math.abs(dx)) / dlen;
          let fp = (distCam / f) / (cosang < 0.15 ? 0.15 : cosang);
          if (fp < 1e-3) fp = 1e-3;
          if (face === 1) shade = scene.ceilingShade * (1 - 0.08 * (qz / -400));
          else if (face === 2) shade = floorShade(scene, qx, qz, fp);
          else {
            const side = face === 3 ? scene.sideShadeLeft : scene.sideShadeRight;
            shade = side * (1 + 0.1 * (qz / 400));
            if (scene.baseboard) {
              // La plinthe du mur latéral est éclairée comme son mur (jonction d'angle visible, comme en réalité).
              const ratio = Math.max(0.75, Math.min(1.15, side / scene.wallShade));
              const cov = clamp01(0.5 - (scene.H - scene.baseboard.h - qy) / fp);
              shade = shade + (Math.min(255, scene.baseboard.shade * ratio) - shade) * cov;
            }
          }
        }
      }
      prevOnWall = onWall;
      // Vignettage (image).
      buf[j * W + i] = shade * (1 - vig * r2);
    }
  }
  const blurred = scene.blurSigma > 0 ? gaussianBlurF32(buf, W, Hh, scene.blurSigma) : buf;
  const rng = mulberry32(scene.seed ^ 0x9e3779b9);
  const out = new Uint8ClampedArray(W * Hh);
  const sigma = scene.noiseSigma;
  // Table de bruit gaussien (65 536 échantillons) indexée par le générateur : même qualité statistique, 5× plus rapide.
  const table = new Float32Array(65536);
  for (let i = 0; i < table.length; i++) table[i] = gaussianNoise(rng) * sigma;
  for (let i = 0; i < out.length; i++) out[i] = blurred[i] + table[(rng() * 65536) | 0];
  return { image: { width: W, height: Hh, data: out }, camera: cam, renderMs: performance.now() - t0 };
}

export type { Vec3 };
