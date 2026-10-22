import type { ChangeManifest } from '@agent-nexus/driftbench-core';
import { normativeEstate } from '../scan/document-roles';
import type { RawEstate } from '../scan/reader';
import type { DocumentInfo } from '../schema';
import { cut } from './cut';
import { type Ledger, type LedgerEntry, nextLedger } from './ledger';

/**
 * The blast radius on the ledger: what an edit of the prose reruns, read from the ledger before the edit and
 * the ledger after it. Unit ids persist across edits, so the two ledgers name the same unit by the same id,
 * and each unit falls in one edit class. The rerun set of each class is fixed by `RERUN_RULE`:
 *
 * - `unchanged`: the same text and the same neighbours. Nothing reruns.
 * - `context`: the same text, other neighbours or another heading path. Advisory: its links are reported,
 *   nothing reruns for it (a reference the link does not show, such as "as described above").
 * - `moved`: the same text in another file. Advisory, as `context`.
 * - `changed`: the text changed. Its links rerun.
 * - `deleted`: the unit is gone. Its links rerun.
 * - `new`: no old unit is followed into it, so no link names it. The links of the old units of its section
 *   rerun: the units under the same headings in the same file, else under the nearest heading above, else
 *   every unit of the file. A new unit in a file the old ledger never held reruns the whole suite.
 *
 * The ladder's own events land in these classes: a split keeps the old id on its first piece (`changed`)
 * and mints the others (`new`); a merge keeps the first old id (`changed`) and ends the second (`deleted`);
 * an ambiguous text keeps the old id on its first match and mints the others (`new`). So the rerun set of a
 * split, a merge or an ambiguous text is the union of the rerun sets of its classes.
 */

export const EDIT_CLASSES = ['unchanged', 'context', 'moved', 'changed', 'deleted', 'new'] as const;
export type EditClass = (typeof EDIT_CLASSES)[number];

export const RERUN_RULE: Readonly<Record<EditClass, 'none' | 'advisory' | 'unit' | 'section'>> = {
  unchanged: 'none',
  context: 'advisory',
  moved: 'advisory',
  changed: 'unit',
  deleted: 'unit',
  new: 'section',
};

export type UnitChange = {
  id: string;
  class: EditClass;
  /** The file of the unit: after the edit, or before it for a deleted unit. */
  path: string;
  /** The headings above the unit, outermost first, on the same side as `path`. */
  sectionPath: string[];
  /** The unit's text, collapsed: after the edit, or before it for a deleted unit. */
  quote: string;
  /** The text before the edit, when it changed. */
  was?: string;
  /** The file before the edit, when the unit moved. */
  from?: string;
};

const live = (ledger: Ledger): LedgerEntry[] => ledger.entries.filter((entry) => entry.status === 'live');

/** Every live unit of either ledger in its edit class, in the order of the ledger after the edit, deleted units last. */
export function ledgerChanges(before: Ledger, after: Ledger): UnitChange[] {
  const old = new Map(live(before).map((entry) => [entry.id, entry]));
  const now = live(after);
  const out: UnitChange[] = [];
  const seen = new Set<string>();
  for (const entry of now) {
    seen.add(entry.id);
    const prior = old.get(entry.id);
    const at = { id: entry.id, path: entry.path, sectionPath: entry.sectionPath, quote: entry.quote };
    if (!prior) out.push({ ...at, class: 'new' });
    else if (prior.fp !== entry.fp) out.push({ ...at, class: 'changed', was: prior.quote });
    else if (prior.path !== entry.path) out.push({ ...at, class: 'moved', from: prior.path });
    else if (prior.ctxFp !== entry.ctxFp) out.push({ ...at, class: 'context' });
    else out.push({ ...at, class: 'unchanged' });
  }
  for (const entry of live(before)) {
    if (seen.has(entry.id)) continue;
    out.push({
      id: entry.id,
      path: entry.path,
      sectionPath: entry.sectionPath,
      quote: entry.quote,
      class: 'deleted',
    });
  }
  return out;
}

export type Rerun = {
  /** The old units whose links rerun, with the reasons, by id. */
  units: Map<string, string[]>;
  /** The units whose links are reported and do not rerun, with the reasons, by id. */
  advisory: Map<string, string[]>;
  /** Set when the whole suite reruns, with the reason. */
  whole: string | null;
};

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, at) => value === b[at]);

