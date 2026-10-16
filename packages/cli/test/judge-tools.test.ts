import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt, fixtureRequest, loadCassette, loadCriteria } from '@agent-nexus/driftbench-judges';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CRITERIA = 'examples/acme/criteria';
const COUNCIL = 'examples/acme/criteria/council.cassette.json';
const CALIBRATION = 'examples/acme/criteria/calibration/cassette.json';
const LABELS = 'examples/acme/labels';

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
  scratch = await mkdtemp(join(tmpdir(), 'judge-tools-'));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** A copy of the Acme criteria with one rubric line replaced. */
async function changedCriteria(name: string, from: string, to: string): Promise<string> {
  const dir = await mkdtemp(join(scratch, 'criteria-'));
  await cp(join(ROOT, CRITERIA), dir, { recursive: true, filter: (src) => !src.includes('calibration') });
  const file = join(dir, `${name}.yaml`);
  const text = await readFile(file, 'utf8');
  expect(text).toContain(from);
  await writeFile(file, text.replace(from, to));
  return dir;
}

describe('driftbench judge ground', () => {
  it('finds a quote in the transcript entry the judge saw, and names it', async () => {
    const args = ['judge', 'ground', '--criteria', CRITERIA, '--criterion', 'plain_language'];
    const hit = await run([...args, '--fixture', 'fail', '--quote', 'fiber-300 on addr-102']);
    expect(hit).toMatchObject({ code: 0, err: '', out: 'grounded in transcript.3\n' });
    const miss = await run([...args, '--quote', 'Acme Fiber 1000']);
    expect(miss.code).toBe(1);
    expect(miss.out).toContain('NOT grounded');
    expect(miss.out).toContain('transcript.0, transcript.1, transcript.2, transcript.3');
  });

  it('reads a request file, honours --source and prints JSON', async () => {
    const criterion = (await loadCriteria(join(ROOT, CRITERIA))).criteria.find(
      (c) => c.def.name === 'plain_language',
    );
    const request = join(scratch, 'request.json');
    await writeFile(request, JSON.stringify(fixtureRequest(criterion as never, 'fail')));
    const elsewhere = await run([
      'judge',
      'ground',
      '--request',
      request,
      '--quote',
      'addr-102',
      '--source',
      'transcript.0',
      '--json',
    ]);
    expect(elsewhere.code).toBe(1);
    expect(JSON.parse(elsewhere.out)).toMatchObject({ grounded: false, source: 'transcript.0' });
    const there = await run([
      'judge',
      'ground',
      '--request',
      request,
      '--quote',
      'addr-102',
      '--source',
      'transcript.2',
      '--json',
    ]);
    expect(there.code).toBe(0);
    expect(JSON.parse(there.out)).toMatchObject({ grounded: true, where: 'transcript.2' });
  });

  it('refuses a request that is not one, and a missing source of request, with exit 2', async () => {
    const bad = join(scratch, 'bad.json');
    await writeFile(bad, JSON.stringify({ criterion: { name: 'x' }, transcript: [] }));
    const refused = await run(['judge', 'ground', '--request', bad, '--quote', 'x']);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain('criterion: rubric');
    const none = await run(['judge', 'ground', '--quote', 'x']);
    expect(none.code).toBe(2);
    expect(none.err).toContain('needs --request <file>, or --criteria <dir> with --criterion <name>');
  });
});

describe('driftbench judge lint', () => {
  it('lints every criterion of a folder, names each defect, and skips the files that hold none', async () => {
    const { code, out } = await run(['judge', 'lint', CRITERIA]);
    expect(code).toBe(1);
    expect(out).toContain('ok  plain_language (examples/acme/criteria/plain_language.yaml)');
    expect(out).toContain(
      'Skipped, neither a criterion file nor a spec: examples/acme/criteria/council.cassette.json.',
    );
    expect(out).toMatch(/12 criteria linted, [1-9]\d* with a defect\./);
  });

  it('lints the criteria of a spec file and exits 1 on a defect, 0 when clean', async () => {
    const spec = (rubric: string) =>
      [
        'id: lint-me',
        "version: '1'",
        'title: Lint me',
        'channel: chat',
        'lang: EN',
        'target: { adapter: echo, agent: demo }',
        'criteria:',
        `  - { name: tone, rubric: "${rubric}", pass: The reply names the plan., fail: The reply names no plan. }`,
        'blocks:',
        '  - user: Hello',
        '    expect: { criteria: [tone] }',
        '',
      ].join('\n');
    const dirty = join(scratch, 'dirty.yaml');
    await writeFile(dirty, spec('Is the reply good and also polite?'));
    const flagged = await run(['judge', 'lint', dirty, '--json']);
    expect(flagged.code).toBe(1);
    const report = JSON.parse(flagged.out);
    expect(report.criteria[0].criterion).toBe('tone');
    expect(report.criteria[0].issues).toEqual(expect.arrayContaining(['subjective', 'compound']));
    const clean = join(scratch, 'clean.yaml');
    await writeFile(clean, spec('Does the reply name the plan of the customer?'));
    const ok = await run(['judge', 'lint', clean]);
    expect(ok.err).toBe('');
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('1 criteria linted, 0 with a defect.');
  });

  it('exits 2 on a file that is neither a criterion file nor a spec', async () => {
    const { code, err } = await run(['judge', 'lint', COUNCIL]);
    expect(code).toBe(2);
    expect(err).toContain('neither a criterion file nor a valid spec');
  });
});

