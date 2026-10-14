import { stage, tools } from '@agent-nexus/driftbench-checks';
import {
  AdapterTransportError,
  type AgentAdapter,
  type CheckContext,
  canonicalJson,
  contentHash,
  gateToolCalls,
  type Message,
  Observed,
  type ResolvedGiven,
  type Session,
  type TargetRef,
  type Turn,
  type WorldState,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

/**
 * The reference agent of the chat mode: the Acme Telecom sales assistant and its store. An adapter under the
 * suite reaches this agent through its own transport: behind a function, a local endpoint, a bridge. The
 * agent is bundled into this entry only; the package's main entry does not hold it.
 */
export {
  type AcmeAgent,
  type AcmeStore,
  createAcmeAgent,
  createStore,
} from '../../../examples/acme/src/index';

/**
 * The contract suite every adapter passes, shipped as `@agent-nexus/driftbench-adapters/contract`. It
 * registers vitest tests, so it runs inside a vitest test file; `vitest` and
 * `@agent-nexus/driftbench-checks` are the two optional peers it needs.
 *
 *     adapterContract('http', () => httpAdapter({ url }), { brokenTransport: () => httpAdapter({ url: dead }) });
 *     adapterContract('process', () => processAdapter(...), { brokenTransport, released, task: { ... } });
 *
 * `makeAdapter` builds an adapter, fresh for each test. The suite plays the runner, which owns
 * `session.history`: it appends the block's user message before `send` and the reply after it, so at send
 * time the history ends with the current user turn. What a capability rules out is skipped, never failed.
 *
 * Two modes, one suite. A chat adapter reaches the Acme Telecom agent (examples/acme), and the suite holds
 * the Acme chat with it, tool calls and end states included. An adapter that runs a code agent in a sandbox
 * (the `sandbox` capability) and cannot hold that chat names a `task` instead: the suite runs the generic
 * checks on the task's blocks and skips the Acme tool-call and end-state checks, saying why.
 *
 * What it holds an adapter to:
 * - Its id is the name given; every capability is a boolean; `trace`, `endState` and `readArtifact` exist
 *   when `trace`, `endState` and `sandbox` are declared. A task names a sandbox adapter.
 * - `open` returns a session of the adapter for the Given, whose history is a fresh array of the shared frozen prefix messages: the
 *   messages so far. `seedPrefix` says whether the agent itself sees them.
 * - `send` returns an Observed that validates against the schema: every tool call is a `tool_call` segment
 *   followed by its `tool_result` segment, `toolCalls` lists them in the same order with the same outputs and
 *   errors, `text` is the text segments joined by a newline, and `cost` and `latencyMs` are present.
 *   Chat: the turn is whole, the Acme agent's two tool calls and its reply all arrive. Task: the block's
 *   workspace diff and artifacts arrive, and `readArtifact` reads the produced file.
 * - `send` never appends to the history, and two sends on one session carry it forward.
 * - Chat, with `toolStubs`: an error forced in `world.tools` reaches the tool's `tool_result` segment.
 * - Chat, with `endState`: `tool:order.create` reads the last payload the order tool received, after the
 *   four blocks of an upgrade; a tool that received nothing reads undefined. Source `*` lists every payload
 *   in order as `{ tool, input }`: the order alone after the upgrade, an empty list when nothing was
 *   submitted.
 * - With `trace`, `trace` returns the same block under the same rules.
 * - `close` releases the session: a later `send` fails, and `released` (when given) confirms it.
 * - A transport failure throws AdapterTransportError, from `open` or from `send`.
 */

export type AdapterFactory = () => AgentAdapter | Promise<AgentAdapter>;

/** A task for an adapter that runs a code agent in a sandbox, in place of the Acme chat. */
export type ContractTask = {
  /** The workspace the agent starts in. */
  workspace: NonNullable<WorldState['workspace']>;
  /** The instruction of each block, in order. The first makes the agent write `produces`. */
  instructions: readonly [string, string, ...string[]];
  /** The file the first block creates, read back through `readArtifact`. */
  produces: string;
  /** How many history messages the agent says it received, read from its Observed. Proves the history reached it. */
  historySeen?: (observed: Observed) => number | undefined;
};

export type ContractOptions = {
  /**
   * An adapter of the same kind whose transport fails: an endpoint that refuses connections, a fetch that
   * throws, an agent command that is not there.
   */
  brokenTransport: AdapterFactory;
  /** The target the Givens carry. Default `{ adapter: <name> }`. */
  target?: TargetRef;
  /** Confirms that what a closed session held is released: the store dropped, the conversation deleted. */
  released?: (session: Session) => boolean | Promise<boolean>;
  /** For a sandbox adapter that cannot hold the Acme chat: the task its generic checks run. */
  task?: ContractTask;
  /** Milliseconds a test may take. Default 20000. */
  timeoutMs?: number;
};

/** The customer asks about an address the Acme agent covers: two tool calls, then a reply. */
export const COVERAGE_QUESTION = 'Hi, do you have home internet at 3 Orchard Way, Acmeville?';
/** The customer picks one of the two plans the reply offered. */
export const PLAN_CHOICE = 'Acme Fiber 300, please.';
/** Four blocks that end with `order.create` placing an upgrade. */
export const UPGRADE_CONVERSATION = [
  "Hi, I'm already an Acme customer and I keep running out of data on my phone.",
  "It's sam.rivera@example.com",
  'The unlimited one, please.',
  'Confirm',
];
export const UPGRADE_PAYLOAD = { type: 'upgrade', customer_id: 'cust-001', plan_id: 'mobile-l' };
const GREETING = "Hi, I'm the Acme Telecom sales assistant.";

/** Test callers play the runner: every message enters history deeply frozen. */
function frozenMessage<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) frozenMessage(child);
    Object.freeze(value);
  }
  return value;
}

