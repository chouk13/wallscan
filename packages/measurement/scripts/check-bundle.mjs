// Vérifie que le bundle IIFE se charge dans Node et expose la globale WSMeasure avec les fonctions du contrat.
import { readFileSync } from "node:fs";
import vm from "node:vm";
const code = readFileSync(new URL("../dist/wsmeasure.iife.js", import.meta.url), "utf8");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const api = ctx.WSMeasure;
const required = ["toGray", "detectReference", "refineCorners", "proposeWallCorners", "snapToEdge", "estimateRadialDistortion", "rectify", "warpToPlane", "proposeOpenings", "measureBaseboard", "applyBaseboard", "surveyBounds", "measurePhoto", "manualMeasurement"];
const missing = required.filter((k) => typeof api?.[k] !== "function");
if (missing.length > 0) {
  console.error(`WSMeasure incomplet : ${missing.join(", ")}`);
  process.exit(1);
}
// Fumée : rectification d'un cas connu.
const wall = [{ x: 100, y: 100 }, { x: 1900, y: 100 }, { x: 1900, y: 1200 }, { x: 100, y: 1200 }];
const ref = [{ x: 950, y: 600 }, { x: 1044.5, y: 600 }, { x: 1044.5, y: 733.65 }, { x: 950, y: 733.65 }];
const s = api.rectify({ wallQuad: wall, refQuad: ref, refSizeCm: { w: 21, h: 29.7 }, refKind: "a4", imageSize: { w: 2000, h: 1300 } });
if (Math.abs(s.widthCm - 400) > 0.01 || Math.abs(s.heightCm - 244.4) > 0.1) {
  console.error(`rectify incohérent : ${s.widthCm} × ${s.heightCm}`);
  process.exit(1);
}
console.log(`WSMeasure OK : ${Object.keys(api).length} exports, ${(code.length / 1024).toFixed(0)} Ko, rectify 400 × ${s.heightCm.toFixed(1)} cm`);
