// stubs.js — doublures de `WSMeasure` (packages/measurement) et `WSQuote` (packages/quote-engine) pour le module web,
// tant que les bundles IIFE réels (packages/*/dist/ws*.iife.js) n'existent pas. Contrat : docs/specs/measurement-api.md.
// Chaque globale n'est définie que si elle est absente : un bundle réel chargé avant ce fichier garde la main.
// Comportement minimal et déterministe : rectification par homographie à 4 points (reprise du prototype), échelle depuis la
// feuille, aucune détection (detectReference / proposeWallCorners → null, proposeOpenings → []), aimantation = identité,
// plinthe = hauteur redressée entre le point tapé et le bas du mur, calepinage = formule simple du prototype, fourchette = trois appels.
(function (g) {
  "use strict";
  // ---------------------------------------------------------------- géométrie (reprise du prototype)
  function adj(m) { return [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4], m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5], m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]]; }
  function mul(a, b) { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += a[3 * i + k] * b[3 * k + j]; r.push(s); } return r; }
  function mulv(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
  function basis(p) { const m = [p[0].x, p[1].x, p[2].x, p[0].y, p[1].y, p[2].y, 1, 1, 1]; const v = mulv(adj(m), [p[3].x, p[3].y, 1]); return mul(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]); }
  function norm9(h) { const k = h[8] || 1; return h.map((v) => v / k); }
  /** Homographie envoyant le quadrilatère `from` (4 Pt) sur `to` (4 Pt). */
  function homography(from, to) { return norm9(mul(basis(to), adj(basis(from)))); }
  function apply(h, x, y) { const X = h[0] * x + h[1] * y + h[2], Y = h[3] * x + h[4] * y + h[5], Z = h[6] * x + h[7] * y + h[8] || 1e-12; return { x: X / Z, y: Y / Z }; }
  function invert(h) { return norm9(adj(h)); }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const UNIT = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const r1 = (n) => Math.round(n * 10) / 10, r2 = (n) => Math.round(n * 100) / 100;

  // ================================================================ WSMeasure
  if (typeof g.WSMeasure === "undefined") {
    const SIGMA_PX = { mire: 0.5, a4: 1.5, manual_a4: 2.5 }; // ±px sur les coins de la référence (spec §2.3.8)
    const WSMeasure = {
      STUB: true,
      toGray(rgba, width, height) {
        const n = width * height, out = new Uint8ClampedArray(n);
        for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114 + 500) / 1000;
        return { width, height, data: out };
      },
      detectReference() { return null; },
      refineCorners(img, quad) { return quad.map((p) => ({ x: p.x, y: p.y })); },
      proposeWallCorners() { return null; },
      snapToEdge(img, p) { return { x: p.x, y: p.y }; },
      estimateRadialDistortion() { return { k1: 0, residualPct: 0 }; },
      rectify(args) {
        const { wallQuad, refQuad, refSizeCm, imageSize } = args; const refKind = args.refKind || "a4";
        const warnings = [];
        const Hu = homography(wallQuad, UNIT); // image → carré unité du mur
        const r = refQuad.map((p) => apply(Hu, p.x, p.y));
        const fu = (Math.abs(r[1].x - r[0].x) + Math.abs(r[2].x - r[3].x)) / 2, fv = (Math.abs(r[3].y - r[0].y) + Math.abs(r[2].y - r[1].y)) / 2;
        const bad = !(fu > 1e-4 && fv > 1e-4);
        const widthCm = bad ? 0 : refSizeCm.w / fu, heightCm = bad ? 0 : refSizeCm.h / fv;
        if (bad) warnings.push("La référence est trop petite ou mal placée : replacez ses quatre coins.");
        // Contrôles : la référence redressée doit rester un rectangle (côtés opposés égaux)
        const du = Math.abs(Math.abs(r[1].x - r[0].x) - Math.abs(r[2].x - r[3].x)) / (fu || 1), dv = Math.abs(Math.abs(r[3].y - r[0].y) - Math.abs(r[2].y - r[1].y)) / (fv || 1);
        const oppositeSidesPct = r2(Math.max(du, dv) * 100);
        if (!bad && oppositeSidesPct > 3) warnings.push("Les coins de la référence ne forment pas un rectangle : vérifiez-les.");
        const inside = r.every((p) => p.x > -0.01 && p.x < 1.01 && p.y > -0.01 && p.y < 1.01);
        if (!bad && !inside && refQuad !== wallQuad) warnings.push("La référence doit être posée sur le mur mesuré.");
        // Incertitude propagée : coins de la référence (±σ px) + coins du mur (±3 px) + distorsion résiduelle 0,3 %
        const refPxW = (dist(refQuad[0], refQuad[1]) + dist(refQuad[3], refQuad[2])) / 2 || 1, refPxH = (dist(refQuad[0], refQuad[3]) + dist(refQuad[1], refQuad[2])) / 2 || 1;
        const wallPxW = (dist(wallQuad[0], wallQuad[1]) + dist(wallQuad[3], wallQuad[2])) / 2 || 1, wallPxH = (dist(wallQuad[0], wallQuad[3]) + dist(wallQuad[1], wallQuad[2])) / 2 || 1;
        const s = SIGMA_PX[refKind] || 1.5, q = (a, b, c) => Math.sqrt(a * a + b * b + c * c);
        const uW = q(100 * s * Math.SQRT2 / refPxW, 100 * 3 * Math.SQRT2 / wallPxW, 0.3), uH = q(100 * s * Math.SQRT2 / refPxH, 100 * 3 * Math.SQRT2 / wallPxH, 0.3);
        if (!bad && refQuad !== wallQuad && refPxW < 40) warnings.push(`La feuille est petite sur la photo (${Math.round(refPxW)} px de large) : rapprochez-vous ou utilisez la mire pour plus de précision.`);
        if (!bad && (widthCm < 50 || widthCm > 1500 || heightCm < 100 || heightCm > 500)) warnings.push("Dimensions improbables : vérifiez les coins du mur et ceux de la référence.");
        const H = bad ? Hu : norm9(mul([widthCm, 0, 0, 0, heightCm, 0, 0, 0, 1], Hu)); // image → plan du mur (cm)
        void imageSize;
        return {
          widthCm: r1(widthCm), heightCm: r1(heightCm), heightLeftCm: r1(heightCm), heightRightCm: r1(heightCm),
          uncertaintyPct: r2(Math.max(uW, uH)), displayTolerancePct: refKind === "manual_a4" ? 5 : 3, reference: refKind,
          scalePxPerCm: bad ? 1 : r2(1024 / widthCm), homography: H, openings: [],
          baseboard: { enabled: false, heightCm: null, source: null },
          checks: { oppositeSidesPct, referenceAspectPct: 0, distortionPct: r2(Math.abs(args.k1 || 0) * 100), warnings },
        };
      },
      warpToPlane(img, H, outW, outH) {
        // H : image → pixels de sortie. Rééchantillonnage bilinéaire par transformation inverse ; hors image → pixel le plus proche.
        const inv = invert(H), W = img.width, Hh = img.height, src = img.data, out = new Uint8ClampedArray(outW * outH);
        const mw = W - 1, mh = Hh - 1;
        for (let j = 0; j < outH; j++) {
          const y = j + 0.5;
          for (let i = 0; i < outW; i++) {
            const x = i + 0.5, Z = inv[6] * x + inv[7] * y + inv[8] || 1e-12;
            let sx = (inv[0] * x + inv[1] * y + inv[2]) / Z - 0.5, sy = (inv[3] * x + inv[4] * y + inv[5]) / Z - 0.5;
            if (sx < 0) sx = 0; else if (sx > mw) sx = mw; if (sy < 0) sy = 0; else if (sy > mh) sy = mh;
            const x0 = sx | 0, y0 = sy | 0, x1 = x0 < mw ? x0 + 1 : x0, y1 = y0 < mh ? y0 + 1 : y0, fx = sx - x0, fy = sy - y0;
            const a = src[y0 * W + x0], b = src[y0 * W + x1], c = src[y1 * W + x0], d = src[y1 * W + x1];
            out[j * outW + i] = (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
          }
        }
        return { width: outW, height: outH, data: out };
      },
      proposeOpenings() { return []; },
      measureBaseboard(survey, pointInImage) {
        const p = apply(survey.homography, pointInImage.x, pointInImage.y), p2 = apply(survey.homography, pointInImage.x, pointInImage.y + 3);
        const heightCm = Math.max(0, survey.heightCm - p.y);
        return { heightCm: r1(heightCm), uncertaintyCm: r1(Math.max(0.5, Math.abs(p2.y - p.y))) };
      },
      applyBaseboard(survey, enabled, heightCm, source) {
        const s = clone(survey); s.baseboard = { enabled: !!enabled, heightCm: heightCm == null ? null : Number(heightCm), source: source || null };
        s.checks.warnings = s.checks.warnings.filter((w) => !w.startsWith("Plinthes :"));
        if (enabled && heightCm == null) s.checks.warnings.push("Plinthes : hauteur inconnue — mesurez-la sur la photo ou saisissez-la. Sans hauteur, rien n'est déduit.");
        else if (enabled && Number(heightCm) > survey.heightCm * 0.5) s.checks.warnings.push("Plinthes : hauteur improbable, vérifiez le point tapé ou la valeur saisie.");
        return s;
      },
      surveyBounds(survey) {
        const t = survey.displayTolerancePct / 100;
        const scale = (k) => {
          const s = clone(survey);
          for (const key of ["widthCm", "heightCm", "heightLeftCm", "heightRightCm"]) s[key] = r1(s[key] * k);
          s.openings = s.openings.map((o) => ({ ...o, rect: { x: r1(o.rect.x * k), y: r1(o.rect.y * k), w: r1(o.rect.w * k), h: r1(o.rect.h * k) } }));
          if (s.baseboard.source === "measured" && s.baseboard.heightCm != null) s.baseboard.heightCm = r1(s.baseboard.heightCm * k);
          s.scalePxPerCm = r2(s.scalePxPerCm / k); s.homography = norm9(mul([k, 0, 0, 0, k, 0, 0, 0, 1], s.homography));
          return s;
        };
        return { low: scale(1 - t), high: scale(1 + t) };
      },
    };
    g.WSMeasure = WSMeasure;
  }

  // ================================================================ WSQuote
  if (typeof g.WSQuote === "undefined") {
    const ceil = Math.ceil, floor = Math.floor;
    const rhu = (x) => Math.sign(x) * Math.floor(Math.abs(x) + 0.5), r5 = (c) => Math.sign(c) * Math.floor((Math.abs(c) + 2) / 5) * 5;
    const fq = (n) => String(n).replace(".", ",");
    const KIND_LBL = { window: "fenêtre", door: "porte", french_door: "porte-fenêtre", radiator: "radiateur", niche: "niche", excluded: "zone exclue" };

    function planStrips(input) {
      const w = input.wall, p = input.paper, s = input.settings, t = [];
      const H = Math.max(w.heightLeftCm, w.heightRightCm), Havg = (w.heightLeftCm + w.heightRightCm) / 2;
      if (Math.abs(w.heightLeftCm - w.heightRightCm) / (Havg || 1) > 0.02) t.push(`Mur en trapèze : ${fq(w.heightLeftCm)} cm à gauche, ${fq(w.heightRightCm)} cm à droite — les lés sont coupés à la plus grande hauteur`);
      let Hp = H, bbCm = 0;
      if (w.baseboard && w.baseboard.enabled) {
        if (w.baseboard.heightCm == null) { t.push("Plinthes demandées sans hauteur connue : calepinage refusé. Mesurez ou saisissez la hauteur de plinthe."); return { strips: [], rolls: [], rollCount: 0, rollsUsed: 0, simpleRollCount: 0, billableAreaM2: 0, grossAreaM2: 0, deductedAreaM2: 0, wasteTotalCm: 0, phaseOutCm: 0, stripCount: 0, pieceCount: 0, anchorIndex: 0, trace: t, error: "baseboard_height_missing" }; }
        bbCm = w.baseboard.heightCm; Hp = H - bbCm; t.push(`Plinthes de ${fq(bbCm)} cm : le papier s'arrête en haut de la plinthe, hauteur à couvrir ${fq(r1(Hp))} cm`);
      }
      let sh = Hp + s.cutTopCm + s.cutBottomCm; t.push(`Hauteur de lé : ${fq(r1(Hp))} cm de mur + ${fq(s.cutTopCm)} cm en haut + ${fq(s.cutBottomCm)} cm en bas = ${fq(r1(sh))} cm`);
      if (p.matchType !== "free" && p.patternRepeatCm > 0) {
        const r = ceil(sh / p.patternRepeatCm) * p.patternRepeatCm; t.push(`Raccord ${p.matchType === "half_drop" ? "sauté" : p.matchType === "offset" ? "décalé" : "droit"} de ${fq(p.patternRepeatCm)} cm : la hauteur de lé passe au multiple supérieur, ${fq(r)} cm`); sh = r;
        if ((p.matchType === "half_drop" || p.matchType === "offset") && p.offsetCm > 0) { sh += p.offsetCm; t.push(`Raccord sauté : ${fq(p.offsetCm)} cm de plus sur un lé sur deux, on compte ${fq(sh)} cm pour chaque lé`); }
      }
      const rw = p.rollWidthCm;
      let x0, n;
      if (s.start === "centered") {
        const cx = s.centerAtCm != null ? s.centerAtCm : w.widthCm / 2;
        const left = ceil(Math.max(0, cx - rw / 2) / rw), right = ceil(Math.max(0, w.widthCm - cx - rw / 2) / rw);
        n = 1 + left + right; x0 = cx - rw / 2 - left * rw;
        t.push(`Motif centré ${s.centerAtCm != null ? `à ${fq(cx)} cm du bord gauche` : "sur l'axe du mur"} : ${n} lés (un lé centré, ${left} à gauche, ${right} à droite)`);
      } else { n = ceil(w.widthCm / rw); x0 = 0; t.push(`Lés : ${fq(w.widthCm)} cm de largeur sur des lés de ${fq(rw)} cm, soit ${fq((w.widthCm / rw).toFixed(2))}, arrondi à ${n} lés`); }
      const strips = [];
      for (let i = 0; i < n; i++) {
        const xFrom = r1(x0 + i * rw), xTo = r1(x0 + (i + 1) * rw);
        const fd = (w.openings || []).find((o) => o.kind === "french_door" && o.rect.x <= xFrom + 0.5 && o.rect.x + o.rect.w >= xTo - 0.5 && o.rect.y <= 0.5 && o.rect.y + o.rect.h >= Hp - 0.5);
        if (fd) { strips.push({ index: i, xFromCm: xFrom, xToCm: xTo, pieces: [], skipped: "french_door" }); t.push(`Lé ${i + 1} entièrement dans la porte-fenêtre : supprimé`); continue; }
        strips.push({ index: i, xFromCm: xFrom, xToCm: xTo, pieces: [{ stripIndex: i, fromCm: 0, toCm: r1(Hp), lengthCm: r1(sh), patternStartCm: p.matchType === "half_drop" ? (i % 2) * p.offsetCm : 0, reason: "full" }] });
      }
      const active = strips.filter((st) => !st.skipped);
      // Surface facturable : déduction au-delà du seuil, radiateurs jamais, zones exclues toujours
      const gross = (w.widthCm * Hp) / 1e4;
      let ded = 0; const dedTxt = [];
      for (const o of w.openings || []) {
        const a = (o.rect.w * o.rect.h) / 1e4;
        if (o.kind === "radiator") continue;
        if (o.kind === "excluded" || a > s.deductAboveM2) { ded += a; dedTxt.push(`${KIND_LBL[o.kind] || o.kind} de ${fq(o.rect.w)} × ${fq(o.rect.h)} cm`); }
      }
      for (const o of w.areaOnlyOpenings || []) { const a = (o.widthCm * o.heightCm) / 1e4; if (a > s.deductAboveM2) { ded += a; dedTxt.push(`${o.type === "door" ? "porte" : o.type === "window" ? "fenêtre" : "ouverture"} de ${fq(o.widthCm)} × ${fq(o.heightCm)} cm (sans position)`); } }
      const billableAreaM2 = r2(gross - ded);
      if (p.saleUnit === "m2") {
        const m2 = r2(active.length * (rw / 100) * (sh / 100));
        t.push(`Décor sur mesure : ${active.length} lés de ${fq(rw / 100)} m sur ${fq(sh / 100)} m de haut, soit ${fq(m2)} m² de décor`);
        t.push(`Surface de pose facturée : ${fq(billableAreaM2)} m²${dedTxt.length ? " (" + dedTxt.join(", ") + " déduite)" : ""}`);
        return { strips, rolls: [], rollCount: 0, rollsUsed: 0, simpleRollCount: 0, m2Decor: m2, billableAreaM2, grossAreaM2: r2(gross), deductedAreaM2: r2(ded), wasteTotalCm: 0, phaseOutCm: 0, stripCount: active.length, pieceCount: active.length, anchorIndex: 0, trace: t };
      }
      let spr = floor(p.rollLengthCm / sh); if (spr < 1) { spr = 1; t.push(`Rouleau de ${fq(p.rollLengthCm / 100)} m plus court qu'un lé : un rouleau par lé au moins`); }
      else t.push(`Lés par rouleau : un rouleau de ${fq(p.rollLengthCm / 100)} m donne ${spr} lés de ${fq(sh)} cm`);
      let rc = ceil(active.length / spr); t.push(`Rouleaux : ${active.length} lés à ${spr} par rouleau, soit ${rc} rouleaux`);
      const rolls = []; let k = 0;
      for (let r = 0; r < rc; r++) { const cuts = []; for (let c = 0; c < spr && k < active.length; c++, k++) cuts.push({ stripIndex: active[k].index, pieceIndex: 0, lengthCm: r1(sh) }); rolls.push({ index: r, cuts, wasteCm: r1(p.rollLengthCm - cuts.length * sh) }); }
      if (s.safetyRollIfPattern && p.matchType !== "free") { rc += 1; rolls.push({ index: rolls.length, cuts: [], wasteCm: p.rollLengthCm }); t.push(`Motif à raccord : un rouleau de réserve en plus, ${rc} au total`); }
      if (rc < p.minOrderRolls) { t.push(`Minimum de commande du fournisseur : ${p.minOrderRolls} rouleaux`); while (rolls.length < p.minOrderRolls) rolls.push({ index: rolls.length, cuts: [], wasteCm: p.rollLengthCm }); rc = p.minOrderRolls; }
      t.push(`Surface facturée : ${fq(billableAreaM2)} m²${dedTxt.length ? ", " + dedTxt.join(" et ") + " déduite" : ", ouvertures de plus de " + fq(s.deductAboveM2) + " m² déduites"}`);
      const phaseOutCm = p.matchType === "free" || !p.patternRepeatCm ? 0 : r1(((s.phaseOffsetCm || 0) + w.widthCm) % p.patternRepeatCm);
      return { strips, rolls, rollCount: rc, rollsUsed: rolls.filter((r) => r.cuts.length).length, simpleRollCount: rc, billableAreaM2, grossAreaM2: r2(gross), deductedAreaM2: r2(ded), wasteTotalCm: r1(rolls.reduce((a, r) => a + r.wasteCm, 0)), phaseOutCm, stripCount: active.length, pieceCount: active.length, anchorIndex: 0, trace: t };
    }

    function planRoom(walls) {
      const out = []; let phase = 0; const trace = [];
      walls.forEach((w, i) => { const inp = clone(w); inp.settings.phaseOffsetCm = phase; const pl = planStrips(inp); phase = pl.phaseOutCm; out.push(pl); trace.push(`Mur ${i + 1} : ${pl.rollCount} rouleaux`); });
      trace.push("Doublure : rouleaux additionnés mur par mur (pas d'empaquetage commun)");
      return { walls: out, rollCount: out.reduce((a, p) => a + p.rollCount, 0), trace };
    }

    const validAt = (list, date, pred) => (list || []).find((r) => (!pred || pred(r)) && (!r.validFrom || r.validFrom.slice(0, 10) <= date) && (!r.validTo || r.validTo.slice(0, 10) >= date));
    // WallInput du contrat (packages/quote-engine/src/contract.ts) → StripPlanInput : trapèze, ouvertures positionnées (V2) ou
    // sans position (déduites de la surface, jamais découpées), plinthes, départ du calepinage.
    function stripInputOf(wall, paper, settings) {
      const s = { ...settings, start: wall.start || settings.start || "left" }; if (wall.centerAtCm != null) s.centerAtCm = wall.centerAtCm;
      const w = { widthCm: wall.widthCm, heightLeftCm: wall.heightLeftCm != null ? wall.heightLeftCm : wall.heightCm, heightRightCm: wall.heightRightCm != null ? wall.heightRightCm : wall.heightCm, openings: wall.openingsV2 || [], baseboard: wall.baseboard || { enabled: false, heightCm: null } };
      if (!wall.openingsV2) w.areaOnlyOpenings = wall.openings || [];
      return { wall: w, paper, settings: s };
    }
    const LABOR_LBL = { pose_standard: "Pose sans raccord", pose_raccord: "Pose avec raccord", pose_panoramique: "Pose panoramique", preparation: "Préparation du support", depose: "Dépose de l'ancien papier" };
    function quoteOnce(input) {
      const st = input.settings, date = (input.quoteDate || "2026-01-01").slice(0, 10), lines = [], warnings = [], blockers = [];
      const tax = validAt(input.taxRates, date); if (!tax) blockers.push("tax_rate_missing"); const bp = tax ? tax.rateBp : 0;
      const deductAboveM2 = st.openingsRule && st.openingsRule.kind === "subtract_above_m2" ? st.openingsRule.thresholdM2 : st.openingsRule && st.openingsRule.kind === "subtract_all" ? 0 : Infinity;
      const stripSettings = { cutTopCm: st.cutMarginTopCm, cutBottomCm: st.cutMarginBottomCm, start: "left", deductAboveM2, safetyRollIfPattern: !!st.safetyRollIfPattern };
      let area = 0, stripCount = 0; const laborAreas = {};
      for (const wall of input.walls) {
        const wp = input.wallpaperByWall[wall.wallId]; if (!wp) { blockers.push(`wallpaper_missing:${wall.wallId}`); continue; }
        const W = wp.wallpaper, paper = { rollWidthCm: W.rollWidthCm, rollLengthCm: W.rollLengthCm, patternRepeatCm: W.patternRepeatCm, matchType: W.matchType, offsetCm: W.offsetCm, saleUnit: W.saleUnit || "roll", minOrderRolls: wp.price.minOrderRolls || 1 };
        const plan = planStrips(stripInputOf(wall, paper, stripSettings));
        if (plan.error) { blockers.push(`calepinage:${wall.wallId}:${plan.error}`); warnings.push(`Calepinage refusé (${wall.wallId}) : ${plan.trace[plan.trace.length - 1]}`); continue; }
        const m2 = paper.saleUnit === "m2"; area += plan.billableAreaM2; stripCount += plan.strips.length;
        const lt = m2 ? "pose_panoramique" : W.matchType === "free" ? "pose_standard" : "pose_raccord"; laborAreas[lt] = (laborAreas[lt] || 0) + plan.billableAreaM2;
        const sh = plan.strips.find((x) => x.pieces.length);
        const computation = { stripHeightCm: sh ? sh.pieces[0].lengthCm : 0, stripCount: plan.strips.length, stripsPerRoll: plan.rolls.length ? plan.rolls[0].cuts.length : 0, rollCount: plan.rollCount, billableAreaM2: plan.billableAreaM2, trace: plan.trace, simpleRollCount: plan.rollCount, plan: { walls: [plan], rollCount: plan.rollCount, trace: plan.trace, rolls: plan.rolls, rollsUsed: plan.rolls.filter((r) => r.cuts.length).length, separateRollCount: plan.rollCount, billableAreaM2: plan.billableAreaM2, wasteTotalCm: plan.wasteTotalCm } };
        if (m2) computation.m2Decor = plan.m2Decor;
        lines.push({ kind: "wallpaper", wallId: wall.wallId, wallpaperId: W.id, description: `${W.name}${W.colorName ? " " + W.colorName : ""} — ${W.sku}${m2 ? " (décor sur mesure, au m²)" : ""}`, qty: m2 ? plan.m2Decor : plan.rollCount, unit: m2 ? "m²" : "rouleau", unitPrice: wp.price.salePricePerRoll, taxRateBp: bp, computation });
      }
      area = r2(area);
      for (const c of input.consumables || []) { if (!(c.coverageM2PerUnit > 0)) { blockers.push(`consumable_coverage_invalid:${c.id}`); continue; } const q = ceil(Math.round(area * 100) / Math.round(c.coverageM2PerUnit * 100)); if (!q) continue; lines.push({ kind: "consumable", description: c.name, qty: q, unit: c.unit, unitPrice: c.price, taxRateBp: bp, computation: { trace: [`${c.name} : une unité couvre ${fq(c.coverageM2PerUnit)} m² → ${q} × ${c.unit} pour ${fq(area)} m²`] } }); }
      const install = input.options && input.options.install != null ? input.options.install : st.organizationInstalls;
      let laborMin = false;
      const pushLabor = (type, a) => {
        let rate = validAt(input.laborRates, date, (r) => r.type === type), price, unit, trace = [];
        if (rate) { price = rate.price; unit = rate.unit; } else if (type === "pose_panoramique" && st.laborPanoramicM2Cents != null) { price = st.laborPanoramicM2Cents; unit = "m2"; trace.push("Tarif panoramique pris dans les paramètres de l'organisation (aucun tarif dédié)"); } else { blockers.push(`labor_rate_missing:${type}`); return; }
        const q = unit === "forfait" ? 1 : Math.max(a, st.laborMinimumM2 || 0); if (q > a && unit !== "forfait") { laborMin = true; trace.push(`Minimum de pose ${fq(st.laborMinimumM2)} m² appliqué (surface ${fq(a)} m²)`); }
        trace.push(unit === "forfait" ? `${LABOR_LBL[type]} : forfait` : `${LABOR_LBL[type]} : ${fq(q)} m² × ${(price / 100).toFixed(2)}`);
        lines.push({ kind: "labor", description: LABOR_LBL[type], qty: q, unit: unit === "forfait" ? "forfait" : "m²", unitPrice: price, taxRateBp: bp, computation: { trace } });
      };
      if (install && area > 0) {
        for (const type of ["pose_standard", "pose_raccord", "pose_panoramique"]) if (laborAreas[type]) pushLabor(type, r2(laborAreas[type]));
        if (input.options && input.options.preparation) pushLabor("preparation", area); if (input.options && input.options.depose) pushLabor("depose", area);
        if (st.travelFlatFeeCents > 0) lines.push({ kind: "labor", description: "Déplacement", qty: 1, unit: "forfait", unitPrice: st.travelFlatFeeCents, taxRateBp: bp, computation: { trace: ["Forfait de déplacement de l'organisation"] } });
        if (input.options && input.options.travelOutsideCanton) { if (st.travelOutsideCantonCents > 0) lines.push({ kind: "labor", description: "Déplacement hors canton", qty: 1, unit: "forfait", unitPrice: st.travelOutsideCantonCents, taxRateBp: bp, computation: { trace: ["Forfait hors canton de l'organisation"] } }); else blockers.push("travel_rate_missing"); }
      }
      let subtotal = 0; for (const l of lines) { l.lineTotal = rhu(l.unitPrice * Math.round(l.qty * 100) / 100); subtotal += l.lineTotal; }
      const applies = st.discountAppliesTo || ["wallpaper"];
      const base = lines.filter((l) => applies.includes(l.kind)).reduce((a, l) => a + l.lineTotal, 0);
      const d = input.discount, discountTotal = !d ? 0 : d.type === "pct" ? rhu(base * d.value / 100) : Math.min(base, rhu(d.value));
      for (const l of lines) { const share = applies.includes(l.kind) && base ? discountTotal * l.lineTotal / base : 0; l.taxAmount = rhu((l.lineTotal - share) * l.taxRateBp / 1e4); }
      const net = subtotal - discountTotal, taxTotal = rhu(net * bp / 1e4); let total = net + taxTotal, roundingCents = 0; if (st.roundTotalToFiveCents) { const t5 = r5(total); roundingCents = t5 - total; total = t5; }
      const limit = d ? (d.sellerLimitPct != null ? d.sellerLimitPct : st.discountMaxPct) : null;
      return { engineVersion: "stub-0 (doublure, formule du prototype)", lines, subtotal, discountTotal, taxTotal, total, requiresAdminApproval: !!(d && d.type === "pct" && limit != null && d.value > limit), warnings, roundingCents, billableAreaM2: area, blockers, meta: { stripCount, laborMin } };
    }
    function scaleWall(w, k) {
      const o = { ...w, widthCm: r1(w.widthCm * k), heightCm: r1(w.heightCm * k), openings: (w.openings || []).map((x) => ({ ...x, widthCm: r1(x.widthCm * k), heightCm: r1(x.heightCm * k) })) };
      if (w.heightLeftCm != null) o.heightLeftCm = r1(w.heightLeftCm * k); if (w.heightRightCm != null) o.heightRightCm = r1(w.heightRightCm * k);
      if (w.openingsV2) o.openingsV2 = w.openingsV2.map((x) => ({ ...x, rect: { x: r1(x.rect.x * k), y: r1(x.rect.y * k), w: r1(x.rect.w * k), h: r1(x.rect.h * k) } }));
      return o;
    }
    function quoteRange(input, tolerancePct) {
      const t = (tolerancePct || 0) / 100, mid = quoteOnce(input), low = quoteOnce({ ...input, walls: input.walls.map((w) => scaleWall(w, 1 - t)) }), high = quoteOnce({ ...input, walls: input.walls.map((w) => scaleWall(w, 1 + t)) });
      const discreteChanges = [];
      for (const hl of high.lines) { if ((hl.kind !== "wallpaper" && hl.kind !== "consumable") || hl.unit === "m²") continue; const ll = low.lines.find((l) => l.kind === hl.kind && l.description === hl.description); if (ll && ll.qty !== hl.qty) discreteChanges.push(`${hl.description} : ${ll.qty} → ${hl.qty} ${hl.unit}${hl.qty > 1 ? (hl.unit === "rouleau" ? "x" : "s") : ""}`); }
      return { low, mid, high, thresholdInside: low.total !== high.total, discreteChanges };
    }
    g.WSQuote = { STUB: true, ENGINE_VERSION: "stub-0", planStrips, planRoom, quoteRange, computeQuote: quoteOnce };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
