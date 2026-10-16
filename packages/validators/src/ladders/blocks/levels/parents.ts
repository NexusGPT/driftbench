import {
  type AgentLog,
  between,
  code,
  list,
  loadIssues,
  observed,
  outcomeOf,
  pick,
  type RawSpec,
  type Rng,
  rngFor,
  run,
  SHOP,
  scriptedAdapter,
  shuffled,
  statusOf,
} from '../harness';
import { need } from '../product';
import { type BankItem, expectAll, fail, PASS, type Tier } from '../types';

/**
 * Level 7: parent blocks (docs/concepts/given-when-then.md, "Parent blocks", as the parents lane writes it on
 * feat/block-parents). A block sets `parent: <block id>` to start from that block's recorded end state: its
 * prefix holds the ancestors' actual replies and tool calls, never a sibling's; a passed parent runs once
 * however many children share it. A failed, unrun or blocked parent makes the child `blocked`, with no agent
 * call and no failure of its own: `blocked.by` names the direct parent, `blocked.root` the original cause, and
 * independent roots go on. The run counts the cause once. `PARENT_MISSING` and `PARENT_CYCLE` are spec errors.
 * Forests are drawn from the seed, every block's fate is planted, so every verdict is known.
 */

const RUNNER = 'packages/core/src/runner/run.ts';
const PARENTS = 'packages/core/src/spec/parents.ts';
const VERDICTS = 'packages/core/src/runner/verdicts.ts';

type Fate = 'pass' | 'fail' | 'not_run';

/** A forest: the parent of each block (by index, -1 for a root) and the order the blocks are written in. */
type Forest = { parents: number[]; written: number[] };

type Shape = { id: string; tier: number; draw(rng: Rng): number[] };

const SHAPES: Shape[] = [
  { id: 'chain', tier: 1, draw: (rng) => Array.from({ length: between(rng, 3, 6) }, (_, i) => i - 1) },
  { id: 'deep-chain', tier: 2, draw: (rng) => Array.from({ length: between(rng, 8, 12) }, (_, i) => i - 1) },
  {
    id: 'star',
    tier: 1,
    draw: (rng) => Array.from({ length: between(rng, 3, 6) }, (_, i) => (i === 0 ? -1 : 0)),
  },
  {
    id: 'two-roots',
    tier: 2,
    draw: (rng) => {
      const left = between(rng, 2, 3);
      const right = between(rng, 2, 3);
      return [
        ...Array.from({ length: left }, (_, i) => i - 1),
        ...Array.from({ length: right }, (_, i) => (i === 0 ? -1 : left + i - 1)),
      ];
    },
  },
  {
    id: 'random-tree',
    tier: 3,
    draw: (rng) =>
      Array.from({ length: between(rng, 5, 9) }, (_, i) => (i === 0 ? -1 : between(rng, 0, i - 1))),
  },
  {
    id: 'random-forest',
    tier: 4,
    draw: (rng) =>
      Array.from({ length: between(rng, 6, 10) }, (_, i) =>
        i === 0 || (i > 1 && rng() < 0.25) ? -1 : between(rng, 0, i - 1),
      ),
  },
];

/** A forest drawn for a shape, written in dependency order or shuffled (forward references). */
function forestOf(rng: Rng, shape: Shape, forward: boolean): Forest {
  const parents = shape.draw(rng);
  const order = [...parents.keys()];
  return { parents, written: forward ? shuffled(rng, order) : order };
}

type Placement = { id: string; tier: number; plant(rng: Rng, forest: Forest): Fate[] };

const roots = (forest: Forest) => forest.parents.flatMap((p, i) => (p === -1 ? [i] : []));
const inner = (forest: Forest) => forest.parents.flatMap((_, i) => (forest.parents.includes(i) ? [i] : []));
const leaves = (forest: Forest) => forest.parents.flatMap((_, i) => (forest.parents.includes(i) ? [] : [i]));

const PLACEMENTS: Placement[] = [
  { id: 'all-pass', tier: 0, plant: (_rng, f) => f.parents.map(() => 'pass') },
  {
    id: 'root-fails',
    tier: 0,
    plant: (rng, f) => {
      const r = pick(rng, roots(f));
      return f.parents.map((_, i) => (i === r ? 'fail' : 'pass'));
    },
  },
  {
    id: 'inner-fails',
    tier: 1,
    plant: (rng, f) => {
      const candidates = inner(f).filter((i) => f.parents[i] !== -1);
      const x = candidates.length > 0 ? pick(rng, candidates) : pick(rng, inner(f));
      return f.parents.map((_, i) => (i === x ? 'fail' : 'pass'));
    },
  },
  {
    id: 'leaf-fails',
    tier: 0,
    plant: (rng, f) => {
      const x = pick(rng, leaves(f));
      return f.parents.map((_, i) => (i === x ? 'fail' : 'pass'));
    },
  },
  {
    id: 'parent-not-run',
    tier: 2,
    plant: (rng, f) => {
      const x = pick(rng, inner(f));
      return f.parents.map((_, i) => (i === x ? 'not_run' : 'pass'));
    },
  },
  {
    id: 'two-causes',
    tier: 2,
    plant: (rng, f) => {
      const [a, b] = shuffled(rng, [...f.parents.keys()]);
      return f.parents.map((_, i) =>
        i === a ? 'fail' : i === b ? pick(rng, ['fail', 'not_run'] as const) : 'pass',
      );
    },
  },
];

