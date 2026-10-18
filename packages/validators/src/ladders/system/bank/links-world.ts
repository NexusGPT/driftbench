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
 * The sections of a linked suite: one per block (`own_<s>_<b>`), one per spec (`spec_<s>`), one global
 * (`tone`). Ids use underscores: the registry builder slugs a heading's hyphens to underscores.
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
  const names = neutralNames(seed, tag, specs * (blocks + 1) + specs);
  for (const flow of flows) flow.spec.id = `s${names.pop()}`;
  const own = flows.map(() => Array.from({ length: blocks }, () => `sec_${names.pop()}`));
  const spec = flows.map(() => `sec_${names.pop()}`);
  const global = 'tone';
  const ids = shuffled(rngFor(seed, `${tag}-order`), [...own.flat(), ...spec, global]);
  const prompt = plantedPrompt(seed, ids, tag);
  const registry = registryOf(prompt, 'v1', [global]);
  flows.forEach((flow, s) => {
    flow.spec.metadata = {
      links: [
        ...Array.from({ length: blocks }, (_, b) =>
          sectionLink(own[s]?.[b] as string, form === 'id' ? `b${b}` : b),
        ),
        sectionLink(spec[s] as string, undefined),
      ],
    };
  });
  return { flows, registry, prompt, own, spec, global };
}

/** Distinct six-digit hexadecimal names drawn from the seed and the tag. */
export function neutralNames(seed: number, tag: string, count: number): string[] {
  const rng = rngFor(seed, `${tag}-names`);
  const out = new Set<string>();
  while (out.size < count)
    out.add(
      Math.floor(rng() * 0xffffff)
        .toString(16)
        .padStart(6, '0'),
    );
  return [...out];
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
      key: `${flow.spec.id}#b${b}`,
      sections: [suite.own[s]?.[b] as string, suite.spec[s] as string],
      ancestors: mode === 'T' ? [] : Array.from({ length: b }, (_, a) => `${flow.spec.id}#b${a}`),
    })),
  );
}

/** The block keys the plant fails. */
export function failingKeys(suite: LinkedSuite, plant: SuitePlant): Set<string> {
  const out = new Set<string>();
  for (const [s, faults] of plant)
    for (const [b, classes] of faults) if (classes.length > 0) out.add(`${suite.flows[s]?.spec.id}#b${b}`);
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
