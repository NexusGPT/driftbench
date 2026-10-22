import { distinctSentences } from '../../kit/anchor-world';
import { type Block, compose } from '../../kit/compose';
import { liveByText, scanOk } from '../../kit/estate';
import { type Recording, recording } from '../../kit/labellers';
import { show } from '../../kit/oracle';
import { keyOf, numberOf, PROBE_YAML, RULES_YAML } from '../../kit/sets';
import { type FakeTransport, fakeTransport, haikuResponse, type ParsedCall } from '../../kit/transport';
import { Prose, type Rng, word } from '../../kit/words';
import type {
  Diagnostic,
  FetchResponse,
  LabelRequest,
  LedgerView,
  ScanArm,
  ScanRequest,
  ScanResult,
  SourceFile,
} from '../../sut/port';
import { fail, type ItemContext, type Outcome, Problem, pass, type Run } from '../types';

/**
 * The runners of `specs/hardening-bugs-c.ts`: answer validation, spans, links, runs, carry, the system 1
 * clients and the settings file. Each item is red on one planted bug of round 3, seat 4, and green on the
 * reader without it.
 */

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const para = (text: string): Block => ({ kind: 'paragraph', sentences: [text] });
const docOf = (texts: readonly string[]): SourceFile[] => [
  { path: 'doc.md', text: compose(texts.map(para)).text },
];
const labelOf = (ledger: LedgerView, text: string, set: string): string | undefined =>
  liveByText(ledger, text)?.labels[set]?.label;
