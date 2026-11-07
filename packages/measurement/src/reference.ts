/**
 * Détection de la référence d'échelle : feuille A4 (quadrilatère clair à fort contraste local) ou mire WallScan
 * (cadre noir épais à intérieur clair, code d'orientation / identifiant), affinage sous-pixel des 4 coins.
 */
import type { GrayImage, Pt, Quad, ReferenceKind } from "@wallscan/core";
import { A4_CM, decodeMireCells, MIRE_LAYOUT, MIRE_OUTER_CM } from "./constants.js";
import { applyHomography, homographyFromPoints, rectQuad } from "./homography.js";
import { bilinear, boxMean, integralImage, noiseSigma } from "./image.js";
import { dist } from "./linalg.js";
import { findEdgeAlongNormal, innerNormal, refineCornersDetailed } from "./refine.js";
import { adaptiveMask, connectedComponents, convexHull, polygonArea, quadCenter, quadFromHull, quadSides, type Component } from "./segment.js";

export interface ReferenceDetection {
  kind: "mire" | "a4";
  quad: Quad;
  confidence: number;
  code?: number;
}

export interface ReferenceHint {
  kind?: ReferenceKind;
  near?: Pt;
}

interface Candidate {
  quad: Quad;
  comp: Component;
  fill: number;
  hullFill: number;
  aspect: number;
  longPx: number;
}

/** Candidats quadrilatères issus d'un masque, filtrés sur la taille et la convexité. */
function candidatesFromMask(mask: Uint8Array, w: number, h: number, minSide: number, maxSide: number): Candidate[] {
  const comps = connectedComponents(mask, w, h, Math.max(16, minSide * minSide * 0.3), maxSide);
  const out: Candidate[] = [];
  for (const comp of comps) {
    const bw = comp.maxX - comp.minX + 1;
    const bh = comp.maxY - comp.minY + 1;
    if (Math.max(bw, bh) < minSide) continue;
    const hull = convexHull(comp.boundary);
    const quad = quadFromHull(hull);
    if (!quad) continue;
    const quadArea = polygonArea(quad);
    const hullArea = polygonArea(hull);
    const sides = quadSides(quad);
    const short = Math.min(sides.w, sides.h);
    const long = Math.max(sides.w, sides.h);
    if (!(short > 2)) continue;
    out.push({ quad, comp, fill: comp.area / quadArea, hullFill: quadArea / Math.max(hullArea, 1e-9), aspect: long / short, longPx: long });
  }
  return out;
}

/**
 * Objet encadré ? Pour chaque côté, cherche une seconde arête vers l'extérieur entre 5 % et 30 % de la longueur du côté
 * (cadre de fenêtre, cadre noir de la mire, baguette d'un tableau). Une feuille posée sur le mur n'en a pas.
 */
export function isFramed(img: GrayImage, quad: Quad, minStrength: number): boolean {
  let framedSides = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const len = dist(a, b);
    const nIn = innerNormal(a, b);
    const nOut = { x: -nIn.x, y: -nIn.y };
    // Fenêtre de recherche [max(4 px, 5 %) ; 30 %] du côté : au-delà de la traîne de la propre arête du quad.
    const minOff = Math.max(4, 0.05 * len);
    const center = (minOff + 0.3 * len) / 2;
    const radius = (0.3 * len - minOff) / 2;
    let hits = 0;
    for (let k = 1; k <= 5; k++) {
      const t = k / 6;
      const s = { x: a.x + (b.x - a.x) * t + nOut.x * center, y: a.y + (b.y - a.y) * t + nOut.y * center };
      if (findEdgeAlongNormal(img, s, nOut, radius, 0, minStrength)) hits++;
    }
    if (hits >= 3) framedSides++;
  }
  return framedSides >= 3;
}

/**
 * Structure intérieure ? Une feuille est uniforme ; une fenêtre à cadre clair (cadre + vitrage fusionnés dans le masque)
 * a une arête intérieure parallèle à chaque côté (cadre → vitre) entre 5 % et 30 % du côté.
 */
export function hasInnerFrame(img: GrayImage, quad: Quad, minStrength: number): boolean {
  let sides = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const len = dist(a, b);
    const nIn = innerNormal(a, b);
    const minOff = Math.max(4, 0.05 * len);
    const center = (minOff + 0.3 * len) / 2;
    const radius = (0.3 * len - minOff) / 2;
    let hits = 0;
    for (let k = 1; k <= 5; k++) {
      const t = k / 6;
      const s = { x: a.x + (b.x - a.x) * t + nIn.x * center, y: a.y + (b.y - a.y) * t + nIn.y * center };
      if (findEdgeAlongNormal(img, s, nIn, radius, 0, minStrength)) hits++;
    }
    if (hits >= 3) sides++;
  }
  return sides >= 3;
}