/** The documented verdicts: blocked under any failed, unrun or blocked ancestor, by the parent, rooted at the topmost cause. */
export function forestVerdicts(parents: readonly number[], fates: readonly Fate[]) {
  const ancestors = (i: number): number[] => {
    const out: number[] = [];
    for (let p = parents[i] as number; p !== -1; p = parents[p] as number) out.unshift(p);
    return out;
  };
  return parents.map((parent, i) => {
    const chain = ancestors(i);
    const cause = chain.find((a) => fates[a] !== 'pass');
    if (cause !== undefined) return { status: 'blocked', by: parent, root: cause };
    return { status: fates[i] as string, by: -1, root: -1 };
  });
}

type Built = { raw: RawSpec; texts: string[]; tokens: string[]; ids: string[] };

/** The spec of a forest: block i asks for its token; a not_run fate forces a tool result the adapter cannot apply. */
function forestSpec(seed: number, tag: string, forest: Forest, fates: readonly Fate[]): Built {
  const rng = rngFor(seed, `${tag}#spec`);
  const ids = forest.parents.map((_, i) => `n${i}-${between(rng, 10, 99)}`);
  const texts = forest.parents.map(
    (_, i) => `[${tag}:${i}] ${pick(rng, SHOP.customers)} asks about the ${pick(rng, SHOP.bikes)}.`,
  );
  const tokens = forest.parents.map((_, i) => code(seed, tag, i));
  const blocks = forest.written.map((i) => ({
    id: ids[i],
    ...(forest.parents[i] === -1 ? {} : { parent: ids[forest.parents[i] as number] }),
    user: texts[i],
    ...(fates[i] === 'not_run'
      ? { given: { world: { tools: { 'bikes.lookup': { result: { free: true } } } } } }
      : {}),
    expect: { must: [tokens[i]] },
  }));
  return { raw: { id: `blocks-parents-${seed}`, channel: 'chat', blocks }, texts, tokens, ids };
}

/** The agent: block i says its token unless planted to fail; every reply also carries a marker the child can see. */
function forestAgent(built: Built, fates: readonly Fate[]) {
  return (turn: { user: string }) => {
    const i = built.texts.findIndex((text) => turn.user.includes(text));
    if (i < 0) throw new Error(`no planted block for "${turn.user.slice(0, 60)}"`);
    const said =
      fates[i] === 'fail' ? `Marker M${i}. Let me check.` : `Marker M${i}. Your code is ${built.tokens[i]}.`;
    return observed(said, [{ label: 'bikes.lookup', input: { block: i }, output: { seen: `R${i}` } }]);
  };
}

function verdictItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const shape of SHAPES) {
    for (const placement of PLACEMENTS) {
      const forward = shape.tier >= 3 || placement.id === 'two-causes';
      const id = `parents/verdicts/${shape.id}/${placement.id}`;
      items.push({
        id,
        family: 'parents-verdicts',
        tier: Math.min(5, shape.tier + placement.tier) as Tier,
        level: 7,
        component: placement.id === 'all-pass' ? RUNNER : VERDICTS,
        title: `a ${shape.id.replace(/-/g, ' ')} forest${forward ? ' written out of order' : ''} where ${placement.id.replace(/-/g, ' ')} reads every block pass, fail, not_run or blocked (by its parent, rooted at the first cause), never calls a blocked block, and counts each cause once`,
        cause:
          placement.id === 'all-pass'
            ? 'The runner runs a spec with parent links as a forest, each child after its parent.'
            : 'A failed, unrun or blocked parent makes its children blocked, with blocked.by the parent and blocked.root the first cause.',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const forest = forestOf(rng, shape, forward);
          const fates = placement.plant(rng, forest);
          const built = forestSpec(seed, id, forest, fates);
          const log: AgentLog = { turns: [] };
          const record = await run(
            product,
            built.raw,
            scriptedAdapter(product, forestAgent(built, fates), { capabilities: { toolStubs: false }, log }),
          );
          const want = forestVerdicts(forest.parents, fates);
          const byId = new Map(record.blocks.map((block) => [block.blockId, block]));
          for (const [i, expected] of want.entries()) {
            const block = byId.get(built.ids[i]);
            if (!block) return fail(`the run holds no block ${built.ids[i]}`);
            const status = statusOf(product, block);
            if (status !== expected.status)
              return fail(`block ${built.ids[i]} reads ${status}, expected ${expected.status}`);
            const calls = log.turns.filter((turn) => turn.user.includes(built.texts[i] as string)).length;
            if (expected.status === 'blocked') {
              if (calls > 0) return fail(`the blocked block ${built.ids[i]} reached the agent`);
              const by = built.ids[expected.by];
              const root = built.ids[expected.root];
              if (block.blocked?.by !== by || block.blocked?.root !== root)
                return fail(
                  `block ${built.ids[i]} is blocked by ${block.blocked?.by} (root ${block.blocked?.root}), expected by ${by} (root ${root})`,
                );
              if (block.verdicts.length > 0)
                return fail(`the blocked block ${built.ids[i]} carries verdicts`);
            } else if (expected.status !== 'not_run' && calls !== 1)
              return fail(`block ${built.ids[i]} reached the agent ${calls} times, expected once`);
          }
          const statuses = want.map((each) => each.status);
          const wantOutcome = statuses.includes('fail')
            ? 'fail'
            : statuses.includes('not_run')
              ? 'not_run'
              : statuses.includes('blocked')
                ? 'blocked'
                : 'pass';
          const countBlocks = need<(blocks: unknown[]) => Record<string, number>>(
            product.core,
            'core',
            'countBlocks',
          );
          const counts = countBlocks(record.blocks);
          const causes = fates.filter((fate, i) => fate === 'fail' && want[i]?.status === 'fail').length;
          return expectAll([
            [
              outcomeOf(product, record) === wantOutcome,
              `the run reads ${outcomeOf(product, record)}, expected ${wantOutcome}`,
            ],
            [
              counts.fail === causes,
              `the run counts ${counts.fail} failures, expected the ${causes} planted causes`,
            ],
            [
              counts.blocked === statuses.filter((s) => s === 'blocked').length,
              `the run counts ${counts.blocked} blocked, expected ${statuses.filter((s) => s === 'blocked').length}`,
            ],
          ]);
        },
      });
    }
  }
  return items;
}

/** The child starts from its ancestors' recorded end state: their replies and tool calls, never a sibling's. */
function stateItems(): BankItem[] {
  const items: BankItem[] = [];
  const views = [
    { id: 'ancestors-in-order', tier: 2 },
    { id: 'no-sibling-history', tier: 3 },
    { id: 'recorded-tool-results', tier: 3 },
    { id: 'ancestor-user-turns', tier: 2 },
  ] as const;
  for (const shape of SHAPES) {
    for (const view of views) {
      // A chain has no sibling: that view would check nothing.
      if (shape.id.endsWith('chain') && view.id === 'no-sibling-history') continue;
      const id = `parents/state/${shape.id}/${view.id}`;
      items.push({
        id,
        family: 'parents-state',
        tier: Math.min(5, shape.tier + view.tier - 1) as Tier,
        level: 7,
        component: RUNNER,
        title: `in a ${shape.id.replace(/-/g, ' ')} forest, each child's history ${view.id === 'ancestors-in-order' ? "holds its ancestors' replies in order" : view.id === 'no-sibling-history' ? 'holds no reply of a block outside its ancestors' : view.id === 'recorded-tool-results' ? "holds its ancestors' tool calls with their recorded results" : "holds the user turn of each ancestor once, and no other block's"}`,
        cause:
          view.id === 'ancestor-user-turns'
            ? "A child's history replays each ancestor's user turn once, and no other block's."
            : "A child starts from its parent's recorded end state: the ancestors' replies and tool calls, never a sibling's.",
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const forest = forestOf(rng, shape, shape.tier >= 3);
          const fates: Fate[] = forest.parents.map(() => 'pass');
          const built = forestSpec(seed, id, forest, fates);
          const log: AgentLog = { turns: [] };
          await run(product, built.raw, scriptedAdapter(product, forestAgent(built, fates), { log }));
          for (const [i] of forest.parents.entries()) {
            const turns = log.turns.filter((turn) => turn.user.includes(built.texts[i] as string));
            if (turns.length !== 1)
              return fail(`block ${built.ids[i]} reached the agent ${turns.length} times, expected once`);
            const turn = turns[0] as (typeof log.turns)[number];
            const lineage: number[] = [];
            for (let p = forest.parents[i] as number; p !== -1; p = forest.parents[p] as number)
              lineage.unshift(p);
            const replies = turn.messages
              .filter((m) => m.role === 'assistant')
              .map((m) => /Marker M(\d+)/.exec(m.content)?.[1])
              .filter((m) => m !== undefined)
              .map(Number);
            if (view.id === 'ancestors-in-order' && replies.join(',') !== lineage.join(','))
              return fail(
                `block ${built.ids[i]} saw the replies of ${list(replies)}, expected its ancestors ${list(lineage)}`,
              );
            if (view.id === 'no-sibling-history') {
              const stray = replies.filter((r) => !lineage.includes(r));
              if (stray.length > 0)
                return fail(`block ${built.ids[i]} saw the replies of non-ancestors ${list(stray)}`);
            }
            if (view.id === 'ancestor-user-turns') {
              const users = turn.messages
                .filter((m) => m.role === 'user')
                .map((m) => built.texts.findIndex((text) => m.content.includes(text)));
              const before = users.slice(0, -1);
              if (before.join(',') !== lineage.join(','))
                return fail(
                  `block ${built.ids[i]} saw the user turns of ${list(before)}, expected its ancestors ${list(lineage)}`,
                );
            }
            if (view.id === 'recorded-tool-results') {
              const results = turn.messages.flatMap((m) =>
                (m.tool_calls ?? []).map((c) => (c.output as { seen?: string } | undefined)?.seen),
              );
              const want = lineage.map((a) => `R${a}`);
              if (results.join(',') !== want.join(','))
                return fail(
                  `block ${built.ids[i]} saw the tool results ${list(results)}, expected ${list(want)}`,
                );
            }
          }
          return PASS;
        },
      });
    }
  }
  return items;
}

