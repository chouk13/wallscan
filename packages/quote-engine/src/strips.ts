/**
 * Calepinage lé par lé : `planStrips` (un mur) et `planRoom` (pièce entière, motif chaîné, empaquetage commun).
 *
 * Déroulé : validation → géométrie en mm → position des lés → découpe de chaque lé en morceaux autour des
 * ouvertures couvrantes → déductions de surface → empaquetage des morceaux dans les rouleaux (variantes
 * « morceaux » et « lés entiers », ordre naturel et décroissant ; la moins chère gagne) → réserve, minimum
 * fournisseur → comparaison avec la formule simple §5.1 → trace en français, une ligne par décision.
 */
import type { OpeningV2 } from "@wallscan/core";
import {
  computeDeductions,
  layoutStrips,
  splitStrip,
  type Deductions,
  type OpeningMm,
  type PieceMm,
  type StripSpan,
  type WallGeometry,
} from "./layout.js";
import {
  bestPacking,
  packPieces,
  type PackOptions,
  type PackOrder,
  type PackPiece,
  type PackedRoll,
} from "./packing.js";
import { computeRollsSimple, dropMm, hasPattern } from "./simple.js";
import type {
  RollPlan,
  RoomPlan,
  StripInfo,
  StripPiece,
  StripPlan,
  StripPlanError,
  StripPlanInput,
  StripSkipReason,
} from "./types.js";
import { fmtCm, fmtM, fmtM2, fmtNum, mm2ToM2, mmToCm, mod, plural, toMm } from "./units.js";

type Variant = "split" | "unsplit";

interface PreparedStrip {
  span: StripSpan;
  heightMm: number;
  phaseMm: number;
  pieces: PieceMm[];
  /** Variante « lé entier » (une seule pièce pleine hauteur) ; vide si le lé est sauté. */
  unsplit: PieceMm[];
  /** Identifiants des ouvertures couvrantes (pour la trace d'un lé sauté). */
  coveringIds: string[];
  skipped?: StripSkipReason;
}

interface PreparedWall {
  input: StripPlanInput;
  g: WallGeometry;
  cutTopMm: number;
  cutBottomMm: number;
  rollWidthMm: number;
  rollLengthMm: number;
  /** 0 sans raccord. */
  repeatMm: number;
  dropMm: number;
  phaseOffsetMm: number;
  phaseOutMm: number;
  anchorIndex: number;
  strips: PreparedStrip[];
  deductions: Deductions;
  maxHeightMm: number;
  trace: string[];
}

type Prepared =
  { ok: true; wall: PreparedWall } | { ok: false; error: StripPlanError; trace: string[] };

const isPos = (n: number): boolean => Number.isFinite(n) && n > 0;
const isNonNeg = (n: number): boolean => Number.isFinite(n) && n >= 0;

function refuse(error: StripPlanError, why: string): Prepared {
  return { ok: false, error, trace: [`Refus (${error}) : ${why}`] };
}

