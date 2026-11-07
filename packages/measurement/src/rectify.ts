/**
 * Rectification : coins du mur → rectangle ; proportions et échelle fixées par la référence (feuille A4 ou mire)
 * mesurée dans le repère redressé ; contrôles de cohérence ; incertitude propagée (docs/specs/mesure-photo-v1.md §2.3).
 *
 * Géométrie : l'homographie du mur vers le carré unité annule la perspective indépendamment de la position du téléphone ;
 * la référence, coplanaire, y apparaît comme un parallélogramme dont les vecteurs côtés valent
 *   e1 = (a·cosθ / W, a·sinθ / H),  e2 = (−b·sinθ / W, b·cosθ / H)
 * (a × b = taille de la référence, θ = rotation de la feuille dans le plan du mur). On en tire W, H et θ ; la redondance
 * (deux estimations de θ) et un redressement « caméra » indépendant (points de fuite, focale) alimentent les contrôles.
 */
import type { Pt, Quad, ReferenceKind, WallSurvey } from "@wallscan/core";
import {
  A4_CM, CHECK_DISTORTION_PCT, CHECK_OPPOSITE_SIDES_PCT, CHECK_REFERENCE_ASPECT_PCT, CHECK_TRAPEZOID_PCT,
  DISTORTION_RESIDUAL_PCT, FOCAL_SWEEP_MM_EQUIV, MAX_RECTIFIED_WIDTH_PX, MIRE_OUTER_CM, REF_CORNER_SIGMA_PX, REFERENCE_MIN_SIDE_PX,
  WALL_CORNER_SIGMA_PX, WARN,
} from "./constants.js";
import { distortionDisplacementPct, undistortPoint, type ImageSize } from "./distortion.js";
import { applyHomography, applyHomographyToQuad, quadToUnitSquare } from "./homography.js";
import { dist, intersectLinesH, lineThrough, type Mat3 } from "./linalg.js";

export interface RectifyArgs {
  wallQuad: Quad;
  refQuad: Quad;
  /** Taille de la référence telle qu'orientée sur le mur : w = côté horizontal, h = côté vertical (cm). */
  refSizeCm: { w: number; h: number };
  refKind: ReferenceKind;
  k1?: number;
  /** Taille de l'image de travail dans laquelle les quads sont exprimés. */
  imageSize: ImageSize;
  /** Surcharge de l'incertitude (px) sur les coins de la référence (ex. coins affinés sur l'image pleine résolution). */
  refCornerSigmaPx?: number;
  /** Focale en px (EXIF) si connue : renforce le contrôle géométrique. */
  focalPx?: number;
  /** Résidu de distorsion (%) après correction, si mesuré ; défaut 0,3 %. */
  distortionResidualPct?: number;
}

/**
 * Redressement métrique « caméra », indépendant de la référence, pour les contrôles de cohérence.
 * Hypothèses : les arêtes gauche/droite du mur sont d'aplomb, la ligne de sol est horizontale ; la ligne de plafond
 * n'est PAS supposée horizontale (c'est elle qu'on teste). Avec la focale f : point de fuite vertical v_y = gauche ∩ droite,
 * horizon ℓ_h = ω·v_y, point de fuite horizontal v_x = sol ∩ ℓ_h ; le quad redressé a ses verticales parallèles et son sol
 * horizontal ; l'écart entre hauteurs gauche et droite mesure la pente du plafond ou un coin mal placé.
 * La focale est connue (EXIF, ± 5 %) ou balayée sur 22–35 mm équivalent : on retient la valeur la plus favorable
 * (contrôle conservateur : pas de fausse alerte due à une focale inconnue) et la plage de proportions compatibles.
 */
export interface CameraCheck {
  /** Largeur / hauteur du mur à la focale retenue, et plage sur les focales admissibles. */
  aspect: number;
  aspectMin: number;
  aspectMax: number;
  /** Écart relatif entre hauteurs gauche et droite (%) du mur redressé, à la focale la plus favorable. */
  oppositeSidesPct: number;
  /** Hauteurs gauche / droite relatives (moyenne = 1). */
  leftRel: number;
  rightRel: number;
  focalPx: number;
  focalKnown: boolean;
}

type V3 = [number, number, number];
const norm3 = (v: V3): V3 | null => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : null;
};
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

interface FocalRect {
  hL: number;
  hR: number;
  w: number;
}

