import { extractMap, ModelError, type Proposal, SYSTEM_PROMPT } from '@driftbench/generate';
import { describe, expect, it } from 'vitest';
import { runLadder } from '../../src/ladder';
import { expectedFacts, proposalFacts } from '../../src/ladders/map/bank/facts';
import {
  bankLevel,
  bankRow,
  bankShape,
  forecast,
  type ItemResult,
  MIN_FAMILY,
} from '../../src/ladders/map/bank/hardness';
import { mapBank } from '../../src/ladders/map/bank/index';
import {
  answerFor,
  asModelWrites,
  CHARS_PER_TOKEN,
  contractOf,
  OUTPUT_TOKENS,
  type Planted,
  perfectPort,
} from '../../src/ladders/map/bank/perfect';
import { runCase, runItem } from '../../src/ladders/map/bank/run';
import { renderStyled, STYLES, styledSpec } from '../../src/ladders/map/bank/styled';
import { LEVELS } from '../../src/ladders/map/bank/types';
import { mapLadder } from '../../src/ladders/map/index';

const bank = mapBank();
const item = (id: string) => {
  const found = bank.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

describe('the map bank under section 12', () => {
  it('holds at least 300 items, no family under 20, every tier, unique ids', () => {
    expect(bankShape(bank)).toEqual([]);
    expect(bank.length).toBeGreaterThanOrEqual(300);
    const families = new Map<string, number>();
    for (const one of bank) families.set(one.family, (families.get(one.family) ?? 0) + 1);
    for (const [family, count] of families) expect(count, family).toBeGreaterThanOrEqual(MIN_FAMILY);
    expect(new Set(bank.map((one) => one.tier))).toEqual(new Set([1, 2, 3, 4, 5]));
    for (const [index] of LEVELS.entries()) expect(bank.some((one) => one.level === index + 1)).toBe(true);
  });

  it('covers the minimum content of section 12.6: twelve styles and more, every pair, 100k prompts, the first ladder', () => {
    for (const style of [
      'markdown',
      'numbered',
      'prose',
      'table',
      'nested',
      'multilingual',
      'negation',
      'conditional',
      'tool-reference',
      'contradicting-example',
      'deprecated',
      'precedence',
    ]) {
      expect(STYLES).toContain(style);
    }
    expect(STYLES).toEqual(expect.arrayContaining(['question', 'hidden-in-example']));
    const pairs = bank.filter((one) => one.family === 'style-pairs');
    expect(pairs).toHaveLength((STYLES.length * (STYLES.length - 1)) / 2);
    expect(bank.filter((one) => /^scale\.100k\.[a-z-]+$/.test(one.id))).toHaveLength(STYLES.length);
    expect(bank.filter((one) => one.id.includes('.v1-'))).toHaveLength(7);
    expect(new Set(bank.map((one) => one.family))).toEqual(
      new Set([
        'inventory-forms',
        'tool-formats',
        'schema-keywords',
        'prompt-containers',
        'hostile-inputs',
        'styles',
        'style-pairs',
        'relations',
        'constraints',
        'transforms',
        'composition',
        'semantics',
        'roles',
        'scale',
      ]),
    );
  });

  it('generates the same cases on a repeat and different ones on another seed', () => {
    const one = item('styles.table');
    expect(JSON.stringify(one.generate(4))).toBe(JSON.stringify(one.generate(4)));
    expect(JSON.stringify(one.generate(4))).not.toBe(JSON.stringify(one.generate(5)));
  });
});

describe('the perfect model', () => {
  const value = (anchor: string, fields?: Record<string, unknown>): Planted => ({
    type: 'value',
    section: 'rules',
    source: 'prompt.md',
    quote: anchor,
    anchor,
    dimension: { id: 'rule', title: 'rules', kind: 'behaviour' },
    value: { id: 'R-01', title: 'a rule' },
    ...(fields ? { fields } : {}),
  });
  const request = (text: string, system = SYSTEM_PROMPT) => ({
    system,
    user: `SECTION: rules\n\nSources:\n\n<<<SOURCE prompt.md (prompt)\n${text}\nSOURCE prompt.md>>>`,
  });

  it('reports only what the request shows', () => {
    expect(
      answerFor('rules', request('Never read out a card number.'), [value('Never read out a card number.')])
        .dimensions,
    ).toHaveLength(1);
    expect(
      answerFor('rules', request('Something else.'), [value('Never read out a card number.')]).dimensions,
    ).toHaveLength(0);
  });

  it('writes a key only when the contract template shows it', () => {
    expect(contractOf(SYSTEM_PROMPT).valueKeys.has('polarity')).toBe(false);
    const plain = answerFor('rules', request('Never do it.'), [
      value('Never do it.', { polarity: 'must_not' }),
    ]);
    expect(plain.dimensions[0]?.values[0]).not.toHaveProperty('polarity');
    const richer = SYSTEM_PROMPT.replace(
      '"values": [{"id": "<value id>",',
      '"values": [{"id": "<value id>", "polarity": "<must or must_not>",',
    );
    expect(richer).not.toBe(SYSTEM_PROMPT);
    const rich = answerFor('rules', request('Never do it.', richer), [
      value('Never do it.', { polarity: 'must_not' }),
    ]);
    expect(rich.dimensions[0]?.values[0]).toMatchObject({ polarity: 'must_not' });
  });

  it('cuts an answer over its output budget and refuses a request over its context', async () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      ...value(`Rule number ${i} is a long rule that the assistant follows in every case.`),
      value: { id: `R-${i}`, title: 'x'.repeat(100) },
    })) as Planted[];
    const text = many.map((entry) => (entry as { anchor: string }).anchor).join('\n');
    await expect(perfectPort(many).complete(request(text))).rejects.toMatchObject({ code: 'truncated' });
    await expect(perfectPort(many).complete({ ...request(text), maxTokens: 100_000 })).resolves.toContain(
      'R-399',
    );
    await expect(
      perfectPort([], { contextTokens: 10 }).complete(request('x'.repeat(100))),
    ).rejects.toBeInstanceOf(ModelError);
  });

  it('writes text as a tokeniser does', () => {
    expect(asModelWrites('café')).toBe('café');
    expect(asModelWrites(`a${String.fromCharCode(0x200b)}b${String.fromCharCode(0x00ad)}c`)).toBe('abc');
  });
});

