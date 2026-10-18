import { type DriftClass, outcomeOf, type PlannedCell, type RunResult } from '@agent-nexus/driftbench-core';
import { CHECK_COMPONENTS, SYSTEM_COMPONENTS } from '../components';
import { GUARD, OPERATORS } from '../family';
import type { Behaviour, Flow } from '../plant';
import { between, rngFor } from '../random';
import { type BankItem, expectAll, fail, type ItemResult, PASS, type Tier } from './types';
import {
  type AdapterKind,
  behavioursFor,
  type Faults,
  failingFamilies,
  failingList,
  plantedFlow,
  positionOf,
  runScenario,
} from './world';

/**
 * Levels 2 and 4: a planted fault reaches the run record at the right block and check, and carries the
 * right drift class. The items are generated: operator by position by mode, by adapter, two faults in one
 * run, a fault after an injected deviation, and two faults in one block. Nothing here is listed by hand.
 */

/** The operators of the bank, in a fixed order: one per fault class of the family. */
export const OPERATOR_ORDER = [
  'X1_local',
  'X2_contradiction',
  'X3_flow',
  'X4_format',
  'X5_tool',
  'D2_goal_shift',
  'D4_loose_confirmation',
  'D6_instruction_in_data',
  'D8_tool_failure',
  'D9_out_of_scope',
] as const;

/**
 * The drift class of a failing check family, by docs/concepts/drift.md ("The engine of phase 3 assigns"):
 * the stage check gives X3, the ledger check X2, tool, skill and guard checks X5 (a forbidden tool is a tool
 * check), format and channel checks X4, any other failing check X1.
 */
export const DOC_CLASS: Readonly<Record<string, DriftClass>> = {
  stage: 'X3_flow',
  flow: 'X3_flow',
  ledger: 'X2_contradiction',
  tools: 'X5_tool',
  forbidden: 'X5_tool',
  skills: 'X5_tool',
  guards: 'X5_tool',
  lang: 'X4_format',
  cards: 'X4_format',
};

export function docClass(family: string): DriftClass {
  return DOC_CLASS[family] ?? 'X1_local';
}

/** The classes a block planted with these operators must carry: each operator's own and its check's. */
export function expectedClasses(classes: readonly string[]): DriftClass[] {
  const out = new Set<DriftClass>();
  for (const cls of classes) {
    const operator = OPERATORS[cls];
    if (!operator) continue;
    out.add(operator.drift);
    out.add(docClass(operator.check));
  }
  return [...out].sort();
}

/** What an operator touches in a block: two operators that touch nothing in common can share a block. */
const PARTS: Readonly<Record<string, readonly string[]>> = {
  X1_local: ['text'],
  X4_format: ['text'],
  D9_out_of_scope: ['text'],
  D8_tool_failure: ['text', 'stage', 'lookup'],
  X2_contradiction: ['lookup'],
  X5_tool: ['lookup'],
  D4_loose_confirmation: ['forbidden'],
  X3_flow: ['stage'],
  D2_goal_shift: ['stage'],
  D6_instruction_in_data: ['guards'],
};

export function disjoint(a: string, b: string): boolean {
  const left = PARTS[a] ?? [];
  return !(PARTS[b] ?? []).some((part) => left.includes(part));
}

/** A cell for outcomeOf: only the fields the outcome reads are real. */
function cellOf(run: RunResult): PlannedCell {
  return {
    cellId: run.runId,
    specId: run.specId,
    specHash: run.specHash,
    target: run.target,
    mode: run.mode,
    repeat: run.repeat,
    blocks: run.blocks.length,
  };
}

/**
 * The oracle of a planted run: every planted position fails with the planted operators' check families and
 * no other family (an operator's `also` families allowed), every other position passes, and the campaign
 * outcome lists `block <position> <check>.` for each planted check.
 */