/** Validation + conversion en mm + géométrie + découpe des lés + déductions. Aucun rouleau ici. */
function prepareWall(input: StripPlanInput): Prepared {
  const { wall, paper, settings } = input;
  if (!isPos(wall.widthCm) || !isPos(wall.heightLeftCm) || !isPos(wall.heightRightCm)) {
    return refuse(
      "invalid_wall",
      "largeur et hauteurs doivent être des nombres strictement positifs",
    );
  }
  if (!isPos(paper.rollWidthCm)) return refuse("invalid_paper", "largeur de lé invalide");
  if (paper.saleUnit === "roll" && !isPos(paper.rollLengthCm))
    return refuse("invalid_paper", "longueur de rouleau invalide pour une vente au rouleau");
  if (!isNonNeg(paper.patternRepeatCm) || !isNonNeg(paper.offsetCm))
    return refuse("invalid_paper", "raccord ou décalage négatif");
  if (!isNonNeg(paper.minOrderRolls))
    return refuse("invalid_paper", "minimum de commande invalide");
  if (!isNonNeg(settings.cutTopCm) || !isNonNeg(settings.cutBottomCm))
    return refuse("invalid_paper", "marges de coupe invalides");
  if (!(settings.deductAboveM2 >= 0)) return refuse("invalid_paper", "seuil de déduction invalide");
  if (wall.baseboard.enabled && wall.baseboard.heightCm === null) {
    return refuse(
      "baseboard_height_missing",
      "l'option « avec plinthes » est active mais la hauteur de plinthe n'est ni mesurée ni saisie ; aucune valeur par défaut n'est appliquée — mesurer la plinthe sur la photo ou saisir sa hauteur",
    );
  }
  const baseboardMm = wall.baseboard.enabled ? toMm(wall.baseboard.heightCm as number) : 0;
  if (wall.baseboard.enabled && !isPos(baseboardMm))
    return refuse("invalid_wall", "hauteur de plinthe invalide (doit être > 0)");

  const g: WallGeometry = {
    widthMm: toMm(wall.widthCm),
    heightLeftMm: toMm(wall.heightLeftCm),
    heightRightMm: toMm(wall.heightRightCm),
    baseboardMm,
  };
  if (Math.min(g.heightLeftMm, g.heightRightMm) - baseboardMm <= 0) {
    return refuse("invalid_wall", "la plinthe est plus haute que le mur : rien à tapisser");
  }

  const trace: string[] = [];
  const trapezoid = g.heightLeftMm !== g.heightRightMm;
  const wallDesc = trapezoid
    ? `Mur : ${fmtCm(g.widthMm)} de large, ${fmtCm(g.heightLeftMm)} à gauche et ${fmtCm(g.heightRightMm)} à droite (trapèze)`
    : `Mur : ${fmtNum(mmToCm(g.widthMm), 1)} × ${fmtCm(g.heightLeftMm)} (du plafond au sol)`;
  const paperMin = Math.min(g.heightLeftMm, g.heightRightMm) - baseboardMm;
  const paperMax = Math.max(g.heightLeftMm, g.heightRightMm) - baseboardMm;
  const heightDesc =
    paperMin === paperMax ? fmtCm(paperMax) : `${fmtCm(paperMin)} à ${fmtCm(paperMax)}`;
  trace.push(
    wall.baseboard.enabled
      ? `${wallDesc} ; plinthes de ${fmtCm(baseboardMm)} : le papier s'arrête en haut de la plinthe → hauteur à tapisser ${heightDesc}`
      : `${wallDesc} ; sans plinthes → hauteur à tapisser ${heightDesc}`,
  );

  const openings: OpeningMm[] = [];
  for (const o of wall.openings) {
    const r = { x: toMm(o.rect.x), y: toMm(o.rect.y), w: toMm(o.rect.w), h: toMm(o.rect.h) };
    if (r.w <= 0 || r.h <= 0) {
      trace.push(`Ouverture « ${o.id} » ignorée : rectangle vide`);
      continue;
    }
    openings.push({ id: o.id, kind: o.kind, ...r });
  }

  const rollWidthMm = toMm(paper.rollWidthCm);
  const cutTopMm = toMm(settings.cutTopCm);
  const cutBottomMm = toMm(settings.cutBottomCm);
  const { spans, anchorIndex } = layoutStrips(
    g.widthMm,
    rollWidthMm,
    settings.start,
    settings.centerAtCm === undefined ? undefined : toMm(settings.centerAtCm),
  );
  const leftCount = Math.ceil(g.widthMm / rollWidthMm);
  if (settings.start === "left") {
    trace.push(
      `Lés de ${fmtCm(rollWidthMm)}, départ au coin gauche : ${fmtCm(g.widthMm)} / ${fmtCm(rollWidthMm)} = ${fmtNum(g.widthMm / rollWidthMm, 2)} → ${plural(spans.length, "lé")}`,
    );
  } else {
    const centerMm = Math.min(
      g.widthMm,
      Math.max(
        0,
        Math.round(settings.centerAtCm === undefined ? g.widthMm / 2 : toMm(settings.centerAtCm)),
      ),
    );
    const right = spans.length - 1 - anchorIndex;
    trace.push(
      `Lés de ${fmtCm(rollWidthMm)}, motif centré sur ${fmtCm(centerMm)}${settings.centerAtCm === undefined ? " (axe du mur)" : ""} : ${plural(spans.length, "lé")} (${anchorIndex} à gauche du lé central, ${right} à droite ; ${leftCount} en partant du coin gauche)`,
    );
  }

  const repeatRaw = toMm(paper.patternRepeatCm);
  const pattern = hasPattern(paper.matchType, repeatRaw);
  const repeatMm = pattern ? repeatRaw : 0;
  const drop = pattern ? dropMm(paper.matchType, repeatMm, toMm(paper.offsetCm)) : 0;
  const phaseOffsetMm = pattern ? mod(toMm(settings.phaseOffsetCm ?? 0), repeatMm) : 0;
  if (pattern) {
    const kind =
      paper.matchType === "straight"
        ? "droit"
        : paper.matchType === "half_drop"
          ? "sauté"
          : "décalé";
    const dropDesc = drop > 0 ? ` : décalage de ${fmtCm(drop)} un lé sur deux` : "";
    const phaseDesc =
      settings.phaseOffsetCm === undefined ? "début de pièce" : "continuité du mur précédent";
    trace.push(
      `Raccord ${kind} de ${fmtCm(repeatMm)}${dropDesc} ; motif au plafond à ${fmtCm(phaseOffsetMm)} (${phaseDesc})`,
    );
  } else if (paper.matchType !== "free") {
    trace.push("Raccord déclaré sans hauteur de raccord : traité comme une pose libre");
  } else {
    trace.push("Sans raccord : pose libre");
  }
  trace.push(
    `Marges de coupe : ${fmtCm(cutTopMm)} en haut, ${fmtCm(cutBottomMm)} en bas de chaque morceau`,
  );

  const byId = new Map(openings.map((o) => [o.id, o]));
  const strips: PreparedStrip[] = [];
  let maxHeightMm = 0;
  for (const span of spans) {
    const parityDrop = Math.abs(span.index - anchorIndex) % 2 === 1 ? drop : 0;
    const phaseMm = pattern ? mod(phaseOffsetMm + parityDrop, repeatMm) : 0;
    const split = splitStrip(
      span,
      g,
      openings,
      cutTopMm,
      cutBottomMm,
      pattern ? { repeatMm, phaseMm } : null,
    );
    maxHeightMm = Math.max(maxHeightMm, split.heightMm);
    const unsplit: PieceMm[] = split.skipped
      ? []
      : [
          {
            pieceIndex: 0,
            fromMm: 0,
            toMm: split.heightMm,
            usefulMm: split.heightMm,
            lengthMm: split.heightMm + cutTopMm + cutBottomMm,
            patternStartMm: phaseMm,
            reason: "full",
            openingIds: [],
          },
        ];
    const ps: PreparedStrip = {
      span,
      heightMm: split.heightMm,
      phaseMm,
      pieces: split.pieces,
      unsplit,
      coveringIds: [...new Set(split.intervals.flatMap((it) => it.ids))],
    };
    if (split.skipped) ps.skipped = split.skipped;
    strips.push(ps);
    trace.push(describeStrip(ps, byId, cutTopMm, cutBottomMm));
  }

  const deductAboveMm2 = settings.deductAboveM2 * 1_000_000;
  const deductions = computeDeductions(g, openings, wall.areaOnlyOpenings ?? [], deductAboveMm2);
  trace.push(...describeDeductions(deductions, deductAboveMm2, byId));

  const phaseOutMm = pattern
    ? mod(phaseOffsetMm + (Math.abs(spans.length - anchorIndex) % 2 === 1 ? drop : 0), repeatMm)
    : 0;

  return {
    ok: true,
    wall: {
      input,
      g,
      cutTopMm,
      cutBottomMm,
      rollWidthMm,
      rollLengthMm: toMm(paper.rollLengthCm),
      repeatMm,
      dropMm: drop,
      phaseOffsetMm,
      phaseOutMm,
      anchorIndex,
      strips,
      deductions,
      maxHeightMm,
      trace,
    },
  };
}