describe('the oracle of the styled prompts', () => {
  it('agrees with the extractor on everything but the fields the contract lacks', async () => {
    for (const styles of [
      ['markdown'],
      ['table', 'negation'],
      ['nested', 'precedence'],
      ['multilingual', 'question'],
    ] as const) {
      const rendered = renderStyled(
        styledSpec({ styles: [...styles], seed: 3, extras: { constraints: true } }),
      );
      const run = await runCase({ label: 'x', sources: rendered.sources, planted: rendered.planted });
      if (!run.result.ok) throw new Error('no proposal');
      const parts = { values: true, produced: true, constraints: true, relations: true, phrases: true };
      expect(proposalFacts(run.result.proposal, parts)).toEqual(
        expectedFacts(rendered.planted, rendered.code, parts),
      );
    }
  });
});

/** The real extractor, its proposal edited afterwards: a planted fault. */
function planted(edit: (proposal: Proposal) => void): { extract: typeof extractMap } {
  return {
    extract: (async (input) => {
      const result = await extractMap(input);
      if (result.ok) edit(result.proposal);
      return result;
    }) as typeof extractMap,
  };
}

// These tests never assert that today's extractor fails an item: an executor that fixes it must not break them.
describe('items and their oracles', () => {
  it('pass where the pre-pass contract has always held', async () => {
    for (const seed of [1, 2]) {
      expect((await runItem(item('schema-keywords.enum'), seed)).pass).toBe(true);
      expect((await runItem(item('tool-formats.mcp'), seed)).pass).toBe(true);
      expect((await runItem(item('prompt-containers.markdown'), seed)).pass).toBe(true);
      expect((await runItem(item('relations.path'), seed)).pass).toBe(true);
    }
  });

  it('name the lost partition when a planted fault drops it', async () => {
    const fault = planted((proposal) => {
      for (const dimension of proposal.dimensions)
        dimension.values = dimension.values.filter((value) => !value.id.endsWith('.low'));
    });
    const outcome = await runItem(item('schema-keywords.enum'), 3, fault);
    if (!outcome.pass) expect(outcome.detail).toMatch(/lost .*\.low = code/);
    const rules = planted((proposal) => {
      proposal.dimensions = proposal.dimensions.filter((dimension) => dimension.id !== 'rule');
    });
    const container = await runItem(item('prompt-containers.markdown'), 1, rules);
    expect(container.pass).toBe(false);
    expect(container.detail).toMatch(/lost .*rule\/R-01/);
  });

  it('fail a styled prompt on polarity while the contract has no polarity key, and on nothing else', async () => {
    if (contractOf(SYSTEM_PROMPT).valueKeys.has('polarity')) return;
    const outcome = await runItem(item('styles.markdown'), 1);
    expect(outcome.pass).toBe(false);
    expect(outcome.detail).toMatch(/^styles\.markdown: lost polarity rule\/R-\d+ = "must(_not)?"/);
    expect(outcome.detail).toMatch(/gained nothing$/);
  });

  it('write 100k prompts whose rules no single answer can hold', () => {
    const [one] = item('scale.100k.prose').generate(1);
    if (!one) throw new Error('no case');
    const prompt = one.sources.find((source) => source.kind === 'prompt')?.text ?? '';
    expect(prompt.length).toBeGreaterThanOrEqual(100_000);
    const answer = answerFor(
      'rules',
      {
        system: SYSTEM_PROMPT,
        user: `SECTION: rules\n\n<<<SOURCE prompt.md (prompt)\n${prompt}\nSOURCE prompt.md>>>`,
      },
      one.planted,
    );
    expect(JSON.stringify(answer).length).toBeGreaterThan(OUTPUT_TOKENS * CHARS_PER_TOKEN);
  });

  it('catch a planted extractor fault in the families it touches', async () => {
    const dropRelations = planted((proposal) => {
      proposal.relations = [];
    });
    expect((await runItem(item('relations.uses-tool'), 1, dropRelations)).pass).toBe(false);
    expect((await runItem(item('inventory-forms.all-classes'), 1, dropRelations)).pass).toBe(false);
    expect((await runItem(item('schema-keywords.enum'), 1, dropRelations)).pass).toBe(false);
  });
});

