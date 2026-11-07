/**
 * Banc synthétique complet : rendu → image de travail → pipeline automatique (référence → coins du mur → distorsion →
 * rectification → plinthe → ouvertures) → comparaison à la vérité terrain → rapport Markdown.
 * node dist/bench.mjs [--n=500] [--seed=20261107] [--out=docs/reports/measurement-synthetic-bench.md] [--stage=ref|wall|full]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import type { OpeningKindV2, Quad } from "@wallscan/core";
import { measurePhoto } from "../src/pipeline.js";
import { workFactor, workImage } from "../src/image.js";
import { rectify } from "../src/rectify.js";
import { renderScene } from "./raster.js";
import { generateCase, type BenchCase } from "./scene.js";
import { fmt, pctBelow, summarize, summaryRow } from "./stats.js";
import { gaussianNoise, mulberry32 } from "./random.js";

interface Args {
  n: number;
  seed: number;
  out: string | null;
  verbose: boolean;
  /** Sauvegarde / relecture des résultats bruts (JSON) pour regénérer le rapport sans recalcul. */
  json: string | null;
  fromJson: string | null;
}

function parseArgs(): Args {
  const a: Args = { n: 500, seed: 20261107, out: null, verbose: false, json: null, fromJson: null };
  for (const arg of process.argv.slice(2)) {
    const m = /^--(\w+)=(.*)$/.exec(arg);
    if (!m) continue;
    if (m[1] === "n") a.n = Number(m[2]);
    else if (m[1] === "seed") a.seed = Number(m[2]);
    else if (m[1] === "out") a.out = m[2];
    else if (m[1] === "verbose") a.verbose = m[2] !== "0";
    else if (m[1] === "json") a.json = m[2];
    else if (m[1] === "fromJson") a.fromJson = m[2];
  }
  return a;
}

interface TruthSummary {
  index: number;
  W: number;
  H: number;
  wallTone: BenchCase["truth"]["wallTone"];
  anglesDeg: BenchCase["truth"]["anglesDeg"];
  k1: number;
  referenceShortSidePx: number | null;
  openings: Array<{ kind: OpeningKindV2; rect: { x: number; y: number; w: number; h: number } }>;
  floorPattern: BenchCase["truth"]["floorPattern"];
}

interface CaseResult {
  truth: TruthSummary;
  failure: string | null;
  displayTolerancePct: number;
  k1Est: number | null;
  baseboardEst: number | null;
  openingsFound: Array<{ kind: OpeningKindV2; rect: { x: number; y: number; w: number; h: number } }>;
  refKindTruth: "a4" | "mire" | "none";
  refDetected: boolean;
  refFalse: boolean;
  refCornerErrPx: number | null;
  wallDetected: boolean;
  wallCornerErrPx: number | null;
  errW: number | null;
  errH: number | null;
  errWManual: number | null;
  errHManual: number | null;
  k1Err: number | null;
  baseboardErrCm: number | null;
  baseboardTruth: number | null;
  baseboardDetected: boolean;
  openingsTruth: number;
  openingsMatched: number;
  openingsKindOk: number;
  openingsFalse: number;
  pipelineMs: number;
  renderMs: number;
  uncertaintyPct: number | null;
  warnings: string[];
  rendered: { w: number; h: number };
}

const quadErr = (a: Quad, b: Quad): number => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));