/** A resolved Given for the Acme agent: no ledger, the world and the prefix given. */
export function acmeGiven(target: TargetRef, world: WorldState = {}, prefix: Message[] = []): ResolvedGiven {
  const given = { prefix, ledger: {}, world, vars: { channel: 'chat' }, target };
  return { ...given, hash: contentHash(given) };
}

/** One block: a user message sent under a Given. */
export function userTurn(index: number, text: string, given: ResolvedGiven): Turn {
  return { index, stimulus: { user: text }, given };
}

/** The reply the runner appends to the history: the text, and each tool call with its output or error. */
export function replyMessage(observed: Observed): Message {
  const toolCalls = observed.toolCalls.map((call) => {
    const recorded: Record<string, unknown> = { label: call.label, input: call.input ?? {} };
    if (call.id !== undefined) recorded.id = call.id;
    if (call.error !== undefined) recorded.error = call.error;
    else recorded.output = call.output ?? null;
    return recorded;
  });
  return frozenMessage({ role: 'assistant', content: observed.text, tool_calls: toolCalls } as Message);
}

/** Sends one user message the way the runner does: append it to the history, then send. */
export async function sendUser(
  adapter: AgentAdapter,
  session: Session,
  text: string,
  index: number,
  given: ResolvedGiven = session.given,
): Promise<Observed> {
  const message: Message = { role: 'user', content: text };
  session.history.push(message);
  const observed = await adapter.send(session, userTurn(index, text, given));
  expect(Object.isFrozen(message), 'send freezes messages supplied by direct callers').toBe(true);
  return observed;
}

/** One whole block the way the runner runs it: append the user message, send, append the reply. */
export async function converse(
  adapter: AgentAdapter,
  session: Session,
  text: string,
  index: number,
  given: ResolvedGiven = session.given,
): Promise<Observed> {
  const observed = await sendUser(adapter, session, text, index, given);
  session.history.push(replyMessage(observed));
  return observed;
}

