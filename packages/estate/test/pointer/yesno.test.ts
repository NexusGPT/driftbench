import { describe, expect, it } from 'vitest';
import {
  askedLabels,
  choiceKey,
  choiceOpinions,
  choiceQuestions,
  createJevLabeler,
  createOpenAiDecisionsLabeler,
  isTooLarge,
  isVector,
  LabelerConfigError,
  type LabelSet,
  NONE_DEFINITION,
  questionKey,
  yesNoOpinions,
} from '../../src/pointer';
import { BAKERY, type Call, fakeFetch, load, windowOf } from './support';

const [BAKE] = load(BAKERY) as [LabelSet];
const GATED = load(
  `${BAKERY}      - name: gate-line\n        description: A unit that sets one act before another.\n        target: required\n`,
)[0] as LabelSet;

const recorded = (probabilities: Record<string, number>) => ({
  probabilities,
  returnedModel: 'm',
  stopReason: 'answered',
  usage: { input: 0, output: 0 },
});

describe('the yes or no questions', () => {
  it('asks every label but those that ask for a target, and refuses such a set unless in a stack', () => {
    expect(askedLabels(BAKE, false).map((label) => label.name)).toEqual([
      'greeting',
      'price-claim',
      'allergen-line',
    ]);
    expect(() => askedLabels(GATED, false)).toThrow(LabelerConfigError);
    expect(askedLabels(GATED, true).map((label) => label.name)).toEqual([
      'greeting',
      'price-claim',
      'allergen-line',
    ]);
  });

  it('takes the label with the highest probability at or above the threshold, else none', () => {
    const asked = askedLabels(BAKE, false);
    const answer = recorded({
      [questionKey(1, 'greeting')]: 0.9,
      [questionKey(1, 'price-claim')]: 0.2,
      [questionKey(1, 'allergen-line')]: 0.1,
      [questionKey(2, 'greeting')]: 0.4,
      [questionKey(2, 'price-claim')]: 0.45,
      [questionKey(2, 'allergen-line')]: 0.1,
    });
    const strict = yesNoOpinions(answer, windowOf(2), asked, 0.5);
    expect([...strict.byUnit.values()].map((opinion) => opinion.label)).toEqual(['greeting', 'none']);
    // A lower threshold reads the same recording without a new call.
    const loose = yesNoOpinions(answer, windowOf(2), asked, 0.4);
    expect([...loose.byUnit.values()].map((opinion) => opinion.label)).toEqual(['greeting', 'price-claim']);
    expect(loose.byUnit.get(0)?.probabilities).toEqual({
      greeting: 0.9,
      'price-claim': 0.2,
      'allergen-line': 0.1,
    });
  });

  it('leaves a unit without an opinion when one of its questions has no probability', () => {
    const answer = recorded({ [questionKey(1, 'greeting')]: 0.9 });
    expect(yesNoOpinions(answer, windowOf(1), askedLabels(BAKE, false), 0.4).byUnit.size).toBe(0);
  });
});

