import {
  type Assertion,
  type Count,
  type Expect,
  type Given,
  isZero,
  type Message,
  type Observed,
  type PerturbationSpec,
  type Spec,
  type Stimulus,
  type WorldState,
} from '@agent-nexus/driftbench-core';
import { type AcmeAgent, createAcmeAgent } from '../../src/agent';
import { isForeign } from '../../src/parse';
import { type AcmeStore, createStore } from '../../src/store';

/**
 * A light stand-in for the Phase 1 runner, enough to prove the Acme specs and the Acme agent agree.
 * It drives a conversation spec in free-running mode (the agent's own replies form the history), or in
 * perturbed mode with one perturbation, and checks what can be checked without a model: tools (count,
 * input assertions, order), must and must_not, stage, guards, budget cost and latency, the rules, the end state
 * and the recovery. Criteria and ledgers are left to the judges of Phase 2 and 3.
 *
 * Perturbations: `user` or `burst` inserts a block before `inject_at`, checked against the
 * perturbation's `expect`. A perturbation with only `world` inserts nothing: its world applies from block
 * `inject_at` onwards and its `expect`, when given, replaces that block's. Worlds accumulate: spec, then
 * each block's `given.world` from that block onwards, then the perturbation's; for each tool, store key
 * and fixture, the later one wins. The end state is checked on unperturbed runs only.
 */

export type DrivenBlock = {
  index: number;
  label: string;
  injected: boolean;
  user: string[];
  observed: Observed;
  stage: string | undefined;
  failures: string[];
};

export type DrivenRun = { blocks: DrivenBlock[]; store: AcmeStore; failures: string[]; transcript: string };

export type DriveOptions = {
  perturbation?: PerturbationSpec;
  /** Wraps the agent, for example to break it on purpose and prove the checks can fail. */
  wrap?: (agent: AcmeAgent) => AcmeAgent;
};

type Planned = {
  label: string;
  injected: boolean;
  when: Stimulus;
  given?: Given;
  expect?: Expect;
  budget?: { cost_usd?: number; latency_ms?: number };
  world?: WorldState;
};

export async function driveSpec(spec: Spec, options: DriveOptions = {}): Promise<DrivenRun> {
  const store = createStore();
  const base = createAcmeAgent(store);
  const agent = options.wrap ? options.wrap(base) : base;
  const { planned, injectedAt } = plan(spec, options.perturbation);

  let world = mergeWorld({}, spec.given?.world);
  let history: Message[] = [];
  const blocks: DrivenBlock[] = [];
  for (const [index, block] of planned.entries()) {
    world = mergeWorld(mergeWorld(world, block.given?.world), block.world);
    if (block.given?.prefix) history = structuredClone(block.given.prefix);
    const user = messagesOf(block.when);
    history.push(...user.map((content): Message => ({ role: 'user', content })));
    const observed = await agent.respond(structuredClone(history), structuredClone(world));
    history.push(assistantMessage(observed));
    blocks.push({
      index,
      label: block.label,
      injected: block.injected,
      user,
      observed,
      stage: observed.runtime?.stages?.at(-1)?.name,
      failures: [...checkBlock(block.expect, observed), ...checkBudget(block.budget, observed)],
    });
  }

  const failures = [
    ...blocks.flatMap((block) => block.failures.map((failure) => `${block.label}: ${failure}`)),
    ...checkRules(spec, blocks),
    ...(options.perturbation
      ? checkRecovery(options.perturbation, blocks, injectedAt)
      : checkEndState(spec.end_state, store)),
  ];
  return { blocks, store, failures, transcript: render(blocks) };
}

