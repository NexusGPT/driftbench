import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { type Io, main } from '../src/index';

// Each test scans or builds an estate: on a loaded runner that takes longer than the default 5 seconds.
vi.setConfig({ testTimeout: 120_000 });

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

/** An invented estate with `notes` orphan notes that nothing names, scanned into `map.yaml`. */
async function scanned(notes: number): Promise<string> {
  const top = await mkdtemp(join(tmpdir(), 'driftbench-estate-output-'));
  const files: Record<string, string> = {
    'agent/CLAUDE.md': '# Harbour assistant\n\nAlways answer in the language of the user.\n',
    'agent/.claude/settings.json': '{}\n',
  };
  for (let index = 0; index < notes; index += 1)
    files[`agent/.claude/notes/note-${String(index).padStart(2, '0')}.md`] = `# Note ${index}\n`;
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(top, path)), { recursive: true });
    await writeFile(join(top, path), text);
  }
  const scan = await run(['estate', 'scan', 'agent', '--no-model', '--out', 'map.yaml'], top);
  expect(scan.err).toBe('');
  return top;
}

describe('driftbench estate lint on a long list of findings', () => {
  it('prints the total per code and the first items, and --verbose lists every one', async () => {
    const top = await scanned(25);
    const short = await run(['estate', 'lint', 'map.yaml'], top);
    expect(short.code).toBe(1);
    expect(short.out.match(/^ {2}ORPHAN {2}.*note-/gm)).toHaveLength(10);
    expect(short.out).toContain('... 15 more of 25');
    expect(short.out).toContain('Totals: ORPHAN 25');
    expect(short.out).toContain('25 findings.');

    const verbose = await run(['estate', 'lint', 'map.yaml', '--verbose'], top);
    expect(verbose.out.match(/^ {2}ORPHAN {2}.*note-/gm)).toHaveLength(25);
    expect(verbose.out).not.toContain('Totals:');
  });

  it('carries the cut as data with --json: per code the total, the number shown and the number omitted', async () => {
    const top = await scanned(25);
    const short = JSON.parse((await run(['estate', 'lint', 'map.yaml', '--json'], top)).out);
    const orphan = short.totals.find((entry: { code: string }) => entry.code === 'ORPHAN');
    expect(orphan).toEqual({ code: 'ORPHAN', total: 25, shown: 10, omitted: 15 });
    expect(short.findings.filter((finding: { code: string }) => finding.code === 'ORPHAN')).toHaveLength(10);
    const verbose = JSON.parse((await run(['estate', 'lint', 'map.yaml', '--json', '--verbose'], top)).out);
    expect(verbose.totals.find((entry: { code: string }) => entry.code === 'ORPHAN')).toEqual({
      code: 'ORPHAN',
      total: 25,
      shown: 25,
      omitted: 0,
    });
    expect(verbose.failed).toBe(true);
  });

  it('prints a short list as before', async () => {
    const top = await scanned(3);
    const lint = await run(['estate', 'lint', 'map.yaml'], top);
    expect(lint.out.match(/^ {2}ORPHAN {2}.*note-/gm)).toHaveLength(3);
    expect(lint.out).not.toContain('Totals:');
    expect(lint.out).not.toContain('more of');
  });
});

describe('driftbench estate scan on a long list', () => {
  it('stops each list after the first items and lists every one with --verbose', async () => {
    const top = await scanned(25);
    const short = await run(['estate', 'scan', 'agent', '--no-model', '--out', 'again.yaml'], top);
    expect(short.out).toMatch(/Orphans: 25, the first 10 are /);
    expect(short.out).toContain('add --verbose to list every one');
    const verbose = await run(
      ['estate', 'scan', 'agent', '--no-model', '--verbose', '--out', 'again.yaml', '--force'],
      top,
    );
    expect(verbose.out).toContain('note-24.md');
    expect(verbose.out).not.toContain('the first 10 are');
  });
});

describe('driftbench estate lint on a map moved away from its estate', () => {
  it('refuses with the folder looked at, the root as recorded and a fix', async () => {
    const top = await scanned(1);
    await mkdir(join(top, 'elsewhere'));
    await writeFile(join(top, 'elsewhere', 'map.yaml'), await readFile(join(top, 'map.yaml'), 'utf8'));
    const moved = await run(['estate', 'lint', 'elsewhere/map.yaml'], top);
    expect(moved.code).toBe(2);
    expect(moved.err).toContain('Cannot find the estate folder');
    expect(moved.err).toContain('(root: agent)');
    expect(moved.err).toContain('Fix: ');
  });
});

describe('driftbench estate lint verdict: not run, clean, or findings', () => {
  const lintJson = async (top: string) =>
    JSON.parse((await run(['estate', 'lint', 'map.yaml', '--json'], top)).out) as {
      failed: boolean;
      notRun: boolean;
      atoms: number;
      findings: unknown[];
      totals: Array<{ code: string; total: number; shown: number; omitted: number }>;
    };

  it('over no input: not run, not failed, no finding, never clean', async () => {
    const top = await mkdtemp(join(tmpdir(), 'driftbench-estate-verdict-'));
    await mkdir(join(top, 'agent'));
    expect((await run(['estate', 'scan', 'agent', '--no-model', '--out', 'map.yaml'], top)).err).toBe('');
    const data = await lintJson(top);
    expect(data).toMatchObject({ failed: false, notRun: true, atoms: 0, findings: [], totals: [] });
    const text = await run(['estate', 'lint', 'map.yaml'], top);
    expect(text.code).toBe(0);
    expect(text.out).not.toContain('Clean.');
  });

  it('over an estate with nothing wrong: clean, so not "not run"', async () => {
    const top = await mkdtemp(join(tmpdir(), 'driftbench-estate-verdict-'));
    await mkdir(join(top, 'agent'));
    await writeFile(join(top, 'agent', 'CLAUDE.md'), '# Rules\n\nAnswer in English.\n');
    await run(['estate', 'scan', 'agent', '--no-model', '--out', 'map.yaml'], top);
    const data = await lintJson(top);
    expect(data).toMatchObject({ failed: false, notRun: false, findings: [], totals: [] });
    const text = await run(['estate', 'lint', 'map.yaml'], top);
    expect(text.code).toBe(0);
    expect(text.out).toContain('Clean.');
  });

  it('with findings: failed, and the count printed is the true total, not the number listed', async () => {
    const top = await scanned(25);
    const data = await lintJson(top);
    expect(data).toMatchObject({ failed: true, notRun: false });
    const total = data.totals.reduce((sum, entry) => sum + entry.total, 0);
    const listed = data.totals.reduce((sum, entry) => sum + entry.shown, 0);
    expect(listed).toBeLessThan(total);
    expect(data.findings).toHaveLength(listed);
    const text = await run(['estate', 'lint', 'map.yaml'], top);
    expect(text.code).toBe(1);
    expect(text.out).toContain(`${total} findings.`);
  });
});