describe('the bank as a ladder', () => {
  it('stops at its first failing level and names the failing items with family and tier', async () => {
    const noTools = planted((proposal) => {
      proposal.dimensions = proposal.dimensions.filter(
        (dimension) => !dimension.id.includes('.in.') && !dimension.id.includes('.out.'),
      );
    });
    const run = await runLadder(mapLadder(noTools), { seed: 1 });
    expect(run.top).toBe(LEVELS.length);
    expect(run.level).toBe(0);
    expect(run.failing?.id).toBe('structured');
    expect(run.rows[1]?.pass).toBeNull();
    const ids = run.failing?.items.map((one) => one.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining(['schema-keywords.enum', 'tool-formats.mcp']));
    expect(run.failing?.items[0]?.detail).toMatch(/^\[[a-z-]+, tier [1-5]\] /);
  });
});

describe('the hardness measurement', () => {
  const results = (passing: number, total = 10): ItemResult[] =>
    Array.from({ length: total }, (_, i) => ({
      id: `f.${i}`,
      family: 'f',
      tier: 1,
      level: 1 + (i % 2),
      pass: i < passing,
      failedOn: i < passing ? [] : ['1'],
    }));

  it('scores a row, its level and its tallies', () => {
    const row = bankRow(0, 'abcdef1', ['1', 'hidden'], results(3), 'iteration 0', '2026-10-11T00:00:00.000Z');
    expect(row).toMatchObject({
      total: 10,
      passing: 3,
      score: 0.3,
      level: 0,
      perFamily: { f: { total: 10, passing: 3 } },
    });
    expect(bankLevel(results(10))).toBe(LEVELS.length);
    expect(bankLevel(results(1))).toBe(0);
  });

  it('forecasts the iterations left from the pilot and checks the gate', () => {
    const rows = [bankRow(0, 'abcdef1', ['1'], results(30, 400), '', '2026-10-11T00:00:00.000Z')];
    for (let i = 1; i <= 10; i++)
      rows.push(bankRow(i, 'abcdef1', ['1'], results(30 + 2 * i, 400), '', '2026-10-11T00:00:00.000Z'));
    const measured = forecast(rows);
    expect(measured).toMatchObject({
      iterations: 10,
      fixedPerIteration: 2,
      remaining: 350,
      forecast: 175,
      gate: true,
    });
    const fast = [
      rows[0] as (typeof rows)[number],
      bankRow(1, 'abcdef1', ['1'], results(330, 400), '', '2026-10-11T00:00:00.000Z'),
    ];
    expect(forecast(fast)?.gate).toBe(false);
    expect(forecast(fast)?.reasons.join('; ')).toMatch(/under 100.*over 0\.4.*not 10/);
  });
});
