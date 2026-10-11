import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeModelPort, loadProposal } from '@driftbench/generate';
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
    expect(out.split('\n').slice(0, 3)).toEqual([
      'Wrote map/proposal.yaml: 3 dimensions, 3 values, 0 constraints, 0 phrases, none approved.',
      '  Code pre-pass: 3 dimensions, 3 values, 0 constraints.',
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
      },
    });
    const dir = await project({ 'answers.json': recording });
    const { code, out } = await run([...base(), '--replay', 'answers.json', '--agent', 'zed'], dir);
    expect(code).toBe(0);
    expect(out).toContain('  Model lane by hand: 5 sections, 5 calls.\n    stages    added 1 entry\n');
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
      '    rules     failed: the answer could not be read, twice: the answer is not JSON',
    );
    expect(out).toContain(
      '    personas  failed: the model call failed (exhausted: the recording holds no answer left for the personas section)',
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
    ]);
    const code = await extractCommand(
      { prompt: ['prompt.md'], inventory: 'inventory.yaml', out: 'map/proposal.yaml' },
      io,
      { port, now: () => new Date('2026-10-11T12:00:00.000Z') },
    );
    expect(code).toBe(0);
    expect(output.out).toContain('  Model fake fake-model: 5 sections, 5 calls.');
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
      /^Wrote proposal\.yaml: 29 dimensions, 86 values, 3 constraints, 0 phrases, none approved\./,
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

  it('lists what is not approved yet and exits 0', async () => {
    const dir = await withProposal();
    const { code, out } = await run(['extract', 'approve', 'map/proposal.yaml'], dir);
    expect(code).toBe(0);
    expect(out).toBe(
      [
        'map/proposal.yaml: 3 of 3 entries are not approved yet.',
        '  value  behaviour/B-001  Verify the customer before any balance',
        '         ../inventory.yaml: "id: B-001 title: Verify the customer before any balance"',
        '  value  flow/balance  A customer asks for their balance',
        '         ../inventory.yaml: "id: balance title: A customer asks for their balance behaviours: [B-001]"',
        '  value  channel/chat  On chat',
        '         ../inventory.yaml: "channels: [chat]"',
        'Set approved: true on each entry you accept, or approve every entry with --all.',
        '',
      ].join('\n'),
    );
  });

  it('approves everything with --all, prints the count, and then has nothing left', async () => {
    const dir = await withProposal();
    const all = await run(['extract', 'approve', 'map/proposal.yaml', '--all'], dir);
    expect(all.code).toBe(0);
    expect(all.out).toBe('Approved 3 entries in map/proposal.yaml; 0 were already approved.\n');
    const again = await run(['extract', 'approve', 'map/proposal.yaml'], dir);
    expect(again.out).toBe('map/proposal.yaml: all 3 entries are approved.\n');
    const loaded = await loadProposal(join(dir, 'map/proposal.yaml'));
    expect(loaded.ok && loaded.proposal.dimensions.every((d) => d.values.every((v) => v.approved))).toBe(
      true,
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
