import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeModelPort } from '@driftbench/generate';
import { describe, expect, it } from 'vitest';
import { logsCommand } from '../src/commands/intake';
import { type Io, main } from '../src/index';

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

const ACME = fileURLToPath(new URL('../../../examples/acme/', import.meta.url));

/** Generated at run time so that no source file holds a real-looking address or number. */
const REAL_EMAIL = `ana.duarte@${['mail', 'box'].join('')}.be`;
const REAL_PHONE = ['+32', '471', '12', '34', '56'].join(' ');

const LOGS = [
  {
    id: 'c1',
    turns: [
      { role: 'user', text: "I'd like a plan with more data." },
      { role: 'agent', text: 'Sure.' },
    ],
  },
  { id: 'c2', turns: [{ role: 'user', text: `Can I get more data? My account email is ${REAL_EMAIL}` }] },
  {
    id: 'c3',
    turns: [{ role: 'user', text: 'Hi, do you have home internet at 3 Orchard Way, Acmeville?' }],
    flags: ['incident'],
  },
  { id: 'c4', turns: [{ role: 'user', text: `I want to switch to Acme and keep my number ${REAL_PHONE}` }] },
  { id: 'c5', turns: [{ role: 'user', text: "My name is Ana Duarte and I'd like a plan with more data." }] },
]
  .map((line) => JSON.stringify(line))
  .join('\n');

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-intake-'));
  await writeFile(join(dir, 'logs.jsonl'), `${LOGS}\n`);
  return dir;
}

describe('driftbench intake logs', () => {
  it('writes the private set with owner-only permissions and prints counts, never a value', async () => {
    const dir = await setup();
    const result = await run(
      [
        'intake',
        'logs',
        'logs.jsonl',
        '--out',
        'private/set',
        '--map',
        `${ACME}map/approved.yaml`,
        '--spot-check',
        '3',
      ],
      dir,
    );
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect((await readdir(join(dir, 'private/set'))).sort()).toEqual([
      'conversations.jsonl',
      'intake-report.json',
      'reference-turns.jsonl',
      'spot-check.yaml',
    ]);
    expect((await stat(join(dir, 'private/set'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, 'private/set/conversations.jsonl'))).mode & 0o777).toBe(0o600);
    expect(result.out).toContain(
      'Conversations: 5 read, 0 near-duplicates dropped, 5 kept, 1 flagged as failures.',
    );
    expect(result.out).toMatch(/Pass 1 \(rules and checksums\): 3 redacted: address 1, email 1, phone 1/);
    expect(result.out).toContain('Pass 2 (independent rules): 1 more redacted: name 1.');
    expect(result.out).toMatch(/Intents on flow: \d+ seen, \d+ from the map/);
    expect(result.out).toMatch(/Good-Turing f1 \/ n\): f1 = \d+, f2 = \d+, n = 5/);
    const written = (
      await Promise.all(
        ['conversations.jsonl', 'intake-report.json', 'reference-turns.jsonl', 'spot-check.yaml'].map(
          (name) => readFile(join(dir, 'private/set', name), 'utf8'),
        ),
      )
    ).join('\n');
    for (const secret of ['ana.duarte', '471', 'Duarte', 'Orchard Way']) {
      expect(written).not.toContain(secret);
      expect(result.out).not.toContain(secret);
    }
    const turns = (await readFile(join(dir, 'private/set/reference-turns.jsonl'), 'utf8')).trim().split('\n');
    expect(JSON.parse(turns[0] as string).cell).toEqual({ flow: 'upgrade' });
  });

  it('refuses an output folder inside a git work tree with exit 2 and writes nothing', async () => {
    const dir = await setup();
    await mkdir(join(dir, 'repo', '.git'), { recursive: true });
    const result = await run(['intake', 'logs', 'logs.jsonl', '--out', 'repo/private'], dir);
    expect(result.code).toBe(2);
    expect(result.err).toContain('is inside the git work tree');
    expect(await readdir(join(dir, 'repo'))).toEqual(['.git']);
  });

  it('refuses this repository too', async () => {
    const dir = await setup();
    const result = await run(
      ['intake', 'logs', join(dir, 'logs.jsonl'), '--out', join(ACME, 'private')],
      dir,
    );
    expect(result.code).toBe(2);
    expect(result.err).toContain('Refused');
  });

  it('refuses a folder that already holds files without --force', async () => {
    const dir = await setup();
    await mkdir(join(dir, 'set'));
    await writeFile(join(dir, 'set', 'old.txt'), 'x');
    expect((await run(['intake', 'logs', 'logs.jsonl', '--out', 'set'], dir)).code).toBe(2);
    expect((await run(['intake', 'logs', 'logs.jsonl', '--out', 'set', '--force'], dir)).code).toBe(0);
  });

  it('refuses an invalid file by line number without echoing its text', async () => {
    const dir = await setup();
    await writeFile(
      join(dir, 'bad.jsonl'),
      `{"turns": [{"role": "user", "text": "${REAL_EMAIL}"}]}\nnot json ${REAL_EMAIL}\n`,
    );
    const result = await run(['intake', 'logs', 'bad.jsonl', '--out', 'set'], dir);
    expect(result.code).toBe(2);
    expect(result.err).toContain('✗ line 2  not a JSON object');
    expect(result.err).not.toContain('ana.duarte');
    expect(await stat(join(dir, 'set')).catch(() => undefined)).toBeUndefined();
  });

  it('refuses an unknown second pass and a model pass without a key', async () => {
    const dir = await setup();
    expect(
      (await run(['intake', 'logs', 'logs.jsonl', '--out', 's', '--second-pass', 'maybe'], dir)).code,
    ).toBe(2);
    const { io, output } = capture(dir);
    const code = await logsCommand('logs.jsonl', { out: 's', secondPass: 'model' }, io, { env: {} });
    expect(code).toBe(2);
    expect(output.err).toContain('no model key');
  });

  it('runs the model checker through the port and exits 1 when it fails on a conversation', async () => {
    const dir = await setup();
    const answers = [
      '{"findings": []}',
      '{"findings": []}',
      '{"findings": []}',
      'not json',
      'still not json',
      '{"findings": []}',
    ];
    const port = new FakeModelPort(answers, { family: 'other', model: 'checker-1' });
    const { io, output } = capture(dir);
    const code = await logsCommand('logs.jsonl', { out: 'set', secondPass: 'both' }, io, { port });
    expect(code).toBe(1);
    expect(output.out).toContain('Model check (other checker-1): 4 checked, 0 more redacted, 1 failed');
    expect(output.out).toContain('✗ model check failed on c4');
    for (const request of port.requests) expect(request.user).not.toContain('ana.duarte');
  });
});
