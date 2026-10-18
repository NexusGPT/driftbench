import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  emptyCassette,
  FakeJudge,
  type JudgeRequest,
  parseAnswerText,
  playerClient,
  recordingClient,
  repairAnswerText,
} from '../src/index';

/**
 * The strict repair: a model answer whose string values hold unescaped double quotes does not parse as JSON.
 * One repair escapes those inner quotes, then the contract reads it, and the result says it was repaired.
 * The fixture is the answer haiku gave on the ledger_intact fail fixture on 2026-10-12, as recorded.
 */

const CAPTURED = new URL('./fixtures/ledger-intact-unescaped.txt', import.meta.url);

describe('the strict repair of unescaped quotes', () => {
  it('reads the captured ledger_intact answer as the fail it says, and marks it repaired', async () => {
    const raw = await readFile(CAPTURED, 'utf8');
    expect(() => JSON.parse(raw)).toThrow();
    const result = parseAnswerText(raw);
    expect(result.unparsed).toBeUndefined();
    expect(result.repaired).toBe(true);
    expect(result.answer.outcome).toBe('fail');
    expect(result.answer.score).toBe(0.05);
    expect(result.answer.reasoning).toContain(
      'asks for the address again ("What address would you like me to check?")',
    );
    expect(result.raw).toBe(raw);
  });

  it('leaves a valid answer as it is, unmarked', () => {
    const result = parseAnswerText('{"outcome":"pass","reasoning":"he said \\"yes\\""}');
    expect(result).toMatchObject({ answer: { outcome: 'pass', reasoning: 'he said "yes"' } });
    expect(result.repaired).toBeUndefined();
  });

  it('repairs only quotes inside string values, and refuses what is still not JSON after it', () => {
    expect(repairAnswerText('{"outcome": "fail", "reasoning": "a "quoted" word"}')).toBe(
      '{"outcome": "fail", "reasoning": "a \\"quoted\\" word"}',
    );
    const broken = parseAnswerText('{"outcome": "fail", "reasoning": "cut here');
    expect(broken.unparsed).toBe(true);
    expect(broken.repaired).toBeUndefined();
    // A repair never turns a contract break into a pass: an extra key stays unparsed.
    const extra = parseAnswerText('{"outcome": "pass", "reasoning": "a "b" c", "verdict": "pass"}');
    expect(extra.unparsed).toBe(true);
  });

  it('records the repair on a cassette, and the replay says it again', async () => {
    const raw = await readFile(CAPTURED, 'utf8');
    const cassette = emptyCassette();
    const request: JudgeRequest = {
      criterion: { name: 'ledger_intact', rubric: 'The reply restates the address.' },
      transcript: [{ role: 'agent', text: 'What address would you like me to check?' }],
    };
    await recordingClient(new FakeJudge('lab', [raw], { family: 'lab' }), cassette).judge(request);
    expect(cassette.entries[0]).toMatchObject({ repaired: true, answer: { outcome: 'fail' } });
    const replayed = await playerClient(cassette, 'lab').judge(request);
    expect(replayed).toMatchObject({ repaired: true, answer: { outcome: 'fail' } });
  });
});
