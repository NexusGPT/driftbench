import { describe, expect, it } from 'vitest';
import { type ExtractResult, extractMap, SYSTEM_PROMPT, validateProposal } from '../../src/extract';
import { FakeModelPort, ModelError } from '../../src/model';
import {
  answer,
  DATA,
  fromPrompt,
  GOOD_ANSWERS,
  PERSONAS,
  PHRASES,
  RELATIONS,
  RULES,
  SOURCES,
  STAGES,
} from './support';

const NOW = () => new Date('2026-10-11T12:00:00.000Z');

function ok(result: ExtractResult) {
  if (!result.ok) throw new Error(`expected a proposal, got ${JSON.stringify(result.errors)}`);
  return result;
}

async function run(answers: ConstructorParameters<typeof FakeModelPort>[0]) {
  const port = new FakeModelPort(answers);
  const result = ok(await extractMap({ agent: 'zed', sources: SOURCES, port, now: NOW }));
  return { port, result, proposal: result.proposal };
}

const valueIds = (
  result: { proposal: { dimensions: Array<{ id: string; values: Array<{ id: string }> }> } },
  id: string,
) => result.proposal.dimensions.find((dimension) => dimension.id === id)?.values.map((value) => value.id);

describe('extractMap without a model', () => {
  it('runs the code pre-pass only: no call, family code', async () => {
    const result = ok(await extractMap({ agent: 'zed', sources: SOURCES, now: NOW }));
    expect(result.calls).toBe(0);
    expect(result.sections).toEqual([]);
    expect(result.proposal.produced_by).toEqual({
      family: 'code',
      model: 'pre-pass',
      at: '2026-10-11T12:00:00.000Z',
    });
    expect(result.proposal.dimensions.map((dimension) => dimension.id)).toEqual([
      'behaviour',
      'flow',
      'deviation',
      'channel',
    ]);
    expect(result.proposal.constraints.map((constraint) => constraint.forbid)).toEqual([
      { behaviour: 'B-002', channel: 'email' },
    ]);
    expect(result.proposal.sources).toEqual([
      { kind: 'prompt', path: 'prompt.md' },
      { kind: 'inventory', path: 'inventory.yaml' },
    ]);
    expect(result.prepass).toEqual({ dimensions: 4, values: 7, constraints: 1, relations: 1 });
  });

  it('stops on an invalid inventory before anything else', async () => {
    const port = new FakeModelPort(GOOD_ANSWERS);
    const sources = SOURCES.map((source) =>
      source.kind === 'inventory' ? { ...source, text: 'behaviours: [{ id: bad }]\nflows: []\n' } : source,
    );
    const result = await extractMap({ agent: 'zed', sources, port });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors[0]).toMatchObject({ source: 'inventory.yaml', code: 'SCHEMA_INVALID_FORMAT' });
    expect(port.requests).toHaveLength(0);
  });

  it('needs exactly one inventory', async () => {
    const result = await extractMap({
      agent: 'zed',
      sources: SOURCES.filter((source) => source.kind === 'prompt'),
    });
    expect(result.ok).toBe(false);
  });
});

