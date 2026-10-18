import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { parentIsolation } from '../../src/runner/isolation';
import { specOf } from './support';

/**
 * The isolation check (plan M5.3), on the plan's planted set: 10 children that read state only their parent
 * gives (positives) and 10 that read none (negatives). Each must be marked `manifest: true` and `false`
 * respectively. A fictional Acme agent behind the function adapter reads the conversation, the world and the
 * variables it is given; no model call.
 */

const driver = createScriptedDriver();
const checks = defaultChecks();

function acme() {
  return functionAdapter({
    deterministic: true,
    respond(messages, world, vars) {
      const user = messages.at(-1)?.content ?? '';
      const said = messages.filter((message) => message.role === 'user').map((message) => message.content);
      const calls = messages.flatMap((message) => message.tool_calls ?? []);
      const ref = (calls.find((call) => call.label === 'lookup')?.output as { ref?: string } | undefined)
        ?.ref;
      const name = said.find((text) => text.startsWith('I am '))?.slice(5);
      const account = world.store?.account;
      const answers: Record<string, string> = {
        open: 'Acme looked you up.',
        'I am Sam Rivera': 'Hello.',
        'What is my reference?': ref ? `Your reference is ${ref}.` : 'I have no reference for you.',
        'Read my reference back.': ref ? `${ref}, as found.` : 'No reference found.',
        'What is my name?': name ? `You are ${name}.` : 'I do not know your name.',
        'Spell my surname.': name ? (name.split(' ').at(-1)?.split('').join(' ') ?? '') : 'I do not know it.',
        'Which channel is this?': vars.channel ? `This is ${String(vars.channel)}.` : 'I cannot tell.',
        'Am I on the phone?': vars.channel === 'phone' ? 'Yes, phone.' : 'No.',
        'What is my account?': account ? `Account ${String(account)}.` : 'No account.',
        'Is my account open?': account ? `Account ${String(account)} is open.` : 'No account.',
        'Did you look me up?': calls.length > 0 ? 'Yes, I looked you up.' : 'Not yet.',
        'How many lookups so far?': `${calls.length} lookups.`,
      };
      const fixed: Record<string, string> = {
        'When is Acme open?': 'Acme opens at 09:00.',
        'Where is Acme?': 'Acme is at 1 Main Street.',
        'What does Mobile M cost?': 'Mobile M costs 25 USD.',
        'Do you sell fiber?': 'Yes, Acme Fiber 300.',
        'What is the support number?': 'Call 202 555 0142.',
        'Can I pay by card?': 'Yes, by card.',
        'Is there a contract?': 'No contract.',
        'What is Mobile L?': 'Mobile L is unlimited.',
        'Do you ship abroad?': 'No, only at home.',
        'Who are you?': 'I am the Acme assistant.',
      };
      const text = answers[user] ?? fixed[user] ?? 'Sorry?';
      return {
        segments: [],
        text,
        toolCalls:
          user === 'open' ? [{ id: 'lookup-1', label: 'lookup', input: {}, output: { ref: 'ACME-7' } }] : [],
        cost: {},
        latencyMs: 0,
      };
    },
  });
}

/** Ten children that need their parent: the history, the user's own words, the variables, the world. */
const POSITIVES: Array<[string, string, string]> = [
  ['ref', 'What is my reference?', 'ACME-7'],
  ['ref-back', 'Read my reference back.', 'ACME-7'],
  ['name', 'What is my name?', 'Sam Rivera'],
  ['surname', 'Spell my surname.', 'R i v e r a'],
  ['channel', 'Which channel is this?', 'phone'],
  ['on-phone', 'Am I on the phone?', 'Yes'],
  ['account', 'What is my account?', 'Account 7'],
  ['account-open', 'Is my account open?', 'is open'],
  ['looked-up', 'Did you look me up?', 'Yes'],
  ['lookups', 'How many lookups so far?', '1 lookups'],
];

/** Ten children that read nothing their parent gives. */
const NEGATIVES: Array<[string, string, string]> = [
  ['hours', 'When is Acme open?', '09:00'],
  ['where', 'Where is Acme?', 'Main Street'],
  ['price', 'What does Mobile M cost?', '25 USD'],
  ['fiber', 'Do you sell fiber?', 'Fiber 300'],
  ['support', 'What is the support number?', '0142'],
  ['card', 'Can I pay by card?', 'card'],
  ['contract', 'Is there a contract?', 'No contract'],
  ['mobile-l', 'What is Mobile L?', 'unlimited'],
  ['abroad', 'Do you ship abroad?', 'at home'],
  ['who', 'Who are you?', 'Acme assistant'],
];

