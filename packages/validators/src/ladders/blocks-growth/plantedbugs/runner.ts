import { between, canonical, rngFor, type Seen, type Turn } from '../../blocks/harness';
import { type BlockDef, call, play, type RunRecord, scenario } from '../../blocks-breaker/kit';
import { type BankItem, CORE, type ItemContext, pitem, show, tok, twoTokens } from './kit';

/**
 * plantedbugs.runner: two rules of the runner that the bank held only in their easy case.
 *
 * - The canonical prefix of mode T (docs/concepts/run-modes.md "Teacher-forced") carries each expected tool as many
 *   times as its count asks, its min for a range: a range that writes only a max has no min, so the tool is carried
 *   no time. Each item sets such a range beside counts that carry calls, so a prefix that drops every call fails too.
 * - A fact a block adds with ledger_add is in the ledger from that block on (docs/running.md "Given resolution and the
 *   hash", docs/concepts/drift.md "The ledger check"): when the ledger already holds the fact, the added value
 *   replaces it. Each item states the new value in one block and the old value in another, so a check that never
 *   compares, or always flags, fails as well.
 */

/* ---------------------------------------------------------------------------------------------------------
 * the canonical prefix: a count with a max and no min carries no call
 * ------------------------------------------------------------------------------------------------------- */

/** The tool labels of each assistant message of the history a turn received, counted by label. */
function assistantCounts(turn: Turn | undefined): Record<string, number>[] {
  return ((turn?.messages ?? []) as Seen[])
    .filter((message) => message.role === 'assistant')
    .map((message) => {
      const counts: Record<string, number> = {};
      for (const each of message.tool_calls ?? []) counts[each.label] = (counts[each.label] ?? 0) + 1;
      return counts;
    });
}

type Expectation = { label: string; count?: unknown; carried: number };

/** The expectations of one block: tools with their count and the calls a canonical message carries for each. */
function expectations(ctx: ItemContext, tag: string, block: number, kinds: readonly string[]): Expectation[] {
  const rng = rngFor(ctx.seed, `pb:${tag}:counts:${block}`);
  return kinds.map((kind, index) => {
    const label = tok(ctx, tag, `label:${block}:${index}`, 8);
    if (kind === 'max-only') return { label, count: { max: between(rng, 0, 4) }, carried: 0 };
    if (kind === 'range') {
      const min = between(rng, 1, 3);
      return { label, count: { min, max: min + between(rng, 0, 3) }, carried: min };
    }
    if (kind === 'exact') {
      const n = between(rng, 1, 3);
      return { label, count: n, carried: n };
    }
    return { label, carried: 1 };
  });
}

/** What a canonical message carries for `tools`: each label with a count above 0. */
const carriedOf = (tools: readonly Expectation[]): Record<string, number> =>
  Object.fromEntries(tools.filter((each) => each.carried > 0).map((each) => [each.label, each.carried]));

/**
 * A spec whose blocks before the last expect `perBlock[i]`; the agent calls every expected tool twice, so a prefix
 * built from the agent's own calls differs from the canonical one. Returns the turn of the last block.
 */
async function canonicalRun(ctx: ItemContext, tag: string, perBlock: readonly Expectation[][]) {
  const defs: BlockDef[] = [
    ...perBlock.map((tools, b) => ({
      expect: {
        tools: tools.map((each) => ({
          label: each.label,
          ...(each.count === undefined ? {} : { count: each.count }),
        })),
      },
      plan: {
        text: tok(ctx, tag, `reply:${b}`, 9),
        calls: tools.flatMap((each) => [call(each.label), call(each.label)]),
      },
    })),
    { plan: { text: tok(ctx, tag, 'reply:last', 9) } },
  ];
  const { log, rec } = await play(ctx, scenario(ctx.seed, `pb:${tag}`, defs), { mode: 'T' });
  return { turn: log.turns[perBlock.length], rec };
}

function canonicalItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (id: string, tier: 2 | 3 | 4, title: string, kinds: readonly (readonly string[])[]) =>
    out.push(
      pitem(`pb.canonical.${id}`, tier, 1, CORE, 'canonical-count', title, async (ctx) => {
        const tag = `canonical.${id}`;
        const perBlock = kinds.map((each, b) => expectations(ctx, tag, b, each));
        const { turn, rec } = await canonicalRun(ctx, tag, perBlock);
        if (!turn)
          return [
            `the last block should reach the agent in mode T; the run is ${rec.status} with ${rec.blocks.length} blocks`,
          ];
        const got = assistantCounts(turn);
        const want = perBlock.map(carriedOf);
        return [
          canonical(got) !== canonical(want) &&
            `the canonical prefix of the last block should carry, per earlier block, ${show(want)} (counts ${show(
              perBlock.map((tools) => tools.map((each) => each.count ?? 'none')),
            )}); it carries ${show(got)}`,
        ];
      }),
    );
  add(
    'max-only-beside-range',
    3,
    'in mode T, a tool expected with a count that writes only a max is carried no time in the canonical prefix, while a tool expected with a range carries its min',
    [['max-only', 'range']],
  );
  add(
    'max-only-beside-exact-and-bare',
    3,
    'in mode T, the canonical message of a block that expects a max-only count, an exact count and a tool with no count carries none, the exact number and one call',
    [['exact', 'max-only', 'bare']],
  );
  add(
    'max-only-over-two-blocks',
    4,
    'in mode T, the canonical prefix of a third block carries no call for the max-only count of the first block and the exact calls of the second, one message per block',
    [
      ['max-only', 'bare'],
      ['exact', 'max-only'],
    ],
  );
  return out;
}

/* ---------------------------------------------------------------------------------------------------------
 * ledger_add: the added value replaces a held one
 * ------------------------------------------------------------------------------------------------------- */

type Step = {
  add?: Record<string, unknown>;
  given?: Record<string, unknown>;
  states?: Record<string, unknown>;
};

const ledgerOutcome = (rec: RunRecord, block: number, fact: string): string => {
  const verdicts = (rec.blocks[block]?.verdicts ?? []) as { id: string; outcome: string }[];
  return verdicts.find((each) => each.id === `ledger.${fact}`)?.outcome ?? 'none';
};

async function ledgerRun(
  ctx: ItemContext,
  tag: string,
  ledger: Record<string, unknown>,
  steps: readonly Step[],
  mode: 'F' | 'T',
): Promise<RunRecord> {
  const tool = tok(ctx, tag, 'tool', 7);
  const defs: BlockDef[] = steps.map((step, b) => ({
    plan: { text: tok(ctx, tag, `reply:${b}`, 9), calls: step.states ? [call(tool, step.states)] : [] },
    ...(step.add ? { expect: { ledger_add: step.add } } : {}),
    ...(step.given ? { given: step.given } : {}),
  }));
  const sc = scenario(
    ctx.seed,
    `pb:${tag}`,
    defs,
    Object.keys(ledger).length > 0 ? { given: { ledger } } : {},
  );
  return (await play(ctx, sc, { mode })).rec;
}

