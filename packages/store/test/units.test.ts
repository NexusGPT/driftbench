import type { CostUnit } from '@agent-nexus/driftbench-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { measuredUnits, openMemoryStore, projectCost, type SqliteStore } from '../src/index';
import { block, observed, run, SUPPORT, storeError } from './fixtures';

let store: SqliteStore;

beforeEach(() => {
  store = openMemoryStore();
});

afterEach(async () => {
  await store.close();
});

const blockUnit: CostUnit = {
  adapter: 'function',
  metric: 'block',
  usd: 0.002,
  measuredAt: '2026-10-11T10:00:00.000Z',
  samples: 12,
};

describe('cost units in the store', () => {
  it('round trip, with and without a sample count, sorted by adapter and metric', async () => {
    const judge: CostUnit = {
      adapter: 'function',
      metric: 'judge_call',
      usd: 0.0007,
      measuredAt: '2026-10-11',
    };
    const http: CostUnit = {
      adapter: 'http',
      metric: 'block',
      usd: 0.01,
      measuredAt: '2026-10-11',
      samples: 3,
    };
    await store.putUnit(http);
    await store.putUnit(judge);
    await store.putUnit(blockUnit);
    expect(await store.listUnits()).toStrictEqual([blockUnit, judge, http]);
    expect(await store.listUnits('http')).toStrictEqual([http]);
    expect(await store.listUnits('nexus')).toStrictEqual([]);
  });

  it('keep one row per adapter and metric: a new measurement replaces the old one', async () => {
    await store.putUnit(blockUnit);
    const newer = { ...blockUnit, usd: 0.0025, samples: 40, measuredAt: '2026-10-12T10:00:00.000Z' };
    await store.putUnit(newer);
    expect(await store.listUnits()).toStrictEqual([newer]);
  });

  it('refuse a unit with a negative cost, a missing field or an unknown key', async () => {
    const cases = [
      { ...blockUnit, usd: -1 },
      { ...blockUnit, usd: Number.NaN },
      { ...blockUnit, measuredAt: '' },
      { ...blockUnit, samples: 1.5 },
      { ...blockUnit, currency: 'EUR' },
    ];
    for (const unit of cases) {
      const error = await storeError(() => store.putUnit(unit as CostUnit));
      expect(error.code, JSON.stringify(unit)).toBe('INVALID_RECORD');
    }
    expect(await store.listUnits()).toStrictEqual([]);
  });
});

describe('projectCost', () => {
  const units: CostUnit[] = [
    blockUnit,
    { adapter: 'function', metric: 'judge_call', usd: 0.0005, measuredAt: '2026-10-11T10:00:00.000Z' },
    { adapter: 'http', metric: 'block', usd: 0.01, measuredAt: '2026-10-11T10:00:00.000Z' },
  ];

  it('prices blocks and judge calls with the adapter units', () => {
    const projection = projectCost(
      [
        { adapter: 'function', blocks: 10, judgeCalls: 4 },
        { adapter: 'function', blocks: 5 },
        { adapter: 'http', blocks: 3 },
      ],
      units,
    );
    expect(projection.usd).toBeCloseTo(15 * 0.002 + 4 * 0.0005 + 3 * 0.01, 12);
    expect(projection.unmeasured).toEqual([]);
  });

  it('lists adapters with no unit for what their cells need, and leaves them out of the sum', () => {
    const projection = projectCost(
      [
        { adapter: 'nexus', blocks: 8 },
        { adapter: 'http', blocks: 2, judgeCalls: 1 },
        { adapter: 'process', blocks: 0 },
        { adapter: 'function', blocks: 1 },
      ],
      units,
    );
    expect(projection.usd).toBeCloseTo(2 * 0.01 + 0.002, 12);
    expect(projection.unmeasured).toEqual(['http', 'nexus']);
  });

  it('prices with the most recently measured unit when two share an adapter and metric', () => {
    const later = { ...blockUnit, usd: 0.004, measuredAt: '2026-10-12T08:00:00.000Z' };
    expect(projectCost([{ adapter: 'function', blocks: 2 }], [later, blockUnit]).usd).toBeCloseTo(0.008, 12);
    expect(projectCost([{ adapter: 'function', blocks: 2 }], [blockUnit, later]).usd).toBeCloseTo(0.008, 12);
  });

  it('projects nothing for no cells, and refuses counts that are not whole', () => {
    expect(projectCost([], units)).toEqual({ usd: 0, unmeasured: [] });
    expect(() => projectCost([{ adapter: 'function', blocks: -1 }], units)).toThrow(RangeError);
    expect(() => projectCost([{ adapter: 'function', blocks: 2, judgeCalls: 0.5 }], units)).toThrow(
      /whole counts/,
    );
  });
});

describe('measuredUnits', () => {
  it('derives the mean block cost per adapter with its sample count and the latest finish', () => {
    const units = measuredUnits([
      run({ finishedAt: '2026-10-11T10:00:02.000Z' }),
      run({
        repeat: 1,
        finishedAt: '2026-10-11T11:00:00.000Z',
        blocks: [block(0, { observed: { ...observed(), cost: { usd: 0.0045 } } })],
      }),
      run({ target: SUPPORT, blocks: [block(0, { observed: { ...observed(), cost: { usd: 0.01 } } })] }),
    ]);
    expect(units).toHaveLength(2);
    const [fn, http] = units;
    expect(fn).toMatchObject({
      adapter: 'function',
      metric: 'block',
      samples: 3,
      measuredAt: '2026-10-11T11:00:00.000Z',
    });
    expect(fn?.usd).toBeCloseTo((0.0015 + 0.0015 + 0.0045) / 3, 12);
    expect(http).toMatchObject({ adapter: 'http', metric: 'block', usd: 0.01, samples: 1 });
  });

  it('sums segment costs when a block has no total, skips blocks with no cost and runs served from the cache', () => {
    const segmentsOnly = { ...observed(), cost: { inputTokens: 820 } };
    const noCost = {
      ...observed(),
      cost: {},
      segments: observed().segments.map(({ cost: _cost, ...segment }) => segment),
    };
    const units = measuredUnits([
      run({ blocks: [block(0, { observed: segmentsOnly }), block(1, { observed: noCost })] }),
      run({ repeat: 2, cacheHit: true }),
    ]);
    expect(units).toHaveLength(1);
    expect(units[0]?.samples).toBe(1);
    expect(units[0]?.usd).toBeCloseTo(0.0004 + 0.0011, 12);
    expect(measuredUnits([run({ cacheHit: true })])).toEqual([]);
  });

  it('feeds the projection: measure, store, list, project', async () => {
    for (const unit of measuredUnits([run(), run({ repeat: 1 })])) await store.putUnit(unit);
    const projection = projectCost([{ adapter: 'function', blocks: 100 }], await store.listUnits());
    expect(projection.usd).toBeCloseTo(100 * 0.0015, 12);
    expect(projection.unmeasured).toEqual([]);
  });
});
