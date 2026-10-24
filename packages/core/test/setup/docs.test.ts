import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { CLAUDE_CODE_PROFILE } from '../../src/runtime-profile/claude-code';
import { parseSetupText } from '../../src/setup/schema';

it('loads the setup guide example with the setup schema, independently of the spec YAML dialect', async () => {
  const text = await readFile(new URL('../../../../docs/setup.md', import.meta.url), 'utf8');
  const examples = [...text.matchAll(/^```yaml setup\n([\s\S]*?)^```$/gm)];
  expect(examples).toHaveLength(1);
  const result = parseSetupText(examples[0]?.[1] ?? '', CLAUDE_CODE_PROFILE);
  expect(result.ok ? [] : result.errors).toEqual([]);
});
