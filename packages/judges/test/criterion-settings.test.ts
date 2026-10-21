import { type CheckContext, CriterionDef, type Observed, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  criteriaJudge,
  FakeJudge,
  fixtureRequest,
  type JudgeRequest,
  type LoadedCriterion,
  labelRequest,
  parseCriterionFile,
  requestFor,
  responseSchema,
  singleJudgeCheck,
} from '../src/index';

/**
 * The judge settings a criterion carries (rows 9 to 13 of the CLI gap list) reach the request a judge reads,
 * from a spec and from a criteria file, and a criterion without them sends the same request as before.
 */

const OBSERVED: Observed = {
  segments: [{ type: 'text', text: 'Your parcel ships on Thursday.' }],
  text: 'Your parcel ships on Thursday.',
  toolCalls: [],
  cost: {},
  latencyMs: 1,
};

function context(criterion: Record<string, unknown>): CheckContext {
  const def = CriterionDef.parse({ name: 'ships', rubric: 'Does the reply give a ship day?', ...criterion });
  const spec = {
    id: 'settings',
    kind: 'conversation',
    criteria: [def],
    blocks: [{ when: { user: 'When does my parcel ship?' } }],
  } as Spec;
  const block = { when: { user: 'When does my parcel ship?' }, expect: { criteria: ['ships'] } };
  return {
    spec,
    mode: 'F',
    blockIndex: 0,
    block,
    expect: block.expect,
    given: {
      prefix: [
        { role: 'user', content: 'Hello.' },
        { role: 'assistant', content: 'Hello, how can I help?' },
      ],
      ledger: { order: 'A-1' },
      world: {},
      vars: {},
      target: { adapter: 'claude-code' },
      hash: 'h',
    },
    observed: OBSERVED,
    history: [],
    ledger: { order: 'A-1' },
  };
}

/** The request one criterion sends through the single judge of a run. */
async function sent(criterion: Record<string, unknown>, answers = ['{"outcome":"pass","reasoning":"ok"}']) {
  const fake = new FakeJudge('stand-in', answers, { cls: 'system2' });
  const verdicts = await singleJudgeCheck(fake).evaluate(context(criterion));
  return { fake, request: fake.requests[0] as JudgeRequest, verdict: verdicts[0] };
}

it('preserves an explicit metric intent from the spec without inferring it from rubric text', async () => {
  expect((await sent({ intent: 'request-fulfillment' })).request.criterion.intent).toBe(
    'request-fulfillment',
  );
  expect((await sent({})).request.criterion).not.toHaveProperty('intent');
  expect(() => CriterionDef.parse({ name: 'x', rubric: 'Quality.', intent: 'writing' })).toThrow();
});

const FILE = (criterion: string) =>
  [
    'criterion:',
    '  name: ships',
    '  rubric: Does the reply give a ship day?',
    // Conformance reads the rubric alone: its file carries no pictures.
    criterion.includes('conformance') ? '' : '  pass: It names a day.',
    criterion.includes('conformance') ? '' : '  fail: It names no day.',
    criterion,
    'fixtures:',
    '  pass:',
    '    transcript:',
    '      - { role: user, text: When does it ship? }',
    '      - { role: agent, text: Thursday. }',
    '    given: { stage: shipping }',
    '  fail:',
    '    transcript:',
    '      - { role: user, text: When does it ship? }',
    '      - { role: agent, text: Soon. }',
  ]
    .filter((line) => line !== '')
    .join('\n');

function loaded(criterion: string): LoadedCriterion {
  const result = parseCriterionFile(FILE(criterion), 'ships.yaml');
  if ('issues' in result) throw new Error(JSON.stringify(result.issues));
  return result;
}

