/**
 * Banc « coins parfaits » : vérité terrain projetée (sans rendu) → rectify. Isole la précision géométrique de
 * la rectification de celle de la détection. node dist/perfect.mjs [n]
 */
import type { Quad } from "@wallscan/core";
import { rectify } from "../src/rectify.js";
import { workFactor } from "../src/image.js";
import { gaussianNoise, mulberry32 } from "./random.js";
import { generateCase } from "./scene.js";
import { pctBelow, summaryRow } from "./stats.js";

const n = Number(process.argv[2] ?? 500);
const seed = 20261107;
const rows: Record<string, number[]> = { exactW: [], exactH: [], naiveW: [], naiveH: [], manualW: [], manualH: [], unc: [], aspect: [], opp: [] };
let warnAspect = 0;
let warnCorners = 0;
for (let i = 0; i < n; i++) {
  const c = generateCase(i, seed);
  const t = c.truth;
  if (!t.reference) continue;
  const factor = workFactor(t.camera.imageW, t.camera.imageH, 2048);
  const toWork = (q: Quad): Quad => q.map((p) => ({ x: p.x / factor, y: p.y / factor })) as Quad;
  const imageSize = { w: t.camera.imageW / factor, h: t.camera.imageH / factor };
  const wallQuad = toWork(t.wallQuadFull);
  const refQuad = toWork(t.reference.quadFull);
  const exact = rectify({ wallQuad, refQuad, refSizeCm: t.reference.sizeCm, refKind: t.reference.kind, k1: t.k1, imageSize });
  rows.exactW.push((Math.abs(exact.widthCm - t.W) / t.W) * 100);
  rows.exactH.push((Math.abs(exact.heightCm - t.H) / t.H) * 100);
  rows.unc.push(exact.uncertaintyPct);
  rows.aspect.push(exact.checks.referenceAspectPct);
  rows.opp.push(exact.checks.oppositeSidesPct);
  if (exact.checks.warnings.includes("reference_aspect_mismatch")) warnAspect++;
  if (exact.checks.warnings.includes("wall_corners_inconsistent")) warnCorners++;
  const naive = rectify({ wallQuad, refQuad, refSizeCm: t.reference.sizeCm, refKind: t.reference.kind, imageSize });
  rows.naiveW.push((Math.abs(naive.widthCm - t.W) / t.W) * 100);
  rows.naiveH.push((Math.abs(naive.heightCm - t.H) / t.H) * 100);
  // Feuille tapée à la main : bruit gaussien σ = 2 px (pleine résolution) sur chaque coin de la référence, ±1,5 px sur le mur.
  const rng = mulberry32(c.seed ^ 0x1234);
  const noisyRef = t.reference.quadFull.map((p) => ({ x: (p.x + gaussianNoise(rng) * 2) / factor, y: (p.y + gaussianNoise(rng) * 2) / factor })) as Quad;
  const noisyWall = t.wallQuadFull.map((p) => ({ x: (p.x + gaussianNoise(rng) * 1.5) / factor, y: (p.y + gaussianNoise(rng) * 1.5) / factor })) as Quad;
  const manual = rectify({ wallQuad: noisyWall, refQuad: noisyRef, refSizeCm: t.reference.sizeCm, refKind: "manual_a4", k1: t.k1, imageSize });
  rows.manualW.push((Math.abs(manual.widthCm - t.W) / t.W) * 100);
  rows.manualH.push((Math.abs(manual.heightCm - t.H) / t.H) * 100);
}
console.log(`Banc coins parfaits — ${n} cas, graine ${seed}`);
console.log("| Série | n | p50 | p95 | max |\n|---|---|---|---|---|");
console.log(summaryRow("W, k1 connu", rows.exactW));
console.log(summaryRow("H, k1 connu", rows.exactH));
console.log(summaryRow("W, sans correction de distorsion", rows.naiveW));
console.log(summaryRow("H, sans correction de distorsion", rows.naiveH));
console.log(summaryRow("W, feuille manuelle (σ 2 px)", rows.manualW));
console.log(summaryRow("H, feuille manuelle (σ 2 px)", rows.manualH));
console.log(summaryRow("Incertitude propagée (k1 connu)", rows.unc));
console.log(summaryRow("Contrôle proportions référence", rows.aspect));
console.log(summaryRow("Contrôle hauteurs G/D", rows.opp));
console.log(`Fausses alertes : proportions ${warnAspect}, coins ${warnCorners} ; manuel < 3 % : W ${pctBelow(rows.manualW, 3).toFixed(1)} %, H ${pctBelow(rows.manualH, 3).toFixed(1)} % ; < 5 % : W ${pctBelow(rows.manualW, 5).toFixed(1)} %, H ${pctBelow(rows.manualH, 5).toFixed(1)} %`);
