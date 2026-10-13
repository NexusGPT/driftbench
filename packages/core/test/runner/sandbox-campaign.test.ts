import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { type LoadedSpec, loadSpecFile } from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planCampaign, runCampaign } from '../../src/runner';
import { putCampaign } from './support';

/**
 * A campaign over a code agent in a sandbox: the Acme price sheet task on the Acme ops agent through the
 * process adapter, with every default check and the real artifact readers. runCampaign hands the readers
 * to each run, and a second campaign over the same store runs the cells live again: a replay would have
 * no workspace for the xlsx checks to read.
 */

const AGENT = fileURLToPath(new URL('../../../../examples/acme/ops/agent.mjs', import.meta.url));
const PRICE_SHEET = fileURLToPath(
  new URL('../../../../examples/acme/specs/tasks/price-sheet.yaml', import.meta.url),
);

let parent: string;
let loaded: LoadedSpec;
beforeAll(async () => {
  parent = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-sandbox-campaign-')));
  const result = await loadSpecFile(PRICE_SHEET);
  if (!result.ok) throw new Error('the price sheet spec is invalid');
  loaded = result;
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

describe('a campaign on a sandboxed agent', () => {
  it('passes the xlsx checks through the readers it is given, and again in a second campaign on the same store', async () => {
    const adapter = processAdapter({
      command: process.execPath,
      args: [AGENT],
      provider: localProvider({ dir: parent }),
      deterministic: true,
    });
    const target = { adapter: 'process', agent: 'acme-ops' };
    const plan = planCampaign([loaded], [target], ['F'], 1);
    const store = openMemoryStore();
    let reads = 0;
    let writes = 0;
    const cache = {
      cacheGet: (key: string) => {
        reads += 1;
        return store.cacheGet(key);
      },
      cachePut: (...args: Parameters<typeof store.cachePut>) => {
        writes += 1;
        return store.cachePut(...args);
      },
    };
    try {
      const outcomes = [];
      for (const campaignId of ['c-first', 'c-second']) {
        await putCampaign(store, campaignId, [loaded]);
        outcomes.push(
          ...(await runCampaign({
            campaignId,
            cells: plan.cells,
            specFor: () => loaded.spec,
            adapterFor: () => adapter,
            driver: () => createScriptedDriver(),
            checks: defaultChecks(),
            artifacts: defaultReaders(),
            store,
            cache,
          })),
        );
      }
      expect(outcomes.map((outcome) => [outcome.state, outcome.run?.cacheHit])).toEqual([
        ['pass', false],
        ['pass', false],
      ]);
      for (const outcome of outcomes) {
        const passed = (outcome.run?.blocks ?? []).flatMap((block) =>
          block.verdicts.filter((verdict) => verdict.outcome === 'pass').map((verdict) => verdict.id),
        );
        expect(passed).toEqual(
          expect.arrayContaining([
            'artifacts.out/acme-price-sheet.xlsx.0.sheets',
            'artifacts.out/acme-price-sheet.xlsx.6.formula',
            'artifacts.out/acme-price-sheet.xlsx.2.cells',
          ]),
        );
      }
      // The sandboxed runs neither read the cache nor wrote to it.
      expect([reads, writes]).toEqual([0, 0]);
      expect(await store.listRuns()).toHaveLength(2);
    } finally {
      await store.close();
    }
  }, 120_000);
});
