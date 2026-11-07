/**
 * Proposition des 4 coins du mur : Sobel → arêtes → Hough probabiliste → chaînes de segments quasi colinéaires →
 * lignes dominantes quasi horizontales (plafond, sol) et quasi verticales (angles) autour d'un point intérieur
 * (la référence) → intersections → quad, affiné en sous-pixel sur l'image de travail.
 */
import type { GrayImage, Pt, Quad } from "@wallscan/core";
import { cannyLite, houghSegments, type Segment } from "./edges.js";
import { bilinear, downsampleBox, noiseSigma } from "./image.js";
import { dist, fitLineTLS, intersectLinesH, lineFromPointDir, pointLineDistance } from "./linalg.js";
import { findEdgeAlongNormal, fitLineRobust, refineCornersDetailed } from "./refine.js";

export type WallLineKind = "ceiling" | "floor" | "left" | "right";

export interface WallLine {
  a: Pt;
  b: Pt;
  kind: WallLineKind;
}

export interface WallCornersProposal {
  quad: Quad;
  confidence: number;
  lines: WallLine[];
}

export interface WallCornersHint {
  /** Point connu à l'intérieur du mur (centre de la référence). Défaut : centre de l'image. */
  inside?: Pt;
}

export interface Chain {
  segments: Segment[];
  p: Pt;
  d: Pt;
  /** Extrémités (projection min / max sur d). */
  tMin: number;
  tMax: number;
  length: number;
  horizontal: boolean;
  contrast: number;
  /** Propreté de la bande intérieure (0–1). */
  clean: number;
}

const angleDiff = (a: number, b: number): number => {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
};

function refitChain(c: Chain): void {
  // Droite ajustée sur tous les pixels d'arête des segments (TLS), bien plus précise que les seules extrémités.
  const pts: Pt[] = [];
  for (const s of c.segments) {
    pts.push(s.a, s.b);
    for (const q of s.pixels) pts.push(q);
  }
  const fit = fitLineTLS(pts) as { p: Pt; d: Pt }; // ≥ 2 points distincts par construction (segments de longueur ≥ minLength)
  c.p = fit.p;
  c.d = fit.d;
  let tMin = Number.POSITIVE_INFINITY;
  let tMax = Number.NEGATIVE_INFINITY;
  let len = 0;
  for (const s of c.segments) {
    for (const q of [s.a, s.b]) {
      const t = (q.x - c.p.x) * c.d.x + (q.y - c.p.y) * c.d.y;
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }
    len += dist(s.a, s.b);
  }
  c.tMin = tMin;
  c.tMax = tMax;
  c.length = Math.min(len, tMax - tMin);
}

/** Regroupe les segments quasi colinéaires (angle < 3°, distance < tol px, trou < maxGap) en chaînes. */
export function chainSegments(segments: Segment[], tol: number, maxGap: number): Chain[] {
  const sorted = segments.slice().sort((a, b) => dist(b.a, b.b) - dist(a.a, a.b));
  const chains: Chain[] = [];
  for (const s of sorted) {
    const ang = s.angle;
    const horizontal = angleDiff(ang, 0) <= (35 * Math.PI) / 180;
    const vertical = angleDiff(ang, Math.PI / 2) <= (35 * Math.PI) / 180;
    if (!horizontal && !vertical) continue;
    let target: Chain | null = null;
    for (const c of chains) {
      if (c.horizontal !== horizontal) continue;
      const cAng = Math.atan2(c.d.y, c.d.x);
      if (angleDiff(cAng, ang) > (2 * Math.PI) / 180) continue;
      const line = lineFromPointDir(c.p, c.d);
      if (Math.abs(pointLineDistance(line, s.a)) > tol || Math.abs(pointLineDistance(line, s.b)) > tol) continue;
      const ta = (s.a.x - c.p.x) * c.d.x + (s.a.y - c.p.y) * c.d.y;
      const tb = (s.b.x - c.p.x) * c.d.x + (s.b.y - c.p.y) * c.d.y;
      const lo = Math.min(ta, tb);
      const hi = Math.max(ta, tb);
      const gap = Math.max(0, Math.max(lo - c.tMax, c.tMin - hi));
      if (gap > maxGap) continue;
      // Deux morceaux d'une même droite ne se recouvrent pas : un recouvrement notable = droite parallèle voisine.
      const overlap = Math.min(hi, c.tMax) - Math.max(lo, c.tMin);
      if (overlap > 0.2 * Math.min(hi - lo, c.tMax - c.tMin)) continue;
      target = c;
      break;
    }
    if (target) {
      target.segments.push(s);
      refitChain(target);
    } else {
      const c: Chain = { segments: [s], p: s.a, d: { x: 0, y: 0 }, tMin: 0, tMax: 0, length: 0, horizontal, contrast: 0, clean: 1 };
      refitChain(c);
      chains.push(c);
    }
  }
  return chains;
}