describe('the choice questions', () => {
  it('lists the labels and none as options, with their definitions, one question per unit', () => {
    const questions = choiceQuestions(askedLabels(BAKE, false), windowOf(2)) as Record<
      string,
      { type: string; instructions: string; criteria: Record<string, string> }
    >;
    expect(Object.keys(questions)).toEqual(['u1', 'u2']);
    expect(questions.u2?.type).toBe('choice');
    expect(questions.u2?.instructions).toContain('unit [2]');
    expect(Object.keys(questions.u2?.criteria ?? {})).toEqual([
      'greeting',
      'price-claim',
      'allergen-line',
      'none',
    ]);
    expect(questions.u1?.criteria.greeting).toContain(BAKE.labels[0]?.description);
    expect(questions.u1?.criteria.none).toBe(NONE_DEFINITION);
  });

  it('takes the option with the highest probability, none among them, and keeps the whole vector', () => {
    const answer = recorded({
      [choiceKey(1, 'greeting')]: 0.81,
      [choiceKey(1, 'price-claim')]: 0.12,
      [choiceKey(1, 'allergen-line')]: 0.02,
      [choiceKey(1, 'none')]: 0.05,
      [choiceKey(2, 'greeting')]: 0.1,
      [choiceKey(2, 'price-claim')]: 0.1,
      [choiceKey(2, 'allergen-line')]: 0.1,
      [choiceKey(2, 'none')]: 0.7,
    });
    const opinions = choiceOpinions(answer, windowOf(2), askedLabels(BAKE, false));
    expect([...opinions.byUnit.values()].map((opinion) => opinion.label)).toEqual(['greeting', 'none']);
    expect(opinions.byUnit.get(0)?.probabilities).toEqual({
      greeting: 0.81,
      'price-claim': 0.12,
      'allergen-line': 0.02,
      none: 0.05,
    });
  });

  it('leaves a unit without an opinion when an option has no probability', () => {
    const answer = recorded({ [choiceKey(1, 'greeting')]: 0.9, [choiceKey(1, 'none')]: 0.1 });
    expect(choiceOpinions(answer, windowOf(1), askedLabels(BAKE, false)).byUnit.size).toBe(0);
  });
});

describe('a choice answer that is no probability vector', () => {
  const asked = askedLabels(BAKE, false);
  const vector = (n: number, values: Record<string, number>) =>
    Object.fromEntries(Object.entries(values).map(([name, p]) => [choiceKey(n, name), p]));

  it('is refused with its sum and left without an opinion, never normalised', () => {
    const answer = recorded({
      ...vector(1, { greeting: 0.5, 'price-claim': 0.5, 'allergen-line': 0.5, none: 0.5 }),
      ...vector(2, { greeting: 0.7, 'price-claim': 0.1, 'allergen-line': 0.1, none: 0.1 }),
    });
    const opinions = choiceOpinions(answer, windowOf(2), asked);
    expect([...opinions.byUnit.values()].map((opinion) => opinion.label)).toEqual(['greeting']);
    expect(opinions.refusals).toEqual([
      expect.stringContaining('unit [1] has probabilities that are no vector (they sum to 2)'),
    ]);
  });

  it('accepts the rounding of two decimals, and refuses a probability outside 0 to 1', () => {
    expect(isVector({ a: 0.33, b: 0.33, c: 0.33, none: 0.01 })).toBe(true);
    expect(isVector({ a: 0.33, b: 0.33, c: 0.3, none: 0.01 })).toBe(false);
    expect(isVector({ a: 1.2, none: -0.2 })).toBe(false);
    expect(isVector({})).toBe(false);
  });
});

