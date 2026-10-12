import { describe, expect, it } from 'vitest';
import { CriterionDef } from '../src/schema/spec';

const base = { name: 'tone', rubric: 'Is the reply polite?' };

describe('CriterionDef repeat_reducer', () => {
  it('is optional, so a criterion without one is unchanged', () => {
    expect(CriterionDef.safeParse(base).success).toBe(true);
  });

  it('accepts mode, median and at_least:<k>', () => {
    for (const repeat_reducer of ['mode', 'median', 'at_least:2']) {
      expect(CriterionDef.safeParse({ ...base, repeat_reducer }).success).toBe(true);
    }
  });

  it('refuses any other spelling, so a typo fails the spec load', () => {
    for (const repeat_reducer of ['majority', 'at_least:0', 'at_least:x', 'Mode']) {
      expect(CriterionDef.safeParse({ ...base, repeat_reducer }).success).toBe(false);
    }
  });
});
