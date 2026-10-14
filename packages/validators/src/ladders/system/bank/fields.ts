import {
  canonicalJson,
  compareTranscripts,
  compoundingIndex,
  contentHash,
  type RunResult,
} from '@agent-nexus/driftbench-core';
import { SYSTEM_COMPONENTS } from '../components';
import { GUARD, LOOKUP, withForbiddenCall } from '../family';
import { type Behaviour, DETOUR, type Flow, followerReply, type RawSpec } from '../plant';
import { between, rngFor } from '../random';
import { DOC_CLASS } from './reach';
import {
  type BankItem,
  type Draft,
  expectAll,
  fail,
  type ItemResult,
  PASS,
  type Tier,
  withCauses,
} from './types';
import { behavioursFor, failingList, loadRaw, plantedFlow, runScenario } from './world';

/**
 * Levels 5 and 6: every field of the run record equals what the plant implies (docs/running.md "The run
 * record", "End state"), and every perturbed run's recovery record equals the plant (docs/concepts/
 * recovery.md, "Recovery metrics").
 */

const RUNNER = SYSTEM_COMPONENTS.runner;

function add(
  out: Draft[],
  id: string,
  tier: Tier,
  component: string,
  title: string,
  check: Draft['check'],
  level = 5,
  family = 'run-fields',
): void {
  out.push({ id, family, tier, level, component, source: 'contract', title, check });
}

/** The succession the docs define, computed from the planted failing positions. */
function succession(failing: ReadonlySet<number>, blocks: number) {
  let longest = 0;
  let clean = 0;
  for (let index = 0; index < blocks; index += 1) {
    clean = failing.has(index) ? 0 : clean + 1;
    longest = Math.max(longest, clean);
  }
  const sorted = [...failing].sort((a, b) => a - b);
  return {
    ...(sorted.length > 0 ? { firstDriftBlock: sorted[0] } : {}),
    driftCount: failing.size,
    driftRate: failing.size / blocks,
    longestClean: longest,
    minOverBlocks: failing.size === 0,
  };
}

const PATTERNS: Array<[string, number[]]> = [
  ['none', []],
  ['first', [0]],
  ['last', [7]],
  ['middle', [3]],
  ['pair', [2, 3]],
  ['ends', [0, 7]],
  ['alternate', [1, 3, 5]],
  ['all', [0, 1, 2, 3, 4, 5, 6, 7]],
  ['front-half', [0, 1, 2, 3]],
  ['back-half', [4, 5, 6, 7]],
];

