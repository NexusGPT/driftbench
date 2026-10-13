import type { AdapterCapabilities, AgentAdapter, Session, Turn } from '../contracts/adapter';
import type { ArtifactReaderRegistry } from '../contracts/artifacts';
import { type CheckContext, type CheckSet, machineVerdict } from '../contracts/check';
import type { DriverStep, UserDriver } from '../contracts/driver';
import { immutableHistorySource } from '../contracts/history';
import type { Store } from '../contracts/store';
import { gateToolCalls, type ToolRule } from '../contracts/tool-policy';
import { collectRetries, type RetryPolicy, retryPolicy } from '../retry';
import type { Message, TargetRef, WorldState } from '../schema/common';
import {
  type BlockResult,
  Observed,
  type ResolvedGiven,
  type RetryEvent,
  type RunEvent,
  type RunMode,
  RunResult,
  Verdict,
} from '../schema/run';
import type { BlockSpec, EndState, Expect, GivenOverride, Spec, Stimulus } from '../schema/spec';
import { cloneJson, contentHash } from '../spec/hash';
import { compareEndState, type EndStateMatch } from './assertion';
import { blockCacheKey, endStateCacheKey, type ObservedCache, unwrapEndState, wrapEndState } from './cache';
import { cellId } from './cell';
import { driftOf } from './drift';
import {
  addFacts,
  assistantMessage,
  enterBlock,
  initialGiven,
  resolveCanonicalGiven,
  resolveGiven,
  stimulusMessages,
} from './given';
import { describeContradiction, ledgerVerdicts } from './ledger';
import { type RecoveryOptions, recoveryOf } from './recovery';
import { CallFailure, describeError, type RetryOptions, retryLayer, withRetry } from './retry';
import { canonicalPreviousStage, flowVerdicts, readStage, stageSignatures } from './stages';
import { succession } from './succession';

/**
 * What the runner reports as it runs, in order: a block starting, each tool call the adapter recorded, each retry a block took,
 * a block ending with its verdict, and the run ending. An observer writes these as they arrive, so an interrupted run keeps the
 * events up to the interruption.
 */
export type { RunEvent };

export type RunOptions = {
  /** Receives each event as it happens. Absent: no events are reported. */
  onEvent?: (event: RunEvent) => void;
  /** Keeps the events on the run record (its events field), in order. Off by default: a run record stays as it was. */
  recordEvents?: boolean;
  adapter: AgentAdapter;
  /** Decides each block's stimulus. The scripted driver of `@agent-nexus/driftbench-users` replays the spec's blocks. */
  driver: UserDriver;
  /** Applied to every block, in order. */
  checks: CheckSet;
  /** F runs free: one session, each block inherits the agent's own earlier replies. P is F plus the
   *  blocks a perturbing driver injects. T (teacher-forced) runs every block from its canonical Given in a
   *  session of its own: the prefix, ledger and world the spec writes, never the agent's own history. */
  mode: RunMode;
  repeat: number;
  /** Overrides the spec's target. With neither, the target is `{ adapter: <adapter id> }`. */
  target?: TargetRef;
  /** The perturbation the run injects, recorded on the result. */
  perturbationId?: string;
  /** A tool policy over the calls each block records. The denied calls are marked before the checks read them; the
   *  cache keeps the calls as the adapter reported them, and every read gates them again. Absent: no gate. */
  toolPolicy?: readonly ToolRule[];
  /** With `campaignId`, the finished run is written here. */
  store?: Store;
  campaignId?: string;
  /** Observed blocks and end-state reads go to this cache, and a run is replayed from it when every
   *  block and read of the run is in it. Absent: no cache, every block reaches the adapter. An adapter
   *  whose capabilities say `sandbox` never uses it: a replay has no workspace to read files from. */
  cache?: ObservedCache;
  cacheTtlMs?: number;
  /** Names the suite a run belongs to. Its cache keys differ from another suite's, so a new name starts from an empty cache. */
  suite?: string;
  /** Readers for the artifact checks, passed to every CheckContext. */
  artifacts?: ArtifactReaderRegistry;
  retry?: RetryOptions;
  now?: () => Date;
  /** Default: the cell id of the run (spec hash, target, mode, repeat, perturbation), the store's run id. */
  runId?: string;
  /** A guard against a driver that never stops. Default: 4 steps per spec block, at least 16. */
  maxSteps?: number;
  /** Mode P: the free-running run of the same spec and target, for the collateral of the recovery. */
  reference?: RunResult;
  /** Mode P: more tools whose call is a consequential act, for the recovery's safe action and clarification. */
  consequential?: (label: string) => boolean;
};

