import { homedir } from 'node:os';
import { between, rngFor } from '../blocks/harness';
import { need } from '../blocks/product';
import { type BankItem, expectAll, fail, PASS, type Tier } from '../blocks/types';

/**
 * The lane "links2" (blocks validator, board row "Version the blocks validator for links"): items on the links
 * of each block and their readers that the bank's `links` family does not test in the case written here. Every
 * item cites docs/reference/block-contracts.md, "Section registry and localize". Levels: 6 (section links).
 *
 * - links2-localize: the spectrum of `radius localize` on stored verdicts a seeded plant writes: the soft weight
 *   of a block (failed rows over rows), a stale link that adds nothing, stale and global sections not ranked, and
 *   the score of every section against the formula computed apart.
 * - links2-schema: `spec validate` on `metadata.links`: the exact path of LINK_BLOCK_UNKNOWN, a value outside each
 *   list refused under `metadata.links`, an absent `block` meaning every block, and links out of the spec hash
 *   whatever field changes.
 *
 * The maintainer joins them to the bank by one registration line in `blocks/bank.ts`.
 */

const LOCALIZE = 'packages/core/src/radius/localize.ts';
const LINKS = 'packages/core/src/radius/links.ts';
const SCHEMA = 'packages/core/src/schema/links.ts';
const IDENTITY = 'packages/core/src/spec/identity.ts';
const SEMANTICS = 'packages/core/src/spec/semantics.ts';
const CONTRACT = 'docs/reference/block-contracts.md, "Section registry and localize"';

function item(
  id: string,
  family: string,
  tier: Tier,
  component: string,
  title: string,
  cause: string,
  check: BankItem['check'],
): BankItem {
  return {
    id: `links2/${id}`,
    family,
    tier,
    level: 6,
    component,
    title: `${title} (${CONTRACT})`,
    cause,
    check: (context) => neutralProcess(() => check(context)),
  };
}

/**
 * Runs a check as a neutral program sees itself: argv `node app`, no node options, the home folder as the
 * working folder. A product that reads how it is being run (audit of links2, cheater: argv, execArgv and
 * temporary-folder sniffing) sees nothing of the validator. Items run one at a time, so the swap is safe.
 */
async function neutralProcess<T>(run: () => Promise<T>): Promise<T> {
  const argv = process.argv;
  const execArgv = process.execArgv;
  const cwd = process.cwd;
  const home = homedir();
  process.argv = [argv[0] as string, 'app'];
  process.execArgv = [];
  process.cwd = () => home;
  try {
    return await run();
  } finally {
    process.argv = argv;
    process.execArgv = execArgv;
    process.cwd = cwd;
  }
}

/**
 * A name drawn from the seed and the tag, with no fixed prefix, a seeded length of 3 to 20 characters and
 * every character an id may hold (a letter or digit first, then letters of both cases, digits, dots,
 * underscores and hyphens): no product can tell the items' prompts, specs, blocks or sections apart from a
 * user's by their shape (audit of links2, cheater rounds 1 and 2: fixture-name, id-pattern, dash and
 * id-length matching).
 */
export function neutralName(seed: number, tag: string): string {
  const rng = rngFor(seed, `name:${tag}`);
  const first = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rest = `${first}._-`;
  const length = 3 + Math.floor(rng() * 18);
  let out = first[Math.floor(rng() * first.length)] as string;
  while (out.length < length) out += rest[Math.floor(rng() * rest.length)];
  return out;
}

/**
 * A status that covers, drawn from the seed: `declared`, `attributed` and `verified` links all cover their
 * section (planted-bug audit round 2: a product that counts only `declared` passed every item).
 */
function covering(seed: number, tag: string): string {
  return (['declared', 'attributed', 'verified'] as const)[between(rngFor(seed, `status:${tag}`), 0, 2)];
}

/** A spec count and a block count drawn from the seed: the inputs carry no fixed shape (cheater round 2). */
function shapeOf(seed: number, tag: string, specs: [number, number], blocks: [number, number]) {
  const rng = rngFor(seed, `shape:${tag}`);
  return { specs: between(rng, specs[0], specs[1]), blocks: between(rng, blocks[0], blocks[1]) };
}

// ---------------------------------------------------------------------------------------------------------
// A spec of n blocks whose block b links to its own section s<b> and, by a link with no block, to a spec
// section; a registry that holds them; stored runs where the plant decides which blocks fail on which repeat.

type Link = {
  block?: string | number;
  to: { kind: 'prompt_section'; prompt: string; section: string };
  status: string;
};

type World = {
  specs: Array<{
    id: string;
    blocks: Array<{ id: string; user: string; expect: { must: string[] } }>;
    metadata: { links: Link[] };
  }>;
  registry: Record<string, unknown> & { sections: Array<Record<string, unknown>> };
  own: string[][];
  wide: string[];
  global: string;
  prompt: string;
  agent: string;
};