describe('criterion judge settings', () => {
  it('keeps the request of a criterion without settings byte for byte', async () => {
    const { request } = await sent({ pass: 'A day.', fail: 'No day.' });
    expect(JSON.stringify(request)).toBe(
      JSON.stringify({
        criterion: {
          name: 'ships',
          rubric: 'Does the reply give a ship day?',
          pass: 'A day.',
          fail: 'No day.',
          scope: 'block',
        },
        transcript: [
          { role: 'user', text: 'Hello.' },
          { role: 'agent', text: 'Hello, how can I help?' },
          { role: 'user', text: 'When does my parcel ship?' },
          { role: 'agent', text: 'Your parcel ships on Thursday.' },
        ],
        given: { ledger: { order: 'A-1' } },
      }),
    );
    const file = loaded('');
    expect(JSON.stringify(fixtureRequest(file, 'pass'))).toBe(
      JSON.stringify({
        criterion: {
          name: 'ships',
          rubric: 'Does the reply give a ship day?',
          pass: 'It names a day.',
          fail: 'It names no day.',
          scope: 'block',
        },
        transcript: [
          { role: 'user', text: 'When does it ship?' },
          { role: 'agent', text: 'Thursday.' },
        ],
        given: { stage: 'shipping' },
      }),
    );
    const plain = { ...context({}), spec: context({}).spec };
    const def = plain.spec.criteria?.[0] as CriterionDef;
    expect(Object.keys(requestFor(plain, def, undefined))).toEqual(['criterion', 'transcript', 'given']);
  });

  it('row 9: prompt_version, decoder_version and answer_contract reach the request', async () => {
    const { request } = await sent({ prompt_version: 2, decoder_version: 2 });
    expect(request.criterionPromptVersion).toBe(2);
    expect(request.criterionDecoderVersion).toBe(2);
    expect(request.answerContract).toBeUndefined();
    const legacy = await sent({ answer_contract: 'legacy' });
    expect(legacy.request.answerContract).toBe('legacy');
    const file = loaded('  prompt_version: 2\n  decoder_version: 2\n  answer_contract: ledger');
    expect(fixtureRequest(file, 'fail')).toMatchObject({
      criterionPromptVersion: 2,
      criterionDecoderVersion: 2,
      answerContract: 'ledger',
    });
  });

  it('row 10: each assessment kind reaches the request with its reference, and the Given only where it is read', async () => {
    const relevance = (await sent({ assessment: 'response-relevance' })).request;
    expect(relevance.assessment).toEqual({ kind: 'response-relevance' });
    expect(relevance.given).toBeUndefined();
    const conformance = (await sent({ assessment: 'conformance', reference: 'Ships Thursday.' })).request;
    expect(conformance.assessment).toEqual({ kind: 'conformance', reference: 'Ships Thursday.' });
    expect(conformance.reference).toBeUndefined();
    expect(conformance.given).toBeUndefined();
    const audit = (await sent({ assessment: 'answer-audit', reference: 'Thursday' })).request;
    expect(audit.assessment).toEqual({ kind: 'answer-audit' });
    expect(audit.reference).toBe('Thursday');
    expect(audit.given).toBeUndefined();
    const facts = (
      await sent({ assessment: 'fact-ledger', reference: 'Ships Thursday.', grounding: 'strict' })
    ).request;
    expect(facts.assessment).toEqual({ kind: 'fact-ledger', grounding: 'strict' });
    expect(facts.reference).toBe('Ships Thursday.');
    expect(facts.given).toEqual({ ledger: { order: 'A-1' } });
    const file = loaded('  assessment: conformance\n  reference: ""');
    expect(fixtureRequest(file, 'pass')).not.toHaveProperty('given');
    expect(fixtureRequest(file, 'pass').assessment).toEqual({ kind: 'conformance', reference: '' });
  });

  it('row 11: items with threshold become a rubric, and requirements split the ledger', async () => {
    const items = [
      { name: 'day', rubric: 'Names a ship day.', hard: true },
      { name: 'tone', rubric: 'Is polite.', weight: 0.5 },
    ];
    const rubric = (await sent({ items, threshold: 0.75 })).request;
    expect(rubric.assessment).toEqual({ kind: 'rubric', items, threshold: 0.75 });
    const requirements = [
      { id: 'day', requirement: 'Names a ship day.' },
      { id: 'when', requirement: 'Answers when, not where.' },
    ];
    expect((await sent({ requirements })).request.requirements).toEqual(requirements);
    const file = loaded('  items:\n    - { name: day, rubric: Names a ship day. }\n  threshold: 1');
    const block = {
      id: 'b1',
      label: 'pass' as const,
      transcript: [{ role: 'agent' as const, text: 'Thursday.' }],
    };
    expect(labelRequest(file, block).assessment).toEqual({
      kind: 'rubric',
      items: [{ name: 'day', rubric: 'Names a ship day.' }],
      threshold: 1,
    });
  });

  it('row 13: repeat asks k times and holds only an agreeing verdict; per_turn judges each turn prefix', async () => {
    const agree = await sent({ repeat: 3 });
    expect(agree.fake.requests).toHaveLength(3);
    expect(agree.verdict?.outcome).toBe('pass');
    const split = await sent({ repeat: 2 }, [
      '{"outcome":"pass","reasoning":"ok"}',
      '{"outcome":"fail","reasoning":"no"}',
    ]);
    expect(split.verdict?.outcome).toBe('inconclusive');
    expect(split.verdict?.reasoning).toContain('repeated 2 times: pass, fail');
    const turns = await sent({ per_turn: true, scope: 'conversation' }, [
      '{"outcome":"pass","reasoning":"ok"}',
      '{"outcome":"fail","reasoning":"no"}',
    ]);
    expect(turns.fake.requests.map((r) => r.transcript.length)).toEqual([2, 4]);
    expect(turns.verdict?.outcome).toBe('fail');
    expect(turns.verdict?.reasoning).toContain('turn 1 pass, turn 2 fail');

    const fake = new FakeJudge('player', ['{"outcome":"pass","reasoning":"ok"}'], { cls: 'system2' });
    const file = loaded('  repeat: 2');
    const player = criteriaJudge(fake, [file.def]);
    await player.judge(fixtureRequest(file, 'pass'));
    expect(fake.requests).toHaveLength(2);
    expect(criteriaJudge(fake, [loaded('').def])).toBe(fake);
  });

  it('refuses settings that cannot work, with a message that names the fix', () => {
    const issues = (criterion: Record<string, unknown>) => {
      const parsed = CriterionDef.safeParse({ name: 'x', rubric: 'r', ...criterion });
      return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
    };
    expect(issues({ prompt_version: 3 })).not.toEqual([]);
    expect(issues({ assessment: 'conformance' })).toContain(
      'assessment conformance needs reference (an empty string is allowed)',
    );
    expect(issues({ assessment: 'fact-ledger' })).toContain(
      'assessment fact-ledger needs a nonempty reference',
    );
    expect(issues({ grounding: 'strict' })).toContain('grounding is for assessment fact-ledger only');
    expect(issues({ reference: 'x' })).toContain(
      'reference is read only by assessment conformance, fact-ledger or answer-audit',
    );
    expect(issues({ threshold: 0.5 })).toContain('threshold needs items');
    expect(issues({ assessment: 'conformance', reference: '', pass: 'p' })).toContain(
      'assessment conformance reads only the rubric: put the pass and fail conditions in it and drop pass and fail',
    );
    expect(issues({ assessment: 'conformance', reference: '', scope: 'block' })).toContain(
      'assessment conformance judges the whole supplied transcript: drop scope block, or use scope conversation',
    );
    expect(issues({ items: [{ name: 'a', rubric: 'r' }], assessment: 'answer-audit' })).toContain(
      'items score a rubric: they cannot be combined with assessment answer-audit',
    );
    expect(
      issues({
        items: [
          { name: 'a', rubric: 'r' },
          { name: 'a', rubric: 's' },
        ],
      }),
    ).toContain('item a appears twice: names must be unique');
    expect(issues({ assessment: 'answer-audit', answer_contract: 'legacy' })).toContain(
      'the legacy answer contract reads no assessment or items: drop one',
    );
    expect(issues({ repeat: 2, per_turn: true })).toContain(
      'repeat and per_turn cannot be combined: choose one',
    );
    expect(issues({ repeat: 0 })).not.toEqual([]);
  });
});

