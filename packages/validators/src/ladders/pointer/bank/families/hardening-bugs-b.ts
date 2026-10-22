import { cloneWorld, filesOf, worldOf } from '../../kit/anchor-world';
import { type Block, compose } from '../../kit/compose';
import { build, liveByText, liveOf, scanOk } from '../../kit/estate';
import { RUNS } from '../../kit/fixture';
import { constant, perfect, recording } from '../../kit/labellers';
import { requireSourceWitness } from '../../kit/positive';
import { keyOf, RULES_YAML } from '../../kit/sets';
import { fakeTransport, haikuResponse } from '../../kit/transport';
import { headingText, longMake, Prose, rewordWords, word } from '../../kit/words';
import type {
  Labeler,
  LedgerEntry,
  LedgerView,
  ManifestChange,
  RerunApi,
  ScanResult,
  SourceFile,
} from '../../sut/port';
import { fail, type ItemContext, missing, Problem, pass, type Run } from '../types';

/**
 * The runners of `specs/hardening-bugs-b.ts`: items for the planted bugs of the round 3 audit (seat 4) in the
 * blast radius, the atom builder, the dense labeler and the scan. Each oracle is what the reader does on a case
 * the planted bug changes; test/pointer/cr2-bugs-bugsB.test.ts shows each item red on its bug.
 */

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const para = (text: string): Block => ({ kind: 'paragraph', sentences: [text] });
const heading = (text: string): Block => ({ kind: 'heading', level: 1, text });
const fileOf = (path: string, blocks: Block[]): SourceFile => ({ path, text: compose(blocks).text });
const SET = 'agent-rules';

/** `count` heading texts drawn from the seed, no two alike, so each heading names its own section. */
function headings(p: Prose, count: number): string[] {
  const out: string[] = [];
  for (let tries = 0; out.length < count && tries < count * 40; tries++) {
    const text = headingText(p.random);
    if (!out.includes(text)) out.push(text);
  }
  if (out.length < count) throw new Problem(`the seed drew fewer than ${count} distinct headings`);
  return out;
}