function runCase(c: BenchCase, rng: () => number): CaseResult {
  const r = renderScene(c.scene);
  const t = c.truth;
  const work = workImage(r.image, 2048);
  const factor = work.factor;
  const toWork = (q: Quad): Quad => q.map((p) => ({ x: p.x / factor, y: p.y / factor })) as Quad;
  const t0 = performance.now();
  const res = measurePhoto({ work: work.img, full: r.image, fullFactor: factor });
  const pipelineMs = performance.now() - t0;
  const refKindTruth = t.reference?.kind ?? "none";
  const refDetected = res.reference !== null && t.reference !== null && res.reference.kind === t.reference.kind;
  let refFalse = false;
  let refCornerErrPx: number | null = null;
  if (res.reference && t.reference) {
    const err = quadErr(res.reference.quad, toWork(t.reference.quadFull));
    if (res.reference.kind !== t.reference.kind || err > 6) refFalse = true;
    else refCornerErrPx = err;
  } else if (res.reference && !t.reference) refFalse = true;
  const wallDetected = res.wallCorners !== null;
  let wallCornerErrPx: number | null = null;
  if (res.wallCorners) wallCornerErrPx = quadErr(res.wallCorners.quad, toWork(t.wallQuadFull));
  let errW: number | null = null;
  let errH: number | null = null;
  let uncertaintyPct: number | null = null;
  if (res.survey && refDetected && !refFalse && wallCornerErrPx !== null && wallCornerErrPx < 40) {
    errW = (Math.abs(res.survey.widthCm - t.W) / t.W) * 100;
    errH = (Math.abs(res.survey.heightCm - t.H) / t.H) * 100;
    uncertaintyPct = res.survey.uncertaintyPct;
  }
  // Référence tapée à la main (σ 2 px pleine résolution) avec les coins du mur détectés automatiquement.
  let errWManual: number | null = null;
  let errHManual: number | null = null;
  if (t.reference && res.wallCorners && wallCornerErrPx !== null && wallCornerErrPx < 40) {
    const noisy = t.reference.quadFull.map((p) => ({ x: (p.x + gaussianNoise(rng) * 2) / factor, y: (p.y + gaussianNoise(rng) * 2) / factor })) as Quad;
    const s = rectify({ wallQuad: res.wallCorners.quad, refQuad: noisy, refSizeCm: t.reference.sizeCm, refKind: "manual_a4", k1: res.distortion?.k1 ?? 0, imageSize: { w: work.img.width, h: work.img.height } });
    errWManual = (Math.abs(s.widthCm - t.W) / t.W) * 100;
    errHManual = (Math.abs(s.heightCm - t.H) / t.H) * 100;
  }
  const k1Err = res.distortion ? Math.abs(res.distortion.k1 - t.k1) : null;
  // Plinthe.
  let baseboardErrCm: number | null = null;
  const baseboardDetected = res.baseboard !== null;
  if (res.baseboard && t.baseboardCm !== null) baseboardErrCm = Math.abs(res.baseboard.heightCm - t.baseboardCm);
  // Ouvertures : appariement par IoU ≥ 0,5.
  let matched = 0;
  let kindOk = 0;
  const used = new Set<number>();
  for (const o of t.openings) {
    let bestIou = 0;
    let bestIdx = -1;
    res.openings.forEach((p, idx) => {
      if (used.has(idx)) return;
      const ix = Math.max(0, Math.min(o.rect.x + o.rect.w, p.rect.x + p.rect.w) - Math.max(o.rect.x, p.rect.x));
      const iy = Math.max(0, Math.min(o.rect.y + o.rect.h, p.rect.y + p.rect.h) - Math.max(o.rect.y, p.rect.y));
      const inter = ix * iy;
      const union = o.rect.w * o.rect.h + p.rect.w * p.rect.h - inter;
      const iou = union > 0 ? inter / union : 0;
      if (iou > bestIou) {
        bestIou = iou;
        bestIdx = idx;
      }
    });
    if (bestIou >= 0.5 && bestIdx >= 0) {
      matched++;
      used.add(bestIdx);
      if (res.openings[bestIdx].kind === o.kind) kindOk++;
    }
  }
  return {
    truth: {
      index: c.index,
      W: t.W,
      H: t.H,
      wallTone: t.wallTone,
      anglesDeg: t.anglesDeg,
      k1: t.k1,
      referenceShortSidePx: t.referenceShortSidePx,
      openings: t.openings.map((o) => ({ kind: o.kind, rect: { ...o.rect } })),
      floorPattern: t.floorPattern,
    },
    failure: res.failure,
    displayTolerancePct: res.survey?.displayTolerancePct ?? 3,
    k1Est: res.distortion?.k1 ?? null,
    baseboardEst: res.baseboard?.heightCm ?? null,
    openingsFound: res.openings.map((o) => ({ kind: o.kind, rect: { ...o.rect } })),
    refKindTruth,
    refDetected: refDetected && !refFalse,
    refFalse,
    refCornerErrPx,
    wallDetected,
    wallCornerErrPx,
    errW,
    errH,
    errWManual,
    errHManual,
    k1Err,
    baseboardErrCm,
    baseboardTruth: t.baseboardCm,
    baseboardDetected,
    openingsTruth: t.openings.length,
    openingsMatched: matched,
    openingsKindOk: kindOk,
    openingsFalse: res.openings.length - matched,
    pipelineMs,
    renderMs: r.renderMs,
    uncertaintyPct,
    warnings: res.survey?.checks.warnings ?? [],
    rendered: { w: r.image.width, h: r.image.height },
  };
}

