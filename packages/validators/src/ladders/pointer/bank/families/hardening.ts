import { fileURLToPath } from 'node:url';
import { anchorCase } from '../../kit/anchor-case';
import { allTexts, cloneWorld, distinctSentences, filesOf, worldOf } from '../../kit/anchor-world';
import { runChild } from '../../kit/child-run';
import { type Block, compose } from '../../kit/compose';
import { cutRun } from '../../kit/cut-case';
import { build, byId, type EstateFile, liveByText, liveOf, scanOk } from '../../kit/estate';
import { loadFixture, RUNS } from '../../kit/fixture';
import { entriesFor, perfect, recording, truthLabel } from '../../kit/labellers';
import { norm } from '../../kit/norm';
import { show } from '../../kit/oracle';
import { requireSourceWitness } from '../../kit/positive';
import { buildScript, filesOfSegments, type ScriptOps } from '../../kit/segments';
import { FIVE_YAML, keyOf, PROBE_YAML, RULES_YAML } from '../../kit/sets';
import { type FakeTransport, fakeTransport, type ParsedCall, seededModels } from '../../kit/transport';
import { headingText, longMake, Prose, rewordWords, word } from '../../kit/words';
import type { Labeler, LedgerEntry, LedgerView, ScanResult, SourceFile } from '../../sut/port';
import { runControl } from '../controls';
import { PLANTS, probe, readerGainedNothing } from '../harness-probe';
import { MARKER_PLANTED } from '../plants/broken';
import { importsOfValidators } from '../reader-imports';
import { fail, type ItemContext, missing, type Outcome, Problem, pass, type Run } from '../types';

/**
 * The runners of the items the audits added (`specs/hardening.ts`). Each item is written so that a correct reader
 * passes and the defect or the cheat that motivated it fails; `validators/pointer/audit.md` names them.
 */

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const SET = 'agent-rules';

/** The label a live entry holds under the default set. */
const labelOf = (ledger: LedgerView, text: string): string | undefined =>
  liveByText(ledger, text)?.labels[SET]?.label;

/* ----- cutting ----- */

const cutting: Record<string, Run> = {
  'url-query-capital-after-mark': cutRun((ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const url = `https://shop.example/${word(r)}?${capital(word(r))}=${1 + Math.floor(r() * 8)}&${capital(word(r))}=${word(r)}`;
    const first = `Open ${url} for the ${word(r)} list.`;
    return {
      blocks: [{ kind: 'paragraph', sentences: [first, p.next()] }],
      extra: (_doc, got) =>
        got.units[0]?.text.includes(url)
          ? undefined
          : `the first unit does not hold the whole address ${url}: a question mark inside it ended the sentence`,
    };
  }),
};

/* ----- ids ----- */

const history = (ledger: LedgerView, id: string): string[] => {
  const entry = byId(ledger, id);
  if (!entry) throw new Problem(`the ledger has no entry ${id}`);
  if (!entry.lineage)
    throw new Problem(
      `the reader records no lineage for ${id}: each entry must keep its history, one step per change of the unit`,
      'missing-observation',
    );
  return entry.lineage.map((step) => step.event);
};

const ids: Record<string, Run> = {
  'lineage-is-history': async (ctx) => {
    const p = prose(ctx);
    const w = worldOf(p, { files: 1, perFile: 8 });
    const texts = w.texts[0] as string[];
    const labeler = perfect();
    const files = build(filesOf(w)).files;
    const first = await scanOk(ctx.sut, { files, labeler });
    requireSourceWitness(first, files);
    const all = liveOf(first.ledger).map((e) => e.id);
    for (const id of all) {
      const got = history(first.ledger, id);
      if (JSON.stringify(got) !== JSON.stringify(['new']))
        return fail(`after the first scan the lineage of ${id} is ${JSON.stringify(got)}, expected ["new"]`);
    }
    const second = await scanOk(ctx.sut, { files, previousLedger: first.ledger.raw, labeler });
    if (second.ledger.raw !== first.ledger.raw)
      return fail(
        'a rescan of unchanged files wrote other ledger bytes: a lineage step was added for no change',
      );
    const edited = cloneWorld(w);
    const was = texts[3] as string;
    (edited.texts[0] as string[])[3] = rewordWords(p.random, was, 1);
    const editedFiles = build(filesOf(edited)).files;
    const third = await scanOk(ctx.sut, { files: editedFiles, previousLedger: second.ledger.raw, labeler });
    const id3 = liveByText(first.ledger, was)?.id as string;
    const kept = history(third.ledger, id3);
    if (JSON.stringify(kept) !== JSON.stringify(['new', 'changed']))
      return fail(`the reworded unit has the lineage ${JSON.stringify(kept)}, expected ["new","changed"]`);
    for (const id of all.filter((x) => x !== id3)) {
      const got = history(third.ledger, id);
      if (JSON.stringify(got) !== JSON.stringify(['new']))
        return fail(`the untouched unit ${id} has the lineage ${JSON.stringify(got)}, expected ["new"]`);
    }
    const gone = cloneWorld(edited);
    const removed = (gone.texts[0] as string[]).splice(5, 1)[0] as string;
    const id5 = liveByText(first.ledger, removed)?.id as string;
    const fourth = await scanOk(ctx.sut, {
      files: build(filesOf(gone)).files,
      previousLedger: third.ledger.raw,
      labeler,
    });
    const last = byId(fourth.ledger, id5);
    if (!last || last.status === 'live') return fail('the deleted unit is still live in the ledger');
    const ended = history(fourth.ledger, id5);
    if (JSON.stringify(ended) !== JSON.stringify(['new', 'deleted']))
      return fail(`the deleted unit has the lineage ${JSON.stringify(ended)}, expected ["new","deleted"]`);
    const steps = (byId(fourth.ledger, id3)?.lineage ?? []).map((step) => step.scan);
    if (!steps.every((scan, at) => at === 0 || scan > (steps[at - 1] as number)))
      return fail(`the scan numbers of one lineage do not grow: ${JSON.stringify(steps)}`);
    // Round 3 audit, seat 2: a lineage that steps only on a changed fingerprint or a deletion gains nothing.
    // A fifth scan moves the first unit to the end of the file: its lineage ends with `moved`.
    const shifted = cloneWorld(gone);
    const first0 = (shifted.texts[0] as string[]).shift() as string;
    (shifted.texts[0] as string[]).push(first0);
    const fifth = await scanOk(ctx.sut, {
      files: build(filesOf(shifted)).files,
      previousLedger: fourth.ledger.raw,
      labeler,
    });
    const id0 = liveByText(first.ledger, first0)?.id as string;
    const moved = history(fifth.ledger, id0);
    return JSON.stringify(moved) === JSON.stringify(['new', 'moved'])
      ? pass('the lineage grows by one true step per change, a move included, and not for a rescan')
      : fail(`the moved unit has the lineage ${JSON.stringify(moved)}, expected ["new","moved"]`);
  },
  'entry-slices-with-bom-and-crlf': async (ctx) => {
    const p = prose(ctx);
    const blocks: Block[] = [
      { kind: 'heading', level: 1, text: headingText(p.random) },
      { kind: 'paragraph', sentences: p.many(2, longMake), wrap: 48 },
      { kind: 'list', items: p.many(2, longMake).map((text) => ({ text })), wrap: 48 },
    ];
    const doc = compose(blocks, { eol: '\r\n', bom: true });
    const files = [{ path: 'crlf.md', text: doc.text }];
    const result = await scanOk(ctx.sut, { files, labeler: perfect() });
    requireSourceWitness(result, files);
    const live = liveOf(result.ledger);
    for (const entry of live) {
      if (!entry.hint)
        return fail(`the entry ${entry.id} has no hint: its place in the file is not recorded`);
      const slice = doc.text.slice(entry.hint.start, entry.hint.end);
      if (slice !== entry.quote)
        return fail(
          `the quote of ${entry.id} is not the source slice ${JSON.stringify(slice.slice(0, 40))}: it reads ${JSON.stringify(entry.quote.slice(0, 40))}`,
        );
      if (!doc.text.includes(`${entry.prefix}${entry.quote}${entry.suffix}`))
        return fail(`prefix + quote + suffix of ${entry.id} is not in the source`);
    }
    return pass(`${live.length} entries slice the source, byte-order mark and CRLF included`);
  },
  'id-unique-for-repeated-text': async () => {
    const dup =
      'Keep the red ledger beside the brass lamp until the courier has signed the dispatch sheet twice.';
    const text = compose(
      Array.from({ length: 50 }, (): Block => ({ kind: 'paragraph', sentences: [dup] })),
    ).text;
    const limit = Number(process.env.DRIFTBENCH_POINTER_CHILD_MS ?? 120_000);
    const child = await runChild(
      { kind: 'scan', files: [{ path: 'dup.md', text }], labeler: 'perfect' },
      { timeoutMs: limit },
    );
    try {
      if (child.timedOut)
        return fail(
          `the scan of fifty identical sentences did not end within ${Math.round(limit / 1000)} s: the reader loops when a text repeats`,
        );
      const out = child.output;
      if (!out) return fail(`the child gave no output: ${child.stderr.slice(0, 200)}`);
      if (!out.ok) return fail(out.error);
      const result = out.result as ScanResult;
      if (!result.ok || !result.ledger) return fail(`the scan failed: ${result.error ?? 'no ledger'}`);
      const live = liveOf(result.ledger);
      if (live.length !== 50) return fail(`${live.length} live entries for fifty paragraphs`);
      const distinct = new Set(live.map((entry) => entry.id)).size;
      return distinct === 50
        ? pass('fifty distinct ids')
        : fail(`${distinct} distinct ids for fifty equal units`);
    } finally {
      child.cleanup();
    }
  },
};

