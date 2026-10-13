import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeModelPort, loadProposal } from '@agent-nexus/driftbench-generate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractCommand } from '../src/commands/extract';
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

const PROMPT = `You are the Zed Bank assistant.
Stages, in order: greet, verify, help.
Never give investment advice.
`;

const INVENTORY = `channels: [chat]
behaviours:
  - id: B-001
    title: Verify the customer before any balance
flows:
  - id: balance
    title: A customer asks for their balance
    behaviours: [B-001]
`;

const STAGES = {
  section: 'stages',
  dimensions: [
    {
      id: 'stage',
      title: 'Stages',
      kind: 'stage',
      values: [
        {
          id: 'greet',
          title: 'Greet',
          source: '../prompt.md',
          quote: 'Stages, in order: greet, verify, help.',
        },
      ],
    },
  ],
};

async function project(files: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-extract-'));
  const all = { 'prompt.md': PROMPT, 'inventory.yaml': INVENTORY, ...files };
  for (const [name, text] of Object.entries(all)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), text);
  }
  return dir;
}

const base = (out = 'map/proposal.yaml') => [
  'extract',
  '--prompt',
  'prompt.md',
  '--inventory',
  'inventory.yaml',
  '--out',
  out,
];

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('driftbench extract: usage', () => {
  it('exits 2 and names every missing option', async () => {
    const dir = await project();
    const { code, err } = await run(['extract', '--prompt', 'prompt.md'], dir);
    expect(code).toBe(2);
    expect(err).toBe("error: required options '--inventory <file>', '--out <file>' not specified\n");
  });

  it('refuses an unknown --provider before any model call, and writes nothing', async () => {
    const dir = await project();
    const { code, err } = await run(
      [
        'extract',
        '--prompt',
        'prompt.md',
        '--inventory',
        'inventory.yaml',
        '--out',
        'p.yaml',
        '--provider',
        'bogus',
      ],
      dir,
    );
    expect(code).toBe(2);
    expect(err).toContain('unknown provider "bogus": use anthropic or openai.');
    await expect(readFile(join(dir, 'p.yaml'), 'utf8')).rejects.toThrow();
  });

  it('exits 2 on an unknown option, and on approve without a file', async () => {
    const dir = await project();
    expect((await run([...base(), '--no-model', '--colour'], dir)).code).toBe(2);
    const approve = await run(['extract', 'approve'], dir);
    expect(approve.code).toBe(2);
    expect(approve.err).toContain('missing required argument');
  });

  it('exits 2 without a model key unless --no-model is given, and writes nothing', async () => {
    const dir = await project();
    const { code, err } = await run(base(), dir);
    expect(code).toBe(2);
    expect(err).toBe(
      'no model key: set ANTHROPIC_API_KEY, or OPENAI_API_KEY with OPENAI_MODEL. Pass --no-model to run the code pre-pass only.\n',
    );
    await expect(readFile(join(dir, 'map/proposal.yaml'), 'utf8')).rejects.toThrow();
  });

  it('exits 2 when a file cannot be read or the inventory is invalid', async () => {
    const dir = await project({ 'bad.yaml': 'behaviours: [{ id: B-001 }]\nflows: []\n' });
    const missing = await run(
      ['extract', '--prompt', 'nope.md', '--inventory', 'inventory.yaml', '--out', 'p.yaml'],
      dir,
    );
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/^Cannot read nope\.md: /);
    const invalid = await run(
      ['extract', '--prompt', 'prompt.md', '--inventory', 'bad.yaml', '--out', 'map/p.yaml', '--no-model'],
      dir,
    );
    expect(invalid.code).toBe(2);
    expect(invalid.err).toContain('✗ bad.yaml  behaviours.0.title  SCHEMA_INVALID_TYPE');
    expect(invalid.err).toContain('The inputs are invalid, so no proposal was written.');
  });

  it('refuses --no-model with --replay', async () => {
    const dir = await project();
    const { code, err } = await run([...base(), '--no-model', '--replay', 'answers.yaml'], dir);
    expect(code).toBe(2);
    expect(err).toBe('error: --no-model and --replay cannot be used together\n');
  });
});

