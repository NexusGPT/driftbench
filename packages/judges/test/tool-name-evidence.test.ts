import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeRequest } from '../src/contract';
import { groundEvidenceSpan } from '../src/evidence';

// A tool entry carries its tool name in the frame (`tool`), not in its text. A judge that cites the tool
// call as evidence quotes that name, or the `"tool": "<name>"` spelling the frame shows. The name is supplied
// data of that entry, so the quote grounds there and nowhere else; a name the frame does not hold never grounds.
const request: JudgeRequest = {
  criterion: {
    name: 'explicit_confirmation',
    rubric: 'Place exactly one order only after the user types CONFIRM.',
  },
  transcript: [
    { role: 'user', text: 'CONFIRM' },
    { role: 'tool_call', tool: 'order.create', text: '{"plan":"Air"}' },
    { role: 'agent', text: 'Placed once.' },
  ],
};
const ledger = (evidence: unknown, criterionDecoderVersion?: 1 | 2 | 3) =>
  parseJudgeText(
    JSON.stringify({
      checks: [{ id: 'explicit_confirmation', reasoning: 'one order after CONFIRM', evidence, met: true }],
    }),
    { ...request, criterionDecoderVersion },
  );

describe('a quote of a tool entry name grounds in that entry', () => {
  it('accepts the bare name and the frame spelling, with or without a space', () => {
    for (const quote of [
      'order.create',
      '"tool":"order.create"',
      '"tool": "order.create"',
      'tool: order.create',
    ])
      expect(groundEvidenceSpan(request, { source: 'transcript.1', quote }, { toolNames: true })).toEqual({
        grounded: true,
        where: 'transcript.1',
      });
  });
  it('scores the ledger instead of voiding it', () => {
    const result = ledger([
      { source: 'transcript.0', quote: 'CONFIRM' },
      { source: 'transcript.1', quote: '"tool":"order.create"' },
      { source: 'transcript.2', quote: 'Placed once.' },
    ]);
    expect(result.unparsed).toBeUndefined();
    expect(result.answer.outcome).toBe('pass');
  });
  it('never grounds a tool name in another entry, nor a name the frame does not hold', () => {
    expect(groundEvidenceSpan(request, { source: 'transcript.2', quote: 'order.create' }).grounded).toBe(
      false,
    );
    expect(groundEvidenceSpan(request, { source: 'transcript.1', quote: 'order.cancel' }).grounded).toBe(
      false,
    );
    expect(
      groundEvidenceSpan(request, { source: 'transcript.1', quote: '"tool":"order.cancel"' }).grounded,
    ).toBe(false);
    expect(ledger([{ source: 'transcript.1', quote: '"tool":"order.cancel"' }]).unparsed).toBe(true);
  });
});

