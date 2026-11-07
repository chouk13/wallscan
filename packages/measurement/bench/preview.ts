/** Rend quelques cas du banc en PNG (réduits) pour inspection visuelle : node dist/preview.mjs [n] [dir]. */
import { mkdirSync } from "node:fs";
import { downsampleBox } from "../src/image.js";
import { writePng } from "./png.js";
import { renderScene } from "./raster.js";
import { generateCase } from "./scene.js";

const n = Number(process.argv[2] ?? 6);
const dir = process.argv[3] ?? "/tmp/wallscan-bench";
mkdirSync(dir, { recursive: true });
for (let i = 0; i < n; i++) {
  const c = generateCase(i, 20261107);
  const r = renderScene(c.scene);
  const small = downsampleBox(r.image, 4);
  writePng(`${dir}/case-${i}.png`, small);
  const t = c.truth;
  console.log(`case ${i}: ${t.W.toFixed(0)}×${t.H.toFixed(0)} cm, ${t.wallTone}, ref=${t.reference?.kind} (${t.referenceShortSidePx?.toFixed(0)} px), plinthe=${t.baseboardCm?.toFixed(1)}, ouvertures=${t.openings.map((o) => o.kind).join(",")}, k1=${t.k1.toFixed(3)}, d=${t.distanceCm.toFixed(0)}, angles=${t.anglesDeg.yaw.toFixed(0)}/${t.anglesDeg.pitch.toFixed(0)}/${t.anglesDeg.roll.toFixed(0)}, ${r.image.width}×${r.image.height}, rendu ${r.renderMs.toFixed(0)} ms`);
}
