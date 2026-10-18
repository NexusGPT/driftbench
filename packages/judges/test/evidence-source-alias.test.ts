import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeRequest } from '../src/contract';
import { groundEvidenceSpan } from '../src/evidence';
import { buildPrompt, CRITERION_PROMPT_V1_FINGERPRINT } from '../src/prompt';

const request: JudgeRequest = {
  criterion: { name: 'c', rubric: 'The reply agrees with reference.txt.' },
  transcript: [{ role: 'agent', text: 'The fee is 54 credits monthly.' }],
  inputs: [{ path: 'reference.txt', text: 'The fee is 54 credits per month.' }],
};
const aliases = ['reference.txt', 'reference', 'given', 'artifact'];
const quote = 'The fee is 54 credits per month.';
const raw = (source: string, quote: string) =>
  JSON.stringify({
    checks: [{ id: 'c', reasoning: 'The fee agrees.', evidence: [{ source, quote }], met: true }],
  });

describe('input source aliases', () => {
  it.each(aliases)('resolves %s to the only declared input and still grounds its quote', (source) => {
    expect(groundEvidenceSpan(request, { source, quote })).toEqual({
      grounded: true,
      where: 'input.reference.txt',
    });
    const result = parseJudgeText(raw(source, quote), request);
    expect(result.unparsed).toBeUndefined();
    expect(result.answer.outcome).toBe('pass');
  });
  it.each(aliases)('rejects a quote absent from the input under %s', (source) => {
    for (const absent of ['The fee is 54 credits monthly.', 'The fee is 99 credits per month.', '']) {
      expect(groundEvidenceSpan(request, { source, quote: absent }).grounded).toBe(false);
      expect(parseJudgeText(raw(source, absent), request).unparsed).toBe(true);
    }
  });
  it.each(aliases)(
    'does not alias %s with two declared inputs, even when only one contains the quote',
    (source) => {
      for (const text of ['Other facts.', quote]) {
        const two = { ...request, inputs: [...request.inputs!, { path: 'other.txt', text }] };
        expect(groundEvidenceSpan(two, { source, quote }).grounded).toBe(false);
        expect(parseJudgeText(raw(source, quote), two).unparsed).toBe(true);
        expect(groundEvidenceSpan(two, { source: 'input.reference.txt', quote }).grounded).toBe(true);
      }
    },
  );
  it.each(aliases)('does not alias %s without a declared input', (source) => {
    expect(groundEvidenceSpan({ ...request, inputs: [] }, { source, quote }).grounded).toBe(false);
  });
  it('does not override a populated canonical source or alias unrelated names', () => {
    const occupied = {
      ...request,
      reference: 'Other reference.',
      artifact: 'Other artifact.',
      given: { stage: 'other' },
    };
    for (const source of ['reference', 'given', 'artifact'])
      expect(groundEvidenceSpan(occupied, { source, quote }).grounded).toBe(false);
    for (const source of [
      'transcript.99',
      'input.missing.txt',
      'missing.txt',
      'criterion',
      'inputs',
      'Reference',
      '../reference.txt',
    ])
      expect(groundEvidenceSpan(request, { source, quote }).grounded).toBe(false);
  });
  it('preserves canonical sources when an input path collides with their name', () => {
    const collision = {
      ...request,
      reference: 'Other reference.',
      inputs: [{ path: 'reference', text: quote }],
    };
    expect(groundEvidenceSpan(collision, { source: 'reference', quote }).grounded).toBe(false);
    expect(groundEvidenceSpan(collision, { source: 'input.reference', quote }).grounded).toBe(true);
  });
  it('uses the complete declared path, with no basename or fuzzy matching', () => {
    const nested = { ...request, inputs: [{ path: 'docs/reference.txt', text: quote }] };
    expect(groundEvidenceSpan(nested, { source: 'reference.txt', quote }).grounded).toBe(false);
    expect(groundEvidenceSpan(nested, { source: 'docs/reference.txt', quote })).toEqual({
      grounded: true,
      where: 'input.docs/reference.txt',
    });
  });
  it('keeps the version 1 fingerprint unchanged', () => {
    expect(CRITERION_PROMPT_V1_FINGERPRINT).toBe('398673b792c1');
    expect(buildPrompt(request).system).toContain('input.<file path>');
  });
});
