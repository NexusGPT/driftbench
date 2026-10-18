import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractMap, ModelError, type Proposal, SYSTEM_PROMPT } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { BANK_MIN_FAMILY as MIN_FAMILY, measureHardness } from '../../src/hardness';
import { readJournal } from '../../src/journal';
import { runLadder } from '../../src/ladder';
import { expectedFacts, proposalFacts } from '../../src/ladders/map/bank/facts';
import {
  bankByFamilyTier,
  bankShape,
  distinctCauses,
  mapBank,
  mapQuarantine,
} from '../../src/ladders/map/bank/index';
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
import { ROOT } from './support';

const bank = mapBank();
/** Quarantined items still run in the tests: they count toward no score, but they must stay correct. */
const written = [...bank, ...mapQuarantine()];
const item = (id: string) => {
  const found = written.find((candidate) => candidate.id === id);
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
    expect(written.filter((one) => one.id.includes('.v1-'))).toHaveLength(7);
    expect(new Set(written.map((one) => one.family))).toEqual(
      new Set([
        'inventory-forms',
        'tool-formats',
        'schema-keywords',
        'prompt-containers',
        'hostile-inputs',
        'adversarial',
        'styles',
        'style-pairs',
        'relations',
        'constraints',
        'transforms',
        'composition',
        'semantics',
        'roles',
        'scale',
        'cutter-slices',
        'cutter-anchors',
        'cutter-containers',
        'cutter-invariance',
        'cutter-ledger',
        'cutter-scale',
        'cutter-hostile',
        'cutter-sentences',
        'cutter-structure',
        'cutter-masks',
        'cutter-ledger-follow',
        'cutter-growth',
      ]),
    );
  });

  it('gives every item one cause written as <component>:<change>, and holds more than 110 distinct causes', () => {
    for (const one of bank) expect(one.cause, one.id).toMatch(/^[a-z]+:[a-z0-9][a-z0-9+.-]*$/);
    expect(new Set(bank.map((one) => one.cause)).size).toBeGreaterThan(110);
    expect(
      distinctCauses(bank, [
        'schema-keywords.ref-defs',
        'schema-keywords.ref-definitions',
        'styles.markdown',
      ]),
    ).toEqual(['contract:rule-polarity', 'tools:local-ref']);
  });

  it('generates the same cases on a repeat and different ones on another seed', () => {
    const one = item('styles.table');
    expect(JSON.stringify(one.generate(4))).toBe(JSON.stringify(one.generate(4)));
    expect(JSON.stringify(one.generate(4))).not.toBe(JSON.stringify(one.generate(5)));
  });
});

