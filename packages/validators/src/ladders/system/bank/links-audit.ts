import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BlockLink,
  blockStatus,
  type ChangeManifest,
  checkSectionRegistry,
  localizeRuns,
  type RunMode,
  type RunResult,
  type SectionRegistry,
  sectionSelection,
  specHash,
} from '@agent-nexus/driftbench-core';
import { parse, stringify } from 'yaml';
import { LOOKUP } from '../family';
import type { Flow, RawSpec } from '../plant';
import { between, rngFor } from '../random';
import { cli, json, storeCampaign, written } from './links-chain';
import {
  type LinkedSuite,
  linkedSuite,
  PROMPT,
  plantAt,
  type ReferenceRow,
  registryOf,
  type SuitePlant,
  suiteRows,
} from './links-world';
import { OPERATOR_ORDER } from './reach';
import { type BankItem, type Draft, expectAll, fail, PASS, type Tier, withCauses } from './types';
import { behavioursFor, failingList, loadRaw, memoryCache, plantedFlow, runScenario } from './world';

/**
 * Items the independent audit of system ladder version 6 asked for (validators/system/audit.md): each cheat
 * that raised the score and each planted bug the bank missed becomes an item (docs/validators.md section
 * 12.7). Level 12 (family `link-audit`): soft weights over repeats, refuted links, blocks not run inside a
 * localised run, mode T with adjacent failures, flat counting on the command line, two registries for one
 * prompt, an anchor quote found twice, provenance kept out of the identity, the whole help text, and a child
 * authored first with a counter-case. Level 13 (family `verdict-audit`): whole-token matching of a shared
 * fact, the canonical-prefix warning, and the exit of the gating commands on every verdict mix.
 */

const LOCALIZE = 'packages/core/src/radius/localize.ts';
const SELECT = 'packages/core/src/radius/select.ts';
const SECTIONS = 'packages/core/src/radius/sections.ts';
const LINKS = 'packages/core/src/radius/links.ts';
const IDENTITY = 'packages/core/src/spec/identity.ts';
const GIVEN = 'packages/core/src/spec/verify-given.ts';
const GATE_EXIT = 'packages/cli/src/commands/gate-exit.ts';
const LOCALIZE_CMD = 'packages/cli/src/commands/radius-localize.ts';

function draft(
  id: string,
  family: 'link-audit' | 'verdict-audit',
  tier: Tier,
  component: string,
  title: string,
  cause: string,
  check: BankItem['check'],
): Draft {
  return {
    id: `audit/${id}`,
    family,
    tier,
    level: family === 'link-audit' ? 12 : 13,
    component,
    title,
    cause,
    check,
    source: 'adversarial',
  };
}

const slug = (cls: string) => cls.toLowerCase().replace(/_/g, '-');

// ---------------------------------------------------------------------------------------------------------
// The reference over runs that differ: the doc's soft weight is failed rows over rows, per block, over the
// suite runs (docs/concepts/blast-radius.md, "Localisation over sections"). Each run says which blocks fail
// and which are no row (not run or blocked); grouped counting drops a failure whose ancestor failed in that
// same run.

type RunTruth = { failing: ReadonlySet<string>; absent: ReadonlySet<string> };

