import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { provenanceHash, type RunOptions, runSpec, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import {
  AgendaEngine,
  type AgentActs,
  batchFlipShares,
  calibrationReport,
  calibrationSelfCheck,
  cassettePort,
  createBlockUser,
  createScriptedDriver,
  ENGINE_DEFAULTS,
  ENGINE_VERSION,
  engineParams,
  flipReport,
  freezeSimulatedRun,
  type LedgerTurn,
  leaks,
  loadPersona,
  NO_AGENT_ACTS,
  type PlannedAct,
  passHatK,
  REALISER_SYSTEM,
  recordingCassettePort,
  rerunFlipRate,
  SimulatedUserError,
  simulatedUserFromPersona,
  TEMPLATE_HASH,
  type UserModelPort,
} from '../src/index';
import { acmeSales, PERSONA_DIR, spec } from './support';

const FACTS = {
  account: 'AC-00017',
  email: 'sam.rivera@example.com',
  address: '88 Summit Avenue, Acmeville',
};

/** The agent turns of the prototype's determinism check (block-sim checks_offline.py), on this fact set. */
const SCRIPT: AgentActs[] = [
  { ...NO_AGENT_ACTS, requested_slots: ['account'] },
  { ...NO_AGENT_ACTS, requested_slots: ['email', 'order_id'], asks_problem_detail: true },
  { ...NO_AGENT_ACTS, says_cannot_do: true },
  { ...NO_AGENT_ACTS, says_resolved: true, asks_anything_else: true },
];

function planSequence(seed: string, script: readonly AgentActs[] = SCRIPT) {
  const engine = new AgendaEngine({ goal: 'move to a plan with more data', facts: FACTS, seed });
  const plans = [engine.plan()];
  for (const acts of script) {
    engine.observe(acts);
    plans.push(engine.plan());
  }
  return plans;
}

describe('the agenda engine', () => {
  it('plans the same acts across 10 runs with the same seed and the same agent turns', () => {
    const runs = Array.from({ length: 10 }, () => JSON.stringify(planSequence('seed-12345')));
    expect(new Set(runs).size).toBe(1);
    // A different seed draws a different plan somewhere: the seed is used.
    const others = Array.from({ length: 10 }, (_, i) => JSON.stringify(planSequence(`seed-${i}`)));
    expect(new Set(others).size).toBeGreaterThan(1);
  });

  it('never says goodbye before the agent signals closure (0 premature stops over 300 seeds)', () => {
    const open: AgentActs[] = [
      { ...NO_AGENT_ACTS, requested_slots: ['email'] },
      { ...NO_AGENT_ACTS, asks_confirmation: true },
      { ...NO_AGENT_ACTS, asks_to_try_something: true },
      { ...NO_AGENT_ACTS, asks_problem_detail: true },
      NO_AGENT_ACTS,
    ];
    let premature = 0;
    for (let seed = 0; seed < 300; seed += 1) {
      for (const plan of planSequence(`p${seed}`, open)) {
        if (plan.acts.some((act) => act.act === 'goodbye')) premature += 1;
      }
    }
    expect(premature).toBe(0);
  });

  it('says goodbye once the agent closes', () => {
    const plans = planSequence('close', [
      { ...NO_AGENT_ACTS, says_resolved: true, asks_anything_else: true },
    ]);
    // The opening plan, then the goodbye.
    expect(plans.at(-1)?.stop).toBe('goodbye');
  });

  it('never plans a value it does not hold (0 invented values over 300 seeds)', () => {
    const asks: AgentActs[] = [
      { ...NO_AGENT_ACTS, requested_slots: ['order_id', 'pin_number'] },
      { ...NO_AGENT_ACTS, requested_slots: ['order_id', 'email'] },
      { ...NO_AGENT_ACTS, requested_slots: ['zip_code'] },
    ];
    let invented = 0;
    let unknown = 0;
    for (let seed = 0; seed < 300; seed += 1) {
      for (const plan of planSequence(`u${seed}`, asks)) {
        for (const act of plan.acts) {
          if (act.act === 'answer' && !Object.hasOwn(FACTS, act.slot)) invented += 1;
          if (act.act === 'dont_know') unknown += 1;
        }
      }
    }
    expect(invented).toBe(0);
    expect(unknown).toBeGreaterThan(0);
  });

  it('gives up when engagement falls, and after its turn budget', () => {
    const refusals = Array.from({ length: 6 }, () => ({ ...NO_AGENT_ACTS, requested_slots: ['email'] }));
    // The same request repeated is unhelpful: engagement falls by 0.15 each time, from 0.8 below 0.3.
    const plans = planSequence('tired', refusals);
    expect(plans.some((plan) => plan.stop === 'abandon')).toBe(true);
    const engine = new AgendaEngine({
      goal: 'g',
      facts: {},
      seed: 'budget',
      params: engineParams({ turn_budget: 2 }),
    });
    expect(engine.plan().stop).toBeUndefined();
    engine.observe(NO_AGENT_ACTS);
    expect(engine.plan().stop).toBeUndefined();
    expect(engine.plan().stop).toBe('abandon');
  });

  it('keeps the front-loading default at 0.5: half of the openings state the problem too', () => {
    expect(ENGINE_DEFAULTS.opening_detail_share).toBe(0.5);
    let detailed = 0;
    for (let seed = 0; seed < 400; seed += 1) {
      const engine = new AgendaEngine({ goal: 'g', facts: FACTS, seed: `o${seed}` });
      if (engine.plan().acts.some((act) => act.act === 'inform_detail')) detailed += 1;
    }
    expect(detailed / 400).toBeGreaterThan(0.42);
    expect(detailed / 400).toBeLessThan(0.58);
  });
});

describe('the leak check', () => {
  it('flags a fact the plan did not give, and ignores a value inside a value it gave', () => {
    const facts = { address: '88 Summit Avenue, Acmeville 20500', zip: '20500', phone: '+1 202 555 0131' };
    expect(leaks('my zip is 20500', facts, new Set())).toEqual(['zip']);
    expect(leaks('88 Summit Avenue, Acmeville 20500', facts, new Set(['address']))).toEqual([]);
    expect(leaks('call me on 202-555-0131', facts, new Set(['address']))).toEqual(['phone']);
  });
});

/** A fake model: the realiser writes each planned act plainly; the labeller answers from a script, by call. */
function fakePort(labels: readonly AgentActs[], family = 'fake'): UserModelPort & { calls: string[] } {
  const calls: string[] = [];
  let labelled = 0;
  return {
    family,
    model: 'fake-1',
    calls,
    async complete(request) {
      calls.push(request.system === REALISER_SYSTEM ? 'realise' : 'label');
      if (request.system !== REALISER_SYSTEM) {
        const acts = labels[labelled] ?? NO_AGENT_ACTS;
        labelled += 1;
        return JSON.stringify(acts);
      }
      const plan = request.user.split('Planned acts for this message:\n')[1]?.split('\n\nStyle:')[0] ?? '';
      const parts = plan.split('\n').map((line) => {
        const given = /^- give your [^:]+: (.*)$/.exec(line);
        if (given) return `It's ${given[1]}`;
        if (line.startsWith('- state what you want')) return 'I keep running out of data on my phone.';
        if (line.startsWith('- explain')) return 'I want a plan with more data.';
        if (line.startsWith('- confirm')) return 'The unlimited one.';
        return 'ok';
      });
      return parts.join(' ');
    },
  };
}

const SAM = {
  mode: 'simulated' as const,
  persona: 'Sam Rivera. A busy Acme mobile customer. Fictional.',
  goal: 'Move the current Acme phone plan to one with more data.',
  hidden_knowledge: { email: 'sam.rivera@example.com' },
  reveal: { email: 'on_request' as const },
  ask_patterns: { email: ['e-?mail'] },
  stop: '###STOP###',
  engine: { acts_per_turn: [1], short_turn_share: 0, opening_detail_share: 0 },
};

const SIMULATED = spec({
  id: 'sim-upgrade',
  target: { adapter: 'function', agent: 'acme-sales' },
  blocks: [
    { when: { user: 'I keep running out of data.', simulated_user: SAM } },
    { when: { user: 'Here is my email address.', simulated_user: SAM } },
    { when: { user: 'The unlimited one, please.', simulated_user: SAM } },
  ],
});

const LABELS: AgentActs[] = [
  { ...NO_AGENT_ACTS, requested_slots: ['email'] },
  { ...NO_AGENT_ACTS, asks_confirmation: true },
];

const WIRING = { checks: defaultChecks(), artifacts: defaultReaders() } satisfies Partial<RunOptions>;

function run(spec: Spec, port: UserModelPort, recordRealizedText = true) {
  const driver = createBlockUser({ spec, port, agentFamily: 'none', judgeFamilies: [] });
  return runSpec(spec, {
    adapter: acmeSales(),
    driver,
    mode: 'F',
    repeat: 0,
    recordRealizedText,
    ...WIRING,
  }).then((result) => ({ result, driver }));
}

describe('a simulated user defined in the block', () => {
  it('plays the spec with the engine and the realiser, and keeps a disclosure ledger', async () => {
    const port = fakePort(LABELS);
    const { result, driver } = await run(SIMULATED, port);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe('completed');
    const sent = result.blocks.map((block) => block.realized?.text);
    expect(sent[0]).toBe('I keep running out of data on my phone.');
    expect(sent[1]).toBe("It's sam.rivera@example.com");
    const ledger = driver.ledger();
    expect(ledger.map((turn) => turn.mode)).toEqual(['simulated', 'simulated', 'simulated']);
    expect(ledger[0]?.plannedActs).toEqual([{ act: 'inform_intent' }]);
    expect(ledger[0]?.disclosed).toEqual([]);
    expect(ledger[1]?.agentActs?.requested_slots).toEqual(['email']);
    expect(ledger[1]?.disclosed).toEqual(['email']);
    expect(ledger[2]?.disclosedTotal).toEqual(['email']);
    expect(ledger[2]?.plannedActs).toEqual([{ act: 'confirm' }]);
    for (const turn of ledger) expect(turn.engagement).toBeGreaterThan(0);
    // The fact reached the model only once planned: the first realiser request does not hold it.
    expect(port.calls[0]).toBe('realise');
  });

  it('gives the model a fact only once the plan gives it', async () => {
    const requests: string[] = [];
    const inner = fakePort(LABELS);
    const port: UserModelPort = {
      family: 'fake',
      model: 'fake-1',
      complete: (request) => {
        if (request.system === REALISER_SYSTEM) requests.push(request.user);
        return inner.complete(request);
      },
    };
    await run(SIMULATED, port);
    expect(requests[0]).not.toContain('sam.rivera@example.com');
    expect(requests[1]).toContain('give your email: sam.rivera@example.com');
  });

  it('pins the seed, the family, the model, the template hash and the engine version', () => {
    const driver = createBlockUser({
      spec: SIMULATED,
      port: fakePort([]),
      agentFamily: 'none',
      judgeFamilies: [],
    });
    expect(driver.seeds).toEqual({
      seed: 'sim-upgrade',
      family: 'fake',
      model: 'fake-1',
      template: TEMPLATE_HASH,
      engine: ENGINE_VERSION,
    });
    expect(driver.id).toBe('simulated-block:fake');
  });

  it('replays a cassette: the same messages, no model call', async () => {
    const recorder = recordingCassettePort(fakePort(LABELS));
    const first = await run(SIMULATED, recorder);
    const cassette = recorder.cassette();
    expect(Object.keys(cassette.entries).length).toBeGreaterThan(0);
    const second = await run(SIMULATED, cassettePort(cassette));
    expect(second.result.blocks.map((block) => block.realized?.hash)).toEqual(
      first.result.blocks.map((block) => block.realized?.hash),
    );
    expect(second.driver.ledger()).toEqual(first.driver.ledger());
    // A request the cassette does not hold fails, naming its key.
    const other = spec({ ...SIMULATED, id: 'sim-upgrade-2' });
    const missing = await run(other, cassettePort(cassette));
    expect(missing.result.status).toBe('failed');
    expect(JSON.stringify(missing.result)).toContain('holds no response for request');
  });

  it('exact sends the user text as written, without the simulated user on the wire', async () => {
    const exact = spec({
      id: 'exact-upgrade',
      target: { adapter: 'function', agent: 'acme-sales' },
      blocks: [{ when: { user: 'I keep running out of data.', simulated_user: { mode: 'exact' } } }],
    });
    const step = await createScriptedDriver().next({ spec: exact, mode: 'F', blockIndex: 0, history: [] });
    expect(step).toEqual({ kind: 'block', blockIndex: 0, stimulus: { user: 'I keep running out of data.' } });
    const { result } = await run(exact, fakePort([]));
    expect(result.blocks[0]?.realized).toBeUndefined();
  });

  it('the scripted driver refuses a simulated block rather than send its authored text', async () => {
    const driver = createScriptedDriver();
    expect(() => driver.next({ spec: SIMULATED, mode: 'F', blockIndex: 0, history: [] })).toThrow(
      /block 0 is simulated/,
    );
  });

  it('refuses a simulated block with no port, a port of the agent family, or two people in one spec', () => {
    expect(() => createBlockUser({ spec: SIMULATED, agentFamily: 'none', judgeFamilies: [] })).toThrow(
      /give a model port or a cassette/,
    );
    expect(() =>
      createBlockUser({
        spec: SIMULATED,
        port: fakePort([], 'anthropic'),
        agentFamily: 'anthropic',
        judgeFamilies: [],
      }),
    ).toThrow(/family of the agent/);
    const two = spec({
      id: 'two',
      blocks: [
        { when: { user: 'a', simulated_user: SAM } },
        { when: { user: 'b', simulated_user: { ...SAM, goal: 'Something else.' } } },
      ],
    });
    expect(() =>
      createBlockUser({ spec: two, port: fakePort([]), agentFamily: 'none', judgeFamilies: [] }),
    ).toThrow(/another simulated user/);
  });

  it('freezes a found failure as replay blocks that the scripted driver plays back exactly', async () => {
    const { result } = await run(SIMULATED, fakePort(LABELS));
    const frozen = freezeSimulatedRun(SIMULATED, result.blocks, result.runId);
    expect(frozen.id).toBe('sim-upgrade-replay');
    for (const [index, block] of frozen.blocks.entries()) {
      const when = block.when as {
        user: string;
        simulated_user: { mode: string; recorded: { hash: string } };
      };
      expect(when.simulated_user.mode).toBe('replay');
      expect(when.user).toBe(result.blocks[index]?.realized?.text);
      expect(when.simulated_user.recorded.hash).toBe(provenanceHash(when.user));
    }
    // The frozen spec loads, and replays the same messages with no model.
    const loaded = spec(frozen);
    const replayed = await runSpec(loaded, {
      adapter: acmeSales(),
      driver: createBlockUser({ spec: loaded, agentFamily: 'none', judgeFamilies: [] }),
      mode: 'F',
      repeat: 0,
      ...WIRING,
    });
    expect(replayed.blocks.map((block) => block.observed.text)).toEqual(
      result.blocks.map((block) => block.observed.text),
    );
    // A tampered replay text is refused.
    const tampered = spec({
      ...frozen,
      blocks: frozen.blocks.map((block, index) =>
        index === 0 ? { ...block, when: { ...(block.when as object), user: 'something else' } } : block,
      ),
    });
    const bad = await runSpec(tampered, {
      adapter: acmeSales(),
      driver: createBlockUser({ spec: tampered, agentFamily: 'none', judgeFamilies: [] }),
      mode: 'F',
      repeat: 0,
      ...WIRING,
    });
    expect(bad.status).toBe('failed');
    expect(JSON.stringify(bad)).toContain('does not match its recorded hash');
    // A run that kept only the hashes cannot be frozen.
    const hashed = await run(SIMULATED, fakePort(LABELS), false);
    expect(() => freezeSimulatedRun(SIMULATED, hashed.result.blocks)).toThrow(SimulatedUserError);
  });

  it('maps a persona file onto the block: facts, reveal on request, ask patterns, stop', async () => {
    const persona = await loadPersona(join(PERSONA_DIR, 'sam-upgrader.yaml'));
    const user = simulatedUserFromPersona(persona);
    expect(user.hidden_knowledge).toEqual({ email: 'sam.rivera@example.com' });
    expect(user.reveal).toEqual({ email: 'on_request' });
    expect(user.ask_patterns).toEqual({ email: ['e-?mail'] });
    expect(user.stop).toBe('###STOP###');
    expect(user.mode).toBe('simulated');
    // It loads as a block's simulated user.
    expect(() => spec({ id: 'p', blocks: [{ when: { user: 'hi', simulated_user: user } }] })).not.toThrow();
  });
});

describe('the calibration report', () => {
  const turn = (text: string, parts: Partial<LedgerTurn> = {}): LedgerTurn => ({
    block: 0,
    mode: 'simulated',
    text,
    disclosed: [],
    disclosedTotal: [],
    ...parts,
  });

  it('measures form from the text and politeness, doubt and ids from the plan', () => {
    const dialogue = [
      turn('I keep running out of data on my phone', {
        style: { short: false, polite: true, uncertain: false, question: false },
      }),
      turn('sam.rivera@example.com', { disclosed: ['email'] }),
      turn('which one is cheaper?', {
        style: { short: false, polite: false, uncertain: true, question: true },
      }),
      turn('ok'),
    ];
    const report = calibrationReport([dialogue]);
    const value = (metric: string) => report.metrics.find((row) => row.metric === metric)?.simulated;
    expect(value('Short%')).toBe(50);
    expect(value('Quest%')).toBe(25);
    expect(value('Polite%')).toBe(25);
    expect(value('Uncert%')).toBe(25);
    expect(value('IDs/turn')).toBe(0.25);
    // 10 of 15 words in the first two messages.
    expect(value('FrntId%')).toBeCloseTo((100 * 10) / 15, 6);
    expect(report.metrics.find((row) => row.metric === 'Polite%')?.source).toBe('plan');
    expect(report.metrics.find((row) => row.metric === 'Short%')?.source).toBe('text');
  });

  it('self-check: forcing a polite message on every turn lowers the Polite% Dice', () => {
    const check = calibrationSelfCheck();
    expect(check.ok).toBe(true);
    expect(check.forcedDice).toBeCloseTo((200 * 20.685) / 120.685, 1);
    expect(check.defaultDice).toBeGreaterThan(70);
  });
});

type H11 = {
  registered: { cross: number; within: number };
  trials: Record<string, Record<string, boolean[]>>;
};

describe('the flip flag', () => {
  it('pass^k equals the brute-force count for every n up to 8', () => {
    for (let n = 1; n <= 8; n += 1) {
      for (let c = 0; c <= n; c += 1) {
        for (let k = 1; k <= n; k += 1) {
          const outcomes = Array.from({ length: n }, (_, i) => i < c);
          let all = 0;
          let subsets = 0;
          const walk = (start: number, chosen: number[]) => {
            if (chosen.length === k) {
              subsets += 1;
              if (chosen.every((i) => outcomes[i])) all += 1;
              return;
            }
            for (let i = start; i < n; i += 1) walk(i + 1, [...chosen, i]);
          };
          walk(0, []);
          expect(passHatK(n, c, k)).toBeCloseTo(all / subsets, 12);
        }
      }
    }
    expect(rerunFlipRate([true, true, true, true])).toBe(0);
    expect(rerunFlipRate([true, false])).toBe(1);
  });

  it('on the H11 data it raises block 1539 and no stable block', async () => {
    const h11 = JSON.parse(await readFile(join(__dirname, 'fixtures', 'h11-flips.json'), 'utf8')) as H11;
    const report = flipReport(h11.trials);
    expect(report.filter((row) => row.flagged).map((row) => row.block)).toEqual(['1539']);
    const stable = report.filter((row) =>
      Object.values(h11.trials[row.block] ?? {}).every((outcomes) => new Set([...outcomes]).size === 1),
    );
    expect(stable.length).toBeGreaterThan(0);
    expect(stable.some((row) => row.flagged)).toBe(false);
    // Without the noise test (alpha above 1), the rerun baseline alone also raises two blocks one trial in
    // eight apart, and no block whose families disagree no more than each disagrees with itself.
    const loose = flipReport(h11.trials, { alpha: 2 });
    expect(loose.filter((row) => row.flagged).map((row) => row.block)).toEqual(['1539', '7860', '8196']);
    const row1539 = report.find((row) => row.block === '1539');
    expect(row1539?.crossFlipRate).toBeCloseTo(0.6875, 6);
    expect(row1539?.rerunFlipRate).toBeCloseTo((0.25 + 24 / 56) / 2, 6);
  });

  it('reproduces the registered H11 shares: cross-family 0.15, within-family 0.20', async () => {
    const h11 = JSON.parse(await readFile(join(__dirname, 'fixtures', 'h11-flips.json'), 'utf8')) as H11;
    const shares = batchFlipShares(h11.trials, ['O', 'G']);
    expect(shares.cross).toBeCloseTo(h11.registered.cross, 9);
    expect(shares.within).toBeCloseTo(h11.registered.within, 9);
  });
});

/** Acts the plan may hold: a type-level guard that the act union stays closed. */
const ALL_ACTS: PlannedAct['act'][] = [
  'inform_intent',
  'inform_detail',
  'answer',
  'dont_know',
  'answer_other',
  'confirm',
  'report_try',
  'repeat_request',
  'accept_outcome',
  'acknowledge',
  'ask_status',
  'goodbye',
  'abandon',
];
it('the act set is the thirteen the realiser can write', () => {
  expect(new Set(ALL_ACTS).size).toBe(13);
});