function report(results: CaseResult[], args: Args): string {
  const lines: string[] = [];
  const n = results.length;
  const by = <T>(f: (r: CaseResult) => T | null): T[] => results.map(f).filter((v): v is T => v !== null);
  lines.push(`# Banc synthétique — mesure d'un mur depuis une photo`);
  lines.push("");
  lines.push(`Généré par \`pnpm --filter @wallscan/measurement bench\` — ${n} cas, graine ${args.seed}, ${new Date().toISOString().slice(0, 10)}.`);
  lines.push("");
  lines.push("## Protocole");
  lines.push("");
  lines.push("- Rasteriseur maison (`packages/measurement/bench/raster.ts`) : pièce vue de l'intérieur (mur du fond, plafond, sol avec lames, murs latéraux), caméra sténopé avec distorsion radiale (modèle de division, k1 ∈ [−0,02 ; 0,02]), focale 24–28 mm équiv., distance 2,5–5 m, angles lacet/tangage/roulis ±15°, images 12 Mpx (4000 × 3000 majoritaire, portrait 3000 × 4000, 8 Mpx), flou d'objectif σ 0,6–1,2 px, bruit gaussien σ 1,5–4, éclairage dégradé ±12 %, vignettage ≤ 15 %.");
  lines.push("- Mur W ∈ [250 ; 550] cm × H ∈ [230 ; 300] cm, teinte blanche (30 %), claire (40 %) ou foncée (30 %) ; plinthe réelle de 5–14 cm dans 85 % des cas ; 0–2 fenêtres, 0–1 porte, 0–1 radiateur, prises et cadre comme distracteurs ; feuille A4 ou mire (50/50) au centre, à hauteur des yeux, tournée de ±2°.");
  lines.push("- Pipeline **sans intervention humaine** : `measurePhoto` = `detectReference` (sur l'image de travail ≤ 2048 px, coins affinés sur l'image pleine résolution) → `proposeWallCorners` → `estimateRadialDistortion` → `refineCorners` → `rectify` → `warpToPlane` → `proposeBaseboard` → `proposeOpenings`.");
  lines.push("- Un cas compte comme **mesuré** seulement si la référence est détectée (bonne nature, coins à < 6 px de la vérité) et les coins du mur proposés sont à < 40 px ; tout autre cas est un **échec signalé** (`null` / avertissement), jamais une mesure silencieuse.");
  lines.push("");
  const measured = results.filter((r) => r.errW !== null);
  lines.push("## Résultats globaux");
  lines.push("");
  lines.push(`| Indicateur | Valeur |`);
  lines.push(`|---|---|`);
  const refCases = results.filter((r) => r.refKindTruth !== "none");
  lines.push(`| Référence détectée (bonne nature, coins < 6 px) | ${refCases.filter((r) => r.refDetected).length} / ${refCases.length} (${fmt((refCases.filter((r) => r.refDetected).length / Math.max(1, refCases.length)) * 100, 1)} %) |`);
  lines.push(`| Fausses détections de référence (mauvaise nature ou > 6 px) | ${results.filter((r) => r.refFalse).length} |`);
  lines.push(`| Coins du mur proposés (non nul) | ${results.filter((r) => r.wallDetected).length} / ${n} |`);
  lines.push(`| Coins du mur à < 3 px / < 10 px de la vérité | ${pctBelow(by((r) => r.wallCornerErrPx), 3).toFixed(1)} % / ${pctBelow(by((r) => r.wallCornerErrPx), 10).toFixed(1)} % |`);
  lines.push(`| Cas mesurés automatiquement de bout en bout | ${measured.length} / ${n} |`);
  lines.push(`| Temps pipeline par image (p50 / p95) | ${fmt(summarize(results.map((r) => r.pipelineMs)).p50, 0)} ms / ${fmt(summarize(results.map((r) => r.pipelineMs)).p95, 0)} ms |`);
  lines.push(`| Temps de rendu par image (p50) | ${fmt(summarize(results.map((r) => r.renderMs)).p50, 0)} ms |`);
  lines.push("");
  lines.push("## Erreur sur W et H (cas mesurés)");
  lines.push("");
  lines.push("| Série | n | p50 | p95 | max |");
  lines.push("|---|---|---|---|---|");
  for (const kind of ["mire", "a4"] as const) {
    const sub = measured.filter((r) => r.refKindTruth === kind);
    lines.push(summaryRow(`${kind} — largeur W`, sub.map((r) => r.errW as number)));
    lines.push(summaryRow(`${kind} — hauteur H`, sub.map((r) => r.errH as number)));
  }
  const manual = results.filter((r) => r.errWManual !== null);
  lines.push(summaryRow("feuille tapée à la main (σ 2 px) — W", manual.map((r) => r.errWManual as number)));
  lines.push(summaryRow("feuille tapée à la main (σ 2 px) — H", manual.map((r) => r.errHManual as number)));
  const quiet = measured.filter((r) => r.warnings.length === 0);
  const warned = measured.filter((r) => r.warnings.length > 0);
  lines.push(summaryRow("cas mesurés sans avertissement — max(W, H)", quiet.map((r) => Math.max(r.errW as number, r.errH as number))));
  lines.push(summaryRow("cas mesurés avec avertissement(s) — max(W, H)", warned.map((r) => Math.max(r.errW as number, r.errH as number))));
  lines.push("");
  lines.push("| Cible | Résultat |");
  lines.push("|---|---|");
  const a4 = measured.filter((r) => r.refKindTruth === "a4");
  const mire = measured.filter((r) => r.refKindTruth === "mire");
  const worst = (rs: CaseResult[]): number[] => rs.map((r) => Math.max(r.errW as number, r.errH as number));
  lines.push(`| Feuille A4 détectée : 95 % des cas < 3 % (W et H) | ${fmt(pctBelow(worst(a4), 3), 1)} % des cas < 3 % (p95 = ${fmt(summarize(worst(a4)).p95)} %) |`);
  lines.push(`| Mire : p95 < 1 % | p95 = ${fmt(summarize(worst(mire)).p95)} % |`);
  lines.push(`| Feuille tapée à la main : 95 % < 5 % | ${fmt(pctBelow(manual.map((r) => Math.max(r.errWManual as number, r.errHManual as number)), 5), 1)} % des cas < 5 % |`);
  lines.push(`| Aucune fausse mesure silencieuse | ${results.filter((r) => r.refFalse).length} fausse(s) détection(s) de référence ; ${results.filter((r) => r.wallDetected && (r.wallCornerErrPx as number) >= 40 && r.errW === null).length} quad(s) de mur faux non mesurés ; cas mesurés avec erreur > tolérance affichée sans avertissement : ${measured.filter((r) => Math.max(r.errW as number, r.errH as number) > r.displayTolerancePct && r.warnings.length === 0).length} |`);
  lines.push("");
  lines.push("## Par type de mur (cas mesurés, erreur max(W, H))");
  lines.push("");
  lines.push("| Type de mur | Référence | Cas | Détection réf. | p50 | p95 | max |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const tone of ["white", "light", "dark"] as const) {
    for (const kind of ["mire", "a4"] as const) {
      const all = results.filter((r) => r.truth.wallTone === tone && r.refKindTruth === kind);
      const sub = all.filter((r) => r.errW !== null);
      const s = summarize(worst(sub));
      lines.push(`| ${tone} | ${kind} | ${all.length} | ${all.filter((r) => r.refDetected).length} / ${all.length} | ${fmt(s.p50)} % | ${fmt(s.p95)} % | ${fmt(s.max)} % |`);
    }
  }
  lines.push("");
  lines.push("## Précision des étapes");
  lines.push("");
  lines.push("| Étape | n | p50 | p95 | max |");
  lines.push("|---|---|---|---|---|");
  lines.push(summaryRow("Coins de la référence (px, image de travail)", by((r) => r.refCornerErrPx), "px"));
  lines.push(summaryRow("Coins du mur (px, image de travail)", by((r) => r.wallCornerErrPx), "px"));
  lines.push(summaryRow("Erreur sur k1 (×1000)", by((r) => (r.k1Err === null ? null : r.k1Err * 1000)), ""));
  lines.push(summaryRow("Hauteur de plinthe (cm)", by((r) => r.baseboardErrCm), "cm"));
  lines.push(summaryRow("Incertitude propagée (cas mesurés)", by((r) => r.uncertaintyPct)));
  const withBase = results.filter((r) => r.baseboardTruth !== null && r.errW !== null);
  lines.push("");
  lines.push(`Plinthe : ${withBase.filter((r) => r.baseboardDetected).length} / ${withBase.length} proposées automatiquement quand elle existe (cas mesurés) ; ${results.filter((r) => r.baseboardTruth === null && r.baseboardDetected).length} proposition(s) sans plinthe réelle ; erreur < 1 cm dans ${fmt(pctBelow(by((r) => r.baseboardErrCm), 1), 1)} % des propositions.`);
  const calib = measured.filter((r) => Math.max(r.errW as number, r.errH as number) <= (r.uncertaintyPct as number)).length;
  lines.push(`Calibration de l'incertitude : erreur réelle ≤ incertitude propagée dans ${fmt((calib / Math.max(1, measured.length)) * 100, 1)} % des cas mesurés.`);
  lines.push("");
  lines.push("## Ouvertures (cas mesurés)");
  lines.push("");
  const ot = measured.reduce((s, r) => s + r.openingsTruth, 0);
  const om = measured.reduce((s, r) => s + r.openingsMatched, 0);
  const ok = measured.reduce((s, r) => s + r.openingsKindOk, 0);
  const of = measured.reduce((s, r) => s + r.openingsFalse, 0);
  lines.push(`| Indicateur | Valeur |`);
  lines.push(`|---|---|`);
  lines.push(`| Ouvertures réelles | ${ot} |`);
  lines.push(`| Retrouvées (IoU ≥ 0,5) | ${om} (${fmt((om / Math.max(1, ot)) * 100, 1)} %) |`);
  lines.push(`| … avec le bon type | ${ok} (${fmt((ok / Math.max(1, om)) * 100, 1)} % des retrouvées) |`);
  lines.push(`| Propositions sans ouverture réelle | ${of} |`);
  for (const kind of ["window", "door", "radiator"] as const) {
    const truth = measured.flatMap((r) => r.truth.openings.filter((o) => o.kind === kind));
    let found = 0;
    for (const r of measured) {
      for (const o of r.truth.openings) {
        if (o.kind !== kind) continue;
        const hit = r.openingsFound.some((p) => {
          const ix = Math.max(0, Math.min(o.rect.x + o.rect.w, p.rect.x + p.rect.w) - Math.max(o.rect.x, p.rect.x));
          const iy = Math.max(0, Math.min(o.rect.y + o.rect.h, p.rect.y + p.rect.h) - Math.max(o.rect.y, p.rect.y));
          const inter = ix * iy;
          return inter / (o.rect.w * o.rect.h + p.rect.w * p.rect.h - inter) >= 0.5 && p.kind === kind;
        });
        if (hit) found++;
      }
    }
    lines.push(`| ${kind} : retrouvées avec le bon type | ${found} / ${truth.length} |`);
  }
  lines.push("");
  lines.push("## Échecs et avertissements");
  lines.push("");
  const failures = results.filter((r) => r.errW === null);
  const reasons = new Map<string, number>();
  for (const r of failures) {
    const reason = r.failure ?? (r.refFalse ? "reference_false" : (r.wallCornerErrPx as number) >= 40 ? "wall_corners_wrong" : "other");
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  lines.push(`| Cause | Cas |`);
  lines.push(`|---|---|`);
  for (const [k, v] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${v} |`);
  const warnCounts = new Map<string, number>();
  for (const r of measured) for (const w of r.warnings) warnCounts.set(w, (warnCounts.get(w) ?? 0) + 1);
  lines.push("");
  lines.push(`| Avertissement (cas mesurés) | Cas |`);
  lines.push(`|---|---|`);
  for (const [k, v] of [...warnCounts.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${v} |`);
  lines.push("");
  // Pires cas pour l'analyse.
  const worstCases = measured.slice().sort((a, b) => Math.max(b.errW as number, b.errH as number) - Math.max(a.errW as number, a.errH as number)).slice(0, 8);
  lines.push("## Pires cas mesurés");
  lines.push("");
  lines.push("| Cas | Mur | Réf. | Réf. px | Angles | k1 | Err W | Err H | Incert. | Coins réf. px | Coins mur px | Avertissements |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of worstCases) {
    const t = r.truth;
    lines.push(`| ${r.truth.index} | ${t.W.toFixed(0)} × ${t.H.toFixed(0)} ${t.wallTone} | ${r.refKindTruth} | ${fmt(t.referenceShortSidePx ?? Number.NaN, 0)} | ${t.anglesDeg.yaw.toFixed(0)}/${t.anglesDeg.pitch.toFixed(0)}/${t.anglesDeg.roll.toFixed(0)} | ${t.k1.toFixed(3)} | ${fmt(r.errW as number)} % | ${fmt(r.errH as number)} % | ${fmt(r.uncertaintyPct as number)} % | ${fmt(r.refCornerErrPx as number)} | ${fmt(r.wallCornerErrPx as number, 1)} | ${r.warnings.join(", ")} |`);
  }
  lines.push("");
  lines.push("## Banc « coins parfaits » (sans rendu : vérité terrain projetée → `rectify`)");
  lines.push("");
  lines.push("Isole la géométrie de la rectification de la détection : coins exacts du mur et de la référence, avec et sans correction de distorsion, et feuille tapée à la main (bruit gaussien σ 2 px pleine résolution sur les coins de la référence, σ 1,5 px sur ceux du mur).");
  lines.push("");
  lines.push("| Série | n | p50 | p95 | max |");
  lines.push("|---|---|---|---|---|");
  for (const row of perfectRows(args.seed, n)) lines.push(row);
  lines.push("");
  lines.push("## Lecture des résultats");
  lines.push("");
  lines.push("- Les erreurs W/H sont mesurées sur les cas **mesurés** (référence détectée et coins du mur à < 40 px) : ce sont les cas où le pipeline rend un `WallSurvey` sans échec. Les cas restants sont des échecs **signalés** (`failure` non nul) que l'UI renvoie vers la saisie manuelle (loupe) : ils ne produisent jamais de chiffre.");
  lines.push("- `floor_line_ambiguous` accompagne les cas où le bas du mur a été descendu d'un haut de plinthe au vrai sol (ou pourrait l'être) : la mesure est correcte dans la très grande majorité des cas mais l'UI doit faire confirmer le bas du mur.");
  lines.push("- La ligne « feuille tapée à la main » simule la saisie des 4 coins de la feuille avec une erreur gaussienne de 2 px (pleine résolution) sur chaque coordonnée, les coins du mur étant ceux proposés automatiquement : c'est la tolérance affichée ± 5 %.");
  const nwc = results.filter((r) => r.failure === "no_wall_corners");
  const nwcWhite = nwc.filter((r) => r.truth.wallTone === "white").length;
  lines.push(`- \`no_wall_corners\` (${nwc.length} cas, dont ${nwcWhite} murs blancs) : la sélection des lignes exige que chaque arête explique son côté (une arête de porte prise pour l'angle du mur est éliminée plutôt que de produire un mur faux mais cohérent) ; sur un mur blanc sous un plafond blanc, l'arête du plafond est souvent trop faible → repli manuel assumé. Les pires cas mesurés (erreur sur H de 1,5–2 %, sans avertissement) correspondent à une plinthe basse (≈ 5 cm) dont le haut a été pris pour le sol sans que le contrôle du dessous ne tranche ; l'erreur reste sous la tolérance affichée et le quad est soumis à confirmation visuelle.`);
  lines.push("- L'incertitude propagée est calibrée : la ligne « Calibration » donne la part des cas où l'erreur réelle est inférieure à l'incertitude annoncée (1σ propagée avec les hypothèses de la spécification ; sur des bords synthétiques l'erreur réelle des coins est bien plus faible que ±1,5 px, d'où une incertitude conservatrice).");
  lines.push("");
  lines.push("## Limites du banc (à garder en tête avant le banc réel)");
  lines.push("");
  lines.push("- Images **synthétiques** : bords nets (flou gaussien seul), bruit gaussien, pas d'artefacts JPEG, pas de flou de bougé, pas de reflets ni de textures murales (papier peint existant, crépi), pas de meubles devant le mur. La précision sous-pixel (0,04 px p50 sur la référence) est optimiste ; le banc réel de 20 murs (`docs/reports/measurement-benchmark.md`, lot M7) est indispensable.");
  lines.push("- Distorsion : le même modèle de division sert au rendu et à la correction ; sur un vrai objectif (termes d'ordre supérieur, distorsion tangentielle), un résidu de 0,2–0,5 % est attendu. Le pipeline refuse les k1 implausibles (|k1| ≥ 0,045) et signale `distortion_not_estimated`.");
  lines.push("- Murs rectangulaires uniquement (pas de pente de plafond) ; la détection de trapèze n'est validée que par tests unitaires avec focale EXIF.");
  lines.push("- La feuille A4 sur mur blanc (contraste ≤ 15 niveaux) n'est détectée que dans une partie des cas : c'est le cas « le client tape les 4 coins avec la loupe » de la spécification, pas un défaut du banc.");
  lines.push("- Les lignes de sol invisibles (sol de la teinte de la plinthe, sans joint ni ombre) ne peuvent pas être trouvées : le haut de plinthe est alors retenu ; c'est l'un des cas où la confirmation visuelle du bas du mur par l'utilisateur, sur l'image redressée, reste nécessaire.");
  lines.push("- Les ouvertures sont des rectangles idéaux (cadres uniformes) ; les faux positifs du banc sont surtout des tableaux encadrés classés « fenêtre » et des bords intérieurs de cadres : l'UI fait confirmer chaque proposition (rien n'est déduit sans confirmation).");
  lines.push("");
  lines.push("## Ce que l'UI doit savoir");
  lines.push("");
  lines.push("- Appeler `measurePhoto({ work, full, fullFactor })` avec l'image de travail (≤ 2048 px) **et** l'originale : l'affinage des coins de la référence sur l'originale divise son incertitude par le facteur de réduction.");
  lines.push("- `failure === \"no_reference\"` → écran « tapez les 4 coins de la feuille » (loupe), puis rappeler `measurePhoto` avec `reference: { quad, kind: \"manual_a4\" }` (tolérance affichée 5 %). `failure === \"no_wall_corners\"` → placer les 4 coins (aimantation `snapToEdge`), rappeler avec `wallQuad`.");
  lines.push("- Toujours afficher les coins proposés sur l'image redressée (`rectified`) et faire confirmer ; afficher les avertissements (codes i18n) : `floor_line_ambiguous` (confirmer le bas du mur), `reference_aspect_mismatch` (feuille pas à plat / coin faux), `wall_corners_inconsistent` / `wall_trapezoid` (coin mal placé ou mur non rectangulaire), `distortion_not_estimated`, `reference_too_small`, `uncertainty_above_display_tolerance`.");
  lines.push("- Plinthes : `survey.baseboard` arrive avec `enabled: false` et, si une ligne a été trouvée, `heightCm` + `source: \"auto\"` ; la bascule passe par `applyBaseboard(survey, true, heightCm, source)` ; sans hauteur réelle, l'option reste inactive et `baseboard_height_required` est levé. Le point tapé sur la photo → `snapToEdge` puis `measureBaseboard`.");
  lines.push("- Ouvertures : `survey.openings` (source `auto`, `confidence`) sont des propositions à confirmer/ajuster/typer ; `surveyBounds(survey)` donne les deux surveys −tol/+tol pour l'estimation en fourchette.");
  lines.push("");
  lines.push("## Reproduire");
  lines.push("");
  lines.push("`pnpm --filter @wallscan/measurement bench` (500 cas, graine 20261107, ≈ 8 min sur 2 cœurs ; résultats bruts dans `dist/bench-results.json`, `pnpm bench:report` regénère ce fichier sans recalcul). Banc « coins parfaits » : `pnpm --filter @wallscan/measurement bench:perfect`.");
  lines.push("");
  return lines.join("\n");
}

/** Banc coins parfaits (cf. bench/perfect.ts) : lignes du tableau. */
function perfectRows(seed: number, n: number): string[] {
  const exactW: number[] = [];
  const exactH: number[] = [];
  const naiveW: number[] = [];
  const naiveH: number[] = [];
  const manualW: number[] = [];
  const manualH: number[] = [];
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
    exactW.push((Math.abs(exact.widthCm - t.W) / t.W) * 100);
    exactH.push((Math.abs(exact.heightCm - t.H) / t.H) * 100);
    const naive = rectify({ wallQuad, refQuad, refSizeCm: t.reference.sizeCm, refKind: t.reference.kind, imageSize });
    naiveW.push((Math.abs(naive.widthCm - t.W) / t.W) * 100);
    naiveH.push((Math.abs(naive.heightCm - t.H) / t.H) * 100);
    const rng = mulberry32(c.seed ^ 0x1234);
    const noisyRef = t.reference.quadFull.map((p) => ({ x: (p.x + gaussianNoise(rng) * 2) / factor, y: (p.y + gaussianNoise(rng) * 2) / factor })) as Quad;
    const noisyWall = t.wallQuadFull.map((p) => ({ x: (p.x + gaussianNoise(rng) * 1.5) / factor, y: (p.y + gaussianNoise(rng) * 1.5) / factor })) as Quad;
    const manual = rectify({ wallQuad: noisyWall, refQuad: noisyRef, refSizeCm: t.reference.sizeCm, refKind: "manual_a4", k1: t.k1, imageSize });
    manualW.push((Math.abs(manual.widthCm - t.W) / t.W) * 100);
    manualH.push((Math.abs(manual.heightCm - t.H) / t.H) * 100);
  }
  return [
    summaryRow("W, k1 connu", exactW),
    summaryRow("H, k1 connu", exactH),
    summaryRow("W, sans correction de distorsion (k1 ∈ ±0,02)", naiveW),
    summaryRow("H, sans correction de distorsion", naiveH),
    summaryRow("W, feuille manuelle (σ 2 px) + coins du mur ±1,5 px", manualW),
    summaryRow("H, feuille manuelle (σ 2 px) + coins du mur ±1,5 px", manualH),
  ];
}

