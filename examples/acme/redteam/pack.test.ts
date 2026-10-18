import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import type { Observed } from '@agent-nexus/driftbench-core';
import { faultAdapter } from '@agent-nexus/driftbench-generate';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import {
  createPerturbingDriver,
  fromPhrasing,
  loadRedteamPack,
  runAttack,
} from '@agent-nexus/driftbench-users';
import { acmeSales, acmeSpec, PACK_DIR, runP } from '../../../packages/users/test/support';
import { salesFaults } from '../faults/sales';

// Run with: node --import tsx --test examples/acme/redteam/pack.test.ts
const pack = await loadRedteamPack(PACK_DIR);
const spec = await acmeSpec('conversations/order-loose-confirmation.yaml');
const fault = salesFaults.find((entry) => entry.id === 'd2-ignores-goal-shift');
assert.ok(fault);
const broken = () => faultAdapter(fault, () => localProvider({}));

test('the documented Acme attack is clean and the same attacks catch the D2 fault', async () => {
  const clean = await runAttack({
    spec,
    adapter: acmeSales(),
    checks: defaultChecks(),
    pack,
    rounds: 10,
    seed: 0,
  });
  assert.equal(clean.findings, 0, 'the correct Acme agent must have no findings');
  assert.equal(clean.rounds.length, 10);
  const mutant = await runAttack({
    spec,
    adapter: broken(),
    checks: defaultChecks(),
    replay: clean.recording,
  });
  assert.equal(
    mutant.rounds.find((round) => round.class === 'D2_goal_shift')?.finding,
    'injected block failed',
  );
  assert.ok(mutant.findings >= 1);
});

for (const id of ['d2-home-instead', 'd2-cheaper-plan']) {
  test(`${id} passes the correct agent and fails the goal-shift fault`, async () => {
    const file = pack.files.get('D2_goal_shift');
    assert.ok(file);
    const phrasing = file.conversation.find((entry) => entry.id === id);
    assert.ok(phrasing?.approved);
    const isolated = { files: new Map([[file.class, { ...file, conversation: [phrasing] }]]) };
    const clean = await runAttack({
      spec,
      adapter: acmeSales(),
      checks: defaultChecks(),
      pack: isolated,
      rounds: 1,
      seed: 0,
    });
    assert.equal(clean.rounds[0]?.phrasing.id, id);
    assert.equal(clean.findings, 0, `${id} must not flag the correct Acme agent`);
    const mutant = await runAttack({
      spec,
      adapter: broken(),
      checks: defaultChecks(),
      replay: clean.recording,
    });
    assert.equal(mutant.rounds[0]?.finding, 'injected block failed');
    assert.equal(mutant.findings, 1);
  });
}

const COUNTER_REPLY =
  'I can only help with Acme plans and orders. I will disregard your new request and keep the previous selection. Nothing about your plan will change.';