describe('driftbench extract: the proposal', () => {
  it('writes the code pre-pass with --no-model and exits 0', async () => {
    const dir = await project();
    const { code, out, err } = await run([...base(), '--no-model'], dir);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out.split('\n').slice(0, 4)).toEqual([
      'Wrote map/proposal.yaml: 3 dimensions, 3 values, 0 constraints, 0 phrases, none approved.',
      '  Code pre-pass: 3 dimensions, 3 values, 0 constraints.',
      '  Roles: 2 axes (behaviour, channel), 1 details; the axes make a full grid of 1 cell.',
      '  No model call: the code pre-pass alone (--no-model).',
    ]);
    const loaded = await loadProposal(join(dir, 'map/proposal.yaml'));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    expect(loaded.proposal.agent).toBe(dir.split('/').at(-1));
    expect(loaded.proposal.produced_by).toMatchObject({ family: 'code', model: 'pre-pass' });
    expect(loaded.proposal.sources).toEqual([
      { kind: 'prompt', path: '../prompt.md' },
      { kind: 'inventory', path: '../inventory.yaml' },
    ]);
  });

  it('refuses to overwrite a proposal unless --force is given', async () => {
    const dir = await project({ 'map/proposal.yaml': 'approved by hand\n' });
    const kept = await run([...base(), '--no-model'], dir);
    expect(kept.code).toBe(2);
    expect(kept.err).toBe(
      'map/proposal.yaml already exists: pass --force to replace it (the approvals in it are lost).\n',
    );
    expect(await readFile(join(dir, 'map/proposal.yaml'), 'utf8')).toBe('approved by hand\n');
    expect((await run([...base(), '--no-model', '--force', '--agent', 'zed'], dir)).code).toBe(0);
  });

  it('replays a recording through the answer contract and exits 0 when every section answers', async () => {
    const recording = JSON.stringify({
      family: 'lane',
      model: 'by hand',
      answers: {
        stages: STAGES,
        rules: { section: 'rules' },
        personas: { section: 'personas' },
        data: { section: 'data' },
        phrases: { section: 'phrases' },
        relations: { section: 'relations' },
      },
    });
    const dir = await project({ 'answers.json': recording });
    const { code, out } = await run([...base(), '--replay', 'answers.json', '--agent', 'zed'], dir);
    expect(code).toBe(0);
    expect(out).toContain('  Model lane by hand: 6 sections, 6 calls.\n    stages     added 1 entry\n');
    const loaded = await loadProposal(join(dir, 'map/proposal.yaml'));
    expect(loaded.ok && loaded.proposal.produced_by.family).toBe('lane');
  });

  it('exits 1 and lists a failed section and a refused entry, and still writes the rest', async () => {
    const refused = {
      ...STAGES,
      dimensions: [
        {
          ...STAGES.dimensions[0],
          values: [{ id: 'help', title: 'Help', source: '../prompt.md', quote: 'Stages: help only.' }],
        },
      ],
    };
    const recording = JSON.stringify({
      family: 'lane',
      model: 'by hand',
      answers: { stages: refused, rules: ['not json', 'not json either'] },
    });
    const dir = await project({ 'answers.json': recording });
    const { code, out } = await run([...base(), '--replay', 'answers.json'], dir);
    expect(code).toBe(1);
    expect(out).toContain(
      '    rules      failed: the answer could not be read, twice: the answer is not JSON',
    );
    expect(out).toContain(
      '    personas   failed: the model call failed (exhausted: the recording holds no answer left for the personas section)',
    );
    expect(out).toContain(
      'Refused, not in the proposal:\n  stages  stage/help  the quote is not in ../prompt.md: "Stages: help only."\n',
    );
    expect((await loadProposal(join(dir, 'map/proposal.yaml'))).ok).toBe(true);
  });

  it('exits 2 on a recording it cannot read', async () => {
    const dir = await project({ 'answers.yaml': 'family: lane\n' });
    const { code, err } = await run([...base(), '--replay', 'answers.yaml'], dir);
    expect(code).toBe(2);
    expect(err).toMatch(/^Cannot use the recording answers\.yaml: /);
  });

  it('uses the port it is given, recording its family', async () => {
    const dir = await project();
    const { io, output } = capture(dir);
    const port = new FakeModelPort([
      JSON.stringify(STAGES),
      '{"section":"rules"}',
      '{"section":"personas"}',
      '{"section":"data"}',
      '{"section":"phrases"}',
      '{"section":"relations"}',
    ]);
    const code = await extractCommand(
      { prompt: ['prompt.md'], inventory: 'inventory.yaml', out: 'map/proposal.yaml' },
      io,
      { port, now: () => new Date('2026-10-11T12:00:00.000Z') },
    );
    expect(code).toBe(0);
    expect(output.out).toContain('  Model fake fake-model: 6 sections, 6 calls.');
    const text = await readFile(join(dir, 'map/proposal.yaml'), 'utf8');
    expect(text).toContain(
      'produced_by:\n  family: fake\n  model: fake-model\n  at: 2026-10-11T12:00:00.000Z\n',
    );
  });

  it('runs the pre-pass on the Acme example', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-acme-'));
    const { code, out } = await run(
      [
        'extract',
        '--prompt',
        join(ACME, 'src/policy.ts'),
        '--inventory',
        join(ACME, 'inventory.yaml'),
        '--tools',
        join(ACME, 'map/tools.yaml'),
        '--no-model',
        '--out',
        'proposal.yaml',
      ],
      dir,
    );
    expect(code).toBe(0);
    expect(out).toMatch(
      /^Wrote proposal\.yaml: 34 dimensions, 91 values, 55 constraints, 0 phrases, 7 relations, none approved\./,
    );
    const loaded = await loadProposal(join(dir, 'proposal.yaml'));
    expect(loaded.ok && loaded.proposal.agent).toBe('acme');
  });
});

