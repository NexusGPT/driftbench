import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERIFY_CASES } from '../../src/ladders/variables/bank/families/verify';
import type { FileCase } from '../../src/ladders/variables/bank/files';
import { contextFor, runItem, variablesBank } from '../../src/ladders/variables/bank/index';
import type {
  FileIssue,
  FileProvenance,
  FileStore,
  VariablesImpl,
} from '../../src/ladders/variables/interface';

/**
 * Adapters that read requests and remember earlier ones, and that never compare a quote with the text of a file.
 * A missing file is answered from the list of files, which is a fact of the request. They must pass 0 quote items.
 * The first is the scene-pairing adapter of the review of the second variables bank: a missing-file request that
 * carried the altered quote named the altered quote for the present-file requests of its scene.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SEEDS = [...Array.from({ length: 20 }, (_, i) => i + 1), 820020691, 360920726];
const bank = variablesBank();
const items = bank.filter((i) => i.stem in VERIFY_CASES);

type Entry = { path: string; at: string; quote: string; file: string };

/** Every quote entry of a store, in the order the page walks a store, with its dotted path. */
function entries(store: FileStore): Entry[] {
  const out: Entry[] = [];
  const visit = (list: FileProvenance[] | undefined, at: string) => {
    for (const [k, e] of (list ?? []).entries())
      if (e.kind === 'quote')
        out.push({ path: `${at}.${k}`, at: `${at}.${k}`, quote: e.quote, file: e.path });
  };
  for (const [i, v] of store.variables.entries()) {
    visit(v.provenance, `variables.${i}.provenance`);
    for (const [m, x] of v.values.entries()) visit(x.provenance, `variables.${i}.values.${m}.provenance`);
    for (const [b, bd] of (v.boundaries ?? []).entries())
      visit(bd.provenance, `variables.${i}.boundaries.${b}.provenance`);
  }
  for (const [c, k] of (store.constraints ?? []).entries())
    visit(k.provenance, `constraints.${c}.provenance`);
  return out;
}

const unreadable = (e: Entry): FileIssue => ({ code: 'VARIABLES_SOURCE_UNREADABLE', path: `${e.at}.path` });
const missingNotFound = (e: Entry): FileIssue => ({
  code: 'VARIABLES_QUOTE_NOT_FOUND',
  path: `${e.at}.quote`,
});

type Verdict = (e: Entry, store: FileStore, files: Record<string, string>) => boolean;

/** An adapter that answers a missing file from the file list (once per file) and asks `verdict` for the rest. */
function adapter(verdict: Verdict): Partial<VariablesImpl> {
  return {
    quotes(store, files) {
      const errors: FileIssue[] = [];
      const reported = new Set<string>();
      for (const e of entries(store)) {
        if (!Object.hasOwn(files, e.file)) {
          if (!reported.has(e.file)) {
            reported.add(e.file);
            errors.push(unreadable(e));
          }
        } else if (!verdict(e, store, files)) errors.push(missingNotFound(e));
      }
      return { errors };
    },
  };
}

/** A fair coin from a hash of the store: the same store always gets the same flip. */
const flipOf = (text: string): boolean => ((createHash('sha256').update(text).digest()[0] ?? 0) & 1) === 0;
const coin = (seed: number) => (_e: Entry, store: FileStore) => flipOf(`${seed}:${JSON.stringify(store)}`);

/** The reviewer's scene-pairing adapter, written for this port. Scenes are keyed by the agent of the store. */
function scenePairing(): Partial<VariablesImpl> {
  type Scene = { missing?: string; said: Map<string, boolean> };
  const scenes = new Map<string, Scene>();
  return {
    quotes(store, files) {
      const e = entries(store)[0];
      if (!e) return { errors: [] };
      const scene: Scene = scenes.get(store.agent) ?? { said: new Map<string, boolean>() };
      scenes.set(store.agent, scene);
      if (!Object.hasOwn(files, e.file)) {
        scene.missing = e.quote;
        return { errors: [unreadable(e)] };
      }
      let good: boolean;
      if (scene.missing !== undefined) good = e.quote !== scene.missing;
      else if (scene.said.has(e.quote)) good = scene.said.get(e.quote) as boolean;
      else if (scene.said.size > 0) good = !([...scene.said.values()][0] as boolean);
      else good = flipOf(JSON.stringify(store));
      scene.said.set(e.quote, good);
      return { errors: good ? [] : [missingNotFound(e)] };
    },
  };
}

