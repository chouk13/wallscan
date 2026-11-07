import { describe, expect, it } from "vitest";
import type { Quad, WallSurvey } from "@wallscan/core";
import { applyBaseboard, findHorizontalStep, measureBaseboard, proposeBaseboard, usableHeightCm } from "../src/baseboard.js";
import { scaleSurvey, surveyBounds } from "../src/bounds.js";
import { WARN } from "../src/constants.js";
import { estimateRadialDistortion, trackEdge } from "../src/distortionEstimate.js";
import { blurGray, makeGray } from "../src/image.js";
import { proposeOpenings, runs } from "../src/openings.js";
import { measurePhoto } from "../src/pipeline.js";
import { rectify } from "../src/rectify.js";
import { quadCenter } from "../src/segment.js";
import { proposeWallCorners } from "../src/wallCorners.js";
import { warpToPlane } from "../src/warp.js";
import { makeCamera, projectWall } from "../bench/camera.js";
import { quadErr, rendered } from "./scenes.js";
import { pctErr } from "./helpers.js";

describe("estimation de la distorsion", () => {
  it("k1 retrouvé à ±0,003 sur une scène rendue ; sans lignes → 0", () => {
    for (const k1 of [0.018, -0.015]) {
      const s = rendered({ reference: "mire", k1, yawDeg: 5, pitchDeg: -6, distanceCm: 420 });
      const p = proposeWallCorners(s.work, { inside: quadCenter(s.refQuad!) })!;
      expect(p).not.toBeNull();
      const est = estimateRadialDistortion(s.work, p.lines);
      expect(Math.abs(est.k1 - k1)).toBeLessThan(0.003);
      expect(est.residualPct).toBeLessThan(0.3);
    }
    const flat = makeGray(300, 200, 100);
    expect(estimateRadialDistortion(flat, [{ a: { x: 10, y: 10 }, b: { x: 290, y: 12 } }])).toEqual({ k1: 0, residualPct: 0 });
    expect(estimateRadialDistortion(flat, [{ a: { x: 10, y: 10 }, b: { x: 20, y: 12 } }])).toEqual({ k1: 0, residualPct: 0 });
    expect(trackEdge(flat, { x: 0, y: 0 }, { x: 5, y: 5 }, 2)).toEqual([]);
  });

  it("courbure hors modèle : pas de correction, courbure brute rapportée, avertissement du pipeline", () => {
    // Arête fortement courbe (flèche 60 px sur 1000 px) : k1 implausible → 0, résidu élevé.
    const w = 1200;
    const h = 400;
    const img = makeGray(w, h, 60);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (y > 200 + 60 * Math.pow((x - 600) / 600, 2)) img.data[y * w + x] = 200;
    const est = estimateRadialDistortion(blurGray(img, 0.8), [{ a: { x: 100, y: 242 }, b: { x: 1100, y: 242 } }]);
    expect(est.k1).toBe(0);
    expect(est.residualPct).toBeGreaterThan(0.1);
    // Scène rendue avec une distorsion extrême (ultra grand-angle) : mesure refusée ou signalée.
    const s = rendered({ reference: "mire", k1: 0.09, distanceCm: 420 });
    const res = measurePhoto({ work: s.work, proposeOpenings: false });
    expect(res.failure !== null || (res.survey !== null && res.survey.checks.warnings.some((x) => x === WARN.distortionUnknown || x === WARN.distortionHigh))).toBe(true);
  });

  it("une ligne aberrante parmi quatre n'entraîne pas l'estimation (consensus)", () => {
    const s = rendered({ reference: "a4", k1: 0.01, yawDeg: -4, pitchDeg: 3, distanceCm: 420 });
    const p = proposeWallCorners(s.work, { inside: quadCenter(s.refQuad!) })!;
    // Ligne bidon : un segment qui coupe le mur en diagonale (aucune arête à suivre → ignorée) et un segment court.
    const lines = [...p.lines, { a: { x: 300, y: 300 }, b: { x: 1700, y: 1200 } }, { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }];
    const est = estimateRadialDistortion(s.work, lines);
    expect(Math.abs(est.k1 - 0.01)).toBeLessThan(0.003);
  });
});

