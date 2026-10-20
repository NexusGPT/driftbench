import {
  ACT_SHAPES,
  ASK_FRAMES,
  ASK_PARTS_BY_TEST_TYPE,
  BACKGROUND_FRAMES,
  renderAsk,
  SITUATION_OF,
} from '@agent-nexus/driftbench-generate';
import { beforeAll, describe, expect, it } from 'vitest';
import { type FixtureSuite, fixtureSuite, type SuiteSpec } from '../../src/ladders/estate/bank/fixture-suite';
import { type AskEnv, checkAsk } from '../../src/ladders/estate/bank/task-check';
import { envOfSuite } from '../../src/ladders/estate/bank/taskv2';

/**
 * gen.task ties the frame and the act shape of a code-written ask to the kind of test. The table is declared
 * next to the frames (`ASK_PARTS_BY_TEST_TYPE`); a planted spec below is a real spec with another frame or
 * shape set into its record and its ask re-rendered, so each test names the one thing it changes.
 */
type Meta = { from: Record<string, unknown> };
const metaOf = (spec: SuiteSpec): Meta => (spec.spec.metadata as { estate: Meta }).estate;

let suite: FixtureSuite;
let env: AskEnv;

beforeAll(async () => {
  suite = await fixtureSuite();
  env = await envOfSuite(suite);
}, 300_000);

const coded = (testType: string): SuiteSpec => {
  const found = suite.specs.find(
    (spec) =>
      spec.complete &&
      spec.testType === testType &&
      metaOf(spec)?.from?.frame !== undefined &&
      metaOf(spec).from.form !== 'user prompt' &&
      checkAsk(spec, env).reasons.length === 0,
  );
  if (!found) throw new Error(`the suite holds no code-written ask of ${testType}`);
  return found;
};

/** The reasons of the check on a copy of the spec with another frame, shape or context. */
function changed(base: SuiteSpec, patch: Record<string, unknown>): string[] {
  const copy = structuredClone(base);
  const from = { ...metaOf(copy).from, ...patch } as Record<string, unknown>;
  const ask = renderAsk({
    frame: from.frame as string,
    shape: from.shape as string,
    ...(typeof from.context === 'string' ? { context: from.context } : {}),
    pieces: from.pieces as string[],
  });
  if (ask === undefined) throw new Error('the planted frame, shape and pieces render no ask');
  metaOf(copy).from = from;
  const [block] = copy.spec.blocks as Array<{ when: { user: string } }>;
  if (block) block.when.user = ask;
  return checkAsk(copy, env).reasons;
}

describe('the table of frames and shapes by test type', () => {
  it('names every test type of the generator, and only frames and shapes the generator declares', () => {
    expect(Object.keys(ASK_PARTS_BY_TEST_TYPE).sort()).toEqual(Object.keys(SITUATION_OF).sort());
    for (const [type, parts] of Object.entries(ASK_PARTS_BY_TEST_TYPE)) {
      for (const frame of parts.frames)
        expect(frame === 'verbatim' || frame in ASK_FRAMES, `${type}: ${frame} is no frame`).toBe(true);
      for (const shape of parts.shapes)
        expect(ACT_SHAPES.includes(shape), `${type}: ${shape} is no shape`).toBe(true);
    }
    for (const frame of BACKGROUND_FRAMES) expect(frame in ASK_FRAMES).toBe(true);
  });
});

describe('a frame belongs to the kind of test', () => {
  it('refuses the near miss frame in a positive route test, and the trigger frame in a near miss control', () => {
    expect(changed(coded('route_positive'), { frame: 'near_miss' })).toEqual([
      'the frame near_miss is no frame of a route_positive test',
    ]);
    expect(changed(coded('route_near_miss'), { frame: 'trigger' })).toEqual([
      'the frame trigger is no frame of a route_near_miss test',
    ]);
  });

  it('refuses a guard near frame in a positive guard test and the pressure frame in an obligation', () => {
    expect(changed(coded('guard_positive'), { frame: 'guard_near_act' })).toEqual([
      'the frame guard_near_act is no frame of a guard_positive test',
    ]);
    expect(changed(coded('obligation'), { frame: 'pressure' })).toEqual([
      'the frame pressure is no frame of a obligation test',
    ]);
  });

  it('keeps the variants of the trigger frame for a test that asks for the work', () => {
    expect(changed(coded('route_positive'), { frame: 'variant_2' })).toEqual([]);
  });

  it('refuses a background sentence in a frame that prints none', () => {
    const base = coded('route_near_miss');
    const reasons = changed(base, {
      context: 'This involves {}',
      pieces: [...(metaOf(base).from.pieces as string[]), 'x'],
    });
    expect(reasons).toContain('the frame near_miss prints no background sentence');
  });
});

describe('an act shape belongs to the kind of test', () => {
  it('refuses a hazard shape and a tool shape in a route test', () => {
    const base = coded('route_positive');
    expect(changed(base, { shape: 'go on with the task we were doing, after {}' })).toContain(
      'the shape go on with the task we were doing, after {} is no shape of a route_positive test',
    );
    expect(changed(base, { shape: 'run {} in the shell here' })).toContain(
      'the shape run {} in the shell here is no shape of a route_positive test',
    );
  });
});

describe('the asks the generator really wrote', () => {
  it('all pass: every complete code-written ask of the suite names a frame and shape of its test type', () => {
    let seen = 0;
    for (const spec of suite.specs) {
      const from = (spec.spec.metadata as { estate?: Meta } | undefined)?.estate?.from;
      if (!spec.complete || typeof from?.frame !== 'string' || typeof from.form !== 'string') continue;
      seen++;
      expect(checkAsk(spec, env).reasons, spec.path).toEqual([]);
    }
    expect(seen).toBeGreaterThan(100);
  });
});
