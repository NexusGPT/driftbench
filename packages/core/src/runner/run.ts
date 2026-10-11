import type { AdapterCapabilities, AgentAdapter, Session, Turn } from '../contracts/adapter';
import type { ArtifactReaderRegistry } from '../contracts/artifacts';
import { type CheckContext, type CheckSet, machineVerdict } from '../contracts/check';
import type { DriverStep, UserDriver } from '../contracts/driver';
import type { Store } from '../contracts/store';
import { DriftClass, type Message, type TargetRef, type WorldState } from '../schema/common';
import { type BlockResult, Observed, type RunMode, RunResult, Verdict } from '../schema/run';
import type { BlockSpec, EndState, Expect, GivenOverride, Spec, Stimulus } from '../schema/spec';
import { contentHash } from '../spec/hash';
import { compareEndState, type EndStateMatch } from './assertion';
import { blockCacheKey, endStateCacheKey, type ObservedCache, unwrapEndState, wrapEndState } from './cache';
import { cellId } from './cell';
import {
  addFacts,
  assistantMessage,
  enterBlock,
  initialGiven,
  resolveGiven,
  stimulusMessages,
} from './given';
import { CallFailure, describeError, type RetryOptions, withRetry } from './retry';
import { succession } from './succession';

export type RunOptions = {
  adapter: AgentAdapter;
  /** Decides each block's stimulus. The scripted driver of `@driftbench/users` replays the spec's blocks. */
  driver: UserDriver;
  /** Applied to every block, in order. */
  checks: CheckSet;
  /** F runs free: one session, each block inherits the agent's own earlier replies. P is F plus the
   *  blocks a perturbing driver injects. T (teacher-forced) is planned, phase 3, and throws. */
  mode: RunMode;
  repeat: number;
  /** Overrides the spec's target. With neither, the target is `{ adapter: <adapter id> }`. */
  target?: TargetRef;
  /** The perturbation the run injects, recorded on the result. */
  perturbationId?: string;
  /** With `campaignId`, the finished run is written here. */
  store?: Store;
  campaignId?: string;
  /** Observed blocks and end-state reads go to this cache, and a run is replayed from it when every
   *  block and read of the run is in it. Absent: no cache, every block reaches the adapter. */
  cache?: ObservedCache;
  cacheTtlMs?: number;
  /** Readers for the artifact checks, passed to every CheckContext. */
  artifacts?: ArtifactReaderRegistry;
  retry?: RetryOptions;
  now?: () => Date;
  /** Default: the cell id of the run (spec hash, target, mode, repeat, perturbation), the store's run id. */
  runId?: string;
  /** A guard against a driver that never stops. Default: 4 steps per spec block, at least 16. */
  maxSteps?: number;
};

/**
 * Runs one spec, once, in free-running mode. For each step of the driver: resolve the block's Given,
 * send the stimulus (then `trace` when the adapter has the capability), apply every check, record the
 * ledger, drift and pass of the block. After the last spec block, the end-state sources the spec names
 * are read through `adapter.endState` (source `*` for `end_state: none`); the checks of that block see
 * them and the run compares them.
 *
 * Transport errors are retried with backoff; an AgentFailure, an Observed that does not validate, or a
 * transport error past its retries ends the run with status `failed` and the error. The session is
 * always closed. The result always validates against the RunResult schema.
 */
