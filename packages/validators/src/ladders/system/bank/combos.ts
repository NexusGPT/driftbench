import { join } from 'node:path';
import { type Campaign, canonicalJson, type RunResult } from '@agent-nexus/driftbench-core';
import { openMemoryStore, openStore, type SqliteStore } from '@agent-nexus/driftbench-store';
import { SYSTEM_COMPONENTS } from '../components';
import { OPERATORS } from '../family';
import { between, rngFor } from '../random';
import { OPERATOR_ORDER, reachOracle, withPerturbation } from './reach';
import { type BankItem, fail, type Tier } from './types';
import {
  ADAPTERS,
  type AdapterKind,
  behavioursFor,
  MODES,
  plantedFlow,
  positionOf,
  runScenario,
} from './world';

/**
 * combo-store: every operator class crossed with every adapter, every mode and both store backends, generated
 * here and never written by hand. One item runs the planted flow with the fault at one block, files the run in
 * the store backend, reads it back (the file store after a close and a reopen), and asks two things of the run
 * it read: it equals the run the runner returned, and the failing verdict sits on the planted block with the
 * check the operator breaks (the reach oracle of level 2). The other families prove the run; this one proves
 * that what a person reads from the store is that run, in every cell.
 */

const BACKENDS = ['file', 'memory'] as const;
type Backend = (typeof BACKENDS)[number];

const CLOCK = '2026-10-11T00:00:00.000Z';

function campaignFor(run: RunResult): Campaign {
  return {
    campaignId: 'c-combo',
    specs: [{ id: run.specId, hash: run.specHash }],
    targets: [run.target],
    modes: [run.mode],
    repeats: { T: run.mode === 'T' ? 1 : 0, F: run.mode === 'F' ? 1 : 0, P: run.mode === 'P' ? 1 : 0 },
    budgetUsd: 0,
    judge: { mode: 'system1', judges: [] },
    createdAt: CLOCK,
  };
}

/** Files the run and reads it back: the memory store in one session, the file store after a reopen. */
async function readBack(backend: Backend, run: RunResult, path: string): Promise<RunResult | undefined> {
  const write = async (store: SqliteStore) => {
    await store.putCampaign(campaignFor(run));
    await store.putRun('c-combo', run);
  };
  if (backend === 'memory') {
    const store = openMemoryStore();
    try {
      await write(store);
      return await store.getRun(run.runId, 'c-combo');
    } finally {
      await store.close();
    }
  }
  const first = openStore(path);
  try {
    await write(first);
  } finally {
    await first.close();
  }
  const second = openStore(path);
  try {
    return await second.getRun(run.runId, 'c-combo');
  } finally {
    await second.close();
  }
}

function slug(cls: string): string {
  return cls.toLowerCase().replace(/_/g, '-');
}

function tierOf(adapter: AdapterKind, mode: string, backend: Backend): Tier {
  let tier = 1;
  if (adapter !== 'function') tier += 1;
  if (adapter === 'http-flaky') tier += 1;
  if (mode === 'P') tier += 1;
  if (backend === 'file') tier += 1;
  return Math.min(tier, 5) as Tier;
}

export function comboItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const cls of OPERATOR_ORDER) {
    const check = OPERATORS[cls]?.check ?? cls;
    for (const adapter of ADAPTERS) {
      for (const mode of MODES) {
        for (const backend of BACKENDS) {
          const id = `combo/${slug(cls)}/${adapter}/${mode}/${backend}`;
          out.push({
            id,
            family: `combo-store-${backend}`,
            tier: tierOf(adapter, mode, backend),
            level: 1,
            component: SYSTEM_COMPONENTS.store,
            source: 'combination',
            title: `a ${cls} run on the ${adapter} adapter in mode ${mode}, filed in the ${backend} store and read back, is the run the runner returned, with the ${check} verdict on the planted block`,
            cause: `the ${backend} store gives back a run whose ${check} verdict failed as the runner wrote it`,
            async check({ seed, scratch }) {
              const planted = plantedFlow(seed, id);
              const blocks = planted.truths.length;
              const rng = rngFor(seed, `${id}-at`);
              // In mode P the deviation goes in at k and the fault sits before it, so its position does not shift.
              const k = mode === 'P' ? between(rng, 2, blocks - 2) : undefined;
              const at = between(rng, 0, (k ?? blocks) - 1);
              const behaviours = behavioursFor(planted, new Map([[at, [cls]]]));
              const perturbationId = k === undefined ? undefined : withPerturbation(planted, behaviours, k);
              const run = await runScenario(planted.spec, behaviours, {
                mode,
                adapter,
                ...(perturbationId ? { perturbationId } : {}),
              });
              const back = await readBack(
                backend,
                run,
                join(scratch, `combo-${slug(cls)}-${adapter}-${mode}-${seed}.sqlite`),
              );
              if (back === undefined)
                return fail(`getRun found nothing in the ${backend} store for run ${run.runId}`);
              if (canonicalJson(back) !== canonicalJson(run))
                return fail(
                  `the run read back from the ${backend} store differs from the run the runner returned`,
                );
              return reachOracle(back, new Map([[positionOf(at, k), [cls]]]));
            },
          });
        }
      }
    }
  }
  return out;
}
