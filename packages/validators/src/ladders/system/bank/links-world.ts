import {
  type BlockLink,
  localizeRuns,
  type RunMode,
  type RunResult,
  type SectionRegistry,
  sectionsFromHeadings,
} from '@agent-nexus/driftbench-core';
import type { Flow, RawSpec } from '../plant';
import { between, rngFor, shuffled } from '../random';
import { behavioursFor, type Faults, loadRaw, plantedFlow, runScenario } from './world';

/**
 * The linked world of the links levels: a planted suite whose blocks carry `metadata.links` to the sections
 * of one planted prompt, the section registry of that prompt, and a reference Ochiai written from the
 * formula of docs/concepts/blast-radius.md ("Localisation over sections") and the plant alone. The reference
 * never reads the runs: it knows which blocks fail by construction, so a chain that loses or moves a failure
 * between the runner and the ranking shows as a difference.
 */

/** The prompt id every planted link names. */
export const PROMPT = 'planted-agent';

/** How a link names its block: by id (`b2`), by index (`2`), or absent (every block of the spec). */
export type LinkForm = 'id' | 'index';

/**
 * The sections of a linked suite: one per block, one per spec, one global, every id drawn from the seed in the
 * slug form the registry builder gives a heading back (lower case, digits, single underscores).
 */
export type LinkedSuite = {
  flows: Flow[];
  registry: SectionRegistry;
  prompt: string;
  /** own[s][b]: the section block b of spec s links to alone. */
  own: string[][];
  /** spec[s]: the section every block of spec s links to (a link with no block). */
  spec: string[];
  /** The global section: no block links to it, and it is never ranked. */
  global: string;
};

/** A heading title for a section id: the registry slugs it back to the same id. */
function heading(id: string, seed: number, at: number): string {
  return `## ${id}\n\nRule ${id}: answer step ${at + 1} with reference R-${1000 + ((seed * 31 + at * 7) % 9000)} and nothing else (${id}).\n`;
}

/** A planted prompt with the given section ids, in order, after a preamble. */
export function plantedPrompt(seed: number, ids: readonly string[], tag: string): string {
  return [
    `You are the planted agent of ${tag}, seed ${seed}. Follow every numbered rule below.\n`,
    ...ids.map((id, at) => heading(id, seed, at)),
  ].join('\n');
}

/** The registry of a planted prompt, every section local but the ones named global. */
export function registryOf(
  prompt: string,
  version: string,
  global: readonly string[] = [],
  edges: Readonly<
    Record<string, { references?: string[]; overrides?: string[]; duplicates?: string[]; stale?: boolean }>
  > = {},
): SectionRegistry {
  const made = sectionsFromHeadings(prompt, { promptId: PROMPT, version });
  if (!made.ok)
    throw new Error(`the bank wrote a prompt the registry builder refuses: ${made.errors.join('; ')}`);
  return {
    ...made.registry,
    sections: made.registry.sections.map((section) => ({
      ...section,
      scope: global.includes(section.id) || section.id === 'preamble' ? 'global' : 'local',
      ...(edges[section.id] ?? {}),
    })),
  };
}

/** A link from block `block` (or every block) to a planted section. */
export function sectionLink(
  section: string,
  block: string | number | undefined,
  status: BlockLink['status'] = 'declared',
): BlockLink {
  return {
    ...(block === undefined ? {} : { block }),
    to: { kind: 'prompt_section', prompt: PROMPT, section },
    status,
    created_by: 'author',
    at_version: 'v1',
  };
}

/**
 * A linked suite of `specs` planted flows of `blocks` blocks. Block b of spec s links to its own section
 * `own-s-b` by id or index, and every block of spec s links to `spec-s` by a link with no block. The section
 * order in the prompt is seeded, so a ranking that follows prompt order and not the scores is caught.
 */