const span = (at: number) => ({ start: at * 20, end: at * 20 + 10 });
const hex = '0'.repeat(64);

function world(seed: number, tag: string, specs: number, blocks: number, form: 'id' | 'index' = 'id'): World {
  // Every name of one world is distinct, whatever its case: a drawn name already taken is drawn again.
  const taken = new Set<string>();
  const name = (what: string) => {
    for (let again = 0; ; again += 1) {
      const drawn = neutralName(seed, `${tag}${what}#${again}`);
      if (!taken.has(drawn.toLowerCase())) {
        taken.add(drawn.toLowerCase());
        return drawn;
      }
    }
  };
  const own = Array.from({ length: specs }, (_, s) =>
    Array.from({ length: blocks }, (_, b) => name(`own${s}.${b}`)),
  );
  const wide = Array.from({ length: specs }, (_, s) => name(`wide${s}`));
  const global = name('global');
  const prompt = name('prompt');
  const agent = name('agent');
  const ids = [...own.flat(), ...wide, global];
  const registry = {
    prompt_id: prompt,
    version: 'v1',
    text_sha256: hex,
    sections: ids.map((id, at) => ({
      id,
      scope: id === global ? 'global' : 'local',
      span: span(at),
      sha256: hex,
      anchor: { quote: id },
    })),
  };
  const specList = own.map((sections, s) => {
    const id = name(`spec${s}`);
    const blockIds = sections.map((_, b) => name(`block${s}.${b}`));
    return {
      id,
      blocks: blockIds.map((blockId, b) => ({
        id: blockId,
        user: `Step ${b + 1} of ${id}.`,
        expect: { must: ['ok'] },
      })),
      metadata: {
        links: [
          ...blockIds.map((blockId, b) => ({
            block: form === 'id' ? blockId : b,
            to: { kind: 'prompt_section' as const, prompt, section: sections[b] as string },
            status: covering(seed, `${tag}status${s}.${b}`),
          })),
          {
            to: { kind: 'prompt_section' as const, prompt, section: wide[s] as string },
            status: covering(seed, `${tag}status${s}`),
          },
        ],
      },
    };
  });
  return { specs: specList, registry, own, wide, global, prompt, agent };
}

/** Stored runs, mode T: `fails(s, b, repeat)` says whether block b of spec s fails on that repeat. */
function runsOf(
  product: Parameters<BankItem['check']>[0]['product'],
  w: World,
  repeats: number,
  fails: (s: number, b: number, repeat: number) => boolean,
  mode: Mode = 'T',
) {
  const specHash = need<(spec: unknown) => string>(product.core, 'core', 'specHash');
  const loaded = w.specs.map((raw) => loadSpec(product, raw));
  return {
    loaded,
    runs: loaded.flatMap((spec, s) =>
      Array.from({ length: repeats }, (_, repeat) => ({
        runId: `${spec.id}-${repeat}`,
        specId: spec.id,
        specHash: specHash(spec),
        mode,
        repeat,
        target: { adapter: 'function', agent: w.agent },
        status: 'completed',
        blocks: (spec.blocks as unknown[]).map((_, b) => {
          const failed = fails(s, b, repeat);
          return { index: b, pass: !failed, status: failed ? 'fail' : 'pass', verdicts: [], drift: [] };
        }),
      })),
    ),
  };
}

function loadSpec(
  product: Parameters<BankItem['check']>[0]['product'],
  raw: unknown,
): Record<string, unknown> & { id: string; blocks: unknown[] } {
  const validateSpec = need<
    (raw: unknown, path?: string) => { ok: boolean; spec?: unknown; errors?: unknown }
  >(product.core, 'core', 'validateSpec');
  const result = validateSpec(raw, 'links2');
  if (!result.ok)
    throw new Error(`the item's spec is refused: ${JSON.stringify(result.errors).slice(0, 200)}`);
  return result.spec as Record<string, unknown> & { id: string; blocks: unknown[] };
}

type Mode = 'T' | 'F' | 'P';

type Ranked = {
  sections: Array<{ section: string; score: number; linked: number; best: number; worst: number }>;
  failureWeight: number;
  inherited: number;
};

/**
 * Whether block b of spec s failed in run r only because an earlier block of its conversation failed in that
 * run: in modes F and P a block inherits every earlier block of its spec, in mode T it inherits nothing.
 */
function inheritedAt(
  fails: (s: number, b: number, repeat: number) => boolean,
  mode: Mode,
  s: number,
  b: number,
  r: number,
): boolean {
  if (mode === 'T' || !fails(s, b, r)) return false;
  for (let a = 0; a < b; a += 1) if (fails(s, a, r)) return true;
  return false;
}

