import { describe, expect, it } from 'vitest';
import * as spans from '../../src/ladders/variables/blind/spans';

/**
 * Round 2, cheat A: the implementation module imported the bank's own table of what each span means and labelled
 * spans from it, so the scale items passed without any reader. The table must not be readable from the validator's
 * code: the bank only reports a declaration to a sink that the test side installs (test/variables-blind/span-table.ts).
 */
describe('the bank keeps its table of span meanings out of reach of the implementation', () => {
  it('no export of the span module returns what a declared span means', () => {
    const text = 'the audit order value is above 91 euros';
    spans.numeric(text, 'the audit order value', 91, 'gt');
    spans.declareSpan(`${text} again`, { kind: 'boolean', subject: 'x', word: 'y' });
    for (const [name, value] of Object.entries(spans)) {
      if (typeof value !== 'function' || ['declareSpan', 'numeric', 'setSpanSink'].includes(name)) continue;
      for (const arg of [text, `${text} again`]) {
        let got: unknown;
        try {
          got = (value as (x: string) => unknown)(arg);
        } catch {
          continue;
        }
        expect(got, `${name}(${arg})`).not.toMatchObject({ kind: expect.any(String) });
      }
    }
  });

  it('declaring a span without a sink installed keeps nothing', () => {
    const seen: string[] = [];
    spans.setSpanSink((t) => seen.push(t));
    spans.declareSpan('seen once', { kind: 'boolean', subject: 'a', word: 'b' });
    spans.setSpanSink(undefined);
    spans.declareSpan('seen never', { kind: 'boolean', subject: 'a', word: 'b' });
    expect(seen).toEqual(['seen once']);
  });
});