describe('extractMap with a model: the answer contract', () => {
  it('asks one call per section, in order, with the system prompt, and keeps every good entry unapproved', async () => {
    const { port, result, proposal } = await run(GOOD_ANSWERS);
    expect(port.requests.map((request) => request.user.split('\n')[0])).toEqual([
      'SECTION: stages',
      'SECTION: rules',
      'SECTION: personas',
      'SECTION: data',
      'SECTION: phrases',
      'SECTION: relations',
    ]);
    expect(port.requests.every((request) => request.system === SYSTEM_PROMPT)).toBe(true);
    expect(result.calls).toBe(6);
    expect(result.sections.map((run) => [run.section, run.status, run.accepted])).toEqual([
      ['stages', 'done', 3],
      ['rules', 'done', 1],
      ['personas', 'done', 3],
      ['data', 'done', 0],
      ['phrases', 'done', 2],
      ['relations', 'done', 2],
    ]);
    expect(result.refusals).toEqual([]);
    expect(proposal.produced_by).toEqual({
      family: 'fake',
      model: 'fake-model',
      at: '2026-10-11T12:00:00.000Z',
    });
    expect(valueIds(result, 'stage')).toEqual(['greet', 'verify', 'help']);
    expect(valueIds(result, 'rule')).toEqual(['no-investment-advice']);
    expect(proposal.constraints.at(-1)).toEqual({
      forbid: { language: 'other', channel: 'email' },
      reason: 'invented for the test',
      evidence: { source: 'prompt.md', quote: 'If the customer writes in another language' },
      produced_by: 'model',
      approved: false,
    });
    expect(proposal.phrases).toEqual([
      {
        dimension: 'flow',
        value: 'balance',
        text: 'What is my balance?',
        lang: 'en',
        evidence: { source: 'prompt.md', quote: '"What is my balance?"' },
        produced_by: 'model',
        approved: false,
      },
      {
        dimension: 'language',
        value: 'other',
        text: 'Quel est mon solde ?',
        lang: 'fr',
        produced_by: 'model',
        approved: false,
      },
    ]);
    const flags = [
      ...proposal.dimensions.map((dimension) => dimension.approved),
      ...proposal.constraints.map((constraint) => constraint.approved),
      ...proposal.phrases.map((phrase) => phrase.approved),
    ];
    expect(flags.every((flag) => flag === false)).toBe(true);
    expect(proposal.dimensions.flatMap((d) => d.values).every((value) => value.approved === undefined)).toBe(
      true,
    );
    expect(proposal.dimensions.map((d) => [d.id, d.role, d.produced_by])).toEqual([
      ['behaviour', 'axis', 'code'],
      ['flow', 'detail', 'code'],
      ['deviation', 'axis', 'code'],
      ['channel', 'axis', 'code'],
      ['stage', 'axis', 'model'],
      ['rule', 'detail', 'model'],
      ['language', 'axis', 'model'],
    ]);
    expect(proposal.constraints.map((c) => c.produced_by)).toEqual(['code', 'model']);
    expect(proposal.phrases.every((phrase) => phrase.produced_by === 'model')).toBe(true);
    expect(validateProposal(proposal).ok).toBe(true);
  });

  it('shows each later section what the earlier ones proposed', async () => {
    const { port } = await run(GOOD_ANSWERS);
    expect(port.requests[1]?.user).toContain('- stage (stage): The stage a turn ends in');
    expect(port.requests[4]?.user).toContain('    other: other');
  });

  it('retries a malformed answer once, with the reason, and uses the retry', async () => {
    const { port, result } = await run([
      '{"section": "stages", "dimensions": [',
      STAGES,
      RULES,
      PERSONAS,
      DATA,
      PHRASES,
      RELATIONS,
    ]);
    expect(port.requests).toHaveLength(7);
    expect(port.requests[1]?.user).toContain(
      'Your previous answer could not be read: the answer is not JSON',
    );
    expect(result.sections[0]).toMatchObject({ section: 'stages', status: 'done', calls: 2, accepted: 3 });
    expect(valueIds(result, 'stage')).toEqual(['greet', 'verify', 'help']);
  });

  it('reports a section whose answer is malformed twice, and runs the next sections', async () => {
    const { port, result } = await run([
      'not json at all',
      'still not json',
      RULES,
      PERSONAS,
      DATA,
      PHRASES,
      answer('relations'),
    ]);
    expect(port.requests).toHaveLength(7);
    expect(result.sections[0]).toMatchObject({
      section: 'stages',
      status: 'failed',
      calls: 2,
      accepted: 0,
      excerpt: 'still not json',
    });
    expect(result.sections[0]?.error).toMatch(/^the answer could not be read, twice: the answer is not JSON/);
    expect(result.sections.slice(1).every((run) => run.status === 'done')).toBe(true);
    expect(valueIds(result, 'stage')).toBeUndefined();
    expect(result.calls).toBe(7);
  });

  it('refuses an entry without a quote and keeps the rest of the answer', async () => {
    const stages = answer('stages', {
      dimensions: [
        {
          id: 'stage',
          title: 'Stages',
          kind: 'stage',
          values: [
            fromPrompt('greet', 'Stages, in order: greet, verify, help.'),
            { id: 'verify', title: 'Verify', source: 'prompt.md' },
            { id: 'help', title: 'Help', source: 'prompt.md', quote: '   ' },
          ],
        },
      ],
    });
    const { result } = await run([stages, RULES, PERSONAS, DATA, PHRASES]);
    expect(valueIds(result, 'stage')).toEqual(['greet']);
    expect(result.refusals).toEqual([
      {
        section: 'stages',
        entry: 'stage/verify',
        reason: 'quote: the quote is missing: every entry quotes the source that justifies it',
      },
      {
        section: 'stages',
        entry: 'stage/help',
        reason: 'the quote is missing: every entry quotes the source that justifies it',
      },
    ]);
  });

  it('refuses a quote its source does not hold, a source that is not listed, and a quote that is too long', async () => {
    const stages = answer('stages', {
      dimensions: [
        {
          id: 'stage',
          title: 'Stages',
          kind: 'stage',
          values: [
            fromPrompt('greet', 'Stages, in order: greet, verify, help, goodbye.'),
            { id: 'verify', title: 'Verify', source: 'policy.md', quote: 'Always verify the customer' },
            fromPrompt('help', `${'Never give investment advice. '.repeat(14)}`),
            fromPrompt('end', 'ok'),
          ],
        },
      ],
    });
    const { result } = await run([stages, RULES, PERSONAS, DATA, PHRASES]);
    expect(valueIds(result, 'stage')).toBeUndefined();
    expect(result.refusals.map((refusal) => [refusal.entry, refusal.reason])).toEqual([
      ['stage/greet', 'the quote is not in prompt.md: "Stages, in order: greet, verify, help, goodbye."'],
      ['stage/verify', '"policy.md" is not one of the sources'],
      ['stage/help', 'the quote is longer than 400 characters: quote the passage, not the file'],
      ['stage/end', 'the quote is too short to show where the entry comes from'],
    ]);
  });

  it('refuses a dimension of a kind the section does not own, and a broken dimension', async () => {
    const stages = answer('stages', {
      dimensions: [
        {
          id: 'language',
          title: 'Language',
          kind: 'persona',
          values: [fromPrompt('english', 'answer in English.')],
        },
        { id: 'Stage!', title: 'Bad id', kind: 'stage', values: [] },
        {
          id: 'behaviour',
          title: 'Again',
          kind: 'stage',
          values: [fromPrompt('x', 'Never give investment advice.')],
        },
      ],
    });
    const { result } = await run([stages, RULES, PERSONAS, DATA, PHRASES]);
    expect(result.refusals.map((refusal) => [refusal.entry, refusal.reason])).toEqual([
      ['dimension language', 'kind persona does not belong to the stages section (stage or behaviour)'],
      ['dimension Stage!', expect.stringMatching(/^id: expected a dimension id/)],
      ['dimension behaviour', 'behaviour already exists with the kind behaviour'],
    ]);
  });

  it('keeps a constraint on proposed values and refuses one on a value that does not exist', async () => {
    const personas = answer('personas', {
      dimensions: [
        {
          id: 'language',
          title: 'Language',
          kind: 'persona',
          values: [
            fromPrompt('english', 'answer in English.'),
            fromPrompt('other', 'writes in another language'),
          ],
        },
      ],
      constraints: [
        {
          forbid: { language: 'other', channel: 'fax' },
          reason: 'no fax',
          source: 'prompt.md',
          quote: 'writes in another language',
        },
        {
          forbid: { language: 'other' },
          reason: 'alone',
          source: 'prompt.md',
          quote: 'writes in another language',
        },
        {
          forbid: { language: 'other', channel: 'chat' },
          reason: 'kept',
          source: 'prompt.md',
          quote: 'writes in another language',
        },
        {
          forbid: { channel: 'chat', language: 'other' },
          reason: 'same again',
          source: 'prompt.md',
          quote: 'writes in another language',
        },
      ],
    });
    const { result, proposal } = await run([STAGES, RULES, personas, DATA, answer('phrases')]);
    expect(result.refusals.map((refusal) => [refusal.entry, refusal.reason])).toEqual([
      ['constraint #1 (language=other, channel=fax)', 'channel=fax is not a proposed value'],
      ['constraint #2 (language=other)', 'a constraint names values from at least two dimensions'],
    ]);
    expect(result.duplicates).toEqual([
      'personas: constraint #4 (channel=chat, language=other) is already proposed',
    ]);
    expect(proposal.constraints.at(-1)?.reason).toBe('kept');
  });

  it('keeps phrases on proposed values only, and checks a quoted phrase like any entry', async () => {
    const phrases = answer('phrases', {
      phrases: [
        { dimension: 'flow', value: 'loans', text: 'I want a loan', lang: 'en' },
        {
          dimension: 'flow',
          value: 'balance',
          text: 'Balance please',
          lang: 'en',
          source: 'prompt.md',
          quote: 'Balance please',
        },
        { dimension: 'flow', value: 'balance', text: 'Balance?', lang: 'en', source: 'prompt.md' },
        { dimension: 'flow', value: 'balance', text: 'How much do I have?', lang: 'english' },
        { dimension: 'flow', value: 'balance', text: 'How much do I have?', lang: 'en' },
      ],
      dimensions: [{ id: 'extra', title: 'Extra', kind: 'data', values: [] }],
    });
    const { result, proposal } = await run([STAGES, RULES, PERSONAS, DATA, phrases]);
    expect(result.refusals.map((refusal) => [refusal.entry, refusal.reason])).toEqual([
      ['dimension extra', 'the phrases section proposes phrases only'],
      ['phrase #1 (flow/loans)', 'flow/loans is not a proposed value'],
      ['phrase #2 (flow/balance)', 'the quote is not in prompt.md: "Balance please"'],
      ['phrase #3 (flow/balance)', 'a phrase gives both source and quote, or neither'],
      ['phrase #4', 'lang: expected a language tag such as en, nl or pt-BR'],
    ]);
    expect(proposal.phrases.map((phrase) => phrase.text)).toEqual(['How much do I have?']);
  });

  it('refuses phrases outside the phrases section', async () => {
    const rules = answer('rules', {
      phrases: [{ dimension: 'flow', value: 'balance', text: 'hi', lang: 'en' }],
    });
    const { result } = await run([STAGES, rules, PERSONAS, DATA, answer('phrases')]);
    expect(result.refusals).toEqual([
      { section: 'rules', entry: 'phrase #1', reason: 'phrases come from the phrases section' },
    ]);
  });

  it('adds values to a dimension the pre-pass made, and skips a value already there', async () => {
    const rules = answer('rules', {
      dimensions: [
        {
          id: 'deviation',
          title: 'Deviations',
          kind: 'deviation',
          values: [
            fromPrompt(
              'D5_language_switch',
              'If the customer writes in another language, answer in English.',
            ),
            fromPrompt('D1_off_topic', 'Never give investment advice.'),
          ],
        },
      ],
    });
    const { result } = await run([STAGES, rules, PERSONAS, DATA, PHRASES]);
    expect(valueIds(result, 'deviation')).toEqual(['D1_off_topic', 'D8_tool_failure', 'D5_language_switch']);
    expect(result.duplicates).toEqual(['rules: deviation/D1_off_topic is already proposed']);
    expect(result.refusals).toEqual([]);
  });

  it('reports a failed model call as a failed section and goes on', async () => {
    const down = new ModelError('http', '529 overloaded_error: Overloaded', { status: 529, retryable: true });
    const { port, result } = await run([down, RULES, PERSONAS, DATA, PHRASES, answer('relations')]);
    expect(port.requests).toHaveLength(6);
    expect(result.sections[0]).toEqual({
      section: 'stages',
      calls: 1,
      status: 'failed',
      accepted: 0,
      error: 'the model call failed (http: 529 overloaded_error: Overloaded)',
    });
    expect(result.sections[1]?.status).toBe('done');
  });

  it('keeps every proposal a valid space map: one stage dimension, unique ids per kind, no "none"', async () => {
    const stages = answer('stages', {
      dimensions: [
        {
          id: 'stage',
          title: 'Stages',
          kind: 'stage',
          values: [fromPrompt('greet', 'Stages, in order: greet, verify, help.')],
        },
        {
          id: 'phase',
          title: 'Phases',
          kind: 'stage',
          values: [fromPrompt('help', 'Stages, in order: greet, verify, help.')],
        },
      ],
    });
    const rules = answer('rules', {
      dimensions: [
        {
          id: 'deviation',
          title: 'Deviations',
          kind: 'deviation',
          values: [fromPrompt('D11_shouting', 'Never give investment advice.')],
        },
        {
          id: 'rule',
          title: 'Rules',
          kind: 'behaviour',
          values: [
            fromPrompt('B-001', 'Never give investment advice.'),
            fromPrompt('none', 'Never give investment advice.'),
          ],
        },
      ],
    });
    const { result, proposal } = await run([stages, rules, PERSONAS, DATA, PHRASES]);
    expect(result.refusals.map((refusal) => [refusal.entry, refusal.reason])).toEqual([
      ['dimension phase', 'a map holds one stage dimension: add the values to "stage"'],
      [
        'deviation/D11_shouting',
        '"D11_shouting" is not a deviation class: use D1_off_topic to D12_prompt_extraction',
      ],
      [
        'rule/B-001',
        '"B-001" is already a value of behaviour: a spec names a behaviour value without its dimension, so the id must be unique',
      ],
      ['rule/none', '"none" is reserved: code adds it where a dimension needs it'],
    ]);
    expect(validateProposal(proposal).ok).toBe(true);
  });
});

