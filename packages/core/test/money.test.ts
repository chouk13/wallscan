import { describe, expect, it } from "vitest";
import {
  add, applyPercentBp, cents, formatCents, mulQty, mulRatio, parseCents, roundToFiveCents, sub, sum, ZERO,
} from "../src/money.js";

describe("money (centimes entiers)", () => {
  it("refuse les non-entiers", () => {
    expect(() => cents(1 / 3)).toThrow();
    expect(() => cents(Number.MAX_SAFE_INTEGER + 2)).toThrow();
  });
  it("additionne / soustrait / somme", () => {
    expect(add(cents(100), cents(250))).toBe(350);
    expect(sub(cents(100), cents(250))).toBe(-150);
    expect(sum([cents(1), cents(2), cents(3)])).toBe(6);
    expect(sum([])).toBe(ZERO);
  });
  it("multiplie par une quantité entière", () => {
    expect(mulQty(cents(1990), 7)).toBe(13930);
    expect(() => mulQty(cents(1), 2 / 4)).toThrow();
  });
  it("applique un ratio avec arrondi half-up", () => {
    expect(mulRatio(cents(1000), 1, 3)).toBe(333);
    expect(mulRatio(cents(1000), 2, 3)).toBe(667);
    expect(mulRatio(cents(5), 1, 2)).toBe(3);
    expect(mulRatio(cents(-5), 1, 2)).toBe(-3);
  });
  it("TVA 8,1 % en points de base", () => {
    expect(applyPercentBp(cents(10000), 810)).toBe(810);
    expect(applyPercentBp(cents(12345), 810)).toBe(1000); // 999.945 → 1000
    expect(applyPercentBp(cents(12345), 260)).toBe(321); // 320.97 → 321
  });
  it("arrondit aux 5 centimes à la suisse", () => {
    expect(roundToFiveCents(cents(1001))).toBe(1000);
    expect(roundToFiveCents(cents(1002))).toBe(1000);
    expect(roundToFiveCents(cents(1003))).toBe(1005);
    expect(roundToFiveCents(cents(1007))).toBe(1005);
    expect(roundToFiveCents(cents(1008))).toBe(1010);
    expect(roundToFiveCents(cents(-1003))).toBe(-1005);
  });
  it("parse et formate", () => {
    expect(parseCents("12.35")).toBe(1235);
    expect(parseCents("12,3")).toBe(1230);
    expect(parseCents("-7")).toBe(-700);
    expect(() => parseCents("1.234")).toThrow();
    expect(formatCents(cents(123456))).toContain("1");
    expect(formatCents(cents(-50), "CHF", "de-CH")).toContain("0.50");
  });
});
