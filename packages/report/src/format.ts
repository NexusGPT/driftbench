import type { CarriedSummary } from './data';
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

/**
 * The lines that say a campaign merges fresh and carried results, and from which agent version the
 * carried ones come when it is not the version the campaign runs. Empty when every run is fresh.
 */
export function carriedLines(summary: CarriedSummary | undefined): string[] {
  if (!summary) return [];
  const runs = (n: number) => `${n} ${n === 1 ? 'run' : 'runs'}`;
  const lines = [
    `Fresh and carried results are merged: ${runs(summary.fresh)} fresh, ${runs(summary.carried)} carried. Every rate over this campaign counts both.`,
  ];
  for (const source of summary.sources) {
    const other =
      source.agentVersion === undefined
        ? 'an agent version nothing names'
        : summary.versions.includes(source.agentVersion)
          ? `the same agent version, ${source.agentVersion}`
          : `another agent version, ${source.agentVersion}${summary.versions.length > 0 ? ` (this campaign runs ${summary.versions.join(', ')})` : ''}`;
    const campaigns = `${source.maxCampaigns} ${source.maxCampaigns === 1 ? 'campaign' : 'campaigns'}`;
    lines.push(
      `  ${runs(source.runs)} carried from ${source.campaign}, measured on ${other}; oldest: ${campaigns}, ${source.maxDays.toFixed(1)} days.`,
    );
  }
  return lines;
}

/**
 * The runs neither passed nor failed, as they follow the fail count: `2 not run, 1 blocked, `, each part
 * only when above 0, the separator after each; the empty string when there is none.
 */
export function unscoredRuns(counts: { notRun?: number; blocked?: number }, separator = ', '): string {
  const parts = [
    ...(counts.notRun ? [`${counts.notRun} not run`] : []),
    ...(counts.blocked ? [`${counts.blocked} blocked`] : []),
  ];
  return parts.map((part) => `${part}${separator}`).join('');
}
