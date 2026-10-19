import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

async function project(files: Record<string, string>) {
  const dir = await tempFolder('driftbench-space-');
  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), text);
  }
  return dir;
}

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Three dimensions of two values; a loose yes never comes on whatsapp; a loose yes is required. */
const MAP = `version: '1'
agent: hand
inventory: inventory.yaml
dimensions:
  - id: stage
    title: Stage
    kind: stage
    values:
      - { id: a, title: Stage a, weight: 3 }
      - { id: b, title: Stage b, weight: 1 }
  - id: deviation
    title: Deviation
    kind: deviation
    values:
      - { id: none, title: No deviation, weight: 9 }
      - { id: D4_loose_confirmation, title: A loose yes, weight: 1, required: true }
  - id: channel
    title: Channel
    kind: channel
    values:
      - { id: chat, title: Chat }
      - { id: whatsapp, title: WhatsApp }
constraints:
  - forbid: { deviation: D4_loose_confirmation, channel: whatsapp }
    reason: No confirmation step on whatsapp.
prior: { kind: declared }
`;

const INVENTORY = `channels: [chat, whatsapp]
behaviours:
  - { id: B-001, title: Asks for an explicit yes }
flows:
  - { id: confirm, title: Confirmation, behaviours: [B-001], deviations: [D4_loose_confirmation] }
`;

const S1 = `id: s1
channel: chat
stages: [a, b]
blocks:
  - { user: hi, expect: { stage: a } }
  - { user: next, expect: { stage: b } }
`;

const S2 = `id: s2
channel: chat
covers: [B-001]
stages: [a, b]
blocks:
  - { user: hi, expect: { stage: a } }
perturbations:
  - { id: loose, class: D4_loose_confirmation, inject_at: 1, user: ok, recovery: { within_blocks: 0 } }
`;

const S2_CALM = S2.slice(0, S2.indexOf('perturbations:'));

const FILES = { 'space.yaml': MAP, 'inventory.yaml': INVENTORY, 'specs/s1.yaml': S1, 'specs/s2.yaml': S2 };
const coverage = (...args: string[]) => ['space', 'coverage', 'specs', '--map', 'space.yaml', ...args];
const complete = (...args: string[]) => ['space', 'complete', ...args];

