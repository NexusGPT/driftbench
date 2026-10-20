import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLASS = 'examples/acme/classes/order-fiber-address.yaml';
const SET = 'examples/acme/classes/order-fiber-address.set.json';
const CASSETTE = 'examples/acme/classes/order-fiber-address.cassette.jsonl.gz';
const SEATS = ['--realiser', 'openai:gpt-6-luna', '--judge', 'anthropic:claude-haiku-5-5'];

async function cli(argv: string[]) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: ROOT,
  };
  return { code: await main(argv, io), out, err };
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-class-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('driftbench class plan', { timeout: 120_000 }, () => {
  it('prints the strength-2 array with slot_surface as an axis, and the coverage', async () => {
    const { code, out, err } = await cli(['class', 'plan', CLASS]);
    expect(code).toBe(0);
    expect(err).toContain('slot "plan": 1 surface form(s) wait for sign-off and are not planned');
    expect(out).toContain('slot_surface 3, register 3, length 3, distractor 2.');
    expect(out).toMatch(/Strength 2: \d+ rows cover 44 of 44 2-way tuples \(100\.0%\)\./);
  });

  it('refuses a class file that does not hold together, with exit 2', async () => {
    const bad = join(dir, 'bad.yaml');
    await writeFile(
      bad,
      'id: bad\nintent: x\nseed: hello\nslots:\n  - name: a\n    surface_forms: [{ form: zz, approved: true }]\n',
    );
    const { code, err } = await cli(['class', 'plan', bad]);
    expect(code).toBe(2);
    expect(err).toContain('seed  the seed holds no approved form of slot "a"');
  });
});

describe('driftbench class realise', { timeout: 120_000 }, () => {
  it('replays the recorded run to the committed set, byte for byte, with no key and no live call', async () => {
    const out = join(dir, 'replayed.set.json');
    const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const run = await cli([
        'class',
        'realise',
        CLASS,
        '--rows',
        '56',
        '--out',
        out,
        ...SEATS,
        '--cassette',
        CASSETTE,
      ]);
      // 5 of the 56 rows repeat a cell and found no realisation far enough from the accepted ones: exit 1.
      expect(run.code).toBe(1);
      expect(run.out).toContain('56 planned rows, 101 candidates, 51 accepted, 5 rows unfilled.');
      expect(run.out).toContain('Frozen set 2c9ce562b65c');
      expect(run.out).not.toContain('live model calls');
    } finally {
      if (saved.a !== undefined) process.env.ANTHROPIC_API_KEY = saved.a;
      if (saved.o !== undefined) process.env.OPENAI_API_KEY = saved.o;
    }
    expect(await readFile(out, 'utf8')).toBe(await readFile(join(ROOT, SET), 'utf8'));
  });

  it('refuses a replay the cassette cannot answer, and a run with neither --cassette nor --record', async () => {
    const miss = await cli([
      'class',
      'realise',
      CLASS,
      '--seed',
      '9',
      '--out',
      join(dir, 'x.json'),
      ...SEATS,
      '--cassette',
      CASSETTE,
    ]);
    expect(miss.code).toBe(2);
    expect(miss.err).toMatch(/the cassette has no answer for this openai gpt-6-luna request/);
    const none = await cli(['class', 'realise', CLASS, '--out', join(dir, 'y.json'), ...SEATS]);
    expect(none.code).toBe(2);
    expect(none.err).toContain(
      'Give --cassette to replay recorded answers, or --record to ask the live models.',
    );
    const seat = await cli([
      'class',
      'realise',
      CLASS,
      '--out',
      join(dir, 'z.json'),
      '--realiser',
      'mistral:x',
      '--judge',
      'anthropic:y',
      '--cassette',
      CASSETTE,
    ]);
    expect(seat.code).toBe(2);
    expect(seat.err).toContain('--realiser takes <provider:model> with provider anthropic, openai, gemini');
  });
});

describe('driftbench class audit', { timeout: 120_000 }, () => {
  it('passes the recorded audit: 0 of 51 accepted items invalid by the union of two families', async () => {
    const out = join(dir, 'audit.json');
    const { code, out: printed } = await cli([
      'class',
      'audit',
      CLASS,
      '--set',
      SET,
      '--labeller',
      'anthropic:claude-opus-5-5',
      '--labeller',
      'openai:gpt-6.1-sol',
      '--cassette',
      CASSETTE,
      '--out',
      out,
    ]);
    expect(code).toBe(0);
    expect(printed).toContain('0 of 51 items invalid by the union rule (bar: at most 1). Pass.');
    expect(JSON.parse(await readFile(out, 'utf8'))).toMatchObject({ items: 51, invalid: 0, pass: true });
  });

  it('wants two labellers of different families', async () => {
    const { code, err } = await cli([
      'class',
      'audit',
      CLASS,
      '--set',
      SET,
      '--labeller',
      'anthropic:a',
      '--labeller',
      'anthropic:b',
      '--cassette',
      CASSETTE,
    ]);
    expect(code).toBe(2);
    expect(err).toContain('Give two --labeller options of different model families');
  });
});

describe('driftbench class expand and envelope', { timeout: 120_000 }, () => {
  it('writes one copy per realisation, runs them, and reports the envelope apart from the single-string spec', async () => {
    const out = join(dir, 'expanded');
    const expand = await cli([
      'class',
      'expand',
      'examples/acme/classes/specs',
      '--classes',
      'examples/acme/classes',
      '--out',
      out,
    ]);
    expect(expand.code).toBe(0);
    expect(expand.out).toContain('51 copies of 1 specs written');
    expect((await readdir(out)).filter((f) => f.endsWith('.yaml'))).toHaveLength(51);
    const store = join(dir, 'class.db');
    const run = await cli([
      'campaign',
      'run',
      out,
      'examples/acme/specs/conversations/order-loose-confirmation.yaml',
      '--store',
      store,
    ]);
    expect(run.code).toBe(1);
    const report = await cli(['class', 'envelope', '--store', store, '--json']);
    expect(report.code).toBe(0);
    const json = JSON.parse(report.out) as {
      classes: {
        class: string;
        envelope: { n: number; minP: number; byValue: { value: string; rate: number }[] };
      }[];
      single: { specs: number; rate: number };
    };
    expect(json.classes).toHaveLength(1);
    const e = json.classes[0]?.envelope;
    expect(e?.n).toBe(51);
    // The block's exact address regex is the oracle the class exposes: only the canonical spelling passes.
    expect(e?.minP).toBe(0);
    expect(e?.byValue.find((v) => v.value === 'slot_surface=s0')?.rate).toBe(1);
    expect(e?.byValue.find((v) => v.value === 'slot_surface=s1')?.rate).toBe(0);
    // The seed spec passes every block, and is never averaged into the class rate.
    expect(json.single).toMatchObject({ specs: 1, rate: 1 });
  });

  it('refuses to expand from a set whose item was edited after the freeze', async () => {
    const folder = join(dir, 'edited');
    await cp(join(ROOT, 'examples/acme/classes'), folder, { recursive: true });
    const path = join(folder, 'order-fiber-address.set.json');
    const set = JSON.parse(await readFile(path, 'utf8'));
    set.items[0].text = 'Order Acme Fiber 300 for 14 Harbor Road, Acmeville.';
    await writeFile(path, JSON.stringify(set));
    const { code, err } = await cli([
      'class',
      'expand',
      join(folder, 'specs'),
      '--classes',
      folder,
      '--out',
      join(dir, 'never'),
    ]);
    expect(code).toBe(2);
    expect(err).toContain('item r001 changed after the set was frozen');
  });
});
