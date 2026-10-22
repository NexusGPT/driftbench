import { createHash } from 'node:crypto';
import type { Cut, Unit } from './cut';
import { sha } from './cut';
import { canonical } from './labels';

/**
 * The ledger gives each unit a stable identity and remembers what each label set said about it. An id is
 * derived once from (estate key, file, fingerprint, occurrence) and then persisted, never recomputed: a unit
 * that is edited keeps its id when the ladder below can follow it.
 */

export type LedgerLabel = {
  label: string;
  /** The hash of the label set that was asked. */
  setHash: string;
  /** The hash of the labelers and settings that decided the label. A change of either re-labels the unit. */
  labeler: string;
  /** The cassette keys (first 12 characters) of the answers the label comes from. */
  source: string;
  /** The class that decided: system1 or system2. */
  by?: 'system1' | 'system2';
  target?: string;
  /** Clauses of the unit by offsets into its text; kept with the label, valid while the unit's text is. */
  spans?: Array<{ kind: string; from: number; to: number; polarity?: string }>;
  /** Atoms the unit points at, by kind and id. */
  links?: Array<{ kind: string; to: string }>;
};

export type LedgerEntry = {
  id: string;
  path: string;
  /** The unit's place in its file at the last scan. */
  index: number;
  sectionPath: string[];
  container: string;
  fp: string;
  /** Fingerprint of the neighbours and the headings: a change here can flip a label the unit text does not show. */
  ctxFp: string;
  quote: string;
  prefix: string;
  suffix: string;
  status: 'live' | 'deleted';
  labels: Record<string, LedgerLabel>;
};

export type Ledger = { version: 1; cutDigests: Record<string, string>; entries: LedgerEntry[] };

export type Event = 'new' | 'unchanged' | 'moved' | 'ambiguous' | 'changed' | 'split' | 'merged' | 'deleted';

/** A file and its cut; with the source text, the quote and its context are slices of the source. */
export type FileCut = { path: string; cut: Cut; source?: string };

/** The place of a unit in the estate: its file and its index in the cut. */
export const unitKey = (path: string, index: number): string => `${path}\0${index}`;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** Ten base32 characters of the hash of (estate key, file, fingerprint, occurrence). */
export function mintId(estateKey: string, path: string, fp: string, occurrence: number): string {
  const digest = createHash('sha256').update(`${estateKey}\0${path}\0${fp}\0${occurrence}`).digest();
  let bits = '';
  for (const byte of digest.subarray(0, 7)) bits += byte.toString(2).padStart(8, '0');
  let id = '';
  for (let position = 0; position < 10; position++) {
    id += ALPHABET[Number.parseInt(bits.slice(position * 5, position * 5 + 5), 2)];
  }
  return id;
}

/**
 * The first id that is not taken, minted from the occurrence number upward. An injective `mint` meets at most
 * `taken.size` taken ids in a row, so more attempts than that mean `mint` gives one id to several occurrence
 * numbers (it ignores the occurrence). The loop then stops with an error that names the id and the attempts,
 * and never runs forever.
 */
export function freeId(
  mint: (occurrence: number) => string,
  taken: ReadonlySet<string>,
  from: number,
): string {
  let id = mint(from);
  for (let attempts = 1; taken.has(id); attempts++) {
    if (attempts > taken.size)
      throw new Error(
        `The id ${id} is taken and was minted again on attempt ${attempts} for occurrences ${from} to ${from + attempts - 1} (${taken.size} ids taken): the id base ignores the occurrence number.`,
      );
    id = mint(from + attempts);
  }
  return id;
}

const squash = (text: string): string => text.normalize('NFC').replace(/\s+/g, ' ').trim();

type Fresh = {
  path: string;
  index: number;
  unit: Unit;
  quote: string;
  prefix: string;
  suffix: string;
  ctxFp: string;
};

/** UTF-16 code units of source kept on each side of a quote. */
const CONTEXT_UNITS = 24;

