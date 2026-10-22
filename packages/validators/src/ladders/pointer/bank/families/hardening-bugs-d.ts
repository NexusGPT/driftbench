import { distinctSentences } from '../../kit/anchor-world';
import { compose } from '../../kit/compose';
import { liveByText, scanOk } from '../../kit/estate';
import { type AuthoredFile, canonical, makeFixture, requireFixtureLabels } from '../../kit/fixture';
import { entriesFor, recording } from '../../kit/labellers';
import { show } from '../../kit/oracle';
import { requireSourceWitness } from '../../kit/positive';
import { PROBE_YAML } from '../../kit/sets';
import { type FakeTransport, fakeTransport, TOO_LARGE } from '../../kit/transport';
import { Prose, type Rng, word } from '../../kit/words';
import type { FetchResponse, Labeler, LedgerView, ScanResult, SourceFile } from '../../sut/port';
import { fail, type ItemContext, Problem, pass, type Run } from '../types';

/**
 * The runners of the items the round 3 audit, seat 4 asked for (`specs/hardening-bugs-d.ts`): planted bugs in
 * the reader's stack, user labeler, cassette and key code that lost no item. Each oracle is what the
 * unmutated reader does on a case the bug changes; the inputs are drawn from the seed.
 */

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const para = (text: string) => ({ kind: 'paragraph' as const, sentences: [text] });
const docOf = (texts: string[]): SourceFile[] => [{ path: 'doc.md', text: compose(texts.map(para)).text }];
const SET = 'probe';
/** The labels of the probe set, none of which names a target: a choice model is asked about each. */
const OPTIONS = ['rule', 'prohibition', 'example'] as const;
const labelOf = (ledger: LedgerView, text: string): string | undefined =>
  liveByText(ledger, text)?.labels[SET]?.label;
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T;
const other = (rng: Rng, not: readonly string[]): string =>
  pick(
    rng,
    OPTIONS.filter((name) => !not.includes(name)),
  );
