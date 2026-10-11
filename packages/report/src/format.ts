import type { Estimate } from './estimate';

/** Escapes text for HTML element content and attribute values. */
export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A proportion as a percentage with one decimal: 0.926 gives 92.6%. */
export function pct(value: number): string {
  return `${fixed(value * 100, 1)}%`;
}

/** A difference of two proportions in points, signed: 0.05 gives +5.0. */
export function points(value: number): string {
  const text = fixed(value * 100, 1);
  return value > 0 && text !== '0.0' ? `+${text}` : text;
}

/** A number with fixed decimals, never `-0`. */
export function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

/** A p-value: four decimals, or `< 0.0001`. */
export function pValue(value: number): string {
  return value < 0.0001 ? '< 0.0001' : fixed(value, 4);
}

/** US dollars: four decimals under a cent, else two. */
export function usd(value: number): string {
  return `$${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

/** The interval of an estimate as text, in the unit `show` writes. A `none` interval says why it is missing. */
export function interval(estimate: Estimate, show: (value: number) => string): string {
  if (estimate.method === 'none') return 'no interval: one cluster';
  return `[${show(estimate.lower)}, ${show(estimate.upper)}]`;
}

/** Singular or plural: `1 run`, `3 runs`. */
export function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

/** JSON for a drilldown, cut to a readable length. */
export function json(value: unknown, limit = 3000): string {
  const text = JSON.stringify(value, null, 2) ?? 'undefined';
  return text.length > limit ? `${text.slice(0, limit)}\n... (${text.length - limit} more characters)` : text;
}