/** Score de proximité à un point (1 au point, décroît avec la distance relative à la diagonale de l'image). */
function proximityScore(q: Quad, near: Pt | undefined, w: number, h: number): number {
  if (!near) return 1;
  const c = quadCenter(q);
  const d = dist(c, near) / Math.hypot(w, h);
  return Math.max(0.2, 1 - d * 2);
}

/** Décodage de la mire sur un quad (ordre image) : essaie les 4 orientations. */
export function decodeMire(img: GrayImage, quad: Quad): { code: number; contrast: number; orientation: number } | null {
  const L = MIRE_LAYOUT;
  const fw = L.frameW;
  const fh = L.frameH;
  const frameRect = rectQuad(fw, fh);
  for (let k = 0; k < 4; k++) {
    const target: Quad = [quad[k % 4], quad[(k + 1) % 4], quad[(k + 2) % 4], quad[(k + 3) % 4]];
    const H = homographyFromPoints(frameRect, target);
    if (!H) return null;
    const sample = (x: number, y: number): number => {
      const p = applyHomography(H, { x, y });
      return bilinear(img, p.x, p.y);
    };
    const dark: number[] = [];
    const bright: number[] = [];
    // Ligne médiane du cadre (épaisseur 1 cm → à 0,5 cm du bord extérieur), 4 côtés × 5 points.
    const t = L.frameT / 2;
    for (let i = 1; i <= 5; i++) {
      const u = i / 6;
      dark.push(sample(u * fw, t), sample(u * fw, fh - t), sample(t, u * fh), sample(fw - t, u * fh));
      // Marge blanche de la feuille (0,5 cm à l'extérieur) et couronne blanche intérieure (1,5 cm à l'intérieur).
      bright.push(sample(u * fw, -0.5), sample(u * fw, fh + 0.5), sample(-0.5, u * fh), sample(fw + 0.5, u * fh));
      bright.push(sample(u * fw, 1.5), sample(u * fw, fh - 1.5), sample(1.5, u * fh), sample(fw - 1.5, u * fh));
    }
    // Carrés de repère (centres).
    const ci = L.cornerInset + L.cornerSquare / 2;
    dark.push(sample(ci, ci), sample(fw - ci, ci), sample(fw - ci, fh - ci), sample(ci, fh - ci));
    const meanDark = dark.reduce((s, v) => s + v, 0) / dark.length;
    const meanBright = bright.reduce((s, v) => s + v, 0) / bright.length;
    const contrast = meanBright - meanDark;
    if (contrast < 40) continue;
    const thr = (meanDark + meanBright) / 2;
    let bad = 0;
    for (const v of dark) if (v > thr) bad++;
    for (const v of bright) if (v < thr) bad++;
    if (bad > 2) continue;
    // Code 4 × 4.
    const n = L.codeCells;
    const cell = L.codeCell;
    const gx0 = fw / 2 - (n * cell) / 2;
    const gy0 = fh / 2 - (n * cell) / 2;
    const cells: boolean[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) cells.push(sample(gx0 + (c + 0.5) * cell, gy0 + (r + 0.5) * cell) < thr);
    const code = decodeMireCells(cells);
    if (code === null) continue;
    return { code, contrast, orientation: k };
  }
  return null;
}

/**
 * Détecte la référence : mire (prioritaire, validée par son code) puis feuille A4. Retourne les coins affinés en
 * sous-pixel dans l'ordre image (TL, TR, BR, BL), ou `null` (échec signalé, jamais de fausse détection silencieuse).
 */