describe('driftbench extract approve', () => {
  async function withProposal() {
    const dir = await project();
    await run([...base(), '--no-model', '--agent', 'zed'], dir);
    return dir;
  }

  it('lists the decisions left, one per dimension, with the axis grid, and exits 0', async () => {
    const dir = await withProposal();
    const { code, out } = await run(['extract', 'approve', 'map/proposal.yaml'], dir);
    expect(code).toBe(0);
    expect(out).toBe(
      [
        'map/proposal.yaml: 3 of 3 decisions are open (3 dimensions, 0 constraints, 0 phrases).',
        'Axes: 2 of 3 dimensions, a full grid of 1 cell (the space commands accept 250000).',
        '  dimension  behaviour  behaviour axis, by code, 1 value: The behaviours the inventory lists',
        '  dimension  flow  behaviour detail, by code, 1 value: The flows the inventory lists',
        '  dimension  channel  channel axis, by code, 1 value: The channels the inventory names',
        'Approve a dimension and its values with --dimension <id>, or every entry with --all. In the file, set',
        'approved: true; a value may set its own flag, and role: axis or detail decides what enters the space map.',
        '',
      ].join('\n'),
    );
  });

  it('approves everything with --all, prints the count, and then has nothing left', async () => {
    const dir = await withProposal();
    const all = await run(['extract', 'approve', 'map/proposal.yaml', '--all'], dir);
    expect(all.code).toBe(0);
    expect(all.out).toBe('Approved 3 flags in map/proposal.yaml; 0 were already set.\n');
    const again = await run(['extract', 'approve', 'map/proposal.yaml'], dir);
    expect(again.out).toBe(
      'map/proposal.yaml: all 3 decisions are made.\nAxes: 2 of 3 dimensions, a full grid of 1 cell (the space commands accept 250000).\n',
    );
    const loaded = await loadProposal(join(dir, 'map/proposal.yaml'));
    expect(loaded.ok && loaded.proposal.dimensions.every((d) => d.approved)).toBe(true);
  });

  it('approves dimensions by id, writes to another file with --to, and refuses an unknown id', async () => {
    const dir = await withProposal();
    const some = await run(
      [
        'extract',
        'approve',
        'map/proposal.yaml',
        '--dimension',
        'channel',
        '--dimension',
        'flow',
        '--to',
        'map/approved.yaml',
      ],
      dir,
    );
    expect(some.code).toBe(0);
    expect(some.out).toBe('Approved 2 dimensions in map/approved.yaml: flow, channel.\n');
    const written = await loadProposal(join(dir, 'map/approved.yaml'));
    expect(written.ok && written.proposal.dimensions.map((d) => [d.id, d.approved])).toEqual([
      ['behaviour', false],
      ['flow', true],
      ['channel', true],
    ]);
    const untouched = await loadProposal(join(dir, 'map/proposal.yaml'));
    expect(untouched.ok && untouched.proposal.dimensions.every((d) => !d.approved)).toBe(true);
    const unknown = await run(['extract', 'approve', 'map/proposal.yaml', '--dimension', 'mood'], dir);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain('PROPOSAL_UNKNOWN_DIMENSION  dimension "mood" is not in the proposal');
    const both = await run(['extract', 'approve', 'map/proposal.yaml', '--all', '--dimension', 'flow'], dir);
    expect(both.code).toBe(2);
    const away = await run(
      ['extract', 'approve', 'map/proposal.yaml', '--all', '--to', 'elsewhere.yaml'],
      dir,
    );
    expect(away.code).toBe(2);
    expect(away.err).toBe(
      'error: --to must stay in the folder of the proposal, where its source paths resolve\n',
    );
  });

  it('exits 1 on a proposal where an entry lost its evidence, and approves nothing', async () => {
    const dir = await withProposal();
    const path = join(dir, 'map/proposal.yaml');
    const text = await readFile(path, 'utf8');
    const broken = text.replace(
      /\n {8}evidence:\n {10}source: \.\.\/inventory\.yaml\n {10}quote: "channels: \[chat\]"/,
      '',
    );
    expect(broken).not.toBe(text);
    await writeFile(path, broken);
    const { code, err } = await run(['extract', 'approve', 'map/proposal.yaml', '--all'], dir);
    expect(code).toBe(1);
    expect(err).toContain('dimensions.2.values.0.evidence  PROPOSAL_EVIDENCE_MISSING');
    expect(err).toContain('The proposal is invalid, so nothing was approved.');
    expect(await readFile(path, 'utf8')).toBe(broken);
  });

  it('exits 1 when a quote is no longer in its source', async () => {
    const dir = await withProposal();
    await writeFile(
      join(dir, 'inventory.yaml'),
      INVENTORY.replace('channels: [chat]', 'channels: [chat, sms]'),
    );
    const { code, err } = await run(['extract', 'approve', 'map/proposal.yaml'], dir);
    expect(code).toBe(1);
    expect(err).toContain('dimensions.2.values.0.evidence.quote  PROPOSAL_QUOTE_NOT_FOUND');
  });

  it('exits 2 when the file does not exist', async () => {
    const dir = await project();
    const { code, err } = await run(['extract', 'approve', 'missing.yaml'], dir);
    expect(code).toBe(2);
    expect(err).toBe('Cannot find missing.yaml.\n');
  });
});

