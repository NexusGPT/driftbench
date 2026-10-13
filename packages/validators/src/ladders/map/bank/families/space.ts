import { type LoadResult, validateSpec } from '@agent-nexus/driftbench-core';
import {
  codeOf,
  combinations,
  compileSpace,
  coverage,
  decode,
  forEachAllowedCell,
  placeSpec,
  projectGrid,
  quantile,
  type SpaceMap,
  validateSpaceMap,
} from '@agent-nexus/driftbench-space';
import type { Draw } from '../../spec';
import { drawFor } from '../common';
import { type BankItem, levelOf, type Outcome, type Tier } from '../types';

/**
 * Items on the space map the extractor's proposal becomes (packages/space): which cells are allowed, the
 * subsets of dimensions, the prior weights, the tuple codes, where a spec places, t-wise and per-value
 * coverage, the quantile of the completeness interval. Each compares the package with a small reference
 * computed here by brute force or by construction. They sit in the constraints family: they are the cells
 * and impossible combinations the map declares.
 */

const SPACE = 'packages/space/src';

const values = (...ids: string[]) => ids.map((id) => ({ id, title: id }));

/** A random valid map: three or four dimensions of two or three values, one or two constraints. */
function randomMap(draw: Draw): SpaceMap {
  const kinds = ['stage', 'channel', 'persona', 'data'] as const;
  const count = draw.int(3, 4);
  const dimensions = kinds.slice(0, count).map((kind) => ({
    id: kind,
    title: kind,
    kind,
    values: values(...Array.from({ length: draw.int(2, 3) }, (_, i) => `${kind}-${i + 1}`)),
  }));
  for (let attempt = 0; attempt < 20; attempt++) {
    const constraints = Array.from({ length: draw.int(1, 2) }, () => {
      const [a, b] = draw.subset(dimensions, 2) as [(typeof dimensions)[number], (typeof dimensions)[number]];
      return { forbid: { [a.id]: draw.pick(a.values).id, [b.id]: draw.pick(b.values).id }, reason: 'drawn' };
    });
    const result = validateSpaceMap({
      version: '1',
      agent: 'a',
      dimensions,
      constraints,
      prior: { kind: 'declared' },
    });
    if (result.ok) return result.map;
  }
  throw new Error('no valid map drawn');
}

/** Every cell of the grid by brute force, and whether a constraint forbids it. */
function bruteCells(map: SpaceMap): Array<{ cell: number[]; forbidden: boolean }> {
  const sizes = map.dimensions.map((dimension) => dimension.values.length);
  const out: Array<{ cell: number[]; forbidden: boolean }> = [];
  const total = sizes.reduce((a, b) => a * b, 1);
  for (let n = 0; n < total; n++) {
    let rest = n;
    const cell = sizes.map(() => 0);
    for (let d = sizes.length - 1; d >= 0; d--) {
      cell[d] = rest % (sizes[d] as number);
      rest = Math.floor(rest / (sizes[d] as number));
    }
    const forbidden = map.constraints.some((constraint) =>
      Object.entries(constraint.forbid).every(([dimension, value]) => {
        const d = map.dimensions.findIndex((candidate) => candidate.id === dimension);
        return map.dimensions[d]?.values[cell[d] as number]?.id === value;
      }),
    );
    out.push({ cell, forbidden });
  }
  return out;
}

function spec(fields: Record<string, unknown>): LoadResult {
  const result = validateSpec(
    { blocks: [{ user: 'hi', expect: { must: ['hello'] } }], ...fields },
    'specs/x.yaml',
  );
  if (!result.ok) throw new Error(`the item built an invalid spec: ${JSON.stringify(result.errors[0])}`);
  return result;
}
const at = (stage: string) => ({ user: 'next', expect: { stage } });
const injection = (deviation: string, stage: string) => ({
  when: { injection: { class: deviation, user: 'by the way' } },
  expect: { stage },
});