/* ----- id carry and per-kind events (round 3 audit, seat 1) ----- */

/** What each text of an edit script becomes, read from its construction. */
type Plan = {
  before: EstateFile[];
  after: EstateFile[];
  /** Texts the script keeps in place. */
  kept: string[];
  moved: Array<{ text: string; path: string }>;
  changed: Array<{ from: string; to: string }>;
  deleted: string[];
  /** Texts that enter the estate and must take a fresh id: inserts and rewrites in place. */
  entering: string[];
  split: string[];
  merged: Array<{ a: string; b: string; into: string }>;
};

/** An edit script drawn from the seed over `files` files, with six kept units among the ops. */
function planOf(p: Prose, ops: ScriptOps, files: number): Plan {
  const segs = buildScript(p, ops, 6, files);
  const heads = Array.from({ length: files }, (_, f) => `${headingText(p.random)} ${f + 1}`);
  const { before, after } = filesOfSegments(segs, files, heads);
  const plan: Plan = {
    before,
    after,
    kept: [],
    moved: [],
    changed: [],
    deleted: [],
    entering: [],
    split: [],
    merged: [],
  };
  for (const seg of segs) {
    if (seg.fates.length === 0 && seg.before.length === 1 && seg.before[0] === seg.after[0])
      plan.kept.push(seg.before[0] as string);
    if (seg.fates.length === 0 && seg.before.length === 0 && seg.afterFile === undefined)
      plan.entering.push(...seg.after);
    for (const { text, fate } of seg.fates) {
      if (fate.kind === 'moved') plan.moved.push({ text, path: fate.path as string });
      else if (fate.kind === 'changed') plan.changed.push({ from: text, to: fate.to });
      else if (fate.kind === 'split') plan.split.push(text);
      else if (fate.kind === 'mergePair' && !plan.merged.some((m) => m.b === text))
        plan.merged.push({ a: text, b: fate.other, into: fate.into });
      else if (fate.kind === 'deleted') {
        plan.deleted.push(text);
        plan.entering.push(...seg.after);
      }
    }
  }
  return plan;
}

/** Scans the old files fresh, then the new files with the first ledger. */
async function rescan(ctx: ItemContext, before: EstateFile[], after: EstateFile[]) {
  const labeler = perfect();
  const first = await scanOk(ctx.sut, { files: build(before).files, labeler });
  const second = await scanOk(ctx.sut, {
    files: build(after).files,
    previousLedger: first.ledger.raw,
    labeler,
  });
  const oldEntry = (text: string) => {
    const entry = liveByText(first.ledger, text);
    if (!entry) throw new Problem(`positive witness: the first scan has no live entry for ${show(text)}`);
    return entry;
  };
  return { first, second, oldEntry };
}

/**
 * The carry of ids, judged from the ledger alone: the edit is a reword, a move to the other file, a rewrite
 * in place, an insert and a delete among six kept units. Nothing the reader reports beside the ledger is read.
 */
async function carry(ctx: ItemContext) {
  const plan = planOf(prose(ctx), ['reword', 'move', 'rewrite', 'insert', 'delete'], 2);
  const run = await rescan(ctx, plan.before, plan.after);
  const live = liveOf(run.second.ledger);
  if (new Set(live.map((e) => e.id)).size !== live.length)
    throw new Problem('the rescan gives two live entries one id');
  /** The live entry of the old id, or the reason it has none. */
  const carried = (text: string): { old: LedgerEntry; now: LedgerEntry } => {
    const old = run.oldEntry(text);
    const now = live.find((e) => e.id === old.id);
    if (!now)
      throw new Problem(
        `the id ${old.id} of ${show(text)} is not live after the rescan: the unit lost its id`,
      );
    return { old, now };
  };
  return { plan, run, live, carried };
}

const carryRuns: Record<string, Run> = {
  'carry-unchanged-in-ledger': async (ctx) => {
    const { plan, carried } = await carry(ctx);
    for (const text of plan.kept) {
      const { old, now } = carried(text);
      if (norm(now.quote) !== norm(text))
        return fail(`the id ${old.id} of the unchanged unit ${show(text)} now quotes ${show(now.quote)}`);
      if (now.path !== old.path)
        return fail(`the id ${old.id} of the unchanged unit ${show(text)} moved to ${now.path}`);
    }
    return pass(`${plan.kept.length} unchanged units keep their ids in the ledger`);
  },
  'carry-moved-in-ledger': async (ctx) => {
    const { plan, carried } = await carry(ctx);
    for (const { text, path } of plan.moved) {
      const { old, now } = carried(text);
      if (norm(now.quote) !== norm(text))
        return fail(`the id ${old.id} of the moved unit ${show(text)} now quotes ${show(now.quote)}`);
      if (now.path !== path)
        return fail(`the id ${old.id} of the unit moved to ${path} is live in ${now.path}`);
    }
    return pass(`${plan.moved.length} moved unit keeps its id in the ledger, in the file it moved to`);
  },
  'carry-reworded-in-ledger': async (ctx) => {
    const { plan, carried } = await carry(ctx);
    for (const { from, to } of plan.changed) {
      const { old, now } = carried(from);
      if (norm(now.quote) !== norm(to))
        return fail(`the id ${old.id} of the reworded unit quotes ${show(now.quote)}, expected ${show(to)}`);
      if (now.path !== old.path) return fail(`the id ${old.id} of the reworded unit moved to ${now.path}`);
    }
    return pass(`${plan.changed.length} reworded unit keeps its id in the ledger, with the new text`);
  },
  'fresh-id-for-new-unit-in-ledger': async (ctx) => {
    const { plan, run, live } = await carry(ctx);
    const oldIds = new Map(run.first.ledger.entries.map((e) => [e.id, e]));
    for (const text of plan.entering) {
      const now = live.find((e) => norm(e.quote) === norm(text));
      if (!now) return fail(`positive witness: the new unit ${show(text)} has no live entry`);
      const was = oldIds.get(now.id);
      if (was)
        return fail(
          `the new unit ${show(text)} carries the old id ${now.id}, which belonged to ${show(was.quote)}`,
        );
    }
    return pass(`${plan.entering.length} new units take ids no old entry had`);
  },
  'deleted-id-not-reused-in-ledger': async (ctx) => {
    const { plan, run, live } = await carry(ctx);
    for (const text of plan.deleted) {
      const old = run.oldEntry(text);
      const again = live.find((e) => e.id === old.id);
      if (again)
        return fail(
          `the id ${old.id} of the deleted unit ${show(text)} is live again with ${show(again.quote)}`,
        );
    }
    return pass(`${plan.deleted.length} deleted units leave their ids unused`);
  },
};