function openingLabel(id: string, byId: ReadonlyMap<string, OpeningMm>): string {
  const o = byId.get(id)!; // les identifiants viennent toujours de `byId`
  const names: Record<OpeningV2["kind"], string> = {
    window: "fenêtre",
    door: "porte",
    french_door: "porte-fenêtre",
    radiator: "radiateur",
    niche: "niche",
    excluded: "zone exclue",
  };
  return `${names[o.kind]} « ${id} » (${fmtCm(o.w)} × ${fmtCm(o.h)}, de ${fmtCm(Math.max(0, o.y))} à ${fmtCm(o.y + o.h)} du plafond)`;
}

function describeStrip(
  ps: PreparedStrip,
  byId: ReadonlyMap<string, OpeningMm>,
  cutTopMm: number,
  cutBottomMm: number,
): string {
  const head = `Lé ${ps.span.index + 1} (${fmtNum(mmToCm(ps.span.xFromMm), 1)}–${fmtCm(ps.span.xToMm)})`;
  if (ps.skipped) {
    return `${head} : entièrement couvert par ${ps.coveringIds.map((id) => openingLabel(id, byId)).join(" et ")} sur toute la hauteur → aucun papier (lé sauté)`;
  }
  const only = ps.pieces[0]!;
  if (ps.pieces.length === 1 && only.reason === "full") {
    return `${head} : lé entier, ${fmtCm(only.usefulMm)} utiles + ${fmtCm(cutTopMm)} + ${fmtCm(cutBottomMm)} = ${fmtCm(only.lengthMm)}`;
  }
  const ids = [...new Set(ps.pieces.flatMap((p) => p.openingIds))];
  const parts = ps.pieces.map((p) => {
    const where =
      p.reason === "above_opening"
        ? "au-dessus"
        : p.reason === "below_opening"
          ? "en dessous"
          : "entre les ouvertures";
    return `${fmtCm(p.usefulMm)} ${where} → ${fmtCm(p.lengthMm)}`;
  });
  return `${head} : ${ids.map((id) => openingLabel(id, byId)).join(", ")} → ${plural(ps.pieces.length, "morceau", "morceaux")} : ${parts.join(", ")}`;
}

