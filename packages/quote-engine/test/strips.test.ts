import { describe, expect, it } from "vitest";
import { planRoom, planStrips, type StripPlanInput } from "../src/index.js";
import { compareWithSimple } from "../src/strips.js";
import { input, op, paper, settings, wall } from "./helpers.js";

describe("planStrips — validation et refus explicites", () => {
  it("plinthes activées sans hauteur → baseboard_height_missing, trace explicite, aucune valeur par défaut", () => {
    const plan = planStrips(
      input(wall(400, 250, [], { baseboard: { enabled: true, heightCm: null } })),
    );
    expect(plan.error).toBe("baseboard_height_missing");
    expect(plan.strips).toEqual([]);
    expect(plan.rolls).toEqual([]);
    expect(plan.rollCount).toBe(0);
    expect(plan.trace).toHaveLength(1);
    expect(plan.trace[0]).toMatch(/plinthe/);
    expect(plan.trace[0]).toMatch(/aucune valeur par défaut/);
  });
  it("plinthes désactivées avec hauteur null → OK, pleine hauteur", () => {
    const plan = planStrips(
      input(wall(400, 250, [], { baseboard: { enabled: false, heightCm: null } })),
    );
    expect(plan.error).toBeUndefined();
    expect(plan.strips[0]!.heightCm).toBe(250);
  });
  it("plinthe de hauteur invalide ou plus haute que le mur → invalid_wall", () => {
    expect(
      planStrips(input(wall(400, 250, [], { baseboard: { enabled: true, heightCm: 0 } }))).error,
    ).toBe("invalid_wall");
    expect(
      planStrips(input(wall(400, 250, [], { baseboard: { enabled: true, heightCm: -3 } }))).error,
    ).toBe("invalid_wall");
    expect(
      planStrips(input(wall(400, 250, [], { baseboard: { enabled: true, heightCm: 250 } }))).error,
    ).toBe("invalid_wall");
  });
  it("dimensions du mur invalides → invalid_wall", () => {
    expect(planStrips(input(wall(0, 250))).error).toBe("invalid_wall");
    expect(planStrips(input(wall(400, -1))).error).toBe("invalid_wall");
    expect(planStrips(input({ ...wall(400, 250), heightRightCm: Number.NaN })).error).toBe(
      "invalid_wall",
    );
  });
  it("papier invalide → invalid_paper", () => {
    expect(planStrips(input(wall(400, 250), { rollWidthCm: 0 })).error).toBe("invalid_paper");
    expect(planStrips(input(wall(400, 250), { rollLengthCm: 0 })).error).toBe("invalid_paper");
    expect(planStrips(input(wall(400, 250), { patternRepeatCm: -1 })).error).toBe("invalid_paper");
    expect(planStrips(input(wall(400, 250), { offsetCm: -1 })).error).toBe("invalid_paper");
    expect(planStrips(input(wall(400, 250), { minOrderRolls: -1 })).error).toBe("invalid_paper");
    expect(planStrips(input(wall(400, 250), {}, { cutTopCm: -1 })).error).toBe("invalid_paper");
    expect(planStrips(input(wall(400, 250), {}, { cutBottomCm: Number.NaN })).error).toBe(
      "invalid_paper",
    );
    expect(planStrips(input(wall(400, 250), {}, { deductAboveM2: -1 })).error).toBe(
      "invalid_paper",
    );
  });
  it("vente au m² : la longueur de rouleau peut être 0", () => {
    const plan = planStrips(
      input(wall(400, 250), { rollLengthCm: 0, saleUnit: "m2", rollWidthCm: 100 }),
    );
    expect(plan.error).toBeUndefined();
    expect(plan.m2Decor).toBe(4 * 1 * 2.6);
  });
  it("le refus renvoie la phase d'entrée en sortie (chaînage préservé)", () => {
    const plan = planStrips(input(wall(0, 250), {}, { phaseOffsetCm: 12 }));
    expect(plan.phaseOutCm).toBe(12);
  });
});

