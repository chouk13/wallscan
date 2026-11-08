import { describe, expect, it } from "vitest";
import type { Quad } from "@wallscan/core";
import { CONFIDENCE_CAP_REFUSAL, CONFIDENCE_CAP_WARNING, REFUSAL_WARNINGS, WARN } from "../src/constants.js";
import { robustParabolaInliers } from "../src/distortionEstimate.js";
import { blurGray } from "../src/image.js";
import { measurePhoto, withQualityWarnings } from "../src/pipeline.js";
import { detectReference } from "../src/reference.js";
import { rectify } from "../src/rectify.js";
import { sampleQuadEdgesDense } from "../src/wallRefine.js";
import { makeTestScene } from "./helpers.js";
import { rendered } from "./scenes.js";

const surveyOf = (opts: Parameters<typeof makeTestScene>[0]) => {
  const s = makeTestScene(opts);
  return { s, survey: rectify({ wallQuad: s.wallQuad, refQuad: s.refQuad, refSizeCm: s.refSizeCm, refKind: "a4", imageSize: s.work }) };
};

describe("gardes du moteur v2 : plausibilité, cohérence feuille / mur, petite feuille", () => {
  it("mur plausible : aucun des nouveaux codes", () => {
    const { survey } = surveyOf({ W: 400, H: 250 });
    for (const c of [WARN.measureImplausible, WARN.referenceScaleSuspect, WARN.referenceSmallWarn]) expect(survey.checks.warnings).not.toContain(c);
  });

  it("hauteur ou largeur hors bornes → measure_implausible (et feuille trop grande pour le mur)", () => {
    // 153 × 81 cm : la fausse mesure du banc de réalisme (scène 14).
    const low = surveyOf({ W: 153, H: 81, position: [76, 50, -200] }).survey;
    expect(low.checks.warnings).toContain(WARN.measureImplausible);
    expect(low.checks.warnings).toContain(WARN.referenceScaleSuspect);
    const wide = surveyOf({ W: 1300, H: 300, position: [650, 160, -1100] }).survey;
    expect(wide.checks.warnings).toContain(WARN.measureImplausible);
    const tall = surveyOf({ W: 400, H: 480, position: [200, 260, -600] }).survey;
    expect(tall.checks.warnings).toContain(WARN.measureImplausible);
    const narrow = surveyOf({ W: 90, H: 250, position: [45, 140, -300] }).survey;
    expect(narrow.checks.warnings).toContain(WARN.measureImplausible);
  });

  it("feuille > 14 % de la hauteur du mur (mur plausible de 2 m) → reference_scale_suspect seul", () => {
    const w = surveyOf({ W: 400, H: 200, position: [200, 110, -380] }).survey.checks.warnings;
    expect(w).toContain(WARN.referenceScaleSuspect);
    expect(w).not.toContain(WARN.measureImplausible);
  });

  it("feuille de 40–55 px de petit côté → reference_small (avertissement), < 40 px → reference_too_small (refus)", () => {
    const mid = surveyOf({ W: 400, H: 250, factor: 4, position: [200, 140, -330] });
    const side = Math.min(Math.hypot(mid.s.refQuad[1].x - mid.s.refQuad[0].x, mid.s.refQuad[1].y - mid.s.refQuad[0].y), Math.hypot(mid.s.refQuad[3].x - mid.s.refQuad[0].x, mid.s.refQuad[3].y - mid.s.refQuad[0].y));
    expect(side).toBeGreaterThanOrEqual(40);
    expect(side).toBeLessThan(55);
    expect(mid.survey.checks.warnings).toContain(WARN.referenceSmallWarn);
    expect(mid.survey.checks.warnings).not.toContain(WARN.referenceSmall);
    expect(REFUSAL_WARNINGS).toContain(WARN.referenceSmall);
  });
});