/** Redresse le quad pour une focale donnée (voir `cameraCheck`). `null` si dégénéré. */
export function rectifyWithFocal(quad: Quad, size: ImageSize, f: number): FocalRect | null {
  const [tl, tr, br, bl] = quad;
  const cx = size.w / 2;
  const cy = size.h / 2;
  const vy = intersectLinesH(lineThrough(tl, bl), lineThrough(tr, br));
  // Horizon des plans perpendiculaires à la verticale : ℓ_h = ω · v_y, ω ∝ [[1,0,−cx],[0,1,−cy],[−cx,−cy,cx²+cy²+f²]].
  const lh: V3 = [vy[0] - cx * vy[2], vy[1] - cy * vy[2], -cx * vy[0] - cy * vy[1] + (cx * cx + cy * cy + f * f) * vy[2]];
  const vx = intersectLinesH(lineThrough(bl, br), lh);
  const dx = norm3([(vx[0] - cx * vx[2]) / f, (vx[1] - cy * vx[2]) / f, vx[2]]);
  const dy = norm3([(vy[0] - cx * vy[2]) / f, (vy[1] - cy * vy[2]) / f, vy[2]]);
  if (!dx || !dy) return null;
  // v_x est sur l'horizon de v_y ⇒ dx ⟂ dy exactement : n et dy2 sont unitaires, jamais nuls.
  const n = cross3(dx, dy);
  const dy2 = cross3(n, dx);
  const R: Mat3 = [dx[0], dx[1], dx[2], dy2[0], dy2[1], dy2[2], n[0], n[1], n[2]];
  const rect: Pt[] = [];
  let sign = 0;
  for (const p of quad) {
    const d: V3 = [(p.x - cx) / f, (p.y - cy) / f, 1];
    const z = R[6] * d[0] + R[7] * d[1] + R[8] * d[2];
    if (Math.abs(z) < 1e-9) return null;
    const s = z > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return null;
    rect.push({ x: (R[0] * d[0] + R[1] * d[1] + R[2] * d[2]) / z, y: (R[3] * d[0] + R[4] * d[1] + R[5] * d[2]) / z });
  }
  const hL = Math.abs(rect[3].y - rect[0].y);
  const hR = Math.abs(rect[2].y - rect[1].y);
  const w = (Math.abs(rect[1].x - rect[0].x) + Math.abs(rect[2].x - rect[3].x)) / 2;
  return { hL, hR, w };
}

export function cameraCheck(quad: Quad, size: ImageSize, focalPx?: number): CameraCheck | null {
  const longSide = Math.max(size.w, size.h);
  const fMin = focalPx !== undefined ? focalPx * 0.95 : (FOCAL_SWEEP_MM_EQUIV.min / 36) * longSide;
  const fMax = focalPx !== undefined ? focalPx * 1.05 : (FOCAL_SWEEP_MM_EQUIV.max / 36) * longSide;
  const steps = 16;
  let aspectMin = Number.POSITIVE_INFINITY;
  let aspectMax = 0;
  type Eval = { f: number; r: FocalRect | null; mismatch: number };
  const evaluate = (f: number): Eval => {
    const r = rectifyWithFocal(quad, size, f);
    if (!r) return { f, r: null, mismatch: Number.POSITIVE_INFINITY };
    const aspect = (2 * r.w) / (r.hL + r.hR);
    aspectMin = Math.min(aspectMin, aspect);
    aspectMax = Math.max(aspectMax, aspect);
    return { f, r, mismatch: (Math.abs(r.hL - r.hR) / ((r.hL + r.hR) / 2)) * 100 };
  };
  let best: Eval = { f: fMin, r: null, mismatch: Number.POSITIVE_INFINITY };
  for (let i = 0; i <= steps; i++) {
    const e = evaluate(fMin * Math.pow(fMax / fMin, i / steps));
    if (e.mismatch < best.mismatch) best = e;
  }
  if (!best.r) return null;
  // Affinage local (section dorée) autour du meilleur pas de grille : l'écart est en V autour de son minimum.
  const ratio = Math.pow(fMax / fMin, 1 / steps);
  let lo = Math.max(fMin, best.f / ratio);
  let hi = Math.min(fMax, best.f * ratio);
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 30; it++) {
    const e1 = evaluate(hi - phi * (hi - lo));
    const e2 = evaluate(lo + phi * (hi - lo));
    if (e1.mismatch < e2.mismatch) hi = e2.f;
    else lo = e1.f;
    const better = e1.mismatch < e2.mismatch ? e1 : e2;
    if (better.mismatch < best.mismatch) best = better;
  }
  const r = best.r as FocalRect; // best n'est remplacé que par une évaluation valide (écart fini)
  const hMean = (r.hL + r.hR) / 2;
  return {
    aspect: r.w / hMean,
    aspectMin,
    aspectMax,
    oppositeSidesPct: best.mismatch,
    leftRel: r.hL / hMean,
    rightRel: r.hR / hMean,
    focalPx: best.f,
    focalKnown: focalPx !== undefined,
  };
}

