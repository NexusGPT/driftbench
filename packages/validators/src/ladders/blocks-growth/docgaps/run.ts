import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  type AgentLog,
  type Behaviour,
  load,
  observed,
  type RunRecord,
  scriptedAdapter,
  type Turn,
} from '../../blocks/harness';
import { startHttpAgent } from '../../blocks/http-agent';
import { type Action, plantedAgent } from '../../blocks/kinds';
import { need } from '../../blocks/product';
import { play, playP, runLoaded } from '../../blocks-breaker/kit';
import {
  ADAPTERS_PKG,
  type BankItem,
  CLI_PKG,
  CORE_PKG,
  cli,
  expectV,
  folder,
  gitem,
  type ItemContext,
  parseEntries,
  type Row,
  sceneOf,
  show,
  tok,
  writeAt,
} from './kit';

/**
 * docgaps.run: rules of docs/running.md, docs/concepts/run-modes.md, docs/concepts/given-when-then.md and
 * docs/reference/spec.md about a run as a whole: run events under a cache, the realized hash, the early stop of a
 * campaign, the Given of a block a perturbation replaces, a forced latency, a workspace folder written ./<path> on a
 * block or a perturbation, and what a partly cached or resumed campaign costs and accepts. Each item holds the shape
 * the doc passes beside the shape it fails.
 */

const FAMILY = 'docgaps.run';
const P = 'dg.run';

/* ---------------------------------------------------------------------------------------------------------
 * run events: one block start and one block end per block, whatever the cache holds
 * ------------------------------------------------------------------------------------------------------- */

type Event = Record<string, unknown>;

async function eventRun(
  ctx: ItemContext,
  tag: string,
  n: number,
  options: { cache?: unknown; failAt?: number },
): Promise<{ rec: RunRecord; events: Event[] }> {
  const rows: Row[] = Array.from({ length: n }, (_, i) => {
    const code = tok(ctx, tag, `code${i}`, 8);
    return { text: `Yes, ${code}.`, expect: { must: [code] } };
  });
  const sc = sceneOf(ctx, tag, rows);
  const failing = options.failAt === undefined ? undefined : sc.users[options.failAt];
  const behave: Behaviour = (turn) => {
    if (failing && turn.user.includes(failing)) throw new Error('the agent stopped mid-way');
    const marker = [...sc.plans.keys()].find((key) => turn.user.includes(key));
    if (!marker) throw new Error('the scripted agent was sent a turn it has no reply for');
    return observed((sc.plans.get(marker) as { text: string }).text);
  };
  const adapter = scriptedAdapter(ctx.product, behave);
  const spec = load(ctx.product, sc.raw);
  const runSpec = need<(spec: unknown, options: Record<string, unknown>) => Promise<RunRecord>>(
    ctx.product.core,
    'core',
    'runSpec',
  );
  const events: Event[] = [];
  const rec = await runSpec(spec, {
    adapter,
    driver: need<() => unknown>(ctx.product.users, 'users', 'createScriptedDriver')(),
    checks: need<() => unknown>(ctx.product.checks, 'checks', 'defaultChecks')(),
    mode: 'F',
    repeat: 0,
    retry: { retries: 0, baseDelayMs: 0, sleep: async () => {} },
    now: () => new Date('2026-10-16T00:00:00.000Z'),
    ...(options.cache ? { cache: options.cache } : {}),
    onEvent: (event: Event) => events.push(event),
  });
  return { rec, events };
}

/** For every event type that names a block index: how many events of the type each block index has. */
function perBlock(events: readonly Event[]): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  for (const event of events) {
    if (typeof event.type !== 'string' || typeof event.index !== 'number') continue;
    const counts = out.get(event.type) ?? new Map<number, number>();
    counts.set(event.index, (counts.get(event.index) ?? 0) + 1);
    out.set(event.type, counts);
  }
  return out;
}

