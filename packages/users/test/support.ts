import { fileURLToPath } from 'node:url';
import { functionAdapter, processAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type AgentAdapter,
  type BlockResult,
  loadSpecFile,
  type Observed,
  type RunResult,
  runSpec,
  type Spec,
  type UserDriver,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import {
  type AcmeAgent,
  type AcmeStore,
  createAcmeAgent,
  createStore,
} from '../../../examples/acme/src/index';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const PACK_DIR = fileURLToPath(new URL('../../../examples/acme/redteam', import.meta.url));
/** A test pack whose phrasings are unapproved (one D3 phrasing is approved), for the refusal tests. */
export const UNAPPROVED_PACK_DIR = fileURLToPath(new URL('./fixtures/unapproved-pack', import.meta.url));
export const PERSONA_DIR = fileURLToPath(new URL('../../../examples/acme/personas', import.meta.url));
export const OPS_AGENT = fileURLToPath(new URL('../../../examples/acme/ops/agent.mjs', import.meta.url));

/** An Acme spec file, loaded and validated. */
export async function acmeSpec(relative: string): Promise<Spec> {
  const loaded = await loadSpecFile(
    fileURLToPath(new URL(`../../../examples/acme/specs/${relative}`, import.meta.url)),
  );
  if (!loaded.ok) throw new Error(`${relative}: ${JSON.stringify(loaded.errors)}`);
  return loaded.spec;
}

export const CONVERSATIONS = [
  'conversations/new-customer-coverage.yaml',
  'conversations/number-porting.yaml',
  'conversations/off-topic-return.yaml',
  'conversations/order-loose-confirmation.yaml',
  'conversations/plan-upgrade.yaml',
  'conversations/tool-failure.yaml',
] as const;

/** A spec from a literal, validated. */
export function spec(raw: unknown): Spec {
  const loaded = validateSpec(raw);
  if (!loaded.ok) throw new Error(`invalid test spec: ${JSON.stringify(loaded.errors)}`);
  return loaded.spec;
}

/** The Acme sales assistant behind the real function adapter, wired as the CLI wires it. */
export function acmeSales(wrap?: (agent: AcmeAgent) => AcmeAgent): AgentAdapter {
  type Session = { store: AcmeStore; agent: AcmeAgent };
  return functionAdapter<Session>({
    create: () => {
      const store = createStore();
      const agent = createAcmeAgent(store);
      return { store, agent: wrap ? wrap(agent) : agent };
    },
    respond: (messages, world, _vars, session) => session.agent.respond(messages, world),
    payloads: (session) => session.store.payloads,
    deterministic: true,
  });
}

/** A faulty ops agent of the gate lane's fault set: a script that wraps the real one. */
export const OPS_FAULT = (name: string) =>
  fileURLToPath(new URL(`../../../examples/acme/faults/ops/${name}`, import.meta.url));

/** The Acme ops agent (or a fault script) behind the real process adapter, in a local sandbox under `dir`. */
export function acmeOps(dir: string, script: string = OPS_AGENT): AgentAdapter {
  return processAdapter({
    command: process.execPath,
    args: [script],
    provider: localProvider({ dir }),
    deterministic: true,
  });
}

/** One run in mode P through the real runner with the default checks and readers. */
export function runP(
  runOf: Spec,
  driver: UserDriver,
  adapter: AgentAdapter,
  perturbationId?: string,
): Promise<RunResult> {
  return runSpec(runOf, {
    adapter,
    driver,
    checks: defaultChecks(),
    artifacts: defaultReaders(),
    mode: 'P',
    repeat: 0,
    ...(perturbationId === undefined ? {} : { perturbationId }),
  });
}

const EMPTY: Observed = { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0 };

/** A block result written by hand: passing, ledger intact, no verdict, unless the parts say otherwise. */
export function block(index: number, parts: Partial<BlockResult> & { text?: string } = {}): BlockResult {
  const { text, ...rest } = parts;
  return {
    index,
    givenHash: `g${index}`,
    observed: { ...EMPTY, text: text ?? '' },
    verdicts: [],
    ledgerCheck: { ok: true, contradictions: [] },
    drift: [],
    pass: true,
    ...rest,
  };
}

/** A run written by hand around its blocks. */
export function run(blocks: BlockResult[], parts: Partial<RunResult> = {}): RunResult {
  return {
    runId: 'r1',
    specId: 's',
    specHash: 'h',
    target: { adapter: 'function', agent: 'test' },
    mode: 'P',
    repeat: 0,
    status: 'completed',
    blocks,
    succession: { driftCount: 0, driftRate: 0, longestClean: blocks.length, minOverBlocks: true },
    cost: 0,
    latencyMs: 0,
    startedAt: '2026-10-11T00:00:00.000Z',
    finishedAt: '2026-10-11T00:00:01.000Z',
    cacheHit: false,
    ...parts,
  };
}