function describeDeductions(
  d: Deductions,
  deductAboveMm2: number,
  byId: ReadonlyMap<string, OpeningMm>,
): string[] {
  const lines: string[] = [`Surface brute à tapisser : ${fmtM2(d.grossMm2)}`];
  const threshold = Number.isFinite(deductAboveMm2) ? fmtM2(deductAboveMm2) : null;
  for (const l of d.lines) {
    const name = byId.has(l.label) ? openingLabel(l.label, byId).replace(/ \(.*\)$/, "") : l.label;
    switch (l.why) {
      case "excluded":
        lines.push(`${name} : ${fmtM2(l.areaMm2)} → zone exclue, toujours déduite`);
        break;
      case "radiator":
        lines.push(
          `${name} : ${fmtM2(l.areaMm2)} → radiateur, jamais déduit (le papier passe derrière)`,
        );
        break;
      case "above_threshold":
        lines.push(`${name} : ${fmtM2(l.areaMm2)} > ${threshold} → déduite`);
        break;
      case "below_threshold":
        lines.push(
          threshold === null
            ? `${name} : ${fmtM2(l.areaMm2)} → non déduite (règle de l'entreprise : jamais)`
            : `${name} : ${fmtM2(l.areaMm2)} ≤ ${threshold} → non déduite`,
        );
        break;
    }
  }
  if (d.deductedSumMm2 > d.deductedMm2)
    lines.push(
      `Ouvertures déduites qui se chevauchent : ${fmtM2(d.deductedSumMm2)} comptés ${fmtM2(d.deductedMm2)} (chevauchement une seule fois, jamais plus que le mur)`,
    );
  lines.push(
    `Surface facturée : ${fmtM2(d.grossMm2 - d.deductedMm2)}${d.deductedMm2 > 0 ? ` (${fmtM2(d.deductedMm2)} d'ouvertures déduites)` : ""}`,
  );
  return lines;
}

function errorPlan(
  error: StripPlanError,
  trace: readonly string[],
  phaseOffsetCm: number | undefined,
): StripPlan {
  return {
    strips: [],
    rolls: [],
    rollCount: 0,
    rollsUsed: 0,
    simpleRollCount: 0,
    billableAreaM2: 0,
    grossAreaM2: 0,
    deductedAreaM2: 0,
    wasteTotalCm: 0,
    phaseOutCm: phaseOffsetCm ?? 0,
    stripCount: 0,
    pieceCount: 0,
    anchorIndex: 0,
    trace: [...trace],
    error,
  };
}

function toPackPieces(walls: readonly PreparedWall[], variant: Variant): PackPiece[] {
  const out: PackPiece[] = [];
  walls.forEach((w, wallIndex) => {
    for (const s of w.strips) {
      for (const p of variant === "split" ? s.pieces : s.unsplit) {
        out.push({
          wallIndex,
          stripIndex: s.span.index,
          pieceIndex: p.pieceIndex,
          lengthMm: p.lengthMm,
          patternStartMm: p.patternStartMm,
        });
      }
    }
  });
  return out;
}

const CANDIDATES: readonly { variant: Variant; order: PackOrder; label: string }[] = [
  { variant: "split", order: "natural", label: "morceaux, ordre des lés" },
  { variant: "split", order: "ffd", label: "morceaux, premier-ajustement décroissant" },
  { variant: "unsplit", order: "natural", label: "lés entiers, ordre des lés" },
  { variant: "unsplit", order: "ffd", label: "lés entiers, premier-ajustement décroissant" },
];

type Chosen =
  | { ok: true; variant: Variant; label: string; rolls: PackedRoll[] }
  | { ok: false; error: "piece_longer_than_roll" };

/** Essaie les variantes d'empaquetage (tous murs confondus) et garde celle qui commande le moins de rouleaux. */
function choosePacking(
  walls: readonly PreparedWall[],
  opts: PackOptions,
  forced?: Variant,
): Chosen {
  const candidates = CANDIDATES.filter((c) => forced === undefined || c.variant === forced).map(
    (c) => ({
      ...c,
      result: packPieces(toPackPieces(walls, c.variant), opts, c.order),
    }),
  );
  const best = bestPacking(candidates);
  if ("error" in best) return { ok: false, error: best.error };
  const chosen = candidates.find((c) => c.label === best.label)!;
  return { ok: true, variant: chosen.variant, label: best.label, rolls: best.rolls };
}

function toRollPlans(
  rolls: readonly PackedRoll[],
  rollLengthMm: number,
  withWall: boolean,
): RollPlan[] {
  return rolls.map((r, index) => {
    const cuts = r.cuts.map((c) => {
      const cut = {
        stripIndex: c.piece.stripIndex,
        pieceIndex: c.piece.pieceIndex,
        lengthCm: mmToCm(c.piece.lengthMm),
        startCm: mmToCm(c.startMm),
        wasteBeforeCm: mmToCm(c.wasteBeforeMm),
      };
      return withWall ? { ...cut, wallIndex: c.piece.wallIndex } : cut;
    });
    const used = r.cuts.reduce((s, c) => s + c.piece.lengthMm, 0);
    return { index, cuts, wasteCm: mmToCm(rollLengthMm - used), usedCm: mmToCm(r.cursorMm) };
  });
}

function toStripInfos(w: PreparedWall, variant: Variant): StripInfo[] {
  return w.strips.map((s) => {
    const pieces: StripPiece[] = (variant === "split" ? s.pieces : s.unsplit).map((p) => ({
      stripIndex: s.span.index,
      pieceIndex: p.pieceIndex,
      fromCm: mmToCm(p.fromMm),
      toCm: mmToCm(p.toMm),
      lengthCm: mmToCm(p.lengthMm),
      usefulCm: mmToCm(p.usefulMm),
      patternStartCm: mmToCm(p.patternStartMm),
      reason: p.reason,
      openingIds: [...p.openingIds],
    }));
    const info: StripInfo = {
      index: s.span.index,
      xFromCm: mmToCm(s.span.xFromMm),
      xToCm: mmToCm(s.span.xToMm),
      heightCm: mmToCm(s.heightMm),
      phaseCm: mmToCm(s.phaseMm),
      pieces,
    };
    if (s.skipped) info.skipped = s.skipped;
    return info;
  });
}

function rollTrace(
  rolls: readonly RollPlan[],
  walls: readonly PreparedWall[],
  variant: Variant,
): string[] {
  return rolls.map((r) => {
    const cuts = r.cuts.map((c) => {
      const strip = walls[c.wallIndex ?? 0]!.strips[c.stripIndex]!;
      const piece = (variant === "split" ? strip.pieces : strip.unsplit).find(
        (p) => p.pieceIndex === c.pieceIndex,
      )!;
      const part =
        piece.reason === "full"
          ? ""
          : piece.reason === "above_opening"
            ? " haut"
            : piece.reason === "below_opening"
              ? " bas"
              : " milieu";
      const wait =
        c.wasteBeforeCm > 0 ? `, attente du raccord ${fmtCm(toMm(c.wasteBeforeCm))}` : "";
      const wallNo = c.wallIndex === undefined ? "" : `mur ${c.wallIndex + 1} `;
      return `${wallNo}lé ${c.stripIndex + 1}${part} (${fmtCm(toMm(c.lengthCm))}${wait})`;
    });
    return `Rouleau ${r.index + 1} : ${cuts.join(", ")} ; chute ${fmtCm(toMm(r.wasteCm))}`;
  });
}

function simpleFor(w: PreparedWall, stripCount: number, billableAreaM2: number) {
  const { paper, settings } = w.input;
  return computeRollsSimple({
    stripCount,
    heightCm: mmToCm(w.maxHeightMm),
    cutTopCm: settings.cutTopCm,
    cutBottomCm: settings.cutBottomCm,
    rollLengthCm: paper.rollLengthCm,
    patternRepeatCm: paper.patternRepeatCm,
    matchType: paper.matchType,
    offsetCm: paper.offsetCm,
    minOrderRolls: paper.minOrderRolls,
    safetyRollIfPattern: settings.safetyRollIfPattern,
    billableAreaM2,
  });
}

/** Rouleaux à commander à partir des rouleaux découpés : réserve si raccord, puis minimum fournisseur. */
function orderCount(used: number, w: PreparedWall, trace: string[]): number {
  if (used === 0) {
    trace.push("Aucun papier nécessaire : 0 rouleau");
    return 0;
  }
  let count = used;
  if (w.repeatMm > 0 && w.input.settings.safetyRollIfPattern) {
    count += 1;
    trace.push(`Motif à raccord : un rouleau de réserve en plus → ${count}`);
  }
  if (count < w.input.paper.minOrderRolls) {
    count = w.input.paper.minOrderRolls;
    trace.push(`Minimum de commande du fournisseur : ${plural(count, "rouleau", "rouleaux")}`);
  }
  return count;
}

/** @internal exporté pour les tests */
export function compareWithSimple(
  simpleRollCount: number,
  simpleStripHeightCm: number,
  simpleStripsPerRoll: number,
  stripCount: number,
  rollCount: number,
): string {
  if (simpleRollCount === 0)
    return "Formule simple inapplicable (lé arrondi au raccord plus long que le rouleau) ; le calepinage fait foi";
  const diff = simpleRollCount - rollCount;
  const verdict =
    diff === 0
      ? "identique"
      : diff > 0
        ? `${diff} de moins : raccords calculés exactement, morceaux autour des ouvertures`
        : `${-diff} de plus — anomalie, à signaler`;
  return `Formule simple (${stripCount} lés de ${fmtCm(toMm(simpleStripHeightCm))}, ${simpleStripsPerRoll} par rouleau) : ${plural(simpleRollCount, "rouleau", "rouleaux")} ; calepinage : ${plural(rollCount, "rouleau", "rouleaux")} (${verdict})`;
}

function planPrepared(w: PreparedWall, forced?: Variant): StripPlan {
  const trace = [...w.trace];
  const stripCount = w.strips.filter((s) => !s.skipped).length;
  const billableMm2 = w.deductions.grossMm2 - w.deductions.deductedMm2;
  const billableAreaM2 = mm2ToM2(billableMm2);
  const grossAreaM2 = mm2ToM2(w.deductions.grossMm2);
  const deductedAreaM2 = mm2ToM2(w.deductions.deductedMm2);
  const phaseOutCm = mmToCm(w.phaseOutMm);
  const phaseLine =
    w.repeatMm > 0 ? `Motif en sortie (premier lé du mur suivant) : ${fmtCm(w.phaseOutMm)}` : null;

  if (w.input.paper.saleUnit === "m2") {
    const stripLengthMm = w.maxHeightMm + w.cutTopMm + w.cutBottomMm;
    const decorMm2 = stripCount * w.rollWidthMm * stripLengthMm;
    const m2Decor = mm2ToM2(decorMm2);
    trace.push(
      `Vente au m² (décor imprimé sur mesure) : ${stripCount} lés × ${fmtCm(w.rollWidthMm)} × ${fmtCm(stripLengthMm)} = ${fmtM2(decorMm2)} de décor ; les ouvertures ne réduisent pas le décor imprimé`,
    );
    if (phaseLine) trace.push(phaseLine);
    const strips = toStripInfos(w, "split");
    return {
      strips,
      rolls: [],
      rollCount: 0,
      rollsUsed: 0,
      simpleRollCount: 0,
      m2Decor,
      billableAreaM2,
      grossAreaM2,
      deductedAreaM2,
      wasteTotalCm: 0,
      phaseOutCm,
      stripCount,
      pieceCount: strips.reduce((s, x) => s + x.pieces.length, 0),
      anchorIndex: w.anchorIndex,
      trace,
    };
  }

  const opts: PackOptions = {
    rollLengthMm: w.rollLengthMm,
    repeatMm: w.repeatMm,
    cutTopMm: w.cutTopMm,
  };
  const chosen = choosePacking([w], opts, forced);
  if (!chosen.ok) {
    trace.push(
      `Refus (${chosen.error}) : un morceau de ${fmtCm(Math.max(...toPackPieces([w], "split").map((p) => p.lengthMm)))} dépasse la longueur du rouleau (${fmtCm(w.rollLengthMm)}) — un lé ne se raccorde pas horizontalement`,
    );
    return {
      ...errorPlan(chosen.error, trace, w.input.settings.phaseOffsetCm),
      billableAreaM2,
      grossAreaM2,
      deductedAreaM2,
      stripCount,
      phaseOutCm,
      anchorIndex: w.anchorIndex,
    };
  }
  const strips = toStripInfos(w, chosen.variant);
  const rolls = toRollPlans(chosen.rolls, w.rollLengthMm, false);
  const hadSplits = w.strips.some(
    (s) => s.pieces.length !== s.unsplit.length || s.pieces.some((p) => p.reason !== "full"),
  );
  if (chosen.variant === "unsplit" && hadSplits) {
    trace.push(
      "Découpe autour des ouvertures non rentable avec ce raccord : lés entiers, ouvertures évidées à la pose",
    );
  }
  trace.push(
    `Rouleaux de ${fmtM(w.rollLengthMm)} — empaquetage retenu : ${chosen.label}${w.repeatMm > 0 ? ", avec respect de la position du motif" : ""}`,
  );
  trace.push(...rollTrace(rolls, [w], chosen.variant));
  const wasteTotalCm = rolls.reduce((s, r) => s + r.wasteCm, 0);
  trace.push(
    `${plural(rolls.length, "rouleau découpé", "rouleaux découpés")} ; chute totale ${fmtCm(toMm(wasteTotalCm))}`,
  );
  const rollCount = orderCount(rolls.length, w, trace);
  const simple = simpleFor(w, stripCount, billableAreaM2);
  trace.push(
    compareWithSimple(
      simple.rollCount,
      simple.stripHeightCm,
      simple.stripsPerRoll,
      stripCount,
      rollCount,
    ),
  );
  if (phaseLine) trace.push(phaseLine);
  return {
    strips,
    rolls,
    rollCount,
    rollsUsed: rolls.length,
    simpleRollCount: simple.rollCount,
    billableAreaM2,
    grossAreaM2,
    deductedAreaM2,
    wasteTotalCm,
    phaseOutCm,
    stripCount,
    pieceCount: strips.reduce((s, x) => s + x.pieces.length, 0),
    anchorIndex: w.anchorIndex,
    trace,
  };
}

/** Calepinage d'un mur. Ne lève jamais : refus explicite via `error` + `trace`. */
export function planStrips(input: StripPlanInput): StripPlan {
  const prepared = prepareWall(input);
  if (!prepared.ok) return errorPlan(prepared.error, prepared.trace, input.settings.phaseOffsetCm);
  return planPrepared(prepared.wall);
}

function samePaper(a: StripPlanInput["paper"], b: StripPlanInput["paper"]): boolean {
  return (
    a.rollWidthCm === b.rollWidthCm &&
    a.rollLengthCm === b.rollLengthCm &&
    a.patternRepeatCm === b.patternRepeatCm &&
    a.matchType === b.matchType &&
    a.offsetCm === b.offsetCm &&
    a.saleUnit === b.saleUnit &&
    a.minOrderRolls === b.minOrderRolls
  );
}

function roomError(walls: readonly StripPlan[], error: StripPlanError, trace: string[]): RoomPlan {
  return {
    walls,
    rollCount: 0,
    trace,
    rolls: [],
    rollsUsed: 0,
    separateRollCount: 0,
    billableAreaM2: 0,
    wasteTotalCm: 0,
    error,
  };
}

/**
 * Pièce entière : murs chaînés dans l'ordre (gauche → droite), la phase du motif en sortie d'un mur devient la phase
 * d'entrée du suivant ; empaquetage commun des morceaux de tous les murs ; réserve et minimum appliqués une fois.
 */
export function planRoom(walls: readonly StripPlanInput[]): RoomPlan {
  if (walls.length === 0)
    return roomError([], "invalid_wall", ["Refus (invalid_wall) : aucune paroi fournie"]);
  const first = walls[0]!;
  const trace: string[] = [
    `Pièce : ${plural(walls.length, "mur")} chaînés de gauche à droite (${walls.map((w) => fmtCm(toMm(w.wall.widthCm))).join(", ")})`,
  ];
  const prepared: PreparedWall[] = [];
  const plans: StripPlan[] = [];
  let phaseCm: number | undefined = first.settings.phaseOffsetCm;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i]!;
    if (!samePaper(first.paper, w.paper)) {
      trace.push(
        `Refus (invalid_paper) : le mur ${i + 1} n'a pas la même référence que le mur 1 (une pièce = un papier ; grouper les murs par référence)`,
      );
      return roomError(plans, "invalid_paper", trace);
    }
    const settings = phaseCm === undefined ? w.settings : { ...w.settings, phaseOffsetCm: phaseCm };
    const p = prepareWall({ ...w, settings });
    if (!p.ok) {
      trace.push(`Mur ${i + 1} : ${p.trace.join(" ; ")}`);
      return roomError(
        [...prepared.map((pw) => planPrepared(pw)), errorPlan(p.error, p.trace, phaseCm)],
        p.error,
        trace,
      );
    }
    prepared.push(p.wall);
    phaseCm = mmToCm(p.wall.phaseOutMm);
    if (p.wall.repeatMm > 0)
      trace.push(
        `Mur ${i + 1} : motif au plafond à ${fmtCm(p.wall.phaseOffsetMm)} en entrée, ${fmtCm(p.wall.phaseOutMm)} en sortie`,
      );
  }

  if (first.paper.saleUnit === "m2") {
    for (const w of prepared) plans.push(planPrepared(w));
    const m2Decor = Math.round(plans.reduce((s, p) => s + p.m2Decor! * 100, 0)) / 100; // toujours défini en vente au m²
    const billableAreaM2 = Math.round(plans.reduce((s, p) => s + p.billableAreaM2 * 100, 0)) / 100;
    trace.push(
      `Vente au m² : ${fmtNum(m2Decor, 2)} m² de décor pour la pièce ; surface facturée ${fmtNum(billableAreaM2, 2)} m²`,
    );
    return {
      walls: plans,
      rollCount: 0,
      trace,
      rolls: [],
      rollsUsed: 0,
      separateRollCount: 0,
      m2Decor,
      billableAreaM2,
      wasteTotalCm: 0,
    };
  }

  const ref = prepared[0]!;
  const opts: PackOptions = {
    rollLengthMm: ref.rollLengthMm,
    repeatMm: ref.repeatMm,
    cutTopMm: ref.cutTopMm,
  };
  const chosen = choosePacking(prepared, opts);
  if (!chosen.ok) {
    for (const w of prepared) plans.push(planPrepared(w));
    trace.push(`Refus (${chosen.error}) : un morceau dépasse la longueur du rouleau`);
    return roomError(plans, chosen.error, trace);
  }
  for (const w of prepared) plans.push(planPrepared(w, chosen.variant));
  const rolls = toRollPlans(chosen.rolls, ref.rollLengthMm, true);
  const billableAreaM2 = Math.round(plans.reduce((s, p) => s + p.billableAreaM2 * 100, 0)) / 100;
  const stripCount = plans.reduce((s, p) => s + p.stripCount, 0);
  const pieceCount = plans.reduce((s, p) => s + p.pieceCount, 0);
  trace.push(
    `${plural(stripCount, "lé")}, ${plural(pieceCount, "morceau", "morceaux")} ; empaquetage commun retenu : ${chosen.label}`,
  );
  trace.push(...rollTrace(rolls, prepared, chosen.variant));
  const wasteTotalCm = rolls.reduce((s, r) => s + r.wasteCm, 0);
  trace.push(
    `${plural(rolls.length, "rouleau découpé", "rouleaux découpés")} pour la pièce ; chute totale ${fmtCm(toMm(wasteTotalCm))}`,
  );
  const rollCount = orderCount(rolls.length, ref, trace);
  const separateRollCount = plans.reduce((s, p) => s + p.rollCount, 0);
  trace.push(
    `Commande pour la pièce : ${plural(rollCount, "rouleau", "rouleaux")} (${separateRollCount} si chaque mur était commandé séparément) ; surface facturée ${fmtNum(billableAreaM2, 2)} m²`,
  );
  return {
    walls: plans,
    rollCount,
    trace,
    rolls,
    rollsUsed: rolls.length,
    separateRollCount,
    billableAreaM2,
    wasteTotalCm,
  };
}
