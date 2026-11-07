import { describe, expect, it } from "vitest";
import type { Quad } from "@wallscan/core";
import { distortionDisplacementPct, distortPoint, undistortPoint } from "../src/distortion.js";
import { cameraCheck, imageToWallCm, rectify, rectifyWithFocal, referenceSizeCm } from "../src/rectify.js";
import { WARN } from "../src/constants.js";
import { makeTestScene, pctErr } from "./helpers.js";

describe("distorsion radiale (modèle de division)", () => {
  const size = { w: 4000, h: 3000 };
  it("aller-retour exact et k1 = 0 neutre", () => {
    for (const k1 of [-0.02, -0.005, 0.01, 0.02, 0.08]) {
      for (const p of [{ x: 100, y: 200 }, { x: 3900, y: 2900 }, { x: 2000, y: 1500 }, { x: 2000.3, y: 1500.2 }]) {
        const d = distortPoint(p, k1, size);
        const u = undistortPoint(d, k1, size);
        expect(Math.abs(u.x - p.x)).toBeLessThan(1e-6);
        expect(Math.abs(u.y - p.y)).toBeLessThan(1e-6);
      }
    }
    expect(undistortPoint({ x: 1, y: 2 }, 0, size)).toEqual({ x: 1, y: 2 });
    expect(distortPoint({ x: 1, y: 2 }, 0, size)).toEqual({ x: 1, y: 2 });
    expect(distortPoint({ x: 2000, y: 1500 }, 0.02, size)).toEqual({ x: 2000, y: 1500 }); // centre : rayon nul
    expect(distortionDisplacementPct({ x: 0, y: 0 }, 0.02, size)).toBeCloseTo((1 - 1 / 1.02) * 100, 9);
    expect(distortionDisplacementPct({ x: 2000, y: 1500 }, 0.02, size)).toBe(0);
    // Dérivée nulle (r_d² = 1/k1) : la boucle de Newton s'arrête sans exception.
    const extreme = distortPoint({ x: 2000 + 2500 / Math.sqrt(0.5) * 0.9999, y: 1500 }, 0.5, size);
    expect(Number.isFinite(extreme.x)).toBe(true);
  });
});