export async function runSpec(spec: Spec, options: RunOptions): Promise<RunResult> {
  if (options.mode === 'T') {
    throw new Error('runSpec: teacher-forced mode (T) is planned, phase 3; this runner runs F and P');
  }
  if (options.store && options.campaignId === undefined) {
    throw new Error('runSpec: a store needs a campaignId to file the run under');
  }
  const now = options.now ?? (() => new Date());
  const specHash = contentHash(spec);
  const target = options.target ?? spec.target ?? { adapter: options.adapter.id };
  // In P mode the spec's end state describes the unperturbed run, so it is neither read nor compared, as
  // the Acme light runner and the end_state check do; phase 3 decides what a perturbed run should leave.
  const endState = options.mode === 'P' ? undefined : spec.end_state;
  const run: RunContext = {
    spec,
    specHash,
    target,
    mode: options.mode,
    repeat: options.repeat,
    perturbationId: options.perturbationId,
    adapter: options.adapter,
    capabilities: options.adapter.capabilities(),
    driver: options.driver,
    checks: options.checks,
    cache: options.cache,
    cacheTtlMs: options.cacheTtlMs,
    artifacts: options.artifacts,
    retry: options.retry,
    now,
    runId:
      options.runId ??
      cellId({
        specHash,
        target,
        mode: options.mode,
        repeat: options.repeat,
        perturbationId: options.perturbationId,
      }),
    startedAt: now().toISOString(),
    maxSteps: options.maxSteps ?? Math.max(16, 4 * spec.blocks.length),
    endState,
    sources: endStateSources(endState),
  };

  const replayed = options.cache ? await execute(run, replayChannel(options.cache)) : undefined;
  const result = replayed ?? (await execute(run, liveChannel(run)));
  if (!result) throw new Error('runSpec: a live run always gives a result');
  // The run as the store keeps it: written as JSON and read back, so what is returned is what is stored.
  const parsed = RunResult.parse(JSON.parse(JSON.stringify(result)));
  if (options.store && options.campaignId !== undefined)
    await options.store.putRun(options.campaignId, parsed);
  return parsed;
}

type RunContext = {
  spec: Spec;
  specHash: string;
  target: TargetRef;
  mode: RunMode;
  repeat: number;
  perturbationId: string | undefined;
  adapter: AgentAdapter;
  capabilities: AdapterCapabilities;
  driver: UserDriver;
  checks: CheckSet;
  cache: ObservedCache | undefined;
  cacheTtlMs: number | undefined;
  artifacts: ArtifactReaderRegistry | undefined;
  retry: RetryOptions | undefined;
  now: () => Date;
  runId: string;
  startedAt: string;
  maxSteps: number;
  endState: EndState | undefined;
  /** The sources read after the last spec block: each mapping's own, or `*` for `end_state: none`. */
  sources: string[];
};

/** One step of the driver, resolved against the spec. */
type PlannedStep = {
  block: BlockSpec;
  expect: Expect;
  stimulus: Stimulus;
  injected: boolean;
  blockId?: string;
  given?: GivenOverride;
  world?: WorldState;
  budget?: NonNullable<Turn['budget']>;
  lastSpecBlock: boolean;
};

type EndStateRead = { kind: 'read'; states: unknown[] } | { kind: 'miss' } | { kind: 'unavailable' };

/** Where observations come from: the adapter (live), or the cache (replay). */
type Channel = {
  readonly replay: boolean;
  /** Ends the open session, so the next block opens a new one from its own prefix. */
  restart(): Promise<void>;
  /** The block's Observed; undefined when a replay misses. */
  observe(turn: Turn, user: Message[], key: string): Promise<Observed | undefined>;
  endState(sources: string[], key: string): Promise<EndStateRead>;
  readArtifact(): ((path: string) => Promise<Uint8Array>) | undefined;
  /** Closes what is open; returns a note when something could not be closed or cached. */
  close(): Promise<string | undefined>;
};

class RunnerError extends Error {
  override name = 'RunnerError';
}

