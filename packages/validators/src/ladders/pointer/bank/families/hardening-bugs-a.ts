import { cloneWorld, filesOf, lowerFirst, type World, worldOf } from '../../kit/anchor-world';
import { cutRun } from '../../kit/cut-case';
import { build, byId, liveByText, liveOf, scanOk } from '../../kit/estate';
import { perfect } from '../../kit/labellers';
import { norm, squash } from '../../kit/norm';
import { show } from '../../kit/oracle';
import { requireSourceWitness } from '../../kit/positive';
import { longMake, Prose, type Rng, sentence, similarity, word } from '../../kit/words';
import type { LedgerEntry, LedgerView, ScanResult, SourceFile } from '../../sut/port';
import { fail, type ItemContext, Problem, pass, type Run } from '../types';

/**
 * The runners of `specs/hardening-bugs-a.ts`: round 3 audit, seat 4, the cutter and the ledger. Each item is
 * green on the reader as it is and red on one planted bug; the oracle is what the reader does on the case the
 * bug changes.
 */

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** A sentence without its final full stop. */
const body = (text: string) => text.replace(/\.$/, '');
/** A whole number from `from` to `to`, drawn from the stream. */
const between = (r: Rng, from: number, to: number) => from + Math.floor(r() * (to - from + 1));

/* ----- cutting ----- */

const cutting: Record<string, Run> = {
  'sentence-stop-before-digit-merges': cutRun((ctx) => {
    const p = prose(ctx);
    const [one, two, three] = p.many(3) as [string, string, string];
    const n = between(p.random, 2, 98);
    const joined = `${one} ${n} ${two}`;
    return {
      blocks: [{ kind: 'paragraph', sentences: [joined, three] }],
      extra: (_doc, got) =>
        got.units[0] && squash(got.units[0].text) === joined
          ? undefined
          : `the first unit is ${show(got.units[0]?.text ?? '')}: a full stop followed by the number ${n} ended the sentence`,
    };
  }),
  'list-in-quote-container': async (ctx) => {
    const p = prose(ctx);
    const [paragraph, one, two] = p.many(3) as [string, string, string];
    const text = `> ${paragraph}\n>\n> - ${one}\n> - ${two}\n`;
    const got = await ctx.sut.cut({ path: 'quote.md', text });
    const want: Array<[string, string]> = [
      ['block_quote', paragraph],
      ['list_item', one],
      ['list_item', two],
    ];
    const listed = got.units.map((unit) => `${unit.container} ${show(unit.text, 24)}`).join('; ');
    if (got.units.length !== want.length)
      return fail(`${got.units.length} units for a quote paragraph and two quoted items: ${listed}`);
    for (const [index, [container, expected]] of want.entries()) {
      const unit = got.units[index];
      if (!unit) return fail(`no unit ${index}`);
      if (unit.text !== text.slice(unit.start, unit.end))
        return fail(`unit ${index} is not the source slice of its span`);
      if (norm(unit.text, container) !== norm(expected, container))
        return fail(`unit ${index} reads ${show(unit.text)}, expected ${show(expected)}`);
      if (unit.container !== container)
        return fail(
          `unit ${index} ${show(expected, 24)} is a ${unit.container}, expected ${container}: an item of a list inside a quote is a list item`,
        );
    }
    return pass('the quote paragraph is a block quote, each quoted item a list item');
  },
  'number-stop-before-word-splits': cutRun((ctx) => {
    const p = prose(ctx);
    const [one, two] = p.many(2) as [string, string];
    const year = between(p.random, 1900, 2099);
    const first = `${body(one)} in ${year}.`;
    return {
      blocks: [{ kind: 'paragraph', sentences: [first, two] }],
      extra: (_doc, got) =>
        got.units.length === 2
          ? undefined
          : `${got.units.length} units: the full stop after ${year} before a capital word must end the sentence`,
    };
  }),
  'double-backtick-code-masked': cutRun((ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const [one, two] = p.many(2) as [string, string];
    const code = `\`\`${capital(word(r))}. ${capital(word(r))} ${word(r)}\`\``;
    const first = `${body(one)} with ${code} near the ${word(r)}.`;
    return {
      blocks: [{ kind: 'paragraph', sentences: [first, two] }],
      extra: (_doc, got) =>
        got.units[0]?.text.includes(code)
          ? undefined
          : `the first unit ${show(got.units[0]?.text ?? '')} does not hold the code span ${show(code)}: a full stop inside it ended the sentence`,
    };
  }),
};