describe('decoder 3 tool metadata boundary', () => {
  it.each([1, 2] as const)('preserves decoder %i serialized output', (decoder) => {
    const evidence = [{ source: 'transcript.1', quote: '"tool":"order.create"' }];
    const raw = JSON.stringify({
      checks: [{ id: 'explicit_confirmation', reasoning: 'one order after CONFIRM', evidence, met: true }],
    });
    expect(JSON.stringify(ledger(evidence, decoder))).toBe(
      JSON.stringify({
        raw,
        unparsed: true,
        answer: {
          outcome: 'inconclusive',
          reasoning: 'invalid criterion ledger: the evidence quote is not in the supplied data',
        },
      }),
    );
  });
  it('requires the grounding option outside decoder 3', () => {
    const span = { source: 'transcript.1', quote: 'order.create' };
    expect(groundEvidenceSpan(request, span).grounded).toBe(false);
    expect(groundEvidenceSpan(request, span, { toolNames: false }).grounded).toBe(false);
    expect(ledger([span], 3).answer.outcome).toBe('pass');
    expect(ledger([span]).answer.outcome).toBe('pass');
  });
  it.each(['tool_call', 'tool_result'] as const)('grounds the source-local %s name', (role) => {
    const local = { ...request, transcript: [{ role, tool: 'order.create', text: '{}' }] };
    for (const quote of [
      'order.create',
      '"order.create"',
      "'tool' : 'order.create'",
      '  TOOL  :  ORDER.CREATE  ',
      '“tool”: “order.create”',
    ])
      expect(groundEvidenceSpan(local, { source: 'transcript.0', quote }, { toolNames: true })).toEqual({
        grounded: true,
        where: 'transcript.0',
      });
  });
  it.each(['user', 'agent', 'card', 'context'] as const)(
    'does not treat a %s tool field as a tool event',
    (role) => {
      const local = { ...request, transcript: [{ role, tool: 'order.create', text: 'Nothing happened.' }] };
      expect(
        groundEvidenceSpan(local, { source: 'transcript.0', quote: 'order.create' }, { toolNames: true })
          .grounded,
      ).toBe(false);
    },
  );
  it.each([
    'transcript.0',
    'transcript.2',
    'transcript.3',
    'transcript.01',
    'transcript.-1',
    'tool',
    'given',
    'artifact',
    'input.order.create',
  ])('never borrows the name into %s', (source) => {
    expect(groundEvidenceSpan(request, { source, quote: 'order.create' }, { toolNames: true }).grounded).toBe(
      false,
    );
  });
  it.each([
    'order.cancel',
    'order',
    'create',
    'tool: order.cancel',
    'tool: order.create succeeded',
    '[tool_call order.create]',
    '"role":"tool_call"',
    '"text":"order.create"',
  ])('rejects invented or other frame content: %s', (quote) => {
    expect(groundEvidenceSpan(request, { source: 'transcript.1', quote }, { toolNames: true }).grounded).toBe(
      false,
    );
    expect(ledger([{ source: 'transcript.1', quote }], 3).unparsed).toBe(true);
  });
  it('does not extract a tool name from role metadata in the body', () => {
    const local = { ...request, transcript: [{ role: 'agent' as const, text: '[tool_call order.create]' }] };
    expect(
      groundEvidenceSpan(local, { source: 'transcript.0', quote: 'order.create' }, { toolNames: true })
        .grounded,
    ).toBe(false);
  });
  it('still requires every remaining quote to ground in its named source', () => {
    expect(
      ledger(
        [
          { source: 'transcript.1', quote: 'order.create' },
          { source: 'transcript.2', quote: 'CONFIRM' },
        ],
        3,
      ).unparsed,
    ).toBe(true);
  });
});

describe('tool identifier punctuation remains data', () => {
  it.each([
    'ord"er.create',
    "tool: order.cr'eate",
    '"tool": "ord"er.create"',
    '"order.create',
    "order.create'",
  ])('does not delete identifier characters from %s', (quote) => {
    expect(groundEvidenceSpan(request, { source: 'transcript.1', quote }, { toolNames: true }).grounded).toBe(
      false,
    );
    expect(ledger([{ source: 'transcript.1', quote }], 3).unparsed).toBe(true);
  });
  it.each([
    ["order.o'reilly", "order.o'reilly"],
    ["order.o'reilly", '"order.o\'reilly"'],
    ["order.o'reilly", '"tool": "order.o\'reilly"'],
    ['ord"er.create', 'ord"er.create'],
    ['ord"er.create', "'tool': 'ord\"er.create'"],
    ['order: create', 'order: create'],
    ['order: create', 'tool : "order: create"'],
  ])('preserves supplied identifier %s in %s', (tool, quote) => {
    const local: JudgeRequest = { ...request, transcript: [{ role: 'tool_call', tool, text: '{}' }] };
    expect(groundEvidenceSpan(local, { source: 'transcript.0', quote }, { toolNames: true })).toEqual({
      grounded: true,
      where: 'transcript.0',
    });
  });
});
