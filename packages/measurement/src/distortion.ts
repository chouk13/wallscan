/**
 * Distorsion radiale, modèle de division à un coefficient (Fitzgibbon) :
 *   p_u = c + (p_d − c) / (1 + k1 · r_d²),   r_d = |p_d − c| / R,   R = demi-diagonale de l'image.
 * k1 < 0 : barillet (|p_u − c| = |p_d − c| / (1 + k1·r²) > |p_d − c| : les bords sont contractés dans l'image distordue,
 * cas des grands-angles et ultra grand-angles) ; k1 > 0 : coussinet. k1 ∈ [−0,02 ; 0,02] couvre les téléphones hors ultra
 * grand-angle (≈ 2 % de déplacement maximal dans les coins). (Correction du 2026-11-08 : la v1 disait l'inverse.)
 */
import type { Pt } from "@wallscan/core";

export interface ImageSize {
  w: number;
  h: number;
}

export interface DistortionFrame {
  cx: number;
  cy: number;
  /** Rayon de normalisation (demi-diagonale). */
  r: number;
}

export function distortionFrame(size: ImageSize): DistortionFrame {
  const cx = size.w / 2;
  const cy = size.h / 2;
  return { cx, cy, r: Math.max(1e-9, Math.hypot(cx, cy)) };
}

/** Coordonnées distordues (image réelle) → coordonnées non distordues (sténopé idéal). */
export function undistortPoint(p: Pt, k1: number, size: ImageSize): Pt {
  if (k1 === 0) return { x: p.x, y: p.y };
  const f = distortionFrame(size);
  const dx = (p.x - f.cx) / f.r;
  const dy = (p.y - f.cy) / f.r;
  const d = 1 + k1 * (dx * dx + dy * dy);
  return { x: f.cx + (dx / d) * f.r, y: f.cy + (dy / d) * f.r };
}

/**
 * Coordonnées non distordues → distordues (inverse du modèle de division), par itérations de Newton sur le rayon.
 * Converge en quelques itérations pour |k1| ≤ 0,1 dans le champ de l'image.
 */
export function distortPoint(p: Pt, k1: number, size: ImageSize): Pt {
  if (k1 === 0) return { x: p.x, y: p.y };
  const f = distortionFrame(size);
  const ux = (p.x - f.cx) / f.r;
  const uy = (p.y - f.cy) / f.r;
  const ru = Math.hypot(ux, uy);
  if (ru < 1e-12) return { x: p.x, y: p.y };
  let rd = ru;
  for (let i = 0; i < 12; i++) {
    const den = 1 + k1 * rd * rd;
    const g = rd / den - ru;
    const dg = (1 - k1 * rd * rd) / (den * den);
    if (Math.abs(dg) < 1e-12) break;
    const step = g / dg;
    rd -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  const s = rd / ru;
  return { x: f.cx + ux * s * f.r, y: f.cy + uy * s * f.r };
}

/** Déplacement radial relatif (en %) induit par k1 au point p : |p_u − p_d| / |p_d − c|. */
export function distortionDisplacementPct(p: Pt, k1: number, size: ImageSize): number {
  const f = distortionFrame(size);
  const r2 = ((p.x - f.cx) ** 2 + (p.y - f.cy) ** 2) / (f.r * f.r);
  return Math.abs(1 / (1 + k1 * r2) - 1) * 100;
}
