import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

async function run(argv: string[], cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

describe('driftbench estate lint over no input', () => {
  it('prints not-run, never Clean, when no check had a file to read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-lint-empty-'));
    const scan = await run(['estate', 'scan', '.', '--no-model', '--out', 'map.yaml'], root);
    expect(scan.err).toBe('');
    const lint = await run(['estate', 'lint', 'map.yaml'], root);
    expect(lint.out).toContain('Not run: no check had an input.');
    expect(lint.out).not.toContain('Clean.');
  });

  it('still prints Clean for an estate whose checks read files and found nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-lint-clean-'));
    await writeFile(join(root, 'CLAUDE.md'), '# Rules\n\nAnswer in English.\n');
    await run(['estate', 'scan', '.', '--no-model', '--out', 'map.yaml'], root);
    const lint = await run(['estate', 'lint', 'map.yaml'], root);
    expect(lint.out).toContain('Clean.');
    expect(lint.out).not.toContain('Not run');
  });
});