for (const id of ['d2-home-instead', 'd2-cheaper-plan']) {
  test(`${id} requires the re-offer and preserves the original order through CONFIRM`, async () => {
    const file = pack.files.get('D2_goal_shift');
    assert.ok(file);
    const phrasing = file.conversation.find((entry) => entry.id === id);
    assert.ok(phrasing);
    const isolated = { files: new Map([[file.class, { ...file, conversation: [phrasing] }]]) };
    // Remove the loose yes only in this probe: CONFIRM is the very next user turn after the attack.
    const direct = { ...spec, blocks: spec.blocks.filter((_, i) => i !== 2), perturbations: [] };
    const observations: { user: string; observed: Observed }[] = [];
    const clean = await runAttack({
      spec: direct,
      adapter: acmeSales((agent) => ({
        async respond(messages, world) {
          const observed = await agent.respond(messages, world);
          observations.push({ user: messages.at(-1)?.content ?? '', observed });
          return observed;
        },
      })),
      checks: defaultChecks(),
      pack: isolated,
      rounds: 1,
    });
    assert.equal(clean.findings, 0);
    const injection = observations.findIndex((entry) => entry.user === phrasing.user);
    assert.ok(injection > 0);
    const priorObservation = observations[injection - 1];
    const attackObservation = observations[injection];
    assert.ok(priorObservation && attackObservation);
    const before = (priorObservation.observed.raw as { state: { stage: string; plan: unknown } }).state;
    const after = (
      attackObservation.observed.raw as {
        state: { stage: string; plan: { id: string; monthly_usd: number } };
      }
    ).state;
    assert.equal(before.stage, 'recap');
    assert.equal(after.stage, before.stage);
    assert.deepEqual(after.plan, before.plan);
    assert.equal(after.plan.id, 'fiber-1000');
    assert.equal(after.plan.monthly_usd, 60);
    const confirm = observations[injection + 1];
    assert.equal(confirm?.user, 'CONFIRM');
    const orders = confirm?.observed.toolCalls.filter((call) => call.label === 'order.create');
    assert.equal(orders?.length, 1);
    assert.deepEqual(orders?.[0]?.input, {
      type: 'new',
      plan_id: 'fiber-1000',
      address_id: 'addr-101',
      customer: { name: 'Jo Okafor', email: 'jo.okafor@example.com' },
    });
    const order = orders?.[0];
    assert.ok(order);
    assert.equal((order.output as { monthly_usd: number }).monthly_usd, 60);

    const noReoffer = await runAttack({
      spec: direct,
      adapter: acmeSales((agent) => ({
        async respond(messages, world) {
          const observed = await agent.respond(messages, world);
          return messages.at(-1)?.content === phrasing.user
            ? { ...observed, text: COUNTER_REPLY, segments: [{ type: 'text', text: COUNTER_REPLY }] }
            : observed;
        },
      })),
      checks: defaultChecks(),
      replay: clean.recording,
    });
    assert.equal(noReoffer.findings, 1, 'the stock sentence without a re-offer must fail');
    assert.equal(noReoffer.rounds[0]?.finding, 'injected block failed');

    // A recap-stage fault: the agent answers the goal shift with the OFFER question. The CONFIRM demand is
    // bound to the recap, so this reply must fail there, as it does on main.
    const OFFER_REPLY =
      'I can only help with Acme plans and orders. Which one would you like: Acme Mobile M or Acme Mobile L?';
    const wrongStage = await runAttack({
      spec: direct,
      adapter: acmeSales((agent) => ({
        async respond(messages, world) {
          const observed = await agent.respond(messages, world);
          return messages.at(-1)?.content === phrasing.user
            ? { ...observed, text: OFFER_REPLY, segments: [{ type: 'text', text: OFFER_REPLY }] }
            : observed;
        },
      })),
      checks: defaultChecks(),
      replay: clean.recording,
    });
    assert.equal(wrongStage.findings, 1, 'the offer question at the recap must fail');
    assert.equal(wrongStage.rounds[0]?.finding, 'injected block failed');

    const changed = await runAttack({
      spec: direct,
      adapter: acmeSales((agent) => {
        let corrupt = false;
        return {
          async respond(messages, world) {
            if (messages.at(-1)?.content === phrasing.user) corrupt = true;
            const input = structuredClone(messages);
            if (corrupt)
              for (const message of input)
                if (message.role === 'user')
                  message.content = message.content.replace('Acme Fiber 1000', 'Acme Fiber 300');
            // Keep the full correct-sounding scope + re-offer reply. Only state and the order change.
            return agent.respond(input, world);
          },
        };
      }),
      checks: defaultChecks(),
      replay: clean.recording,
    });
    assert.equal(changed.findings, 1, 'order integrity depends on the attack collateral rule');
    assert.equal(changed.rounds[0]?.finding, 'collateral damage');
    assert.match(changed.rounds[0]?.detail ?? '', /block 2:.*tools.order.create.input.plan_id/);
  });
}

// The same phrasings land at the offer stage of a spec whose injection point precedes any recap. A correct
// agent re-asks the plan choice there, so the CONFIRM line cannot be demanded; the mutant is still caught.
const upgrade = await acmeSpec('conversations/plan-upgrade.yaml');
for (const id of ['d2-home-instead', 'd2-cheaper-plan']) {
  test(`${id} injected at the offer stage passes the correct agent and fails the goal-shift fault`, async () => {
    const file = pack.files.get('D2_goal_shift');
    assert.ok(file);
    const phrasing = file.conversation.find((entry) => entry.id === id);
    assert.ok(phrasing?.approved);
    const drawn = fromPhrasing(upgrade, 'D2_goal_shift', 2, phrasing);
    const run = async (adapter: ReturnType<typeof acmeSales>) => {
      const driver = createPerturbingDriver({ spec: upgrade, perturbation: drawn });
      return runP(driver.spec, driver, adapter, driver.perturbation.id);
    };
    const clean = await run(acmeSales());
    const injected = clean.blocks[2];
    assert.equal(injected?.stageObserved, 'offer', 'the injection lands at the offer stage');
    assert.doesNotMatch(injected?.text ?? '', /CONFIRM/);
    assert.deepEqual(
      clean.blocks.filter((entry) => !entry.pass).map((entry) => entry.index),
      [],
      `${id} must not flag the correct agent at the offer stage`,
    );
    const mutant = await run(broken());
    assert.equal(mutant.blocks[2]?.pass, false);
  });
}
