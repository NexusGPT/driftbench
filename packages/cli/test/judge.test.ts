import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CRITERIA = 'examples/acme/criteria';
const CASSETTE = 'examples/acme/criteria/council.cassette.json';

async function run(argv: string[], cwd = ROOT) {
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

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'judge-cli-'));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('driftbench judge check', () => {
  it('validates the 12 Acme criteria and their fixture pairs', async () => {
    const { code, out, err } = await run(['judge', 'check', CRITERIA]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('12 valid criteria, 0 issue(s).');
    expect(out).toContain('ok  holds_instructions [system1, gating]');
  });

  it('exits 1 and names the file when a criterion is broken', async () => {
    const text = await readFile(join(ROOT, CRITERIA, 'plain_language.yaml'), 'utf8');
    await writeFile(join(scratch, 'plain_language.yaml'), text.replace(/ {2}fail:\n(?: {4}.*\n)+$/, ''));
    const { code, err } = await run(['judge', 'check', scratch]);
    expect(code).toBe(1);
    expect(err).toMatch(/plain_language\.yaml: fixtures\.fail/);
  });

  it('exits 2 on a folder that cannot be read', async () => {
    expect((await run(['judge', 'check', join(scratch, 'nowhere')])).code).toBe(2);
  });

  it('prints JSON on request', async () => {
    const { code, out } = await run(['judge', 'check', CRITERIA, '--json']);
    expect(code).toBe(0);
    expect(JSON.parse(out).valid).toHaveLength(12);
  });
});

describe('driftbench judge run', () => {
  it('replays the council on the cassette and separates every Acme criterion', async () => {
    const { code, out, err } = await run(['judge', 'run', '--criteria', CRITERIA, '--cassette', CASSETTE]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('12 of 12 criteria separated in mode hybrid.');
    expect(out).toContain(
      'separated  holds_instructions [system1, gating]: pass fixture pass, fail fixture fail (split, re-judged)',
    );
  });

  it('reports JSON with every vote', async () => {
    const { code, out } = await run([
      'judge',
      'run',
      '--criteria',
      CRITERIA,
      '--cassette',
      CASSETTE,
      '--json',
    ]);
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ separated: 12, criteria: 12, errors: 0 });
    const honest = doc.rows.find((row: { criterion: string }) => row.criterion === 'honest_failure');
    expect(JSON.stringify(honest)).toContain('asked again with the large budget');
  });

  it('exits 1 on a cassette miss and says so, never inventing an answer', async () => {
    const cassette = JSON.parse(await readFile(join(ROOT, CASSETTE), 'utf8'));
    cassette.entries = cassette.entries.filter(
      (entry: { criterion: string; judge: string }) =>
        !(entry.criterion === 'plain_language' && entry.judge === 'jev-a'),
    );
    const path = join(scratch, 'missing.json');
    await writeFile(path, JSON.stringify(cassette));
    const { code, out } = await run(['judge', 'run', '--criteria', CRITERIA, '--cassette', path]);
    expect(code).toBe(1);
    expect(out).toContain('gave no answer');
  });

  it('exits 1 when a recorded answer no longer separates a criterion', async () => {
    const cassette = JSON.parse(await readFile(join(ROOT, CASSETTE), 'utf8'));
    for (const entry of cassette.entries) {
      if (entry.criterion === 'care_redirect' && entry.answer?.outcome === 'fail') {
        entry.answer = { outcome: 'pass', score: 0.9, reasoning: 'flipped' };
      }
    }
    const path = join(scratch, 'flipped.json');
    await writeFile(path, JSON.stringify(cassette));
    const { code, out } = await run(['judge', 'run', '--criteria', CRITERIA, '--cassette', path]);
    expect(code).toBe(1);
    expect(out).toContain('NOT separated  care_redirect');
    expect(out).toContain('11 of 12 criteria separated');
  });

  it('refuses a council with a judge of the agent family, before any judging', async () => {
    const { code, err } = await run([
      'judge',
      'run',
      '--criteria',
      CRITERIA,
      '--cassette',
      CASSETTE,
      '--agent-family',
      'google',
    ]);
    expect(code).toBe(2);
    expect(err).toContain('judge google-chat is from the google family');
  });

  it('exits 2 on a bad mode or a missing option', async () => {
    expect(
      (await run(['judge', 'run', '--criteria', CRITERIA, '--cassette', CASSETTE, '--mode', 'x'])).code,
    ).toBe(2);
    expect((await run(['judge', 'run', '--criteria', CRITERIA])).code).toBe(2);
  });

  it('runs in system1 mode with the cascade', async () => {
    const { code, out } = await run([
      'judge',
      'run',
      '--criteria',
      CRITERIA,
      '--cassette',
      CASSETTE,
      '--mode',
      'system1',
      '--cascade',
    ]);
    expect(out).toContain('(cascade)');
    // In system1 mode the system 2 criteria are judged by system 1 judges with no recording: misses, exit 1.
    expect(code).toBe(1);
  });
});