describe("planStrips — géométrie des lés", () => {
  it("départ gauche : lés de largeur w, dernier lé rogné au mur", () => {
    const plan = planStrips(input(wall(400, 250)));
    expect(plan.strips.map((s) => [s.xFromCm, s.xToCm])).toEqual([
      [0, 53],
      [53, 106],
      [106, 159],
      [159, 212],
      [212, 265],
      [265, 318],
      [318, 371],
      [371, 400],
    ]);
  });
  it("centré sur l'axe : lé central symétrique, indexation gauche → droite", () => {
    const plan = planStrips(input(wall(400, 250), {}, { start: "centered" }));
    const center = plan.strips.find((s) => s.xFromCm === 173.5)!;
    expect(center.xToCm).toBe(226.5);
    expect(plan.strips).toHaveLength(9);
    expect(plan.strips[0]!.xFromCm).toBe(0);
    expect(plan.strips.at(-1)!.xToCm).toBe(400);
    expect(plan.trace.some((t) => t.includes("motif centré sur 200 cm (axe du mur)"))).toBe(true);
  });
  it("centré sur un point hors du mur : le point est ramené au bord", () => {
    const left = planStrips(input(wall(400, 250), {}, { start: "centered", centerAtCm: -50 }));
    expect(left.strips[0]!.xFromCm).toBe(0);
    expect(left.strips[0]!.xToCm).toBe(26.5);
    const right = planStrips(input(wall(400, 250), {}, { start: "centered", centerAtCm: 900 }));
    expect(right.strips.at(-1)!.xFromCm).toBe(373.5);
    expect(right.strips.at(-1)!.xToCm).toBe(400);
  });
  it("centerAtCm est ignoré en départ gauche", () => {
    const a = planStrips(input(wall(400, 250), {}, { start: "left", centerAtCm: 100 }));
    const b = planStrips(input(wall(400, 250)));
    expect(a.strips).toEqual(b.strips);
  });
  it("trapèze : la hauteur d'un lé est le max sur son intervalle, surface = hauteur moyenne", () => {
    const plan = planStrips(input({ ...wall(400, 250), heightLeftCm: 258, heightRightCm: 250 }));
    expect(plan.strips[0]!.heightCm).toBe(258);
    expect(plan.strips.at(-1)!.heightCm).toBe(250.6);
    expect(plan.grossAreaM2).toBe(10.16);
    expect(plan.trace[0]).toContain("trapèze");
  });
  it("les longueurs sont arrondies au millimètre (entrées flottantes)", () => {
    const plan = planStrips(input(wall(418.333, 250.049)));
    expect(plan.strips[0]!.heightCm).toBe(250);
    expect(plan.strips.at(-1)!.xToCm).toBe(418.3);
  });
});

