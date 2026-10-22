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
  /** The unit's text as the file holds it: `source.slice(hint.start, hint.end)`. */
  quote: string;
  /** The characters of the file before the unit and after it. */
  prefix: string;
  suffix: string;
  /** UTF-16 offsets of the unit in its file at the last scan, byte-order mark included. */
  hint: { start: number; end: number };
  status: 'live' | 'deleted';
  /** Keyed by set name; a map without a prototype, so a set may bear any name. */
  labels: Record<string, LedgerLabel>;
  /** What the scans that changed the ledger decided for the unit, oldest first, the last {@link LINEAGE_KEEP} kept. */
  lineage: Array<{ scan: number; event: Event }>;
  /** The id of the unit with the same text in an earlier file of the estate (identical boilerplate), else null. */
  twinOf: string | null;
};

export type Ledger = { version: 1; cutDigests: Record<string, string>; entries: LedgerEntry[] };

export type Event = 'new' | 'unchanged' | 'moved' | 'ambiguous' | 'changed' | 'split' | 'merged' | 'deleted';

/** `text` is the file as read. Without it the entries keep the squashed text of the unit and of its neighbours. */
export type FileCut = { path: string; cut: Cut; text?: string };

/** The scans a unit's lineage remembers. */
export const LINEAGE_KEEP = 8;

/** The characters of the file kept on each side of a unit. */
const AROUND = 24;

/** The place of a unit in the estate: its file and its index in the cut. */
export const unitKey = (path: string, index: number): string => `${path}\0${index}`;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** Ten base24 characters of the hash of (estate key, file, fingerprint, occurrence). */
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

/** The text a unit is compared by: white space collapsed, so a rewrap is no change. */
type Flat = { quote: string };
const flats = new WeakMap<object, Flat>();
function flat(entry: { quote: string }): Flat {
  let found = flats.get(entry);
  if (!found) {
    found = { quote: squash(entry.quote) };
    flats.set(entry, found);
  }
  return found;
}

/** A slice that does not start or end inside a surrogate pair. */
function slice(text: string, from: number, to: number): string {
  let start = Math.max(0, from);
  let end = Math.min(text.length, to);
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start] ?? '')) start++;
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end--;
  return text.slice(start, Math.max(start, end));
}