function ledgerItems(): BankItem[] {
  const out: BankItem[] = [];
  const names = (ctx: ItemContext, tag: string) => {
    const fact = `${tok(ctx, tag, 'k1', 5)}_${tok(ctx, tag, 'k2', 5)}`;
    const [held, added] = twoTokens(ctx, tag, 'value', 8);
    return { fact, held, added };
  };
  const later = (
    id: string,
    tier: 2 | 3 | 4,
    title: string,
    mode: 'F' | 'T',
    build: (n: ReturnType<typeof names>) => {
      ledger: Record<string, unknown>;
      steps: Step[];
      want: string[];
    },
  ) =>
    out.push(
      pitem(`pb.ledger-add.${id}`, tier, 1, CORE, 'ledger-add-later', title, async (ctx) => {
        const tag = `ledger-add.${id}`;
        const n = names(ctx, tag);
        const { ledger, steps, want } = build(n);
        const rec = await ledgerRun(ctx, tag, ledger, steps, mode);
        const got = steps.map((_, b) => ledgerOutcome(rec, b, n.fact));
        return [
          got.join() !== want.join() &&
            `ledger.${n.fact} per block should be ${want.join(', ')} (the added value replaces the held one); it is ${got.join(', ')}`,
        ];
      }),
    );
  later(
    'replaces-given',
    3,
    'a ledger_add that gives a fact of given.ledger another value replaces it: a later block stating the added value passes ledger.<fact>, one stating the held value fails it',
    'F',
    (n) => ({
      ledger: { [n.fact]: n.held },
      steps: [
        { add: { [n.fact]: n.added } },
        { states: { [n.fact]: n.added } },
        { states: { [n.fact]: n.held } },
      ],
      want: ['none', 'pass', 'fail'],
    }),
  );
  later(
    'replaces-given-mode-t',
    3,
    'in mode T, a ledger_add that gives a fact of given.ledger another value replaces it for every later block: the added value passes ledger.<fact>, the held value fails it',
    'T',
    (n) => ({
      ledger: { [n.fact]: n.held },
      steps: [
        { add: { [n.fact]: n.added } },
        { states: { [n.fact]: n.held } },
        { states: { [n.fact]: n.added } },
      ],
      want: ['none', 'fail', 'pass'],
    }),
  );
  later(
    'replaces-earlier-add',
    3,
    'a ledger_add that gives a fact an earlier ledger_add set another value replaces it: a later block stating the newer value passes ledger.<fact>, one stating the older value fails it',
    'F',
    (n) => ({
      ledger: {},
      steps: [
        { add: { [n.fact]: n.held } },
        { add: { [n.fact]: n.added } },
        { states: { [n.fact]: n.added } },
        { states: { [n.fact]: n.held } },
      ],
      want: ['none', 'none', 'pass', 'fail'],
    }),
  );
  later(
    'replaces-block-given',
    4,
    "a block's ledger_add that gives a fact of the block's own given.ledger another value replaces it in the later blocks: the added value passes ledger.<fact>, the given value fails it",
    'F',
    (n) => ({
      ledger: {},
      steps: [
        { given: { ledger: { [n.fact]: n.held } }, add: { [n.fact]: n.added } },
        { states: { [n.fact]: n.held } },
        { states: { [n.fact]: n.added } },
      ],
      want: ['none', 'fail', 'pass'],
    }),
  );
  out.push(
    pitem(
      'pb.ledger-add.same-block-replaces',
      3,
      1,
      CORE,
      'ledger-add-same-block',
      'the ledger a block is compared with holds its own ledger_add over the held value: the block stating the added value passes ledger.<fact>, the twin stating the held value fails it',
      async (ctx) => {
        const tag = 'ledger-add.same-block-replaces';
        const n = names(ctx, tag);
        const ledger = { [n.fact]: n.held };
        const right = await ledgerRun(
          ctx,
          `${tag}:right`,
          ledger,
          [{ add: { [n.fact]: n.added }, states: { [n.fact]: n.added } }],
          'F',
        );
        const wrong = await ledgerRun(
          ctx,
          `${tag}:wrong`,
          ledger,
          [{ add: { [n.fact]: n.added }, states: { [n.fact]: n.held } }],
          'F',
        );
        const a = ledgerOutcome(right, 0, n.fact);
        const b = ledgerOutcome(wrong, 0, n.fact);
        return [
          a !== 'pass' &&
            `the block that adds a value and states it should pass ledger.${n.fact}, the added value replacing the held one; it is ${a}`,
          b !== 'fail' &&
            `the block that adds a value and states the held one should fail ledger.${n.fact}; it is ${b}`,
        ];
      },
    ),
  );
  return out;
}

export function runnerItems(): BankItem[] {
  return [...canonicalItems(), ...ledgerItems()];
}