function shuffled<T>(rng: Rng, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
const must = (res: ScanResult, what: string): ScanResult & { ledger: LedgerView } => {
  if (!res.ok || !res.ledger) throw new Problem(`${what} failed: ${res.error ?? 'no ledger'}`);
  return res as ScanResult & { ledger: LedgerView };
};
/** An endpoint that refuses every request it is sent, with an error no retry can change. */
const CLOSED: FetchResponse = {
  status: 400,
  body: JSON.stringify({ error: { type: 'invalid_request_error', message: 'closed' } }),
};
/** The fields a miss names as differing from its nearest entry (its structured `differs`); none for no miss. */
function fieldsNamed(res: ScanResult): string[] {
  return res.miss?.differs ?? [];
}

/* ----- the default stack: a choice system 1 arm in front of the haiku arm ----- */

/**
 * Two options whose sum and difference are exact in binary: a vector of these two (the other options and
 * `none` at 0) leads by exactly `top - next`, so a cut set to that difference meets the margin, unrounded.
 */
const EXACT: ReadonlyArray<readonly [number, number]> = [
  [0.75, 0.25],
  [0.875, 0.125],
  [0.8125, 0.1875],
  [0.6875, 0.3125],
];
/** A vector that leads by 0.875 and one that leads by 0.125: above and under every cut drawn here. */
const SURE: readonly [number, number] = [0.9375, 0.0625];
const UNSURE: readonly [number, number] = [0.5625, 0.4375];

type StackUnit = {
  text: string;
  /** The probability of each option of the system 1 choice question (`none` takes what is left: 0 here). */
  vector: Record<string, number>;
  /** The label every system 2 run gives the unit. */
  second: string;
  /** The label the unit must hold; undefined: no label. */
  want: string | undefined;
  /** What the unit tests, for the failure message. */
  why: string;
};

const vectorOf = (top: string, [p, q]: readonly [number, number], next: string): Record<string, number> => ({
  ...Object.fromEntries(OPTIONS.map((name) => [name, 0])),
  [top]: p,
  [next]: q,
});

/** Records the units on a stack of the `jev` and `haiku` arms; `refuse` names an arm whose requests fail. */
async function stackScan(
  ctx: ItemContext,
  units: StackUnit[],
  marginCut: number,
  refuse?: 'jev' | 'haiku',
): Promise<{ res: ScanResult; fake: FakeTransport; files: SourceFile[] }> {
  const vectors = new Map(units.map((u) => [u.text, u.vector]));
  const second = new Map(units.map((u) => [u.text, u.second]));
  const fake = fakeTransport({
    truth: (text) => second.get(text) ?? 'none',
    probability: (text, name) => vectors.get(text)?.[name] ?? 0,
    respond: (_index, call) => (refuse !== undefined && call.arm === refuse ? CLOSED : undefined),
  });
  const files = docOf(units.map((u) => u.text));
  const res = await ctx.sut.scan({
    files,
    labelsYaml: PROBE_YAML,
    model: { arm: 'jev', transport: fake, stack: { marginCut } },
    cassette: { mode: 'record' },
  });
  return { res, fake, files };
}

/** Every unit holds the label it must hold, or the first that does not, named. */
function stackLabels(ledger: LedgerView, units: readonly StackUnit[]): string | undefined {
  for (const u of units) {
    const got = labelOf(ledger, u.text);
    if (got !== u.want)
      return `${show(u.text, 40)} holds ${got ?? 'no label'}, expected ${u.want ?? 'no label'}: ${u.why}`;
  }
  return undefined;
}

const stackRuns: Record<string, Run> = {
  'stack-margin-at-cut-decides-by-system1': async (ctx) => {
    const r = ctx.rng;
    const exact = pick(r, EXACT);
    const cut = exact[0] - exact[1];
    const count = { at: 2 + Math.floor(r() * 2), under: 2, above: 1 + Math.floor(r() * 2) };
    const texts = distinctSentences(prose(ctx), count.at + count.under + count.above);
    const units: StackUnit[] = texts.map((text, i) => {
      const top = pick(r, OPTIONS);
      const next = other(r, [top]);
      const second = other(r, [top]);
      if (i < count.at)
        return {
          text,
          vector: vectorOf(top, exact, next),
          second,
          want: top,
          why: `system 1 leads by ${cut}, the cut, so system 1 decides`,
        };
      if (i < count.at + count.under)
        return {
          text,
          vector: vectorOf(top, UNSURE, next),
          second,
          want: second,
          why: `system 1 leads by 0.125, under the cut ${cut}, so system 2 decides`,
        };
      return {
        text,
        vector: vectorOf(top, [1, 0], next),
        second,
        want: top,
        why: `system 1 leads by 1, above the cut ${cut}`,
      };
    });
    const { res, files } = await stackScan(ctx, shuffled(r, units), cut);
    if (!res.ok) return fail(`the stack scan failed: ${res.error}`);
    requireSourceWitness(res, files);
    const wrong = stackLabels(res.ledger, units);
    return wrong
      ? fail(wrong)
      : pass(`${count.at} units at the cut ${cut} kept the system 1 label; system 2 decided those under it`);
  },
  'stack-system2-none-keeps-sure-system1': async (ctx) => {
    const r = ctx.rng;
    const cut = pick(r, [0.25, 0.375, 0.5]);
    const count = { sureNone: 2 + Math.floor(r() * 2), sureOther: 1, underNone: 1 + Math.floor(r() * 2) };
    const texts = distinctSentences(prose(ctx), count.sureNone + count.sureOther + count.underNone);
    const units: StackUnit[] = texts.map((text, i) => {
      const top = pick(r, OPTIONS);
      const next = other(r, [top]);
      if (i < count.sureNone)
        return {
          text,
          vector: vectorOf(top, SURE, next),
          second: 'none',
          want: top,
          why: `system 1 leads by 0.875, above the cut ${cut}; a none from system 2 does not override it`,
        };
      if (i < count.sureNone + count.sureOther)
        return {
          text,
          vector: vectorOf(top, SURE, next),
          second: other(r, [top]),
          want: top,
          why: `system 1 leads by 0.875, above the cut ${cut}`,
        };
      return {
        text,
        vector: vectorOf(top, UNSURE, next),
        second: 'none',
        want: 'none',
        why: `system 1 leads by 0.125, under the cut ${cut}, and every system 2 run said none`,
      };
    });
    const { res, files } = await stackScan(ctx, shuffled(r, units), cut);
    if (!res.ok) return fail(`the stack scan failed: ${res.error}`);
    requireSourceWitness(res, files);
    const wrong = stackLabels(res.ledger, units);
    return wrong
      ? fail(wrong)
      : pass(`${count.sureNone} sure units kept their system 1 label against a none from system 2`);
  },
  'stack-fallback-counts-sure-system1-alone': async (ctx) => {
    const r = ctx.rng;
    const cut = pick(r, [0.25, 0.375, 0.5]);
    const count = { sure: 2 + Math.floor(r() * 3), under: 1 + Math.floor(r() * 3) };
    const texts = distinctSentences(prose(ctx), count.sure + count.under);
    const units: StackUnit[] = texts.map((text, i) => {
      const top = pick(r, OPTIONS);
      const next = other(r, [top]);
      return i < count.sure
        ? {
            text,
            vector: vectorOf(top, SURE, next),
            second: other(r, [top]),
            want: top,
            why: 'system 1 is sure and system 2 gave no opinion: system 1 decides alone',
          }
        : {
            text,
            vector: vectorOf(top, UNSURE, next),
            second: other(r, [top]),
            want: undefined,
            why: 'system 1 is under the cut and system 2 gave no opinion: no label',
          };
    });
    const { res, fake, files } = await stackScan(ctx, shuffled(r, units), cut, 'haiku');
    if (!res.ok) return fail(`the stack scan failed: ${res.error}`);
    requireSourceWitness(res, files);
    if (!fake.calls.some((call) => call.arm === 'haiku'))
      return fail('no system 2 request was sent: the stack never asked the haiku arm');
    const wrong = stackLabels(res.ledger, units);
    if (wrong) return fail(wrong);
    if (res.fellBack === undefined)
      return fail(
        'the reader does not report fellBack: the units one member of a stack decided alone must be counted',
      );
    return res.fellBack === count.sure
      ? pass(`${count.sure} sure units decided by system 1 alone, counted as fallbacks`)
      : fail(
          `fellBack is ${res.fellBack}, expected ${count.sure}: every system 2 request failed, so each of the ${count.sure} sure units was decided by system 1 alone`,
        );
  },
  'stack-system1-missing-system2-decides': async (ctx) => {
    const r = ctx.rng;
    const n = 4 + Math.floor(r() * 3);
    const texts = distinctSentences(prose(ctx), n);
    const units: StackUnit[] = texts.map((text) => {
      const top = pick(r, OPTIONS);
      const second = pick(r, [...OPTIONS, 'none']);
      return {
        text,
        vector: vectorOf(top, SURE, other(r, [top])),
        second,
        want: second,
        why: 'every system 1 request failed, so system 2 decides alone',
      };
    });
    const { res, fake, files } = await stackScan(ctx, units, 0.5, 'jev');
    if (!res.ok) return fail(`the stack scan failed: ${res.error}`);
    requireSourceWitness(res, files);
    if (!fake.calls.some((call) => call.arm === 'jev'))
      return fail('no system 1 request was sent: the stack never asked the jev arm');
    const wrong = stackLabels(res.ledger, units);
    if (wrong) return fail(wrong);
    if (res.fellBack === undefined)
      return fail(
        'the reader does not report fellBack: the units one member of a stack decided alone must be counted',
      );
    return res.fellBack === n
      ? pass(`${n} units decided by system 2 alone after system 1 failed`)
      : fail(`fellBack is ${res.fellBack}, expected ${n}: system 2 decided every unit alone`);
  },
};

/* ----- what decides a label: a change of it re-labels the units ----- */

/** A planted labeller that answers `choose` for each unit it may label. */
const answering =
  (choose: (text: string) => string): Labeler =>
  (request) => ({ labels: entriesFor(request, (u) => choose(u.text)) });

/** Two labels per text, drawn from the seed, never equal: the first labeller's and the second's. */
function twoLabels(
  r: Rng,
  texts: readonly string[],
): { first: Map<string, string>; second: Map<string, string> } {
  const first = new Map<string, string>();
  const second = new Map<string, string>();
  for (const text of texts) {
    const a = pick(r, OPTIONS);
    first.set(text, a);
    second.set(text, other(r, [a]));
  }
  return { first, second };
}

/** The first unit whose label is not the one `want` gives, named; undefined when every unit holds it. */
function labelsAre(
  ledger: LedgerView,
  texts: readonly string[],
  want: (text: string) => string,
): string | undefined {
  for (const text of texts) {
    const got = labelOf(ledger, text);
    if (got !== want(text)) return `${show(text, 40)} holds ${got ?? 'no label'}, expected ${want(text)}`;
  }
  return undefined;
}

const relabelRuns: Record<string, Run> = {
  'labeler-runs-change-relabels': async (ctx) => {
    const r = ctx.rng;
    const texts = distinctSentences(prose(ctx), 6);
    const files = docOf(texts);
    const { first, second } = twoLabels(r, texts);
    const firstOf = (t: string) => first.get(t) as string;
    const secondOf = (t: string) => second.get(t) as string;
    const before = await scanOk(ctx.sut, { files, labelsYaml: PROBE_YAML, labeler: answering(firstOf) });
    const wrongBefore = labelsAre(before.ledger, texts, firstOf);
    if (wrongBefore) return fail(`positive witness, first scan: ${wrongBefore}`);
    // Control: the same runs, so every label carries and the labeller is asked nothing.
    const same = recording(answering(secondOf));
    const kept = await scanOk(ctx.sut, {
      files,
      labelsYaml: PROBE_YAML,
      labeler: same,
      previousLedger: before.ledger.raw,
    });
    if (same.calls.length !== 0)
      return fail(
        `the rescan with nothing changed asked the labeller ${same.calls.length} times: every unit carries its label`,
      );
    const wrongKept = labelsAre(kept.ledger, texts, firstOf);
    if (wrongKept) return fail(`the rescan with nothing changed: ${wrongKept}`);
    const runs = 2 + Math.floor(r() * 2);
    const asked = recording(answering(secondOf));
    const after = await scanOk(ctx.sut, {
      files,
      labelsYaml: PROBE_YAML,
      labeler: asked,
      labelerRuns: runs,
      previousLedger: before.ledger.raw,
    });
    if (asked.calls.length === 0)
      return fail(
        `the rescan with the labeller asked ${runs} times per window sent it nothing: the runs decide a label, so a change of them re-labels every unit`,
      );
    const wrongAfter = labelsAre(after.ledger, texts, secondOf);
    return wrongAfter
      ? fail(`after the runs changed to ${runs}: ${wrongAfter}`)
      : pass(`a change of the runs to ${runs} re-labelled ${texts.length} units`);
  },
  'labeler-settings-change-relabels': async (ctx) => {
    const r = ctx.rng;
    const texts = distinctSentences(prose(ctx), 10);
    const files = docOf(texts);
    const table = new Map<string, { label: string; p: number }>();
    for (const [i, text] of texts.entries())
      table.set(text, { label: pick(r, OPTIONS), p: i % 2 === 0 ? 0.95 : pick(r, [0.45, 0.55, 0.65, 0.75]) });
    const probability = (text: string, name: string) => {
      const row = table.get(text);
      return row && row.label === name ? row.p : 0.02;
    };
    const scan = (threshold: number, fake: FakeTransport, previousLedger?: string) =>
      ctx.sut.scan({
        files,
        labelsYaml: PROBE_YAML,
        model: { arm: 'openai-decisions', transport: fake, threshold },
        cassette: { mode: 'record' },
        ...(previousLedger !== undefined ? { previousLedger } : {}),
      });
    const before = must(await scan(0.4, fakeTransport({ probability })), 'the first scan at 0.4');
    const all = (t: string) => (table.get(t) as { label: string }).label;
    const wrongBefore = labelsAre(before.ledger, texts, all);
    if (wrongBefore) return fail(`positive witness, at 0.4: ${wrongBefore}`);
    // Control: the same threshold, so every label carries and no request leaves.
    const quiet = fakeTransport({ probability });
    const kept = must(await scan(0.4, quiet, before.ledger.raw), 'the rescan at 0.4');
    if (quiet.count !== 0)
      return fail(
        `the rescan with nothing changed sent ${quiet.count} requests: every unit carries its label`,
      );
    const wrongKept = labelsAre(kept.ledger, texts, all);
    if (wrongKept) return fail(`the rescan with nothing changed: ${wrongKept}`);
    const asked = fakeTransport({ probability });
    const after = must(await scan(0.8, asked, before.ledger.raw), 'the rescan at 0.8');
    if (asked.count === 0)
      return fail(
        'the rescan at threshold 0.8 sent no request: the threshold of a labeler decides its labels, so a change of it re-labels every unit',
      );
    const at08 = (t: string) => {
      const row = table.get(t) as { label: string; p: number };
      return row.p >= 0.8 ? row.label : 'none';
    };
    const wrongAfter = labelsAre(after.ledger, texts, at08);
    return wrongAfter
      ? fail(`after the threshold changed to 0.8: ${wrongAfter}`)
      : pass('the threshold changed from 0.4 to 0.8 and every unit was labelled again');
  },
  'http-labeler-address-change-relabels': async (ctx) => {
    const r = ctx.rng;
    const texts = distinctSentences(prose(ctx), 6);
    const files = docOf(texts);
    const { first, second } = twoLabels(r, texts);
    // One host for both addresses: the model of an HTTP labeler names its host, so only its id differs.
    const host = `${word(r)}-${word(r)}.invalid`;
    const address = () => `https://${host}/${word(r)}/${word(r)}`;
    const urlA = address();
    let urlB = address();
    while (urlB === urlA) urlB = address();
    const scan = (url: string, fake: FakeTransport, previousLedger?: string) =>
      ctx.sut.scan({
        files,
        labelsYaml: PROBE_YAML,
        model: { arm: 'http', url, transport: fake },
        cassette: { mode: 'record' },
        ...(previousLedger !== undefined ? { previousLedger } : {}),
      });
    const firstOf = (t: string) => first.get(t) as string;
    const secondOf = (t: string) => second.get(t) as string;
    const fakeA = fakeTransport({ truth: firstOf });
    const before = must(await scan(urlA, fakeA), 'the first scan at the first address');
    const elsewhere = fakeA.calls.find((call) => call.url !== urlA);
    if (fakeA.count === 0 || elsewhere)
      return fail(
        `positive witness: the first scan sent ${fakeA.count} requests${elsewhere ? `, one to ${elsewhere.url}` : ''}; the http arm posts each window to its address`,
      );
    const wrongBefore = labelsAre(before.ledger, texts, firstOf);
    if (wrongBefore) return fail(`positive witness, first address: ${wrongBefore}`);
    // Control: the same address, so every label carries and no request leaves.
    const quiet = fakeTransport({ truth: secondOf });
    const kept = must(await scan(urlA, quiet, before.ledger.raw), 'the rescan at the same address');
    if (quiet.count !== 0)
      return fail(
        `the rescan at the same address sent ${quiet.count} requests: every unit carries its label`,
      );
    const fakeB = fakeTransport({ truth: secondOf });
    const after = must(await scan(urlB, fakeB, before.ledger.raw), 'the rescan at the second address');
    if (fakeB.count === 0)
      return fail(
        'the rescan with a user labeler at another address sent no request: the address is the id of the labeler, so another address re-labels every unit',
      );
    const astray = fakeB.calls.find((call) => call.url !== urlB);
    if (astray) return fail(`the rescan sent a request to ${astray.url}, not to the second address`);
    const wrongKept = labelsAre(kept.ledger, texts, firstOf);
    if (wrongKept) return fail(`the rescan at the same address: ${wrongKept}`);
    const wrongAfter = labelsAre(after.ledger, texts, secondOf);
    return wrongAfter
      ? fail(`after the labeler moved to another address: ${wrongAfter}`)
      : pass(`the labeler at another address re-labelled ${texts.length} units`);
  },
};

/* ----- the cassette: halving, the nearest entry of a miss ----- */

/** One or two seeded files of three to five units, each with a seeded label of the probe set. */
function authored(ctx: ItemContext, files: number): AuthoredFile[] {
  const p = prose(ctx);
  const r = p.random;
  const names = new Set<string>();
  const out: AuthoredFile[] = [];
  while (out.length < files) {
    const name = `notes/${word(r)}.md`;
    if (names.has(name)) continue;
    names.add(name);
    const texts = distinctSentences(p, 3 + Math.floor(r() * 3));
    const units = texts.map((text) => ({ text, label: pick(r, OPTIONS) }));
    out.push({ path: name, units });
  }
  return out;
}

/** The probe set with a seeded word added to the description of one of its labels. */
function editedYaml(r: Rng): string {
  const lines = PROBE_YAML.split('\n');
  const at = lines.flatMap((line, i) => (line.startsWith('        description: ') ? [i] : []));
  const line = pick(r, at);
  lines[line] = (lines[line] as string).replace(/\.$/, ` ${word(r)}.`);
  return lines.join('\n');
}

const closed = (): FakeTransport => fakeTransport({ respond: () => CLOSED });

const cassetteRuns: Record<string, Run> = {
  'too-large-halves-larger-first': async (ctx) => {
    const r = ctx.rng;
    const n = pick(r, [7, 9, 11, 13]);
    const texts = distinctSentences(prose(ctx), n);
    const fake = fakeTransport({
      respond: (_i, call) => (call.questions.length === n ? TOO_LARGE : undefined),
    });
    const files = docOf(texts);
    const res = await ctx.sut.scan({
      files,
      labelsYaml: PROBE_YAML,
      model: { arm: 'jev', transport: fake },
      cassette: { mode: 'record' },
    });
    requireSourceWitness(res, files);
    const larger = Math.ceil(n / 2);
    const sizes = fake.calls.map((call) => call.questions.length);
    if (JSON.stringify(sizes) !== JSON.stringify([n, larger, n - larger]))
      return fail(
        `the requests held ${JSON.stringify(sizes)} units; the window of ${n} was refused, so it is halved into ${larger} then ${n - larger}, the larger half first`,
      );
    const firstHalf = (fake.calls[1]?.units ?? []).map((u) => u.text);
    if (JSON.stringify(firstHalf) !== JSON.stringify(texts.slice(0, larger)))
      return fail(`the first half did not hold the first ${larger} units of the window in order`);
    const unlabelled = texts.find((t) => labelOf(res.ledger, t) === undefined);
    return unlabelled
      ? fail(`${show(unlabelled, 40)} has no label after the window was halved`)
      : pass(`${n} units refused, halved into ${larger} then ${n - larger}, all labelled`);
  },
  'miss-nearest-same-labeler': async (ctx) => {
    const r = ctx.rng;
    const documents = authored(ctx, 1 + Math.floor(r() * 2));
    const jev = makeFixture('jev', documents, PROBE_YAML);
    const haiku = makeFixture('haiku', documents, PROBE_YAML);
    const replay = async (labelsYaml: string, cassette: string) => {
      const fake = closed();
      const res = await ctx.sut.scan({
        files: jev.files,
        labelsYaml,
        model: { arm: 'jev', transport: fake },
        cassette: { mode: 'replay', text: cassette },
      });
      return { res, fake };
    };
    const own = await replay(PROBE_YAML, jev.cassette);
    requireFixtureLabels(own.res, jev);
    if (own.fake.count !== 0)
      return fail('positive witness: the replay of its own cassette called the transport');
    // Control: a changed label description misses on the entries of the same labeler; the miss names them.
    const edited = await replay(editedYaml(r), jev.cassette);
    if (edited.res.ok || edited.fake.count !== 0)
      return fail('positive witness: a changed label description replayed, or reached the transport');
    if (!fieldsNamed(edited.res).includes('setHash'))
      return fail(
        `positive witness: the miss of a changed description names no setHash: ${edited.res.error}`,
      );
    const foreign = await replay(PROBE_YAML, haiku.cassette);
    if (foreign.res.ok || foreign.fake.count !== 0)
      return fail('the cassette of another labeller replayed, or the miss reached the transport');
    const named = fieldsNamed(foreign.res);
    return named.includes('labeler')
      ? fail(
          `the miss names an entry of another labeller as the nearest (it differs in ${named.join(', ')}): the nearest entry is one of the same file, window, set and labeller, and there is none: ${foreign.res.error}`,
        )
      : pass('the miss on the cassette of another labeller names no entry of that labeller');
  },
  'miss-names-least-different-entry': async (ctx) => {
    const r = ctx.rng;
    const documents = authored(ctx, 1 + Math.floor(r() * 2));
    const haiku = makeFixture('haiku', documents, PROBE_YAML);
    const replay = async (labelsYaml: string) => {
      const fake = closed();
      const res = await ctx.sut.scan({
        files: haiku.files,
        labelsYaml,
        model: { arm: 'haiku', transport: fake },
        cassette: { mode: 'replay', text: haiku.cassette },
      });
      return { res, fake };
    };
    const own = await replay(PROBE_YAML);
    requireFixtureLabels(own.res, haiku);
    if (own.fake.count !== 0)
      return fail('positive witness: the replay of its own cassette called the transport');
    const edited = await replay(editedYaml(r));
    if (edited.res.ok || edited.fake.count !== 0)
      return fail('a changed label description replayed, or the miss reached the transport');
    const named = fieldsNamed(edited.res);
    if (!named.includes('setHash'))
      return fail(`the miss does not name the set hash among the fields that differ: ${edited.res.error}`);
    return named.includes('run')
      ? fail(
          `the miss names an entry of another run (it differs in ${named.join(', ')}): the entry of the same run differs least, so it is the nearest`,
        )
      : pass(`the miss names the entry of the same run: ${named.join(', ')}`);
  },
};

/* ----- privacy: a key behind a getter ----- */

const privacyRuns: Record<string, Run> = {
  'key-getter-not-read-when-nothing-sent': async (ctx) => {
    const r = ctx.rng;
    const documents = authored(ctx, 2);
    const haiku = makeFixture('haiku', documents, PROBE_YAML);
    const scan = (cassette: string, fake: FakeTransport, onKeyRead: () => void) =>
      ctx.sut.scan({
        files: haiku.files,
        labelsYaml: PROBE_YAML,
        model: { arm: 'haiku', transport: fake, onKeyRead },
        cassette: { mode: 'record', text: cassette },
      });
    let reads = 0;
    const quiet = closed();
    const full = await scan(haiku.cassette, quiet, () => {
      reads += 1;
    });
    requireFixtureLabels(full, haiku);
    if (quiet.count !== 0) return fail(`the recording scan on a full cassette sent ${quiet.count} requests`);
    if (reads !== 0)
      return fail(
        `the recording scan sent nothing and read the key ${reads} times: a key behind a getter is read when a request leaves, never before`,
      );
    // Control: a cassette without one file sends its requests, and reads the key for them.
    const dropped = pick(r, documents).path;
    const partial = haiku.rows
      .filter((row) => row.readable.path !== dropped)
      .map(canonical)
      .concat('')
      .join('\n');
    let controlReads = 0;
    const open = fakeTransport();
    const sent = await scan(partial, open, () => {
      controlReads += 1;
    });
    if (!sent.ok) return fail(`positive witness: the recording scan of a missing file failed: ${sent.error}`);
    if (open.count === 0 || controlReads === 0)
      return fail(
        `positive witness: the scan of a missing file sent ${open.count} requests and read the key ${controlReads} times; the key watch reports no read`,
      );
    return pass(`no read with nothing to send; ${controlReads} read when ${open.count} requests left`);
  },
};

/** The runners by family. */
export const HARDENING_D_RUNS: Record<string, Record<string, Run>> = {
  labels: { ...stackRuns, ...relabelRuns },
  replay: cassetteRuns,
  privacy: privacyRuns,
};
