import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderCatalogue } from '../../src/ladders/pointer/bank/catalogue';
import { pointerBank } from '../../src/ladders/pointer/bank/index';

const FILE = fileURLToPath(new URL('../../../../validators/pointer/CATALOGUE.md', import.meta.url));

describe('the catalogue', () => {
  it('states the size of the bank', () => {
    expect(renderCatalogue()).toContain(`Bank: **${pointerBank().length} items**`);
  });

  it('lists every item once', () => {
    const text = renderCatalogue();
    for (const item of pointerBank()) expect(text.split(`\`${item.id}\``).length - 1, item.id).toBe(1);
  });

  it('is the committed file, byte for byte (regenerate with tools/pointer-catalogue.ts)', () => {
    expect(readFileSync(FILE, 'utf8')).toBe(renderCatalogue());
  });

  it('counts the same items as the committed file says', () => {
    const match = /Bank: \*\*(\d+) items\*\*/.exec(readFileSync(FILE, 'utf8'));
    expect(Number(match?.[1])).toBe(pointerBank().length);
  });
});