/**
 * Contraste de marche d'une chaîne : différence d'intensité entre les deux côtés (±off px) le long de son étendue.
 * Retourne la médiane des |différences| signées de façon cohérente ; une ligne « barre » (centre plus sombre ou plus
 * clair que les deux côtés : joint de lames, câble) ou une marche incohérente (< 75 % des échantillons) vaut 0.
 */
export function stepContrast(img: GrayImage, c: Chain, off: number, minContrast: number): number {
  const n = { x: -c.d.y, y: c.d.x };
  const k = 16;
  const diffs: number[] = [];
  let bars = 0;
  for (let i = 0; i < k; i++) {
    const t = c.tMin + ((c.tMax - c.tMin) * (i + 0.5)) / k;
    const x = c.p.x + c.d.x * t;
    const y = c.p.y + c.d.y * t;
    const a = bilinear(img, x + n.x * off, y + n.y * off);
    const b = bilinear(img, x - n.x * off, y - n.y * off);
    const mid = bilinear(img, x, y);
    // Barre : les deux côtés se valent et le centre diffère (joint, câble) ; une marche avec un joint sombre n'est pas une barre.
    if (Math.abs(a - b) < minContrast && (mid < Math.min(a, b) - 3 || mid > Math.max(a, b) + 3)) bars++;
    diffs.push(a - b);
  }
  if (bars > k / 2) return 0;
  let pos = 0;
  let neg = 0;
  for (const d of diffs) {
    if (d >= minContrast) pos++;
    else if (d <= -minContrast) neg++;
  }
  const sign = pos >= neg ? 1 : -1;
  if (Math.max(pos, neg) < 0.7 * k) return 0;
  const signed = diffs.map((d) => d * sign).sort((a, b) => a - b);
  return Math.max(0, signed[Math.floor(signed.length / 2)]);
}

/** Recale la droite d'une chaîne sur l'arête la plus forte à ±3 px (échantillons le long de l'étendue, ajustement robuste). */
export function refineChainLine(img: GrayImage, c: Chain, minStrength: number): void {
  const n = { x: -c.d.y, y: c.d.x };
  const k = 24;
  const pts: Pt[] = [];
  for (let i = 0; i < k; i++) {
    const t = c.tMin + ((c.tMax - c.tMin) * (i + 0.5)) / k;
    const e = findEdgeAlongNormal(img, { x: c.p.x + c.d.x * t, y: c.p.y + c.d.y * t }, n, 2, 0, minStrength);
    if (e) pts.push(e.p);
  }
  const fit = fitLineRobust(pts, 8);
  if (!fit) return;
  // Conserve l'étendue : projection des anciennes extrémités sur la nouvelle droite.
  const ends = [
    { x: c.p.x + c.d.x * c.tMin, y: c.p.y + c.d.y * c.tMin },
    { x: c.p.x + c.d.x * c.tMax, y: c.p.y + c.d.y * c.tMax },
  ];
  const d = fit.d.x * c.d.x + fit.d.y * c.d.y >= 0 ? fit.d : { x: -fit.d.x, y: -fit.d.y };
  c.p = fit.p;
  c.d = d;
  const t0 = (ends[0].x - c.p.x) * c.d.x + (ends[0].y - c.p.y) * c.d.y;
  const t1 = (ends[1].x - c.p.x) * c.d.x + (ends[1].y - c.p.y) * c.d.y;
  c.tMin = Math.min(t0, t1);
  c.tMax = Math.max(t0, t1);
}

/**
 * Propreté de la bande intérieure (3–9 px du côté du point intérieur) : fraction des échantillons sans « barre »
 * (ligne plus sombre ou plus claire que les deux bords de la bande). Une marche (haut de plinthe) n'est pas une barre ;
 * un joint de lames voisin en est une.
 */
