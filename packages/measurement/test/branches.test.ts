/** Cas limites ciblés : chaque branche défensive est exercée par une entrée construite. */
import { describe, expect, it } from "vitest";
import type { Pt, Quad, WallSurvey } from "@wallscan/core";
import { findHorizontalStep } from "../src/baseboard.js";
import { parabolaInliers } from "../src/distortionEstimate.js";
import { cannyLite, houghSegments } from "../src/edges.js";
import { blurGray, makeGray } from "../src/image.js";
import { proposeOpenings } from "../src/openings.js";
import { checkFloorBelow, measurePhoto } from "../src/pipeline.js";
import { WARN } from "../src/constants.js";
import { imageToWallCm } from "../src/rectify.js";
import { invertHomography } from "../src/homography.js";
import { decodeMire, detectReference } from "../src/reference.js";
import { fitLineRobust, refineCornersDetailed, snapToEdge } from "../src/refine.js";
import { refineChainLine, selectWallQuad, type Chain, type WallLineCandidates } from "../src/wallCorners.js";
import { warpToPlane } from "../src/warp.js";
import { renderScene } from "../bench/raster.js";
import { generateCase, simpleScene } from "../bench/scene.js";
import { workImage } from "../src/image.js";
import { pctErr } from "./helpers.js";

const chain = (p: Pt, d: Pt, tMin: number, tMax: number, horizontal: boolean, contrast = 50, clean = 1): Chain => ({
  segments: [],
  p,
  d,
  tMin,
  tMax,
  length: tMax - tMin,
  horizontal,
  contrast,
  clean,
});