describe("planStrips — ouvertures et morceaux", () => {
  it("une ouverture qui ne couvre qu'une partie de la largeur du lé ne le découpe pas", () => {
    const plan = planStrips(input(wall(400, 250, [op("f", "window", 170, 50, 30, 100)])));
    expect(plan.strips[3]!.pieces).toHaveLength(1);
    expect(plan.strips[3]!.pieces[0]!.reason).toBe("full");
  });
  it("ouverture au ras du plafond : pas de morceau au-dessus ; au ras du sol : pas de morceau en dessous", () => {
    const top = planStrips(input(wall(400, 250, [op("f", "window", 150, 0, 120, 100)])));
    expect(top.strips[3]!.pieces.map((p) => p.reason)).toEqual(["below_opening"]);
    expect(top.strips[3]!.pieces[0]!.fromCm).toBe(100);
    expect(top.strips[3]!.pieces[0]!.toCm).toBe(250);
    const bottom = planStrips(input(wall(400, 250, [op("p", "door", 150, 40, 120, 210)])));
    expect(bottom.strips[3]!.pieces.map((p) => p.reason)).toEqual(["above_opening"]);
    expect(bottom.strips[3]!.pieces[0]!.usefulCm).toBe(40);
    expect(bottom.strips[3]!.pieces[0]!.lengthCm).toBe(50);
    expect(bottom.strips[3]!.pieces[0]!.openingIds).toEqual(["p"]);
  });
  it("ouvertures qui se chevauchent verticalement : intervalles fusionnés", () => {
    const plan = planStrips(
      input(
        wall(400, 250, [op("a", "window", 150, 40, 120, 100), op("b", "niche", 150, 100, 120, 80)]),
      ),
    );
    const pieces = plan.strips[3]!.pieces;
    expect(pieces.map((p) => p.reason)).toEqual(["above_opening", "below_opening"]);
    expect(pieces[1]!.fromCm).toBe(180);
    expect(pieces[1]!.openingIds).toEqual(["a", "b"]);
  });
  it("ouverture débordant du papier (sous la plinthe, hors du mur) : rognée", () => {
    const plan = planStrips(
      input(
        wall(400, 250, [op("p", "door", -20, 60, 100, 300)], {
          baseboard: { enabled: true, heightCm: 10 },
        }),
      ),
    );
    expect(plan.strips[0]!.pieces.map((p) => p.reason)).toEqual(["above_opening"]);
    // surface : porte rognée à x ∈ [0, 80], y ∈ [60, 240] → 0,8 × 1,8 = 1,44 m² > 1 → déduite ; brut 4 × 2,4 = 9,6
    expect(plan.deductedAreaM2).toBe(1.44);
    expect(plan.billableAreaM2).toBe(8.16);
  });
  it("ouverture entièrement hors du mur horizontalement : surface nulle, aucune découpe", () => {
    const plan = planStrips(input(wall(400, 250, [op("x", "window", 500, 50, 100, 100)])));
    expect(plan.deductedAreaM2).toBe(0);
    expect(plan.pieceCount).toBe(8);
  });
  it("ouverture de rectangle vide : ignorée avec une ligne de trace", () => {
    const plan = planStrips(input(wall(400, 250, [op("vide", "window", 100, 100, 0, 50)])));
    expect(plan.pieceCount).toBe(8);
    expect(plan.trace.some((t) => t.includes("« vide » ignorée"))).toBe(true);
  });
  it("porte pleine hauteur qui n'est pas une porte-fenêtre : lé sauté avec la raison full_height_opening", () => {
    const plan = planStrips(input(wall(400, 250, [op("p", "door", 159, 0, 53, 250)])));
    expect(plan.strips[3]!.skipped).toBe("full_height_opening");
    expect(plan.stripCount).toBe(7);
  });
  it("mur entièrement couvert par une porte-fenêtre : 0 rouleau, pas de réserve ni de minimum", () => {
    const plan = planStrips(
      input(wall(100, 250, [op("pf", "french_door", 0, 0, 100, 250)]), {
        minOrderRolls: 2,
        patternRepeatCm: 64,
        matchType: "straight",
      }),
    );
    expect(plan.error).toBeUndefined();
    expect(plan.stripCount).toBe(0);
    expect(plan.rollCount).toBe(0);
    expect(plan.rolls).toEqual([]);
    expect(plan.trace.some((t) => t.includes("Aucun papier nécessaire"))).toBe(true);
  });
  it("règle de déduction : seuil 0 (tout déduire) et seuil infini (ne rien déduire)", () => {
    const openings = [
      op("f", "window", 150, 50, 50, 50),
      op("r", "radiator", 10, 180, 60, 50),
      op("x", "excluded", 300, 0, 40, 40),
    ];
    const all = planStrips(input(wall(400, 250, openings), {}, { deductAboveM2: 0 }));
    expect(all.deductedAreaM2).toBe(0.41); // fenêtre 0,25 + zone exclue 0,16, jamais le radiateur
    const none = planStrips(
      input(wall(400, 250, openings), {}, { deductAboveM2: Number.POSITIVE_INFINITY }),
    );
    expect(none.deductedAreaM2).toBe(0.16); // la zone exclue est toujours déduite
    expect(none.trace.some((t) => t.includes("règle de l'entreprise : jamais"))).toBe(true);
  });
  it("ouvertures non positionnées : surface déduite selon le seuil, lés jamais découpés", () => {
    const plan = planStrips(
      input(
        wall(400, 250, [], {
          areaOnlyOpenings: [
            { type: "window", widthCm: 180, heightCm: 140 },
            { type: "door", widthCm: 80, heightCm: 200 },
          ],
        }),
        {},
        { deductAboveM2: 2 },
      ),
    );
    expect(plan.pieceCount).toBe(8);
    expect(plan.deductedAreaM2).toBe(2.52);
    expect(plan.trace.some((t) => t.includes("position inconnue"))).toBe(true);
  });
});

