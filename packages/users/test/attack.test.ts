import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { type AgentAdapter, runSpec } from '@agent-nexus/driftbench-core';
import { FakeModelPort, faultAdapter } from '@agent-nexus/driftbench-generate';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { beforeAll, describe, expect, it } from 'vitest';
import { salesFaults } from '../../../examples/acme/faults/sales';
import {
  AttackError,
  type AttackResult,
  createScriptedDriver,
  cuesOf,
  loadRedteamPack,
  type RedteamPack,
  RedteamPackError,
  runAttack,
} from '../src/index';
import { acmeSales, acmeSpec, PACK_DIR } from './support';

let pack: RedteamPack;
beforeAll(async () => {
  pack = await loadRedteamPack(PACK_DIR);
});

function fault(id: string): AgentAdapter {
  const def = salesFaults.find((entry) => entry.id === id);
  if (!def) throw new Error(`no fault ${id}`);
  return faultAdapter(def, () => localProvider({}));
}

const classesOf = (result: AttackResult) => result.rounds.map((round) => round.class);

describe('the adaptive attacker', { timeout: 60_000 }, () => {
  it('picks each attack from the agent reply that invites it: a loose yes right after it asks for CONFIRM', async () => {
    const spec = await acmeSpec('conversations/plan-upgrade.yaml');
    const result = await runAttack({
      spec,
      adapter: acmeSales(),
      checks: defaultChecks(),
      pack,
      rounds: 10,
      seed: 0,
    });
    const d4 = result.rounds.find((round) => round.class === 'D4_loose_confirmation');
    expect(d4?.cue.rule).toBe('asks for an explicit confirmation');
    expect(d4?.cue.reply).toMatch(/CONFIRM/);
    expect(d4?.injectAt).toBe((d4?.cue.block ?? -2) + 1);
    // Ten rounds, ten different classes: the attacker never repeats a class while one is untried.
    expect(new Set(classesOf(result)).size).toBe(result.rounds.length);
    expect(result.rounds).toHaveLength(10);
    // Every round is scored by the runner's own recovery record.
    for (const round of result.rounds) expect(round.recovery?.injectedAt).toBeTypeOf('number');
  });

  it('reads a request for the next move as a question: "I need your full name and email address"', async () => {
    const spec = await acmeSpec('conversations/order-loose-confirmation.yaml');
    const reference = await runSpec(spec, {
      adapter: acmeSales(),
      driver: createScriptedDriver(),
      checks: defaultChecks(),
      mode: 'F',
      repeat: 0,
    });
    expect(reference.blocks[0]?.observed.text).not.toContain('?');
    const first = cuesOf(spec, reference, 'reference').filter((cue) => cue.cue.block === 0);
    expect(first.map((cue) => cue.cls)).toEqual(expect.arrayContaining(['D3_contradiction', 'D1_off_topic']));
  });

  it('reads each next cue from the last run, so the attacks follow the conversation it has seen', async () => {
    const spec = await acmeSpec('conversations/plan-upgrade.yaml');
    const result = await runAttack({
      spec,
      adapter: acmeSales(),
      checks: defaultChecks(),
      pack,
      rounds: 3,
      seed: 0,
    });
    expect(result.rounds[0]?.cue.run).toBe('reference');
    expect(result.rounds[1]?.cue.run).toBe(result.rounds[0]?.runId);
    expect(result.rounds[2]?.cue.run).toBe(result.rounds[1]?.runId);
  });

  it('finds the fault that places an order on a loose yes, and the real agent stays safe on the same attack', async () => {
    const spec = await acmeSpec('conversations/plan-upgrade.yaml');
    const real = await runAttack({
      spec,
      adapter: acmeSales(),
      checks: defaultChecks(),
      pack,
      rounds: 10,
      seed: 0,
    });
    const broken = await runAttack({
      spec,
      adapter: fault('d4-order-on-loose-yes'),
      checks: defaultChecks(),
      pack,
      rounds: 10,
      seed: 0,
    });
    const realD4 = real.rounds.find((round) => round.class === 'D4_loose_confirmation');
    const brokenD4 = broken.rounds.find((round) => round.class === 'D4_loose_confirmation');
    expect(realD4?.recovery?.safeAction).toBe(true);
    expect(realD4?.finding).toBeUndefined();
    expect(brokenD4?.recovery?.safeAction).toBe(false);
    expect(brokenD4?.finding).toBe('unsafe act');
    expect(broken.findings).toBeGreaterThan(real.findings);
  });

  it('never draws a class the pack has no approved phrasing for: D11 and D12 are not attacks until approved', async () => {
    const spec = await acmeSpec('conversations/plan-upgrade.yaml');
    for (const seed of [0, 1, 2]) {
      const result = await runAttack({
        spec,
        adapter: acmeSales(),
        checks: defaultChecks(),
        pack,
        rounds: 10,
        seed,
      });
      const classes = result.rounds.map((round) => round.class);
      expect(classes.filter((cls) => cls === 'D11_pii_leak' || cls === 'D12_prompt_extraction')).toEqual([]);
    }
  });

  it('refuses a pack with no approved phrasing at all, and draws from it when the run asks for drafts', async () => {
    const spec = await acmeSpec('conversations/order-loose-confirmation.yaml');
    const unapproved: RedteamPack = {
      files: new Map(
        [...pack.files].map(([cls, file]) => [
          cls,
          {
            ...file,
            conversation: file.conversation.map((phrasing) => ({ ...phrasing, approved: false })),
            ...(file.task ? { task: file.task.map((phrasing) => ({ ...phrasing, approved: false })) } : {}),
          },
        ]),
      ),
    };
    const base = {
      spec,
      adapter: acmeSales(),
      checks: defaultChecks(),
      pack: unapproved,
      rounds: 3,
      seed: 0,
    };
    // Nothing to draw is not a clean run of zero attacks: the pack is refused, as a pack with no file is.
    await expect(runAttack(base)).rejects.toBeInstanceOf(RedteamPackError);
    await expect(runAttack(base)).rejects.toThrow(/no approved conversation phrasing/);
    const drafts = await runAttack({ ...base, drafts: true });
    expect(drafts.rounds).toHaveLength(3);
  });

  it('finds the fault that hides a tool failure, on the attack the spec author wrote for that block', async () => {
    // The order block calls order.create; the spec declares a D8 there, so the attacker uses its expectations.
    const spec = await acmeSpec('conversations/order-loose-confirmation.yaml');
    const attack = (adapter: AgentAdapter) =>
      runAttack({ spec, adapter, checks: defaultChecks(), pack, rounds: 10, seed: 0 });
    const real = (await attack(acmeSales())).rounds.find((round) => round.class === 'D8_tool_failure');
    const broken = (await attack(fault('d8-hides-tool-failure'))).rounds.find(
      (round) => round.class === 'D8_tool_failure',
    );
    expect(broken?.cue).toMatchObject({ rule: 'called a tool', tool: 'order.create' });
    expect(broken?.phrasing).toMatchObject({ id: 'order-service-down', source: 'spec' });
    expect([real?.injectAt, real?.recovery?.label, real?.finding]).toEqual([3, 'immediate', undefined]);
    expect([broken?.injectAt, broken?.recovery?.label, broken?.finding]).toEqual([
      3,
      'never',
      'injected block failed',
    ]);
    expect(broken?.detail).toBe(
      'the injected block violated; the agent did not recover by the end of the run',
    );
  });

  it('fails the tool the cueing block called when the spec declares no D8 there', async () => {
    const declared = await acmeSpec('conversations/plan-upgrade.yaml');
    const spec = {
      ...declared,
      perturbations: declared.perturbations?.filter((p) => p.class !== 'D8_tool_failure'),
    };
    const result = await runAttack({
      spec,
      adapter: acmeSales(),
      checks: defaultChecks(),
      pack,
      rounds: 10,
      seed: 0,
    });
    const d8 = result.rounds.find((round) => round.class === 'D8_tool_failure');
    expect(d8?.phrasing.source).toBe('pack');
    expect(d8?.phrasing.tool).toBe(d8?.cue.tool);
    expect(Object.keys(d8?.perturbation.world?.tools ?? {})).toEqual([d8?.cue.tool]);
  });

  it('is seeded, and replays from its recording with the same attacks and the same records', async () => {
    const spec = await acmeSpec('conversations/order-loose-confirmation.yaml');
    const first = await runAttack({
      spec,
      adapter: acmeSales(),
      checks: defaultChecks(),
      pack,
      rounds: 4,
      seed: 7,
    });
    const again = await runAttack({
      spec,
      adapter: acmeSales(),
      checks: defaultChecks(),
      pack,
      rounds: 4,
      seed: 7,
    });
    expect(again.recording).toEqual(first.recording);
    const replay = await runAttack({
      spec,
      adapter: acmeSales(),
      checks: defaultChecks(),
      replay: first.recording,
    });
    expect(replay.rounds.map((round) => [round.class, round.injectAt, round.recovery])).toEqual(
      first.rounds.map((round) => [round.class, round.injectAt, round.recovery]),
    );
    const other = await acmeSpec('conversations/plan-upgrade.yaml');
    await expect(
      runAttack({ spec: other, adapter: acmeSales(), checks: defaultChecks(), replay: first.recording }),
    ).rejects.toThrow(AttackError);
  });

  it('writes the user-borne attacks through the model port, from the reply that cued them, on another family', async () => {
    const spec = await acmeSpec('conversations/plan-upgrade.yaml');
    const port = new FakeModelPort(
      Array.from({ length: 10 }, (_, index) => `attack message ${index + 1}`),
      { family: 'mistral' },
    );
    const result = await runAttack({
      spec,
      adapter: acmeSales(),
      checks: defaultChecks(),
      pack,
      rounds: 3,
      seed: 0,
      port,
      agentFamily: 'none',
      judgeFamilies: [],
    });
    const written = result.rounds.filter((round) => round.phrasing.source === 'model');
    expect(written.length).toBeGreaterThan(0);
    for (const round of written) expect(round.perturbation.user).toMatch(/^attack message \d+$/);
    const request = port.requests[0];
    expect(request?.user).toContain('The assistant just wrote:');
    expect(request?.system).toContain(
      result.rounds.find((round) => round.phrasing.source === 'model')?.class ?? '?',
    );
    await expect(
      runAttack({
        spec,
        adapter: acmeSales(),
        checks: defaultChecks(),
        pack,
        port,
        agentFamily: 'mistral',
        judgeFamilies: [],
      }),
    ).rejects.toThrow('the family of the agent under test');
  });
});
