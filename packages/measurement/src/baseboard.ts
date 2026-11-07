/**
 * Plinthes : hauteur TOUJOURS réelle — mesurée sur la photo (point tapé → aimantation → homographie), proposée
 * automatiquement (deux lignes basses parallèles dans l'image redressée) ou saisie. Jamais de valeur par défaut :
 * `applyBaseboard` sans hauteur → avertissement `baseboard_height_required` et aucune réduction.
 */
import type { BaseboardSource, GrayImage, Pt, WallSurvey } from "@wallscan/core";
import { WARN } from "./constants.js";
import { noiseSigma } from "./image.js";
import { imageToWallCm } from "./rectify.js";

export interface BaseboardProposal {
  heightCm: number;
  confidence: number;
  /** Fraction de la largeur où l'arête est visible. */
  coverage: number;
}

export interface HorizontalStep {
  /** Ordonnée sous-pixel du bord (px). */
  y: number;
  coverage: number;
  contrast: number;
}

/**
 * Ligne de marche horizontale la plus nette entre les lignes yMin et yMax (incluses) d'une image redressée :
 * dérivée verticale moyenne par ligne, couverture = fraction des colonnes où le bord est présent avec le même signe.
 * `null` si aucune ligne ne couvre au moins `minCoverage` de la largeur avec un contraste suffisant.
 */
export function findHorizontalStep(img: GrayImage, yMin: number, yMax: number, minCoverage = 0.5): HorizontalStep | null {
  const w = img.width;
  const h = img.height;
  const y0 = Math.max(1, Math.floor(yMin));
  const y1 = Math.min(h - 2, Math.ceil(yMax));
  if (y1 - y0 < 2 || w < 20) return null;
  const x0 = Math.floor(w * 0.05);
  const x1 = Math.ceil(w * 0.95);
  const cols = x1 - x0;
  const d = img.data;
  const noise = noiseSigma(img);
  const minCol = Math.max(4, 3 * noise);
  const rowDiff = (y: number): number => {
    let s = 0;
    for (let x = x0; x < x1; x++) s += d[(y + 1) * w + x] - d[(y - 1) * w + x];
    return s / cols;
  };
  let bestY = -1;
  let bestScore = 0;
  let bestSign = 0;
  let bestCoverage = 0;
  let bestMean = 0;
  const rowMean = (y: number): number => {
    const yy = Math.max(0, Math.min(h - 1, y));
    let s = 0;
    for (let x = x0; x < x1; x++) s += d[yy * w + x];
    return s / cols;
  };
  for (let y = y0; y <= y1; y++) {
    const mean = rowDiff(y);
    const sign = mean >= 0 ? 1 : -1;
    let covered = 0;
    for (let x = x0; x < x1; x++) {
      const diff = (d[(y + 1) * w + x] - d[(y - 1) * w + x]) * sign;
      if (diff >= minCol && diff >= 0.4 * Math.abs(mean)) covered++;
    }
    const coverage = covered / cols;
    const score = Math.abs(mean) * coverage;
    // Une barre (joint sombre ou clair) a deux bords de signes opposés : la marche entre y − 4 et y + 4 doit subsister.
    const isStep = Math.abs(rowMean(y + 4) - rowMean(y - 4)) >= 0.6 * Math.abs(mean);
    if (coverage >= minCoverage && isStep && score > bestScore) {
      bestScore = score;
      bestY = y;
      bestSign = sign;
      bestCoverage = coverage;
      bestMean = Math.abs(mean);
    }
  }
  if (bestY < 0 || bestMean < Math.max(3, 2 * noise)) return null;
  // Sous-pixel : parabole sur la dérivée des lignes voisines (signe cohérent).
  const signed = (y: number): number => rowDiff(y) * bestSign;
  const ya = signed(bestY - 1);
  const yb = bestMean;
  const yc = signed(bestY + 1);
  const den = ya - 2 * yb + yc;
  const offset = den < -1e-9 ? Math.max(-1, Math.min(1, (0.5 * (ya - yc)) / den)) : 0;
  return { y: bestY + 0.5 + offset, coverage: bestCoverage, contrast: bestMean };
}

/**
 * Cherche le haut de plinthe dans la bande [3 ; 25] cm au-dessus du sol de l'image redressée : ligne horizontale de
 * fort contraste couvrant au moins la moitié de la largeur (une porte peut l'interrompre). `null` si rien de net.
 */
export function proposeBaseboard(rectified: GrayImage, scalePxPerCm: number, survey: WallSurvey): BaseboardProposal | null {
  const h = rectified.height;
  if (!(scalePxPerCm > 0) || rectified.width < 20 || h < 20 || !(survey.heightCm > 0)) return null;
  const floorY = Math.min(h, Math.round(survey.heightCm * scalePxPerCm));
  const yMin = Math.max(2, floorY - Math.round(25 * scalePxPerCm));
  const yMax = Math.min(h - 3, floorY - Math.max(2, Math.round(3 * scalePxPerCm)));
  const step = findHorizontalStep(rectified, yMin, yMax, 0.5);
  if (!step) return null;
  const heightCm = (floorY - step.y) / scalePxPerCm;
  const confidence = Math.max(0, Math.min(1, 0.5 * step.coverage + 0.5 * Math.min(1, step.contrast / 12)));
  return { heightCm, confidence, coverage: step.coverage };
}

/**
 * Haut de plinthe tapé sur la photo (coordonnées de l'image de travail) → hauteur en cm par l'homographie.
 * Incertitude : 2 px locaux + incertitude relative du survey.
 */
export function measureBaseboard(survey: WallSurvey, pointInImage: Pt): { heightCm: number; uncertaintyCm: number } {
  const p = imageToWallCm(survey, pointInImage);
  const q = imageToWallCm(survey, { x: pointInImage.x, y: pointInImage.y + 1 });
  const cmPerPx = Math.hypot(q.x - p.x, q.y - p.y);
  const raw = survey.heightCm - p.y;
  const heightCm = Math.max(0, Math.min(survey.heightCm, raw));
  const uncertaintyCm = Math.hypot(2 * cmPerPx, (heightCm * survey.uncertaintyPct) / 100);
  return { heightCm, uncertaintyCm };
}

/**
 * Active / désactive l'option plinthes avec une hauteur réelle. Hauteur absente ou invalide avec `enabled` →
 * option laissée inactive + avertissement `baseboard_height_required`. Retourne un nouveau survey (immutabilité).
 */
export function applyBaseboard(survey: WallSurvey, enabled: boolean, heightCm: number | null, source: BaseboardSource | null): WallSurvey {
  const warnings = survey.checks.warnings.filter((w) => w !== WARN.baseboardHeightRequired);
  const valid = heightCm !== null && Number.isFinite(heightCm) && heightCm > 0 && heightCm < survey.heightCm;
  if (enabled && !valid) {
    warnings.push(WARN.baseboardHeightRequired);
    return { ...survey, baseboard: { enabled: false, heightCm: null, source: null }, checks: { ...survey.checks, warnings } };
  }
  return {
    ...survey,
    baseboard: { enabled, heightCm: valid ? heightCm : null, source: valid ? source : null },
    checks: { ...survey.checks, warnings },
  };
}

/** Hauteur utile pour le papier : hauteur du mur moins la plinthe si l'option est active (hauteur réelle connue). */
export function usableHeightCm(survey: WallSurvey): number {
  const b = survey.baseboard;
  return b.enabled && b.heightCm !== null ? survey.heightCm - b.heightCm : survey.heightCm;
}
