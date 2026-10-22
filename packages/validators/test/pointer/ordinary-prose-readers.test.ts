import { describe, expect, it } from 'vitest';
import { findingsOf } from './no-prose-patterns.test';

const cases: Record<string, string> = {
  'Set.has on words': "function reads(text){return new Set(['never','always','must']).has(text);}",
  'includes with concatenated word': "function reads(text){return text.includes('ne'+'ver');}",
  'word-list some/includes':
    "const words=['ne'+'ver','mu'+'st'];function reads(text){return words.some(w=>text.includes(w));}",
};
describe('ordinary prose-reading forms are in scope', () => {
  for (const [name, source] of Object.entries(cases))
    it(name, () => {
      const reads = new Function(source + ';return reads;')() as (text: string) => boolean;
      expect(reads('never')).toBe(true);
      expect(reads('A parcel reached the depot.')).toBe(false);
      expect(findingsOf('bank/families/ids.ts', source).length, source).toBeGreaterThan(0);
    });
});