function degenerateSurvey(refKind: ReferenceKind, warnings: string[]): WallSurvey {
  return {
    widthCm: 0,
    heightCm: 0,
    heightLeftCm: 0,
    heightRightCm: 0,
    uncertaintyPct: 100,
    displayTolerancePct: refKind === "manual_a4" ? 5 : 3,
    reference: refKind,
    scalePxPerCm: 0,
    homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    openings: [],
    baseboard: { enabled: false, heightCm: null, source: null },
    checks: { oppositeSidesPct: 0, referenceAspectPct: 0, distortionPct: 0, warnings },
  };
}

const finiteQuad = (q: Quad): boolean => q.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

/** Rectification complète (sans ouvertures). Jamais d'exception : géométrie invalide → survey nul + `degenerate_geometry`. */
export function rectify(args: RectifyArgs): WallSurvey {
  const { refKind, imageSize } = args;
  const k1 = args.k1 ?? 0;
  const a = args.refSizeCm.w;
  const b = args.refSizeCm.h;
  if (
    !finiteQuad(args.wallQuad) || !finiteQuad(args.refQuad) || !(a > 0) || !(b > 0) || !Number.isFinite(k1) ||
    !(imageSize.w > 0) || !(imageSize.h > 0)
  ) {
    return degenerateSurvey(refKind, [WARN.degenerate]);
  }
  const wallU = args.wallQuad.map((p) => undistortPoint(p, k1, imageSize)) as Quad;
  const refU = args.refQuad.map((p) => undistortPoint(p, k1, imageSize)) as Quad;
  const Hu = quadToUnitSquare(wallU);
  if (!Hu) return degenerateSurvey(refKind, [WARN.degenerate]);
  const r = applyHomographyToQuad(Hu, refU);
  // Vecteurs côtés moyens de la référence dans le carré unité.
  const e1 = { x: (r[1].x - r[0].x + (r[2].x - r[3].x)) / 2, y: (r[1].y - r[0].y + (r[2].y - r[3].y)) / 2 };
  const e2 = { x: (r[3].x - r[0].x + (r[2].x - r[1].x)) / 2, y: (r[3].y - r[0].y + (r[2].y - r[1].y)) / 2 };
  const u = e1.x / a;
  const v = e1.y / a;
  const s = -e2.x / b;
  const c = e2.y / b;
  if (!(u > 1e-9) || !(c > 1e-9)) return degenerateSurvey(refKind, [WARN.degenerate, WARN.referenceOrientation]);
  const theta = (Math.atan2(v, c) + Math.atan2(s, u)) / 2;
  const cosT = Math.cos(theta);
  const widthCm = cosT / u;
  const heightCm = cosT / c;
  if (!(widthCm > 1) || !(heightCm > 1) || !(widthCm < 1e5) || !(heightCm < 1e5)) return degenerateSurvey(refKind, [WARN.degenerate]);
  // Homographie image (non distordue) → cm : mise à l'échelle anisotrope du carré unité.
  const H: Mat3 = [Hu[0] * widthCm, Hu[1] * widthCm, Hu[2] * widthCm, Hu[3] * heightCm, Hu[4] * heightCm, Hu[5] * heightCm, Hu[6], Hu[7], Hu[8]];

  const warnings: string[] = [];
  // Échelle naturelle de l'image redressée : moyenne pondérée des deux échelles apparentes de la référence.
  const refWPx = (dist(refU[0], refU[1]) + dist(refU[3], refU[2])) / 2;
  const refHPx = (dist(refU[0], refU[3]) + dist(refU[1], refU[2])) / 2;
  const sW = refWPx / a;
  const sH = refHPx / b;
  const scalePxPerCm = Math.min((sW * a + sH * b) / (a + b), MAX_RECTIFIED_WIDTH_PX / widthCm);
  if (Math.min(refWPx, refHPx) < REFERENCE_MIN_SIDE_PX) warnings.push(WARN.referenceSmall);

  // Contrôles géométriques indépendants de la référence.
  const cam = cameraCheck(wallU, imageSize, args.focalPx);
  let oppositeSidesPct = 0;
  let referenceAspectPct = 0;
  let heightLeftCm = heightCm;
  let heightRightCm = heightCm;
  if (cam) {
    oppositeSidesPct = cam.oppositeSidesPct;
    // Écart (%) entre les proportions mesurées par la référence et la plage compatible avec la géométrie du quad.
    const aspect = widthCm / heightCm;
    if (aspect < cam.aspectMin) referenceAspectPct = (cam.aspectMin / aspect - 1) * 100;
    else if (aspect > cam.aspectMax) referenceAspectPct = (aspect / cam.aspectMax - 1) * 100;
    if (oppositeSidesPct > CHECK_OPPOSITE_SIDES_PCT) warnings.push(WARN.wallCorners);
    if (oppositeSidesPct > CHECK_TRAPEZOID_PCT) {
      warnings.push(WARN.trapezoid);
      heightLeftCm = heightCm * cam.leftRel;
      heightRightCm = heightCm * cam.rightRel;
    }
    if (referenceAspectPct > CHECK_REFERENCE_ASPECT_PCT) warnings.push(WARN.referenceAspect);
  } else {
    warnings.push(WARN.geometryCheckUnavailable);
  }

  // Distorsion appliquée aux coins du mur (déplacement maximal, %).
  let distortionPct = 0;
  for (const p of args.wallQuad) distortionPct = Math.max(distortionPct, distortionDisplacementPct(p, k1, imageSize));
  if (distortionPct > CHECK_DISTORTION_PCT) warnings.push(WARN.distortionHigh);

  // Incertitude propagée (somme quadratique), par axe, puis la plus défavorable.
  const sigmaRef = args.refCornerSigmaPx ?? REF_CORNER_SIGMA_PX[refKind];
  const wallWPx = (dist(wallU[0], wallU[1]) + dist(wallU[3], wallU[2])) / 2;
  const wallHPx = (dist(wallU[0], wallU[3]) + dist(wallU[1], wallU[2])) / 2;
  const residual = (args.distortionResidualPct ?? DISTORTION_RESIDUAL_PCT) / 100;
  const uW = Math.hypot(sigmaRef / refWPx, WALL_CORNER_SIGMA_PX / wallWPx, residual) * 100;
  const uH = Math.hypot(sigmaRef / refHPx, WALL_CORNER_SIGMA_PX / wallHPx, residual) * 100;
  const uncertaintyPct = Math.max(uW, uH);
  const displayTolerancePct: 3 | 5 = refKind === "manual_a4" ? 5 : 3;
  if (uncertaintyPct > displayTolerancePct) warnings.push(WARN.uncertaintyHigh);

  const survey: WallSurvey = {
    widthCm,
    heightCm,
    heightLeftCm,
    heightRightCm,
    uncertaintyPct,
    displayTolerancePct,
    reference: refKind,
    scalePxPerCm,
    homography: H,
    openings: [],
    baseboard: { enabled: false, heightCm: null, source: null },
    checks: { oppositeSidesPct, referenceAspectPct, distortionPct, warnings },
    imageSize: { w: imageSize.w, h: imageSize.h },
  };
  if (k1 !== 0) survey.distortionK1 = k1;
  return survey;
}

/** Point de l'image de travail (coordonnées distordues) → plan du mur (cm) via le survey. */
export function imageToWallCm(survey: WallSurvey, p: Pt, imageSize?: ImageSize): Pt {
  const size = imageSize ?? survey.imageSize;
  const u = size ? undistortPoint(p, survey.distortionK1 ?? 0, size) : p;
  return applyHomography(survey.homography, u);
}

/** Taille de la référence telle qu'orientée sur le mur (portrait ou paysage) d'après la géométrie de son quad. */
export function referenceSizeCm(kind: ReferenceKind, quad: Quad): { w: number; h: number } {
  const nominal = kind === "mire" ? MIRE_OUTER_CM : A4_CM;
  const horiz = dist(quad[0], quad[1]) + dist(quad[3], quad[2]);
  const vert = dist(quad[0], quad[3]) + dist(quad[1], quad[2]);
  return horiz > vert ? { w: nominal.h, h: nominal.w } : { w: nominal.w, h: nominal.h };
}