describe("rectify — coins parfaits issus d'une caméra virtuelle", () => {
  it("vue frontale : W et H exacts, échelle et homographie cohérentes", () => {
    const s = makeTestScene();
    const r = rectify({ wallQuad: s.wallQuad, refQuad: s.refQuad, refSizeCm: s.refSizeCm, refKind: "a4", imageSize: s.work });
    expect(pctErr(r.widthCm, s.W)).toBeLessThan(0.01);
    expect(pctErr(r.heightCm, s.H)).toBeLessThan(0.01);
    expect(r.heightLeftCm).toBeCloseTo(r.heightCm, 6);
    expect(r.displayTolerancePct).toBe(3);
    expect(r.reference).toBe("a4");
    expect(r.checks.warnings).toEqual([]);
    expect(r.checks.oppositeSidesPct).toBeLessThan(0.01);
    expect(r.checks.referenceAspectPct).toBeLessThan(0.05);
    expect(r.scalePxPerCm).toBeGreaterThan(3);
    expect(r.scalePxPerCm).toBeLessThanOrEqual(2048 / r.widthCm + 1e-9);
    expect(r.distortionK1).toBeUndefined();
    // L'homographie envoie le coin bas-droit du mur sur (W, H).
    const br = imageToWallCm(r, s.wallQuad[2], s.work);
    expect(br.x).toBeCloseTo(s.W, 6);
    expect(br.y).toBeCloseTo(s.H, 6);
    // Incertitude : feuille ≈ 1,5 px sur ~110 px → ≈ 1,4 %, sous la tolérance affichée.
    expect(r.uncertaintyPct).toBeGreaterThan(0.8);
    expect(r.uncertaintyPct).toBeLessThan(3);
  });

  it("vue oblique avec distorsion : exact quand k1 est connu, biaisé sinon", () => {
    const s = makeTestScene({ yawDeg: 14, pitchDeg: -9, rollDeg: 6, k1: 0.018, position: [120, 150, -420] });
    const exact = rectify({ wallQuad: s.wallQuad, refQuad: s.refQuad, refSizeCm: s.refSizeCm, refKind: "mire", k1: 0.018, imageSize: s.work });
    expect(pctErr(exact.widthCm, s.W)).toBeLessThan(0.02);
    expect(pctErr(exact.heightCm, s.H)).toBeLessThan(0.02);
    expect(exact.distortionK1).toBe(0.018);
    expect(exact.checks.distortionPct).toBeGreaterThan(0.5);
    expect(exact.checks.warnings).not.toContain(WARN.trapezoid);
    const naive = rectify({ wallQuad: s.wallQuad, refQuad: s.refQuad, refSizeCm: s.refSizeCm, refKind: "mire", imageSize: s.work });
    expect(pctErr(naive.widthCm, s.W) + pctErr(naive.heightCm, s.H)).toBeGreaterThan(0.3);
    // Hauteur sous plafond : point du bas du mur → y ≈ H.
    const mid = imageToWallCm(exact, s.wallQuad[3], s.work);
    expect(mid.y).toBeCloseTo(s.H, 5);
  });

  it("feuille tournée dans le plan du mur : W et H restent justes", () => {
    const s = makeTestScene({ yawDeg: -8, pitchDeg: 5 });
    // Feuille tournée de 3° autour de son centre (dans le plan du mur), re-projetée.
    const theta = (3 * Math.PI) / 180;
    const cx = s.W / 2;
    const cy = s.H - 160;
    const rot = (x: number, y: number): [number, number] => [cx + (x - cx) * Math.cos(theta) - (y - cy) * Math.sin(theta), cy + (x - cx) * Math.sin(theta) + (y - cy) * Math.cos(theta)];
    const corners: Array<[number, number]> = [rot(cx - 10.5, cy - 14.85), rot(cx + 10.5, cy - 14.85), rot(cx + 10.5, cy + 14.85), rot(cx - 10.5, cy + 14.85)];
    const refQuad = corners.map(([x, y]) => {
      const p = s.cam.planeToImage;
      const w = p[6] * x + p[7] * y + p[8];
      return { x: (p[0] * x + p[1] * y + p[2]) / w / s.factor, y: (p[3] * x + p[4] * y + p[5]) / w / s.factor };
    }) as Quad;
    const r = rectify({ wallQuad: s.wallQuad, refQuad, refSizeCm: s.refSizeCm, refKind: "a4", imageSize: s.work });
    expect(pctErr(r.widthCm, s.W)).toBeLessThan(0.05);
    expect(pctErr(r.heightCm, s.H)).toBeLessThan(0.05);
  });

  it("mur non rectangulaire : trapèze signalé, deux hauteurs", () => {
    const s = makeTestScene({ yawDeg: 6, pitchDeg: 4 });
    // Plafond en pente : le coin haut-droit est 12 cm plus bas (≈ 5 %).
    const p = s.cam.planeToImage;
    const proj = (x: number, y: number): { x: number; y: number } => {
      const w = p[6] * x + p[7] * y + p[8];
      return { x: (p[0] * x + p[1] * y + p[2]) / w / s.factor, y: (p[3] * x + p[4] * y + p[5]) / w / s.factor };
    };
    const wallQuad: Quad = [proj(0, 0), proj(s.W, 12), proj(s.W, s.H), proj(0, s.H)];
    const r = rectify({ wallQuad, refQuad: s.refQuad, refSizeCm: s.refSizeCm, refKind: "a4", imageSize: s.work });
    expect(r.checks.warnings).toContain(WARN.trapezoid);
    expect(r.heightLeftCm).toBeGreaterThan(r.heightRightCm);
    expect(Math.abs((r.heightLeftCm + r.heightRightCm) / 2 - r.heightCm)).toBeLessThan(1e-6);
  });

  it("feuille mal placée : écart de proportions signalé ; feuille manuelle → tolérance 5 %", () => {
    const s = makeTestScene({ yawDeg: 10, pitchDeg: 6 });
    // Coins droits de la feuille décalés de 6 px vers l'extérieur : largeur apparente +5 %.
    const refQuad: Quad = [s.refQuad[0], { x: s.refQuad[1].x + 6, y: s.refQuad[1].y }, { x: s.refQuad[2].x + 6, y: s.refQuad[2].y }, s.refQuad[3]];
    const r = rectify({ wallQuad: s.wallQuad, refQuad, refSizeCm: s.refSizeCm, refKind: "manual_a4", imageSize: s.work });
    expect(r.displayTolerancePct).toBe(5);
    expect(r.checks.referenceAspectPct).toBeGreaterThan(1.5);
    expect(r.checks.warnings).toContain(WARN.referenceAspect);
    expect(r.uncertaintyPct).toBeGreaterThan(3);
  });

  it("référence trop petite, focale EXIF fournie, distorsion forte", () => {
    const s = makeTestScene({ W: 700, H: 280, position: [350, 170, -650], imageW: 1600, imageH: 1200, factor: 1, k1: 0.05 });
    const r = rectify({ wallQuad: s.wallQuad, refQuad: s.refQuad, refSizeCm: s.refSizeCm, refKind: "a4", imageSize: s.work, k1: 0.05, focalPx: s.cam.focalPx });
    expect(r.checks.warnings).toContain(WARN.referenceSmall);
    expect(r.checks.warnings).toContain(WARN.uncertaintyHigh);
    expect(r.checks.warnings).toContain(WARN.distortionHigh);
    expect(pctErr(r.widthCm, s.W)).toBeLessThan(0.05);
  });

  it("coins incohérents : contrôle « coin mal placé »", () => {
    const s = makeTestScene({ yawDeg: 0, pitchDeg: 0 });
    // Vue frontale : les points de fuite sont à l'infini, la focale est supposée ; un coin déplacé de 40 px casse le rectangle.
    const wallQuad: Quad = [s.wallQuad[0], s.wallQuad[1], { x: s.wallQuad[2].x - 40, y: s.wallQuad[2].y }, s.wallQuad[3]];
    const r = rectify({ wallQuad, refQuad: s.refQuad, refSizeCm: s.refSizeCm, refKind: "a4", imageSize: s.work });
    expect(r.checks.oppositeSidesPct).toBeGreaterThan(1);
    expect(r.checks.warnings).toContain(WARN.wallCorners);
  });

  it("entrées dégénérées : survey nul avec avertissement, jamais d'exception", () => {
    const s = makeTestScene();
    const nan: Quad = [{ x: Number.NaN, y: 0 }, s.wallQuad[1], s.wallQuad[2], s.wallQuad[3]];
    expect(rectify({ wallQuad: nan, refQuad: s.refQuad, refSizeCm: s.refSizeCm, refKind: "a4", imageSize: s.work }).checks.warnings).toEqual([WARN.degenerate]);
    expect(rectify({ wallQuad: s.wallQuad, refQuad: s.refQuad, refSizeCm: { w: 0, h: 29.7 }, refKind: "a4", imageSize: s.work }).widthCm).toBe(0);
    expect(rectify({ wallQuad: s.wallQuad, refQuad: s.refQuad, refSizeCm: s.refSizeCm, refKind: "a4", imageSize: { w: 0, h: 0 } }).widthCm).toBe(0);
    const col: Quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 100 }];
    expect(rectify({ wallQuad: col, refQuad: s.refQuad, refSizeCm: s.refSizeCm, refKind: "a4", imageSize: s.work }).checks.warnings).toEqual([WARN.degenerate]);
    // Référence à l'envers (ordre inversé) : orientation invalide.
    const flipped: Quad = [s.refQuad[1], s.refQuad[0], s.refQuad[3], s.refQuad[2]];
    const f = rectify({ wallQuad: s.wallQuad, refQuad: flipped, refSizeCm: s.refSizeCm, refKind: "manual_a4", imageSize: s.work });
    expect(f.checks.warnings).toContain(WARN.referenceOrientation);
    expect(f.displayTolerancePct).toBe(5);
    // Référence de taille physique absurde : W < 1 cm → dégénéré.
    expect(rectify({ wallQuad: s.wallQuad, refQuad: s.refQuad, refSizeCm: { w: 0.001, h: 0.001 }, refKind: "a4", imageSize: s.work }).checks.warnings).toEqual([WARN.degenerate]);
    // Verticales parallèles et ligne de sol passant par le centre optique : l'horizon coupe le mur, contrôle caméra impossible.
    const through: Quad = [{ x: 200, y: 100 }, { x: 1800, y: 100 }, { x: 1800, y: 850 }, { x: 200, y: 650 }];
    const small: Quad = [{ x: 980, y: 300 }, { x: 1020, y: 300 }, { x: 1020, y: 356 }, { x: 980, y: 356 }];
    const noCam = rectify({ wallQuad: through, refQuad: small, refSizeCm: s.refSizeCm, refKind: "a4", imageSize: s.work });
    expect(noCam.checks.warnings).toContain(WARN.geometryCheckUnavailable);
    expect(noCam.widthCm).toBeGreaterThan(1);
    // Référence minuscule (1e-6 px) : W infini → dégénéré.
    const tiny: Quad = [{ x: 1000, y: 700 }, { x: 1000.000001, y: 700 }, { x: 1000.000001, y: 700.000001 }, { x: 1000, y: 700.000001 }];
    expect(rectify({ wallQuad: s.wallQuad, refQuad: tiny, refSizeCm: s.refSizeCm, refKind: "a4", imageSize: s.work }).checks.warnings).toContain(WARN.degenerate);
  });

  it("orientation de la référence : portrait / paysage, mire", () => {
    const s = makeTestScene();
    expect(referenceSizeCm("a4", s.refQuad)).toEqual({ w: 21, h: 29.7 });
    const landscape: Quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
    expect(referenceSizeCm("a4", landscape)).toEqual({ w: 29.7, h: 21 });
    expect(referenceSizeCm("mire", landscape)).toEqual({ w: 27.7, h: 19 });
    expect(referenceSizeCm("manual_a4", s.refQuad)).toEqual({ w: 21, h: 29.7 });
  });
});