function plan(spec: Spec, perturbation?: PerturbationSpec): { planned: Planned[]; injectedAt?: number } {
  const planned: Planned[] = spec.blocks.map((block, index) => ({
    label: `block ${index}${block.id ? ` (${block.id})` : ''}`,
    injected: 'injection' in block.when,
    when: block.when,
    given: block.given,
    expect: block.expect,
    budget: block.budget,
  }));
  if (!perturbation) return { planned };

  const at = perturbation.inject_at;
  const label = `perturbation ${perturbation.id} (${perturbation.class})`;
  if (perturbation.user !== undefined || perturbation.burst !== undefined) {
    const when: Stimulus = perturbation.burst
      ? { burst: perturbation.burst }
      : { user: perturbation.user ?? '' };
    planned.splice(at, 0, {
      label,
      injected: true,
      when,
      expect: perturbation.expect,
      world: perturbation.world,
    });
    return { planned, injectedAt: at };
  }
  const target = planned[at];
  if (target) {
    target.label = `${target.label} under ${label}`;
    target.injected = true;
    target.world = perturbation.world;
    if (perturbation.expect) target.expect = perturbation.expect;
  }
  return { planned, injectedAt: at };
}

function messagesOf(when: Stimulus): string[] {
  if ('user' in when) return [when.user];
  if ('burst' in when) return when.burst;
  return [when.injection.user];
}

/** The assistant message the history keeps: the reply, and each tool call with its result or error. */
export function assistantMessage(observed: Observed): Message {
  const toolCalls = observed.toolCalls.map((call) => {
    const recorded: Record<string, unknown> = { label: call.label, input: call.input };
    if (call.id !== undefined) recorded.id = call.id;
    if (call.error !== undefined) recorded.error = call.error;
    else recorded.output = call.output;
    return recorded;
  });
  return { role: 'assistant', content: observed.text, tool_calls: toolCalls } as Message;
}

function mergeWorld(base: WorldState, next: WorldState | undefined): WorldState {
  if (!next) return base;
  return {
    tools: { ...base.tools, ...next.tools },
    store: { ...base.store, ...next.store },
    fixtures: { ...base.fixtures, ...next.fixtures },
    ...((next.workspace ?? base.workspace) ? { workspace: next.workspace ?? base.workspace } : {}),
  };
}

/** The machine part of a block's Then: tools, tool order, must, must_not, stage, guards. */
export function checkBlock(expect: Expect | undefined, observed: Observed): string[] {
  if (!expect) return [];
  const failures: string[] = [];

  for (const tool of expect.tools ?? []) {
    const calls = observed.toolCalls.filter((call) => call.label === tool.label);
    if (!countAllows(tool.count, calls.length)) {
      failures.push(`tool ${tool.label}: expected ${showCount(tool.count)}, saw ${calls.length}`);
    }
    for (const [field, assertion] of Object.entries(tool.input ?? {})) {
      calls.forEach((call, n) => {
        const value = isRecord(call.input) ? call.input[field] : undefined;
        if (!matches(value, assertion)) {
          failures.push(
            `tool ${tool.label} call ${n + 1}: input.${field} is ${show(value)}, expected ${show(assertion)}`,
          );
        }
      });
    }
  }
  failures.push(...checkOrder(expect, observed));

  for (const pattern of expect.must ?? []) {
    if (!new RegExp(pattern, 'm').test(observed.text)) failures.push(`must /${pattern}/ is missing`);
  }
  for (const pattern of expect.must_not ?? []) {
    if (new RegExp(pattern, 'm').test(observed.text)) failures.push(`must_not /${pattern}/ is present`);
  }
  if (expect.stage !== undefined) {
    const stage = observed.runtime?.stages?.at(-1)?.name;
    if (stage !== expect.stage) failures.push(`stage: expected ${expect.stage}, saw ${stage ?? 'none'}`);
  }
  for (const guard of expect.guards ?? []) {
    const fired = (observed.runtime?.guards ?? []).filter(
      (event) =>
        event.name === guard.name && (guard.verdict === undefined || event.verdict === guard.verdict),
    );
    if (!countAllows(guard.count, fired.length)) {
      const verdict = guard.verdict ? ` with verdict ${guard.verdict}` : '';
      failures.push(`guard ${guard.name}${verdict}: expected ${showCount(guard.count)}, saw ${fired.length}`);
    }
  }
  return failures;
}