export function detectReference(img: GrayImage, hint: ReferenceHint = {}): ReferenceDetection | null {
  const w = img.width;
  const h = img.height;
  if (w < 32 || h < 32) return null;
  const longSide = Math.max(w, h);
  const minSide = Math.max(10, longSide * 0.008);
  const maxSide = longSide * 0.125;
  const noise = noiseSigma(img);
  const window = Math.floor(Math.min(w, h) * 0.25) | 1;
  const wantMire = hint.kind === undefined || hint.kind === "mire";
  const wantA4 = hint.kind === undefined || hint.kind === "a4" || hint.kind === "manual_a4";
  const integral = integralImage(img);

  if (wantMire) {
    // Fenêtre locale de l'ordre de la mire : sur un mur sombre, une grande fenêtre (plafond, murs clairs) rendrait tout le
    // mur « sombre » et absorberait le cadre noir dans une composante géante.
    const windowDark = Math.max(31, Math.floor(Math.min(w, h) * 0.07)) | 1;
    const mask = adaptiveMask(img, windowDark, Math.max(20, 5 * noise), false);
    const cands = candidatesFromMask(mask, w, h, minSide, maxSide).filter((c) => c.fill > 0.08 && c.fill < 0.6 && c.hullFill > 0.85);
    const nominal = MIRE_OUTER_CM.h / MIRE_OUTER_CM.w;
    const found: Array<{ score: number; quad: Quad; code: number; contrast: number }> = [];
    for (const c of cands) {
      if (Math.abs(c.aspect / nominal - 1) > 0.16) continue;
      const refined = refineCornersDetailed(img, c.quad, { radiusPx: 4, maxSamples: 48, polarity: -1 });
      const decoded = decodeMire(img, refined.quad);
      if (!decoded) continue;
      const score = Math.min(1, decoded.contrast / 120) * proximityScore(c.quad, hint.near, w, h);
      found.push({ score, quad: refined.quad, code: decoded.code, contrast: decoded.contrast });
    }
    found.sort((a, b) => b.score - a.score);
    const best = found[0];
    if (best) {
      const sides = quadSides(best.quad);
      const sizeScore = Math.min(1, Math.min(sides.w, sides.h) / 40);
      return { kind: "mire", quad: best.quad, confidence: Math.min(1, 0.6 + 0.3 * sizeScore + 0.1 * Math.min(1, best.contrast / 150)), code: best.code };
    }
  }

  if (wantA4) {
    const mask = adaptiveMask(img, window, Math.max(5, 2.5 * noise), true);
    const cands = candidatesFromMask(mask, w, h, minSide, maxSide).filter((c) => c.fill > 0.8 && c.hullFill > 0.9);
    const nominal = A4_CM.h / A4_CM.w;
    const found: Array<{ score: number; quad: Quad; aspectErr: number; contrast: number }> = [];
    for (const c of cands) {
      const aspectErr = Math.abs(c.aspect / nominal - 1);
      if (aspectErr > 0.14) continue;
      const refined = refineCornersDetailed(img, c.quad, { radiusPx: 4, maxSamples: 48, polarity: 1 });
      const q = refined.quad;
      if (isFramed(img, q, Math.max(6, 3 * noise)) || hasInnerFrame(img, q, Math.max(6, 3 * noise))) continue;
      const sides = quadSides(q);
      // Contraste : intérieur (boîte réduite) contre anneau extérieur.
      const center = quadCenter(q);
      const hw = Math.max(2, sides.w * 0.3);
      const hh = Math.max(2, sides.h * 0.3);
      const inside = boxMean(integral, w, h, Math.round(center.x - hw), Math.round(center.y - hh), Math.round(center.x + hw), Math.round(center.y + hh));
      const ow = sides.w * 0.75;
      const oh = sides.h * 0.75;
      const outerBox = boxMean(integral, w, h, Math.round(center.x - ow), Math.round(center.y - oh), Math.round(center.x + ow), Math.round(center.y + oh));
      const innerFullArea = 4 * (sides.w / 2) * (sides.h / 2);
      const outerArea = 4 * ow * oh;
      const innerFull = boxMean(integral, w, h, Math.round(center.x - sides.w / 2), Math.round(center.y - sides.h / 2), Math.round(center.x + sides.w / 2), Math.round(center.y + sides.h / 2));
      const ring = (outerBox * outerArea - innerFull * innerFullArea) / Math.max(1, outerArea - innerFullArea);
      const contrast = Math.max(0, inside - ring);
      const brightness = Math.min(1, Math.max(0, (inside - 150) / 90));
      const refinedSides = refined.sides.filter((s) => s.refined).length;
      const score =
        (1 - aspectErr / 0.14) * 0.35 + Math.min(1, contrast / 60) * 0.25 + brightness * 0.2 + (refinedSides / 4) * 0.2;
      found.push({ score: score * proximityScore(q, hint.near, w, h), quad: q, aspectErr, contrast });
    }
    found.sort((a, b) => b.score - a.score);
    const best = found[0];
    if (best) {
      const sides = quadSides(best.quad);
      const sizeScore = Math.min(1, Math.min(sides.w, sides.h) / 40);
      const confidence = Math.min(1, 0.35 + 0.3 * sizeScore + 0.2 * Math.min(1, best.contrast / 60) + 0.15 * (1 - best.aspectErr / 0.14));
      return { kind: "a4", quad: best.quad, confidence };
    }
  }
  return null;
}
