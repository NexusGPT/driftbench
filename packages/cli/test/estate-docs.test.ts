import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

async function run(argv: string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    cwd: ROOT,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

function example(page: string, command: string): string {
  const marker = `\`\`\`\n$ ${command}\n`;
  const start = page.indexOf(marker);
  expect(start, command).toBeGreaterThan(0);
  const from = start + marker.length;
  return page.slice(from, page.indexOf('\n```', from)).trimEnd();
}

describe('current estate documentation and output', () => {
  it('shows the committed fixture approval output without changing historical scan captures', async () => {
    const page = await readFile(join(ROOT, 'docs/estate.md'), 'utf8');
    const command = 'pnpm -s driftbench estate approve examples/estates/fixture/approved.yaml';
    const actual = await run(['estate', 'approve', 'examples/estates/fixture/approved.yaml']);
    expect(actual.code).toBe(0);
    expect(example(page, command)).toBe(actual.out.trimEnd());
  });

  it('shows complete current scan output alongside unchanged historical captures', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'driftbench-estate-doc-'));
    try {
      const page = await readFile(join(ROOT, 'docs/estate.md'), 'utf8');
      const documented = '_captures/current/estate-map.yaml';
      const output = join(scratch, 'estate-map.yaml');
      const command = `pnpm -s driftbench estate scan examples/estates/fixture --no-model --out ${documented}`;
      const actual = await run(['estate', 'scan', 'examples/estates/fixture', '--no-model', '--out', output]);
      expect(actual.code).toBe(0);
      expect(example(page, command)).toBe(actual.out.replaceAll(output, documented).trimEnd());
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('shows lint informational codes and counts for the committed approved map', async () => {
    const page = await readFile(join(ROOT, 'docs/estate.md'), 'utf8');
    const command = 'pnpm -s driftbench estate lint examples/estates/fixture/approved.yaml';
    const actual = await run(['estate', 'lint', 'examples/estates/fixture/approved.yaml']);
    expect(actual.code).toBe(1);
    expect(example(page, command)).toBe(actual.out.trimEnd());
    expect(page).toContain('| `EXTERNAL` |');
  });

  it('documents the built runner and its required-input usage error', async () => {
    const actual = await run(['estate', 'run']);
    expect(actual.code).toBe(2);
    expect(actual.err).toContain("required option '--estate <root>'");
    const page = await readFile(join(ROOT, 'docs/estate.md'), 'utf8');
    expect(page).not.toContain('the live runner, which is not built yet');
    const reference = await readFile(join(ROOT, 'docs/reference/cli.md'), 'utf8');
    expect(reference).toContain(
      'Exit 0 when every spec passes, 1 when one fails, 2 on a usage or input error',
    );
  });

  it('documents the built mutation command and its required atom', async () => {
    const actual = await run(['estate', 'mutate']);
    expect(actual.code).toBe(2);
    expect(actual.err).toContain("required option '--atom <id>'");
    const page = await readFile(join(ROOT, 'docs/reference/cli.md'), 'utf8');
    expect(page).toContain('driftbench estate mutate <map> --atom <id> (--delete | --invert)');
    expect(page).toContain('Exit 0 when the mutant is written, 2 on a usage or input error');
  });
});