/** The rerun set of the changes: each class by `RERUN_RULE`, the `new` class through the old units of its section. */
export function rerunOf(changes: readonly UnitChange[], before: Ledger): Rerun {
  const units = new Map<string, string[]>();
  const advisory = new Map<string, string[]>();
  let whole: string | null = null;
  const add = (into: Map<string, string[]>, id: string, why: string) => {
    const list = into.get(id) ?? [];
    if (!list.includes(why)) list.push(why);
    into.set(id, list);
  };
  const old = live(before);
  for (const change of changes) {
    const rule = RERUN_RULE[change.class];
    if (rule === 'unit') add(units, change.id, change.class);
    else if (rule === 'advisory') add(advisory, change.id, change.class);
    else if (rule === 'section') {
      const inFile = old.filter((entry) => entry.path === change.path);
      if (inFile.length === 0) {
        whole ??= `a new unit ${change.id} in ${change.path}, a file the ledger did not hold`;
        continue;
      }
      // The nearest heading above the new unit that an old unit of the file sits under.
      for (let depth = change.sectionPath.length; depth >= 0; depth--) {
        const heading = change.sectionPath.slice(0, depth);
        const siblings = inFile.filter((entry) => sameList(entry.sectionPath.slice(0, depth), heading));
        if (siblings.length === 0) continue;
        for (const entry of siblings) add(units, entry.id, `new unit ${change.id} beside it`);
        break;
      }
    }
  }
  return { units, advisory, whole };
}

export type ManifestOptions = {
  from: string;
  to: string;
  /** The atoms of the map before the edit that sit on each unit, by unit id (`fields.unit`, `fields.condition`). */
  atomsByUnit?: ReadonlyMap<string, readonly string[]>;
};

/**
 * The change manifest of a rerun set. A unit that holds atoms is the `prompt` change of each atom: the tests
 * that name the atom rerun, as for any atom. A unit that holds none is a `unit` change: its tests link it by
 * `estate_unit` links, a selection that stays advisory, so the radius is the whole suite.
 */
export function ledgerChangeManifest(rerun: Rerun, options: ManifestOptions): ChangeManifest {
  const changes: ChangeManifest['changes'] = [];
  if (rerun.whole !== null) {
    changes.push({ kind: 'prompt', global: true, note: rerun.whole });
    return { from: options.from, to: options.to, changes };
  }
  const prompts = new Map<string, string[]>();
  for (const [unit, why] of [...rerun.units].sort(([a], [b]) => a.localeCompare(b))) {
    const atoms = options.atomsByUnit?.get(unit) ?? [];
    if (atoms.length === 0) {
      changes.push({ kind: 'unit', id: unit, note: why.join('; ') });
      continue;
    }
    for (const atom of atoms)
      prompts.set(atom, [...(prompts.get(atom) ?? []), `unit ${unit}: ${why.join('; ')}`]);
  }
  for (const [atom, why] of [...prompts].sort(([a], [b]) => a.localeCompare(b)))
    changes.push({ kind: 'prompt', id: atom, note: why.join('; ') });
  return { from: options.from, to: options.to, changes };
}

/** The atoms of a map by the units they sit on: the unit an atom was built from and the units of its conditions. */
export function atomsByUnit(
  atoms: ReadonlyArray<{ id: string; fields?: Record<string, unknown> }>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const atom of atoms) {
    const fields = atom.fields ?? {};
    const units = [
      ...(typeof fields.unit === 'string' ? [fields.unit] : []),
      ...(Array.isArray(fields.condition)
        ? fields.condition.filter((each): each is string => typeof each === 'string')
        : []),
    ];
    for (const unit of units) out.set(unit, [...new Set([...(out.get(unit) ?? []), atom.id])].sort());
  }
  return out;
}

/** The count of each edit class. */
export function editCounts(changes: readonly UnitChange[]): Record<EditClass, number> {
  const counts = Object.fromEntries(EDIT_CLASSES.map((name) => [name, 0])) as Record<EditClass, number>;
  for (const change of changes) counts[change.class]++;
  return counts;
}

/**
 * The ledger of an estate's prose as it is now, followed from a previous ledger, with no labeler: the files
 * the pointer scan reads (each file that holds normative prose, by the document roles the map records: an
 * example, a fixture, a template or a history is no part of it), cut and followed as the scan does. Labels carry where the scan would carry them; nothing is
 * labelled.
 */
export function proseLedger(
  raw: RawEstate,
  previous: Ledger | undefined,
  estateKey = 'estate',
  documents: ReadonlyArray<DocumentInfo> = [],
): Ledger {
  // The roles the scan recorded in the map stand: a document its role pass found to be a fixture or a template
  // is no part of the ledger now either.
  const recorded = new Map(documents.map((document) => [document.path, document]));
  const normative = normativeEstate({
    ...raw,
    files: raw.files.map((file) => {
      const document = recorded.get(file.path);
      return document === undefined ? file : { ...file, document };
    }),
  });
  const texts = new Map(normative.files.map((file) => [file.path, file.text]));
  const files = new Set(normative.prose.map((chunk) => chunk.file));
  const paths = [...files].sort((a, b) => a.localeCompare(b));
  return nextLedger(
    paths.map((path) => ({ path, cut: cut(texts.get(path) ?? ''), text: texts.get(path) ?? '' })),
    previous,
    estateKey,
  ).ledger;
}