/** The inherited failures the plant makes: failures dropped, never rows. */
function inheritedOf(
  w: World,
  repeats: number,
  fails: (s: number, b: number, repeat: number) => boolean,
  mode: Mode,
): number {
  let count = 0;
  w.specs.forEach((spec, s) => {
    spec.blocks.forEach((_, b) => {
      for (let r = 0; r < repeats; r += 1) if (inheritedAt(fails, mode, s, b, r)) count += 1;
    });
  });
  return count;
}

/**
 * The documented score of every local, live section, from the plant: weight = failed rows / rows, where an
 * inherited failure is no row and a block that passes after a failing one stays a row.
 */
function reference(
  w: World,
  repeats: number,
  fails: (s: number, b: number, repeat: number) => boolean,
  covers: (s: number, b: number) => string[],
  ranked: (section: string) => boolean,
  mode: Mode = 'T',
): Map<string, Want> {
  const weights: Array<{ w: number; sections: string[] }> = [];
  w.specs.forEach((spec, s) => {
    spec.blocks.forEach((_, b) => {
      let failed = 0;
      let rows = 0;
      for (let r = 0; r < repeats; r += 1) {
        if (inheritedAt(fails, mode, s, b, r)) continue;
        rows += 1;
        if (fails(s, b, r)) failed += 1;
      }
      if (rows > 0) weights.push({ w: failed / rows, sections: covers(s, b) });
    });
  });
  const total = weights.reduce((sum, row) => sum + row.w, 0);
  const scores = new Map<string, { score: number; linked: number }>();
  for (const section of (w.registry.sections as Array<{ id: string }>).map((each) => each.id)) {
    if (!ranked(section)) continue;
    let nf = 0;
    let ns = 0;
    let linked = 0;
    for (const row of weights) {
      if (!row.sections.includes(section)) continue;
      nf += row.w;
      ns += 1 - row.w;
      linked += 1;
    }
    scores.set(section, { score: nf === 0 || total === 0 ? 0 : nf / Math.sqrt(total * (nf + ns)), linked });
  }
  // Ties as a rank range: best = 1 + the sections above, worst = the sections above + the tied ones.
  const out = new Map<string, Want>();
  for (const [section, each] of scores) {
    const above = [...scores.values()].filter((other) => other.score > each.score + 1e-12).length;
    const tied = [...scores.values()].filter((other) => Math.abs(other.score - each.score) <= 1e-12).length;
    out.set(section, { ...each, best: above + 1, worst: above + tied });
  }
  return out;
}

function localize(
  product: Parameters<BankItem['check']>[0]['product'],
  loaded: unknown[],
  runs: unknown[],
  registry: unknown,
  mode: Mode = 'T',
): Ranked {
  const localizeRuns = need<
    (specs: unknown[], runs: unknown[], registry: unknown, options: unknown) => { localization: Ranked }
  >(product.core, 'core', 'localizeRuns');
  return localizeRuns(loaded, runs, registry, { mode }).localization;
}

type Want = { score: number; linked: number; best: number; worst: number };

/** The first difference of the ranking from the reference: score (NaN never matches), linked count, ranks. */
function compare(got: Ranked, want: Map<string, Want>): string | undefined {
  for (const [section, expected] of want) {
    const found = got.sections.find((each) => each.section === section);
    if (!found) return `the section ${section} is not ranked`;
    if (!(Math.abs(found.score - expected.score) <= 1e-9))
      return `the section ${section} scores ${Number(found.score).toFixed(6)}, expected ${expected.score.toFixed(6)}`;
    if (found.linked !== expected.linked)
      return `the section ${section} counts ${found.linked} linked blocks, expected ${expected.linked}`;
    if (found.best !== expected.best || found.worst !== expected.worst)
      return `the section ${section} ranks ${found.best} to ${found.worst}, expected ${expected.best} to ${expected.worst}`;
  }
  const extra = got.sections.find((each) => !want.has(each.section));
  return extra ? `the section ${extra.section} is ranked, though it is not a live local section` : undefined;
}

