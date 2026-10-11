import { describe, expect, it } from 'vitest';
import {
  allowedTuples,
  BANK_LEVELS,
  bankScore,
  bankShape,
  dispatcherFamily,
  estateBank,
  type Family,
  frontmatterFamily,
  hardness,
  hostileFamily,
  itemsOf,
  levelMeasure,
  PlantedEstate,
  rowOf,
  scaleEstate,
  truthPort,
} from '../../src/ladders/estate/index';

function fake(id: string, results: (seed: number) => boolean[]): Family {
  const items = itemsOf(id, 1, 'x', [
    { key: 'a', tier: 1, title: 'a' },
    { key: 'b', tier: 2, title: 'b' },
  ]);
  let calls = 0;
  return {
    id,
    level: 1,
    component: 'x',
    items,
    get calls() {
      return calls;
    },
    async evaluate(seed) {
      calls += 1;
      const pass = results(seed);
      return new Map(
        items.map((item, index) => [item.id, { pass: pass[index] ?? false, detail: `seed ${seed}` }]),
      );
    },
  } as Family & { calls: number };
}

describe('the estate bank', () => {
  it('meets the bank minimum of section 12: 300 items, no family under 20, every tier', () => {
    const shape = bankShape(estateBank());
    expect(shape.size).toBeGreaterThanOrEqual(300);
    for (const [family, count] of Object.entries(shape.families))
      expect(count, family).toBeGreaterThanOrEqual(20);
    expect(Object.keys(shape.tiers).sort()).toEqual(['1', '2', '3', '4', '5']);
    expect(Object.keys(shape.levels).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(BANK_LEVELS.map((level) => level.id)).toEqual([
      'reader',
      'lint',
      'plan',
      'generation',
      'agent-mutants',
      'maintenance',
      'scale',
    ]);
  });

  it('gives every item a unique id, a family, a tier from 1 to 5 and a component', () => {
    const items = estateBank().flatMap((family) =>
      family.items.map((item) => ({ ...item, owner: family.id })),
    );
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    for (const item of items) {
      expect(item.family).toBe(item.owner);
      expect(item.tier).toBeGreaterThanOrEqual(1);
      expect(item.tier).toBeLessThanOrEqual(5);
      expect(item.component).toMatch(/^packages\//);
      expect(item.id.startsWith(`${item.family}.`)).toBe(true);
    }
  });

  it('scores an item only when it passes on every seed, and asks a failed item no further seed', async () => {
    const family = fake('fake.score', (seed) => [true, seed !== 2]) as Family & { calls: number };
    const score = await bankScore(
      [family],
      [
        { seed: 1, label: '1' },
        { seed: 2, label: '2' },
        { seed: 3, label: 'hidden' },
      ],
    );
    expect(score.passing).toBe(1);
    expect(score.items.find((item) => item.id === 'fake.score.b')).toMatchObject({
      pass: false,
      failedOn: '2',
    });
    expect(family.calls).toBe(3);
  });

  it('measures a level as items passing over items, naming each failing item with family and tier', async () => {
    const measure = await levelMeasure([fake('fake.level', () => [true, false])], 1);
    expect(measure.value).toBe(0.5);
    expect(measure.items).toEqual([
      { id: 'fake.level.b', component: 'x', detail: '[fake.level, tier 2] b: seed 1' },
    ]);
  });

  it('forecasts iterations from the items each pilot iteration fixed', () => {
    const families = [fake('fake.hard', () => [false, false])];
    const row = (iteration: number, failing: string[]) => ({
      iteration,
      at: '2026-10-12T00:00:00Z',
      commit: 'c',
      seeds: ['1', 'hidden'],
      hiddenSeed: 7,
      size: 4,
      passing: 4 - failing.length,
      score: (4 - failing.length) / 4,
      change: `step ${iteration}`,
      failing,
      perFamily: {},
    });
    const result = hardness(families, {
      version: 1,
      component: 'estate',
      rows: [row(0, ['a', 'b', 'c', 'd']), row(1, ['b', 'c', 'd']), row(2, ['c', 'd'])],
    });
    expect(result.pilot.map((entry) => entry.fixed)).toEqual([['a'], ['b']]);
    expect(result.meanFixed).toBe(1);
    expect(result.forecast).toBe(2);
    expect(result.gate).toEqual({ forecast: false, score: false, holds: false });
  });

  it('builds a row with its failing ids and the score per family', () => {
    const row = rowOf(
      {
        size: 2,
        passing: 1,
        score: 0.5,
        items: [
          { id: 'f.a', family: 'f', tier: 1, level: 1, component: 'x', title: 'a', pass: true },
          {
            id: 'f.b',
            family: 'f',
            tier: 2,
            level: 1,
            component: 'x',
            title: 'b',
            pass: false,
            failedOn: '1',
            detail: 'no',
          },
        ],
      },
      { iteration: 0, at: 'now', commit: 'c', seeds: ['1'], hiddenSeed: 9, change: 'start' },
    );
    expect(row.failing).toEqual(['f.b']);
    expect(row.perFamily).toEqual({ f: { size: 2, passing: 1 } });
  });
});

describe('planted estates', { timeout: 60_000 }, () => {
  it('judges an item by its own lines: a missed atom, an atom never planted, a missed edge, a failed check', async () => {
    const estate = new PlantedEstate();
    estate.file('CLAUDE.md', 'base').line('# Planted');
    const writer = estate.file('.claude/skills/tally/SKILL.md', 'item');
    writer.line('---');
    writer.line('name: tally', [{ hid: 'skill', kind: 'skill', key: 'tally' }]);
    writer.line('description: Tally things.', [{ hid: 'route', kind: 'route', key: 'tally' }]);
    writer.line('---');
    writer.line('');
    writer.line('When unsure, open `references/gone.md`.');
    estate.edge('item', 'route', 'skill', 'route');
    estate.edge('item', 'skill', 'route', 'dispatch');
    estate.check('item', () => 'the planted check fails');
    const scan = await estate.scan();
    const result = estate.judge(scan, ['item']).get('item');
    expect(result?.pass).toBe(false);
    expect(result?.detail).toMatch(
      /found reference .* at \.claude\/skills\/tally\/SKILL\.md:6, never planted/,
    );
    expect(result?.detail).toMatch(/missed the dispatch edge skill to route/);
    expect(result?.detail).toMatch(/the planted check fails/);
  });

  it('answers any chunk with the planted prose atoms inside its lines', async () => {
    const port = truthPort(
      new Map([
        [
          'a.md',
          [
            {
              kind: 'instruction' as const,
              title: 'one',
              quote: 'Rule one.',
              evidence: [{ type: 'custom' as const, name: 'x' }],
              line: 3,
            },
            {
              kind: 'instruction' as const,
              title: 'two',
              quote: 'Rule two.',
              evidence: [{ type: 'custom' as const, name: 'x' }],
              line: 30,
            },
          ],
        ],
      ]),
    );
    const answer = await port.complete({
      system: '',
      user: 'CHUNK: a.md#1\n\nFile a.md, lines 1 to 10. Split it.\n\n<<<CHUNK\nx\nCHUNK>>>',
    });
    expect(JSON.parse(answer)).toMatchObject({ chunk: 'a.md#1', atoms: [{ title: 'one' }] });
    expect(port.requests).toEqual([{ file: 'a.md', from: 1, to: 10, characters: 1 }]);
  });
});

describe('families against the current components', { timeout: 120_000 }, () => {
  it('reads plain frontmatter forms and names the colon form the reader refuses', async () => {
    const results = await frontmatterFamily().evaluate(3);
    expect(results.get('scan.frontmatter.plain')?.pass).toBe(true);
    expect(results.get('scan.frontmatter.colon-in-value')?.pass).toBe(false);
    expect(results.get('scan.frontmatter.colon-in-value')?.detail).toMatch(/missed route/);
  });

  it('finds the script behind an anchor and names the prefix forms it cannot read', async () => {
    const results = await dispatcherFamily().evaluate(3);
    expect(results.get('scan.dispatcher.interpreter-anchor')?.pass).toBe(true);
    expect(results.get('scan.dispatcher.quiet-prefix')?.pass).toBe(false);
  });

  it('turns a crash of the scan on an empty file into a failing item, not a failing family', async () => {
    const results = await hostileFamily().evaluate(1);
    expect(results.get('scan.hostile.empty-definition')).toMatchObject({ pass: false });
    expect(results.get('scan.hostile.frontmatter-only')?.pass).toBe(true);
  });

  it('enumerates allowed tuples of strength 3 by brute force', () => {
    const tuples = allowedTuples([2, 2, 2], 3, (cell) => cell[0] === 0 && cell[1] === 0);
    expect(tuples.size).toBe(6);
  });

  it('plants as many atoms as asked in a scale estate, the same from the same seed', () => {
    const a = scaleEstate(250, 4);
    expect(a.atoms).toBeGreaterThanOrEqual(250);
    expect(a.atoms).toBeLessThan(250 + 7);
    expect(scaleEstate(250, 4)).toEqual(a);
    expect(scaleEstate(250, 5).files).not.toEqual(a.files);
  });
});