describe('extractMap: the relations section', () => {
  it('keeps every good relation unapproved with its quote, and refuses one per reason', async () => {
    const relations = answer('relations', {
      relations: [
        {
          kind: 'uses_tool',
          subject: { dimension: 'flow', value: 'balance' },
          tool: 'card.check',
          stage: 'verify',
          input: { last_four: '{card}' },
          source: 'prompt.md',
          quote: 'Always verify the customer with the last four digits of their card',
        },
        {
          kind: 'path',
          id: 'balance-lost',
          flow: 'balance',
          stages: ['greet', 'lost'],
          source: 'prompt.md',
          quote: 'Stages, in order: greet, verify, help.',
        },
        {
          kind: 'binds',
          subject: { dimension: 'language', value: 'english' },
          slots: { greeting: 'Hello' },
          source: 'prompt.md',
          quote: 'never in the prompt',
        },
        {
          kind: 'recovery',
          class: 'D5_language_switch',
          flows: ['balance'],
          stage_after: 'pending',
          source: 'prompt.md',
          quote: 'If the customer writes in another language',
        },
        { kind: 'reply_language', subject: { dimension: 'rule', value: 'no-investment-advice' }, lang: 'en' },
      ],
    });
    const { result, proposal } = await run([STAGES, RULES, PERSONAS, DATA, PHRASES, relations]);
    expect(result.sections.at(-1)).toMatchObject({ section: 'relations', status: 'done', accepted: 1 });
    expect(proposal.relations?.map((relation) => relation.kind)).toEqual(['recovery', 'uses_tool']);
    const added = proposal.relations?.[1];
    expect(added).toMatchObject({
      evidence: {
        source: 'prompt.md',
        quote: 'Always verify the customer with the last four digits of their card',
      },
      produced_by: 'model',
      approved: false,
    });
    expect(result.refusals.map((refusal) => [refusal.entry.split(' (')[0], refusal.reason])).toEqual([
      ['relation #2', 'lost is not a proposed stage'],
      ['relation #3', 'the quote is not in prompt.md: "never in the prompt"'],
      ['relation #4', 'D5_language_switch is not a proposed deviation class'],
      ['relation #5', 'source: the source is missing: name the path of the source the quote comes from'],
    ]);
    expect(validateProposal(proposal).ok).toBe(true);
  });

  it('takes relations from the relations section only, and phrases with a when and binds it can resolve', async () => {
    const rules = answer('rules', {
      dimensions: [
        {
          id: 'rule',
          title: 'Rules',
          kind: 'behaviour',
          values: [fromPrompt('no-investment-advice', 'Never give investment advice.')],
        },
      ],
      relations: [
        { kind: 'reply_language', subject: { dimension: 'rule', value: 'no-investment-advice' }, lang: 'en' },
      ],
    });
    const phrases = answer('phrases', {
      phrases: [
        {
          dimension: 'flow',
          value: 'balance',
          text: 'My card ends in {card}.',
          lang: 'en',
          when: { channel: ['chat'] },
          binds: { card: '4242' },
        },
        {
          dimension: 'flow',
          value: 'balance',
          text: 'Balance please.',
          lang: 'en',
          when: { channel: ['fax'] },
        },
      ],
    });
    const { result, proposal } = await run([STAGES, rules, PERSONAS, DATA, phrases, RELATIONS]);
    expect(result.refusals.map((refusal) => [refusal.section, refusal.entry, refusal.reason])).toEqual([
      ['rules', 'relation #1', 'relations come from the relations section'],
      ['phrases', 'phrase #2 (flow/balance)', 'when names channel=fax, which is not a proposed value'],
    ]);
    expect(proposal.phrases).toEqual([
      {
        dimension: 'flow',
        value: 'balance',
        text: 'My card ends in {card}.',
        lang: 'en',
        when: { channel: ['chat'] },
        binds: { card: '4242' },
        produced_by: 'model',
        approved: false,
      },
    ]);
  });

  it('skips a relation already proposed, whoever proposed it first', async () => {
    const twice = answer('relations', {
      relations: [
        {
          kind: 'recovery',
          class: 'D1_off_topic',
          flows: ['balance'],
          stage_after: 'pending',
          source: 'prompt.md',
          quote: 'Stages, in order: greet, verify, help.',
        },
      ],
    });
    const { result } = await run([STAGES, RULES, PERSONAS, DATA, PHRASES, twice]);
    expect(result.duplicates).toEqual([
      'relations: relation #1 (recovery D1_off_topic in balance) is already proposed',
    ]);
  });
});