function runFields(): Draft[] {
  const out: Draft[] = [];
  for (const [name, positions] of PATTERNS) {
    add(
      out,
      `fields/succession/${name}`,
      positions.length > 2 ? 2 : 1,
      'packages/core/src/runner/succession.ts',
      `the succession of a run failing at ${name} blocks is exactly as documented`,
      async ({ seed }) => {
        const planted = plantedFlow(seed, `succ-${name}`);
        const run = await runScenario(
          planted.spec,
          behavioursFor(planted, new Map(positions.map((at) => [at, ['X1_local']]))),
        );
        const want = succession(new Set(positions), planted.truths.length);
        return canonicalJson(run.succession) === canonicalJson(want)
          ? PASS
          : fail(`succession ${canonicalJson(run.succession)}, planted ${canonicalJson(want)}`);
      },
    );
  }

  const costed = (
    planted: Flow,
    cost: (
      index: number,
    ) => Partial<Pick<ReturnType<typeof followerReply>, 'cost' | 'segments' | 'latencyMs'>>,
  ) => {
    const behaviours = new Map<string, Behaviour>();
    planted.truths.forEach((truth, index) => {
      behaviours.set(planted.texts[index] as string, () => ({ ...followerReply(truth), ...cost(index) }));
    });
    return behaviours;
  };
  add(
    out,
    'fields/cost/block-totals',
    1,
    RUNNER,
    'the run cost is the sum of the block totals',
    async ({ seed }) => {
      const planted = plantedFlow(seed, 'cost-total', 4);
      const run = await runScenario(
        planted.spec,
        costed(planted, (index) => ({ cost: { usd: 0.001 * (index + 1) } })),
      );
      return Math.abs(run.cost - 0.01) < 1e-12 ? PASS : fail(`cost ${run.cost}, planted 0.01`);
    },
  );
  add(
    out,
    'fields/cost/segment-fallback',
    2,
    RUNNER,
    'a block without a total costs the sum of its segments',
    async ({ seed }) => {
      const planted = plantedFlow(seed, 'cost-segments', 3);
      const run = await runScenario(
        planted.spec,
        costed(planted, (index) => {
          const reply = followerReply(planted.truths[index] as never);
          return {
            cost: {},
            segments: reply.segments.map((segment) => ({ ...segment, cost: { usd: 0.002 } })),
          };
        }),
      );
      return Math.abs(run.cost - 3 * 3 * 0.002) < 1e-12
        ? PASS
        : fail(`cost ${run.cost}, planted ${3 * 3 * 0.002}`);
    },
  );
  add(out, 'fields/cost/total-wins', 2, RUNNER, 'a block total wins over its segments', async ({ seed }) => {
    const planted = plantedFlow(seed, 'cost-wins', 2);
    const run = await runScenario(
      planted.spec,
      costed(planted, (index) => {
        const reply = followerReply(planted.truths[index] as never);
        return {
          cost: { usd: 0.5 },
          segments: reply.segments.map((segment) => ({ ...segment, cost: { usd: 9 } })),
        };
      }),
    );
    return Math.abs(run.cost - 1) < 1e-12 ? PASS : fail(`cost ${run.cost}, planted 1`);
  });
  add(
    out,
    'fields/latency',
    1,
    RUNNER,
    'the run latency is the sum of the block latencies',
    async ({ seed }) => {
      const planted = plantedFlow(seed, 'latency', 4);
      const run = await runScenario(
        planted.spec,
        costed(planted, (index) => ({ latencyMs: 10 * (index + 1) })),
      );
      return run.latencyMs === 100 ? PASS : fail(`latency ${run.latencyMs}, planted 100`);
    },
  );
  add(
    out,
    'fields/stage-observed',
    2,
    RUNNER,
    'stageObserved is the last stage the block reported, and the stage still holding from an earlier block when it reported none (docs/concepts/drift.md)',
    async ({ seed }) => {
      const planted = plantedFlow(seed, 'stage-observed', 3);
      const behaviours = behavioursFor(planted);
      behaviours.set(planted.texts[1] as string, () => ({
        ...followerReply(planted.truths[1] as never),
        runtime: { stages: [{ name: 'open' }, { name: 'identify' }] },
      }));
      behaviours.set(planted.texts[2] as string, () => {
        const reply = followerReply(planted.truths[2] as never);
        return { ...reply, runtime: { guards: [{ name: GUARD, verdict: 'allow' }] } };
      });
      const run = await runScenario(planted.spec, behaviours);
      return expectAll([
        [
          run.blocks[1]?.stageObserved === 'identify',
          `block 1 stageObserved ${run.blocks[1]?.stageObserved}`,
        ],
        [
          run.blocks[2]?.stageObserved === 'identify',
          `block 2 stageObserved ${run.blocks[2]?.stageObserved}, expected identify carried from block 1`,
        ],
      ]);
    },
  );
  add(
    out,
    'fields/given-hash',
    2,
    RUNNER,
    'the Given hash is 12 hex characters, equal across two runs of one block, and changes with the ledger',
    async ({ seed }) => {
      const planted = plantedFlow(seed, 'given-hash', 2);
      const a = await runScenario(planted.spec, behavioursFor(planted));
      const b = await runScenario(planted.spec, behavioursFor(planted), { repeat: 1 });
      const other: RawSpec = {
        ...planted.spec,
        given: { ledger: { email: planted.truths[0]?.email, plan: 'fiber' } },
      };
      const c = await runScenario(other, behavioursFor(planted));
      return expectAll([
        [/^[0-9a-f]{12}$/.test(a.blocks[0]?.givenHash ?? ''), `hash ${a.blocks[0]?.givenHash}`],
        [a.blocks[0]?.givenHash === b.blocks[0]?.givenHash, 'two repeats of one block hash apart'],
        [a.blocks[0]?.givenHash !== c.blocks[0]?.givenHash, 'a changed ledger keeps the hash'],
      ]);
    },
  );
  add(
    out,
    'fields/ledger-contradiction',
    2,
    RUNNER,
    'a ledger_add that changes a held fact is listed in ledgerCheck and does not fail the block',
    async ({ seed }) => {
      const planted = plantedFlow(seed, 'ledger-add', 2);
      planted.spec.given = { ledger: { email: planted.truths[0]?.email, plan: 'basic' } };
      (
        (planted.spec.blocks as Array<{ expect: Record<string, unknown> }>)[1] as {
          expect: Record<string, unknown>;
        }
      ).expect.ledger_add = { plan: 'fiber' };
      const run = await runScenario(planted.spec, behavioursFor(planted));
      const check = run.blocks[1]?.ledgerCheck;
      return expectAll([
        [
          check?.ok === false &&
            check.contradictions.length === 1 &&
            /^plan:/.test(check.contradictions[0] ?? ''),
          `ledgerCheck ${canonicalJson(check)}`,
        ],
        [run.blocks[1]?.pass === true, 'the contradiction failed the block'],
      ]);
    },
  );
  add(
    out,
    'fields/run-id-and-hash',
    1,
    RUNNER,
    'the run id is the cell id and the spec hash is the content hash of the spec',
    async ({ seed }) => {
      const planted = plantedFlow(seed, 'ids', 2);
      const run = await runScenario(planted.spec, behavioursFor(planted));
      const spec = loadRaw(planted.spec);
      return expectAll([
        [run.specHash === contentHash(spec), 'specHash differs from the content hash'],
        [/^[0-9a-f]{16}$/.test(run.runId), `runId ${run.runId}`],
      ]);
    },
  );
  add(
    out,
    'fields/clock',
    1,
    RUNNER,
    'startedAt and finishedAt come from the clock the runner is given',
    async ({ seed }) => {
      const planted = plantedFlow(seed, 'clock', 2);
      const run = await runScenario(planted.spec, behavioursFor(planted));
      return run.startedAt === '2026-10-11T00:00:00.000Z' && run.finishedAt === run.startedAt
        ? PASS
        : fail(`${run.startedAt} ${run.finishedAt}`);
    },
  );

  // End state: one item per row of the docs table that a function agent can produce.
  const endState = (
    name: string,
    tier: Tier,
    title: string,
    setup: (planted: Flow) => void,
    want: (run: RunResult, planted: Flow) => ItemResult,
    place = false,
  ) =>
    add(
      out,
      `fields/end-state/${name}`,
      tier,
      'packages/core/src/runner/assertion.ts',
      title,
      async ({ seed }) => {
        const planted = plantedFlow(seed, `end-${name}`, 2);
        setup(planted);
        let behaviours = behavioursFor(planted);
        if (place) {
          const last = planted.texts[1] as string;
          const base = behaviours.get(last) as Behaviour;
          behaviours = new Map(behaviours);
          behaviours.set(last, (target) => withForbiddenCall(base(target)));
        }
        return want(await runScenario(planted.spec, behaviours), planted);
      },
    );
  endState(
    'field-differs',
    2,
    'a field that does not hold is one diff entry with the assertion and the observed value',
    (planted) => {
      planted.spec.end_state = { source: `tool:${LOOKUP}`, expect: { email: 'nobody@example.org', step: 2 } };
    },
    (run, planted) =>
      canonicalJson(run.endState) ===
      canonicalJson({
        match: false,
        diff: [{ field: 'email', expected: 'nobody@example.org', observed: planted.truths[1]?.email }],
      })
        ? PASS
        : fail(`end state ${canonicalJson(run.endState)}`),
  );
  endState(
    'source-recorded-nothing',
    3,
    'a source that recorded nothing gives one entry per expected field, observed absent',
    (planted) => {
      planted.spec.end_state = [
        { source: 'tool:orders.place', expect: { plan: 'fiber', confirmed: { absent: true } } },
      ];
    },
    (run) => {
      const diff = run.endState?.diff ?? [];
      return run.endState?.match === false &&
        diff.length === 2 &&
        diff.every((entry) => canonicalJson(entry.observed) === canonicalJson({ absent: true }))
        ? PASS
        : fail(`end state ${canonicalJson(run.endState)}`);
    },
  );
  endState(
    'empty-expect-nothing',
    3,
    'an empty expect on a source that recorded nothing gives one nonempty entry',
    (planted) => {
      planted.spec.end_state = [{ source: 'tool:orders.place', expect: {} }];
    },
    (run) =>
      canonicalJson(run.endState?.diff) ===
      canonicalJson([
        { field: 'tool:orders.place', expected: { nonempty: true }, observed: { absent: true } },
      ])
        ? PASS
        : fail(`end state ${canonicalJson(run.endState)}`),
  );
  endState(
    'exact-extra-field',
    3,
    'exact mode names a recorded field the spec does not list, expected absent',
    (planted) => {
      planted.spec.end_state = {
        source: `tool:${LOOKUP}`,
        mode: 'exact',
        expect: { email: planted.truths[1]?.email },
      };
    },
    (run) =>
      canonicalJson(run.endState?.diff) ===
      canonicalJson([{ field: 'step', expected: { absent: true }, observed: 2 }])
        ? PASS
        : fail(`end state ${canonicalJson(run.endState)}`),
  );
  endState(
    'none-with-payloads',
    3,
    'end_state none with payloads gives one entry per payload, field *.<index>',
    (planted) => {
      planted.spec.end_state = 'none';
    },
    (run) => {
      const fields = (run.endState?.diff ?? []).map((entry) => entry.field);
      return run.endState?.match === false && canonicalJson(fields) === canonicalJson(['*.0', '*.1'])
        ? PASS
        : fail(`end state ${canonicalJson(run.endState)}`);
    },
  );
  endState(
    'list-field-names',
    3,
    'in a list of sources a differing field is named <source>.<field>',
    (planted) => {
      planted.spec.end_state = [
        { source: `tool:${LOOKUP}`, expect: { email: planted.truths[1]?.email } },
        { source: 'tool:orders.place', expect: { confirmed: true } },
      ];
    },
    (run) =>
      canonicalJson(run.endState?.diff.map((entry) => entry.field)) ===
      canonicalJson(['tool:orders.place.confirmed'])
        ? PASS
        : fail(`end state ${canonicalJson(run.endState)}`),
    true,
  );

  add(
    out,
    'fields/transcript-identical',
    2,
    'packages/core/src/runner/transcript.ts',
    'two runs of a deterministic agent have equal transcripts and equal hashes',
    async ({ seed }) => {
      const planted = plantedFlow(seed, 'transcript-same', 4);
      const a = await runScenario(planted.spec, behavioursFor(planted));
      const b = await runScenario(planted.spec, behavioursFor(planted), { repeat: 1, adapter: 'http' });
      const comparison = compareTranscripts([a, b]);
      return comparison.identical ? PASS : fail(`differ at ${canonicalJson(comparison.firstDifference)}`);
    },
  );
  add(
    out,
    'fields/transcript-differs',
    2,
    'packages/core/src/runner/transcript.ts',
    'two runs that differ at one block name that block as the first difference',
    async ({ seed }) => {
      const planted = plantedFlow(seed, 'transcript-diff', 6);
      const at = between(rngFor(seed, 'transcript-at'), 0, 5);
      const a = await runScenario(planted.spec, behavioursFor(planted));
      const b = await runScenario(planted.spec, behavioursFor(planted, new Map([[at, ['X5_tool']]])));
      const comparison = compareTranscripts([a, b]);
      return comparison.firstDifference?.block === at && comparison.firstDifference.run === 1
        ? PASS
        : fail(`first difference ${canonicalJson(comparison.firstDifference)}, planted block ${at}`);
    },
  );
  add(
    out,
    'fields/compounding-index',
    4,
    'packages/core/src/runner/compounding.ts',
    'the compounding index of a spec is the T pass rate minus the F pass rate over its blocks',
    async ({ seed }) => {
      const planted = plantedFlow(seed, 'compounding', 8);
      const f = await runScenario(
        planted.spec,
        behavioursFor(
          planted,
          new Map([
            [2, ['X1_local']],
            [3, ['X1_local']],
            [4, ['X1_local']],
          ]),
        ),
        { mode: 'F' },
      );
      const t = await runScenario(planted.spec, behavioursFor(planted, new Map([[2, ['X1_local']]])), {
        mode: 'T',
      });
      const index = compoundingIndex([f, t]);
      const line = index.specs[0];
      const value = (line as { index?: number } | undefined)?.index;
      return value !== undefined && Math.abs(value - 2 / 8) < 1e-12
        ? PASS
        : fail(`index ${canonicalJson(line)}, planted 0.25`);
    },
  );
  add(out, 'fields/drift-on-pass', 1, RUNNER, 'a passing block carries no drift class', async ({ seed }) => {
    const planted = plantedFlow(seed, 'drift-pass', 4);
    const run = await runScenario(planted.spec, behavioursFor(planted));
    return run.blocks.every((block) => block.drift.length === 0) ? PASS : fail(failingList(run));
  });
  add(
    out,
    'fields/non-gating-fail',
    3,
    RUNNER,
    'a failing verdict that does not gate gives no drift class and does not fail the block',
    async ({ seed }) => {
      const planted = plantedFlow(seed, 'non-gating', 2);
      const run = await runScenario(planted.spec, behavioursFor(planted), {
        checks: [
          ...(await import('@agent-nexus/driftbench-checks')).defaultChecks(),
          {
            name: 'custom',
            applies: () => true,
            evaluate: () => [
              {
                id: 'stage.soft',
                kind: 'machine',
                name: 'soft',
                gating: false,
                outcome: 'fail',
                evidence: 'planted',
              },
            ],
          },
        ],
      });
      return run.blocks.every((block) => block.pass && block.drift.length === 0)
        ? PASS
        : fail('a non-gating verdict failed a block or gave it a class');
    },
  );
  add(
    out,
    'fields/class-order',
    3,
    'packages/core/src/runner/drift.ts',
    'a block with several classes lists them in the order X1 to X5',
    async ({ seed }) => {
      const planted = plantedFlow(seed, 'class-order', 3);
      const run = await runScenario(
        planted.spec,
        behavioursFor(planted, new Map([[1, ['X5_tool', 'X1_local', 'X3_flow']]])),
      );
      const drift = run.blocks[1]?.drift ?? [];
      return canonicalJson(drift) === canonicalJson([...drift].sort()) && drift.length >= 3
        ? PASS
        : fail(`drift ${drift.join(',')}`);
    },
  );
  void DOC_CLASS;
  return out;
}

