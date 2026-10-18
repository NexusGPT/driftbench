import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseVariableStoreText, VariableStoreIssueCodes } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { verifyVariableQuotes } from '../../src/extract';

/**
 * The help topic `authoring-map` explains every code of the variable store with a fictional store that
 * triggers it. This test runs each of those stores and checks that it reports the code it is written under:
 * the loader's errors and advice, then the check of the quotes against the files next to the store
 * (`examples/variables`).
 */
const TOPIC = fileURLToPath(new URL('../../../cli/help/authoring-map.md', import.meta.url));
const NEXT_TO_THE_STORE = fileURLToPath(new URL('../../../../examples/variables/', import.meta.url));

type Entry = { code: string; yaml: string };

async function entries(): Promise<Entry[]> {
  const body = (await readFile(TOPIC, 'utf8')).split('\n## Common errors\n')[1] ?? '';
  return [...body.matchAll(/^#### `(VARIABLES_[A-Z_]+)`\n([\s\S]*?)(?=^#### |^### |(?![\s\S]))/gm)].map(
    (match) => ({
      code: match[1] as string,
      yaml: /^```yaml\n([\s\S]*?)^```/m.exec(match[2] as string)?.[1] ?? '',
    }),
  );
}

async function codesOf(yaml: string): Promise<string[]> {
  const loaded = parseVariableStoreText(yaml, 'yaml');
  if (!loaded.ok) return loaded.errors.map((issue) => issue.code);
  const checked = await verifyVariableQuotes(loaded.store, NEXT_TO_THE_STORE);
  return [...loaded.warnings, ...checked].map((issue) => issue.code);
}

describe('the variable store codes of the help topic', () => {
  it('has a section for every code of the store', async () => {
    const found = (await entries()).map((entry) => entry.code);
    expect(VariableStoreIssueCodes.filter((code) => !found.includes(code))).toEqual([]);
    expect(new Set(found).size).toBe(found.length);
  });

  it('gives each section a store, a meaning and a fix', async () => {
    const body = (await readFile(TOPIC, 'utf8')).split('\n## Common errors\n')[1] ?? '';
    for (const { code, yaml } of await entries()) {
      expect(yaml, code).not.toBe('');
      const section = body.split(`#### \`${code}\`\n`)[1]?.split('\n#### ')[0] ?? '';
      expect(section, code).toContain('\nFix: ');
    }
  });

  for (const code of VariableStoreIssueCodes) {
    it(`${code}: the store written under it reports it`, async () => {
      const entry = (await entries()).find((candidate) => candidate.code === code);
      expect(entry, `a section for ${code}`).toBeDefined();
      expect(await codesOf(entry?.yaml ?? '')).toContain(code);
    });
  }
});
