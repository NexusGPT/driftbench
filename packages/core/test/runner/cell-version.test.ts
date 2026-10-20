import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { heldRun, specHash, specIdentityHash } from '../../src/index';
import { prepareRejudge, rejudgeRun } from '../../src/radius/rejudge';
import { cellIdOf, planCampaign, runCampaign, runSpec, runsByCell } from '../../src/runner';
import { adapterProvenance, provenanceHash } from '../../src/runner/provenance';
import { echoAdapter, putCampaign, specOf } from './support';

// docs/reference/cli.md, "spec validate": "The hash, not the spec's `version`, is part of the runner's cache key and of
// every run id; `version` is a free label."
const target = { adapter: 'echo', agent: 'x' };
const withVersion = (version: string | undefined) =>
  specOf({ id: 'labelled', ...(version === undefined ? {} : { version }), blocks: [{ user: 'hi' }] });
const loadedOf = (version: string | undefined) => {
  const spec = withVersion(version);
  return { ok: true as const, spec, hash: specHash(spec), path: 'labelled.yaml', warnings: [] };
};

describe('the version label is no part of a cell id', () => {
  it('moves the spec hash and leaves the identity hash where it was', () => {
    const [none, one, two] = [undefined, 'v1', 'v2'].map(withVersion);
    expect(new Set([none, one, two].map((spec) => specHash(spec as never))).size).toBe(3);
    expect(new Set([none, one, two].map((spec) => specIdentityHash(spec as never))).size).toBe(1);
    // A spec with no version has the one hash, so ids made before the label existed stay.
    expect(specIdentityHash(none as never)).toBe(specHash(none as never));
  });

  it('plans the same cells after the label is added, removed or changed, and others when the content changes', () => {
    const ids = (version: string | undefined) =>
      planCampaign([loadedOf(version)], [target], ['T', 'F'], 2).cells.map((cell) => cell.cellId);
    expect(ids('v1')).toEqual(ids(undefined));
    expect(ids('v2')).toEqual(ids('v1'));
    const other = specOf({ id: 'labelled', blocks: [{ user: 'hello' }] });
    const changed = planCampaign([{ spec: other, hash: specHash(other) }], [target], ['T', 'F'], 2).cells;
    expect(changed.map((cell) => cell.cellId)).not.toEqual(ids(undefined));
  });

  it('gives a run the same run id, and stamps the hash it was made from', async () => {
    const run = async (version: string | undefined) =>
      runSpec(withVersion(version), {
        adapter: echoAdapter(),
        driver: createScriptedDriver(),
        checks: [],
        mode: 'F',
        repeat: 0,
        target,
      });
    const [none, one] = [await run(undefined), await run('v1')];
    expect(one.runId).toBe(none.runId);
    expect(one.specHash).not.toBe(none.specHash);
    expect(one.identityHash).toBe(none.identityHash);
    expect(cellIdOf(one)).toBe(one.runId);
    expect(planCampaign([loadedOf('v1')], [target], ['F'], 1).cells[0]?.cellId).toBe(one.runId);
  });

  it('keeps an old run: a run stored without the identity hash reads its id from the spec hash', async () => {
    const run = await runSpec(withVersion(undefined), {
      adapter: echoAdapter(),
      driver: createScriptedDriver(),
      checks: [],
      mode: 'F',
      repeat: 0,
      target,
    });
    const { identityHash: _identityHash, ...old } = run;
    expect(cellIdOf(old)).toBe(run.runId);
  });

  it('a campaign planned after a relabel finds the stored run of the cell and does not run it again', async () => {
    const store = openMemoryStore();
    try {
      const adapter = echoAdapter();
      const first = loadedOf('v1');
      await putCampaign(store, 'relabel', [first]);
      const go = async (entry: ReturnType<typeof loadedOf>) =>
        runCampaign({
          campaignId: 'relabel',
          cells: planCampaign([entry], [target], ['F'], 1).cells,
          specFor: () => entry.spec,
          adapterFor: () => adapter,
          driver: () => createScriptedDriver(),
          checks: [],
          store,
          concurrency: 1,
        });
      expect((await go(first)).map((outcome) => outcome.state)).toEqual(['pass']);
      const opened = adapter.opened.length;
      const again = await go(loadedOf('v2'));
      expect(again.map((outcome) => outcome.state)).toEqual(['pass']);
      expect(adapter.opened.length).toBe(opened);
    } finally {
      await store.close();
    }
  });

  it('gives a rejudged run of a versioned spec the cell id the plan gives, and the version-free identity hash', async () => {
    const versioned = (rubric: string) =>
      specOf({
        id: 'judged',
        version: 'v7',
        criteria: [{ name: 'price', rubric, gating: true }],
        blocks: [{ when: { user: 'Quote.' }, expect: { criteria: ['price'] } }],
      });
    const old = versioned('A price is present.');
    const next = versioned('The price must be 12.');
    const pinned = { adapter: 'echo', variant: 'v1' };
    const run = await runSpec(old, {
      adapter: echoAdapter(),
      driver: createScriptedDriver(),
      checks: [],
      mode: 'F',
      repeat: 0,
      target: pinned,
      recordProvenance: true,
      now: () => new Date('2026-10-13T00:00:00Z'),
    });
    const prepared = prepareRejudge(old, next, run, {
      baselineProvenance: {
        version: 2 as const,
        adapters: [
          {
            ...adapterProvenance(echoAdapter(), pinned.adapter),
            targetHash: provenanceHash(pinned),
            agentVersionHash: provenanceHash('v1'),
          },
        ],
      },
      fromCampaign: 'base',
      agentVersion: 'v1',
      criteria: ['price'],
      now: new Date('2026-10-13T01:00:00Z'),
    });
    const rejudged = await rejudgeRun(
      prepared,
      {
        name: 'judge',
        applies: () => true,
        evaluate: () => [
          {
            id: 'judge.price',
            kind: 'judge',
            name: 'price',
            gating: true,
            outcome: 'fail',
            evidence: 'no 12',
          },
        ],
      },
      () => 0,
    );
    expect(rejudged.specHash).toBe(specHash(next));
    expect(rejudged.identityHash).toBe(specIdentityHash(next));
    expect(rejudged.identityHash).not.toBe(rejudged.specHash);
    const planned = planCampaign([{ spec: next, hash: specHash(next) }], [pinned], ['F'], 1).cells[0];
    expect(rejudged.runId).toBe(planned?.cellId);
    expect(cellIdOf(rejudged)).toBe(rejudged.runId);
  });

  it('resumes a run stored under the id it had before the label left the id, and reads it in the status', async () => {
    const store = openMemoryStore();
    try {
      const adapter = echoAdapter();
      const entry = loadedOf('v1');
      const cell = planCampaign([entry], [target], ['F'], 1).cells[0];
      if (cell?.legacyCellId === undefined) throw new Error('a versioned spec has a legacy id');
      expect(cell.legacyCellId).not.toBe(cell.cellId);
      await putCampaign(store, 'legacy', [entry]);
      // The run as the earlier version stored it: no identity hash, its run id made from the spec hash.
      const stored = await runSpec(entry.spec, {
        adapter,
        driver: createScriptedDriver(),
        checks: [],
        mode: 'F',
        repeat: 0,
        target,
        runId: cell.legacyCellId,
      });
      const { identityHash: _identityHash, ...old } = stored;
      await store.putRun('legacy', old);
      expect(cellIdOf(old)).toBe(cell.legacyCellId);
      expect(heldRun(await runsByCell(store, 'legacy'), cell)?.runId).toBe(cell.legacyCellId);
      const opened = adapter.opened.length;
      const outcomes = await runCampaign({
        campaignId: 'legacy',
        cells: [cell],
        specFor: () => entry.spec,
        adapterFor: () => adapter,
        driver: () => createScriptedDriver(),
        checks: [],
        store,
        concurrency: 1,
      });
      expect(outcomes.map((o) => [o.state, o.reused])).toEqual([['pass', true]]);
      expect(adapter.opened.length).toBe(opened);
    } finally {
      await store.close();
    }
  });
});