function softReference(
  rows: readonly ReferenceRow[],
  truths: readonly RunTruth[],
  local: readonly string[],
  counting: 'grouped' | 'flat',
): { scores: Map<string, number>; failureWeight: number; roots: string[] } {
  const weight = new Map<string, number>();
  const roots = new Set<string>();
  for (const row of rows) {
    let n = 0;
    let failed = 0;
    for (const truth of truths) {
      if (truth.absent.has(row.key)) continue;
      const fails = truth.failing.has(row.key);
      if (counting === 'grouped' && fails && row.ancestors.some((ancestor) => truth.failing.has(ancestor)))
        continue;
      n += 1;
      if (fails) {
        failed += 1;
        roots.add(row.key);
      }
    }
    if (n > 0) weight.set(row.key, failed / n);
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
  return { scores, failureWeight, roots: [...roots].sort() };
}

/** The truth of each suite run read from its plant, and its absent blocks read from the statuses not run. */
function truthsOf(suite: LinkedSuite, runs: readonly RunResult[], plantOf: (repeat: number) => SuitePlant) {
  const byRepeat = new Map<number, { failing: Set<string>; absent: Set<string> }>();
  for (const run of runs) {
    const truth = byRepeat.get(run.repeat) ?? { failing: new Set<string>(), absent: new Set<string>() };
    const s = suite.flows.findIndex((flow) => flow.spec.id === run.specId);
    for (const [b, classes] of plantOf(run.repeat).get(s) ?? new Map())
      if (classes.length > 0) truth.failing.add(`${run.specId}#b${b}`);
    for (const block of run.blocks) {
      const status = blockStatus(block);
      if (status === 'not_run' || status === 'blocked')
        truth.absent.add(`${run.specId}#${block.blockId ?? `b${block.index}`}`);
    }
    byRepeat.set(run.repeat, truth);
  }
  return [...byRepeat.values()];
}

/** Compares localizeRuns with the soft reference: the failure weight, the roots and every local score. */
function softDifference(
  suite: LinkedSuite,
  runs: readonly RunResult[],
  mode: RunMode,
  counting: 'grouped' | 'flat',
  rows: readonly ReferenceRow[],
  truths: readonly RunTruth[],
): string | undefined {
  const got = localizeRuns(
    suite.flows.map((flow) => loadRaw(flow.spec)),
    runs,
    suite.registry,
    { mode, counting },
  );
  const local = suite.registry.sections.filter((s) => s.scope === 'local').map((s) => s.id);
  const want = softReference(rows, truths, local, counting);
  if (want.failureWeight === 0)
    throw new Error('the bank planted nothing that fails: the item would be vacuous');
  if (Math.abs(got.localization.failureWeight - want.failureWeight) > 1e-9)
    return `failure weight ${got.localization.failureWeight}, expected ${want.failureWeight}`;
  const roots = [...got.localization.roots].sort();
  if (roots.join(',') !== want.roots.join(','))
    return `roots ${roots.join(', ') || 'none'}, expected ${want.roots.join(', ')}`;
  for (const section of local) {
    const score = got.localization.sections.find((each) => each.section === section)?.score ?? 0;
    const expected = want.scores.get(section) ?? 0;
    if (Math.abs(score - expected) > 1e-9)
      return `the section ${section} scores ${score.toFixed(6)}, expected ${expected.toFixed(6)}`;
  }
  return undefined;
}

async function runPlanted(
  suite: LinkedSuite,
  plantOf: (repeat: number) => SuitePlant,
  mode: RunMode,
  repeats: number,
): Promise<RunResult[]> {
  const runs: RunResult[] = [];
  for (const [s, flow] of suite.flows.entries())
    for (let repeat = 0; repeat < repeats; repeat += 1)
      runs.push(
        await runScenario(flow.spec, behavioursFor(flow, plantOf(repeat).get(s) ?? new Map()), {
          mode,
          repeat,
        }),
      );
  return runs;
}

// B01: a block that fails on some repeats only weighs failed rows over rows.
function softRepeats(): Draft[] {
  return OPERATOR_ORDER.map((cls) => {
    const id = `soft-repeats/${slug(cls)}`;
    return draft(
      id,
      'link-audit',
      3,
      LOCALIZE,
      `${cls} planted on one of three repeats: the block weighs one third, failed rows over rows, and every section scores as the formula does`,
      'localizeRuns weighs a block by its failed rows over its rows, not by whether it ever failed',
      async ({ seed }) => {
        const suite = linkedSuite(seed, id);
        const at = plantAt(seed, id, suite.flows.length, 4);
        const failingRepeat = between(rngFor(seed, `${id}-repeat`), 0, 2);
        const plantOf = (repeat: number): SuitePlant =>
          repeat === failingRepeat ? new Map([[at.s, new Map([[at.b, [cls]]])]]) : new Map();
        const runs = await runPlanted(suite, plantOf, 'F', 3);
        const diff = softDifference(
          suite,
          runs,
          'F',
          'grouped',
          suiteRows(suite, 'F'),
          truthsOf(suite, runs, plantOf),
        );
        return diff ? fail(`${cls} on repeat ${failingRepeat} of 3: ${diff}`) : PASS;
      },
    );
  });
}

// B04: a refuted link adds nothing; a section reached only by refuted links has no covering block.
function refuted(): Draft[] {
  const out: Draft[] = [];
  for (const cls of OPERATOR_ORDER.slice(0, 5))
    for (const mode of ['F', 'T'] as const) {
      const id = `refuted/${slug(cls)}/${mode}`;
      out.push(
        draft(
          id,
          'link-audit',
          3,
          LOCALIZE,
          `${cls} on a block whose own link is refuted, mode ${mode}: the refuted section is charged nothing, and the spec-wide section takes the failure`,
          'localizeRows leaves a refuted link out of the sections a block covers',
          async ({ seed }) => {
            const suite = linkedSuite(seed, id);
            const at = plantAt(seed, id, suite.flows.length, 4);
            const flow = suite.flows[at.s] as Flow;
            const own = (flow.spec.metadata as { links: BlockLink[] }).links.find(
              (link) => link.block === `b${at.b}`,
            );
            if (!own) throw new Error('the bank lost the planted block link');
            own.status = 'refuted';
            const plantOf = (): SuitePlant => new Map([[at.s, new Map([[at.b, [cls]]])]]);
            const runs = await runPlanted(suite, plantOf, mode, 2);
            const refutedSection = suite.own[at.s]?.[at.b] as string;
            const rows = suiteRows(suite, mode).map((row) =>
              row.key === `${flow.spec.id}#b${at.b}`
                ? { ...row, sections: row.sections.filter((section) => section !== refutedSection) }
                : row,
            );
            const diff = softDifference(suite, runs, mode, 'grouped', rows, truthsOf(suite, runs, plantOf));
            return diff ? fail(`${cls}, the own link refuted: ${diff}`) : PASS;
          },
        ),
      );
    }
  return out;
}

// B23: a block not run is no row of the localisation.
function notRunInside(): Draft[] {
  const out: Draft[] = [];
  for (const cls of OPERATOR_ORDER.slice(0, 6))
    for (const mode of ['F', 'T'] as const) {
      const id = `not-run-inside/${slug(cls)}/${mode}`;
      out.push(
        draft(
          id,
          'link-audit',
          4,
          LOCALIZE,
          `${cls} on one block and a Given error on the next, mode ${mode}: the blocks not run are no rows, and every section scores as the formula does without them`,
          'localizeRuns leaves a block not run or blocked out of the rows',
          async ({ seed }) => {
            const suite = linkedSuite(seed, id);
            const at = plantAt(seed, id, suite.flows.length, 3);
            const flow = suite.flows[at.s] as Flow;
            const next = (flow.spec.blocks as Array<Record<string, unknown>>)[at.b + 1] as Record<
              string,
              unknown
            >;
            next.given = {
              prefix: [
                { role: 'user', content: 'Hello.' },
                {
                  role: 'assistant',
                  content: 'Looking.',
                  tool_calls: [{ id: 'c', label: LOOKUP, input: {} }],
                },
              ],
            };
            const plantOf = (): SuitePlant => new Map([[at.s, new Map([[at.b, [cls]]])]]);
            const runs = await runPlanted(suite, plantOf, mode, 2);
            const truths = truthsOf(suite, runs, plantOf);
            if (!truths.every((truth) => truth.absent.has(`${flow.spec.id}#b${at.b + 1}`)))
              return fail(
                `block ${at.b + 1}, with an unpaired prefix call, was run: ${failingList(runs[0] as RunResult)}`,
              );
            const diff = softDifference(suite, runs, mode, 'grouped', suiteRows(suite, mode), truths);
            return diff ? fail(`${cls} at ${at.b}, not run from ${at.b + 1}: ${diff}`) : PASS;
          },
        ),
      );
    }
  return out;
}

// B24: in mode T a block inherits nothing, so two adjacent failures are two roots.
function adjacentT(): Draft[] {
  return OPERATOR_ORDER.map((cls, index) => {
    const next = OPERATOR_ORDER[(index + 3) % OPERATOR_ORDER.length] as string;
    const id = `adjacent-t/${slug(cls)}-${slug(next)}`;
    return draft(
      id,
      'link-audit',
      3,
      LOCALIZE,
      `${cls} then ${next} on the next block of a mode T suite: a block of mode T inherits nothing, so both failures are roots`,
      'localizeRows gives a block of mode T no ancestors',
      async ({ seed }) => {
        const suite = linkedSuite(seed, id);
        const at = plantAt(seed, id, suite.flows.length, 3);
        const plantOf = (): SuitePlant =>
          new Map([
            [
              at.s,
              new Map([
                [at.b, [cls]],
                [at.b + 1, [next]],
              ]),
            ],
          ]);
        const runs = await runPlanted(suite, plantOf, 'T', 2);
        const diff = softDifference(
          suite,
          runs,
          'T',
          'grouped',
          suiteRows(suite, 'T'),
          truthsOf(suite, runs, plantOf),
        );
        return diff ? fail(`${cls} at ${at.b} and ${next} at ${at.b + 1}, mode T: ${diff}`) : PASS;
      },
    );
  });
}

// B21: radius localize --counting flat on a campaign with an inherited failure.
function flatChain(): Draft[] {
  const out: Draft[] = [];
  for (const cls of ['X1_local', 'X5_tool', 'D4_loose_confirmation', 'D9_out_of_scope'])
    for (const counting of ['flat', 'grouped'] as const) {
      const id = `chain-counting/${slug(cls)}/${counting}`;
      out.push(
        draft(
          id,
          'link-audit',
          3,
          LOCALIZE_CMD,
          `${cls} on two adjacent blocks of a stored F campaign: radius localize --counting ${counting} ${counting === 'flat' ? 'counts the inherited failure' : 'drops the inherited failure'}, score for score`,
          'radius localize passes --counting to the localisation',
          async ({ seed, scratch }) => {
            const suite = linkedSuite(seed, id);
            const dir = join(scratch, id.replace(/[^A-Za-z0-9-]/g, '-'));
            const made = await written(suite, dir);
            if (typeof made === 'string') return fail(made);
            const at = plantAt(seed, id, suite.flows.length, 3);
            const plantOf = (): SuitePlant =>
              new Map([
                [
                  at.s,
                  new Map([
                    [at.b, [cls]],
                    [at.b + 1, ['X1_local']],
                  ]),
                ],
              ]);
            const runs = await runPlanted(suite, plantOf, 'F', 2);
            await storeCampaign(join(dir, 'runs.db'), 'c-count', runs, 'F', 2);
            const got = await cli(
              [
                'radius',
                'localize',
                'specs',
                '--store',
                'runs.db',
                '--campaign',
                'c-count',
                '--sections',
                'reg.yaml',
                '--counting',
                counting,
                '--top',
                '0',
                '--json',
              ],
              dir,
            );
            const doc = json(got.out) as
              | { localization?: { sections: Array<{ section: string; score: number }> } }
              | undefined;
            if (got.code !== 0 || !doc?.localization)
              return fail(`radius localize exited ${got.code}: ${(got.err || got.out).slice(0, 200)}`);
            const local = made.registry.sections.filter((s) => s.scope === 'local').map((s) => s.id);
            const want = softReference(
              suiteRows(suite, 'F'),
              truthsOf(suite, runs, plantOf),
              local,
              counting,
            );
            for (const section of local) {
              const score = doc.localization.sections.find((each) => each.section === section)?.score ?? 0;
              if (Math.abs(score - (want.scores.get(section) ?? 0)) > 1e-9)
                return fail(
                  `the section ${section} prints ${score}, expected ${(want.scores.get(section) ?? 0).toFixed(6)}`,
                );
            }
            return PASS;
          },
        ),
      );
    }
  return out;
}

const manifestOf = (section: string): ChangeManifest =>
  ({
    from: 'v1',
    to: 'v2',
    changes: [{ kind: 'prompt_section', id: `${PROMPT}#${section}` }],
  }) as ChangeManifest;

// B27: two registries that describe one prompt are an error: selection reads every block.
function twoRegistries(): Draft[] {
  const out: Draft[] = [];
  for (const form of ['id', 'index'] as const) {
    const id = `two-registries/select/${form}`;
    out.push(
      draft(
        id,
        'link-audit',
        2,
        LINKS,
        `advisory selection given two registries of one prompt selects every block and names the two registries (links by ${form})`,
        'registriesByPrompt refuses two registries that describe one prompt',
        async ({ seed }) => {
          const suite = linkedSuite(seed, id, { form });
          const at = plantAt(seed, id, suite.flows.length, 4);
          const got = sectionSelection(
            suite.flows.map((flow) => {
              const spec = loadRaw(flow.spec);
              return { spec, hash: specHash(spec) };
            }),
            manifestOf(suite.own[at.s]?.[at.b] as string),
            [suite.registry, { ...suite.registry, version: 'v1-copy' }],
          );
          return expectAll([
            [got.all !== null && /two section registries/.test(got.all), `all is ${got.all}`],
            [
              got.specs.every((spec) => spec.blocks.every((block) => block.state !== 'out')),
              'a block is out',
            ],
          ]);
        },
      ),
    );
    const cliId = `two-registries/cli/${form}`;
    out.push(
      draft(
        cliId,
        'link-audit',
        3,
        LINKS,
        `radius --sections with two registries of one prompt prints an advisory selection of every block (links by ${form})`,
        'registriesByPrompt refuses two registries that describe one prompt',
        async ({ seed, scratch }) => {
          const suite = linkedSuite(seed, cliId, { form });
          const dir = join(scratch, cliId.replace(/[^A-Za-z0-9-]/g, '-'));
          const made = await written(suite, dir);
          if (typeof made === 'string') return fail(made);
          writeFileSync(join(dir, 'reg-copy.yaml'), stringify({ ...made.registry, version: 'v1-copy' }));
          const at = plantAt(seed, cliId, suite.flows.length, 4);
          writeFileSync(join(dir, 'change.yaml'), stringify(manifestOf(suite.own[at.s]?.[at.b] as string)));
          const got = await cli(
            [
              'radius',
              'specs',
              '--change',
              'change.yaml',
              '--sections',
              'reg.yaml',
              'reg-copy.yaml',
              '--json',
            ],
            dir,
          );
          const doc = json(got.out) as { advisory?: { all: string | null } } | undefined;
          return doc?.advisory?.all
            ? PASS
            : fail(
                `radius exited ${got.code} and the advisory selection is ${doc?.advisory ? 'partial' : 'absent'}: ${(got.err || got.out).slice(0, 200)}`,
              );
        },
      ),
    );
  }
  return out;
}

// B10: an anchor quote must be found once in the prompt.
function anchorTwice(): Draft[] {
  const out: Draft[] = [];
  const shapes = [
    { id: 'word-of-every-section', quote: () => 'Rule ' },
    {
      id: 'quote-of-another-section',
      quote: (registry: SectionRegistry, at: number) => registry.sections[at + 1]?.anchor.quote ?? '',
    },
    { id: 'heading-mark', quote: () => '## ' },
  ];
  for (const shape of shapes)
    for (const how of ['function', 'command'] as const) {
      const id = `anchor-twice/${shape.id}/${how}`;
      out.push(
        draft(
          id,
          'link-audit',
          how === 'function' ? 2 : 3,
          SECTIONS,
          `${how === 'function' ? 'checkSectionRegistry' : 'radius sections check'} reports an anchor quote that is found more than once in the prompt (${shape.id.replace(/-/g, ' ')})`,
          'checkSectionRegistry requires each anchor quote to be found once in the prompt',
          async ({ seed, scratch }) => {
            const suite = linkedSuite(seed, id);
            const local = suite.registry.sections.findIndex((section) => section.scope === 'local');
            const registry = structuredClone(suite.registry);
            const target = registry.sections[local];
            if (!target) throw new Error('no local section');
            target.anchor = { quote: shape.quote(registry, local) };
            if (how === 'function') {
              const problems = checkSectionRegistry(registry, suite.prompt);
              return problems.length > 0
                ? PASS
                : fail(`no problem reported for the anchor "${target.anchor.quote}"`);
            }
            const dir = join(scratch, id.replace(/[^A-Za-z0-9-]/g, '-'));
            const made = await written(suite, dir);
            if (typeof made === 'string') return fail(made);
            const onDisk = parse(readFileSync(join(dir, 'reg.yaml'), 'utf8')) as SectionRegistry;
            const section = onDisk.sections.find((each) => each.id === target.id);
            if (section) section.anchor = { quote: shape.quote(onDisk, onDisk.sections.indexOf(section)) };
            writeFileSync(join(dir, 'reg.yaml'), stringify(onDisk));
            const got = await cli(['radius', 'sections', 'check', 'reg.yaml', '--prompt', 'v1.md'], dir);
            return got.code === 1 ? PASS : fail(`radius sections check exited ${got.code}, expected 1`);
          },
        ),
      );
    }
  return out;
}

// B20: metadata.provenance stays out of the spec hash, the run id and the cache key.
function provenanceIdentity(): Draft[] {
  const out: Draft[] = [];
  for (const change of ['added', 'changed'] as const)
    for (const what of ['hash', 'cache'] as const) {
      const id = `provenance/${change}/${what}`;
      out.push(
        draft(
          id,
          'link-audit',
          what === 'hash' ? 2 : 3,
          IDENTITY,
          `metadata.provenance ${change} leaves the ${what === 'hash' ? 'spec hash and the run id' : 'cache key'} unchanged`,
          'specHash and the cache key leave metadata.provenance out',
          async ({ seed }) => {
            const flow = plantedFlow(seed, id, 3);
            const before = structuredClone(flow.spec) as RawSpec;
            if (change === 'changed')
              before.metadata = { provenance: { source: 'author', at: '2026-10-01' } };
            const after = structuredClone(flow.spec) as RawSpec;
            after.metadata = { provenance: { source: 'generator', at: '2026-10-18', seed } };
            const behaviours = behavioursFor(flow);
            if (what === 'hash') {
              const a = specHash(loadRaw(before));
              const b = specHash(loadRaw(after));
              const one = await runScenario(before, behaviours);
              const two = await runScenario(after, behaviours);
              return expectAll([
                [a === b, `the spec hash moved from ${a} to ${b}`],
                [one.runId === two.runId, `run id ${one.runId} became ${two.runId}`],
              ]);
            }
            const cache = memoryCache();
            await runScenario(before, behaviours, { cache });
            const recorded = cache.size();
            await runScenario(after, behaviours, { cache });
            return cache.size() === recorded
              ? PASS
              : fail(`the cache grew from ${recorded} to ${cache.size()} entries`);
          },
        ),
      );
    }
  return out;
}

// The cheat on the help items: the whole text of `help <command> <subcommand>` equals that of `--help`.
function helpWhole(): Draft[] {
  return [
    ['radius', 'localize'],
    ['radius', 'sections', 'init'],
    ['radius', 'sections', 'check'],
    ['radius', 'sections', 'reanchor'],
  ].map((command) => {
    const id = `help-whole/${command.slice(1).join('-')}`;
    return draft(
      id,
      'link-audit',
      2,
      'packages/cli/src/main.ts',
      `driftbench help ${command.join(' ')} prints the same text as driftbench ${command.join(' ')} --help, option for option`,
      'driftbench help <command> prints the usage of a subcommand of radius',
      async ({ root }) => {
        const viaHelp = await cli(['help', ...command], root);
        const viaFlag = await cli([...command, '--help'], root);
        return expectAll([
          [viaFlag.out.includes('--'), 'the --help text lists no option'],
          [viaHelp.out === viaFlag.out, 'the two texts differ'],
        ]);
      },
    );
  });
}

// The cheat on the child-first selection: a block authored before the changed parent that does not descend
// from it stays out, while the descendant authored first is selected.
function childFirstCounter(): Draft[] {
  const out: Draft[] = [];
  const shapes = [
    {
      id: 'root-first',
      order: [3, 1, 0, 2],
      parents: [
        [1, 0],
        [2, 1],
      ] as Array<[number, number]>,
    },
    {
      id: 'other-root-between',
      order: [1, 3, 0, 2],
      parents: [
        [1, 0],
        [2, 0],
      ] as Array<[number, number]>,
    },
    {
      id: 'other-child-first',
      order: [2, 1, 0, 3],
      parents: [
        [1, 0],
        [2, 3],
      ] as Array<[number, number]>,
    },
  ];
  for (const shape of shapes)
    for (const form of ['id', 'index'] as const) {
      const id = `child-first-counter/${shape.id}/${form}`;
      out.push(
        draft(
          id,
          'link-audit',
          4,
          SELECT,
          `a change to a parent selects its descendant authored before it and leaves out a block authored before it that does not descend from it (${shape.id.replace(/-/g, ' ')}, links by ${form})`,
          'sectionSelection follows block-level parent edges to every descendant, whatever the authored order',
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
            const parentOf = new Map(shape.parents);
            raw.blocks = shape.order.map((truth) => {
              const block = { ...(source[truth] as Record<string, unknown>) };
              const parent = parentOf.get(truth);
              if (parent !== undefined) block.parent = `b${parent}`;
              return block;
            });
            if (form === 'index')
              for (const link of (raw.metadata as { links: BlockLink[] }).links)
                if (typeof link.block === 'number') link.block = shape.order.indexOf(link.block);
            const got = sectionSelection(
              suite.flows.map((each) => {
                const spec = loadRaw(each.spec);
                return { spec, hash: specHash(spec) };
              }),
              manifestOf(suite.own[s]?.[0] as string),
              [registryOf(suite.prompt, 'v1', [suite.global])],
            );
            const mine = got.specs.find((spec) => spec.specId === flow.spec.id);
            const descends = (truth: number): boolean => {
              for (let up = parentOf.get(truth); up !== undefined; up = parentOf.get(up))
                if (up === 0) return true;
              return false;
            };
            const parentAt = shape.order.indexOf(0);
            for (const [position, truth] of shape.order.entries()) {
              const block = mine?.blocks.find((each) => each.index === position);
              const state = block?.state ?? 'absent';
              if (descends(truth) && state === 'out') return fail(`b${truth} descends from b0 and is out`);
              if (!descends(truth) && truth !== 0 && position < parentAt && state !== 'out')
                return fail(
                  `b${truth}, authored before b0 and not its descendant, is ${state}: ${block?.why.join('; ')}`,
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
// Level 13.

type Block = Record<string, unknown>;

// B16: a shared fact is matched on whole tokens.
function wholeTokens(): Draft[] {
  const out: Draft[] = [];
  const shapes = [
    { id: 'inside-a-number', value: '42', message: 'My order number is 14217.' },
    { id: 'prefix-of-a-word', value: 'ship', message: 'Please check the shipment.' },
  ];
  for (const shape of shapes)
    for (const mode of ['F', 'T'] as const) {
      const id = `whole-tokens/${shape.id}/${mode}`;
      out.push(
        draft(
          id,
          'verdict-audit',
          3,
          GIVEN,
          `a shared fact whose value is only part of a token of the message it names (${shape.id.replace(/-/g, ' ')}), mode ${mode}: the block is not run (value_in_message)`,
          'verifyGiven matches a shared fact on whole tokens of the message it names',
          async ({ seed }) => {
            const flow = plantedFlow(seed, id, 4);
            const raw = flow.spec as RawSpec & { given: Record<string, unknown> };
            raw.given = {
              ...raw.given,
              ledger: { ...(raw.given.ledger as Record<string, unknown>), ref: shape.value },
            };
            const k = between(rngFor(seed, `${id}-k`), 0, 3);
            const block = (raw.blocks as Block[])[k] as Block;
            block.given = {
              prefix: [
                { role: 'user', content: shape.message },
                { role: 'assistant', content: 'Noted.' },
              ],
              shared: [{ fact: 'ref', by: 'user', in: 0 }],
            };
            const run = await runScenario(raw, behavioursFor(flow), { mode });
            const target = run.blocks.find((each) => each.index === k);
            return expectAll([
              [
                target !== undefined && blockStatus(target) === 'not_run',
                `block ${k} is ${target ? blockStatus(target) : 'absent'}`,
              ],
              [target?.notRun?.check === 'value_in_message', `notRun.check is ${target?.notRun?.check}`],
            ]);
          },
        ),
      );
    }
  return out;
}

// B17: an unpaired call in a canonical prefix is a warning only: the block runs.
function canonicalWarning(): Draft[] {
  const out: Draft[] = [];
  for (const mode of ['F', 'T'] as const)
    for (const position of ['first', 'last'] as const) {
      const id = `canonical-unpaired/${mode}/${position}`;
      out.push(
        draft(
          id,
          'verdict-audit',
          3,
          GIVEN,
          `a canonical prefix with a tool call that has no result, on the ${position} block of a ${mode} run: a warning only, the block runs and passes`,
          'verifyGiven makes an unpaired call of a canonical prefix a warning, not a Given error',
          async ({ seed }) => {
            const flow = plantedFlow(seed, id, 4);
            const k = position === 'first' ? 0 : 3;
            const block = (flow.spec.blocks as Block[])[k] as Block;
            block.given = {
              origin: 'canonical',
              prefix: [
                { role: 'user', content: 'Hello.' },
                {
                  role: 'assistant',
                  content: 'Looking.',
                  tool_calls: [{ id: 'c', label: LOOKUP, input: {} }],
                },
              ],
            };
            const run = await runScenario(flow.spec, behavioursFor(flow), { mode });
            const target = run.blocks.find((each) => each.index === k);
            return target !== undefined && blockStatus(target) === 'pass'
              ? PASS
              : fail(
                  `block ${k} is ${target ? blockStatus(target) : 'absent'}: ${target?.notRun?.check ?? failingList(run)}`,
                );
          },
        ),
      );
    }
  return out;
}

// B18: the exit of a gating command over every mix of cell states (docs/reference/cli.md, "Exit codes").
function gateExits(): Draft[] {
  const cases: Array<[string[], number]> = [
    [['pass'], 0],
    [['pass', 'pass', 'pass'], 0],
    [['blocked'], 3],
    [['pass', 'blocked'], 3],
    [['not_run'], 3],
    [['pass', 'not_run', 'blocked'], 3],
    [['fail'], 1],
    [['pass', 'fail', 'not_run'], 1],
    [['blocked', 'fail'], 1],
    [['failed', 'pass'], 1],
    [['stopped', 'not_run'], 1],
    [['pass', 'blocked', 'failed'], 1],
  ];
  return cases.map(([states, want]) => {
    const id = `gate-exit/${states.join('-')}`;
    return draft(
      id,
      'verdict-audit',
      states.length > 2 ? 2 : 1,
      GATE_EXIT,
      `a gating command over cells ${states.join(', ')} exits ${want}`,
      'gateExit gives 0 when every cell passes, 3 when nothing failed but a cell was not run or blocked, else 1',
      async () => {
        const { gateExit } = (await import('../../../../../cli/src/commands/gate-exit')) as {
          gateExit: (states: readonly string[]) => number;
        };
        const got = gateExit(states);
        return got === want ? PASS : fail(`gateExit(${states.join(', ')}) gave ${got}, expected ${want}`);
      },
    );
  });
}

/** Every item the audit of version 6 asked for. */
export function auditItems(): BankItem[] {
  return withCauses([
    ...softRepeats(),
    ...refuted(),
    ...notRunInside(),
    ...adjacentT(),
    ...flatChain(),
    ...twoRegistries(),
    ...anchorTwice(),
    ...provenanceIdentity(),
    ...helpWhole(),
    ...childFirstCounter(),
    ...wholeTokens(),
    ...canonicalWarning(),
    ...gateExits(),
  ]);
}
