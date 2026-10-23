import { ModelError } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import {
  Cassette,
  type Labeler,
  LabelerError,
  type Labelled,
  type LabelSet,
  type PointerInput,
  type PointerPlan,
  PointerPlanOnly,
  pointerScan,
  requestRange,
  singleLabelling,
  stackedLabelling,
  type Window,
} from '../../src/pointer';
import { load, plantedDense, plantedYesNo } from './support';

/**
 * The rule under test: for a scan that runs to its end, the number of calls it makes to a labeler lies in the range
 * its plan gives, whatever the labeler does. LOW is a number no such scan goes under, and HIGH is one none goes over.
 *
 * The test measures real scans, not the plan's own arithmetic: a labeler that counts each call it receives, a matrix
 * of ways it can fail (an answer that cannot be read, a window refused as too large, runs that drift from their units,
 * runs that tie, any of them on every call or on some), a matrix of shapes (window size, runs, a single labeler or a
 * stack), and a cassette that is empty, half full or full but for the re-asks. Nothing in the expected range is read
 * from the product's output: the only inputs are the files, the sets and the failures.
 */

const QUAY = [
  '# Quay',
  '',
  '- Coil the ropes on the red post',
  '- Name the skipper of every boat',
  '- Hang the lamp before dusk',
  '',
  'Count the boats twice. Close the gate when the quay is empty.',
  '',
].join('\n');
const OFFICE = ['# Office', '', 'The office opens at nine.', '', '- Log each boat at the desk', ''].join(
  '\n',
);
const BIG = ['# Big', '', ...Array.from({ length: 20 }, (_, at) => `- Check the rope number ${at}`), ''].join(
  '\n',
);
const FILES = [
  { path: 'quay.md', text: QUAY },
  { path: 'office.md', text: OFFICE },
  { path: 'big.md', text: BIG },
];
/** Two sets whose labels carry no target, span or link: a first labeler can decide a unit of them alone. */
const PLAIN = `labels:
  - set: duty
    description: What the harbour notes ask of a skipper.
    labels:
      - name: order
        description: A unit that tells the skipper what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: remark
        description: A unit that only says how the quay is.
  - set: tone
    description: How a note is worded.
    labels:
      - name: curt
        description: A unit of three words or fewer.
      - name: long
        description: A unit of more than three words.
`;
/** A set with a label that carries a span: only a chat labeler can give it, so a first labeler never decides alone. */
const SPANNED = `labels:
  - set: duty
    description: What the harbour notes ask of a skipper.
    spans:
      - { name: act, description: the clause that says what the skipper does }
    labels:
      - name: order
        description: A unit that tells the skipper what to do.
        spans: [act]
        atom: { kind: instruction, polarity: obligation }
      - name: remark
        description: A unit that only says how the quay is.
`;
/** Two labels of one kind: the runs of a labeler can tie two and two. */
const KINDS = `labels:
  - set: duty
    description: What the harbour notes ask of a skipper.
    labels:
      - name: order
        description: A unit that tells the skipper what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: ban
        description: A unit that tells the skipper what never to do.
        atom: { kind: instruction, polarity: prohibition }
      - name: remark
        description: A unit that only says how the quay is.
`;

const unlocated = { kind: 'act', from: -1, to: -1, unlocated: 'the text is not in the unit' };
const tooLarge = () => new ModelError('http', '400 max_tokens_exceeded', { status: 400 });
const every = (window: Window, label: string, spans: unknown[]): Labelled[] =>
  window.units.map((unit) => ({ units: String(unit.n), label, spans }) as Labelled);
const byLength = (window: Window, set: LabelSet): Labelled[] =>
  window.units.map((unit) => ({
    units: String(unit.n),
    label: set.set === 'duty' ? 'order' : unit.text.split(/\s+/).length <= 3 ? 'curt' : 'long',
  }));

type Fail = (window: Window, attempt: number) => Error | undefined;
type Shape = { windowUnits: number; runs: number; stack: boolean };
type Scenario = {
  name: string;
  sets: string;
  /** Builds the chat labeler. */
  dense: (runs: number) => Labeler;
  /** What every call of the chat labeler does besides answering. */
  fail?: Fail;
  /** The chances of the first labeler of a stack. */
  chances?: (unit: { n: number; text: string }, set: LabelSet) => Record<string, number>;
  /** The scenario needs this many runs at least to show. */
  minRuns?: number;
  /** Runs the scenario is judged at, when only one count makes sense. */
  onlyRuns?: number;
};