export function reachOracle(run: RunResult, planted: ReadonlyMap<number, readonly string[]>): ItemResult {
  if (run.status !== 'completed') return fail(`the run ${run.status}: ${run.error ?? ''}`);
  const outcome = outcomeOf(cellOf(run), run);
  for (const block of run.blocks) {
    const classes = planted.get(block.index);
    const seen = failingFamilies(block);
    if (!classes || classes.length === 0) {
      if (!block.pass)
        return fail(`block ${block.index} has no planted fault and fails: ${failingList(run)}`);
      continue;
    }
    if (block.pass) return fail(`block ${block.index} carries ${classes.join(' and ')} and passes`);
    const allowed = new Set(
      classes.flatMap((cls) => [OPERATORS[cls]?.check ?? '', ...(OPERATORS[cls]?.also ?? [])]),
    );
    for (const cls of classes) {
      const check = OPERATORS[cls]?.check ?? '';
      if (!seen.includes(check))
        return fail(`block ${block.index} (${cls}) fails on ${seen.join(', ')}, not on ${check}`);
      if (!outcome.failing.some((line) => line.startsWith(`block ${block.index} ${check}.`))) {
        return fail(
          `the campaign outcome does not list block ${block.index} ${check}: ${outcome.failing.join(', ')}`,
        );
      }
    }
    const extra = seen.filter((family) => !allowed.has(family));
    if (extra.length > 0)
      return fail(`block ${block.index} also fails on ${extra.join(', ')}: ${failingList(run)}`);
  }
  for (const position of planted.keys()) {
    if (!run.blocks.some((block) => block.index === position))
      return fail(`no block ran at position ${position}`);
  }
  return outcome.state === 'fail' ? PASS : fail(`the campaign outcome is ${outcome.state}, not fail`);
}

const POSITIONS = ['first', 'middle', 'last'] as const;

function positionIndex(seed: number, tag: string, where: (typeof POSITIONS)[number], blocks: number): number {
  if (where === 'first') return 0;
  if (where === 'last') return blocks - 1;
  return between(rngFor(seed, `${tag}-position`), 1, blocks - 2);
}

function slug(cls: string): string {
  return cls.toLowerCase().replace(/_/g, '-');
}

/** Adds one perturbation before block k whose injected block the agent answers right. */
export function withPerturbation(
  planted: Flow,
  behaviours: Map<string, Behaviour>,
  k: number,
  cls = 'D1_off_topic',
): string {
  const pending = planted.truths[k - 1]?.stage ?? 'open';
  const ack = `R-${7000 + k}`;
  const user = `By the way, is the office open on Saturday? (${planted.spec.id})`;
  planted.spec.perturbations = [
    {
      id: 'p-bank',
      class: cls,
      inject_at: k,
      user,
      expect: { stage: pending, must: [`\\b${ack}\\b`] },
      recovery: { within_blocks: 1, stage_after: pending },
    },
  ];
  behaviours.set(user, () => {
    const text = `Yes, it is open. Your request stays on reference ${ack}, and we continue where we were.`;
    return {
      segments: [{ type: 'text', text }],
      text,
      toolCalls: [],
      runtime: { stages: [{ name: pending }], guards: [{ name: GUARD, verdict: 'allow' }] },
      cost: { usd: 0 },
      latencyMs: 0,
    };
  });
  return 'p-bank';
}

function item(
  id: string,
  family: string,
  tier: Tier,
  level: number,
  component: string,
  title: string,
  check: BankItem['check'],
  source: BankItem['source'] = 'combination',
): BankItem {
  return { id, family, tier, level, component, title, check, source, cause: '' };
}

/** fault-position-mode: each operator at the first, a middle and the last block, in modes F and T. */
function positionMode(): BankItem[] {
  const out: BankItem[] = [];
  for (const cls of OPERATOR_ORDER) {
    for (const where of POSITIONS) {
      for (const mode of ['F', 'T'] as const) {
        const id = `reach/${slug(cls)}/${where}/${mode}`;
        const tier: Tier = mode === 'T' ? 3 : where === 'middle' ? 1 : 2;
        out.push(
          item(
            id,
            'fault-position-mode',
            tier,
            2,
            CHECK_COMPONENTS[OPERATORS[cls]?.check ?? ''] ?? SYSTEM_COMPONENTS.runner,
            `${cls} at the ${where} block in mode ${mode} fails that block on its check`,
            async ({ seed }) => {
              const planted = plantedFlow(seed, id);
              const at = positionIndex(seed, id, where, planted.truths.length);
              const faults: Faults = new Map([[at, [cls]]]);
              const run = await runScenario(planted.spec, behavioursFor(planted, faults), { mode });
              return reachOracle(run, faults);
            },
          ),
        );
      }
    }
  }
  return out;
}

