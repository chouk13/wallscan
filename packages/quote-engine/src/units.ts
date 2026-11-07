/**
 * Unités et formatage.
 *
 * Toutes les longueurs sont converties en MILLIMÈTRES ENTIERS à l'entrée du moteur (arrondi au mm) :
 * les positions de raccord, les modulos et les comparaisons sont alors exacts, sans bruit flottant.
 * Les sorties sont reconverties en cm (une décimale au plus). Les surfaces sont manipulées en mm²
 * et arrondies au centième de m² à la sortie.
 */

/** cm (nombre quelconque) → mm entier. */
export function toMm(cm: number): number {
  return Math.round(cm * 10);
}

/** mm entier → cm (exact à une décimale). */
export function mmToCm(mm: number): number {
  return mm / 10;
}

/** mm² → m² arrondi au centième (0,01 m² = 10 000 mm²). */
export function mm2ToM2(mm2: number): number {
  return Math.round(mm2 / 10_000) / 100;
}

/** Modulo toujours positif (JavaScript renvoie un reste signé). */
export function mod(a: number, m: number): number {
  const r = a % m;
  return r < 0 ? r + m : r;
}

/**
 * Nombre en notation française : virgule décimale, au plus `maxDecimals` décimales, zéros inutiles supprimés.
 * Volontairement sans `Intl` pour être identique sur tous les moteurs JavaScript (déterminisme de la trace).
 */
export function fmtNum(value: number, maxDecimals = 2): string {
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(value * factor) / factor;
  let s = rounded.toFixed(maxDecimals);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s.replace(".", ",");
}

export function fmtCm(mm: number): string {
  return `${fmtNum(mmToCm(mm), 1)} cm`;
}

export function fmtM(mm: number): string {
  return `${fmtNum(mm / 1000, 2)} m`;
}

export function fmtM2(mm2: number): string {
  return `${fmtNum(mm2ToM2(mm2), 2)} m²`;
}

/** Pluriel français simple : plural(1, "lé") → "1 lé", plural(3, "lé") → "3 lés". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${fmtNum(n, 2)} ${n > 1 ? pluralForm : singular}`;
}
