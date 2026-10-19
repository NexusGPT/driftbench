import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpecFile } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { tempFolder } from '../../../tools/test-setup/temp-folders';
import { importTracesCommand } from '../src/commands/import-traces';
import { type Io, main } from '../src/index';

const TRACES = fileURLToPath(new URL('../../adapters/test/traces/fixtures/', import.meta.url));
const SESSIONS = fileURLToPath(new URL('../../../examples/estates/sessions/', import.meta.url));

function capture(cwd: string) {
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
  return { io, output };
}

async function run(argv: string[], cwd: string) {
  const { io, output } = capture(cwd);
  const code = await main(argv, io);
  return { code, ...output };
}

const scratch = () => tempFolder('driftbench-import-');

describe('driftbench import traces', () => {
  it('drafts one valid, unapproved spec per OpenTelemetry conversation', async () => {
    const dir = await scratch();
    const result = await run(['import', 'traces', TRACES, '--from', 'otel', '--out', 'drafts'], dir);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect((await readdir(join(dir, 'drafts'))).sort()).toEqual([
      'draft-otel-conv-acme-0001.yaml',
      'draft-otel-sess-port-0042.yaml',
    ]);
    expect(result.out).toContain('Read 2 traces from 3 files (otel): 4 turns.');
    expect(result.out).toContain('Wrote 2 draft specs to drafts, none approved');
    for (const name of await readdir(join(dir, 'drafts'))) {
      const loaded = await loadSpecFile(join(dir, 'drafts', name));
      if (!loaded.ok) throw new Error(`invalid draft ${name}`);
      expect(loaded.spec.metadata?.imported).toMatchObject({ approved: false });
    }
  });

  it('reads Nexus traces and a Claude Code session', async () => {
    const dir = await scratch();
    const nexus = await run(
      ['import', 'traces', `${TRACES}nexus-traces.jsonl`, '--from', 'nexus', '--out', 'n'],
      dir,
    );
    expect(nexus.code).toBe(0);
    expect(await readdir(join(dir, 'n'))).toHaveLength(2);
    const session = await run(
      ['import', 'traces', `${SESSIONS}clean-build.jsonl`, '--from', 'claude-code', '--out', 'c'],
      dir,
    );
    expect(session.code).toBe(0);
    expect(session.out).toContain('(claude-code)');
  });

  it('reads OTLP from standard input with -', async () => {
    const dir = await scratch();
    const { io, output } = capture(dir);
    const text = await readFile(`${TRACES}otel-flat.jsonl`, 'utf8');
    const code = await importTracesCommand('-', { from: 'otel', out: 'd' }, io, {
      readStdin: async () => text,
    });
    expect(code).toBe(0);
    expect(output.out).toContain('Read 1 trace from standard input (otel)');
  });

  it('refuses a missing or unknown --from, an overwrite, and standard input for a session', async () => {
    const dir = await scratch();
    expect((await run(['import', 'traces', TRACES, '--out', 'd'], dir)).code).toBe(2);
    expect((await run(['import', 'traces', TRACES, '--from', 'jaeger', '--out', 'd'], dir)).code).toBe(2);
    expect((await run(['import', 'traces', TRACES, '--from', 'otel', '--out', 'd'], dir)).code).toBe(0);
    const again = await run(['import', 'traces', TRACES, '--from', 'otel', '--out', 'd'], dir);
    expect(again.code).toBe(2);
    expect(again.err).toContain('already exists');
    const { io } = capture(dir);
    expect(
      await importTracesCommand('-', { from: 'claude-code', out: 'x' }, io, { readStdin: async () => '' }),
    ).toBe(2);
  });

  it('applies a price table to tokens', async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, 'prices.json'),
      JSON.stringify({ 'example-model-1-0301': { input: 2, output: 8 } }),
    );
    await run(
      [
        'import',
        'traces',
        `${TRACES}otel-semconv.json`,
        '--from',
        'otel',
        '--out',
        'd',
        '--prices',
        'prices.json',
      ],
      dir,
    );
    const loaded = await loadSpecFile(join(dir, 'd', 'draft-otel-conv-acme-0001.yaml'));
    if (!loaded.ok) throw new Error('invalid draft');
    const imported = loaded.spec.metadata?.imported as { observed: Array<{ cost: { usd: number } }> };
    expect(imported.observed[0]?.cost.usd).toBeCloseTo((930 * 2 + 62 * 8) / 1e6, 12);
  });
});

