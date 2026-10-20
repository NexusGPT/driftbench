import type { RerunMark } from '../schema/links';

/**
 * The blocks that always rerun, computed by two procedures and never listed by hand. A mark is written to the
 * spec (`metadata.rerun`) and read by the selection.
 *
 * R1, `fails_at_baseline`: a block that is red when nothing changed (it fails in at least half of the repeats of
 * the unmutated suite) reruns on every change. Any edit may be its fix, and a selection that skips it leaves the
 * user with a stale FAIL.
 *
 * R2, `fragile`: a block that flipped under `minMutants` or more mutants whose changed sections the links did not
 * select it for reruns on every change. It reacts to edits it has no link to, so no link can name them.
 *
 * Both are calibrated on the run they are given. The marks are then frozen into the map: a later sample is
 * measured with those marks, never with marks learned from it.
 */

export type RerunInput = {
  /** For each block, whether it failed in each repeat of the unmutated suite. */
  baseline: Readonly<Record<string, readonly boolean[]>>;
  /** For each mutant: the blocks it flipped (confirmed) and the blocks the links selected for it. */
  mutants: ReadonlyArray<{ id: string; flipped: readonly string[]; selected: readonly string[] }>;
  /** Blocks that cannot verify anything (flaky) and are never marked. Default none. */
  excluded?: ReadonlySet<string>;
  /** How many mutants a block must flip under, unselected, to be fragile. Default 2. */
  minMutants?: number;
};

export function rerunMarks(input: RerunInput): RerunMark[] {
  const minMutants = input.minMutants ?? 2;
  const marks: RerunMark[] = [];
  const marked = new Set<string>();
  for (const [block, failures] of Object.entries(input.baseline)) {
    if (input.excluded?.has(block) || failures.length === 0) continue;
    const failed = failures.filter(Boolean).length;
    if (failed * 2 >= failures.length) {
      marked.add(block);
      marks.push({ block, reason: 'fails_at_baseline', evidence: { failed, repeats: failures.length } });
    }
  }
  const unselected = new Map<string, string[]>();
  for (const mutant of input.mutants) {
    const selected = new Set(mutant.selected);
    for (const block of mutant.flipped) {
      if (selected.has(block) || input.excluded?.has(block)) continue;
      unselected.set(block, [...(unselected.get(block) ?? []), mutant.id]);
    }
  }
  for (const [block, ids] of [...unselected].sort(([a], [b]) => a.localeCompare(b))) {
    if (marked.has(block) || ids.length < minMutants) continue;
    marks.push({ block, reason: 'fragile', evidence: { mutants: ids.length, of: input.mutants.length } });
  }
  return marks;
}
