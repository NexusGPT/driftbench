import { describe, expect, it } from 'vitest';
import { findingsOf } from './no-prose-patterns.test';

/** The three Set forms the independent review of PR 1136 found after the first guard (round 3). */
const cases: Record<string, string> = {
  'Set built in a let initializer':
    "function reads(text){let words=new Set(['never','must']);return words.has(text);}",
  'Set filled with add through an alias, then searched with has on the original':
    "const words=new Set();const alias=words;alias.add('never');function reads(text){return words.has(text);}",
  'Set filled by forEach(add) over a literal array':
    "const words=new Set();['never','must'].forEach(w=>words.add(w));function reads(text){return words.has(text);}",
};
describe('Set forms that read prose are in scope', () => {
  for (const [name, source] of Object.entries(cases))
    it(name, () => {
      const reads = new Function(source + ';return reads;')() as (text: string) => boolean;
      expect(reads('never')).toBe(true);
      expect(reads('A parcel reached the depot.')).toBe(false);
      expect(findingsOf('bank/families/ids.ts', source).length, source).toBeGreaterThan(0);
    });
});
