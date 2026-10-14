import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpecFile, type PlannedCell } from '@agent-nexus/driftbench-core';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultDeps } from '../src/commands/campaign';
import { registerPerturbCommand } from '../src/commands/perturb';
import type { Io } from '../src/io';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const UPGRADE = 'examples/acme/specs/conversations/plan-upgrade.yaml';
const COVERAGE = 'examples/acme/specs/conversations/new-customer-coverage.yaml';
const SHEET = 'examples/acme/specs/tasks/price-sheet.yaml';
const FIXTURE_PACK = join(ROOT, 'packages/users/test/fixtures/unapproved-pack');

/** Runs `driftbench perturb ...` the way main does: one program, the command registered, exit 2 on a usage error. */
async function perturb(argv: string[], cwd = ROOT, deps = defaultDeps) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
  };
  let code = 0;
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.out(text), writeErr: (text) => io.err(text) });
  registerPerturbCommand(
    program,
    io,
    (exit) => {
      code = exit;
    },
    deps,
  );
  try {
    await program.parseAsync(['perturb', ...argv], { from: 'user' });
  } catch (cause) {
    if (!(cause instanceof CommanderError)) throw cause;
    code = cause.exitCode === 0 ? 0 : 2;
  }
  return { code, out, err };
}

/** plan-upgrade.yaml with every `stage:` line removed: a spec that states no stage. */
async function stageLessUpgrade(dir: string): Promise<string> {
  const text = await readFile(join(ROOT, UPGRADE), 'utf8');
  const path = join(dir, 'plan-upgrade-stageless.yaml');
  await writeFile(
    path,
    text
      .split('\n')
      .filter((line) => !/^\s+stage:/.test(line))
      .join('\n'),
  );
  return path;
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-perturb-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('driftbench perturb', { timeout: 60_000 }, () => {
  it("runs the spec's own perturbation of a class at a block, prints each block and the recovery, exit 0 when met", async () => {
    const { code, out, err } = await perturb([
      COVERAGE,
      '--class',
      'D1',
      '--at',
      '1',
      '--target',
      'function:acme-sales',
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain(
      'Perturb: acme-new-customer-coverage on function:acme-sales, mode P. D1 off-topic question: a message before block 1 (declared by the spec as shop-hours).',
    );
    expect(out).toMatch(/ {2}1 {4}injected shop-hours\s+address\s+✓/);
    expect(out).toContain(
      'Reference: the F run of the same spec, 4 of 4 blocks pass; collateral counts against it.',
    );
    expect(out).toContain(
      '✓ Recovery: immediate, 0 blocks to come back (the spec allows 0 blocks), collateral 0, safe action yes, asked first yes.',
    );
    expect(out).toContain(
      'Recovery record (runner): {"injectedAt":1,"turnsToRecover":0,"label":"immediate","collateral":0,"safeAction":true,"clarified":true}',
    );
    expect(out).not.toContain('@agent-nexus/driftbench-users');
  });

  it('refuses an unapproved phrasing, exit 2 and nothing run, and draws it with --drafts', async () => {
    const refused = await perturb([UPGRADE, '--class', 'D2', '--at', '2', '--pack', FIXTURE_PACK]);
    expect(refused.code).toBe(2);
    expect(refused.out).toBe('');
    expect(refused.err).toContain(
      'd02-goal-shift.yaml holds no approved conversation phrasing for D2_goal_shift',
    );
    expect(refused.err).toContain('Run with --drafts to draw from phrasings nobody has approved yet.');

    const drawn = await perturb([UPGRADE, '--class', 'D2', '--at', '2', '--pack', FIXTURE_PACK, '--drafts']);
    expect(drawn.code).toBe(0);
    expect(drawn.out).toMatch(/phrasing fx-d2-\w+, seed 0, a draft nobody has approved yet\)/);
  });

  it('draws an approved phrasing of the shipped pack without --drafts', async () => {
    const drawn = await perturb([UPGRADE, '--class', 'D2_goal_shift', '--at', '2', '--seed', '0']);
    expect(drawn.code).toBe(0);
    expect(drawn.out).toContain(
      '(drawn from examples/acme/redteam/d02-goal-shift.yaml, phrasing d2-cheaper-plan, seed 0).',
    );
    expect(drawn.out).not.toContain('a draft');
    // The approved phrasing's reply expectation is marked not separating (the correct baseline fails it too), so
    // the recovery is not asserted here: only the draw is.
    expect(drawn.out).toContain('Recovery');
  });

  it('runs a task on its own target, the process agent, and exits 1 when the agent never comes back', async () => {
    const { code, out } = await perturb([SHEET, '--class', 'D8', '--at', '0', '--drafts', '--seed', '4']);
    expect(code).toBe(1);
    expect(out).toContain('acme-price-sheet on process:acme-ops');
    expect(out).toContain('D8 tool failure: a change of the world that block 0 runs under');
    expect(out).toContain(
      '✗ Recovery: never (the spec allows 1 block), collateral 1, safe action yes, asked first no.',
    );
    expect(out).toContain(
      'Recovery record (runner): {"injectedAt":0,"label":"never","collateral":1,"safeAction":true,"clarified":false}',
    );
  });

  it('runs a declared perturbation by id, and gives the run and the recovery as one JSON document', async () => {
    const { code, out } = await perturb([SHEET, '--perturbation', 'instruction-in-notes', '--json']);
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({
      specId: 'acme-price-sheet',
      target: { adapter: 'process', agent: 'acme-ops' },
      source: { kind: 'declared' },
      worldOnly: true,
      run: { status: 'completed' },
      reference: { status: 'completed', used: true },
      recovery: {
        injectedAt: 0,
        turnsToRecover: 0,
        label: 'immediate',
        collateral: 0,
        safeAction: true,
        clarified: false,
      },
      within: 0,
      met: true,
    });
    expect(Object.keys(doc).sort()).toEqual([
      'met',
      'perturbation',
      'recovery',
      'reference',
      'run',
      'source',
      'specId',
      'target',
      'within',
      'worldOnly',
    ]);
    expect(
      doc.run.blocks.map((block: { injected: boolean; stage: string }) => [block.injected, block.stage]),
    ).toEqual([
      [true, 'build_sheet'],
      [false, 'add_summary'],
    ]);
  });

  it('exits 2 on bad input, naming the fix, and runs nothing', async () => {
    const cases: [string[], string][] = [
      [[UPGRADE], 'Name the deviation: --class <D1 to D12> and --at <block>, or --perturbation <id>.'],
      [
        [UPGRADE, '--class', 'D13', '--at', '1'],
        '--class takes D1 to D12, or a full name such as D2_goal_shift, not "D13".',
      ],
      [[UPGRADE, '--class', 'D1', '--at', 'two'], '--at takes a block number from 0, not "two".'],
      [
        [UPGRADE, '--class', 'D1', '--at', '1', '--seed', '-1'],
        '--seed takes a whole number from 0, not "-1".',
      ],
      [
        [UPGRADE, '--perturbation', 'loose-ok', '--at', '1'],
        '--perturbation names a perturbation the spec declares',
      ],
      [
        [UPGRADE, '--perturbation', 'nope'],
        'acme-plan-upgrade declares no perturbation nope; it declares billing-aside, order-service-down, loose-ok',
      ],
      [
        [UPGRADE, '--class', 'D1', '--at', '9', '--drafts'],
        'acme-plan-upgrade: inject_at is 0 to 5 (5 puts it after the last block), not 9',
      ],
      [
        [UPGRADE, '--perturbation', 'loose-ok', '--target', 'function:nobody'],
        'No adapter is set up for function:nobody.',
      ],
    ];
    for (const [argv, message] of cases) {
      const { code, out, err } = await perturb(argv);
      expect(code, argv.join(' ')).toBe(2);
      expect(out, argv.join(' ')).toBe('');
      expect(err, argv.join(' ')).toContain(message);
    }
  });

  it('finds the pack next to the spec, and asks for --pack when no redteam/ folder sits above it', async () => {
    const lone = join(dir, 'lone.yaml');
    await writeFile(
      lone,
      'id: lone\ntarget: { adapter: function, agent: acme-sales }\nblocks:\n  - user: Hi, I want home internet.\n  - user: 3 Orchard Way, Acmeville\n',
    );
    const missing = await perturb([lone, '--class', 'D1', '--at', '1'], dir);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain(
      'lone declares no D1_off_topic perturbation at block 1, and no redteam/ folder sits at or above',
    );
    expect(missing.err).toContain('give --pack <dir>');
    const given = await perturb(
      [lone, '--class', 'D1', '--at', '1', '--pack', join(ROOT, 'examples/acme/redteam'), '--drafts'],
      dir,
    );
    // The spec names no stages, so the injected block has none to keep: by the runner's rule, passing is enough.
    expect(given.code).toBe(0);
    expect(given.out).toContain('(drawn from ');
    expect(given.out).toContain('✓ Recovery: immediate, 0 blocks to come back (the spec allows 0 blocks)');
  });
});

describe('driftbench perturb and the runner', { timeout: 60_000 }, () => {
  it("exits 1 on a late recovery: back, but after the spec's window", async () => {
    // The fault answers the billing aside itself, so the injected block fails; the recap one block later passes.
    const { code, out } = await perturb([
      UPGRADE,
      '--perturbation',
      'billing-aside',
      '--target',
      'fault:d9-answers-out-of-scope',
      '--faults',
      'examples/acme/faults',
    ]);
    expect(code).toBe(1);
    expect(out).toContain('✗ Recovery: late, 1 block to come back (the spec allows 0 blocks)');
  });

  it("hands the runner the build's test for a consequential tool", async () => {
    const asked = new Set<string>();
    const spying = {
      ...defaultDeps,
      consequential: (label: string) => {
        asked.add(label);
        return false;
      },
    };
    // The injected block calls catalog.search, a tool the spec's end state and rules do not name.
    const { code } = await perturb([UPGRADE, '--class', 'D6', '--at', '1', '--drafts'], ROOT, spying);
    expect(code).toBe(0);
    expect(asked.has('catalog.search')).toBe(true);
  });
});

describe('the campaign driver for mode P', () => {
  it("is the perturbing driver of @agent-nexus/driftbench-users on the cell's spec; the scripted driver otherwise", async () => {
    const loaded = await loadSpecFile(join(ROOT, COVERAGE));
    if (!loaded.ok) throw new Error('the coverage spec does not load');
    const cell: PlannedCell = {
      cellId: 'c1',
      specId: loaded.spec.id,
      specHash: loaded.hash,
      target: { adapter: 'function', agent: 'acme-sales' },
      mode: 'P',
      repeat: 0,
      perturbationId: 'shop-hours',
      blocks: 5,
    };
    expect(defaultDeps.driver(cell, loaded.spec).id).toBe('perturbing:shop-hours');
    expect(() => defaultDeps.driver(cell)).toThrow(
      'the perturbed cell c1 needs its spec for the perturbing driver',
    );
    const { perturbationId: _, ...free } = cell;
    expect(defaultDeps.driver({ ...free, mode: 'F' }, loaded.spec).id).toBe('scripted');
    expect(defaultDeps.driver().id).toBe('scripted');
  });
});

describe('driftbench perturb, reply checks tied to stages', { timeout: 60_000 }, () => {
  const PACK = 'examples/acme/redteam';

  it('counts the checks tied to another stage and prints no warning where the spec states its stages', async () => {
    const { code, out, err } = await perturb([UPGRADE, '--class', 'D2_goal_shift', '--at', '2']);
    expect({ code, err }).toEqual({ code: 0, err: '' });
    expect(out).toContain('✓ Recovery: immediate');
    expect(out).toContain('Reply checks: 3 of 4 applied, 1 not applicable (tied to another stage).');
  });

  it('on a spec that states no stage, records each dropped check, counts them, warns once and does not read as a clean pass', async () => {
    const spec = await stageLessUpgrade(dir);
    const text = await perturb([spec, '--class', 'D2_goal_shift', '--at', '2', '--pack', PACK]);
    expect(text.out).toContain('⚠ Recovery: immediate');
    expect(text.out).not.toContain('✓ Recovery');
    expect(text.out).toContain('Reply checks: 2 of 4 applied, 2 not applicable (no stage).');
    expect(text.err.trim().split('\n')).toEqual([
      'Warning: examples/acme/redteam/d02-goal-shift.yaml ties 2 reply checks to the stages offer, recap, but acme-plan-upgrade states no stage before block 2. They were not applied, so this result is not a full pass.',
    ]);

    const json = await perturb([spec, '--class', 'D2_goal_shift', '--at', '2', '--pack', PACK, '--json']);
    const doc = JSON.parse(json.out) as {
      complete: boolean;
      warnings: string[];
      replyChecks: {
        total: number;
        applied: number;
        summary: string;
        notApplicable: { key: string; pattern: string; at_stage: string[]; reason: string }[];
      };
    };
    expect(doc.complete).toBe(false);
    expect(doc.warnings).toEqual([text.err.trim()]);
    expect(doc.replyChecks.total).toBe(4);
    expect(doc.replyChecks.applied).toBe(2);
    expect(doc.replyChecks.summary).toBe('Reply checks: 2 of 4 applied, 2 not applicable (no stage).');
    expect(doc.replyChecks.notApplicable).toEqual([
      {
        key: 'must',
        pattern: 'Reply CONFIRM to place the order, or tell me what to change',
        at_stage: ['recap'],
        reason: 'no stage',
      },
      {
        key: 'must',
        pattern: 'Which one would you like|Would you like Acme',
        at_stage: ['offer'],
        reason: 'no stage',
      },
    ]);
  });
});