describe("image redressée", () => {
  it("warpToPlane : identité, hors source, homographie singulière, distorsion", () => {
    const img = makeGray(10, 8, 0);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) img.data[y * 10 + x] = x * 20;
    const same = warpToPlane(img, [1, 0, 0, 0, 1, 0, 0, 0, 1], 10, 8);
    expect(Array.from(same.data)).toEqual(Array.from(img.data));
    const shifted = warpToPlane(img, [1, 0, 5, 0, 1, 0, 0, 0, 1], 10, 8); // sortie décalée de 5 px : la moitié vient d'avant la source
    expect(shifted.data[0]).toBe(0);
    expect(shifted.data[9]).toBe(80);
    const black = warpToPlane(img, [1, 2, 3, 2, 4, 6, 1, 1, 1], 4, 4);
    expect(black.data.every((v) => v === 0)).toBe(true);
    expect(warpToPlane(img, [1, 0, 0, 0, 1, 0, 0, 0, 1], 0, 0).data.length).toBe(0);
    const d = warpToPlane(img, [1, 0, 0, 0, 1, 0, 0, 0, 1], 10, 8, 0.02);
    expect(d.data[4 * 10 + 5]).toBe(img.data[4 * 10 + 5]); // le centre ne bouge pas
    // Dénominateur nul sur une ligne de l'image de sortie : pixels laissés à zéro, pas d'exception.
    const proj = warpToPlane(img, [1, 0, 0, 0, 1, 0, 0, -1, 2], 6, 6);
    expect(proj.data.length).toBe(36);
  });
});

describe("plinthes", () => {
  const survey = (heightCm: number, scale = 2): WallSurvey => ({
    widthCm: 400,
    heightCm,
    heightLeftCm: heightCm,
    heightRightCm: heightCm,
    uncertaintyPct: 1,
    displayTolerancePct: 3,
    reference: "a4",
    scalePxPerCm: scale,
    homography: [scale, 0, 0, 0, scale, 0, 0, 0, 1].map((v, i) => (i === 0 || i === 4 ? 1 / scale : v)),
    openings: [],
    baseboard: { enabled: false, heightCm: null, source: null },
    checks: { oppositeSidesPct: 0, referenceAspectPct: 0, distortionPct: 0, warnings: [] },
    imageSize: { w: 800, h: 500 },
  });
  const rectifiedWithBaseboard = (hCm: number, bbCm: number, scale = 2, contrast = 60) => {
    const w = 400 * scale;
    const h = hCm * scale;
    const img = makeGray(w, h, 140);
    const top = Math.round((hCm - bbCm) * scale);
    for (let y = top; y < h; y++) for (let x = 0; x < w; x++) img.data[y * w + x] = 140 + contrast;
    return blurGray(img, 0.8);
  };

  it("proposition automatique : hauteur à 0,3 cm, absence détectée, entrées invalides", () => {
    const s = survey(250);
    const p = proposeBaseboard(rectifiedWithBaseboard(250, 9), 2, s)!;
    expect(p).not.toBeNull();
    expect(Math.abs(p.heightCm - 9)).toBeLessThan(0.3);
    expect(p.coverage).toBeGreaterThan(0.9);
    expect(p.confidence).toBeGreaterThan(0.7);
    expect(proposeBaseboard(blurGray(makeGray(800, 500, 140), 0.8), 2, s)).toBeNull();
    expect(proposeBaseboard(rectifiedWithBaseboard(250, 9), 0, s)).toBeNull();
    expect(proposeBaseboard(makeGray(10, 10, 0), 2, s)).toBeNull();
    expect(proposeBaseboard(rectifiedWithBaseboard(250, 9), 2, survey(0))).toBeNull();
    // Bande trop étroite (mur de 4 cm) → null ; plinthe hors de la bande cherchée (1,5 cm, 30 cm) → null.
    expect(proposeBaseboard(makeGray(100, 8, 100), 2, survey(4))).toBeNull();
    expect(proposeBaseboard(rectifiedWithBaseboard(250, 1.5), 2, s)).toBeNull();
    expect(proposeBaseboard(rectifiedWithBaseboard(250, 30), 2, s)).toBeNull();
    // Une barre (joint sombre) n'est pas un haut de plinthe.
    const bar = makeGray(800, 500, 140);
    for (let x = 0; x < 800; x++) bar.data[480 * 800 + x] = 20;
    expect(proposeBaseboard(blurGray(bar, 0.8), 2, s)).toBeNull();
    // Marche faible mais présente : couverture insuffisante sur la moitié → null.
    const half = makeGray(800, 500, 140);
    for (let y = 482; y < 500; y++) for (let x = 0; x < 300; x++) half.data[y * 800 + x] = 200;
    expect(proposeBaseboard(blurGray(half, 0.8), 2, s)).toBeNull();
    expect(findHorizontalStep(makeGray(10, 3, 0), 0, 2)).toBeNull();
  });

  it("mesure au point tapé, bascule avec hauteur réelle, jamais de défaut, fourchette", () => {
    const s = survey(250);
    const m = measureBaseboard(s, { x: 100, y: 2 * (250 - 8) });
    expect(m.heightCm).toBeCloseTo(8, 6);
    expect(m.uncertaintyCm).toBeGreaterThan(0);
    expect(measureBaseboard(s, { x: 100, y: 2 * 300 }).heightCm).toBe(0);
    expect(measureBaseboard(s, { x: 100, y: -50 }).heightCm).toBe(250);
    const on = applyBaseboard(s, true, 8, "measured");
    expect(on.baseboard).toEqual({ enabled: true, heightCm: 8, source: "measured" });
    expect(usableHeightCm(on)).toBe(242);
    expect(on.checks.warnings).toEqual([]);
    const missing = applyBaseboard(s, true, null, null);
    expect(missing.baseboard).toEqual({ enabled: false, heightCm: null, source: null });
    expect(missing.checks.warnings).toContain(WARN.baseboardHeightRequired);
    expect(usableHeightCm(missing)).toBe(250);
    const invalid = applyBaseboard(missing, true, 300, "user");
    expect(invalid.baseboard.enabled).toBe(false);
    expect(invalid.checks.warnings.filter((w) => w === WARN.baseboardHeightRequired).length).toBe(1);
    const off = applyBaseboard(missing, false, 8, "auto");
    expect(off.baseboard).toEqual({ enabled: false, heightCm: 8, source: "auto" });
    expect(off.checks.warnings).toEqual([]);
    const offNoHeight = applyBaseboard(s, false, null, null);
    expect(offNoHeight.baseboard.heightCm).toBeNull();
    expect(s.baseboard.enabled).toBe(false); // immutabilité
    const b = surveyBounds(on);
    expect(b.low.widthCm).toBeCloseTo(388, 9);
    expect(b.high.heightCm).toBeCloseTo(257.5, 9);
    expect(b.low.baseboard.heightCm).toBeCloseTo(7.76, 9);
    expect(b.high.scalePxPerCm).toBeCloseTo(2 / 1.03, 9);
    const withOpening = scaleSurvey({ ...s, openings: [{ id: "u1", kind: "window", rect: { x: 10, y: 20, w: 100, h: 120 }, confidence: 1, source: "user" }] }, 2);
    expect(withOpening.openings[0].rect).toEqual({ x: 20, y: 40, w: 200, h: 240 });
    expect(scaleSurvey(s, 1.5).baseboard.heightCm).toBeNull();
  });
});

