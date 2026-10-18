import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunMode, RunResult, SectionRegistry } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { parse, stringify } from 'yaml';
import type { Flow } from '../plant';
import { between, rngFor } from '../random';
import {
  blockId,
  failingKeys,
  hideArgv,
  type LinkedSuite,
  linkedSuite,
  PROMPT,
  plantAt,
  referenceOchiai,
  renamePerturbation,
  runSuite,
  type SuitePlant,
  suiteRows,
} from './links-world';
import { OPERATOR_ORDER, withPerturbation } from './reach';
import { type BankItem, type Draft, expectAll, fail, PASS, type Tier, withCauses } from './types';
import { behavioursFor, runScenario } from './world';

/**
 * Level 12, links through the command line: the chain a user runs. `radius sections init` writes the
 * registry of the planted prompt, `radius sections reanchor` finds its sections in an edited version and
 * writes the change manifest, `radius --sections` prints the advisory selection of that change, and
 * `radius localize` ranks the sections from a stored campaign (docs/concepts/blast-radius.md and `driftbench
 * help authoring-prompt-sections`). The plant knows the edited section and the failing block, so every
 * printed state, score and exit code is known before the commands run.
 */

const RADIUS_CMD = 'packages/cli/src/commands/radius.ts';
const SECTIONS_CMD = 'packages/cli/src/commands/radius-sections.ts';
const LOCALIZE_CMD = 'packages/cli/src/commands/radius-localize.ts';

type Cli = { code: number; out: string; err: string };

export async function cli(argv: string[], cwd: string): Promise<Cli> {
  const { main } = (await import('../../../../../cli/src/main')) as {
    main: (argv: string[], io: unknown) => Promise<number>;
  };
  let out = '';
  let err = '';
  const code = await main(argv, {
    out: (text: string) => {
      out += text;
    },
    err: (text: string) => {
      err += text;
    },
    cwd,
  });
  return { code, out, err };
}

function draft(
  id: string,
  family: string,
  tier: Tier,
  component: string,
  title: string,
  cause: string,
  check: BankItem['check'],
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
    source: 'contract',
  };
}

