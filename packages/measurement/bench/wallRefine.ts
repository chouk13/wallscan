/**
 * Banc « coins tapés » : coins du mur vérité + bruit gaussien σ 3 px (image de travail, ≈ coin tapé au doigt avec la loupe),
 * puis `refineWallQuad` sur l'image pleine résolution. Référence = vérité (isole l'effet des coins du mur), k1 = vérité.
 * Compare aussi l'estimation de k1 : chemin v1 (lignes suivies sur l'image de travail) vs polylignes pleine résolution.
 * node dist/wallrefine.mjs [n=120] [seed=20261107]
 */
import type { Quad } from "@wallscan/core";
import { estimateRadialDistortion, estimateRadialDistortionFromPolylines } from "../src/distortionEstimate.js";
import { workImage } from "../src/image.js";
import { rectify } from "../src/rectify.js";
import { refineWallQuad, sampleQuadEdgesDense } from "../src/wallRefine.js";
import { proposeWallCorners } from "../src/wallCorners.js";
import { quadCenter } from "../src/segment.js";
import { renderScene } from "./raster.js";
import { generateCase } from "./scene.js";
import { gaussianNoise, mulberry32 } from "./random.js";
import { fmt, pctBelow, summarize } from "./stats.js";

const n = Number(process.argv[2] ?? 120);
const seed = Number(process.argv[3] ?? 20261107);
const typedErr: number[] = [];
const refinedErr: number[] = [];
const typedPct: number[] = [];
const refinedPct: number[] = [];
const k1Old: number[] = [];
const k1New: number[] = [];
const ms: number[] = [];
let refinedCount = 0;
let total = 0;
const quadErr = (a: Quad, b: Quad): number => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
for (let i = 0; i < n; i++) {
  const c = generateCase(i, seed);
  const t = c.truth;
  if (!t.reference) continue;
  const full = renderScene(c.scene).image;
  const { img: work, factor } = workImage(full, 2048);
  const size = { w: work.width, h: work.height };
  const toWork = (q: Quad): Quad => q.map((p) => ({ x: p.x / factor, y: p.y / factor })) as Quad;
  const truthWall = toWork(t.wallQuadFull);
  const refQuad = toWork(t.reference.quadFull);
  const rng = mulberry32(seed ^ (i * 7919));
  const typed = truthWall.map((p) => ({ x: p.x + 3 * gaussianNoise(rng), y: p.y + 3 * gaussianNoise(rng) })) as Quad;
  // Coins hors image (mur plus grand que le cadre) : non tapables, cas ignoré.
  if (!typed.every((p) => p.x > 2 && p.y > 2 && p.x < size.w - 2 && p.y < size.h - 2)) continue;
  total++;
  const t0 = performance.now();
  const r = refineWallQuad(full, typed.map((p) => ({ x: p.x * factor, y: p.y * factor })) as Quad, { searchPx: 5 * factor + 4, k1: t.k1 });
  ms.push(performance.now() - t0);
  if (r.refined) refinedCount++;
  const refined = r.quad.map((p) => ({ x: p.x / factor, y: p.y / factor })) as Quad;
  typedErr.push(quadErr(typed, truthWall));
  refinedErr.push(quadErr(refined, truthWall));
  const err = (q: Quad): number => {
    const s = rectify({ wallQuad: q, refQuad, refSizeCm: t.reference!.sizeCm, refKind: t.reference!.kind, k1: t.k1, imageSize: size });
    return Math.max((Math.abs(s.widthCm - t.W) / t.W) * 100, (Math.abs(s.heightCm - t.H) / t.H) * 100);
  };
  typedPct.push(err(typed));
  refinedPct.push(err(refined));
  // k1 : v1 (lignes de proposeWallCorners suivies sur l'image de travail) vs polylignes pleine résolution sur le même quad.
  const prop = proposeWallCorners(work, { inside: quadCenter(refQuad) });
  if (prop) {
    k1Old.push(Math.abs(estimateRadialDistortion(work, prop.lines).k1 - t.k1) * 1000);
    const fq = prop.quad.map((p) => ({ x: p.x * factor, y: p.y * factor })) as Quad;
    const polys = sampleQuadEdgesDense(full, fq, { searchPx: 2 * factor + 4 }).map((l) => l.map((p) => ({ x: p.x / factor, y: p.y / factor })));
    k1New.push(Math.abs(estimateRadialDistortionFromPolylines(polys, size).k1 - t.k1) * 1000);
  }
  if (i % 20 === 0) console.log(`[${i}] tapé ${fmt(typedErr.at(-1)!)} px → ${fmt(refinedErr.at(-1)!)} px ; ${fmt(typedPct.at(-1)!)} % → ${fmt(refinedPct.at(-1)!)} %`);
}
const row = (label: string, v: number[], unit: string): string => {
  const s = summarize(v);
  return `| ${label} | ${s.n} | ${fmt(s.p50)}${unit} | ${fmt(s.p95)}${unit} | ${fmt(s.max)}${unit} |`;
};
console.log(`\nCas : ${total} ; quads entièrement affinés : ${refinedCount} (${fmt((refinedCount / Math.max(1, total)) * 100, 1)} %)`);
console.log("| Série | n | p50 | p95 | max |\n|---|---|---|---|---|");
console.log(row("Coins tapés σ 3 px — erreur max des coins (px travail)", typedErr, " px"));
console.log(row("Après refineWallQuad — erreur max des coins (px travail)", refinedErr, " px"));
console.log(row("Coins tapés — erreur max(W, H)", typedPct, " %"));
console.log(row("Après refineWallQuad — erreur max(W, H)", refinedPct, " %"));
console.log(row("Erreur sur k1 ×1000 — v1 (image de travail)", k1Old, ""));
console.log(row("Erreur sur k1 ×1000 — polylignes pleine résolution", k1New, ""));
console.log(row("Temps refineWallQuad (ms)", ms, " ms"));
console.log(`max(W,H) < 0,5 % : tapés ${fmt(pctBelow(typedPct, 0.5), 1)} % → affinés ${fmt(pctBelow(refinedPct, 0.5), 1)} %`);