/** A whole number from `lo` to `hi`, both included. */
const between = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
/** The items of a list in an order drawn from the seed. */
function shuffled<T>(r: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
/** `count` distinct lower-case nouns drawn from the seed. */
function nouns(r: Rng, count: number): string[] {
  const out: string[] = [];
  for (let tries = 0; out.length < count && tries < 400; tries += 1) {
    const candidate = word(r);
    if (out.every((other) => !other.includes(candidate) && !candidate.includes(other))) out.push(candidate);
  }
  if (out.length < count) throw new Problem('could not draw distinct nouns');
  return out;
}

/** The three labels of the `probe` set, in set order. */
const PROBE = ['rule', 'prohibition', 'example'] as const;
const PROBE_NAMES: readonly string[] = PROBE;
/** The labels of `agent-rules` that need no target. */
const PLAIN = ['rule', 'prohibition', 'example', 'description'] as const;

/** The names a reader's diagnostic carries besides its cause: the fields an item asks a cause to hold. */
type Names = Partial<Omit<Diagnostic, 'code' | 'reason' | 'detail'>>;

/**
 * Whether a diagnostic gives the cause: its stable `reason` and each of the names asked for, as the fields of the
 * diagnostic. The words of its `detail` are never read.
 */
const gave = (res: ScanResult, reason: string, names: Names = {}): boolean =>
  res.diagnostics.some(
    (d) => d.reason === reason && Object.entries(names).every(([key, value]) => d[key as keyof Names] === value),
  );
/** A cause an item expects of a refusal: the `reason` and the names it carries. */
type Cause = { reason: string; names: Names };
/** The codes a reader gives an entry or a window it refused: a refusal, or a window that failed. */
const REFUSED = new Set(['refusal', 'failed-window', 'window_failed']);
const refused = (res: ScanResult): boolean => res.diagnostics.some((d) => REFUSED.has(d.code));
const details = (res: ScanResult): string =>
  JSON.stringify(res.diagnostics.slice(0, 3).map((d) => d.detail.slice(0, 120)));

/** The number of a unit in the window a planted labeller is shown; the item fails without it. */
function nOf(request: LabelRequest, text: string): number {
  const n = numberOf(request, text);
  if (n === undefined) throw new Problem(`the window does not show ${show(text, 30)}`);
  return n;
}

type RawEntry = {
  units: string;
  label: string;
  target?: number | null;
  spans?: unknown[];
  links?: unknown[];
};

/** A planted labeller that answers with raw text, as a model does: the entries, as one JSON object. */
const rawAnswer = (build: (request: LabelRequest) => RawEntry[]): Recording =>
  recording((request) => ({ raw: JSON.stringify({ labels: build(request) }) }));

/** Records a scan on a model arm over the fake transport. */
async function modelScan(
  ctx: ItemContext,
  files: SourceFile[],
  arm: ScanArm,
  transport: FakeTransport,
  extra: Partial<ScanRequest> = {},
): Promise<ScanResult> {
  return ctx.sut.scan({ files, model: { arm, transport }, cassette: { mode: 'record' }, ...extra });
}
const must = (res: ScanResult): ScanResult & { ledger: LedgerView } => {
  if (!res.ok || !res.ledger) throw new Problem(`the scan failed: ${res.error ?? 'no ledger'}`);
  return res as ScanResult & { ledger: LedgerView };
};

/* ----- ranges and units named twice ----- */

/** Ten units, each with a label of `probe` drawn from the seed. */
function probeUnits(ctx: ItemContext): { r: Rng; texts: string[]; own: Map<string, string> } {
  const p = prose(ctx);
  const r = p.random;
  const texts = distinctSentences(p, 10);
  const own = new Map(texts.map((t) => [t, PROBE[between(r, 0, 2)] as string]));
  return { r, texts, own };
}

const ranges: Record<string, Run> = {
  'refuse-descending-range-explicit': async (ctx) => {
    const { r, texts, own } = probeUnits(ctx);
    const start = between(r, 2, 5);
    const run = texts.slice(start, start + between(r, 2, 3));
    const label = PROBE[between(r, 0, 2)] as string;
    let named = '';
    const answer = (backwards: boolean) =>
      recording((request) => {
        const ns = run.map((t) => nOf(request, t));
        const lo = Math.min(...ns);
        const hi = Math.max(...ns);
        named = backwards ? `${hi}-${lo}` : `${lo}-${hi}`;
        const labels = texts
          .filter((t) => !run.includes(t))
          .map((t) => ({ units: String(nOf(request, t)), label: own.get(t) as string }));
        return { labels: [...labels, { units: named, label }] };
      });
    const files = docOf(texts);
    const back = await scanOk(ctx.sut, { files, labeler: answer(true), labelsYaml: PROBE_YAML });
    for (const t of run) {
      const got = labelOf(back.ledger, t, 'probe');
      if (got !== undefined)
        return fail(`${show(t, 30)} holds ${got} from ${named}: a range written backwards names no unit`);
    }
    if (!gave(back, 'units-malformed', { units: named }))
      return fail(`no refusal names the backwards range ${named}: it was passed over (${details(back)})`);
    const forth = await scanOk(ctx.sut, { files, labeler: answer(false), labelsYaml: PROBE_YAML });
    for (const t of run) {
      const got = labelOf(forth.ledger, t, 'probe');
      if (got !== label) return fail(`${show(t, 30)} holds ${got} from ${named}, expected ${label}`);
    }
    return pass(`the backwards range is refused by name; written forwards it labels ${run.length} units`);
  },
  'unit-named-twice-refused': async (ctx) => {
    const { r, texts, own } = probeUnits(ctx);
    const at = between(r, 2, 8);
    const twice = r() < 0.5 ? texts.slice(at, at + 2) : texts.slice(at, at + 1);
    const other = PROBE.find((name) => twice.every((t) => own.get(t) !== name)) as string;
    const answer = (again: boolean) =>
      recording((request) => {
        const labels = texts.map((t) => ({ units: String(nOf(request, t)), label: own.get(t) as string }));
        if (!again) return { labels };
        const ns = twice.map((t) => nOf(request, t));
        const units = ns.length === 1 ? String(ns[0]) : `${Math.min(...ns)}-${Math.max(...ns)}`;
        return { labels: [...labels, { units, label: other }] };
      });
    const files = docOf(texts);
    const dup = await scanOk(ctx.sut, { files, labeler: answer(true), labelsYaml: PROBE_YAML });
    for (const t of twice) {
      if (labelOf(dup.ledger, t, 'probe') === other)
        return fail(`${show(t, 30)} holds ${other} from a second entry: a labelled unit was named again`);
    }
    if (!refused(dup)) return fail('no refusal reports the entry that names a labelled unit again');
    const once = await scanOk(ctx.sut, { files, labeler: answer(false), labelsYaml: PROBE_YAML });
    const wrong = texts.find((t) => labelOf(once.ledger, t, 'probe') !== own.get(t));
    return wrong === undefined
      ? pass(`the second label of ${twice.length} unit(s) is refused; without it every unit keeps its label`)
      : fail(`${show(wrong, 30)} holds ${labelOf(once.ledger, wrong, 'probe')} without the second entry`);
  },
  'range-leaving-window-refused': async (ctx) => {
    const { r, texts, own } = probeUnits(ctx);
    const start = between(r, 4, 7);
    const tail = texts.slice(start);
    const over = between(r, 1, 3);
    const label = PROBE[between(r, 0, 2)] as string;
    let named = '';
    const answer = (past: boolean) =>
      recording((request) => {
        const last = Math.max(...request.window.units.map((u) => u.n));
        named = `${nOf(request, tail[0] as string)}-${last + (past ? over : 0)}`;
        const labels = texts
          .slice(0, start)
          .map((t) => ({ units: String(nOf(request, t)), label: own.get(t) as string }));
        return { labels: [...labels, { units: named, label }] };
      });
    const files = docOf(texts);
    const past = await scanOk(ctx.sut, { files, labeler: answer(true), labelsYaml: PROBE_YAML });
    for (const t of tail) {
      const got = labelOf(past.ledger, t, 'probe');
      if (got !== undefined)
        return fail(`${show(t, 30)} holds ${got} from the range ${named}, which runs past the window`);
    }
    if (!gave(past, 'units-leave-window', { units: named }))
      return fail(`no refusal names the range ${named} that leaves the window (${details(past)})`);
    const inside = await scanOk(ctx.sut, { files, labeler: answer(false), labelsYaml: PROBE_YAML });
    const wrong = tail.find((t) => labelOf(inside.ledger, t, 'probe') !== label);
    return wrong === undefined
      ? pass(`a range ${over} past the last unit is refused; ending at the last, it labels ${tail.length}`)
      : fail(`${show(wrong, 30)} holds ${labelOf(inside.ledger, wrong, 'probe')}, the range gave ${label}`);
  },
};

/* ----- dense answers: a null target, two fences ----- */

const dense: Record<string, Run> = {
  'null-target-is-no-target': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const texts = distinctSentences(p, 10);
    const own = new Map(texts.map((t) => [t, PLAIN[between(r, 0, 3)] as string]));
    const nulls = new Set(shuffled(r, texts).slice(0, 3));
    const gate = shuffled(r, texts)[0] as string;
    const files = docOf(texts);
    const first = await scanOk(ctx.sut, {
      files,
      labelsYaml: RULES_YAML,
      labeler: rawAnswer((request) =>
        texts.map((t) => ({
          units: String(nOf(request, t)),
          label: own.get(t) as string,
          ...(nulls.has(t) ? { target: null } : {}),
        })),
      ),
    });
    for (const t of texts) {
      const got = labelOf(first.ledger, t, 'agent-rules');
      const why = nulls.has(t) ? ': a target written as null is no target' : '';
      if (got !== own.get(t)) return fail(`${show(t, 30)} holds ${got}, expected ${own.get(t)}${why}`);
    }
    if (refused(first)) return fail(`an answer with null targets was refused: ${details(first)}`);
    const second = await scanOk(ctx.sut, {
      files,
      labelsYaml: RULES_YAML,
      labeler: rawAnswer((request) =>
        texts.map((t) =>
          t === gate
            ? { units: String(nOf(request, t)), label: 'gate', target: null }
            : { units: String(nOf(request, t)), label: own.get(t) as string },
        ),
      ),
    });
    if (labelOf(second.ledger, gate, 'agent-rules') === 'gate')
      return fail(`${show(gate, 30)} holds gate with a null target: a gate needs a target`);
    if (!gave(second, 'target-required', { label: 'gate' }))
      return fail(`no refusal says the gate with a null target needs a target (${details(second)})`);
    return pass('three null targets read as none, every label stands; a gate with a null target is refused');
  },
  'two-fences-no-answer': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const texts = distinctSentences(p, 8);
    const a = new Map(texts.map((t) => [t, PROBE[between(r, 0, 2)] as string]));
    const shift = (t: string) => PROBE[(PROBE_NAMES.indexOf(a.get(t) as string) + between(r, 1, 2)) % 3];
    const b = new Map(texts.map((t) => [t, shift(t)]));
    const fence = (request: LabelRequest, pick: Map<string, string | undefined>) => {
      const labels = texts.map((t) => ({ units: String(nOf(request, t)), label: pick.get(t) }));
      return `\`\`\`json\n${JSON.stringify({ labels })}\n\`\`\``;
    };
    const lead = `Labels of the ${word(r)} window follow.`;
    const files = docOf(texts);
    const two = await scanOk(ctx.sut, {
      files,
      labelsYaml: PROBE_YAML,
      labeler: recording((request) => ({
        raw: `${lead}\n${fence(request, a)}\nA second reading:\n${fence(request, b)}`,
      })),
    });
    for (const t of texts) {
      const got = labelOf(two.ledger, t, 'probe');
      if (got !== undefined)
        return fail(`${show(t, 30)} holds ${got} from an answer with two fenced objects: it holds no answer`);
    }
    if (!gave(two, 'answer-not-json'))
      return fail(`no failure says the answer is not JSON (${details(two)})`);
    const one = await scanOk(ctx.sut, {
      files,
      labelsYaml: PROBE_YAML,
      labeler: recording((request) => ({ raw: `${lead}\n${fence(request, a)}` })),
    });
    const wrong = texts.find((t) => labelOf(one.ledger, t, 'probe') !== a.get(t));
    return wrong === undefined
      ? pass('two fenced objects give no answer; one fenced object is read')
      : fail(`${show(wrong, 30)} holds ${labelOf(one.ledger, wrong, 'probe')}, not ${a.get(wrong)}`);
  },
};

