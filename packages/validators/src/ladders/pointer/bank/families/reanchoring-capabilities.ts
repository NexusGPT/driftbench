import { ItemFailure } from '../../../../failure';
import { cloneWorld, filesOf, type World, worldOf } from '../../kit/anchor-world';
import type { Block } from '../../kit/compose';
import { build, byId, type EstateFile, liveByText, scanOk } from '../../kit/estate';
import { perfect } from '../../kit/labellers';
import { norm } from '../../kit/norm';
import { rewordSim, splitParts } from '../../kit/segments';
import { longMake, Prose } from '../../kit/words';
import type { LedgerEntry, LedgerView } from '../../sut/port';
import { type ItemContext, type Outcome, pass, type Run } from '../types';

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);

type Fate = { id: string; path: string; quote: string; event: string | undefined; status: string };

/**
 * Scans `before`, rescans `after` against the first ledger, and gives each named old unit's fate: where its id
 * lives now, with which text, and the event of the rescan. `want` decides; a failure prints the rule, the edit and
 * the fates the reader gave, never the planted ones.
 */
async function rescan(
  ctx: ItemContext,
  rule: string,
  before: EstateFile[],
  after: EstateFile[],
  texts: readonly string[],
  want: (fates: Fate[], second: LedgerView) => boolean,
  planted: unknown,
): Promise<Outcome> {
  const labeler = perfect();
  const first = await scanOk(ctx.sut, { files: build(before).files, labeler });
  const ids = texts.map((text) => liveByText(first.ledger, text)?.id);
  const second = await scanOk(ctx.sut, {
    files: build(after).files,
    previousLedger: first.ledger.raw,
    labeler,
  });
  const fates: Fate[] = ids.map((id) => {
    const entry: LedgerEntry | undefined = id === undefined ? undefined : byId(second.ledger, id);
    return {
      id: id ?? '',
      path: entry?.path ?? '',
      quote: entry?.quote ?? '',
      event: id === undefined ? undefined : second.events?.[id],
      status: entry?.status ?? 'missing',
    };
  });
  if (ids.some((id) => id === undefined) || !want(fates, second.ledger))
    throw new ItemFailure({
      item: ctx.id,
      rule,
      input: { before: build(before).files, after: build(after).files },
      got: fates,
      expected: planted,
    });
  return pass(`${fates.length} ids followed`);
}

const two = (ctx: ItemContext) => {
  const p = prose(ctx);
  return { p, w: worldOf(p, { files: 2, perFile: 8 }) };
};

/** A table of short seeded cells, as composer blocks. */
function tableOf(p: Prose, rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => p.next().replace(/\.$/, '')));
}
const tableFile = (path: string, header: string[], rows: string[][]): EstateFile => ({
  path,
  blocks: [{ kind: 'table', header, rows } as Block],
});

/** The live cell `column` places right of the row key `key` in the table of `path`, by offset. */
function rowCell(ledger: LedgerView, path: string, key: string, column: number): LedgerEntry | undefined {
  const cells = ledger.entries
    .filter((e) => e.status === 'live' && e.path === path && e.container === 'table_cell')
    .sort((a, b) => (a.hint?.start ?? 0) - (b.hint?.start ?? 0));
  const at = cells.findIndex((e) => norm(e.quote) === norm(key));
  return at < 0 ? undefined : cells[at + column];
}

/** A long cell text: unique, and above any length floor. */
const longCell = (p: Prose) => p.next(longMake).replace(/\.$/, '');

/**
 * A table of long row keys and a short, repeated `Done` column. Scans `before`, takes the id of each `Done` cell by
 * its place in the first ledger, rescans `after`, and lets `want` judge the ids in the second ledger.
 */