/** The event the reader reports for one id; an absent observation earns no credit. */
const reported = (result: ScanResult, id: string): string => {
  const event = result.events?.[id];
  if (event === undefined)
    throw new Problem(`the reader does not expose an event for ${id}`, 'missing-observation');
  return event;
};

/** The edit of each script kind; `ambiguous` has its own world. */
const KIND_OPS: Record<string, { ops: ScriptOps; files: number }> = {
  new: { ops: ['insert'], files: 1 },
  unchanged: { ops: ['insert'], files: 1 },
  moved: { ops: ['move'], files: 2 },
  changed: { ops: ['reword'], files: 1 },
  split: { ops: ['split'], files: 1 },
  merged: { ops: ['merge'], files: 1 },
  deleted: { ops: ['delete'], files: 1 },
};

/** The ids that must carry the event, the ids that must not, from the ledger; then the events are read. */
async function eventCase(ctx: ItemContext, kind: string): Promise<Outcome> {
  const p = prose(ctx);
  let targets: string[];
  let controls: string[];
  let result: ScanResult;
  if (kind === 'ambiguous') {
    const w = worldOf(p, { files: 1, perFile: 30 });
    const v2 = cloneWorld(w);
    const texts = v2.texts[0] as string[];
    const t = texts.splice(8, 1)[0] as string;
    texts.splice(2, 0, t);
    texts.splice(20, 0, t);
    const run = await rescan(ctx, filesOf(w), filesOf(v2));
    targets = [run.oldEntry(t).id];
    controls = (w.texts[0] as string[]).filter((x) => x !== t).map((x) => run.oldEntry(x).id);
    result = run.second;
  } else {
    const { ops, files } = KIND_OPS[kind] as { ops: ScriptOps; files: number };
    const plan = planOf(p, ops, files);
    const run = await rescan(ctx, plan.before, plan.after);
    const kept = plan.kept.map((text) => run.oldEntry(text).id);
    const fresh = plan.entering.map((text) => {
      const entry = liveByText(run.second.ledger, text);
      if (!entry) throw new Problem(`positive witness: the inserted unit ${show(text)} has no live entry`);
      return entry.id;
    });
    const survivors = plan.merged.map(({ a, b, into }) => {
      const pair = [run.oldEntry(a).id, run.oldEntry(b).id];
      const live = pair.filter((id) => {
        const now = byId(run.second.ledger, id);
        return now?.status === 'live' && norm(now.quote) === norm(into);
      });
      if (live.length !== 1)
        throw new Problem(
          `positive witness: ${live.length} of the two merged ids live on with the joined text, expected one`,
        );
      return live[0] as string;
    });
    const byKind: Record<string, string[]> = {
      new: fresh,
      unchanged: kept,
      moved: plan.moved.map((m) => run.oldEntry(m.text).id),
      changed: plan.changed.map((c) => run.oldEntry(c.from).id),
      split: plan.split.map((text) => run.oldEntry(text).id),
      merged: survivors,
      deleted: plan.deleted.map((text) => run.oldEntry(text).id),
    };
    targets = byKind[kind] ?? [];
    controls = kind === 'unchanged' ? fresh : kept;
    result = run.second;
  }
  if (targets.length === 0 || controls.length === 0)
    throw new Problem(`positive witness: the script made no ${kind} unit or no control unit`);
  for (const id of targets) {
    const event = reported(result, id);
    if (event !== kind) return fail(`the ${kind} unit ${id} has event ${event}, expected ${kind}`);
  }
  for (const id of controls) {
    if (reported(result, id) === kind)
      return fail(`the control unit ${id}, which the edit did not make ${kind}, has event ${kind}`);
  }
  return pass(`${targets.length} ${kind} unit(s) reported ${kind}; ${controls.length} control units are not`);
}

const KINDS = ['new', 'unchanged', 'moved', 'changed', 'split', 'merged', 'ambiguous', 'deleted'] as const;
const eventRuns: Record<string, Run> = {};
for (const kind of KINDS) eventRuns[`event-${kind}`] = (ctx) => eventCase(ctx, kind);

/* ----- re-anchoring ----- */