/** Every new field, as a spec and as a criteria file would set it. */
const RENDERED: [string, Record<string, unknown>, string][] = [
  ['prompt_version 2', { prompt_version: 2 }, '  prompt_version: 2'],
  ['decoder_version 2', { decoder_version: 2 }, '  decoder_version: 2'],
  ['answer_contract legacy', { answer_contract: 'legacy' }, '  answer_contract: legacy'],
  ['answer_contract ledger', { answer_contract: 'ledger' }, '  answer_contract: ledger'],
  ['response-relevance', { assessment: 'response-relevance' }, '  assessment: response-relevance'],
  [
    'conformance',
    { assessment: 'conformance', reference: 'Ships Thursday.' },
    '  assessment: conformance\n  reference: Ships Thursday.',
  ],
  [
    'conformance, empty reference',
    { assessment: 'conformance', reference: '' },
    '  assessment: conformance\n  reference: ""',
  ],
  ['answer-audit', { assessment: 'answer-audit' }, '  assessment: answer-audit'],
  [
    'answer-audit with reference',
    { assessment: 'answer-audit', reference: 'Thursday' },
    '  assessment: answer-audit\n  reference: Thursday',
  ],
  [
    'fact-ledger strict',
    { assessment: 'fact-ledger', reference: 'Ships Thursday.', grounding: 'strict' },
    '  assessment: fact-ledger\n  reference: Ships Thursday.\n  grounding: strict',
  ],
  [
    'requirements',
    { requirements: [{ id: 'day', requirement: 'Names a ship day.' }] },
    '  requirements:\n    - { id: day, requirement: Names a ship day. }',
  ],
  [
    'items and threshold',
    { items: [{ name: 'day', rubric: 'Names a ship day.', weight: 2, hard: true }], threshold: 0.5 },
    '  items:\n    - { name: day, rubric: Names a ship day., weight: 2, hard: true }\n  threshold: 0.5',
  ],
  ['repeat', { repeat: 2 }, '  repeat: 2'],
  ['per_turn', { per_turn: true }, '  per_turn: true'],
];

