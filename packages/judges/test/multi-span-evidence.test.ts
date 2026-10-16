import { describe, expect, it } from 'vitest';
import { parseJudgeText, responseSchema } from '../src/assessment';
import type { JudgeRequest } from '../src/contract';
import { buildPrompt } from '../src/prompt';
import recorded from './fixtures/multi-span-threshold.json';

const request: JudgeRequest = {
  criterion: { name: 'c', rubric: 'The reply follows the supplied facts.' },
  transcript: [
    { role: 'context', text: 'Usage is 32 GB.' },
    { role: 'agent', text: 'I approve the discount.' },
    { role: 'agent', text: 'Usage is 32 GB.' },
  ],
  artifact: 'Invoice total is 42 USD.',
  given: { stage: 'offer', ledger: { price: 42 } },
  inputs: [{ path: 'facts.txt', text: 'Limit is 50 GB.' }],
  reference: 'The threshold is strictly above 32 GB.',
};
const parse = (evidence: unknown, met: boolean | null = true, r: JudgeRequest = request) =>
  parseJudgeText(
    JSON.stringify({ checks: [{ id: r.criterion.name, reasoning: 'check', evidence, met }] }),
    r,
  );

describe('criterion evidence spans are grounded in their named sources', () => {
  it('preserves the real unmet threshold judgment with separate spans, without guessing a pipe split', () => {
    const r = recorded.request as JudgeRequest;
    expect(parseJudgeText(recorded.raw_ledger_response, { ...r, criterionDecoderVersion: 1 }).unparsed).toBe(
      true,
    );
    expect(parseJudgeText(recorded.raw_ledger_response, r)).toMatchObject({
      answer: { outcome: 'fail' },
      evidenceUnverified: 1,
      checks: [{ met: false, evidence: null, grounded: false }],
    });
    // Schema-only transcription of a real response, not a new model recording.
    const ledger = JSON.parse(recorded.raw_ledger_response);
    ledger.checks[0].evidence = [
      { source: 'transcript.0', quote: 'Usage=32 GB. Discount threshold is strictly > 32 GB.' },
      { source: 'transcript.1', quote: 'Your usage meets the threshold, so I approve the discount.' },
    ];
    const result = parseJudgeText(JSON.stringify(ledger), r);
    expect(result.unparsed).toBeUndefined();
    expect(result.answer.outcome).toBe('fail');
    expect(result.checks?.[0]?.evidence).toEqual(ledger.checks[0].evidence);
    expect(result.answer.evidence).toBe(ledger.checks[0].evidence[0].quote);
  });

  it('accepts several sources and keeps the public evidence field a string', () => {
    const evidence = [
      { source: 'transcript.0', quote: 'Usage is 32 GB.' },
      { source: 'transcript.1', quote: 'I approve the discount.' },
      { source: 'artifact', quote: 'Invoice total is 42 USD.' },
      { source: 'given', quote: 'offer' },
      { source: 'input.facts.txt', quote: 'Limit is 50 GB.' },
      { source: 'reference', quote: 'The threshold is strictly above 32 GB.' },
    ];
    const result = parse(evidence);
    expect(result.unparsed).toBeUndefined();
    expect(result.answer.outcome).toBe('pass');
    expect(result.answer.evidence).toBe(evidence[0]?.quote);
    expect(result.checks?.[0]?.evidence).toEqual(evidence);
  });

  it('grounds a named later entry even when an earlier entry has the same text', () => {
    expect(parse([{ source: 'transcript.2', quote: 'Usage is 32 GB.' }]).unparsed).toBeUndefined();
    expect(parse([{ source: 'transcript.2', quote: '[agent] Usage is 32 GB.' }]).unparsed).toBeUndefined();
    expect(parse([{ source: 'transcript.2', quote: '[context] Usage is 32 GB.' }]).unparsed).toBe(true);
  });

  it.each([
    { source: 'transcript.0', quote: 'I approve the discount.' },
    { source: 'transcript.1', quote: 'Usage is 32 GB.' },
    { source: 'transcript.99', quote: 'Usage is 32 GB.' },
    { source: 'transcript.00', quote: 'Usage is 32 GB.' },
    { source: 'transcript.-1', quote: 'Usage is 32 GB.' },
    { source: 'input.missing.txt', quote: 'Limit is 50 GB.' },
    { source: 'artifact', quote: 'Invoice total is 4 USD.' },
    { source: 'reference', quote: 'The threshold is at least 32 GB.' },
    { source: 'transcript.0', quote: 'Usage is 32 GB. | I approve the discount.' },
    { source: 'transcript.0', quote: 'Usage is 32 GB. ... I approve the discount.' },
    { source: 'transcript.0', quote: 'context' },
  ])('rejects a span in the wrong or missing source: $source / $quote', (bad) => {
    const result = parse([{ source: 'transcript.1', quote: 'I approve the discount.' }, bad]);
    expect(result.unparsed).toBe(true);
    expect(result.answer.outcome).toBe('inconclusive');
  });

  it('keeps missing evidence, exact requirement coverage and old string evidence behavior', () => {
    expect(parse([]).unparsed).toBe(true);
    expect(parse([{ source: 'transcript.0', quote: ' ' }]).unparsed).toBe(true);
    expect(parse([{ source: 'transcript.0', quote: 'Usage is 32 GB.', extra: true }]).unparsed).toBe(true);
    expect(parse(null).unparsed).toBe(true);
    expect(parse(null, false).answer.outcome).toBe('fail');
    expect(parse(null, null).answer.outcome).toBe('inconclusive');
    expect(parse('Usage is 32 GB.').answer.outcome).toBe('pass');
    expect(
      parse([{ source: 'transcript.0', quote: 'Usage is 32 GB.' }], true, {
        ...request,
        requirements: [
          { id: 'c', requirement: 'first' },
          { id: 'missing', requirement: 'second' },
        ],
      }).unparsed,
    ).toBe(true);
  });

  it('rejects repeated decoded keys within a span before JSON parsing', () => {
    for (const span of [
      String.raw`{"source":"transcript.0","\u0073ource":"transcript.1","quote":"I approve the discount."}`,
      String.raw`{"source":"transcript.0","quote":"invented","\u0071uote":"Usage is 32 GB."}`,
    ]) {
      const result = parseJudgeText(
        `{"checks":[{"id":"c","reasoning":"r","evidence":[${span}],"met":true}]}`,
        request,
      );
      expect(result.unparsed).toBe(true);
      expect(result.answer.reasoning).toContain('repeated key');
    }
  });

  it('advertises source-bound span lists in the new prompt and schema only', () => {
    const prompt = buildPrompt(request);
    expect(prompt.system).toContain('"source":"transcript.0"');
    expect(prompt.system).toContain('Keep separate quotations in separate spans');
    expect(prompt.system).toContain('input.<file path>');
    expect(JSON.stringify(responseSchema(request))).toContain('"quote"');
    expect(buildPrompt({ ...request, answerContract: 'legacy' }).system).not.toContain('"checks"');
  });
});
