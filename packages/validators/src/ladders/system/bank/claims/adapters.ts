import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type * as Sqlite from 'node:sqlite';
import {
  functionAdapter,
  HTTP_ADAPTER_VERSION,
  httpAdapter,
  processAdapter,
} from '@agent-nexus/driftbench-adapters';
import {
  AdapterTransportError,
  type AgentAdapter,
  AgentFailure,
  type Campaign,
  canonicalJson,
  contentHash,
  type Message,
  type Observed,
  type ResolvedGiven,
  type RunResult,
  runSpec,
  type Session,
  type Stimulus,
  type TargetRef,
  type Turn,
  validateSpec,
  type WorldState,
} from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import {
  BLOCK_METRIC,
  openStore,
  SCHEMA_VERSION,
  type SqliteStore,
  StoreError,
} from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { type BankItem, expectAll, fail, type ItemContext, type ItemResult, PASS, type Tier } from '../types';
import { behavioursFor, plantedFlow, runScenario } from '../world';

// Loaded at call time from the running Node.js: a bundler would turn a static import of node:sqlite into a
// package named sqlite, which does not exist.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof Sqlite;

/**
 * Executable claims on two subjects.
 *
 * claim-adapters: the function, http and process adapters against docs/adapters/function.md, http.md,
 * process.md and index.md: capabilities, request and response shapes, which errors are transport errors and
 * which are agent failures, end-state reads, timeouts, tool rounds, the process protocol and its sandbox. The
 * http items drive the adapter through an injected fetch; the process items run a small node script written
 * into the item's scratch folder, in a local sandbox.
 *
 * store-stress: the store (docs/running.md "The store", packages/store/src/errors.ts) under concurrency and
 * corruption: two handles and two processes on one SQLite file, a crash in the middle of a write, truncated
 * and foreign files, rows edited by hand, schema versions, a closed store, damaged bundles, ids with path
 * characters, a very large run and many campaigns.
 */

const FN = 'packages/adapters/src/function/index.ts';
const HTTP = 'packages/adapters/src/http/index.ts';
const HTTP_CHAT = 'packages/adapters/src/http/chat.ts';
const TRANSPORT = 'packages/adapters/src/shared/transport.ts';
const PROC = 'packages/adapters/src/process/index.ts';
const PROTOCOL = 'packages/adapters/src/process/protocol.ts';
const RUN = 'packages/sandbox/src/run.ts';
const WALK = 'packages/sandbox/src/walk.ts';
const FOLDER = 'packages/sandbox/src/folder.ts';
const LOCAL = 'packages/sandbox/src/local.ts';
const STORE = 'packages/store/src/store.ts';
const BUNDLE = 'packages/store/src/bundle.ts';

const ADAPTERS_FAMILY = 'claim-adapters';
const STORE_FAMILY = 'store-stress';

type Spec = {
  slug: string;
  tier: Tier;
  level: number;
  component: string;
  source: BankItem['source'];
  title: string;
  cause: string;
  check: BankItem['check'];
};

function adapterItem(spec: Spec): BankItem {
  return { id: `claim/adapters/${spec.slug}`, family: ADAPTERS_FAMILY, ...without(spec) };
}

/**
 * The newer schema versions a refusal item writes: the version the seed draws above the current one (as the item
 * always did, never replaced), and the next version, added on every seed.
 */
export function newerSchemas(seed: number): number[] {
  return [...new Set([SCHEMA_VERSION + 1 + (seed % 4), SCHEMA_VERSION + 1])];
}

/**
 * The store schema that brought the block verdicts not_run and blocked: a floor, never a fixed number. A store
 * that holds one must be stamped at least this, so a driftbench older than the verdicts refuses it.
 */
const VERDICT_SCHEMA = 3;

function storeItem(spec: Spec): BankItem {
  return { id: `claim/adapters/store-${spec.slug}`, family: STORE_FAMILY, ...without(spec) };
}

function without(spec: Spec): Omit<BankItem, 'id' | 'family'> {
  const { slug: _slug, ...rest } = spec;
  return rest;
}