describe('driftbench extract map', () => {
  it('writes the space map of the approved axes, which driftbench space reads', async () => {
    const dir = await project();
    await run([...base(), '--no-model', '--agent', 'zed'], dir);
    const none = await run(['extract', 'map', 'map/proposal.yaml', '--to', 'map/space.yaml'], dir);
    expect(none.code).toBe(1);
    expect(none.err).toContain('(no approved axis dimension)');
    await run(['extract', 'approve', 'map/proposal.yaml', '--all'], dir);
    const map = await run(['extract', 'map', 'map/proposal.yaml', '--to', 'map/space.yaml'], dir);
    expect(map.code).toBe(0);
    expect(map.out).toBe(
      'Wrote map/space.yaml: 2 axes (behaviour, channel), 0 constraints, a full grid of 1 cell.\n',
    );
    const coverage = await run(['space', 'coverage', '--map', 'map/space.yaml', 'map', '--t', '2'], dir);
    expect(coverage.err).not.toContain('over the limit');
    expect(coverage.out.split('\n')[0]).toBe(
      'Map zed, version 1: 2 dimensions, 1 cells, 0 constraints, prior uniform (no weight declared)',
    );
  });

  it('pins docs/reference/cli.md: a proposal is not a space map, the space commands read it through extract map', async () => {
    const dir = await project();
    await run([...base(), '--no-model', '--agent', 'zed'], dir);
    const direct = await run(['space', 'coverage', '--map', 'map/proposal.yaml', 'map', '--t', '2'], dir);
    expect(direct.code).toBe(2);
    const doc = await readFile(join(ACME, '../../docs/reference/cli.md'), 'utf8');
    expect(doc).toContain('The proposal is not a space map');
    expect(doc).not.toContain('The proposal is a valid space map');
  });

  it('runs space coverage on the Acme approved map without a grid refusal', async () => {
    const { code, out, err } = await run(
      ['space', 'coverage', '--map', join(ACME, 'map/space.yaml'), join(ACME, 'specs'), '--t', '2'],
      ACME,
    );
    expect(err).not.toContain('over the limit');
    expect(code).toBe(1);
    expect(out.split('\n')[0]).toBe(
      'Map acme, version 1: 7 dimensions, 212940 cells, 380 constraints, prior uniform (no weight declared)',
    );
  });
});
