/**
 * Calibration de `sharpness` dans les conditions du banc de réalisme (bench/realism.ts) : scènes du banc rendues
 * DIRECTEMENT à 2 048 px (image de travail), flou ajouté composé au flou d'optique (σ = hypot(optique, ajouté)), bougé
 * horizontal, puis bruit gaussien ajouté APRÈS le flou (comme sur un capteur). Imprime la distribution de `blurPx` et le
 * verdict par condition.
 * node dist/sharpness.mjs [n=40] [premier=0]   (premier = indice du premier cas : jeu de validation disjoint)
 */
import type { GrayImage } from "@wallscan/core";
import { sharpness } from "../src/quality.js";
import { motionBlurH } from "./blur.js";
import { renderScene } from "./raster.js";
import { generateCase } from "./scene.js";
import { gaussianNoise, mulberry32 } from "./random.js";
import { summarize } from "./stats.js";

interface Cond {
  id: string;
  blur?: number;
  motion?: number;
  noise?: number;
  /** Verdicts acceptés (docs/quality-thresholds.md, banc de réalisme). */
  ok: string[];
}
const conds: Cond[] = [
  { id: "nominal", ok: ["sharp"] },
  { id: "noise-8", noise: 8, ok: ["sharp", "soft"] },
  { id: "blur-1", blur: 1, ok: ["sharp", "soft"] },
  { id: "blur-1.5", blur: 1.5, ok: ["soft", "blurry"] },
  { id: "blur-2", blur: 2, ok: ["blurry"] },
  { id: "blur-3", blur: 3, ok: ["blurry"] },
  { id: "motion-4", motion: 4, ok: ["sharp", "soft"] },
  { id: "motion-6", motion: 6, ok: ["soft", "blurry"] },
  { id: "motion-8", motion: 8, ok: ["blurry"] },
  { id: "motion-14", motion: 14, ok: ["blurry"] },
];

const n = Number(process.argv[2] ?? 40);
const first = Number(process.argv[3] ?? 0);
const blurs = new Map<string, number[]>();
const hits = new Map<string, number>();
const verdicts = new Map<string, Record<string, number>>();
for (let j = 0; j < n; j++) {
  const i = first + j;
  const c = generateCase(i, 20261107);
  const sc = c.scene;
  const s = 2048 / Math.max(sc.camera.imageW, sc.camera.imageH);
  const camera = { ...sc.camera, imageW: Math.round(sc.camera.imageW * s), imageH: Math.round(sc.camera.imageH * s), focalPx: sc.camera.focalPx * s };
  for (const cond of conds) {
    const blurSigma = cond.blur ? Math.hypot(sc.blurSigma, cond.blur) : sc.blurSigma;
    let img: GrayImage = renderScene({ ...sc, camera, blurSigma, noiseSigma: 0 }).image;
    if (cond.motion) img = motionBlurH(img, cond.motion);
    const rng = mulberry32(sc.seed ^ 0x51f15e);
    const sigma = cond.noise ?? sc.noiseSigma;
    const out = new Uint8ClampedArray(img.data.length);
    for (let k = 0; k < out.length; k++) out[k] = img.data[k] + sigma * gaussianNoise(rng);
    const r = sharpness({ width: img.width, height: img.height, data: out });
    const list = blurs.get(cond.id) ?? [];
    list.push(r.blurPx);
    blurs.set(cond.id, list);
    if (cond.ok.includes(r.verdict)) hits.set(cond.id, (hits.get(cond.id) ?? 0) + 1);
    const v = verdicts.get(cond.id) ?? {};
    v[r.verdict] = (v[r.verdict] ?? 0) + 1;
    verdicts.set(cond.id, v);
  }
  if (j % 10 === 0) console.log(`[${i}] ${conds.map((cd) => `${cd.id}=${(blurs.get(cd.id) as number[])[j].toFixed(2)}`).join(" ")}`);
}
console.log("| Condition | n | blurPx min | p50 | p95 | max | sharp / soft / blurry | verdict conforme |");
console.log("|---|---|---|---|---|---|---|---|");
for (const cd of conds) {
  const v = blurs.get(cd.id) as number[];
  const st = summarize(v);
  const vd = verdicts.get(cd.id) ?? {};
  console.log(`| ${cd.id} | ${v.length} | ${Math.min(...v).toFixed(2)} | ${st.p50.toFixed(2)} | ${st.p95.toFixed(2)} | ${st.max.toFixed(2)} | ${vd.sharp ?? 0} / ${vd.soft ?? 0} / ${vd.blurry ?? 0} | ${hits.get(cd.id) ?? 0} / ${v.length} (${cd.ok.join(" ou ")}) |`);
}