/* ------------------------------------------------------------------------------------------------ */
/* Shared helpers                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

/** A fresh folder of one item and seed under the run's scratch folder. */
function folderFor(ctx: ItemContext, tag: string): string {
  const dir = join(ctx.scratch, 'claims-adapters', `${tag}-${ctx.seed}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

async function caught(work: Promise<unknown> | (() => Promise<unknown>)): Promise<unknown> {
  try {
    await (typeof work === 'function' ? work() : work);
    return undefined;
  } catch (error) {
    return error ?? new Error('a falsy value was thrown');
  }
}

/** What an error is, as the docs classify errors. */
function kindOf(error: unknown): string {
  if (error === undefined) return 'no error';
  if (error instanceof AdapterTransportError) return 'AdapterTransportError';
  if (error instanceof AgentFailure) return 'AgentFailure';
  if (error instanceof StoreError) return `StoreError ${error.code}`;
  const e = error as Error;
  return `${e?.name ?? typeof error}: ${String(e?.message ?? error).slice(0, 200)}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const show = (value: unknown, size = 300): string => {
  const text = value === undefined ? 'undefined' : JSON.stringify(value);
  return text.length > size ? `${text.slice(0, size)}...` : text;
};

const TARGET: TargetRef = { adapter: 'function', agent: 'bank-agent' };

function givenOf(over: Partial<ResolvedGiven> = {}): ResolvedGiven {
  return {
    prefix: [],
    ledger: { email: 'ana@example.org' },
    world: {},
    vars: { channel: 'chat' },
    target: TARGET,
    hash: 'g-bank-claims',
    ...over,
  };
}

function stimulusMessages(stimulus: Stimulus): Message[] {
  if ('user' in stimulus) return [{ role: 'user', content: stimulus.user }];
  if ('burst' in stimulus) return stimulus.burst.map((content): Message => ({ role: 'user', content }));
  return [{ role: 'user', content: stimulus.injection.user }];
}

/** Plays the runner: appends the block's user messages, sends, appends the reply. */
async function play(
  adapter: AgentAdapter,
  session: Session,
  stimulus: Stimulus | string,
  extra: { index?: number; world?: WorldState; vars?: Record<string, unknown>; budget?: Turn['budget'] } = {},
): Promise<Observed> {
  const stim: Stimulus = typeof stimulus === 'string' ? { user: stimulus } : stimulus;
  for (const message of stimulusMessages(stim)) session.history.push(message);
  const turn: Turn = {
    index: extra.index ?? session.history.filter((m) => m.role === 'user').length - 1,
    stimulus: stim,
    given: {
      ...session.given,
      world: extra.world ?? session.given.world,
      vars: extra.vars ?? session.given.vars,
    },
    ...(extra.budget ? { budget: extra.budget } : {}),
  };
  const observed = await adapter.send(session, turn);
  session.history.push({ role: 'assistant', content: observed.text });
  return observed;
}

function textObserved(text: string): Observed {
  return { segments: [{ type: 'text', text }], text, toolCalls: [], cost: {}, latencyMs: 1 };
}

const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');

/* ------------------------------------------------------------------------------------------------ */
/* claim-adapters: function                                                                           */
/* ------------------------------------------------------------------------------------------------ */

function functionItems(): BankItem[] {
  const out: BankItem[] = [];
  const code = (seed: number) => `R-${String(1000 + (seed % 9000)).padStart(4, '0')}`;

  out.push(
    adapterItem({
      slug: 'function/capabilities-default',
      tier: 1,
      level: 3,
      component: FN,
      source: 'contract',
      title:
        'function.md "Capabilities": seedPrefix and toolStubs on; variants, trace, sandbox off; endState off without payloads; deterministic false by default',
      cause: 'functionAdapter declares its default capabilities as the function page documents',
      async check() {
        const caps = functionAdapter({ respond: () => textObserved('x') }).capabilities();
        const want = {
          variants: false,
          seedPrefix: true,
          toolStubs: true,
          trace: false,
          sandbox: false,
          endState: false,
          deterministic: false,
        };
        return same(caps, want) ? PASS : fail(`expected capabilities ${show(want)}, got ${show(caps)}`);
      },
    }),
    adapterItem({
      slug: 'function/capabilities-declared',
      tier: 1,
      level: 3,
      component: FN,
      source: 'contract',
      title:
        'function.md "Capabilities": endState is on when payloads is given, deterministic is as declared, and version is the one given',
      cause:
        'functionAdapter turns endState on with a payload log and carries the declared deterministic flag and version',
      async check({ seed }) {
        const version = `bank-v${seed}`;
        const adapter = functionAdapter({
          respond: () => textObserved('x'),
          payloads: () => [],
          deterministic: true,
          version,
        });
        const caps = adapter.capabilities();
        return expectAll([
          [caps.endState === true, `expected endState true with payloads, got ${caps.endState}`],
          [caps.deterministic === true, `expected deterministic true as declared, got ${caps.deterministic}`],
          [adapter.version === version, `expected version ${version}, got ${adapter.version}`],
          [adapter.id === 'function', `expected id function, got ${adapter.id}`],
        ]);
      },
    }),
    adapterItem({
      slug: 'function/open-history-copy',
      tier: 1,
      level: 3,
      component: FN,
      source: 'contract',
      title:
        'function.md "What the agent receives": open preserves the prefix and rejects writes into handed-over messages without changing history or Given',
      cause: 'functionAdapter.open protects handed-over messages from caller writes',
      async check({ seed }) {
        // Deliberately unfrozen: direct callers receive the same protection as the runner.
        const prefix: Message[] = [
          { role: 'user', content: `Earlier question ${code(seed)}` },
          { role: 'assistant', content: 'Earlier answer' },
        ];
        const given = givenOf({ prefix });
        const prefixBefore = JSON.stringify(prefix);
        const givenBefore = JSON.stringify(given);
        const adapter = functionAdapter({ respond: () => textObserved('x') });
        const session = await adapter.open(given);
        try {
          const historyBefore = JSON.stringify(session.history);
          const callerError = await caught(async () => {
            (prefix[0] as Message).content = 'changed after open';
          });
          const sessionError = await caught(async () => {
            (session.history[1] as Message).content = 'changed through session';
          });
          return expectAll([
            [session.adapter === 'function', `expected session.adapter function, got ${session.adapter}`],
            [
              same(session.target, TARGET),
              `expected the target ${show(TARGET)}, got ${show(session.target)}`,
            ],
            [
              session.given === given || same(session.given, given),
              'expected the session to carry the Given',
            ],
            [
              historyBefore === prefixBefore,
              `expected history to equal the prefix at open, got ${historyBefore}`,
            ],
            [
              JSON.stringify(session.history) === historyBefore,
              'a caller write changed session history bytes',
            ],
            [JSON.stringify(given) === givenBefore, 'a caller write changed Given bytes'],
            [
              callerError instanceof TypeError,
              `expected a caller message write to throw TypeError, got ${kindOf(callerError)}`,
            ],
            [
              sessionError instanceof TypeError,
              `expected a session message write to throw TypeError, got ${kindOf(sessionError)}`,
            ],
          ]);
        } finally {
          await adapter.close(session);
        }
      },
    }),
    adapterItem({
      slug: 'function/receives-history',
      tier: 1,
      level: 3,
      component: FN,
      source: 'contract',
      title:
        'function.md "What the agent receives": messages is the session history ending with the block user message, prefix included',
      cause: 'functionAdapter.send hands the agent the whole session history',
      async check({ seed }) {
        const prefix: Message[] = [
          { role: 'user', content: `Earlier ${code(seed)}` },
          { role: 'assistant', content: 'Earlier answer' },
        ];
        let received: Message[] = [];
        const adapter = functionAdapter({
          respond: (messages) => {
            received = messages;
            return textObserved('ok');
          },
        });
        const session = await adapter.open(givenOf({ prefix }));
        await play(adapter, session, `Now ${code(seed + 1)}`);
        const want = [...prefix, { role: 'user', content: `Now ${code(seed + 1)}` }];
        return same(received, want)
          ? PASS
          : fail(`expected the agent to receive ${show(want)}, got ${show(received)}`);
      },
    }),
    adapterItem({
      slug: 'function/world-vars-state',
      tier: 1,
      level: 3,
      component: FN,
      source: 'contract',
      title:
        'function.md "What the agent receives": world and vars are the block resolved world and variables, so world.tools reaches the agent',
      cause: 'functionAdapter.send passes the turn world and vars to the agent',
      async check({ seed }) {
        const world: WorldState = { tools: { 'records.lookup': { result: { code: code(seed) } } } };
        const vars = { channel: 'email', seed };
        let got: unknown[] = [];
        const adapter = functionAdapter({
          respond: (_m, w, v) => {
            got = [w, v];
            return textObserved('ok');
          },
        });
        const session = await adapter.open(givenOf());
        await play(adapter, session, 'hello', { world, vars });
        return same(got, [world, vars])
          ? PASS
          : fail(`expected the agent to receive world and vars ${show([world, vars])}, got ${show(got)}`);
      },
    }),
    adapterItem({
      slug: 'function/args-are-copies',
      tier: 2,
      level: 3,
      component: FN,
      source: 'adversarial',
      title:
        'function.md "What the agent receives": message writes fail loudly, history and Given stay byte-identical, and each turn receives private arrays, world and vars',
      cause: 'functionAdapter.send protects message contents and isolates each turn from agent writes',
      async check({ seed }) {
        const given = givenOf({
          prefix: [
            {
              role: 'assistant',
              content: 'Earlier call',
              tool_calls: [{ label: 'records.lookup', input: { code: code(seed) } }],
            },
          ],
          world: { fixtures: { code: code(seed) } },
          vars: { preferences: { channel: 'chat' } },
        });
        const views: string[] = [];
        const inputs: string[] = [];
        const arrays: Message[][] = [];
        const reachedMessageWrite: boolean[] = [];
        let attempt = 0;
        const adapter = functionAdapter({
          respond: (messages, world, vars) => {
            views.push(JSON.stringify(messages));
            inputs.push(JSON.stringify([world, vars]));
            arrays.push(messages);
            const newest = messages.at(-1) as Message;
            const earlier = messages[0] as Message;
            // These writes must succeed on private per-turn containers, even when the
            // following message write aborts the turn. Nested values must be private too.
            messages.push({ role: 'assistant', content: 'smuggled' });
            messages[0] = { role: 'user', content: 'replaced only in the agent array' };
            (world.fixtures as Record<string, unknown>).code = 'R-0000';
            (vars.preferences as Record<string, unknown>).channel = 'hijacked';
            const calls = earlier.tool_calls;
            if (!calls?.[0]) throw new Error('the agent did not receive the planted tool call');
            reachedMessageWrite[attempt] = true;
            if (attempt === 0) newest.content = 'rewritten';
            else if (attempt === 1) {
              (calls[0].input as Record<string, unknown>).code = 'rewritten nested input';
            } else calls.push({ label: 'smuggled' });
            return textObserved('ok');
          },
        });
        const session = await adapter.open(given);
        const givenBefore = JSON.stringify(given);
        const inputsBefore = JSON.stringify([given.world, given.vars]);
        const checks: Array<readonly [boolean, string]> = [];
        try {
          for (attempt = 0; attempt < 3; attempt += 1) {
            const user = `Hi ${code(seed)} turn ${attempt}`;
            // No runner and no fixture freeze: send must protect a directly appended message.
            session.history.push({ role: 'user', content: user });
            const historyBefore = JSON.stringify(session.history);
            const retainedBefore = arrays.map((messages) => JSON.stringify(messages));
            const error = await caught(adapter.send(session, { index: attempt, stimulus: { user }, given }));
            checks.push(
              [
                JSON.stringify(session.history) === historyBefore,
                `turn ${attempt}: an agent write changed history bytes`,
              ],
              [JSON.stringify(given) === givenBefore, `turn ${attempt}: an agent write changed Given bytes`],
              [
                views[attempt] === historyBefore,
                `turn ${attempt}: a prior turn changed the next history view`,
              ],
              [inputs[attempt] === inputsBefore, `turn ${attempt}: a prior turn changed world or vars`],
              [
                reachedMessageWrite[attempt] === true,
                `turn ${attempt}: private array, world or vars writes were blocked`,
              ],
              [
                error instanceof AgentFailure && error.cause instanceof TypeError,
                `turn ${attempt}: expected AgentFailure caused by TypeError for the message write, got ${kindOf(error)}`,
              ],
              [
                retainedBefore.every((before, i) => JSON.stringify(arrays[i]) === before),
                `turn ${attempt}: a later turn changed an earlier agent array`,
              ],
            );
          }
          return expectAll(checks);
        } finally {
          await adapter.close(session);
        }
      },
    }),
    adapterItem({
      slug: 'function/create-per-session',
      tier: 1,
      level: 3,
      component: FN,
      source: 'contract',
      title:
        'function.md "Options": create builds the state of one session from its resolved Given, so nothing leaks between conversations',
      cause: 'functionAdapter.open builds one state per session with create(given)',
      async check({ seed }) {
        const seen: string[] = [];
        const adapter = functionAdapter<{ count: number }>({
          create: (given) => {
            seen.push(given.hash);
            return { count: 0 };
          },
          respond: (_m, _w, _v, state) => {
            state.count += 1;
            return textObserved(String(state.count));
          },
        });
        const one = await adapter.open(givenOf({ hash: `g-one-${seed}` }));
        const two = await adapter.open(givenOf({ hash: `g-two-${seed}` }));
        const a1 = (await play(adapter, one, 'a')).text;
        const a2 = (await play(adapter, one, 'b')).text;
        const b1 = (await play(adapter, two, 'c')).text;
        return expectAll([
          [
            same(seen, [`g-one-${seed}`, `g-two-${seed}`]),
            `expected create to get each Given, got ${show(seen)}`,
          ],
          [
            a1 === '1' && a2 === '2' && b1 === '1',
            `expected counts 1, 2 in session one and 1 in session two, got ${a1}, ${a2}, ${b1}`,
          ],
        ]);
      },
    }),
    adapterItem({
      slug: 'function/no-create-state',
      tier: 1,
      level: 3,
      component: FN,
      source: 'contract',
      title: 'function.md "Options": without create, state is undefined',
      cause: 'functionAdapter passes an undefined state when no create is given',
      async check() {
        let state: unknown = 'not called';
        const adapter = functionAdapter({
          respond: (_m, _w, _v, s) => {
            state = s;
            return textObserved('ok');
          },
        });
        const session = await adapter.open(givenOf());
        await play(adapter, session, 'hello');
        return state === undefined ? PASS : fail(`expected state undefined, got ${show(state)}`);
      },
    }),
    adapterItem({
      slug: 'function/throw-is-failure',
      tier: 1,
      level: 2,
      component: FN,
      source: 'contract',
      title: 'function.md "Errors": an error the agent throws becomes an AgentFailure that keeps its message',
      cause: 'functionAdapter.send turns an error the agent throws into an AgentFailure',
      async check({ seed }) {
        const adapter = functionAdapter({
          respond: () => {
            throw new TypeError(`lookup broke on ${code(seed)}`);
          },
        });
        const session = await adapter.open(givenOf());
        const error = await caught(play(adapter, session, 'hello'));
        return expectAll([
          [error instanceof AgentFailure, `expected AgentFailure, got ${kindOf(error)}`],
          [
            messageOf(error).includes(`lookup broke on ${code(seed)}`),
            `expected the failure to keep the message, got "${messageOf(error)}"`,
          ],
        ]);
      },
    }),
    adapterItem({
      slug: 'function/contract-errors-pass',
      tier: 2,
      level: 2,
      component: FN,
      source: 'contract',
      title:
        'function.md "Errors": an AdapterTransportError or an AgentFailure the agent throws passes through as it is',
      cause: 'functionAdapter.send rethrows the two contract errors unchanged',
      async check({ seed }) {
        const transport = new AdapterTransportError(`socket closed ${code(seed)}`);
        const failure = new AgentFailure(`refused ${code(seed)}`);
        const errors: unknown[] = [];
        for (const thrown of [transport, failure]) {
          const adapter = functionAdapter({
            respond: () => {
              throw thrown;
            },
          });
          const session = await adapter.open(givenOf());
          errors.push(await caught(play(adapter, session, 'hello')));
        }
        return expectAll([
          [errors[0] === transport, `expected the same AdapterTransportError, got ${kindOf(errors[0])}`],
          [errors[1] === failure, `expected the same AgentFailure, got ${kindOf(errors[1])}`],
        ]);
      },
    }),
    adapterItem({
      slug: 'function/invalid-observed',
      tier: 1,
      level: 2,
      component: FN,
      source: 'contract',
      title:
        'function.md "Errors": an Observed that does not validate is an AgentFailure that names its first issues',
      cause: 'functionAdapter.send validates the returned Observed and fails the agent naming the issue',
      async check() {
        const adapter = functionAdapter({
          respond: () =>
            ({ segments: 'not a list', text: 1, toolCalls: [], cost: {}, latencyMs: 0 }) as never,
        });
        const session = await adapter.open(givenOf());
        const error = await caught(play(adapter, session, 'hello'));
        return expectAll([
          [error instanceof AgentFailure, `expected AgentFailure, got ${kindOf(error)}`],
          [
            messageOf(error).includes('segments'),
            `expected the message to name the field segments, got "${messageOf(error)}"`,
          ],
        ]);
      },
    }),
    adapterItem({
      slug: 'function/end-state-tool',
      tier: 1,
      level: 3,
      component: FN,
      source: 'contract',
      title:
        'function.md "End state": tool:<label> returns the input of the last payload of that tool, or undefined for a tool that received none',
      cause: 'functionAdapter.endState reads the last payload of the named tool',
      async check({ seed }) {
        const adapter = functionAdapter<{ log: { tool: string; input: unknown }[] }>({
          create: () => ({ log: [] }),
          respond: (_m, _w, _v, state) => {
            state.log.push({ tool: 'order.create', input: { plan: 'fiber-300', code: code(seed) } });
            state.log.push({ tool: 'note.add', input: { text: 'n' } });
            state.log.push({ tool: 'order.create', input: { plan: 'air-5g', code: code(seed) } });
            return textObserved('placed');
          },
          payloads: (state) => state.log,
        });
        const session = await adapter.open(givenOf());
        await play(adapter, session, 'order');
        const last = await adapter.endState?.(session, 'tool:order.create');
        const none = await adapter.endState?.(session, 'tool:refund.issue');
        return expectAll([
          [
            same(last, { plan: 'air-5g', code: code(seed) }),
            `expected the last order.create input, got ${show(last)}`,
          ],
          [none === undefined, `expected undefined for a tool with no payload, got ${show(none)}`],
        ]);
      },
    }),
    adapterItem({
      slug: 'function/end-state-all',
      tier: 1,
      level: 3,
      component: FN,
      source: 'contract',
      title: 'function.md "End state": source * returns the whole log, in order, as { tool, input }',
      cause: 'functionAdapter.endState lists every payload in order for source *',
      async check({ seed }) {
        const log = [
          { tool: 'order.create', input: { n: 1 } },
          { tool: 'note.add', input: { n: 2, code: code(seed) } },
          { tool: 'order.create', input: { n: 3 } },
        ];
        const adapter = functionAdapter<{ log: typeof log }>({
          create: () => ({ log: [] }),
          respond: (_m, _w, _v, state) => {
            state.log.push(...log);
            return textObserved('ok');
          },
          payloads: (state) => state.log,
        });
        const session = await adapter.open(givenOf());
        const empty = await adapter.endState?.(session, '*');
        await play(adapter, session, 'go');
        const all = await adapter.endState?.(session, '*');
        return expectAll([
          [same(empty, []), `expected an empty list before the first block, got ${show(empty)}`],
          [same(all, log), `expected the whole log in order ${show(log)}, got ${show(all)}`],
        ]);
      },
    }),
    adapterItem({
      slug: 'function/end-state-bad-source',
      tier: 2,
      level: 2,
      component: FN,
      source: 'contract',
      title:
        'function.md "End state": any source other than tool:<label> or * is a configuration error, not an agent failure',
      cause: 'functionAdapter.endState refuses an unknown source as a configuration error',
      async check() {
        const adapter = functionAdapter({ respond: () => textObserved('x'), payloads: () => [] });
        const session = await adapter.open(givenOf());
        const errors = [
          await caught(adapter.endState?.(session, 'order.create') ?? Promise.resolve()),
          await caught(adapter.endState?.(session, 'tool:') ?? Promise.resolve()),
        ];
        const wrong = errors.find(
          (e) => e === undefined || e instanceof AgentFailure || e instanceof AdapterTransportError,
        );
        return wrong === undefined
          ? PASS
          : fail(
              `expected a configuration error for sources "order.create" and "tool:", got ${errors.map(kindOf).join(' and ')}`,
            );
      },
    }),
    adapterItem({
      slug: 'function/after-close',
      tier: 1,
      level: 3,
      component: FN,
      source: 'contract',
      title: 'function.md "Errors": a session used after close is an error',
      cause: 'functionAdapter refuses a closed session',
      async check() {
        const adapter = functionAdapter({ respond: () => textObserved('x'), payloads: () => [] });
        const session = await adapter.open(givenOf());
        await adapter.close(session);
        const send = await caught(play(adapter, session, 'late'));
        const read = await caught(adapter.endState?.(session, '*') ?? Promise.resolve());
        return expectAll([
          [send !== undefined, 'expected send after close to reject, it resolved'],
          [read !== undefined, 'expected endState after close to reject, it resolved'],
        ]);
      },
    }),
    adapterItem({
      slug: 'function/never-appends',
      tier: 1,
      level: 3,
      component: FN,
      source: 'contract',
      title: 'index.md "The history belongs to the runner": send leaves the history as it was',
      cause: 'functionAdapter.send never appends to the session history',
      async check() {
        const adapter = functionAdapter({ respond: () => textObserved('reply') });
        const session = await adapter.open(givenOf());
        session.history.push({ role: 'user', content: 'one' });
        const before = canonicalJson(session.history);
        await adapter.send(session, { index: 0, stimulus: { user: 'one' }, given: session.given });
        return canonicalJson(session.history) === before
          ? PASS
          : fail(`expected the history unchanged by send, got ${show(session.history)}`);
      },
    }),
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* claim-adapters: http                                                                               */
/* ------------------------------------------------------------------------------------------------ */

type Posted = { url: string; init: RequestInit; body: Record<string, unknown> };

function fakeFetch(answer: (call: Posted, n: number) => Response | Promise<Response>) {
  const calls: Posted[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const call: Posted = {
      url,
      init: init ?? {},
      body: init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>),
    };
    calls.push(call);
    return answer(call, calls.length - 1);
  };
  return { fetch, calls };
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const URL_TURN = 'http://agent.example.org/turn';
const URL_END = 'http://agent.example.org/end-state';
const URL_CLOSE = 'http://agent.example.org/close';

function completion(content: unknown, toolCalls?: unknown[], usage?: [number, number]) {
  return {
    choices: [{ message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) } }],
    ...(usage ? { usage: { prompt_tokens: usage[0], completion_tokens: usage[1] } } : {}),
  };
}

function askTool(id: string, name: string, args: unknown) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

async function httpSend(
  answer: (call: Posted, n: number) => Response | Promise<Response>,
  options: {
    world?: WorldState;
    maxToolRounds?: number;
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {},
  user = 'hello',
): Promise<{ observed?: Observed; error?: unknown; calls: Posted[]; session: Session }> {
  const fake = fakeFetch(answer);
  const adapter = httpAdapter({
    url: URL_TURN,
    fetch: fake.fetch,
    ...(options.maxToolRounds === undefined ? {} : { maxToolRounds: options.maxToolRounds }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });
  const session = await adapter.open(givenOf({ target: { adapter: 'http', agent: 'support-bot' } }));
  try {
    const observed = await play(adapter, session, user, options.world ? { world: options.world } : {});
    return { observed, calls: fake.calls, session };
  } catch (error) {
    return { error, calls: fake.calls, session };
  }
}

function httpItems(): BankItem[] {
  const out: BankItem[] = [];
  const code = (seed: number) => `R-${String(2000 + (seed % 7000)).padStart(4, '0')}`;

  out.push(
    adapterItem({
      slug: 'http/capabilities-default',
      tier: 1,
      level: 3,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "Capabilities and version": seedPrefix on; variants, toolStubs, deterministic false by default; trace, sandbox off; endState off without endStateUrl',
      cause: 'httpAdapter declares its default capabilities as the http page documents',
      async check() {
        const caps = httpAdapter({ url: URL_TURN, fetch: fakeFetch(() => json({})).fetch }).capabilities();
        const want = {
          variants: false,
          seedPrefix: true,
          toolStubs: false,
          trace: false,
          sandbox: false,
          endState: false,
          deterministic: false,
        };
        return same(caps, want) ? PASS : fail(`expected ${show(want)}, got ${show(caps)}`);
      },
    }),
    adapterItem({
      slug: 'http/capabilities-declared',
      tier: 1,
      level: 3,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "Capabilities and version": variants, toolStubs and deterministic are as declared; endState is on with an endStateUrl',
      cause: 'httpAdapter carries the declared capabilities and turns endState on with an endStateUrl',
      async check() {
        const caps = httpAdapter({
          url: URL_TURN,
          endStateUrl: URL_END,
          capabilities: { variants: true, toolStubs: true, deterministic: true },
          fetch: fakeFetch(() => json({})).fetch,
        }).capabilities();
        const want = {
          variants: true,
          seedPrefix: true,
          toolStubs: true,
          trace: false,
          sandbox: false,
          endState: true,
          deterministic: true,
        };
        return same(caps, want) ? PASS : fail(`expected ${show(want)}, got ${show(caps)}`);
      },
    }),
    adapterItem({
      slug: 'http/version-per-url',
      tier: 1,
      level: 3,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "Capabilities and version": the version is <adapter version>+<hash of url>, stable for one url and distinct for different urls',
      cause:
        'httpAdapter combines its exported version with the content hash of its url, stably per url and distinctly across urls',
      async check({ seed }) {
        const make = (url: string) => httpAdapter({ url, fetch: fakeFetch(() => json({})).fetch }).version;
        const urlA = `http://a.example.org/turn/${seed}`;
        const urlB = `http://b.example.org/turn/${seed}`;
        const a = make(urlA);
        const a2 = make(urlA);
        const b = make(urlB);
        const expected = (url: string) => `${HTTP_ADAPTER_VERSION}+${contentHash(url)}`;
        return expectAll([
          [a === expected(urlA), `expected version ${expected(urlA)} for ${urlA}, got ${a}`],
          [b === expected(urlB), `expected version ${expected(urlB)} for ${urlB}, got ${b}`],
          [a === a2, `expected one url to give one version, got ${a} and ${a2}`],
          [a !== b, `expected two urls to give two versions, both gave ${a}`],
        ]);
      },
    }),
    adapterItem({
      slug: 'http/request-fields',
      tier: 1,
      level: 3,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "The request": one POST per block with content-type application/json, the headers, and session, turn, model, messages, stimulus, world, vars and target',
      cause: 'httpAdapter.send posts the documented request body and headers',
      async check({ seed }) {
        const fake = fakeFetch(() => json(textObserved('ok')));
        const target: TargetRef = { adapter: 'http', agent: 'support-bot', variant: 'v2' };
        const adapter = httpAdapter({
          url: URL_TURN,
          fetch: fake.fetch,
          headers: { 'x-bank-key': `key-${seed}` },
        });
        const world: WorldState = { fixtures: { code: code(seed) } };
        const session = await adapter.open(givenOf({ target, vars: { channel: 'chat', seed } }));
        await play(adapter, session, `Hi ${code(seed)}`, {
          index: 3,
          world,
          vars: { channel: 'chat', seed },
        });
        const call = fake.calls[0];
        if (!call) return fail('expected one POST, got none');
        const headers = new Headers(call.init.headers);
        const b = call.body;
        return expectAll([
          [fake.calls.length === 1, `expected one POST per block, got ${fake.calls.length}`],
          [call.init.method === 'POST', `expected method POST, got ${call.init.method}`],
          [call.url === URL_TURN, `expected the url ${URL_TURN}, got ${call.url}`],
          [
            (headers.get('content-type') ?? '').startsWith('application/json'),
            `expected content-type application/json, got ${headers.get('content-type')}`,
          ],
          [
            headers.get('x-bank-key') === `key-${seed}`,
            `expected the given header, got ${headers.get('x-bank-key')}`,
          ],
          [b.session === session.id, `expected session ${session.id}, got ${show(b.session)}`],
          [b.turn === 3, `expected turn 3, got ${show(b.turn)}`],
          [b.model === 'support-bot', `expected model support-bot, got ${show(b.model)}`],
          [
            same(b.messages, [{ role: 'user', content: `Hi ${code(seed)}` }]),
            `expected messages [the user turn], got ${show(b.messages)}`,
          ],
          [same(b.stimulus, { user: `Hi ${code(seed)}` }), `expected the stimulus, got ${show(b.stimulus)}`],
          [same(b.world, world), `expected the world ${show(world)}, got ${show(b.world)}`],
          [same(b.vars, { channel: 'chat', seed }), `expected the vars, got ${show(b.vars)}`],
          [same(b.target, target), `expected the whole target ${show(target)}, got ${show(b.target)}`],
        ]);
      },
    }),
    adapterItem({
      slug: 'http/model-absent',
      tier: 2,
      level: 3,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "The request": model is target.agent only when it is set; a target with no agent sends no model',
      cause: 'httpAdapter.send leaves model out when the target has no agent',
      async check() {
        const fake = fakeFetch(() => json(textObserved('ok')));
        const adapter = httpAdapter({ url: URL_TURN, fetch: fake.fetch });
        const session = await adapter.open(givenOf({ target: { adapter: 'http' } }));
        await play(adapter, session, 'hello');
        const body = fake.calls[0]?.body ?? {};
        return 'model' in body ? fail(`expected no model field, got model ${show(body.model)}`) : PASS;
      },
    }),
    adapterItem({
      slug: 'http/tool-history-shape',
      tier: 2,
      level: 3,
      component: HTTP_CHAT,
      source: 'contract',
      title:
        'http.md "The request": an assistant message that recorded tool calls becomes the assistant tool_calls with no content, one tool message per call (output JSON or {"error"}), then the reply text',
      cause: 'toChatMessages expands a recorded assistant message into the three documented parts',
      async check({ seed }) {
        const fake = fakeFetch(() => json(textObserved('ok')));
        const adapter = httpAdapter({ url: URL_TURN, fetch: fake.fetch });
        const prefix: Message[] = [
          { role: 'user', content: 'My code please' },
          {
            role: 'assistant',
            content: `Your code is ${code(seed)}.`,
            tool_calls: [
              {
                id: 'call-1',
                label: 'records.lookup',
                input: { email: 'ana@example.org' },
                output: { code: code(seed) },
              },
              { id: 'call-2', label: 'policy.check', input: { action: 'share' }, error: 'denied' },
            ],
          },
        ];
        const session = await adapter.open(givenOf({ prefix }));
        await play(adapter, session, 'Thanks');
        const m = (fake.calls[0]?.body.messages ?? []) as Record<string, unknown>[];
        const calls = (m[1]?.tool_calls ?? []) as {
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }[];
        const want = [
          'user',
          'assistant(tool_calls)',
          `tool call-1 {"code":"${code(seed)}"}`,
          'tool call-2 {"error":"denied"}',
          `assistant Your code is ${code(seed)}.`,
          'user Thanks',
        ];
        const got = m.map((msg) => {
          if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) return `assistant(tool_calls)`;
          if (msg.role === 'tool')
            return `tool ${String(msg.tool_call_id)} ${canonicalJson(JSON.parse(String(msg.content)))}`;
          if (msg.role === 'user' && msg.content === 'My code please') return 'user';
          return `${String(msg.role)} ${String(msg.content)}`;
        });
        return expectAll([
          [same(got, want), `expected the messages ${show(want)}, got ${show(got, 600)}`],
          [
            m[1]?.content === null,
            `expected the tool_calls message to carry content null, got ${show(m[1]?.content)}`,
          ],
          [
            calls.length === 2 &&
              calls[0]?.function.name === 'records.lookup' &&
              same(JSON.parse(calls[0]?.function.arguments ?? 'null'), { email: 'ana@example.org' }) &&
              calls[0]?.type === 'function',
            `expected two function tool_calls, the first records.lookup with its input, got ${show(calls)}`,
          ],
        ]);
      },
    }),
    adapterItem({
      slug: 'http/observed-filled',
      tier: 1,
      level: 3,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "The response": an Observed with segments only gets text joined by a newline, calls paired with results, no cost and the measured round trip',
      cause: 'httpAdapter fills the missing fields of an Observed answer as documented',
      async check({ seed }) {
        const segments = [
          { type: 'text', text: 'Looking it up.' },
          { type: 'tool_call', id: 't1', label: 'records.lookup', input: { email: 'ana@example.org' } },
          { type: 'tool_result', id: 't1', label: 'records.lookup', output: { code: code(seed) } },
          { type: 'text', text: `Your code is ${code(seed)}.` },
        ];
        const r = await httpSend(() => json({ segments }));
        const o = r.observed;
        if (!o) return fail(`expected an Observed, got ${kindOf(r.error)}`);
        return expectAll([
          [
            o.text === `Looking it up.\nYour code is ${code(seed)}.`,
            `expected text joined by a newline, got ${show(o.text)}`,
          ],
          [
            same(o.toolCalls, [
              {
                id: 't1',
                label: 'records.lookup',
                input: { email: 'ana@example.org' },
                output: { code: code(seed) },
              },
            ]),
            `expected the call paired with its result, got ${show(o.toolCalls)}`,
          ],
          [same(o.cost, {}), `expected no cost, got ${show(o.cost)}`],
          [
            typeof o.latencyMs === 'number' && o.latencyMs >= 0,
            `expected a measured latency, got ${o.latencyMs}`,
          ],
        ]);
      },
    }),
    adapterItem({
      slug: 'http/completion-text-usage',
      tier: 1,
      level: 3,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "The response": a chat completion string content becomes a text segment, and usage prompt and completion tokens become the tokens',
      cause: 'httpAdapter maps a chat completion message and usage onto the Observed',
      async check({ seed }) {
        const r = await httpSend(() =>
          json(completion(`Plan noted ${code(seed)}`, undefined, [11 + seed, 7])),
        );
        const o = r.observed;
        if (!o) return fail(`expected an Observed, got ${kindOf(r.error)}`);
        return expectAll([
          [o.text === `Plan noted ${code(seed)}`, `expected the content as text, got ${show(o.text)}`],
          [
            o.segments.length === 1 && o.segments[0]?.type === 'text',
            `expected one text segment, got ${show(o.segments)}`,
          ],
          [
            same(o.cost, { inputTokens: 11 + seed, outputTokens: 7 }),
            `expected tokens ${11 + seed} in and 7 out, got ${show(o.cost)}`,
          ],
        ]);
      },
    }),
    adapterItem({
      slug: 'http/completion-text-parts',
      tier: 2,
      level: 3,
      component: HTTP,
      source: 'contract',
      title: 'http.md "The response": a completion content given as text parts becomes the text of the block',
      cause: 'httpAdapter reads the text parts of a completion content',
      async check({ seed }) {
        const r = await httpSend(() =>
          json(
            completion([
              { type: 'text', text: 'Part A ' },
              { type: 'text', text: `part B ${code(seed)}` },
            ]),
          ),
        );
        const o = r.observed;
        if (!o) return fail(`expected an Observed, got ${kindOf(r.error)}`);
        return o.text === `Part A part B ${code(seed)}`
          ? PASS
          : fail(`expected the parts joined, "Part A part B ${code(seed)}", got ${show(o.text)}`);
      },
    }),
    adapterItem({
      slug: 'http/tool-round',
      tier: 2,
      level: 3,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "The response": a completion asking for tool_calls is answered from world.tools (latency_ms kept), the assistant and tool messages are added, and the adapter posts again',
      cause: 'httpAdapter answers a completion tool round from world.tools and posts again',
      async check({ seed }) {
        const world: WorldState = {
          tools: { 'records.lookup': { result: { code: code(seed) }, latency_ms: 42 } },
        };
        const r = await httpSend(
          (_call, n) =>
            json(
              n === 0
                ? completion(null, [askTool('c1', 'records.lookup', { email: 'ana@example.org' })])
                : completion(`Your code is ${code(seed)}.`),
            ),
          { world },
        );
        const o = r.observed;
        if (!o) return fail(`expected an Observed, got ${kindOf(r.error)}`);
        const second = (r.calls[1]?.body.messages ?? []) as Record<string, unknown>[];
        const tail = second.slice(-2);
        return expectAll([
          [r.calls.length === 2, `expected two POSTs, got ${r.calls.length}`],
          [
            tail[0]?.role === 'assistant' && Array.isArray(tail[0]?.tool_calls),
            `expected the second request to end with the assistant tool_calls, got ${show(tail[0])}`,
          ],
          [
            tail[1]?.role === 'tool' &&
              tail[1]?.tool_call_id === 'c1' &&
              same(JSON.parse(String(tail[1]?.content)), { code: code(seed) }),
            `expected a tool message for c1 with the stub result, got ${show(tail[1])}`,
          ],
          [
            same(
              o.segments.map((s) => s.type),
              ['tool_call', 'tool_result', 'text'],
            ),
            `expected segments tool_call, tool_result, text, got ${show(o.segments.map((s) => s.type))}`,
          ],
          [
            same(o.toolCalls, [
              {
                id: 'c1',
                label: 'records.lookup',
                input: { email: 'ana@example.org' },
                output: { code: code(seed) },
                latencyMs: 42,
              },
            ]),
            `expected the call with its stub output and latency 42, got ${show(o.toolCalls)}`,
          ],
          [o.text === `Your code is ${code(seed)}.`, `expected the final text, got ${show(o.text)}`],
        ]);
      },
    }),
    adapterItem({
      slug: 'http/tool-error-stub',
      tier: 2,
      level: 3,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "The response": a world.tools error answers the call as an error on the tool_result and the tool message carries {"error"}',
      cause: 'httpAdapter delivers a forced tool error from world.tools',
      async check({ seed }) {
        const r = await httpSend(
          (_call, n) =>
            json(
              n === 0
                ? completion(null, [askTool('c1', 'policy.check', { code: code(seed) })])
                : completion('Sorry.'),
            ),
          { world: { tools: { 'policy.check': { error: 'denied by policy' } } } },
        );
        const o = r.observed;
        if (!o) return fail(`expected an Observed, got ${kindOf(r.error)}`);
        const result = o.segments.find((s) => s.type === 'tool_result') as { error?: string } | undefined;
        const toolMessage = ((r.calls[1]?.body.messages ?? []) as Record<string, unknown>[]).find(
          (m) => m.role === 'tool',
        );
        return expectAll([
          [result?.error === 'denied by policy', `expected the tool_result error, got ${show(result)}`],
          [
            o.toolCalls[0]?.error === 'denied by policy',
            `expected the call error, got ${show(o.toolCalls[0])}`,
          ],
          [
            same(JSON.parse(String(toolMessage?.content ?? 'null')), { error: 'denied by policy' }),
            `expected the tool message {"error":"denied by policy"}, got ${show(toolMessage)}`,
          ],
        ]);
      },
    }),
    adapterItem({
      slug: 'http/tool-without-stub',
      tier: 2,
      level: 2,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "The response": a call to a tool that world.tools gives no result or error fails the block',
      cause: 'httpAdapter fails the agent when a completion asks for a tool with no stub',
      async check({ seed }) {
        const r = await httpSend(
          () => json(completion(null, [askTool('c1', 'order.create', { code: code(seed) })])),
          {
            world: { tools: { 'records.lookup': { result: {} } } },
          },
        );
        return r.error instanceof AgentFailure
          ? PASS
          : fail(`expected AgentFailure for a tool with no stub, got ${kindOf(r.error)}`);
      },
    }),
    adapterItem({
      slug: 'http/max-tool-rounds',
      tier: 3,
      level: 2,
      component: HTTP,
      source: 'adversarial',
      title:
        'http.md "Options" and "The response": an endpoint that never stops asking for tools fails after maxToolRounds rounds, with exactly that many rounds answered',
      cause: 'httpAdapter stops a tool loop after maxToolRounds answered rounds',
      async check({ seed }) {
        const rounds = 1 + (seed % 3);
        const r = await httpSend(() => json(completion(null, [askTool(`c${seed}`, 'records.lookup', {})])), {
          world: { tools: { 'records.lookup': { result: { code: code(seed) } } } },
          maxToolRounds: rounds,
        });
        return expectAll([
          [
            r.error instanceof AgentFailure,
            `expected AgentFailure after ${rounds} rounds, got ${kindOf(r.error)}`,
          ],
          [
            r.calls.length === rounds + 1,
            `expected ${rounds + 1} POSTs (the first and ${rounds} answered rounds), got ${r.calls.length}`,
          ],
        ]);
      },
    }),
    adapterItem({
      slug: 'http/round-measures',
      tier: 3,
      level: 3,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "The response": each round latency and tokens sit on its first segment, so the segments add up to the block',
      cause: 'httpAdapter puts each round measure on its first segment and sums the rounds',
      async check({ seed }) {
        const r = await httpSend(
          (_call, n) =>
            json(
              n === 0
                ? completion(null, [askTool('c1', 'records.lookup', {})], [5, 2 + seed])
                : completion('Done.', undefined, [3, 4]),
            ),
          { world: { tools: { 'records.lookup': { result: { ok: true } } } } },
        );
        const o = r.observed;
        if (!o) return fail(`expected an Observed, got ${kindOf(r.error)}`);
        const sum = { inputTokens: 0, outputTokens: 0 };
        let latency = 0;
        for (const s of o.segments) {
          sum.inputTokens += s.cost?.inputTokens ?? 0;
          sum.outputTokens += s.cost?.outputTokens ?? 0;
          latency += s.latencyMs ?? 0;
        }
        return expectAll([
          [
            same(o.segments[0]?.cost, { inputTokens: 5, outputTokens: 2 + seed }),
            `expected the first round tokens on the first segment, got ${show(o.segments[0])}`,
          ],
          [
            same(o.segments[2]?.cost, { inputTokens: 3, outputTokens: 4 }),
            `expected the second round tokens on its text segment, got ${show(o.segments[2])}`,
          ],
          [
            same(o.cost, { inputTokens: 8, outputTokens: 6 + seed }) && same(sum, o.cost),
            `expected block tokens ${show({ inputTokens: 8, outputTokens: 6 + seed })} equal to the segment sum ${show(sum)}, got ${show(o.cost)}`,
          ],
          [
            Math.abs(latency - o.latencyMs) < 1e-6,
            `expected segment latencies to add to ${o.latencyMs}, got ${latency}`,
          ],
        ]);
      },
    }),
    adapterItem({
      slug: 'http/no-connection',
      tier: 1,
      level: 2,
      component: TRANSPORT,
      source: 'contract',
      title: 'http.md "Errors": no connection is an AdapterTransportError, which the runner retries',
      cause: 'sendRequest turns a failed connection into an AdapterTransportError',
      async check() {
        const r = await httpSend(() => {
          throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:9');
        });
        return r.error instanceof AdapterTransportError
          ? PASS
          : fail(`expected AdapterTransportError, got ${kindOf(r.error)}`);
      },
    }),
    adapterItem({
      slug: 'http/timeout',
      tier: 2,
      level: 2,
      component: TRANSPORT,
      source: 'contract',
      title:
        'http.md "Options" and "Errors": a request past timeoutMs is aborted and is an AdapterTransportError',
      cause: 'sendRequest aborts at timeoutMs and reports a transport error',
      async check() {
        const started = Date.now();
        const r = await httpSend(
          (call) =>
            new Promise<Response>((_ok, reject) => {
              const signal = call.init.signal;
              if (!signal) return;
              signal.addEventListener('abort', () => reject(signal.reason));
            }),
          { timeoutMs: 40 },
        );
        const took = Date.now() - started;
        return expectAll([
          [
            r.error instanceof AdapterTransportError,
            `expected AdapterTransportError, got ${kindOf(r.error)}`,
          ],
          [took < 2000, `expected the request aborted near 40 ms, it took ${took} ms`],
        ]);
      },
    }),
    adapterItem({
      slug: 'http/body-breaks-off',
      tier: 3,
      level: 2,
      component: TRANSPORT,
      source: 'hostile',
      title: 'http.md "Errors": a body that breaks off is an AdapterTransportError',
      cause: 'sendRequest reports a body stream error as a transport error',
      async check() {
        const r = await httpSend(
          () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode('{"segments": [{"type": "te'));
                  controller.error(new Error('connection reset'));
                },
              }),
              { status: 200 },
            ),
        );
        return r.error instanceof AdapterTransportError
          ? PASS
          : fail(`expected AdapterTransportError for a broken body, got ${kindOf(r.error)}`);
      },
    }),
    adapterItem({
      slug: 'http/retryable-status',
      tier: 1,
      level: 2,
      component: HTTP,
      source: 'contract',
      title: 'http.md "Errors": status 408 and 429 are AdapterTransportError, so the runner retries',
      cause: 'httpAdapter classes 408 and 429 as transport errors',
      async check() {
        const got: string[] = [];
        for (const status of [408, 429]) {
          const r = await httpSend(() => new Response('slow down', { status }));
          got.push(`${status}: ${kindOf(r.error)}`);
        }
        return same(got, ['408: AdapterTransportError', '429: AdapterTransportError'])
          ? PASS
          : fail(`expected both statuses as AdapterTransportError, got ${got.join(', ')}`);
      },
    }),
    adapterItem({
      slug: 'http/failing-status',
      tier: 1,
      level: 2,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "Errors": any 5xx is an AdapterTransportError the runner retries; any other failing status is an AgentFailure: the run fails',
      cause: 'httpAdapter classes 5xx as transport errors and other failing statuses as agent failures',
      async check() {
        const got: string[] = [];
        for (const status of [500, 502, 503]) {
          const r = await httpSend(() => new Response('busy', { status }));
          if (!(r.error instanceof AdapterTransportError))
            got.push(`${status}: ${kindOf(r.error)}, expected AdapterTransportError`);
        }
        for (const status of [400, 401, 404, 302]) {
          const r = await httpSend(() => new Response('nope', { status }));
          if (!(r.error instanceof AgentFailure))
            got.push(`${status}: ${kindOf(r.error)}, expected AgentFailure`);
        }
        return got.length === 0 ? PASS : fail(got.join('; '));
      },
    }),
    adapterItem({
      slug: 'http/body-not-object',
      tier: 2,
      level: 2,
      component: HTTP,
      source: 'contract',
      title: 'http.md "Errors": a 200 body that is not a JSON object (text, a list, null) is an AgentFailure',
      cause: 'httpAdapter fails the agent on a body that is not a JSON object',
      async check() {
        const got: string[] = [];
        for (const body of ['plain text answer', '[1,2]', 'null', '']) {
          const r = await httpSend(() => new Response(body, { status: 200 }));
          if (!(r.error instanceof AgentFailure)) got.push(`${JSON.stringify(body)}: ${kindOf(r.error)}`);
        }
        return got.length === 0 ? PASS : fail(`expected AgentFailure for each body, got ${got.join(', ')}`);
      },
    }),
    adapterItem({
      slug: 'http/body-neither-shape',
      tier: 2,
      level: 2,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "Errors": a JSON object of neither shape (no segments, no choices) or an invalid Observed is an AgentFailure',
      cause: 'httpAdapter fails the agent on an object that is neither an Observed nor a completion',
      async check() {
        const got: string[] = [];
        for (const body of [{ reply: 'hi' }, { segments: [{ type: 'nonsense' }] }, { choices: [] }]) {
          const r = await httpSend(() => json(body));
          if (!(r.error instanceof AgentFailure)) got.push(`${JSON.stringify(body)}: ${kindOf(r.error)}`);
        }
        return got.length === 0 ? PASS : fail(`expected AgentFailure for each body, got ${got.join(', ')}`);
      },
    }),
    adapterItem({
      slug: 'http/error-names-no-header',
      tier: 2,
      level: 2,
      component: HTTP,
      source: 'hostile',
      title:
        'http.md "Options": an error message names the method, the URL, the status and the start of the body, never a header',
      cause: 'httpAdapter error messages carry the method, url, status and body start and no header value',
      async check({ seed }) {
        const secret = `sk-bank-${seed}-do-not-print`;
        const failing = await httpSend(
          () => new Response(`internal problem ${code(seed)}`, { status: 500 }),
          {
            headers: { authorization: `Bearer ${secret}` },
          },
        );
        const refused = await httpSend(
          () => {
            throw new TypeError('connect ECONNREFUSED');
          },
          { headers: { authorization: `Bearer ${secret}` } },
        );
        const m = messageOf(failing.error);
        const t = messageOf(refused.error);
        return expectAll([
          [
            m.includes('POST') &&
              m.includes(URL_TURN) &&
              m.includes('500') &&
              m.includes(`internal problem ${code(seed)}`),
            `expected the message to name POST, ${URL_TURN}, 500 and the body start, got "${m}"`,
          ],
          [
            !m.includes(secret) && !t.includes(secret),
            `expected no header value in messages, got "${m}" and "${t}"`,
          ],
        ]);
      },
    }),
    adapterItem({
      slug: 'http/end-state-read',
      tier: 1,
      level: 3,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "End state and close": endState posts { session, source } to endStateUrl and reads { state }; a 404 reads undefined',
      cause: 'httpAdapter.endState posts the source and reads the state, a 404 as undefined',
      async check({ seed }) {
        const fake = fakeFetch((call) =>
          call.body.source === 'tool:order.create'
            ? json({ state: { plan: 'fiber-300', code: code(seed) } })
            : new Response('not found', { status: 404 }),
        );
        const adapter = httpAdapter({ url: URL_TURN, endStateUrl: URL_END, fetch: fake.fetch });
        const session = await adapter.open(givenOf());
        const found = await adapter.endState?.(session, 'tool:order.create');
        const missing = await adapter.endState?.(session, 'tool:refund.issue');
        return expectAll([
          [
            fake.calls[0]?.url === URL_END &&
              same(fake.calls[0]?.body, { session: session.id, source: 'tool:order.create' }),
            `expected a POST of { session, source } to ${URL_END}, got ${show(fake.calls[0])}`,
          ],
          [same(found, { plan: 'fiber-300', code: code(seed) }), `expected the state, got ${show(found)}`],
          [missing === undefined, `expected undefined for a 404, got ${show(missing)}`],
        ]);
      },
    }),
    adapterItem({
      slug: 'http/end-state-all',
      tier: 2,
      level: 3,
      component: HTTP,
      source: 'contract',
      title:
        'http.md "End state and close": for source * a 404 or no state reads an empty list, a list reads as is, and a state that is not a list fails the block',
      cause: 'httpAdapter.endState reads source * as a list, empty when absent',
      async check({ seed }) {
        const list = [{ tool: 'order.create', input: { code: code(seed) } }];
        const answers = [
          () => new Response('', { status: 404 }),
          () => json({}),
          () => json({ state: list }),
          () => json({ state: { tool: 'order.create' } }),
        ];
        const fake = fakeFetch((_call, n) => (answers[n] ?? answers[0] ?? (() => json({})))());
        const adapter = httpAdapter({ url: URL_TURN, endStateUrl: URL_END, fetch: fake.fetch });
        const session = await adapter.open(givenOf());
        const a = await adapter.endState?.(session, '*');
        const b = await adapter.endState?.(session, '*');
        const c = await adapter.endState?.(session, '*');
        const d = await caught(adapter.endState?.(session, '*') ?? Promise.resolve());
        return expectAll([
          [same(a, []), `expected [] for a 404, got ${show(a)}`],
          [same(b, []), `expected [] for no state, got ${show(b)}`],
          [same(c, list), `expected the list, got ${show(c)}`],
          [
            d instanceof AgentFailure,
            `expected AgentFailure for a state that is not a list, got ${kindOf(d)}`,
          ],
        ]);
      },
    }),
    adapterItem({
      slug: 'http/close-posts',
      tier: 1,
      level: 3,
      component: HTTP,
      source: 'contract',
      title: 'http.md "End state and close": close posts { session } to closeUrl, when it is set',
      cause: 'httpAdapter.close tells closeUrl the session id',
      async check() {
        const fake = fakeFetch(() => json({ ok: true }));
        const adapter = httpAdapter({ url: URL_TURN, closeUrl: URL_CLOSE, fetch: fake.fetch });
        const session = await adapter.open(givenOf());
        await adapter.close(session);
        return fake.calls.length === 1 &&
          fake.calls[0]?.url === URL_CLOSE &&
          same(fake.calls[0]?.body, { session: session.id })
          ? PASS
          : fail(`expected one POST of { session } to ${URL_CLOSE}, got ${show(fake.calls)}`);
      },
    }),
    adapterItem({
      slug: 'http/after-close',
      tier: 1,
      level: 3,
      component: HTTP,
      source: 'contract',
      title: 'index.md "The contract suite": after close, a later send rejects',
      cause: 'httpAdapter refuses a closed session',
      async check() {
        const fake = fakeFetch(() => json(textObserved('ok')));
        const adapter = httpAdapter({ url: URL_TURN, fetch: fake.fetch });
        const session = await adapter.open(givenOf());
        await adapter.close(session);
        const error = await caught(play(adapter, session, 'late'));
        return expectAll([
          [error !== undefined, 'expected send after close to reject, it resolved'],
          [fake.calls.length === 0, `expected no POST after close, got ${fake.calls.length}`],
        ]);
      },
    }),
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* claim-adapters: process                                                                            */
/* ------------------------------------------------------------------------------------------------ */

