import { validateVariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import {
  estateToVariables,
  limitPlace,
  limitRequest,
  limitsOfAnswer,
  produceLimits,
  provenanceResolver,
  withLimits,
} from '../../src/variables';
import { atom, mapOf } from './support';

// Invented: a boat hall with a keeper, keys and moorings.
const FILE = [
  '# Boat hall',
  '',
  '## Keys',
  '',
  '- Name the keeper of every boat before it leaves the hall.',
  '- Answer a mooring call within two hours.',
  '- Never hand out a key without a signature.',
  '',
  '## Moorings',
  '',
  '| Kind | Hours |',
  '|---|---|',
  '| small | 2 |',
  '',
  '- Use the hours in the table above.',
  '',
].join('\n');
const TEXTS = new Map([['CLAUDE.md', FILE]]);
const QUOTE = 'Answer a mooring call within two hours.';
const lineOf = (text: string) => FILE.split('\n').findIndex((row) => row.includes(text)) + 1;

describe('the place of an instruction', () => {
  it('holds the heading path, the tables of the section, the units that scope it and the units around it', () => {
    const line = lineOf(QUOTE);
    const place = limitPlace(FILE, line, line, 'When a boat is out.');
    expect(place).toContain('HEADINGS: Boat hall > Keys');
    expect(place).toContain('TABLES OF THE SECTION:\n(none)');
    expect(place).toContain('UNITS THAT SCOPE IT, linked by the map:\nWhen a boat is out.');
    expect(place).toContain('PREVIOUS UNIT: Name the keeper of every boat before it leaves the hall.');
    expect(place).toContain('NEXT UNIT: Never hand out a key without a signature.');
  });

  it('puts the table of the section in the place of an instruction that points at it, and no unit of another section', () => {
    const line = lineOf('Use the hours in the table above.');
    const place = limitPlace(FILE, line);
    expect(place).toContain('HEADINGS: Boat hall > Moorings');
    expect(place).toContain('| small | 2 |');
    expect(place).not.toContain('NEXT UNIT');
    expect(place).not.toContain('Never hand out a key');
  });

  it('builds a request whose user text holds the place and the quote', () => {
    const request = limitRequest(QUOTE, 'HEADINGS: x');
    expect(request.user).toBe(`PLACE:\nHEADINGS: x\n\nINSTRUCTION:\n${QUOTE}`);
    expect(request.system).toContain('a number that a rule constrains');
  });
});

describe('the answer to a request', () => {
  const answer = (limits: unknown) => JSON.stringify({ limits });

  it('reads limits with their comparison, role and unit, and makes one of a limit written twice', () => {
    const one = { limit: 2, comparison: 'le', role: 'constraint', unit: ' hours ' };
    expect(limitsOfAnswer(answer([one, { ...one }, { limit: 3, comparison: 'gt', role: 'trigger' }])).limits).toEqual([
      { limit: 2, comparison: 'le', role: 'constraint', unit: 'hours' },
      { limit: 3, comparison: 'gt', role: 'trigger' },
    ]);
  });

  it('reads an empty list as no limit, and an answer wrapped in other text', () => {
    expect(limitsOfAnswer(answer([]))).toEqual({ limits: [] });
    expect(limitsOfAnswer(`Here it is: ${answer([{ limit: 1, comparison: 'ge', role: 'constraint' }])}`).limits).toHaveLength(1);
  });

  it.each([
    ['no JSON', 'none'],
    ['JSON that does not parse', '{"limits": [}'],
    ['no list', '{"limits": 3}'],
    ['a limit that is a string', answer([{ limit: '2', comparison: 'le', role: 'constraint' }])],
    ['a limit that is not finite', '{"limits": [{"limit": 1e999, "comparison": "le", "role": "constraint"}]}'],
    ['an unknown comparison', answer([{ limit: 2, comparison: 'more', role: 'constraint' }])],
    ['an unknown role', answer([{ limit: 2, comparison: 'le', role: 'maybe' }])],
    ['a missing role', answer([{ limit: 2, comparison: 'le' }])],
  ])('gives no limit and a reason for %s', (_name, text) => {
    const read = limitsOfAnswer(text);
    expect(read.limits).toEqual([]);
    expect(read.problem).toBeDefined();
  });
});

describe('producing the limits of a map', () => {
  const rule = atom({ quote: QUOTE, span: { startLine: lineOf(QUOTE), endLine: lineOf(QUOTE) } });
  const plain = atom({
    quote: 'Never hand out a key without a signature.',
    span: { startLine: lineOf('Never hand out'), endLine: lineOf('Never hand out') },
  });
  const guard = atom({ kind: 'guard', quote: QUOTE, span: { startLine: lineOf(QUOTE), endLine: lineOf(QUOTE) } });

  it('asks once for each instruction atom, lands each answer on its own atom, and asks about no other kind', async () => {
    const asked: string[] = [];
    const produced = await produceLimits(mapOf([rule, plain, guard]), {
      texts: TEXTS,
      async ask(request) {
        asked.push(request.user);
        return request.user.endsWith(QUOTE)
          ? JSON.stringify({ limits: [{ limit: 2, comparison: 'le', role: 'constraint', unit: 'hours' }] })
          : '{"limits": []}';
      },
    });
    expect(asked).toHaveLength(2);
    expect(produced.requests).toBe(2);
    expect([...produced.limits.keys()]).toEqual([rule.id]);
    expect(produced.limits.get(rule.id)).toEqual([{ limit: 2, comparison: 'le', role: 'constraint', unit: 'hours' }]);
    expect(produced.unreadable).toEqual([]);
  });

  it('names an atom whose answer cannot be read, and gives it no limit', async () => {
    const produced = await produceLimits(mapOf([rule]), { texts: TEXTS, ask: async () => 'sorry' });
    expect(produced.limits.size).toBe(0);
    expect(produced.unreadable).toEqual([{ atom: rule.id, reason: 'no JSON object' }]);
  });

  it('writes the limits where the variable feed reads them, without the role, beside the ids of condition units', () => {
    const withIds = atom({
      quote: QUOTE,
      span: { startLine: lineOf(QUOTE), endLine: lineOf(QUOTE) },
      files: { 'CLAUDE.md': FILE },
      fields: { condition: ['abcdefghij'] },
    });
    const map = withLimits(mapOf([withIds]), new Map([[withIds.id, [{ limit: 2, comparison: 'le', role: 'trigger', unit: 'hours' }]]]));
    expect(map.atoms[0]?.fields?.condition).toEqual(['abcdefghij', { limit: 2, comparison: 'le', unit: 'hours' }]);
    const store = estateToVariables(map, provenanceResolver(TEXTS)).store;
    const conditions = store.variables.filter((variable) => variable.id.startsWith('condition.'));
    expect(conditions).toHaveLength(1);
    expect(conditions[0]?.boundaries?.[0]).toMatchObject({ limit: 2, comparison: 'le', unit: 'hours' });
    expect(validateVariableStore(store).ok).toBe(true);
  });
});
