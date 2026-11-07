/**
 * Caméra virtuelle du banc synthétique : sténopé + distorsion radiale (modèle de division, même convention que
 * `src/distortion.ts`). Repère monde en cm : x vers la droite, y vers le bas, z vers le mur ; le mur est le plan z = 0,
 * son coin haut-gauche à l'origine ; la caméra est en z < 0 et regarde vers +z quand ses angles sont nuls.
 * Coordonnées image continues : le pixel (i, j) couvre [i, i+1[ × [j, j+1[ (centre en i + 0,5).
 */
import type { Pt } from "@wallscan/core";
import { distortPoint, undistortPoint } from "../src/distortion.js";
import type { Mat3 } from "../src/linalg.js";
import { mat3Mul } from "../src/linalg.js";

export type Vec3 = [number, number, number];

export interface CameraParams {
  imageW: number;
  imageH: number;
  /** Focale en pixels (image pleine résolution). */
  focalPx: number;
  k1: number;
  /** Position du centre optique (cm, repère monde). */
  position: Vec3;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

export interface Camera extends CameraParams {
  /** Rotation monde → caméra (ligne par ligne). */
  R: Mat3;
  /** Homographie plan du mur (cm) → image non distordue (px). */
  planeToImage: Mat3;
}

const deg = (d: number): number => (d * Math.PI) / 180;

export function rotationMatrix(yawDeg: number, pitchDeg: number, rollDeg: number): Mat3 {
  const a = deg(yawDeg);
  const b = deg(pitchDeg);
  const c = deg(rollDeg);
  const ry: Mat3 = [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
  const rx: Mat3 = [1, 0, 0, 0, Math.cos(b), -Math.sin(b), 0, Math.sin(b), Math.cos(b)];
  const rz: Mat3 = [Math.cos(c), -Math.sin(c), 0, Math.sin(c), Math.cos(c), 0, 0, 0, 1];
  return mat3Mul(rz, mat3Mul(rx, ry));
}

export function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function makeCamera(p: CameraParams): Camera {
  const R = rotationMatrix(p.yawDeg, p.pitchDeg, p.rollDeg);
  const cx = p.imageW / 2;
  const cy = p.imageH / 2;
  const K: Mat3 = [p.focalPx, 0, cx, 0, p.focalPx, cy, 0, 0, 1];
  const r1 = mulVec(R, [1, 0, 0]);
  const r2 = mulVec(R, [0, 1, 0]);
  const t = mulVec(R, [-p.position[0], -p.position[1], -p.position[2]]);
  const E: Mat3 = [r1[0], r2[0], t[0], r1[1], r2[1], t[1], r1[2], r2[2], t[2]];
  return { ...p, R, planeToImage: mat3Mul(K, E) };
}

/** Projette un point monde (cm) en pixels distordus (pleine résolution). `null` si derrière la caméra. */
export function projectWorld(cam: Camera, X: Vec3): Pt | null {
  const d: Vec3 = [X[0] - cam.position[0], X[1] - cam.position[1], X[2] - cam.position[2]];
  const c = mulVec(cam.R, d);
  if (c[2] <= 1e-6) return null;
  const u = (cam.focalPx * c[0]) / c[2] + cam.imageW / 2;
  const v = (cam.focalPx * c[1]) / c[2] + cam.imageH / 2;
  return distortPoint({ x: u, y: v }, cam.k1, { w: cam.imageW, h: cam.imageH });
}

/** Point du plan du mur (cm) → pixel distordu. */
export function projectWall(cam: Camera, x: number, y: number): Pt | null {
  return projectWorld(cam, [x, y, 0]);
}

/** Direction (monde) du rayon passant par un pixel distordu. */
export function rayDirection(cam: Camera, p: Pt): Vec3 {
  const u = undistortPoint(p, cam.k1, { w: cam.imageW, h: cam.imageH });
  const dc: Vec3 = [(u.x - cam.imageW / 2) / cam.focalPx, (u.y - cam.imageH / 2) / cam.focalPx, 1];
  // Rᵀ · dc
  const R = cam.R;
  return [
    R[0] * dc[0] + R[3] * dc[1] + R[6] * dc[2],
    R[1] * dc[0] + R[4] * dc[1] + R[7] * dc[2],
    R[2] * dc[0] + R[5] * dc[1] + R[8] * dc[2],
  ];
}

/** Focale en pixels à partir d'une focale équivalente 24 × 36 et du côté long de l'image. */
export function focalPxFromEquiv(focalMmEquiv: number, longSidePx: number): number {
  return (focalMmEquiv / 36) * longSidePx;
}