describe('driftbench space coverage', () => {
  it('prints the dimensions, the grid, the shares and the required cells; exit 0 when all are covered', async () => {
    const dir = await project(FILES);
    const { code, out, err } = await run(coverage(), dir);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toBe(
      [
        'Map hand, version 1: 3 dimensions, 8 cells, 1 constraint, prior declared',
        '',
        'Dimensions',
        '  id         kind       values  covered  not covered',
        '  stage      stage      2       2',
        '  deviation  deviation  2       2',
        '  channel    channel    2       1        whatsapp',
        '',
        'Full grid: every cell holds one value of each of the 3 dimensions',
        '  cells     6 allowed of 8 (2 forbidden by the constraints)',
        '  covered   3 (50.0%)',
        '  weighted  51.3% of the declared user mix, effective sample size 2.0 of 2 specs',
        '',
        't-wise coverage',
        '  t = 2  7 of 11 allowed pairs (63.6%)',
        '  t = 3  3 of 6 allowed triples (50.0%)',
        '',
        'Required cells',
        '  ✓  deviation=D4_loose_confirmation       s2',
        '  ✓  flow confirm · D4_loose_confirmation  s2',
        '',
        'Coverage: 2 of 2 required cells covered, 3 of 6 cells in the full grid (50.0%).',
        '',
      ].join('\n'),
    );
  });

  it('exits 1 when a required cell is empty, from the map or from the inventory it names', async () => {
    const dir = await project({ ...FILES, 'specs/s2.yaml': S2_CALM });
    const { code, out } = await run(coverage(), dir);
    expect(code).toBe(1);
    expect(out).toContain('  ✗  deviation=D4_loose_confirmation       no spec\n');
    expect(out).toContain('  ✗  flow confirm · D4_loose_confirmation  no spec\n');
    expect(out).toContain('Coverage: 0 of 2 required cells covered');
  });

  it('says in its help that --t runs from 1 to the number of dimensions', async () => {
    const { code, out } = await run(['space', 'coverage', '--help'], process.cwd());
    expect(code).toBe(0);
    expect(out.replace(/\s+/g, ' ')).toContain(
      'cells on every subset of n dimensions, n from 1 to the number of dimensions; default: the full grid',
    );
    expect(out).not.toContain('2 or 3');
  });

  it('prints the grid at t = 2 with --t 2', async () => {
    const dir = await project(FILES);
    const { code, out } = await run(coverage('--t', '2'), dir);
    expect(code).toBe(0);
    expect(out).toContain(
      [
        'Grid at t = 2: 3 subsets of 2 dimensions',
        '  cells     11 allowed of 12 (1 forbidden by the constraints)',
        '  covered   7 (63.6%)',
      ].join('\n'),
    );
    expect(out).toContain('Coverage: 2 of 2 required cells covered, 7 of 11 cells at t = 2 (63.6%).\n');
  });

  it('prints one JSON document with the same facts under --json', async () => {
    const dir = await project(FILES);
    const { code, out } = await run(coverage('--json'), dir);
    expect(code).toBe(0);
    const report = JSON.parse(out) as Record<string, unknown> & {
      grid: { allowed: number; covered: number; cells: unknown[] };
      specs: Array<{ id: string; path: string }>;
    };
    expect(Object.keys(report)).toEqual([
      'map',
      'inventory',
      'agent',
      'version',
      'prior',
      'constraints',
      'dimensions',
      'grid',
      'tway',
      'required',
      'specs',
      'warnings',
      'invalidSpecs',
      'ok',
    ]);
    expect(report).toMatchObject({
      map: 'space.yaml',
      inventory: 'inventory.yaml',
      constraints: 1,
      ok: true,
    });
    expect(report.grid).toMatchObject({ allowed: 6, covered: 3 });
    expect(report.grid.cells).toHaveLength(6);
    expect(report.specs.map((spec) => spec.path)).toEqual(['specs/s1.yaml', 'specs/s2.yaml']);
  });

  it('prints the Acme map on the Acme specs and exits 1 on the deviations the inventory misses', async () => {
    const { code, out } = await run(
      [
        'space',
        'coverage',
        'examples/acme/specs',
        '--map',
        'packages/space/test/fixtures/acme-space.yaml',
        '--t',
        '2',
      ],
      ROOT,
    );
    expect(code).toBe(1);
    expect(out).toContain('  cells     818 allowed of 823 (5 forbidden by the constraints)\n');
    expect(out).toContain(
      '  ✓  stage=recap · deviation=D4_loose_confirmation  acme-order-loose-confirmation, acme-plan-upgrade\n',
    );
    expect(out).toContain('  ✗  flow new-home · D5_language_switch             no spec\n');
    expect(out).toContain('Coverage: 8 of 11 required cells covered');
  });
});

