import {
  type BlockLink,
  type ChangeManifest,
  checkSpecLinks,
  type RunMode,
  registriesByPrompt,
  type SectionRegistry,
  sectionSelection,
  specHash,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import type { Flow, RawSpec } from '../plant';
import { between, rngFor } from '../random';
import {
  blockId,
  failingKeys,
  hideArgv,
  type LinkedSuite,
  linkedSuite,
  localizeDifference,
  PROMPT,
  plantAt,
  type ReferenceRow,
  registryOf,
  renamePerturbation,
  runSuite,
  type SuitePlant,
  sectionLink,
} from './links-world';
import { OPERATOR_ORDER, withPerturbation } from './reach';
import { type BankItem, type Draft, expectAll, fail, PASS, type Tier, withCauses } from './types';
import { behavioursFor, failingList, loadRaw, memoryCache, runScenario } from './world';

/**
 * Level 12, links: a planted fault reaches the right block through its link. A block's `metadata.links`
 * name the prompt sections it tests (docs/concepts/blast-radius.md, "Prompt sections and block links").
 * Three readers follow them, and each is checked against an oracle the plant knows:
 *
 * - localisation (`localizeRuns`, "Localisation over sections"): the plant knows which blocks fail, so the
 *   Ochiai score of every section is computed from the documented formula without reading a run, and
 *   compared with the ranking the chain prints from the stored runs;
 * - advisory selection (`sectionSelection`, "Advisory section selection"): a second implementation of the
 *   documented rule list gives every block's state for a change to one section;
 * - the spec loader and the identity (`spec validate`, "The link"): the documented refusal codes, and links
 *   kept out of the spec hash, the run id and the cache key.
 *
 * Every item is generated from the operator table, the link forms, the modes and the edge kinds; none is
 * written by hand.
 */

const LOCALIZE = 'packages/core/src/radius/localize.ts';
const SELECT = 'packages/core/src/radius/select.ts';
const LINKS = 'packages/core/src/radius/links.ts';
const SCHEMA = 'packages/core/src/schema/links.ts';
const IDENTITY = 'packages/core/src/spec/identity.ts';
const CACHE = 'packages/core/src/runner/cache.ts';

/** A raw spec as the radius reads it: the loaded spec and its hash. */
const radiusSpec = (raw: RawSpec) => {
  const spec = loadRaw(raw);
  return { spec, hash: specHash(spec) };
};

const slug = (cls: string) => cls.toLowerCase().replace(/_/g, '-');

/** Operators that touch neither the stage nor the flow: they fail a block of a parent forest by themselves. */
const STAGELESS = [
  'X1_local',
  'X4_format',
  'X5_tool',
  'D4_loose_confirmation',
  'D6_instruction_in_data',
  'D9_out_of_scope',
] as const;

function draft(
  id: string,
  family: string,
  tier: Tier,
  component: string,
  title: string,
  cause: string,
  check: BankItem['check'],
  source: BankItem['source'] = 'combination',
): Draft {
  return {
    id: `links/${id}`,
    family,
    tier,
    level: 12,
    component,
    title,
    cause,
    check: (ctx) => hideArgv(() => check(ctx)),
    source,
  };
}

/** The plant of one fault: spec s, block b, operator cls. */
function onePlant(s: number, b: number, cls: string): SuitePlant {
  return new Map([[s, new Map([[b, [cls]]])]]);
}

/** Fails when a run of the plant does not fail exactly the planted blocks: the chain below the links broke. */
function plantHolds(suite: LinkedSuite, runs: Parameters<typeof localizeDifference>[1], plant: SuitePlant) {
  const want = failingKeys(suite, plant);
  for (const run of runs) {
    for (const block of run.blocks) {
      if (block.injected === true) continue;
      const key = `${run.specId}#${block.blockId ?? blockId(run.specId, block.specIndex ?? block.index)}`;
      const failing = block.status === 'fail' || (block.status === undefined && !block.pass);
      if (failing !== want.has(key))
        return `block ${key} ${failing ? 'fails' : 'passes'} against the plant: ${failingList(run)}`;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------
// link-localize: one fault, each operator, each mode, each link form.

function localizeOne(): Draft[] {
  const out: Draft[] = [];
  for (const cls of OPERATOR_ORDER)
    for (const mode of ['F', 'T'] as const)
      for (const form of ['id', 'index'] as const) {
        const id = `localize/${slug(cls)}/${mode}/${form}`;
        out.push(
          draft(
            id,
            'link-localize',
            mode === 'F' ? 2 : 3,
            LOCALIZE,
            `${cls} planted at one block of a ${mode} suite: localisation from the stored runs scores every section as the formula does on the plant, links by ${form}`,
            'localizeRuns scores the sections a failing block links to with the documented Ochiai formula',
            async ({ seed }) => {
              const suite = linkedSuite(seed, id, { form });
              const at = plantAt(seed, id, suite.flows.length, 4);
              const plant = onePlant(at.s, at.b, cls);
              const runs = await runSuite(suite, plant, { mode });
              const broken = plantHolds(suite, runs, plant);
              if (broken) return fail(`the plant did not hold, so the links cannot be judged: ${broken}`);
              const diff = localizeDifference(suite, runs, plant, mode, 'grouped');
              return diff ? fail(`${cls} at spec ${at.s} block ${at.b}: ${diff}`) : PASS;
            },
          ),
        );
      }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// link-inherit: two faults on adjacent blocks of one conversation, grouped and flat counting.

function localizePairs(): Draft[] {
  const out: Draft[] = [];
  OPERATOR_ORDER.forEach((cls, at) => {
    const next = OPERATOR_ORDER[(at + 3) % OPERATOR_ORDER.length] as string;
    for (const counting of ['grouped', 'flat'] as const) {
      const id = `inherit/${slug(cls)}-${slug(next)}/${counting}`;
      out.push(
        draft(
          id,
          'link-inherit',
          counting === 'grouped' ? 3 : 2,
          LOCALIZE,
          `${cls} then ${next} on the next block of one F conversation: the second failure is ${counting === 'grouped' ? 'inherited and dropped' : 'counted'}, and every section scores as the formula does`,
          counting === 'grouped'
            ? 'localizeRuns drops a failure whose earlier block of the conversation failed in the same run'
            : 'localizeRuns with flat counting counts every failing block',
          async ({ seed }) => {
            const suite = linkedSuite(seed, id);
            const p = plantAt(seed, id, suite.flows.length, 3);
            const plant: SuitePlant = new Map([
              [
                p.s,
                new Map([
                  [p.b, [cls]],
                  [p.b + 1, [next]],
                ]),
              ],
            ]);
            const runs = await runSuite(suite, plant, { mode: 'F' });
            const broken = plantHolds(suite, runs, plant);
            if (broken) return fail(`the plant did not hold: ${broken}`);
            const diff = localizeDifference(suite, runs, plant, 'F', counting);
            return diff ? fail(`${cls} at block ${p.b} and ${next} at ${p.b + 1}: ${diff}`) : PASS;
          },
        ),
      );
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// link-shift: the run position is not the authored position. An injected deviation (mode P) shifts every
// later block by one; a parent authored after its child runs first. The failure must reach the sections of
// the AUTHORED block, the one the link names.

function localizePerturbed(): Draft[] {
  return OPERATOR_ORDER.map((cls) => {
    const id = `shift/perturbed/${slug(cls)}`;
    return draft(
      id,
      'link-shift',
      4,
      LOCALIZE,
      `${cls} planted after an injected deviation in mode P: localisation charges the sections of the authored block, not of the block one run position later`,
      'localizeRuns maps a mode P block to its authored index, never to its run position after the injected block',
      async ({ seed }) => {
        const suite = linkedSuite(seed, id, { blocks: 5 });
        const rng = rngFor(seed, `${id}-at`);
        const s = between(rng, 0, suite.flows.length - 1);
        const k = between(rng, 1, 3);
        const j = between(rng, k, 3);
        const plant = onePlant(s, j, cls);
        const behaviours = new Map<number, ReturnType<typeof behavioursFor>>();
        const runs = [];
        for (const [index, flow] of suite.flows.entries()) {
          const made = behavioursFor(flow, plant.get(index) ?? new Map());
          behaviours.set(index, made);
          const perturbationId = renamePerturbation(flow, withPerturbation(flow, made, k), seed, id);
          for (let repeat = 0; repeat < 2; repeat += 1)
            runs.push(await runScenario(flow.spec, made, { mode: 'P', repeat, perturbationId }));
        }
        const injected = runs[0]?.blocks.findIndex((block) => block.injected === true);
        if (injected !== k) return fail(`the deviation went in at run position ${injected}, planted ${k}`);
        const diff = localizeDifference(suite, runs, plant, 'P', 'grouped');
        return diff ? fail(`${cls} at authored block ${j}, deviation before block ${k}: ${diff}`) : PASS;
      },
    );
  });
}

/**
 * A forest spec: blocks [r0, c0 (parent r0), r1, c1 (parent r1)] with every stage expectation removed, so an
 * independent root starts from the spec defaults without a stage-order verdict against it. `childFirst`
 * authors c0 before r0, which the runner schedules first.
 */
function forest(flow: Flow, childFirst: boolean): { order: number[]; parents: Map<number, number> } {
  const raw = flow.spec as RawSpec & { blocks: Array<Record<string, unknown>>; stages?: unknown };
  delete raw.stages;
  for (const block of raw.blocks) {
    const expect = block.expect as Record<string, unknown>;
    delete expect.stage;
  }
  // Authored order by truth index: r0=0, c0=1, r1=2, c1=3, or c0 first.
  const order = childFirst ? [1, 0, 2, 3] : [0, 1, 2, 3];
  const parents = new Map<number, number>([
    [1, 0],
    [3, 2],
  ]);
  raw.blocks = order.map((truth) => {
    const block = { ...(flow.spec.blocks as Array<Record<string, unknown>>)[truth] } as Record<
      string,
      unknown
    >;
    const parent = parents.get(truth);
    if (parent !== undefined) block.parent = blockId(flow.spec.id, parent);
    return block;
  });
  return { order, parents };
}

function localizeForest(): Draft[] {
  const out: Draft[] = [];
  for (const cls of STAGELESS)
    for (const shape of ['roots', 'child-first'] as const) {
      const id = `shift/forest-${shape}/${slug(cls)}`;
      out.push(
        draft(
          id,
          'link-shift',
          shape === 'roots' ? 4 : 5,
          LOCALIZE,
          shape === 'roots'
            ? `${cls} on a child of one root and on a second, independent root of a parent forest: the second root's failure is its own, not inherited`
            : `${cls} on a child authored before its parent: localisation charges the sections of the authored child, whatever order the runner ran it in`,
          shape === 'roots'
            ? 'localizeRows reads the ancestors of a block in a parent forest from its parent edges, not from every earlier block'
            : 'localizeRuns maps a block run out of authored order by its specIndex, never by its run position',
          async ({ seed }) => {
            const suite = linkedSuite(seed, id, { specs: 2, blocks: 4 });
            const s = between(rngFor(seed, `${id}-spec`), 0, 1);
            const flow = suite.flows[s] as Flow;
            const { parents } = forest(flow, shape === 'child-first');
            // Faults by truth index: the child c0 and the second root r1 (roots), or the child c0 alone.
            const faults =
              shape === 'roots'
                ? new Map([
                    [1, [cls]],
                    [2, [cls]],
                  ])
                : new Map([[1, [cls]]]);
            const plant: SuitePlant = new Map([[s, faults]]);
            const runs = await runSuite(suite, plant, { mode: 'F' });
            const rows: ReferenceRow[] = suite.flows.flatMap((each, at) =>
              each.truths.map((_, b) => {
                const ancestors: string[] = [];
                if (at === s)
                  for (let up = parents.get(b); up !== undefined; up = parents.get(up))
                    ancestors.push(`${each.spec.id}#${blockId(each.spec.id, up)}`);
                else
                  for (let a = 0; a < b; a += 1)
                    ancestors.push(`${each.spec.id}#${blockId(each.spec.id, a)}`);
                return {
                  key: `${each.spec.id}#${blockId(each.spec.id, b)}`,
                  sections: [suite.own[at]?.[b] as string, suite.spec[at] as string],
                  ancestors,
                };
              }),
            );
            // A block whose forest ancestor fails is blocked: no measurement, so no row of the reference.
            const failing = failingKeys(suite, plant);
            const measured = rows.filter((row) => !row.ancestors.some((ancestor) => failing.has(ancestor)));
            const broken = plantHolds(suite, runs, plant);
            if (broken) return fail(`the plant did not hold: ${broken}`);
            const diff = localizeDifference(suite, runs, plant, 'F', 'grouped', undefined, measured);
            return diff ? fail(`${cls}, forest ${shape}: ${diff}`) : PASS;
          },
        ),
      );
    }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// link-select: a change to one section, the planted block linked to it through each edge kind, each status.

type Edges = Record<
  string,
  { references?: string[]; overrides?: string[]; duplicates?: string[]; stale?: boolean }
>;

const RELATIONS = [
  'direct',
  'references',
  'overrides',
  'duplicates-of',
  'duplicated-by',
  'transitive',
  'unrelated',
] as const;
type Relation = (typeof RELATIONS)[number];

const STATUSES: BlockLink['status'][] = ['declared', 'attributed', 'verified', 'refuted', 'stale'];

/**
 * The second implementation of the documented selection rule (docs/concepts/blast-radius.md, "Advisory
 * section selection"): direct for a non-refuted link to a section of the closure, for no link to the
 * changed prompt, and for a stale link; forward for every later block of the same spec.
 */
function referenceSelection(
  specs: readonly RawSpec[],
  registry: SectionRegistry,
  changed: readonly string[],
): Map<string, 'direct' | 'forward' | 'out'> | 'all' {
  const sections = new Map(registry.sections.map((section) => [section.id, section]));
  if (changed.some((id) => !sections.has(id) || sections.get(id)?.scope === 'global')) return 'all';
  const closure = new Set(changed);
  for (let grew = true; grew; ) {
    grew = false;
    for (const section of registry.sections) {
      if (closure.has(section.id)) continue;
      const edges = [
        ...(section.references ?? []),
        ...(section.overrides ?? []),
        ...(section.duplicates ?? []),
      ];
      const duplicatedBy = registry.sections.some(
        (other) => closure.has(other.id) && (other.duplicates ?? []).includes(section.id),
      );
      if (edges.some((id) => closure.has(id)) || duplicatedBy) {
        closure.add(section.id);
        grew = true;
      }
    }
  }
  const out = new Map<string, 'direct' | 'forward' | 'out'>();
  for (const spec of specs) {
    const blocks = spec.blocks as Array<{ id?: string }>;
    const links = ((spec.metadata as { links?: BlockLink[] } | undefined)?.links ?? []).filter(
      (link) => link.to.kind === 'prompt_section' && link.to.prompt === PROMPT,
    );
    let first = -1;
    blocks.forEach((block, index) => {
      const mine = links.filter(
        (link) => link.block === undefined || link.block === index || link.block === block.id,
      );
      const direct =
        mine.length === 0 ||
        mine.some((link) => {
          const target = link.to.kind === 'prompt_section' ? link.to.section : '';
          const section = sections.get(target);
          if (link.status === 'stale' || !section || section.stale === true) return true;
          return link.status !== 'refuted' && closure.has(target);
        });
      out.set(`${spec.id}#${index}`, direct ? 'direct' : 'out');
      if (direct && first < 0) first = index;
    });
    if (first >= 0)
      for (let index = first + 1; index < blocks.length; index += 1)
        if (out.get(`${spec.id}#${index}`) === 'out') out.set(`${spec.id}#${index}`, 'forward');
  }
  return out;
}

function manifestOf(
  changed: readonly string[],
  extra: Partial<ChangeManifest['changes'][number]> = {},
): ChangeManifest {
  return {
    from: 'v1',
    to: 'v2',
    changes: changed.map((id) => ({ kind: 'prompt_section', id: `${PROMPT}#${id}`, ...extra })),
  } as ChangeManifest;
}

function selectionDifference(
  specs: readonly RawSpec[],
  registry: SectionRegistry,
  changed: readonly string[],
  expectAllBlocks = false,
): string | undefined {
  const want = referenceSelection(specs, registry, changed);
  if ((want === 'all') !== expectAllBlocks)
    throw new Error(
      `the bank's reference selects ${want === 'all' ? 'every block' : 'a part'}, which this item does not plant`,
    );
  const got = sectionSelection(
    specs.map((raw) => radiusSpec(raw)),
    manifestOf(changed),
    [registry],
  );
  if (want === 'all') {
    if (got.all === null)
      return 'expected every block selected (a global or unknown section), got a partial selection';
    return got.specs.every((spec) => spec.blocks.every((block) => block.state !== 'out'))
      ? undefined
      : 'got.all is set but a block is out';
  }
  if (got.all !== null) return `every block selected (${got.all}), expected a partial selection`;
  for (const spec of got.specs)
    for (const block of spec.blocks) {
      const expected = want.get(`${spec.specId}#${block.index}`);
      if (expected !== block.state)
        return `${spec.specId} block ${block.index} is ${block.state} (${block.why.join('; ')}), expected ${expected}`;
    }
  return undefined;
}

const changedIsLocal = (registry: SectionRegistry, id: string) =>
  registry.sections.some((section) => section.id === id && section.scope === 'local');

/** Wires the planted block's own section T to the changed section C by the relation, and returns C. */
function wire(suite: LinkedSuite, s: number, b: number, relation: Relation, seed: number, tag: string) {
  const target = suite.own[s]?.[b] as string;
  const others = suite.own.flat().filter((id) => id !== target);
  const rng = rngFor(seed, `${tag}-wire`);
  const c = others[between(rng, 0, others.length - 1)] as string;
  const r = others.filter((id) => id !== c)[between(rng, 0, others.length - 2)] as string;
  const edges: Edges = {};
  switch (relation) {
    case 'direct':
      return { changed: target, edges };
    case 'references':
      edges[target] = { references: [c] };
      break;
    case 'overrides':
      edges[target] = { overrides: [c] };
      break;
    case 'duplicates-of':
      edges[target] = { duplicates: [c] };
      break;
    case 'duplicated-by':
      edges[c] = { duplicates: [target] };
      break;
    case 'transitive':
      edges[target] = { references: [r] };
      edges[r] = { overrides: [c] };
      break;
    case 'unrelated':
      break;
  }
  return { changed: c, edges };
}

function selectItems(): Draft[] {
  const out: Draft[] = [];
  for (const relation of RELATIONS)
    for (const status of STATUSES) {
      const id = `select/${relation}/${status}`;
      out.push(
        draft(
          id,
          'link-select',
          relation === 'transitive' || relation === 'duplicated-by'
            ? 4
            : status === 'refuted' || status === 'stale'
              ? 3
              : 2,
          SELECT,
          `a change to one section, the planted block linked to a section that is ${relation === 'direct' ? 'the changed one' : `${relation} of it`} by a ${status} link: every block's selection state follows the documented rule`,
          status === 'stale'
            ? 'sectionSelection selects every block with a stale link'
            : status === 'refuted'
              ? 'sectionSelection leaves out a refuted link'
              : relation === 'direct' || relation === 'unrelated'
                ? 'sectionSelection selects the blocks linked to a changed section and the later blocks of their conversation'
                : `sectionSelection closes the changed sections over ${relation === 'transitive' ? 'chains of references and overrides' : relation === 'duplicated-by' ? 'the duplicates a changed section lists' : relation}`,
          async ({ seed }) => {
            const suite = linkedSuite(seed, id);
            const at = plantAt(seed, id, suite.flows.length, 4);
            const { changed, edges } = wire(suite, at.s, at.b, relation, seed, id);
            const registry = registryOf(suite.prompt, 'v1', [suite.global], edges);
            const flow = suite.flows[at.s] as Flow;
            const links = (flow.spec.metadata as { links: BlockLink[] }).links;
            const own = links.find((link) => link.block === blockId(flow.spec.id, at.b));
            if (own) own.status = status;
            // The planted fault: the block whose link reaches the changed section fails on the run.
            const run = await runScenario(flow.spec, behavioursFor(flow, new Map([[at.b, ['X1_local']]])));
            const planted = run.blocks.find((block) => block.index === at.b);
            if (!planted || planted.pass)
              return fail(`the planted block ${at.b} does not fail: ${failingList(run)}`);
            const diff = selectionDifference(
              suite.flows.map((each) => each.spec),
              registry,
              [changed],
            );
            if (!changedIsLocal(registry, changed))
              throw new Error(`the bank changed ${changed}, not a local section`);
            return diff ? fail(`change ${changed}, planted ${flow.spec.id} block ${at.b}: ${diff}`) : PASS;
          },
        ),
      );
    }
  return out;
}

/** The edges of selection: whole-suite answers, missing links, stale sections, several changes. */
function selectEdges(): Draft[] {
  type Case = {
    id: string;
    tier: Tier;
    title: string;
    cause: string;
    build(suite: LinkedSuite, s: number, b: number): { registry: SectionRegistry; changed: string[] };
  };
  const cases: Case[] = [
    {
      id: 'global-section',
      tier: 1,
      title: 'a change to the global section selects every block',
      cause: 'sectionSelection selects every block when a changed section is global',
      build: (suite) => ({
        registry: registryOf(suite.prompt, 'v1', [suite.global]),
        changed: [suite.global],
      }),
    },
    {
      id: 'unknown-section',
      tier: 1,
      title: 'a change to a section no registry holds selects every block',
      cause: 'sectionSelection selects every block when a changed section is in no registry',
      build: (suite) => ({
        registry: registryOf(suite.prompt, 'v1', [suite.global]),
        changed: ['no-such-section'],
      }),
    },
    {
      id: 'no-links',
      tier: 2,
      title:
        'a block of a spec with no link to the prompt is selected, as Ekstazi runs a test with no record',
      cause: 'sectionSelection selects a block with no link to the changed prompt',
      build: (suite, s) => {
        (suite.flows[s] as Flow).spec.metadata = { links: [] };
        return {
          registry: registryOf(suite.prompt, 'v1', [suite.global]),
          changed: [suite.own[(s + 1) % suite.flows.length]?.[0] as string],
        };
      },
    },
    {
      id: 'stale-section',
      tier: 3,
      title: 'a block linked to a section the registry marks stale is selected',
      cause: 'sectionSelection selects every block with a stale link',
      build: (suite, s, b) => {
        const stale = suite.own[s]?.[b] as string;
        return {
          registry: registryOf(suite.prompt, 'v1', [suite.global], { [stale]: { stale: true } }),
          changed: [suite.own[(s + 1) % suite.flows.length]?.[0] as string],
        };
      },
    },
    {
      id: 'link-to-missing-section',
      tier: 3,
      title: 'a block linked to a section its registry lacks is selected as stale',
      cause: 'sectionSelection selects every block with a stale link',
      build: (suite, s, b) => {
        const links = ((suite.flows[s] as Flow).spec.metadata as { links: BlockLink[] }).links;
        links.push(sectionLink('gone-section', blockId((suite.flows[s] as Flow).spec.id, b)));
        return {
          registry: registryOf(suite.prompt, 'v1', [suite.global]),
          changed: [suite.own[(s + 1) % suite.flows.length]?.[0] as string],
        };
      },
    },
    {
      id: 'two-changes',
      tier: 2,
      title: 'two changed sections in two specs select both planted blocks and what follows each',
      cause:
        'sectionSelection selects the blocks linked to a changed section and the later blocks of their conversation',
      build: (suite, s, b) => ({
        registry: registryOf(suite.prompt, 'v1', [suite.global]),
        changed: [
          suite.own[s]?.[b] as string,
          suite.own[(s + 1) % suite.flows.length]?.[(b + 1) % 4] as string,
        ],
      }),
    },
    {
      id: 'spec-wide-link',
      tier: 2,
      title:
        'a change to the section every block of one spec links to selects that whole spec and nothing else',
      cause: 'sectionSelection reads a link with no block as a link of every block',
      build: (suite, s) => ({
        registry: registryOf(suite.prompt, 'v1', [suite.global]),
        changed: [suite.spec[s] as string],
      }),
    },
    {
      id: 'link-by-index',
      tier: 2,
      title: 'a link that names its block by index selects that block as a link by id does',
      cause: 'linkHolds matches a link to its block by index',
      build: (suite, s, b) => {
        const links = ((suite.flows[s] as Flow).spec.metadata as { links: BlockLink[] }).links;
        const own = links.find((link) => link.block === blockId((suite.flows[s] as Flow).spec.id, b));
        if (own) own.block = b;
        return {
          registry: registryOf(suite.prompt, 'v1', [suite.global]),
          changed: [suite.own[s]?.[b] as string],
        };
      },
    },
    {
      id: 'duplicate-cycle',
      tier: 4,
      title:
        'two sections that list each other as duplicates and a third that references one of them close without looping',
      cause: `sectionSelection closes the changed sections over the duplicates a changed section lists`,
      build: (suite, s, b) => {
        const a = suite.own[s]?.[b] as string;
        const c = suite.own[(s + 1) % suite.flows.length]?.[b] as string;
        const d = suite.own[(s + 2) % suite.flows.length]?.[b] as string;
        return {
          registry: registryOf(suite.prompt, 'v1', [suite.global], {
            [a]: { duplicates: [c] },
            [c]: { duplicates: [a] },
            [d]: { references: [c] },
          }),
          changed: [a],
        };
      },
    },
    {
      id: 'reference-to-global',
      tier: 3,
      title: 'a local section that references the global one is not selected by a change to a third section',
      cause:
        'sectionSelection selects the blocks linked to a changed section and the later blocks of their conversation',
      build: (suite, s, b) => ({
        registry: registryOf(suite.prompt, 'v1', [suite.global], {
          [suite.own[s]?.[b] as string]: { references: [suite.global] },
        }),
        changed: [suite.own[(s + 1) % suite.flows.length]?.[b] as string],
      }),
    },
  ];
  return cases.flatMap((c) =>
    (['id', 'index'] as const).map((form) => {
      const id = `select-edge/${c.id}/${form}`;
      return draft(
        id,
        'link-select-edge',
        c.tier,
        SELECT,
        `${c.title} (links by ${form})`,
        c.cause,
        async ({ seed }) => {
          const suite = linkedSuite(seed, id, { form });
          const at = plantAt(seed, id, suite.flows.length, 4);
          const { registry, changed } = c.build(suite, at.s, form === 'index' ? at.b : at.b);
          const diff = selectionDifference(
            suite.flows.map((each) => each.spec),
            registry,
            changed,
            c.id === 'global-section' || c.id === 'unknown-section',
          );
          return diff ? fail(`${c.id}: ${diff}`) : PASS;
        },
      );
    }),
  );
}

/**
 * select-parent: docs/concepts/given-when-then.md, "Parent blocks": "A blast-radius change reaching a parent
 * includes its descendants in every mode, even when they occur earlier in the YAML." A child authored before
 * its parent, the parent linked to the changed section, must be selected.
 */
function selectParents(): Draft[] {
  const out: Draft[] = [];
  const shapes = [
    { id: 'child-first', order: [1, 0, 2, 3], parents: [[1, 0]] as const, depth: 1 },
    { id: 'child-first-gap', order: [3, 0, 1, 2], parents: [[3, 2]] as const, depth: 1 },
    {
      id: 'grandchild-first',
      order: [2, 1, 0, 3],
      parents: [
        [1, 0],
        [2, 1],
      ] as const,
      depth: 2,
    },
    {
      id: 'two-children-first',
      order: [1, 2, 0, 3],
      parents: [
        [1, 0],
        [2, 0],
      ] as const,
      depth: 1,
    },
    { id: 'child-after', order: [0, 1, 2, 3], parents: [[1, 0]] as const, depth: 1 },
  ];
  for (const shape of shapes)
    for (const form of ['id', 'index'] as const) {
      const id = `select-parent/${shape.id}/${form}`;
      out.push(
        draft(
          id,
          'link-select-edge',
          shape.id === 'child-after' ? 2 : shape.depth === 2 ? 5 : 4,
          SELECT,
          `a change to the section a parent block links to selects its descendants, ${shape.id === 'child-after' ? 'authored after it' : 'authored before it in the YAML'} (links by ${form})`,
          shape.id === 'child-after'
            ? 'sectionSelection selects the blocks linked to a changed section and the later blocks of their conversation'
            : 'sectionSelection follows block-level parent edges to every descendant, whatever the authored order',
          async ({ seed }) => {
            const suite = linkedSuite(seed, id, { specs: 2, form });
            const s = between(rngFor(seed, `${id}-spec`), 0, 1);
            const flow = suite.flows[s] as Flow;
            const raw = flow.spec as RawSpec & { blocks: Array<Record<string, unknown>>; stages?: unknown };
            delete raw.stages;
            const source = raw.blocks.map((block) => {
              const copy = { ...block, expect: { ...(block.expect as Record<string, unknown>) } };
              delete (copy.expect as Record<string, unknown>).stage;
              return copy;
            });
            const parentOf = new Map<number, number>(shape.parents.map(([child, parent]) => [child, parent]));
            raw.blocks = shape.order.map((truth) => {
              const block = { ...(source[truth] as Record<string, unknown>) };
              const parent = parentOf.get(truth);
              if (parent !== undefined) block.parent = blockId(flow.spec.id, parent);
              return block;
            });
            // Links by index name authored positions: re-point them at the new positions.
            if (form === 'index') {
              const links = (raw.metadata as { links: BlockLink[] }).links;
              for (const link of links)
                if (typeof link.block === 'number') link.block = shape.order.indexOf(link.block);
            }
            const loaded = validateSpec(raw, 'bank');
            if (!loaded.ok)
              return fail(
                `the bank's forest spec is refused: ${loaded.errors.map((e) => e.message).join('; ')}`,
              );
            const changed = suite.own[s]?.[0] as string;
            const registry = registryOf(suite.prompt, 'v1', [suite.global]);
            const got = sectionSelection(
              suite.flows.map((each) => radiusSpec(each.spec)),
              manifestOf([changed]),
              [registry],
            );
            const mine = got.specs.find((spec) => spec.specId === flow.spec.id);
            const descendants = [...parentOf.keys()].filter((child) => {
              for (let up = parentOf.get(child); up !== undefined; up = parentOf.get(up))
                if (up === 0) return true;
              return false;
            });
            for (const truth of descendants) {
              const position = shape.order.indexOf(truth);
              const block = mine?.blocks.find((each) => each.index === position);
              if (!block || block.state === 'out')
                return fail(
                  `block b${truth} (authored at ${position}) descends from b0, linked to the changed section ${changed}, and is ${block?.state ?? 'absent'}: ${block?.why.join('; ') ?? ''}`,
                );
            }
            return PASS;
          },
        ),
      );
    }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// link-spec: the loader's refusal codes and lint findings for links, and links kept out of every identity.

function specItems(): Draft[] {
  type Bad = {
    id: string;
    tier: Tier;
    mutate(link: Record<string, unknown>, blocks: number): void;
    code: string;
    path: RegExp;
  };
  const bad: Bad[] = [
    {
      id: 'unknown-block-id',
      tier: 1,
      mutate: (l) => (l.block = 'no-such-block'),
      code: 'LINK_BLOCK_UNKNOWN',
      path: /metadata\.links\.\d+/,
    },
    {
      id: 'index-past-end',
      tier: 1,
      mutate: (l, n) => (l.block = n),
      code: 'LINK_BLOCK_UNKNOWN',
      path: /metadata\.links\.\d+/,
    },
    {
      id: 'unknown-key',
      tier: 2,
      mutate: (l) => (l.weight = 2),
      code: 'SCHEMA_CUSTOM',
      path: /^metadata\.links\.\d+$/,
    },
    {
      id: 'unknown-key-in-to',
      tier: 2,
      mutate: (l) => ((l.to as Record<string, unknown>).line = 3),
      code: 'SCHEMA_CUSTOM',
      path: /^metadata\.links\.\d+\.to$/,
    },
    {
      id: 'bad-status',
      tier: 1,
      mutate: (l) => (l.status = 'trusted'),
      code: 'SCHEMA_CUSTOM',
      path: /^metadata\.links\.\d+\.status$/,
    },
    {
      id: 'missing-status',
      tier: 1,
      mutate: (l) => delete l.status,
      code: 'SCHEMA_CUSTOM',
      path: /^metadata\.links\.\d+\.status$/,
    },
    {
      id: 'missing-to',
      tier: 1,
      mutate: (l) => delete l.to,
      code: 'SCHEMA_CUSTOM',
      path: /^metadata\.links\.\d+\.to$/,
    },
    {
      id: 'bad-relation',
      tier: 2,
      mutate: (l) => (l.relation = 'covers'),
      code: 'SCHEMA_CUSTOM',
      path: /^metadata\.links\.\d+\.relation$/,
    },
    {
      id: 'bad-creator',
      tier: 2,
      mutate: (l) => (l.created_by = 'model'),
      code: 'SCHEMA_CUSTOM',
      path: /^metadata\.links\.\d+\.created_by$/,
    },
    {
      id: 'bad-target-kind',
      tier: 2,
      mutate: (l) => (l.to = { kind: 'file', path: 'x' }),
      code: 'SCHEMA_CUSTOM',
      path: /^metadata\.links\.\d+\.to/,
    },
    {
      id: 'negative-turn',
      tier: 3,
      mutate: (l) => (l.to = { kind: 'source_turn', conversation: 'c-1', turn: -1 }),
      code: 'SCHEMA_CUSTOM',
      path: /^metadata\.links\.\d+\.to/,
    },
    {
      id: 'empty-section',
      tier: 3,
      mutate: (l) => (l.to = { kind: 'prompt_section', prompt: PROMPT, section: '' }),
      code: 'SCHEMA_CUSTOM',
      path: /^metadata\.links\.\d+\.to/,
    },
  ];
  const out: Draft[] = bad.map((b) => {
    const id = `spec/refuse/${b.id}`;
    return draft(
      id,
      'link-spec',
      b.tier,
      b.code === 'LINK_BLOCK_UNKNOWN' ? 'packages/core/src/spec/semantics.ts' : SCHEMA,
      `spec validate refuses a link with ${b.id.replace(/-/g, ' ')} as ${b.code}, at its path, and the spec is invalid`,
      b.code === 'LINK_BLOCK_UNKNOWN'
        ? 'spec validate refuses a link whose block names no block of the spec as LINK_BLOCK_UNKNOWN'
        : 'spec validate refuses a malformed link as SCHEMA_CUSTOM at the field it breaks',
      async ({ seed }) => {
        const suite = linkedSuite(seed, id, { specs: 1 });
        const raw = structuredClone((suite.flows[0] as Flow).spec) as RawSpec;
        const links = (raw.metadata as { links: Array<Record<string, unknown>> }).links;
        const at = between(rngFor(seed, `${id}-at`), 0, links.length - 2);
        b.mutate(links[at] as Record<string, unknown>, (raw.blocks as unknown[]).length);
        const result = validateSpec(raw, 'bank');
        if (result.ok) return fail(`the spec with link ${at} broken (${b.id}) was accepted`);
        const hit = result.errors.find((issue) => issue.code === b.code && b.path.test(issue.path));
        return hit
          ? PASS
          : fail(
              `expected ${b.code} at a path like ${b.path}, got ${result.errors.map((e) => `${e.code} ${e.path}`).join('; ')}`,
            );
      },
    );
  });

  // Lint against the registries: an unknown section is an error, a prompt with no registry and staleness warn.
  type Lint = {
    id: string;
    tier: Tier;
    level: 'error' | 'warning';
    code: string;
    prepare(suite: LinkedSuite, raw: RawSpec): SectionRegistry[];
  };
  const lints: Lint[] = [
    {
      id: 'unknown-section',
      tier: 1,
      level: 'error',
      code: 'LINK_TARGET_UNKNOWN',
      prepare: (suite, raw) => {
        (raw.metadata as { links: BlockLink[] }).links.push(
          sectionLink('missing-section', blockId(raw.id, 0)),
        );
        return [suite.registry];
      },
    },
    {
      id: 'no-registry',
      tier: 2,
      level: 'warning',
      code: 'LINK_TARGET_UNKNOWN',
      prepare: () => [],
    },
    {
      id: 'stale-status',
      tier: 2,
      level: 'warning',
      code: 'LINK_STALE',
      prepare: (suite, raw) => {
        const link = (raw.metadata as { links: BlockLink[] }).links[0] as BlockLink;
        link.status = 'stale';
        return [suite.registry];
      },
    },
    {
      id: 'stale-section',
      tier: 3,
      level: 'warning',
      code: 'LINK_STALE',
      prepare: (suite, raw) => {
        const link = (raw.metadata as { links: BlockLink[] }).links[0] as BlockLink;
        const target = link.to.kind === 'prompt_section' ? link.to.section : '';
        return [registryOf(suite.prompt, 'v1', [suite.global], { [target]: { stale: true } })];
      },
    },
  ];
  for (const lint of lints) {
    const id = `spec/lint/${lint.id}`;
    out.push(
      draft(
        id,
        'link-spec',
        lint.tier,
        LINKS,
        `spec lint --sections reports a link with ${lint.id.replace(/-/g, ' ')} as a ${lint.level} ${lint.code}`,
        `checkSpecLinks reports ${lint.code} as a ${lint.level} for a link with ${lint.id.replace(/-/g, ' ')}`,
        async ({ seed }) => {
          const suite = linkedSuite(seed, id, { specs: 1 });
          const raw = structuredClone((suite.flows[0] as Flow).spec) as RawSpec;
          const registries = lint.prepare(suite, raw);
          const indexed = registriesByPrompt(registries);
          if (!indexed.ok) return fail(indexed.errors.join('; '));
          const issues = checkSpecLinks(loadRaw(raw), indexed.byPrompt);
          const hit = issues.find((issue) => issue.code === lint.code && issue.level === lint.level);
          return hit
            ? PASS
            : fail(
                `expected a ${lint.level} ${lint.code}, got ${issues.map((i) => `${i.level} ${i.code}`).join('; ') || 'nothing'}`,
              );
        },
      ),
    );
  }

  // Identity: links stay out of the spec hash, the run id and the cache key.
  const changes: Array<{ id: string; tier: Tier; change(links: BlockLink[]): void }> = [
    { id: 'added', tier: 1, change: (links) => links.push(sectionLink('own_0_0', 1)) },
    { id: 'promoted', tier: 2, change: (links) => ((links[0] as BlockLink).status = 'verified') },
    { id: 'refuted', tier: 2, change: (links) => ((links[0] as BlockLink).status = 'refuted') },
    { id: 'removed', tier: 2, change: (links) => links.splice(0, links.length) },
    {
      id: 'evidence',
      tier: 3,
      change: (links) =>
        ((links[0] as BlockLink).evidence = { verified: { mutant: 'm1', runs: 3, flips: 3 } }),
    },
  ];
  for (const c of changes) {
    for (const what of ['hash', 'cache'] as const) {
      const id = `spec/identity/${c.id}/${what}`;
      out.push(
        draft(
          id,
          'link-spec',
          what === 'hash' ? c.tier : ((c.tier + 1) as Tier),
          what === 'hash' ? IDENTITY : CACHE,
          what === 'hash'
            ? `a link ${c.id} leaves the spec hash and the run id unchanged`
            : `a run recorded before a link was ${c.id} is replayed from the observed cache: every block is a cache hit`,
          what === 'hash'
            ? 'specHash and the run id leave metadata.links out'
            : 'the observed cache key leaves metadata.links out',
          async ({ seed }) => {
            const suite = linkedSuite(seed, id, { specs: 1 });
            const flow = suite.flows[0] as Flow;
            const before = structuredClone(flow.spec) as RawSpec;
            const after = structuredClone(flow.spec) as RawSpec;
            c.change((after.metadata as { links: BlockLink[] }).links);
            if (what === 'hash') {
              const a = specHash(loadRaw(before));
              const b = specHash(loadRaw(after));
              if (a !== b) return fail(`the spec hash moved from ${a} to ${b}`);
              const behaviours = behavioursFor(flow);
              const one = await runScenario(before, behaviours);
              const two = await runScenario(after, behaviours);
              return expectAll([
                [one.runId === two.runId, `run id ${one.runId} became ${two.runId}`],
                [one.specHash === two.specHash, `the run's spec hash moved`],
              ]);
            }
            const cache = memoryCache();
            const behaviours = behavioursFor(flow);
            await runScenario(before, behaviours, { cache });
            const recorded = cache.size();
            const second = await runScenario(after, behaviours, { cache });
            const hits = second.blocks.filter(
              (block) => (block as { cached?: boolean }).cached === true,
            ).length;
            return expectAll([
              [
                cache.size() === recorded,
                `the cache grew from ${recorded} to ${cache.size()} entries: the link changed a cache key`,
              ],
              [second.status === 'completed', `the replayed run ${second.status}`],
              [
                hits === 0 || hits === second.blocks.length,
                `${hits} of ${second.blocks.length} blocks read as cached`,
              ],
            ]);
          },
        ),
      );
    }
  }
  return out;
}

/** Every item of the links level. */
export function linkItems(): BankItem[] {
  return withCauses([
    ...localizeOne(),
    ...localizePairs(),
    ...localizePerturbed(),
    ...localizeForest(),
    ...selectItems(),
    ...selectEdges(),
    ...selectParents(),
    ...specItems(),
  ]);
}

export type { RunMode };