describe("planStrips — raccords", () => {
  it("raccord déclaré sans hauteur de raccord → pose libre, pas de réserve", () => {
    const plan = planStrips(input(wall(400, 250), { matchType: "straight", patternRepeatCm: 0 }));
    expect(plan.rollCount).toBe(3);
    expect(plan.trace.some((t) => t.includes("traité comme une pose libre"))).toBe(true);
    expect(plan.strips[0]!.phaseCm).toBe(0);
  });
  it("raccord droit : phase identique sur tous les lés, patternStart = phase + position verticale", () => {
    const plan = planStrips(
      input(
        wall(400, 250, [op("f", "window", 150, 70, 120, 100)]),
        { matchType: "straight", patternRepeatCm: 64 },
        { phaseOffsetCm: 10 },
      ),
    );
    expect(plan.strips.every((s) => s.phaseCm === 10)).toBe(true);
    const below = plan.strips[3]!.pieces.find((p) => p.reason === "below_opening")!;
    expect(below.patternStartCm).toBe((10 + 170) % 64);
    expect(plan.phaseOutCm).toBe(10);
    expect(plan.trace.some((t) => t.includes("continuité du mur précédent"))).toBe(true);
  });
  it("raccord sauté sans décalage renseigné : demi-raccord ; raccord décalé : offsetCm", () => {
    const half = planStrips(
      input(wall(400, 250), { matchType: "half_drop", patternRepeatCm: 64, offsetCm: 0 }),
    );
    expect(half.strips.map((s) => s.phaseCm)).toEqual([0, 32, 0, 32, 0, 32, 0, 32]);
    const off = planStrips(
      input(wall(400, 250), { matchType: "offset", patternRepeatCm: 60, offsetCm: 20 }),
    );
    expect(off.strips.map((s) => s.phaseCm)).toEqual([0, 20, 0, 20, 0, 20, 0, 20]);
    expect(
      off.trace.some((t) =>
        t.includes("Raccord décalé de 60 cm : décalage de 20 cm un lé sur deux"),
      ),
    ).toBe(true);
  });
  it("départ centré avec raccord sauté : l'alternance part du lé central", () => {
    const plan = planStrips(
      input(
        wall(400, 250),
        { matchType: "half_drop", patternRepeatCm: 64, offsetCm: 32 },
        { start: "centered" },
      ),
    );
    const center = plan.strips.findIndex((s) => s.xFromCm === 173.5);
    expect(plan.strips[center]!.phaseCm).toBe(0);
    expect(plan.strips[center - 1]!.phaseCm).toBe(32);
    expect(plan.strips[center + 1]!.phaseCm).toBe(32);
  });
  it("position du motif respectée sur chaque coupe d'un rouleau (origine + début + marge haute ≡ patternStart)", () => {
    const plan = planStrips(
      input(wall(500, 250, [op("f", "window", 150, 70, 120, 100)]), {
        matchType: "half_drop",
        patternRepeatCm: 64,
        offsetCm: 32,
      }),
    );
    for (const roll of plan.rolls) {
      const first = roll.cuts[0]!;
      const firstPiece = plan.strips[first.stripIndex]!.pieces[first.pieceIndex]!;
      const origin = (((firstPiece.patternStartCm - 5) % 64) + 64) % 64;
      for (const c of roll.cuts) {
        const piece = plan.strips[c.stripIndex]!.pieces[c.pieceIndex]!;
        expect((origin + c.startCm + 5) % 64).toBeCloseTo(piece.patternStartCm, 6);
      }
    }
  });
});

describe("planStrips — rouleaux", () => {
  it("rollCount ≥ rollsUsed ; réserve puis minimum fournisseur", () => {
    const plan = planStrips(
      input(wall(100, 250), { matchType: "straight", patternRepeatCm: 64, minOrderRolls: 4 }),
    );
    expect(plan.rollsUsed).toBe(1);
    expect(plan.rollCount).toBe(4);
    expect(
      plan.trace.some((t) => t.includes("Minimum de commande du fournisseur : 4 rouleaux")),
    ).toBe(true);
  });
  it("sans option de réserve, pas de rouleau ajouté", () => {
    const plan = planStrips(
      input(
        wall(100, 250),
        { matchType: "straight", patternRepeatCm: 64 },
        { safetyRollIfPattern: false },
      ),
    );
    expect(plan.rollCount).toBe(1);
  });
  it("chute d'un rouleau = longueur − Σ coupes ; usedCm = fin de la dernière coupe", () => {
    const plan = planStrips(input(wall(400, 250), { matchType: "straight", patternRepeatCm: 64 }));
    const r = plan.rolls[0]!;
    expect(r.wasteCm).toBe(1005 - 3 * 260);
    expect(r.usedCm).toBe(900);
    expect(r.cuts.map((c) => c.startCm)).toEqual([0, 320, 640]);
  });
  it("vente au m² avec raccord : trace de phase, pas de rouleau, lés sautés exclus du décor", () => {
    const plan = planStrips(
      input(wall(400, 250, [op("pf", "french_door", 159, 0, 53, 250)]), {
        saleUnit: "m2",
        rollLengthCm: 0,
        rollWidthCm: 53,
        matchType: "straight",
        patternRepeatCm: 64,
      }),
    );
    expect(plan.rollCount).toBe(0);
    expect(plan.stripCount).toBe(7);
    expect(plan.m2Decor).toBe(9.65); // 7 × 0,53 × 2,60 = 9,646 → 9,65
    expect(plan.trace.some((t) => t.startsWith("Motif en sortie"))).toBe(true);
  });
  it("verdicts de comparaison avec la formule simple", () => {
    expect(compareWithSimple(0, 320, 0, 8, 4)).toContain("inapplicable");
    expect(compareWithSimple(4, 320, 3, 8, 4)).toContain("identique");
    expect(compareWithSimple(5, 320, 3, 8, 4)).toContain("1 de moins");
    expect(compareWithSimple(3, 320, 3, 8, 4)).toContain("anomalie");
  });
});