/* ----- spans and links ----- */

/** A set whose `rule` carries `action` spans, `condition` spans within them, and `tool` links. */
const clauseSet = (values: readonly string[]): string => `labels:
  - set: clauses
    description: The clauses and the tools of instructions.
    spans:
      - name: action
        description: The clause that says what to do.
      - name: condition
        description: The clause that says when the action applies.
        within: action
    links:
      - name: tool
        description: The tool the unit asks for.
        values: [${values.join(', ')}]
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        spans: [action, condition]
        links: [tool]
      - name: note
        description: A unit that states how something is.
`;

/**
 * Scans prose with each unit of `extra` labelled `rule` with the extras given, every other unit `note`, and
 * returns the result and the label a unit holds. The answer comes from a planted labeller, or, with `model`,
 * from the `haiku` arm on the fake transport: a link names a candidate the request lists, and only a model
 * request lists them.
 */
async function clauseScan(
  ctx: ItemContext,
  texts: readonly string[],
  yaml: string,
  extra: ReadonlyMap<string, Partial<RawEntry>>,
  model = false,
): Promise<{ res: ScanResult & { ledger: LedgerView }; held: (text: string) => string | undefined }> {
  const entries = (n: (text: string) => number | undefined): RawEntry[] =>
    texts.map((t) => {
      const own = extra.get(t);
      const units = String(n(t));
      return own ? { units, label: 'rule', ...own } : { units, label: 'note' };
    });
  const files = docOf(texts);
  let res: ScanResult & { ledger: LedgerView };
  if (model) {
    const fake = fakeTransport({
      respond: (_index, call) => {
        const n = (t: string) => call.units.find((u) => keyOf(u.text) === keyOf(t))?.n;
        return haikuResponse(JSON.stringify({ window: call.window, set: call.set, labels: entries(n) }));
      },
    });
    res = must(await modelScan(ctx, files, 'haiku', fake, { labelsYaml: yaml }));
  } else {
    const labeler = rawAnswer((request) => entries((t) => nOf(request, t)));
    res = await scanOk(ctx.sut, { files, labelsYaml: yaml, labeler });
  }
  return { res, held: (text) => labelOf(res.ledger, text, 'clauses') };
}

