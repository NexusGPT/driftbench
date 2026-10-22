import { ItemFailure } from '../../../../failure';
import { cloneWorld, filesOf, type World, worldOf } from '../../kit/anchor-world';
import type { Block } from '../../kit/compose';
import { build, byId, type EstateFile, liveByText, scanOk } from '../../kit/estate';
import { perfect } from '../../kit/labellers';
import { norm } from '../../kit/norm';
import { rewordSim, splitParts } from '../../kit/segments';
import { Prose } from '../../kit/words';
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
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => p.next().replace(/\.$/, '')),
  );
}
const tableFile = (path: string, header: string[], rows: string[][]): EstateFile => ({
  path,
  blocks: [{ kind: 'table', header, rows } as Block],
});

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
      'a unit moved to another file and split in two',
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
};
