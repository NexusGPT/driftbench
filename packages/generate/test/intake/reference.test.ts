import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  approveAllTurns,
  type CellPlan,
  cellOfRequest,
  fromInterview,
  type Interview,
  parseApproval,
  parseInterview,
  parseReferenceAnswer,
  planCells,
  renderApproval,
  renderReferenceSet,
  turnRecordingPort,
} from '../../src/intake';
import { FakeModelPort, type ModelRequest } from '../../src/model';
import { ZED_ANSWERS, ZED_MAP } from './fixtures';
import { realEmail } from './support';

function interview(): Interview {
  const parsed = parseInterview(ZED_ANSWERS, ZED_MAP);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.interview;
}

const plan = (total = 10): CellPlan => planCells(interview(), ZED_MAP, { total, minPerCell: 1 });

describe('planCells', () => {
  it('enumerates one cell per example, language and channel, minus what the map forbids', () => {
    const { cells, dropped, skipped } = plan();
    expect(cells.map((cell) => cell.key)).toEqual([
      'stage=greet flow=balance persona=saver user_type=customer language=english channel=chat lang=en',
      'stage=greet flow=balance persona=saver user_type=customer language=other-language channel=chat lang=nl',
      'stage=verify flow=card-lost persona=saver user_type=customer language=english channel=chat lang=en',
      'stage=verify flow=card-lost persona=saver user_type=customer language=english channel=email lang=en',
      'stage=verify flow=card-lost persona=saver user_type=customer language=other-language channel=chat lang=nl',
      'stage=verify flow=card-lost persona=saver user_type=customer language=other-language channel=email lang=nl',
      'stage=help flow=balance persona=teller user_type=staff language=english channel=chat lang=en',
    ]);
    expect(dropped.map((cell) => cell.reason)).toEqual([
      'balance is on chat only',
      'balance is on chat only',
    ]);
    expect(skipped).toEqual([{ example: 3, reason: 'card-lost is not an intent of teller' }]);
  });

  it('weighs each cell by the declared shares, normalised to 1', () => {
    const { cells } = plan();
    // saver 3/4 x balance 2/3 x en 9/10 x chat 4/5 = 0.36, and so on; the teller cell 1/4. Sum before
    // normalising: 0.9, the two balance-by-email cells being forbidden.
    const expected = [0.36, 0.04, 0.18, 0.045, 0.02, 0.005, 0.25].map((weight) => weight / 0.9);
    cells.forEach((cell, index) => {
      expect(cell.weight).toBeCloseTo(expected[index] as number, 12);
    });
  });

  it('allocates the turns by largest remainder with a floor of one per cell', () => {
    expect(plan(10).cells.map((cell) => cell.requested)).toEqual([4, 1, 2, 1, 1, 1, 3]);
    expect(plan(0).cells.map((cell) => cell.requested)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it('splits a group over the stages the owner gave examples for', () => {
    const answers = ZED_ANSWERS.replace(
      '  - stage: verify\n    intent: card-lost',
      '  - stage: help\n    intent: balance\n    persona: saver\n    turns: ["and my savings?"]\n  - stage: verify\n    intent: card-lost',
    );
    const parsed = parseInterview(answers, ZED_MAP);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const { cells } = planCells(parsed.interview, ZED_MAP, { total: 10 });
    const greet = cells.find((cell) => cell.stage === 'greet' && cell.lang === 'en');
    const help = cells.find(
      (cell) => cell.stage === 'help' && cell.persona === 'saver' && cell.lang === 'en',
    );
    expect(greet?.weight).toBeCloseTo(help?.weight ?? -1, 12);
  });
});

/** Answers each cell with the turns a test wants, by cell key; a default answer otherwise. */
function answering(byCell: (key: string, count: number) => unknown) {
  return (request: ModelRequest) => {
    const key = cellOfRequest(request.user) ?? '';
    const count = Number(/^COUNT: (\d+)$/m.exec(request.user)?.[1]);
    return JSON.stringify(byCell(key, count));
  };
}

const PATHS = { interview: 'answers.yaml', map: 'map.yaml' };
const NOW = () => new Date('2026-10-11T12:00:00Z');

describe('fromInterview', () => {
  it('puts the owner examples in their own cell and the model turns in theirs, every turn tagged', async () => {
    const p = plan(7);
    const port = new FakeModelPort(
      p.cells.map(() =>
        answering((key, count) => ({
          cell: key,
          turns: Array.from({ length: count }, (_, i) => ({
            text: `turn ${i} for ${key.split(' ')[0]} ${key.split(' ').at(-1)} ${key.split(' ')[5]}`,
            source: 'tone',
          })),
        })),
      ),
      { family: 'other', model: 'writer-1' },
    );
    const result = await fromInterview(interview(), ZED_MAP, p, { port, paths: PATHS, now: NOW });
    expect(result.runs.every((run) => run.status === 'done')).toBe(true);
    expect(result.calls).toBe(7);
    const fromOwner = result.set.turns.filter((turn) => turn.origin === 'interview');
    expect(
      fromOwner.map((turn) => [turn.source, turn.cell.stage, turn.cell.lang, turn.cell.channel]),
    ).toEqual([
      ['examples.0.turns.0', 'greet', 'en', 'chat'],
      ['examples.0.turns.1', 'greet', 'en', 'chat'],
      ['examples.1.turns.0', 'verify', 'en', 'chat'],
      ['examples.2.turns.0', 'help', 'en', 'chat'],
    ]);
    expect(result.set.turns.filter((turn) => turn.origin === 'model')).toHaveLength(
      p.cells.reduce((sum, cell) => sum + cell.requested, 0),
    );
    expect(result.set.turns.map((turn) => turn.id)).toEqual(
      result.set.turns.map((_, index) => `t-${String(index + 1).padStart(4, '0')}`),
    );
    expect(result.set.produced_by).toEqual({
      family: 'other',
      model: 'writer-1',
      at: '2026-10-11T12:00:00.000Z',
    });
    const request = port.requests[0]?.user ?? '';
    expect(request).toContain('EXAMPLES FROM THE OWNER:\n- examples.0.turns.0: "hi, what\'s my balance?"');
    expect(request).toContain('- never.0: Users never ask for investment advice');
    expect(request).toContain(
      'SOURCES: examples.0.turns.0, examples.0.turns.1, personas.saver, tone, never.0',
    );
  });

  it('refuses each bad turn in code with its reason, and reports the cell short', async () => {
    const p = plan(0);
    const first = p.cells[0]?.key ?? '';
    p.cells[0] = { ...(p.cells[0] as (typeof p.cells)[number]), requested: 8 };
    const bad = [
      { text: 'User: what is my balance', source: 'tone' },
      { text: `my email is ${realEmail('bo')}`, source: 'tone' },
      { text: 'should I invest my savings?', source: 'tone' },
      { text: "hi, what's my balance?", source: 'tone' },
      { text: 'how much money do I have in my account', source: 'tone' },
      { text: 'how much money do I have in my account?', source: 'tone' },
      { text: 'what is left on my card', source: 'examples.9.turns.0' },
      { text: '', source: 'tone' },
      { text: 'mail me at sam@example.com', source: 'tone' },
    ];
    const port = new FakeModelPort(
      p.cells.map(() =>
        answering((key, count) =>
          key === first
            ? { cell: key, turns: bad }
            : {
                cell: key,
                turns: Array.from({ length: count }, (_, i) => ({
                  text: `other ${key} ${i}`,
                  source: 'tone',
                })),
              },
        ),
      ),
    );
    const result = await fromInterview(interview(), ZED_MAP, p, { port, paths: PATHS, now: NOW });
    expect(result.set.rejected.map((entry) => entry.reason)).toEqual([
      'starts with a speaker label',
      'real-looking personal data (email)',
      'contains "invest", which never.0 rules out',
      'copies the owner example examples.0.turns.0',
      'near-duplicate of t-0003',
      'cites an unknown source "examples.9.turns.0"',
      'empty',
    ]);
    expect(result.runs[0]).toMatchObject({ status: 'short', requested: 8, accepted: 2 });
    expect(
      result.set.turns
        .filter((turn) => turn.cell.stage === 'greet' && turn.cell.lang === 'en')
        .map((t) => t.text),
    ).toEqual([
      "hi, what's my balance?",
      'balance please',
      'how much money do I have in my account',
      'mail me at sam@example.com',
    ]);
  });

  it('refuses turns beyond the count asked', async () => {
    const p = plan(0);
    const port = new FakeModelPort(
      p.cells.map(() =>
        answering((key) => ({
          cell: key,
          turns: [
            { text: `first distinct message ${key}`, source: 'tone' },
            { text: 'a second, entirely different one', source: 'tone' },
          ],
        })),
      ),
    );
    const result = await fromInterview(interview(), ZED_MAP, p, { port, paths: PATHS, now: NOW });
    expect(result.set.rejected.every((entry) => entry.reason === 'more turns than asked')).toBe(true);
    expect(result.set.rejected).toHaveLength(p.cells.length);
  });

  it('retries an unreadable answer once, then fails the cell and runs the next ones', async () => {
    const p = plan(0);
    const good = answering((key, count) => ({
      cell: key,
      turns: Array.from({ length: count }, (_, i) => ({ text: `fine ${key} ${i}`, source: 'tone' })),
    }));
    const port = new FakeModelPort([
      'not json',
      good,
      '{"cell": "another", "turns": []}',
      '{"cell": "x"}',
      ...p.cells.slice(2).map(() => good),
    ]);
    const result = await fromInterview(interview(), ZED_MAP, p, { port, paths: PATHS, now: NOW });
    expect(result.runs.map((run) => run.status)).toEqual([
      'done',
      'failed',
      'done',
      'done',
      'done',
      'done',
      'done',
    ]);
    expect(result.runs[1]?.error).toBe('turns: Invalid input: expected array, received undefined');
    expect(port.requests[1]?.user).toContain('could not be read: the answer is not JSON');
    expect(result.calls).toBe(4 + p.cells.length - 2);
  });
});

describe('parseReferenceAnswer', () => {
  it('reads a fenced answer and refuses another cell or an unknown key', () => {
    expect(parseReferenceAnswer('```json\n{"cell": "k", "turns": []}\n```', 'k')).toEqual({
      ok: true,
      turns: [],
    });
    expect(parseReferenceAnswer('{"cell": "j", "turns": []}', 'k')).toMatchObject({ ok: false });
    expect(
      parseReferenceAnswer('{"cell": "k", "turns": [{"text": "a", "source": "b", "x": 1}]}', 'k'),
    ).toMatchObject({
      ok: false,
    });
  });
});

describe('the reference set and its approval file', () => {
  async function built() {
    const p = plan(0);
    const port = new FakeModelPort(
      p.cells.map(() =>
        answering((key) => ({ cell: key, turns: [{ text: `written for ${key}`, source: 'tone' }] })),
      ),
    );
    return fromInterview(interview(), ZED_MAP, p, { port, paths: PATHS, now: NOW });
  }

  it('renders YAML that reads back, every turn unapproved, the text repeated for the reader', async () => {
    const { set } = await built();
    const reference = parseYaml(renderReferenceSet(set));
    expect(reference.turns).toHaveLength(set.turns.length);
    const approval = parseApproval(renderApproval(set, 'reference.yaml'));
    expect(approval.ok).toBe(true);
    if (!approval.ok) return;
    expect(approval.approval.turns.every((turn) => turn.approved === false)).toBe(true);
    expect(approval.approval.turns[0]).toMatchObject({
      id: 't-0001',
      origin: 'interview',
      text: "hi, what's my balance?",
    });
  });

  it('approves every turn in place and counts the flags it flipped', async () => {
    const { set } = await built();
    const text = renderApproval(set, 'reference.yaml').replace('approved: false', 'approved: true');
    const result = approveAllTurns(text);
    expect(result).toMatchObject({ ok: true, approved: set.turns.length - 1, already: 1 });
    if (!result.ok) return;
    expect(result.text.startsWith('# Approval of the reference set')).toBe(true);
    expect(approveAllTurns(result.text)).toMatchObject({ approved: 0, already: set.turns.length });
  });

  it('refuses an approval file with a turn twice or a flag that is not a boolean', () => {
    const turn = '  - { id: t-1, cell: c, origin: model, text: a, approved: false }\n';
    expect(parseApproval(`reference: r\nturns:\n${turn}${turn}`)).toMatchObject({ ok: false });
    expect(
      parseApproval(
        'reference: r\nturns:\n  - { id: t-1, cell: c, origin: model, text: a, approved: yes }\n',
      ),
    ).toMatchObject({
      ok: false,
    });
  });
});

describe('turnRecordingPort', () => {
  it('answers by the cell the request names, in order, and says when a cell has no answer left', async () => {
    const port = turnRecordingPort({
      family: 'lane',
      model: 'by hand',
      answers: { 'stage=a': ['one', { cell: 'stage=a', turns: [] }] },
    });
    expect(await port.complete({ system: '', user: 'CELL: stage=a\nCOUNT: 1' })).toBe('one');
    expect(JSON.parse(await port.complete({ system: '', user: 'CELL: stage=a\nCOUNT: 1' }))).toEqual({
      cell: 'stage=a',
      turns: [],
    });
    await expect(port.complete({ system: '', user: 'CELL: stage=a' })).rejects.toMatchObject({
      code: 'exhausted',
    });
    await expect(port.complete({ system: '', user: 'no cell' })).rejects.toMatchObject({
      code: 'bad_response',
    });
  });
});
