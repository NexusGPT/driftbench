import { describe, expect, it } from 'vitest';
import { check, diagnostics, ItemFailure, leakReport, leaksOf, none, renderFailure } from '../src/failure';
import { wantedInMessage } from './leak-scan';

describe('the failure of an item, in fields', () => {
  it('renders item, rule, input and got, and never the expected value', () => {
    const f = new ItemFailure({
      rule: 'the interval is the Wilson interval',
      input: { count: 3, total: 7 },
      got: [0.1, 0.9],
      expected: [0.158, 0.75],
    });
    expect(f.message).toBe(renderFailure(f.fields));
    expect(f.message).toContain('"count":3');
    expect(f.message).toContain('0.9');
    expect(f.message).not.toContain('0.158');
    expect(leaksOf(f)).toEqual([]);
  });

  it('catches a message that repeats the expected value, in the rendering or added by hand', () => {
    // The product's own output may repeat words the wanted value has; only the wanted token itself would leak.
    const viaGot = new ItemFailure({
      rule: 'the refusal names its code',
      got: 'the code WRONG_CODE_HERE',
      expected: 'RIGHT_CODE_HERE',
    });
    expect(leaksOf(viaGot)).toEqual([]);
    const viaRule = new ItemFailure({
      rule: 'expected RIGHT_CODE_HERE at the path',
      expected: 'RIGHT_CODE_HERE',
    });
    expect(leaksOf(viaRule)).toEqual(['RIGHT_CODE_HERE']);
    const byHand = new ItemFailure({ rule: 'a rule', expected: 'RIGHT_CODE_HERE' });
    byHand.message = `${byHand.message}; expected RIGHT_CODE_HERE`;
    expect(leaksOf(byHand)).toContain('(the message is not the rendering of its fields)');
  });

  it('does not count the input or the output of the product as a leak when the wanted value shares an atom', () => {
    const f = new ItemFailure({
      rule: 'r',
      input: { path: 'variables.2.values.0' },
      got: [],
      expected: { path: 'variables.2.values.0' },
    });
    expect(leaksOf(f)).toEqual([]);
  });

  it('check throws an ItemFailure only when the condition fails, and the report counts structured and other failures', () => {
    expect(() => check(true, { rule: 'r' })).not.toThrow();
    let thrown: unknown;
    try {
      check(false, () => ({ rule: 'r', got: 5, expected: 7 }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ItemFailure);
    const report = leakReport([
      { item: 'a', error: thrown },
      { item: 'b', error: new Error('free text') },
      {
        item: 'c',
        error: Object.assign(new ItemFailure({ rule: 'r', expected: 'SECRET_VALUE' }), {
          message: 'r; SECRET_VALUE',
        }),
      },
    ]);
    expect(report.structured).toBe(2);
    expect(report.unstructured).toBe(1);
    expect(report.leaking.map((l) => l.item)).toEqual(['c']);
  });

  it('reads the leaves of the expected value, not its keys, and a sentence as one atom', () => {
    const f = new ItemFailure({
      rule: 'the plan holds every tuple',
      got: { rows: 4 },
      expected: { allowed: 12, note: 'three distinct samples' },
    });
    expect(leaksOf(f)).toEqual([]);
    const leaking = new ItemFailure({ rule: 'a rule', got: { rows: 4 }, expected: { allowed: 12345 } });
    leaking.message = 'a rule; the answer is 12345';
    expect(leaksOf(leaking)).toContain('(the message is not the rendering of its fields)');
  });

  it('catches a short wanted value: a number of any length by value, and a short code', () => {
    const rule = new ItemFailure({
      rule: 'the limit is 40 units',
      got: { limit: 7 },
      expected: { limit: 40 },
    });
    expect(leaksOf(rule)).toEqual(['40']);
    const two = new ItemFailure({ rule: 'a count of 2', got: { count: 5 }, expected: 2 });
    expect(leaksOf(two)).toEqual(['2']);
    const code = new ItemFailure({
      rule: 'the refusal code E1 at the path',
      got: { code: 'E9' },
      expected: { code: 'E1' },
    });
    expect(leaksOf(code)).toEqual(['E1']);
    // The same number printed by the product's own output is the product's, not a leak.
    const own = new ItemFailure({ rule: 'a count', got: { count: 40 }, expected: 40 });
    expect(leaksOf(own)).toEqual([]);
    // A number that is part of a longer number is not the same number.
    const part = new ItemFailure({ rule: 'a count', got: { count: 400 }, expected: 40 });
    expect(leaksOf(part)).toEqual([]);
  });

  it('catches the wanted value in another form: a fraction for a decimal, a path with other separators, the whole sentence', () => {
    const half = new ItemFailure({ rule: 'the share is 1/2', got: { share: 0.4 }, expected: 0.5 });
    expect(leaksOf(half)).toEqual(['0.5']);
    const percent = new ItemFailure({ rule: 'the share is 50%', got: { share: 0.4 }, expected: 0.5 });
    expect(leaksOf(percent)).toEqual(['0.5']);
    const path = new ItemFailure({
      rule: 'the issue is at variables\\2\\values\\0',
      got: { path: 'variables.9' },
      expected: 'variables/2/values/0',
    });
    expect(leaksOf(path)).toEqual(['variables/2/values/0']);
    const whole = new ItemFailure({
      rule: 'the refusal says The quote is not in the file named',
      got: { code: 'X' },
      expected: 'The quote is not in the file named',
    });
    expect(leaksOf(whole)).toEqual(['The quote is not in the file named']);
    // The same text printed by the product's own output is the product's.
    const own = new ItemFailure({
      rule: 'r',
      got: { reason: 'The quote is not in the file named' },
      expected: 'The quote is not in the file named',
    });
    expect(leaksOf(own)).toEqual([]);
  });
});

describe('the switch that builds diagnostics', () => {
  it('builds the factory of a failing check only when diagnostics are on', () => {
    let built = 0;
    const factory = () => {
      built += 1;
      return { rule: 'r' };
    };
    expect(() => check(false, factory)).toThrow(ItemFailure);
    expect(built).toBe(1);
    diagnostics.build = false;
    try {
      expect(() => check(false, factory)).toThrow(ItemFailure);
      expect(built).toBe(1);
      check(true, factory);
      expect(built).toBe(1);
    } finally {
      diagnostics.build = true;
    }
  });
});

describe('a failure declares what it wants', () => {
  it('refuses a failure with no expected field, even when a caller forgets the type', () => {
    expect(() => new ItemFailure({ rule: 'r', got: { n: 1 } } as never)).toThrow(/declares no expected value/);
  });

  it('accepts none(reason) and compares nothing with it', () => {
    const f = new ItemFailure({ rule: 'the product did something', got: { n: 7 }, expected: none('an observation') });
    expect(leaksOf(f)).toEqual([]);
  });
});

describe('the reference-versus-wrong scan', () => {
  it('finds a value the correct product returned and the message repeats', () => {
    const f = new ItemFailure({ rule: 'a count is exact', got: { details: [88, 'VARIABLES_QUOTE_NOT_FOUND'] }, expected: none('x') });
    const reference = new Set(['VARIABLES_QUOTE_NOT_FOUND', '88', 'ok']);
    const wrong = new Set(['ok']);
    expect(wantedInMessage(f, reference, wrong, 'item.id').sort()).toEqual(['88', 'VARIABLES_QUOTE_NOT_FOUND']);
  });

  it('lets a token through when the wrong product printed it too', () => {
    const f = new ItemFailure({ rule: 'r', got: { rows: 12 }, expected: none('x') });
    expect(wantedInMessage(f, new Set(['12']), new Set(['12']), 'i')).toEqual([]);
    const given = new ItemFailure({ rule: 'r', input: { limit: 12 }, expected: none('x') });
    expect(wantedInMessage(given, new Set(['12']), new Set(), 'i')).toEqual([]);
  });
});