const PRELUDE = `import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
const input = fs.readFileSync(0, 'utf8');
const block = process.env.DRIFTBENCH_BLOCK;
`;

type ProcOptions = Partial<Parameters<typeof processAdapter>[0]> & { extraArgs?: string[] };

type ProcHarness = {
  adapter: ReturnType<typeof processAdapter>;
  session: Session;
  dir: string;
  send(
    stimulus: Stimulus | string,
    extra?: { index?: number; world?: WorldState; budget?: Turn['budget'] },
  ): Promise<Observed>;
};

async function withProcess<T>(
  ctx: ItemContext,
  tag: string,
  body: string,
  options: ProcOptions,
  use: (h: ProcHarness) => Promise<T>,
  given: Partial<ResolvedGiven> = {},
): Promise<T> {
  const dir = folderFor(ctx, tag);
  const agent = join(dir, 'agent.mjs');
  writeFileSync(agent, `${PRELUDE}${body}\n`);
  const { extraArgs, ...rest } = options;
  const adapter = processAdapter({
    command: process.execPath,
    args: [agent, ...(extraArgs ?? [])],
    provider: localProvider({ dir: join(dir, 'sandboxes') }),
    ...rest,
  });
  const g = givenOf({ target: { adapter: 'process', agent: 'bank-agent' }, ...given });
  const session = await adapter.open(g);
  const h: ProcHarness = {
    adapter,
    session,
    dir,
    send: (stimulus, extra = {}) => play(adapter, session, stimulus, extra),
  };
  try {
    return await use(h);
  } finally {
    await adapter.close(session).catch(() => undefined);
  }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function processItems(): BankItem[] {
  const out: BankItem[] = [];
  const code = (seed: number) => `R-${String(3000 + (seed % 6000)).padStart(4, '0')}`;

  out.push(
    adapterItem({
      slug: 'process/capabilities',
      tier: 1,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "Capabilities": sandbox, readArtifact and seedPrefix (the history file) on, deterministic as declared, variants, toolStubs, trace and endState off, version 0.1.0',
      cause: 'processAdapter declares its capabilities and version as the process page documents',
      async check({ scratch }) {
        const adapter = processAdapter({
          command: process.execPath,
          provider: localProvider({ dir: join(scratch, 'claims-adapters', 'caps') }),
          deterministic: true,
        });
        const want = {
          variants: false,
          seedPrefix: true,
          toolStubs: false,
          trace: false,
          sandbox: true,
          endState: false,
          deterministic: true,
        };
        const caps = adapter.capabilities();
        return expectAll([
          [same(caps, want), `expected ${show(want)}, got ${show(caps)}`],
          [typeof adapter.readArtifact === 'function', 'expected readArtifact to exist'],
          [adapter.endState === undefined, 'expected no endState method'],
          [adapter.version === '0.1.0', `expected version 0.1.0, got ${adapter.version}`],
          [adapter.id === 'process', `expected id process, got ${adapter.id}`],
        ]);
      },
    }),
    adapterItem({
      slug: 'process/observed-shape',
      tier: 1,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "How a block runs": text is stdout as one text segment, no tool calls, sandbox kind local with weak isolation and no folder, empty cost',
      cause: 'processAdapter.send builds the documented Observed from the agent stdout and the sandbox',
      async check(ctx) {
        return withProcess(
          ctx,
          'shape',
          `process.stdout.write('line one ${code(ctx.seed)}\\nline two\\n');`,
          {},
          async (h) => {
            const o = await h.send('go');
            return expectAll([
              [
                same(o.segments, [{ type: 'text', text: `line one ${code(ctx.seed)}\nline two` }]),
                `expected one text segment with the stdout, got ${show(o.segments)}`,
              ],
              [o.text === `line one ${code(ctx.seed)}\nline two`, `expected the text, got ${show(o.text)}`],
              [same(o.toolCalls, []), `expected no tool calls, got ${show(o.toolCalls)}`],
              [
                same(o.sandbox, { kind: 'local', isolation: 'weak' }),
                `expected sandbox local, weak, no root, got ${show(o.sandbox)}`,
              ],
              [same(o.cost, {}), `expected an empty cost, got ${show(o.cost)}`],
            ]);
          },
        );
      },
    }),
    adapterItem({
      slug: 'process/final-line-break-only',
      tier: 3,
      level: 3,
      component: PROC,
      source: 'adversarial',
      title:
        'process.md "How a block runs": text is stdout without its final line break, so an output ending in a blank line keeps the earlier break',
      cause: 'processAdapter.send strips only the final line break of stdout',
      async check(ctx) {
        return withProcess(
          ctx,
          'final-break',
          `process.stdout.write('answer ${code(ctx.seed)}\\n\\n');`,
          {},
          async (h) => {
            const o = await h.send('go');
            const want = `answer ${code(ctx.seed)}\n`;
            return o.text === want
              ? PASS
              : fail(
                  `expected stdout "answer ${code(ctx.seed)}\\n\\n" to read ${JSON.stringify(want)}, got ${JSON.stringify(o.text)}`,
                );
          },
        );
      },
    }),
    adapterItem({
      slug: 'process/no-output',
      tier: 1,
      level: 3,
      component: PROC,
      source: 'contract',
      title: 'process.md "How a block runs": no output gives no segment',
      cause: 'processAdapter.send returns no segment for an empty stdout',
      async check(ctx) {
        return withProcess(
          ctx,
          'no-output',
          `fs.writeFileSync('done.txt', '${code(ctx.seed)}');`,
          {},
          async (h) => {
            const o = await h.send('go');
            return same(o.segments, []) && o.text === ''
              ? PASS
              : fail(`expected no segment and empty text, got ${show(o.segments)} and ${show(o.text)}`);
          },
        );
      },
    }),
    adapterItem({
      slug: 'process/stdin-mode',
      tier: 1,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "How a block runs": in stdin mode (the default) the instruction arrives on standard input',
      cause: 'processAdapter.send writes the instruction to the agent stdin',
      async check(ctx) {
        return withProcess(ctx, 'stdin', `process.stdout.write('got:' + input);`, {}, async (h) => {
          const o = await h.send(`Build the sheet ${code(ctx.seed)}`);
          return o.text === `got:Build the sheet ${code(ctx.seed)}`
            ? PASS
            : fail(`expected "got:Build the sheet ${code(ctx.seed)}", got ${show(o.text)}`);
        });
      },
    }),
    adapterItem({
      slug: 'process/file-mode-placeholder',
      tier: 2,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "How a block runs": in file mode the stimulus file path replaces {stimulus_file} in args, the file holds the instruction, and stdin is empty',
      cause: 'processAdapter.send writes the stimulus file and substitutes its path in args',
      async check(ctx) {
        const body = `const arg = process.argv.find((a) => a.startsWith('--in='));
const p = path.resolve(process.cwd(), arg.slice(5));
console.log(JSON.stringify({ p, env: process.env.DRIFTBENCH_STIMULUS_FILE, content: fs.readFileSync(p, 'utf8'), stdin: input }));`;
        return withProcess(
          ctx,
          'file-placeholder',
          body,
          { stimulus: 'file', extraArgs: ['--in={stimulus_file}'] },
          async (h) => {
            const o = await h.send(`Read me ${code(ctx.seed)}`);
            const got = JSON.parse(o.text) as { p: string; env: string; content: string; stdin: string };
            return expectAll([
              [
                got.content === `Read me ${code(ctx.seed)}`,
                `expected the file to hold the instruction, got ${show(got.content)}`,
              ],
              [got.stdin === '', `expected empty stdin in file mode, got ${show(got.stdin)}`],
              [
                realpathSync(got.p) === realpathSync(got.env),
                `expected the argument to name DRIFTBENCH_STIMULUS_FILE ${got.env}, got ${got.p}`,
              ],
            ]);
          },
        );
      },
    }),
    adapterItem({
      slug: 'process/file-mode-append',
      tier: 2,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "How a block runs": in file mode with no argument holding {stimulus_file}, the stimulus file path is appended to args',
      cause: 'processAdapter.send appends the stimulus file path when no argument holds the placeholder',
      async check(ctx) {
        const body = `const last = process.argv[process.argv.length - 1];
const p = path.resolve(process.cwd(), last);
console.log(JSON.stringify({ p, env: process.env.DRIFTBENCH_STIMULUS_FILE, content: fs.readFileSync(p, 'utf8') }));`;
        return withProcess(
          ctx,
          'file-append',
          body,
          { stimulus: 'file', extraArgs: ['--flag'] },
          async (h) => {
            const o = await h.send(`Appended ${code(ctx.seed)}`);
            const got = JSON.parse(o.text) as { p: string; env: string; content: string };
            return expectAll([
              [
                got.content === `Appended ${code(ctx.seed)}`,
                `expected the last argument to name the stimulus file, read ${show(got.content)}`,
              ],
              [
                realpathSync(got.p) === realpathSync(got.env),
                `expected the last argument ${got.p} to be ${got.env}`,
              ],
            ]);
          },
        );
      },
    }),
    adapterItem({
      slug: 'process/burst-blank-line',
      tier: 2,
      level: 3,
      component: PROC,
      source: 'contract',
      title: 'process.md "How a block runs": a burst arrives as its messages joined by a blank line',
      cause: 'processAdapter joins a burst with a blank line',
      async check(ctx) {
        const burst = [`first ${code(ctx.seed)}`, 'second', 'third'];
        return withProcess(ctx, 'burst', `process.stdout.write(JSON.stringify(input));`, {}, async (h) => {
          const o = await h.send({ burst });
          const got = JSON.parse(o.text) as string;
          return got === burst.join('\n\n')
            ? PASS
            : fail(`expected ${JSON.stringify(burst.join('\n\n'))} on stdin, got ${JSON.stringify(got)}`);
        });
      },
    }),
    adapterItem({
      slug: 'process/agent-variables',
      tier: 1,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "What the agent reports": DRIFTBENCH_WORKSPACE, _BLOCK, _HISTORY_FILE, _COMMANDS_FILE and _RUNTIME_FILE name the workspace files; _STIMULUS_FILE only in file mode',
      cause: 'processAdapter sets the documented DRIFTBENCH_ variables for the agent',
      async check(ctx) {
        const body = `console.log(JSON.stringify({
  cwd: fs.realpathSync(process.cwd()),
  ws: process.env.DRIFTBENCH_WORKSPACE,
  block,
  hist: process.env.DRIFTBENCH_HISTORY_FILE,
  cmds: process.env.DRIFTBENCH_COMMANDS_FILE,
  rt: process.env.DRIFTBENCH_RUNTIME_FILE,
  stim: process.env.DRIFTBENCH_STIMULUS_FILE ?? null,
}));`;
        return withProcess(ctx, 'variables', body, {}, async (h) => {
          const index = 2 + (ctx.seed % 5);
          const o = await h.send('go', { index });
          const v = JSON.parse(o.text) as Record<string, string | null>;
          const ws = v.ws ?? '';
          return expectAll([
            [
              ws !== '' && realpathSync(ws) === v.cwd,
              `expected DRIFTBENCH_WORKSPACE to be the working folder ${v.cwd}, got ${ws}`,
            ],
            [v.block === String(index), `expected DRIFTBENCH_BLOCK ${index}, got ${v.block}`],
            [
              v.hist === join(ws, 'driftbench-history.json'),
              `expected the history file in the workspace, got ${v.hist}`,
            ],
            [
              v.cmds === join(ws, 'driftbench-commands.jsonl'),
              `expected the commands file in the workspace, got ${v.cmds}`,
            ],
            [
              v.rt === join(ws, 'driftbench-runtime.jsonl'),
              `expected the runtime file in the workspace, got ${v.rt}`,
            ],
            [v.stim === null, `expected no DRIFTBENCH_STIMULUS_FILE in stdin mode, got ${v.stim}`],
          ]);
        });
      },
    }),
    adapterItem({
      slug: 'process/environment-isolation',
      tier: 2,
      level: 3,
      component: LOCAL,
      source: 'hostile',
      title: 'process.md "Options": the evaluator environment does not pass to the agent; env adds variables',
      cause: 'the local sandbox passes only the listed host variables plus env',
      async check(ctx) {
        const name = 'DRIFTBENCH_BANK_SECRET';
        const body = `console.log(JSON.stringify({ secret: process.env.${name} ?? null, given: process.env.BANK_GIVEN ?? null, path: Boolean(process.env.PATH) }));`;
        process.env[name] = `sk-evaluator-${ctx.seed}`;
        try {
          return await withProcess(
            ctx,
            'env',
            body,
            { env: { BANK_GIVEN: `given-${ctx.seed}` } },
            async (h) => {
              const v = JSON.parse((await h.send('go')).text) as Record<string, unknown>;
              return expectAll([
                [
                  v.secret === null,
                  `expected the evaluator variable ${name} not to reach the agent, it read ${show(v.secret)}`,
                ],
                [
                  v.given === `given-${ctx.seed}`,
                  `expected env BANK_GIVEN to reach the agent, got ${show(v.given)}`,
                ],
                [v.path === true, 'expected PATH to pass to the agent'],
              ]);
            },
          );
        } finally {
          delete process.env[name];
        }
      },
    }),
    adapterItem({
      slug: 'process/history-file',
      tier: 1,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "What the agent reports": driftbench-history.json holds the session history as a JSON array ending with the current user turn, prefix included',
      cause: 'processAdapter writes the session history file before each block',
      async check(ctx) {
        const prefix: Message[] = [
          { role: 'user', content: `Earlier ${code(ctx.seed)}` },
          { role: 'assistant', content: 'Earlier answer' },
        ];
        const body = `process.stdout.write(fs.readFileSync(process.env.DRIFTBENCH_HISTORY_FILE, 'utf8'));`;
        return withProcess(
          ctx,
          'history',
          body,
          {},
          async (h) => {
            const first = JSON.parse((await h.send('One')).text) as unknown;
            const second = JSON.parse((await h.send('Two')).text) as Message[];
            const want = [...prefix, { role: 'user', content: 'One' }];
            return expectAll([
              [same(first, want), `expected block 0 to read ${show(want)}, got ${show(first)}`],
              [
                second.length === 5 && same(second.at(-1), { role: 'user', content: 'Two' }),
                `expected block 1 to read 5 messages ending with "Two", got ${show(second)}`,
              ],
            ]);
          },
          { prefix },
        );
      },
    }),
    adapterItem({
      slug: 'process/commands-protocol',
      tier: 1,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "What the agent reports": each driftbench-commands.jsonl line is an execution record with role command, then one record with role agent, always last',
      cause: 'processAdapter turns reported commands into execution records followed by the agent record',
      async check(ctx) {
        const body = `fs.appendFileSync(process.env.DRIFTBENCH_COMMANDS_FILE,
  JSON.stringify({ command: 'python build.py', exitCode: 0, startedAt: '2026-10-11T00:00:00.000Z', latencyMs: ${ctx.seed} }) + '\\n' +
  JSON.stringify({ command: 'ls out', exitCode: 2 }) + '\\n');
console.log('done');`;
        return withProcess(ctx, 'commands', body, {}, async (h) => {
          const e = (await h.send('go')).executions ?? [];
          return expectAll([
            [e.length === 3, `expected 3 execution records, got ${e.length}: ${show(e)}`],
            [
              same(e[0], {
                command: 'python build.py',
                role: 'command',
                exitCode: 0,
                startedAt: '2026-10-11T00:00:00.000Z',
                latencyMs: ctx.seed,
              }),
              `expected the first reported command, got ${show(e[0])}`,
            ],
            [
              same(e[1], { command: 'ls out', role: 'command', exitCode: 2 }),
              `expected the second, got ${show(e[1])}`,
            ],
            [
              e[2]?.role === 'agent' && e[2]?.exitCode === 0 && (e[2]?.command ?? '').includes('agent.mjs'),
              `expected the agent record last with its command line, got ${show(e[2])}`,
            ],
          ]);
        });
      },
    }),
    adapterItem({
      slug: 'process/non-zero-exit-is-fact',
      tier: 1,
      level: 2,
      component: PROC,
      source: 'contract',
      title:
        'process.md "How a block runs": a non-zero exit is a fact in the agent record, not an agent failure',
      cause: 'processAdapter records a non-zero exit instead of failing the agent',
      async check(ctx) {
        const exit = 2 + (ctx.seed % 5);
        return withProcess(
          ctx,
          'exit',
          `console.log('partial'); process.stderr.write('bad ${code(ctx.seed)}'); process.exitCode = ${exit};`,
          {},
          async (h) => {
            let o: Observed | undefined;
            const error = await caught(async () => {
              o = await h.send('go');
            });
            const agent = o?.executions?.at(-1);
            return expectAll([
              [error === undefined, `expected send to resolve, got ${kindOf(error)}`],
              [
                agent?.exitCode === exit,
                `expected exit code ${exit} in the agent record, got ${show(agent)}`,
              ],
              [
                (agent?.stderr ?? '').includes(`bad ${code(ctx.seed)}`),
                `expected stderr in the agent record, got ${show(agent?.stderr)}`,
              ],
            ]);
          },
        );
      },
    }),
    adapterItem({
      slug: 'process/runtime-protocol',
      tier: 1,
      level: 3,
      component: PROTOCOL,
      source: 'contract',
      title:
        'process.md "What the agent reports": driftbench-runtime.jsonl skill, guard (with verdict) and stage lines become the runtime, at kept',
      cause: 'parseRuntime maps runtime lines onto skills, guards and stages',
      async check(ctx) {
        const body = `fs.appendFileSync(process.env.DRIFTBENCH_RUNTIME_FILE, [
  { type: 'skill', name: 'csv' },
  { type: 'guard', name: 'no_destructive_ops', verdict: 'pass', at: '2026-10-11T00:00:01.000Z' },
  { type: 'stage', name: 'add_summary_${ctx.seed}' },
].map((l) => JSON.stringify(l)).join('\\n') + '\\n');`;
        return withProcess(ctx, 'runtime', body, {}, async (h) => {
          const o = await h.send('go');
          const want = {
            skills: [{ name: 'csv' }],
            guards: [{ name: 'no_destructive_ops', verdict: 'pass', at: '2026-10-11T00:00:01.000Z' }],
            stages: [{ name: `add_summary_${ctx.seed}` }],
          };
          return same(o.runtime, want)
            ? PASS
            : fail(`expected runtime ${show(want)}, got ${show(o.runtime)}`);
        });
      },
    }),
    adapterItem({
      slug: 'process/protocol-errors',
      tier: 2,
      level: 3,
      component: PROTOCOL,
      source: 'hostile',
      title:
        'process.md "What the agent reports": a blank line is skipped; a line that is not a JSON object or misses a required field is skipped and named in raw.protocolErrors',
      cause: 'the process protocol parser skips bad lines and names each one',
      async check(ctx) {
        const body = `fs.writeFileSync(process.env.DRIFTBENCH_COMMANDS_FILE, ['', 'not json', '[1,2]', '{"command":"x"}', '{"command":"ok ${code(ctx.seed)}","exitCode":0}'].join('\\n') + '\\n');
fs.writeFileSync(process.env.DRIFTBENCH_RUNTIME_FILE, ['{"type":"guard","name":"g"}', '{"type":"tool","name":"n"}', '{"type":"skill","name":"csv"}'].join('\\n') + '\\n');`;
        return withProcess(ctx, 'protocol-errors', body, {}, async (h) => {
          const o = await h.send('go');
          const errors = ((o.raw as { protocolErrors?: string[] } | undefined)?.protocolErrors ??
            []) as string[];
          const named = (file: string, line: number) =>
            errors.some((e) => e.includes(file) && e.includes(`line ${line}`));
          return expectAll([
            [
              errors.length === 5,
              `expected 5 protocol errors (3 commands, 2 runtime), got ${errors.length}: ${show(errors, 800)}`,
            ],
            [
              named('driftbench-commands.jsonl', 2) &&
                named('driftbench-commands.jsonl', 3) &&
                named('driftbench-commands.jsonl', 4),
              `expected commands lines 2, 3 and 4 named, got ${show(errors, 800)}`,
            ],
            [
              named('driftbench-runtime.jsonl', 1) && named('driftbench-runtime.jsonl', 2),
              `expected runtime lines 1 and 2 named, got ${show(errors, 800)}`,
            ],
            [
              (o.executions ?? [])
                .filter((e) => e.role === 'command')
                .map((e) => e.command)
                .join() === `ok ${code(ctx.seed)}`,
              `expected the one good command kept, got ${show(o.executions)}`,
            ],
            [
              same(o.runtime?.skills, [{ name: 'csv' }]) && same(o.runtime?.guards, []),
              `expected skill csv kept and the guard without verdict dropped, got ${show(o.runtime)}`,
            ],
          ]);
        });
      },
    }),
    adapterItem({
      slug: 'process/protocol-errors-cap',
      tier: 2,
      level: 3,
      component: PROC,
      source: 'scale',
      title: 'process.md "How a block runs": raw.protocolErrors holds at most 20 lines',
      cause: 'processAdapter keeps at most 20 protocol errors',
      async check(ctx) {
        const bad = 25 + (ctx.seed % 10);
        const body = `fs.writeFileSync(process.env.DRIFTBENCH_COMMANDS_FILE, Array.from({ length: ${bad} }, (_, i) => 'bad ' + i).join('\\n'));`;
        return withProcess(ctx, 'protocol-cap', body, {}, async (h) => {
          const o = await h.send('go');
          const errors = ((o.raw as { protocolErrors?: string[] } | undefined)?.protocolErrors ??
            []) as string[];
          return errors.length === 20
            ? PASS
            : fail(`expected 20 protocol errors kept of ${bad}, got ${errors.length}`);
        });
      },
    }),
    adapterItem({
      slug: 'process/runtime-absent',
      tier: 1,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "What the agent reports": a runtime file the agent did not write leaves runtime absent, not empty',
      cause: 'processAdapter leaves runtime absent when no runtime file was written',
      async check(ctx) {
        return withProcess(ctx, 'runtime-absent', `console.log('${code(ctx.seed)}');`, {}, async (h) => {
          const o = await h.send('go');
          return o.runtime === undefined ? PASS : fail(`expected runtime absent, got ${show(o.runtime)}`);
        });
      },
    }),
    adapterItem({
      slug: 'process/protocol-cleared-per-block',
      tier: 2,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "What the agent reports": the adapter deletes both protocol files before each block, so what they hold belongs to that block',
      cause: 'processAdapter removes the protocol files before each block',
      async check(ctx) {
        const body = `if (block === '0') {
  fs.appendFileSync(process.env.DRIFTBENCH_COMMANDS_FILE, JSON.stringify({ command: 'first ${code(ctx.seed)}', exitCode: 0 }) + '\\n');
  fs.appendFileSync(process.env.DRIFTBENCH_RUNTIME_FILE, JSON.stringify({ type: 'stage', name: 'first' }) + '\\n');
}
console.log(String(fs.existsSync(process.env.DRIFTBENCH_COMMANDS_FILE)));`;
        return withProcess(ctx, 'protocol-cleared', body, {}, async (h) => {
          await h.send('one', { index: 0 });
          const o = await h.send('two', { index: 1 });
          return expectAll([
            [
              o.text === 'false',
              `expected no commands file at the start of block 1, the agent saw exists=${o.text}`,
            ],
            [o.runtime === undefined, `expected block 1 runtime absent, got ${show(o.runtime)}`],
            [
              (o.executions ?? []).length === 1,
              `expected only the agent record in block 1, got ${show(o.executions)}`,
            ],
          ]);
        });
      },
    }),
    adapterItem({
      slug: 'process/protocol-file-too-large',
      tier: 3,
      level: 3,
      component: PROC,
      source: 'hostile',
      title:
        'process.md "What the agent reports": a protocol file over 10 MiB is skipped and named in raw.protocolErrors',
      cause: 'processAdapter skips a protocol file over 10 MiB and names it',
      async check(ctx) {
        const body = `const line = JSON.stringify({ type: 'skill', name: 'big' }) + '\\n';
fs.writeFileSync(process.env.DRIFTBENCH_RUNTIME_FILE, line.repeat(Math.ceil((10 * 1024 * 1024 + 1) / line.length)));`;
        return withProcess(ctx, 'protocol-large', body, {}, async (h) => {
          const o = await h.send('go');
          const errors = ((o.raw as { protocolErrors?: string[] } | undefined)?.protocolErrors ??
            []) as string[];
          return expectAll([
            [
              o.runtime === undefined,
              `expected the runtime of a skipped file absent, got ${show(o.runtime, 120)}`,
            ],
            [
              errors.some((e) => e.includes('driftbench-runtime.jsonl')),
              `expected the runtime file named in protocolErrors, got ${show(errors)}`,
            ],
          ]);
        });
      },
    }),
    adapterItem({
      slug: 'process/workspace-diff-artifacts',
      tier: 1,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "How a block runs": the diff lists created, changed and deleted paths; every created or changed file is an artifact with its hash and size; protocol files never appear',
      cause:
        'processAdapter diffs the two snapshots into workspaceDiff and artifacts without the protocol files',
      async check(ctx) {
        const changed = `after ${code(ctx.seed)}`;
        const created = `new ${code(ctx.seed + 1)}`;
        const body = `fs.writeFileSync('change.txt', ${JSON.stringify(changed)});
fs.unlinkSync('gone.txt');
fs.mkdirSync('out');
fs.writeFileSync('out/new.txt', ${JSON.stringify(created)});
fs.appendFileSync(process.env.DRIFTBENCH_COMMANDS_FILE, JSON.stringify({ command: 'x', exitCode: 0 }) + '\\n');
fs.appendFileSync(process.env.DRIFTBENCH_RUNTIME_FILE, JSON.stringify({ type: 'stage', name: 's' }) + '\\n');`;
        return withProcess(
          ctx,
          'diff',
          body,
          {},
          async (h) => {
            const o = await h.send('go');
            const want = {
              diff: { created: ['out/new.txt'], changed: ['change.txt'], deleted: ['gone.txt'] },
              artifacts: [
                { path: 'change.txt', sha256: sha256(changed), bytes: Buffer.byteLength(changed) },
                { path: 'out/new.txt', sha256: sha256(created), bytes: Buffer.byteLength(created) },
              ],
            };
            return expectAll([
              [
                same(o.workspaceDiff, want.diff),
                `expected diff ${show(want.diff)}, got ${show(o.workspaceDiff)}`,
              ],
              [
                same(o.artifacts, want.artifacts),
                `expected artifacts ${show(want.artifacts)}, got ${show(o.artifacts)}`,
              ],
            ]);
          },
          {
            world: {
              workspace: { files: { 'keep.txt': 'keep', 'change.txt': 'before', 'gone.txt': 'gone' } },
            },
          },
        );
      },
    }),
    adapterItem({
      slug: 'process/given-delta-keeps-agent-files',
      tier: 2,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "How a block runs": before each block the adapter writes what the Given adds or changes; files the agent changed since stay as they are',
      cause: 'processAdapter seeds only the Given delta between blocks',
      async check(ctx) {
        const body = `if (block === '0') fs.appendFileSync('a.txt', ' agent');
process.stdout.write(fs.readFileSync('a.txt', 'utf8') + '|' + (fs.existsSync('b.txt') ? fs.readFileSync('b.txt', 'utf8') : '-') + '|' + (fs.existsSync('c.txt') ? fs.readFileSync('c.txt', 'utf8') : '-'));`;
        const w0: WorldState = { workspace: { files: { 'a.txt': 'v1', 'c.txt': 'c1' } } };
        const w1: WorldState = {
          workspace: { files: { 'a.txt': 'v1', 'b.txt': `B ${code(ctx.seed)}`, 'c.txt': 'c2' } },
        };
        return withProcess(
          ctx,
          'delta',
          body,
          {},
          async (h) => {
            await h.send('one', { index: 0, world: w0 });
            const o = await h.send('two', { index: 1, world: w1 });
            const want = `v1 agent|B ${code(ctx.seed)}|c2`;
            return o.text === want
              ? PASS
              : fail(
                  `expected block 1 to read ${JSON.stringify(want)} (agent change kept, b added, c changed), got ${JSON.stringify(o.text)}`,
                );
          },
          { world: w0 },
        );
      },
    }),
    adapterItem({
      slug: 'process/command-not-found',
      tier: 1,
      level: 2,
      component: PROC,
      source: 'contract',
      title: 'process.md "Errors": an agent command that is not found is an AdapterTransportError at open',
      cause: 'processAdapter.open checks the agent command and reports a missing one as a transport error',
      async check(ctx) {
        const dir = folderFor(ctx, 'not-found');
        const adapter = processAdapter({
          command: join(dir, `missing-agent-${ctx.seed}`),
          provider: localProvider({ dir: join(dir, 'sandboxes') }),
        });
        const error = await caught(adapter.open(givenOf()));
        const left = existsSync(join(dir, 'sandboxes')) ? readdirSync(join(dir, 'sandboxes')) : [];
        return expectAll([
          [error instanceof AdapterTransportError, `expected AdapterTransportError, got ${kindOf(error)}`],
          [left.length === 0, `expected the sandbox removed after the failed open, found ${show(left)}`],
        ]);
      },
    }),
    adapterItem({
      slug: 'process/unreadable-from',
      tier: 2,
      level: 2,
      component: PROC,
      source: 'contract',
      title:
        'process.md "Errors": a workspace from folder that cannot be read fails the run at once: neither a transport error nor an agent failure',
      cause: 'processAdapter.open lets a seeding configuration error through as it is',
      async check(ctx) {
        const dir = folderFor(ctx, 'unreadable-from');
        const adapter = processAdapter({
          command: process.execPath,
          provider: localProvider({ dir: join(dir, 'sandboxes') }),
        });
        const error = await caught(
          adapter.open(givenOf({ world: { workspace: { from: join(dir, `nowhere-${ctx.seed}`) } } })),
        );
        return error !== undefined &&
          !(error instanceof AdapterTransportError) &&
          !(error instanceof AgentFailure)
          ? PASS
          : fail(`expected a plain error that fails the run at once, got ${kindOf(error)}`);
      },
    }),
    adapterItem({
      slug: 'process/timeout-kills-group',
      tier: 2,
      level: 3,
      component: RUN,
      source: 'contract',
      title:
        'process.md "Sandboxes": a command is killed after its timeout with everything it started; its exit code is then 124',
      cause: 'the sandbox kills a timed-out agent and its process group and reports 124',
      async check(ctx) {
        const body = `cp.spawn('/bin/sh', ['-c', 'sleep 0.4; echo late > late.txt'], { stdio: 'ignore' });
setTimeout(() => {}, 5000);`;
        return withProcess(ctx, 'timeout', body, { timeoutMs: 200, keep: true }, async (h) => {
          const o = await h.send('go');
          await sleep(700);
          const root = o.sandbox?.root ?? '';
          const agent = o.executions?.at(-1);
          return expectAll([
            [
              agent?.exitCode === 124,
              `expected exit code 124 after the timeout, got ${show(agent?.exitCode)}`,
            ],
            [
              root !== '' && !existsSync(join(root, 'late.txt')),
              `expected the child the agent started to be killed, late.txt exists in ${root}`,
            ],
          ]);
        });
      },
    }),
    adapterItem({
      slug: 'process/timeout-kills-detached-child',
      tier: 4,
      level: 3,
      component: RUN,
      source: 'hostile',
      title:
        'process.md "Sandboxes": everything the agent started is killed at the timeout, also a child it started in its own process group',
      cause: 'the sandbox kills children that left the agent process group, at the timeout and at the exit',
      async check(ctx) {
        const body = `cp.spawn('/bin/sh', ['-c', 'sleep 0.4; echo late > late.txt'], { stdio: 'ignore', detached: true }).unref();
setTimeout(() => {}, 5000);`;
        return withProcess(ctx, 'timeout-detached', body, { timeoutMs: 200, keep: true }, async (h) => {
          const o = await h.send('go');
          await sleep(700);
          const root = o.sandbox?.root ?? '';
          return root !== '' && !existsSync(join(root, 'late.txt'))
            ? PASS
            : fail(
                `expected the detached child killed with the agent at the timeout, but it ran on and wrote late.txt in ${root}`,
              );
        });
      },
    }),
    adapterItem({
      slug: 'process/exit-kills-detached-child',
      tier: 4,
      level: 3,
      component: RUN,
      source: 'hostile',
      title:
        'packages/sandbox/src/run.ts and process.md "Sandboxes": when the agent exits, a background child it left running is killed with it, also one it started in its own process group',
      cause: 'the sandbox kills children that left the agent process group, at the timeout and at the exit',
      async check(ctx) {
        const body = `cp.spawn('/bin/sh', ['-c', 'sleep 0.4; echo late > late.txt'], { stdio: 'ignore', detached: true }).unref();
console.log('R-${1000 + ctx.seed}');`;
        return withProcess(ctx, 'exit-detached', body, { timeoutMs: 5000, keep: true }, async (h) => {
          const o = await h.send('go');
          await sleep(700);
          const root = o.sandbox?.root ?? '';
          return root !== '' && !existsSync(join(root, 'late.txt'))
            ? PASS
            : fail(
                `expected the detached child killed when the agent exited, but it ran on and wrote late.txt in ${root}`,
              );
        });
      },
    }),
    adapterItem({
      slug: 'process/budget-lowers-timeout',
      tier: 2,
      level: 3,
      component: PROC,
      source: 'contract',
      title: 'process.md "Options": a block budget.latency_ms lowers the timeout',
      cause: 'processAdapter.send takes the lower of timeoutMs and the block latency budget',
      async check(ctx) {
        return withProcess(
          ctx,
          'budget',
          `setTimeout(() => console.log('late'), 4000);`,
          { timeoutMs: 60_000 },
          async (h) => {
            const started = Date.now();
            const o = await h.send('go', { budget: { latencyMs: 250 + (ctx.seed % 3) * 50 } });
            const took = Date.now() - started;
            const agent = o.executions?.at(-1);
            return expectAll([
              [
                agent?.exitCode === 124,
                `expected exit code 124 from the budget, got ${show(agent?.exitCode)}`,
              ],
              [took < 3000, `expected the block to stop near the budget, it took ${took} ms`],
            ]);
          },
        );
      },
    }),
    adapterItem({
      slug: 'process/signal-exit-code',
      tier: 2,
      level: 3,
      component: RUN,
      source: 'contract',
      title: 'process.md "Sandboxes": a command killed by a signal exits with 128 plus the signal number',
      cause: 'the sandbox reports a signal death as 128 plus the signal number',
      async check(ctx) {
        return withProcess(
          ctx,
          'signal',
          `process.kill(process.pid, 'SIGTERM'); setTimeout(() => {}, 2000);`,
          {},
          async (h) => {
            const agent = (await h.send('go')).executions?.at(-1);
            return agent?.exitCode === 143
              ? PASS
              : fail(`expected exit code 143 (128 + SIGTERM 15), got ${show(agent?.exitCode)}`);
          },
        );
      },
    }),
    adapterItem({
      slug: 'process/stdout-cut',
      tier: 3,
      level: 3,
      component: RUN,
      source: 'scale',
      title: 'process.md "Sandboxes": standard output is cut at 10 MiB, and the record says so',
      cause: 'the sandbox cuts stdout at 10 MiB and marks the record truncated',
      async check(ctx) {
        return withProcess(
          ctx,
          'stdout-cut',
          `process.stdout.write('a'.repeat(11 * 1024 * 1024));`,
          {},
          async (h) => {
            const o = await h.send('go');
            const agent = o.executions?.at(-1);
            return expectAll([
              [
                o.text.length === 10 * 1024 * 1024,
                `expected 10485760 characters of text, got ${o.text.length}`,
              ],
              [
                agent?.truncated === true,
                `expected truncated true on the agent record, got ${show(agent?.truncated)}`,
              ],
            ]);
          },
        );
      },
    }),
    adapterItem({
      slug: 'process/depth-bound',
      tier: 3,
      level: 2,
      component: PROC,
      source: 'hostile',
      title:
        'process.md "Sandboxes" and "Errors": a workspace 32 folder levels deep is fine; past 32 levels the agent left a workspace past the bounds, an AgentFailure',
      cause: 'processAdapter fails the agent when the workspace snapshot passes its bounds',
      async check(ctx) {
        const body = `const levels = block === '0' ? 32 : 33;
const dir = path.join(...Array.from({ length: levels }, () => 'd'));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'f${ctx.seed}.txt'), 'x');`;
        return withProcess(ctx, 'depth', body, {}, async (h) => {
          const ok = await caught(h.send('one', { index: 0 }));
          const deep = await caught(h.send('two', { index: 1 }));
          return expectAll([
            [ok === undefined, `expected 32 levels to be within the bounds, got ${kindOf(ok)}`],
            [deep instanceof AgentFailure, `expected AgentFailure past 32 levels, got ${kindOf(deep)}`],
          ]);
        });
      },
    }),
    adapterItem({
      slug: 'process/skips-node-modules-git',
      tier: 2,
      level: 3,
      component: WALK,
      source: 'contract',
      title: 'process.md "Sandboxes": a snapshot never enters node_modules or .git',
      cause: 'the workspace walk skips node_modules and .git',
      async check(ctx) {
        const body = `fs.mkdirSync('node_modules/pkg', { recursive: true }); fs.writeFileSync('node_modules/pkg/index.js', '1');
fs.mkdirSync('.git'); fs.writeFileSync('.git/HEAD', 'ref');
fs.mkdirSync('src/node_modules', { recursive: true }); fs.writeFileSync('src/node_modules/x.js', '2');
fs.writeFileSync('src/a${ctx.seed}.js', '3');`;
        return withProcess(ctx, 'skip-dirs', body, {}, async (h) => {
          const o = await h.send('go');
          return same(o.workspaceDiff?.created, [`src/a${ctx.seed}.js`])
            ? PASS
            : fail(`expected only src/a${ctx.seed}.js created, got ${show(o.workspaceDiff?.created)}`);
        });
      },
    }),
    adapterItem({
      slug: 'process/planted-link',
      tier: 3,
      level: 2,
      component: FOLDER,
      source: 'hostile',
      title:
        'process.md "Errors": a workspace the next block cannot be written to, such as a planted link, is an AgentFailure, and nothing is written through the link',
      cause: 'processAdapter refuses to seed through a link the agent planted and fails the agent',
      async check(ctx) {
        const outside = join(folderFor(ctx, 'planted-link-outside'), 'target');
        mkdirSync(outside, { recursive: true });
        const body = `if (block === '0') fs.symlinkSync(process.env.OUTSIDE, 'data');`;
        return withProcess(ctx, 'planted-link', body, { env: { OUTSIDE: outside } }, async (h) => {
          await h.send('one', { index: 0 });
          const error = await caught(
            h.send('two', { index: 1, world: { workspace: { files: { 'data/in.txt': code(ctx.seed) } } } }),
          );
          return expectAll([
            [error instanceof AgentFailure, `expected AgentFailure for a planted link, got ${kindOf(error)}`],
            [
              !existsSync(join(outside, 'in.txt')),
              'expected nothing written through the link, found in.txt outside',
            ],
          ]);
        });
      },
    }),
    adapterItem({
      slug: 'process/read-artifact',
      tier: 1,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "Reading files and closing": readArtifact reads a file of the workspace byte for byte',
      cause: 'processAdapter.readArtifact reads a produced file back',
      async check(ctx) {
        const body = `fs.mkdirSync('out'); fs.writeFileSync('out/sheet.csv', Buffer.from([0, 255, 82, 45, ${ctx.seed % 200}, 10]));`;
        return withProcess(ctx, 'read-artifact', body, {}, async (h) => {
          await h.send('go');
          const bytes = await h.adapter.readArtifact(h.session, 'out/sheet.csv');
          const want = [0, 255, 82, 45, ctx.seed % 200, 10];
          return same([...bytes], want)
            ? PASS
            : fail(`expected bytes ${show(want)}, got ${show([...bytes])}`);
        });
      },
    }),
    adapterItem({
      slug: 'process/read-artifact-outside',
      tier: 3,
      level: 3,
      component: FOLDER,
      source: 'hostile',
      title:
        'process.md "Reading files and closing": a path outside the workspace is refused, by .., by an absolute path or through a link the agent planted',
      cause: 'the sandbox read refuses paths that leave the workspace',
      async check(ctx) {
        const secretDir = folderFor(ctx, 'read-outside-secret');
        const secret = join(secretDir, 'secret.txt');
        writeFileSync(secret, `secret ${code(ctx.seed)}`);
        const body = `fs.symlinkSync(process.env.SECRET, 'leak.txt');`;
        return withProcess(ctx, 'read-outside', body, { env: { SECRET: secret } }, async (h) => {
          await h.send('go');
          const leaks: string[] = [];
          for (const path of ['../agent.mjs', '../../agent.mjs', secret, 'leak.txt']) {
            const error = await caught(h.adapter.readArtifact(h.session, path));
            if (error === undefined) leaks.push(path);
          }
          return leaks.length === 0
            ? PASS
            : fail(`expected every outside path refused, these were read: ${leaks.join(', ')}`);
        });
      },
    }),
    adapterItem({
      slug: 'process/close-removes',
      tier: 1,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "Reading files and closing": close removes the sandbox, a second call does nothing, and a later send rejects',
      cause: 'processAdapter.close removes the sandbox once and closes the session',
      async check(ctx) {
        return withProcess(
          ctx,
          'close',
          `process.stdout.write(fs.realpathSync(process.cwd()));`,
          {},
          async (h) => {
            const folder = (await h.send('go')).text;
            await h.adapter.close(h.session);
            const second = await caught(h.adapter.close(h.session));
            const late = await caught(h.send('late'));
            return expectAll([
              [folder !== '' && !existsSync(folder), `expected the sandbox folder ${folder} removed`],
              [second === undefined, `expected a second close to do nothing, got ${kindOf(second)}`],
              [late !== undefined, 'expected send after close to reject, it resolved'],
            ]);
          },
        );
      },
    }),
    adapterItem({
      slug: 'process/keep-names-folder',
      tier: 2,
      level: 3,
      component: PROC,
      source: 'contract',
      title:
        'process.md "Options" and "How a block runs": keep leaves the sandbox on disk after close, and a kept sandbox names its folder on the Observed',
      cause: 'processAdapter keeps a sandbox when asked and names its folder',
      async check(ctx) {
        return withProcess(
          ctx,
          'keep',
          `process.stdout.write(fs.realpathSync(process.cwd()));`,
          { keep: true },
          async (h) => {
            const o = await h.send('go');
            await h.adapter.close(h.session);
            const root = o.sandbox?.root;
            return expectAll([
              [
                root !== undefined && realpathSync(root) === o.text,
                `expected sandbox.root ${o.text}, got ${show(root)}`,
              ],
              [
                root !== undefined && existsSync(root),
                `expected the kept folder ${root} on disk after close`,
              ],
            ]);
          },
        );
      },
    }),
    adapterItem({
      slug: 'process/history-is-a-copy',
      tier: 2,
      level: 3,
      component: PROC,
      source: 'differential',
      title:
        'process.md "How a block runs": handed-over host messages reject writes, and child edits of serialised history cannot change host history or another turn',
      cause: 'processAdapter protects host messages at handoff and isolates child history edits',
      async check(ctx) {
        const prefix: Message[] = [{ role: 'user', content: `Earlier ${code(ctx.seed)}` }];
        const prefixBefore = JSON.stringify(prefix);
        const body = `
const file = process.env.DRIFTBENCH_HISTORY_FILE;
const messages = JSON.parse(fs.readFileSync(file, 'utf8'));
const before = JSON.stringify(messages);
messages[0].content = 'edited in the child';
messages.push({ role: 'assistant', content: 'smuggled' });
fs.writeFileSync(file, JSON.stringify(messages));
process.stdout.write(JSON.stringify({ before, after: fs.readFileSync(file, 'utf8') }));`;
        return withProcess(
          ctx,
          'history-copy',
          body,
          {},
          async ({ adapter, session }) => {
            const givenBefore = JSON.stringify(session.given);
            const historyAtOpen = JSON.stringify(session.history);
            const callerError = await caught(async () => {
              (prefix[0] as Message).content = 'edited by the caller';
            });
            const sessionError = await caught(async () => {
              (session.history[0] as Message).content = 'edited in the session';
            });
            const checks: Array<readonly [boolean, string]> = [
              [historyAtOpen === prefixBefore, 'expected history to equal the prefix at open'],
              [
                JSON.stringify(session.history) === historyAtOpen,
                'a host write changed session history bytes',
              ],
              [JSON.stringify(session.given) === givenBefore, 'a host write changed Given bytes'],
              [
                callerError instanceof TypeError,
                `expected a caller message write to throw TypeError, got ${kindOf(callerError)}`,
              ],
              [
                sessionError instanceof TypeError,
                `expected a session message write to throw TypeError, got ${kindOf(sessionError)}`,
              ],
            ];
            for (let index = 0; index < 2; index += 1) {
              const user = `Now ${code(ctx.seed)} turn ${index}`;
              const message: Message = { role: 'user', content: user };
              session.history.push(message);
              const historyBefore = JSON.stringify(session.history);
              const observed = await adapter.send(session, {
                index,
                stimulus: { user },
                given: session.given,
              });
              const child = JSON.parse(observed.text) as { before: string; after: string };
              const expectedEdit = JSON.parse(historyBefore) as Message[];
              (expectedEdit[0] as Message).content = 'edited in the child';
              expectedEdit.push({ role: 'assistant', content: 'smuggled' });
              checks.push(
                [child.before === historyBefore, `turn ${index}: the child received a changed history view`],
                [
                  child.after === JSON.stringify(expectedEdit),
                  `turn ${index}: the child did not perform its serialised history edit`,
                ],
                [
                  JSON.stringify(session.history) === historyBefore,
                  `turn ${index}: the child changed host history bytes`,
                ],
                [
                  JSON.stringify(session.given) === givenBefore,
                  `turn ${index}: the child changed Given bytes`,
                ],
              );
              const lateError = await caught(async () => {
                message.content = 'edited after send';
              });
              checks.push(
                [
                  JSON.stringify(session.history) === historyBefore,
                  `turn ${index}: a late caller write changed history bytes`,
                ],
                [
                  lateError instanceof TypeError,
                  `turn ${index}: expected a handed-over message write to throw TypeError, got ${kindOf(lateError)}`,
                ],
              );
            }
            return expectAll(checks);
          },
          { prefix },
        );
      },
    }),
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* store-stress                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

const CLOCK = '2026-10-11T00:00:00.000Z';

function campaignOf(campaignId: string, run: RunResult, extra: Partial<Campaign> = {}): Campaign {
  return {
    campaignId,
    specs: [{ id: run.specId, hash: run.specHash }],
    targets: [TARGET],
    modes: ['F'],
    repeats: { T: 0, F: 1, P: 0 },
    budgetUsd: 0,
    judge: { mode: 'system1', judges: [] },
    createdAt: CLOCK,
    ...extra,
  };
}

/** One real run of a three-block planted flow, the base every store item starts from. */
async function baseRun(seed: number, tag: string): Promise<RunResult> {
  const planted = plantedFlow(seed, `store-${tag}`, 3);
  return runScenario(planted.spec, behavioursFor(planted, new Map([[1, ['X1_local']]])), { target: TARGET });
}

function variant(run: RunResult, runId: string, extra: Partial<RunResult> = {}): RunResult {
  return { ...structuredClone(run), runId, ...extra };
}

async function withStore<T>(path: string, use: (store: SqliteStore) => Promise<T>): Promise<T> {
  const store = openStore(path);
  try {
    return await use(store);
  } finally {
    await store.close();
  }
}

async function codeOf(work: Promise<unknown> | (() => Promise<unknown>)): Promise<string> {
  return kindOf(await caught(work));
}

/** Edits the file by hand, outside the store, as a person with sqlite3 would. */
function editByHand(path: string, sql: string, ...params: (string | number | Uint8Array | null)[]): void {
  const db = new DatabaseSync(path);
  try {
    db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}

function readByHand(path: string, sql: string): Record<string, unknown> | undefined {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(sql).get() as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }
}

/** A store file holding one campaign and one run, closed. */
async function seededFile(
  ctx: ItemContext,
  tag: string,
): Promise<{ path: string; run: RunResult; dir: string }> {
  const dir = folderFor(ctx, `store-${tag}`);
  const path = join(dir, 'store.sqlite');
  const run = variant(await baseRun(ctx.seed, tag), `r-${tag}-${ctx.seed}`);
  await withStore(path, async (store) => {
    await store.putCampaign(campaignOf('c-1', run));
    await store.putRun('c-1', run);
  });
  return { path, run, dir };
}

/** Runs a node script in a child process and resolves with its exit code, stdout and stderr. */
function runChild(
  args: string[],
  options: { cwd?: string; onLine?: (line: string) => void } = {},
): Promise<{ code: number | null; signal: NodeJS.Signals | null; out: string; err: string }> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let pending = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
      pending += chunk.toString('utf8');
      let at = pending.indexOf('\n');
      while (at >= 0) {
        options.onLine?.(pending.slice(0, at));
        pending = pending.slice(at + 1);
        at = pending.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('close', (code, signal) => done({ code, signal, out, err }));
  });
}

const HOLD_LOCK = `import { DatabaseSync } from 'node:sqlite';
const [path, id, json, end, holdMs] = process.argv.slice(2);
const db = new DatabaseSync(path);
db.exec('BEGIN IMMEDIATE');
db.prepare('INSERT INTO campaigns (id, json, created_at) VALUES (?, ?, ?)').run(id, json, '${CLOCK}');
console.log('ready');
setTimeout(() => { db.exec(end === 'commit' ? 'COMMIT' : 'ROLLBACK'); db.close(); console.log('done'); }, Number(holdMs));
`;

function storeItems(): BankItem[] {
  const out: BankItem[] = [];

  out.push(
    storeItem({
      slug: 'two-handles-interleave',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'adversarial',
      title:
        'docs/running.md "The store": two writers on one SQLite file, putting runs in turn, each see every run the other put',
      cause: 'the store reads every call from the file, never from a per-handle copy',
      async check(ctx) {
        const dir = folderFor(ctx, 'store-two-handles');
        const path = join(dir, 'store.sqlite');
        const base = await baseRun(ctx.seed, 'two-handles');
        const a = openStore(path);
        const b = openStore(path);
        try {
          await a.putCampaign(campaignOf('c-two', base));
          const n = 10 + (ctx.seed % 5);
          const ids = Array.from({ length: n }, (_, i) => `r-${String(i).padStart(3, '0')}`);
          await Promise.all(ids.map((id, i) => (i % 2 === 0 ? a : b).putRun('c-two', variant(base, id))));
          const fromA = (await a.listRuns({ campaignId: 'c-two' })).map((r) => r.runId).sort();
          const fromB = (await b.listRuns({ campaignId: 'c-two' })).map((r) => r.runId).sort();
          return expectAll([
            [same(fromA, ids), `expected handle A to list all ${n} runs, got ${show(fromA)}`],
            [same(fromB, ids), `expected handle B to list all ${n} runs, got ${show(fromB)}`],
          ]);
        } finally {
          await a.close();
          await b.close();
        }
      },
    }),
    storeItem({
      slug: 'writer-waits-for-lock',
      tier: 3,
      level: 1,
      component: STORE,
      source: 'adversarial',
      title:
        'docs/running.md "The store": a write while another process holds the write lock waits for it, and both writes land',
      cause: 'the store waits for a busy database instead of failing the write',
      async check(ctx) {
        const { path, run, dir } = await seededFile(ctx, 'lock-wait');
        const script = join(dir, 'hold.mjs');
        writeFileSync(script, HOLD_LOCK);
        const store = openStore(path);
        try {
          let writeResult = 'not tried';
          const child = runChild(
            [script, path, 'c-other', JSON.stringify(campaignOf('c-other', run)), 'commit', '300'],
            {
              onLine: (line) => {
                if (line === 'ready') {
                  void codeOf(store.putCampaign(campaignOf('c-main', run))).then((k) => {
                    writeResult = k;
                  });
                }
              },
            },
          );
          const ended = await child;
          await sleep(50);
          const ids = (await store.listCampaigns()).map((c) => c.campaignId).sort();
          return expectAll([
            [
              ended.code === 0,
              `expected the lock holder to finish, it exited ${ended.code}: ${ended.err.slice(0, 200)}`,
            ],
            [writeResult === 'no error', `expected the put to wait and succeed, got ${writeResult}`],
            [same(ids, ['c-1', 'c-main', 'c-other']), `expected both writes to land, got ${show(ids)}`],
          ]);
        } finally {
          await store.close();
        }
      },
    }),
    storeItem({
      slug: 'reads-skip-uncommitted',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'adversarial',
      title:
        'docs/running.md "The store": while another process holds an open write, reads return the committed state and never its uncommitted rows',
      cause: 'the store reads committed rows only while another writer is in flight',
      async check(ctx) {
        const { path, dir } = await seededFile(ctx, 'uncommitted');
        const script = join(dir, 'hold.mjs');
        writeFileSync(script, HOLD_LOCK);
        const store = openStore(path);
        try {
          let during = 'not read';
          const child = runChild([script, path, 'c-ghost', '{"campaignId":"c-ghost"}', 'rollback', '400'], {
            onLine: (line) => {
              if (line === 'ready') {
                void store.listCampaigns().then(
                  (cs) => {
                    during = cs.map((c) => c.campaignId).join(',');
                  },
                  (error: unknown) => {
                    during = kindOf(error);
                  },
                );
              }
            },
          });
          await child;
          const after = (await store.listCampaigns()).map((c) => c.campaignId).join(',');
          return expectAll([
            [during === 'c-1', `expected the read during the open write to list c-1 only, got ${during}`],
            [after === 'c-1', `expected the rolled-back row absent after, got ${after}`],
          ]);
        } finally {
          await store.close();
        }
      },
    }),
    storeItem({
      slug: 'crash-mid-write',
      tier: 3,
      level: 1,
      component: STORE,
      source: 'hostile',
      title:
        'docs/running.md "The worker pool": a crash loses no finished run: a writer killed in the middle of a large write leaves the committed records whole',
      cause: 'the store recovers a file left by a writer killed mid-transaction to its last commit',
      async check(ctx) {
        const { path, run, dir } = await seededFile(ctx, 'crash');
        const script = join(dir, 'crash.mjs');
        writeFileSync(
          script,
          `import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2]);
db.exec('PRAGMA cache_size = 2');
db.exec('BEGIN IMMEDIATE');
db.exec('DELETE FROM blocks');
db.exec('DELETE FROM runs');
const insert = db.prepare('INSERT INTO campaigns (id, json, created_at) VALUES (?, ?, ?)');
for (let i = 0; i < 300; i++) insert.run('c-ghost-' + i, '{"pad":"' + 'x'.repeat(8000) + '"}', 'now');
process.kill(process.pid, 'SIGKILL');
`,
        );
        const ended = await runChild([script, path]);
        return withStore(path, async (store) => {
          const ids = (await store.listCampaigns()).map((c) => c.campaignId);
          const back = await store.getRun(run.runId, 'c-1');
          return expectAll([
            [
              ended.signal === 'SIGKILL',
              `expected the writer killed, it ended with ${ended.code} ${ended.signal}`,
            ],
            [
              same(ids, ['c-1']),
              `expected only the committed campaign c-1, got ${show(ids.slice(0, 5))} (${ids.length})`,
            ],
            [same(back, run), 'expected the committed run back whole after the crash'],
          ]);
        });
      },
    }),
    storeItem({
      slug: 'torn-read-during-replace',
      tier: 4,
      level: 1,
      component: STORE,
      source: 'adversarial',
      title:
        'docs/running.md "The store": getRun racing another process that replaces the same run reads one whole version, never the summary of one and the blocks of another',
      cause: 'the store reads a run and its blocks in one read transaction',
      async check(ctx) {
        const dir = folderFor(ctx, 'store-torn');
        const path = join(dir, 'store.sqlite');
        const base = await baseRun(ctx.seed, 'torn');
        const pad = 'p'.repeat(1_500_000);
        const target: TargetRef = { ...TARGET, options: { pad } };
        const three = variant(base, 'r-torn', { cost: 3, target, blocks: base.blocks.slice(0, 3) });
        const one = variant(base, 'r-torn', { cost: 1, target, blocks: base.blocks.slice(0, 1) });
        if (three.blocks.length !== 3)
          return fail(`the base run has ${three.blocks.length} blocks, the item needs 3`);
        await withStore(path, async (store) => {
          await store.putCampaign(campaignOf('c-race', base));
          await store.putRun('c-race', three);
        });
        const runsFile = join(dir, 'runs.json');
        writeFileSync(runsFile, JSON.stringify([three, one]));
        const childScript = join(dir, 'writer.mts');
        writeFileSync(
          childScript,
          `import { readFileSync } from 'node:fs';
import { openStore } from ${JSON.stringify(join(ctx.root, 'packages/store/src/index.ts'))};
const [path, runsFile, n] = process.argv.slice(2);
const versions = JSON.parse(readFileSync(runsFile, 'utf8'));
const store = openStore(path);
console.log('ready');
for (let i = 0; i < Number(n); i++) await store.putRun('c-race', versions[i % 2]);
await store.close();
`,
        );
        const store = openStore(path);
        let reads = 0;
        const torn: string[] = [];
        const other: string[] = [];
        let started = false;
        let running = true;
        const child = runChild(['--import', 'tsx', childScript, path, runsFile, '60'], {
          cwd: ctx.root,
          onLine: (line) => {
            if (line === 'ready') started = true;
          },
        }).finally(() => {
          running = false;
        });
        try {
          while (running) {
            if (!started) {
              await sleep(10);
              continue;
            }
            try {
              const run = await store.getRun('r-torn', 'c-race');
              reads += 1;
              if (run && run.cost !== run.blocks.length)
                torn.push(`cost ${run.cost} with ${run.blocks.length} blocks`);
            } catch (error) {
              other.push(kindOf(error));
            }
            await new Promise((done) => setImmediate(done));
          }
          const ended = await child;
          return expectAll([
            [
              ended.code === 0,
              `expected the writer to finish, it exited ${ended.code}: ${ended.err.slice(0, 300)}`,
            ],
            [reads > 0, 'expected at least one read during the writes'],
            [
              torn.length === 0,
              `expected every read to be one whole version, ${torn.length} of ${reads} reads mixed versions: ${torn.slice(0, 3).join('; ')}`,
            ],
            [other.length === 0, `expected no error while racing, got ${[...new Set(other)].join('; ')}`],
          ]);
        } finally {
          await store.close();
        }
      },
    }),
    storeItem({
      slug: 'truncated-file',
      tier: 3,
      level: 1,
      component: STORE,
      source: 'hostile',
      title:
        'packages/store/src/errors.ts: a truncated database file fails with a StoreError code (OPEN_FAILED or CORRUPT_ROW), never a raw SQLite error',
      cause: 'the store turns a malformed database into a StoreError with a documented code',
      async check(ctx) {
        const dir = folderFor(ctx, 'store-truncated');
        const path = join(dir, 'store.sqlite');
        const base = await baseRun(ctx.seed, 'truncated');
        await withStore(path, async (store) => {
          await store.putCampaign(campaignOf('c-t', base));
          for (let i = 0; i < 8; i++) await store.putRun('c-t', variant(base, `r-${i}`));
        });
        const size = statSync(path).size;
        truncateSync(path, Math.floor(size * 0.55));
        let opened: SqliteStore | undefined;
        const openError = await caught(async () => {
          opened = openStore(path);
        });
        if (openError !== undefined) {
          return openError instanceof StoreError && openError.code === 'OPEN_FAILED'
            ? PASS
            : fail(`expected StoreError OPEN_FAILED at open, got ${kindOf(openError)}`);
        }
        const store = opened as SqliteStore;
        try {
          const problems: string[] = [];
          for (const [name, work] of [
            ['listCampaigns', () => store.listCampaigns()],
            ['listRuns', () => store.listRuns()],
            ['getRun', () => store.getRun('r-7', 'c-t')],
          ] as const) {
            const error = await caught(work);
            if (
              error !== undefined &&
              !(error instanceof StoreError && ['OPEN_FAILED', 'CORRUPT_ROW'].includes(error.code))
            ) {
              problems.push(`${name}: ${kindOf(error)}`);
            }
          }
          return problems.length === 0
            ? PASS
            : fail(
                `expected StoreError OPEN_FAILED or CORRUPT_ROW from a truncated file (${size} to ${Math.floor(size * 0.55)} bytes), got ${problems.join('; ')}`,
              );
        } finally {
          await store.close().catch(() => undefined);
        }
      },
    }),
    storeItem({
      slug: 'header-cut-file',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'hostile',
      title:
        'packages/store/src/errors.ts OPEN_FAILED: a database file cut inside its header cannot be opened',
      cause: 'openStore reports a file cut inside its header as OPEN_FAILED',
      async check(ctx) {
        const { path } = await seededFile(ctx, 'header-cut');
        truncateSync(path, 40 + (ctx.seed % 50));
        const code = await codeOf(async () => {
          const store = openStore(path);
          try {
            await store.listCampaigns();
          } finally {
            await store.close();
          }
        });
        return code === 'StoreError OPEN_FAILED'
          ? PASS
          : fail(`expected StoreError OPEN_FAILED, got ${code}`);
      },
    }),
    storeItem({
      slug: 'foreign-file',
      tier: 1,
      level: 1,
      component: STORE,
      source: 'hostile',
      title: 'packages/store/src/errors.ts OPEN_FAILED: --store pointing at a text file is refused at open',
      cause: 'openStore reports a file that is not a database as OPEN_FAILED',
      async check(ctx) {
        const dir = folderFor(ctx, 'store-foreign');
        const path = join(dir, 'notes.sqlite');
        writeFileSync(path, `Meeting notes R-${1000 + ctx.seed}\n`.repeat(400));
        const before = readFileSync(path, 'utf8');
        const code = await codeOf(async () => {
          openStore(path);
        });
        return expectAll([
          [code === 'StoreError OPEN_FAILED', `expected StoreError OPEN_FAILED, got ${code}`],
          [readFileSync(path, 'utf8') === before, 'expected the foreign file left as it was'],
        ]);
      },
    }),
    storeItem({
      slug: 'directory-path',
      tier: 1,
      level: 1,
      component: STORE,
      source: 'adversarial',
      title: 'packages/store/src/errors.ts OPEN_FAILED: a store path that is a folder is refused at open',
      cause: 'openStore reports a folder path as OPEN_FAILED',
      async check(ctx) {
        const dir = folderFor(ctx, 'store-folder-path');
        const code = await codeOf(async () => {
          openStore(dir);
        });
        return code === 'StoreError OPEN_FAILED'
          ? PASS
          : fail(`expected StoreError OPEN_FAILED for a folder, got ${code}`);
      },
    }),
    storeItem({
      slug: 'empty-file',
      tier: 1,
      level: 1,
      component: STORE,
      source: 'adversarial',
      title:
        'docs/running.md "The store": --store opens or creates the file; an empty file becomes a working store',
      cause: 'openStore sets up the tables in an empty file',
      async check(ctx) {
        const dir = folderFor(ctx, 'store-empty');
        const path = join(dir, 'store.sqlite');
        writeFileSync(path, '');
        const run = await baseRun(ctx.seed, 'empty');
        const code = await codeOf(
          withStore(path, async (store) => {
            await store.putCampaign(campaignOf('c-e', run));
            await store.putRun('c-e', run);
            if ((await store.listRuns()).length !== 1) throw new Error('the run did not come back');
          }),
        );
        return code === 'no error' ? PASS : fail(`expected an empty file to open as a store, got ${code}`);
      },
    }),
    storeItem({
      slug: 'missing-folders-created',
      tier: 1,
      level: 1,
      component: STORE,
      source: 'contract',
      title: 'docs/running.md "The store": --store <file> creates the file, and its missing parent folders',
      cause: 'openStore creates the missing parent folders of the file',
      async check(ctx) {
        const dir = folderFor(ctx, 'store-nested');
        const path = join(dir, 'a', 'b', `c-${ctx.seed}`, 'store.sqlite');
        const code = await codeOf(withStore(path, async (store) => store.listCampaigns()));
        return code === 'no error' && existsSync(path) ? PASS : fail(`expected ${path} created, got ${code}`);
      },
    }),
    storeItem({
      slug: 'hand-edit-run-json',
      tier: 1,
      level: 1,
      component: STORE,
      source: 'hostile',
      title: 'errors.ts CORRUPT_ROW: a runs row whose JSON was edited by hand into text that does not parse',
      cause: 'readRun raises CORRUPT_ROW for a run summary that does not parse',
      async check(ctx) {
        const { path, run } = await seededFile(ctx, 'edit-run-json');
        editByHand(path, 'UPDATE runs SET json = ? WHERE run_id = ?', '{"runId": "half', run.runId);
        const code = await codeOf(withStore(path, (store) => store.getRun(run.runId, 'c-1')));
        return code === 'StoreError CORRUPT_ROW'
          ? PASS
          : fail(`expected StoreError CORRUPT_ROW, got ${code}`);
      },
    }),
    storeItem({
      slug: 'hand-edit-run-schema',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'hostile',
      title: 'errors.ts CORRUPT_ROW: a runs row edited to a status outside the schema',
      cause: 'readRun raises CORRUPT_ROW for a run that does not match the RunResult schema',
      async check(ctx) {
        const { path, run } = await seededFile(ctx, 'edit-run-schema');
        editByHand(
          path,
          `UPDATE runs SET json = json_set(json, '$.status', 'paused') WHERE run_id = ?`,
          run.runId,
        );
        const code = await codeOf(withStore(path, (store) => store.listRuns()));
        return code === 'StoreError CORRUPT_ROW'
          ? PASS
          : fail(`expected StoreError CORRUPT_ROW, got ${code}`);
      },
    }),
    storeItem({
      slug: 'hand-edit-run-key',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'hostile',
      title: 'errors.ts CORRUPT_ROW: a runs row whose JSON names another run id than its key',
      cause: 'readRun raises CORRUPT_ROW when the run JSON does not match its key',
      async check(ctx) {
        const { path, run } = await seededFile(ctx, 'edit-run-key');
        editByHand(
          path,
          `UPDATE runs SET json = json_set(json, '$.runId', 'r-someone-else') WHERE run_id = ?`,
          run.runId,
        );
        const code = await codeOf(withStore(path, (store) => store.getRun(run.runId, 'c-1')));
        return code === 'StoreError CORRUPT_ROW'
          ? PASS
          : fail(`expected StoreError CORRUPT_ROW, got ${code}`);
      },
    }),
    storeItem({
      slug: 'hand-edit-block-observed',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'hostile',
      title: 'errors.ts CORRUPT_ROW: a blocks row whose observed JSON was cut by hand',
      cause: 'readRun raises CORRUPT_ROW for a block column that does not parse',
      async check(ctx) {
        const { path, run } = await seededFile(ctx, 'edit-block');
        editByHand(
          path,
          `UPDATE blocks SET observed_json = '{"segments": [' WHERE run_id = ? AND "index" = 1`,
          run.runId,
        );
        const code = await codeOf(withStore(path, (store) => store.listRuns({ campaignId: 'c-1' })));
        return code === 'StoreError CORRUPT_ROW'
          ? PASS
          : fail(`expected StoreError CORRUPT_ROW, got ${code}`);
      },
    }),
    storeItem({
      slug: 'hand-edit-block-index',
      tier: 3,
      level: 1,
      component: STORE,
      source: 'hostile',
      title: 'errors.ts CORRUPT_ROW: a blocks row whose JSON names another block index than its key',
      cause: 'readRun raises CORRUPT_ROW when a block JSON does not match its row index',
      async check(ctx) {
        const { path, run } = await seededFile(ctx, 'edit-block-index');
        editByHand(
          path,
          `UPDATE blocks SET json = json_set(json, '$.index', 2) WHERE run_id = ? AND "index" = 1`,
          run.runId,
        );
        const code = await codeOf(withStore(path, (store) => store.getRun(run.runId, 'c-1')));
        return code === 'StoreError CORRUPT_ROW'
          ? PASS
          : fail(`expected StoreError CORRUPT_ROW, got ${code}`);
      },
    }),
    storeItem({
      slug: 'hand-edit-status-column',
      tier: 3,
      level: 1,
      component: STORE,
      source: 'hostile',
      title:
        'docs/running.md "The store" and errors.ts CORRUPT_ROW: listRuns filtered by status never returns a run of another status, even when the status column was edited by hand',
      cause: 'listRuns checks the filter columns against the record it read',
      async check(ctx) {
        const { path, run } = await seededFile(ctx, 'edit-status');
        const other = run.status === 'failed' ? 'stopped' : 'failed';
        editByHand(path, 'UPDATE runs SET status = ? WHERE run_id = ?', other, run.runId);
        let got: RunResult[] = [];
        const error = await caught(
          withStore(path, async (store) => {
            got = await store.listRuns({ status: other });
          }),
        );
        if (error !== undefined) {
          return error instanceof StoreError && error.code === 'CORRUPT_ROW'
            ? PASS
            : fail(`expected CORRUPT_ROW or an empty list, got ${kindOf(error)}`);
        }
        const wrong = got.filter((r) => r.status !== other);
        return wrong.length === 0
          ? PASS
          : fail(
              `listRuns({ status: '${other}' }) returned ${wrong.length} run(s) whose status is ${wrong[0]?.status}`,
            );
      },
    }),
    storeItem({
      slug: 'hand-edit-spec-id-column',
      tier: 3,
      level: 1,
      component: STORE,
      source: 'hostile',
      title:
        'docs/running.md "The store" and errors.ts CORRUPT_ROW: listRuns filtered by specId never returns a run whose record holds another specId, even when the spec_id column was edited by hand',
      cause: 'listRuns checks the filter columns against the record it read',
      async check(ctx) {
        const { path, run } = await seededFile(ctx, 'edit-spec-id');
        const other = 's-other';
        editByHand(path, 'UPDATE runs SET spec_id = ? WHERE run_id = ?', other, run.runId);
        let got: RunResult[] = [];
        const error = await caught(
          withStore(path, async (store) => {
            got = await store.listRuns({ specId: other } as never);
          }),
        );
        if (error !== undefined) {
          return error instanceof StoreError && error.code === 'CORRUPT_ROW'
            ? PASS
            : fail(`expected CORRUPT_ROW or an empty list, got ${kindOf(error)}`);
        }
        const wrong = got.filter((r) => r.specId !== other);
        return wrong.length === 0
          ? PASS
          : fail(
              `listRuns({ specId: '${other}' }) returned ${wrong.length} run(s) whose specId is ${wrong[0]?.specId}`,
            );
      },
    }),
    storeItem({
      slug: 'hand-edit-mode-column',
      tier: 3,
      level: 1,
      component: STORE,
      source: 'hostile',
      title:
        'docs/running.md "The store" and errors.ts CORRUPT_ROW: listRuns filtered by mode never returns a run whose record holds another mode, even when the mode column was edited by hand',
      cause: 'listRuns checks the filter columns against the record it read',
      async check(ctx) {
        const { path, run } = await seededFile(ctx, 'edit-mode');
        const other = run.mode === 'T' ? 'F' : 'T';
        editByHand(path, 'UPDATE runs SET mode = ? WHERE run_id = ?', other, run.runId);
        let got: RunResult[] = [];
        const error = await caught(
          withStore(path, async (store) => {
            got = await store.listRuns({ mode: other } as never);
          }),
        );
        if (error !== undefined) {
          return error instanceof StoreError && error.code === 'CORRUPT_ROW'
            ? PASS
            : fail(`expected CORRUPT_ROW or an empty list, got ${kindOf(error)}`);
        }
        const wrong = got.filter((r) => r.mode !== other);
        return wrong.length === 0
          ? PASS
          : fail(
              `listRuns({ mode: '${other}' }) returned ${wrong.length} run(s) whose mode is ${wrong[0]?.mode}`,
            );
      },
    }),
    storeItem({
      slug: 'hand-edit-campaign',
      tier: 1,
      level: 1,
      component: STORE,
      source: 'hostile',
      title:
        'errors.ts CORRUPT_ROW: a campaigns row edited by hand so it no longer matches the Campaign schema',
      cause: 'readCampaign raises CORRUPT_ROW for a campaign row that does not match its schema',
      async check(ctx) {
        const { path } = await seededFile(ctx, 'edit-campaign');
        editByHand(path, `UPDATE campaigns SET json = json_set(json, '$.repeats', 'twice') WHERE id = 'c-1'`);
        const code = await codeOf(withStore(path, (store) => store.listCampaigns()));
        return code === 'StoreError CORRUPT_ROW'
          ? PASS
          : fail(`expected StoreError CORRUPT_ROW, got ${code}`);
      },
    }),
    storeItem({
      slug: 'hand-edit-cache',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'hostile',
      title:
        'errors.ts CORRUPT_ROW: a cache row whose Observed was edited by hand, and one whose expiry is not a date',
      cause: 'cacheGet raises CORRUPT_ROW for a cache row it cannot read',
      async check(ctx) {
        const { path } = await seededFile(ctx, 'edit-cache');
        await withStore(path, async (store) => {
          await store.cachePut('k-observed', textObserved(`R-${ctx.seed}`));
          await store.cachePut('k-expiry', textObserved('later'), 60_000);
        });
        editByHand(path, `UPDATE cache SET observed_json = '{"segments":"x"}' WHERE key = 'k-observed'`);
        editByHand(path, `UPDATE cache SET expires_at = 'tomorrow' WHERE key = 'k-expiry'`);
        const codes = await withStore(path, async (store) => [
          await codeOf(store.cacheGet('k-observed')),
          await codeOf(store.cacheGet('k-expiry')),
        ]);
        return same(codes, ['StoreError CORRUPT_ROW', 'StoreError CORRUPT_ROW'])
          ? PASS
          : fail(`expected CORRUPT_ROW for both cache rows, got ${codes.join(' and ')}`);
      },
    }),
    storeItem({
      slug: 'hand-edit-unit',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'hostile',
      title: 'errors.ts CORRUPT_ROW: a cost unit edited by hand to a negative price',
      cause: 'listUnits raises CORRUPT_ROW for a unit row that is invalid',
      async check(ctx) {
        const { path } = await seededFile(ctx, 'edit-unit');
        await withStore(path, (store) =>
          store.putUnit({
            adapter: 'function',
            metric: BLOCK_METRIC,
            usd: 0.01 * ctx.seed,
            measuredAt: CLOCK,
          }),
        );
        editByHand(path, `UPDATE units SET usd = -0.5 WHERE adapter = 'function'`);
        const code = await codeOf(withStore(path, (store) => store.listUnits()));
        return code === 'StoreError CORRUPT_ROW'
          ? PASS
          : fail(`expected StoreError CORRUPT_ROW, got ${code}`);
      },
    }),
    storeItem({
      slug: 'hand-edit-spec',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'hostile',
      title: 'errors.ts CORRUPT_ROW: a specs row whose canonical JSON was edited by hand',
      cause: 'getSpec raises CORRUPT_ROW for a spec row that does not parse or does not match its hash',
      async check(ctx) {
        const { path } = await seededFile(ctx, 'edit-spec');
        const planted = plantedFlow(ctx.seed, 'store-edit-spec', 3);
        const loaded = validateSpec(planted.spec, 'bank:store-edit-spec');
        if (!loaded.ok) return fail('the planted spec did not load');
        await withStore(path, (store) => store.putSpec(loaded));
        editByHand(path, `UPDATE specs SET yaml = '{"id": "broken' WHERE id = ?`, loaded.spec.id);
        const code = await codeOf(withStore(path, (store) => store.getSpec(loaded.spec.id, loaded.hash)));
        return code === 'StoreError CORRUPT_ROW'
          ? PASS
          : fail(`expected StoreError CORRUPT_ROW, got ${code}`);
      },
    }),
    storeItem({
      slug: 'hand-edit-version',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'hostile',
      title:
        'errors.ts CORRUPT_ROW: a registry version row edited by hand into a record that is not a version',
      cause: 'readVersion raises CORRUPT_ROW for a versions row that is not a version record',
      async check(ctx) {
        const { path } = await seededFile(ctx, 'edit-version');
        await withStore(path, (store) =>
          store.pushVersion('dataset', 'leads', [
            { path: 'leads.csv', bytes: new TextEncoder().encode(`email\nana@example.org,${ctx.seed}\n`) },
          ]),
        );
        editByHand(path, `UPDATE versions SET json = '{"kind":"dataset","name":"leads"}'`);
        const code = await codeOf(withStore(path, (store) => store.listVersions('dataset', 'leads')));
        return code === 'StoreError CORRUPT_ROW'
          ? PASS
          : fail(`expected StoreError CORRUPT_ROW, got ${code}`);
      },
    }),
    storeItem({
      slug: 'hand-edit-blob',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'hostile',
      title:
        'errors.ts CORRUPT_ROW: a registry file whose bytes were replaced by hand no longer hashes to its version',
      cause: 'readVersionFiles raises CORRUPT_ROW for bytes that no longer match their hash',
      async check(ctx) {
        const { path } = await seededFile(ctx, 'edit-blob');
        const version = await withStore(
          path,
          async (store) =>
            (
              await store.pushVersion('prompt', 'greeter', [
                { path: 'prompt.md', bytes: new TextEncoder().encode(`Hello R-${ctx.seed}`) },
              ])
            ).version,
        );
        editByHand(path, 'UPDATE blobs SET bytes = ?', new TextEncoder().encode('Hello, tampered'));
        const code = await codeOf(withStore(path, (store) => store.readVersionFiles(version)));
        return code === 'StoreError CORRUPT_ROW'
          ? PASS
          : fail(`expected StoreError CORRUPT_ROW, got ${code}`);
      },
    }),
    storeItem({
      slug: 'newer-schema-version',
      tier: 1,
      level: 1,
      component: STORE,
      source: 'contract',
      title:
        'errors.ts SCHEMA_VERSION: a database written by a newer schema is refused at open, and left as it was',
      cause: 'openStore refuses a database of a newer schema version without touching it',
      async check(ctx) {
        const checks: Array<[boolean, string]> = [];
        for (const newer of newerSchemas(ctx.seed)) {
          const { path } = await seededFile(ctx, `newer-schema-${newer}`);
          editByHand(path, `PRAGMA user_version = ${newer}`);
          const code = await codeOf(async () => {
            openStore(path);
          });
          const after = Number(readByHand(path, 'PRAGMA user_version')?.user_version);
          checks.push(
            [
              code === 'StoreError SCHEMA_VERSION',
              `version ${newer}: expected StoreError SCHEMA_VERSION, got ${code}`,
            ],
            [after === newer, `version ${newer}: expected the version left at ${newer}, got ${after}`],
          );
        }
        return expectAll(checks);
      },
    }),
    storeItem({
      slug: 'schema-holds-block-verdicts',
      tier: 1,
      level: 1,
      component: STORE,
      source: 'contract',
      title:
        'packages/store/src/schema.ts: the store schema is at least the version that brought the block verdicts not_run and blocked (3), so an older driftbench refuses a store that holds one',
      cause:
        'SCHEMA_VERSION is at or above the version that introduced not_run and blocked, in the file and in a bundle',
      async check(ctx) {
        const { path, run, dir } = await seededFile(ctx, 'verdict-schema');
        // A run whose last block was not run: the record an older reader cannot hold.
        const last = run.blocks.length - 1;
        const unsent = {
          ...run,
          runId: `${run.runId}-unsent`,
          blocks: run.blocks.map((block, index) =>
            index === last
              ? {
                  ...block,
                  verdicts: [],
                  drift: [],
                  pass: false,
                  status: 'not_run' as const,
                  notRun: {
                    kind: 'unsupported' as const,
                    layer: '5 world',
                    check: 'capability',
                    expected: 'e',
                    got: 'g',
                  },
                }
              : block,
          ),
        };
        const back = await withStore(path, async (store) => {
          await store.putRun('c-1', unsent);
          return store.getRun(unsent.runId, 'c-1');
        });
        const folder = await withStore(path, (store) => store.exportCampaign('c-1', join(dir, 'export')));
        const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as {
          schemaVersion?: unknown;
        };
        const file = Number(readByHand(path, 'PRAGMA user_version')?.user_version);
        return expectAll([
          [
            SCHEMA_VERSION >= VERDICT_SCHEMA,
            `expected SCHEMA_VERSION at least ${VERDICT_SCHEMA}, got ${SCHEMA_VERSION}`,
          ],
          [file >= VERDICT_SCHEMA, `expected the file at schema ${VERDICT_SCHEMA} or above, got ${file}`],
          [
            Number(manifest.schemaVersion) >= VERDICT_SCHEMA,
            `expected the bundle at schema ${VERDICT_SCHEMA} or above, got ${show(manifest.schemaVersion)}`,
          ],
          [
            back?.blocks[last]?.status === 'not_run',
            `expected the block read back not_run, got ${show(back?.blocks[last]?.status)}`,
          ],
        ]);
      },
    }),
    storeItem({
      slug: 'older-schema-upgraded',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'contract',
      title:
        'packages/store/src/schema.ts: an older database (schema 1, no registry tables) is upgraded on open and keeps its records',
      cause: 'openStore upgrades an older schema in place',
      async check(ctx) {
        const { path, run } = await seededFile(ctx, 'older-schema');
        const db = new DatabaseSync(path);
        try {
          db.exec('DROP TABLE versions; DROP TABLE blobs; PRAGMA user_version = 1;');
        } finally {
          db.close();
        }
        const code = await codeOf(
          withStore(path, async (store) => {
            const back = await store.getRun(run.runId, 'c-1');
            if (!same(back, run)) throw new Error('the run did not come back equal after the upgrade');
            await store.pushVersion('dataset', 'd', [
              { path: 'a.txt', bytes: new TextEncoder().encode('a') },
            ]);
          }),
        );
        const after = Number(readByHand(path, 'PRAGMA user_version')?.user_version);
        return expectAll([
          [code === 'no error', `expected the upgraded store to work, got ${code}`],
          [
            after === SCHEMA_VERSION,
            `expected schema version ${SCHEMA_VERSION} (the current schema) after the upgrade, got ${after}`,
          ],
        ]);
      },
    }),
    storeItem({
      slug: 'bundle-newer-schema',
      tier: 1,
      level: 1,
      component: BUNDLE,
      source: 'contract',
      title:
        'errors.ts SCHEMA_VERSION: a bundle whose manifest names a newer schema version is refused on import',
      cause: 'readCampaignBundle refuses a bundle of a newer schema version',
      async check(ctx) {
        const checks: Array<[boolean, string]> = [];
        for (const newer of newerSchemas(ctx.seed)) {
          const { path, dir } = await seededFile(ctx, `bundle-newer-${newer}`);
          const folder = await withStore(path, (store) => store.exportCampaign('c-1', join(dir, 'export')));
          const manifestPath = join(folder, 'manifest.json');
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
          writeFileSync(manifestPath, JSON.stringify({ ...manifest, schemaVersion: newer }));
          const target = join(dir, 'target.sqlite');
          const code = await codeOf(withStore(target, (store) => store.importCampaign(folder)));
          const left = await withStore(target, (store) => store.listCampaigns());
          checks.push(
            [
              code === 'StoreError SCHEMA_VERSION',
              `version ${newer}: expected StoreError SCHEMA_VERSION, got ${code}`,
            ],
            [
              left.length === 0,
              `version ${newer}: expected nothing imported, found ${left.length} campaign(s)`,
            ],
          );
        }
        return expectAll(checks);
      },
    }),
    storeItem({
      slug: 'bundle-missing-run-file',
      tier: 2,
      level: 1,
      component: BUNDLE,
      source: 'hostile',
      title:
        'docs/running.md "The store" and errors.ts BUNDLE_INVALID: a bundle that lost one run file is incomplete and nothing is imported',
      cause: 'readCampaignBundle checks the run files against the manifest counts',
      async check(ctx) {
        const dir = folderFor(ctx, 'store-bundle-missing');
        const base = await baseRun(ctx.seed, 'bundle-missing');
        const folder = await withStore(join(dir, 'source.sqlite'), async (store) => {
          await store.putCampaign(campaignOf('c-b', base));
          for (let i = 0; i < 3; i++) await store.putRun('c-b', variant(base, `r-${i}`));
          return store.exportCampaign('c-b', join(dir, 'export'));
        });
        unlinkSync(join(folder, 'runs', 'r-1.json'));
        const target = join(dir, 'target.sqlite');
        const code = await codeOf(withStore(target, (store) => store.importCampaign(folder)));
        const left = await withStore(
          target,
          async (store) => (await store.listCampaigns()).length + (await store.listRuns()).length,
        );
        return expectAll([
          [code === 'StoreError BUNDLE_INVALID', `expected StoreError BUNDLE_INVALID, got ${code}`],
          [left === 0, `expected nothing imported, found ${left} record(s)`],
        ]);
      },
    }),
    storeItem({
      slug: 'bundle-conflict-all-or-nothing',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'adversarial',
      title:
        'errors.ts CAMPAIGN_CONFLICT: importing a bundle over a different campaign of the same id is refused, all or nothing: none of its runs land',
      cause: 'importCampaign writes the campaign and its runs in one transaction',
      async check(ctx) {
        const dir = folderFor(ctx, 'store-bundle-conflict');
        const base = await baseRun(ctx.seed, 'bundle-conflict');
        const folder = await withStore(join(dir, 'source.sqlite'), async (store) => {
          await store.putCampaign(campaignOf('c-x', base));
          for (let i = 0; i < 2; i++) await store.putRun('c-x', variant(base, `r-${i}`));
          return store.exportCampaign('c-x', join(dir, 'export'));
        });
        const target = join(dir, 'target.sqlite');
        await withStore(target, (store) => store.putCampaign(campaignOf('c-x', base, { budgetUsd: 7 })));
        const code = await codeOf(withStore(target, (store) => store.importCampaign(folder)));
        const runs = await withStore(target, (store) => store.listRuns({ campaignId: 'c-x' }));
        return expectAll([
          [code === 'StoreError CAMPAIGN_CONFLICT', `expected StoreError CAMPAIGN_CONFLICT, got ${code}`],
          [runs.length === 0, `expected no run imported, found ${runs.length}`],
        ]);
      },
    }),
    storeItem({
      slug: 'path-character-ids',
      tier: 3,
      level: 1,
      component: BUNDLE,
      source: 'hostile',
      title:
        'docs/running.md "The store": exportCampaign writes inside its folder whatever the ids hold (.., /, a leading dot, *), and the bundle imports back equal',
      cause: 'the bundle writer encodes ids into plain file names inside the export folder',
      async check(ctx) {
        const dir = folderFor(ctx, 'store-path-ids');
        const base = await baseRun(ctx.seed, 'path-ids');
        const campaignId = '../../escape/c';
        const runIds = ['../up', '.hidden', 'a/b', 'star*', `..\\back-${ctx.seed}`];
        const exportDir = join(dir, 'box', 'export');
        mkdirSync(exportDir, { recursive: true });
        const folder = await withStore(join(dir, 'source.sqlite'), async (store) => {
          await store.putCampaign(campaignOf(campaignId, base));
          for (const id of runIds) await store.putRun(campaignId, variant(base, id));
          return store.exportCampaign(campaignId, exportDir);
        });
        const inside = resolve(folder).startsWith(`${resolve(exportDir)}/`);
        const boxEntries = readdirSync(join(dir, 'box')).sort();
        const dirEntries = readdirSync(dir).sort();
        const runFiles = existsSync(join(folder, 'runs')) ? readdirSync(join(folder, 'runs')) : [];
        const back = await withStore(join(dir, 'target.sqlite'), async (store) => {
          await store.importCampaign(folder);
          return (await store.listRuns({ campaignId })).map((r) => r.runId).sort();
        });
        return expectAll([
          [inside, `expected the bundle folder inside ${exportDir}, it is ${folder}`],
          [
            same(boxEntries, ['export']),
            `expected nothing written beside the export folder, found ${show(boxEntries)}`,
          ],
          [
            same(dirEntries, ['box', 'source.sqlite']) ||
              same(dirEntries, ['box', 'source.sqlite', 'target.sqlite']),
            `expected nothing written outside, found ${show(dirEntries)}`,
          ],
          [
            runFiles.length === runIds.length && runFiles.every((f) => !f.startsWith('.')),
            `expected ${runIds.length} visible run files, got ${show(runFiles)}`,
          ],
          [same(back, [...runIds].sort()), `expected every run back by id, got ${show(back)}`],
        ]);
      },
    }),
    storeItem({
      slug: 'case-clash-ids',
      tier: 2,
      level: 1,
      component: BUNDLE,
      source: 'adversarial',
      title:
        'errors.ts BUNDLE_INVALID: two run ids that differ only in case are refused at export, so no run file overwrites another on a case-insensitive disk',
      cause: 'the bundle writer refuses run ids that share one file name ignoring case',
      async check(ctx) {
        const dir = folderFor(ctx, 'store-case-clash');
        const base = await baseRun(ctx.seed, 'case-clash');
        const code = await codeOf(
          withStore(join(dir, 'source.sqlite'), async (store) => {
            await store.putCampaign(campaignOf('c-case', base));
            await store.putRun('c-case', variant(base, `Run-${ctx.seed}`));
            await store.putRun('c-case', variant(base, `run-${ctx.seed}`));
            return store.exportCampaign('c-case', join(dir, 'export'));
          }),
        );
        return code === 'StoreError BUNDLE_INVALID'
          ? PASS
          : fail(`expected StoreError BUNDLE_INVALID, got ${code}`);
      },
    }),
    storeItem({
      slug: 'closed-store',
      tier: 1,
      level: 1,
      component: STORE,
      source: 'contract',
      title:
        'errors.ts CLOSED: every call on a closed store fails with CLOSED, and a second close does nothing',
      cause: 'the store refuses every call after close with CLOSED',
      async check(ctx) {
        const { path, run, dir } = await seededFile(ctx, 'closed');
        const store = openStore(path);
        await store.close();
        const second = await codeOf(store.close());
        const calls: [string, () => Promise<unknown>][] = [
          ['putCampaign', () => store.putCampaign(campaignOf('c-2', run))],
          ['getCampaign', () => store.getCampaign('c-1')],
          ['listCampaigns', () => store.listCampaigns()],
          ['putRun', () => store.putRun('c-1', run)],
          ['getRun', () => store.getRun(run.runId, 'c-1')],
          ['listRuns', () => store.listRuns()],
          ['cacheGet', () => store.cacheGet('k')],
          ['cachePut', () => store.cachePut('k', textObserved('x'))],
          ['putUnit', () => store.putUnit({ adapter: 'a', metric: BLOCK_METRIC, usd: 1, measuredAt: CLOCK })],
          ['listUnits', () => store.listUnits()],
          ['exportCampaign', () => store.exportCampaign('c-1', join(dir, 'export'))],
          ['listVersions', () => store.listVersions('dataset')],
          ['getVersion', () => store.getVersion('dataset', 'd')],
        ];
        const wrong: string[] = [];
        for (const [name, work] of calls) {
          const code = await codeOf(work);
          if (code !== 'StoreError CLOSED') wrong.push(`${name}: ${code}`);
        }
        return expectAll([
          [second === 'no error', `expected a second close to do nothing, got ${second}`],
          [wrong.length === 0, `expected StoreError CLOSED from every call, got ${wrong.join('; ')}`],
        ]);
      },
    }),
    storeItem({
      slug: 'close-during-import',
      tier: 3,
      level: 1,
      component: STORE,
      source: 'adversarial',
      title:
        'errors.ts CLOSED: a store closed while an import reads its bundle fails the import with CLOSED, and nothing is written',
      cause: 'importCampaign checks the store is open again after reading the bundle',
      async check(ctx) {
        const { path, dir } = await seededFile(ctx, 'close-import');
        const folder = await withStore(path, (store) => store.exportCampaign('c-1', join(dir, 'export')));
        const target = join(dir, 'target.sqlite');
        const store = openStore(target);
        const importing = codeOf(store.importCampaign(folder));
        await store.close();
        const code = await importing;
        const left = await withStore(target, (s) => s.listCampaigns());
        return expectAll([
          [code === 'StoreError CLOSED', `expected StoreError CLOSED, got ${code}`],
          [left.length === 0, `expected nothing imported, found ${left.length} campaign(s)`],
        ]);
      },
    }),
    storeItem({
      slug: 'one-handle-closes',
      tier: 1,
      level: 1,
      component: STORE,
      source: 'adversarial',
      title:
        'docs/running.md "The store": closing one handle on a file leaves another handle on the same file working',
      cause: 'closing a store releases only its own connection',
      async check(ctx) {
        const { path, run } = await seededFile(ctx, 'one-closes');
        const a = openStore(path);
        const b = openStore(path);
        try {
          await a.close();
          const put = await codeOf(b.putRun('c-1', variant(run, `r-after-${ctx.seed}`)));
          const listed = (await b.listRuns()).length;
          const closed = await codeOf(a.getCampaign('c-1'));
          return expectAll([
            [put === 'no error', `expected the open handle to write, got ${put}`],
            [listed === 2, `expected 2 runs through the open handle, got ${listed}`],
            [closed === 'StoreError CLOSED', `expected the closed handle to say CLOSED, got ${closed}`],
          ]);
        } finally {
          await b.close();
        }
      },
    }),
    storeItem({
      slug: 'refused-put-keeps-old',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'contract',
      title:
        'errors.ts INVALID_RECORD "nothing was written": a replacement run whose block indexes do not rise is refused and the stored run stays',
      cause: 'putRun validates a replacement before it deletes the stored run',
      async check(ctx) {
        const { path, run } = await seededFile(ctx, 'refused-put');
        const [b0, b1] = run.blocks;
        if (!b0 || !b1) return fail('the base run needs two blocks');
        const bad = {
          ...structuredClone(run),
          blocks: [
            { ...b1, index: 1 },
            { ...b0, index: 0 },
          ],
        };
        const code = await codeOf(withStore(path, (store) => store.putRun('c-1', bad)));
        const back = await withStore(path, (store) => store.getRun(run.runId, 'c-1'));
        return expectAll([
          [code === 'StoreError INVALID_RECORD', `expected StoreError INVALID_RECORD, got ${code}`],
          [same(back, run), 'expected the stored run unchanged after the refused replacement'],
        ]);
      },
    }),
    storeItem({
      slug: 'unwritable-json-keeps-old',
      tier: 3,
      level: 1,
      component: STORE,
      source: 'adversarial',
      title:
        'errors.ts INVALID_RECORD "nothing was written": a replacement run holding a value JSON cannot write (a BigInt in raw) is refused and the stored run stays',
      cause: 'putRun serialises every block before it touches the stored run',
      async check(ctx) {
        const { path, run } = await seededFile(ctx, 'bigint-put');
        const bad = structuredClone(run);
        const first = bad.blocks[0];
        if (!first) return fail('the base run has no block');
        first.observed.raw = { tokens: BigInt(ctx.seed) };
        const code = await codeOf(withStore(path, (store) => store.putRun('c-1', bad)));
        const back = await withStore(path, (store) => store.getRun(run.runId, 'c-1'));
        return expectAll([
          [code === 'StoreError INVALID_RECORD', `expected StoreError INVALID_RECORD, got ${code}`],
          [same(back, run), 'expected the stored run unchanged after the refused replacement'],
        ]);
      },
    }),
    storeItem({
      slug: 'very-large-run',
      tier: 3,
      level: 1,
      component: STORE,
      source: 'scale',
      title:
        'docs/running.md "The store": a very large run (120 blocks of 40 kB text, about 5 MB) goes in and comes back equal',
      cause: 'the store keeps a large run whole',
      async check(ctx) {
        const dir = folderFor(ctx, 'store-large');
        const path = join(dir, 'store.sqlite');
        const base = await baseRun(ctx.seed, 'large');
        const b0 = base.blocks[0];
        if (!b0) return fail('the base run has no block');
        const blocks = Array.from({ length: 120 }, (_, i) => {
          const text = `R-${String(i).padStart(4, '0')} ${'é'.repeat(20)}${'x'.repeat(40_000)}`;
          return {
            ...structuredClone(b0),
            index: i,
            observed: { ...structuredClone(b0.observed), segments: [{ type: 'text' as const, text }], text },
          };
        });
        const run = variant(base, `r-large-${ctx.seed}`, { blocks });
        const back = await withStore(path, async (store) => {
          await store.putCampaign(campaignOf('c-large', run));
          await store.putRun('c-large', run);
          return undefined;
        }).then(() => withStore(path, (store) => store.getRun(run.runId, 'c-large')));
        return same(back, run)
          ? PASS
          : fail(
              `expected the 120-block run back equal, got ${back ? `${back.blocks.length} blocks, not equal` : 'nothing'}`,
            );
      },
    }),
    storeItem({
      slug: 'many-campaigns-order',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'scale',
      title:
        'docs/running.md "The store": with 300 campaigns, many sharing a creation time, listCampaigns is newest first, then by id',
      cause: 'listCampaigns sorts by creation time, newest first, then by id',
      async check(ctx) {
        const dir = folderFor(ctx, 'store-many');
        const path = join(dir, 'store.sqlite');
        const base = await baseRun(ctx.seed, 'many');
        const start = Date.UTC(2026, 0, 1);
        const records = Array.from({ length: 300 }, (_, i) => {
          const id = `c-${String((i * 37 + ctx.seed) % 300).padStart(4, '0')}`;
          return campaignOf(id, base, { createdAt: new Date(start + (i % 23) * 1000).toISOString() });
        });
        const want = [...records]
          .sort(
            (a, b) =>
              Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.campaignId < b.campaignId ? -1 : 1),
          )
          .map((c) => c.campaignId);
        const got = await withStore(path, async (store) => {
          for (const c of records) await store.putCampaign(c);
          return (await store.listCampaigns()).map((c) => c.campaignId);
        });
        const at = got.findIndex((id, i) => id !== want[i]);
        return at < 0 && got.length === want.length
          ? PASS
          : fail(
              `expected ${want.length} campaigns newest first then by id; first difference at ${at}: expected ${want[at]}, got ${got[at]}`,
            );
      },
    }),
    storeItem({
      slug: 'many-campaigns-filter',
      tier: 2,
      level: 1,
      component: STORE,
      source: 'scale',
      title:
        'docs/running.md "The store": with 150 campaigns each holding the same run id, listRuns by campaign returns that campaign run alone',
      cause: 'listRuns filters by campaign id among many campaigns sharing a run id',
      async check(ctx) {
        const dir = folderFor(ctx, 'store-many-filter');
        const path = join(dir, 'store.sqlite');
        const base = await baseRun(ctx.seed, 'many-filter');
        const pick = `c-${String(17 + (ctx.seed % 100)).padStart(4, '0')}`;
        const result = await withStore(path, async (store) => {
          for (let i = 0; i < 150; i++) {
            const id = `c-${String(i).padStart(4, '0')}`;
            await store.putCampaign(campaignOf(id, base));
            await store.putRun(id, variant(base, 'r-shared', { cost: i }));
          }
          return {
            one: await store.listRuns({ campaignId: pick }),
            all: await store.listRuns(),
          };
        });
        return expectAll([
          [result.all.length === 150, `expected 150 runs in all, got ${result.all.length}`],
          [
            result.one.length === 1 && result.one[0]?.cost === Number(pick.slice(2)),
            `expected the one run of ${pick} (cost ${Number(pick.slice(2))}), got ${result.one.length} run(s) with cost ${result.one[0]?.cost}`,
          ],
        ]);
      },
    }),
  );
  return out;
}