const reanchoring: Record<string, Run> = {
  ...eventRuns,
  'heading-edit-relabels-interior-unit': async (ctx) => {
    const p = prose(ctx);
    const paragraphs = p.many(4, longMake) as string[];
    const doc = (heading: string) =>
      compose([
        { kind: 'heading', level: 1, text: heading },
        ...paragraphs.map((text): Block => ({ kind: 'paragraph', sentences: [text] })),
      ]).text;
    const text = paragraphs[1] as string;
    const first = await scanOk(ctx.sut, {
      files: [{ path: 'ctx.md', text: doc('Closing duties') }],
      labeler: perfect(),
    });
    const was = labelOf(first.ledger, text);
    const flipTo = was === 'none' ? 'rule' : 'none';
    const flip: Labeler = (request) => ({
      labels: entriesFor(request, (unit) =>
        keyOf(unit.text) === keyOf(text) ? flipTo : truthLabel(unit.text),
      ),
    });
    const second = await scanOk(ctx.sut, {
      files: [{ path: 'ctx.md', text: doc('Locking rounds') }],
      previousLedger: first.ledger.raw,
      labeler: flip,
    });
    const before = liveByText(first.ledger, text);
    const after = liveByText(second.ledger, text);
    if (!before || !after) return fail('positive witness: the second paragraph has no live entry');
    if (before.fp !== after.fp) return fail('positive witness: the fingerprint of the text changed');
    if (before.id !== after.id) return fail('the unit lost its id when only its heading was renamed');
    if (before.ctxFp === after.ctxFp)
      return fail(
        'the context fingerprint is the same under another heading: the heading path is not part of it',
      );
    const got = labelOf(second.ledger, text);
    return got === flipTo
      ? pass('the heading path is part of the context, so the unit was labelled again')
      : fail(`the unit has label ${got}: the old label ${was} was carried across a renamed heading`);
  },
  'events-follow-the-text': async (ctx) => {
    const p = prose(ctx);
    const w = worldOf(p, { files: 2, perFile: 8 });
    const v2 = cloneWorld(w);
    const first = v2.texts[0] as string[];
    const second = v2.texts[1] as string[];
    const moved = first.splice(1, 1)[0] as string;
    second.splice(4, 0, moved);
    const from = first[2] as string;
    const reworded = rewordWords(p.random, from, 1);
    first[2] = reworded;
    const gone = second.pop() as string;
    first.push(p.unrelatedTo(allTexts(w)));
    return anchorCase(ctx, {
      before: filesOf(w),
      after: filesOf(v2),
      fates: [
        { text: moved, fate: { kind: 'moved', events: ['moved'], path: w.paths[1] as string } },
        { text: from, fate: { kind: 'changed', to: reworded } },
        { text: gone, fate: { kind: 'deleted' } },
      ],
    });
  },
  'neighbour-edit-relabels': async (ctx) => {
    const p = prose(ctx);
    const w = worldOf(p, { files: 1, perFile: 12 });
    const texts = w.texts[0] as string[];
    const edited = cloneWorld(w);
    (edited.texts[0] as string[])[5] = rewordWords(p.random, texts[5] as string, 1);
    const first = await scanOk(ctx.sut, { files: build(filesOf(w)).files, labeler: perfect() });
    const flipped = new Set([texts[4], texts[6]].map((t) => keyOf(t as string)));
    const flip: Labeler = (request) => ({
      labels: entriesFor(request, (unit) => (flipped.has(keyOf(unit.text)) ? 'none' : truthLabel(unit.text))),
    });
    const second = await scanOk(ctx.sut, {
      files: build(filesOf(edited)).files,
      previousLedger: first.ledger.raw,
      labeler: flip,
    });
    for (const text of [texts[4], texts[6]] as string[]) {
      const before = liveByText(first.ledger, text);
      const after = liveByText(second.ledger, text);
      if (!before || !after)
        return fail(`the neighbour ${JSON.stringify(text.slice(0, 30))} has no live entry`);
      if (before.id !== after.id) return fail('a neighbour of the edit lost its id');
      if (before.ctxFp === after.ctxFp)
        return fail('positive witness: the neighbour kept its context fingerprint');
      const got = labelOf(second.ledger, text);
      if (got !== 'none')
        return fail(
          `the neighbour ${JSON.stringify(text.slice(0, 30))} has label ${got}: the labeller said none, but the old label was carried across a change of context`,
        );
    }
    for (const text of [texts[1], texts[9]] as string[]) {
      const got = labelOf(second.ledger, text);
      if (got !== truthLabel(text))
        return fail(
          `a unit far from the edit has label ${got}, expected the label it had, ${truthLabel(text)}`,
        );
    }
    return pass('the neighbours take the new answer, the far units keep theirs');
  },
  'short-repeated-text-stays-in-file': async (ctx) => {
    const p = prose(ctx);
    const short = ['Stop.', 'Wait.', 'Hold.', 'Rest.'][ctx.seed % 4] as string;
    const w = worldOf(p, { files: 3, perFile: 6 });
    (w.texts[0] as string[]).splice(2, 0, short);
    (w.texts[1] as string[]).splice(3, 0, short);
    const v2 = cloneWorld(w);
    (v2.texts[0] as string[]).splice(2, 1);
    (v2.texts[2] as string[]).splice(4, 0, short);
    const first = await scanOk(ctx.sut, { files: build(filesOf(w)).files, labeler: perfect() });
    const second = await scanOk(ctx.sut, {
      files: build(filesOf(v2)).files,
      previousLedger: first.ledger.raw,
      labeler: perfect(),
    });
    const at = (ledger: LedgerView, path: string) =>
      liveOf(ledger).find((entry) => entry.path === path && entry.quote === short);
    const inA = at(first.ledger, w.paths[0] as string);
    const inB = at(first.ledger, w.paths[1] as string);
    if (!inA || !inB) return fail('positive witness: the first scan has no entry for the short text');
    const inC = at(second.ledger, w.paths[2] as string);
    if (!inC) return fail('the third file has no live entry for the added short text');
    if (inC.id === inA.id)
      return fail('the short text added to the third file took the id of the copy removed from the first');
    const old = byId(second.ledger, inA.id);
    if (old && old.status === 'live') return fail('the id of the removed short text is still live');
    const still = at(second.ledger, w.paths[1] as string);
    return still?.id === inB.id
      ? pass('the short text stays with its own file')
      : fail('the copy that stayed in the second file lost its id');
  },
};

/* ----- privacy ----- */

const privacy: Record<string, Run> = {
  'warning-names-models-not-units': async (ctx) => {
    const fixture = loadFixture('haiku');
    // Round 3 audit, seat 2: the models come from the seed, and a re-record whose models agree must warn of
    // nothing, so a warning literal or a warning given on every scan gains nothing.
    const { recorded, returned } = seededModels(ctx.seed, ctx.id);
    const reRecord = (cassetteModel: string, transportModel: string): Promise<ScanResult> => {
      const rows = structuredClone(fixture.rows).slice(1);
      for (const row of rows) row.answer.returnedModel = cassetteModel;
      return ctx.sut.scan({
        files: fixture.files,
        labelsYaml: fixture.labelsYaml,
        model: { arm: 'haiku', transport: fakeTransport({ model: transportModel }) },
        cassette: {
          mode: 'record',
          text: rows
            .map((row) => JSON.stringify(row))
            .concat('')
            .join('\n'),
        },
      });
    };
    const res = await reRecord(recorded, returned);
    if (!res.ok) return fail(`the re-record failed: ${res.error}`);
    if (!Array.isArray(res.warnings) || !Array.isArray(res.warningRecords))
      return missing(
        'the reader does not expose warnings: a returned model that differs from the cassette must be reported as a warning that names both models',
      );
    const named = res.warningRecords.filter(
      (w) => w.code === 'model-mismatch' && w.recorded === recorded && w.returned === returned,
    );
    if (named.length === 0)
      return fail(`no warning names both models; the warnings are ${JSON.stringify(res.warningRecords)}`);
    const units = fixture.documents.flatMap((d) => d.units.map((u) => u.text.replace(/\s+/g, ' ').trim()));
    const quoted = res.warnings.find((w) => units.some((u) => u.length >= 20 && w.includes(u.slice(0, 20))));
    if (quoted) return fail(`a warning quotes unit text: ${quoted.slice(0, 60)}`);
    const same = await reRecord(recorded, recorded);
    if (!same.ok) return fail(`the re-record whose models agree failed: ${same.error}`);
    if (!Array.isArray(same.warnings) || !Array.isArray(same.warningRecords))
      return fail('the second re-record exposes no warnings');
    return same.warnings.length === 0 && same.warningRecords.length === 0
      ? pass('the warning names both models and no unit text; models that agree give no warning')
      : fail(
          `a re-record whose models agree warns: ${JSON.stringify([...same.warnings, ...same.warningRecords]).slice(0, 120)}`,
        );
  },
};

/* ----- radius (the rerun rule of the ledger) ----- */

async function rerunWorld(
  ctx: ItemContext,
  edit: (w: ReturnType<typeof worldOf>, p: Prose) => void,
  extra?: Block[],
) {
  const api = ctx.sut.rerun;
  if (!api)
    throw new Problem(
      'the reader exports no rerun rule: it must say, for each unit between two ledgers, whether it is unchanged, context, moved, changed, deleted or new, and which old units rerun',
      'missing-observation',
    );
  const p = prose(ctx);
  const w = worldOf(p, { files: 1, perFile: 8 });
  const first = await scanOk(ctx.sut, { files: build(filesOf(w)).files, labeler: perfect() });
  const v2 = cloneWorld(w);
  edit(v2, p);
  const files = build(filesOf(v2)).files.map((file) =>
    extra && file.path === w.paths[0] ? { ...file, text: `${file.text}\n${compose(extra).text}` } : file,
  );
  const second = await scanOk(ctx.sut, { files, previousLedger: first.ledger.raw, labeler: perfect() });
  return { api, w, first, second };
}

