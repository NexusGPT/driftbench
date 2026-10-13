import type { Change, ChangeManifest } from './change';

/** An approved map entry and the dependencies derived from its exact evidence quote. */
export type PromptAnchor = {
  entry: string;
  source: string;
  quote: string;
  changes: Change[];
};

/**
 * Map the changed text to approved evidence quotes. No fuzzy match can justify a carry. The enclosing
 * changed span must be covered in full: matching one edit never hides a second, unmapped edit. Multiple
 * separated edits may therefore over-select. Insertions at a quote boundary are unknown, since they may
 * introduce a new global instruction. Ambiguous, stale or unmapped evidence also fails closed.
 */
export function promptChangeManifest(
  before: string,
  after: string,
  anchors: readonly PromptAnchor[],
  versions: { from: string; to: string },
): ChangeManifest {
  const whole = (note: string): ChangeManifest => ({
    ...versions,
    changes: [{ kind: 'prompt', global: true, note }],
  });
  if (before === after) {
    return versions.from === versions.to
      ? { ...versions, changes: [] }
      : whole('no changed quote explains the version transition');
  }
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = before.length;
  let nextEnd = after.length;
  while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) {
    end--;
    nextEnd--;
  }
  const matches: { anchor: PromptAnchor; start: number; end: number }[] = [];
  for (const anchor of anchors) {
    if (!anchor.quote.trim()) return whole(`empty quote: ${anchor.entry}`);
    // Map whitespace-normalised evidence back to raw offsets; changed prompt bytes are never normalised.
    const pattern = anchor.quote
      .trim()
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');
    const occurrences = [...before.matchAll(new RegExp(pattern, 'g'))];
    if (occurrences.length === 0) return whole(`stale quote: ${anchor.entry}`);
    const matching = occurrences.filter((found) => {
      const at = found.index,
        until = at + found[0].length;
      return start === end ? at < start && start < until : at < end && start < until;
    });
    if (matching.length === 0) continue;
    if (occurrences.length > 1) return whole(`ambiguous quote: ${anchor.entry}`);
    const [match] = matching;
    if (!match) continue;
    const at = match.index;
    const until = at + match[0].length;
    if (anchor.changes.length === 0) return whole(`unmapped quote: ${anchor.entry}`);
    matches.push({ anchor, start: at, end: until });
  }
  if (matches.length === 0) return whole('no quote matched: the change is outside every declared anchor');
  let covered = start;
  for (const match of [...matches].sort((a, b) => a.start - b.start)) {
    if (match.start > covered) break;
    covered = Math.max(covered, match.end);
  }
  if (covered < end) return whole('changed text outside the declared anchors');
  return {
    ...versions,
    changes: matches.flatMap(({ anchor, start: at, end: until }) =>
      anchor.changes.map((change) => ({
        ...change,
        note: `anchor ${anchor.entry} (${anchor.source}:${at}-${until}): ${JSON.stringify(anchor.quote)}`,
      })),
    ),
  };
}