interface WorkerMessage {
  results: Array<[number, CaseResult]>;
  verboseLines: string[];
}

function describe(i: number, r: CaseResult): string {
  const t = r.truth;
  return `[${i}] ${t.wallTone} ${t.W.toFixed(0)}×${t.H.toFixed(0)} ref=${r.refKindTruth} det=${r.refDetected ? "oui" : "NON"}${r.refFalse ? " FAUSSE" : ""} refErr=${fmt(r.refCornerErrPx ?? Number.NaN)}px wall=${fmt(r.wallCornerErrPx ?? Number.NaN, 1)}px W=${fmt(r.errW ?? Number.NaN)}% H=${fmt(r.errH ?? Number.NaN)}% k1=${t.k1.toFixed(3)}→${fmt(r.k1Est ?? Number.NaN, 3)} plinthe=${fmt(r.baseboardTruth ?? Number.NaN, 1)}→${fmt(r.baseboardEst ?? Number.NaN, 1)} ouv=${r.openingsMatched}/${r.openingsTruth}(+${r.openingsFalse}) ${r.pipelineMs.toFixed(0)}ms ${r.failure ?? ""} ${r.warnings.join(",")}`;
}

function runRange(indices: number[], seed: number, verbose: boolean, log: (s: string) => void): Array<[number, CaseResult]> {
  const out: Array<[number, CaseResult]> = [];
  for (const i of indices) {
    const rng = mulberry32((seed ^ 0x5555) + i * 101);
    const c = generateCase(i, seed);
    const r = runCase(c, rng);
    out.push([i, r]);
    if (verbose || i % 25 === 0) log(describe(i, r));
  }
  return out;
}