function freshOf(files: readonly FileCut[]): Fresh[] {
  const out: Fresh[] = [];
  for (const { path, cut, text } of files) {
    cut.units.forEach((unit, index) => {
      const before = cut.units[index - 1];
      const after = cut.units[index + 1];
      out.push({
        path,
        index,
        unit,
        quote: unit.text,
        prefix:
          text === undefined
            ? squash(before?.text ?? '').slice(-AROUND)
            : slice(text, unit.start - AROUND, unit.start),
        suffix:
          text === undefined
            ? squash(after?.text ?? '').slice(0, AROUND)
            : slice(text, unit.end, unit.end + AROUND),
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
    if (flat(entry).quote.length < LADDER.exactFloor && !unique) continue;
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
    0.6 * similarity(flat(entry).quote, flat(item).quote) +
    0.4 *
      ((similarity(entry.prefix, item.prefix) +
        similarity(entry.suffix, item.suffix) +
        (entry.sectionPath.join('>') === item.unit.path.join('>') ? 1 : 0)) /
        3);

  // Split: two neighbouring new units read better together than apart as the old one.
  for (const entry of openOld()) {
    const run = openNew()
      .filter((item) => item.path === entry.path)
      .sort((a, b) => a.index - b.index);
    for (let at = 0; at + 1 < run.length; at++) {
      const first = run[at];
      const second = run[at + 1];
      if (!first || !second || second.index !== first.index + 1) continue;
      const joined = similarity(flat(entry).quote, `${flat(first).quote} ${flat(second).quote}`);
      const alone = Math.max(
        similarity(flat(entry).quote, flat(first).quote),
        similarity(flat(entry).quote, flat(second).quote),
      );
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
    const joined = `${flat(first).quote} ${flat(second).quote}`;
    const best = openNew()
      .filter((item) => item.path === first.path)
      .map((item) => ({ item, value: similarity(joined, flat(item).quote) }))
      .sort((a, b) => b.value - a.value)[0];
    if (
      best &&
      best.value >= LADDER.threshold + LADDER.joinMargin &&
      best.value >
        Math.max(
          similarity(flat(first).quote, flat(best.item).quote),
          similarity(flat(second).quote, flat(best.item).quote),
        ) +
          0.1
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
        Math.abs(flat(entry).quote.length - flat(item).quote.length) >
        Math.max(flat(entry).quote.length, flat(item).quote.length) * 0.8
      ) {
        continue;
      }
      pairs.push({ entry, item, value: score(entry, item) });
    }
  }
  pairs.sort((a, b) => b.value - a.value);
  for (const { entry, item, value } of pairs) {
    if (result.has(entry.id) || used.has(item)) continue;
    if (value > LADDER.threshold && similarity(flat(entry).quote, flat(item).quote) > LADDER.textFloor) {
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
  /** What the ladder decided for each id of this scan: the live ids, and the ids that are deleted now. */
  eventsById: Record<string, Event>;
};

/** A map of labels by set name that has no prototype: `__proto__` and `constructor` are names like any other. */
export function labelMap(from?: Readonly<Record<string, LedgerLabel>>): Record<string, LedgerLabel> {
  const map: Record<string, LedgerLabel> = Object.create(null);
  if (from) for (const key of Object.keys(from)) map[key] = from[key] as LedgerLabel;
  return map;
}

/** The scan after the last one the ledger remembers, from 1. */
const scanAfter = (previous: Ledger | undefined): number =>
  1 +
  Math.max(
    0,
    ...(previous?.entries ?? []).flatMap((entry) => (entry.lineage ?? []).map((item) => item.scan)),
  );

/**
 * The lineage after a scan: a scan that finds the unit as it was adds nothing, so that rescanning unchanged
 * files writes the same bytes. `scan` counts the versions of the ledger, not the runs.
 */
const remember = (
  lineage: LedgerEntry['lineage'] | undefined,
  scan: number,
  event: Event,
): LedgerEntry['lineage'] =>
  event === 'unchanged' && lineage !== undefined && lineage.length > 0
    ? lineage
    : [...(lineage ?? []), { scan, event }].slice(-LINEAGE_KEEP);

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
  const scan = scanAfter(previous);
  const eventsById: Record<string, Event> = Object.create(null);
  const occurrences = new Map<string, number>();
  const ids = new Map<string, string>();
  const entries: LedgerEntry[] = [];
  for (const item of fresh) {
    const occurrenceKey = `${item.path}\0${item.unit.fp}`;
    const occurrence = occurrences.get(occurrenceKey) ?? 0;
    occurrences.set(occurrenceKey, occurrence + 1);
    let carried = byItem.get(item);
    if (!carried) {
      let next = occurrence;
      let id = mintId(estateKey, item.path, item.unit.fp, next);
      while (taken.has(id)) id = mintId(estateKey, item.path, item.unit.fp, ++next);
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
      hint: { start: item.unit.start, end: item.unit.end },
      status: 'live',
      labels: labelMap(keepLabels && carried.from ? carried.from.labels : undefined),
      lineage: remember(carried.from?.lineage, scan, carried.event),
      twinOf: null,
    });
    eventsById[carried.id] = carried.event;
  }
  twins(entries);
  const kept = new Set(entries.map((entry) => entry.id));
  for (const entry of previous?.entries ?? []) {
    if (kept.has(entry.id)) continue;
    if (entry.status === 'live') {
      events.deleted++;
      eventsById[entry.id] = 'deleted';
    }
    // The quote of a deleted unit stays, so a link to it falls back to its section.
    entries.push({
      ...entry,
      status: 'deleted',
      labels: labelMap(entry.labels),
      lineage: entry.status === 'live' ? remember(entry.lineage, scan, 'deleted') : (entry.lineage ?? []),
    });
  }
  entries.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      Number(a.status === 'deleted') - Number(b.status === 'deleted') ||
      (a.status === 'live' ? a.index - b.index : a.id.localeCompare(b.id)),
  );
  const cutDigests = Object.fromEntries(files.map(({ path, cut }) => [path, cut.digest.slice(0, 16)]));
  return { ledger: { version: 1, cutDigests, entries }, ids, events, eventsById };
}

/**
 * Marks identical boilerplate: a live unit whose text is the text of a live unit in an earlier file names that
 * unit, the first of them in file order. The first of a text, and a text that repeats only inside one file, name
 * no twin, so a copy is not mistaken for a move.
 */
function twins(entries: readonly LedgerEntry[]): void {
  const first = new Map<string, LedgerEntry>();
  const ordered = [...entries].sort((a, b) => a.path.localeCompare(b.path) || a.index - b.index);
  for (const entry of ordered) {
    const found = first.get(entry.fp);
    if (!found) first.set(entry.fp, entry);
    else if (found.path !== entry.path) entry.twinOf = found.id;
  }
}

/** The ledger as the file beside the estate: sorted keys, no times, so equal ledgers are equal bytes. */
export const renderLedger = (ledger: Ledger): string => `${canonical(ledger)}\n`;

export function parseLedger(text: string): Ledger | undefined {
  try {
    const value = JSON.parse(text) as Partial<Ledger>;
    if (value.version !== 1 || !Array.isArray(value.entries)) return undefined;
    // An entry written before lineage and twins were kept reads as having neither.
    for (const entry of value.entries) {
      entry.labels = labelMap(entry.labels);
      entry.lineage ??= [];
      entry.twinOf ??= null;
      entry.hint ??= { start: 0, end: 0 };
    }
    return value as Ledger;
  } catch {
    return undefined;
  }
}

/** An entry without the lineage, which every scan extends: what a ledger is compared by. */
const stable = (entry: LedgerEntry) => ({ ...entry, lineage: undefined });

/**
 * Whether the ledger a scan produced says what the committed one says. The lineage grows with every scan and is
 * left out; a file that changed, appeared or went is named. A missing committed ledger is out of date.
 */
export function checkLedger(
  previousRaw: string | undefined,
  current: Ledger,
): { ok: boolean; error?: string } {
  const previous = previousRaw === undefined ? undefined : parseLedger(previousRaw);
  if (!previous) return { ok: false, error: 'there is no committed ledger' };
  const byPath = (ledger: Ledger): Map<string, string> => {
    const groups = new Map<string, string[]>();
    for (const entry of ledger.entries) {
      groups.set(entry.path, [...(groups.get(entry.path) ?? []), canonical(stable(entry))]);
    }
    return new Map([...groups].map(([path, list]) => [path, list.join('\n')]));
  };
  const before = byPath(previous);
  const after = byPath(current);
  const changed = [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort((a, b) => a.localeCompare(b));
  if (changed.length === 0) return { ok: true };
  return { ok: false, error: `the ledger is out of date for ${changed.join(', ')}` };
}