function eventsItem(cache: 'empty' | 'prefix' | 'whole'): BankItem {
  const id = `${P}.events-under-cache.${cache}`;
  return gitem(
    FAMILY,
    id,
    cache === 'prefix' ? 5 : 4,
    CORE_PKG,
    'replay-attempt-events',
    `with a cache that ${cache === 'empty' ? 'is empty' : cache === 'prefix' ? 'holds the first blocks of the run' : 'holds the whole run'}, every block reports one start and one end, as a run with no cache does`,
    async (ctx) => {
      const n = 4;
      const openMemoryStore = need<() => unknown>(ctx.product.store, 'store', 'openMemoryStore');
      // The run with no cache sets the reference: the event types that report each block once.
      const base = await eventRun(ctx, `${id}:base`, n, {});
      const once = [...perBlock(base.events)].filter(
        ([, counts]) => counts.size === n && [...counts.values()].every((count) => count === 1),
      );
      if (once.length < 2)
        return [
          `a run of ${n} blocks with no cache should report a start and an end per block; its events are ${show(base.events.map((e) => e.type))}`,
        ];
      const store = openMemoryStore();
      if (cache === 'prefix') await eventRun(ctx, id, n, { cache: store, failAt: 2 });
      if (cache === 'whole') await eventRun(ctx, id, n, { cache: store });
      const got = await eventRun(ctx, id, n, { cache: store });
      const counts = perBlock(got.events);
      return [
        got.rec.status !== 'completed' && `the run should complete; it is ${got.rec.status}`,
        ...once.map(([type]) => {
          const seen = counts.get(type) ?? new Map<number, number>();
          const wrong = Array.from({ length: n }, (_, i) => i).filter((i) => seen.get(i) !== 1);
          return wrong.length === 0
            ? undefined
            : `the event ${type} should come once per block, as with no cache; blocks ${show(wrong)} have ${show(wrong.map((i) => seen.get(i) ?? 0))}`;
        }),
      ];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * realized.hash: the SHA-256 of the user messages received, joined by newlines
 * ------------------------------------------------------------------------------------------------------- */

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function realizedItem(stimulus: 'user' | 'burst'): BankItem {
  const id = `${P}.realized-hash.${stimulus}`;
  return gitem(
    FAMILY,
    id,
    stimulus === 'user' ? 3 : 4,
    CORE_PKG,
    'realized-hash',
    stimulus === 'user'
      ? 'a simulated user that rewrites a block records realized.hash, the SHA-256 of the message sent; a block it sends as written records none'
      : 'a block the spec writes as a burst and the simulated user sends as one message records the SHA-256 of that one message',
    async (ctx) => {
      const [m0, m1] = [tok(ctx, id, 'm0', 9), tok(ctx, id, 'm1', 9)];
      const spec = {
        id: tok(ctx, id, 'spec', 8),
        blocks: [
          {
            id: 'b0',
            ...(stimulus === 'user' ? { user: m0 } : { burst: [m0, tok(ctx, id, 'second', 9)] }),
            expect: { must: ['ok'] },
          },
          { id: 'b1', user: m1, expect: { must: ['ok'] } },
        ],
      };
      const sent0 = `${m0} ${tok(ctx, id, 'more', 6)} please`;
      const createSimulatedUser = need<(options: Record<string, unknown>) => unknown>(
        ctx.product.users,
        'users',
        'createSimulatedUser',
      );
      const userRecordingPort = need<(recording: Record<string, unknown>) => unknown>(
        ctx.product.users,
        'users',
        'userRecordingPort',
      );
      const driver = createSimulatedUser({
        persona: 'A fictional Larkspur Cycles customer who rents bikes on weekends.',
        goal: 'Rent a bike for the weekend.',
        facts: {},
        revealWhenAsked: {},
        stopToken: '###STOP###',
        port: userRecordingPort({
          family: 'hand-written',
          model: 'recorded for the blocks bank',
          persona: tok(ctx, id, 'persona', 6),
          answers: [sent0, m1],
        }),
        agentFamily: 'none',
        judgeFamilies: [],
      });
      const adapter = scriptedAdapter(ctx.product, () => observed('ok'));
      const rec = await runLoaded(ctx.product, load(ctx.product, spec as never), adapter, {
        mode: 'F',
        driver,
      });
      const at = (blockId: string) =>
        rec.blocks.find((block) => block.blockId === blockId) as
          | (Record<string, unknown> & { realized?: { hash?: unknown } })
          | undefined;
      const hash = at('b0')?.realized?.hash;
      return [
        rec.blocks.length !== 2 &&
          `the run should hold its two blocks; it holds ${rec.blocks.length} (${rec.status})`,
        hash === undefined &&
          `block b0 was sent "${sent0}", other text than the spec wrote: it should record realized.hash; it records ${show(at('b0')?.realized)}`,
        typeof hash === 'string' &&
          !hash.endsWith(sha256(sent0)) &&
          `block b0's realized.hash should be the SHA-256 of "${sent0}", ${sha256(sent0).slice(0, 16)}...; it is ${hash.slice(0, 24)}`,
        at('b1')?.realized !== undefined &&
          `block b1 was sent as the spec wrote it: it should record no realized; it records ${show(at('b1')?.realized)}`,
      ];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * runCampaign({ earlyStop: true })
 * ------------------------------------------------------------------------------------------------------- */

type Reply = (block: number, run: number) => Record<string, unknown>;

type CampSpec = {
  /** Fields of each block beside its user word. */
  block: (code: string) => Record<string, unknown>;
  /** Keys of the spec beside its blocks. */
  extra?: Record<string, unknown>;
  /** What the agent answers on a block, by the run of the spec it is in (counted from 0, in order). */
  reply: Reply;
};

type CellOutcome = {
  cell: { specId: string; repeat: number; mode: string };
  state: string;
  earlyStop?: unknown;
};

const BLOCKS = 2;

async function campaign(
  ctx: ItemContext,
  tag: string,
  specs: CampSpec[],
  modes: string[],
  repeats: number,
): Promise<{ ids: string[]; outcomes: CellOutcome[]; stored: Map<string, number> }> {
  const core = ctx.product.core;
  const dir = folder(ctx, tag);
  const ids = specs.map((_, s) => `${tok(ctx, tag, `spec${s}`, 7)}${String.fromCharCode(97 + s)}`);
  const users = specs.map((_, s) =>
    Array.from({ length: BLOCKS }, (_, b) => tok(ctx, tag, `u${s}.${b}`, 10)),
  );
  const codes = specs.map((_, s) => Array.from({ length: BLOCKS }, (_, b) => tok(ctx, tag, `c${s}.${b}`, 8)));
  for (const [s, def] of specs.entries())
    writeAt(join(dir, `${ids[s]}.yaml`), {
      id: ids[s],
      ...(def.extra ?? {}),
      blocks: (users[s] as string[]).map((user, b) => ({
        id: `b${b}`,
        user,
        ...def.block((codes[s] as string[])[b] as string),
      })),
    });
  const runs = specs.map(() => 0);
  const behave: Behaviour = (turn: Turn) => {
    for (const [s, list] of users.entries()) {
      const b = list.findIndex((user) => turn.user.includes(user));
      if (b === -1) continue;
      if (b === 0) runs[s] = (runs[s] ?? 0) + 1;
      return (specs[s] as CampSpec).reply(b, (runs[s] ?? 1) - 1);
    }
    throw new Error('the scripted agent was sent a turn it has no reply for');
  };
  const adapter = scriptedAdapter(ctx.product, behave);
  const loadSpecs = need<(paths: string[]) => Promise<{ ok: boolean; spec: { id: string }; hash: string }[]>>(
    core,
    'core',
    'loadSpecs',
  );
  const entries = (await loadSpecs([dir])).filter((entry) => entry.ok);
  if (entries.length !== specs.length) throw new Error(`the loader refuses a campaign spec of ${tag}`);
  const store = need<() => Record<string, (...args: unknown[]) => Promise<unknown>>>(
    ctx.product.store,
    'store',
    'openMemoryStore',
  )();
  const target = { adapter: 'function', agent: 'larkspur' };
  const campaignId = `c-${tok(ctx, tag, 'campaign', 8)}`;
  for (const entry of entries) await store.putSpec?.(entry);
  await store.putCampaign?.({
    campaignId,
    specs: entries.map((entry) => ({ id: entry.spec.id, hash: entry.hash, target })),
    targets: [target],
    modes,
    repeats: { T: modes.includes('T') ? repeats : 0, F: modes.includes('F') ? repeats : 0, P: 0 },
    budgetUsd: 0,
    judge: { mode: 'system1', judges: [] },
    createdAt: '2026-10-16T00:00:00.000Z',
  });
  const bySpec = new Map(entries.map((entry) => [`${entry.spec.id}@${entry.hash}`, entry.spec]));
  const plan = need<(...args: unknown[]) => { cells: { specId: string; specHash: string }[] }>(
    core,
    'core',
    'planCampaign',
  )(entries, [target], modes, repeats);
  const runCampaign = need<(options: Record<string, unknown>) => Promise<CellOutcome[]>>(
    core,
    'core',
    'runCampaign',
  );
  const outcomes = await runCampaign({
    campaignId,
    cells: plan.cells,
    specFor: (cell: { specId: string; specHash: string }) => bySpec.get(`${cell.specId}@${cell.specHash}`),
    adapterFor: () => adapter,
    driver: () => need<() => unknown>(ctx.product.users, 'users', 'createScriptedDriver')(),
    checks: need<() => unknown>(ctx.product.checks, 'checks', 'defaultChecks')(),
    store,
    now: () => new Date('2026-10-16T00:00:00.000Z'),
    concurrency: 1,
    earlyStop: true,
  });
  const listed = (await store.listRuns?.({ campaignId })) as { specId: string }[] | undefined;
  const stored = new Map<string, number>();
  for (const run of listed ?? []) stored.set(run.specId, (stored.get(run.specId) ?? 0) + 1);
  await store.close?.();
  return { ids, outcomes, stored };
}

/** A spec whose blocks expect their code: `fails(run)` says which runs answer without it. */
function mustSpec(ctx: ItemContext, tag: string, fails: (run: number) => boolean): CampSpec {
  const said: string[] = [];
  return {
    block: (code) => {
      said.push(code);
      return { expect: { must: [code] } };
    },
    reply: (block, run) =>
      observed(fails(run) ? `Let me check ${tok(ctx, tag, 'filler', 6)}.` : `Yes, ${said[block]}.`),
  };
}

const statesOf = (outcomes: readonly CellOutcome[], specId: string, mode = 'F') =>
  outcomes
    .filter((outcome) => outcome.cell.specId === specId && outcome.cell.mode === mode)
    .sort((a, b) => a.cell.repeat - b.cell.repeat);

const describe = (cells: readonly CellOutcome[]) =>
  show(cells.map((cell) => `${cell.state}${cell.earlyStop ? '+earlyStop' : ''}`));

/** The repeats 2 and up are stopped with an earlyStop marker and no run is stored for them; 0 and 1 ran. */
function stoppedAfterTwo(
  outcomes: readonly CellOutcome[],
  stored: Map<string, number>,
  specId: string,
  repeats: number,
  mode = 'F',
): string | undefined {
  const cells = statesOf(outcomes, specId, mode);
  const ran = cells.slice(0, 2);
  const later = cells.slice(2);
  if (cells.length !== repeats)
    return `${specId} should have ${repeats} ${mode} cells; it has ${cells.length}`;
  if (ran.some((cell) => cell.state === 'stopped'))
    return `${specId}: repeats 0 and 1 always run; they came back ${describe(ran)}`;
  if (
    !later.every(
      (cell) => cell.state === 'stopped' && (cell.earlyStop as { after?: unknown } | undefined)?.after === 2,
    )
  )
    return `${specId} failed a gating machine check in F repeats 0 and 1: repeats 2 on should be stopped with earlyStop { after: 2 }; the repeats came back ${describe(cells)}`;
  if ((stored.get(specId) ?? 0) !== 2)
    return `${specId}: no run is stored for a stopped repeat, so 2 runs are stored; ${stored.get(specId) ?? 0} are`;
  return undefined;
}

/** Every repeat ran and was stored: none stopped. */
function allRan(
  outcomes: readonly CellOutcome[],
  stored: Map<string, number>,
  specId: string,
  repeats: number,
  mode = 'F',
  storedRuns = repeats,
): string | undefined {
  const cells = statesOf(outcomes, specId, mode);
  if (cells.length !== repeats)
    return `${specId} should have ${repeats} ${mode} cells; it has ${cells.length}`;
  if (cells.some((cell) => cell.state === 'stopped' || cell.earlyStop !== undefined))
    return `${specId} should run every ${mode} repeat; they came back ${describe(cells)}`;
  if ((stored.get(specId) ?? 0) !== storedRuns)
    return `${specId}: every run is stored, ${storedRuns}; ${stored.get(specId) ?? 0} are`;
  return undefined;
}

type EarlyCase = {
  id: string;
  title: string;
  tier: 3 | 4 | 5;
  probe: (ctx: ItemContext, tag: string) => Promise<ReadonlyArray<string | undefined | false>>;
};

const REPEATS = 4;

const EARLY: EarlyCase[] = [
  {
    id: 'machine-fail-stops',
    title:
      'a spec that fails a must in F repeats 0 and 1 has repeats 2 and 3 stopped, unstored; a passing spec runs every repeat',
    tier: 3,
    probe: async (ctx, tag) => {
      const { ids, outcomes, stored } = await campaign(
        ctx,
        tag,
        [mustSpec(ctx, tag, () => true), mustSpec(ctx, `${tag}p`, () => false)],
        ['F'],
        REPEATS,
      );
      return [
        stoppedAfterTwo(outcomes, stored, ids[0] as string, REPEATS),
        allRan(outcomes, stored, ids[1] as string, REPEATS),
      ];
    },
  },
  {
    id: 'repeat-0-passes',
    title:
      'a spec that passes repeat 0 and fails from repeat 1 on runs every repeat; one that fails 0 and 1 is stopped',
    tier: 4,
    probe: async (ctx, tag) => {
      const { ids, outcomes, stored } = await campaign(
        ctx,
        tag,
        [mustSpec(ctx, `${tag}a`, (run) => run >= 1), mustSpec(ctx, `${tag}b`, () => true)],
        ['F'],
        REPEATS,
      );
      return [
        allRan(outcomes, stored, ids[0] as string, REPEATS),
        stoppedAfterTwo(outcomes, stored, ids[1] as string, REPEATS),
      ];
    },
  },
  {
    id: 'repeat-1-passes',
    title:
      'a spec that fails repeat 0, passes repeat 1 and fails after runs every repeat; one that fails 0 and 1 is stopped',
    tier: 4,
    probe: async (ctx, tag) => {
      const { ids, outcomes, stored } = await campaign(
        ctx,
        tag,
        [mustSpec(ctx, `${tag}a`, (run) => run !== 1), mustSpec(ctx, `${tag}b`, () => true)],
        ['F'],
        REPEATS,
      );
      return [
        allRan(outcomes, stored, ids[0] as string, REPEATS),
        stoppedAfterTwo(outcomes, stored, ids[1] as string, REPEATS),
      ];
    },
  },
  {
    id: 'end-state-fail-stops',
    title:
      'a spec whose end_state verdict, a gating machine verdict, fails in F repeats 0 and 1 has its later repeats stopped',
    tier: 4,
    probe: async (ctx, tag) => {
      const tool = tok(ctx, tag, 'tool', 7);
      const field = tok(ctx, tag, 'field', 6);
      const want = tok(ctx, tag, 'want', 6);
      const said: string[] = [];
      const endState: CampSpec = {
        block: (code) => {
          said.push(code);
          return { expect: { must: [code] } };
        },
        extra: { end_state: { source: `tool:${tool}`, expect: { [field]: want } } },
        reply: (block) =>
          observed(
            `Yes, ${said[block]}.`,
            block === BLOCKS - 1 ? [{ label: tool, input: { [field]: `${want}x` } }] : [],
          ),
      };
      const { ids, outcomes, stored } = await campaign(
        ctx,
        tag,
        [endState, mustSpec(ctx, `${tag}p`, () => false)],
        ['F'],
        REPEATS,
      );
      const first = statesOf(outcomes, ids[0] as string).slice(0, 2);
      return [
        first.some((cell) => cell.state !== 'fail') &&
          `the end state differs in every run, so repeats 0 and 1 fail; they came back ${describe(first)}`,
        stoppedAfterTwo(outcomes, stored, ids[0] as string, REPEATS),
        allRan(outcomes, stored, ids[1] as string, REPEATS),
      ];
    },
  },
  {
    id: 'inconclusive-gating-does-not-stop',
    title:
      'a spec that fails F repeats 0 and 1 only on a gating inconclusive verdict (a skill with no runtime trace) runs every repeat',
    tier: 5,
    probe: async (ctx, tag) => {
      const skill = tok(ctx, tag, 'skill', 6);
      const said: string[] = [];
      const inconclusive: CampSpec = {
        block: (code) => {
          said.push(code);
          return { expect: { must: [code], skills: [{ name: skill }] } };
        },
        reply: (block) => observed(`Yes, ${said[block]}.`),
      };
      const { ids, outcomes, stored } = await campaign(
        ctx,
        tag,
        [inconclusive, mustSpec(ctx, `${tag}b`, () => true)],
        ['F'],
        REPEATS,
      );
      const first = statesOf(outcomes, ids[0] as string).slice(0, 2);
      return [
        first.some((cell) => cell.state !== 'fail') &&
          `a gating inconclusive verdict fails the block, so repeats 0 and 1 fail; they came back ${describe(first)}`,
        allRan(outcomes, stored, ids[0] as string, REPEATS),
        stoppedAfterTwo(outcomes, stored, ids[1] as string, REPEATS),
      ];
    },
  },
  {
    id: 'mode-T-never-stopped',
    title: 'a spec that fails in T and F: its F repeats 2 and 3 are stopped, every T repeat runs',
    tier: 4,
    probe: async (ctx, tag) => {
      const { ids, outcomes, stored } = await campaign(
        ctx,
        tag,
        [mustSpec(ctx, tag, () => true)],
        ['T', 'F'],
        REPEATS,
      );
      const t = statesOf(outcomes, ids[0] as string, 'T');
      return [
        t.length !== REPEATS && `the spec should have ${REPEATS} T cells; it has ${t.length}`,
        t.some((cell) => cell.state === 'stopped' || cell.earlyStop !== undefined) &&
          `the early stop holds for mode F only: every T repeat runs; they came back ${describe(t)}`,
        (() => {
          const f = statesOf(outcomes, ids[0] as string, 'F');
          const later = f.slice(2);
          return later.every((cell) => cell.state === 'stopped' && cell.earlyStop !== undefined)
            ? undefined
            : `F repeats 0 and 1 failed a must: F repeats 2 on should be stopped; they came back ${describe(f)}`;
        })(),
        (stored.get(ids[0] as string) ?? 0) !== REPEATS + 2 &&
          `${REPEATS} T runs and 2 F runs are stored; ${stored.get(ids[0] as string) ?? 0} are`,
      ];
    },
  },
];

function earlyItem(c: EarlyCase): BankItem {
  const id = `${P}.early-stop.${c.id}`;
  return gitem(FAMILY, id, c.tier, CORE_PKG, 'early-stop-machine-fail', c.title, (ctx) => c.probe(ctx, id));
}

/* ---------------------------------------------------------------------------------------------------------
 * a block a world-only perturbation replaces keeps its own Given
 * ------------------------------------------------------------------------------------------------------- */

function replacedItem(part: 'vars' | 'prefix' | 'ledger'): BankItem {
  const id = `${P}.replaced-block-given.${part}`;
  return gitem(
    FAMILY,
    id,
    part === 'ledger' ? 5 : 4,
    CORE_PKG,
    'replaced-block-keeps-given',
    `a block that a world-only perturbation replaces in mode P keeps its given ${part}, from that block on, as in mode F`,
    async (ctx) => {
      const key = tok(ctx, id, 'key', 6);
      const value = tok(ctx, id, 'value', 8);
      const pu = tok(ctx, id, 'pu', 9);
      const pa = tok(ctx, id, 'pa', 9);
      const tool = tok(ctx, id, 'tool', 7);
      const given =
        part === 'vars'
          ? { vars: { [key]: value } }
          : part === 'prefix'
            ? {
                prefix: [
                  { role: 'user', content: pu },
                  { role: 'assistant', content: pa },
                ],
              }
            : { ledger: { [key]: value } };
      const rows: Row[] = [
        { text: 'Hello.' },
        { text: 'Noted.', given },
        { text: 'Done.', calls: part === 'ledger' ? [{ label: tool, input: { [key]: value } }] : [] },
        { text: 'Done.', calls: part === 'ledger' ? [{ label: tool, input: { [key]: `${value}x` } }] : [] },
      ];
      const spec = {
        perturbations: [
          {
            id: 'down',
            class: 'D8_tool_failure',
            inject_at: 1,
            world: { tools: { [tok(ctx, id, 'down', 7)]: { error: 'service down' } } },
          },
        ],
      };
      const sc = sceneOf(ctx, id, rows, spec);
      const f = await play(ctx, sc, { mode: 'F' });
      const p = await playP(ctx, sc, 'down');
      const turnOf = (log: AgentLog, block: number) =>
        log.turns.find((turn) => turn.user.includes(sc.users[block] as string));
      const recordOf = (rec: RunRecord, block: number) =>
        rec.blocks.findIndex(
          (each) => each.blockId === sc.ids[block] && (each as { injected?: unknown }).injected !== true,
        );
      const problems: (string | undefined | false)[] = [];
      for (const [mode, run] of [
        ['F', f],
        ['P', p],
      ] as const) {
        if (part === 'vars') {
          const seen = (block: number) => turnOf(run.log, block)?.vars?.[key];
          problems.push(
            seen(0) !== undefined && `mode ${mode}: block 0 comes before the var and should not see it`,
            seen(1) !== value &&
              `mode ${mode}: block 1 sets vars.${key}; the agent saw ${show(seen(1))} there`,
            seen(2) !== value && `mode ${mode}: the var holds from block 1 on; block 2 saw ${show(seen(2))}`,
          );
        } else if (part === 'prefix') {
          const at = (block: number) => turnOf(run.log, block)?.messages ?? [];
          const first = at(1)[0];
          problems.push(
            at(0).some((message) => message.content.includes(pu)) &&
              `mode ${mode}: block 0 should not see block 1's prefix`,
            !(first?.role === 'user' && first.content.includes(pu)) &&
              `mode ${mode}: block 1 opens a session from its prefix; the history it got starts ${show(first)}`,
            at(1).some((message) => message.content.includes(sc.users[0] as string)) &&
              `mode ${mode}: block 1 starts from its prefix, without block 0's turn; the history holds it`,
            !at(2).some((message) => message.content.includes(pa)) &&
              `mode ${mode}: block 2 continues from block 1's session; its history lacks the prefix`,
          );
        } else {
          const two = recordOf(run.rec, 2);
          const three = recordOf(run.rec, 3);
          const at = (found: string | undefined) => found && `mode ${mode}: ${found}`;
          problems.push(
            two === -1 && `mode ${mode}: the run holds no record of block 2`,
            two !== -1 && at(expectV(run.rec, two, `ledger.${key}`, 'pass', true)),
            three !== -1 && at(expectV(run.rec, three, `ledger.${key}`, 'fail', true)),
          );
        }
      }
      return problems;
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * a forced result with latency_ms on the vercel-ai adapter
 * ------------------------------------------------------------------------------------------------------- */

function forcedLatencyItem(): BankItem {
  const id = `${P}.forced-latency.vercel-ai`;
  return gitem(
    FAMILY,
    id,
    4,
    ADAPTERS_PKG,
    'forced-latency-with-result',
    'on the vercel-ai adapter a tool forced { result, latency_ms } returns the forced result after the latency, as a tool forced { result } returns its result at once',
    async (ctx) => {
      const name = tok(ctx, id, 'name', 7);
      const label = `${tok(ctx, id, 'ns', 5)}.${tok(ctx, id, 'op', 5)}`;
      const real = { from: tok(ctx, id, 'real', 8) };
      const slow = { from: tok(ctx, id, 'slow', 8) };
      const quick = { from: tok(ctx, id, 'quick', 8) };
      const latency = 60;
      const timings: number[] = [];
      const outputs: unknown[] = [];
      const generateText = async (args: {
        tools?: Record<string, { execute?: (input: unknown, options: unknown) => unknown }>;
      }) => {
        const tool = args.tools?.[name];
        const started = Date.now();
        const output = await tool?.execute?.({ q: 'x' }, { toolCallId: 'c1', messages: [] });
        timings.push(Date.now() - started);
        outputs.push(output);
        const content = [
          { type: 'tool-call', toolCallId: 'c1', toolName: name, input: { q: 'x' } },
          { type: 'tool-result', toolCallId: 'c1', toolName: name, input: { q: 'x' }, output },
          { type: 'text', text: 'Done.' },
        ];
        return {
          text: 'Done.',
          steps: [{ content, usage: { inputTokens: 1, outputTokens: 1 }, finishReason: 'stop' }],
        };
      };
      const vercelAiAdapter = need<(options: Record<string, unknown>) => Record<string, unknown>>(
        ctx.product.adapters,
        'adapters',
        'vercelAiAdapter',
      );
      const adapter = vercelAiAdapter({
        generateText,
        model: { modelId: 'fictional-model', provider: 'fictional', specificationVersion: 'v2' },
        system: 'You help Larkspur Cycles riders.',
        tools: { [name]: { description: 'Looks a bike up.', execute: async () => real } },
        toolLabels: { [name]: label },
        deterministic: true,
      });
      const spec = {
        id: tok(ctx, id, 'spec', 8),
        blocks: [
          {
            id: 'b0',
            user: tok(ctx, id, 'u0', 9),
            given: { world: { tools: { [label]: { result: slow, latency_ms: latency } } } },
            expect: { must: ['Done'] },
          },
          {
            id: 'b1',
            user: tok(ctx, id, 'u1', 9),
            given: { world: { tools: { [label]: { result: quick } } } },
            expect: { must: ['Done'] },
          },
        ],
      };
      const rec = await runLoaded(ctx.product, load(ctx.product, spec as never), adapter, { mode: 'F' });
      return [
        rec.status !== 'completed' &&
          `the run should complete; it is ${rec.status}: ${show((rec as { error?: unknown }).error)}`,
        outputs.length !== 2 &&
          `the agent should run the tool once per block; it ran it ${outputs.length} times`,
        JSON.stringify(outputs[1]) !== JSON.stringify(quick) &&
          `block 1 forces the result ${show(quick)}: the tool should return it; it returned ${show(outputs[1])}`,
        JSON.stringify(outputs[0]) !== JSON.stringify(slow) &&
          `block 0 forces the result ${show(slow)} with latency_ms ${latency}: the tool should return it; it returned ${show(outputs[0])}`,
        (timings[0] ?? 0) < latency - 10 &&
          `block 0 forces a latency of ${latency} ms: the tool should take it; it took ${timings[0]} ms`,
      ];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * a workspace folder written ./<path> on a block or a perturbation
 * ------------------------------------------------------------------------------------------------------- */

function anchorRunItem(where: 'block' | 'perturbation'): BankItem {
  const id = `${P}.anchor-workspace.${where}`;
  return gitem(
    FAMILY,
    id,
    where === 'block' ? 4 : 5,
    CORE_PKG,
    'anchor-workspace-from',
    where === 'block'
      ? "a block's given.world.workspace.from written ./<folder> is read from the spec file's folder: the agent finds its files at that block, not before"
      : "a world-only perturbation's workspace.from written ./<folder> is read from the spec file's folder: the agent finds its files on the injected block",
    async (ctx) => {
      const dir = folder(ctx, id);
      const seed = tok(ctx, id, 'seed', 6);
      const file = `${tok(ctx, id, 'file', 6)}.txt`;
      writeAt(join(dir, 'specs', seed, file), 'one planted line\n');
      const markers = [0, 1, 2].map((b) => tok(ctx, id, `m${b}`, 9));
      const workspace = { from: `./${seed}` };
      const raw = {
        id: tok(ctx, id, 'spec', 8),
        blocks: markers.map((marker, b) => ({
          id: `b${b}`,
          user: marker,
          ...(where === 'block' && b === 1 ? { given: { world: { workspace } } } : {}),
          expect: { must: ['Done'] },
        })),
        ...(where === 'perturbation'
          ? {
              perturbations: [{ id: 'seeded', class: 'D8_tool_failure', inject_at: 1, world: { workspace } }],
            }
          : {}),
      };
      const path = writeAt(join(dir, 'specs', 'spec.yaml'), raw);
      const loadSpecFile = need<(path: string) => Promise<{ ok: boolean; spec?: unknown; errors?: unknown }>>(
        ctx.product.core,
        'core',
        'loadSpecFile',
      );
      const loaded = await loadSpecFile(path);
      if (!loaded.ok) return [`the spec file loads; the loader refuses it: ${show(loaded.errors)}`];
      const actions = new Map<string, Action>(markers.map((marker) => [marker, { reply: 'Done.' }]));
      const agent = plantedAgent(ctx.product, 'code', actions, { scratch: ctx.scratch });
      const rec = await runLoaded(ctx.product, loaded.spec as never, agent.adapter, {
        mode: where === 'block' ? 'F' : 'P',
        ...(where === 'perturbation'
          ? {
              driver: need<(base: unknown, id: string) => unknown>(
                ctx.product.core,
                'core',
                'injectingDriver',
              )(need<() => unknown>(ctx.product.users, 'users', 'createScriptedDriver')(), 'seeded'),
              perturbationId: 'seeded',
            }
          : {}),
      });
      const seen = (marker: string) =>
        agent
          .delivered()
          .find((turn) => turn.marker === marker)
          ?.files?.some((each) => each.endsWith(file)) ?? false;
      return [
        rec.status !== 'completed' &&
          `the run should complete; it is ${rec.status}: ${show((rec as { error?: unknown }).error)}`,
        seen(markers[0] as string) && `block 0 comes before the workspace and should not hold ${file}`,
        !seen(markers[1] as string) &&
          `the workspace ./${seed} is read from the spec's folder, which holds ${file}: the agent should find it at block 1; it found ${show(
            agent.delivered().find((turn) => turn.marker === markers[1])?.files ?? [],
          )}`,
      ];
    },
  );
}

function anchorHashItem(): BankItem {
  const id = `${P}.anchor-workspace.hash`;
  return gitem(
    FAMILY,
    id,
    4,
    CLI_PKG,
    'anchor-workspace-from',
    'two copies of one spec in two folders, whose block names a workspace folder ./<path>, get two hashes, as copies whose spec-level workspace does',
    async (ctx) => {
      const dir = folder(ctx, id);
      const seed = tok(ctx, id, 'seed', 6);
      const spec = (level: 'spec' | 'block') => ({
        id: tok(ctx, id, `spec-${level}`, 8),
        ...(level === 'spec' ? { given: { world: { workspace: { from: `./${seed}` } } } } : {}),
        blocks: [
          { id: 'b0', user: tok(ctx, id, 'u0', 9), expect: { must: ['x'] } },
          {
            id: 'b1',
            user: tok(ctx, id, 'u1', 9),
            ...(level === 'block' ? { given: { world: { workspace: { from: `./${seed}` } } } } : {}),
            expect: { must: ['y'] },
          },
        ],
      });
      const files: string[] = [];
      for (const copy of ['one', 'two'])
        for (const level of ['spec', 'block'] as const) {
          const name = `${copy}/${level}.yaml`;
          writeAt(join(dir, copy, seed, 'note.txt'), 'one planted line\n');
          writeAt(join(dir, name), spec(level));
          files.push(name);
        }
      const result = await cli(ctx, ['spec', 'validate', ...files, '--json'], dir);
      const entries = parseEntries(result.out);
      if (typeof entries === 'string') return [`spec validate --json printed ${entries}`];
      const hash = (name: string) =>
        (entries.find((each) => (each.path ?? '').endsWith(name)) as { hash?: string } | undefined)?.hash;
      return [
        ...files.map(
          (name) =>
            hash(name) === undefined &&
            `${name} should be valid with a hash; spec validate gave ${show(entries.find((each) => (each.path ?? '').endsWith(name)))}`,
        ),
        hash('one/spec.yaml') === hash('two/spec.yaml') &&
          'the spec-level ./ folder resolves to two folders, so the two copies get two hashes; they share one',
        hash('one/block.yaml') === hash('two/block.yaml') &&
          `the block-level ./${seed} resolves from each copy's folder before the hash is taken, so the two copies get two hashes; they share ${hash('one/block.yaml')}`,
      ];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * the command line: a partly cached run's cost, and resume without --cache-suite
 * ------------------------------------------------------------------------------------------------------- */

type CliWorld = {
  dir: string;
  run(argv: string[]): Promise<{ code: number; out: string; err: string }>;
  close(): Promise<void>;
};

async function cliWorld(
  ctx: ItemContext,
  tag: string,
  costs: number[],
  failOnce?: number,
): Promise<CliWorld> {
  const dir = folder(ctx, tag);
  const users = costs.map((_, b) => tok(ctx, tag, `u${b}`, 10));
  const codes = costs.map((_, b) => tok(ctx, tag, `c${b}`, 8));
  let failed = false;
  const agent = await startHttpAgent((turn) => {
    const b = users.findIndex((user) => turn.user.includes(user));
    if (b === -1) throw new Error('no planted reply');
    if (b === failOnce && !failed) {
      failed = true;
      throw new Error('the agent stopped mid-way');
    }
    return { ...observed(`Yes, ${codes[b]}.`), cost: { usd: costs[b] } };
  });
  writeAt(join(dir, 'spec.yaml'), {
    id: tok(ctx, tag, 'spec', 8),
    target: {
      adapter: 'http',
      agent: 'larkspur',
      options: { url: agent.url, tool_stubs: false, deterministic: true },
    },
    blocks: users.map((user, b) => ({ id: `b${b}`, user, expect: { must: [codes[b]] } })),
  });
  return { dir, run: (argv) => cli(ctx, argv, dir), close: () => agent.close() };
}

const spentOf = (out: string): number | undefined => {
  const match = /Spent \$([0-9]+(?:\.[0-9]+)?)/.exec(out);
  return match ? Number(match[1]) : undefined;
};

function partialCacheItem(): BankItem {
  const id = `${P}.partial-cache.cost`;
  return gitem(
    FAMILY,
    id,
    5,
    CLI_PKG,
    'partial-cache-cost',
    'a run stopped after block 0 and resumed reads block 0 back from the cache: the resume spends only block 1, and its line has no replay note',
    async (ctx) => {
      const costs = [0.37, 0.05];
      const w = await cliWorld(ctx, id, costs, 1);
      try {
        const campaign = `c-${tok(ctx, id, 'c', 8)}`;
        const first = await w.run([
          'campaign',
          'run',
          'spec.yaml',
          '--store',
          'runs.db',
          '--campaign',
          campaign,
          '--retry-attempts',
          '1',
        ]);
        const resumed = await w.run(['campaign', 'resume', campaign, '--store', 'runs.db']);
        const line = resumed.out.split('\n').find((each) => each.includes(' · ')) ?? '';
        return [
          first.code !== 1 &&
            `the first command stops on block 1 and exits 1; it exits ${first.code}: ${first.err.slice(0, 160)}`,
          spentOf(first.out) !== 0.37 &&
            `the first command spent block 0 only, $0.37; its summary reads "${first.out.split('\n').find((each) => each.includes('Spent')) ?? first.out.slice(0, 160)}"`,
          resumed.code !== 0 &&
            `the resume completes the run and exits 0; it exits ${resumed.code}: ${resumed.err.slice(0, 160)}`,
          /replayed|reused/.test(line) &&
            `a partly cached run reads like a fresh run, with no note; its line reads "${line.trim()}"`,
          spentOf(resumed.out) !== 0.05 &&
            `the resume read block 0 back from the cache and sent block 1 alone: it spends $0.05; its summary reads "${resumed.out.split('\n').find((each) => each.includes('Spent')) ?? resumed.out.slice(0, 160)}"`,
        ];
      } finally {
        await w.close();
      }
    },
  );
}

function resumeSuiteItem(): BankItem {
  const id = `${P}.resume.no-cache-suite`;
  return gitem(
    FAMILY,
    id,
    2,
    CLI_PKG,
    'resume-no-cache-suite',
    'campaign resume refuses --cache-suite as an unknown option, exit 2; the same resume without it completes',
    async (ctx) => {
      const w = await cliWorld(ctx, id, [0, 0]);
      try {
        const campaign = `c-${tok(ctx, id, 'c', 8)}`;
        const first = await w.run([
          'campaign',
          'run',
          'spec.yaml',
          '--store',
          'runs.db',
          '--campaign',
          campaign,
        ]);
        const refused = await w.run([
          'campaign',
          'resume',
          campaign,
          '--store',
          'runs.db',
          '--cache-suite',
          tok(ctx, id, 'suite', 6),
        ]);
        const plain = await w.run(['campaign', 'resume', campaign, '--store', 'runs.db']);
        return [
          first.code !== 0 &&
            `the campaign passes and exits 0; it exits ${first.code}: ${first.err.slice(0, 160)}`,
          refused.code !== 2 &&
            `resume takes no --cache-suite: the option is an argument error, exit 2; it exits ${refused.code}: ${(refused.err || refused.out).slice(0, 160)}`,
          plain.code !== 0 &&
            `the resume without the option exits 0; it exits ${plain.code}: ${plain.err.slice(0, 160)}`,
        ];
      } finally {
        await w.close();
      }
    },
  );
}

export function runItems(): BankItem[] {
  return [
    eventsItem('empty'),
    eventsItem('prefix'),
    eventsItem('whole'),
    realizedItem('user'),
    realizedItem('burst'),
    ...EARLY.map(earlyItem),
    replacedItem('vars'),
    replacedItem('prefix'),
    replacedItem('ledger'),
    forcedLatencyItem(),
    anchorRunItem('block'),
    anchorRunItem('perturbation'),
    anchorHashItem(),
    partialCacheItem(),
    resumeSuiteItem(),
  ];
}
