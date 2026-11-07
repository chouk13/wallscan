/**
 * Argent = entiers en centimes. Jamais de `number` flottant pour un montant (§9).
 * Les fonctions ici sont les SEULES autorisées pour manipuler des montants.
 */

declare const centsBrand: unique symbol;
/** Montant en centimes, entier signé. */
export type Cents = number & { readonly [centsBrand]: true };

export type Currency = "CHF" | "EUR";

export class MoneyError extends Error {
  override readonly name = "MoneyError";
}

export function cents(n: number): Cents {
  if (!Number.isInteger(n)) throw new MoneyError(`Montant non entier: ${n}`);
  if (!Number.isSafeInteger(n)) throw new MoneyError(`Montant hors plage: ${n}`);
  return n as Cents;
}

export const ZERO: Cents = cents(0);

export function add(a: Cents, b: Cents): Cents {
  return cents(a + b);
}

export function sub(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

export function sum(values: readonly Cents[]): Cents {
  return values.reduce<Cents>((acc, v) => add(acc, v), ZERO);
}

/** Multiplie un montant par une quantité entière. */
export function mulQty(a: Cents, qty: number): Cents {
  if (!Number.isInteger(qty) || qty < 0) throw new MoneyError(`Quantité invalide: ${qty}`);
  return cents(a * qty);
}

/**
 * Multiplie un montant par un ratio exprimé en entiers (numérateur / dénominateur),
 * arrondi commercial au centime (half-up). Ex. TVA 8,1 % → ratio(810, 10000).
 */
export function mulRatio(a: Cents, numerator: number, denominator: number): Cents {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new MoneyError(`Ratio invalide: ${numerator}/${denominator}`);
  }
  const product = a * numerator;
  const q = Math.trunc(product / denominator);
  const r = product - q * denominator;
  const half = denominator / 2;
  const absR = Math.abs(r);
  if (absR > half || (absR === half && denominator % 2 === 0)) {
    return cents(q + Math.sign(product));
  }
  return cents(q);
}

/** Pourcentage en points de base (bp) : 8,1 % = 810 bp. Évite tout flottant dans les taux. */
export type BasisPoints = number;

export function applyPercentBp(a: Cents, bp: BasisPoints): Cents {
  if (!Number.isInteger(bp)) throw new MoneyError(`Points de base non entiers: ${bp}`);
  return mulRatio(a, bp, 10_000);
}

/** Arrondi suisse aux 5 centimes (commercial, half-up). */
export function roundToFiveCents(a: Cents): Cents {
  const sign = a < 0 ? -1 : 1;
  const abs = Math.abs(a);
  const rounded = Math.floor((abs + 2) / 5) * 5; // 0,1,2 → bas ; 3,4 → haut
  return cents(sign * rounded);
}

/** Formatage pour affichage uniquement — jamais pour recalculer. */
export function formatCents(a: Cents, currency: Currency = "CHF", locale = "fr-CH"): string {
  const units = Math.trunc(a / 100);
  const rest = Math.abs(a - units * 100);
  const value = Number(`${a < 0 && units === 0 ? "-" : ""}${units}.${rest.toString().padStart(2, "0")}`);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
}

/** Parse "12.35" / "12,35" / "12" en centimes. Refuse plus de 2 décimales. */
export function parseCents(input: string): Cents {
  const m = /^\s*(-)?(\d+)(?:[.,](\d{1,2}))?\s*$/.exec(input);
  if (!m) throw new MoneyError(`Montant illisible: "${input}"`);
  const sign = m[1] ? -1 : 1;
  const units = Number(m[2]);
  const dec = (m[3] ?? "").padEnd(2, "0");
  return cents(sign * (units * 100 + Number(dec)));
}
