import { type ItemContext, type Outcome, Problem, pass } from '../bank/types';
import type { Labeler, LedgerEntry } from '../sut/port';
import { build, byId, type EstateFile, eventNow, liveByText, liveOf, scanOk } from './estate';
import { perfect } from './labellers';
import { norm } from './norm';
import { show } from './oracle';
import { buildScript, filesOfSegments, UNRELATED } from './segments';
import { Prose, similarity } from './words';

/** What must become of an old unit, by its text in the old estate. */
export type Fate =
  | { kind: 'unchanged' }
  | { kind: 'moved'; events?: string[]; path?: string }
  | { kind: 'changed'; to: string }
  | { kind: 'deleted' }
  | { kind: 'split'; parts: string[] }
  | { kind: 'ambiguous' }
  /** The ids of these two old units: exactly one lives on with the joined text, event `merged`; the other is gone. */
  | { kind: 'mergePair'; other: string; into: string }
  /** Carries the id through, to a text whose similarity the caller already knows is high. */
  | { kind: 'carried'; to: string };

export type Scenario = {
  before: EstateFile[];
  after: EstateFile[];
  /** Fates by old unit text; every other old unit must come out unchanged. */
  fates?: Array<{ text: string; fate: Fate }>;
  /** After texts that must have fresh ids, besides the parts of splits. Default: derived from the fates. */
  fresh?: string[];
  labeler?: Labeler;
  /** Texts left out of the default checks, old and new (the item checks them itself). */
  skip?: string[];
  /** A last check on the two scans. */
  extra?: (run: ScenarioRun) => string | undefined;
};

export type ScenarioRun = {
  ids: Map<string, string>;
  before: Awaited<ReturnType<typeof scanOk>>;
  after: Awaited<ReturnType<typeof scanOk>>;
};

const key = (text: string, container?: string) => norm(text, container);