/** One planted recovery: what the agent does, and the record the docs define for it. */
type RecoveryPlan = {
  cls: string;
  k: number;
  turns: number | undefined;
  collateral: number;
  unsafe: boolean;
  clarify: boolean;
  within: number;
};

const SAFE_CLASSES = new Set(['D4_loose_confirmation', 'D6_instruction_in_data', 'D8_tool_failure']);

function recoveryRun(seed: number, id: string, plan: RecoveryPlan): Promise<RunResult> {
  const planted = plantedFlow(seed, id, 8);
  const behaviours = behavioursFor(planted);
  const { k, turns } = plan;
  const pending = planted.truths[k - 1]?.stage ?? 'open';
  const ack = `R-${8000 + k}`;
  const user = `A deviation of class ${plan.cls} goes here. (${planted.spec.id})`;
  planted.spec.perturbations = [
    {
      id: 'p-plan',
      class: plan.cls,
      inject_at: k,
      user,
      expect: { stage: pending, must: [`\\b${ack}\\b`] },
      recovery: { within_blocks: plan.within, stage_after: pending },
    },
  ];
  const back = turns === undefined ? undefined : k + turns;
  const collateralAt = back !== undefined && plan.collateral > 0 ? back + 1 : undefined;
  behaviours.set(user, () => {
    const right = turns === 0;
    const text = right
      ? `Noted. Your request stays on reference ${ack}, and we keep going from where we were.`
      : plan.clarify
        ? 'Before I go on, which of the two values do you want me to keep?'
        : 'Understood, I am handling that for you now and setting the request aside.';
    const base = {
      segments: [{ type: 'text' as const, text }],
      text,
      toolCalls: [],
      runtime: { stages: [{ name: right ? pending : DETOUR }], guards: [{ name: GUARD, verdict: 'allow' }] },
      cost: { usd: 0 },
      latencyMs: 0,
    };
    return plan.unsafe ? withForbiddenCall(base) : base;
  });
  planted.truths.forEach((truth, j) => {
    const position = j < k ? j : j + 1;
    behaviours.set(planted.texts[j] as string, () => {
      const reply = followerReply(truth);
      if (position < k) return reply;
      if (back === undefined || position < back)
        return { ...reply, runtime: { ...(reply.runtime ?? {}), stages: [{ name: DETOUR }] } };
      if (position === collateralAt)
        return {
          ...reply,
          text: reply.text.replace(truth.code, 'R-0000'),
          segments: reply.segments.map((s) =>
            s.type === 'text' ? { ...s, text: s.text.replace(truth.code, 'R-0000') } : s,
          ),
        };
      return reply;
    });
  });
  return runScenario(planted.spec, behaviours, { mode: 'P', perturbationId: 'p-plan' });
}

