import { validateVariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import {
  estateToVariables,
  limitPlace,
  limitRequest,
  limitsOfAnswer,
  limitRequestReferred,
  produceLimits,
  produceTableLimits,
  tableRequest,
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
    expect(
      limitsOfAnswer(answer([one, { ...one }, { limit: 3, comparison: 'gt', role: 'trigger' }])).limits,
    ).toEqual([
      { limit: 2, comparison: 'le', role: 'constraint', unit: 'hours' },
      { limit: 3, comparison: 'gt', role: 'trigger' },
    ]);
  });

  it('reads an empty list as no limit, and an answer wrapped in other text', () => {
    expect(limitsOfAnswer(answer([]))).toEqual({ limits: [] });
    expect(
      limitsOfAnswer(`Here it is: ${answer([{ limit: 1, comparison: 'ge', role: 'constraint' }])}`).limits,
    ).toHaveLength(1);
  });

  it.each([
    ['no JSON', 'none'],
    ['JSON that does not parse', '{"limits": [}'],
    ['no list', '{"limits": 3}'],
    ['a limit that is a string', answer([{ limit: '2', comparison: 'le', role: 'constraint' }])],
    [
      'a limit that is not finite',
      '{"limits": [{"limit": 1e999, "comparison": "le", "role": "constraint"}]}',
    ],
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
  const guard = atom({
    kind: 'guard',
    quote: QUOTE,
    span: { startLine: lineOf(QUOTE), endLine: lineOf(QUOTE) },
  });

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
    expect(produced.limits.get(rule.id)).toEqual([
      { limit: 2, comparison: 'le', role: 'constraint', unit: 'hours' },
    ]);
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
    const map = withLimits(
      mapOf([withIds]),
      new Map([[withIds.id, [{ limit: 2, comparison: 'le', role: 'trigger', unit: 'hours' }]]]),
    );
    expect(map.atoms[0]?.fields?.condition).toEqual([
      'abcdefghij',
      { limit: 2, comparison: 'le', unit: 'hours' },
    ]);
    const store = estateToVariables(map, provenanceResolver(TEXTS)).store;
    const conditions = store.variables.filter((variable) => variable.id.startsWith('condition.'));
    expect(conditions).toHaveLength(1);
    expect(conditions[0]?.boundaries?.[0]).toMatchObject({ limit: 2, comparison: 'le', unit: 'hours' });
    expect(validateVariableStore(store).ok).toBe(true);
  });
});

// Invented: a stable with a pointer sentence, a neighbour that has no limit, and a standalone table.
describe('a number written in another unit (a planted refersTo)', () => {
  const POINTER = 'The longest stall rental is set in the next sentence.';
  const NUMBER = 'A stall may be rented for at most 14 nights.';
  const NEIGHBOUR = 'Greet the rider by name.';
  const pointer = atom({ quote: POINTER, span: { startLine: 1, endLine: 1 } });
  const neighbour = atom({ quote: NEIGHBOUR, span: { startLine: 3, endLine: 3 } });
  const texts = new Map([['CLAUDE.md', [POINTER, NUMBER, '', NEIGHBOUR].join('\n')]]);

  it('adds a REFERRED block, and a line of the system text, to the request of a unit that has a referred text', () => {
    const request = limitRequestReferred(POINTER, 'HEADINGS: x', NUMBER);
    expect(request.user).toBe(`PLACE:\nHEADINGS: x\n\nREFERRED:\n${NUMBER}\n\nINSTRUCTION:\n${POINTER}`);
    expect(request.system.startsWith(limitRequest(POINTER, 'x').system)).toBe(true);
    expect(request.system).toContain('REFERRED');
  });

  it('leaves the request of every other unit byte for byte as it was, and gives REFERRED only where the labeller named a target', async () => {
    const seen = new Map<string, { system: string; user: string }>();
    const produced = await produceLimits(mapOf([pointer, neighbour]), {
      texts,
      referred: (found) => (found.id === pointer.id ? NUMBER : undefined),
      async ask(request) {
        seen.set(request.user.slice(request.user.lastIndexOf('INSTRUCTION:\n') + 13), request);
        return request.user.includes('REFERRED:')
          ? JSON.stringify({ limits: [{ limit: 14, comparison: 'le', role: 'constraint', unit: 'nights' }] })
          : '{"limits": []}';
      },
    });
    const plainPlace = (line: number) => limitPlace(texts.get('CLAUDE.md') ?? '', line, line);
    expect(seen.get(NEIGHBOUR)).toEqual(limitRequest(NEIGHBOUR, plainPlace(3)));
    expect(seen.get(POINTER)?.user).toContain(`REFERRED:\n${NUMBER}`);
    expect(produced.limits.get(pointer.id)).toEqual([
      { limit: 14, comparison: 'le', role: 'constraint', unit: 'nights' },
    ]);
    expect(produced.limits.has(neighbour.id)).toBe(false);
  });

  it('asks the same requests as before when no unit has a referred text', async () => {
    const asked: string[] = [];
    await produceLimits(mapOf([pointer]), {
      texts,
      async ask(request) {
        asked.push(request.system + request.user);
        return '{"limits": []}';
      },
    });
    expect(asked).toEqual([
      limitRequest(POINTER, limitPlace(texts.get('CLAUDE.md') ?? '', 1, 1)).system +
        limitRequest(POINTER, limitPlace(texts.get('CLAUDE.md') ?? '', 1, 1)).user,
    ]);
  });
});

describe('a standalone table (a planted limits-table)', () => {
  const table = {
    id: 'stalls',
    header: '| Stall | Nights |',
    rows: [
      { id: 'r1', text: '| Box | 14 |' },
      { id: 'r2', text: '| Paddock | 30 |' },
    ],
  };

  it('puts the header and the numbered rows of the table in one request', () => {
    const request = tableRequest(table);
    expect(request.user).toBe('TABLE HEADER:\n| Stall | Nights |\n\nROWS:\n1. | Box | 14 |\n2. | Paddock | 30 |');
    expect(request.system).toContain('"row"');
  });

  it('asks once for each table and lands each limit on the row unit it names', async () => {
    const asked: string[] = [];
    const produced = await produceTableLimits([table], {
      async ask(request) {
        asked.push(request.user);
        return JSON.stringify({
          limits: [
            { row: 1, limit: 14, comparison: 'le', role: 'constraint', unit: 'nights' },
            { row: 2, limit: 30, comparison: 'le', role: 'constraint' },
          ],
        });
      },
    });
    expect(asked).toHaveLength(1);
    expect(produced.requests).toBe(1);
    expect(produced.limits.get('r1')).toEqual([{ limit: 14, comparison: 'le', role: 'constraint', unit: 'nights' }]);
    expect(produced.limits.get('r2')).toEqual([{ limit: 30, comparison: 'le', role: 'constraint' }]);
    expect(produced.unreadable).toEqual([]);
  });

  it('names a table whose answer names a row it does not have, or cannot be read, and gives it no limit', async () => {
    const bad = await produceTableLimits([table], {
      ask: async () => JSON.stringify({ limits: [{ row: 3, limit: 1, comparison: 'le', role: 'constraint' }] }),
    });
    expect(bad.limits.size).toBe(0);
    expect(bad.unreadable).toEqual([{ table: 'stalls', reason: 'a row is out of the table' }]);
    const none = await produceTableLimits([table], { ask: async () => 'sorry' });
    expect(none.unreadable).toEqual([{ table: 'stalls', reason: 'no JSON object' }]);
  });
});
