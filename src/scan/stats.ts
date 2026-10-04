// Small counting helpers shared by the scan aggregator and the markdown renderer.

/** Percentage with one decimal; 0 when the denominator is 0. */
export const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((1000 * n) / d) / 10);

export function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2;
}
export function quantile(xs: number[], q: number): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export function bump(m: Record<string, number>, k: string, n = 1) {
  m[k] = (m[k] ?? 0) + n;
}
export function rank(m: Record<string, number>) {
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}