describe('the perfect model', () => {
  it('misreads an entry whose context the request leaves out', () => {
    const rule = (extra: Partial<Planted>): Planted =>
      ({
        type: 'value',
        section: 'rules',
        source: 'prompt.md',
        quote: 'Never quote the old price.',
        anchor: 'Never quote the old price.',
        dimension: { id: 'rule', title: 'rules', kind: 'behaviour' },
        value: { id: 'R-01', title: 'a rule' },
        fields: { polarity: 'must_not', when: { channel: ['sms'] } },
        ...extra,
      }) as Planted;
    const ask = (text: string) => ({
      system: SYSTEM_PROMPT,
      user: `SECTION: rules\n\n<<<SOURCE prompt.md (prompt)\n${text}\nSOURCE prompt.md>>>`,
    });
    const deprecated = rule({ silent: true, context: { anchor: '## Deprecated', ifMissing: 'report' } });
    expect(
      answerFor('rules', ask('## Deprecated\n- Never quote the old price.'), [deprecated]).dimensions,
    ).toHaveLength(0);
    expect(answerFor('rules', ask('- Never quote the old price.'), [deprecated]).dimensions).toHaveLength(1);
    const scoped = rule({ context: { anchor: '### Only on sms', ifMissing: 'without-when' } });
    const richer = SYSTEM_PROMPT.replace(
      '"values": [{"id": "<value id>",',
      '"values": [{"id": "<value id>", "when": {}, ',
    );
    const cut = answerFor('rules', { ...ask('- Never quote the old price.'), system: richer }, [scoped]);
    expect(cut.dimensions[0]?.values[0]).not.toHaveProperty('when');
    const whole = answerFor(
      'rules',
      { ...ask('### Only on sms\n- Never quote the old price.'), system: richer },
      [scoped],
    );
    expect(whole.dimensions[0]?.values[0]).toHaveProperty('when');
  });

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
    const template = `{"dimensions": [
      {"id": "<dimension id>", "title": "<what it varies>", "kind": "<kind>",
       "values": [{"id": "<value id>", "title": "<what the value means>", "source": "<path>", "quote": "<verbatim text>"}]}
    ]}`;
    expect(contractOf(template).valueKeys.has('polarity')).toBe(false);
    const plain = answerFor('rules', request('Never do it.', template), [
      value('Never do it.', { polarity: 'must_not' }),
    ]);
    expect(plain.dimensions[0]?.values).toHaveLength(1);
    expect(plain.dimensions[0]?.values[0]).not.toHaveProperty('polarity');
  });

  it('writes a key when the contract template shows it', () => {
    const template = `{"dimensions": [
      {"id": "<dimension id>", "title": "<what it varies>", "kind": "<kind>",
       "values": [{"id": "<value id>", "title": "<what the value means>", "polarity": "<must or must_not>", "source": "<path>", "quote": "<verbatim text>"}]}
    ]}`;
    expect(contractOf(template).valueKeys.has('polarity')).toBe(true);
    const rich = answerFor('rules', request('Never do it.', template), [
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

describe('round 2 of the map audit', () => {
  it('runs every roles item on both sort orders of the two persona ids', () => {
    for (const one of written.filter((candidate) => candidate.family === 'roles' && !candidate.run)) {
      for (const seed of [1, 2, 3]) {
        const cases = one.generate(seed);
        expect(cases.map((c) => c.label.split('.').at(-1))).toEqual(['tone-first', 'type-first']);
        const orders = cases.map((c) => {
          const ids = [
            ...new Set(
              c.planted.flatMap((p) =>
                p.type === 'value' && p.dimension.kind === 'persona' ? [p.dimension] : [],
              ),
            ),
          ];
          const tone = ids.find((dimension) => /writes/.test(dimension.title))?.id ?? '';
          const type = ids.find((dimension) => /kind of customer/.test(dimension.title))?.id ?? '';
          return tone < type ? 'tone-first' : 'type-first';
        });
        expect(orders, `${one.id} seed ${seed}`).toEqual(['tone-first', 'type-first']);
      }
    }
  });

  it('fails roles and permute items when roles follow the sorted ids, whichever end is the axis', async () => {
    for (const first of [true, false]) {
      const sorted = planted((proposal) => {
        const personas = proposal.dimensions
          .filter((dimension) => dimension.kind === 'persona')
          .sort((a, b) => (a.id < b.id ? -1 : 1));
        personas.forEach((dimension, index) => {
          dimension.role = index === (first ? 0 : personas.length - 1) ? 'axis' : 'detail';
        });
      });
      for (const id of [
        'roles.markdown.tone-axis',
        'roles.markdown.type-axis',
        'transforms.permute.markdown',
      ]) {
        expect((await runItem(item(id), 1, sorted)).pass, `${id}, axis first ${first}`).toBe(false);
      }
    }
  });

  it('holds the code around the proposal and the space package to its references', async () => {
    for (const one of bank.filter((candidate) => candidate.id.startsWith('constraints.plumbing-'))) {
      const outcome = await runItem(one, 1);
      expect(outcome.pass, `${one.id}: ${outcome.detail}`).toBe(true);
    }
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
    expect(run.failing?.items[0]?.detail).toMatch(/^\[[a-z-]+, tier [1-5]\] .*\. Fix: [a-z]+:[a-z0-9+.-]+$/s);
  });
});

describe('the hardness measurement', () => {
  it('counts the bank per family and tier as the journal records it', () => {
    const counts = bankByFamilyTier(bank);
    const total = Object.values(counts)
      .flatMap((tiers) => Object.values(tiers))
      .reduce((sum, n) => sum + n, 0);
    expect(total).toBe(bank.length);
  });

  it('reads iteration 0 and the ten pilot rows of ladder version 2; with the bar of GATE.md, only the audit (12.7) is left', () => {
    // Ladder version 3 started a new journal: the version 2 rows sit, byte for byte, in journal-v2.jsonl.
    // They are read through the same reader, from a scratch root whose journal is that file.
    const scratch = mkdtempSync(join(tmpdir(), 'map-journal-v2-'));
    mkdirSync(join(scratch, 'validators/map'), { recursive: true });
    copyFileSync(
      join(ROOT, 'validators/map/journal-v2.jsonl'),
      join(scratch, 'validators/map/journal.jsonl'),
    );
    const { rows, problems } = readJournal(scratch, 'map');
    expect(problems).toEqual([]);
    const gate = readFileSync(join(ROOT, 'validators/map/GATE.md'), 'utf8');
    expect(measureHardness(rows).gate.reasons.some((reason) => /score after the pilot/.test(reason))).toBe(
      true,
    );
    const measured = measureHardness(rows, { gate });
    expect(measured).toMatchObject({ maxScore: 0.42, lowered: true });
    expect(measured.iteration0).toMatchObject({ bankSize: 578, passing: 222 });
    expect(measured.pilot).toMatchObject({ iterations: 10, complete: true });
    expect(measured.forecast).toBeGreaterThanOrEqual(100);
    expect(measured.causes?.distinct).toBeGreaterThanOrEqual(100);
    for (const reason of measured.gate.reasons) expect(reason).toMatch(/audit/);
    expect(measured.bankMinimum.holds).toBe(true);
  });

  it('reads ladder version 3 from the journal as it stands: the cutter level, its gate NOT MET', () => {
    // Version 3 adds the cutter level to the 578 items of version 2. Iteration 0 fails 6 items of one cause,
    // the builder's one pilot iteration fixed them, so the score after the pilot is 1, the forecast and the
    // failing causes are 0, and the pilot holds 1 of its 10 iterations. These are the reasons the pull request
    // states the gate of section 12.4 is not met; a later version 3 row changes them on purpose.
    const { rows, problems } = readJournal(ROOT, 'map');
    expect(problems).toEqual([]);
    const gate = readFileSync(join(ROOT, 'validators/map/GATE.md'), 'utf8');
    const measured = measureHardness(rows, { gate });
    expect(measured.iteration0).toMatchObject({ bankSize: 879, passing: 873 });
    expect(measured.pilot).toMatchObject({ iterations: 1, complete: false });
    expect(measured.pilot.end).toMatchObject({ bankSize: 879, passing: 879 });
    expect(measured.forecast).toBe(0);
    expect(measured.causes?.distinct).toBe(0);
    expect(measured.gate.holds).toBe(false);
    for (const pattern of [
      /1 of 10 iterations/,
      /forecast 0 is under 100/,
      /score after the pilot 1 is above 0.42/,
      /0 distinct failing causes/,
    ])
      expect(measured.gate.reasons.some((reason) => pattern.test(reason))).toBe(true);
    expect(measured.bankMinimum.holds).toBe(true);
  });
});
