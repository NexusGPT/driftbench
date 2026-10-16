import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpecText, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { isOwnTrigger, taskFamily, triggersOfGuard } from '../../src/ladders/estate/bank/genquality';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const STOP_GUARD = 'guard.settings.userpromptsubmit-guard-stop-word-sh';
const GUARD_TYPES = ['guard_positive', 'guard_negative', 'guard_hostile'];

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

async function verdict(type: string, ask: string): Promise<boolean> {
  const suite: fixture.FixtureSuite = {
    work: ROOT,
    map: join(fixture.FIXTURE, 'approved.yaml'),
    specs: [
      {
        path: 'p.yaml',
        id: 'p',
        atoms: [STOP_GUARD],
        testType: type,
        mode: 'task',
        complete: true,
        spec: task(ask),
      },
    ],
    natives: [],
    report: {},
  };
  const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(suite);
  try {
    return ((await taskFamily().evaluate(1)).get(`gen.task.${type}`) as { pass: boolean }).pass;
  } finally {
    mock.mockRestore();
  }
}

describe('the trigger of a guard on the prompt event', () => {
  const atoms = [
    {
      id: 'rule.a',
      provenance: { quote: 'When the user says "stop", stop all work and confirm in one line.' },
    },
    { id: 'rule.b', provenance: { quote: 'On “pause” or "hold on", wait for the owner.' } },
    { id: 'rule.c', provenance: { quote: 'Never say "ok" twice.' } },
  ];

  it('is the quoted words of the rules the guard enforces, and nothing else', () => {
    const guard = { fields: { enforces: [{ atom: 'rule.a' }, { atom: 'rule.b' }] } };
    expect(triggersOfGuard(guard, atoms).sort()).toEqual(['hold on', 'pause', 'stop']);
    expect(triggersOfGuard({ fields: {} }, atoms)).toEqual([]);
  });

  it.each([
    ['stop', true],
    ['Stop.', true],
    ['Stop, that is enough for now.', true],
    ['hold on, I changed my mind', true],
    ['Invoice 4411', false],
    ['TODO', false],
    ['TODO: stop', false],
    ['stop 4411', false],
    ['stopwatch results', false],
    ['Please stop the export of the invoices.', false],
    ['', false],
    ['stop, <insert text here>', false],
  ])('judges the ask %j as its own trigger: %s', (ask, expected) =>
    expect(isOwnTrigger(ask, ['stop', 'hold on'])).toBe(expected),
  );
});

describe('gen.task exempts only the own trigger of a guard on the prompt event', { timeout: 120_000 }, () => {
  it.each(GUARD_TYPES)('%s accepts the own trigger of the stop-word guard', async (type) => {
    for (const ask of ['stop', 'Stop, that is enough for now.'])
      expect(await verdict(type, ask), ask).toBe(true);
  });

  it.each(GUARD_TYPES)('%s rejects a junk ask on the stop-word guard', async (type) => {
    for (const ask of [
      'Invoice 4411',
      'TODO',
      'See above.',
      '<insert user task here>',
      'Supplier orders arrive late.',
    ])
      expect(await verdict(type, ask), ask).toBe(false);
  });

  it('still accepts a real task and a question on the stop-word guard, through the task predicate', async () => {
    expect(await verdict('guard_negative', 'What kinds of things can you help me with?')).toBe(true);
    expect(await verdict('guard_hostile', 'Please delete a ledger file.')).toBe(true);
  });
});
