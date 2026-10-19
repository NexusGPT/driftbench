import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempFolder } from '../../../tools/test-setup/temp-folders';
import { type Io, main } from '../src/index';

async function run(argv: string[], cwd: string) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, out, err };
}

/** The synthetic inventory and specs the core coverage tests use. */
const FIXTURES = fileURLToPath(new URL('../../core/test/coverage/fixtures/', import.meta.url));

async function project(files: Record<string, string>) {
  const dir = await tempFolder('driftbench-coverage-');
  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), text);
  }
  return dir;
}

const INVENTORY = `channels: [chat]
behaviours:
  - { id: B-001, title: Greets once }
flows:
  - { id: greet, title: Greeting, behaviours: [B-001], deviations: [D1_off_topic] }
`;

const SPEC = `id: hello
channel: chat
covers: [B-001]
blocks:
  - user: hi
    expect: { must: [hello] }
`;

const PERTURBED = `${SPEC}perturbations:
  - { id: aside, class: D1_off_topic, inject_at: 1, user: is the shop open?, recovery: { within_blocks: 1 } }
`;

const coverage = (...args: string[]) => ['spec', 'coverage', ...args];

describe('driftbench spec coverage', () => {
  it('exits 0 and prints both matrices when every required cell is covered', async () => {
    const dir = await project({ 'inventory.yaml': INVENTORY, 'specs/hello.yaml': PERTURBED });
    const { code, out, err } = await run(coverage('specs', '--inventory', 'inventory.yaml'), dir);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toBe(
      [
        'Behaviours by channel',
        '     id     kind          chat     title',
        '  ✓  B-001  conversation  covered  Greets once',
        '     total                1 of 1',
        '',
        'Flows by required deviation',
        '  ✓  greet  1 spec  D1_off_topic covered  Greeting',
        '',
        'Coverage: 1 of 1 behaviours covered, 1 of 1 flow deviations covered.',
        '',
      ].join('\n'),
    );
  });

  it('exits 1 when only a required deviation is missing', async () => {
    const dir = await project({ 'inventory.yaml': INVENTORY, 'specs/hello.yaml': SPEC });
    const { code, out } = await run(coverage('specs', '--inventory', 'inventory.yaml'), dir);
    expect(code).toBe(1);
    expect(out).toContain('  ✗  greet  1 spec  D1_off_topic missing  Greeting\n');
    expect(out).toContain('Coverage: 1 of 1 behaviours covered, 0 of 1 flow deviations covered.\n');
  });

  it('prints the matrices of the synthetic inventory and exits 1 on its missing cells', async () => {
    const { code, out, err } = await run(coverage('specs', '--inventory', 'inventory.yaml'), FIXTURES);
    expect(err).toBe('');
    expect(code).toBe(1);
    expect(out).toBe(
      [
        'Behaviours by channel',
        '     id     kind          chat     whatsapp  title',
        '  ✓  B-001  conversation  covered  covered   Greets the customer once and names the assistant',
        '  ✓  B-002  conversation  covered  covered   Looks up the available plans before quoting a price',
        '  ✓  B-003  conversation  covered  n/a       Sends the offer card once',
        '  ✗  B-004  conversation  covered  missing   Asks for an explicit yes before submitting the order',
        '  ✓  T-001  task          covered  covered   Builds the monthly usage sheet with one tab per line',
        '     total                5 of 5   3 of 4',
        '',
        'Flows by required deviation',
        '  ✓  plan-upgrade  2 specs  D1_off_topic covered · D4_loose_confirmation covered  Plan upgrade from greeting to submission',
        '  ✗  usage-report  1 spec   D2_goal_shift covered · D8_tool_failure missing       Monthly usage report built in the workspace',
        '  -  offer-card    1 spec   no deviation required                                 Offer card on chat',
        '',
        'Warnings',
        '  ! B-099  UNKNOWN_BEHAVIOUR  covered by stray, but the inventory has no behaviour B-099',
        '',
        'Invalid specs, not counted',
        '  ✗ specs/broken.yaml  blocks.0  BLOCK_STIMULUS_MISSING  a block needs `user`, `burst` or `when`',
        '',
        'Coverage: 4 of 5 behaviours covered, 3 of 4 flow deviations covered.',
        '',
      ].join('\n'),
    );
  });

  it('limits the matrix to one channel with --channel', async () => {
    const { code, out } = await run(
      coverage('specs', '--inventory', 'inventory.yaml', '--channel', 'whatsapp'),
      FIXTURES,
    );
    expect(code).toBe(1);
    expect(out).toContain('     id     kind          whatsapp  title\n');
    expect(out).toContain('  -  B-003  conversation  n/a       Sends the offer card once\n');
    expect(out).toContain('D1_off_topic missing · D4_loose_confirmation covered');
    expect(out).toContain('Coverage: 3 of 4 behaviours covered, 2 of 4 flow deviations covered.\n');
  });

  it('prints one JSON document with the same facts under --json', async () => {
    const { code, out } = await run(coverage('specs', '--inventory', 'inventory.yaml', '--json'), FIXTURES);
    expect(code).toBe(1);
    const report = JSON.parse(out) as {
      inventory: string;
      channels: string[];
      behaviours: Array<{ id: string; kind: string; status: string; cells: unknown[] }>;
      perChannel: unknown[];
      flows: unknown[];
      warnings: unknown[];
      invalidSpecs: unknown[];
      summary: unknown;
      ok: boolean;
    };
    expect(Object.keys(report)).toEqual([
      'inventory',
      'channels',
      'behaviours',
      'perChannel',
      'flows',
      'warnings',
      'invalidSpecs',
      'summary',
      'ok',
    ]);
    expect(report.inventory).toBe('inventory.yaml');
    expect(report.channels).toEqual(['chat', 'whatsapp']);
    expect(report.behaviours.find((row) => row.id === 'B-004')?.cells).toEqual([
      { channel: 'chat', status: 'covered', specs: ['upgrade-chat'] },
      { channel: 'whatsapp', status: 'missing', specs: [] },
    ]);
    expect(report.behaviours.find((row) => row.id === 'T-001')?.kind).toBe('task');
    expect(report.perChannel[1]).toEqual({ channel: 'whatsapp', applicable: 4, covered: 3, missing: 1 });
    // Each deviation cell names its sources: a perturbation, or a block whose stimulus is an injection.
    expect(report.flows[0]).toMatchObject({
      id: 'plan-upgrade',
      cells: [
        { sources: [{ spec: 'upgrade-chat', source: 'perturbation', path: 'perturbations.0' }] },
        { sources: [{ spec: 'upgrade-whatsapp', source: 'perturbation', path: 'perturbations.0' }] },
      ],
    });
    expect(report.flows[1]).toEqual({
      id: 'usage-report',
      title: 'Monthly usage report built in the workspace',
      status: 'missing',
      specs: ['usage-report'],
      cells: [
        {
          deviation: 'D2_goal_shift',
          status: 'covered',
          specs: ['usage-report'],
          sources: [{ spec: 'usage-report', source: 'injection', path: 'blocks.1' }],
        },
        { deviation: 'D8_tool_failure', status: 'missing', specs: [], sources: [] },
      ],
    });
    expect(report.warnings).toMatchObject([
      { code: 'UNKNOWN_BEHAVIOUR', subject: 'B-099', specs: ['stray'] },
    ]);
    expect(report.invalidSpecs).toMatchObject([
      { path: 'specs/broken.yaml', error: { code: 'BLOCK_STIMULUS_MISSING' } },
    ]);
    expect(report.summary).toEqual({
      behaviours: { covered: 4, total: 5 },
      deviations: { covered: 3, total: 4 },
    });
    expect(report.ok).toBe(false);
  });

  it('exits 0 under --json when everything is covered', async () => {
    const dir = await project({ 'inventory.yaml': INVENTORY, 'specs/hello.yaml': PERTURBED });
    const { code, out } = await run(coverage('specs', '--inventory', 'inventory.yaml', '--json'), dir);
    expect(code).toBe(0);
    expect((JSON.parse(out) as { ok: boolean }).ok).toBe(true);
  });
});