export const json = (text: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

/** Writes the suite's prompt and specs under a folder and the registry through `radius sections init`. */
export async function written(
  suite: LinkedSuite,
  dir: string,
): Promise<{ registry: SectionRegistry } | string> {
  mkdirSync(join(dir, 'specs'), { recursive: true });
  writeFileSync(join(dir, 'v1.md'), suite.prompt);
  for (const flow of suite.flows)
    writeFileSync(join(dir, 'specs', `${flow.spec.id}.yaml`), stringify(flow.spec));
  const init = await cli(
    ['radius', 'sections', 'init', 'v1.md', '--id', PROMPT, '--prompt-version', 'v1', '--out', 'reg.yaml'],
    dir,
  );
  if (init.code !== 0) return `radius sections init exited ${init.code}: ${init.err.slice(0, 200)}`;
  const registry = parse(readFileSync(join(dir, 'reg.yaml'), 'utf8')) as SectionRegistry;
  // The author's step the help names: mark local the sections only their linked blocks reach.
  for (const section of registry.sections)
    section.scope = section.id === suite.global || section.id === 'preamble' ? 'global' : 'local';
  writeFileSync(join(dir, 'reg.yaml'), stringify(registry));
  const local = registry.sections.filter((section) => section.scope === 'local').map((section) => section.id);
  for (const id of [...suite.own.flat(), ...suite.spec])
    if (!local.includes(id))
      return `radius sections init wrote no section ${id} (it wrote ${local.join(', ')})`;
  return { registry };
}

// ---------------------------------------------------------------------------------------------------------
// chain-select: an edit of the prompt, re-anchored, selected.

const EDITS = ['inside', 'removed', 'reordered', 'outside'] as const;
type Edit = (typeof EDITS)[number];

/** The section text of `id` in the planted prompt: from its heading to the next heading. */
function sectionText(prompt: string, id: string): string {
  const start = prompt.indexOf(`## ${id}\n`);
  const next = prompt.indexOf('\n## ', start + 1);
  return prompt.slice(start, next < 0 ? prompt.length : next + 1);
}

function edited(prompt: string, edit: Edit, target: string, other: string): string {
  const text = sectionText(prompt, target);
  switch (edit) {
    case 'inside':
      return prompt.replace(`Rule ${target}:`, `Rule ${target}, as amended:`);
    case 'removed':
      return prompt.replace(text, '');
    case 'reordered': {
      const second = sectionText(prompt, other);
      return prompt.replace(text, '\u0000').replace(second, text).replace('\u0000', second);
    }
    case 'outside':
      return prompt.replace(text, `${text}\nAlways greet the customer by name.\n`);
  }
}

function selectChain(): Draft[] {
  const out: Draft[] = [];
  for (const edit of EDITS)
    for (const form of ['id', 'index'] as const) {
      const id = `chain-select/${edit}/${form}`;
      out.push(
        draft(
          id,
          'link-chain',
          edit === 'reordered' ? 4 : edit === 'outside' ? 3 : 2,
          edit === 'outside' || edit === 'reordered' ? SECTIONS_CMD : RADIUS_CMD,
          `a section ${edit === 'inside' ? 'edited inside' : edit === 'removed' ? 'removed' : edit === 'reordered' ? 'moved before another' : 'left alone while text is added outside every section'}: reanchor exits 1 and writes the change, and radius --sections selects the planted block through its link (links by ${form})`,
          edit === 'outside'
            ? 'radius sections reanchor writes a global prompt change for text added outside every section'
            : edit === 'reordered'
              ? 'radius sections reanchor writes a prompt_section change per reordered section and radius --sections selects their linked blocks'
              : 'radius --sections selects the blocks linked to a section reanchor found stale',
          async ({ seed, scratch }) => {
            const suite = linkedSuite(seed, id, { form });
            const dir = join(scratch, id.replace(/[^A-Za-z0-9-]/g, '-'));
            const made = await written(suite, dir);
            if (typeof made === 'string') return fail(made);
            const at = plantAt(seed, id, suite.flows.length, 4);
            const target = suite.own[at.s]?.[at.b] as string;
            const other = suite.own[(at.s + 1) % suite.flows.length]?.[(at.b + 2) % 4] as string;
            writeFileSync(join(dir, 'v2.md'), edited(suite.prompt, edit, target, other));
            const re = await cli(
              [
                'radius',
                'sections',
                'reanchor',
                'reg.yaml',
                '--prompt',
                'v1.md',
                'v2.md',
                '--to-version',
                'v2',
                '--out',
                'reg2.yaml',
                '--change-out',
                'change.yaml',
                '--json',
              ],
              dir,
            );
            if (re.code !== 1)
              return fail(
                `reanchor exited ${re.code}, expected 1 (the prompt changed): ${(re.err || re.out).slice(0, 200)}`,
              );
            const report = json(re.out) as
              | { sections?: Array<{ id: string; status: string }>; outside?: string[]; reordered?: string[] }
              | undefined;
            if (!report) return fail(`reanchor --json printed no JSON: ${re.out.slice(0, 200)}`);
            const manifest = parse(readFileSync(join(dir, 'change.yaml'), 'utf8')) as {
              changes: Array<{ kind: string; id?: string; global?: boolean }>;
            };
            if (edit === 'outside') {
              const radius = await cli(
                ['radius', 'specs', '--change', 'change.yaml', '--sections', 'reg2.yaml', '--json'],
                dir,
              );
              return expectAll([
                [(report.outside ?? []).length > 0, 'reanchor reports no change outside every section'],
                [
                  report.sections?.every((section) => section.status !== 'stale') === true,
                  'reanchor made a section stale for text added outside it',
                ],
                [
                  manifest.changes.some((change) => change.kind === 'prompt' && change.global === true),
                  `the manifest holds no global prompt change: ${JSON.stringify(manifest.changes)}`,
                ],
                [
                  radius.code === 1,
                  `radius exited ${radius.code}, expected 1: a global change is the whole suite`,
                ],
              ]);
            }
            const changed = edit === 'reordered' ? (report.reordered ?? []) : [target];
            const sections = manifest.changes
              .filter((change) => change.kind === 'prompt_section')
              .map((change) => change.id)
              .sort();
            const want = changed.map((section) => `${PROMPT}#${section}`).sort();
            if (sections.join(',') !== want.join(','))
              return fail(
                `the manifest changes ${sections.join(', ') || 'nothing'}, expected ${want.join(', ')}`,
              );
            if (edit === 'reordered' && !changed.includes(target) && !changed.includes(other))
              return fail(
                `reanchor reports ${changed.join(', ') || 'nothing'} reordered after ${target} moved before ${other}`,
              );
            const radius = await cli(
              ['radius', 'specs', '--change', 'change.yaml', '--sections', 'reg2.yaml', '--json'],
              dir,
            );
            const doc = json(radius.out) as
              | {
                  advisory?: {
                    all: string | null;
                    specs: Array<{
                      specId: string;
                      blocks: Array<{ index: number; state: string; why: string[] }>;
                    }>;
                  };
                }
              | undefined;
            if (!doc?.advisory)
              return fail(
                `radius --sections --json printed no advisory selection: ${(radius.err || radius.out).slice(0, 200)}`,
              );
            if (radius.code !== 1)
              return fail(
                `radius exited ${radius.code}, expected 1: section selection is advisory, the radius is the whole suite`,
              );
            if (doc.advisory.all !== null)
              return fail(`the advisory selection selects every block: ${doc.advisory.all}`);
            // Every block linked to a changed section is direct; the planted block is one of them.
            for (const [s, flow] of suite.flows.entries())
              for (let b = 0; b < 4; b += 1) {
                const linked = changed.includes(suite.own[s]?.[b] as string);
                const block = doc.advisory.specs
                  .find((spec) => spec.specId === flow.spec.id)
                  ?.blocks.find((each) => each.index === b);
                if (linked && block?.state !== 'direct')
                  return fail(
                    `${flow.spec.id} block ${b}, linked to the changed ${suite.own[s]?.[b]}, is ${block?.state ?? 'absent'}`,
                  );
                if (!linked && block?.state === 'direct')
                  return fail(
                    `${flow.spec.id} block ${b} is direct with no link to a changed section: ${block.why.join('; ')}`,
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
// chain-localize: a stored campaign of the plant, ranked by the command.

export async function storeCampaign(
  path: string,
  campaignId: string,
  runs: readonly RunResult[],
  mode: RunMode,
  repeats: number,
) {
  const store = openStore(path);
  try {
    const specs = [
      ...new Map(runs.map((run) => [run.specId, { id: run.specId, hash: run.specHash }])).values(),
    ];
    await store.putCampaign({
      campaignId,
      specs,
      targets: [runs[0]?.target as RunResult['target']],
      modes: [mode],
      repeats: { T: mode === 'T' ? repeats : 0, F: mode === 'F' ? repeats : 0, P: 0 },
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt: '2026-10-11T00:00:00.000Z',
    });
    for (const run of runs) await store.putRun(campaignId, run);
  } finally {
    await store.close();
  }
}

function localizeChain(): Draft[] {
  const out: Draft[] = [];
  const cases: Array<{ cls: string; mode: RunMode; counting: 'grouped' | 'flat' }> = [
    ...OPERATOR_ORDER.map((cls) => ({ cls, mode: 'F' as RunMode, counting: 'grouped' as const })),
    { cls: 'X1_local', mode: 'T', counting: 'grouped' },
    { cls: 'X5_tool', mode: 'T', counting: 'grouped' },
    { cls: 'X2_contradiction', mode: 'F', counting: 'flat' },
    { cls: 'D8_tool_failure', mode: 'F', counting: 'flat' },
  ];
  for (const c of cases) {
    const id = `chain-localize/${c.cls.toLowerCase().replace(/_/g, '-')}/${c.mode}/${c.counting}`;
    out.push(
      draft(
        id,
        'link-chain',
        c.counting === 'flat' ? 3 : c.mode === 'T' ? 3 : 2,
        LOCALIZE_CMD,
        `${c.cls} planted on two failing blocks of a stored ${c.mode} campaign: radius localize --json prints the documented Ochiai score of every section and exits 0`,
        c.mode === 'T'
          ? 'radius localize reads the mode of a campaign that holds one mode, not the F default of radius --mode'
          : 'radius localize reads the stored campaign and prints the localisation of its runs',
        async ({ seed, scratch }) => {
          const suite = linkedSuite(seed, id);
          const dir = join(scratch, id.replace(/[^A-Za-z0-9-]/g, '-'));
          const made = await written(suite, dir);
          if (typeof made === 'string') return fail(made);
          const rng = rngFor(seed, `${id}-plant`);
          const s = between(rng, 0, suite.flows.length - 1);
          const b = between(rng, 0, 2);
          const plant: SuitePlant = new Map([
            [s, new Map([[b, [c.cls]]])],
            [(s + 1) % suite.flows.length, new Map([[between(rng, 0, 3), ['X1_local']]])],
          ]);
          const runs = await runSuite(suite, plant, { mode: c.mode, repeats: 2 });
          await storeCampaign(join(dir, 'runs.db'), 'c-plant', runs, c.mode, 2);
          const got = await cli(
            [
              'radius',
              'localize',
              'specs',
              '--store',
              'runs.db',
              '--campaign',
              'c-plant',
              '--sections',
              'reg.yaml',
              '--counting',
              c.counting,
              '--top',
              '0',
              '--json',
            ],
            dir,
          );
          if (got.code !== 0)
            return fail(
              `radius localize exited ${got.code}, expected 0: ${(got.err || got.out).slice(0, 200)}`,
            );
          const doc = json(got.out) as
            | { localization?: { sections: Array<{ section: string; score: number }> } }
            | undefined;
          if (!doc?.localization)
            return fail(`radius localize --json printed no localization: ${got.out.slice(0, 200)}`);
          const local = made.registry.sections
            .filter((section) => section.scope === 'local')
            .map((section) => section.id);
          const want = referenceOchiai(
            suiteRows(suite, c.mode),
            failingKeys(suite, plant),
            local,
            c.counting,
          );
          for (const section of local) {
            const score = doc.localization.sections.find((each) => each.section === section)?.score;
            const expected = want.scores.get(section) ?? 0;
            if (score === undefined || Math.abs(score - expected) > 1e-9)
              return fail(
                `the section ${section} prints ${score ?? 'nothing'}, expected ${expected.toFixed(6)}`,
              );
          }
          return PASS;
        },
      ),
    );
  }
  for (const mode of ['F', 'T'] as const) {
    const id = `chain-localize/clean/${mode}`;
    out.push(
      draft(
        id,
        'link-chain',
        1,
        LOCALIZE_CMD,
        `radius localize on a stored ${mode} campaign where nothing failed exits 1: every score is 0`,
        'radius localize exits 1 when nothing failed outside inherited failures',
        async ({ seed, scratch }) => {
          const suite = linkedSuite(seed, id);
          const dir = join(scratch, id.replace(/[^A-Za-z0-9-]/g, '-'));
          const made = await written(suite, dir);
          if (typeof made === 'string') return fail(made);
          const runs = await runSuite(suite, new Map(), { mode, repeats: 1 });
          await storeCampaign(join(dir, 'runs.db'), 'c-clean', runs, mode, 1);
          const got = await cli(
            [
              'radius',
              'localize',
              'specs',
              '--store',
              'runs.db',
              '--campaign',
              'c-clean',
              '--sections',
              'reg.yaml',
            ],
            dir,
          );
          return got.code === 1
            ? PASS
            : fail(`radius localize exited ${got.code}, expected 1: ${(got.err || got.out).slice(0, 200)}`);
        },
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// chain-help: docs/reference/cli.md, "-h, --help: print the usage of the program or of a command";
// "driftbench help <command> does the same".

/** The options the help topic authoring-prompt-sections documents for a command, read from its own section. */
function documentedOptions(root: string, command: readonly string[]): string[] {
  const text = readFileSync(join(root, 'packages/cli/help/authoring-prompt-sections.md'), 'utf8');
  const heading = `### driftbench ${command.join(' ')}\n`;
  const start = text.indexOf(heading);
  if (start < 0) return [];
  const ends = [
    text.indexOf('\n### ', start + heading.length),
    text.indexOf('\n## ', start + heading.length),
  ].filter((at) => at >= 0);
  const section = text.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
  return [...new Set([...section.matchAll(/`(--[a-z][a-z-]*)/g)].map((match) => match[1] as string))];
}

function helpItems(): Draft[] {
  const commands = [
    ['radius', 'localize'],
    ['radius', 'sections', 'init'],
    ['radius', 'sections', 'check'],
    ['radius', 'sections', 'reanchor'],
  ];
  const out: Draft[] = [];
  for (const command of commands)
    for (const form of ['flag', 'topic'] as const) {
      const id = `chain-help/${command.slice(1).join('-')}/${form}`;
      out.push(
        draft(
          id,
          'link-chain',
          2,
          form === 'flag' ? RADIUS_CMD : 'packages/cli/src/commands/help.ts',
          `${form === 'flag' ? `driftbench ${command.join(' ')} --help` : `driftbench help ${command.join(' ')}`} prints the usage of that command, exit 0`,
          form === 'flag'
            ? 'the subcommands of radius print their own usage on --help'
            : 'driftbench help <command> prints the usage of a subcommand of radius',
          async ({ root }) => {
            const argv = form === 'flag' ? [...command, '--help'] : ['help', ...command];
            const got = await cli(argv, root);
            const usage = `Usage: driftbench ${command.join(' ')}`;
            // Every option the help topic's table of this command documents is in the usage printed.
            const options = documentedOptions(root, command);
            const missing = options.filter((option) => !got.out.includes(option));
            return expectAll([
              [got.code === 0, `exit ${got.code}`],
              [
                got.out.includes(usage),
                `the output does not start the usage "${usage}": ${got.out.slice(0, 120).replace(/\n/g, ' ')}`,
              ],
              [options.length > 0, `the help topic documents no option of ${command.join(' ')}`],
              [missing.length === 0, `the usage lacks the documented options ${missing.join(', ')}`],
            ]);
          },
        ),
      );
    }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// chain-lint: `spec lint --sections` and `radius sections check`, the two checks the help names for CI.

function lintItems(): Draft[] {
  type Case = {
    id: string;
    tier: Tier;
    title: string;
    cause: string;
    component: string;
    run(dir: string, suite: LinkedSuite, s: number, b: number): Promise<ReturnType<typeof expectAll>>;
  };
  const lint = (dir: string, extra: string[]) =>
    cli(['spec', 'lint', 'specs', '--sections', 'reg.yaml', ...extra], dir);
  const rewrite = (
    dir: string,
    suite: LinkedSuite,
    s: number,
    change: (links: Array<Record<string, unknown>>) => void,
  ) => {
    const flow = suite.flows[s];
    if (!flow) return;
    const raw = structuredClone(flow.spec) as {
      id: string;
      metadata: { links: Array<Record<string, unknown>> };
    };
    change(raw.metadata.links);
    writeFileSync(join(dir, 'specs', `${raw.id}.yaml`), stringify(raw));
  };
  const cases: Case[] = [
    {
      id: 'lint/clean',
      tier: 1,
      component: 'packages/cli/src/commands/spec.ts',
      title: 'spec lint --sections on specs whose every link names a local section of the registry exits 0',
      cause: 'spec lint --sections exits 0 when every link names a known section',
      run: async (dir) => {
        const got = await lint(dir, []);
        return expectAll([
          [got.code === 0, `spec lint exited ${got.code}: ${(got.out + got.err).slice(0, 200)}`],
        ]);
      },
    },
    {
      id: 'lint/unknown-section',
      tier: 1,
      component: 'packages/cli/src/commands/spec.ts',
      title:
        'spec lint --sections exits 1 and names LINK_TARGET_UNKNOWN for a link to a section the registry does not hold',
      cause: 'spec lint --sections fails on a link to a section its registry does not hold',
      run: async (dir, suite, s, b) => {
        rewrite(dir, suite, s, (links) =>
          links.push({
            block: blockId((suite.flows[s] as Flow).spec.id, b),
            to: { kind: 'prompt_section', prompt: PROMPT, section: 'no_such_section' },
            status: 'declared',
          }),
        );
        const got = await lint(dir, ['--json']);
        return expectAll([
          [got.code === 1, `spec lint exited ${got.code}, expected 1`],
          [
            got.out.includes('LINK_TARGET_UNKNOWN'),
            `the JSON names no LINK_TARGET_UNKNOWN: ${got.out.slice(0, 200)}`,
          ],
        ]);
      },
    },
    {
      id: 'lint/stale-warning',
      tier: 2,
      component: 'packages/cli/src/commands/spec.ts',
      title: 'spec lint --sections exits 0 on a stale link, which is a warning, and 1 with --strict',
      cause: 'spec lint --sections reports a stale link as a warning that only --strict fails on',
      run: async (dir, suite, s) => {
        rewrite(dir, suite, s, (links) => {
          (links[0] as Record<string, unknown>).status = 'stale';
        });
        const plain = await lint(dir, []);
        const strict = await lint(dir, ['--strict']);
        return expectAll([
          [plain.code === 0, `spec lint exited ${plain.code} on a warning, expected 0`],
          [strict.code === 1, `spec lint --strict exited ${strict.code}, expected 1`],
          [(plain.out + plain.err).includes('LINK_STALE'), 'the output names no LINK_STALE'],
        ]);
      },
    },
    {
      id: 'lint/unknown-block',
      tier: 2,
      component: 'packages/cli/src/commands/spec.ts',
      title: 'spec lint exits 1 and names LINK_BLOCK_UNKNOWN for a link whose block is past the last one',
      cause: 'spec validate refuses a link whose block names no block of the spec as LINK_BLOCK_UNKNOWN',
      run: async (dir, suite, s) => {
        rewrite(dir, suite, s, (links) => {
          (links[0] as Record<string, unknown>).block = 99;
        });
        const got = await lint(dir, ['--json']);
        return expectAll([
          [got.code === 1, `spec lint exited ${got.code}, expected 1`],
          [
            got.out.includes('LINK_BLOCK_UNKNOWN'),
            `the JSON names no LINK_BLOCK_UNKNOWN: ${got.out.slice(0, 200)}`,
          ],
        ]);
      },
    },
    {
      id: 'check/match',
      tier: 1,
      component: SECTIONS_CMD,
      title: 'radius sections check of the written registry against its own prompt exits 0',
      cause: 'radius sections check exits 0 when the registry describes the prompt',
      run: async (dir) => {
        const got = await cli(
          ['radius', 'sections', 'check', 'reg.yaml', '--prompt', 'v1.md', '--json'],
          dir,
        );
        return expectAll([
          [got.code === 0, `radius sections check exited ${got.code}: ${got.out.slice(0, 200)}`],
        ]);
      },
    },
    {
      id: 'check/edited',
      tier: 2,
      component: SECTIONS_CMD,
      title: 'radius sections check against a prompt edited inside one section exits 1 and names a problem',
      cause: 'radius sections check exits 1 when a section hash no longer matches the prompt',
      run: async (dir, suite, s, b) => {
        const target = suite.own[s]?.[b] as string;
        writeFileSync(
          join(dir, 'v2.md'),
          suite.prompt.replace(`Rule ${target}:`, `Rule ${target}, amended:`),
        );
        const got = await cli(
          ['radius', 'sections', 'check', 'reg.yaml', '--prompt', 'v2.md', '--json'],
          dir,
        );
        const doc = json(got.out) as { problems?: unknown[] } | undefined;
        return expectAll([
          [got.code === 1, `radius sections check exited ${got.code}, expected 1`],
          [(doc?.problems?.length ?? 0) > 0, `the JSON lists no problem: ${got.out.slice(0, 200)}`],
        ]);
      },
    },
    {
      id: 'check/duplicate-id',
      tier: 2,
      component: SECTIONS_CMD,
      title: 'radius sections check of a registry with one id twice exits 2: the registry is invalid',
      cause: 'radius sections check exits 2 on an invalid registry',
      run: async (dir) => {
        const registry = parse(readFileSync(join(dir, 'reg.yaml'), 'utf8')) as SectionRegistry;
        const second = registry.sections[2];
        if (second) second.id = registry.sections[1]?.id ?? second.id;
        writeFileSync(join(dir, 'bad.yaml'), stringify(registry));
        const got = await cli(['radius', 'sections', 'check', 'bad.yaml', '--prompt', 'v1.md'], dir);
        return expectAll([[got.code === 2, `radius sections check exited ${got.code}, expected 2`]]);
      },
    },
    {
      id: 'check/unknown-reference',
      tier: 3,
      component: SECTIONS_CMD,
      title: 'radius sections check of a registry whose section references an unknown section exits 2',
      cause: 'radius sections check exits 2 on an invalid registry',
      run: async (dir) => {
        const registry = parse(readFileSync(join(dir, 'reg.yaml'), 'utf8')) as SectionRegistry;
        const first = registry.sections[1];
        if (first) first.references = ['no_such_section'];
        writeFileSync(join(dir, 'bad.yaml'), stringify(registry));
        const got = await cli(['radius', 'sections', 'check', 'bad.yaml', '--prompt', 'v1.md'], dir);
        return expectAll([[got.code === 2, `radius sections check exited ${got.code}, expected 2`]]);
      },
    },
    {
      id: 'localize/two-registries-one-prompt',
      tier: 3,
      component: LOCALIZE_CMD,
      title:
        'radius localize given two registries of one prompt exits 2: two registries for one prompt are an error',
      cause: 'radius localize refuses two registries that describe one prompt',
      run: async (dir) => {
        writeFileSync(join(dir, 'reg-copy.yaml'), readFileSync(join(dir, 'reg.yaml'), 'utf8'));
        const got = await cli(
          [
            'radius',
            'localize',
            'specs',
            '--store',
            'none.db',
            '--campaign',
            'c',
            '--sections',
            'reg.yaml',
            'reg-copy.yaml',
          ],
          dir,
        );
        return expectAll([[got.code === 2, `radius localize exited ${got.code}, expected 2`]]);
      },
    },
    {
      id: 'localize/bad-counting',
      tier: 1,
      component: LOCALIZE_CMD,
      title: 'radius localize with --counting neither grouped nor flat exits 2',
      cause: 'radius localize exits 2 on a bad option value',
      run: async (dir) => {
        const got = await cli(
          [
            'radius',
            'localize',
            'specs',
            '--store',
            'none.db',
            '--campaign',
            'c',
            '--sections',
            'reg.yaml',
            '--counting',
            'weighted',
          ],
          dir,
        );
        return expectAll([[got.code === 2, `radius localize exited ${got.code}, expected 2`]]);
      },
    },
  ];
  return cases.map((c) => {
    const id = `chain-lint/${c.id}`;
    return draft(id, 'link-chain', c.tier, c.component, c.title, c.cause, async ({ seed, scratch }) => {
      const suite = linkedSuite(seed, id);
      const dir = join(scratch, id.replace(/[^A-Za-z0-9-]/g, '-'));
      const made = await written(suite, dir);
      if (typeof made === 'string') return fail(made);
      const at = plantAt(seed, id, suite.flows.length, 4);
      return c.run(dir, suite, at.s, at.b);
    });
  });
}

/** radius localize --mode P on a stored perturbed campaign: the failure is charged to the authored block. */
function localizePerturbedChain(): Draft[] {
  return ['X1_local', 'X5_tool', 'D4_loose_confirmation', 'D9_out_of_scope'].map((cls) => {
    const id = `chain-localize/perturbed/${cls.toLowerCase().replace(/_/g, '-')}`;
    return draft(
      id,
      'link-chain',
      4,
      LOCALIZE_CMD,
      `${cls} after an injected deviation in a stored P campaign: radius localize --mode P charges the authored block's sections`,
      'localizeRuns maps a mode P block to its authored index, never to its run position after the injected block',
      async ({ seed, scratch }) => {
        const suite = linkedSuite(seed, id, { blocks: 5 });
        const dir = join(scratch, id.replace(/[^A-Za-z0-9-]/g, '-'));
        const made = await written(suite, dir);
        if (typeof made === 'string') return fail(made);
        const rng = rngFor(seed, `${id}-at`);
        const s = between(rng, 0, suite.flows.length - 1);
        const k = between(rng, 1, 3);
        const j = between(rng, k, 3);
        const plant: SuitePlant = new Map([[s, new Map([[j, [cls]]])]]);
        const runs: RunResult[] = [];
        for (const [index, flow] of suite.flows.entries()) {
          const behaviours = behavioursFor(flow, plant.get(index) ?? new Map());
          const perturbationId = renamePerturbation(flow, withPerturbation(flow, behaviours, k), seed, id);
          runs.push(await runScenario(flow.spec, behaviours, { mode: 'P', perturbationId }));
        }
        // The specs on disk carry the perturbation the runs used.
        for (const flow of suite.flows)
          writeFileSync(join(dir, 'specs', `${flow.spec.id}.yaml`), stringify(flow.spec));
        await storeCampaign(join(dir, 'runs.db'), 'c-p', runs, 'P', 1);
        const got = await cli(
          [
            'radius',
            'localize',
            'specs',
            '--store',
            'runs.db',
            '--campaign',
            'c-p',
            '--sections',
            'reg.yaml',
            '--mode',
            'P',
            '--top',
            '0',
            '--json',
          ],
          dir,
        );
        if (got.code !== 0)
          return fail(
            `radius localize exited ${got.code}, expected 0: ${(got.err || got.out).slice(0, 200)}`,
          );
        const doc = json(got.out) as
          | { localization?: { sections: Array<{ section: string; score: number }> } }
          | undefined;
        const top = doc?.localization?.sections[0];
        const want = suite.own[s]?.[j] as string;
        return top?.section === want && top.score > 0
          ? PASS
          : fail(
              `the top section is ${top?.section ?? 'none'} (${top?.score ?? 0}), expected ${want}, the section of authored block ${j}`,
            );
      },
    );
  });
}

/** Every command-line item of the links level. */
export function linkChainItems(): BankItem[] {
  return withCauses([
    ...selectChain(),
    ...localizeChain(),
    ...localizePerturbedChain(),
    ...lintItems(),
    ...helpItems(),
  ]);
}