/** fault-adapter: each operator through the http adapter, a flaky http adapter (retries on the path), and http in mode T. */
function adapterInteractions(): BankItem[] {
  const out: BankItem[] = [];
  const shapes: Array<{ adapter: AdapterKind; mode: 'F' | 'T'; tier: Tier }> = [
    { adapter: 'http', mode: 'F', tier: 2 },
    { adapter: 'http-flaky', mode: 'F', tier: 3 },
    { adapter: 'http', mode: 'T', tier: 4 },
  ];
  for (const cls of OPERATOR_ORDER) {
    for (const shape of shapes) {
      const id = `reach-adapter/${slug(cls)}/${shape.adapter}/${shape.mode}`;
      out.push(
        item(
          id,
          'fault-adapter',
          shape.tier,
          2,
          'packages/adapters/src/http/index.ts',
          `${cls} reaches the record through the ${shape.adapter} adapter in mode ${shape.mode}`,
          async ({ seed }) => {
            const planted = plantedFlow(seed, id);
            const at = positionIndex(seed, id, 'middle', planted.truths.length);
            const faults: Faults = new Map([[at, [cls]]]);
            const run = await runScenario(planted.spec, behavioursFor(planted, faults), {
              mode: shape.mode,
              adapter: shape.adapter,
            });
            return reachOracle(run, faults);
          },
        ),
      );
    }
  }
  return out;
}

/** The pairs of operators the bank plants together: offsets 1 and 3 in OPERATOR_ORDER, then 5. */
export function operatorPairs(): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const offset of [1, 3, 5]) {
    OPERATOR_ORDER.forEach((cls, index) => {
      const other = OPERATOR_ORDER[(index + offset) % OPERATOR_ORDER.length] as string;
      const key = [cls, other].sort().join(' ');
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push([cls, other]);
    });
  }
  return pairs;
}

/** fault-multi: two operators in one run at two blocks, in mode F, plus two at adjacent blocks. */
function multi(): BankItem[] {
  return operatorPairs().map(([a, b], index) => {
    const adjacent = index % 2 === 1;
    const id = `reach-multi/${slug(a)}+${slug(b)}${adjacent ? '/adjacent' : ''}`;
    return item(
      id,
      'fault-multi',
      adjacent ? 3 : 2,
      2,
      SYSTEM_COMPONENTS.runner,
      `${a} and ${b} at two ${adjacent ? 'adjacent ' : ''}blocks each fail their own block only`,
      async ({ seed }) => {
        const planted = plantedFlow(seed, id);
        const rng = rngFor(seed, `${id}-at`);
        const first = between(rng, 0, planted.truths.length - 2);
        const second = adjacent
          ? first + 1
          : (first + between(rng, 1, planted.truths.length - 1)) % planted.truths.length;
        const faults: Faults = new Map([
          [first, [a]],
          [second, [b]],
        ]);
        const run = await runScenario(planted.spec, behavioursFor(planted, faults));
        return reachOracle(run, faults);
      },
    );
  });
}

/** fault-perturbed: each operator before and after an injected deviation, in mode P; positions shift by one. */
function perturbed(): BankItem[] {
  const out: BankItem[] = [];
  for (const cls of OPERATOR_ORDER) {
    for (const side of ['before', 'after'] as const) {
      const id = `reach-perturbed/${slug(cls)}/${side}`;
      out.push(
        item(
          id,
          'fault-perturbed',
          side === 'after' ? 4 : 3,
          2,
          SYSTEM_COMPONENTS.runner,
          `${cls} ${side} an injected deviation fails the block at its run position`,
          async ({ seed }) => {
            const planted = plantedFlow(seed, id);
            const rng = rngFor(seed, `${id}-at`);
            const k = between(rng, 2, planted.truths.length - 2);
            const j = side === 'before' ? between(rng, 0, k - 1) : between(rng, k, planted.truths.length - 1);
            const behaviours = behavioursFor(planted, new Map([[j, [cls]]]));
            const perturbation = withPerturbation(planted, behaviours, k);
            const run = await runScenario(planted.spec, behaviours, {
              mode: 'P',
              perturbationId: perturbation,
            });
            const injected = run.blocks.findIndex((block) => block.injected === true);
            if (injected !== k) return fail(`the deviation went in at position ${injected}, planted ${k}`);
            return reachOracle(run, new Map([[positionOf(j, k), [cls]]]));
          },
        ),
      );
    }
  }
  return out;
}