/** A quote that was seen in a request whose file was absent is the altered one. */
function absentMemory(seed: number): Partial<VariablesImpl> {
  const absent = new Set<string>();
  const seen = new Set<string>();
  const flip = coin(seed);
  return {
    quotes(store, files) {
      const errors: FileIssue[] = [];
      const reported = new Set<string>();
      for (const e of entries(store)) {
        if (!Object.hasOwn(files, e.file)) {
          absent.add(e.quote);
          if (!reported.has(e.file)) {
            reported.add(e.file);
            errors.push(unreadable(e));
          }
        } else if (absent.has(e.quote) || (seen.has(e.quote) && !flip(e, store)))
          errors.push(missingNotFound(e));
        else if (!seen.has(e.quote) && !flip(e, store)) errors.push(missingNotFound(e));
        seen.add(e.quote);
      }
      return { errors };
    },
  };
}

/** A length cue: a quote longer than the modal length of the quotes seen so far is altered, otherwise a coin. */
function lengthCue(seed: number): Partial<VariablesImpl> {
  const lengths: number[] = [];
  const flip = coin(seed);
  return adapter((e, store) => {
    lengths.push(e.quote.length);
    const sorted = [...lengths].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] as number;
    return e.quote.length === median ? flip(e, store) : e.quote.length <= median;
  });
}

/** A look-alike cue: a quote that shares a long prefix with a different earlier quote is altered, otherwise a coin. */
function lookAlike(seed: number): Partial<VariablesImpl> {
  const earlier: string[] = [];
  const flip = coin(seed);
  return adapter((e, store) => {
    const twin = earlier.some((q) => q !== e.quote && q.slice(0, 12) === e.quote.slice(0, 12));
    earlier.push(e.quote);
    return twin ? false : flip(e, store);
  });
}

/** A within-request cue: the longer of two near-identical quotes of one store is altered. */
const withinRequest = (seed: number) =>
  adapter((e, store) => {
    const twins = entries(store).filter(
      (o) => o.quote !== e.quote && o.quote.slice(0, 10) === e.quote.slice(0, 10),
    );
    return twins.some((o) => o.quote.length < e.quote.length) ? false : coin(seed)(e, store);
  });

/**
 * A shape cue: unfold the quote and find out whether it still has the shape of one of the bank's sentences. A
 * quote whose own words are broken looks different from one that is whole. It never reads the file.
 */
const WORD = '[a-z]+';
const SHAPES = [
  `^when the ${WORD} is ${WORD}, don't tell the "${WORD}" at the caf\u00e9 about ${WORD}_x\\* again\\.$`,
  `^if a ${WORD} is ${WORD} then don't send the "${WORD}" to the caf\u00e9 before ${WORD}_x\\*\\.$`,
  `^never let the ${WORD} near the caf\u00e9; don't forget "${WORD}" and ${WORD}_x\\* with the ${WORD} today\\.$`,
  `^at the caf\u00e9 the ${WORD} is ${WORD}_x\\*, so don't read "${WORD}" aloud to the ${WORD}\\.$`,
  `^ask the ${WORD}, then the ${WORD}, and don't use the "${WORD}" or ${WORD}_x\\* at the caf\u00e9\\.$`,
  `^please don't mix ${WORD} with "${WORD}" at the caf\u00e9 unless ${WORD}_x\\* says ${WORD} again\\.$`,
].map((source) => new RegExp(source, 'i'));
const unfold = (text: string) =>
  text
    .normalize('NFC')
    .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '')
    .replace(/\\([_*])/g, '$1')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ');