export function insideBandClean(img: GrayImage, c: Chain, inside: Pt, minContrast: number): number {
  const n = { x: -c.d.y, y: c.d.x };
  const toInside = (inside.x - c.p.x) * n.x + (inside.y - c.p.y) * n.y >= 0 ? 1 : -1;
  const k = 24;
  let clean = 0;
  for (let i = 0; i < k; i++) {
    const t = c.tMin + ((c.tMax - c.tMin) * (i + 0.5)) / k;
    const x = c.p.x + c.d.x * t;
    const y = c.p.y + c.d.y * t;
    const at = (o: number): number => bilinear(img, x + n.x * o * toInside, y + n.y * o * toInside);
    const a = at(3);
    const b = at(9);
    let lo = Math.min(a, b);
    let hi = Math.max(a, b);
    for (let o = 4; o <= 8; o++) {
      const v = at(o);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const bar = lo < Math.min(a, b) - minContrast || hi > Math.max(a, b) + minContrast;
    if (!bar) clean++;
  }
  return clean / k;
}

/**
 * Prolonge l'étendue d'une chaîne le long de sa droite tant que des pixels d'arête la suivent (±1 px, trous ≤ 3 px),
 * au plus 30 % de sa longueur de chaque côté : récupère les morceaux trop courts pour la transformée de Hough
 * (angle de mur dans la zone de plinthe, ligne interrompue par un cadre).
 */
export function extendChain(edges: Uint8Array, w: number, h: number, c: Chain): void {
  const n = { x: -c.d.y, y: c.d.x };
  const maxExt = 0.3 * Math.max(1, c.tMax - c.tMin);
  const probe = (t: number): boolean => {
    for (const o of [0, -1, 1]) {
      const x = Math.round(c.p.x + c.d.x * t + n.x * o);
      const y = Math.round(c.p.y + c.d.y * t + n.y * o);
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      if (edges[y * w + x]) return true;
    }
    return false;
  };
  for (const dir of [1, -1]) {
    let t = dir > 0 ? c.tMax : c.tMin;
    let last = t;
    let gap = 0;
    for (let k = 1; k <= maxExt; k++) {
      t += dir;
      if (probe(t)) {
        last = t;
        gap = 0;
      } else if (++gap > 3) break;
    }
    if (dir > 0) c.tMax = Math.max(c.tMax, last);
    else c.tMin = Math.min(c.tMin, last);
  }
}

/** Ordonnée de la droite de la chaîne à l'abscisse x (chaîne horizontale) ou abscisse à y (verticale). */
export function lineAt(c: Chain, v: number): number {
  // Une chaîne horizontale a |d.x| ≥ cos 35°, une verticale |d.y| ≥ cos 35° : jamais de division par zéro.
  if (c.horizontal) return c.p.y + ((v - c.p.x) / c.d.x) * c.d.y;
  return c.p.x + ((v - c.p.y) / c.d.y) * c.d.x;
}

function extent(c: Chain): { lo: number; hi: number } {
  // Étendue sur l'axe principal (x pour horizontale, y pour verticale).
  const a = c.horizontal ? c.p.x + c.d.x * c.tMin : c.p.y + c.d.y * c.tMin;
  const b = c.horizontal ? c.p.x + c.d.x * c.tMax : c.p.y + c.d.y * c.tMax;
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

export interface WallLineCandidates {
  factor: number;
  small: GrayImage;
  inside: Pt;
  chains: Chain[];
  ceilings: Chain[];
  floors: Chain[];
  lefts: Chain[];
  rights: Chain[];
}

/** Étape intermédiaire exportée pour les tests et le banc : chaînes de marche candidates par côté (repère réduit ≤ 1024 px). */
export function wallLineCandidates(img: GrayImage, hint: WallCornersHint = {}): WallLineCandidates | null {
  if (img.width < 64 || img.height < 64) return null;
  const factor = Math.max(1, Math.ceil(Math.max(img.width, img.height) / 1024));
  const small = factor > 1 ? downsampleBox(img, factor) : img;
  const w = small.width;
  const h = small.height;
  const inside = hint.inside ? { x: hint.inside.x / factor, y: hint.inside.y / factor } : { x: w / 2, y: h / 2 };
  const edgeMap = cannyLite(small, 1.0);
  const minDim = Math.min(w, h);
  const segments = houghSegments(edgeMap, { threshold: 18, minLength: Math.max(20, minDim * 0.05), maxGap: 5, thetaResDeg: 0.5 });
  const chains = chainSegments(segments, 3, minDim * 0.25);
  const noise = noiseSigma(small);
  const minContrast = Math.max(3.5, 2.5 * noise);
  for (const c of chains) {
    refineChainLine(small, c, Math.max(1.5, 1.5 * noise));
    extendChain(edgeMap.edges, w, h, c);
    c.length = Math.max(c.length, c.tMax - c.tMin);
    c.contrast = stepContrast(small, c, 6, minContrast);
    c.clean = insideBandClean(small, c, inside, minContrast);
  }
  const usable = chains.filter((c) => c.contrast >= minContrast && c.clean >= 0.6);
  const covers = (c: Chain, v: number, slack: number): boolean => {
    const e = extent(c);
    return v >= e.lo - slack && v <= e.hi + slack;
  };
  // Candidats par côté (au plus 5, les plus longs) : lignes de marche, du bon côté du point intérieur.
  const K = 5;
  const topK = (arr: Chain[]): Chain[] => arr.sort((a, b) => b.length - a.length).slice(0, K);
  return {
    factor,
    small,
    inside,
    chains,
    ceilings: topK(usable.filter((c) => c.horizontal && covers(c, inside.x, w * 0.1) && c.length >= 0.2 * w && lineAt(c, inside.x) < inside.y)),
    floors: topK(usable.filter((c) => c.horizontal && covers(c, inside.x, w * 0.1) && c.length >= 0.2 * w && lineAt(c, inside.x) > inside.y)),
    lefts: topK(usable.filter((c) => !c.horizontal && covers(c, inside.y, h * 0.1) && c.length >= 0.2 * h && lineAt(c, inside.y) < inside.x)),
    rights: topK(usable.filter((c) => !c.horizontal && covers(c, inside.y, h * 0.1) && c.length >= 0.2 * h && lineAt(c, inside.y) > inside.x)),
  };
}

export interface WallQuadChoice {
  score: number;
  quad: [Pt, Pt, Pt, Pt];
  chains: [Chain, Chain, Chain, Chain];
}

/**
 * Choix du quad parmi les combinaisons plafond × sol × gauche × droite (repère réduit) : jonctions (accord entre
 * l'étendue de chaque ligne et le côté entre ses deux coins, pondéré par la qualité de la ligne), puis, à score comparable,
 * le quad le plus grand (sol plutôt que haut de plinthe, angle plutôt que montant de porte). `null` si rien de cohérent.
 */
export function selectWallQuad(cand: WallLineCandidates): WallQuadChoice | null {
  const { ceilings, floors, lefts, rights } = cand;
  const w = cand.small.width;
  const h = cand.small.height;
  const tOf = (c: Chain, p: Pt): number => (p.x - c.p.x) * c.d.x + (p.y - c.p.y) * c.d.y;
  const extentMatch = (c: Chain, p1: Pt, p2: Pt): number => {
    const t1 = tOf(c, p1);
    const t2 = tOf(c, p2);
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    const span = Math.max(1, hi - lo);
    const underScale = c.horizontal ? 0.6 : 0.2;
    let penalty = 0;
    for (const [end, corner] of [[c.tMin, lo], [c.tMax, hi]] as const) {
      const over = corner === lo ? Math.max(0, corner - end) : Math.max(0, end - corner);
      const under = corner === lo ? Math.max(0, end - corner) : Math.max(0, corner - end);
      penalty += over / (0.2 * span) + Math.max(0, under - 0.03 * span) / (underScale * span);
    }
    // Qualité propre de la ligne : propreté de la bande intérieure et contraste de marche (saturé à 8 niveaux).
    const quality = c.clean * Math.min(1, c.contrast / 8);
    return Math.max(0, 1 - penalty) * quality;
  };
  // Intersection de deux chaînes : lignes horizontale et verticale, jamais parallèles (≥ 20° d'écart) → point fini.
  const meet = (a: Chain, b: Chain): Pt => {
    const hA = intersectLinesH(lineFromPointDir(a.p, a.d), lineFromPointDir(b.p, b.d));
    return { x: hA[0] / hA[2], y: hA[1] / hA[2] };
  };
  const inBounds = (p: Pt): boolean => p.x > -0.1 * w && p.x < 1.1 * w && p.y > -0.1 * h && p.y < 1.1 * h;
  const combos: Array<WallQuadChoice & { area: number }> = [];
  for (const ce of ceilings) {
    for (const fl of floors) {
      for (const le of lefts) {
        for (const ri of rights) {
          const tl = meet(ce, le);
          const tr = meet(ce, ri);
          const br = meet(fl, ri);
          const bl = meet(fl, le);
          if (![tl, tr, br, bl].every(inBounds)) continue;
          const parts = [extentMatch(ce, tl, tr), extentMatch(fl, bl, br), extentMatch(le, tl, bl), extentMatch(ri, tr, br)];
          // Chaque ligne doit expliquer son côté au moins un peu : un montant de porte pris pour un angle (arrêt à 200 cm
          // du sol, loin du plafond) vaut 0 et élimine la combinaison plutôt que de produire un mur faux et cohérent.
          if (parts.some((v) => v < 0.2)) continue;
          const m = (parts[0] + parts[1] + parts[2] + parts[3]) / 4;
          const area = Math.abs((tr.x - tl.x) * (bl.y - tl.y) - (bl.x - tl.x) * (tr.y - tl.y));
          combos.push({ score: m, area, quad: [tl, tr, br, bl], chains: [ce, fl, le, ri] });
        }
      }
    }
  }
  if (combos.length === 0) return null;
  const maxArea = Math.max(...combos.map((c) => c.area));
  let best = combos[0];
  let bestTotal = -1;
  for (const c of combos) {
    const total = c.score + 0.5 * (c.area / maxArea);
    if (total > bestTotal) {
      bestTotal = total;
      best = c;
    }
  }
  if (best.score < 0.3) return null;
  return { score: best.score, quad: best.quad, chains: best.chains };
}

export function proposeWallCorners(img: GrayImage, hint: WallCornersHint = {}): WallCornersProposal | null {
  const cand = wallLineCandidates(img, hint);
  if (!cand) return null;
  const choice = selectWallQuad(cand);
  if (!choice) return null;
  const { factor } = cand;
  const [tl, tr, br, bl] = choice.quad;
  const [ceiling, floor, leftC, rightC] = choice.chains;
  const best = choice;
  const coarse: Quad = [tl, tr, br, bl].map((p) => ({ x: p.x * factor, y: p.y * factor })) as Quad;
  const refined = refineCornersDetailed(img, coarse, { radiusPx: 4 * factor + 2, maxSamples: 96 });
  const quad = refined.quad;
  // Confiance : couverture des lignes par rapport aux côtés du quad, contraste, côtés affinés.
  const sideLen = [dist(quad[0], quad[1]), dist(quad[1], quad[2]), dist(quad[2], quad[3]), dist(quad[3], quad[0])];
  const chainsInOrder = [ceiling, rightC, floor, leftC];
  let cov = 0;
  for (let i = 0; i < 4; i++) cov += Math.min(1, (chainsInOrder[i].length * factor) / Math.max(1, 0.9 * sideLen[i]));
  cov /= 4;
  const contrastScore = Math.min(1, Math.min(...chainsInOrder.map((c) => c.contrast)) / 25);
  const refinedScore = refined.sides.filter((s) => s.refined).length / 4;
  const confidence = Math.max(0, Math.min(1, 0.4 * cov + 0.2 * contrastScore + 0.2 * refinedScore + 0.2 * best.score));
  // Lignes rendues : étendue de la chaîne recadrée entre ses deux coins (marge 2 %) — l'estimation de distorsion ne doit
  // pas suivre l'arête au-delà de l'angle (plafond ou sol du mur latéral, qui change de direction).
  const toLine = (c: Chain, p1: Pt, p2: Pt, kind: WallLineKind): WallLine => {
    const t1 = (p1.x - c.p.x) * c.d.x + (p1.y - c.p.y) * c.d.y;
    const t2 = (p2.x - c.p.x) * c.d.x + (p2.y - c.p.y) * c.d.y;
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    const margin = 0.02 * (hi - lo);
    const tA = Math.max(c.tMin, lo + margin);
    const tB = Math.min(c.tMax, hi - margin);
    return {
      a: { x: (c.p.x + c.d.x * tA) * factor, y: (c.p.y + c.d.y * tA) * factor },
      b: { x: (c.p.x + c.d.x * tB) * factor, y: (c.p.y + c.d.y * tB) * factor },
      kind,
    };
  };
  return {
    quad,
    confidence,
    lines: [toLine(ceiling, tl, tr, "ceiling"), toLine(floor, bl, br, "floor"), toLine(leftC, tl, bl, "left"), toLine(rightC, tr, br, "right")],
  };
}