function freshOf(files: readonly FileCut[]): Fresh[] {
  const out: Fresh[] = [];
  for (const { path, cut, source } of files) {
    cut.units.forEach((unit, index) => {
      const before = cut.units[index - 1];
      const after = cut.units[index + 1];
      const sliced = source !== undefined;
      out.push({
        path,
        index,
        unit,
        quote: sliced ? source.slice(unit.start, unit.end) : squash(unit.text),
        prefix: sliced
          ? source.slice(Math.max(0, unit.start - CONTEXT_UNITS), unit.start)
          : squash(before?.text ?? '').slice(-32),
        suffix: sliced
          ? source.slice(unit.end, unit.end + CONTEXT_UNITS)
          : squash(after?.text ?? '').slice(0, 32),
        ctxFp: sha(`${before?.fp ?? ''}\n${after?.fp ?? ''}\n${unit.path.join('>')}`).slice(0, 16),
      });
    });
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, column) => column);
  for (let row = 1; row <= a.length; row++) {
    const current = [row];
    for (let column = 1; column <= b.length; column++) {
      current[column] = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

const similarity = (a: string, b: string): number => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word !== ''),
  );
}

function jaccard(a: string, b: string): number {
  const left = wordSet(a);
  const right = wordSet(b);
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  const union = left.size + right.size - shared;
  return union === 0 ? 1 : shared / union;
}

/** The longest common subsequence of two fingerprint lists: the unchanged anchors. */
function anchors(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const rows = a.length;
  const columns = b.length;
  const table = Array.from({ length: rows + 1 }, () => new Uint16Array(columns + 1));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = columns - 1; j >= 0; j--) {
      const row = table[i];
      if (!row) continue;
      row[j] =
        a[i] === b[j] ? (table[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) i++;
    else j++;
  }
  return out;
}

/** Starting values for the ladder. The text floor stops a rewritten unit from being carried by its context alone. */
export const LADDER = { threshold: 0.45, textFloor: 0.4, exactFloor: 12, joinMargin: 0.25 } as const;

type Mapping = { event: Event; to: Fresh[] };

/**
 * Follows the old live entries into the new units, cheapest first: unchanged anchors by file, the same text
 * elsewhere (moved, or ambiguous when several match), a split or merge, then the best-scoring pair in the
 * same file (0.6 text, 0.4 context, with the text floor). What nothing claims is deleted.
 */
