import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { analysePilot, type PlantedCheck } from '../../src/pilot/analyse';
import { designPilot, pilotFactors } from '../../src/pilot/design';
import { pilotObservations, runPilot } from '../../src/pilot/run';
import { acmeAdapter, acmePilotMap, acmeSuite, pilotChecks, randomAdapter } from './support';

const NOW = () => new Date('2026-10-11T12:00:00.000Z');

async function pilotOn(
  adapter: ReturnType<typeof acmeAdapter>,
  options: Parameters<typeof designPilot>[2],
  agent = 'acme',
) {
  const design = designPilot(await acmePilotMap(), await acmeSuite(), options);
  const store = await openMemoryStore();
  try {
    const { campaign, outcomes } = await runPilot({
      design,
      target: { adapter: 'function', agent },
      adapter,
      store,
      checks: pilotChecks(),
      driver: createScriptedDriver,
      now: NOW,
      // One at a time: the control hands out its run draws in session order, so the report is reproducible.
      concurrency: 1,
    });
    const { observations, unlabelled } = await pilotObservations(store, campaign.campaignId);
    const specs = await Promise.all(campaign.specs.map((entry) => store.getSpec(entry.id, entry.hash)));
    return { design, campaign, outcomes, observations, unlabelled, specs };
  } finally {
    await store.close();
  }
}

describe('the pilot on the deterministic Acme agent', () => {
  it('runs every variant through the runner and finds zero run-to-run variance', async () => {
    const { design, outcomes, observations, unlabelled, specs } = await pilotOn(acmeAdapter(), {
      conversations: 3,
      repeats: 3,
      wordings: 3,
    });
    const variants = design.cells.flatMap((cell) => cell.conversations.flatMap((c) => c.variants));
    expect(outcomes).toHaveLength(variants.length * 3);
    expect(observations).toHaveLength(variants.length * 3);
    expect(unlabelled).toBe(0);
    // Every stored spec carries its factors, so every stored run names its cell, conversation and wording.
    for (const loaded of specs) expect(pilotFactors(loaded?.spec as never)).toBeDefined();
    expect(
      new Set(observations.map((o) => `${o.cell}|${o.conversation}|${o.wording}|${o.repeat}`)).size,
    ).toBe(observations.length);

    const analysis = analysePilot(observations, { iterations: 50 });
    expect(analysis.errored).toBe(0);
    expect(analysis.pooled.levels.find((level) => level.level === 'repeat')?.variance).toBe(0);
    expect(analysis.flip.flipping).toBe(0);
    expect(analysis.noiseFloor.perBlock.repeats).toBe(1);
    expect(analysis.planted).toBeUndefined();
  }, 60_000);
});

describe('the pilot on the seeded random control', () => {
  it('measures run-to-run variance and recovers the planted shares inside the bootstrap interval', async () => {
    // Eight seeds of the control on the full Acme design. A 95% interval misses about one level in twenty
    // by chance, so the bar is coverage: every level recovered on at least 6 of 8 seeds, 28 of 32 overall.
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const checks: PlantedCheck['levels'][] = [];
    for (const seed of seeds) {
      const { observations } = await pilotOn(
        randomAdapter({ seed }),
        { conversations: 10, repeats: 5, wordings: 3 },
        `acme-random-${seed}`,
      );
      const analysis = analysePilot(observations, { iterations: 300 });
      expect(analysis.errored).toBe(0);
      expect(analysis.pooled.levels.find((level) => level.level === 'repeat')?.share).toBeGreaterThan(0.4);
      expect(analysis.flip.flipping).toBeGreaterThan(0);
      expect(analysis.planted?.model).toEqual({ seed, fragile: 0.5, pFragile: 0.5, pSturdy: 0.05 });
      checks.push(analysis.planted?.levels ?? []);
    }
    const recovered = (level: string) =>
      checks.filter((levels) => levels.find((entry) => entry.level === level)?.recovered).length;
    const detail = JSON.stringify(checks.map((levels) => levels.map((l) => [l.level, l.recovered])));
    for (const level of ['cell', 'conversation', 'wording', 'repeat']) {
      expect(recovered(level), `${level}: ${detail}`).toBeGreaterThanOrEqual(6);
    }
    expect(checks.flat().filter((entry) => entry.recovered).length, detail).toBeGreaterThanOrEqual(28);
  }, 180_000);

  it('gives the same runs twice when it runs one at a time', async () => {
    const outcomes = async () =>
      (
        await pilotOn(randomAdapter(), { conversations: 3, repeats: 4, wordings: 3 }, 'acme-random')
      ).observations.map(
        (o) => `${o.cell}|${o.conversation}|${o.wording}|${o.repeat}|${o.pass}|${o.planted}`,
      );
    expect(await outcomes()).toEqual(await outcomes());
  }, 60_000);
});