function idOf(ledger: LedgerView, text: string): string {
  const entry = liveByText(ledger, text);
  if (!entry) throw new Problem(`positive witness: the ledger has no live entry for ${JSON.stringify(text)}`);
  return entry.id;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/* ----- radius ----- */

function rerunApi(ctx: ItemContext): RerunApi {
  const api = ctx.sut.rerun;
  if (!api)
    throw new Problem(
      'the reader exports no rerun rule: it must say, for each unit between two ledgers, whether it is unchanged, context, moved, changed, deleted or new, and which old units rerun',
      'missing-observation',
    );
  return api;
}

function manifestApi(ctx: ItemContext): NonNullable<RerunApi['manifest']> {
  const api = rerunApi(ctx);
  if (!api.manifest)
    throw new Problem(
      'the reader exports no change manifest: it must turn the rerun set of an edit into prompt changes of the atoms on the units and unit changes',
      'missing-observation',
    );
  return api.manifest.bind(api);
}

/** Two scans of one file: the world, then the world after `edit`. */
async function twoScans(
  ctx: ItemContext,
  perFile: number,
  edit: (texts: string[], p: Prose) => void,
): Promise<{
  texts: string[];
  first: ScanResult & { ledger: LedgerView };
  second: ScanResult & { ledger: LedgerView };
}> {
  const p = prose(ctx);
  const w = worldOf(p, { files: 1, perFile });
  const first = await scanOk(ctx.sut, { files: build(filesOf(w)).files, labeler: perfect() });
  const v2 = cloneWorld(w);
  edit(v2.texts[0] as string[], p);
  const second = await scanOk(ctx.sut, {
    files: build(filesOf(v2)).files,
    previousLedger: first.ledger.raw,
    labeler: perfect(),
  });
  return { texts: w.texts[0] as string[], first, second };
}

/** The live entries of a file in file order, read from their offsets. */
function inFileOrder(ledger: LedgerView, path: string): LedgerEntry[] {
  const entries = liveOf(ledger).filter((entry) => entry.path === path);
  if (entries.some((entry) => entry.hint === undefined))
    throw new Problem(
      'the ledger gives a live entry no offsets: the order of the units of a file is unknown',
    );
  return entries.sort((a, b) => (a.hint?.start ?? 0) - (b.hint?.start ?? 0));
}

/** A file the first ledger never held arrives with several units. */
async function newFileCase(ctx: ItemContext) {
  const api = rerunApi(ctx);
  const p = prose(ctx);
  const w = worldOf(p, { files: 2, perFile: 4 });
  const files = build(filesOf(w)).files;
  const kept = files.filter((file) => file.path === w.paths[0]);
  const first = await scanOk(ctx.sut, { files: kept, labeler: perfect() });
  const second = await scanOk(ctx.sut, { files, previousLedger: first.ledger.raw, labeler: perfect() });
  const fresh = inFileOrder(second.ledger, w.paths[1] as string);
  if (fresh.length < 2)
    throw new Problem(`positive witness: the new file holds ${fresh.length} units, expected 5`);
  const out = await api.rerun(first.ledger, second.ledger);
  return { path: w.paths[1] as string, fresh, out };
}

const radius: Record<string, Run> = {
  'new-file-reruns-whole-suite': async (ctx) => {
    const { path, out } = await newFileCase(ctx);
    if (out.whole === null)
      return fail(
        `units of ${path}, a file the old ledger did not hold, rerun ${out.units.length} units and not the whole suite`,
      );
    return out.whole.includes(path)
      ? pass('a new unit in a file the ledger did not hold reruns the whole suite')
      : fail(`the whole suite reruns for a reason that does not name the new file ${path}: ${out.whole}`);
  },
  'whole-reason-names-first-new-unit': async (ctx) => {
    const { path, fresh, out } = await newFileCase(ctx);
    if (out.whole === null) return fail(`a new file ${path} does not rerun the whole suite`);
    const head = fresh[0] as LedgerEntry;
    const others = fresh.slice(1).filter((entry) => out.whole?.includes(entry.id));
    if (others.length > 0)
      return fail(
        `the reason names ${others.map((entry) => entry.id).join(', ')}, a later unit of ${path}; it must name the first new unit ${head.id}`,
      );
    return out.whole.includes(head.id)
      ? pass('the reason names the first new unit of the new file')
      : fail(`the reason ${JSON.stringify(out.whole)} does not name the first new unit ${head.id}`);
  },
  'deleted-before-not-deleted-again': async (ctx) => {
    const api = rerunApi(ctx);
    const p = prose(ctx);
    const w = worldOf(p, { files: 1, perFile: 8 });
    const texts = w.texts[0] as string[];
    const first = await scanOk(ctx.sut, { files: build(filesOf(w)).files, labeler: perfect() });
    const gone = idOf(first.ledger, texts[2] as string);
    const v2 = cloneWorld(w);
    (v2.texts[0] as string[]).splice(2, 1);
    const second = await scanOk(ctx.sut, {
      files: build(filesOf(v2)).files,
      previousLedger: first.ledger.raw,
      labeler: perfect(),
    });
    const v3 = cloneWorld(v2);
    const edited = (v3.texts[0] as string[])[4] as string;
    (v3.texts[0] as string[])[4] = rewordWords(p.random, edited, 1);
    const third = await scanOk(ctx.sut, {
      files: build(filesOf(v3)).files,
      previousLedger: second.ledger.raw,
      labeler: perfect(),
    });
    const changed = idOf(second.ledger, edited);
    if (idOf(third.ledger, (v3.texts[0] as string[])[4] as string) !== changed)
      return fail('positive witness: the reworded unit did not keep its id');
    const classes = await api.classify(second.ledger, third.ledger);
    const again = classes.find((change) => change.id === gone);
    if (again)
      return fail(
        `the unit deleted by the earlier edit is classed ${again.class} by the next one: only a unit live before an edit can be deleted by it`,
      );
    if (classes.find((change) => change.id === changed)?.class !== 'changed')
      return fail('positive witness: the reworded unit is not classed changed');
    const out = await api.rerun(second.ledger, third.ledger);
    return sameSet(out.units, [changed]) && out.whole === null
      ? pass('only the reworded unit reruns; the unit deleted before is not deleted again')
      : fail(`the rerun set is ${JSON.stringify(out.units)}, expected only the reworded unit ${changed}`);
  },
  'new-unit-reruns-its-own-section': async (ctx) => {
    const api = rerunApi(ctx);
    const p = prose(ctx);
    const [ha, hb] = headings(p, 2) as [string, string];
    const [a1, a2, a3, b1, b2, b3, added] = p.many(7, longMake);
    const blocks = (extra: string[]) => [
      heading(ha),
      ...[a1, a2, a3, ...extra].map((text) => para(text as string)),
      heading(hb),
      ...[b1, b2, b3].map((text) => para(text as string)),
    ];
    const before = [fileOf('notes/sections.md', blocks([]))];
    const first = await scanOk(ctx.sut, { files: before, labeler: perfect() });
    const after = [fileOf('notes/sections.md', blocks([added as string]))];
    const second = await scanOk(ctx.sut, {
      files: after,
      previousLedger: first.ledger.raw,
      labeler: perfect(),
    });
    const want = [a1, a2, a3].map((text) => idOf(first.ledger, text as string));
    const out = await api.rerun(first.ledger, second.ledger);
    if (out.whole !== null)
      return fail(`a unit added under an old heading reruns the whole suite: ${out.whole}`);
    return sameSet(out.units, want)
      ? pass('a unit added under a heading reruns the old units under that heading, and no others')
      : fail(
          `the rerun set holds ${out.units.length} units, expected the ${want.length} old units under the heading of the new unit`,
        );
  },
  'new-unit-under-empty-heading-falls-back': async (ctx) => {
    const api = rerunApi(ctx);
    const p = prose(ctx);
    const [ha, hc, hf] = headings(p, 3) as [string, string, string];
    const [a1, a2, f1, f2, added] = p.many(5, longMake);
    const main = (extra: string[]) =>
      fileOf('notes/main.md', [
        heading(ha),
        para(a1 as string),
        para(a2 as string),
        heading(hc),
        ...extra.map((text) => para(text)),
      ]);
    const other = fileOf('notes/other.md', [heading(hf), para(f1 as string), para(f2 as string)]);
    const first = await scanOk(ctx.sut, { files: [main([]), other], labeler: perfect() });
    const second = await scanOk(ctx.sut, {
      files: [main([added as string]), other],
      previousLedger: first.ledger.raw,
      labeler: perfect(),
    });
    const want = liveOf(first.ledger)
      .filter((entry) => entry.path === 'notes/main.md')
      .map((entry) => entry.id);
    if (want.length < 4)
      return fail(`positive witness: the first scan holds ${want.length} units of the file, expected 4`);
    const out = await api.rerun(first.ledger, second.ledger);
    if (out.whole !== null) return fail(`a unit added to an old file reruns the whole suite: ${out.whole}`);
    return sameSet(out.units, want)
      ? pass('a unit under a heading that holds no old unit falls back to every old unit of its file')
      : fail(
          `the rerun set holds ${out.units.length} units, expected the ${want.length} old units of the file: the heading of the new unit holds none, so the search goes on to the file`,
        );
  },
  'manifest-condition-unit-reruns-its-atom': async (ctx) => {
    const manifest = manifestApi(ctx);
    const r = new Prose(ctx.seed, `${ctx.id}:atoms`).random;
    const [withCondition, other] = [`instruction.${word(r)}-1`, `instruction.${word(r)}-2`];
    const { texts, first, second } = await twoScans(ctx, 8, (edited, p) => {
      edited[4] = rewordWords(p.random, edited[4] as string, 1);
    });
    const atoms = [
      {
        id: withCondition,
        unit: idOf(first.ledger, texts[1] as string),
        condition: [idOf(first.ledger, texts[4] as string)],
      },
      { id: other, unit: idOf(first.ledger, texts[6] as string) },
    ];
    const got = await manifest(first.ledger, second.ledger, atoms);
    const want: ManifestChange[] = [{ kind: 'prompt', id: withCondition }];
    const shown = JSON.stringify(
      got.map((change) => ({ kind: change.kind, id: change.id, global: change.global })),
    );
    return JSON.stringify(got.map((change) => [change.kind, change.id, change.global === true])) ===
      JSON.stringify(want.map((change) => [change.kind, change.id, false]))
      ? pass('an edit of a condition unit reruns the atom the condition belongs to')
      : fail(
          `the manifest is ${shown}, expected only the prompt change of ${withCondition}: the edited unit is a condition of that atom`,
        );
  },
  'manifest-unit-changes-in-id-order': async (ctx) => {
    const manifest = manifestApi(ctx);
    const p = prose(ctx);
    const w = worldOf(p, { files: 1, perFile: 12 });
    const texts = w.texts[0] as string[];
    const first = await scanOk(ctx.sut, { files: build(filesOf(w)).files, labeler: perfect() });
    const ids = texts.map((text) => idOf(first.ledger, text));
    // Two units apart in the file whose ids run the other way, so the file order is not the id order.
    let pair: [number, number] | undefined;
    for (let i = 0; i < ids.length && !pair; i++)
      for (let j = i + 2; j < ids.length && !pair; j++)
        if ((ids[i] as string).localeCompare(ids[j] as string) > 0) pair = [i, j];
    if (!pair) throw new Problem('the seed drew twelve ids in file order: no two units separate the orders');
    const v2 = cloneWorld(w);
    for (const at of pair) (v2.texts[0] as string[])[at] = rewordWords(p.random, texts[at] as string, 1);
    const second = await scanOk(ctx.sut, {
      files: build(filesOf(v2)).files,
      previousLedger: first.ledger.raw,
      labeler: perfect(),
    });
    const edited = pair.map((at) => ids[at] as string);
    const want = [...edited].sort((a, b) => a.localeCompare(b));
    const got = await manifest(first.ledger, second.ledger, []);
    if (got.some((change) => change.kind !== 'unit'))
      return fail(
        `the manifest holds ${JSON.stringify(got)}, expected unit changes only: no atom sits on the units`,
      );
    const order = got.map((change) => change.id ?? '');
    return JSON.stringify(order) === JSON.stringify(want)
      ? pass('the unit changes of the manifest come in id order')
      : fail(
          `the unit changes come as ${JSON.stringify(order)}, expected ${JSON.stringify(want)} (id order)`,
        );
  },
};

/* ----- grouping (the atom builder) ----- */

/** The title rule of docs section 6: no marks, white space collapsed, at most 90 characters with an ellipsis. */
function titleFor(text: string): string {
  const flat = text
    .replace(/[*`]/g, '')
    .replace(/^\s*(?:[-+]|\d+[.)]|#+|>)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length <= 90 ? flat : `${flat.slice(0, 89).trimEnd()}…`;
}

const atomOn = (result: ScanResult, id: string) => result.atoms.filter((atom) => atom.fields.unit === id);
/** The diagnostics about a unit, by the fields that hold a unit id: the unit, the target it points at, the unit it repeats. */
const naming = (result: ScanResult, id: string) =>
  result.diagnostics.filter((d) => d.unit === id || d.target === id || d.repeats === id);

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

const LINK_YAML = `labels:
  - set: agent-rules
    description: What an instruction file asks of the agent.
    links:
      - name: topic
        description: The instruction the unit is about.
        to: [instruction]
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        links: [topic]
        atom: { kind: instruction, polarity: obligation }
`;

const TEMPLATE_YAML = `labels:
  - set: agent-rules
    description: What an instruction file asks of the agent.
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation, situation: "Before \${code} runs" }
`;

const WHEN_FILE_YAML = `labels:
  - set: agent-rules
    description: What an instruction file asks of the agent.
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: points
        description: A unit that sends the reader to a file.
        atom: { kind: reference, whenFile: true }
`;

/** A sentence that holds one inline code span, drawn from the seed. */
function codeSentence(p: Prose, code: string): string {
  const r = p.random;
  return `${word(r).replace(/^./, (c) => c.toUpperCase())} the \`${code}\` step before the ${word(r)} ${word(r)} closes.`;
}

const grouping: Record<string, Run> = {
  'title-ninety-characters': async (ctx) => {
    const p = prose(ctx);
    const long = p.next(longMake);
    let short = p.next();
    for (let tries = 0; short.length > 80 && tries < 20; tries++) short = p.next();
    if (short.length > 80) throw new Problem('the seed drew no sentence of 80 characters or fewer');
    const files = [fileOf('notes/titles.md', [para(long), para(short)])];
    const result = await scanOk(ctx.sut, { files, labeler: constant('rule'), labelsYaml: RULES_YAML });
    requireSourceWitness(result, files);
    for (const text of [long, short]) {
      const [atom] = atomOn(result, idOf(result.ledger, text));
      if (!atom) return fail(`positive witness: the unit ${JSON.stringify(text.slice(0, 30))} built no atom`);
      if (atom.title === undefined)
        return missing(
          'the reader does not expose the title of an atom: the title is part of the atom it builds',
        );
      const want = titleFor(text);
      if (atom.title !== want)
        return fail(
          `the title of a unit of ${text.length} characters is ${JSON.stringify(atom.title)} (${atom.title.length} characters), expected ${JSON.stringify(want)} (${want.length})`,
        );
    }
    return pass(
      'a long unit gives a title of at most 90 characters ending with an ellipsis; a short one its own text',
    );
  },
  'orphan-condition-refused': async (ctx) => {
    const p = prose(ctx);
    const [rule, condition] = p.many(2, longMake) as [string, string];
    const files = [
      fileOf('notes/when.md', [{ kind: 'paragraph', sentences: [rule, rule] }, para(condition)]),
    ];
    const labeler: Labeler = (request) => {
      const twins = request.window.units.filter((unit) => keyOf(unit.text) === keyOf(rule));
      const target = twins[1]?.n;
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
    const twins = liveOf(result.ledger).filter((entry) => keyOf(entry.quote) === keyOf(rule));
    if (twins.length !== 2)
      return fail(`positive witness: ${twins.length} live entries hold the repeated rule, expected 2`);
    const conditionId = idOf(result.ledger, condition);
    if (result.ledger.entries.find((entry) => entry.id === conditionId)?.labels[SET]?.label !== 'when')
      return fail('positive witness: the condition unit does not hold the label when');
    const instructions = result.atoms.filter((atom) => atom.kind === 'instruction');
    if (instructions.length !== 1)
      return fail(
        `${instructions.length} instruction atoms for a rule written twice on one line, expected one`,
      );
    const second = twins.sort((a, b) => (a.hint?.start ?? 0) - (b.hint?.start ?? 0))[1] as LedgerEntry;
    if (
      !result.diagnostics.some(
        (d) => d.code === 'duplicate' && d.reason === 'atom-duplicate' && d.unit === second.id,
      )
    )
      return fail('positive witness: the repeat of the rule is not reported as a duplicate');
    if (instructions[0]?.situation !== undefined)
      return fail('the atom of the first rule takes the situation of a condition that points at its repeat');
    return result.diagnostics.some(
      (d) => d.reason === 'condition-unattached' && d.unit === conditionId && d.target === second.id,
    )
      ? pass('a condition whose target built no atom is reported')
      : fail(
          `nothing reports the condition ${conditionId}: its target repeats an atom and holds none, so the condition sets no situation and must say so`,
        );
  },
  'none-link-builds-no-refusal': async (ctx) => {
    const p = prose(ctx);
    const texts = p.many(3, longMake);
    const files = [fileOf('notes/links.md', texts.map(para))];
    let linked: number | undefined;
    const labeler: Labeler = (request) => {
      const units = request.window.units.filter((unit) => unit.mode === 'label');
      linked = units[0]?.n;
      const labels = units.map((unit, at) =>
        at === 0
          ? { units: String(unit.n), label: 'rule', links: [{ kind: 'topic', to: 'none' }] }
          : { units: String(unit.n), label: 'rule' },
      );
      return { raw: JSON.stringify({ labels }) };
    };
    const result = await scanOk(ctx.sut, { files, labeler, labelsYaml: LINK_YAML });
    requireSourceWitness(result, files);
    if (linked === undefined) return fail('positive witness: the labeller was never asked');
    const id = idOf(result.ledger, texts[0] as string);
    const missing = texts.filter((text) => atomOn(result, idOf(result.ledger, text)).length !== 1);
    if (missing.length > 0)
      return fail(
        `${missing.length} of ${texts.length} rules built no atom: the answer with a link to none must stand`,
      );
    const said = naming(result, id);
    return said.length === 0
      ? pass('a link to none names nothing: the atom stands and nothing is refused')
      : fail(`a link to none is reported: ${said[0]?.detail.slice(0, 120)}`);
  },
  'template-placeholder-unfilled-refused': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const code = `${word(r)}-${word(r)}`;
    const withCode = codeSentence(p, code);
    const without = p.next(longMake);
    const files = [fileOf('notes/template.md', [para(withCode), para(without)])];
    const result = await scanOk(ctx.sut, { files, labeler: constant('rule'), labelsYaml: TEMPLATE_YAML });
    requireSourceWitness(result, files);
    const [filled] = atomOn(result, idOf(result.ledger, withCode));
    if (!filled) return fail('positive witness: the unit with a code span built no atom');
    if (filled.situation !== `Before ${code} runs`)
      return fail(
        `the situation is ${JSON.stringify(filled.situation)}, expected "Before ${code} runs" from the template`,
      );
    const bare = idOf(result.ledger, without);
    const built = atomOn(result, bare);
    if (built.length > 0)
      return fail(
        `a unit with no code span built an atom whose situation is ${JSON.stringify(built[0]?.situation)}: a placeholder the unit does not fill refuses the atom`,
      );
    return naming(result, bare).some((d) => d.reason === 'template-unfilled' && d.unit === bare)
      ? pass('a template filled by the unit builds; one the unit cannot fill refuses the atom and says why')
      : fail('the unit whose template stays unfilled built nothing and nothing says why');
  },
  'when-file-needs-a-file': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const target = `docs/${word(r)}-${word(r)}.md`;
    const pointing = codeSentence(p, target);
    const rule = p.next(longMake);
    const files = [fileOf('notes/points.md', [para(pointing), para(rule)])];
    const labeler: Labeler = (request) => ({
      labels: request.window.units
        .filter((unit) => unit.mode === 'label')
        .map((unit) => ({
          units: String(unit.n),
          label: keyOf(unit.text) === keyOf(pointing) ? 'points' : 'rule',
        })),
    });
    const result = await scanOk(ctx.sut, { files, labeler, labelsYaml: WHEN_FILE_YAML });
    requireSourceWitness(result, files);
    const id = idOf(result.ledger, pointing);
    if (result.ledger.entries.find((entry) => entry.id === id)?.labels[SET]?.label !== 'points')
      return fail('positive witness: the unit with the code span does not hold the label points');
    if (atomOn(result, idOf(result.ledger, rule)).length !== 1)
      return fail('positive witness: the rule beside it built no atom');
    const built = result.atoms.filter((atom) => atom.kind === 'reference');
    if (built.length > 0)
      return fail(
        `a whenFile mapping built ${built.length} atom(s) for a code span naming ${target}, which is no file of the estate`,
      );
    return naming(result, id).length === 0
      ? pass(
          'a whenFile mapping whose code span names no file of the estate builds nothing and reports nothing',
        )
      : fail(
          `a whenFile mapping that does not apply is reported: ${naming(result, id)[0]?.detail.slice(0, 100)}`,
        );
  },
};

/* ----- labels (the scan and the dense labeler) ----- */

const systemOf = (body: string): { system: string; messages: string } => {
  const parsed = JSON.parse(body) as { system?: unknown; messages?: unknown };
  return { system: String(parsed.system ?? ''), messages: JSON.stringify(parsed.messages ?? null) };
};

/** Atoms of two kinds handed to the scan, in an order that is not the id order of either kind. */
function seededAtoms(p: Prose) {
  const r = p.random;
  const make = (kind: string, n: number) => ({ id: `${kind}.${word(r)}-${n}`, kind, title: p.next() });
  const wanted = [1, 2, 3, 4].map((n) => make('instruction', n));
  const others = [1, 2, 3].map((n) => make('hazard', n));
  const sorted = [...wanted].sort((a, b) => a.id.localeCompare(b.id));
  const given = [
    sorted[2],
    others[0],
    sorted[0],
    others[1],
    sorted[3],
    others[2],
    sorted[1],
  ] as typeof wanted;
  return { wanted, others, given };
}

async function candidatesCase(ctx: ItemContext) {
  const p = prose(ctx);
  const texts = p.many(4, longMake);
  const { wanted, others, given } = seededAtoms(p);
  const fake = fakeTransport({ truth: () => 'none' });
  const result = await ctx.sut.scan({
    files: [fileOf('notes/topics.md', texts.map(para))],
    model: { arm: 'haiku', transport: fake },
    cassette: { mode: 'record' },
    labelsYaml: LINK_YAML,
    atoms: given,
  });
  if (!result.ok) throw new Problem(`the scan failed: ${result.error}`);
  if (fake.count === 0) throw new Problem('positive witness: no request reached the model');
  return { wanted, others, bodies: fake.calls.map((call) => call.body) };
}

const labels: Record<string, Run> = {
  'haiku-retry-says-why': async (ctx) => {
    const p = prose(ctx);
    const texts = p.many(6, longMake);
    const unreadable = `The ${word(p.random)} window has no answer.`;
    const fake = fakeTransport({ respond: (index) => (index === 0 ? haikuResponse(unreadable) : undefined) });
    const result = await ctx.sut.scan({
      files: [fileOf('notes/retry.md', texts.map(para))],
      model: { arm: 'haiku', transport: fake },
      cassette: { mode: 'record' },
      labelsYaml: RULES_YAML,
    });
    if (!result.ok) return fail(`the scan failed: ${result.error}`);
    if (fake.count !== RUNS.haiku + 1)
      return fail(
        `${fake.count} calls, expected ${RUNS.haiku + 1}: an answer that is no JSON is asked once more, then the other runs ask once each`,
      );
    const [first, retry, next] = fake.calls.map((call) => systemOf(call.body));
    if (!first || !retry || !next) return fail('positive witness: fewer than three requests were kept');
    if (retry.messages !== first.messages)
      return fail('the retried request shows other units than the first');
    if (next.system !== first.system)
      return fail('a run asked after the retry carries the retry note: the note is for the retry alone');
    return retry.system.startsWith(first.system) && retry.system.length > first.system.length
      ? pass('the retried request adds a note after the system text; the other requests do not')
      : fail(
          'the retried request is the first one again: it must say, after the system text, that the answer could not be read',
        );
  },
  'carried-window-not-asked-again': async (ctx) => {
    const p = prose(ctx);
    const [ha, hb] = headings(p, 2) as [string, string];
    const [a1, a2, a3, b1, b2, b3] = p.many(6, longMake) as string[];
    const doc = (last: string) =>
      fileOf('notes/two.md', [
        heading(ha),
        ...[a1, a2, a3].map((text) => para(text as string)),
        heading(hb),
        ...[b1, b2, last].map((text) => para(text as string)),
      ]);
    const asked = recording(perfect());
    const first = await scanOk(ctx.sut, { files: [doc(b3 as string)], labeler: asked });
    if (asked.calls.length !== 2)
      return fail(
        `positive witness: the first scan asked ${asked.calls.length} windows, expected 2 (one per top-level heading)`,
      );
    const reworded = rewordWords(p.random, b3 as string, 1);
    const again = recording(perfect());
    await scanOk(ctx.sut, { files: [doc(reworded)], previousLedger: first.ledger.raw, labeler: again });
    const holds = (request: (typeof again.calls)[number], text: string) =>
      request.window.units.some((unit) => keyOf(unit.text) === keyOf(text));
    if (!again.calls.some((request) => holds(request, reworded)))
      return fail('positive witness: no request of the rescan holds the reworded unit');
    return again.calls.length === 1
      ? pass('the rescan asks only the window of the edit; the window whose labels carried is not sent')
      : fail(
          `the rescan sent ${again.calls.length} requests; the section with no edit kept every label and must not be asked again`,
        );
  },
  'link-candidates-of-its-kind': async (ctx) => {
    const { wanted, others, bodies } = await candidatesCase(ctx);
    for (const body of bodies) {
      const absent = wanted.find((atom) => !body.includes(atom.id));
      if (absent)
        return fail(`a request does not list ${absent.id}, an atom of the kind the link kind names`);
      const extra = others.find((atom) => body.includes(atom.id));
      if (extra) return fail(`a request lists ${extra.id}, an atom of a kind the link kind does not name`);
    }
    return pass('each request lists the atoms of the kind the link kind names, and no other');
  },
  'link-candidates-in-id-order': async (ctx) => {
    const { wanted, bodies } = await candidatesCase(ctx);
    const want = [...wanted].sort((a, b) => a.id.localeCompare(b.id)).map((atom) => atom.id);
    for (const body of bodies) {
      const absent = want.find((id) => !body.includes(id));
      if (absent) return fail(`a request does not list ${absent}`);
      const order = [...want].sort((a, b) => body.indexOf(a) - body.indexOf(b));
      if (JSON.stringify(order) !== JSON.stringify(want))
        return fail(
          `a request lists the candidates as ${order.join(', ')}, expected id order ${want.join(', ')}`,
        );
    }
    return pass('the candidates of a link kind come in id order');
  },
};

export const HARDENING_BUGS_B_RUNS: Record<string, Record<string, Run>> = { radius, grouping, labels };