const same = (a: readonly string[], b: readonly string[]): boolean =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const radius: Record<string, Run> = {
  'moved-unit-is-advisory': async (ctx) => {
    const api = ctx.sut.rerun;
    if (!api)
      throw new Problem(
        'the reader exports no rerun rule: it must say, for each unit between two ledgers, whether it is unchanged, context, moved, changed, deleted or new, and which old units rerun',
      );
    const p = prose(ctx);
    const w = worldOf(p, { files: 2, perFile: 8 });
    const v2 = cloneWorld(w);
    const [moved] = (v2.texts[0] as string[]).splice(3, 1);
    (v2.texts[1] as string[]).splice(4, 0, moved as string);
    const first = await scanOk(ctx.sut, { files: build(filesOf(w)).files, labeler: perfect() });
    const second = await scanOk(ctx.sut, {
      files: build(filesOf(v2)).files,
      previousLedger: first.ledger.raw,
      labeler: perfect(),
    });
    const id = liveByText(first.ledger, moved as string)?.id;
    if (id === undefined) return fail('positive witness: the first scan has no entry for the moved unit');
    const now = byId(second.ledger, id);
    if (now?.status !== 'live' || now.path !== w.paths[1])
      return fail('positive witness: the moved unit did not keep its id in the second file');
    const classes = new Map((await api.classify(first.ledger, second.ledger)).map((c) => [c.id, c.class]));
    if (classes.get(id) !== 'moved')
      return fail(`the moved unit is classed ${classes.get(id)}, expected moved`);
    const out = await api.rerun(first.ledger, second.ledger);
    if (out.units.includes(id)) return fail('the moved unit reruns its links: a move is only advisory');
    if (out.whole !== null) return fail(`a move reruns the whole suite: ${out.whole}`);
    return out.advisory.includes(id)
      ? pass('the moved unit is reported, and nothing reruns for it')
      : fail(`the advisory set is ${JSON.stringify(out.advisory)}, expected the moved unit`);
  },
  'deleted-unit-reruns-its-links': async (ctx) => {
    const { api, w, first, second } = await rerunWorld(ctx, (v2) => {
      (v2.texts[0] as string[]).splice(4, 1);
    });
    const gone = liveByText(first.ledger, (w.texts[0] as string[])[4] as string)?.id as string;
    const classes = await api.classify(first.ledger, second.ledger);
    const got = classes.find((c) => c.id === gone)?.class;
    if (got !== 'deleted') return fail(`the deleted unit is classed ${got}, expected deleted`);
    const out = await api.rerun(first.ledger, second.ledger);
    return same(out.units, [gone]) && out.whole === null
      ? pass('the deleted unit reruns its links, and nothing else does')
      : fail(`the rerun set is ${JSON.stringify(out.units)}, expected only the deleted unit ${gone}`);
  },
  'new-unit-falls-back-to-whole-file': async (ctx) => {
    const { api, first, second } = await rerunWorld(ctx, () => undefined, [
      { kind: 'heading', level: 1, text: 'Kitchen annex' },
      { kind: 'paragraph', sentences: ['Wipe the copper pans before the lamp is lit in the annex.'] },
    ]);
    const old = liveOf(first.ledger).map((entry) => entry.id);
    const added = liveOf(second.ledger).filter((entry) => !old.includes(entry.id));
    if (added.length < 1) return fail('positive witness: the second scan has no new unit');
    const out = await api.rerun(first.ledger, second.ledger);
    return same(out.units, old) && out.whole === null
      ? pass(`a new section reruns the links of all ${old.length} old units of its file`)
      : fail(
          `the rerun set holds ${out.units.length} units, expected the ${old.length} old units of the file`,
        );
  },
  'context-edit-is-advisory': async (ctx) => {
    const { api, w, first, second } = await rerunWorld(ctx, (edited, prose2) => {
      const texts = edited.texts[0] as string[];
      texts[4] = rewordWords(prose2.random, texts[4] as string, 1);
    });
    const texts = w.texts[0] as string[];
    const idOf = (i: number) => liveByText(first.ledger, texts[i] as string)?.id as string;
    const classes = new Map((await api.classify(first.ledger, second.ledger)).map((c) => [c.id, c.class]));
    for (const i of [3, 5])
      if (classes.get(idOf(i)) !== 'context')
        return fail(`a neighbour of the edit is classed ${classes.get(idOf(i))}, expected context`);
    const out = await api.rerun(first.ledger, second.ledger);
    if (!same(out.advisory, [idOf(3), idOf(5)]))
      return fail(`the advisory set is ${JSON.stringify(out.advisory)}, expected the two neighbours`);
    return same(out.units, [idOf(4)])
      ? pass('the edited unit reruns, its neighbours are only reported')
      : fail(`the rerun set is ${JSON.stringify(out.units)}, expected only the edited unit`);
  },
};

/* ----- grouping ----- */

const CONDITION_YAML = `labels:
  - set: agent-rules
    description: What an instruction file asks of the agent, and when.
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: when
        description: A unit that states when the rule it points at applies.
        target: required
        condition: true
`;

const TWO_ATOM_SETS = `${RULES_YAML}  - set: second-reading
    description: The same instructions read a second time.
    labels:
      - name: also-rule
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation }
`;

const grouping: Record<string, Run> = {
  'same-unit-in-two-sets-is-one-atom': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 1, perFile: 6 });
    const files = build(filesOf(w, { heading: false })).files;
    const both: Labeler = (request) => ({
      labels: entriesFor(request, () => (request.set === 'second-reading' ? 'also-rule' : 'rule')),
    });
    const result = await scanOk(ctx.sut, { files, labeler: both, labelsYaml: TWO_ATOM_SETS });
    const units = liveOf(result.ledger).length;
    const instructions = result.atoms.filter((atom) => atom.kind === 'instruction');
    if (instructions.length === 0) return fail('positive witness: the scan built no instruction atom');
    const seen = new Set(instructions.map((atom) => `${atom.file}:${atom.startLine}-${atom.endLine}`));
    if (seen.size !== instructions.length)
      return fail(
        `${instructions.length} instruction atoms stand on ${seen.size} places: two atoms of one kind repeat the same lines`,
      );
    const repeats = result.diagnostics.filter((d) => d.code === 'duplicate').length;
    return repeats === units
      ? pass(`${units} units, one atom each, ${repeats} repeats reported`)
      : fail(`${repeats} duplicate diagnostics for ${units} units that two sets map to one atom`);
  },
};