/* ----- ids ----- */

type Scanned = ScanResult & { ledger: LedgerView };

/** Scans the files fresh with the perfect labeller, then each later version with the ledger before it. */
async function scans(ctx: ItemContext, versions: readonly SourceFile[][], estateKey?: string) {
  const labeler = perfect();
  const out: Scanned[] = [];
  for (const files of versions) {
    const previous = out.at(-1);
    out.push(
      await scanOk(ctx.sut, {
        files,
        labeler,
        ...(previous ? { previousLedger: previous.ledger.raw } : {}),
        ...(estateKey !== undefined ? { estateKey } : {}),
      }),
    );
  }
  return out;
}

const filesFor = (w: World): SourceFile[] => build(filesOf(w)).files;

/** The count of an event the reader reports for a scan; a reader without counts earns no credit. */
function counted(result: ScanResult, event: string): number {
  if (!result.eventCounts)
    throw new Problem(`the reader does not expose event counts: the ${event} count is read from them`);
  return result.eventCounts[event] ?? 0;
}

/** The live entry of a text in one file. */
const liveIn = (ledger: LedgerView, path: string, text: string): LedgerEntry | undefined =>
  liveOf(ledger).find((entry) => entry.path === path && norm(entry.quote, entry.container) === norm(text));

const ids: Record<string, Run> = {
  'short-text-repeated-in-new-estate-not-moved': async (ctx) => {
    const p = prose(ctx);
    const w = worldOf(p, { files: 3, perFile: 6 });
    const short = `${capital(word(p.random))}.`;
    (w.texts[0] as string[]).splice(2, 0, short);
    const v2 = cloneWorld(w);
    (v2.texts[0] as string[]).splice(2, 1);
    (v2.texts[1] as string[]).splice(3, 0, short);
    (v2.texts[2] as string[]).splice(4, 0, short);
    const [first, second] = (await scans(ctx, [filesFor(w), filesFor(v2)])) as [Scanned, Scanned];
    const old = liveIn(first.ledger, w.paths[0] as string, short);
    if (!old) return fail(`positive witness: the first scan has no entry for the short text ${show(short)}`);
    const now = byId(second.ledger, old.id);
    if (now?.status === 'live')
      return fail(
        `the old id ${old.id} of the short text ${show(short)} is live again in ${now.path}: a short text that the new estate holds twice was followed out of its file`,
      );
    const oldIds = new Set(first.ledger.entries.map((entry) => entry.id));
    for (const path of [w.paths[1], w.paths[2]] as string[]) {
      const copy = liveIn(second.ledger, path, short);
      if (!copy) return fail(`positive witness: ${path} has no live entry for the short text it gained`);
      if (oldIds.has(copy.id))
        return fail(`the copy of the short text in ${path} carries the old id ${copy.id}`);
    }
    return pass('the short text keeps no old id; both copies take fresh ids');
  },
  'deleted-event-counts-live-only': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const w = worldOf(p, { files: 1, perFile: 10 });
    const texts = w.texts[0] as string[];
    const order = texts.map((text) => ({ text, at: r() })).sort((a, b) => a.at - b.at);
    const firstCut = between(r, 1, 2);
    const secondCut = between(r, 1, 3);
    const removed2 = new Set(order.slice(0, firstCut).map((x) => x.text));
    const removed3 = new Set(order.slice(firstCut, firstCut + secondCut).map((x) => x.text));
    const v2 = cloneWorld(w);
    v2.texts[0] = texts.filter((text) => !removed2.has(text));
    const v3 = cloneWorld(v2);
    v3.texts[0] = (v2.texts[0] as string[]).filter((text) => !removed3.has(text));
    const [, second, third] = (await scans(ctx, [filesFor(w), filesFor(v2), filesFor(v3)])) as [
      Scanned,
      Scanned,
      Scanned,
    ];
    const two = counted(second, 'deleted');
    if (two !== firstCut) return fail(`the second scan removed ${firstCut} units and counts ${two} deleted`);
    const three = counted(third, 'deleted');
    return three === secondCut
      ? pass(`each scan counts the ${firstCut} and ${secondCut} units it removed`)
      : fail(
          `the third scan removed ${secondCut} units and counts ${three} deleted: the units an earlier scan deleted were counted again`,
        );
  },
  'estate-key-in-id': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const w = worldOf(p, { files: 2, perFile: 5 });
    const files = filesFor(w);
    const key = `estate-${word(r)}-${between(r, 10, 99)}`;
    const other = `${key}-${word(r)}`;
    const idsUnder = async (estateKey: string): Promise<Map<string, string>> => {
      const [result] = (await scans(ctx, [files], estateKey)) as [Scanned];
      const keyOf = (entry: LedgerEntry) => `${entry.path}\0${norm(entry.quote, entry.container)}`;
      return new Map(liveOf(result.ledger).map((entry) => [keyOf(entry), entry.id]));
    };
    const one = await idsUnder(key);
    const two = await idsUnder(key);
    const three = await idsUnder(other);
    if (one.size === 0) return fail('positive witness: the scan has no live entry');
    for (const [text, id] of one) {
      if (two.get(text) !== id)
        return fail(`two scans under the estate key ${key} give one text the ids ${id} and ${two.get(text)}`);
    }
    const shared = [...three.values()].filter((id) => [...one.values()].includes(id));
    return shared.length === 0
      ? pass(`the keys ${key} and ${other} give ${one.size} texts disjoint ids`)
      : fail(
          `the estate keys ${key} and ${other} give ${shared.length} of ${one.size} units the same id: the key is not part of the id`,
        );
  },
  'deleted-id-not-reminted': async (ctx) => {
    const p = prose(ctx);
    const w = worldOf(p, { files: 1, perFile: 8 });
    const at = between(p.random, 1, 6);
    const text = (w.texts[0] as string[])[at] as string;
    const v2 = cloneWorld(w);
    (v2.texts[0] as string[]).splice(at, 1);
    const [first, second, third] = (await scans(ctx, [filesFor(w), filesFor(v2), filesFor(w)])) as [
      Scanned,
      Scanned,
      Scanned,
    ];
    const was = liveByText(first.ledger, text);
    if (!was) return fail(`positive witness: the first scan has no entry for ${show(text)}`);
    const gone = byId(second.ledger, was.id);
    if (!gone || gone.status === 'live')
      return fail(`positive witness: after the unit was removed its id ${was.id} is not a deleted entry`);
    const ledger = third.ledger;
    const now = liveByText(ledger, text);
    if (!now) return fail(`positive witness: the text written back has no live entry: ${show(text)}`);
    if (now.id === was.id)
      return fail(
        `the text written back took its deleted id ${was.id} again: the id of a deleted unit was minted a second time`,
      );
    const old = byId(ledger, was.id);
    if (!old) return fail(`the deleted entry ${was.id} left the ledger`);
    return old.status === 'live'
      ? fail(`the deleted entry ${was.id} is live again`)
      : pass('the text written back takes a fresh id; the old id stays deleted');
  },
};

