import type {
  EditClass,
  LedgerView,
  ManifestAtom,
  ManifestChange,
  RerunApi,
} from '../../../src/ladders/pointer/sut/port';
import { referenceBugsB } from './bugs-b';

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
  // Only a unit live before the edit can be deleted by it; one the old ledger already holds as deleted is not.
  const before = referenceBugsB.has('old-deleted-reported') ? previous.entries : live(previous);
  for (const entry of before) if (!seen.has(entry.id)) out.push({ id: entry.id, class: 'deleted' });
  return out;
}

const byId = (a: string, b: string) => a.localeCompare(b);

/** The rerun set in the order the units joined it, the advisory set, and the reason the whole suite reruns. */
function rerunSet(
  previous: LedgerView,
  current: LedgerView,
  defects: RerunDefects,
): { units: string[]; advisory: string[]; whole: string | null } {
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
      if (inFile.length === 0 && !referenceBugsB.has('file-unknown-skipped')) {
        // The first new unit of a file the ledger did not hold names the reason.
        const reason = `a new unit ${entry.id} in ${entry.path}, a file the ledger did not hold`;
        whole = referenceBugsB.has('whole-reason-last-wins') ? reason : (whole ?? reason);
        continue;
      }
      // The nearest heading above the new unit, its own first, that an old unit of the file sits under.
      const start = entry.sectionPath.length - (referenceBugsB.has('section-skips-own-heading') ? 1 : 0);
      for (let depth = start; depth >= (defects.noWholeFileFallback ? 1 : 0); depth -= 1) {
        const heading = entry.sectionPath.slice(0, depth);
        const siblings = inFile.filter((other) => sameList(other.sectionPath.slice(0, depth), heading));
        if (siblings.length === 0) {
          if (referenceBugsB.has('section-stops-at-empty')) break;
          continue;
        }
        for (const sibling of siblings) units.add(sibling.id);
        break;
      }
    }
  }
  return { units: [...units], advisory: [...advisory], whole };
}

/**
 * The change manifest of an edit (docs, "Rerun after an edit"): one global change when the whole suite reruns;
 * else each unit of the rerun set, in id order, is a `unit` change when no atom sits on it, and the atoms that sit
 * on the units (the unit an atom was built from, and its condition units) are `prompt` changes, in atom id order.
 */
function manifestOf(
  rerun: { units: string[]; whole: string | null },
  atoms: ReadonlyArray<ManifestAtom>,
): ManifestChange[] {
  if (rerun.whole !== null) return [{ kind: 'prompt', global: true }];
  const onUnit = new Map<string, Set<string>>();
  for (const atom of atoms) {
    const units = [
      atom.unit,
      ...(referenceBugsB.has('condition-units-not-mapped') ? [] : (atom.condition ?? [])),
    ];
    for (const unit of units) onUnit.set(unit, new Set([...(onUnit.get(unit) ?? []), atom.id]));
  }
  const order = referenceBugsB.has('manifest-unsorted') ? rerun.units : [...rerun.units].sort(byId);
  const changes: ManifestChange[] = [];
  const prompts = new Set<string>();
  for (const unit of order) {
    const held = [...(onUnit.get(unit) ?? [])];
    if (held.length === 0) changes.push({ kind: 'unit', id: unit });
    for (const atom of held) prompts.add(atom);
  }
  for (const atom of [...prompts].sort(byId)) changes.push({ kind: 'prompt', id: atom });
  return changes;
}

export function makeRerun(defects: RerunDefects = {}): RerunApi {
  return {
    classify: classifyWith(defects),
    rerun(previous, current) {
      const out = rerunSet(previous, current, defects);
      return { units: [...out.units].sort(), advisory: [...out.advisory].sort(), whole: out.whole };
    },
    manifest(previous, current, atoms) {
      return manifestOf(rerunSet(previous, current, defects), atoms);
    },
  };
}

export const referenceRerun: RerunApi = makeRerun();