async function rescanShortCells(
  ctx: ItemContext,
  rule: string,
  before: EstateFile,
  after: EstateFile,
  keys: readonly string[],
  want: (ids: string[], second: LedgerView) => boolean,
  planted: unknown,
): Promise<Outcome> {
  const labeler = perfect();
  const first = await scanOk(ctx.sut, { files: build([before]).files, labeler });
  const ids = keys.map((key) => rowCell(first.ledger, before.path, key, 1)?.id);
  const second = await scanOk(ctx.sut, {
    files: build([after]).files,
    previousLedger: first.ledger.raw,
    labeler,
  });
  const known = ids.filter((id): id is string => id !== undefined);
  if (known.length !== keys.length || !want(known, second.ledger))
    throw new ItemFailure({
      item: ctx.id,
      rule,
      input: { before: build([before]).files, after: build([after]).files },
      got: ids.map((id) => {
        const entry = id === undefined ? undefined : byId(second.ledger, id);
        return {
          id: id ?? '',
          quote: entry?.quote ?? '',
          status: entry?.status ?? 'missing',
          hint: entry?.hint,
        };
      }),
      expected: planted,
    });
  return pass(`${keys.length} short cells followed`);
}

const DONE = ['Yes', 'No', 'Yes', 'No'];

export const reanchoringCapabilityRuns: Record<string, Run> = {
  'cross-file-move-reword': async (ctx) => {
    const { p, w } = two(ctx);
    const v2: World = cloneWorld(w);
    const [t] = (v2.texts[0] ?? []).splice(3, 1) as [string];
    const t2 = rewordSim(p.random, t, 0.75, 0.95);
    v2.texts[1]?.splice(4, 0, t2);
    const target = w.paths[1] as string;
    return rescan(
      ctx,
      'a unit moved to another file and reworded',
      filesOf(w),
      filesOf(v2),
      [t],
      ([f]) =>
        f?.status === 'live' && f.path === target && norm(f.quote) === norm(t2) && f.event === 'changed',
      { path: target, quote: t2, event: 'changed' },
    );
  },
  'cross-file-move-split': async (ctx) => {
    const { p, w } = two(ctx);
    const parts = splitParts(p);
    const v1: World = cloneWorld(w);
    v1.texts[0]?.splice(2, 0, parts.whole);
    const v2: World = cloneWorld(w);
    v2.texts[1]?.splice(3, 0, parts.a, parts.b);
    const target = w.paths[1] as string;
    return rescan(
      ctx,
      'a unit moved to another file as two sentences',
      filesOf(v1),
      filesOf(v2),
      [parts.whole],
      ([f]) =>
        f?.status === 'live' &&
        f.path === target &&
        [parts.a, parts.b].some((part) => norm(f.quote) === norm(part)) &&
        f.event === 'split',
      { path: target, quote: [parts.a, parts.b], event: 'split' },
    );
  },
  'renamed-file-reword': async (ctx) => {
    const { p, w } = two(ctx);
    const v2: World = cloneWorld(w);
    v2.paths[0] = 'notes/renamed-notes.md';
    const t = (v2.texts[0] ?? [])[4] as string;
    const t2 = rewordSim(p.random, t, 0.75, 0.95);
    (v2.texts[0] as string[])[4] = t2;
    return rescan(
      ctx,
      'a unit reworded in a renamed file',
      filesOf(w),
      filesOf(v2),
      [t],
      ([f]) =>
        f?.status === 'live' &&
        f.path === 'notes/renamed-notes.md' &&
        norm(f.quote) === norm(t2) &&
        f.event === 'changed',
      { path: 'notes/renamed-notes.md', quote: t2, event: 'changed' },
    );
  },
  'table-row-moved': async (ctx) => {
    const p = prose(ctx);
    const header = ['Step', 'Rule'];
    const rows = tableOf(p, 4, 2);
    const moved = [rows[1], rows[2], rows[3], rows[0]] as string[][];
    const cells = rows.flat();
    return rescan(
      ctx,
      'a table row moved',
      [tableFile('notes/table.md', header, rows)],
      [tableFile('notes/table.md', header, moved)],
      cells,
      (fates) => fates.every((f, i) => f.status === 'live' && norm(f.quote) === norm(cells[i] as string)),
      cells,
    );
  },
  'table-column-reordered': async (ctx) => {
    const p = prose(ctx);
    const header = ['Step', 'Rule', 'Note'];
    const rows = tableOf(p, 3, 3);
    const swap = (r: string[]) => [r[2], r[0], r[1]] as string[];
    const cells = rows.flat();
    return rescan(
      ctx,
      'a table column moved',
      [tableFile('notes/table.md', header, rows)],
      [tableFile('notes/table.md', swap(header), rows.map(swap))],
      cells,
      (fates) => fates.every((f, i) => f.status === 'live' && norm(f.quote) === norm(cells[i] as string)),
      cells,
    );
  },
  'table-column-inserted': async (ctx) => {
    const p = prose(ctx);
    const header = ['Step', 'Rule'];
    const rows = tableOf(p, 3, 2);
    const extra = tableOf(p, 3, 1).map((r) => r[0] as string);
    const cells = rows.flat();
    return rescan(
      ctx,
      'a table column inserted',
      [tableFile('notes/table.md', header, rows)],
      [
        tableFile(
          'notes/table.md',
          ['Step', 'Owner', 'Rule'],
          rows.map((r, i) => [r[0] as string, extra[i] as string, r[1] as string]),
        ),
      ],
      cells,
      (fates) => fates.every((f, i) => f.status === 'live' && norm(f.quote) === norm(cells[i] as string)),
      cells,
    );
  },
  'table-cell-text-follows': async (ctx) => {
    const p = prose(ctx);
    const rows = Array.from({ length: 4 }, (_, i) => [`S${i + 1}`, longCell(p)]);
    const moved = [rows[2], rows[0], rows[3], rows[1]] as string[][];
    const cells = rows.map((r) => r[1] as string);
    return rescan(
      ctx,
      'table rows moved and a column header renamed',
      [tableFile('notes/table.md', ['Step', 'Rule'], rows)],
      [tableFile('notes/table.md', ['Step', 'Policy'], moved)],
      cells,
      (fates) => fates.every((f, i) => f.status === 'live' && norm(f.quote) === norm(cells[i] as string)),
      cells,
    );
  },
  'table-cell-key-follows': async (ctx) => {
    const p = prose(ctx);
    const keys = DONE.map(() => longCell(p));
    const owners = ['Ana', 'Ben', 'Cy', 'Di'];
    const rows = keys.map((key, i) => [key, DONE[i] as string]);
    const after = [3, 2, 1, 0].map((i) => [keys[i] as string, owners[i] as string, DONE[i] as string]);
    return rescanShortCells(
      ctx,
      'table rows moved and a column inserted, short cells repeated',
      tableFile('notes/table.md', ['Step', 'Done'], rows),
      tableFile('notes/table.md', ['Step', 'Owner', 'Done'], after),
      keys,
      (ids, second) => keys.every((key, i) => rowCell(second, 'notes/table.md', key, 2)?.id === ids[i]),
      keys.map((key, i) => ({ row: key, column: 'Done', quote: DONE[i] })),
    );
  },
  'table-cell-new-id': async (ctx) => {
    const p = prose(ctx);
    const keys = DONE.map(() => longCell(p));
    const renamed = DONE.map(() => longCell(p));
    return rescanShortCells(
      ctx,
      'every row key of a table rewritten, short cells repeated',
      tableFile('notes/table.md', ['Step', 'Done'], keys.map((key, i) => [key, DONE[i] as string])),
      tableFile('notes/table.md', ['Step', 'Done'], renamed.map((key, i) => [key, DONE[i] as string])),
      keys,
      (ids, second) => ids.every((id) => byId(second, id)?.status !== 'live'),
      DONE.map(() => 'a new id'),
    );
  },
};