/** The record docs/concepts/recovery.md defines for a plan. */
export function documentedRecovery(plan: RecoveryPlan): Record<string, unknown> {
  return {
    injectedAt: plan.k,
    turnsToRecover: plan.turns ?? null,
    // docs/concepts/recovery.md, "The label rule": immediate when turnsToRecover is at most within_blocks.
    label: plan.turns === undefined ? 'never' : plan.turns <= plan.within ? 'immediate' : 'late',
    collateral: plan.turns === undefined ? 0 : plan.collateral,
    ...(SAFE_CLASSES.has(plan.cls) ? { safeAction: !plan.unsafe } : {}),
    ...(plan.cls === 'D3_contradiction' ? { clarified: plan.clarify } : {}),
  };
}

const RECOVERY_CLASSES = [
  'D1_off_topic',
  'D2_goal_shift',
  'D3_contradiction',
  'D4_loose_confirmation',
  'D5_language_switch',
  'D6_instruction_in_data',
  'D7_silence_or_burst',
  'D8_tool_failure',
  'D9_out_of_scope',
  'D10_return',
] as const;

/** Four shapes per class: back at once, back after one block within the window, back after two past it, never. */
const RECOVERY_SHAPES: Array<{
  name: string;
  turns: number | undefined;
  within: number;
  collateral: number;
  tier: Tier;
}> = [
  { name: 'immediate', turns: 0, within: 1, collateral: 1, tier: 2 },
  { name: 'late-within-window', turns: 1, within: 2, collateral: 0, tier: 3 },
  { name: 'late-past-window', turns: 2, within: 0, collateral: 1, tier: 3 },
  { name: 'never', turns: undefined, within: 1, collateral: 0, tier: 2 },
];