describe('the Jev labeler, a system 1 labeler', () => {
  it('is system 1; one request per window, one choice question u<n> per unit', () => {
    const labeler = createJevLabeler({ env: {}, replayOnly: true });
    expect([labeler.id, labeler.cls]).toEqual(['jev', 'system1']);
    const wire = labeler.render(BAKE, windowOf(4));
    const questions = wire.body.questions as Record<string, { type: string }>;
    expect(Object.keys(questions)).toEqual(['u1', 'u2', 'u3', 'u4']);
    expect(questions.u2?.type).toBe('choice');
    expect(wire.body.state).toMatchObject({ set: 'counter-voice', window: 'notes.md#1' });
    expect(JSON.stringify(wire.body.state)).toContain('[4] Line 4 wrapped');
  });

  it('cuts a window at 30 units, or at the cap it is given', () => {
    const labeler = createJevLabeler({ env: {}, replayOnly: true });
    expect(labeler.maxUnits(BAKE, 60)).toBe(30);
    expect(labeler.maxUnits(BAKE, 10)).toBe(10);
    expect(createJevLabeler({ env: {}, maxUnits: 12, replayOnly: true }).maxUnits(BAKE, 60)).toBe(12);
  });

  it('labels one unit per request in the unit state', () => {
    const labeler = createJevLabeler({ env: {}, state: 'unit', replayOnly: true });
    expect(labeler.id).toBe('jev-unit');
    expect(labeler.maxUnits(BAKE, 60)).toBe(1);
    expect(labeler.render(BAKE, windowOf(1)).labeler).toBe('jev-unit');
  });

  it('refuses a set whose label needs a target on its own, and serves it inside a stack', () => {
    const alone = createJevLabeler({ env: {}, replayOnly: true });
    expect(() => alone.render(GATED, windowOf(2))).toThrow(LabelerConfigError);
    const inStack = createJevLabeler({ env: {}, replayOnly: true, skipTargetLabels: true });
    const questions = inStack.render(GATED, windowOf(2)).body.questions as Record<
      string,
      { criteria: Record<string, string> }
    >;
    expect(Object.keys(questions.u1?.criteria ?? {})).not.toContain('gate-line');
    expect(Object.keys(questions)).toHaveLength(2);
  });

  it('names the question in the settings, so the labels are re-made when it changes', () => {
    expect(createJevLabeler({ env: {}, replayOnly: true }).settings).toEqual({ question: 'choice' });
  });

  it('posts the batch to the gateway with its key header and records the probabilities and the usage', async () => {
    const calls: Call[] = [];
    const labeler = createJevLabeler({
      env: { JEV_API_KEY: 'k-secret', JEV_ROUTE: 'gateway', JEV_MODEL: 'jev-test' },
      fetch: fakeFetch(
        {
          model: 'jev-test',
          answers: {
            u1: {
              type: 'choice',
              choice: 'greeting',
              confidence: 0.8,
              probabilities: { greeting: 0.8, 'price-claim': 0.1, 'allergen-line': 0, none: 0.1, odd: 3 },
            },
            u2: { type: 'refusal' },
          },
          usage: { input_tokens: 4200, output_tokens: 31 },
        },
        calls,
      ),
    });
    const wire = labeler.render(BAKE, windowOf(1));
    const answer = await labeler.call?.(wire, BAKE, windowOf(1));
    expect(calls[0]?.url).toBe('https://jev-gateway.nexus-orga.gpt.nexus/v1/systemone');
    expect(calls[0]?.headers['api-key']).toBe('k-secret');
    expect(calls[0]?.body.model).toBe('jev-test');
    expect(answer?.probabilities).toEqual({
      [choiceKey(1, 'greeting')]: 0.8,
      [choiceKey(1, 'price-claim')]: 0.1,
      [choiceKey(1, 'allergen-line')]: 0,
      [choiceKey(1, 'none')]: 0.1,
    });
    expect(answer?.usage).toEqual({ input: 4200, output: 31 });
  });

  it('reads a missing usage as 0, never as a guess', async () => {
    const labeler = createJevLabeler({
      env: { JEV_API_KEY: 'k', JEV_ROUTE: 'typesafe' },
      fetch: fakeFetch({ answers: {} }),
    });
    const answer = await labeler.call?.(labeler.render(BAKE, windowOf(1)), BAKE, windowOf(1));
    expect(answer?.usage).toEqual({ input: 0, output: 0 });
  });

  it('sends the typesafe route a bearer token', async () => {
    const calls: Call[] = [];
    const labeler = createJevLabeler({
      env: { JEV_API_KEY: 'k-secret', JEV_ROUTE: 'typesafe' },
      fetch: fakeFetch({ answers: {} }, calls),
    });
    await labeler.call?.(labeler.render(BAKE, windowOf(1)), BAKE, windowOf(1));
    expect(calls[0]?.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(calls[0]?.headers.authorization).toBe('Bearer k-secret');
  });

  it('reads the error type of a request that is too large, so the scan can halve the window', async () => {
    const labeler = createJevLabeler({
      env: { JEV_API_KEY: 'k', JEV_ROUTE: 'typesafe' },
      fetch: fakeFetch({ detail: { error_type: 'max_tokens_exceeded' } }, [], 400),
      maxRetries: 0,
    });
    const error = await labeler
      .call?.(labeler.render(BAKE, windowOf(1)), BAKE, windowOf(1))
      .catch((cause: unknown) => cause);
    expect(isTooLarge(error)).toBe(true);
  });

  it('stops with an error that names the route when the key is refused', async () => {
    const labeler = createJevLabeler({
      env: { JEV_API_KEY: 'k', JEV_ROUTE: 'gateway' },
      fetch: fakeFetch({ detail: 'invalid key' }, [], 401),
      maxRetries: 0,
    });
    const error = await labeler
      .call?.(labeler.render(BAKE, windowOf(1)), BAKE, windowOf(1))
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(LabelerConfigError);
    expect((error as Error).message).toContain('gateway');
    expect((error as Error).message).toContain('401');
  });

  it('has no call without a key or a route', () => {
    expect(createJevLabeler({ env: {} }).call).toBeUndefined();
    expect(createJevLabeler({ env: { JEV_API_KEY: 'k' } }).call).toBeUndefined();
    expect(
      createJevLabeler({ env: { JEV_API_KEY: 'k', JEV_ROUTE: 'typesafe' }, replayOnly: true }).call,
    ).toBeUndefined();
  });
});

describe('the OpenAI Decisions labeler, the public system 1 example', () => {
  it('is system 1, named openai-decisions, and sends predicate questions with the numbered text as input', () => {
    const labeler = createOpenAiDecisionsLabeler({ model: 'decide-1', env: {}, replayOnly: true });
    expect([labeler.id, labeler.cls, labeler.family, labeler.model]).toEqual([
      'openai-decisions',
      'system1',
      'openai',
      'decide-1',
    ]);
    const body = labeler.render(BAKE, windowOf(2)).body as {
      model: string;
      input: string;
      questions: Array<{ type: string; name: string; instructions: string }>;
    };
    expect(body.model).toBe('decide-1');
    expect(body.input).toContain('[2] Line 2 wrapped');
    expect(body.questions).toHaveLength(2 * 3);
    expect(body.questions[0]).toMatchObject({ type: 'predicate', name: questionKey(1, 'greeting') });
    expect(body.questions[0]?.instructions).toContain('Does this label apply to unit [1]');
  });

  it('posts to the decisions route with a bearer token and reads the probabilities, leaving a refusal out', async () => {
    const calls: Call[] = [];
    const labeler = createOpenAiDecisionsLabeler({
      model: 'decide-1',
      env: { OPENAI_API_KEY: 'k-secret', OPENAI_BASE_URL: 'https://decisions.example.test/' },
      fetch: fakeFetch(
        {
          answers: [
            { name: questionKey(1, 'greeting'), probability: 0.7 },
            { name: questionKey(1, 'price-claim'), type: 'refusal' },
          ],
          usage: { input_tokens: 90, output_tokens: 3 },
        },
        calls,
      ),
    });
    const answer = await labeler.call?.(labeler.render(BAKE, windowOf(1)), BAKE, windowOf(1));
    expect(calls[0]?.url).toBe('https://decisions.example.test/v1/decisions');
    expect(calls[0]?.headers.authorization).toBe('Bearer k-secret');
    expect(answer?.probabilities).toEqual({ [questionKey(1, 'greeting')]: 0.7 });
    expect(answer?.usage).toEqual({ input: 90, output: 3 });
    // The unit with a refused question gets no opinion: it is listed as unlabeled, never guessed.
    expect(labeler.opinions(answer as NonNullable<typeof answer>, BAKE, windowOf(1)).byUnit.size).toBe(0);
  });

  it('has no call without a key, and caps a request at fewer questions than the Jev default', () => {
    expect(createOpenAiDecisionsLabeler({ model: 'm', env: {} }).call).toBeUndefined();
    expect(createOpenAiDecisionsLabeler({ model: 'm', env: {} }).maxUnits(BAKE, 200)).toBe(33);
  });
});