describe("cameraCheck — redressement par horizon et balayage de focale", () => {
  const size = { w: 2000, h: 1500 };
  it("quad rectangle parfait : proportions dans la plage, pas d'écart de hauteurs", () => {
    const s = makeTestScene({ yawDeg: 15, pitchDeg: -10, rollDeg: 3 });
    const c = cameraCheck(s.wallQuad, s.work)!;
    expect(c.focalKnown).toBe(false);
    expect(c.oppositeSidesPct).toBeLessThan(0.01);
    expect(c.aspectMin).toBeLessThanOrEqual(s.W / s.H + 1e-6);
    expect(c.aspectMax).toBeGreaterThanOrEqual(s.W / s.H - 1e-6);
    // Focale EXIF : plage étroite, proportions exactes.
    const k = cameraCheck(s.wallQuad, s.work, s.cam.focalPx / s.factor)!;
    expect(k.focalKnown).toBe(true);
    expect(pctErr(k.aspect, s.W / s.H)).toBeLessThan(0.3);
    expect(k.aspectMax - k.aspectMin).toBeLessThan(0.05);
  });
  it("trapèze détecté avec la focale connue, atténué sans", () => {
    const s = makeTestScene({ yawDeg: 12, pitchDeg: 8, rollDeg: -4 });
    const p = s.cam.planeToImage;
    const proj = (x: number, y: number): { x: number; y: number } => {
      const w = p[6] * x + p[7] * y + p[8];
      return { x: (p[0] * x + p[1] * y + p[2]) / w / s.factor, y: (p[3] * x + p[4] * y + p[5]) / w / s.factor };
    };
    const trap: Quad = [proj(0, 0), proj(s.W, 12), proj(s.W, s.H), proj(0, s.H)];
    const known = cameraCheck(trap, s.work, s.cam.focalPx / s.factor)!;
    expect(known.oppositeSidesPct).toBeGreaterThan(3);
    expect(known.oppositeSidesPct).toBeLessThan(6);
    expect(known.leftRel).toBeGreaterThan(known.rightRel);
    const unknown = cameraCheck(trap, s.work)!;
    expect(unknown.oppositeSidesPct).toBeLessThanOrEqual(known.oppositeSidesPct + 1e-9);
  });
  it("vue frontale : indépendant de la focale ; dégénérescences → null", () => {
    const frontal: Quad = [{ x: 200, y: 200 }, { x: 1800, y: 200 }, { x: 1800, y: 1300 }, { x: 200, y: 1300 }];
    const c = cameraCheck(frontal, size)!;
    expect(c.aspect).toBeCloseTo(1600 / 1100, 9);
    expect(c.aspectMax - c.aspectMin).toBeLessThan(1e-9);
    expect(c.oppositeSidesPct).toBeLessThan(1e-9);
    // Tous les points alignés : normale indéfinie.
    const line: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
    expect(cameraCheck(line, size)).toBeNull();
    // Deux points confondus : droite nulle → direction nulle.
    const dup: Quad = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1800, y: 1300 }, { x: 200, y: 1300 }];
    expect(cameraCheck(dup, size)).toBeNull();
    // Quad « papillon » : signes mixtes.
    const bowtie: Quad = [{ x: 200, y: 200 }, { x: 1800, y: 1300 }, { x: 1800, y: 200 }, { x: 200, y: 1300 }];
    expect(cameraCheck(bowtie, size)).toBeNull();
    // Côté gauche réduit à un point : direction verticale indéfinie.
    const flat: Quad = [{ x: 200, y: 1300 }, { x: 1800, y: 200 }, { x: 1800, y: 1300 }, { x: 200, y: 1300 }];
    expect(rectifyWithFocal(flat, size, 1500)).toBeNull();
  });
});