/** Runs the loop over one channel. Returns undefined when a replay misses, so the run goes live instead. */
async function execute(run: RunContext, channel: Channel): Promise<RunResult | undefined> {
  const { spec } = run;
  const blocks: BlockResult[] = [];
  const { sources } = run;
  let state = initialGiven(spec);
  let history: Message[] = [];
  let nextBlock = 0;
  let lastKey: string | undefined;
  let endRead: { states: unknown[]; afterBlock: number } | undefined;
  let status: RunResult['status'] = 'completed';
  let error: string | undefined;

  try {
    for (let position = 0; ; position++) {
      if (position >= run.maxSteps) {
        status = 'stopped';
        error = `the driver ${run.driver.id} did not stop within ${run.maxSteps} steps`;
        break;
      }
      const step = await nextStep(run, nextBlock, blocks);
      if (step.kind === 'stop') break;
      const planned = planStep(spec, step);
      if (step.kind === 'block') nextBlock = step.blockIndex + 1;

      state = enterBlock(state, planned.given, planned.world);
      if (planned.given?.prefix) {
        await channel.restart();
        history = structuredClone(planned.given.prefix);
      }
      const user = stimulusMessages(planned.stimulus);
      const given = resolveGiven(state, history, run.target);
      const turn: Turn = {
        index: position,
        stimulus: planned.stimulus,
        given,
        ...(planned.budget ? { budget: planned.budget } : {}),
      };
      const key = blockCacheKey({
        specHash: run.specHash,
        repeat: run.repeat,
        position,
        given,
        stimulus: planned.stimulus,
        target: run.target,
        adapter: run.adapter.id,
        adapterVersion: run.adapter.version,
      });
      const observed = await channel.observe(turn, user, key);
      if (!observed) return undefined;
      history = [...history, ...user, assistantMessage(observed)];
      lastKey = key;

      const facts = addFacts(state.ledger, planned.expect.ledger_add);
      state = { ...state, ledger: facts.ledger };

      let endState: unknown;
      if (planned.lastSpecBlock && sources.length > 0) {
        const read = await channel.endState(sources, key);
        if (read.kind === 'miss') return undefined;
        if (read.kind === 'read') {
          endRead = { states: read.states, afterBlock: position };
          endState = endStateValue(run.endState, sources, read.states);
        }
      }

      const verdicts = await applyChecks(run.checks, {
        spec,
        mode: run.mode,
        blockIndex: position,
        block: planned.block,
        expect: planned.expect,
        given,
        observed,
        history: [...blocks],
        ledger: facts.ledger,
        endState,
        artifacts: run.artifacts,
        readArtifact: channel.readArtifact(),
      });
      const stage = observed.runtime?.stages?.at(-1)?.name;
      blocks.push({
        index: position,
        ...(planned.blockId !== undefined ? { blockId: planned.blockId } : {}),
        ...(planned.injected ? { injected: true } : {}),
        givenHash: given.hash,
        observed,
        verdicts,
        ...(stage !== undefined ? { stageObserved: stage } : {}),
        ledgerCheck: { ok: facts.contradictions.length === 0, contradictions: facts.contradictions },
        drift: driftOf(verdicts),
        pass: verdicts.every((verdict) => !verdict.gating || verdict.outcome === 'pass'),
      });
    }
  } catch (cause) {
    if (channel.replay) return undefined;
    status = 'failed';
    error =
      cause instanceof CallFailure || cause instanceof RunnerError ? cause.message : describeError(cause);
  }

  // Every run of a spec that names an end state carries it, failed and stopped runs too: the read taken
  // after the last spec block when no block ran after it, else a read now. A read that cannot happen fails
  // the end state and says why.
  let endState: EndStateMatch | undefined;
  if (run.endState !== undefined) {
    let states = endRead?.afterBlock === blocks.length - 1 ? endRead.states : undefined;
    let unreadable = 'no block ran, so no session was open to read from';
    if (!states && lastKey !== undefined) {
      try {
        const read = await channel.endState(sources, lastKey);
        if (read.kind === 'miss') return undefined;
        if (read.kind === 'read') states = read.states;
        else unreadable = `the adapter ${run.adapter.id} cannot read end states`;
      } catch (cause) {
        if (channel.replay) return undefined;
        unreadable = cause instanceof CallFailure ? cause.message : describeError(cause);
      }
    }
    endState = states
      ? compareEndState(run.endState, endStateValue(run.endState, sources, states))
      : {
          match: false,
          diff: sources.map((source) => ({
            field: source,
            expected: 'an end state read through adapter.endState',
            observed: unreadable,
          })),
        };
  }

  const note = await channel.close();
  if (channel.replay && blocks.length === 0) return undefined;
  const message = [error, note].filter((part) => part !== undefined).join('; ');
  return {
    runId: run.runId,
    specId: spec.id,
    specHash: run.specHash,
    target: run.target,
    mode: run.mode,
    repeat: run.repeat,
    ...(run.perturbationId !== undefined ? { perturbationId: run.perturbationId } : {}),
    status,
    ...(message ? { error: message } : {}),
    blocks,
    succession: succession(blocks),
    ...(endState ? { endState } : {}),
    cost: blocks.reduce((sum, block) => sum + blockCost(block.observed), 0),
    latencyMs: blocks.reduce((sum, block) => sum + block.observed.latencyMs, 0),
    startedAt: run.startedAt,
    finishedAt: run.now().toISOString(),
    cacheHit: channel.replay,
  };
}