function follow(old: readonly LedgerEntry[], fresh: readonly Fresh[]): Map<string, Mapping> {
  const result = new Map<string, Mapping>();
  const used = new Set<Fresh>();
  const paths = [...new Set(old.map((entry) => entry.path))];
  for (const path of paths) {
    const before = old.filter((entry) => entry.path === path);
    const after = fresh.filter((item) => item.path === path);
    for (const [i, j] of anchors(
      before.map((entry) => entry.fp),
      after.map((item) => item.unit.fp),
    )) {
      const entry = before[i];
      const item = after[j];
      if (!entry || !item) continue;
      result.set(entry.id, { event: 'unchanged', to: [item] });
      used.add(item);
    }
  }
  const openOld = () => old.filter((entry) => !result.has(entry.id));
  const openNew = () => fresh.filter((item) => !used.has(item));

  // A short text names little: it keeps its id across files only when it is the only unit with that text in the
  // old estate and in the new one. A short text that repeats falls back to the scored pass in its own file.
  const count = (list: ReadonlyArray<{ fp: string }>, fp: string): number =>
    list.filter((item) => item.fp === fp).length;
  for (const entry of openOld()) {
    const unique =
      count(old, entry.fp) === 1 &&
      count(
        fresh.map((item) => item.unit),
        entry.fp,
      ) === 1;
    if (entry.quote.length < LADDER.exactFloor && !unique) continue;
    const hits = openNew().filter((item) => item.unit.fp === entry.fp);
    if (hits.length === 1 && hits[0]) {
      result.set(entry.id, { event: 'moved', to: hits });
      used.add(hits[0]);
    } else if (hits.length > 1) {
      result.set(entry.id, { event: 'ambiguous', to: hits });
      for (const hit of hits) used.add(hit);
    }
  }

  const score = (entry: LedgerEntry, item: Fresh): number =>
    0.6 * similarity(entry.quote, item.quote) +
    0.4 *
      (0.35 * similarity(entry.prefix, item.prefix) +
        0.35 * similarity(entry.suffix, item.suffix) +
        0.3 * jaccard(entry.sectionPath.join('>'), item.unit.path.join('>')));

  // Split: two neighbouring new units read better together than apart as the old one.
  for (const entry of openOld()) {
    const run = openNew()
      .filter((item) => item.path === entry.path)
      .sort((a, b) => a.index - b.index);
    for (let at = 0; at + 1 < run.length; at++) {
      const first = run[at];
      const second = run[at + 1];
      if (!first || !second || second.index !== first.index + 1) continue;
      const joined = similarity(entry.quote, `${first.quote} ${second.quote}`);
      const alone = Math.max(similarity(entry.quote, first.quote), similarity(entry.quote, second.quote));
      if (joined > alone + 0.1 && joined >= LADDER.threshold + LADDER.joinMargin) {
        result.set(entry.id, { event: 'split', to: [first, second] });
        used.add(first);
        used.add(second);
        break;
      }
    }
  }
  // Merge: two neighbouring old units read better together as one new unit.
  const left = openOld().sort((a, b) => a.path.localeCompare(b.path));
  for (let at = 0; at + 1 < left.length; at++) {
    const first = left[at];
    const second = left[at + 1];
    if (!first || !second || first.path !== second.path || result.has(first.id) || result.has(second.id))
      continue;
    const joined = `${first.quote} ${second.quote}`;
    const best = openNew()
      .filter((item) => item.path === first.path)
      .map((item) => ({ item, value: similarity(joined, item.quote) }))
      .sort((a, b) => b.value - a.value)[0];
    if (
      best &&
      best.value >= LADDER.threshold + LADDER.joinMargin &&
      best.value >
        Math.max(similarity(first.quote, best.item.quote), similarity(second.quote, best.item.quote)) + 0.1
    ) {
      result.set(first.id, { event: 'merged', to: [best.item] });
      result.set(second.id, { event: 'merged', to: [best.item] });
      used.add(best.item);
    }
  }

  // The rest, scored in the same file only: a moved unit was caught above by its text.
  const pairs: Array<{ entry: LedgerEntry; item: Fresh; value: number }> = [];
  for (const entry of openOld()) {
    for (const item of openNew()) {
      if (item.path !== entry.path) continue;
      if (
        Math.abs(entry.quote.length - item.quote.length) >
        Math.max(entry.quote.length, item.quote.length) * 0.8
      ) {
        continue;
      }
      pairs.push({ entry, item, value: score(entry, item) });
    }
  }
  pairs.sort((a, b) => b.value - a.value);
  for (const { entry, item, value } of pairs) {
    if (result.has(entry.id) || used.has(item)) continue;
    if (value >= LADDER.threshold && similarity(entry.quote, item.quote) >= LADDER.textFloor) {
      result.set(entry.id, { event: 'changed', to: [item] });
      used.add(item);
    }
  }
  return result;
}

export type NextLedger = {
  ledger: Ledger;
  /** The id of each unit of the new cut, by `unitKey`. */
  ids: Map<string, string>;
  /** Counts of what the ladder decided, for the scan report. */
  events: Record<Event, number>;
};

/**
 * Builds the ledger for the files as they are now from the ledger of the last scan. A unit that follows an
 * old one keeps its id; labels carry only when the fingerprint and the context fingerprint are unchanged.
 */
