import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SITUATION_CONCERNS } from '../../src/plan/relevance';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DOC = readFileSync(`${ROOT}docs/estate.md`, 'utf8');

/** The rows of the table under "Situation relevance in a proposed plan": dimension, value, kinds, helper routes, tool calls, language. */
function documented(): Record<
  string,
  { kinds: string[]; helperRoutes: boolean; toolCalls: boolean; language: boolean }
> {
  const section = DOC.slice(DOC.indexOf('### Situation relevance in a proposed plan'));
  const table = section.slice(
    0,
    section.indexOf('\n### ', 5) === -1 ? undefined : section.indexOf('\n### ', 5),
  );
  const out: Record<
    string,
    { kinds: string[]; helperRoutes: boolean; toolCalls: boolean; language: boolean }
  > = {};
  for (const line of table.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 8 || !/^`[a-z_]+`$/.test(cells[1] ?? '')) continue;
    const dimension = (cells[1] ?? '').replaceAll('`', '');
    const value = (cells[2] ?? '').replaceAll('`', '');
    out[`${dimension}=${value}`] = {
      kinds: (cells[3] ?? '').split(',').map((kind) => kind.trim().replaceAll('`', '')),
      helperRoutes: cells[4] === 'yes',
      toolCalls: cells[5] === 'yes',
      language: cells[6] === 'yes',
    };
  }
  return out;
}

describe('the relevance table of the product is the table of docs/estate.md', () => {
  it('holds the same values, the same kinds and the same helper routes', () => {
    const product = Object.fromEntries(
      Object.entries(SITUATION_CONCERNS).map(([key, concern]) => [
        key,
        {
          kinds: [...concern.kinds].sort(),
          helperRoutes: concern.helperRoutes === true,
          toolCalls: concern.toolCalls === true,
          language: concern.language === true,
        },
      ]),
    );
    const doc = Object.fromEntries(
      Object.entries(documented()).map(([key, row]) => [key, { ...row, kinds: [...row.kinds].sort() }]),
    );
    expect(Object.keys(doc).length).toBeGreaterThan(0);
    expect(doc).toEqual(product);
  });
});