/** The labeler, counting each call it receives and failing as the scenario says. */
const counted = (labeler: Labeler, count: () => void, fail?: Fail): Labeler => {
  const inner = labeler.call as NonNullable<Labeler['call']>;
  return {
    ...labeler,
    call: async (wire, set, window, attempt) => {
      count();
      const failure = fail?.(window, attempt ?? 1);
      if (failure) throw failure;
      return inner(wire, set, window, attempt);
    },
  };
};

const scenarios: Scenario[] = [
  { name: 'ok', sets: PLAIN, dense: (runs) => plantedDense(byLength, [], { runs }) },
  {
    name: 'ok, the first labeler decides alone',
    sets: PLAIN,
    dense: (runs) => plantedDense(byLength, [], { runs }),
    chances: (unit, set): Record<string, number> =>
      set.set === 'duty'
        ? { order: 0.99, remark: 0.01 }
        : unit.text.split(/\s+/).length <= 3
          ? { curt: 0.99, long: 0.01 }
          : { curt: 0.01, long: 0.99 },
  },
  {
    name: 'an answer that cannot be read, always',
    sets: PLAIN,
    dense: (runs) => plantedDense(byLength, [], { runs }),
    fail: () => new LabelerError('cannot read'),
  },
  {
    name: 'every window refused as too large',
    sets: PLAIN,
    dense: (runs) => plantedDense(byLength, [], { runs }),
    fail: () => tooLarge(),
  },
  {
    name: 'a window over two units refused as too large',
    sets: PLAIN,
    dense: (runs) => plantedDense(byLength, [], { runs }),
    fail: (window) => (window.units.length > 2 ? tooLarge() : undefined),
  },
  {
    name: 'an unreadable answer, then a refusal as too large',
    sets: PLAIN,
    dense: (runs) => plantedDense(byLength, [], { runs }),
    fail: (window, attempt) =>
      window.units.length > 1 ? (attempt === 1 ? new LabelerError('transient') : tooLarge()) : undefined,
  },
  {
    name: 'every run drifts from its units',
    sets: SPANNED,
    dense: (runs) =>
      plantedDense((window) => every(window, 'remark', Array(4).fill(unlocated)), [], { runs }),
    minRuns: 3,
  },
  {
    name: 'every run drifts, and a window over two units is refused as too large',
    sets: SPANNED,
    dense: (runs) =>
      plantedDense((window) => every(window, 'remark', Array(4).fill(unlocated)), [], { runs }),
    fail: (window) => (window.units.length > 2 ? tooLarge() : undefined),
    minRuns: 3,
  },
  {
    name: 'every run drifts, and every window over one unit is refused as too large',
    sets: SPANNED,
    dense: (runs) =>
      plantedDense((window) => every(window, 'remark', Array(4).fill(unlocated)), [], { runs }),
    fail: (window) => (window.units.length > 1 ? tooLarge() : undefined),
    minRuns: 3,
  },
  {
    name: 'every run drifts, and the re-asks come back unreadable once',
    sets: SPANNED,
    dense: (runs) =>
      plantedDense((window) => every(window, 'remark', Array(4).fill(unlocated)), [], { runs }),
    fail: (_window, attempt) => (attempt === 1 ? new LabelerError('transient') : undefined),
    minRuns: 3,
  },
  {
    name: 'the runs tie two and two',
    sets: KINDS,
    dense: (runs) => {
      const calls = new Map<string, number>();
      return plantedDense(
        (window) => {
          const call = (calls.get(window.path) ?? 0) + 1;
          calls.set(window.path, call);
          return [{ units: `1-${window.units.length}`, label: call % 2 === 1 ? 'order' : 'ban' }];
        },
        [],
        { runs },
      );
    },
    onlyRuns: 4,
  },
];

const shapes: Shape[] = [];
for (const windowUnits of [1, 2, 3, 60])
  for (const runs of [1, 3, 4]) for (const stack of [false, true]) shapes.push({ windowUnits, runs, stack });

const applies = (scenario: Scenario, shape: Shape): boolean =>
  (scenario.onlyRuns === undefined || scenario.onlyRuns === shape.runs) &&
  shape.runs >= (scenario.minRuns ?? 1) &&
  (scenario.chances === undefined || shape.stack);

function labelling(scenario: Scenario, shape: Shape, count: () => void) {
  const dense = counted(scenario.dense(shape.runs), count, scenario.fail);
  if (!shape.stack) return singleLabelling(dense);
  const first = counted(
    plantedYesNo(scenario.chances ?? (() => ({ order: 0.5, remark: 0.5, curt: 0.5, long: 0.5, ban: 0.5 }))),
    count,
  );
  return stackedLabelling(first, dense, { passAt: 0.9, failAt: 0.1 });
}

