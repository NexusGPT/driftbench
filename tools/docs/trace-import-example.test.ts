import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../../packages/cli/src/index';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const FIXTURE = join(ROOT, 'packages/adapters/test/traces/fixtures/otel-semconv.json');

describe('docs/traces.md, the draft specs example', () => {
  it('shows what `import traces` prints and the draft it writes', async () => {
    const page = await readFile(join(ROOT, 'docs/traces.md'), 'utf8');
    const start = page.indexOf('```console\n$ driftbench import traces ');
    expect(start, 'the page holds the console example').toBeGreaterThan(0);
    const body = page.slice(start + '```console\n'.length, page.indexOf('\n```', start));
    const shown = body.split('\n').slice(1);
    const excerptStart = page.indexOf('```text\nblocks:', start);
    expect(excerptStart, 'the page holds the draft excerpt').toBeGreaterThan(0);
    const excerptEnd = page.indexOf('\n```', excerptStart);
    const excerpt = page.slice(excerptStart + '```text\n'.length, excerptEnd).split('\n');

    const cwd = await mkdtemp(join(tmpdir(), 'driftbench-doc-traces-'));
    try {
      let printed = '';
      const code = await main(['import', 'traces', FIXTURE, '--from', 'otel', '--out', 'drafts'], {
        cwd,
        out: (text) => {
          printed += text;
        },
        err: (text) => {
          printed += text;
        },
      });
      expect(code, printed).toBe(0);
      expect(printed.trimEnd().split('\n')).toEqual(shown);

      const file = join(cwd, 'drafts', 'draft-otel-conv-acme-0001.yaml');
      const draft = (await readFile(file, 'utf8')).split('\n');
      let from = 0;
      for (const line of excerpt) {
        const at = draft.indexOf(line, from);
        expect(at, `the draft holds, in order: ${line}`).toBeGreaterThanOrEqual(0);
        from = at + 1;
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 60_000);
});