export function linkedSuite(
  seed: number,
  tag: string,
  options: { specs?: number; blocks?: number; form?: LinkForm } = {},
): LinkedSuite {
  const specs = options.specs ?? 3;
  const blocks = options.blocks ?? 4;
  const form = options.form ?? 'id';
  const flows = Array.from({ length: specs }, (_, s) => plantedFlow(seed, `${tag}-s${s}`, blocks));
  // Spec and section ids are drawn from the seed, never read from the item: a product that keys on an id
  // the bank chose (a prefix, a counter) gains nothing on another seed (audit of version 6, cheater).
  // The format of every id is drawn too, with no fixed prefix, length or alphabet (audit of version 6,
  // cheater round 3: a product keyed on `k` plus six hex digits for block ids gained).
  const names = neutralNames(seed, tag, specs * (blocks + 1));
  for (const flow of flows) {
    flow.spec.id = names.pop() as string;
    const ids = (flow.spec.blocks as Array<{ id?: string }>).map(() => names.pop() as string);
    (flow.spec.blocks as Array<{ id?: string }>).forEach((block, index) => {
      block.id = ids[index] as string;
    });
    BLOCK_IDS.set(flow.spec.id, ids);
  }
  // Section ids are headings the registry slugs back to themselves: lower case, digits and single underscores.
  const slugs = neutralNames(seed, `${tag}-sections`, specs * blocks + specs + 1, 'slug');
  const own = flows.map(() => Array.from({ length: blocks }, () => slugs.pop() as string));
  const spec = flows.map(() => slugs.pop() as string);
  const global = slugs.pop() as string;
  const ids = shuffled(rngFor(seed, `${tag}-order`), [...own.flat(), ...spec, global]);
  const prompt = plantedPrompt(seed, ids, tag);
  const registry = registryOf(prompt, 'v1', [global]);
  flows.forEach((flow, s) => {
    flow.spec.metadata = {
      links: [
        ...Array.from({ length: blocks }, (_, b) =>
          sectionLink(own[s]?.[b] as string, form === 'id' ? blockId(flow.spec.id, b) : b),
        ),
        sectionLink(spec[s] as string, undefined),
      ],
    };
  });
  return { flows, registry, prompt, own, spec, global };
}

/** The block ids of each linked spec, by spec id: drawn from the seed, never `b0`, `b1`... */
const BLOCK_IDS = new Map<string, string[]>();

/** The id of block `index` of a linked spec (its authored position before any re-ordering). */
export function blockId(specId: string, index: number): string {
  return BLOCK_IDS.get(specId)?.[index] ?? `b${index}`;
}

/**
 * Runs an item's check with the process arguments of a neutral program: a component that reads how it is
 * being run (audit of version 6, cheater: argv sniffing) sees nothing of the validator.
 */
export async function hideArgv<T>(run: () => Promise<T>): Promise<T> {
  const saved = process.argv;
  process.argv = [saved[0] as string, 'app'];
  try {
    return await run();
  } finally {
    process.argv = saved;
  }
}

/**
 * Distinct names drawn from the seed and the tag, each with its own drawn length (3 to 20) and no fixed prefix.
 * An `id` takes a letter of either case first (so YAML never reads it as a number), then letters of both cases,
 * digits, dots, underscores and hyphens (the spec and block id rule); a `slug` takes a lower-case letter first,
 * then lower-case letters, digits and single underscores, never at the end (a heading the registry slugs back
 * to the same id). Distinct whatever the case; never `preamble`, nor a YAML keyword scalar.
 */