function checkOrder(expect: Expect, observed: Observed): string[] {
  const mode = expect.tool_order ?? 'any_order';
  if (mode === 'any_order') return [];
  const tools = (expect.tools ?? []).filter((tool) => !isZero(tool.count));
  const expected = tools.map((tool) => tool.label);
  if (mode === 'in_order') {
    const seen = unique(
      observed.toolCalls.map((call) => call.label).filter((label) => expected.includes(label)),
    );
    return same(seen, unique(expected)) ? [] : [`tool_order in_order: expected ${expected}, saw ${seen}`];
  }
  const expanded = tools.flatMap((tool) =>
    Array<string>(typeof tool.count === 'number' ? tool.count : 1).fill(tool.label),
  );
  const seen = observed.toolCalls.map((call) => call.label);
  return same(seen, expanded) ? [] : [`tool_order exact: expected ${expanded}, saw ${seen}`];
}

function checkBudget(budget: Planned['budget'], observed: Observed): string[] {
  const failures: string[] = [];
  const cost = observed.cost.usd ?? 0;
  if (budget?.cost_usd !== undefined && cost > budget.cost_usd) {
    failures.push(`budget: cost ${cost} USD is over ${budget.cost_usd}`);
  }
  if (budget?.latency_ms !== undefined && observed.latencyMs > budget.latency_ms) {
    failures.push(`budget: latency ${observed.latencyMs} ms is over ${budget.latency_ms}`);
  }
  return failures;
}

/**
 * The conversation rules: max_calls, forbidden_tools (a max of 0 forbids too), one_message_per_turn,
 * and lang_stable, read here as "no reply carries a word of another language", a stand-in for the
 * language detector of the checks package.
 */
function checkRules(spec: Spec, blocks: DrivenBlock[]): string[] {
  const rules = spec.rules;
  if (!rules) return [];
  const failures: string[] = [];
  const totals = new Map<string, number>();
  for (const block of blocks) {
    for (const call of block.observed.toolCalls) totals.set(call.label, (totals.get(call.label) ?? 0) + 1);
  }
  const forbidden = new Set(rules.forbidden_tools ?? []);
  for (const [label, max] of Object.entries(rules.max_calls ?? {})) {
    if (max === 0) forbidden.add(label);
    else if ((totals.get(label) ?? 0) > max) {
      failures.push(`rules.max_calls: ${label} ran ${totals.get(label)} times, at most ${max}`);
    }
  }
  for (const label of forbidden) {
    if (totals.get(label)) failures.push(`rules.forbidden_tools: ${label} ran ${totals.get(label)} times`);
  }
  for (const block of blocks) {
    const texts = block.observed.segments.filter((segment) => segment.type === 'text').length;
    if (rules.one_message_per_turn && texts !== 1) {
      failures.push(`${block.label}: rules.one_message_per_turn: ${texts} text segments`);
    }
    if (rules.lang_stable && isForeign(block.observed.text)) {
      failures.push(`${block.label}: rules.lang_stable: the reply leaves English`);
    }
  }
  return failures;
}

/** `end_state` against the payload log: `tool:<label>` reads the last payload that tool accepted. */
export function checkEndState(endState: Spec['end_state'], store: AcmeStore): string[] {
  if (endState === undefined) return [];
  if (endState === 'none') {
    return store.payloads.length === 0 ? [] : [`end_state none: ${store.payloads.length} payloads recorded`];
  }
  const failures: string[] = [];
  for (const expected of [endState].flat()) {
    const tool = /^tool:(.+)$/.exec(expected.source)?.[1];
    if (!tool) {
      failures.push(`end_state: source ${expected.source} is not tool:<label>`);
      continue;
    }
    const payload = store.payloads.filter((entry) => entry.tool === tool).at(-1);
    if (!payload) {
      failures.push(`end_state: ${tool} recorded no payload`);
      continue;
    }
    for (const [field, assertion] of Object.entries(expected.expect)) {
      if (!matches(payload.input[field], assertion)) {
        failures.push(
          `end_state ${tool}.${field} is ${show(payload.input[field])}, expected ${show(assertion)}`,
        );
      }
    }
    if (expected.mode === 'exact') {
      for (const field of Object.keys(payload.input)) {
        if (!(field in expected.expect)) failures.push(`end_state exact: ${tool}.${field} is not expected`);
      }
    }
  }
  return failures;
}

