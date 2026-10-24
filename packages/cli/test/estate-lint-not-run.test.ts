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

  it('is not clean when the checks that ran found nothing but others had no input, and names them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-lint-clean-'));
    await writeFile(join(root, 'CLAUDE.md'), '# Rules\n\nAnswer in English.\n');
    await run(['estate', 'scan', '.', '--no-model', '--out', 'map.yaml'], root);
    const lint = await run(['estate', 'lint', 'map.yaml'], root);
    // No rule and no guard: those checks read nothing. The registry checks require a guard to have been read,
    // so with none they lack that capability and are not counted as no-input.
    expect(lint.out).toContain(
      '  not-run     UNENFORCED, UNANCHORED_GUARD, MISSING_SCRIPT: no input to read.',
    );
    expect(lint.out).toContain('  not-run     REGISTRY_ROW, REGISTRY_GUARD: the run lacks what it requires.');
    expect(lint.out).toContain('Not clean: 3 checks did not run.');
    expect(lint.out).not.toContain('Clean.');
    expect(lint.code).toBe(1);
    const json = await run(['estate', 'lint', 'map.yaml', '--json'], root);
    expect(JSON.parse(json.out).summary).toBe('checks-not-run');
    expect(json.code).toBe(1);
  });
});