const grouping2: Record<string, Run> = {
  'condition-ids-in-review-predicate': async (ctx) => {
    const p = prose(ctx);
    const [first, second, rule] = p.many(3, longMake) as [string, string, string];
    const files = [
      {
        path: 'when.md',
        text: compose([first, second, rule].map((text): Block => ({ kind: 'paragraph', sentences: [text] })))
          .text,
      },
    ];
    const labeler: Labeler = (request) => {
      const target = request.window.units.find((unit) => keyOf(unit.text) === keyOf(rule))?.n;
      return {
        labels: request.window.units
          .filter((unit) => unit.mode === 'label')
          .map((unit) =>
            keyOf(unit.text) === keyOf(rule) || target === undefined
              ? { units: String(unit.n), label: 'rule' }
              : { units: String(unit.n), label: 'when', target },
          ),
      };
    };
    const result = await scanOk(ctx.sut, { files, labeler, labelsYaml: CONDITION_YAML });
    requireSourceWitness(result, files);
    const atoms = result.atoms.filter((atom) => atom.kind === 'instruction');
    if (atoms.length !== 1) return fail(`${atoms.length} instruction atoms for one rule, expected one`);
    const ids = [first, second].map((text) => liveByText(result.ledger, text)?.id);
    if (ids.some((id) => id === undefined)) return fail('positive witness: a condition has no live entry');
    const atom = atoms[0];
    const fieldIds = atom?.fields.condition;
    const pointers = (atom?.evidence ?? []).filter((e) => e.name === 'prose_pointer');
    if (pointers.length !== 1) return fail(`${pointers.length} prose_pointer entries, expected one`);
    const optionIds = pointers[0]?.options?.condition;
    if (fieldIds === undefined) return fail('positive witness: the atom fields carry no condition ids');
    if (optionIds === undefined)
      return fail(
        'the review predicate carries no condition ids: the review cannot see which units set the situation',
      );
    const want = JSON.stringify(ids);
    return JSON.stringify(fieldIds) === want && JSON.stringify(optionIds) === want
      ? pass(
          'the condition ids are in the atom fields and in the options of the review predicate, one for one',
        )
      : fail(
          `the atom fields list ${JSON.stringify(fieldIds)} and the predicate ${JSON.stringify(optionIds)}, expected ${want} in both`,
        );
  },
  'conditions-join-in-file-order': async (ctx) => {
    const p = prose(ctx);
    const [first, second, rule] = p.many(3, longMake) as [string, string, string];
    const files = [
      {
        path: 'when.md',
        text: compose([first, second, rule].map((text): Block => ({ kind: 'paragraph', sentences: [text] })))
          .text,
      },
    ];
    const labeler: Labeler = (request) => {
      const target = request.window.units.find((unit) => keyOf(unit.text) === keyOf(rule))?.n;
      return {
        labels: request.window.units
          .filter((unit) => unit.mode === 'label')
          .map((unit) =>
            keyOf(unit.text) === keyOf(rule) || target === undefined
              ? { units: String(unit.n), label: 'rule' }
              : { units: String(unit.n), label: 'when', target },
          ),
      };
    };
    const result = await scanOk(ctx.sut, { files, labeler, labelsYaml: CONDITION_YAML });
    requireSourceWitness(result, files);
    const atoms = result.atoms.filter((atom) => atom.kind === 'instruction');
    if (atoms.length !== 1)
      return fail(`${atoms.length} instruction atoms for one rule and two conditions, expected one`);
    const situation = atoms[0]?.situation;
    if (situation === undefined)
      return fail(
        'the atom has no situation: the units labelled as conditions must become the situation of the atom of their target',
      );
    const want = `${first.trim()} ${second.trim()}`;
    return situation === want
      ? pass('the situation reads the conditions in file order')
      : fail(
          `the situation is ${JSON.stringify(situation.slice(0, 80))}, expected the conditions in file order`,
        );
  },
};

const labels: Record<string, Run> = {
  'top-level-heading-window-boundary': async (ctx) => {
    const p = prose(ctx);
    const [one, two] = p.many(2) as [string, string];
    const files = [
      {
        path: 'sections.md',
        text: compose([
          { kind: 'heading', level: 1, text: `${headingText(p.random)} one` },
          { kind: 'paragraph', sentences: [one] },
          { kind: 'heading', level: 1, text: `${headingText(p.random)} two` },
          { kind: 'paragraph', sentences: [two] },
        ]).text,
      },
    ];
    const fake = fakeTransport();
    const res = await ctx.sut.scan({
      files,
      model: { arm: 'haiku', transport: fake },
      cassette: { mode: 'record' },
    });
    if (!res.ok || !res.ledger) return fail(`the scan failed: ${res.error ?? 'no ledger'}`);
    requireSourceWitness(res, files);
    const windows = new Set(fake.calls.map((call) => call.window));
    if (windows.size !== 2)
      return fail(
        `${windows.size} windows asked for two top-level sections, expected 2: ${[...windows].join(', ')}`,
      );
    const mixed = fake.calls.find((call) => call.units.length > 2);
    return mixed
      ? fail(`a window holds ${mixed.units.length} units: it combines the two sections`)
      : pass('one window per top-level section');
  },
  'settings-threshold-range-refused': async (ctx) => {
    const api = ctx.sut.settings;
    if (!api)
      throw new Problem(
        'the reader exports no settings reader: it must refuse a threshold outside 0 to 1 and name the key',
        'missing-observation',
      );
    for (const key of ['labeler', 'pass_at', 'fail_at', 'margin_cut']) {
      for (const bad of [1.5, 2, -0.1, 100]) {
        const out = await api.parse(`threshold: { ${key}: ${bad} }\n`);
        if (out.ok)
          return fail(`the threshold ${key}: ${bad} was accepted; a threshold is a number from 0 to 1`);
        if (
          !out.issues?.some(
            (i) => i.code === 'threshold-out-of-range' && i.key === key && i.reason === 'out-of-range',
          )
        )
          return fail(
            `the refusal of ${key}: ${bad} does not name the key by code threshold-out-of-range: ${JSON.stringify(out.issues ?? out.errors)}`,
          );
      }
      for (const good of [0, 0.4, 1]) {
        const out = await api.parse(`threshold: { ${key}: ${good} }\n`);
        if (!out.ok) return fail(`the threshold ${key}: ${good} was refused: ${out.errors.join('; ')}`);
        if (out.thresholds[key] !== good)
          return fail(`the threshold ${key}: ${good} came back as ${String(out.thresholds[key])}`);
      }
    }
    return pass('four keys, values outside 0 to 1 refused by name, 0 and 1 accepted');
  },
  'read-unit-not-labelable-under-heading': async (ctx) => {
    const p = prose(ctx);
    const description = `Checks the ${p.next().toLowerCase().replace(/\.$/, '')}.`;
    const body = p.many(4);
    const doc = compose([
      {
        kind: 'front',
        entries: [
          { key: 'name', value: 'shelf-audit' },
          { key: 'description', value: description },
        ],
      },
      { kind: 'heading', level: 1, text: 'Shelf audit' },
      ...body.map((text): Block => ({ kind: 'paragraph', sentences: [text] })),
    ]);
    const labeler = recording(perfect());
    const res = await scanOk(ctx.sut, {
      files: [{ path: '.claude/skills/shelf-audit/SKILL.md', text: doc.text }],
      labeler,
    });
    // A heading ends the window of the read unit, so no window need show it. What must hold is that no window
    // offers it for labelling, that it holds no label, and that the paragraphs below the heading are labelled.
    const offered = labeler.calls
      .flatMap((call) => call.window.units)
      .some((unit) => keyOf(unit.text) === keyOf(description) && unit.mode !== 'read');
    if (offered)
      return fail('the description the structured reader turns into a route is offered for labelling');
    const given = labelOf(res.ledger, description);
    if (given !== undefined && given !== 'none')
      return fail(`the description the structured reader turns into a route holds the label ${given}`);
    const wrong = body.find((text) => labelOf(res.ledger, text) !== truthLabel(text));
    return wrong === undefined
      ? pass('the read unit is never offered and holds no label; the paragraphs are labelled')
      : fail('a paragraph under the heading was not labelled');
  },
  'settings-inherited-threshold-key-refused': async (ctx) => {
    const api = ctx.sut.settings;
    if (!api)
      throw new Problem(
        'the reader exports no settings reader: it must refuse a threshold key that is not one of the four, and name it',
        'missing-observation',
      );
    // Names every object has by inheritance: a lookup in a table of the four keys must not find them.
    for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const out = await api.parse(`threshold: { ${key}: 0.5 }\n`);
      if (out.ok)
        return fail(`the threshold key ${key} was accepted; only the four keys of the file are thresholds`);
      if (
        !out.issues?.some(
          (i) => i.code === 'threshold-unknown-key' && i.key === key && i.reason === 'not-a-threshold',
        )
      )
        return fail(
          `the refusal of ${key} does not name the key by code threshold-unknown-key: ${JSON.stringify(out.issues ?? out.errors)}`,
        );
    }
    const own = await api.parse('threshold: { labeler: 0.5 }\n');
    if (!own.ok) return fail(`the threshold labeler: 0.5 was refused: ${own.errors.join('; ')}`);
    return pass(
      'constructor, toString, hasOwnProperty and valueOf refused by name; a real key still accepted',
    );
  },
};