describe('driftbench space coverage refuses bad input with exit 2', () => {
  it('when --map is missing', async () => {
    const dir = await project(FILES);
    const { code, err } = await run(['space', 'coverage', 'specs'], dir);
    expect(code).toBe(2);
    expect(err).toContain("required option '--map <file>' not specified");
  });

  it('when the map is invalid, naming each problem', async () => {
    const dir = await project({
      ...FILES,
      'space.yaml': MAP.replace('channel: whatsapp }', 'channel: fax }'),
    });
    const { code, out, err } = await run(coverage(), dir);
    expect(code).toBe(2);
    expect(out).toBe('');
    expect(err).toBe(
      [
        '✗ space.yaml',
        '  constraints.0.forbid.channel  SPACE_UNKNOWN_VALUE  "channel" has no value "fax"',
        'The map is invalid, so coverage was not computed.',
        '',
      ].join('\n'),
    );
  });

  it('when t is not a whole number from 1 to the number of dimensions', async () => {
    const dir = await project(FILES);
    for (const t of ['4', '0', 'two']) {
      const { code, err } = await run(coverage('--t', t), dir);
      expect(code).toBe(2);
      expect(err).toBe(`Unknown t "${t}". The map has 3 dimensions, so t is a whole number from 1 to 3.\n`);
    }
  });

  it('when the inventory the map names cannot be read', async () => {
    const dir = await project({ ...FILES, 'space.yaml': MAP.replace('inventory.yaml', 'missing.yaml') });
    const { code, err } = await run(coverage(), dir);
    expect(code).toBe(2);
    expect(err).toContain('✗ missing.yaml\n  (file)  INVENTORY_PARSE  cannot read the file');
    expect(err).toContain('The inventory the map names is invalid, so coverage was not computed.\n');
  });

  it('when a spec path does not exist, or no spec file is found', async () => {
    const dir = await project({ ...FILES, 'notes/readme.txt': 'nothing here' });
    const missing = await run(['space', 'coverage', 'nope.yaml', '--map', 'space.yaml'], dir);
    expect(missing).toMatchObject({ code: 2, err: 'Cannot find nope.yaml.\n' });
    const none = await run(['space', 'coverage', 'notes', '--map', 'space.yaml'], dir);
    expect(none).toMatchObject({ code: 2, err: 'No spec files found.\n' });
  });

  it('when the full grid is over the limit', async () => {
    const big = Array.from({ length: 6 }, (_, index) => {
      const values = Array.from(
        { length: 8 },
        (_, value) => `      - { id: v${index}${value}, title: Value }`,
      );
      return [`  - id: d${index}`, '    title: Dimension', '    kind: data', '    values:', ...values].join(
        '\n',
      );
    }).join('\n');
    const map = `version: '1'\nagent: big\ndimensions:\n${big}\nconstraints: []\nprior: { kind: declared }\n`;
    const dir = await project({ ...FILES, 'space.yaml': map });
    const { code, err } = await run(coverage(), dir);
    expect(code).toBe(2);
    expect(err).toBe(
      'The full grid has 262144 cells, over the limit of 250000. Merge values or split the map.\n',
    );
  });
});

/** Two stages and three conversations: v1 in all three, v2 in one. n = 3 for 2 cells; f1 = 1, f2 = 0. */
const SAMPLE = {
  'space.yaml': `version: '1'
agent: sample
dimensions:
  - id: stage
    title: Stage
    kind: stage
    values: [{ id: v1, title: v1 }, { id: v2, title: v2 }]
constraints: []
prior: { kind: declared }
`,
  'specs/u1.yaml': 'id: u1\nblocks:\n  - { user: hi, expect: { stage: v1 } }\n',
  'specs/u2.yaml': 'id: u2\nblocks:\n  - { user: hi, expect: { stage: v1 } }\n',
  'specs/u3.yaml':
    'id: u3\nblocks:\n  - { user: hi, expect: { stage: v1 } }\n  - { user: next, expect: { stage: v2 } }\n',
};

