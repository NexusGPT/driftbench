import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFloors } from '@agent-nexus/driftbench-validators';
import { describe, expect, it } from 'vitest';
import { main } from '../../packages/cli/src/index';
import { parseFloorExample } from '../../packages/cli/test/support/floor-example';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Each example is a fenced block that starts with the command, prefixed by `$ `, and holds what it prints. */
const EXAMPLES = [['pnpm', '-s', 'driftbench', 'validate', 'floors']];

describe('the CLI reference examples', () => {
  for (const argv of EXAMPLES) {
    const command = argv.join(' ');
    it(`shows, for \`$ ${command}\`, the output for its documented floor state`, async () => {
      const cli = await readFile(`${ROOT}/docs/reference/cli.md`, 'utf8');
      const marker = `\`\`\`\n$ ${command}\n`;
      const start = cli.indexOf(marker);
      expect(start, 'the page holds the example').toBeGreaterThan(0);
      const from = start + marker.length;
      const block = cli.slice(from, cli.indexOf('\n```', from)).trimEnd();
      const fixture = parseFloorExample(block);
      const root = await mkdtemp(join(tmpdir(), 'driftbench-doc-floors-'));
      try {
        await mkdir(join(root, 'validators'));
        writeFloors(root, fixture);
        const out: string[] = [];
        const errors: string[] = [];
        const code = await main(argv.slice(3), {
          cwd: root,
          out: (text) => out.push(text),
          err: (text) => errors.push(text),
        });
        expect(code, errors.join('')).toBe(0);
        expect(block).toBe(out.join('').trimEnd());
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 120_000);
  }
});