/** The sources to read for a spec's `end_state`: `*` for `none`, each mapping's source once otherwise. */
function endStateSources(endState: EndState | undefined): string[] {
  if (endState === undefined) return [];
  if (endState === 'none') return ['*'];
  return [...new Set([endState].flat().map((entry) => entry.source))];
}

/**
 * The end state as the checks see it in `CheckContext.endState`: the value a mapping's source returned,
 * a record keyed by source for a list, the list source `*` returned for `none`.
 */
function endStateValue(endState: EndState | undefined, sources: string[], states: unknown[]): unknown {
  if (Array.isArray(endState))
    return Object.fromEntries(sources.map((source, index) => [source, states[index]]));
  return states[0];
}

async function nextStep(run: RunContext, blockIndex: number, blocks: BlockResult[]): Promise<DriverStep> {
  try {
    return await run.driver.next({ spec: run.spec, mode: run.mode, blockIndex, history: [...blocks] });
  } catch (cause) {
    throw new RunnerError(
      `the driver ${run.driver.id} failed before block ${blockIndex}: ${describeError(cause)}`,
    );
  }
}

function planStep(spec: Spec, step: Exclude<DriverStep, { kind: 'stop' }>): PlannedStep {
  if (step.kind === 'block') {
    const block = spec.blocks[step.blockIndex];
    if (!block) {
      throw new RunnerError(
        `the driver asked for block ${step.blockIndex}; the spec has blocks 0 to ${spec.blocks.length - 1}`,
      );
    }
    const budget = block.budget;
    return {
      block,
      expect: block.expect ?? {},
      stimulus: step.stimulus,
      injected: 'injection' in step.stimulus,
      ...(block.id !== undefined ? { blockId: block.id } : {}),
      ...(block.given ? { given: block.given } : {}),
      ...(budget
        ? {
            budget: {
              ...(budget.steps !== undefined ? { steps: budget.steps } : {}),
              ...(budget.cost_usd !== undefined ? { costUsd: budget.cost_usd } : {}),
              ...(budget.latency_ms !== undefined ? { latencyMs: budget.latency_ms } : {}),
            },
          }
        : {}),
      lastSpecBlock: step.blockIndex === spec.blocks.length - 1,
    };
  }
  const perturbation = spec.perturbations?.find((entry) => entry.id === step.perturbationId);
  const expect = perturbation?.expect ?? {};
  return {
    block: { id: step.perturbationId, when: step.stimulus, expect },
    expect,
    stimulus: step.stimulus,
    injected: true,
    blockId: step.perturbationId,
    ...(perturbation?.world ? { world: perturbation.world } : {}),
    lastSpecBlock: false,
  };
}

/**
 * Applies every check whose `applies` holds. A check that throws, or returns a verdict the schema
 * refuses, gives an inconclusive gating verdict that names the problem: the block cannot pass on it,
 * and nothing is skipped silently.
 */