export function nextLedger(
  files: readonly FileCut[],
  previous: Ledger | undefined,
  estateKey: string,
): NextLedger {
  const fresh = freshOf(files);
  const live = (previous?.entries ?? [])
    .filter((entry) => entry.status === 'live')
    .sort((a, b) => a.path.localeCompare(b.path) || a.index - b.index);
  const mapping = previous ? follow(live, fresh) : new Map<string, Mapping>();
  const taken = new Set((previous?.entries ?? []).map((entry) => entry.id));
  const byItem = new Map<Fresh, { id: string; event: Event; from?: LedgerEntry }>();
  const events: Record<Event, number> = {
    new: 0,
    unchanged: 0,
    moved: 0,
    ambiguous: 0,
    changed: 0,
    split: 0,
    merged: 0,
    deleted: 0,
  };
  for (const entry of live) {
    const found = mapping.get(entry.id);
    if (!found) continue;
    for (const [at, item] of found.to.entries()) {
      // A split gives the first piece the old id and mints the others; an ambiguous text keeps the old id on the first match only.
      if (at > 0 || byItem.has(item)) continue;
      byItem.set(item, { id: entry.id, event: found.event, from: entry });
    }
  }
  const occurrences = new Map<string, number>();
  const ids = new Map<string, string>();
  const entries: LedgerEntry[] = [];
  for (const item of fresh) {
    const occurrenceKey = `${item.path}\0${item.unit.fp}`;
    const occurrence = occurrences.get(occurrenceKey) ?? 0;
    occurrences.set(occurrenceKey, occurrence + 1);
    let carried = byItem.get(item);
    if (!carried) {
      const id = freeId((n) => mintId(estateKey, item.path, item.unit.fp, n), taken, occurrence);
      taken.add(id);
      carried = { id, event: 'new' };
    }
    const keepLabels = carried.from && carried.from.fp === item.unit.fp && carried.from.ctxFp === item.ctxFp;
    events[carried.event]++;
    ids.set(unitKey(item.path, item.index), carried.id);
    entries.push({
      id: carried.id,
      path: item.path,
      index: item.index,
      sectionPath: item.unit.path,
      container: item.unit.container,
      fp: item.unit.fp,
      ctxFp: item.ctxFp,
      quote: item.quote,
      prefix: item.prefix,
      suffix: item.suffix,
      status: 'live',
      labels: keepLabels && carried.from ? carried.from.labels : {},
    });
  }
  const kept = new Set(entries.map((entry) => entry.id));
  for (const entry of previous?.entries ?? []) {
    if (kept.has(entry.id)) continue;
    if (entry.status === 'live') events.deleted++;
    // The quote of a deleted unit stays, so a link to it falls back to its section.
    entries.push({ ...entry, status: 'deleted' });
  }
  entries.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      Number(a.status === 'deleted') - Number(b.status === 'deleted') ||
      (a.status === 'live' ? a.index - b.index : a.id.localeCompare(b.id)),
  );
  const cutDigests = Object.fromEntries(files.map(({ path, cut }) => [path, cut.digest.slice(0, 16)]));
  return { ledger: { version: 1, cutDigests, entries }, ids, events };
}

/** The ledger as the file beside the estate: sorted keys, no times, so equal ledgers are equal bytes. */
export const renderLedger = (ledger: Ledger): string => `${canonical(ledger)}\n`;

export function parseLedger(text: string): Ledger | undefined {
  try {
    const value = JSON.parse(text) as Partial<Ledger>;
    if (value.version !== 1 || !Array.isArray(value.entries)) return undefined;
    return value as Ledger;
  } catch {
    return undefined;
  }
}

/** The result of checking a ledger file against a scan: fresh, or out of date for the listed files. */
export type LedgerCheck =
  | { ok: true }
  | {
      ok: false;
      /** Stable, kebab-case: what the check found. */
      code: 'ledger-out-of-date';
      /** The paths whose entries or cut digest differ between the file and the scan, sorted. */
      files: string[];
      error: string;
    };

/**
 * Checks the text of a ledger file against the ledger a scan gives. The check passes when the scan renders to the
 * same bytes; otherwise it fails with the paths that changed, so a check reads them as a list and never from the text.
 */
export function checkLedger(previous: string | undefined, current: Ledger): LedgerCheck {
  if (previous !== undefined && previous === renderLedger(current)) return { ok: true };
  const before = previous === undefined ? undefined : parseLedger(previous);
  const entriesOf = (ledger: Ledger | undefined): Map<string, string> => {
    const byPath = new Map<string, LedgerEntry[]>();
    for (const entry of ledger?.entries ?? []) {
      byPath.set(entry.path, [...(byPath.get(entry.path) ?? []), entry]);
    }
    return new Map([...byPath].map(([path, list]) => [path, canonical(list)]));
  };
  const was = entriesOf(before);
  const now = entriesOf(current);
  const changed = new Set<string>();
  for (const path of new Set([...was.keys(), ...now.keys()])) {
    if (was.get(path) !== now.get(path)) changed.add(path);
  }
  const digests = new Set([...Object.keys(before?.cutDigests ?? {}), ...Object.keys(current.cutDigests)]);
  for (const path of digests) {
    if (before?.cutDigests[path] !== current.cutDigests[path]) changed.add(path);
  }
  const files = [...changed].sort();
  return {
    ok: false,
    code: 'ledger-out-of-date',
    files,
    error:
      files.length > 0 ? `the ledger is out of date for: ${files.join(', ')}` : 'the ledger is out of date',
  };
}
