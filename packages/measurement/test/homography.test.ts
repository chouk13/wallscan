import { describe, expect, it } from "vitest";
import type { Pt, Quad } from "@wallscan/core";
import {
  applyHomography, applyHomographyToQuad, homographyFromPoints, homographyQuadToQuad, invertHomography,
  normalizeHomography, quadToUnitSquare, rectQuad, reprojectionError, scaleHomography,
} from "../src/homography.js";
import {
  dist, fitLineTLS, intersectLines, intersectLinesH, lineFromPointDir, lineThrough, mat3ApplyH, mat3Det, mat3Identity,
  mat3Inv, mat3Mul, mat3Scale, mat3Transpose, pointLineDistance, smallestEigenvector, symmetricEigen,
} from "../src/linalg.js";

const close = (a: Pt, b: Pt, tol = 1e-9): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThan(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThan(tol);
};

describe("linalg", () => {
  it("produit, déterminant, inverse, transposée, échelle", () => {
    const a = [2, 0, 1, 0, 3, 2, 0.1, 0.2, 1];
    const inv = mat3Inv(a);
    expect(inv).not.toBeNull();
    const id = mat3Mul(a, inv!);
    const I = mat3Identity();
    for (let i = 0; i < 9; i++) expect(id[i]).toBeCloseTo(I[i], 10);
    expect(mat3Det(I)).toBe(1);
    expect(mat3Inv([1, 2, 3, 2, 4, 6, 1, 1, 1])).toBeNull(); // lignes dépendantes
    expect(mat3Inv([Number.NaN, 0, 0, 0, 1, 0, 0, 0, 1])).toBeNull();
    expect(mat3Transpose([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
    expect(mat3Scale(I, 2)[0]).toBe(2);
  });

  it("matrice · vecteur : la convention ligne par ligne est respectée (régression du bug matrice-vecteur)", () => {
    // H = [[2,0,1],[0,3,2],[0.1,0.2,1]] appliqué à (1,1) : (3, 5, 1.3) → (2.3077, 3.8462).
    const H = [2, 0, 1, 0, 3, 2, 0.1, 0.2, 1];
    const [x, y, w] = mat3ApplyH(H, 1, 1, 1);
    expect(x).toBeCloseTo(3, 12);
    expect(y).toBeCloseTo(5, 12);
    expect(w).toBeCloseTo(1.3, 12);
    const p = applyHomography(H, { x: 1, y: 1 });
    expect(p.x).toBeCloseTo(3 / 1.3, 12);
    expect(p.y).toBeCloseTo(5 / 1.3, 12);
    // La transposée donnerait un autre résultat : (2.1, 3.2, 3)/3 → (0.7, 1.0667) ; on vérifie qu'on ne la confond pas.
    const pt = applyHomography(mat3Transpose(H), { x: 1, y: 1 });
    expect(Math.abs(pt.x - p.x)).toBeGreaterThan(1);
    // Point à l'infini : résultat fini mais énorme, pas d'exception.
    const inf = applyHomography([1, 0, 0, 0, 1, 0, 0, 0, 0], { x: 1, y: 2 });
    expect(Number.isFinite(inf.x)).toBe(true);
    expect(Math.abs(inf.x)).toBeGreaterThan(1e6);
    const infNeg = applyHomography([1, 0, 0, 0, 1, 0, 0, 0, -1e-15], { x: 1, y: 2 });
    expect(infNeg.x).toBeLessThan(0);
  });

  it("valeurs propres de Jacobi sur une matrice connue", () => {
    // [[2,1],[1,2]] → valeurs 1 et 3, vecteur de 1 : (1,-1)/√2.
    const { values } = symmetricEigen([2, 1, 1, 2], 2);
    expect(values.slice().sort((a, b) => a - b).map((v) => +v.toFixed(9))).toEqual([1, 3]);
    const v = smallestEigenvector([2, 1, 1, 2], 2);
    expect(Math.abs(v[0] + v[1])).toBeLessThan(1e-9);
    // Matrice déjà diagonale : sortie immédiate.
    const d = symmetricEigen([4, 0, 0, 0, 9, 0, 0, 0, 1], 3);
    expect(d.values).toEqual([4, 9, 1]);
    expect(smallestEigenvector([4, 0, 0, 0, 9, 0, 0, 0, 1], 3)[2]).toBeCloseTo(1, 12);
    // Élément hors diagonale quasi nul : ignoré sans NaN.
    const tiny = symmetricEigen([1, 1e-310, 1e-310, 2], 2);
    expect(tiny.values[0]).toBeCloseTo(1, 12);
  });

  it("droites : intersection, distance, ajustement TLS", () => {
    const l1 = lineThrough({ x: 0, y: 0 }, { x: 1, y: 1 });
    const l2 = lineThrough({ x: 0, y: 1 }, { x: 1, y: 0 });
    close(intersectLines(l1, l2)!, { x: 0.5, y: 0.5 });
    expect(intersectLines(l1, lineThrough({ x: 0, y: 1 }, { x: 1, y: 2 }))).toBeNull();
    const h = intersectLinesH(l1, lineThrough({ x: 0, y: 1 }, { x: 1, y: 2 }));
    expect(Math.abs(h[2])).toBeLessThan(1e-12);
    expect(pointLineDistance(lineFromPointDir({ x: 0, y: 0 }, { x: 1, y: 0 }), { x: 5, y: 2 })).toBeCloseTo(2, 12);
    expect(Math.abs(pointLineDistance([0, 0, 1], { x: 0, y: 0 }))).toBeGreaterThan(1e6);
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    const fit = fitLineTLS([{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }])!;
    expect(Math.abs(fit.d.y / fit.d.x - 2)).toBeLessThan(1e-9);
    expect(fitLineTLS([{ x: 1, y: 1 }])).toBeNull();
    expect(fitLineTLS([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toBeNull();
    const horiz = fitLineTLS([{ x: 0, y: 1 }, { x: 5, y: 1 }])!;
    expect(Math.abs(horiz.d.x)).toBeCloseTo(1, 12);
    const vert = fitLineTLS([{ x: 1, y: 0 }, { x: 1, y: 5 }])!;
    expect(Math.abs(vert.d.y)).toBeCloseTo(1, 12);
  });
});

describe("homographie", () => {
  it("translation, échelle et cas projectif connu", () => {
    const sq = rectQuad(1, 1);
    const tr = rectQuad(1, 1, 10, 20);
    const H = homographyQuadToQuad(sq, tr)!;
    expect(H).not.toBeNull();
    expect(H[2]).toBeCloseTo(10, 9);
    expect(H[5]).toBeCloseTo(20, 9);
    expect(H[0]).toBeCloseTo(1, 9);
    // Valeurs connues : carré unité → trapèze (0,0),(1,0),(0.75,1),(0.25,1)
    const trap: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.75, y: 1 }, { x: 0.25, y: 1 }];
    const Ht = quadToUnitSquare(trap)!;
    expect(Ht).not.toBeNull();
    const inv = invertHomography(Ht)!;
    close(applyHomography(inv, { x: 0.5, y: 0.5 }), { x: 0.5, y: 2 / 3 }, 1e-9); // centre du carré → milieu projectif
    expect(reprojectionError(inv, rectQuad(1, 1), trap)).toBeLessThan(1e-9);
    expect(reprojectionError(Ht, trap, rectQuad(1, 1))).toBeLessThan(1e-9);
    const q2 = applyHomographyToQuad(Ht, trap);
    close(q2[2], { x: 1, y: 1 });
  });

  it("moindres carrés avec plus de 4 points et dégénérescences", () => {
    const H0 = [1.2, 0.1, 5, -0.05, 0.9, 7, 1e-4, 2e-4, 1];
    const src: Pt[] = [];
    const dst: Pt[] = [];
    for (let i = 0; i < 12; i++) {
      const p = { x: (i * 37) % 100, y: (i * 61) % 80 };
      src.push(p);
      dst.push(applyHomography(H0, p));
    }
    const H = homographyFromPoints(src, dst)!;
    expect(reprojectionError(H, src, dst)).toBeLessThan(1e-7);
    expect(homographyFromPoints(src.slice(0, 3), dst.slice(0, 3))).toBeNull();
    expect(homographyFromPoints(src.slice(0, 4), dst.slice(0, 5))).toBeNull();
    expect(homographyFromPoints([{ x: Number.NaN, y: 0 }, ...src.slice(1, 4)], dst.slice(0, 4))).toBeNull();
    // Points confondus : normalisation impossible.
    const same = [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }];
    expect(homographyFromPoints(same, dst.slice(0, 4))).toBeNull();
    expect(homographyFromPoints(src.slice(0, 4), same)).toBeNull();
    // Trois points alignés : homographie singulière.
    const col: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }];
    expect(homographyFromPoints(col, rectQuad(1, 1))).toBeNull();
  });

  it("normalisation, inversion et mise à l'échelle", () => {
    expect(normalizeHomography([1, 0, 0, 0, 1, 0, 0, 0, Number.NaN])).toBeNull();
    expect(normalizeHomography([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
    const affineNoW = normalizeHomography([0, 0, 1, 0, 1, 0, 1, 0, 0])!; // H[8] = 0 (permutation) : norme de Frobenius
    expect(affineNoW).not.toBeNull();
    expect(Math.abs(affineNoW[8])).toBeLessThan(1e-12);
    expect(invertHomography([1, 2, 3, 2, 4, 6, 1, 1, 1])).toBeNull();
    const S = scaleHomography(mat3Identity(), 4);
    close(applyHomography(S, { x: 1, y: 2 }), { x: 4, y: 8 });
  });
});
