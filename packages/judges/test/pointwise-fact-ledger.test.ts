import { readFileSync } from 'node:fs';
import {
  buildPrompt,
  type JudgeRequest,
  parseJudgeText,
  parseJudgeValue,
  requestKey,
  responseSchema,
} from '@agent-nexus/driftbench-judges';
import { describe, expect, it } from 'vitest';

const reference = 'Aster costs 34 crowns monthly, includes 60 GB, and excludes roaming.';
const reply = 'Aster costs 34 crowns monthly, includes 60 GB, and excludes roaming.';
const request: JudgeRequest = {
  criterion: { name: 'facts', rubric: 'Every requested fact matches the trusted reference.' },
  reference,
  transcript: [
    { role: 'user', text: 'State the price, data and roaming terms of Aster.' },
    { role: 'agent', text: reply },
  ],
  assessment: { kind: 'fact-ledger' },
};
const fact = { reference: '34 crowns monthly', reply: '34 crowns monthly', status: 'match' };
const ledger = { facts: [fact], unsupported: [] };
const strict: JudgeRequest = { ...request, assessment: { kind: 'fact-ledger', grounding: 'strict' } };

function parse(value: unknown, input = request) {
  return parseJudgeText(JSON.stringify(value), input);
}

describe('pointwise fact ledger', () => {
  it('computes fail for a nearby wrong number, without a model verdict', () => {
    const result = parse({
      facts: [{ ...fact, reply: '35 crowns monthly', status: 'wrong' }],
      unsupported: [],
    });
    expect(result.answer.outcome).toBe('fail');
    expect(result.unparsed).toBeUndefined();
    expect(result.winner).toBeUndefined();
  });

  it('fails a missing requested fact and an unsupported extra claim', () => {
    expect(
      parse({ facts: [{ ...fact, reply: '', status: 'missing' }], unsupported: [] }).answer.outcome,
    ).toBe('fail');
    expect(parse({ ...ledger, unsupported: ['Aster includes free repairs.'] }).answer.outcome).toBe('fail');
  });

  it('passes only an all-match ledger without unsupported claims', () => {
    const result = parse(ledger);
    expect(result.answer.outcome).toBe('pass');
    expect(result.factLedger).toEqual(ledger);
    expect(parseJudgeValue(ledger, request)).toEqual(result);
    expect(
      parse({ facts: [fact, { reference: '60 GB', reply: '', status: 'missing' }], unsupported: [] }).answer
        .outcome,
    ).toBe('fail');
  });

  it('retains the frozen semantic contract for shared monthly modifiers', () => {
    const input: JudgeRequest = {
      ...request,
      reference: 'Aster costs 34 crowns per month and includes 60 GB per month.',
      transcript: [{ role: 'agent', text: 'Aster: 34 crowns and 60 GB monthly.' }],
    };
    const result = parse(
      {
        facts: [
          {
            reference: 'Aster costs 34 crowns per month',
            reply: 'Aster: 34 crowns monthly',
            status: 'match',
          },
          { reference: 'Aster includes 60 GB per month', reply: '60 GB monthly', status: 'match' },
        ],
        unsupported: [],
      },
      input,
    );
    expect(result.answer.outcome).toBe('pass');
  });

  it.each([
    ['22 MiB', 'match', 'pass'],
    ['22 KiB', 'wrong', 'fail'],
  ])('preserves a recorded units verdict for %s', (text, status, outcome) => {
    const input = {
      ...request,
      reference: 'Vela transfers 22528 KiB. One MiB equals 1024 KiB.',
      transcript: [{ role: 'agent' as const, text: `Vela transfers ${text}.` }],
    };
    expect(
      parse(
        {
          facts: [{ reference: 'Vela transfers 22528 KiB.', reply: `Vela transfers ${text}.`, status }],
          unsupported: [],
        },
        input,
      ).answer.outcome,
    ).toBe(outcome);
  });

  it.each([
    {},
    { facts: [], unsupported: [] },
    { facts: [fact] },
    { ...ledger, outcome: 'pass' },
    { facts: [{ ...fact, status: 'unknown' }], unsupported: [] },
    { facts: [{ ...fact, status: true }], unsupported: [] },
    { facts: [{ ...fact, reference: '' }], unsupported: [] },
    { facts: [fact, fact], unsupported: [] },
    { facts: [fact, { ...fact, reference: '  34 CROWNS monthly  ' }], unsupported: [] },
    { ...ledger, unsupported: [''] },
    { facts: [{ ...fact, reply: null }], unsupported: [] },
  ])('refuses malformed, empty or duplicate ledgers', (value) => {
    expect(parse(value)).toMatchObject({ unparsed: true, answer: { outcome: 'inconclusive' } });
  });

  it('refuses repeated keys before JSON parsing can hide them', () => {
    expect(
      parseJudgeText(
        '{"facts":[],"facts":[{"reference":"34 crowns monthly","reply":"34 crowns monthly","status":"match"}],"unsupported":[]}',
        request,
      ).unparsed,
    ).toBe(true);
  });

  it('requires a nonempty reference before building or parsing', () => {
    for (const ref of [undefined, '', '   ']) {
      const input = { ...request, reference: ref };
      expect(() => buildPrompt(input)).toThrow(/reference/);
      expect(() => responseSchema(input)).toThrow(/reference/);
      expect(parse(ledger, input)).toMatchObject({ unparsed: true, answer: { outcome: 'inconclusive' } });
    }
  });

  it('uses the verbatim frozen prompt and JSON data, with no generic reference caveat', () => {
    const expected = readFileSync(
      new URL('../../../comparisons/langfuse/hard/audit.txt', import.meta.url),
      'utf8',
    );
    const prompt = buildPrompt(request);
    expect(prompt.system).toBe(expected);
    expect(JSON.parse(prompt.user)).toEqual({ query: request.transcript[0]?.text, reference, reply });
    expect(buildPrompt(strict)).toEqual(prompt);
  });

  it('selects the pointwise provider schema without changing the pairwise schema', () => {
    expect(responseSchema(request).required).toEqual(['facts', 'unsupported']);
    expect(JSON.stringify(responseSchema(request))).toContain('"status"');
    const pair = { ...request, candidates: { A: 'a', B: 'b' }, factAudit: { reference } };
    expect(responseSchema(pair).required).toEqual(['facts', 'unsupported_a', 'unsupported_b']);
  });

  it('keeps reference, assessment and strict grounding in distinct cassette keys', () => {
    const keys = [
      request,
      strict,
      { ...request, assessment: undefined },
      { ...request, reference: 'Other reference' },
    ].map((r) => requestKey(r));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('strict pointwise quote grounding', () => {
  it('accepts grounded rows and normalizes presentation only', () => {
    expect(parse(ledger, strict).answer.outcome).toBe('pass');
    expect(
      parse(
        {
          facts: [{ ...fact, reference: '34  crowns\nmonthly', reply: '34 crowns monthly' }],
          unsupported: [],
        },
        strict,
      ).answer.outcome,
    ).toBe('pass');
  });

  it('refuses a fabricated reference or a reply quote borrowed from the user', () => {
    expect(parse({ facts: [{ ...fact, reference: '999 crowns' }], unsupported: [] }, strict).unparsed).toBe(
      true,
    );
    expect(parse({ facts: [{ ...fact, reply: 'State the price' }], unsupported: [] }, strict).unparsed).toBe(
      true,
    );
  });

  it('refuses a nonempty missing quote or an empty match, but accepts empty missing', () => {
    expect(parse({ facts: [{ ...fact, reply: '' }], unsupported: [] }, strict).unparsed).toBe(true);
    expect(parse({ facts: [{ ...fact, status: 'missing' }], unsupported: [] }, strict).unparsed).toBe(true);
    expect(
      parse({ facts: [{ ...fact, reply: '', status: 'missing' }], unsupported: [] }, strict).answer.outcome,
    ).toBe('fail');
  });
});
