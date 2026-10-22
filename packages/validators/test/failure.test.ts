import { describe, expect, it } from 'vitest';
import { check, ItemFailure, leakReport, leaksOf, renderFailure } from '../src/failure';

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
});
