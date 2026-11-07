import type { Pt, Quad } from "@wallscan/core";
import { focalPxFromEquiv, makeCamera, projectWall, type Camera, type CameraParams } from "../bench/camera.js";

export interface TestScene {
  cam: Camera;
  /** Facteur image pleine résolution → image de travail. */
  factor: number;
  work: { w: number; h: number };
  wallQuad: Quad;
  refQuad: Quad;
  refSizeCm: { w: number; h: number };
  W: number;
  H: number;
}

/** Scène de test : mur W × H, référence centrée à hauteur des yeux, caméra paramétrable, quads parfaits (coordonnées de travail). */
export function makeTestScene(opts: Partial<CameraParams> & { W?: number; H?: number; ref?: { w: number; h: number }; factor?: number } = {}): TestScene {
  const W = opts.W ?? 400;
  const H = opts.H ?? 250;
  const imageW = opts.imageW ?? 4000;
  const imageH = opts.imageH ?? 3000;
  const cam = makeCamera({
    imageW,
    imageH,
    focalPx: opts.focalPx ?? focalPxFromEquiv(26, Math.max(imageW, imageH)),
    k1: opts.k1 ?? 0,
    position: opts.position ?? [W / 2, H * 0.6, -380],
    yawDeg: opts.yawDeg ?? 0,
    pitchDeg: opts.pitchDeg ?? 0,
    rollDeg: opts.rollDeg ?? 0,
  });
  const factor = opts.factor ?? 2;
  const ref = opts.ref ?? { w: 21, h: 29.7 };
  const toWork = (x: number, y: number): Pt => {
    const p = projectWall(cam, x, y);
    if (!p) throw new Error("point derrière la caméra (scène de test invalide)");
    return { x: p.x / factor, y: p.y / factor };
  };
  const quadOf = (x: number, y: number, w: number, h: number): Quad => [toWork(x, y), toWork(x + w, y), toWork(x + w, y + h), toWork(x, y + h)];
  const rx = W / 2 - ref.w / 2;
  const ry = H - 160 - ref.h / 2;
  return {
    cam,
    factor,
    work: { w: imageW / factor, h: imageH / factor },
    wallQuad: quadOf(0, 0, W, H),
    refQuad: quadOf(rx, ry, ref.w, ref.h),
    refSizeCm: ref,
    W,
    H,
  };
}

export const pctErr = (est: number, truth: number): number => (Math.abs(est - truth) / truth) * 100;