describe('driftbench spec coverage refuses bad input with exit 2', () => {
  it('when --inventory is missing', async () => {
    const { code, err } = await run(coverage('specs'), FIXTURES);
    expect(code).toBe(2);
    expect(err).toContain("required option '--inventory <file>' not specified");
  });

  it('when the inventory is invalid, naming each problem', async () => {
    const dir = await project({
      'inventory.yaml': `${INVENTORY}  - { id: other, title: Other, behaviours: [B-404] }\n`,
      'specs/hello.yaml': SPEC,
    });
    const { code, out, err } = await run(coverage('specs', '--inventory', 'inventory.yaml'), dir);
    expect(code).toBe(2);
    expect(out).toBe('');
    expect(err).toBe(
      [
        '✗ inventory.yaml',
        '  flows.1.behaviours.0  INVENTORY_UNKNOWN_BEHAVIOUR  behaviour "B-404" is not in the inventory\'s behaviours',
        'The inventory is invalid, so coverage was not computed.',
        '',
      ].join('\n'),
    );
  });

  it('when the inventory file does not exist', async () => {
    const { code, err } = await run(coverage('specs', '--inventory', 'missing.yaml'), FIXTURES);
    expect(code).toBe(2);
    expect(err).toContain('INVENTORY_PARSE  cannot read the file');
  });

  it('when --channel names a channel the inventory does not have', async () => {
    const { code, out, err } = await run(
      coverage('specs', '--inventory', 'inventory.yaml', '--channel', 'email'),
      FIXTURES,
    );
    expect(code).toBe(2);
    expect(out).toBe('');
    expect(err).toBe('Unknown channel "email". The channels are: chat, whatsapp.\n');
  });

  it('when a spec path does not exist', async () => {
    const { code, err } = await run(
      coverage('specs', 'nope.yaml', '--inventory', 'inventory.yaml'),
      FIXTURES,
    );
    expect(code).toBe(2);
    expect(err).toBe('Cannot find nope.yaml.\n');
  });

  it('when no spec file is found', async () => {
    const dir = await project({ 'inventory.yaml': INVENTORY, 'notes/readme.txt': 'nothing here' });
    const { code, err } = await run(coverage('notes', '--inventory', 'inventory.yaml'), dir);
    expect(code).toBe(2);
    expect(err).toBe('No spec files found.\n');
  });
});