/** drift-class: the exact classes of a failing block, one operator in F and T, two disjoint operators in one block. */
function classes(): BankItem[] {
  const out: BankItem[] = [];
  const check = async (seed: number, id: string, planted: string[], mode: 'F' | 'T'): Promise<ItemResult> => {
    const flowed = plantedFlow(seed, id);
    const at = between(rngFor(seed, `${id}-at`), 0, flowed.truths.length - 1);
    const run = await runScenario(flowed.spec, behavioursFor(flowed, new Map([[at, planted]])), { mode });
    const block = run.blocks.find((each) => each.index === at);
    const expected = expectedClasses(planted);
    const got = [...(block?.drift ?? [])].sort();
    return expectAll([
      [run.status === 'completed', `the run ${run.status}`],
      [block !== undefined && !block.pass, `block ${at} does not fail`],
      [
        got.join(',') === expected.join(','),
        `block ${at} planted ${planted.join(' and ')} carries ${got.join(', ') || 'no class'}, expected ${expected.join(', ')} (docs/concepts/drift.md); failing: ${failingList(run)}`,
      ],
    ]);
  };
  for (const cls of OPERATOR_ORDER) {
    for (const mode of ['F', 'T'] as const) {
      const id = `class/${slug(cls)}/${mode}`;
      out.push(
        item(
          id,
          'drift-class',
          mode === 'F' ? 2 : 3,
          4,
          SYSTEM_COMPONENTS.runner.replace('run.ts', 'drift.ts'),
          `a block planted with ${cls} in mode ${mode} carries exactly the documented classes`,
          (ctx) => check(ctx.seed, id, [cls], mode),
          'contract',
        ),
      );
    }
  }
  const pairs: Array<[string, string]> = [];
  for (const a of OPERATOR_ORDER)
    for (const b of OPERATOR_ORDER) if (a < b && disjoint(a, b)) pairs.push([a, b]);
  for (const [a, b] of pairs.slice(0, 24)) {
    const id = `class-pair/${slug(a)}+${slug(b)}`;
    out.push(
      item(
        id,
        'drift-class',
        4,
        4,
        SYSTEM_COMPONENTS.runner.replace('run.ts', 'drift.ts'),
        `a block planted with ${a} and ${b} carries the union of their classes`,
        (ctx) => check(ctx.seed, id, [a, b], 'F'),
        'combination',
      ),
    );
  }
  return out;
}

/** The operator class of an id slug, such as x1-local for X1_local. */
function classOfSlug(text: string): string {
  return OPERATOR_ORDER.find((cls) => slug(cls) === text) ?? text;
}

/**
 * The cause of each generated item (docs/validators.md section 12.4): items that one change would fix share
 * it. A fault reaches its block through the check that reads what the operator broke, so the cause is the
 * check in that mode or through that adapter, not the operator and position.
 */
function causeOf(item: BankItem): string {
  const parts = item.id.split('/');
  const check = (cls: string) => OPERATORS[classOfSlug(cls)]?.check ?? cls;
  switch (item.family) {
    case 'fault-position-mode':
      return `the ${check(parts[1] as string)} check fails the block whose reply breaks it, in mode ${parts[3]}`;
    case 'fault-adapter':
      return `the ${parts[2]} adapter carries what the ${check(parts[1] as string)} check reads, in mode ${parts[3]}`;
    case 'fault-multi':
      return 'the runner keeps each failing verdict on the block that produced it';
    case 'fault-perturbed':
      return `in mode P the ${check(parts[1] as string)} verdict lands on the run position one past an injected block`;
    case 'drift-class':
      if (parts[0] === 'class-pair')
        return 'a block carries the drift classes of all its failing check families';
      return `the drift class of a failing ${check(parts[1] as string)} verdict is ${docClass(check(parts[1] as string))}, and ${classOfSlug(parts[1] as string)} adds its own class`;
    default:
      return item.title;
  }
}

export function reachItems(): BankItem[] {
  return [...positionMode(), ...adapterInteractions(), ...multi(), ...perturbed(), ...classes()].map(
    (item) => ({ ...item, cause: causeOf(item) }),
  );
}
