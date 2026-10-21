import { fileURLToPath } from 'node:url';
import { anchorCase } from '../../kit/anchor-case';
import { allTexts, cloneWorld, filesOf, worldOf } from '../../kit/anchor-world';
import { runChild } from '../../kit/child-run';
import { type Block, compose } from '../../kit/compose';
import { cutRun } from '../../kit/cut-case';
import { build, byId, liveByText, liveOf, scanOk } from '../../kit/estate';
import { loadFixture, RUNS } from '../../kit/fixture';
import { entriesFor, perfect, truthLabel } from '../../kit/labellers';
import { requireSourceWitness } from '../../kit/positive';
import { keyOf, RULES_YAML } from '../../kit/sets';
import { fakeTransport } from '../../kit/transport';
import { headingText, longMake, Prose, rewordWords, word } from '../../kit/words';
import type { Labeler, LedgerView, ScanResult } from '../../sut/port';
import { runControl } from '../controls';
import { PLANTS, probe, readerGainedNothing } from '../harness-probe';
import { MARKER_PLANTED } from '../plants/broken';
import { importsOfValidators } from '../reader-imports';
import { fail, type ItemContext, type Outcome, Problem, pass, type Run } from '../types';

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
    return steps.every((scan, at) => at === 0 || scan > (steps[at - 1] as number))
      ? pass('the lineage grows by one true step per change, and not for a rescan')
      : fail(`the scan numbers of one lineage do not grow: ${JSON.stringify(steps)}`);
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

/* ----- re-anchoring ----- */

const reanchoring: Record<string, Run> = {
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
    const rows = structuredClone(fixture.rows).slice(1);
    for (const row of rows) row.answer.returnedModel = 'm-1';
    const res = await ctx.sut.scan({
      files: fixture.files,
      labelsYaml: fixture.labelsYaml,
      model: { arm: 'haiku', transport: fakeTransport({ model: 'm-2' }) },
      cassette: {
        mode: 'record',
        text: rows
          .map((row) => JSON.stringify(row))
          .concat('')
          .join('\n'),
      },
    });
    if (!res.ok) return fail(`the re-record failed: ${res.error}`);
    if (!Array.isArray(res.warnings))
      return fail(
        'the reader does not expose warnings: a returned model that differs from the cassette must be reported as a warning that names both models',
      );
    const named = res.warnings.filter((w) => w.includes('m-1') && w.includes('m-2'));
    if (named.length === 0)
      return fail(`no warning names both models; the warnings are ${JSON.stringify(res.warnings)}`);
    const units = fixture.documents.flatMap((d) => d.units.map((u) => u.text.replace(/\s+/g, ' ').trim()));
    const quoted = res.warnings.find((w) => units.some((u) => u.length >= 20 && w.includes(u.slice(0, 20))));
    return quoted
      ? fail(`a warning quotes unit text: ${quoted.slice(0, 60)}`)
      : pass('the warning names both models and no unit text');
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
      );
    for (const key of ['labeler', 'pass_at', 'fail_at', 'margin_cut']) {
      for (const bad of [1.5, 2, -0.1, 100]) {
        const out = await api.parse(`threshold: { ${key}: ${bad} }\n`);
        if (out.ok)
          return fail(`the threshold ${key}: ${bad} was accepted; a threshold is a number from 0 to 1`);
        if (!out.errors.some((error) => error.includes(key)))
          return fail(`the refusal of ${key}: ${bad} does not name the key: ${JSON.stringify(out.errors)}`);
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
  'settings-inherited-threshold-key-refused': async (ctx) => {
    const api = ctx.sut.settings;
    if (!api)
      throw new Problem(
        'the reader exports no settings reader: it must refuse a threshold key that is not one of the four, and name it',
      );
    // Names every object has by inheritance: a lookup in a table of the four keys must not find them.
    for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const out = await api.parse(`threshold: { ${key}: 0.5 }\n`);
      if (out.ok) return fail(`the threshold key ${key} was accepted; only the four keys of the file are thresholds`);
      if (!out.errors.some((error) => error.includes(key)))
        return fail(`the refusal of ${key} does not name the key: ${JSON.stringify(out.errors)}`);
    }
    const own = await api.parse('threshold: { labeler: 0.5 }\n');
    if (!own.ok) return fail(`the threshold labeler: 0.5 was refused: ${own.errors.join('; ')}`);
    return pass('constructor, toString, hasOwnProperty and valueOf refused by name; a real key still accepted');
  },
};

/* ----- adversarial: the reader and the verdict ----- */

/** The folder of the reader: `packages/estate/src/pointer`, seen from this file. */
const READER_DIR = fileURLToPath(new URL('../../../../../../estate/src/pointer', import.meta.url));

/**
 * The companion positive control of the three items below. They test the harness, which a reader that does nothing
 * leaves as it is; so that such a reader earns no credit, the reader under test must first cut the control sentence.
 */
async function companion(ctx: ItemContext): Promise<Outcome | undefined> {
  const out = await runControl({ name: 'verdict' }, ctx.sut);
  return out.pass
    ? undefined
    : fail(
        `the reader under test does not cut the control sentence, so the item has no positive control: ${out.detail}`,
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
  ids,
  're-anchoring': reanchoring,
  privacy,
  radius,
  grouping: { ...grouping, ...grouping2 },
  labels,
};