export function neutralNames(seed: number, tag: string, count: number, kind: 'id' | 'slug' = 'id'): string[] {
  const rng = rngFor(seed, `${tag}-names-${kind}`);
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const first = kind === 'id' ? `${lower}${lower.toUpperCase()}` : lower;
  const rest = kind === 'id' ? `${first}${digits}._-` : `${lower}${digits}`;
  const pick = (from: string) => from[Math.floor(rng() * from.length)] as string;
  const out: string[] = [];
  // The section the registry names itself, and the YAML 1.1 and 1.2 keyword scalars (machine format).
  const seen = new Set<string>(['preamble', 'true', 'false', 'null', 'yes', 'off', '.nan', '.inf']);
  while (out.length < count) {
    const length = 3 + Math.floor(rng() * 18);
    let name = pick(first);
    while (name.length < length) {
      const underscore = kind === 'slug' && !name.endsWith('_') && name.length < length - 1 && rng() < 0.15;
      name += underscore ? '_' : pick(rest);
    }
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

/**
 * An authored order of blocks 0..n-1 drawn from the seed. Every pair in `keep` stays in the relative order the
 * fixed shape gives it (a child before or after its parent, a block before or after the changed root); every
 * other pair is free (audit of version 6, cheater round 3: products keyed on the fixed child-first layouts).
 */
export function drawnOrder(
  seed: number,
  tag: string,
  fixed: readonly number[],
  keep: ReadonlyArray<readonly [number, number]>,
): number[] {
  const rng = rngFor(seed, `${tag}-authored-order`);
  const before = (order: readonly number[], a: number, b: number) => order.indexOf(a) < order.indexOf(b);
  const wanted = keep.map(([a, b]) => before(fixed, a, b));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const order = shuffled(rng, fixed);
    if (keep.every(([a, b], at) => before(order, a, b) === wanted[at])) return order;
  }
  return [...fixed];
}

/** The pairs a parent-forest shape keeps: each child against its parent, each block against the root. */
export function shapePairs(
  blocks: number,
  parents: ReadonlyArray<readonly [number, number]>,
  root: number,
): Array<readonly [number, number]> {
  const pairs: Array<readonly [number, number]> = parents.map(([child, parent]) => [child, parent] as const);
  for (let b = 0; b < blocks; b += 1) if (b !== root) pairs.push([b, root] as const);
  return pairs;
}

/** Gives a perturbation a name drawn from the seed in place of the shared fixture's name; returns it. */
export function renamePerturbation(flow: Flow, from: string, seed: number, tag: string): string {
  const name = neutralNames(seed, `${tag}-perturbation`, 1)[0] as string;
  const found = (flow.spec.perturbations as Array<{ id: string }> | undefined)?.find(
    (entry) => entry.id === from,
  );
  if (found) found.id = name;
  return name;
}

/** Where faults are planted: spec index to the block faults of that spec. */
export type SuitePlant = ReadonlyMap<number, Faults>;

/** Runs every spec of the suite `repeats` times in one mode, with the plant's faults. */
export async function runSuite(
  suite: LinkedSuite,
  plant: SuitePlant,
  options: { mode?: RunMode; repeats?: number; perturb?: (flow: Flow, s: number) => string | undefined } = {},
): Promise<RunResult[]> {
  const mode = options.mode ?? 'F';
  const runs: RunResult[] = [];
  for (const [s, flow] of suite.flows.entries()) {
    const behaviours = behavioursFor(flow, plant.get(s) ?? new Map());
    const perturbationId = options.perturb?.(flow, s);
    for (let repeat = 0; repeat < (options.repeats ?? 2); repeat += 1) {
      runs.push(
        await runScenario(flow.spec as RawSpec, behaviours, {
          mode,
          repeat,
          ...(perturbationId ? { perturbationId } : {}),
        }),
      );
    }
  }
  return runs;
}

/** One reference row: a block key, the local sections it links to, and its ancestors in the run. */
export type ReferenceRow = { key: string; sections: string[]; ancestors: string[] };

/**
 * The reference Ochiai of the doc's formula over rows whose failure is known by construction: `failing` is
 * the set of block keys that fail in every suite run (the plant is the same on every repeat). Grouped
 * counting drops a failure whose ancestor failed; flat counts it.
 */
export function referenceOchiai(
  rows: readonly ReferenceRow[],
  failing: ReadonlySet<string>,
  local: readonly string[],
  counting: 'grouped' | 'flat',
): { scores: Map<string, number>; roots: string[]; inherited: number; failureWeight: number } {
  const weight = new Map<string, number>();
  const roots: string[] = [];
  let inherited = 0;
  for (const row of rows) {
    const fails = failing.has(row.key);
    if (counting === 'grouped' && fails && row.ancestors.some((ancestor) => failing.has(ancestor))) {
      inherited += 1;
      continue;
    }
    weight.set(row.key, fails ? 1 : 0);
    if (fails) roots.push(row.key);
  }
  const failureWeight = [...weight.values()].reduce((sum, w) => sum + w, 0);
  const scores = new Map<string, number>();
  for (const section of local) {
    let failed = 0;
    let passed = 0;
    for (const row of rows) {
      const w = weight.get(row.key);
      if (w === undefined || !row.sections.includes(section)) continue;
      failed += w;
      passed += 1 - w;
    }
    scores.set(
      section,
      failed === 0 || failureWeight === 0 ? 0 : failed / Math.sqrt(failureWeight * (failed + passed)),
    );
  }
  return { scores, roots: roots.sort(), inherited, failureWeight };
}

/** The reference rows of a linked suite: sequential conversations (F and P) or independent blocks (T). */
export function suiteRows(suite: LinkedSuite, mode: RunMode): ReferenceRow[] {
  return suite.flows.flatMap((flow, s) =>
    flow.truths.map((_, b) => ({
      key: `${flow.spec.id}#${blockId(flow.spec.id, b)}`,
      sections: [suite.own[s]?.[b] as string, suite.spec[s] as string],
      ancestors:
        mode === 'T'
          ? []
          : Array.from({ length: b }, (_, a) => `${flow.spec.id}#${blockId(flow.spec.id, a)}`),
    })),
  );
}

/** The block keys the plant fails. */
export function failingKeys(suite: LinkedSuite, plant: SuitePlant): Set<string> {
  const out = new Set<string>();
  for (const [s, faults] of plant)
    for (const [b, classes] of faults) {
      const id = suite.flows[s]?.spec.id as string;
      if (classes.length > 0) out.add(`${id}#${blockId(id, b)}`);
    }
  return out;
}

/**
 * Compares localizeRuns on the runs with the reference on the plant: every local section's score within
 * 1e-9, the roots, the inherited count and the failure weight. Returns the first difference, or undefined.
 */
export function localizeDifference(
  suite: LinkedSuite,
  runs: readonly RunResult[],
  plant: SuitePlant,
  mode: RunMode,
  counting: 'grouped' | 'flat',
  specs = suite.flows.map((flow) => flow.spec),
  rows = suiteRows(suite, mode),
): string | undefined {
  const loaded = specs.map((raw) => loadRaw(raw));
  const got = localizeRuns(loaded, runs, suite.registry, { mode, counting });
  if (got.skipped.length > 0)
    return `localizeRuns left out ${got.skipped.length} runs: ${got.skipped[0]?.reason ?? ''}`;
  const local = suite.registry.sections.filter((s) => s.scope === 'local').map((s) => s.id);
  const missing = rows.flatMap((row) => row.sections).find((section) => !local.includes(section));
  if (missing)
    throw new Error(`the bank links a block to ${missing}, which its registry does not hold as local`);
  const want = referenceOchiai(rows, failingKeys(suite, plant), local, counting);
  if (want.failureWeight > 0 && ![...want.scores.values()].some((score) => score > 0))
    throw new Error('the bank planted a failure that no linked section can score: the item would be vacuous');
  // A suite run is one target, mode, repeat and perturbation: every repeat counts once, so a weight of w over
  // R identical runs is still w. The reference weights are per block, so they compare directly.
  if (Math.abs(got.localization.failureWeight - want.failureWeight) > 1e-9)
    return `failure weight ${got.localization.failureWeight}, expected ${want.failureWeight} (roots ${want.roots.join(', ')})`;
  const roots = [...got.localization.roots].sort();
  if (roots.join(',') !== want.roots.join(','))
    return `roots ${roots.join(', ') || 'none'}, expected ${want.roots.join(', ') || 'none'}`;
  const repeats = Math.max(1, got.suiteRuns);
  if (got.localization.inherited !== want.inherited * repeats)
    return `${got.localization.inherited} inherited failures, expected ${want.inherited * repeats}`;
  for (const section of local) {
    const score = got.localization.sections.find((each) => each.section === section)?.score;
    const expected = want.scores.get(section) ?? 0;
    if (score === undefined) return `the section ${section} is not ranked`;
    if (Math.abs(score - expected) > 1e-9)
      return `the section ${section} scores ${score.toFixed(6)}, expected ${expected.toFixed(6)}`;
  }
  if (
    got.localization.global.join(',') !==
    suite.registry.sections
      .filter((s) => s.scope === 'global')
      .map((s) => s.id)
      .join(',')
  )
    return `global sections ${got.localization.global.join(', ')}`;
  return undefined;
}

/** A seeded block and spec for a single fault: never the last spec only, never the first block only. */
export function plantAt(seed: number, tag: string, specs: number, blocks: number): { s: number; b: number } {
  const rng = rngFor(seed, `${tag}-plant`);
  return { s: between(rng, 0, specs - 1), b: between(rng, 0, blocks - 1) };
}
