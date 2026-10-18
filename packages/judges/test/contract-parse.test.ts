import { describe, expect, it } from 'vitest';
import { parseAnswerText } from '../src/contract';

/** Each case: an answer as a model wrote it, and the verdict it must give. A wrong verdict is never acceptable. */
const cases: [string, string, 'pass' | 'fail' | 'inconclusive'][] = [
  ['a clean object', '{"outcome":"pass","score":0.9,"reasoning":"ok"}', 'pass'],
  ['a fenced object', '```json\n{"outcome":"fail","reasoning":"no"}\n```', 'fail'],
  [
    'a brace in prose before the answer',
    'The reply {mentions a booking} and then fails. {"outcome":"fail","reasoning":"no"}',
    'fail',
  ],
  [
    'an example object before the answer',
    'For example {"outcome":"pass","reasoning":"e.g."}. My verdict: {"outcome":"fail","reasoning":"no"}',
    'fail',
  ],
  ['braces inside the reasoning string', '{"outcome":"fail","reasoning":"the {x} is missing"}', 'fail'],
  ['a truncated answer', '{"outcome":"pass","reasoning":"cut', 'inconclusive'],
  ['an answer with an extra key', '{"outcome":"pass","reasoning":"ok","verdict":2}', 'inconclusive'],
  [
    'an example then a truncated final answer',
    'Example {"outcome":"pass","reasoning":"e"} final {"outcome":"fa',
    'inconclusive',
  ],
  [
    'a trailing object that is not an answer',
    '{"outcome":"pass","reasoning":"ok"} {"note":"x"}',
    'inconclusive',
  ],
];

describe('parseAnswerText reads the final answer, never an example', () => {
  for (const [name, raw, want] of cases) {
    it(`${name}: ${want}`, () => {
      expect(parseAnswerText(raw).answer.outcome).toBe(want);
    });
  }

  it('never turns an example object into a verdict', () => {
    const outcome = parseAnswerText(
      'e.g. {"outcome":"pass","reasoning":"x"} and the verdict is {"outcome":"fail","reasoning":"y"}',
    ).answer.outcome;
    expect(outcome).toBe('fail');
  });
});