describe("branches défensives", () => {
  it("marche horizontale sur une rampe linéaire : dérivée plate, pas d'interpolation", () => {
    const w = 60;
    const h = 40;
    const img = makeGray(w, h, 100);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data[y * w + x] = y < 15 ? 100 : y < 25 ? 100 + (y - 15) * 10 : 200;
    const s = findHorizontalStep(img, 10, 30, 0.5)!;
    expect(s).not.toBeNull();
    expect(s.y).toBeGreaterThan(14);
    expect(s.y).toBeLessThan(26);
    // Bande commençant dans la rampe : plateau de dérivée (den = 0) → pas d'interpolation.
    const plateau = findHorizontalStep(img, 18, 22, 0.5)!;
    expect(plateau.y).toBe(18.5);
  });

  it("parabole dégénérée : points confondus renvoyés tels quels", () => {
    const pts = Array.from({ length: 6 }, () => ({ x: 10, y: 10 }));
    expect(parabolaInliers(pts, { x: 10, y: 10 }, { x: 60, y: 10 })).toBe(pts);
    expect(parabolaInliers(pts.slice(0, 3), { x: 0, y: 0 }, { x: 1, y: 0 }).length).toBe(3);
  });

  it("Canny sur image minuscule, Hough aux bords et options par défaut", () => {
    const tiny = cannyLite(makeGray(2, 2, 100));
    expect(tiny.high).toBe(2.5);
    const w = 80;
    const h = 60;
    const img = makeGray(w, h, 40);
    for (let y = 0; y < h; y++) if (y < 28 || y > 31) img.data[y * w] = 220; // colonne claire en x = 0 (trou de 4 px) : arête en x = 1, voisins hors cadre
    const e = cannyLite(blurGray(img, 0.6), 0.8);
    const segs = houghSegments(e, {});
    expect(segs.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(segs[0].a.x - segs[0].b.x)).toBeLessThan(3);
  });

  it("ouvertures : rectangle sans catégorie ignoré, fenêtre texturée acceptée avec confiance réduite", () => {
    const survey: WallSurvey = {
      widthCm: 300,
      heightCm: 200,
      heightLeftCm: 200,
      heightRightCm: 200,
      uncertaintyPct: 1,
      displayTolerancePct: 3,
      reference: "a4",
      scalePxPerCm: 1,
      homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      openings: [],
      baseboard: { enabled: false, heightCm: null, source: null },
      checks: { oppositeSidesPct: 0, referenceAspectPct: 0, distortionPct: 0, warnings: [] },
    };
    const w = 300;
    const h = 200;
    const flat = makeGray(w, h, 120);
    for (let y = 60; y < 92; y++) for (let x = 60; x < 180; x++) flat.data[y * w + x] = 230; // 120 × 32 cm : ni fenêtre ni radiateur
    expect(proposeOpenings(blurGray(flat, 1), 1, survey)).toEqual([]);
    const textured = makeGray(w, h, 120);
    for (let y = 40; y < 140; y++) for (let x = 60; x < 180; x++) textured.data[y * w + x] = ((x >> 2) + (y >> 2)) % 2 === 0 ? 70 : 170;
    const found = proposeOpenings(blurGray(textured, 0.6), 1, survey);
    expect(found.length).toBe(1);
    expect(found[0].kind).toBe("window");
    expect(found[0].confidence).toBeLessThan(0.7);
  });

  it("pipeline : affinage de la référence sur l'image pleine résolution (facteur 2)", () => {
    const { scene, truth } = simpleScene({ reference: "mire", imageW: 4096, imageH: 3072, distanceCm: 400 });
    const full = renderScene(scene).image;
    const { img: work, factor } = workImage(full, 2048);
    expect(factor).toBe(2);
    const res = measurePhoto({ work, full, fullFactor: factor, proposeOpenings: false });
    expect(res.failure).toBeNull();
    expect(res.reference!.sigmaPx).toBe(0.25);
    expect(pctErr(res.survey!.widthCm, truth.W)).toBeLessThan(0.3);
  });

  it("contrôle du bas du mur : ligne sous le bord avec bande uniforme, bande texturée, rien", () => {
    // Image de travail = plan du mur (homographie identité, 1 px = 1 cm) : mur de 200 cm, sol à y = 200.
    const w = 300;
    const h = 260;
    const survey: WallSurvey = {
      widthCm: w,
      heightCm: 200,
      heightLeftCm: 200,
      heightRightCm: 200,
      uncertaintyPct: 1,
      displayTolerancePct: 3,
      reference: "a4",
      scalePxPerCm: 1,
      homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      openings: [],
      baseboard: { enabled: false, heightCm: null, source: null },
      checks: { oppositeSidesPct: 0, referenceAspectPct: 0, distortionPct: 0, warnings: [] },
      imageSize: { w, h },
    };
    const uniform = makeGray(w, h, 150);
    for (let y = 212; y < h; y++) for (let x = 0; x < w; x++) uniform.data[y * w + x] = 90; // vraie ligne de sol 12 cm plus bas
    const found = checkFloorBelow(blurGray(uniform, 0.8), survey, 1, 0)!;
    expect(found).not.toBeNull();
    expect(Math.abs(found.distanceCm - 12)).toBeLessThan(1);
    const textured = makeGray(w, h, 150);
    for (let y = 200; y < h; y++) for (let x = 0; x < w; x++) textured.data[y * w + x] = y < 212 ? 100 + ((y * 37) % 90) : 90;
    expect(checkFloorBelow(blurGray(textured, 0.8), survey, 1, 0)).toBeNull();
    expect(checkFloorBelow(makeGray(w, h, 150), survey, 1, 0)).toBeNull();
    // Ligne juste sous le bord (3 cm) : bande trop étroite pour juger (< 2 lignes) → null.
    const close = makeGray(w, h, 150);
    for (let y = 203; y < h; y++) for (let x = 0; x < w; x++) close.data[y * w + x] = 90;
    expect(checkFloorBelow(blurGray(close, 0.8), survey, 1, 0)).toBeNull();
  });

  it("pipeline : haut de plinthe pris pour le sol → sol descendu et signalé ; distorsion fournie", () => {
    // Cas du banc (graine fixe, rendu à 2048 px) où la ligne de sol, faible et interrompue, perd la sélection au profit du
    // haut de plinthe : le contrôle trouve le vrai sol en dessous, sans plinthe au-dessus, bande uniforme → sol descendu.
    const c = generateCase(332, 20261107, { imageLongSide: 2048 });
    const full = renderScene(c.scene).image;
    const { img: work, factor } = workImage(full, 2048);
    const res = measurePhoto({ work, full, fullFactor: factor, proposeOpenings: false });
    expect(res.survey).not.toBeNull();
    expect(res.survey!.checks.warnings).toContain(WARN.floorAmbiguous);
    expect(pctErr(res.survey!.heightCm, c.truth.H)).toBeLessThan(0.5);
    expect(Math.abs((res.baseboard?.heightCm ?? 0) - (c.truth.baseboardCm ?? 0))).toBeLessThan(1);
    const given = measurePhoto({ work, distortion: { k1: 0, residualPct: 1 }, proposeOpenings: false, proposeBaseboard: false });
    expect(given.survey!.checks.warnings).toContain("distortion_not_estimated");
    const known = measurePhoto({ work, distortion: { k1: 0.004, residualPct: 0.05 }, proposeOpenings: false });
    expect(known.distortion!.k1).toBe(0.004);
  });

  it("imageToWallCm sans taille d'image, warp avec dénominateur nul", () => {
    const survey: WallSurvey = {
      widthCm: 100,
      heightCm: 50,
      heightLeftCm: 50,
      heightRightCm: 50,
      uncertaintyPct: 1,
      displayTolerancePct: 3,
      reference: "a4",
      scalePxPerCm: 1,
      homography: [2, 0, 0, 0, 2, 0, 0, 0, 1],
      openings: [],
      baseboard: { enabled: false, heightCm: null, source: null },
      checks: { oppositeSidesPct: 0, referenceAspectPct: 0, distortionPct: 0, warnings: [] },
    };
    expect(imageToWallCm(survey, { x: 3, y: 4 })).toEqual({ x: 6, y: 8 });
    const img = makeGray(6, 6, 50);
    const H = invertHomography([1, 0, 0, 0, 1, 0, 0, -1, 2.5])!; // l'inverse interne a pour 3e ligne (0, −1, 2,5) : nul en y = 2,5
    const out = warpToPlane(img, H, 6, 6);
    expect(out.data[2 * 6 + 2]).toBe(0);
    expect(out.data[0]).toBe(50);
  });

  it("référence : candidats dégénérés (ligne fine, barre), cadre sans code, carré clair, cadre sombre sans mire", () => {
    const w = 600;
    const h = 450;
    const line = makeGray(w, h, 80);
    for (let x = 200; x < 260; x++) line.data[200 * w + x] = 250; // ligne de 1 px : enveloppe à 2 points
    expect(detectReference(blurGray(line, 0.3), { kind: "a4" })).toBeNull();
    const bar = makeGray(w, h, 80);
    for (let y = 200; y < 202; y++) for (let x = 200; x < 260; x++) bar.data[y * w + x] = 250; // barre de 2 px : côté court ≤ 2
    expect(detectReference(bar, { kind: "a4" })).toBeNull();
    const square = makeGray(w, h, 80);
    for (let y = 200; y < 240; y++) for (let x = 200; x < 240; x++) square.data[y * w + x] = 250; // carré : proportions ≠ A4
    expect(detectReference(blurGray(square, 0.6), { kind: "a4" })).toBeNull();
    // Cadre noir aux proportions de la mire, intérieur clair, mais sans carrés ni code : décodage impossible.
    const frame = makeGray(w, h, 200);
    const s = 0.26; // px par mm : cadre de 49 × 72 px, sous le côté maximal (12,5 % de l'image)
    const fx = 220;
    const fy = 60;
    const fw = Math.round(190 * s);
    const fh = Math.round(277 * s);
    const t = Math.round(10 * s);
    for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + fw; x++) if (x < fx + t || x >= fx + fw - t || y < fy + t || y >= fy + fh - t) frame.data[y * w + x] = 20;
    const blurredFrame = blurGray(frame, 0.6);
    expect(detectReference(blurredFrame, { kind: "mire" })).toBeNull();
    // Cadre noir carré : proportions incompatibles avec la mire.
    const squareFrame = makeGray(w, h, 200);
    for (let y = 100; y < 160; y++) for (let x = 100; x < 160; x++) if (x < 104 || x >= 156 || y < 104 || y >= 156) squareFrame.data[y * w + x] = 20;
    expect(detectReference(blurGray(squareFrame, 0.6), { kind: "mire" })).toBeNull();
    const quad: Quad = [{ x: fx, y: fy }, { x: fx + fw, y: fy }, { x: fx + fw, y: fy + fh }, { x: fx, y: fy + fh }];
    expect(decodeMire(blurredFrame, quad)).toBeNull();
    // Même cadre avec les carrés de repère mais un code tout blanc : coin d'orientation absent → null.
    const sq = Math.round(20 * s);
    const ins = Math.round(30 * s);
    for (const [cx, cy] of [[fx + ins, fy + ins], [fx + fw - ins - sq, fy + ins], [fx + fw - ins - sq, fy + fh - ins - sq], [fx + ins, fy + fh - ins - sq]]) {
      for (let y = cy; y < cy + sq; y++) for (let x = cx; x < cx + sq; x++) frame.data[y * w + x] = 20;
    }
    expect(decodeMire(blurGray(frame, 0.6), quad)).toBeNull();
  });

  it("ajustement robuste : arrêt quand le rejet laisse trop peu de points ou des points confondus", () => {
    const pts: Pt[] = [];
    for (let i = 0; i < 8; i++) pts.push({ x: i * 10, y: 0 });
    pts.push({ x: 35, y: 30 });
    const few = fitLineRobust(pts, 9)!; // le rejet de l'aberrant laisse 8 < 9 points : on garde l'ajustement courant
    expect(few).not.toBeNull();
    expect(few.inliers).toBe(9);
    const same = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 0, y: 40 }, { x: 40, y: 0 }];
    const f = fitLineRobust(same, 4)!;
    expect(f).not.toBeNull();
    expect(f.inliers).toBeGreaterThanOrEqual(4);
  });

  it("affinage : polarité lointaine négative, rayon par défaut, côtés non affinés avec distorsion, intersection lointaine", () => {
    const w = 120;
    const h = 90;
    const dark = makeGray(w, h, 220);
    for (let y = 16; y < 71; y++) for (let x = 20; x < 90; x++) dark.data[y * w + x] = 60;
    const img = blurGray(dark, 0.7);
    const coarse: Quad = [{ x: 17, y: 19 }, { x: 93, y: 13 }, { x: 87, y: 74 }, { x: 23, y: 68 }];
    const r = refineCornersDetailed(img, coarse);
    expect(r.sides.every((s) => s.polarity === -1)).toBe(true);
    expect(Math.abs(r.quad[0].x - 20)).toBeLessThan(0.5);
    // Quad grossier à 6 px : les échantillons proches ne tranchent pas, polarité estimée au loin (intérieur sombre → −1).
    const far: Quad = [{ x: 14, y: 10 }, { x: 96, y: 10 }, { x: 96, y: 77 }, { x: 14, y: 77 }];
    const rf = refineCornersDetailed(img, far, { radiusPx: 8 });
    expect(rf.sides.every((s) => s.polarity === -1)).toBe(true);
    const flat = makeGray(w, h, 100);
    const u = refineCornersDetailed(flat, coarse, { k1: 0.01 });
    expect(u.sides.every((s) => !s.refined)).toBe(true);
    expect(u.quad[0].x).toBeCloseTo(coarse[0].x, 6);
    // Deux côtés consécutifs sur la même arête : droites parallèles → coin d'origine conservé.
    const bright = makeGray(w, h, 60);
    for (let y = 16; y < 71; y++) for (let x = 20; x < 90; x++) bright.data[y * w + x] = 220;
    const degenerate: Quad = [{ x: 25, y: 16 }, { x: 55, y: 16 }, { x: 85, y: 16 }, { x: 20, y: 60 }];
    const d = refineCornersDetailed(blurGray(bright, 0.7), degenerate, { radiusPx: 4 });
    expect(d.quad[1]).toEqual({ x: 55, y: 16 });
    expect(d.sides[1].refined).toBe(false);
  });

  it("aimantation : bord droit (gradient vers −x), plateau de gradient (rampe)", () => {
    const w = 120;
    const h = 90;
    const bright = makeGray(w, h, 60);
    for (let y = 10; y < 80; y++) for (let x = 20; x < 90; x++) bright.data[y * w + x] = 220;
    const img = blurGray(bright, 0.7);
    const right = snapToEdge(img, { x: 93, y: 45 }, 8);
    expect(Math.abs(right.x - 90)).toBeLessThan(1);
    const ramp = makeGray(w, h, 0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ramp.data[y * w + x] = Math.min(255, y * 4);
    const on = snapToEdge(ramp, { x: 50, y: 30 }, 6);
    expect(Math.abs(on.y - 30)).toBeLessThan(7);
    // Coins bas (gradient vers −y) : bas-gauche et bas-droit (gradient exactement vers −x sur le bord droit).
    const bl = snapToEdge(img, { x: 24, y: 76 }, 10);
    expect(Math.abs(bl.x - 20)).toBeLessThan(1);
    expect(Math.abs(bl.y - 80)).toBeLessThan(1);
    const br = snapToEdge(img, { x: 86, y: 76 }, 10);
    expect(Math.abs(br.x - 90)).toBeLessThan(1);
    expect(Math.abs(br.y - 80)).toBeLessThan(1);
  });

  it("chaînes : recalage sans arête, sélection du quad (hors cadre, score faible, aucune combinaison)", () => {
    const flat = makeGray(200, 150, 100);
    const c = chain({ x: 100, y: 75 }, { x: 1, y: 0 }, -50, 50, true);
    refineChainLine(flat, c, 2);
    expect(c.p).toEqual({ x: 100, y: 75 });
    const base: WallLineCandidates = { factor: 1, small: flat, inside: { x: 100, y: 75 }, chains: [], ceilings: [], floors: [], lefts: [], rights: [] };
    expect(selectWallQuad(base)).toBeNull();
    // Lignes cohérentes : quad retenu.
    const good: WallLineCandidates = {
      ...base,
      ceilings: [chain({ x: 100, y: 20 }, { x: 1, y: 0 }, -80, 80, true)],
      floors: [chain({ x: 100, y: 130 }, { x: 1, y: 0 }, -80, 80, true)],
      lefts: [chain({ x: 20, y: 75 }, { x: 0, y: 1 }, -55, 55, false)],
      rights: [chain({ x: 180, y: 75 }, { x: 0, y: 1 }, -55, 55, false)],
    };
    const g = selectWallQuad(good)!;
    expect(g).not.toBeNull();
    expect(g.score).toBeGreaterThan(0.9);
    expect(g.quad[2].x).toBeCloseTo(180, 6);
    // Ligne verticale très inclinée : intersection avec le plafond hors du cadre → combinaison écartée.
    const oblique: WallLineCandidates = { ...good, lefts: [chain({ x: 20, y: 75 }, { x: 0.7, y: 0.714 }, -55, 55, false)] };
    expect(selectWallQuad(oblique)).toBeNull();
    // Étendues très courtes par rapport aux côtés : score < 0,3.
    const weak: WallLineCandidates = {
      ...good,
      ceilings: [chain({ x: 100, y: 20 }, { x: 1, y: 0 }, -80, 80, true, 50, 0.25)],
      floors: [chain({ x: 100, y: 130 }, { x: 1, y: 0 }, -80, 80, true, 50, 0.25)],
      lefts: [chain({ x: 20, y: 75 }, { x: 0, y: 1 }, -55, 55, false, 50, 0.25)],
      rights: [chain({ x: 180, y: 75 }, { x: 0, y: 1 }, -55, 55, false, 50, 0.25)],
    };
    expect(selectWallQuad(weak)).toBeNull();
    // Une ligne qui n'explique pas son côté (montant de porte arrêté à 70 % de la hauteur) élimine la combinaison.
    const doorEdge: WallLineCandidates = { ...good, rights: [chain({ x: 180, y: 95 }, { x: 0, y: 1 }, -35, 35, false)] };
    expect(selectWallQuad(doorEdge)).toBeNull();
  });
});
