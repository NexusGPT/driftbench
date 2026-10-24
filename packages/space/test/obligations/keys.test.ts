import { canonicalGiven, type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import {
  addToStageBook,
  answersOf,
  machineSignature,
  obligationSpecOf,
  type StageBook,
  specWords,
  stageBookOf,
  startStageOf,
  testKeyOf,
  walkOf,
} from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';

/**
 * What makes two blocks the same test, two specs the same walk, and two specs say the same words
 * (docs/validators.md, section 3, "Same test"). The expected values are written from that paragraph: the stage a block
 * starts from, the tool answers it runs against and the machine Then it expects, however the user turn is worded; the
 * channel, the persona and the declared perturbations are no part of it.
 */

type Fields = Record<string, unknown>;

/** A valid spec. The blocks are `{ id, user, expect }`; the fields given replace or add to the rest. */
function make(id: string, blocks: Fields[], fields: Fields = {}): Spec {
  const result = validateSpec({ id, stages: ['a', 'b', 'c'], blocks, ...fields }, `specs/${id}.yaml`);
  if (!result.ok) throw new Error(`expected a valid spec, got ${JSON.stringify(result.errors, null, 2)}`);
  return result.spec;
}

const walkOfThree = (id: string, fields: Fields = {}) =>
  make(
    id,
    [
      { id: 'b1', user: 'hello there', expect: { stage: 'a', must: ['welcome'] } },
      { id: 'b2', user: 'I want the blue one', expect: { stage: 'b', must: ['blue'] } },
      { id: 'b3', user: 'yes please', expect: { stage: 'c', must: ['done'] } },
    ],
    fields,
  );

const withTool = (answer: Fields) => ({ given: { world: { tools: { lookup: answer } } } });

/** A spec of one block: the user turn, the stage it reaches, and any other field of the block. */
const single = (id: string, user: string, extra: Fields = {}, fields: Fields = {}) =>
  make(id, [{ id: 'b1', user, expect: { stage: 'a' }, ...extra }], fields);

describe('machineSignature: the machine Then of a block, as text', () => {
  const block = (expectFields: Fields) => [{ id: 'b1', user: 'hi', expect: { stage: 'a', ...expectFields } }];

  it('ignores the judged criteria and the ledger a block adds', () => {
    const plain = make('s1', block({ must: ['x'] }));
    const judged = make('s2', block({ must: ['x'], criteria: ['kind'], ledger_add: { note: 'x' } }), {
      criteria: [{ name: 'kind', rubric: 'Is the reply kind?' }],
    });
    expect(machineSignature(judged, 0)).toBe(machineSignature(plain, 0));
  });

  it('tells a different machine Then, and the spec rules every block shares', () => {
    const base = machineSignature(make('s1', block({ must: ['x'] })), 0);
    expect(machineSignature(make('s2', block({ must: ['y'] })), 0)).not.toBe(base);
    const ruled = make('s3', block({ must: ['x'] }), { rules: { one_message_per_turn: true } });
    expect(machineSignature(ruled, 0)).not.toBe(base);
  });

  it('reads the end state on the last block only', () => {
    const ended = make('s1', [...block({ must: ['x'] }), { id: 'b2', user: 'ok', expect: { stage: 'b' } }], {
      end_state: { source: 'tool:submit', expect: { done: true } },
    });
    const plain = make('s2', [...block({ must: ['x'] }), { id: 'b2', user: 'ok', expect: { stage: 'b' } }]);
    expect(machineSignature(ended, 0)).toBe(machineSignature(plain, 0));
    expect(machineSignature(ended, 1)).not.toBe(machineSignature(plain, 1));
  });
});

describe('answersOf: the tool answers a block runs against', () => {
  it('is the same for two blocks with the same answers, however the user turn is worded', () => {
    const answer = withTool({ result: { ok: 1 } });
    const one = single('s1', 'one way', answer);
    const two = single('s2', 'another way', answer);
    expect(answersOf(one, 0)).toBe(answersOf(two, 0));
  });

  it('differs when a tool answers another way, or fails', () => {
    const answers = (answer: Fields) => answersOf(single('s', 'hi', withTool(answer)), 0);
    expect(answers({ result: { ok: 2 } })).not.toBe(answers({ result: { ok: 1 } }));
    expect(answers({ error: 'service unavailable' })).not.toBe(answers({ result: { ok: 1 } }));
  });

  it('carries a forced answer to the blocks after it', () => {
    const forced = make('s1', [
      { id: 'b1', user: 'hi', expect: { stage: 'a' }, ...withTool({ error: 'down' }) },
      { id: 'b2', user: 'again', expect: { stage: 'b' } },
    ]);
    expect(answersOf(forced, 1)).toBe(answersOf(forced, 0));
  });

  it('is the same for any two blocks that force nothing', () => {
    const a = make('s1', [{ id: 'b1', user: 'hi', expect: { stage: 'a' } }]);
    const b = make('s2', [{ id: 'b1', user: 'hello', expect: { stage: 'b' } }]);
    expect(answersOf(a, 0)).toBe(answersOf(b, 0));
  });
});

describe('startStageOf: the stage a block starts from', () => {
  it('is the stage the block before it leaves, and for the first block the first stage of the spec', () => {
    const spec = walkOfThree('s1');
    const book = stageBookOf([spec]);
    expect(startStageOf(spec, 0, book)).toBe('a');
    expect(startStageOf(spec, 1, book)).toBe('a');
    expect(startStageOf(spec, 2, book)).toBe('b');
  });

  it('is empty when the spec states no stage at all', () => {
    const bare = make('s1', [{ id: 'b1', user: 'hi', expect: { must: ['x'] } }], { stages: undefined });
    expect(startStageOf(bare, 0, stageBookOf([bare]))).toBe('');
  });

  /**
   * A walk that starts from where another leaves off: its first block declares the stage it starts from, the history
   * of the first block of `s1`, and the block it takes them from. Its own first stage is `start`.
   */
  const continuing = (id: string, stage: string, after: string, history = 1) => {
    const start = canonicalGiven(walkOfThree('s1'), history);
    return make(
      id,
      [
        {
          id: 'c1',
          user: 'I want the blue one',
          expect: { stage: 'b', must: ['blue'] },
          given: { prefix: start.prefix, origin: 'canonical', stage, after },
        },
      ],
      { stages: ['start', 'a', 'b', 'c'] },
    );
  };

  it('reads a declared start when the suite holds the block it names, leaving that stage', () => {
    const book = stageBookOf([walkOfThree('s1')]);
    expect(startStageOf(continuing('t1', 'a', 's1#b1'), 0, book)).toBe('a');
  });

  it('does not read a declared start the block it names does not leave', () => {
    const book = stageBookOf([walkOfThree('s1')]);
    expect(startStageOf(continuing('t2', 'c', 's1#b1'), 0, book)).toBe('start');
  });

  it('does not read a declared start no written spec confirms', () => {
    expect(startStageOf(continuing('t1', 'a', 's1#b1'), 0, stageBookOf([]))).toBe('start');
  });

  it('does not read a declared start whose named block has said another history', () => {
    const book = stageBookOf([walkOfThree('s1')]);
    // The prefix is what block b1 has said; b2 leaves stage b, but after another history.
    expect(startStageOf(continuing('t3', 'b', 's1#b2'), 0, book)).toBe('start');
  });

  it('adds specs to a book one at a time as stageBookOf adds them all', () => {
    const one = walkOfThree('s1');
    const two = walkOfThree('s2');
    const book: StageBook = new Map();
    addToStageBook(book, one);
    addToStageBook(book, two);
    expect(book).toEqual(stageBookOf([one, two]));
    expect([...book.keys()]).toEqual(['s1#b1', 's1#b2', 's1#b3', 's2#b1', 's2#b2', 's2#b3']);
  });
});

describe('specWords: what a spec says apart from its labels', () => {
  const said = (user: string, fields: Fields = {}) => specWords(single('s1', user, {}, fields));

  it('does not depend on padding, ids, channel or tags', () => {
    const base = said('I want the blue one');
    expect(said('  I want   the blue one ')).toBe(base);
    const renamed = make('other', [{ id: 'z9', user: 'I want the blue one', expect: { stage: 'a' } }]);
    expect(specWords(renamed)).toBe(base);
    expect(said('I want the blue one', { channel: 'chat', tags: ['persona:terse'] })).toBe(base);
  });

  it('tells other words, a burst from a message, and another Given', () => {
    const base = said('I want the blue one');
    expect(said('I want the red one')).not.toBe(base);
    const together = { id: 'b1', when: { burst: ['I want', 'the blue one'] }, expect: { stage: 'a' } };
    expect(specWords(make('s1', [together]))).not.toBe(base);
    const forced = single('s1', 'I want the blue one', withTool({ error: 'down' }));
    expect(specWords(forced)).not.toBe(base);
  });
});

describe('walkOf and testKeyOf', () => {
  const book = (...specs: Spec[]) => stageBookOf(specs);

  it('give twins the same walk: a channel or a persona is no part of it', () => {
    const base = walkOfThree('s1');
    const twin = walkOfThree('s2', { channel: 'voice', tags: ['persona:chatty'] });
    expect(walkOf(twin, book(base, twin))).toBe(walkOf(base, book(base, twin)));
  });

  it('give the same walk to a spec whose user turns are worded another way', () => {
    const base = walkOfThree('s1');
    const reworded = make('s2', [
      { id: 'b1', user: 'good morning', expect: { stage: 'a', must: ['welcome'] } },
      { id: 'b2', user: 'the blue, please', expect: { stage: 'b', must: ['blue'] } },
      { id: 'b3', user: 'go ahead', expect: { stage: 'c', must: ['done'] } },
    ]);
    expect(walkOf(reworded, book(base, reworded))).toBe(walkOf(base, book(base, reworded)));
  });

  it('give another walk when a Then, a start stage or a tool answer changes', () => {
    const base = walkOfThree('s1');
    const thenChanged = make('s2', [
      { id: 'b1', user: 'hello there', expect: { stage: 'a', must: ['welcome'] } },
      { id: 'b2', user: 'I want the blue one', expect: { stage: 'b', must: ['green'] } },
      { id: 'b3', user: 'yes please', expect: { stage: 'c', must: ['done'] } },
    ]);
    const welcome = { stage: 'a', must: ['welcome'] };
    const forced = { id: 'b1', user: 'hello there', expect: welcome, ...withTool({ error: 'x' }) };
    const toolChanged = walkOfThree('s3', {
      blocks: [
        forced,
        { id: 'b2', user: 'I want the blue one', expect: { stage: 'b', must: ['blue'] } },
        { id: 'b3', user: 'yes please', expect: { stage: 'c', must: ['done'] } },
      ],
    });
    const all = book(base, thenChanged, toolChanged);
    expect(walkOf(thenChanged, all)).not.toBe(walkOf(base, all));
    expect(walkOf(toolChanged, all)).not.toBe(walkOf(base, all));
  });

  it('key a block by its answers, its start stage and its Then, in that order', () => {
    const spec = walkOfThree('s1');
    const all = book(spec);
    expect(testKeyOf(spec, 1, all)).toBe(
      JSON.stringify([answersOf(spec, 1), startStageOf(spec, 1, all), machineSignature(spec, 1)]),
    );
  });

  it('give two blocks of two specs the same key when they are the same test, whoever says them', () => {
    const one = walkOfThree('s1');
    const two = make('s2', [
      { id: 'x1', user: 'good morning', expect: { stage: 'a', must: ['welcome'] } },
      { id: 'x2', user: 'give me the blue', expect: { stage: 'b', must: ['blue'] } },
    ]);
    const all = book(one, two);
    expect(testKeyOf(two, 1, all)).toBe(testKeyOf(one, 1, all));
    expect(testKeyOf(one, 2, all)).not.toBe(testKeyOf(one, 1, all));
  });

  it('give a block started from another stage another key', () => {
    const one = walkOfThree('s1');
    const jumped = make('s2', [
      { id: 'x1', user: 'hello there', expect: { stage: 'c', must: ['welcome'] } },
      { id: 'x2', user: 'I want the blue one', expect: { stage: 'b', must: ['blue'] } },
    ]);
    const all = book(one, jumped);
    expect(testKeyOf(jumped, 1, all)).not.toBe(testKeyOf(one, 1, all));
  });
});

describe('obligationSpecOf: a spec as the obligations read it', () => {
  const injection = { id: 'b2', when: { injection: { class: 'D3_contradiction', user: 'actually, no' } } };
  const perturbation = (id: string, cls: string, at: number) => ({
    id,
    class: cls,
    inject_at: at,
    user: 'yes',
    expect: { stage: 'a' },
    recovery: { within_blocks: 0, stage_after: 'a' },
  });
  const generated = (extra: Fields) => ({ metadata: { generated: { seeder: 'graph', ...extra } } });

  it('carries the spec-level facts the suite groups by', () => {
    const spec = make('s1', [{ id: 'b1', user: 'hi', expect: { stage: 'a' } }], {
      channel: 'voice',
      tags: ['persona:terse', 'topic:x', 'persona:chatty'],
      ...generated({ path: 'p1', metamorphic: { family: 'f1', variant: 2, of: 3 } }),
    });
    const facts = obligationSpecOf(spec, stageBookOf([spec]));
    expect(facts).toMatchObject({
      spec: 's1',
      path: 'p1',
      channel: 'voice',
      persona: 'persona:terse,persona:chatty',
      family: 'f1',
      variant: 2,
      of: 3,
      walk: walkOf(spec, stageBookOf([spec])),
      words: specWords(spec),
    });
  });

  it('records nothing for a spec the generator did not write', () => {
    const spec = make('s1', [{ id: 'b1', user: 'hi', expect: { stage: 'a' } }]);
    const facts = obligationSpecOf(spec, stageBookOf([spec]));
    expect(facts).toMatchObject({ path: '', channel: '', persona: '', family: '', variant: 0, of: 0 });
  });

  it('marks the block that injects a class, and names every block by its id, else its place', () => {
    const second = { ...injection, expect: { stage: 'a' } };
    const spec = make('s1', [{ id: 'b1', user: 'hi', expect: { stage: 'a' } }, second]);
    const facts = obligationSpecOf(spec, stageBookOf([spec]));
    expect(facts.blocks.map((entry) => entry.key)).toEqual(['s1#b1', 's1#b2']);
    expect(facts.blocks.map((entry) => entry.injected)).toEqual([false, true]);
    expect(facts.blocks[0]?.deviation).toBeUndefined();
    expect(facts.blocks[1]?.deviation).toBe('D3_contradiction');
  });

  it('lists, for each block, the classes of the declared perturbations at or after it, sorted', () => {
    const spec = make(
      's1',
      [
        { id: 'b1', user: 'hi', expect: { stage: 'a' } },
        { id: 'b2', user: 'next', expect: { stage: 'b' } },
        { id: 'b3', user: 'more', expect: { stage: 'c' } },
      ],
      {
        perturbations: [
          perturbation('p1', 'D4_loose_confirmation', 1),
          perturbation('p2', 'D2_goal_shift', 2),
        ],
      },
    );
    const facts = obligationSpecOf(spec, stageBookOf([spec]));
    expect(facts.blocks.map((entry) => entry.perturbed)).toEqual([
      ['D2_goal_shift', 'D4_loose_confirmation'],
      ['D2_goal_shift', 'D4_loose_confirmation'],
      ['D2_goal_shift'],
    ]);
  });

  it('gives each block the key testKeyOf gives it, and the spec the walk walkOf gives it', () => {
    const spec = walkOfThree('s1');
    const book = stageBookOf([spec]);
    const facts = obligationSpecOf(spec, book);
    expect(facts.blocks.map((entry) => entry.test)).toEqual([0, 1, 2].map((at) => testKeyOf(spec, at, book)));
    expect(facts.walk).toBe(walkOf(spec, book));
  });
});