/** The value ids of one event on one dimension. */
function placed(map: SpaceMap, result: LoadResult, dimension: string, event: number): string[] {
  if (!result.ok) throw new Error('invalid spec');
  const space = compileSpace(map);
  const d = space.dimensions.findIndex((candidate) => candidate.id === dimension);
  const found = placeSpec(space, result.spec).events[event];
  return (found?.values[d] ?? []).map((index) => space.dimensions[d]?.values[index]?.id ?? '?');
}

const same = (label: string, actual: unknown, expected: unknown): Outcome =>
  JSON.stringify(actual) === JSON.stringify(expected)
    ? { pass: true, detail: `${label}: as expected` }
    : {
        pass: false,
        detail: `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
      };

const STAGE_MAP = (draw: Draw): SpaceMap => {
  const result = validateSpaceMap({
    version: '1',
    agent: 'a',
    dimensions: [
      { id: 'stage', title: 'Stage', kind: 'stage', values: values('none', 's1', 's2', 's3') },
      {
        id: 'deviation',
        title: 'Deviation',
        kind: 'deviation',
        values: values('none', 'D1_off_topic', 'D8_tool_failure'),
      },
      { id: 'persona', title: 'Persona', kind: 'persona', values: values('none', 'terse', 'chatty') },
      {
        id: 'channel',
        title: 'Channel',
        kind: 'channel',
        values: values(...draw.subset(['chat', 'email', 'sms'], 2)),
      },
    ],
    constraints: [],
    prior: { kind: 'declared' },
  });
  if (!result.ok) throw new Error('stage map invalid');
  return result.map;
};

type SpaceCase = { slug: string; tier: Tier; title: string; cause: string; run(draw: Draw): Outcome };

export const SPACE_CASES: readonly SpaceCase[] = [
  {
    slug: 'allowed-cells',
    tier: 2,
    title: 'the allowed cells are every cell of the grid that no constraint matches, by brute force',
    cause: 'space:allowed-cells',
    run: (draw) => {
      const map = randomMap(draw);
      const seen: string[] = [];
      forEachAllowedCell(compileSpace(map), (cell) => seen.push(cell.join(',')));
      return same(
        'allowed cells',
        seen,
        bruteCells(map)
          .filter((entry) => !entry.forbidden)
          .map((entry) => entry.cell.join(',')),
      );
    },
  },
  {
    slug: 'combinations',
    tier: 2,
    title: 'the subsets of t dimensions out of k are every increasing t-subset, in lexicographic order',
    cause: 'space:combinations',
    run: (draw) => {
      const k = draw.int(1, 6);
      const t = draw.int(0, k);
      const brute: number[][] = [];
      for (let mask = 0; mask < 1 << k; mask++) {
        const subset = Array.from({ length: k }, (_, i) => i).filter((i) => mask & (1 << i));
        if (subset.length === t) brute.push(subset);
      }
      brute.sort((a, b) => a.join(',').localeCompare(b.join(','), undefined, { numeric: true }));
      const got = combinations(k, t);
      const key = (list: number[][]) => list.map((s) => s.join('.')).sort();
      return same(`combinations(${k}, ${t})`, key(got), key(brute));
    },
  },
  {
    slug: 'unlisted-weight',
    tier: 3,
    title: 'a value the prior does not weigh weighs 0, written weights and prior weights alike',
    cause: 'space:unlisted-weight-is-zero',
    run: (draw) => {
      const a = draw.int(1, 5);
      const map = {
        version: '1',
        agent: 'a',
        dimensions: [
          {
            id: 'stage',
            title: 's',
            kind: 'stage',
            values: [
              { id: 'x', title: 'x', weight: a },
              { id: 'y', title: 'y' },
            ],
          },
          { id: 'channel', title: 'c', kind: 'channel', values: values('chat', 'sms', 'email') },
        ],
        constraints: [],
        prior: { kind: 'declared', weights: { channel: { chat: 1, sms: 3 } } },
      } as unknown as SpaceMap;
      const space = compileSpace(map);
      return same(
        'weights',
        space.dimensions.map((d) => d.weights),
        [
          [1, 0],
          [0.25, 0.75, 0],
        ],
      );
    },
  },
  {
    slug: 'decode',
    tier: 3,
    title: 'the tuple code of a cell decodes back to the cell values on the projection',
    cause: 'space:decode',
    run: (draw) => {
      const map = randomMap(draw);
      const space = compileSpace(map);
      const subset = draw.subset(
        map.dimensions.map((_, i) => i),
        draw.int(1, map.dimensions.length),
      );
      const projection = projectGrid(space, [subset]).projections[0];
      if (!projection) return { pass: false, detail: 'no projection' };
      for (const { cell } of bruteCells(map)) {
        const back = decode(projection, codeOf(projection, cell), space);
        const want = subset.map((d) => cell[d]);
        if (JSON.stringify(back) !== JSON.stringify(want)) {
          return {
            pass: false,
            detail: `cell ${cell.join(',')} on ${subset.join(',')}: decoded ${back.join(',')}, expected ${want.join(',')}`,
          };
        }
      }
      return { pass: true, detail: 'every cell decodes' };
    },
  },
  {
    slug: 'projection-allowed',
    tier: 3,
    title: 'a tuple of a projection is allowed exactly when some allowed cell holds it',
    cause: 'space:projection-allowed',
    run: (draw) => {
      const map = randomMap(draw);
      const space = compileSpace(map);
      const subset = draw.subset(
        map.dimensions.map((_, i) => i),
        2,
      );
      const projection = projectGrid(space, [subset]).projections[0];
      if (!projection) return { pass: false, detail: 'no projection' };
      const want = new Set(
        bruteCells(map)
          .filter((entry) => !entry.forbidden)
          .map((entry) => codeOf(projection, entry.cell)),
      );
      const got = [...projection.allowed.entries()].filter(([, flag]) => flag === 1).map(([code]) => code);
      return same(
        'allowed tuples',
        got.sort(),
        [...want].sort((x, y) => x - y),
      );
    },
  },
  {
    slug: 'injection-arrival',
    tier: 3,
    title: 'an injection block places on the stage the previous block reached, not on its own expect.stage',
    cause: 'space:injection-arrival-stage',
    run: (draw) => {
      const map = STAGE_MAP(draw);
      const [first, second] = draw.shuffle(['s1', 's2', 's3']) as [string, string];
      return same(
        'stage of the injection',
        placed(map, spec({ id: 'x', blocks: [at(first), injection('D1_off_topic', second)] }), 'stage', 1),
        [first],
      );
    },
  },
  {
    slug: 'injection-arrival-skips-unstaged',
    tier: 3,
    title: 'an injection block after a block with no stage places on the last stage reached before it',
    cause: 'space:injection-arrival-scan',
    run: (draw) => {
      const map = STAGE_MAP(draw);
      const [first, second] = draw.shuffle(['s1', 's2', 's3']) as [string, string];
      const result = spec({
        id: 'x',
        blocks: [at(first), { user: 'and?', expect: { must: ['ok'] } }, injection('D8_tool_failure', second)],
      });
      return same('stage of the injection', placed(map, result, 'stage', 2), [first]);
    },
  },
  {
    slug: 'injection-first-block',
    tier: 2,
    title: 'an injection block that opens the spec places on its own expect.stage',
    cause: 'space:injection-first-block-stage',
    run: (draw) => {
      const map = STAGE_MAP(draw);
      const stage = draw.pick(['s1', 's2', 's3']);
      return same(
        'stage of the injection',
        placed(map, spec({ id: 'x', blocks: [injection('D1_off_topic', stage)] }), 'stage', 0),
        [stage],
      );
    },
  },
  {
    slug: 'named-tag-not-none',
    tier: 2,
    title: 'a persona tag naming a listed value places on that value, never on none',
    cause: 'space:named-value-over-none',
    run: (draw) => {
      const map = STAGE_MAP(draw);
      const persona = draw.pick(['terse', 'chatty']);
      return same(
        'persona',
        placed(map, spec({ id: 'x', tags: [`persona:${persona}`], blocks: [at('s1')] }), 'persona', 0),
        [persona],
      );
    },
  },
  {
    slug: 'untagged-none',
    tier: 1,
    title: 'a spec with no persona tag places on none when the map lists it',
    cause: 'space:none-when-nothing-named',
    run: (draw) =>
      same('persona', placed(STAGE_MAP(draw), spec({ id: 'x', blocks: [at('s1')] }), 'persona', 0), ['none']),
  },
  {
    slug: 'value-spec-counts',
    tier: 3,
    title: 'each value counts the specs that place on it, as the placements say',
    cause: 'space:value-spec-counts',
    run: (draw) => {
      const map = STAGE_MAP(draw);
      const specs = Array.from({ length: 4 }, (_, i) =>
        spec({
          id: `s${i}`,
          tags: draw.chance(0.5) ? [`persona:${draw.pick(['terse', 'chatty'])}`] : [],
          blocks: [at(draw.pick(['s1', 's2', 's3']))],
        }),
      );
      const result = coverage(map, specs, { t: 2 });
      const persona = result.dimensions.find((d) => d.id === 'persona');
      const want = ['none', 'terse', 'chatty'].map(
        (value) => specs.filter((s) => placed(map, s, 'persona', 0).includes(value)).length,
      );
      return same(
        'persona spec counts',
        persona?.values.map((v) => v.specs),
        want,
      );
    },
  },
  {
    slug: 'pairwise-covered',
    tier: 4,
    title: 'the covered pairs are the allowed pairs some event of some spec holds, by brute force',
    cause: 'space:twise-covered-count',
    run: (draw) => {
      const map = STAGE_MAP(draw);
      const specs = Array.from({ length: 3 }, (_, i) =>
        spec({ id: `s${i}`, blocks: [at(draw.pick(['s1', 's2', 's3'])), at(draw.pick(['s1', 's2', 's3']))] }),
      );
      const result = coverage(map, specs, { t: 2 });
      const space = compileSpace(map);
      const pairs = new Set<string>();
      for (const s of specs) {
        if (!s.ok) continue;
        for (const event of placeSpec(space, s.spec).events) {
          for (const [a, b] of combinations(space.dimensions.length, 2) as Array<[number, number]>) {
            for (const x of event.values[a] ?? [])
              for (const y of event.values[b] ?? []) pairs.add(`${a}:${x}|${b}:${y}`);
          }
        }
      }
      return same('pairs covered', result.tway.find((tw) => tw.t === 2)?.covered, pairs.size);
    },
  },
  {
    slug: 'quantile',
    tier: 2,
    title: 'the quantile interpolates between ranks floor and ceil of (n - 1) q (type 7)',
    cause: 'space:quantile',
    run: (draw) => {
      const sorted = Array.from({ length: draw.int(2, 9) }, () => Math.round(draw.float() * 100)).sort(
        (a, b) => a - b,
      );
      const q = Math.round(draw.float() * 100) / 100;
      const position = (sorted.length - 1) * q;
      const low = sorted[Math.floor(position)] as number;
      const high = sorted[Math.ceil(position)] as number;
      const want = low + (position - Math.floor(position)) * (high - low);
      return same(
        `quantile of ${sorted.join(',')} at ${q}`,
        Math.round(quantile(sorted, q) * 1e9),
        Math.round(want * 1e9),
      );
    },
  },
];

export function spaceItems(): BankItem[] {
  return SPACE_CASES.map((item) => ({
    id: `constraints.space-${item.slug}`,
    family: 'constraints',
    tier: item.tier,
    level: levelOf('relations'),
    component: SPACE,
    title: item.title,
    cause: item.cause,
    generate: () => [],
    check: () => ({ pass: false, detail: 'runs through run()' }),
    run: async (seed) => {
      // Five draws per seed: a reference over one draw proves little.
      for (let round = 0; round < 5; round++) {
        const outcome = item.run(drawFor(seed, `space.${item.slug}.${round}`));
        if (!outcome.pass) return outcome;
      }
      return { pass: true, detail: 'five draws as expected' };
    },
  }));
}