function localizeItems(): BankItem[] {
  const out: BankItem[] = [];
  const family = 'links2-localize';
  // Soft weights: a block fails on some of its repeats only.
  for (const repeats of [2, 3, 4, 5])
    for (const shape of ['one-block', 'two-blocks'] as const) {
      const id = `localize/soft-weight/${repeats}/${shape}`;
      out.push(
        item(
          id,
          family,
          (repeats > 3 ? 3 : 2) as Tier,
          LOCALIZE,
          `a block failing on some of ${repeats} repeats (${shape.replace('-', ' ')}) weighs failed rows over rows, and every section scores as the formula on that weight`,
          'localizeRuns weighs a block by its failed rows over its rows',
          async ({ seed, product }) => {
            const rng = rngFor(seed, id);
            const size = shapeOf(seed, id, [2, 4], [3, 6]);
            const w = world(seed, id, size.specs, size.blocks);
            const plants = Array.from({ length: shape === 'one-block' ? 1 : 2 }, () => ({
              s: between(rng, 0, size.specs - 1),
              b: between(rng, 0, size.blocks - 1),
              on: Array.from({ length: repeats }, () => rng() < 0.5),
            }));
            for (const plant of plants) plant.on[0] = true;
            const fails = (s: number, b: number, r: number) =>
              plants.some((p) => p.s === s && p.b === b && p.on[r] === true);
            const { loaded, runs } = runsOf(product, w, repeats, fails);
            const got = localize(product, loaded, runs, w.registry);
            const want = reference(
              w,
              repeats,
              fails,
              (s, b) => [w.own[s]?.[b] as string, w.wide[s] as string],
              (section) => section !== w.global,
            );
            const diff = compare(got, want);
            return diff ? fail(diff) : PASS;
          },
        ),
      );
    }
  // A stale link adds nothing, in two shapes the contracts2 lane does not test (its stale link sits on a
  // failing block beside a declared one): a stale link on a passing block, and a stale link with no block. A
  // stale section and a global section are not ranked.
  for (const what of [
    'stale-link-passing-block',
    'stale-section',
    'global-section',
    'stale-spec-wide-link',
  ] as const)
    for (const repeats of [1, 3])
      for (const position of ['first', 'last'] as const) {
        const id = `localize/${what}/${repeats}/${position}`;
        out.push(
          item(
            id,
            family,
            (what === 'stale-link-passing-block' ? 3 : 2) as Tier,
            LOCALIZE,
            what === 'stale-link-passing-block'
              ? `a passing block's stale link to the section of the failing block adds no pass weight to it (${position} block, ${repeats} repeats)`
              : what === 'stale-section'
                ? `a section the registry marks stale is not ranked (${position} block, ${repeats} repeats)`
                : what === 'global-section'
                  ? `a block linked to the global section still leaves it unranked (${position} block, ${repeats} repeats)`
                  : `a stale link with no block covers no block of its spec, so its section is charged nothing (${position} block, ${repeats} repeats)`,
            what === 'stale-link-passing-block' || what === 'stale-spec-wide-link'
              ? // The cause sentence of the contracts2 item on stale links: one change makes both pass, so it counts once.
                'radius localize leaves stale links out of the Ochiai counts and reports them as advisory.'
              : what === 'stale-section'
                ? 'localizeRows leaves a stale section out of the ranking'
                : 'localizeRuns lists a global section apart and never ranks it',
            async ({ seed, product }) => {
              const size = shapeOf(seed, id, [2, 4], [3, 6]);
              const w = world(seed, id, size.specs, size.blocks);
              const s = between(rngFor(seed, `${id}-s`), 0, size.specs - 1);
              const b = position === 'first' ? 0 : size.blocks - 1;
              const target = w.own[s]?.[b] as string;
              const spec = w.specs[s] as World['specs'][number];
              let covers = (cs: number, cb: number) => [w.own[cs]?.[cb] as string, w.wide[cs] as string];
              let ranked = (section: string) => section !== w.global;
              if (what === 'stale-link-passing-block') {
                const other = b === 0 ? 1 : 0;
                spec.metadata.links.push({
                  block: spec.blocks[other]?.id,
                  to: { kind: 'prompt_section', prompt: w.prompt, section: target },
                  status: 'stale',
                });
              } else if (what === 'stale-spec-wide-link') {
                const wideLink = spec.metadata.links.find((link) => link.block === undefined);
                if (!wideLink) throw new Error('the spec has no spec-wide link');
                wideLink.status = 'stale';
                covers = (cs, cb) =>
                  cs === s ? [w.own[cs]?.[cb] as string] : [w.own[cs]?.[cb] as string, w.wide[cs] as string];
              } else if (what === 'stale-section') {
                const section = w.registry.sections.find((each) => each.id === target);
                if (section) section.stale = true;
                covers = (cs, cb) =>
                  [w.own[cs]?.[cb] as string, w.wide[cs] as string].filter((id) => id !== target);
                ranked = (section) => section !== w.global && section !== target;
              } else {
                spec.metadata.links.push({
                  block: spec.blocks[b]?.id,
                  to: { kind: 'prompt_section', prompt: w.prompt, section: w.global },
                  status: 'declared',
                });
              }
              const fails = (cs: number, cb: number) => cs === s && cb === b;
              const { loaded, runs } = runsOf(product, w, repeats, fails);
              const got = localize(product, loaded, runs, w.registry);
              const want = reference(w, repeats, fails, covers, ranked);
              const diff = compare(got, want);
              return diff ? fail(diff) : PASS;
            },
          ),
        );
      }
  // A link that names its block by index covers the same block as a link by id.
  for (const repeats of [1, 3])
    for (const plants of [1, 2] as const) {
      const id = `localize/index-links/${repeats}/${plants}`;
      out.push(
        item(
          id,
          family,
          2,
          LOCALIZE,
          `links that name their block by index cover the block of that index: ${plants} failing block(s) over ${repeats} repeats score as the formula`,
          'a link names its block by id or by index, and covers that block alike',
          async ({ seed, product }) => {
            const rng = rngFor(seed, id);
            const size = shapeOf(seed, id, [2, 4], [3, 6]);
            const w = world(seed, id, size.specs, size.blocks, 'index');
            const planted = Array.from({ length: plants }, () => ({
              s: between(rng, 0, size.specs - 1),
              b: between(rng, 1, size.blocks - 1),
            }));
            const fails = (s: number, b: number) => planted.some((p) => p.s === s && p.b === b);
            const { loaded, runs } = runsOf(product, w, repeats, fails);
            const got = localize(product, loaded, runs, w.registry);
            const want = reference(
              w,
              repeats,
              fails,
              (s, b) => [w.own[s]?.[b] as string, w.wide[s] as string],
              (section) => section !== w.global,
            );
            const diff = compare(got, want);
            return diff ? fail(diff) : PASS;
          },
        ),
      );
    }
  // A link to a section of another prompt adds nothing; two links of one block to one section count once.
  for (const what of ['other-prompt-link', 'duplicate-link'] as const)
    for (const repeats of [1, 3])
      for (const position of ['first', 'last'] as const) {
        const id = `localize/${what}/${repeats}/${position}`;
        out.push(
          item(
            id,
            family,
            2,
            LOCALIZE,
            what === 'other-prompt-link'
              ? `a passing block's link to a section of the same id in another prompt adds nothing to that section (${position} block, ${repeats} repeats)`
              : `the failing block's second link to its own section counts once (${position} block, ${repeats} repeats)`,
            what === 'other-prompt-link'
              ? 'radius localize: a link to another prompt adds nothing to the counts'
              : 'radius localize: a block covers a section once, however many of its links name it',
            async ({ seed, product }) => {
              const size = shapeOf(seed, id, [2, 4], [3, 6]);
              const w = world(seed, id, size.specs, size.blocks);
              const s = between(rngFor(seed, `${id}-s`), 0, size.specs - 1);
              const b = position === 'first' ? 0 : size.blocks - 1;
              const target = w.own[s]?.[b] as string;
              const spec = w.specs[s] as World['specs'][number];
              if (what === 'other-prompt-link') {
                const other = b === 0 ? 1 : 0;
                let elsewhere = neutralName(seed, `${id}-elsewhere`);
                if (elsewhere === w.prompt) elsewhere = `${elsewhere}x`;
                spec.metadata.links.push({
                  block: spec.blocks[other]?.id,
                  to: { kind: 'prompt_section', prompt: elsewhere, section: target },
                  status: 'declared',
                });
              } else {
                spec.metadata.links.push({
                  block: spec.blocks[b]?.id,
                  to: { kind: 'prompt_section', prompt: w.prompt, section: target },
                  status: 'declared',
                });
              }
              const fails = (cs: number, cb: number) => cs === s && cb === b;
              const { loaded, runs } = runsOf(product, w, repeats, fails);
              const got = localize(product, loaded, runs, w.registry);
              const want = reference(
                w,
                repeats,
                fails,
                (cs, cb) => [w.own[cs]?.[cb] as string, w.wide[cs] as string],
                (section) => section !== w.global,
              );
              const diff = compare(got, want);
              return diff ? fail(diff) : PASS;
            },
          ),
        );
      }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// The chain items (family links2-localize): the rows of a conversation in modes T and F. In mode F a failure while an earlier block of
// the same run failed is inherited and dropped; a block that passes after a failing one stays a row. In mode T
// every block is a row. Mode P inherits as mode F does.

function chainItems(): BankItem[] {
  const out: BankItem[] = [];
  // One family with the other localize items: the conversation rows are part of the same ranking.
  const family = 'links2-localize';
  const shapes = ['passing-after-failing', 'failing-after-failing', 'mixed'] as const;
  for (const mode of ['T', 'F', 'P'] as const)
    for (const shape of shapes)
      for (const repeats of [1, 3]) {
        const id = `chain/${mode}/${shape}/${repeats}`;
        out.push(
          item(
            id,
            family,
            3,
            LOCALIZE,
            shape === 'passing-after-failing'
              ? `mode ${mode}: a block that passes after a failing block of its conversation stays a row and clears its sections (${repeats} repeats)`
              : shape === 'failing-after-failing'
                ? `mode ${mode}: a block that fails after a failing block of its conversation is ${mode !== 'T' ? 'an inherited failure, dropped and counted' : 'a row of its own'} (${repeats} repeats)`
                : `mode ${mode}: three blocks failing on drawn repeats count rows and inherited failures run by run (${repeats} repeats)`,
            mode !== 'T'
              ? 'radius localize drops a failure when an earlier block of the same conversation failed in the same run, and keeps a block that passes after a failing one as a row'
              : 'radius localize in mode T counts every block as a row: a block starts from its canonical Given and inherits nothing',
            async ({ seed, product }) => {
              const rng = rngFor(seed, id);
              const size = shapeOf(seed, id, [2, 3], [4, 6]);
              const w = world(seed, id, size.specs, size.blocks);
              const s = between(rng, 0, size.specs - 1);
              const first = between(rng, 0, size.blocks - 3);
              const later = between(rng, first + 1, size.blocks - 2);
              const third = size.blocks - 1;
              const draws = Array.from({ length: repeats }, () => [rng() < 0.6, rng() < 0.6, rng() < 0.6]);
              // In the mixed shape the first repeat fails the first block and the last repeat the later one.
              if (draws[0]) draws[0][0] = true;
              const lastDraw = draws[repeats - 1];
              if (lastDraw) lastDraw[1] = true;
              const fails = (cs: number, cb: number, r: number) => {
                if (cs !== s) return false;
                if (shape === 'passing-after-failing') return cb === first;
                if (shape === 'failing-after-failing') return cb === first || cb === later;
                const draw = draws[r] ?? [false, false, false];
                return (cb === first && draw[0]) || (cb === later && draw[1]) || (cb === third && draw[2]);
              };
              const { loaded, runs } = runsOf(product, w, repeats, fails, mode);
              const got = localize(product, loaded, runs, w.registry, mode);
              const want = reference(
                w,
                repeats,
                fails,
                (cs, cb) => [w.own[cs]?.[cb] as string, w.wide[cs] as string],
                (section) => section !== w.global,
                mode,
              );
              const inherited = inheritedOf(w, repeats, fails, mode);
              const diff = compare(got, want);
              if (diff) return fail(diff);
              return got.inherited === inherited
                ? PASS
                : fail(`${got.inherited} inherited failures counted, expected ${inherited}`);
            },
          ),
        );
      }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// links2-schema

function schemaItems(): BankItem[] {
  const out: BankItem[] = [];
  const family = 'links2-schema';
  const issuesOf = (product: Parameters<BankItem['check']>[0]['product'], raw: unknown) => {
    const validateSpec = need<
      (raw: unknown, path?: string) => { ok: boolean; errors?: Array<{ code: string; path: string }> }
    >(product.core, 'core', 'validateSpec');
    const result = validateSpec(raw, 'links2');
    return result.ok ? [] : (result.errors ?? []);
  };
  for (const form of ['id', 'index'] as const)
    for (const at of ['first', 'last'] as const) {
      const id = `schema/block-unknown-path/${form}/${at}`;
      out.push(
        item(
          id,
          family,
          2,
          SEMANTICS,
          `a link whose block (${form}) names no block of the spec is refused with LINK_BLOCK_UNKNOWN at metadata.links.<i>.block (the ${at} link)`,
          'spec validate reports LINK_BLOCK_UNKNOWN at metadata.links.<i>.block',
          async ({ seed, product }) => {
            const w = world(seed, id, 1, shapeOf(seed, id, [1, 1], [3, 6]).blocks);
            const spec = structuredClone(w.specs[0]) as World['specs'][number];
            const index = at === 'first' ? 0 : spec.metadata.links.length - 1;
            (spec.metadata.links[index] as Link).block =
              form === 'id'
                ? neutralName(seed, `${id}none`)
                : spec.blocks.length + between(rngFor(seed, id), 0, 3);
            const issues = issuesOf(product, spec);
            const hit = issues.find((issue) => issue.code === 'LINK_BLOCK_UNKNOWN');
            return hit?.path === `metadata.links.${index}.block`
              ? PASS
              : fail(
                  `LINK_BLOCK_UNKNOWN is at ${hit?.path ?? 'no path'} (codes ${issues.map((i) => i.code).join(', ') || 'none'}), expected metadata.links.${index}.block`,
                );
          },
        ),
      );
    }
  const outside: Array<{
    field: string;
    tier: Tier;
    set(link: Record<string, unknown>, value: string): void;
    values: string[];
  }> = [
    { field: 'relation', tier: 2, set: (l, v) => (l.relation = v), values: ['covers', 'tests'] },
    { field: 'created_by', tier: 2, set: (l, v) => (l.created_by = v), values: ['model', 'verified'] },
    { field: 'status', tier: 1, set: (l, v) => (l.status = v), values: ['trusted', 'Declared'] },
    {
      field: 'to.kind',
      tier: 2,
      set: (l, v) => ((l.to as Record<string, unknown>).kind = v),
      values: ['file', 'section'],
    },
  ];
  for (const entry of outside)
    for (const value of entry.values) {
      const id = `schema/outside/${entry.field}/${value}`;
      out.push(
        item(
          id,
          family,
          entry.tier,
          SCHEMA,
          `a link whose ${entry.field} is "${value}", outside the list, is refused with a path under metadata.links`,
          `spec validate refuses a ${entry.field} outside its list under metadata.links`,
          async ({ seed, product }) => {
            const w = world(seed, id, 1, shapeOf(seed, id, [1, 1], [3, 6]).blocks);
            const spec = structuredClone(w.specs[0]) as World['specs'][number];
            const index = between(rngFor(seed, id), 0, spec.metadata.links.length - 1);
            entry.set(spec.metadata.links[index] as unknown as Record<string, unknown>, value);
            const issues = issuesOf(product, spec);
            return issues.some((issue) => issue.path.startsWith(`metadata.links.${index}`))
              ? PASS
              : fail(
                  `the ${entry.field} "${value}" gave ${issues.map((i) => `${i.code} ${i.path}`).join('; ') || 'no error'}`,
                );
          },
        ),
      );
    }
  // Every value of each list is accepted, beside its twin outside the list.
  const inside: Array<{ field: string; values: readonly string[]; set(link: Link, value: string): void }> = [
    {
      field: 'relation',
      values: ['verifies', 'exercises', 'derived_from', 'observed_in'],
      set: (l, v) => Object.assign(l, { relation: v }),
    },
    {
      field: 'created_by',
      values: ['generator', 'author', 'attribution', 'citation', 'ir', 'mutation'],
      set: (l, v) => Object.assign(l, { created_by: v }),
    },
    {
      field: 'status',
      values: ['declared', 'attributed', 'verified', 'refuted', 'stale'],
      set: (l, v) => Object.assign(l, { status: v }),
    },
    {
      field: 'to.kind',
      values: ['prompt_section', 'spec_clause', 'source_turn'],
      set: (l, v) =>
        Object.assign(l, {
          to:
            v === 'prompt_section'
              ? l.to
              : v === 'spec_clause'
                ? { kind: v, spec: 'policy', clause: 'R-4.2' }
                : { kind: v, conversation: 'c1', turn: 3 },
        }),
    },
  ];
  for (const entry of inside)
    for (const value of entry.values) {
      const id = `schema/inside/${entry.field}/${value}`;
      out.push(
        item(
          id,
          family,
          1,
          SCHEMA,
          `a link whose ${entry.field} is "${value}", a value of the list, is accepted`,
          `spec validate accepts every ${entry.field} of its list`,
          async ({ seed, product }) => {
            const w = world(seed, id, 1, shapeOf(seed, id, [1, 1], [3, 6]).blocks);
            const spec = structuredClone(w.specs[0]) as World['specs'][number];
            const index = between(rngFor(seed, id), 0, spec.metadata.links.length - 1);
            entry.set(spec.metadata.links[index] as Link, value);
            const issues = issuesOf(product, spec);
            return issues.length === 0
              ? PASS
              : fail(`refused: ${issues.map((i) => `${i.code} ${i.path}`).join('; ')}`);
          },
        ),
      );
    }
  // A link without a status, a block index one past the last block or below 0, and a key no link holds are
  // refused under the link.
  const refusals: Array<{
    what: string;
    title: string;
    cause: string;
    change(link: Link, blocks: number): void;
    path: string;
  }> = [
    {
      what: 'status-absent',
      title: 'a link with no status is refused: the status is required',
      cause: 'spec validate requires the status of a link',
      change: (l) => {
        delete (l as Partial<Link>).status;
      },
      path: '',
    },
    {
      what: 'index-one-past',
      title:
        'a link whose block index equals the block count names no block: LINK_BLOCK_UNKNOWN at its block',
      cause: 'spec validate reports LINK_BLOCK_UNKNOWN at metadata.links.<i>.block',
      change: (l, blocks) => Object.assign(l, { block: blocks }),
      path: '.block',
    },
    {
      what: 'index-negative',
      title: 'a link whose block index is below 0 is refused at its block',
      cause: 'spec validate refuses a block index below 0 under metadata.links',
      change: (l) => Object.assign(l, { block: -1 }),
      path: '.block',
    },
    {
      what: 'unknown-key',
      title:
        'a link holding a key outside to, status, block, relation, created_by, at_version and evidence is refused',
      cause: 'spec validate refuses a link key outside its list under metadata.links',
      change: (l) => Object.assign(l, { weight: 2 }),
      path: '',
    },
    {
      what: 'unknown-target-key',
      title: 'a prompt_section target holding a key outside kind, prompt and section is refused',
      cause: 'spec validate refuses a target key outside its list under metadata.links',
      change: (l) => Object.assign(l.to, { heading: 'Refunds' }),
      path: '',
    },
  ];
  for (const refusal of refusals) {
    const id = `schema/refused/${refusal.what}`;
    out.push(
      item(id, family, 2, SCHEMA, refusal.title, refusal.cause, async ({ seed, product }) => {
        const blocks = shapeOf(seed, id, [1, 1], [3, 6]).blocks;
        const w = world(seed, id, 1, blocks);
        const spec = structuredClone(w.specs[0]) as World['specs'][number];
        const index = between(rngFor(seed, id), 0, spec.metadata.links.length - 1);
        const link = spec.metadata.links[index] as Link;
        if (refusal.what.startsWith('index') && link.block === undefined) link.block = 0;
        refusal.change(link, blocks);
        const issues = issuesOf(product, spec);
        const at = `metadata.links.${index}${refusal.path}`;
        return issues.some((issue) => issue.path === at || issue.path.startsWith(`${at}.`))
          ? PASS
          : fail(
              `the change gave ${issues.map((i) => `${i.code} ${i.path}`).join('; ') || 'no error'}, expected an error at ${at}`,
            );
      }),
    );
  }
  // An absent block means every block.
  for (const blocks of [2, 5]) {
    const id = `schema/absent-block-every-block/${blocks}`;
    out.push(
      item(
        id,
        family,
        2,
        LINKS,
        `a link with no block is a link of every one of the ${blocks} blocks`,
        'blockLinks reads a link with no block as a link of every block',
        async ({ seed, product }) => {
          const w = world(seed, id, 1, blocks);
          const spec = loadSpec(product, w.specs[0]);
          const blockLinks = need<(spec: unknown, index: number) => Array<{ to: { section?: string } }>>(
            product.core,
            'core',
            'blockLinks',
          );
          const missing = Array.from({ length: blocks }, (_, b) => b).filter(
            (b) => !blockLinks(spec, b).some((link) => link.to.section === w.wide[0]),
          );
          return missing.length === 0
            ? PASS
            : fail(`blocks ${missing.join(', ')} do not hold the spec-wide link`);
        },
      ),
    );
  }
  // Links stay out of the spec hash, whatever field of a link changes.
  const changes: Array<{ field: string; tier: Tier; change(link: Record<string, unknown>): void }> = [
    { field: 'to', tier: 2, change: (l) => ((l.to as Record<string, unknown>).section = 'other_section') },
    { field: 'relation', tier: 2, change: (l) => (l.relation = 'exercises') },
    { field: 'created_by', tier: 2, change: (l) => (l.created_by = 'mutation') },
    { field: 'at_version', tier: 2, change: (l) => (l.at_version = 'v9') },
    {
      field: 'evidence',
      tier: 3,
      change: (l) => (l.evidence = { verified: { mutant: 'm7', runs: 5, flips: 5 } }),
    },
    { field: 'block', tier: 3, change: (l) => (l.block = 0) },
  ];
  for (const change of changes) {
    const id = `schema/out-of-hash/${change.field}`;
    out.push(
      item(
        id,
        family,
        change.tier,
        IDENTITY,
        `a change of a link's ${change.field} leaves the spec hash unchanged`,
        'specHash leaves metadata.links out',
        async ({ seed, product }) => {
          const specHash = need<(spec: unknown) => string>(product.core, 'core', 'specHash');
          const w = world(seed, id, 1, shapeOf(seed, id, [1, 1], [3, 6]).blocks);
          const before = loadSpec(product, w.specs[0]);
          const raw = structuredClone(w.specs[0]) as World['specs'][number];
          change.change(raw.metadata.links[0] as unknown as Record<string, unknown>);
          const after = loadSpec(product, raw);
          return expectAll([
            [
              specHash(before) === specHash(after),
              `the spec hash moved when the link's ${change.field} changed`,
            ],
          ]);
        },
      ),
    );
  }
  // A spec that gains its first links keeps its hash, with or without a metadata block left behind.
  for (const leftover of ['no-metadata', 'empty-links'] as const) {
    const id = `schema/out-of-hash/first-links/${leftover}`;
    out.push(
      item(
        id,
        family,
        2,
        IDENTITY,
        `a spec that gains its first links keeps the spec hash of its form without them (${leftover.replace('-', ' ')})`,
        'specHash leaves metadata.links out',
        async ({ seed, product }) => {
          const specHash = need<(spec: unknown) => string>(product.core, 'core', 'specHash');
          const w = world(seed, id, 1, shapeOf(seed, id, [1, 1], [3, 6]).blocks);
          const linked = loadSpec(product, w.specs[0]);
          const bare = structuredClone(w.specs[0]) as Record<string, unknown>;
          if (leftover === 'no-metadata') delete bare.metadata;
          else bare.metadata = { links: [] };
          const without = loadSpec(product, bare);
          return expectAll([
            [
              specHash(linked) === specHash(without),
              'the spec hash moved when the spec gained its first links',
            ],
          ]);
        },
      ),
    );
  }
  return out;
}

/** Every item of the lane. */
export function links2Items(): BankItem[] {
  return [...localizeItems(), ...chainItems(), ...schemaItems()];
}