const input = (scenario: Scenario, shape: Shape, cassette: Cassette, count: () => void): PointerInput => ({
  files: FILES,
  sets: load(scenario.sets),
  labelling: labelling(scenario, shape, count),
  cassette,
  mode: 'record',
  windowUnits: shape.windowUnits,
});

async function planOf(scenario: Scenario, shape: Shape, cassette: Cassette): Promise<PointerPlan> {
  try {
    await pointerScan({ ...input(scenario, shape, cassette, () => {}), planOnly: true });
  } catch (cause) {
    if (cause instanceof PointerPlanOnly) return cause.plan;
    throw cause;
  }
  throw new Error('a plan alone must stop at the plan');
}

/** A real scan on the cassette, counting the calls it makes; whether it ran to its end. */
async function scan(scenario: Scenario, shape: Shape, cassette: Cassette) {
  let calls = 0;
  let completed = true;
  try {
    await pointerScan(input(scenario, shape, cassette, () => calls++));
  } catch {
    completed = false;
  }
  return { calls, completed };
}

/** The cassette without the entries a predicate names. */
const without = (cassette: Cassette, drop: (readable: Record<string, string>) => boolean): Cassette => {
  const kept = Cassette.parse(cassette.render());
  for (const [key, entry] of [...kept.entries]) if (drop(entry.readable)) kept.entries.delete(key);
  return kept;
};

describe('the calls of a real scan lie in the range of its plan', { timeout: 1_200_000 }, () => {
  it('on an empty cassette, for every scenario and shape', async () => {
    const outside: string[] = [];
    let exact = 0;
    let judged = 0;
    for (const scenario of scenarios)
      for (const shape of shapes) {
        if (!applies(scenario, shape)) continue;
        const range = requestRange(await planOf(scenario, shape, new Cassette()));
        const { calls, completed } = await scan(scenario, shape, new Cassette());
        judged++;
        const label = `${scenario.name} ${JSON.stringify(shape)}: sent ${calls}, plan ${JSON.stringify(range)}`;
        if (calls > range.high) outside.push(`above HIGH, ${label}`);
        if (completed && calls < range.low) outside.push(`below LOW, ${label}`);
        // Without a failure the plan is exact for a single labeler, and for a stack that decides nothing alone.
        if (scenario.name === 'ok' && !shape.stack) {
          if (calls !== range.expected) outside.push(`not exact, ${label}`);
          else exact++;
        }
      }
    expect(outside).toEqual([]);
    expect(judged).toBeGreaterThan(100);
    expect(exact).toBeGreaterThan(0);
  });

  it('on a cassette that holds half of the answers, and on one that holds all but the re-asks', async () => {
    const outside: string[] = [];
    for (const scenario of scenarios)
      for (const shape of shapes) {
        if (!applies(scenario, shape)) continue;
        const full = new Cassette();
        const seed = await scan(scenario, shape, full);
        if (!seed.completed) continue;
        const entries = [...full.entries.keys()].sort();
        const kept = new Set(entries.filter((_, at) => at % 2 === 0));
        const half = Cassette.parse(full.render());
        for (const key of entries) if (!kept.has(key)) half.entries.delete(key);
        const cases: Array<[string, Cassette]> = [
          ['half the answers', half],
          ['all but the re-asks', without(full, (readable) => Number(readable.run) > shape.runs)],
        ];
        for (const [name, cassette] of cases) {
          const range = requestRange(await planOf(scenario, shape, cassette));
          const { calls, completed } = await scan(scenario, shape, Cassette.parse(cassette.render()));
          const label = `${scenario.name} ${JSON.stringify(shape)} on ${name}: sent ${calls}, plan ${JSON.stringify(range)}`;
          if (calls > range.high) outside.push(`above HIGH, ${label}`);
          if (completed && calls < range.low) outside.push(`below LOW, ${label}`);
        }
      }
    expect(outside).toEqual([]);
  });

  it('keeps a stack whose labels need a chat labeler at the expected count as its low', async () => {
    for (const shape of shapes.filter((each) => each.stack && each.runs >= 3)) {
      const scenario = scenarios.find((each) => each.name === 'every run drifts from its units') as Scenario;
      const plan = await planOf(scenario, shape, new Cassette());
      const range = requestRange(plan);
      expect(range.low, JSON.stringify(shape)).toBe(range.expected);
    }
  });
});