describe("ouvertures", () => {
  it("fenêtre, porte, radiateur et porte-fenêtre retrouvés dans l'image redressée", () => {
    const s = rendered({ reference: "a4", distanceCm: 470, window: { x: 40, y: 60, w: 130, h: 120 }, door: { x: 280, w: 85, h: 205 }, radiator: { x: 55, y: 180, w: 100, h: 55 } });
    const res = measurePhoto({ work: s.work, full: s.full, fullFactor: s.factor });
    expect(res.survey).not.toBeNull();
    const kinds = res.openings.map((o) => o.kind).sort();
    expect(kinds).toEqual(["door", "radiator", "window"]);
    for (const o of res.openings) {
      const t = s.truth.openings.find((g) => g.kind === o.kind)!;
      expect(Math.abs(o.rect.x - t.rect.x)).toBeLessThan(4);
      expect(Math.abs(o.rect.w - t.rect.w)).toBeLessThan(6);
      expect(o.source).toBe("auto");
      expect(o.confidence).toBeGreaterThan(0.5);
      expect(o.id).toMatch(/^auto-\d+$/);
    }
    expect(res.survey!.openings.length).toBe(3);
    // Porte-fenêtre : rectangle pleine hauteur partant du sol.
    const f = rendered({ reference: "a4", distanceCm: 470, door: { x: 240, w: 140, h: 240 }, H: 250 });
    const rf = measurePhoto({ work: f.work, full: f.full, fullFactor: f.factor });
    expect(rf.openings.some((o) => o.kind === "french_door")).toBe(true);
  });

  it("entrées invalides, image à une échelle fine (réduction), séries d'arêtes", () => {
    const base: WallSurvey = {
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
    expect(proposeOpenings(makeGray(300, 200, 100), 0, base)).toEqual([]);
    expect(proposeOpenings(makeGray(10, 10, 100), 1, base)).toEqual([]);
    expect(proposeOpenings(makeGray(300, 200, 100), 1, { ...base, widthCm: 0 })).toEqual([]);
    expect(proposeOpenings(blurGray(makeGray(300, 200, 100), 1), 1, base)).toEqual([]);
    // Image à 3 px/cm avec une fenêtre claire : réduction interne à 1 px/cm.
    const w = 900;
    const h = 600;
    const img = makeGray(w, h, 120);
    for (let y = 150; y < 420; y++) for (let x = 180; x < 540; x++) img.data[y * w + x] = 240;
    const found = proposeOpenings(blurGray(img, 1), 3, base);
    expect(found.length).toBe(1);
    expect(found[0].kind).toBe("window");
    expect(Math.abs(found[0].rect.x - 60)).toBeLessThan(4);
    expect(Math.abs(found[0].rect.w - 120)).toBeLessThan(6);
    // Rectangle sombre ne touchant pas le sol et trop petit pour une fenêtre : ignoré.
    const small = makeGray(300, 200, 120);
    for (let y = 60; y < 90; y++) for (let x = 100; x < 130; x++) small.data[y * 300 + x] = 30;
    expect(proposeOpenings(blurGray(small, 1), 1, base)).toEqual([]);
    // Rectangle gris moyen de taille fenêtre mais sans contraste avec le mur (écart < 10) : aucune proposition.
    const dull = makeGray(300, 200, 120);
    for (let y = 40; y < 140; y++) for (let x = 60; x < 160; x++) dull.data[y * 300 + x] = 126;
    expect(proposeOpenings(blurGray(dull, 1), 1, base).length).toBe(0);
    // runs : séries et déduplication.
    const flag = new Uint8Array(20 * 5);
    for (let x = 2; x < 18; x++) {
      flag[1 * 20 + x] = 1;
      flag[2 * 20 + x] = 1;
    }
    flag[1 * 20 + 9] = 0; // trou d'un pixel toléré
    const strength = new Float32Array(100).fill(1);
    strength[2 * 20 + 5] = 5;
    const r = runs(flag, strength, 20, 5, true, 5);
    expect(r.length).toBe(1);
    expect(r[0].pos).toBe(2);
    expect(runs(flag, strength, 20, 5, false, 2).length).toBeGreaterThanOrEqual(4); // colonnes voisines dédupliquées
  });
});

describe("pipeline automatique", () => {
  it("mire : mesure de bout en bout à < 0,3 %, plinthe proposée, image redressée", () => {
    const s = rendered({ reference: "mire", k1: 0.012, yawDeg: 7, pitchDeg: -4, rollDeg: 2, baseboardCm: 9, distanceCm: 420 });
    const res = measurePhoto({ work: s.work, full: s.full, fullFactor: s.factor });
    expect(res.failure).toBeNull();
    expect(res.reference!.kind).toBe("mire");
    expect(res.reference!.manual).toBe(false);
    expect(res.reference!.code).toBe(22);
    expect(res.wallCorners).not.toBeNull();
    expect(quadErr(res.wallCorners!.quad, s.wallQuad)).toBeLessThan(1.5);
    expect(Math.abs(res.distortion!.k1 - 0.012)).toBeLessThan(0.003);
    const sv = res.survey!;
    expect(pctErr(sv.widthCm, 400)).toBeLessThan(0.3);
    expect(pctErr(sv.heightCm, 250)).toBeLessThan(0.3);
    expect(sv.reference).toBe("mire");
    expect(sv.displayTolerancePct).toBe(3);
    expect(sv.uncertaintyPct).toBeLessThan(1);
    expect(sv.baseboard.source).toBe("auto");
    expect(sv.baseboard.enabled).toBe(false);
    expect(Math.abs((sv.baseboard.heightCm as number) - 9)).toBeLessThan(0.5);
    expect(res.rectified!.width).toBe(Math.round(sv.widthCm * res.rectifiedScalePxPerCm));
    expect(res.timingsMs.rectify).toBeGreaterThanOrEqual(0);
    expect(sv.checks.warnings).not.toContain(WARN.floorAmbiguous);
    // Mesure de plinthe au point tapé sur la photo (bas du mur − 9 cm, au milieu).
    const m = measureBaseboard(sv, { x: (s.wallQuad[3].x + s.wallQuad[2].x) / 2, y: (s.wallQuad[3].y + s.wallQuad[2].y) / 2 - 30 });
    expect(m.heightCm).toBeGreaterThan(5);
    expect(m.heightCm).toBeLessThan(15);
  });

  it("feuille A4 sans image pleine résolution, focale EXIF, options", () => {
    const s = rendered({ reference: "a4", wallShade: 110, baseboardCm: null });
    const res = measurePhoto({ work: s.work, focalPx: s.truth.camera.focalPx / s.factor, proposeOpenings: false, proposeBaseboard: false, rectifiedScalePxPerCm: 1 });
    expect(res.failure).toBeNull();
    expect(res.reference!.sigmaPx).toBe(1.5);
    expect(res.openings).toEqual([]);
    expect(res.baseboard).toBeNull();
    expect(pctErr(res.survey!.widthCm, 400)).toBeLessThan(0.5);
    expect(res.rectifiedScalePxPerCm).toBe(1);
    // Avec image pleine résolution mais facteur 1 : pas de ré-affinage.
    const r1 = measurePhoto({ work: s.work, full: s.work, fullFactor: 1 });
    expect(r1.reference!.sigmaPx).toBe(1.5);
    // Image pleine résolution incohérente (vide) : l'affinage échoue, les coins de l'image de travail sont gardés.
    const r2 = measurePhoto({ work: s.work, full: makeGray(s.work.width * 2, s.work.height * 2, 100), fullFactor: 2 });
    expect(r2.reference!.sigmaPx).toBe(1.5);
    expect(quadErr(r2.reference!.quad, res.reference!.quad)).toBeLessThan(1e-9);
  });

  it("coins et référence fournis par l'utilisateur ; échecs signalés", () => {
    const s = rendered({ reference: "a4" });
    const manual = measurePhoto({ work: s.work, wallQuad: s.wallQuad, reference: { quad: s.refQuad!, kind: "manual_a4" } });
    expect(manual.failure).toBeNull();
    expect(manual.reference!.manual).toBe(true);
    expect(manual.survey!.displayTolerancePct).toBe(5);
    expect(manual.distortion).toBeNull();
    expect(pctErr(manual.survey!.widthCm, 400)).toBeLessThan(0.1);
    expect(manual.survey!.checks.warnings).not.toContain(WARN.floorAmbiguous);
    const mireManual = measurePhoto({ work: s.work, wallQuad: s.wallQuad, reference: { quad: s.refQuad!, kind: "mire" } });
    expect(mireManual.reference!.kind).toBe("mire");
    // Pas de référence : échec signalé, coins du mur tout de même proposés.
    const none = rendered({ reference: "none" });
    const r = measurePhoto({ work: none.work });
    expect(r.failure).toBe("no_reference");
    expect(r.survey).toBeNull();
    expect(r.wallCorners).not.toBeNull();
    // Référence fournie mais aucun mur détectable : échec « coins du mur ».
    const blank = makeGray(600, 400, 120);
    const r2 = measurePhoto({ work: blank, reference: { quad: s.refQuad!, kind: "a4" } });
    expect(r2.failure).toBe("no_wall_corners");
    // Géométrie dégénérée fournie par l'utilisateur.
    const col: Quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 100 }];
    const r3 = measurePhoto({ work: s.work, wallQuad: col, reference: { quad: s.refQuad!, kind: "a4" } });
    expect(r3.failure).toBe("degenerate_geometry");
    expect(r3.survey!.checks.warnings).toContain(WARN.degenerate);
  });

  it("bas du mur ambigu : une ligne horizontale juste sous le bord inférieur est signalée", () => {
    const s = rendered({ reference: "a4", baseboardCm: 12 });
    // On impose comme « sol » le haut de la plinthe (12 cm trop haut) : le vrai sol apparaît sous le bord → avertissement.
    const H = s.truth.H;
    const cam = makeCamera(s.truth.camera);
    const q = (x: number, y: number) => {
      const r = projectWall(cam, x, y)!;
      return { x: r.x / s.factor, y: r.y / s.factor };
    };
    const wrong: Quad = [q(0, 0), q(400, 0), q(400, H - 12), q(0, H - 12)];
    const res = measurePhoto({ work: s.work, wallQuad: wrong, reference: { quad: s.refQuad!, kind: "a4" } });
    expect(res.survey!.checks.warnings).toContain(WARN.floorAmbiguous);
    const right = measurePhoto({ work: s.work, wallQuad: s.wallQuad, reference: { quad: s.refQuad!, kind: "a4" } });
    expect(right.survey!.checks.warnings).not.toContain(WARN.floorAmbiguous);
    expect(rectify({ wallQuad: wrong, refQuad: s.refQuad!, refSizeCm: { w: 21, h: 29.7 }, refKind: "a4", imageSize: { w: s.work.width, h: s.work.height } }).heightCm).toBeLessThan(right.survey!.heightCm);
  });
});