const shapeCue = () => adapter((e) => SHAPES.some((shape) => shape.test(unfold(e.quote))));

/** Present-file requests only, and no memory: the file list plus a coin. */
const freeCue = (seed: number) => adapter(coin(seed));

const ADAPTERS: Record<string, (seed: number) => Partial<VariablesImpl>> = {
  'scene pairing by agent (the review of the second bank)': () => scenePairing(),
  'a quote seen with an absent file is altered': (seed) => absentMemory(seed),
  'the length of the quote': lengthCue,
  'a look-alike of an earlier quote': lookAlike,
  'a near-identical quote in the same store': withinRequest,
  'the shape of the quote': shapeCue,
  'the file list plus a coin': freeCue,
};

describe('quote items against adapters that read requests and remember earlier ones', () => {
  for (const [name, make] of Object.entries(ADAPTERS)) {
    it(`pass 0 items: ${name}`, async () => {
      let passes = 0;
      const passing: string[] = [];
      for (const seed of SEEDS) {
        const impl = make(seed);
        for (const item of items) {
          if ((await runItem(item, seed, ROOT, impl)).pass) {
            passes += 1;
            passing.push(`${item.id}@${seed}`);
          }
        }
      }
      expect(passing, `${name}: ${passes} of ${items.length * SEEDS.length}`).toEqual([]);
    }, 120_000);
  }
});

describe('the requests of a quote item', () => {
  const requestsOf = (id: string, seed: number): FileCase[] => {
    const item = bank.find((i) => i.id === id);
    if (!item) throw new Error(id);
    const build = VERIFY_CASES[item.stem] as (
      variant: string,
      ctx: ReturnType<typeof contextFor>,
    ) => FileCase[];
    return build(id.slice(item.stem.length + 1), contextFor(item, seed, ROOT, {}));
  };

  it('share no quote, no agent and no path, so no request names another', () => {
    for (const item of items) {
      for (const seed of [1, 2, 20]) {
        const cases = requestsOf(item.id, seed).filter(
          (c): c is Extract<FileCase, { op: 'quotes' }> => c.op === 'quotes',
        );
        const quotes = cases.flatMap((c) => entries(c.store).map((e) => e.quote));
        expect(new Set(quotes).size, `${item.id} on seed ${seed}`).toBe(quotes.length);
        const agents = cases.map((c) => c.store.agent);
        expect(new Set(agents).size, `${item.id} on seed ${seed}`).toBe(agents.length);
        const paths = cases.flatMap((c) => entries(c.store).map((e) => e.file));
        expect(new Set(paths).size, `${item.id} on seed ${seed}`).toBeGreaterThanOrEqual(cases.length);
      }
    }
  });

  it('leave a guess on at least 40 quotes whose file is present, so the floor of the best such adapter is 2 to the minus 40 per item', () => {
    for (const item of items) {
      const cases = requestsOf(item.id, 1).filter(
        (c): c is Extract<FileCase, { op: 'quotes' }> => c.op === 'quotes',
      );
      const guesses = cases.flatMap((c) => entries(c.store).filter((e) => Object.hasOwn(c.files, e.file)));
      expect(guesses.length, item.id).toBeGreaterThanOrEqual(40);
    }
  });

  it('hold the quote as well as the altered text in files that are found and files that are not', () => {
    // A quote looks the same whether it is found: every item has requests of both classes with a file present.
    for (const item of items) {
      const cases = requestsOf(item.id, 1).filter(
        (c): c is Extract<FileCase, { op: 'quotes' }> => c.op === 'quotes' && c.want.kind === 'issues',
      );
      const found = cases.filter((c) => c.want.kind === 'issues' && c.want.issues.length === 0).length;
      const wrong = cases.filter(
        (c) => c.want.kind === 'issues' && c.want.issues.some((i) => i.code === 'VARIABLES_QUOTE_NOT_FOUND'),
      ).length;
      expect(found, item.id).toBeGreaterThanOrEqual(12);
      expect(wrong, item.id).toBeGreaterThanOrEqual(12);
    }
  });
});