/* ----- labels: the requests and the record of the yes or no arm `openai-decisions` ----- */

/** The label names of PROBE_YAML and FIVE_YAML, in set order. */
const PROBE_LABELS = ['rule', 'prohibition', 'example'];
const FIVE_LABELS = ['one', 'two', 'three', 'four', 'five'];
/** The most questions one decisions request may hold (docs/estate-pointer-reader.md, section 3). */
const DECISIONS_MAX_QUESTIONS = 100;

/** One file of one paragraph per text, no heading. */
const paragraphs = (texts: string[]): SourceFile[] => {
  const blocks = texts.map((text): Block => ({ kind: 'paragraph', sentences: [text] }));
  return [{ path: 'doc.md', text: compose(blocks).text }];
};

/** A failure found inside a helper, turned into the item's failure by `decisionsRun`. */
class DecisionsFailure extends Error {}
const decisionsRun =
  (body: (ctx: ItemContext) => Promise<Outcome>): Run =>
  async (ctx) => {
    try {
      return await body(ctx);
    } catch (error) {
      if (error instanceof DecisionsFailure) return fail(error.message);
      throw error;
    }
  };

/** Record a scan on the `openai-decisions` arm over `transport`; the failure text when it fails. */
async function decisionsRecord(
  ctx: ItemContext,
  texts: string[],
  yaml: string,
  transport: FakeTransport,
  threshold?: number,
): Promise<ScanResult & { ledger: LedgerView }> {
  const res = await ctx.sut.scan({
    files: paragraphs(texts),
    labelsYaml: yaml,
    model: { arm: 'openai-decisions', transport, ...(threshold === undefined ? {} : { threshold }) },
    cassette: { mode: 'record' },
  });
  if (!res.ok || !res.ledger) throw new DecisionsFailure(`the scan failed: ${res.error ?? 'no ledger'}`);
  return res as ScanResult & { ledger: LedgerView };
}

/** The questions of a decisions request as sent: the `type` and `name` of each entry of its list. */
function predicatesOf(call: ParsedCall): Array<{ type: unknown; name: unknown }> {
  try {
    const questions = (JSON.parse(call.body) as { questions?: unknown }).questions;
    if (!Array.isArray(questions)) return [];
    return questions.map((q) => {
      const question = (q ?? {}) as { type?: unknown; name?: unknown };
      return { type: question.type, name: question.name };
    });
  } catch {
    return [];
  }
}

/**
 * The predicate checks of decisions requests: every question of type `predicate`, named `u<n>__<label>`
 * with a label of `labels` and the number of a unit of its own request's input; no name twice in a request;
 * every unit of the input asked once per label; over all requests, each text asked once per label. The
 * failure, or undefined.
 */
function predicatesProblem(calls: ParsedCall[], texts: string[], labels: string[]): string | undefined {
  const asked = new Map<string, number>();
  for (const [at, call] of calls.entries()) {
    const where = `request ${at + 1}`;
    if (call.arm !== 'decisions') return `${where} holds no list of predicates`;
    const unitText = new Map(call.units.map((u) => [u.n, u.text]));
    const names = new Set<string>();
    for (const question of predicatesOf(call)) {
      if (question.type !== 'predicate')
        return `${where} has a question of type ${String(question.type)}, not predicate`;
      const name = typeof question.name === 'string' ? question.name : '';
      const m = /^u(\d+)__(.+)$/.exec(name);
      if (!m || !labels.includes(m[2] as string))
        return `${where} has a question named ${JSON.stringify(question.name)}, not u<n>__<label> of the set`;
      if (names.has(name)) return `${where} names the predicate ${name} twice`;
      names.add(name);
      const text = unitText.get(Number(m[1]));
      if (text === undefined) return `${where} asks ${name}, and its input has no unit [${m[1]}]`;
      const pair = `${keyOf(text)}\0${m[2]}`;
      asked.set(pair, (asked.get(pair) ?? 0) + 1);
    }
    for (const unit of call.units)
      for (const name of labels)
        if (!names.has(`u${unit.n}__${name}`))
          return `${where} does not ask u${unit.n}__${name}, and unit [${unit.n}] is in its input`;
  }
  for (const text of texts)
    for (const name of labels) {
      const times = asked.get(`${keyOf(text)}\0${name}`) ?? 0;
      if (times !== 1) return `${show(text, 30)} was asked about ${name} ${times} times, expected once`;
    }
  return undefined;
}

/** The label a yes or no labeler decides: the highest probability at or above the threshold, else none. */
const decided = (probs: Record<string, number>, threshold: number): string => {
  let best: { name: string; p: number } | undefined;
  for (const name of PROBE_LABELS) {
    const p = probs[name] as number;
    if (p >= threshold && (!best || p > best.p)) best = { name, p };
  }
  return best?.name ?? 'none';
};

/** The numbers keyed `u<n>__...` in one cassette line, wherever the line nests them. */
function recordedOf(line: string): Map<string, number> {
  const found = new Map<string, number>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === 'number' && /^u\d+__/.test(k)) found.set(k, x);
        else walk(x);
      }
  };
  try {
    walk(JSON.parse(line));
  } catch {
    // A line that is not JSON records nothing.
  }
  return found;
}