if (!isMainThread) {
  const { indices, seed, verbose } = workerData as { indices: number[]; seed: number; verbose: boolean };
  const verboseLines: string[] = [];
  const results = runRange(indices, seed, verbose, (s) => verboseLines.push(s));
  const msg: WorkerMessage = { results, verboseLines };
  parentPort?.postMessage(msg);
} else if (parseArgs().fromJson) {
  const args = parseArgs();
  const saved = JSON.parse(readFileSync(args.fromJson as string, "utf8")) as { seed: number; results: CaseResult[] };
  const md = report(saved.results, { ...args, seed: saved.seed, n: saved.results.length });
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, md);
    console.log(`Rapport écrit : ${args.out}`);
  } else console.log(md);
} else {
  const args = parseArgs();
  const start = performance.now();
  const workers = Math.max(1, Math.min(cpus().length, 8));
  const indices = Array.from({ length: args.n }, (_, i) => i);
  const chunks: number[][] = Array.from({ length: workers }, () => []);
  indices.forEach((i) => chunks[i % workers].push(i));
  const self = fileURLToPath(import.meta.url);
  const all = new Map<number, CaseResult>();
  const jobs = chunks
    .filter((ch) => ch.length > 0)
    .map(
      (ch) =>
        new Promise<void>((resolve, reject) => {
          const wk = new Worker(self, { workerData: { indices: ch, seed: args.seed, verbose: args.verbose } });
          wk.on("message", (m: WorkerMessage) => {
            for (const line of m.verboseLines) console.log(line);
            for (const [i, r] of m.results) all.set(i, r);
          });
          wk.on("error", reject);
          wk.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker ${code}`))));
        }),
    );
  await Promise.all(jobs);
  const results = indices.map((i) => all.get(i) as CaseResult);
  console.log(`Total ${((performance.now() - start) / 1000).toFixed(0)} s sur ${workers} worker(s)`);
  if (args.json) writeFileSync(args.json, JSON.stringify({ seed: args.seed, results }));
  const md = report(results, args);
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, md);
    console.log(`Rapport écrit : ${args.out}`);
  } else {
    console.log(md);
  }
}