/** Prose with one unit put in at a place drawn from the seed. */
function withUnit(ctx: ItemContext, unit: string): { texts: string[]; r: Rng } {
  const p = new Prose(ctx.seed, `${ctx.id}:around`);
  const r = p.random;
  const texts = distinctSentences(p, 5);
  texts.splice(between(r, 0, texts.length), 0, unit);
  return { texts, r };
}

/** The offsets of the spaces of a text: the word boundaries an offset span may use. */
const spaces = (text: string): number[] => [...text.matchAll(/ /g)].map((m) => m.index as number);

/** Checks a pair of clause scans: the first must refuse the unit with the reason, the second must take it. */
function refusedThenTaken(
  unit: string,
  bad: Awaited<ReturnType<typeof clauseScan>>,
  cause: Cause,
  good: Awaited<ReturnType<typeof clauseScan>>,
  what: string,
): Outcome {
  const got = bad.held(unit);
  if (got !== undefined) return fail(`${show(unit, 30)} holds ${got} although ${what}: it must be refused`);
  if (!gave(bad.res, cause.reason, cause.names))
    return fail(
      `no refusal gives the cause ${cause.reason} with ${JSON.stringify(cause.names)} (${details(bad.res)})`,
    );
  const taken = good.held(unit);
  if (taken !== 'rule') return fail(`${show(unit, 30)} holds ${taken} from the valid entry, expected rule`);
  return pass(`refused with ${cause.reason}; the valid entry is taken`);
}

