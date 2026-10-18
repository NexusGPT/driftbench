import { fileURLToPath } from 'node:url';
import { classifyTool, defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type AgentAdapter,
  type BlockResult,
  type Campaign,
  type DriftClass,
  injectingDriver,
  type LoadedSpec,
  loadSpecs,
  type Observed,
  planCampaign,
  type RunMode,
  type RunResult,
  runCampaign,
  type Spec,
  type Store,
  type TargetRef,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { faultAdapter } from '@agent-nexus/driftbench-generate';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { faults } from '../../../examples/acme/faults/index';
import { acmeFunctionAdapter } from '../../cli/src/commands/campaign';
import type { CampaignData } from '../src/data';

/** The clock of every stored test campaign: the same store gives the same bytes. */
export const FIXED = '2026-10-11T12:00:00.000Z';

export const ACME_CONVERSATIONS = fileURLToPath(
  new URL('../../../examples/acme/specs/conversations', import.meta.url),
);

export async function loadAcme(): Promise<LoadedSpec[]> {
  const loaded: LoadedSpec[] = [];
  for (const result of await loadSpecs([ACME_CONVERSATIONS])) {
    if (!result.ok) throw new Error(`invalid Acme spec ${result.path}`);
    loaded.push(result);
  }
  return loaded;
}

export type StoredCampaignOptions = {
  campaignId: string;
  /** A sales fault of examples/acme/faults to run instead of the real Acme sales assistant. */
  fault?: string;
  /** The agent reports a token count, a cost and a latency on each reply, as a model would: its model calls show on the timeline. */
  reportsUsage?: boolean;
  modes?: RunMode[];
  repeats?: number;
  specs?: readonly LoadedSpec[];
  /** The campaign's creation time; FIXED by default. The runs keep the FIXED clock. */
  createdAt?: string;
};

/**
 * Runs the Acme conversation specs on the deterministic Acme sales assistant (or a fault wrapping it) through
 * the real runner and checks, with the CLI's drivers, and stores the campaign. The clock is fixed.
 */
/** The adapter with a usage report on the first segment of each reply: tokens, a cost and a latency. */
function withUsage(inner: AgentAdapter): AgentAdapter {
  return {
    ...inner,
    async send(session, turn) {
      const observed = await inner.send(session, turn);
      return {
        ...observed,
        segments: observed.segments.map((segment, i) =>
          i === 0
            ? { ...segment, cost: { inputTokens: 120, outputTokens: 40, usd: 0.0021 }, latencyMs: 640 }
            : segment,
        ),
      };
    },
  } as AgentAdapter;
}

export async function storeAcmeCampaign(store: Store, options: StoredCampaignOptions): Promise<Campaign> {
  const specs = options.specs ?? (await loadAcme());
  const modes = options.modes ?? ['T', 'F', 'P'];
  const repeats = options.repeats ?? 2;
  const fault = options.fault === undefined ? undefined : faults.find((entry) => entry.id === options.fault);
  if (options.fault !== undefined && !fault) throw new Error(`no fault ${options.fault}`);
  const target: TargetRef = fault
    ? { adapter: 'function', agent: 'acme-sales', variant: `fault-${fault.id}` }
    : { adapter: 'function', agent: 'acme-sales' };
  const plain: AgentAdapter = fault
    ? faultAdapter(fault, () => localProvider())
    : await acmeFunctionAdapter();
  const adapter: AgentAdapter = options.reportsUsage ? withUsage(plain) : plain;
  for (const entry of specs) await store.putSpec(entry);
  const counts = { T: 0, F: 0, P: 0 };
  for (const mode of modes) counts[mode] = repeats;
  const campaign: Campaign = {
    campaignId: options.campaignId,
    specs: specs.map((entry) => ({ id: entry.spec.id, hash: entry.hash, target })),
    targets: [target],
    modes,
    repeats: counts,
    budgetUsd: 0,
    judge: { mode: 'system1', judges: [] },
    createdAt: options.createdAt ?? FIXED,
  };
  await store.putCampaign(campaign);
  const bySpec = new Map(specs.map((entry) => [`${entry.spec.id}@${entry.hash}`, entry.spec]));
  await runCampaign({
    campaignId: campaign.campaignId,
    cells: planCampaign(specs, [target], modes, repeats).cells,
    recordEvents: true,
    specFor: (cell) => bySpec.get(`${cell.specId}@${cell.specHash}`) as Spec,
    adapterFor: () => adapter,
    driver: (cell) =>
      cell.perturbationId === undefined
        ? createScriptedDriver()
        : injectingDriver(createScriptedDriver(), cell.perturbationId),
    consequential: (label) => classifyTool(label) !== undefined,
    checks: defaultChecks(),
    store,
    now: () => new Date(FIXED),
    concurrency: 1,
  });
  return campaign;
}

// Synthetic runs, for the formulas.

export type BlockShape = {
  text?: string;
  pass?: boolean;
  drift?: DriftClass[];
  verdicts?: Array<Partial<Verdict> & { id: string }>;
  stage?: string;
  injected?: boolean;
  blockId?: string;
  toolCalls?: string[];
  usd?: number;
  latencyMs?: number;
};

export type RunShape = {
  specId?: string;
  specHash?: string;
  target?: TargetRef;
  mode?: RunMode;
  repeat?: number;
  perturbationId?: string;
  status?: RunResult['status'];
  blocks?: BlockShape[];
  endState?: RunResult['endState'];
  recovery?: RunResult['recovery'];
  firstDriftBlock?: number;
};

export function observed(shape: BlockShape = {}): Observed {
  return {
    segments: [],
    text: shape.text ?? 'ok',
    toolCalls: (shape.toolCalls ?? []).map((label) => ({ label, input: {} })),
    cost: shape.usd === undefined ? {} : { usd: shape.usd },
    latencyMs: shape.latencyMs ?? 0,
  };
}

export function verdict(partial: Partial<Verdict> & { id: string }): Verdict {
  return {
    kind: 'machine',
    name: partial.id.split('.')[0] as string,
    gating: true,
    outcome: 'pass',
    evidence: 'synthetic',
    ...partial,
  };
}

export function block(index: number, shape: BlockShape = {}): BlockResult {
  const pass = shape.pass ?? true;
  return {
    index,
    ...(shape.blockId === undefined ? {} : { blockId: shape.blockId }),
    ...(shape.injected === undefined ? {} : { injected: shape.injected }),
    givenHash: `g${index}`,
    observed: observed(shape),
    verdicts: (shape.verdicts ?? []).map(verdict),
    ...(shape.stage === undefined ? {} : { stageObserved: shape.stage }),
    ledgerCheck: { ok: true, contradictions: [] },
    drift: shape.drift ?? (pass ? [] : ['X1_local']),
    pass,
  };
}

/** A run whose succession is computed from its blocks, the way the runner computes it. */
export function run(shape: RunShape = {}): RunResult {
  const blocks = (shape.blocks ?? [{}]).map((entry, index) => block(index, entry));
  const drifting = blocks.map((entry) => entry.drift.length > 0);
  const first = drifting.indexOf(true);
  let longest = 0;
  let current = 0;
  for (const d of drifting) {
    current = d ? 0 : current + 1;
    longest = Math.max(longest, current);
  }
  const driftCount = drifting.filter(Boolean).length;
  const target = shape.target ?? { adapter: 'function', agent: 'demo' };
  const mode = shape.mode ?? 'F';
  const repeat = shape.repeat ?? 0;
  const specId = shape.specId ?? 'spec-a';
  return {
    runId: `${specId}-${mode}-${repeat}-${shape.perturbationId ?? ''}-${target.agent ?? ''}-${target.variant ?? ''}`,
    specId,
    specHash: shape.specHash ?? 'h1',
    target,
    mode,
    repeat,
    ...(shape.perturbationId === undefined ? {} : { perturbationId: shape.perturbationId }),
    status: shape.status ?? 'completed',
    blocks,
    succession: {
      ...(first < 0 ? {} : { firstDriftBlock: shape.firstDriftBlock ?? first }),
      driftCount,
      driftRate: blocks.length === 0 ? 0 : driftCount / blocks.length,
      longestClean: longest,
      minOverBlocks: blocks.every((entry) => entry.pass),
    },
    ...(shape.recovery ? { recovery: shape.recovery } : {}),
    ...(shape.endState ? { endState: shape.endState } : {}),
    cost: 0,
    latencyMs: 0,
    startedAt: FIXED,
    finishedAt: FIXED,
    cacheHit: false,
  };
}

/** Campaign data over synthetic runs, with optional specs by id (hash h1 unless the run says otherwise). */
export function dataOf(
  runs: RunResult[],
  specs: Record<string, Partial<Spec>> = {},
  campaignId = 'c-test',
): CampaignData {
  const ids = [...new Set(runs.map((entry) => `${entry.specId}@${entry.specHash}`))];
  const loaded = new Map<string, LoadedSpec>();
  for (const key of ids) {
    const [id, hash] = key.split('@') as [string, string];
    const spec: Spec = {
      id,
      kind: 'conversation',
      blocks: [{ when: { user: 'hello' } }],
      ...specs[id],
    } as Spec;
    loaded.set(key, { ok: true, path: `${id}.yaml`, spec, hash, warnings: [] });
  }
  const modes = [...new Set(runs.map((entry) => entry.mode))];
  return {
    campaign: {
      campaignId,
      specs: ids.map((key) => {
        const [id, hash] = key.split('@') as [string, string];
        return { id, hash };
      }),
      targets: [{ adapter: 'function', agent: 'demo' }],
      modes: modes.length > 0 ? modes : ['F'],
      repeats: { T: 0, F: 1, P: 0 },
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt: FIXED,
    },
    specs: loaded,
    runs,
  };
}