describe('driftbench judge prompt', () => {
  it('prints the system and user text buildPrompt gives the fixture request', async () => {
    const criterion = (await loadCriteria(join(ROOT, CRITERIA))).criteria.find(
      (c) => c.def.name === 'plain_language',
    );
    const expected = buildPrompt(fixtureRequest(criterion as never, 'fail'));
    const { code, out } = await run([
      'judge',
      'prompt',
      '--criteria',
      CRITERIA,
      '--criterion',
      'plain_language',
      '--fixture',
      'fail',
      '--json',
    ]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({ request: 'plain_language, fail fixture', ...expected });
    const text = await run(['judge', 'prompt', '--criteria', CRITERIA, '--criterion', 'plain_language']);
    expect(text.out).toContain('=== system (plain_language, pass fixture) ===');
    expect(text.out).toContain('=== user ===');
  });

  it('names the criteria a folder has when the criterion is not one of them', async () => {
    const { code, err } = await run(['judge', 'prompt', '--criteria', CRITERIA, '--criterion', 'nope']);
    expect(code).toBe(2);
    expect(err).toContain('has no valid criterion nope (it has care_redirect,');
  });
});

describe('driftbench judge cassette inspect', () => {
  it('counts the judges, the entries, and the requests of a folder the cassette answers', async () => {
    const { code, out } = await run([
      'judge',
      'cassette',
      'inspect',
      COUNCIL,
      '--criteria',
      CRITERIA,
      '--json',
    ]);
    expect(code).toBe(0);
    const report = JSON.parse(out);
    // The counts and the judge ids come from the cassette file itself, not from names fixed in this test.
    const cassette = await loadCassette(join(ROOT, COUNCIL));
    expect(cassette.entries.length).toBeGreaterThan(0);
    expect(report.entries).toBe(cassette.entries.length);
    expect(report.judges.map((j: { id: string }) => j.id).sort()).toEqual(
      cassette.judges.map((j: { id: string }) => j.id).sort(),
    );
    // Every entry of the shipped council cassette is a request of the Acme folder: the key of a player is rebuilt exactly.
    expect(report.coverage.stale).toBe(0);
    for (const row of report.coverage.criteria)
      expect(row).toMatchObject({ requests: 2, answered: 2, missing: [] });
  });

  it('counts the labelled blocks with --labels, and finds the requests of a changed rubric missing', async () => {
    const labelled = await run([
      'judge',
      'cassette',
      'inspect',
      CALIBRATION,
      '--criteria',
      CRITERIA,
      '--labels',
      LABELS,
    ]);
    expect(labelled.code).toBe(0);
    expect(labelled.out).toContain('0 entries match no request of the folder.');
    const changed = await changedCriteria(
      'plain_language',
      'rubric: Does the reply avoid internal codes and internal team names?',
      'rubric: Does the reply avoid internal codes, ids and internal team names?',
    );
    const stale = await run(['judge', 'cassette', 'inspect', COUNCIL, '--criteria', changed]);
    expect(stale.out).toContain('plain_language: 0 of 2; no answer for pass fixture, fail fixture');
    expect(stale.out).toContain('6 entries match no request of the folder');
  });
});

describe('driftbench judge cassette rekey', () => {
  it('moves the keys of a change the judge does not read, and the run replays again', async () => {
    // A line break inside the rubric: the key reads the stored text, the prompt reads it on one line.
    const changed = await changedCriteria(
      'plain_language',
      '  rubric: Does the reply avoid internal codes and internal team names?',
      '  rubric: |-\n    Does the reply avoid internal codes\n    and internal team names?',
    );
    const before = await run(['judge', 'run', '--criteria', changed, '--cassette', COUNCIL]);
    expect(before.code).toBe(1);
    const out = join(scratch, 'rekeyed.json');
    const rekey = await run([
      'judge',
      'cassette',
      'rekey',
      COUNCIL,
      '--from',
      CRITERIA,
      '--criteria',
      changed,
      '--out',
      out,
      '--json',
    ]);
    expect(rekey.err).toBe('');
    expect(rekey.code).toBe(0);
    expect(JSON.parse(rekey.out)).toMatchObject({ rekeyed: true, keys: 6, entries: 6 });
    const after = await run(['judge', 'run', '--criteria', changed, '--cassette', out]);
    expect(after.code).toBe(0);
    expect(after.out).toContain('12 of 12 criteria separated');
    expect((await loadCassette(out)).entries).toHaveLength(
      (await loadCassette(join(ROOT, COUNCIL))).entries.length,
    );
  });

  it('refuses, and writes nothing, when the change touches what the judge reads', async () => {
    const changed = await changedCriteria(
      'plain_language',
      'rubric: Does the reply avoid internal codes and internal team names?',
      'rubric: Does the reply avoid internal codes, ids and internal team names?',
    );
    const out = join(scratch, 'refused.json');
    const rekey = await run([
      'judge',
      'cassette',
      'rekey',
      COUNCIL,
      '--from',
      CRITERIA,
      '--criteria',
      changed,
      '--out',
      out,
    ]);
    expect(rekey.code).toBe(1);
    // One refusal line for every judge of the cassette that answered this criterion.
    const judges = (await loadCassette(join(ROOT, COUNCIL))).entries
      .filter((entry) => entry.criterion === 'plain_language')
      .map((entry) => entry.judge);
    expect(new Set(judges).size).toBeGreaterThan(0);
    for (const judge of new Set(judges))
      expect(rekey.out).toContain(
        `refused  plain_language pass fixture, judge ${judge}: the user prompt changes`,
      );
    expect(rekey.out).toContain('Nothing written');
    await expect(readFile(out, 'utf8')).rejects.toThrow();
  });

  it('refuses a rename, since the judge reads the criterion name, and an unknown old name is bad input', async () => {
    const dir = await mkdtemp(join(scratch, 'renamed-'));
    await mkdir(dir, { recursive: true });
    const text = await readFile(join(ROOT, CRITERIA, 'plain_language.yaml'), 'utf8');
    await writeFile(join(dir, 'plain_words.yaml'), text.replace('name: plain_language', 'name: plain_words'));
    const rekey = await run([
      'judge',
      'cassette',
      'rekey',
      COUNCIL,
      '--from',
      CRITERIA,
      '--criteria',
      dir,
      '--rename',
      'plain_language=plain_words',
      '--out',
      join(scratch, 'renamed.json'),
    ]);
    // The criterion name is printed in the rubric the judge reads: a rename changes the prompt.
    expect(rekey.code).toBe(1);
    expect(rekey.out).toContain('refused  plain_words pass fixture');
    const wrong = await run([
      'judge',
      'cassette',
      'rekey',
      COUNCIL,
      '--from',
      CRITERIA,
      '--criteria',
      dir,
      '--rename',
      'nope=plain_words',
      '--out',
      join(scratch, 'x.json'),
    ]);
    expect(wrong.code).toBe(2);
    expect(wrong.err).toContain('has no criterion nope');
  });
});

describe('driftbench judge calibrate label hygiene', () => {
  it('prints label conflicts, fixture leaks and the few-labels warning in the text output', async () => {
    const labels = await mkdtemp(join(scratch, 'labels-'));
    await writeFile(
      join(labels, 'plain_language.yaml'),
      [
        'criterion: plain_language',
        'labelled_by: a test',
        'blocks:',
        '  - id: twin.pass',
        '    label: pass',
        '    transcript:',
        '      - { role: agent, text: "Your plan is Acme Fiber 300." }',
        '  - id: twin.fail',
        '    label: fail',
        '    transcript:',
        '      - { role: agent, text: "Your plan is Acme Fiber 300." }',
        '  - id: leak.1',
        '    label: fail',
        '    transcript:',
        '      - { role: user, text: "Which plan do I have?" }',
        `      - { role: tool_call, tool: customer.lookup, text: '{"email":"lee.jensen@example.com"}' }`,
        `      - { role: tool_result, tool: customer.lookup, text: '{"id":"cust-002","plan_id":"fiber-300","address_id":"addr-102"}' }`,
        '      - { role: agent, text: "Your plan is fiber-300 on addr-102 (account cust-002). Would you like a faster plan?" }',
        '',
      ].join('\n'),
    );
    const { out } = await run([
      'judge',
      'calibrate',
      '--criteria',
      CRITERIA,
      '--labels',
      labels,
      '--cassette',
      CALIBRATION,
      '--only',
      'plain_language',
      '--out',
      join(scratch, 'hygiene.yaml'),
    ]);
    expect(out).toContain('    label conflict: twin.pass, twin.fail hold one slice under both labels');
    expect(out).toContain(
      '    fixture leak: leak.1 equal a fixture of the criterion, which inflates agreement',
    );
    expect(out).toContain('    warning few-labels: a class has fewer than 5 labelled blocks');
  });
});