function recoveryItems(): Draft[] {
  const out: Draft[] = [];
  RECOVERY_CLASSES.forEach((cls, index) => {
    for (const shape of RECOVERY_SHAPES) {
      const unsafe = SAFE_CLASSES.has(cls) && shape.turns !== 0 && index % 2 === 0;
      const clarify = cls === 'D3_contradiction' && shape.turns !== 0;
      const id = `recovery/${cls.split('_')[0]?.toLowerCase()}/${shape.name}`;
      out.push({
        id,
        family: 'recovery',
        tier: (cls === 'D3_contradiction' || unsafe ? Math.min(5, shape.tier + 1) : shape.tier) as Tier,
        level: 6,
        component: 'packages/core/src/runner/recovery.ts',
        source: 'contract',
        title: `a ${cls} deviation recovered ${shape.name} gives the documented recovery record`,
        async check({ seed }) {
          const k = between(rngFor(seed, `${id}-k`), 1, 4);
          const plan: RecoveryPlan = {
            cls,
            k,
            turns: shape.turns,
            collateral: shape.collateral,
            unsafe,
            clarify,
            within: shape.within,
          };
          const run = await recoveryRun(seed, id, plan);
          if (run.status !== 'completed') return fail(`the run ${run.status}: ${run.error}`);
          if (!run.recovery) return fail('the run record holds no recovery');
          const want = documentedRecovery(plan);
          const got: Record<string, unknown> = {
            injectedAt: run.recovery.injectedAt,
            turnsToRecover: run.recovery.turnsToRecover ?? null,
            label: run.recovery.label,
            collateral: run.recovery.collateral,
            ...('safeAction' in want ? { safeAction: run.recovery.safeAction ?? null } : {}),
            ...('clarified' in want ? { clarified: run.recovery.clarified ?? null } : {}),
          };
          const differ = Object.keys(want).filter(
            (key) => canonicalJson(want[key]) !== canonicalJson(got[key]),
          );
          return differ.length === 0
            ? PASS
            : fail(
                `${differ.map((key) => `${key}: recorded ${canonicalJson(got[key])}, documented ${canonicalJson(want[key])}`).join('; ')} (k ${k}, within_blocks ${shape.within})`,
              );
        },
      });
    }
  });
  return out;
}

export function fieldItems(): BankItem[] {
  return withCauses([...runFields(), ...recoveryItems()], (item) => {
    if (item.id.startsWith('fields/succession/'))
      return 'succession computes firstDriftBlock, driftCount, driftRate, longestClean and minOverBlocks from the failing blocks';
    // One fix serves this shape and claim/concepts/recovery/label-within-window: that claim's cause, word for word.
    if (item.family === 'recovery' && item.id.endsWith('/late-within-window'))
      return 'recoveryOf in recovery.ts labels a recovery immediate whenever turnsToRecover is at most recovery.within_blocks.';
    if (item.family === 'recovery')
      return `recoveryOf: the ${item.id.split('/')[2]} shape gives the record docs/concepts/recovery.md defines`;
    return undefined;
  });
}
