import type { Change, ChangeManifest } from './change';
import { normalizePrompt, type PromptRegion, promptDiff } from './prompt-diff';

/** An approved map entry and the dependencies derived from its exact evidence quote. */
export type PromptAnchor = { entry: string; source: string; quote: string; changes: Change[] };
type Span = { start: number; end: number };

/** Lookahead advances one code unit, so overlapping occurrences are counted too. */
function occurrences(text: string, quote: string): Span[] {
  const pattern = quote
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  if (!pattern) return [];
  return [...text.matchAll(new RegExp(`(?=(${pattern}))`, 'g'))].map((match) => ({
    start: match.index,
    end: match.index + (match[1]?.length ?? 0),
  }));
}
const overlap = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
// Strict interior also rejects insertions/deletions at either boundary.
const inside = (start: number, end: number, span: Span) => span.start < start && end < span.end;
const label = (r: PromptRegion) => `region old:${r.oldStart}-${r.oldEnd} new:${r.newStart}-${r.newEnd}`;

/**
 * Every diff region needs one unique, nonoverlapping anchor on BOTH sides. An edited anchor is located
 * in the candidate only through its unchanged first/last characters in a unique optimal alignment;
 * its resulting quote must itself occur exactly once. Missing edges or any doubt selects everything.
 */
export function promptChangeManifest(
  before: string,
  after: string,
  anchors: readonly PromptAnchor[],
  versions: { from: string; to: string },
): ChangeManifest {
  before = normalizePrompt(before);
  after = normalizePrompt(after);
  const whole = (notes: string[]): ChangeManifest => ({
    ...versions,
    changes: [{ kind: 'prompt', global: true, note: notes.join('\n') }],
  });
  if (before === after)
    return versions.from === versions.to
      ? { ...versions, changes: [] }
      : whole(['region none: no normalized change explains the version transition; whole suite']);
  const diff = promptDiff(before, after);
  const fail = (rule: string) =>
    whole(diff.regions.map((region) => `${label(region)}: ${rule}; whole suite`));
  const located: { anchor: PromptAnchor; old: Span; next: Span }[] = [];
  for (const anchor of anchors) {
    const quote = normalizePrompt(anchor.quote);
    if (!quote.trim()) return fail(`empty quote: ${anchor.entry}`);
    const oldMatches = occurrences(before, quote);
    const old = oldMatches[0];
    if (oldMatches.length !== 1 || !old)
      return fail(`${old ? 'ambiguous' : 'stale'} quote in old text: ${anchor.entry}`);
    const start = diff.equal.get(old.start),
      last = diff.equal.get(old.end - 1);
    if (start === undefined || last === undefined || last < start)
      return fail(`anchor cannot be located unambiguously in new text: ${anchor.entry}`);
    const next = { start, end: last + 1 };
    const nextMatches = occurrences(after, after.slice(next.start, next.end));
    if (nextMatches.length !== 1 || nextMatches[0]?.start !== next.start || nextMatches[0]?.end !== next.end)
      return fail(`ambiguous quote in new text: ${anchor.entry}`);
    if (located.some((other) => overlap(old, other.old) || overlap(next, other.next)))
      return fail(`overlapping anchors: ${anchor.entry}`);
    located.push({ anchor, old, next });
  }
  if (diff.uncertainty) return fail(diff.uncertainty);
  const changes: Change[] = [];
  const notes: string[] = [];
  let unsafe = false;
  for (const region of diff.regions) {
    const matches = located.filter(
      (item) =>
        inside(region.oldStart, region.oldEnd, item.old) && inside(region.newStart, region.newEnd, item.next),
    );
    const matched = matches[0];
    if (matches.length !== 1 || !matched) {
      unsafe = true;
      notes.push(
        `${label(region)}: no quote matched on both sides; outside or boundary of declared anchors; whole suite`,
      );
      continue;
    }
    const { anchor, old, next } = matched;
    const note = `${label(region)}: anchor ${anchor.entry} (${anchor.source}; old:${old.start}-${old.end}, new:${next.start}-${next.end}): ${JSON.stringify(anchor.quote)}`;
    if (anchor.changes.length === 0) {
      unsafe = true;
      notes.push(`${note}; unmapped anchor; whole suite`);
    } else {
      notes.push(`${note}; covered on both sides`);
      changes.push(
        ...anchor.changes.map((change) => ({ ...change, note: `${note}; covered on both sides` })),
      );
    }
  }
  return unsafe ? whole(notes) : { ...versions, changes };
}
