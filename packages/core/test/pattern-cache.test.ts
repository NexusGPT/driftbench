import { expect, it, vi } from 'vitest';
import { patternError } from '../src/spec/semantics';

it('compiles a repeated valid pattern once and keeps validation after cache eviction', () => {
  const Original = RegExp;
  const source = 'pattern-cache-test-unique';
  let compilations = 0;
  vi.stubGlobal(
    'RegExp',
    class extends Original {
      constructor(pattern: string | RegExp, flags?: string) {
        super(pattern, flags);
        if (pattern === source) compilations += 1;
      }
    },
  );
  try {
    expect(patternError(source)).toBeUndefined();
    expect(patternError(source)).toBeUndefined();
    expect(compilations).toBe(1);
    for (let index = 0; index < 4096; index += 1)
      expect(patternError(`pattern-cache-churn-${index}`)).toBeUndefined();
    expect(patternError(source)).toBeUndefined();
    expect(compilations).toBe(2);
    for (const invalid of ['[', '(', '*', '(?<x>a)(?<x>b)']) {
      let message = '';
      try {
        new Original(invalid, 'm');
      } catch (cause) {
        message = (cause as Error).message;
      }
      expect(patternError(invalid)).toBe(message);
      expect(patternError(invalid)).toBe(message);
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