/** The claims of this page: the function, http and process adapters, and the store under stress. */
/* ------------------------------------------------------------------------------------------------ */
/* The capability check (index.md "Capabilities")                                                   */
/* ------------------------------------------------------------------------------------------------ */

const RUNNER = 'packages/core/src/runner/run.ts';

/** A spec whose Given forces a tool result from block 0 on, and has two blocks. */
function forcedToolSpec(seed: number) {
  const code = `R-${String(2000 + (seed % 7000)).padStart(4, '0')}`;
  const result = validateSpec({
    id: `forced-tool-${seed}`,
    given: { world: { tools: { lookup: { result: { code } } } } },
    blocks: [
      { user: `Look up ${code}`, expect: { must: ['ok'] } },
      { user: 'And again', expect: { must: ['ok'] } },
    ],
  });
  if (!result.ok) throw new Error(`the item's spec is invalid: ${JSON.stringify(result.errors)}`);
  return result.spec;
}

function capabilityItems(): BankItem[] {
  return [
    adapterItem({
      slug: 'capability/tool-stubs-not-run',
      tier: 2,
      level: 3,
      component: RUNNER,
      source: 'contract',
      title:
        'index.md "Capabilities": a forced tool result in world.tools on an adapter without toolStubs gives not_run: unsupported, check capability, and the block is never sent',
      cause: 'runSpec runs the capability check before it sends a block',
      async check({ seed }) {
        const fake = fakeFetch(() => json(textObserved('ok')));
        const adapter = httpAdapter({ url: URL_TURN, fetch: fake.fetch });
        const run = await runSpec(forcedToolSpec(seed), {
          adapter,
          driver: createScriptedDriver(),
          checks: [],
          mode: 'F',
          repeat: 0,
        });
        const statuses = run.blocks.map((block) => block.status ?? (block.pass ? 'pass' : 'fail'));
        const first = run.blocks[0]?.notRun;
        return expectAll([
          [fake.calls.length === 0, `expected no POST, got ${fake.calls.length}`],
          [statuses.join(',') === 'not_run,not_run', `expected not_run,not_run, got ${statuses.join(',')}`],
          [run.blocks.every((block) => block.pass === false), 'expected pass false on every block not run'],
          [
            first?.kind === 'unsupported' && first.check === 'capability' && first.layer === '5 world',
            `expected kind unsupported, check capability, layer 5 world, got ${show(first)}`,
          ],
          [run.endState === undefined, 'expected no end state compared on a run with a block not run'],
        ]);
      },
    }),
    adapterItem({
      slug: 'capability/tool-stubs-declared-runs',
      tier: 1,
      level: 3,
      component: RUNNER,
      source: 'contract',
      title:
        'index.md "Capabilities": the same spec on an http adapter that declares toolStubs runs every block, with no status',
      cause: 'the capability check passes a layer the adapter declares it applies',
      async check({ seed }) {
        const fake = fakeFetch(() => json(textObserved('ok')));
        const adapter = httpAdapter({ url: URL_TURN, fetch: fake.fetch, capabilities: { toolStubs: true } });
        const run = await runSpec(forcedToolSpec(seed), {
          adapter,
          driver: createScriptedDriver(),
          checks: [],
          mode: 'F',
          repeat: 0,
        });
        return expectAll([
          [fake.calls.length === 2, `expected two POSTs, got ${fake.calls.length}`],
          [
            run.blocks.every((block) => block.status === undefined && block.notRun === undefined),
            `expected no status, got ${show(run.blocks.map((block) => block.status))}`,
          ],
        ]);
      },
    }),
  ];
}

export function adaptersItems(): BankItem[] {
  return [...functionItems(), ...httpItems(), ...processItems(), ...capabilityItems(), ...storeItems()];
}

export type { ItemResult };