describe('every criterion setting renders', () => {
  it.each(RENDERED)(
    '%s: a run request, a fixture request and a label request are accepted by buildPrompt',
    async (_, spec, file) => {
      const pictures = file.includes('conformance') ? {} : { pass: 'A day.', fail: 'No day.' };
      const { request } = await sent({ ...spec, ...pictures });
      expect(() => buildPrompt(request)).not.toThrow();
      expect(() => responseSchema(request)).not.toThrow();
      const conversation = (await sent({ ...spec, ...pictures, scope: 'conversation' })).request;
      expect(() => buildPrompt(conversation)).not.toThrow();
      // A task block that produced a file: the artifact rides along.
      const ctx = context({ ...spec, ...pictures });
      const withFile = requestFor(ctx, ctx.spec.criteria?.[0] as CriterionDef, 'invoice.ts: total = 12 * 3');
      expect(() => buildPrompt(withFile)).not.toThrow();
      expect(() => responseSchema(withFile)).not.toThrow();
      expect(JSON.stringify(withFile)).toContain('total = 12 * 3');
      const criterion = loaded(file);
      for (const which of ['pass', 'fail'] as const) {
        expect(() => buildPrompt(fixtureRequest(criterion, which))).not.toThrow();
        expect(() => responseSchema(fixtureRequest(criterion, which))).not.toThrow();
      }
      const block = {
        id: 'b',
        label: 'pass' as const,
        transcript: [
          { role: 'user' as const, text: 'When does it ship?' },
          { role: 'agent' as const, text: 'Thursday.' },
        ],
      };
      expect(() => buildPrompt(labelRequest(criterion, block))).not.toThrow();
      expect(() => responseSchema(labelRequest(criterion, block))).not.toThrow();
    },
  );
});