describe("planRoom", () => {
  const straight = (w: number): StripPlanInput =>
    input(wall(w, 250), { matchType: "straight", patternRepeatCm: 64 });
  it("aucune paroi → invalid_wall", () => {
    const room = planRoom([]);
    expect(room.error).toBe("invalid_wall");
    expect(room.walls).toEqual([]);
  });
  it("références différentes → invalid_paper, murs précédents conservés", () => {
    const room = planRoom([straight(400), input(wall(300, 250), { rollWidthCm: 70 })]);
    expect(room.error).toBe("invalid_paper");
    expect(room.rollCount).toBe(0);
    expect(room.trace.at(-1)).toContain("mur 2");
  });
  it("un mur refusé → la pièce est refusée avec la même erreur, le mur fautif porte le refus", () => {
    const room = planRoom([
      straight(400),
      {
        ...straight(300),
        wall: wall(300, 250, [], { baseboard: { enabled: true, heightCm: null } }),
      },
    ]);
    expect(room.error).toBe("baseboard_height_missing");
    expect(room.walls).toHaveLength(2);
    expect(room.walls[1]!.error).toBe("baseboard_height_missing");
    expect(room.walls[1]!.phaseOutCm).toBe(0);
  });
  it("morceau plus long que le rouleau dans la pièce → piece_longer_than_roll", () => {
    const room = planRoom([
      input(wall(100, 300), { rollLengthCm: 300 }),
      input(wall(100, 300), { rollLengthCm: 300 }),
    ]);
    expect(room.error).toBe("piece_longer_than_roll");
    expect(room.walls.every((w) => w.error === "piece_longer_than_roll")).toBe(true);
  });
  it("vente au m² : décor et surface sommés, 0 rouleau", () => {
    const m2 = (w: number): StripPlanInput =>
      input(wall(w, 250), { saleUnit: "m2", rollLengthCm: 0, rollWidthCm: 100 });
    const room = planRoom([m2(400), m2(300)]);
    expect(room.error).toBeUndefined();
    expect(room.rollCount).toBe(0);
    expect(room.m2Decor).toBe(18.2); // 4 × 2,6 + 3 × 2,6
    expect(room.billableAreaM2).toBe(17.5);
  });
  it("phase d'entrée explicite sur le premier mur, propagée ; les coupes portent l'index du mur", () => {
    const first = { ...straight(400), settings: settings({ phaseOffsetCm: 20 }) };
    const room = planRoom([first, straight(300)]);
    expect(room.walls[0]!.strips[0]!.phaseCm).toBe(20);
    expect(room.walls[1]!.strips[0]!.phaseCm).toBe(20);
    expect(room.rolls.flatMap((r) => r.cuts).some((c) => c.wallIndex === 1)).toBe(true);
    expect(room.rollCount).toBeLessThanOrEqual(room.separateRollCount);
  });
  it("la pièce impose la même variante de découpe à chaque mur (cohérence rouleaux ↔ morceaux)", () => {
    const tiny = input(
      wall(504, 278, [op("n", "niche", 144, 177, 293, 9)]),
      { rollLengthCm: 661, patternRepeatCm: 120, matchType: "half_drop", offsetCm: 60 },
      { safetyRollIfPattern: false },
    );
    const room = planRoom([tiny, { ...tiny, wall: wall(200, 278) }]);
    expect(room.error).toBeUndefined();
    for (const r of room.rolls) {
      for (const c of r.cuts) {
        const w = room.walls[c.wallIndex!]!;
        expect(w.strips[c.stripIndex]!.pieces.some((p) => p.pieceIndex === c.pieceIndex)).toBe(
          true,
        );
      }
    }
  });
  it("planStrips et planRoom à un mur donnent la même commande", () => {
    const one = input(wall(400, 250, [op("f", "window", 150, 15, 120, 140)]), {
      matchType: "straight",
      patternRepeatCm: 32,
    });
    expect(planRoom([one]).rollCount).toBe(planStrips(one).rollCount);
    expect(paper().rollWidthCm).toBe(53);
  });
});
