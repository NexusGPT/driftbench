import type { EditClass, LedgerView, RerunApi } from '../../../src/ladders/pointer/sut/port';

/**
 * The rerun rule of docs/estate-pointer-reader.md, "Rerun after an edit", written from that page: the class of each
 * unit between two ledgers, and the old units whose links rerun or are only reported.
 */

const live = (view: LedgerView) => view.entries.filter((entry) => entry.status === 'live');
const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** The defects the audit planted in the real rule, for the tests that show the items red on them. */
export type RerunDefects = {
  /** A deleted unit reruns nothing. */
  deletedRerunsNothing?: boolean;
  /** A new unit with no old sibling under its headings does not fall back to the whole file. */
  noWholeFileFallback?: boolean;
  /** A change of context only is read as no change. */
  contextIsUnchanged?: boolean;
};

function classifyWith(
  defects: RerunDefects,
): (previous: LedgerView, current: LedgerView) => Array<{ id: string; class: EditClass }> {
  return (previous, current) => classify(previous, current, defects);
}

function classify(
  previous: LedgerView,
  current: LedgerView,
  defects: RerunDefects = {},
): Array<{ id: string; class: EditClass }> {
  const old = new Map(live(previous).map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const out: Array<{ id: string; class: EditClass }> = [];
  for (const entry of live(current)) {
    seen.add(entry.id);
    const prior = old.get(entry.id);
    let kind: EditClass;
    if (!prior) kind = 'new';
    else if (prior.fp !== entry.fp) kind = 'changed';
    else if (prior.path !== entry.path) kind = 'moved';
    else if (
      !defects.contextIsUnchanged &&
      (prior.ctxFp !== entry.ctxFp || !sameList(prior.sectionPath, entry.sectionPath))
    )
      kind = 'context';
    else kind = 'unchanged';
    out.push({ id: entry.id, class: kind });
  }
  for (const entry of live(previous)) if (!seen.has(entry.id)) out.push({ id: entry.id, class: 'deleted' });
  return out;
}

export function makeRerun(defects: RerunDefects = {}): RerunApi {
  return {
    classify: classifyWith(defects),
    rerun(previous, current) {
      const units = new Set<string>();
      const advisory = new Set<string>();
      let whole: string | null = null;
      const old = live(previous);
      const now = new Map(live(current).map((entry) => [entry.id, entry]));
      for (const change of classify(previous, current, defects)) {
        if (change.class === 'changed' || (change.class === 'deleted' && !defects.deletedRerunsNothing))
          units.add(change.id);
        else if (change.class === 'context' || change.class === 'moved') advisory.add(change.id);
        else if (change.class === 'new') {
          const entry = now.get(change.id);
          if (!entry) continue;
          const inFile = old.filter((other) => other.path === entry.path);
          if (inFile.length === 0) {
            whole ??= `a new unit ${entry.id} in ${entry.path}, a file the ledger did not hold`;
            continue;
          }
          for (
            let depth = entry.sectionPath.length;
            depth >= (defects.noWholeFileFallback ? 1 : 0);
            depth -= 1
          ) {
            const heading = entry.sectionPath.slice(0, depth);
            const siblings = inFile.filter((other) => sameList(other.sectionPath.slice(0, depth), heading));
            if (siblings.length === 0) continue;
            for (const sibling of siblings) units.add(sibling.id);
            break;
          }
        }
      }
      return { units: [...units].sort(), advisory: [...advisory].sort(), whole };
    },
  };
}

export const referenceRerun: RerunApi = makeRerun();