/** PARENT_MISSING and PARENT_CYCLE refuse a spec; a forward reference loads. */
function errorItems(): BankItem[] {
  const items: BankItem[] = [];
  const cases = [
    { id: 'missing', code: 'PARENT_MISSING', tier: 1 },
    { id: 'self', code: 'PARENT_CYCLE', tier: 2 },
    { id: 'two-cycle', code: 'PARENT_CYCLE', tier: 2 },
    { id: 'long-cycle', code: 'PARENT_CYCLE', tier: 3 },
    { id: 'forward-reference', code: undefined, tier: 2 },
  ] as const;
  for (const errorCase of cases) {
    for (const size of [3, 5, 7, 9]) {
      const id = `parents/errors/${errorCase.id}/${size}`;
      items.push({
        id,
        family: 'parents-errors',
        tier: errorCase.tier as Tier,
        level: 7,
        component: PARENTS,
        title: `a spec of ${size} blocks whose parent links are ${errorCase.id.replace(/-/g, ' ')} ${errorCase.code ? `is refused with ${errorCase.code}` : 'loads'}`,
        cause: errorCase.code
          ? `The loader refuses parent links that are ${errorCase.id.replace(/-/g, ' ')} with ${errorCase.code}.`
          : 'The loader accepts a parent written after its child.',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const ids = Array.from({ length: size }, (_, i) => `k${i}-${between(rng, 10, 99)}`);
          const parents: (string | undefined)[] = ids.map((_, i) =>
            i === 0 ? undefined : ids[between(rng, 0, i - 1)],
          );
          const at = between(rng, 1, size - 1);
          if (errorCase.id === 'missing') parents[at] = `${ids[at]}-gone`;
          if (errorCase.id === 'self') parents[at] = ids[at];
          if (errorCase.id === 'two-cycle') {
            parents[0] = ids[at];
            parents[at] = ids[0];
          }
          if (errorCase.id === 'long-cycle') {
            for (let i = 0; i < size; i += 1) parents[i] = ids[(i + 1) % size];
          }
          const order = errorCase.id === 'forward-reference' ? [...ids.keys()].reverse() : [...ids.keys()];
          const blocks = order.map((i) => ({
            id: ids[i],
            ...(parents[i] ? { parent: parents[i] } : {}),
            user: `[${id}:${i}] Hello`,
            expect: { must: ['Hello'] },
          }));
          const result = loadIssues(product, { id: `blocks-parent-errors-${seed}`, blocks });
          if (errorCase.code === undefined)
            return result.ok ? PASS : fail(`the loader refused a forward reference: ${list(result.codes)}`);
          return !result.ok && result.codes.includes(errorCase.code)
            ? PASS
            : fail(
                `the loader answered ${result.ok ? 'ok' : list(result.codes)}, expected ${errorCase.code}`,
              );
        },
      });
    }
  }
  return items;
}

/** Level 7 of the blocks bank. */
export function parentItems(): BankItem[] {
  return [...verdictItems(), ...stateItems(), ...errorItems()];
}
