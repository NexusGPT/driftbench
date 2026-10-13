import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeRequest } from '../src/contract';
import { candidateContainsQuote } from '../src/evidence';

const request = (A: string): JudgeRequest => ({
  criterion: { name: 'c', rubric: 'r' },
  transcript: [],
  assessment: { kind: 'pairwise' },
  candidates: { A, B: 'None.' },
});
const parse = (A: string, winnerQuote: string) =>
  parseJudgeText(JSON.stringify({ winner: 'A', reasoning: 'r', winnerQuote }), request(A));

const unicodeJson = (text: string) =>
  `"${Array.from({ length: text.length }, (_, i) => `\\u${text.charCodeAt(i).toString(16).padStart(4, '0')}`).join('')}"`;

describe('decoded role tokens never supply winner evidence', () => {
  it.each([
    '"[agent]"',
    '{"text":"[agent]"}',
    String.raw`"\u005bagent\u005d"`,
    String.raw`{"text":"\u005bagent\u005d"}`,
    String.raw`{"text":"\u005bagent\u005d⏎"}`,
    String.raw`{"text":"\u005bagent\u005d","text":"\u005buser\u005d"}`,
    String.raw`{"text":["\u005bagent","\u005d"]}`,
  ])('rejects the reviewer role-only JSON candidate %s', (candidate) => {
    expect(candidateContainsQuote(candidate, 'gent')).toBe(false);
    const result = parse(candidate, 'gent');
    expect(result.unparsed).toBe(true);
    expect(result.answer.outcome).toBe('inconclusive');
  });

  it('rejects every substring drawn only from a role token, raw or JSON encoded', () => {
    const roles = [
      '[agent]',
      '[user]',
      '[assistant]',
      '[system]',
      '[context]',
      '[card]',
      '[tool]',
      '[tool_call submit_order]',
      '[tool_result catalog.lookup 42]',
      '[ａｇｅｎｔ]',
      '[𝚊𝚐𝚎𝚗𝚝]',
      '[agent⏎ lookup]',
    ];
    let checked = 0;
    for (const role of roles) {
      const escapedBrackets = JSON.stringify(role)
        .replace('[', String.raw`\u005b`)
        .replace(']', String.raw`\u005d`);
      for (const encoded of [undefined, JSON.stringify(role), escapedBrackets, unicodeJson(role)]) {
        const encodedBody = encoded === undefined ? role : encoded.slice(1, -1);
        const candidates =
          encoded === undefined
            ? [role, `${role} 漢`]
            : [
                encoded,
                `{"text":${encoded}}`,
                `{"text":[${encoded}]}`,
                `{"text":${encoded.slice(0, -1)} 漢"}`,
              ];
        for (let from = 0; from < encodedBody.length; from += 1) {
          for (let to = from + 1; to <= encodedBody.length; to += 1) {
            const quote = encodedBody.slice(from, to);
            if (!/[\p{L}\p{N}]/u.test(quote)) continue;
            for (const candidate of candidates) {
              expect(candidateContainsQuote(candidate, quote), JSON.stringify({ candidate, quote })).toBe(
                false,
              );
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(30_000);
  }, 200_000);

  it('retains literal encoded passages whose decoded content has real text', () => {
    const candidate = JSON.stringify({
      text: '[agent]\n```python\nfrom operator import itemgetter\nprint(42)\n```',
    })
      .replace('[', String.raw`\u005b`)
      .replace(']', String.raw`\u005d`);
    expect(candidateContainsQuote(candidate, String.raw`from operator import itemgetter\nprint(42)`)).toBe(
      true,
    );
    expect(candidateContainsQuote(candidate, 'from operator import itemgetter')).toBe(true);
    expect(candidateContainsQuote(String.raw`"\u005bagent\u005d\u002e"`, 'u002e')).toBe(false);
    expect(candidateContainsQuote(String.raw`"\u005bagent\u005d"`, 'u005b')).toBe(false);
    expect(candidateContainsQuote('{"answer":"Hello World."}', 'hello world.')).toBe(true);
    expect(candidateContainsQuote('{"answer":42}', '４２')).toBe(true);
    expect(candidateContainsQuote('{"required_key":null}', 'required_key')).toBe(true);
    expect(candidateContainsQuote('{"text":"[agent]"}', 'text')).toBe(false);
    expect(candidateContainsQuote('{"text":"[agent] Agent has real text."}', 'gent')).toBe(true);
  });
});