const extras: Record<string, Run> = {
  'span-text-twice-refused': async (ctx) => {
    const r = prose(ctx).random;
    const [a, b, c] = nouns(r, 3) as [string, string, string];
    const unit = `Move the ${a} ${b} to the ${c}, then return the ${a} ${b} afterwards.`;
    const { texts } = withUnit(ctx, unit);
    const yaml = clauseSet(nouns(r, 3));
    const span = (text: string) => new Map([[unit, { spans: [{ kind: 'action', text }] }]]);
    const twice = await clauseScan(ctx, texts, yaml, span(`${a} ${b}`));
    const once = await clauseScan(ctx, texts, yaml, span(`to the ${c}`));
    const cause = { reason: 'span-text-repeated', names: { kind: 'action', span: `${a} ${b}` } };
    return refusedThenTaken(unit, twice, cause, once, `"${a} ${b}" is in it twice`);
  },
  'adjacent-spans-do-not-overlap': async (ctx) => {
    const r = prose(ctx).random;
    const [a, b, c, d] = nouns(r, 4) as [string, string, string, string];
    const unit = `Carry the ${a} and the ${b} past the ${c} into the ${d} tonight.`;
    const { texts } = withUnit(ctx, unit);
    const yaml = clauseSet(nouns(r, 3));
    const cut = shuffled(r, spaces(unit).slice(2, -2))[0] as number;
    const at = cut + 1;
    const end = unit.length - 1;
    const pair = (first: number) =>
      new Map([
        [
          unit,
          {
            spans: [
              { kind: 'action', from: 0, to: first },
              { kind: 'action', from: at, to: end },
            ],
          },
        ],
      ]);
    const touching = await clauseScan(ctx, texts, yaml, pair(at));
    const sharing = await clauseScan(ctx, texts, yaml, pair(at + 1));
    const got = touching.held(unit);
    const spans = `[0, ${at}) and [${at}, ${end})`;
    if (got !== 'rule')
      return fail(`${show(unit, 30)} holds ${got} with spans ${spans}: spans that only touch do not overlap`);
    const shared = sharing.held(unit);
    if (shared !== undefined)
      return fail(`${show(unit, 30)} holds ${shared} with spans that share the character at ${at}`);
    if (!gave(sharing.res, 'span-overlap', { kind: 'action', span: `${at}-${end}` }))
      return fail(`no refusal says the span overlaps another span of the unit (${details(sharing.res)})`);
    return pass(`spans that touch at ${at} are taken; spans that share a character are refused`);
  },
  'nested-span-inside-parent': async (ctx) => {
    const r = prose(ctx).random;
    const [a, b, c, d] = nouns(r, 4) as [string, string, string, string];
    const unit = `Seal the ${a} with the ${b} when the ${c} beside the ${d} is empty.`;
    const { texts } = withUnit(ctx, unit);
    const yaml = clauseSet(nouns(r, 3));
    const gaps = spaces(unit);
    const one = between(r, 1, Math.floor(gaps.length / 2) - 1);
    const two = between(r, one + 1, gaps.length - 2);
    const from = (gaps[one] as number) + 1;
    const close = gaps[two] as number;
    const end = unit.length - 1;
    const nest = (to: number) =>
      new Map([
        [
          unit,
          {
            spans: [
              { kind: 'action', from: 0, to: close },
              { kind: 'condition', from, to },
            ],
          },
        ],
      ]);
    const over = await clauseScan(ctx, texts, yaml, nest(end));
    const inside = await clauseScan(ctx, texts, yaml, nest(close));
    return refusedThenTaken(
      unit,
      over,
      { reason: 'span-outside-parent', names: { kind: 'condition', parent: 'action', span: `${from}-${end}` } },
      inside,
      `its condition span [${from}, ${end}) runs past the action span [0, ${close})`,
    );
  },
  'span-text-case-fold-changes-length-refused': async (ctx) => {
    const r = prose(ctx).random;
    const [a, b, c] = nouns(r, 3) as [string, string, string];
    const clause = `move the ${b} ${c}`;
    const dotted = `Ask \u0130${a} to ${clause} afterwards.`;
    const plain = `Ask I${a} to ${clause} afterwards.`;
    const yaml = clauseSet(nouns(r, 3));
    const span = (unit: string) => new Map([[unit, { spans: [{ kind: 'action', text: clause }] }]]);
    const folded = withUnit(ctx, dotted);
    const bad = await clauseScan(ctx, folded.texts, yaml, span(dotted));
    const got = bad.held(dotted);
    if (got !== undefined)
      return fail(`${show(dotted, 30)} holds ${got}: its lower case is longer, so no text is located in it`);
    if (!gave(bad.res, 'span-text-absent', { kind: 'action', span: clause }))
      return fail(`no refusal says the text is not in the unit (${details(bad.res)})`);
    const good = await clauseScan(ctx, withUnit(ctx, plain).texts, yaml, span(plain));
    const taken = good.held(plain);
    return taken === 'rule'
      ? pass('a unit whose lower case changes length holds no span text; with a plain I the clause is taken')
      : fail(`${show(plain, 30)} holds ${taken} with the clause "${clause}" found once, expected rule`);
  },
  'link-kind-twice-refused': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const unit = p.next();
    const { texts } = withUnit(ctx, unit);
    const values = nouns(r, 3);
    const [v1, v2] = shuffled(r, values) as [string, string];
    const yaml = clauseSet(values);
    const links = (list: string[]) => new Map([[unit, { links: list.map((to) => ({ kind: 'tool', to })) }]]);
    const twice = await clauseScan(ctx, texts, yaml, links([v1, v2]), true);
    const once = await clauseScan(ctx, texts, yaml, links([v1]), true);
    const cause = { reason: 'link-kind-repeated', names: { kind: 'tool', target: v2 } };
    return refusedThenTaken(unit, twice, cause, once, 'it links the kind tool twice');
  },
  'link-unlisted-value-refused': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const [unit, other] = [p.next(), p.next()];
    const { texts } = withUnit(ctx, unit);
    texts.splice(between(r, 0, texts.length), 0, other);
    const [v1, v2, v3, stranger] = nouns(r, 4) as [string, string, string, string];
    const yaml = clauseSet([v1, v2, v3]);
    const unlisted = new Map([[unit, { links: [{ kind: 'tool', to: stranger }] }]]);
    const bad = await clauseScan(ctx, texts, yaml, unlisted, true);
    const listed = shuffled(r, [v1, v2, v3])[0] as string;
    const good = await clauseScan(
      ctx,
      texts,
      yaml,
      new Map([
        [unit, { links: [{ kind: 'tool', to: listed }] }],
        [other, { links: [{ kind: 'tool', to: 'none' }] }],
      ]),
      true,
    );
    const outcome = refusedThenTaken(
      unit,
      bad,
      { reason: 'link-target-unlisted', names: { kind: 'tool', target: stranger } },
      good,
      `it links ${stranger}, which the request did not list`,
    );
    if (!outcome.pass) return outcome;
    const none = good.held(other);
    return none === 'rule'
      ? pass(`a link to ${stranger} is refused; a link to ${listed} and a link to none are taken`)
      : fail(`${show(other, 30)} holds ${none} with a link to none, expected rule`);
  },
};

/* ----- the system 1 clients ----- */

type Probs = Record<string, number>;

/** A response hook that gives each choice question of a unit the vector of its text. */
const vectors =
  (table: ReadonlyMap<string, Probs>) =>
  (_index: number, call: ParsedCall, base: FetchResponse): FetchResponse | undefined => {
    if (base.status !== 200) return undefined;
    const body = JSON.parse(base.body) as { answers?: Record<string, { probabilities?: Probs }> };
    const text = new Map(call.units.map((u) => [`u${u.n}`, keyOf(u.text)]));
    for (const [key, answer] of Object.entries(body.answers ?? {})) {
      const own = table.get(text.get(key) ?? '');
      if (own) answer.probabilities = { ...own };
    }
    return { status: 200, body: JSON.stringify(body) };
  };