/** The checks every Observed passes, whatever the adapter. */
export function expectWholeObserved(observed: Observed): void {
  const parsed = Observed.safeParse(observed);
  const issues = parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3));
  expect(parsed.success, `the Observed validates against the schema ${issues}`).toBe(true);

  const segments = observed.segments;
  const calls = segments.flatMap((segment, at) => (segment.type === 'tool_call' ? [{ segment, at }] : []));
  const resultCount = segments.filter((segment) => segment.type === 'tool_result').length;
  expect(calls.length, 'one tool_call segment per entry of toolCalls').toBe(observed.toolCalls.length);
  expect(resultCount, 'one tool_result segment per entry of toolCalls').toBe(observed.toolCalls.length);

  const answered = new Set<number>();
  calls.forEach(({ segment, at }, index) => {
    if (segment.type !== 'tool_call') return;
    const call = observed.toolCalls[index];
    expect(call?.label, `toolCalls[${index}] is the tool_call segment ${segment.label}`).toBe(segment.label);
    expect(canonicalJson(call?.input ?? {}), `toolCalls[${index}].input`).toBe(
      canonicalJson(segment.input ?? {}),
    );
    const resultAt = segments.findIndex(
      (other, position) =>
        position > at &&
        !answered.has(position) &&
        other.type === 'tool_result' &&
        other.label === segment.label &&
        (segment.id === undefined || other.id === undefined || other.id === segment.id),
    );
    expect(resultAt, `the tool_call ${segment.label} is followed by its tool_result`).toBeGreaterThan(at);
    answered.add(resultAt);
    const result = segments[resultAt];
    if (result?.type !== 'tool_result') return;
    expect(result.error, `the tool_result of ${segment.label} carries the call's error`).toBe(call?.error);
    if (call?.error === undefined) {
      expect(
        canonicalJson(result.output ?? null),
        `the tool_result of ${segment.label} carries its output`,
      ).toBe(canonicalJson(call?.output ?? null));
    }
  });

  const texts = segments.flatMap((segment) => (segment.type === 'text' ? [segment.text] : []));
  expect(observed.text, 'text is the text segments joined by a newline').toBe(texts.join('\n'));
  expect(typeof observed.cost, 'cost is present').toBe('object');
  expect(Number.isFinite(observed.latencyMs) && observed.latencyMs >= 0, 'latencyMs is present').toBe(true);
}

