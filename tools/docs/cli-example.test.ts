import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const run = promisify(execFile);

/** Each example is a fenced block that starts with the command, prefixed by `$ `, and holds what it prints. */
const EXAMPLES = [['pnpm', '-s', 'driftbench', 'validate', 'floors']];

describe('the CLI reference examples', () => {
  for (const argv of EXAMPLES) {
    const command = argv.join(' ');
    it(`shows, for \`$ ${command}\`, the output the command prints today`, async () => {
      const cli = await readFile(`${ROOT}/docs/reference/cli.md`, 'utf8');
      const marker = `\`\`\`\n$ ${command}\n`;
      const start = cli.indexOf(marker);
      expect(start, 'the page holds the example').toBeGreaterThan(0);
      const from = start + marker.length;
      const block = cli.slice(from, cli.indexOf('\n```', from)).trimEnd();
      const { stdout } = await run(argv[0] as string, argv.slice(1), { cwd: ROOT });
      expect(block).toBe(stdout.trimEnd());
    }, 120_000);
  }
});