const parentBlocks = [
  {
    id: 'stem',
    user: 'open',
    given: { vars: { channel: 'phone' }, world: { store: { account: 7 } } },
    expect: { ledger_add: { ref: 'ACME-7' } },
  },
  { id: 'intro', parent: 'stem', user: 'I am Sam Rivera' },
];

function plantedSpec() {
  return specOf({
    id: 'isolation-planted',
    blocks: [
      ...parentBlocks,
      ...[...POSITIVES, ...NEGATIVES].map(([id, user, must]) => ({
        id,
        parent: 'intro',
        user,
        expect: { must: [must] },
      })),
    ],
  });
}

describe('the isolation check', () => {
  it.each(['T', 'F'] as const)(
    '%s marks 10 of 10 planted dependencies manifest and 0 of 10 state-free children',
    async (mode) => {
      const report = await parentIsolation(plantedSpec(), {
        adapter: acme(),
        driver,
        checks,
        mode,
        repeat: 0,
      });
      const by = new Map(report.edges.map((edge) => [edge.child, edge]));
      const positives = POSITIVES.map(([id]) => by.get(id));
      const negatives = NEGATIVES.map(([id]) => by.get(id));
      expect(positives.map((edge) => [edge?.child, edge?.linked, edge?.isolated, edge?.manifest])).toEqual(
        POSITIVES.map(([id]) => [id, 'pass', 'fail', true]),
      );
      expect(negatives.map((edge) => [edge?.child, edge?.linked, edge?.isolated, edge?.manifest])).toEqual(
        NEGATIVES.map(([id]) => [id, 'pass', 'pass', false]),
      );
      // The intro reads nothing of its stem: it passes alone too.
      expect(by.get('intro')).toMatchObject({ parent: 'stem', manifest: false });
      expect(report.linked.status).toBe('completed');
    },
  );

  it('marks a child manifest when alone it is no valid spec, naming the fact only its parent adds', async () => {
    const spec = specOf({
      id: 'isolation-retention',
      blocks: [
        parentBlocks[0],
        {
          id: 'recall',
          parent: 'stem',
          user: 'What is my reference?',
          expect: { must: ['ACME-7'], knowledge_retention: [{ fact: 'ref' }] },
        },
      ],
    });
    const report = await parentIsolation(spec, { adapter: acme(), driver, checks, mode: 'T', repeat: 0 });
    expect(report.edges).toHaveLength(1);
    expect(report.edges[0]).toMatchObject({
      child: 'recall',
      linked: 'pass',
      isolated: 'spec_error',
      manifest: true,
    });
    expect(report.edges[0]?.reason).toContain('RETENTION_FACT_UNKNOWN');
  });

  it('gives no verdict for an edge whose linked child was blocked, and says why', async () => {
    const spec = specOf({
      id: 'isolation-blocked',
      blocks: [
        { ...parentBlocks[0], expect: { must: ['Globex'] } },
        { id: 'hours', parent: 'stem', user: 'When is Acme open?', expect: { must: ['09:00'] } },
      ],
    });
    const report = await parentIsolation(spec, { adapter: acme(), driver, checks, mode: 'T', repeat: 0 });
    expect(report.edges[0]).toMatchObject({ child: 'hours', linked: 'blocked', isolated: 'pass' });
    expect(report.edges[0]?.manifest).toBeUndefined();
    expect(report.edges[0]?.reason).toBe('no verdict to compare: linked blocked, isolated pass');
  });

  it('runs the isolated children without filing them or reusing a block subset', async () => {
    const calls: string[] = [];
    const base = acme();
    const adapter = {
      ...base,
      async send(...args: Parameters<typeof base.send>) {
        const [, turn] = args;
        calls.push('user' in turn.stimulus ? turn.stimulus.user : '');
        return base.send(...args);
      },
    };
    const spec = specOf({
      id: 'isolation-calls',
      blocks: [parentBlocks[0], { id: 'hours', parent: 'stem', user: 'When is Acme open?' }],
    });
    const report = await parentIsolation(spec, {
      adapter,
      driver,
      checks,
      mode: 'T',
      repeat: 0,
      blocks: new Set([1]),
    });
    // The linked run replays the stem for the selected child; the isolated run sends the child alone.
    expect(calls).toEqual(['open', 'When is Acme open?', 'When is Acme open?']);
    expect(report.edges[0]).toMatchObject({ child: 'hours', manifest: false });
  });
});
