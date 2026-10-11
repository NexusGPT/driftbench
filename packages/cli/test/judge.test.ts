import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

const LABELS = 'examples/acme/labels';
const CALIBRATION = 'examples/acme/criteria/calibration/cassette.json';
const TABLE = 'examples/acme/criteria/calibration/assignments.yaml';

function calibrateArgs(out: string, cassette = CALIBRATION): string[] {
  return [
    'judge',
    'calibrate',
    '--criteria',
    CRITERIA,
    '--labels',
    LABELS,
    '--cassette',
    cassette,
    '--out',
    out,
  ];
}

describe('driftbench judge calibrate', () => {
  it('runs every judge on the Acme cassette and writes the committed assignment table', async () => {
    const out = join(scratch, 'assignments.yaml');
    const { code, out: text, err } = await run(calibrateArgs(out));
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(await readFile(out, 'utf8')).toBe(await readFile(join(ROOT, TABLE), 'utf8'));
    expect(text).toContain(
      'plain_language: owned by google-chat (system2: google-chat, openai-chat, anthropic-chat',
    );
    expect(text).toMatch(
      /jev-b {14}system1 {2}separation 3\/3 {2}kappa {2}0\.40 {2}agreement 2\/3 \[0\.21, 0\.94\] {2}misses/,
    );
    expect(text).toContain('ledger_intact: UNASSIGNED, judged but not gating');
    expect(text).toContain('11 of 12 criteria assigned in mode hybrid (3 repeats, kappa at least 0.8).');
    expect(text).toContain('Unassigned, judged but never gating: ledger_intact.');
  });

  it('exits 1 when a gating criterion stays unassigned, and still writes the table', async () => {
    const cassette = JSON.parse(await readFile(join(ROOT, CALIBRATION), 'utf8'));
    // jev-a and google-chat now pass the care_redirect fail fixture: neither class seats three at the bar.
    const fixtureKeys = new Set(
      cassette.entries
        .filter(
          (e: { judge: string; criterion: string; answer?: { outcome: string }; raw?: string }) =>
            e.judge === 'jev-a' && e.criterion === 'care_redirect' && e.answer?.outcome === 'fail',
        )
        .map((e: { key: string }) => e.key),
    );
    for (const entry of cassette.entries) {
      if (entry.criterion !== 'care_redirect' || !fixtureKeys.has(entry.key)) continue;
      if (entry.judge === 'jev-a') entry.answer = { outcome: 'pass', score: 0.9, reasoning: 'flipped' };
      if (entry.judge === 'google-chat') entry.raw = '{"outcome":"pass","reasoning":"flipped"}';
    }
    const path = join(scratch, 'unassigned.json');
    await writeFile(path, JSON.stringify(cassette));
    const out = join(scratch, 'unassigned.yaml');
    const { code, out: text } = await run(calibrateArgs(out, path));
    expect(code).toBe(1);
    expect(text).toContain('care_redirect [gating]: UNASSIGNED, judged but not gating');
    expect(text).toContain('care_redirect (declared gating)');
    expect(await readFile(out, 'utf8')).toContain('status: unassigned');
  });

  it('prints the report as JSON on request', async () => {
    const { code, out } = await run([...calibrateArgs(join(scratch, 'json.yaml')), '--json']);
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ mode: 'hybrid', repeats: 3, kappaMin: 0.8, errors: 0 });
    expect(doc.criteria).toHaveLength(12);
  });

  it('exits 2 on bad input: a missing option, a bad repeat count, labels for an unknown criterion', async () => {
    expect((await run(['judge', 'calibrate', '--criteria', CRITERIA])).code).toBe(2);
    expect((await run([...calibrateArgs(join(scratch, 'r.yaml')), '--repeats', '0'])).code).toBe(2);
    expect((await run([...calibrateArgs(join(scratch, 'm.yaml')), '--mode', 'x'])).code).toBe(2);
    const labels = join(scratch, 'labels');
    await mkdir(labels, { recursive: true });
    await writeFile(
      join(labels, 'nobody.yaml'),
      'criterion: nobody\nblocks:\n  - { id: n.1, label: pass, transcript: [{ role: agent, text: "a" }] }\n  - { id: n.2, label: fail, transcript: [{ role: agent, text: "b" }] }\n',
    );
    const { code, err } = await run([
      'judge',
      'calibrate',
      '--criteria',
      CRITERIA,
      '--labels',
      labels,
      '--cassette',
      CALIBRATION,
      '--out',
      join(scratch, 'u.yaml'),
    ]);
    expect(code).toBe(2);
    expect(err).toContain('labels for an unknown criterion nobody');
  });
});

describe('driftbench judge run with an assignment table', () => {
  it('uses the rows calibration earned', async () => {
    const { code, out, err } = await run([
      'judge',
      'run',
      '--criteria',
      CRITERIA,
      '--cassette',
      CALIBRATION,
      '--assignments',
      TABLE,
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('separated  plain_language [system2]');
    expect(out).toContain('separated  ledger_intact [system2, unassigned: not gating]');
    expect(out).toContain('separated  sheet_matches_catalog [system1, gating]');
    expect(out).toContain('12 of 12 criteria separated in mode hybrid.');
  });

  it('refuses a table written for another mode', async () => {
    const { code, err } = await run([
      'judge',
      'run',
      '--criteria',
      CRITERIA,
      '--cassette',
      CALIBRATION,
      '--assignments',
      TABLE,
      '--mode',
      'llm',
    ]);
    expect(code).toBe(2);
    expect(err).toContain('the assignment table is for mode hybrid');
  });
});