/** Scans the old estate, edits it, rescans with the ledger and checks every old unit's fate. Throws a Problem on a miss. */
export async function runScenario(ctx: ItemContext, s: Scenario): Promise<ScenarioRun> {
  const old = build(s.before);
  const next = build(s.after);
  const labeler = s.labeler ?? perfect();
  const first = await scanOk(ctx.sut, { files: old.files, labeler });
  const second = await scanOk(ctx.sut, { files: next.files, previousLedger: first.ledger.raw, labeler });
  const ids = new Map<string, string>();
  const oldTexts: Array<{ text: string; container: string }> = [];
  for (const doc of old.docs.values())
    for (const u of doc.units) oldTexts.push({ text: u.text, container: u.container });
  for (const { text, container } of oldTexts) {
    const entry = liveByText(first.ledger, text, container);
    if (!entry) {
      if (container === 'fence' || container === 'comment') continue;
      throw new Problem(`the first scan has no live entry for ${show(text)}`);
    }
    ids.set(key(text, container), entry.id);
  }
  const oldIds = new Set(first.ledger.entries.map((e) => e.id));
  const newTexts: Array<{ text: string; container: string }> = [];
  for (const doc of next.docs.values())
    for (const u of doc.units) newTexts.push({ text: u.text, container: u.container });
  const live = liveOf(second.ledger);
  const expectedNew = newTexts.filter((t) => t.container !== 'fence' && t.container !== 'comment');
  if (live.length !== expectedNew.length) {
    throw new Problem(`the rescan has ${live.length} live entries for ${expectedNew.length} units`);
  }
  if (new Set(live.map((e) => e.id)).size !== live.length)
    throw new Problem('the rescan gives two live entries one id');

  const claimed = new Set<string>();
  const explicit = new Map((s.fates ?? []).map((f) => [key(f.text), f.fate]));
  const parts = new Set<string>();
  const pairHandled = new Set<string>();
  const fail = (text: string, why: string): never => {
    throw new Problem(`${show(text)}: ${why}`);
  };
  for (const { text, container } of oldTexts) {
    if (container === 'fence' || container === 'comment') continue;
    const k = key(text, container);
    if (s.skip?.some((t) => key(t) === k)) continue;
    const id = ids.get(k) as string;
    const entry = byId(second.ledger, id);
    const fate: Fate = explicit.get(k) ?? { kind: 'unchanged' };
    if (!entry) return fail(text, `the id ${id} is gone from the ledger`);
    const event = eventNow(second, entry);
    switch (fate.kind) {
      case 'unchanged':
        if (entry.status !== 'live') fail(text, `expected unchanged, the entry is ${entry.status}`);
        if (key(entry.quote, entry.container) !== k)
          fail(text, `expected the same text, the entry quotes ${show(entry.quote)}`);
        if (event !== 'unchanged') fail(text, `expected event unchanged, got ${event}`);
        claimed.add(k);
        break;
      case 'moved': {
        const allowed = fate.events ?? ['moved'];
        if (entry.status !== 'live') fail(text, `expected moved, the entry is ${entry.status}`);
        if (key(entry.quote, entry.container) !== k)
          fail(text, `expected the same text, the entry quotes ${show(entry.quote)}`);
        if (!allowed.includes(event)) fail(text, `expected event ${allowed.join(' or ')}, got ${event}`);
        if (fate.path !== undefined && entry.path !== fate.path)
          fail(text, `expected path ${fate.path}, got ${entry.path}`);
        claimed.add(k);
        break;
      }
      case 'changed':
      case 'carried':
        if (entry.status !== 'live') fail(text, `expected the id to live on, the entry is ${entry.status}`);
        if (key(entry.quote, entry.container) !== key(fate.to, entry.container)) {
          fail(text, `expected the new text ${show(fate.to)}, the entry quotes ${show(entry.quote)}`);
        }
        if (fate.kind === 'changed' && event !== 'changed')
          fail(text, `expected event changed, got ${event}`);
        claimed.add(key(fate.to, entry.container));
        break;
      case 'deleted':
        if (entry.status === 'live')
          fail(text, `expected deleted, the entry is live with ${show(entry.quote)}`);
        if (event !== 'deleted') fail(text, `expected event deleted, got ${event}`);
        if (key(entry.quote, entry.container) !== k)
          fail(text, `the deleted entry no longer quotes the old text: ${show(entry.quote)}`);
        break;
      case 'ambiguous':
        if (event !== 'ambiguous') fail(text, `expected event ambiguous, got ${event}`);
        break;
      case 'split': {
        if (entry.status !== 'live')
          fail(text, `expected the id to live on in one part, the entry is ${entry.status}`);
        if (event !== 'split') fail(text, `expected event split, got ${event}`);
        const keptOne = fate.parts.some((p) => key(p, entry.container) === key(entry.quote, entry.container));
        if (!keptOne) fail(text, `expected one of the parts, the entry quotes ${show(entry.quote)}`);
        for (const p of fate.parts) parts.add(key(p));
        const others = fate.parts.filter(
          (p) => key(p, entry.container) !== key(entry.quote, entry.container),
        );
        for (const p of others) {
          const e = liveByText(second.ledger, p);
          if (!e) fail(text, `the other part ${show(p)} has no live entry`);
          else if (oldIds.has(e.id)) fail(text, `the other part ${show(p)} carries the old id ${e.id}`);
        }
        break;
      }
      case 'mergePair': {
        if (pairHandled.has(k)) break;
        const otherKey = key(fate.other);
        pairHandled.add(k);
        pairHandled.add(otherKey);
        const otherEntry = byId(second.ledger, ids.get(otherKey) as string);
        if (!otherEntry) return fail(text, 'the other id is gone from the ledger');
        const survivors = [entry, otherEntry].filter(
          (e) => e.status === 'live' && key(e.quote, e.container) === key(fate.into, e.container),
        );
        if (survivors.length !== 1)
          fail(
            text,
            `expected exactly one of the two ids to live on as ${show(fate.into)}, found ${survivors.length}`,
          );
        const survivor = survivors[0] as LedgerEntry;
        if (eventNow(second, survivor) !== 'merged')
          fail(text, `expected event merged, got ${eventNow(second, survivor)}`);
        const loser = survivor === entry ? otherEntry : entry;
        if (loser.status === 'live') fail(text, `the other id is still live with ${show(loser.quote)}`);
        claimed.add(key(fate.into));
        break;
      }
    }
  }
  // every live entry that carries no old id is fresh, and must be one the scenario expects
  const freshLive = live.filter((e) => !oldIds.has(e.id));
  const loose = new Set((s.skip ?? []).map((t) => key(t)));
  const expectFresh = new Set(
    (
      s.fresh ??
      expectedNew.map((t) => key(t.text, t.container)).filter((t) => !claimed.has(t) && !parts.has(t))
    ).map((t) => key(t)),
  );
  const gotFresh = new Set(
    freshLive.map((e) => key(e.quote, e.container)).filter((t) => !parts.has(t) && !loose.has(t)),
  );
  for (const t of [...expectFresh].filter((x) => !loose.has(x))) {
    if (!gotFresh.has(t)) {
      const e = live.find((x) => key(x.quote, x.container) === key(t));
      throw new Problem(
        `${show(t)} should have a fresh id; ${e ? `it carries the old id ${e.id}` : 'it has no live entry'}`,
      );
    }
  }
  for (const t of gotFresh) {
    if (!expectFresh.has(t)) {
      throw new Problem(
        `${show(t)} got a fresh id but an old id should have carried it (a wrong anchor or a lost one)`,
      );
    }
  }
  const run: ScenarioRun = { ids, before: first, after: second };
  const more = s.extra?.(run);
  if (more) throw new Problem(more);
  return run;
}

