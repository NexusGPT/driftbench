import { between, rngFor } from '../blocks/harness';
import { token } from '../blocks/kinds';
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
    check,
  };
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
};

const PROMPT = 'shop';
const span = (at: number) => ({ start: at * 20, end: at * 20 + 10 });
const hex = '0'.repeat(64);

function world(seed: number, tag: string, specs: number, blocks: number): World {
  const own = Array.from({ length: specs }, (_, s) =>
    Array.from({ length: blocks }, (_, b) => `own_${token(seed, `${tag}${s}${b}`)}`),
  );
  const wide = Array.from({ length: specs }, (_, s) => `wide_${token(seed, `${tag}w${s}`)}`);
  const global = `tone_${token(seed, `${tag}g`)}`;
  const ids = [...own.flat(), ...wide, global];
  const registry = {
    prompt_id: PROMPT,
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
    const id = `spec_${token(seed, `${tag}spec${s}`)}`;
    const blockIds = sections.map((_, b) => `blk_${token(seed, `${tag}${s}b${b}`)}`);
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
            block: blockId,
            to: { kind: 'prompt_section' as const, prompt: PROMPT, section: sections[b] as string },
            status: 'declared',
          })),
          {
            to: { kind: 'prompt_section' as const, prompt: PROMPT, section: wide[s] as string },
            status: 'declared',
          },
        ],
      },
    };
  });
  return { specs: specList, registry, own, wide, global };
}

/** Stored runs, mode T: `fails(s, b, repeat)` says whether block b of spec s fails on that repeat. */
function runsOf(
  product: Parameters<BankItem['check']>[0]['product'],
  w: World,
  repeats: number,
  fails: (s: number, b: number, repeat: number) => boolean,
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
        mode: 'T',
        repeat,
        target: { adapter: 'function', agent: 'shop' },
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

type Ranked = { sections: Array<{ section: string; score: number; linked: number }>; failureWeight: number };

/** The documented score of every local, live section, from the plant: weight = failed rows / rows. */
function reference(
  w: World,
  repeats: number,
  fails: (s: number, b: number, repeat: number) => boolean,
  covers: (s: number, b: number) => string[],
  ranked: (section: string) => boolean,
): Map<string, number> {
  const weights: Array<{ w: number; sections: string[] }> = [];
  w.specs.forEach((spec, s) =>
    spec.blocks.forEach((_, b) => {
      let failed = 0;
      for (let r = 0; r < repeats; r += 1) if (fails(s, b, r)) failed += 1;
      weights.push({ w: failed / repeats, sections: covers(s, b) });
    }),
  );
  const total = weights.reduce((sum, row) => sum + row.w, 0);
  const out = new Map<string, number>();
  for (const section of (w.registry.sections as Array<{ id: string }>).map((each) => each.id)) {
    if (!ranked(section)) continue;
    let nf = 0;
    let ns = 0;
    for (const row of weights) {
      if (!row.sections.includes(section)) continue;
      nf += row.w;
      ns += 1 - row.w;
    }
    out.set(section, nf === 0 || total === 0 ? 0 : nf / Math.sqrt(total * (nf + ns)));
  }
  return out;
}

function localize(
  product: Parameters<BankItem['check']>[0]['product'],
  loaded: unknown[],
  runs: unknown[],
  registry: unknown,
): Ranked {
  const localizeRuns = need<
    (specs: unknown[], runs: unknown[], registry: unknown, options: unknown) => { localization: Ranked }
  >(product.core, 'core', 'localizeRuns');
  return localizeRuns(loaded, runs, registry, { mode: 'T' }).localization;
}

function compare(got: Ranked, want: Map<string, number>): string | undefined {
  for (const [section, score] of want) {
    const found = got.sections.find((each) => each.section === section);
    if (!found) return `the section ${section} is not ranked`;
    if (Math.abs(found.score - score) > 1e-9)
      return `the section ${section} scores ${found.score.toFixed(6)}, expected ${score.toFixed(6)}`;
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
            const w = world(seed, id, 3, 4);
            const plants = Array.from({ length: shape === 'one-block' ? 1 : 2 }, () => ({
              s: between(rng, 0, 2),
              b: between(rng, 0, 3),
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
  // A stale link adds nothing; a stale section and a global section are not ranked.
  for (const what of ['stale-link', 'stale-section', 'global-section', 'refuted-and-stale'] as const)
    for (const repeats of [1, 3])
      for (const position of ['first', 'last'] as const) {
        const id = `localize/${what}/${repeats}/${position}`;
        out.push(
          item(
            id,
            family,
            (what === 'stale-link' ? 3 : 2) as Tier,
            LOCALIZE,
            what === 'stale-link'
              ? `a stale link of a failing block adds nothing to its section (${position} block, ${repeats} repeats)`
              : what === 'stale-section'
                ? `a section the registry marks stale is not ranked (${position} block, ${repeats} repeats)`
                : what === 'global-section'
                  ? `a block linked to the global section still leaves it unranked (${position} block, ${repeats} repeats)`
                  : `a refuted link and a stale link on one failing block add nothing (${position} block, ${repeats} repeats)`,
            what === 'stale-link' || what === 'refuted-and-stale'
              ? 'localizeRows leaves a stale link out of the sections a block covers'
              : what === 'stale-section'
                ? 'localizeRows leaves a stale section out of the ranking'
                : 'localizeRuns lists a global section apart and never ranks it',
            async ({ seed, product }) => {
              const w = world(seed, id, 2, 4);
              const s = between(rngFor(seed, `${id}-s`), 0, 1);
              const b = position === 'first' ? 0 : 3;
              const target = w.own[s]?.[b] as string;
              const extra = `odd_${token(seed, `${id}x`)}`;
              const spec = w.specs[s] as World['specs'][number];
              let covers = (cs: number, cb: number) => [w.own[cs]?.[cb] as string, w.wide[cs] as string];
              let ranked = (section: string) => section !== w.global;
              if (what === 'stale-link' || what === 'refuted-and-stale') {
                w.registry.sections.push({
                  id: extra,
                  scope: 'local',
                  span: span(w.registry.sections.length),
                  sha256: hex,
                  anchor: { quote: extra },
                });
                spec.metadata.links.push({
                  block: spec.blocks[b]?.id,
                  to: { kind: 'prompt_section', prompt: PROMPT, section: extra },
                  status: 'stale',
                });
                if (what === 'refuted-and-stale')
                  spec.metadata.links.push({
                    block: spec.blocks[b]?.id,
                    to: { kind: 'prompt_section', prompt: PROMPT, section: extra },
                    status: 'refuted',
                  });
              } else if (what === 'stale-section') {
                const section = w.registry.sections.find((each) => each.id === target);
                if (section) section.stale = true;
                covers = (cs, cb) =>
                  [w.own[cs]?.[cb] as string, w.wide[cs] as string].filter((id) => id !== target);
                ranked = (section) => section !== w.global && section !== target;
              } else {
                spec.metadata.links.push({
                  block: spec.blocks[b]?.id,
                  to: { kind: 'prompt_section', prompt: PROMPT, section: w.global },
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
            const w = world(seed, id, 1, 3);
            const spec = structuredClone(w.specs[0]) as World['specs'][number];
            const index = at === 'first' ? 0 : spec.metadata.links.length - 1;
            (spec.metadata.links[index] as Link).block =
              form === 'id'
                ? `none_${token(seed, id)}`
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
            const w = world(seed, id, 1, 3);
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
          const w = world(seed, id, 1, 3);
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
  return out;
}

/** Every item of the lane. */
export function links2Items(): BankItem[] {
  return [...localizeItems(), ...schemaItems()];
}