/** The option a vector of `probe` gives: the highest, the first in set order on a tie, none last. */
function highest(vector: Probs): string {
  let best: { name: string; p: number } | undefined;
  for (const name of [...PROBE, 'none']) {
    const p = vector[name] ?? 0;
    if (!best || p > best.p) best = { name, p };
  }
  return best?.name ?? 'none';
}

const system1: Record<string, Run> = {
  'vector-sum-103-refused': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const offsets = shuffled(r, [0.02, 0.03, 0.04, -0.02, -0.03, -0.04, 0, 0.004, -0.004]);
    const texts = distinctSentences(p, offsets.length);
    const cases = texts.map((text, i) => {
      const order = shuffled(r, PROBE);
      const off = offsets[i] as number;
      const vector: Probs = {
        [order[0] as string]: Math.round((0.55 + off) * 1000) / 1000,
        [order[1] as string]: 0.2,
        [order[2] as string]: 0.15,
        none: 0.1,
      };
      return { text, vector, off };
    });
    const fake = fakeTransport({ respond: vectors(new Map(cases.map((c) => [keyOf(c.text), c.vector]))) });
    const res = must(await modelScan(ctx, docOf(texts), 'jev', fake, { labelsYaml: PROBE_YAML }));
    let off = 0;
    for (const c of cases) {
      const got = labelOf(res.ledger, c.text, 'probe');
      const sum = Number((1 + c.off).toFixed(3));
      if (Math.abs(c.off) >= 0.02) {
        off += 1;
        if (got !== undefined)
          return fail(`${show(c.text, 30)} holds ${got} from probabilities that sum to ${sum}: no vector`);
      } else if (got !== highest(c.vector)) {
        return fail(`${show(c.text, 30)} holds ${got} from a vector of sum ${sum}, not ${highest(c.vector)}`);
      }
    }
    const refusedUnits = res.diagnostics.filter((d) => d.reason === 'no-vector');
    const reasons = new Set(refusedUnits.map((d) => `${d.window}/${d.unit}`)).size;
    return reasons >= off
      ? pass(`${off} answers 0.02 or more from 1 refused by name; ${cases.length - off} within 0.005 read`)
      : fail(`${reasons} refusals say the probabilities are no vector, expected ${off} (${details(res)})`);
  },
  'choice-tie-first-wins': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const low = 0.05;
    const level = [0.35, 0.4, 0.45][between(r, 0, 2)] as number;
    const rest = Math.round((1 - 2 * level - low) * 100) / 100;
    const ties: Probs[] = [
      { rule: level, prohibition: level, example: low, none: rest },
      { rule: low, prohibition: level, example: level, none: rest },
      { rule: level, prohibition: low, example: level, none: rest },
      { rule: 0.45, prohibition: low, example: low, none: 0.45 },
      { rule: low, prohibition: low, example: 0.45, none: 0.45 },
    ];
    const clear: Probs[] = [
      { rule: 0.1, prohibition: 0.7, example: 0.1, none: 0.1 },
      { rule: 0.1, prohibition: 0.1, example: 0.2, none: 0.6 },
    ];
    const vectorsOf = shuffled(r, [...ties, ...shuffled(r, ties).slice(0, 3), ...clear]);
    const texts = distinctSentences(p, vectorsOf.length);
    const table = new Map(texts.map((t, i) => [keyOf(t), vectorsOf[i] as Probs]));
    const fake = fakeTransport({ respond: vectors(table) });
    const res = must(await modelScan(ctx, docOf(texts), 'jev', fake, { labelsYaml: PROBE_YAML }));
    for (const [i, t] of texts.entries()) {
      const vector = vectorsOf[i] as Probs;
      const got = labelOf(res.ledger, t, 'probe');
      const want = highest(vector);
      if (got !== want)
        return fail(`${show(t, 30)} with ${JSON.stringify(vector)} holds ${got}: a tie gives ${want}`);
    }
    const tied = texts.length - clear.length;
    return pass(`${tied} ties go to the first option in set order; the clear units to their highest`);
  },
  'decisions-below-threshold-none': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const texts = distinctSentences(p, 10);
    const two = (lo: number, hi: number) => Math.round((lo + r() * (hi - lo)) * 100) / 100;
    const cases = texts.map((text, i) => {
      if (i % 2 === 0) {
        const top = PROBE[between(r, 0, 2)] as string;
        const probs = Object.fromEntries(
          PROBE.map((name) => [name, name === top ? two(0.8, 0.95) : two(0.02, 0.2)]),
        );
        return { text, probs, want: top };
      }
      return { text, probs: Object.fromEntries(PROBE.map((name) => [name, two(0.05, 0.3)])), want: 'none' };
    });
    const table = new Map(cases.map((c) => [keyOf(c.text), c.probs]));
    const fake = fakeTransport({ probability: (text, name) => table.get(keyOf(text))?.[name] ?? 0.05 });
    const files = docOf(texts);
    const res = must(await modelScan(ctx, files, 'openai-decisions', fake, { labelsYaml: PROBE_YAML }));
    for (const c of cases) {
      const got = labelOf(res.ledger, c.text, 'probe');
      if (got !== c.want)
        return fail(`${show(c.text, 30)} with ${JSON.stringify(c.probs)} holds ${got}, not ${c.want} at 0.4`);
    }
    return pass('five units take the label at or above 0.4; five with every label below it hold none');
  },
  'system1-refuses-link-labels': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const texts = distinctSentences(p, 6);
    const [name, linked, v1, v2] = nouns(r, 4) as [string, string, string, string];
    const set = `tools-${name}`;
    const withLinks = `${linked}-tool`;
    const linkLabel = `      - name: ${withLinks}
        description: A unit that names a tool to use.
        links: [tool]
`;
    const yaml = (link: boolean) => `labels:
  - set: ${set}
    description: Which tool an instruction asks for.
    links:
      - name: tool
        description: The tool the unit asks for.
        values: [${v1}, ${v2}]
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
      - name: note
        description: A unit that states how something is.
${link ? linkLabel : ''}`;
    const fake = fakeTransport();
    const asked = await modelScan(ctx, docOf(texts), 'jev', fake, { labelsYaml: yaml(true) });
    if (asked.ok)
      return fail(`a system 1 labeler alone took the set ${set}, whose label ${withLinks} carries links`);
    if (asked.failure?.code !== 'set-needs-system2' || asked.failure.set !== set)
      return fail(
        `the refusal does not name the set ${set} by code set-needs-system2: ${JSON.stringify(asked.failure ?? null)}`,
      );
    if (fake.calls.some((call) => call.labels.includes(withLinks)))
      return fail(`a call offered the label ${withLinks}, which carries links`);
    const plain = fakeTransport();
    const res = must(await modelScan(ctx, docOf(texts), 'jev', plain, { labelsYaml: yaml(false) }));
    const missing = texts.find((t) => labelOf(res.ledger, t, set) === undefined);
    return missing === undefined
      ? pass(`the set with ${withLinks} is refused by name; without it every unit is labelled`)
      : fail(`${show(missing, 30)} holds no label from a set a system 1 labeler can be asked`);
  },
  'user-probability-above-one-dropped': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const kinds = shuffled(r, ['one', ...['over', 'clear', 'low'].flatMap((k) => [k, k, k])]);
    const texts = distinctSentences(p, kinds.length);
    const two = (lo: number, hi: number) => Math.round((lo + r() * (hi - lo)) * 100) / 100;
    const cases = texts.map((text, i) => {
      const kind = kinds[i] as string;
      const top = PROBE[between(r, 0, 2)] as string;
      const high = kind === 'over' ? two(1.01, 1.5) : kind === 'one' ? 1 : two(0.6, 0.95);
      const probs = Object.fromEntries(
        PROBE.map((name) => [name, kind !== 'low' && name === top ? high : two(0.02, 0.3)]),
      );
      return { text, probs, want: kind === 'over' ? undefined : kind === 'low' ? 'none' : top };
    });
    const table = new Map(cases.map((c) => [keyOf(c.text), c.probs]));
    const fake = fakeTransport({
      respond: (_index, call) => {
        const text = new Map(call.units.map((u) => [u.n, keyOf(u.text)]));
        const probabilities: Probs = {};
        for (const key of call.questions) {
          const m = /^u(\d+)__(.+)$/.exec(key);
          probabilities[key] = table.get(text.get(Number(m?.[1])) ?? '')?.[m?.[2] ?? ''] ?? 0.05;
        }
        return { status: 200, body: JSON.stringify({ model: 'user-fake', probabilities }) };
      },
    });
    const res = must(await modelScan(ctx, docOf(texts), 'user-yes-no', fake, { labelsYaml: PROBE_YAML }));
    if (fake.count === 0) return fail('the user labeler was never asked');
    for (const c of cases) {
      const got = labelOf(res.ledger, c.text, 'probe');
      const what = `${show(c.text, 30)} with ${JSON.stringify(c.probs)}`;
      if (got !== c.want)
        return fail(`${what} holds ${got}, not ${c.want ?? 'no label'}: a probability above 1 is no answer`);
    }
    return pass('three units with a probability above 1 hold no label; 1 itself, and the others, are read');
  },
};