/* ----- re-anchoring ----- */

/** Two files of four kept units; the old units of each case stand between the second and the third. */
function twoFiles(p: Prose, before: [string[], string[]], after: [string[], string[]]) {
  const w = worldOf(p, { files: 2, perFile: 4 });
  const v2 = cloneWorld(w);
  for (const f of [0, 1]) {
    const kept = w.texts[f] as string[];
    w.texts[f] = [...kept.slice(0, 2), ...(before[f] as string[]), ...kept.slice(2)];
    v2.texts[f] = [...kept.slice(0, 2), ...(after[f] as string[]), ...kept.slice(2)];
  }
  return { w, v2 };
}

/** Draws until the case holds, so the measured property is never assumed. */
function draw<T>(what: string, make: () => T | undefined): T {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const made = make();
    if (made !== undefined) return made;
  }
  throw new Problem(`the generator found no ${what} for this seed`);
}

const reanchoring: Record<string, Run> = {
  'context-window-24': async (ctx) => {
    const p = prose(ctx);
    const w = worldOf(p, { files: 1, perFile: 8 });
    const files = filesFor(w);
    const text = (files[0] as SourceFile).text;
    const [result] = (await scans(ctx, [files])) as [Scanned];
    requireSourceWitness(result, files);
    const live = liveOf(result.ledger);
    for (const entry of live) {
      if (!entry.hint) return fail(`the entry ${entry.id} has no hint: its place is not recorded`);
      const prefix = text.slice(Math.max(0, entry.hint.start - 24), entry.hint.start);
      const suffix = text.slice(entry.hint.end, entry.hint.end + 24);
      if (entry.prefix !== prefix)
        return fail(
          `the prefix of ${entry.id} is ${show(entry.prefix)}, expected the 24 code units before it ${show(prefix)}`,
        );
      if (entry.suffix !== suffix)
        return fail(
          `the suffix of ${entry.id} is ${show(entry.suffix)}, expected the 24 code units after it ${show(suffix)}`,
        );
    }
    return pass(`${live.length} entries keep 24 code units of context on each side`);
  },
  'split-needs-margin': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    // The near tie: the unit loses its last word to a sentence of its own.
    const near = draw('near split', () => {
      const base = p.next(longMake);
      const tail = word(r);
      const old = `${body(base)} ${tail}.`;
      const pieces = [base, `${capital(tail)}.`] as const;
      const joined = similarity(old, `${pieces[0]} ${pieces[1]}`);
      const alone = Math.max(similarity(old, pieces[0]), similarity(old, pieces[1]));
      const gain = joined - alone;
      return joined >= 0.75 && gain >= 0.02 && gain <= 0.07 ? { old, pieces } : undefined;
    });
    // The clear cut: a unit of two clauses becomes two sentences.
    const clear = draw('clear split', () => {
      const [a, b] = [sentence(r), sentence(r)];
      const old = `${body(a)}, and ${lowerFirst(b)}`;
      const joined = similarity(old, `${a} ${b}`);
      const alone = Math.max(similarity(old, a), similarity(old, b));
      return joined >= 0.9 && alone >= 0.45 && alone <= 0.62 ? { old, pieces: [a, b] as const } : undefined;
    });
    const { w, v2 } = twoFiles(p, [[near.old], [clear.old]], [[...near.pieces], [...clear.pieces]]);
    const [first, second] = (await scans(ctx, [filesFor(w), filesFor(v2)])) as [Scanned, Scanned];
    const nearOld = liveIn(first.ledger, w.paths[0] as string, near.old);
    const clearOld = liveIn(first.ledger, w.paths[1] as string, clear.old);
    if (!nearOld || !clearOld) return fail('positive witness: the first scan has no entry for an old unit');
    const nearNow = byId(second.ledger, nearOld.id);
    if (nearNow?.status !== 'live' || norm(nearNow.quote) !== norm(near.pieces[0]))
      return fail(
        `the unit that lost its last word does not keep its id on the longer piece ${show(near.pieces[0])}`,
      );
    const clearNow = byId(second.ledger, clearOld.id);
    if (clearNow?.status !== 'live' || !clear.pieces.some((piece) => norm(piece) === norm(clearNow.quote)))
      return fail('the unit cut in two does not keep its id on one of its pieces');
    const split = counted(second, 'split');
    const changed = counted(second, 'changed');
    return split === 1 && changed === 1
      ? pass('the clear cut is split; the near tie is changed')
      : fail(
          `the rescan counts ${split} split and ${changed} changed, expected 1 and 1: two pieces that read barely better together than the longer piece alone are not a split`,
        );
  },
  'merge-needs-margin': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    // The near merge: one sentence that reads like the join of two units, far from either alone.
    const near = draw('near merge', () => {
      const [a, b] = [sentence(r), sentence(r)];
      const join = `${a} ${b}`;
      const words = `${body(a)}, and ${lowerFirst(body(b))}`.split(' ');
      const slots = words
        .map((text, at) => ({ text, at }))
        .filter(({ text, at }) => at > 0 && /^[a-z]{4,}$/.test(text))
        .sort(() => r() - 0.5);
      for (const slot of slots) {
        words[slot.at] = `${word(r)}${r() < 0.5 ? 'ish' : 'ery'}`;
        const into = `${words.join(' ')}.`;
        const joined = similarity(join, into);
        if (joined > 0.64) continue;
        const alone = Math.max(similarity(a, into), similarity(b, into));
        if (joined < 0.5 || alone >= 0.36 || joined - alone < 0.15) return undefined;
        return { a, b, into };
      }
      return undefined;
    });
    const clear = draw('clear merge', () => {
      const [a, b] = [sentence(r), sentence(r)];
      const into = `${body(a)}, and ${lowerFirst(b)}`;
      const joined = similarity(`${a} ${b}`, into);
      const alone = Math.max(similarity(a, into), similarity(b, into));
      return joined >= 0.9 && alone >= 0.45 && alone <= 0.62 ? { a, b, into } : undefined;
    });
    const { w, v2 } = twoFiles(
      p,
      [
        [near.a, near.b],
        [clear.a, clear.b],
      ],
      [[near.into], [clear.into]],
    );
    const [first, second] = (await scans(ctx, [filesFor(w), filesFor(v2)])) as [Scanned, Scanned];
    const oldOf = (path: string, text: string) => {
      const entry = liveIn(first.ledger, path, text);
      if (!entry) throw new Problem(`positive witness: the first scan has no entry for ${show(text)}`);
      return entry.id;
    };
    const [one, two] = [w.paths[0], w.paths[1]] as [string, string];
    const nearIds = [oldOf(one, near.a), oldOf(one, near.b)];
    for (const id of nearIds) {
      const now = byId(second.ledger, id);
      if (now?.status === 'live')
        return fail(
          `the old id ${id} lives on with ${show(now.quote)}: two units whose join reads like the new sentence at no more than 0.64 were merged`,
        );
    }
    const intoNear = liveIn(second.ledger, one, near.into);
    if (!intoNear) return fail('positive witness: the new sentence has no live entry');
    if (first.ledger.entries.some((entry) => entry.id === intoNear.id))
      return fail(`the new sentence carries the old id ${intoNear.id}`);
    const clearIds = [oldOf(two, clear.a), oldOf(two, clear.b)];
    const survivors = clearIds.filter((id) => {
      const now = byId(second.ledger, id);
      return now?.status === 'live' && norm(now.quote) === norm(clear.into);
    });
    return survivors.length === 1
      ? pass('the near join keeps no old id; the clear join is merged into one of its two ids')
      : fail(`${survivors.length} of the two joined ids live on with the joined text, expected one`);
  },
  'ambiguous-claims-every-copy': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const w = worldOf(p, { files: 1, perFile: 6 });
    const kept = w.texts[0] as string[];
    const twin = p.unrelatedTo(kept, 0.3, longMake);
    const reworded = draw('reworded twin', () => {
      const words = twin.replace(/\.$/, '').split(' ');
      const slots = words
        .map((text, at) => ({ text, at }))
        .filter(({ text, at }) => at > 0 && /^[a-z]{4,}$/.test(text));
      const slot = slots[Math.floor(r() * slots.length)];
      if (!slot) return undefined;
      words[slot.at] = word(r);
      const made = `${words.join(' ')}.`;
      return made !== twin && similarity(made, twin) >= 0.85 ? made : undefined;
    });
    w.texts[0] = [...kept.slice(0, 2), twin, kept[2] as string, reworded, ...kept.slice(3)];
    const v2 = cloneWorld(w);
    v2.texts[0] = [twin, ...kept, twin];
    const [first, second] = (await scans(ctx, [filesFor(w), filesFor(v2)])) as [Scanned, Scanned];
    const path = w.paths[0] as string;
    const old = liveIn(first.ledger, path, reworded);
    if (!old) return fail('positive witness: the first scan has no entry for the reworded unit');
    const copies = liveOf(second.ledger).filter(
      (entry) => entry.path === path && norm(entry.quote) === norm(twin),
    );
    if (copies.length !== 2)
      return fail(`positive witness: ${copies.length} live copies of the text, expected two`);
    const now = byId(second.ledger, old.id);
    if (now?.status === 'live')
      return fail(
        `the id ${old.id} of the removed reworded unit lives on with ${show(now.quote)}: a copy of a text that now stands twice was left for another old unit to claim`,
      );
    return pass('both copies stay with the ambiguous text; the removed unit keeps no id');
  },
};

export const HARDENING_BUGS_A_RUNS: Record<string, Record<string, Run>> = {
  cutting,
  ids,
  're-anchoring': reanchoring,
};