/** Within `within_blocks` blocks of the injection, counting it as 0, the run reaches `stage_after`. */
function checkRecovery(perturbation: PerturbationSpec, blocks: DrivenBlock[], injectedAt?: number): string[] {
  const recovery = perturbation.recovery;
  if (!recovery?.stage_after || injectedAt === undefined) return [];
  const window = blocks.slice(injectedAt, injectedAt + recovery.within_blocks + 1);
  if (window.some((block) => block.stage === recovery.stage_after)) return [];
  const seen = window.map((block) => block.stage ?? 'none').join(', ');
  return [
    `recovery: ${recovery.stage_after} not reached within ${recovery.within_blocks} blocks (saw ${seen})`,
  ];
}

/** One spec assertion against one value: a bare scalar is exact equality. */
export function matches(value: unknown, assertion: Assertion): boolean {
  if (assertion === null || typeof assertion !== 'object') return deepEqual(value, assertion);
  if ('exact' in assertion) return deepEqual(value, assertion.exact);
  if ('regex' in assertion) return typeof value === 'string' && new RegExp(assertion.regex, 'm').test(value);
  if ('contains' in assertion) {
    if (typeof value === 'string') return value.includes(assertion.contains);
    return Array.isArray(value) && value.some((item) => deepEqual(item, assertion.contains));
  }
  if ('one_of' in assertion) return assertion.one_of.some((option) => deepEqual(value, option));
  if ('nonempty' in assertion) return !isEmpty(value);
  if ('absent' in assertion) return value === undefined;
  return isRecord(value) && Object.entries(assertion.subset).every(([key, part]) => subset(value[key], part));
}

function subset(value: unknown, expected: unknown): boolean {
  if (isRecord(expected)) {
    return isRecord(value) && Object.entries(expected).every(([key, part]) => subset(value[key], part));
  }
  return deepEqual(value, expected);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a).filter((key) => a[key] !== undefined);
    const other = Object.keys(b).filter((key) => b[key] !== undefined);
    return keys.length === other.length && keys.every((key) => deepEqual(a[key], b[key]));
  }
  return Object.is(a, b);
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Object.keys(value).length === 0;
}

function countAllows(count: Count | undefined, seen: number): boolean {
  if (count === undefined) return seen >= 1;
  if (typeof count === 'number') return seen === count;
  return (count.min === undefined || seen >= count.min) && (count.max === undefined || seen <= count.max);
}

function showCount(count: Count | undefined): string {
  if (count === undefined) return 'at least 1';
  if (typeof count === 'number') return `exactly ${count}`;
  if (count.max === undefined) return `at least ${count.min ?? 0}`;
  return `${count.min ?? 0} to ${count.max}`;
}

function unique(labels: string[]): string[] {
  return [...new Set(labels)];
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function show(value: unknown): string {
  return value === undefined ? 'absent' : JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The run as text, for failure messages: user turns, tool calls, replies, stages. */
function render(blocks: DrivenBlock[]): string {
  return blocks
    .map((block) => {
      const tools = block.observed.toolCalls.map(
        (call) =>
          `    ${call.label} ${JSON.stringify(call.input)}${call.error ? ` failed: ${call.error}` : ''}`,
      );
      return [
        `${block.label}${block.injected ? ' [injected]' : ''}`,
        ...block.user.map((text) => `  user: ${text}`),
        ...tools,
        `  agent [${block.stage}]: ${block.observed.text}`,
        ...block.failures.map((failure) => `  FAIL ${failure}`),
      ].join('\n');
    })
    .join('\n');
}