/* ----- the twin edit (round 3 audit, seat 2: a constant or precomputed event list gains nothing) ----- */

/** The blocks whose removal deletes prose units and nothing else. */
const REMOVABLE = new Set(['paragraph', 'list', 'quote', 'table']);
const PROSE_UNITS = new Set(['sentence', 'list_item', 'table_cell', 'block_quote']);
/** Where the probe file of the twin lives; no item writes under this folder. */
export const TWIN_PROBE_PATH = 'twin/probe.md';

const unitsOf = (files: readonly EstateFile[]): Array<{ text: string; container: string }> => {
  const out: Array<{ text: string; container: string }> = [];
  for (const doc of build(files).docs.values())
    for (const u of doc.units) out.push({ text: u.text, container: u.container });
  return out;
};

/** The old files after the removal, and the removed units in the normal form. */
export type Dropped = { after: EstateFile[]; gone: string[] };

/**
 * The old files with one block removed. The block is drawn by the seed among those whose units are prose and
 * each unique in the estate, and whose removal changes no other unit.
 */
export function dropOneBlock(p: Prose, before: readonly EstateFile[]): Dropped {
  const all = unitsOf(before);
  const count = new Map<string, number>();
  for (const u of all) {
    const k = key(u.text, u.container);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const choices: Dropped[] = [];
  for (const [f, file] of before.entries()) {
    choice: for (const [b, block] of file.blocks.entries()) {
      if (!REMOVABLE.has(block.kind)) continue;
      const without: EstateFile = { ...file, blocks: file.blocks.filter((_, j) => j !== b) };
      const after = before.map((x, i) => (i === f ? without : x));
      const left = new Map(count);
      for (const u of unitsOf(after)) {
        const k = key(u.text, u.container);
        const n = left.get(k) ?? 0;
        if (n === 0) continue choice;
        left.set(k, n - 1);
      }
      const gone: string[] = [];
      for (const u of all) {
        const k = key(u.text, u.container);
        if ((left.get(k) ?? 0) === 0) continue;
        if (!PROSE_UNITS.has(u.container) || count.get(k) !== 1) continue choice;
        left.set(k, 0);
        gone.push(k);
      }
      if (gone.length > 0) choices.push({ after, gone });
    }
  }
  if (choices.length === 0) return { after: [...before], gone: [] };
  return choices[Math.floor(p.random() * choices.length)] as Dropped;
}

/**
 * A probe file edited by a script drawn from the seed: a split, a merge, a reword, a delete and an insert
 * among five kept units. Every text that enters is under the unrelated bound to every removed unit and
 * differs from every old unit, so the ladder has one right answer for each of them.
 */
function probeFile(
  p: Prose,
  before: readonly EstateFile[],
  gone: readonly string[],
): { before: EstateFile; after: EstateFile; fates: Array<{ text: string; fate: Fate }> } {
  if (before.some((file) => file.path === TWIN_PROBE_PATH))
    throw new Error(`an item writes the twin probe path ${TWIN_PROBE_PATH}`);
  const old = new Set(unitsOf(before).map((u) => key(u.text, u.container)));
  for (let round = 0; round < 40; round += 1) {
    const segs = buildScript(p, ['split', 'merge', 'reword', 'delete', 'insert'], 5, 1);
    const head = `Twin probe ${p.random().toString(36).slice(2, 7)}`;
    const files = filesOfSegments(segs, 1, [head]);
    const was = new Set(segs.flatMap((seg) => seg.before));
    const texts = [head, ...segs.flatMap((seg) => [...seg.before, ...seg.after])];
    const entering = segs.flatMap((seg) => seg.after).filter((t) => !was.has(t));
    if (texts.some((t) => old.has(key(t)))) continue;
    if (entering.some((t) => gone.some((g) => similarity(key(t), g) >= UNRELATED))) continue;
    return {
      before: { path: TWIN_PROBE_PATH, blocks: (files.before[0] as EstateFile).blocks },
      after: { path: TWIN_PROBE_PATH, blocks: (files.after[0] as EstateFile).blocks },
      fates: segs.flatMap((seg) => seg.fates),
    };
  }
  throw new Problem('the twin could not draw a probe file apart from the old units');
}

/**
 * The twin of a scenario: the same old files, scanned fresh, then edited by a second script drawn from the
 * seed. One prose block of the old files is removed (its units must be `deleted`, every other old unit
 * `unchanged`), and a probe file beside them is edited by a split, a merge, a reword, a delete and an insert
 * (each unit must follow its script: `split`, `merged`, `changed`, `deleted`, a fresh id). A reader whose
 * events were fixed before it saw the edit (a constant `unchanged`, or a list keyed on the old files) fails
 * here; so does one that derives each event from a same-path, same-fingerprint compare, which can tell no
 * split and no merge.
 */
export async function runTwin(
  ctx: ItemContext,
  before: readonly EstateFile[],
  labeler?: Labeler,
): Promise<string> {
  const p = new Prose(ctx.seed, `${ctx.id}:twin`);
  const { after, gone } = dropOneBlock(p, before);
  const probe = probeFile(p, before, gone);
  try {
    await runScenario(ctx, {
      before: [...before, probe.before],
      after: [...after, probe.after],
      fates: [...gone.map((text) => ({ text, fate: { kind: 'deleted' } as Fate })), ...probe.fates],
      ...(labeler ? { labeler } : {}),
    });
  } catch (cause) {
    if (cause instanceof Problem)
      throw new Problem(`the twin edit (the same files, a second script): ${cause.message}`);
    throw cause;
  }
  return `twin edit: ${gone.length} removed, ${probe.fates.length} scripted fates`;
}

export async function anchorCase(ctx: ItemContext, s: Scenario, detail?: string): Promise<Outcome> {
  const run = await runScenario(ctx, s);
  const twin = await runTwin(ctx, s.before, s.labeler);
  const live = liveOf(run.after.ledger).length;
  return pass(`${detail ?? `${run.ids.size} old units checked, ${live} live after`}; ${twin}`);
}