const decisions: Record<string, Run> = {
  'decisions-predicate-names': decisionsRun(async (ctx) => {
    const p = prose(ctx);
    const count = 12 + Math.floor(p.random() * 9);
    const texts = distinctSentences(p, count);
    const fake = fakeTransport();
    await decisionsRecord(ctx, texts, FIVE_YAML, fake);
    if (fake.count === 0) return fail('no request reached the transport');
    const problem = predicatesProblem(fake.calls, texts, FIVE_LABELS);
    return problem
      ? fail(problem)
      : pass(`${count * 5} predicates u<n>__<label> in ${fake.count} request(s), each unit and label once`);
  }),
  'decisions-question-cap': decisionsRun(async (ctx) => {
    const p = prose(ctx);
    const cases: Array<[string, string[], number, number]> = [
      [PROBE_YAML, PROBE_LABELS, 70, 41],
      [FIVE_YAML, FIVE_LABELS, 45, 36],
    ];
    const seen: string[] = [];
    for (const [yaml, names, low, span] of cases) {
      const count = low + Math.floor(p.random() * span);
      const texts = distinctSentences(p, count);
      const fake = fakeTransport();
      await decisionsRecord(ctx, texts, yaml, fake);
      const big = fake.calls.find((call) => call.questions.length > DECISIONS_MAX_QUESTIONS);
      if (big)
        return fail(
          `a request holds ${big.questions.length} questions (${names.length} labels), the cap is ${DECISIONS_MAX_QUESTIONS}`,
        );
      const total = count * names.length;
      const need = Math.ceil(total / DECISIONS_MAX_QUESTIONS);
      if (fake.count < need)
        return fail(`${fake.count} requests for ${total} questions, at least ${need} are needed`);
      const problem = predicatesProblem(fake.calls, texts, names);
      if (problem) return fail(problem);
      seen.push(`${total} questions in ${fake.count} requests`);
    }
    return pass(`${seen.join(', ')}, none over ${DECISIONS_MAX_QUESTIONS}, each unit and label once`);
  }),
  'decisions-probabilities-recorded': decisionsRun(async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const count = 24 + Math.floor(r() * 17);
    const texts = distinctSentences(p, count);
    const draw = (low: number, high: number) => Math.round((low + r() * (high - low)) * 100) / 100;
    // Three kinds in turn: one label over 0.9; a top label from 0.45 to 0.85; every label under 0.25.
    const table = new Map<string, Record<string, number>>();
    for (const [i, text] of texts.entries()) {
      const kind = i % 3;
      const probs: Record<string, number> = {};
      for (const name of PROBE_LABELS) probs[name] = kind === 2 ? draw(0.02, 0.24) : draw(0.02, 0.4);
      const top = PROBE_LABELS[Math.floor(r() * PROBE_LABELS.length)] as string;
      if (kind === 0) probs[top] = draw(0.91, 0.98);
      if (kind === 1) probs[top] = draw(0.45, 0.85);
      table.set(keyOf(text), probs);
    }
    const answered = (text: string, name: string) => table.get(keyOf(text))?.[name] ?? 0.05;
    const fake = fakeTransport({ probability: answered });
    const res = await decisionsRecord(ctx, texts, PROBE_YAML, fake, 0.9);
    if (!res.cassette) return fail('the record run returned no cassette');
    const lines = res.cassette.split('\n').filter(Boolean).map(recordedOf);
    const used = new Set<number>();
    for (const [at, call] of fake.calls.entries()) {
      const unitText = new Map(call.units.map((u) => [u.n, u.text]));
      const want = call.questions.map((name): [string, number] => {
        const m = /^u(\d+)__(.+)$/.exec(name);
        return [name, answered(unitText.get(Number(m?.[1])) ?? '', m?.[2] ?? '')];
      });
      // A predicate the entry lacks is missing: the difference is NaN, never within the tolerance.
      const missing = (found: Map<string, number>) =>
        want.filter(([name, value]) => !(Math.abs((found.get(name) ?? Number.NaN) - value) <= 1e-9));
      if (want.length === 0) return fail(`request ${at + 1} asks no question`);
      const match = lines.findIndex((found, i) => !used.has(i) && missing(found).length === 0);
      if (match < 0) {
        const left = lines.filter((_, i) => !used.has(i)).map(missing);
        const closest = left.sort((a, b) => a.length - b.length)[0] ?? want;
        const [name, value] = closest[0] as [string, number];
        return fail(
          `request ${at + 1}: no cassette entry holds its ${want.length} probabilities as answered; ${closest.length} differ, e.g. ${name} answered ${value}`,
        );
      }
      used.add(match);
    }
    for (const text of texts) {
      const want = decided(table.get(keyOf(text)) as Record<string, number>, 0.9);
      const got = liveByText(res.ledger, text)?.labels.probe?.label;
      if (got !== want) return fail(`${show(text, 30)} has label ${got} at threshold 0.9, expected ${want}`);
    }
    const closed = fakeTransport({ respond: () => ({ status: 500, body: 'closed' }) });
    const replay = await ctx.sut.scan({
      files: paragraphs(texts),
      labelsYaml: PROBE_YAML,
      model: { arm: 'openai-decisions', transport: closed, threshold: 0.3 },
      cassette: { mode: 'replay', text: res.cassette },
    });
    if (!replay.ok || !replay.ledger) return fail(`the replay at threshold 0.3 failed: ${replay.error}`);
    if (closed.count !== 0) return fail(`${closed.count} transport calls on a replay`);
    for (const text of texts) {
      const want = decided(table.get(keyOf(text)) as Record<string, number>, 0.3);
      const got = liveByText(replay.ledger, text)?.labels.probe?.label;
      if (got !== want)
        return fail(`${show(text, 30)} has label ${got} on the replay at threshold 0.3, expected ${want}`);
    }
    return pass(`${fake.count} request(s) recorded in full; the replay at 0.3 relabelled ${count} units`);
  }),
};

/* ----- adversarial: the reader and the verdict ----- */

/** The folder of the reader: `packages/estate/src/pointer`, seen from this file. */
const READER_DIR = fileURLToPath(new URL('../../../../../../estate/src/pointer', import.meta.url));

/**
 * The companion positive control of the three items below. They test the harness, which a reader that does nothing
 * leaves as it is; so that such a reader, or one that cuts a file or a line as one unit, earns no credit, the reader under test must first cut the control file.
 */
async function companion(ctx: ItemContext): Promise<Outcome | undefined> {
  const out = await runControl({ name: 'verdict' }, ctx.sut);
  return out.pass
    ? undefined
    : fail(
        `the reader under test does not cut the control file, so the item has no positive control: ${out.detail}`,
      );
}

const adversarial: Record<string, Run> = {
  'verdict-channel-is-not-the-readers': async (ctx) => {
    const missing = await companion(ctx);
    if (missing) return missing;
    const cheats = [
      ['wraps the send of its process', PLANTS.send],
      ['writes a pass to the descriptor of the channel', PLANTS.fd],
    ] as const;
    for (const [what, plant] of cheats) {
      const out = await probe(plant, { name: 'verdict' });
      if (out.pass)
        return fail(
          `a broken reader that ${what} made a failing control pass: the verdict is within its reach`,
        );
      if (!readerGainedNothing(out))
        return fail(`the control did not run on the broken reader that ${what}: ${out.detail}`);
    }
    return pass('a reader that wraps the send or writes to the channel gains nothing');
  },
  'sut-env-not-trusted-in-reader-process': async (ctx) => {
    const missing = await companion(ctx);
    if (missing) return missing;
    const out = await probe(PLANTS.env, { name: 'sandbox-cut', expect: MARKER_PLANTED });
    return out.pass
      ? pass('a reader that set the environment at load changed neither process it ran in')
      : fail(`a reader that set DRIFTBENCH_POINTER_SUT at load changed which reader ran: ${out.detail}`);
  },
  'reader-imports-no-bank': async (ctx) => {
    const missing = await companion(ctx);
    if (missing) return missing;
    const found = importsOfValidators(READER_DIR);
    return found.length === 0
      ? pass('no source of the reader names the validators')
      : fail(`the reader names the validators in ${found.length} place(s): ${found.slice(0, 3).join('; ')}`);
  },
};

export const HARDENING_RUNS: Record<string, Record<string, Run>> = {
  adversarial,
  cutting,
  ids: { ...ids, ...carryRuns },
  're-anchoring': reanchoring,
  privacy,
  radius,
  grouping: { ...grouping, ...grouping2 },
  labels: { ...labels, ...decisions },
};