/**
 * Runs one spec, once, in mode F, P or T. For each step of the driver: resolve the block's Given,
 * send the stimulus (then `trace` when the adapter has the capability), apply every check, record the
 * ledger, drift and pass of the block. After the last spec block, the end-state sources the spec names
 * are read through `adapter.endState` (source `*` for `end_state: none`); the checks of that block see
 * them and the run compares them.
 *
 * In mode T each block is an independent sample: it opens its own session from `canonicalGiven`, its
 * checks see no earlier block, and it may not be injected. On an adapter with a sandbox (a task), the
 * workspace is part of the state the reference trajectory had at the block: the block keeps the session of
 * the block before, with its history replaced by the canonical prefix, so it starts from the workspace that
 * block left; a block that writes its own `given.world.workspace` starts in a new session from it. The end state of a T run is composed from a read
 * after every block, in block order: a source keeps the last value a block's session recorded, and `*`
 * joins the payload lists, so the last block's checks and the run see what the blocks left between them.
 *
 * Transport errors are retried with backoff; an AgentFailure, an Observed that does not validate, or a
 * transport error past its retries ends the run with status `failed` and the error. The session is
 * always closed. The result always validates against the RunResult schema.
 */
export async function runSpec(spec: Spec, options: RunOptions): Promise<RunResult> {
  if (options.store && options.campaignId === undefined) {
    throw new Error('runSpec: a store needs a campaignId to file the run under');
  }
  const now = options.now ?? (() => new Date());
  const specHash = contentHash(spec);
  // The cache key leaves out the spec's version: a free label that plays no part (docs/running.md, "The
  // cache and replay"), so relabelling a spec still replays its runs.
  const { version: _version, ...unlabelled } = spec;
  const cacheSpecHash = contentHash(unlabelled);
  const target = options.target ?? spec.target ?? { adapter: options.adapter.id };
  // In P mode the spec's end state describes the unperturbed run, so it is neither read nor compared, as
  // the Acme light runner and the end_state check do; phase 3 decides what a perturbed run should leave.
  const endState = options.mode === 'P' ? undefined : spec.end_state;
  const capabilities = options.adapter.capabilities();
  // A run in a sandbox is neither replayed nor cached: a replay opens no workspace, so the artifact
  // checks could not read the files its blocks made. It goes live every time.
  const cache = capabilities.sandbox ? undefined : options.cache;
  // The events go to the observer as they happen, and to the record when asked for.
  const recorded: RunEvent[] | undefined = options.recordEvents ? [] : undefined;
  const reportEvent =
    recorded || options.onEvent
      ? (event: RunEvent) => {
          recorded?.push(event);
          options.onEvent?.(event);
        }
      : undefined;
  const run: RunContext = {
    spec,
    specHash,
    cacheSpecHash,
    target,
    mode: options.mode,
    repeat: options.repeat,
    perturbationId: options.perturbationId,
    adapter: options.adapter,
    capabilities,
    driver: options.driver,
    checks: options.checks,
    toolPolicy: options.toolPolicy,
    onEvent: reportEvent,
    cache,
    cacheTtlMs: options.cacheTtlMs,
    suite: options.suite,
    artifacts: options.artifacts,
    retry: options.retry,
    // The spec target's retry settings, the run's own (the command line) over them.
    policy: retryPolicy(target.retry, retryLayer(options.retry)),
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
    signatures: stageSignatures(spec),
    recovery: {
      ...(options.reference ? { reference: options.reference } : {}),
      ...(options.consequential ? { consequential: options.consequential } : {}),
    },
  };

  const replayed = cache ? await execute(run, replayChannel(cache, run.toolPolicy)) : undefined;
  // A run the cache holds only in part resumes: each block it finished is read back, and the first block it did not
  // finish goes to the adapter, which opens its session from the history the run has built so far.
  const result =
    replayed ??
    (await execute(run, cache ? resumeChannel(cache, liveChannel(run), run.toolPolicy) : liveChannel(run)));
  if (!result) throw new Error('runSpec: a live run always gives a result');
  reportEvent?.({ type: 'run_end', status: result.status, at: new Date().toISOString() });
  // The run as the store keeps it: written as JSON and read back, so what is returned is what is stored.
  const parsed = RunResult.parse(
    JSON.parse(JSON.stringify(recorded ? { ...result, events: recorded } : result)),
  );
  if (options.store && options.campaignId !== undefined)
    await options.store.putRun(options.campaignId, parsed);
  return parsed;
}

