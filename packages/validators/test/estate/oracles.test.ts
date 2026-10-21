import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultRegistry, ESTATE_CHECKS } from '@agent-nexus/driftbench-checks';
import { type Check, machineVerdict, parseSpecText, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { context, observed } from '../../../checks/test/support/context';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { taskFamily } from '../../src/ladders/estate/bank/genquality';
import { genCompleteFamily, roleOf } from '../../src/ladders/estate/bank/loop';
import { estateMeta } from '../../src/ladders/estate/levels';
import * as pipeline from '../../src/ladders/estate/pipeline';

const APPROVED_TASKS = [
  { type: 'route_positive', text: 'Fill in the shipments late section of the week 41 report.' },
  { type: 'twin', text: 'Go through inbox/ and say which folder each message belongs in.' },
  { type: 'route_positive', text: 'Has NW-55031 arrived yet? The carrier is FRT.' },
];

function task(ask: string): Spec {
  const loaded = parseSpecText(
    JSON.stringify({
      id: 'estate-oracle-task',
      version: '1',
      kind: 'task',
      target: { adapter: 'claude-code' },
      blocks: [{ id: 'ask', when: { user: ask }, expect: { must: ['done'] } }],
    }),
    'json',
  );
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return loaded.spec;
}

async function customVerdicts(custom: Record<string, unknown>, seen = observed('done')) {
  const spec = task('Check the invoice.');
  spec.rules = { ...spec.rules, custom };
  const check = pipeline.replayChecks().find((candidate) => candidate.name === 'custom') as Check;
  expect(check).toBeDefined();
  return check.evaluate(context(spec, 0, seen));
}

describe('the estate bank replay uses the production registry', () => {
  it('recognizes every production estate check without populating the empty global registry', async () => {
    const before = defaultRegistry.names();
    expect(before).toEqual([]);
    for (const name of Object.keys(ESTATE_CHECKS)) {
      const verdicts = await customVerdicts({ [name]: {} });
      expect(
        verdicts.some((verdict) => verdict.evidence?.includes('no check of that name is registered')),
        name,
      ).toBe(false);
    }
    expect(defaultRegistry.names()).toEqual(before);
  });

  it('rejects a wrong tool call instead of treating registration as a passing verdict', async () => {
    const custom = {
      some_call: { calls: [{ label: 'Bash', input: { command: { contains: 'reconcile.py' } } }] },
    };
    const good = await customVerdicts(
      custom,
      observed('done', [{ label: 'Bash', input: { command: 'python3 reconcile.py INV-1001' } }]),
    );
    expect(good).toEqual([expect.objectContaining({ id: 'custom.some_call.0', outcome: 'pass' })]);
    const wrong = await customVerdicts(
      custom,
      observed('done', [{ label: 'Bash', input: { command: 'echo wrong' } }]),
    );
    expect(wrong).toEqual([expect.objectContaining({ id: 'custom.some_call.0', outcome: 'fail' })]);
  });

  it('preserves an explicitly configured default-registry override and leaves global state unchanged', async () => {
    defaultRegistry.register('some_call', () =>
      machineVerdict('override', 'test', 'fail', 'configured override'),
    );
    try {
      const before = defaultRegistry.names();
      expect(await customVerdicts({ some_call: {} })).toEqual([
        expect.objectContaining({ outcome: 'fail', evidence: 'configured override' }),
      ]);
      expect(defaultRegistry.names()).toEqual(before);
    } finally {
      defaultRegistry.unregister('some_call');
    }
  });
});

const COMPLETE_ITEMS = [
  'gen.complete.guard_speed-guard-read-before-edit-py',
  'gen.complete.guard_speed-guard-reply-length-py',
  'gen.complete.obligation-instruction-grounded-values',
  'gen.complete.obligation-instruction-script',
  'gen.complete.outside_trigger-instruction-script',
  'gen.complete.script_fixture-script',
  'gen.complete.twin-instruction-grounded-values',
  'gen.complete.twin-instruction-script',
];

/** Keep all specs of the affected classes; unrelated known generator gaps are outside this regression. */
async function affectedRun(): Promise<pipeline.EstateRun> {
  const run = await pipeline.generationRun(1);
  const atoms = new Map(run.scanned.map.atoms.map((atom) => [atom.id, atom]));
  const specs = run.specs.filter((spec) => {
    const atom = atoms.get(estateMeta(spec).atoms?.[0] ?? '');
    if (!atom) return false;
    const role = roleOf(run.scanned.match.hidOf.get(atom.id) ?? '');
    const key = `${spec.record.testType}|${atom.kind}:${role}`.replace(/[|:.]+/g, '-').replace(/-+$/, '');
    return COMPLETE_ITEMS.includes(`gen.complete.${key}`);
  });
  expect(specs.length).toBeGreaterThan(0);
  return { ...run, specs };
}

describe('the affected gen.complete items', { timeout: 120_000 }, () => {
  it('passes all eight affected classes on their generated specs and rule-follower sessions', async () => {
    const run = await affectedRun();
    const mock = vi.spyOn(pipeline, 'generationRun').mockResolvedValue(run);
    try {
      const verdicts = await genCompleteFamily().evaluate(1);
      expect(Object.fromEntries(COMPLETE_ITEMS.map((id) => [id, verdicts.get(id)]))).toEqual(
        Object.fromEntries(COMPLETE_ITEMS.map((id) => [id, { pass: true, detail: 'holds' }])),
      );
    } finally {
      mock.mockRestore();
    }
  });

  it('still fails the script obligation when the generator expects a command the follower never runs', async () => {
    const run = await affectedRun();
    const source = run.specs.find(
      (spec) => spec.record.testType === 'obligation' && spec.loaded?.spec.rules?.custom?.some_call,
    );
    if (!source?.loaded) throw new Error('no generated script obligation');
    const wrong = structuredClone(source);
    if (!wrong.loaded) throw new Error('no loaded spec');
    wrong.loaded.spec.rules = {
      ...wrong.loaded.spec.rules,
      custom: {
        ...wrong.loaded.spec.rules?.custom,
        some_call: { calls: [{ label: 'Bash', input: { command: { equals: 'wrong-component-command' } } }] },
      },
    };
    const mock = vi.spyOn(pipeline, 'generationRun').mockResolvedValue({ ...run, specs: [wrong] });
    try {
      const verdicts = await genCompleteFamily().evaluate(1);
      expect(verdicts.get('gen.complete.obligation-instruction-script')).toMatchObject({
        pass: false,
        detail: expect.stringMatching(/fails on the rule follower:.*custom\.some_call/),
      });
    } finally {
      mock.mockRestore();
    }
  });
});

describe('approved task asks are judged by the act the fake sets off', () => {
  const bank = parse(readFileSync(join(fixture.FIXTURE, 'phrases.yaml'), 'utf8')) as {
    situations: Array<{ id: string; atoms: string[]; phrases: Array<{ text: string; approved: boolean }> }>;
  };
  const plan = parse(readFileSync(join(fixture.FIXTURE, 'plan.yaml'), 'utf8')) as {
    rows: Array<{ id: string; atomIds: string[]; testType: string }>;
  };
  const situationOf = (text: string) =>
    bank.situations.find((situation) =>
      situation.phrases.some((phrase) => phrase.approved && phrase.text === text),
    );
  // The plan row of the test type whose first atom the situation holds: gen.task judges a spec on its row.
  const rowOf = (type: string, atoms: readonly string[]) =>
    plan.rows.find((row) => row.testType === type && atoms.includes(row.atomIds[0] as string));

  for (const phrase of APPROVED_TASKS) {
    it(`keeps gen.task.${phrase.type} green for the approved ask and red for a rule restated in its place: ${phrase.text}`, async () => {
      const situation = situationOf(phrase.text);
      expect(situation, phrase.text).toBeDefined();
      const row = rowOf(phrase.type, situation?.atoms ?? []);
      expect(row, phrase.text).toBeDefined();
      const asked = (text: string) =>
        ({
          ...task(text),
          metadata: { estate: { ask: 'bank', situation: situation?.id, planRow: row?.id } },
        }) as unknown as Spec;
      const spec = {
        path: 'oracle-task.yaml',
        id: 'oracle-task',
        atoms: row?.atomIds ?? [],
        testType: phrase.type,
        mode: 'task',
        complete: true,
        spec: asked(phrase.text),
      };
      const suite: fixture.FixtureSuite = {
        work: fixture.FIXTURE,
        map: join(fixture.FIXTURE, 'approved.yaml'),
        specs: [spec],
        natives: [],
        report: {},
        checks: fixture.RUNNER_CHECKS,
      };
      const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(suite);
      try {
        expect((await taskFamily().evaluate(1)).get(`gen.task.${phrase.type}`)).toEqual({
          pass: true,
          detail: 'holds (1)',
        });
        mock.mockResolvedValue({
          ...suite,
          specs: [{ ...spec, spec: asked('Please do this: never guess a status.') }],
        });
        expect((await taskFamily().evaluate(1)).get(`gen.task.${phrase.type}`)).toMatchObject({
          pass: false,
          detail: expect.stringContaining('the ask is no phrase of'),
        });
      } finally {
        mock.mockRestore();
      }
    });
  }
});