export function adapterContract(name: string, makeAdapter: AdapterFactory, options: ContractOptions): void {
  const target = options.target ?? { adapter: name };
  const timeout = options.timeoutMs ?? 20_000;
  const task = options.task;
  /** The Given of a block: the task's workspace in task mode, the bare Acme world otherwise. */
  const given = (world: WorldState = {}, prefix?: Message[]) =>
    acmeGiven(target, task ? { ...world, workspace: task.workspace } : world, prefix);
  const firstText = task?.instructions[0] ?? COVERAGE_QUESTION;
  const secondText = task?.instructions[1] ?? PLAN_CHOICE;
  const chatOnly = (skip: (note?: string) => never, why: string) => {
    if (task) skip(`task mode: ${name} runs a code agent in a sandbox, and ${why}`);
  };

  /** Runs a test against an open session and closes it afterwards, also when the test fails. */
  async function withSession<T>(
    test: (adapter: AgentAdapter, session: Session) => Promise<T>,
    start: ResolvedGiven = given(),
  ): Promise<T> {
    const adapter = await makeAdapter();
    const session = await adapter.open(start);
    try {
      return await test(adapter, session);
    } finally {
      await adapter.close(session);
    }
  }

  describe(`${name} adapter contract`, () => {
    it.each([
      ['hole', () => new Array(1)],
      ['undefined', () => [undefined]],
      ['null', () => [null]],
      ['primitive', () => ['text']],
      [
        'hole after a valid prefix',
        () => {
          const prefix = [{ role: 'user', content: 'valid' }];
          prefix.length = 2;
          return prefix;
        },
      ],
    ])('rejects a prefix containing %s', async (_name, make) => {
      const adapter = await makeAdapter();
      await expect(adapter.open({ ...given(), prefix: make() as Message[] })).rejects.toThrow(
        /history\[\d+\].*message object/,
      );
    });

    it('rejects a history index getter that switches the delivered message', async () => {
      const adapter = await makeAdapter();
      const checked: Message = { role: 'user', content: 'checked' };
      const delivered: Message = { role: 'user', content: 'delivered' };
      let reads = 0;
      const prefix = Object.defineProperty([], '0', {
        enumerable: true,
        get: () => (++reads === 1 ? checked : delivered),
      }) as Message[];
      await expect(adapter.open({ ...given(), prefix })).rejects.toThrow(/history.*0.*accessor/);
      expect(reads).toBe(0);
    });

    it('rejects sparse and accessor session arrays before sending', async () => {
      await withSession(async (adapter, session) => {
        session.history = new Array(1);
        await expect(adapter.send(session, userTurn(0, firstText, session.given))).rejects.toThrow(
          /history\[0\].*message object/,
        );
        let reads = 0;
        session.history = Object.defineProperty([], '0', {
          enumerable: true,
          get: () => {
            reads++;
            return { role: 'user', content: firstText };
          },
        });
        await expect(adapter.send(session, userTurn(0, firstText, session.given))).rejects.toThrow(
          /history.*0.*accessor/,
        );
        expect(reads).toBe(0);
      });
    });

    it('rejects a custom history iterator at open and send without running it', async () => {
      let iterations = 0;
      const prefix: Message[] = [{ role: 'user', content: 'checked' }];
      Object.defineProperty(prefix, Symbol.iterator, {
        value: function* () {
          iterations++;
          yield { role: 'user', content: 'unfrozen substitute' };
        },
      });
      const adapter = await makeAdapter();
      await expect(adapter.open({ ...given(), prefix })).rejects.toThrow(/history.*non-index property/);
      await withSession(async (opened, session) => {
        session.history = prefix;
        await expect(opened.send(session, userTurn(0, firstText, session.given))).rejects.toThrow(
          /history.*non-index property/,
        );
      });
      expect(iterations).toBe(0);
    });

    it('rejects accessor messages at open without reading the getter', async () => {
      const adapter = await makeAdapter();
      let reads = 0;
      const prefix: Message[] = [
        {
          role: 'user',
          get content() {
            reads++;
            return 'before';
          },
        },
      ];
      await expect(adapter.open({ ...given(), prefix })).rejects.toThrow(/content.*accessor/);
      expect(reads).toBe(0);
    });

    it('names itself and declares every capability', async () => {
      const adapter = await makeAdapter();
      expect(adapter.id).toBe(name);
      expect(adapter.version).toMatch(/\S/);
      const capabilities = adapter.capabilities();
      for (const key of [
        'variants',
        'seedPrefix',
        'toolStubs',
        'trace',
        'sandbox',
        'endState',
        'deterministic',
      ]) {
        expect(typeof capabilities[key as keyof typeof capabilities], `capability ${key}`).toBe('boolean');
      }
      expect(typeof adapter.trace === 'function' || !capabilities.trace, 'trace exists when declared').toBe(
        true,
      );
      expect(
        typeof adapter.endState === 'function' || !capabilities.endState,
        'endState exists when declared',
      ).toBe(true);
      expect(
        typeof adapter.readArtifact === 'function' || !capabilities.sandbox,
        'readArtifact exists when the adapter owns a workspace',
      ).toBe(true);
      if (task)
        expect(capabilities.sandbox, 'a task names an adapter that runs its agent in a sandbox').toBe(true);
    });

    it(
      'opens a session for the Given, with shared frozen prefix messages in its own array',
      async () => {
        const prefix: Message[] = task
          ? [
              { role: 'user', content: 'An earlier instruction.' },
              { role: 'assistant', content: 'An earlier reply.' },
            ]
          : [
              { role: 'user', content: COVERAGE_QUESTION },
              { role: 'assistant', content: 'We cover 3 Orchard Way. Which plan would you like?' },
            ];
        const start = given({}, prefix);
        const adapter = await makeAdapter();
        const opening = adapter.open(start);
        const frozenOnEntry = Object.isFrozen(prefix[0]);
        const session = await opening;
        try {
          expect(frozenOnEntry, 'freezes before yielding to caller code').toBe(true);
          expect(session.adapter).toBe(name);
          expect(session.id).toMatch(/\S/);
          expect(session.target).toEqual(target);
          expect(session.given).toEqual(start);
          expect(session.history, 'the messages so far, the prefix included').toEqual(prefix);
          expect(session.history).not.toBe(start.prefix);
          for (const [index, message] of session.history.entries()) {
            expect(message).toBe(start.prefix[index]);
            expect(() => {
              message.content = 'changed';
            }).toThrow(TypeError);
          }
          session.history.push({ role: 'user', content: 'one more' });
          expect(start.prefix, 'the array is a copy: the Given stays as it was').toHaveLength(2);
        } finally {
          await adapter.close(session);
        }
      },
      timeout,
    );

    it(
      'sends a block and returns the whole turn: every segment and tool call, the text, cost and latency',
      async ({ skip }) => {
        chatOnly(skip, 'the Acme chat and its tool calls do not apply');
        await withSession(async (adapter, session) => {
          const observed = await sendUser(adapter, session, COVERAGE_QUESTION, 0);
          expectWholeObserved(observed);
          expect(observed.toolCalls.map((call) => call.label)).toEqual(['coverage.check', 'catalog.search']);
          expect(observed.toolCalls[0]?.output).toMatchObject({ found: true, address_id: 'addr-102' });
          expect(observed.text).toContain('3 Orchard Way, Acmeville has fiber up to 300 Mbps');
        });
      },
      timeout,
    );

    it(
      'keeps tool inputs observable by the optional closed-input check',
      async ({ skip }) => {
        chatOnly(skip, 'the task protocol has no tool calls');
        await withSession(async (adapter, session) => {
          const observed = await sendUser(adapter, session, COVERAGE_QUESTION, 0);
          const block = {
            when: { user: COVERAGE_QUESTION },
            expect: {
              tools: [
                {
                  label: 'coverage.check',
                  input: { address: '3 Orchard Way, Acmeville' },
                  input_closed: true,
                },
              ],
            },
          };
          const ctx: CheckContext = {
            spec: { id: 'optional-observations', kind: 'conversation', blocks: [block] },
            mode: 'F',
            blockIndex: 0,
            block,
            expect: block.expect,
            given: session.given,
            observed,
            history: [],
            ledger: {},
          };
          expect((await tools.evaluate(ctx)).every((verdict) => verdict.outcome === 'pass')).toBe(true);
          const mutated = structuredClone(observed);
          const call = mutated.toolCalls.find((entry) => entry.label === 'coverage.check');
          if (!call) throw new Error('the contract fixture omitted coverage.check');
          call.input = { ...(call.input as Record<string, unknown>), extra: 'unapproved' };
          expect(await tools.evaluate({ ...ctx, observed: mutated })).toContainEqual(
            expect.objectContaining({
              id: 'tools.coverage.check.input_closed',
              outcome: 'fail',
              gating: true,
            }),
          );
        });
      },
      timeout,
    );

    it(
      'uses only this block runtime events for the optional stage-reported check',
      async () => {
        await withSession(async (adapter, session) => {
          const observed = await sendUser(adapter, session, firstText, 0);
          const block = { when: { user: firstText }, expect: { stage_reported: true } };
          const ctx: CheckContext = {
            spec: { id: 'optional-stage-report', kind: 'conversation', blocks: [block] },
            mode: 'F',
            blockIndex: 0,
            block,
            expect: block.expect,
            given: session.given,
            observed,
            history: [],
            ledger: {},
          };
          const reported = (observed.runtime?.stages ?? []).some((entry) => entry.name.trim() !== '');
          expect(await stage.evaluate(ctx)).toContainEqual(
            expect.objectContaining({
              id: 'stage.reported',
              outcome: reported ? 'pass' : 'fail',
              gating: true,
            }),
          );
          const removed = structuredClone(observed);
          if (removed.runtime) delete removed.runtime.stages;
          expect(await stage.evaluate({ ...ctx, observed: removed })).toContainEqual(
            expect.objectContaining({
              id: 'stage.reported',
              outcome: 'fail',
              gating: true,
            }),
          );
        });
      },
      timeout,
    );

    it(
      'its recorded tool calls can be gated: a deny on one tool marks exactly its calls and keeps the others',
      async ({ skip }) => {
        chatOnly(skip, 'the Acme chat and its tool calls do not apply');
        await withSession(async (adapter, session) => {
          const observed = await sendUser(adapter, session, COVERAGE_QUESTION, 0);
          const gated = gateToolCalls(observed.toolCalls, [{ pattern: 'coverage.check', action: 'deny' }]);
          expect(gated.map((call) => call.label)).toEqual(observed.toolCalls.map((call) => call.label));
          const denied = gated.filter((call) => call.label === 'coverage.check');
          expect(denied.length).toBeGreaterThan(0);
          for (const call of denied) {
            expect(call.error).toBe('denied by tool policy rule coverage.check');
            expect(call.output).toBeUndefined();
          }
          for (const call of gated.filter((call) => call.label !== 'coverage.check')) {
            expect(call.error).toBeUndefined();
          }
        });
      },
      timeout,
    );

    it(
      'sends a task block and returns its workspace diff and artifacts, and reads the produced file back',
      async ({ skip }) => {
        if (!task) return skip('chat mode: no task is named, and the whole-turn test checks the Acme chat');
        await withSession(async (adapter, session) => {
          const observed = await sendUser(adapter, session, task.instructions[0], 0);
          expectWholeObserved(observed);
          expect(observed.workspaceDiff, 'the workspace diff of the block').toBeDefined();
          expect(observed.workspaceDiff?.created).toContain(task.produces);
          const artifact = observed.artifacts?.find((entry) => entry.path === task.produces);
          expect(artifact, `${task.produces} is an artifact of the block`).toBeDefined();
          const bytes = await adapter.readArtifact?.(session, task.produces);
          expect(bytes?.byteLength ?? 0, `readArtifact reads ${task.produces}`).toBeGreaterThan(0);
          if (artifact?.bytes !== undefined) expect(bytes?.byteLength).toBe(artifact.bytes);
        });
      },
      timeout,
    );

    it(
      'never appends to the history, and carries it forward over two sends',
      async () => {
        await withSession(async (adapter, session) => {
          session.history.push(frozenMessage({ role: 'user', content: firstText }));
          const before = structuredClone(session.history);
          const first = await adapter.send(session, userTurn(0, firstText, session.given));
          expect(session.history, 'send never appends to the history').toEqual(before);
          expectWholeObserved(first);
          session.history.push(replyMessage(first));

          const handed = session.history.length + 1;
          const second = await converse(adapter, session, secondText, 1);
          expectWholeObserved(second);
          if (task) {
            if (task.historySeen) {
              expect(task.historySeen(first), 'the agent received the history of the first block').toBe(
                before.length,
              );
              expect(task.historySeen(second), 'the agent received the history of the second block').toBe(
                handed,
              );
            }
            return;
          }
          expect(first.text.startsWith(GREETING)).toBe(true);
          expect(second.text.startsWith(GREETING), 'the agent knows it already greeted').toBe(false);
          expect(second.text).toContain('Acme Fiber 300');
          expect(
            second.toolCalls.map((call) => call.label),
            'no tool runs again for the earlier block',
          ).toEqual([]);
        });
      },
      timeout,
    );

    it(
      'delivers a tool error forced in world.tools to the tool_result segment, when it honours tool stubs',
      async ({ skip }) => {
        chatOnly(skip, 'its agent calls no Acme tool to force an error on');
        const adapter = await makeAdapter();
        if (!adapter.capabilities().toolStubs) skip('no toolStubs capability');
        const world: WorldState = { tools: { 'coverage.check': { error: 'coverage service unavailable' } } };
        const start = given(world);
        const session = await adapter.open(start);
        try {
          const observed = await sendUser(adapter, session, COVERAGE_QUESTION, 0, start);
          expectWholeObserved(observed);
          const results = observed.segments.filter(
            (segment) => segment.type === 'tool_result' && segment.label === 'coverage.check',
          );
          expect(results.length).toBeGreaterThan(0);
          for (const result of results) {
            expect(result.type === 'tool_result' && result.error).toBe('coverage service unavailable');
          }
          expect(observed.toolCalls.filter((call) => call.label === 'coverage.check')[0]?.error).toBe(
            'coverage service unavailable',
          );
          expect(observed.toolCalls.map((call) => call.label)).not.toContain('catalog.search');
        } finally {
          await adapter.close(session);
        }
      },
      timeout,
    );

    it(
      'reads the last payload order.create received through endState, when it reads end states',
      async ({ skip }) => {
        chatOnly(skip, 'the end-state checks read the Acme order flow it does not hold');
        const adapter = await makeAdapter();
        if (!adapter.capabilities().endState || !adapter.endState) skip('no endState capability');
        const session = await adapter.open(given());
        try {
          for (const [index, text] of UPGRADE_CONVERSATION.entries()) {
            expectWholeObserved(await converse(adapter, session, text, index));
          }
          expect(await adapter.endState?.(session, 'tool:order.create')).toEqual(UPGRADE_PAYLOAD);
          expect(await adapter.endState?.(session, 'tool:notify_sales')).toBeUndefined();
          expect(await adapter.endState?.(session, '*'), 'source * lists every payload, in order').toEqual([
            { tool: 'order.create', input: UPGRADE_PAYLOAD },
          ]);
        } finally {
          await adapter.close(session);
        }
      },
      timeout,
    );

    it(
      'lists no payload for source * when the conversation submitted nothing, when it reads end states',
      async ({ skip }) => {
        chatOnly(skip, 'the end-state checks read the Acme order flow it does not hold');
        const adapter = await makeAdapter();
        if (!adapter.capabilities().endState || !adapter.endState) skip('no endState capability');
        const session = await adapter.open(given());
        try {
          expect(await adapter.endState?.(session, '*'), 'nothing before the first block').toEqual([]);
          await converse(adapter, session, COVERAGE_QUESTION, 0);
          await converse(adapter, session, PLAN_CHOICE, 1);
          expect(await adapter.endState?.(session, '*'), 'two blocks that place no order').toEqual([]);
        } finally {
          await adapter.close(session);
        }
      },
      timeout,
    );

    it(
      'traces the last block under the same rules, when it offers a trace',
      async ({ skip }) => {
        const adapter = await makeAdapter();
        if (!adapter.capabilities().trace || !adapter.trace) skip('no trace capability');
        const session = await adapter.open(given());
        try {
          const sent = await sendUser(adapter, session, firstText, 0);
          const traced = await adapter.trace?.(session, userTurn(0, firstText, session.given));
          if (!traced) throw new Error('trace returned nothing');
          expectWholeObserved(traced);
          expect(traced.toolCalls.map((call) => call.label)).toEqual(
            sent.toolCalls.map((call) => call.label),
          );
          expect(traced.text).toContain(sent.text);
        } finally {
          await adapter.close(session);
        }
      },
      timeout,
    );

    it(
      'releases the session on close',
      async () => {
        const adapter = await makeAdapter();
        const session = await adapter.open(given());
        await converse(adapter, session, firstText, 0);
        await adapter.close(session);
        if (options.released) expect(await options.released(session), 'released').toBe(true);
        await expect(sendUser(adapter, session, secondText, 1)).rejects.toThrow();
      },
      timeout,
    );

    it(
      'throws AdapterTransportError when the transport fails',
      async () => {
        const adapter = await options.brokenTransport();
        expect(adapter.id).toBe(name);
        let session: Session;
        try {
          session = await adapter.open(given());
        } catch (error) {
          expect(error).toBeInstanceOf(AdapterTransportError);
          return;
        }
        await expect(sendUser(adapter, session, firstText, 0)).rejects.toBeInstanceOf(AdapterTransportError);
        // close is always called, also after a failure: it resolves, or reports the same broken transport.
        await adapter
          .close(session)
          .catch((error: unknown) => expect(error).toBeInstanceOf(AdapterTransportError));
      },
      timeout,
    );
  });
}