describe('driftbench import approve', () => {
  it('redacts personal data by default, and keeps it with --no-redact', async () => {
    const dir = await scratch();
    const redacted = await run(['import', 'traces', TRACES, '--from', 'otel', '--out', 'r'], dir);
    expect(redacted.code).toBe(0);
    expect(redacted.out).toContain('Personal data redacted:');
    const kept = await run(['import', 'traces', TRACES, '--from', 'otel', '--out', 'k', '--no-redact'], dir);
    expect(kept.err).toBe('');
    expect(kept.code).toBe(0);
    expect(kept.out).not.toContain('Personal data redacted:');
    const name = 'draft-otel-conv-acme-0001.yaml';
    const before = await readFile(join(dir, 'r', name), 'utf8');
    const after = await readFile(join(dir, 'k', name), 'utf8');
    expect(before).toContain('[ADDRESS_1]');
    expect(before).not.toContain('3 Orchard Way');
    expect(after).toContain('3 Orchard Way');
    expect(after).not.toContain('[ADDRESS_1]');
  });

  it('lists the drafts not approved, then approves them all', async () => {
    const dir = await scratch();
    await run(['import', 'traces', TRACES, '--from', 'otel', '--out', 'd'], dir);
    const listed = await run(['import', 'approve', 'd'], dir);
    expect(listed.code).toBe(0);
    expect(listed.out).toContain('2 of 2 drafts are not approved yet');
    const approved = await run(['import', 'approve', 'd', '--all'], dir);
    expect(approved.out).toContain('Approved 2 drafts');
    expect((await run(['import', 'approve', 'd'], dir)).out).toContain('all 2 drafts are approved');
    await writeFile(join(dir, 'd', 'plain.yaml'), 'id: x\nblocks: [{user: hi}]\n');
    expect((await run(['import', 'approve', 'd/plain.yaml'], dir)).code).toBe(1);
  });
});

describe('driftbench import traces --select and --dataset', () => {
  it('drafts only the traces named by --select', async () => {
    const dir = await scratch();
    const result = await run(
      ['import', 'traces', TRACES, '--from', 'otel', '--out', 'drafts', '--select', 'sess-port-0042'],
      dir,
    );
    expect(result.code).toBe(0);
    expect(await readdir(join(dir, 'drafts'))).toEqual(['draft-otel-sess-port-0042.yaml']);
  });

  it('refuses a --select id that names no trace, and writes nothing', async () => {
    const dir = await scratch();
    const result = await run(
      ['import', 'traces', TRACES, '--from', 'otel', '--out', 'drafts', '--select', 'no-such-trace'],
      dir,
    );
    expect(result.code).toBe(2);
    expect(result.err).toContain('no-such-trace');
    await expect(readdir(join(dir, 'drafts'))).rejects.toThrow();
  });

  it('pushes the drafts as the next dataset version', async () => {
    const dir = await scratch();
    const args = [
      'import',
      'traces',
      TRACES,
      '--from',
      'otel',
      '--out',
      'drafts',
      '--select',
      'conv-acme-0001,sess-port-0042',
      '--dataset',
      'prod-sample',
      '--store',
      'store.db',
    ];
    const first = await run(args, dir);
    expect(first.code).toBe(0);
    expect(first.out).toContain('Pushed dataset');
    expect(first.out).toContain('prod-sample');
  });

  it('refuses --dataset without --store', async () => {
    const dir = await scratch();
    const result = await run(
      ['import', 'traces', TRACES, '--from', 'otel', '--out', 'drafts', '--dataset', 'x'],
      dir,
    );
    expect(result.code).toBe(2);
    expect(result.err).toContain('--store');
  });
});

describe('driftbench import traces is deterministic', () => {
  it('imports the same traces twice to byte-identical drafts, and the registry keeps one version', async () => {
    const dir = await scratch();
    const common = [
      'import',
      'traces',
      TRACES,
      '--from',
      'otel',
      '--select',
      'conv-acme-0001,sess-port-0042',
    ];
    const first = await run(
      [...common, '--out', 'one', '--dataset', 'prod-sample', '--store', 'store.db'],
      dir,
    );
    expect(first.code).toBe(0);
    const second = await run(
      [...common, '--out', 'two', '--dataset', 'prod-sample', '--store', 'store.db'],
      dir,
    );
    expect(second.code).toBe(0);
    expect(second.out).toContain('Unchanged: dataset prod-sample');
    for (const name of await readdir(join(dir, 'one'))) {
      expect(await readFile(join(dir, 'one', name), 'utf8')).toBe(
        await readFile(join(dir, 'two', name), 'utf8'),
      );
    }
  });
});

describe('driftbench import traces keeps each block linked to its source observation', () => {
  it('records the chat span each observed turn started from, in the draft', async () => {
    const dir = await scratch();
    await run(
      ['import', 'traces', TRACES, '--from', 'otel', '--out', 'd', '--select', 'conv-acme-0001'],
      dir,
    );
    const loaded = await loadSpecFile(join(dir, 'd', 'draft-otel-conv-acme-0001.yaml'));
    if (!loaded.ok) throw new Error('invalid draft');
    const observed = loaded.spec.metadata?.imported as {
      observed: Array<{ observation_id?: string }>;
    };
    expect(observed.observed.map((entry) => entry.observation_id)).toEqual([
      'a100000000000002',
      'a200000000000002',
    ]);
  });
});