describe('driftbench space complete', () => {
  it('prints the completeness line with its sentence and assumption, and exits 0', async () => {
    const dir = await project(SAMPLE);
    const { code, out, err } = await run(complete('specs', '--map', 'space.yaml'), dir);
    expect(err).toBe('');
    expect(code).toBe(0);
    // C = 1 - (1 / 3) * [2 * 1 / (2 * 1 + 0)] = 2 / 3; U = 1 / 3.
    expect(out).toMatch(/^Completeness over the full grid: 2 cells, 3 conversations\n/);
    expect(out).toContain('  seen             2 cells; f1 1, f2 0\n');
    expect(out).toMatch(/ {2}sample coverage {2}66\.7% \(95% interval \d+\.\d% to \d+\.\d%\), Chao form\n/);
    expect(out).toMatch(
      / {2}discovery {8}33\.3% \(95% interval \d+\.\d% to \d+\.\d%\), Good-Turing f1 \/ n\n/,
    );
    expect(out).toContain('  bootstrap        2000 resamples of the conversations, seed 1\n');
    expect(out).toContain(
      '\nAbout 67 percent of the interaction classes have appeared; the chance that the next conversation shows a new one is about 33 percent.\n',
    );
    expect(out).toContain(
      'assume independent conversations from a generator that does not learn from results',
    );
  });

  it('says why it cannot print with fewer conversations than cells, and exits 1', async () => {
    const dir = await project(FILES);
    const { code, out } = await run(complete('specs', '--map', 'space.yaml'), dir);
    expect(code).toBe(1);
    expect(out).toContain(
      'No completeness line: the estimate needs at least as many conversations as cells, and there are 2 for 6.\n',
    );
    expect(out).not.toContain('percent of the interaction classes');
  });

  it('prints one JSON document under --json, with the assumption when the line is given', async () => {
    const dir = await project(SAMPLE);
    const { code, out } = await run(complete('specs', '--map', 'space.yaml', '--json'), dir);
    expect(code).toBe(0);
    const report = JSON.parse(out) as Record<string, unknown>;
    expect(report).toMatchObject({
      map: 'space.yaml',
      conversations: 3,
      cells: 2,
      f1: 1,
      f2: 0,
      printable: true,
    });
    expect(report.assumption).toMatch(/^The figures assume independent conversations/);
  });

  it('refuses an invalid map with exit 2', async () => {
    const dir = await project({ ...SAMPLE, 'space.yaml': 'agent: [' });
    const { code, err } = await run(complete('specs', '--map', 'space.yaml'), dir);
    expect(code).toBe(2);
    expect(err).toContain('SPACE_PARSE');
    expect(err).toContain('The map is invalid, so completeness was not computed.\n');
  });
});

describe('driftbench space declare', () => {
  it('writes a map seeded from the inventory and the specs, that coverage then reads', async () => {
    const dir = await project({ 'inventory.yaml': INVENTORY, 'specs/s1.yaml': S1, 'specs/s2.yaml': S2 });
    const declared = await run(
      [
        'space',
        'declare',
        'specs',
        '--inventory',
        'inventory.yaml',
        '--out',
        'maps/space.yaml',
        '--agent',
        'hand',
      ],
      dir,
    );
    expect(declared).toMatchObject({ code: 0, err: '' });
    expect(declared.out).toBe('Wrote maps/space.yaml: 4 dimensions, 8 cells, 0 constraints.\n');
    const text = await readFile(join(dir, 'maps/space.yaml'), 'utf8');
    expect(text.split('\n').slice(0, 3)).toEqual([
      '# The map of situations hand can face, seeded by driftbench space declare.',
      '# Edit it: add persona, data or task dimensions, impossible combinations and weights.',
      "version: '1'",
    ]);
    expect(text).toContain('inventory: ../inventory.yaml\n');
    const counted = await run(['space', 'coverage', 'specs', '--map', 'maps/space.yaml'], dir);
    expect(counted.code).toBe(0);
    expect(counted.out).toContain('  ✓  flow confirm · D4_loose_confirmation  s2\n');
  });

  it('never overwrites an existing map', async () => {
    const dir = await project({ ...FILES });
    const { code, err } = await run(
      ['space', 'declare', 'specs', '--inventory', 'inventory.yaml', '--out', 'space.yaml'],
      dir,
    );
    expect(code).toBe(2);
    expect(err).toBe(
      'space.yaml already exists. The map is never overwritten: remove it or pick another path.\n',
    );
    expect(await readFile(join(dir, 'space.yaml'), 'utf8')).toBe(MAP);
  });

  it('refuses an invalid inventory with exit 2', async () => {
    const dir = await project({ ...FILES, 'inventory.yaml': 'behaviours: oops\n' });
    const { code, err } = await run(
      ['space', 'declare', 'specs', '--inventory', 'inventory.yaml', '--out', 'new.yaml'],
      dir,
    );
    expect(code).toBe(2);
    expect(err).toContain('The inventory is invalid, so no map was written.\n');
  });
});
