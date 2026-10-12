import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { main } from '../../packages/cli/src/index';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

it('shows the current pilot table for the committed Acme map and generated suite', async () => {
  const page = await readFile(join(ROOT, 'docs/reference/cli.md'), 'utf8');
  const command =
    'pnpm -s driftbench pilot plan --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs';
  const marker = `\`\`\`\n$ ${command}\n`;
  const start = page.indexOf(marker);
  expect(start).toBeGreaterThan(0);
  const from = start + marker.length;
  const block = page.slice(from, page.indexOf('\n```', from));
  let out = '';
  let err = '';
  const code = await main(
    ['pilot', 'plan', '--map', 'examples/acme/map/approved.yaml', '--suite', 'examples/acme/generated/specs'],
    {
      cwd: ROOT,
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
    },
  );
  expect(code).toBe(0);
  expect(err).toBe('');
  // The example shows the plan table and cost, before the per-task skip notices.
  expect(block.trimEnd()).toBe(out.split('\nSkipped ')[0]?.trimEnd());
}, 120_000);
