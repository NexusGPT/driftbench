import { describe, expect, it } from 'vitest';
import { ceilingVerdict } from './ceiling';

describe('a ceiling only goes down', () => {
  it('passes at or below the committed value, and when the committed value is at or below the base', () => {
    expect(ceilingVerdict(3493, 3493, undefined)).toBeUndefined();
    expect(ceilingVerdict(3000, 3493, 3493)).toBeUndefined();
    expect(ceilingVerdict(3000, 3000, 3493)).toBeUndefined();
  });

  it('fails when the count is above the committed value, and when the committed value is above the base', () => {
    expect(ceilingVerdict(3494, 3493, 3493)).toMatch(/above the committed ceiling/);
    expect(ceilingVerdict(3494, 3494, 3493)).toMatch(/above the base/);
    expect(ceilingVerdict(10, 3494, 3493)).toMatch(/above the base/);
  });
});