/* ----- runs and carry ----- */

const scan: Record<string, Run> = {
  'runs-differ-on-target-no-opinion': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const texts = distinctSentences(p, 8);
    const picked = shuffled(r, texts);
    const [gate, steady, first, second, third] = picked as [string, string, string, string, string];
    const own = new Map(texts.map((t) => [t, PLAIN[between(r, 0, 3)] as string]));
    const n = (call: ParsedCall, text: string) => call.units.find((u) => keyOf(u.text) === keyOf(text))?.n;
    const fake = fakeTransport({
      respond: (index, call) => {
        const labels = texts.map((t) =>
          t === gate
            ? { units: String(n(call, t)), label: 'gate', target: n(call, index % 3 === 1 ? second : first) }
            : t === steady
              ? { units: String(n(call, t)), label: 'gate', target: n(call, third) }
              : { units: String(n(call, t)), label: own.get(t) },
        );
        return haikuResponse(JSON.stringify({ window: call.window, set: call.set, labels }));
      },
    });
    const res = must(await modelScan(ctx, docOf(texts), 'haiku', fake, { labelsYaml: RULES_YAML }));
    const idOf = (text: string) => liveByText(res.ledger, text)?.id;
    const split = labelOf(res.ledger, gate, 'agent-rules');
    if (split !== undefined)
      return fail(`${show(gate, 30)} holds ${split}: its runs named two targets, so the runs give no label`);
    if (res.atoms.some((atom) => atom.kind === 'gate' && atom.fields.unit === idOf(gate)))
      return fail(`a gate atom is built from ${show(gate, 30)}, whose runs disagree on the target`);
    const held = labelOf(res.ledger, steady, 'agent-rules');
    if (held !== 'gate') return fail(`${show(steady, 30)} holds ${held}: every run gave gate`);
    if (!res.atoms.some((atom) => atom.kind === 'gate' && atom.fields.unit === idOf(steady)))
      return fail(`no gate atom is built from ${show(steady, 30)}, whose runs agree`);
    const rest = texts.filter((t) => t !== gate && t !== steady);
    const wrong = rest.find((t) => labelOf(res.ledger, t, 'agent-rules') !== own.get(t));
    if (wrong === undefined)
      return pass('the gate whose runs differ on its target holds no label; the steady gate and the rest do');
    const held2 = labelOf(res.ledger, wrong, 'agent-rules');
    return fail(`${show(wrong, 30)} holds ${held2}, every run gave ${own.get(wrong)}`);
  },
  'labeler-change-relabels-all': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const texts = distinctSentences(p, 8);
    const before = new Map(texts.map((t) => [keyOf(t), PROBE[between(r, 0, 2)] as string]));
    const after = new Map(
      texts.map((t) => [
        keyOf(t),
        PROBE[(PROBE_NAMES.indexOf(before.get(keyOf(t)) as string) + between(r, 1, 2)) % 3] as string,
      ]),
    );
    const planted = (table: Map<string, string>) =>
      recording((request) => ({
        labels: texts.map((t) => ({ units: String(nOf(request, t)), label: table.get(keyOf(t)) as string })),
      }));
    const files = docOf(texts);
    const first = await scanOk(ctx.sut, { files, labeler: planted(before), labelsYaml: PROBE_YAML });
    const fake = fakeTransport({ truth: (text) => after.get(keyOf(text)) ?? 'none' });
    const extra = { labelsYaml: PROBE_YAML, previousLedger: first.ledger.raw };
    const model = must(await modelScan(ctx, files, 'haiku', fake, extra));
    if (fake.count === 0) return fail('the rescan by another labeler sent no call: it kept the first labels');
    for (const t of texts) {
      const got = labelOf(model.ledger, t, 'probe');
      if (got !== after.get(keyOf(t)))
        return fail(`${show(t, 30)} holds ${got} after a rescan by another labeler: ${after.get(keyOf(t))}`);
    }
    const again = planted(after);
    const same = await scanOk(ctx.sut, {
      files,
      labeler: again,
      labelsYaml: PROBE_YAML,
      previousLedger: first.ledger.raw,
    });
    if (again.calls.length !== 0)
      return fail(`${again.calls.length} calls to the same labeller on an unchanged rescan: labels carry`);
    const lost = texts.find((t) => labelOf(same.ledger, t, 'probe') !== before.get(keyOf(t)));
    return lost === undefined
      ? pass(`another labeler labels all ${texts.length} units again; the same labeller carries them`)
      : fail(`${show(lost, 30)} holds ${labelOf(same.ledger, lost, 'probe')} after the same labeller`);
  },
};