async function applyChecks(checks: CheckSet, ctx: CheckContext): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];
  for (const check of checks) {
    let produced: Verdict[];
    try {
      if (!check.applies(ctx)) continue;
      produced = await check.evaluate(ctx);
    } catch (cause) {
      verdicts.push(
        machineVerdict(
          check.name || 'check',
          'error',
          'inconclusive',
          `the check threw ${describeError(cause)}`,
        ),
      );
      continue;
    }
    for (const verdict of produced) {
      const parsed = Verdict.safeParse(verdict);
      if (parsed.success) {
        verdicts.push(parsed.data);
      } else {
        const issue = parsed.error.issues[0];
        verdicts.push(
          machineVerdict(
            check.name || 'check',
            'invalid',
            'inconclusive',
            `the check returned a verdict the schema refuses: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
          ),
        );
      }
    }
  }
  return verdicts;
}

/**
 * Drift classes before the phase 3 classifier, by the check a failing verdict comes from: the text of its
 * id before the first dot (check names hold no dot; tool labels and paths after it may). Tool, forbidden,
 * skill and guard checks give X5_tool; language and card checks (one_message_per_turn among them) give
 * X4_format; the stage check, which reads the stage the runtime reports, gives X3_flow. A custom check's
 * ids start with `custom`, so a custom check never takes a family's class by its name.
 */
const DRIFT_BY_CHECK: Readonly<Record<string, DriftClass>> = {
  tools: 'X5_tool',
  forbidden: 'X5_tool',
  skills: 'X5_tool',
  guards: 'X5_tool',
  lang: 'X4_format',
  cards: 'X4_format',
  stage: 'X3_flow',
};

function driftOf(verdicts: readonly Verdict[]): DriftClass[] {
  const found = new Set<DriftClass>();
  for (const verdict of verdicts) {
    if (verdict.outcome !== 'fail') continue;
    const drift = DRIFT_BY_CHECK[verdict.id.split('.', 1)[0] ?? ''];
    if (drift) found.add(drift);
  }
  return DriftClass.options.filter((drift) => found.has(drift));
}

/** The block's cost: the total the adapter reported, or else the sum of its segments' costs. */
function blockCost(observed: Observed): number {
  if (observed.cost.usd !== undefined) return observed.cost.usd;
  return observed.segments.reduce((sum, segment) => sum + (segment.cost?.usd ?? 0), 0);
}

function liveChannel(run: RunContext): Channel {
  const { adapter } = run;
  const notes: string[] = [];
  let session: Session | undefined;
  const call = <T>(what: string, attempt: () => Promise<T>) => withRetry(what, attempt, run.retry);
  const remember = async (key: string, observed: Observed) => {
    if (!run.cache) return;
    try {
      await run.cache.cachePut(key, observed, run.cacheTtlMs);
    } catch (cause) {
      notes.push(`the cache refused ${key}: ${describeError(cause)}`);
    }
  };
  const closeSession = async () => {
    const open = session;
    session = undefined;
    if (!open) return;
    try {
      await adapter.close(open);
    } catch (cause) {
      notes.push(`closing session ${open.id} failed: ${describeError(cause)}`);
    }
  };

  return {
    replay: false,
    restart: closeSession,
    async observe(turn, user, key) {
      if (!session) session = await call(`open on block ${turn.index}`, () => adapter.open(turn.given));
      const current = session;
      current.history.push(...structuredClone(user));
      let observed: unknown = await call(`send on block ${turn.index}`, () => adapter.send(current, turn));
      const trace = adapter.trace;
      if (run.capabilities.trace && trace) {
        observed = await call(`trace on block ${turn.index}`, () => trace.call(adapter, current, turn));
      }
      // Checked as JSON, the form the cache and the store keep: an undefined that JSON drops is a fault here.
      const parsed = Observed.safeParse(asJson(observed, turn.index));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new RunnerError(
          `the adapter's Observed for block ${turn.index} does not match the schema as JSON: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
        );
      }
      current.history.push(assistantMessage(parsed.data));
      await remember(key, parsed.data);
      return parsed.data;
    },
    async endState(sources, key) {
      const read = adapter.endState;
      const current = session;
      if (!current || !run.capabilities.endState || !read) return { kind: 'unavailable' };
      const states: unknown[] = [];
      for (const source of sources) {
        const state = await call(`endState ${source}`, () => read.call(adapter, current, source));
        await remember(endStateCacheKey(key, source), wrapEndState(state));
        states.push(state);
      }
      return { kind: 'read', states };
    },
    readArtifact() {
      const read = adapter.readArtifact;
      if (!read) return undefined;
      return (path) =>
        session ? read.call(adapter, session, path) : Promise.reject(new Error('no session is open'));
    },
    async close() {
      await closeSession();
      return notes.length > 0 ? notes.join('; ') : undefined;
    },
  };
}

/** A value written as JSON and read back. */
function asJson(value: unknown, block: number): unknown {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : JSON.parse(text);
  } catch (cause) {
    throw new RunnerError(
      `the adapter's Observed for block ${block} cannot be written as JSON: ${describeError(cause)}`,
    );
  }
}

function replayChannel(cache: ObservedCache): Channel {
  return {
    replay: true,
    async restart() {},
    async observe(_turn, _user, key) {
      const parsed = Observed.safeParse(await cache.cacheGet(key));
      return parsed.success ? parsed.data : undefined;
    },
    async endState(sources, key) {
      const states: unknown[] = [];
      for (const source of sources) {
        const hit = await cache.cacheGet(endStateCacheKey(key, source));
        if (!hit) return { kind: 'miss' };
        states.push(unwrapEndState(hit));
      }
      return { kind: 'read', states };
    },
    readArtifact: () => undefined,
    async close() {
      return undefined;
    },
  };
}
