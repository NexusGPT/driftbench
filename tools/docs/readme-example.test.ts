import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SPEC = 'examples/estates/sessions/specs/price-sheet-build.yaml';

describe('the README code-agent example', () => {
  it('is the price-sheet-build spec, word for word, after its comment lines', async () => {
    const readme = await readFile(`${ROOT}/README.md`, 'utf8');
    const spec = await readFile(`${ROOT}/${SPEC}`, 'utf8');
    const body = spec
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n')
      .trim();
    const start = readme.indexOf('```yaml\nid: replay-price-sheet-build');
    expect(start, 'the README holds the example').toBeGreaterThan(0);
    const block = readme.slice(start + '```yaml\n'.length, readme.indexOf('\n```', start + 8)).trim();
    expect(block).toBe(body);
  });
});
