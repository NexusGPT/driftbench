import { describe, expect, it } from 'vitest';
import { candidateContainsQuote, groundEvidence } from '../src/evidence';
import { type JudgeRequest, parseJudgeText, renderEntry } from '../src/index';
import fixtures from './fixtures/literal-winner-quotes';

const code = '```python\nfrom operator import itemgetter\nprint(itemgetter(0)([42]))\n```';
const opening = '```python\nfrom operator import itemgetter';
const request = (A: string, B: string): JudgeRequest => ({
  criterion: { name: 'c', rubric: 'r' },
  transcript: [],
  assessment: { kind: 'pairwise' },
  candidates: { A, B },
});
const answer = (r: JudgeRequest, quote: string) =>
  parseJudgeText(JSON.stringify({ winner: 'A', winnerQuote: quote, reasoning: 'r' }), r);

describe('literal winner passages survive presentation normalization', () => {
  it('accepts the opening of a closed Python fence without a re-ask', () => {
    expect(candidateContainsQuote(code, opening)).toBe(true);
    const parsed = answer(request(code, 'A different reply.'), opening);
    expect(parsed.unparsed).toBeUndefined();
    expect(parsed.winner).toBe('A');
  });
  for (const fixture of fixtures) {
    it(`preserves the real literal RubricBench passage ${fixture.caseId}`, () => {
      expect(fixture.candidate.includes(fixture.quote)).toBe(true);
      expect(candidateContainsQuote(fixture.candidate, fixture.quote)).toBe(true);
    });
  }
  it('preserves every substantive raw substring of length at least eight in the property corpus', () => {
    const corpus = [
      code,
      '### Result\n**The result is 42.**\n- One item\nSecond item',
      'const snake_case = `value`; // café 日本語 answer 42',
    ];
    let originalChecked = 0;
    for (const candidate of corpus) {
      for (let from = 0; from < candidate.length; from += 1) {
        for (let to = from + 8; to <= candidate.length; to += 1) {
          if (/[\p{L}\p{N}]/u.test(candidate.slice(from, to))) originalChecked += 1;
        }
      }
    }
    expect(originalChecked).toBe(4_224);
    // Reproducible generated Unicode, digits, whitespace and unmatched markup.
    let seed = 7194;
    const alphabet = 'abcXYZ012_日本語αβ\n`*_[]# ';
    for (let sample = 0; sample < 20; sample += 1) {
      let generated = '';
      for (let i = 0; i < 48; i += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        generated += alphabet[seed % alphabet.length];
      }
      corpus.push(generated);
    }
    let checked = 0;
    for (const candidate of corpus) {
      for (let from = 0; from < candidate.length; from += 1) {
        for (let to = from + 8; to <= candidate.length; to += 1) {
          const quote = candidate.slice(from, to);
          if (!/[\p{L}\p{N}]/u.test(quote)) continue;
          expect(candidateContainsQuote(candidate, quote), JSON.stringify({ quote, candidate })).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(21_444);
  });
  it('adds normalized matches while retaining unique identity across raw and decoded views', () => {
    expect(candidateContainsQuote('## Result\nThe answer is **42**.', 'Result The answer is 42.')).toBe(true);
    for (const other of [code, JSON.stringify({ text: code })]) {
      const parsed = answer(request(code, other), opening);
      expect(parsed.unparsed).toBe(true);
      expect(parsed.answer.outcome).toBe('inconclusive');
    }
    expect(answer(request(code, code), `Reply A: ${opening}`).unparsed).toBe(true);
    expect(answer(request(code, 'A different reply.'), `Reply B: ${opening}`).unparsed).toBe(true);
    expect(answer(request(code, 'A different reply.'), 'Import the item getter function').unparsed).toBe(
      true,
    );
  });
  it('requires letters or digits from the quoted body itself, excluding role and list metadata', () => {
    for (const body of [
      '[agent]',
      '[agent] [user]',
      '[ａｇｅｎｔ]',
      '[tool_result lookup]',
      '1. ',
      '... ⏎ ...',
      '""',
      "''",
    ]) {
      expect(candidateContainsQuote(body, body)).toBe(false);
    }
    expect(candidateContainsQuote('[agent] Substantive reply.', 'agent')).toBe(false);
    expect(candidateContainsQuote('[ａｇｅｎｔ] Substantive reply.', 'ａｇｅｎｔ')).toBe(false);
    expect(candidateContainsQuote('🐍 A\u030A [ａｇｅｎｔ] Useful text.', 'ａｇｅｎｔ')).toBe(false);
    expect(candidateContainsQuote('[𝚊𝚐𝚎𝚗𝚝] Useful text.', '𝚊𝚐𝚎𝚗𝚝')).toBe(false);
    expect(candidateContainsQuote('1. Actual content.', '1')).toBe(false);
    expect(candidateContainsQuote('[agent] Substantive reply.', 'Substantive reply.')).toBe(true);
  });

  it('retains all 1,422 reviewer decoration rejections in both grounding paths', () => {
    const bodies = [
      '',
      ' ',
      '\t',
      '\n',
      '\r\n',
      '\n\n',
      '...',
      '…',
      '""',
      "''",
      '“”',
      '‘’',
      '"..."',
      "'...'",
      '⏎',
      ' ⏎ ',
      '⏎ ⏎',
      '"⏎"',
      "'⏎'",
      '\n""\n...',
      ' ... ⏎ "" ',
      '... ...',
      '[agent]',
      '[user]',
      '[context]',
      '[tool_result catalog.lookup]',
      '[agent] ⏎',
      '[agent] ...',
    ];
    let count = 0;
    for (const role of ['agent', 'user', 'context', 'tool_result'] as const) {
      const tool = role === 'tool_result' ? 'catalog.lookup' : undefined;
      for (const text of bodies) {
        const entry = { role, text, ...(tool ? { tool } : {}) };
        const label = `[${role}${tool ? ` ${tool}` : ''}]`;
        const displayed = renderEntry(entry);
        const quotes = new Set([
          label,
          `${label} `,
          `${label} ...`,
          `${label} ⏎`,
          `${label} ⏎ ⏎`,
          `${label} ""`,
          `${label} ''`,
          displayed,
          text,
          `"${displayed}"`,
          `“${displayed}”`,
          `${label} ... ⏎ ...`,
          `${label} "..."`,
        ]);
        for (const evidence of quotes) {
          count += 1;
          expect(candidateContainsQuote(text, evidence)).toBe(false);
          const r: JudgeRequest = {
            criterion: { name: 'c', rubric: 'State the price.' },
            transcript: [entry],
            criterionDecoderVersion: 1,
          };
          expect(groundEvidence(r, { outcome: 'pass', reasoning: 'r', evidence }).grounded).toBe(false);
          expect(
            parseJudgeText(JSON.stringify({ checks: [{ id: 'c', reasoning: 'r', evidence, met: true }] }), r)
              .unparsed,
          ).toBe(true);
        }
      }
    }
    expect(count).toBe(1_422);
  });
});