/* ----- the settings file ----- */

const settings: Record<string, Run> = {
  'settings-threshold-nan-refused': async (ctx) => {
    const api = ctx.sut.settings;
    if (!api)
      throw new Problem(
        'the reader exports no settings reader: it must refuse a threshold of not a number',
        'missing-observation',
      );
    const r = prose(ctx).random;
    for (const key of shuffled(r, ['labeler', 'pass_at', 'fail_at', 'margin_cut'])) {
      const nan = ['.nan', '.NaN', '.NAN'][between(r, 0, 2)] as string;
      const out = await api.parse(`threshold: { ${key}: ${nan} }\n`);
      if (out.ok) return fail(`the threshold ${key}: ${nan} was accepted; not a number is no threshold`);
      if (!out.issues?.some((i) => i.code === 'threshold-not-finite' && i.key === key && i.reason === 'not-finite'))
        return fail(
          `the refusal of ${key}: ${nan} does not name the key by code threshold-not-finite: ${JSON.stringify(out.issues ?? out.errors)}`,
        );
      const value = Math.round(r() * 100) / 100;
      const good = await api.parse(`threshold: { ${key}: ${value} }\n`);
      if (!good.ok) return fail(`the threshold ${key}: ${value} was refused: ${good.errors.join('; ')}`);
      if (good.thresholds[key] !== value)
        return fail(`the threshold ${key}: ${value} came back as ${String(good.thresholds[key])}`);
    }
    return pass('a not-a-number threshold is refused by name for each key; a value from 0 to 1 is kept');
  },
};

export const HARDENING_BUGS_C_RUNS: Record<string, Record<string, Run>> = {
  labels: { ...ranges, ...dense, ...extras, ...system1, ...scan, ...settings },
};
