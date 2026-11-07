/** Statistiques simples pour le rapport du banc. */
export interface Summary {
  n: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function summarize(values: readonly number[]): Summary {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { n: 0, p50: Number.NaN, p95: Number.NaN, max: Number.NaN, mean: Number.NaN };
  return {
    n,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted[n - 1],
    mean: sorted.reduce((s, v) => s + v, 0) / n,
  };
}

export function fmt(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

export function pctBelow(values: readonly number[], threshold: number): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return Number.NaN;
  return (finite.filter((v) => v < threshold).length / finite.length) * 100;
}

export function summaryRow(label: string, values: readonly number[], unit = "%"): string {
  const s = summarize(values);
  return `| ${label} | ${s.n} | ${fmt(s.p50)} ${unit} | ${fmt(s.p95)} ${unit} | ${fmt(s.max)} ${unit} |`;
}