describe("codes de qualité du pipeline (withQualityWarnings) et confiance", () => {
  const { s, survey } = surveyOf({ W: 400, H: 250 });
  const sharp = { score: 1, verdict: "sharp" as const, blurPx: 1, edgePixels: 500 };
  const ref = { kind: "a4" as const, quad: s.refQuad, confidence: 0.9, sigmaPx: 1.5, manual: false };

  it("netteté : soft / blurry ; distorsion : forte / extrême (k1 appliqué ou optimum brut)", () => {
    const base = { sharpness: sharp, reference: ref, distortion: { k1: 0, residualPct: 0 } };
    expect(withQualityWarnings(survey, base, s.refQuad).checks.warnings).toEqual(survey.checks.warnings);
    const soft = withQualityWarnings(survey, { ...base, sharpness: { ...sharp, verdict: "soft" } }, s.refQuad);
    expect(soft.checks.warnings).toContain(WARN.imageSoft);
    const blurry = withQualityWarnings(survey, { ...base, sharpness: { ...sharp, verdict: "blurry" } }, s.refQuad);
    expect(blurry.checks.warnings).toContain(WARN.imageBlurry);
    expect(withQualityWarnings(survey, { ...base, sharpness: null }, s.refQuad).checks.warnings).toEqual(survey.checks.warnings);
    const strong = withQualityWarnings(survey, { ...base, distortion: { k1: 0, residualPct: 1, rawK1: -0.07 } }, s.refQuad);
    expect(strong.checks.warnings).toContain(WARN.distortionStrong);
    const extreme = withQualityWarnings(survey, { ...base, distortion: { k1: -0.12, residualPct: 0 } }, s.refQuad);
    expect(extreme.checks.warnings).toContain(WARN.distortionExtreme);
    expect(withQualityWarnings(survey, { ...base, distortion: null }, s.refQuad).checks.warnings).toEqual(survey.checks.warnings);
  });

  it("référence ambiguë (second candidat proche) ou excentrée → reference_ambiguous ; référence manuelle : jamais", () => {
    const base = { sharpness: sharp, reference: ref, distortion: null };
    expect(withQualityWarnings(survey, { ...base, reference: { ...ref, ambiguous: true } }, s.refQuad).checks.warnings).toContain(WARN.referenceAmbiguous);
    // Référence au bord du mur (premier sixième) : excentrée.
    const corner = s.wallQuad[0];
    const off: Quad = s.refQuad.map((p) => ({ x: p.x - (s.refQuad[0].x - corner.x) + 10, y: p.y })) as Quad;
    expect(withQualityWarnings(survey, base, off).checks.warnings).toContain(WARN.referenceAmbiguous);
    expect(withQualityWarnings(survey, { ...base, reference: { ...ref, manual: true } }, off).checks.warnings).not.toContain(WARN.referenceAmbiguous);
    expect(withQualityWarnings(survey, { ...base, reference: null }, off).checks.warnings).toEqual(survey.checks.warnings);
  });

  it("pipeline : confiance plafonnée selon les codes, netteté exposée, candidats de référence exposés", () => {
    const sc = rendered({ reference: "a4", distanceCm: 420 });
    const ok = measurePhoto({ work: sc.work, proposeOpenings: false });
    expect(ok.failure).toBeNull();
    expect(ok.sharpness!.verdict).toBe("sharp");
    expect(ok.reference!.candidates!.length).toBeGreaterThanOrEqual(1);
    expect(ok.reference!.ambiguous).toBe(false);
    const reliability = ok.survey!.checks.warnings.filter((w) => w !== WARN.baseboardHeightRequired);
    if (reliability.length === 0) expect(ok.confidence).toBeGreaterThanOrEqual(0.8);
    else expect(ok.confidence).toBeLessThanOrEqual(CONFIDENCE_CAP_WARNING);
    // Photo floue (σ 2,5) : image_blurry → refus, confiance ≤ 0,5 ; contrôle désactivable.
    const blurred = blurGray(sc.work, 2.5);
    const b = measurePhoto({ work: blurred, proposeOpenings: false, proposeBaseboard: false, reference: { quad: sc.refQuad!, kind: "a4" }, wallQuad: sc.wallQuad });
    expect(b.survey!.checks.warnings).toContain(WARN.imageBlurry);
    expect(b.confidence).toBeLessThanOrEqual(CONFIDENCE_CAP_REFUSAL);
    const nb = measurePhoto({ work: blurred, proposeOpenings: false, proposeBaseboard: false, reference: { quad: sc.refQuad!, kind: "a4" }, wallQuad: sc.wallQuad, checkSharpness: false });
    expect(nb.sharpness).toBeNull();
    expect(nb.confidence).toBe(1);
    // Avertissement simple (feuille de 2 m de mur mal placée… ici : coins du mur faussés de 4 px) → ≤ 0,79.
    const skew = sc.wallQuad.map((p, i) => (i === 2 ? { x: p.x + 4, y: p.y + 25 } : p)) as Quad;
    const w = measurePhoto({ work: sc.work, proposeOpenings: false, proposeBaseboard: false, reference: { quad: sc.refQuad!, kind: "a4" }, wallQuad: skew });
    expect(w.survey!.checks.warnings.length).toBeGreaterThan(0);
    expect(w.confidence).toBeLessThanOrEqual(CONFIDENCE_CAP_WARNING);
    // Échec : confiance 0.
    expect(measurePhoto({ work: blurGray(sc.work, 0.5), referenceHint: { kind: "mire" }, proposeOpenings: false }).confidence).toBe(0);
  });

  it("detectReference : deux feuilles identiques → ambiguë, deux candidats exposés", () => {
    const sc = rendered({ reference: "a4", distanceCm: 420 });
    const img = { ...sc.work, data: new Uint8ClampedArray(sc.work.data) };
    // Copie de la feuille 300 px à droite.
    const q = sc.refQuad!;
    const x0 = Math.floor(Math.min(...q.map((p) => p.x))) - 6;
    const x1 = Math.ceil(Math.max(...q.map((p) => p.x))) + 6;
    const y0 = Math.floor(Math.min(...q.map((p) => p.y))) - 6;
    const y1 = Math.ceil(Math.max(...q.map((p) => p.y))) + 6;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data[y * img.width + x + 300] = sc.work.data[y * img.width + x];
    const det = detectReference(img)!;
    expect(det.candidates!.length).toBeGreaterThanOrEqual(2);
    expect(det.ambiguous).toBe(true);
  });
});

describe("briques internes", () => {
  it("robustParabolaInliers : points confondus (système singulier) rendus tels quels", () => {
    const same = Array.from({ length: 8 }, () => ({ x: 5, y: 5 }));
    expect(robustParabolaInliers(same, { x: 0, y: 0 }, { x: 10, y: 0 })).toHaveLength(8);
  });

  it("sampleQuadEdgesDense : fenêtre par défaut", () => {
    const sc = rendered({ reference: "a4", distanceCm: 420 });
    const polys = sampleQuadEdgesDense(sc.work, sc.wallQuad);
    expect(polys).toHaveLength(4);
    expect(polys[0].length).toBeGreaterThan(100);
  });
});