type RunContext = {
  spec: Spec;
  specHash: string;
  /** The hash the cache key carries: the spec's, without its version label. */
  cacheSpecHash: string;
  target: TargetRef;
  mode: RunMode;
  repeat: number;
  perturbationId: string | undefined;
  adapter: AgentAdapter;
  capabilities: AdapterCapabilities;
  driver: UserDriver;
  toolPolicy: readonly ToolRule[] | undefined;
  onEvent?: (event: RunEvent) => void;
  checks: CheckSet;
  cache: ObservedCache | undefined;
  cacheTtlMs: number | undefined;
  suite: string | undefined;
  artifacts: ArtifactReaderRegistry | undefined;
  retry: RetryOptions | undefined;
  policy: RetryPolicy;
  now: () => Date;
  runId: string;
  startedAt: string;
  maxSteps: number;
  endState: EndState | undefined;
  /** The sources read after the last spec block: each mapping's own, or `*` for `end_state: none`. */
  sources: string[];
  /** The tools each stage of the spec's catalogue expects, for the step classifier. */
  signatures: Map<string, Set<string>>;
  recovery: RecoveryOptions;
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
  /** Keeps the open session and replaces its history with this prefix; false when no session is open. */
  reseat(prefix: readonly Message[]): boolean;
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
  /** The end-state values so far: in mode T composed over the blocks, else the last read. */
  let composed: unknown[] | undefined;
  /** In mode T, the end state composed before the open session opened. */
  let sessionBase: unknown[] | undefined;
  let status: RunResult['status'] = 'completed';
  let endVerdict: 'success' | 'failure' | undefined;
  let error: string | undefined;

  try {
    for (let position = 0; ; position++) {
      if (position >= run.maxSteps) {
        status = 'stopped';
        error = `the driver ${run.driver.id} did not stop within ${run.maxSteps} steps`;
        break;
      }
      const step = await nextStep(run, nextBlock, blocks);
      if (step.kind === 'stop') {
        endVerdict = step.verdict;
        break;
      }
      const planned = planStep(spec, step);
      if (step.kind === 'block') nextBlock = step.blockIndex + 1;

      let teacherGiven: ResolvedGiven | undefined;
      if (run.mode === 'T') {
        if (step.kind !== 'block') {
          throw new RunnerError(
            `teacher-forced mode runs the spec's own blocks; the driver ${run.driver.id} injected ${step.perturbationId}`,
          );
        }
        const canonical = resolveCanonicalGiven(spec, step.blockIndex, run.target);
        state = canonical.state;
        // A task's workspace is part of the state the reference trajectory had at this block: the session
        // of the block before keeps it, unless this block writes its own workspace. Its history becomes the
        // canonical prefix. Every other block starts in a new session from its canonical Given.
        const keepsWorkspace =
          run.capabilities.sandbox && spec.blocks[step.blockIndex]?.given?.world?.workspace === undefined;
        if (!(keepsWorkspace && channel.reseat(canonical.given.prefix))) {
          await channel.restart();
          sessionBase = composed;
        }
        history = canonical.given.prefix;
        teacherGiven = canonical.given;
      } else {
        state = enterBlock(state, planned.given, planned.world);
        if (planned.given?.prefix) {
          await channel.restart();
          history = structuredClone(planned.given.prefix);
        }
      }
      const user = stimulusMessages(planned.stimulus);
      const given = teacherGiven ?? resolveGiven(state, history, run.target);
      const turn: Turn = {
        index: position,
        stimulus: planned.stimulus,
        given,
        ...(planned.budget ? { budget: planned.budget } : {}),
        retry: run.policy,
      };
      // A live channel without a cache does not consume the key. Keep the block marker without hashing
      // its entire prefix again; cached and replayed runs retain their exact existing identities.
      const key = run.cache
        ? blockCacheKey({
            specHash: run.cacheSpecHash,
            repeat: run.repeat,
            position,
            given,
            stimulus: planned.stimulus,
            target: run.target,
            adapter: run.adapter.id,
            adapterVersion: run.adapter.version,
            ...(run.suite === undefined ? {} : { suite: run.suite }),
          })
        : '';
      run.onEvent?.({ type: 'block_start', index: position, at: new Date().toISOString() });
      const observed = await channel.observe(turn, user, key);
      if (!observed) return undefined;
      // A model call the adapter reported on a segment: its tokens, cost and latency. The time is when the reply came back;
      // the call began latencyMs earlier.
      for (const segment of observed.segments) {
        if (segment.cost === undefined && segment.latencyMs === undefined) continue;
        // One clock reading gives both times, so the end minus the start is exactly the latency.
        const reportedAt = Date.now();
        run.onEvent?.({
          type: 'model_call',
          index: position,
          ...(segment.cost?.inputTokens === undefined ? {} : { inputTokens: segment.cost.inputTokens }),
          ...(segment.cost?.outputTokens === undefined ? {} : { outputTokens: segment.cost.outputTokens }),
          ...(segment.cost?.usd === undefined ? {} : { usd: segment.cost.usd }),
          ...(segment.latencyMs === undefined ? {} : { latencyMs: segment.latencyMs }),
          startedAt: new Date(reportedAt - (segment.latencyMs ?? 0)).toISOString(),
          at: new Date(reportedAt).toISOString(),
        });
      }
      for (const call of observed.toolCalls) {
        run.onEvent?.({
          type: 'tool_call',
          index: position,
          label: call.label,
          ...(call.error === undefined ? {} : { error: call.error }),
          at: new Date().toISOString(),
        });
      }
      for (let r = 0; r < (observed.retries?.length ?? 0); r += 1) {
        run.onEvent?.({ type: 'retry', index: position, at: new Date().toISOString() });
      }
      history = [...history, ...cloneJson(user), cloneJson(assistantMessage(observed))];
      lastKey = key;

      const facts = addFacts(state.ledger, planned.expect.ledger_add);
      state = { ...state, ledger: facts.ledger };

      let endState: unknown;
      if (sources.length > 0 && (planned.lastSpecBlock || run.mode === 'T')) {
        const read = await channel.endState(sources, key);
        if (read.kind === 'miss') return undefined;
        if (read.kind === 'read') {
          // A read covers what the open session recorded since it opened, so it joins what came before.
          const states = run.mode === 'T' ? composeStates(sources, sessionBase, read.states) : read.states;
          composed = states;
          endRead = { states, afterBlock: position };
        }
        if (planned.lastSpecBlock && composed) endState = endStateValue(run.endState, sources, composed);
      }

      const verdicts = await applyChecks(run.checks, {
        spec,
        mode: run.mode,
        blockIndex: position,
        block: planned.block,
        expect: planned.expect,
        given,
        observed,
        // A teacher-forced block is an independent sample: no earlier block of the run is its history.
        history: run.mode === 'T' ? [] : [...blocks],
        ledger: facts.ledger,
        endState,
        artifacts: run.artifacts,
        readArtifact: channel.readArtifact(),
      });
      // The stage reached: the runtime's, else the step classifier's. Before the block: in T the stage the
      // spec expects of the blocks before it, in F and P the stage the run's previous block reached.
      const previous =
        run.mode === 'T' && step.kind === 'block'
          ? canonicalPreviousStage(spec, step.blockIndex)
          : blocks.at(-1)?.stageObserved;
      const reading = readStage(spec, observed, {
        mode: run.mode,
        history: run.mode === 'T' ? [] : blocks,
        previous,
        signatures: run.signatures,
      });
      const flow = flowVerdicts(spec, planned.expect, reading, previous);
      const userMessages = [...given.prefix, ...user].filter((message) => message.role === 'user');
      const ledger = ledgerVerdicts(facts.ledger, observed, userMessages);
      const all = [...verdicts, ...flow, ...ledger.verdicts];
      const contradictions = [...facts.contradictions, ...ledger.contradictions.map(describeContradiction)];
      const block = {
        index: position,
        ...(planned.blockId !== undefined ? { blockId: planned.blockId } : {}),
        ...(planned.injected ? { injected: true } : {}),
        givenHash: given.hash,
        observed,
        verdicts: all,
        ...(reading !== undefined ? { stageObserved: reading.stage } : {}),
        ledgerCheck: { ok: contradictions.length === 0, contradictions },
        drift: driftOf(all),
        pass: all.every((verdict) => !verdict.gating || verdict.outcome === 'pass'),
      };
      blocks.push(block);
      run.onEvent?.({ type: 'block_end', index: position, pass: block.pass, at: new Date().toISOString() });
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
  const recovery =
    run.mode === 'P'
      ? recoveryOf(spec, { blocks, perturbationId: run.perturbationId }, run.recovery)
      : undefined;
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
    ...(endVerdict ? { endVerdict } : {}),
    ...(message ? { error: message } : {}),
    blocks,
    succession: succession(blocks),
    ...(recovery ? { recovery } : {}),
    ...(endState ? { endState } : {}),
    cost: blocks.reduce((sum, block) => sum + blockCost(block.observed), 0),
    latencyMs: blocks.reduce((sum, block) => sum + block.observed.latencyMs, 0),
    startedAt: run.startedAt,
    finishedAt: run.now().toISOString(),
    cacheHit: channel.replay,
  };
}

/**
 * The end state of a teacher-forced run after one more block: for each source, the value this block's
 * session read when it recorded one (not undefined, not null), else the value so far; for `*`, the lists
 * joined in block order.
 */
function composeStates(sources: string[], before: unknown[] | undefined, read: unknown[]): unknown[] {
  return sources.map((source, index) => {
    const earlier = before?.[index];
    const now = read[index];
    if (source === '*') {
      return [...(Array.isArray(earlier) ? earlier : []), ...(Array.isArray(now) ? now : [])];
    }
    return now === undefined || now === null ? earlier : now;
  });
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

/** The Observed with the block's retries added after any the adapter reported itself. */
function withRetries(observed: unknown, retries: RetryEvent[]): unknown {
  if (retries.length === 0 || observed === null || typeof observed !== 'object') return observed;
  const own = (observed as { retries?: unknown }).retries;
  return { ...observed, retries: [...(Array.isArray(own) ? own : []), ...retries] };
}

/** The block's cost: the total the adapter reported, or else the sum of its segments' costs. */
function blockCost(observed: Observed): number {
  if (observed.cost.usd !== undefined) return observed.cost.usd;
  return observed.segments.reduce((sum, segment) => sum + (segment.cost?.usd ?? 0), 0);
}

function liveChannel(run: RunContext): Channel {
  const { adapter } = run;
  const appendHistory = (current: Session, messages: Message[]) => {
    if (adapter.appendHistory) adapter.appendHistory(current, immutableHistorySource(messages));
    else current.history.push(...messages);
  };
  const notes: string[] = [];
  let session: Session | undefined;
  const call = <T>(what: string, attempt: () => Promise<T>) =>
    withRetry(what, attempt, run.retry, run.policy);
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
    reseat(prefix) {
      if (!session) return false;
      session.history = structuredClone([...prefix]);
      return true;
    },
    async observe(turn, user, key) {
      // Every retry of the block, the adapter's own model calls and the runner's, lands in its Observed.
      const { value: answer, retries } = await collectRetries(async () => {
        if (!session) session = await call(`open on block ${turn.index}`, () => adapter.open(turn.given));
        const current = session;
        appendHistory(current, structuredClone(user));
        let sent: unknown = await call(`send on block ${turn.index}`, () => adapter.send(current, turn));
        const trace = adapter.trace;
        if (run.capabilities.trace && trace) {
          sent = await call(`trace on block ${turn.index}`, () => trace.call(adapter, current, turn));
        }
        return { sent, current };
      });
      const current = answer.current;
      const observed: unknown = withRetries(answer.sent, retries);
      // Checked as JSON, the form the cache and the store keep: an undefined that JSON drops is a fault here.
      const parsed = Observed.safeParse(asJson(observed, turn.index));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new RunnerError(
          `the adapter's Observed for block ${turn.index} does not match the schema as JSON: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
        );
      }
      appendHistory(current, [assistantMessage(parsed.data)]);
      // The cache keeps the block without its retries: a replay retries nothing.
      const { retries: _spent, ...kept } = parsed.data;
      await remember(key, kept);
      return gateObserved(parsed.data, run.toolPolicy);
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

/** The block with its tool calls gated by the policy. Without a policy, the block as it is. */
function gateObserved(observed: Observed, toolPolicy: readonly ToolRule[] | undefined): Observed {
  if (!toolPolicy || toolPolicy.length === 0) return observed;
  return { ...observed, toolCalls: gateToolCalls(observed.toolCalls, toolPolicy) };
}

/**
 * A run that is partly in the cache: a block the cache holds is read back, and a block it does not hold goes to the live
 * channel. Once a block goes live, every later block does too, since the live session carries the history.
 */
function resumeChannel(
  cache: ObservedCache,
  live: Channel,
  toolPolicy: readonly ToolRule[] | undefined,
): Channel {
  // Set at the first block the cache does not hold. From then on the live session carries the run, so no later cached
  // block is read back: its recorded reply came from a session that no longer exists.
  let wentLive = false;
  return {
    replay: false,
    restart: () => live.restart(),
    reseat: (prefix) => live.reseat(prefix),
    async observe(turn, user, key) {
      if (!wentLive) {
        const hit = Observed.safeParse(await cache.cacheGet(key));
        if (hit.success) return gateObserved(hit.data, toolPolicy);
        wentLive = true;
      }
      return live.observe(turn, user, key);
    },
    async endState(sources, key) {
      if (wentLive) return live.endState(sources, key);
      const states: unknown[] = [];
      for (const source of sources) {
        const hit = await cache.cacheGet(endStateCacheKey(key, source));
        if (!hit) return live.endState(sources, key);
        states.push(unwrapEndState(hit));
      }
      return { kind: 'read', states };
    },
    readArtifact: live.readArtifact,
    close: () => live.close(),
  };
}

function replayChannel(cache: ObservedCache, toolPolicy: readonly ToolRule[] | undefined): Channel {
  return {
    replay: true,
    async restart() {},
    reseat: () => false,
    async observe(_turn, _user, key) {
      const parsed = Observed.safeParse(await cache.cacheGet(key));
      return parsed.success ? gateObserved(parsed.data, toolPolicy) : undefined;
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
