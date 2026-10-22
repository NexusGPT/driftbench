import { readdirSync, readFileSync } from 'node:fs';
import { link, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lineOf } from '../src/commands/estate-live';
import { type Io, main } from '../src/index';

// Each test starts sandboxes and processes; under a full parallel suite that takes more than the default.
vi.setConfig({ testTimeout: 60_000 });

/** `driftbench estate mutate` and `estate run` on the fictional Northwind fixture, with the fake headless command. */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const MAP = join(FIXTURE, 'approved.yaml');
const R3 = 'gate.standing.read-before-edit-it';
const R7 = 'instruction.standing.r7-when-a-shipment-is-late';
const GATE = 'gate.invoice-reconcile.read-references-matching-rules-md-before';

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

const folders: string[] = [];
afterEach(async () => {
  while (folders.length > 0) await rm(folders.pop() ?? '', { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'estate-live-'));
  folders.push(dir);
  return dir;
}

describe('driftbench estate mutate', () => {
  it('writes the estate copy with the atom deleted, its map and the mutant record', async () => {
    const to = join(await folder(), 'mutant');
    const result = await run(['estate', 'mutate', MAP, '--atom', R3, '--delete', '--to', to]);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain(`Mutant: delete ${R3} in CLAUDE.md.`);
    expect((await readdir(to)).sort()).toEqual([
      '.claude',
      'CLAUDE.md',
      'driftbench.estate.yaml',
      'map.yaml',
      'mutant.json',
    ]);
    expect(await readFile(join(to, 'CLAUDE.md'), 'utf8')).not.toContain('Read a file before you edit it.');
    const record = JSON.parse(await readFile(join(to, 'mutant.json'), 'utf8'));
    const mutantMap = await loadEstateMap(join(to, 'map.yaml'));
    expect(mutantMap.ok).toBe(true);
    if (!mutantMap.ok) return;
    expect(record).toMatchObject({ atom: R3, op: 'delete', file: 'CLAUDE.md', mapHash: mutantMap.map.hash });
    const original = await loadEstateMap(MAP);
    expect(original.ok && record.originalMapHash === original.map.hash).toBe(true);
    expect(record.mapHash).not.toBe(record.originalMapHash);
  });

  it('inverts an obligation and prints the line before and after', async () => {
    const to = join(await folder(), 'mutant');
    const result = await run(['estate', 'mutate', MAP, '--atom', R7, '--invert', '--to', to, '--json']);
    expect(result.code).toBe(0);
    const record = JSON.parse(result.out);
    expect(record.after).toContain('do not tell the user');
  });

  it('refuses a missing or double mutation, an unknown atom, a quote it cannot invert, and an occupied folder', async () => {
    const base = await folder();
    const to = join(base, 'mutant');
    expect((await run(['estate', 'mutate', MAP, '--atom', R3, '--to', to])).code).toBe(2);
    expect(
      (await run(['estate', 'mutate', MAP, '--atom', R3, '--delete', '--invert', '--to', to])).code,
    ).toBe(2);
    const unknown = await run(['estate', 'mutate', MAP, '--atom', 'no.such', '--delete', '--to', to]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('not in the map');
    const json = await run([
      'estate',
      'mutate',
      MAP,
      '--atom',
      'tool.settings.deny-webfetch',
      '--invert',
      '--to',
      to,
    ]);
    expect(json.code).toBe(2);
    expect(json.err).toContain('delete it instead');
    expect(await readdir(base)).toEqual([]);
    const occupied = join(base, 'occupied');
    await run(['estate', 'mutate', MAP, '--atom', R3, '--delete', '--to', occupied]);
    expect((await run(['estate', 'mutate', MAP, '--atom', R7, '--invert', '--to', occupied])).code).toBe(2);
    const replaced = await run([
      'estate',
      'mutate',
      MAP,
      '--atom',
      R7,
      '--invert',
      '--to',
      occupied,
      '--force',
    ]);
    expect(replaced.code).toBe(0);
    const stranger = join(base, 'stranger');
    await rm(stranger, { recursive: true, force: true });
    await (await import('node:fs/promises')).mkdir(stranger);
    await writeFile(join(stranger, 'notes.txt'), 'keep me\n');
    expect(
      (await run(['estate', 'mutate', MAP, '--atom', R3, '--delete', '--to', stranger, '--force'])).code,
    ).toBe(2);
    expect(await readFile(join(stranger, 'notes.txt'), 'utf8')).toBe('keep me\n');
  });
});

const FAKE = join(FIXTURE, 'live/fake/claude.mjs');
const STATES = join(FIXTURE, 'live/states/library.json');
const LIVE = join(FIXTURE, 'generated/specs/live');

/**
 * The live spec of a test type that names an atom in a deviation cell, found by its content. Pairwise
 * specs are numbered by their row, and a new cell class renumbers them; the atom and the cell do not move.
 */
function specNaming(testType: string, atom: string, deviation = 'none'): string {
  const dir = join(LIVE, testType);
  const found = readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .sort()
    .find((name) => {
      const text = readFileSync(join(dir, name), 'utf8');
      return text.includes(`\n      - ${atom}\n`) && text.includes(`\n      deviation: ${deviation}\n`);
    });
  if (found === undefined)
    throw new Error(`no live ${testType} spec names ${atom} with deviation ${deviation}`);
  return `${testType}/${found}`;
}

/** One complete live spec per test type of the fixture's generated suite: the 14 of the proof. */
const PROOF: Record<string, string> = {
  guard_positive: specNaming('guard_positive', 'guard.settings.pretooluse-bash-guard-block-force-push'),
  journey: 'journey/estate.journey.03.yaml',
  misroute: 'misroute/estate.misroute.route.shipment-tracker.an-ask-that-fits-shipment-tracker.yaml',
  obligation: 'obligation/estate.obligation.instruction.standing.r7-when-a-shipment-is-late.yaml',
  ordered_pair:
    'ordered_pair/estate.ordered_pair.gate.invoice-reconcile.read-references-matching-rules-md-before.yaml',
  outside_trigger:
    'outside_trigger/estate.outside_trigger.instruction.standing.r7-when-a-shipment-is-late.yaml',
  register_sample:
    'register_sample/estate.register_sample.register.invoice-reconcile.end-with-one-line-per-invoice.build.yaml',
  route_near_miss:
    'route_near_miss/estate.route_near_miss.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.yaml',
  route_positive:
    'route_positive/estate.route_positive.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.1.yaml',
  skip_pressure:
    'skip_pressure/estate.skip_pressure.gate.invoice-reconcile.read-references-matching-rules-md-before.yaml',
  stage_order: 'stage_order/estate.stage_order.stage.steps.stage-do-make-the-change.yaml',
  stage_skip: 'stage_skip/estate.stage_skip.stage.steps.stage-verify-run-the-check-that.yaml',
  tool_denied: 'tool_denied/estate.tool_denied.tool.settings.deny-webfetch.yaml',
  twin: 'twin/estate.twin.instruction.standing.r7-when-a-shipment-is-late.yaml',
};

const proofSpecs = () => Object.values(PROOF).map((path) => join(LIVE, path));

type RunJson = {
  campaignId: string;
  standIn: boolean;
  pins: string[];
  notes: string[];
  runs: Array<{
    spec: string;
    status: string;
    pass: boolean;
    undecided?: boolean;
    failing: string[];
    costUsd: number | null;
  }>;
  passed: number;
  failed: number;
  undecided: number;
};

async function estateRun(estateRoot: string, specs: string[], ...extra: string[]) {
  const store = join(await folder(), 'runs.db');
  const result = await run([
    'estate',
    'run',
    ...specs,
    '--estate',
    estateRoot,
    '--runtime',
    'claude-code',
    '--command',
    FAKE,
    '--set-env',
    `FAKE_MANIFEST=${join(FIXTURE, 'live/fake/manifest.json')}`,
    '--store',
    store,
    '--states',
    STATES,
    '--json',
    ...extra,
  ]);
  return { ...result, store, json: result.out === '' ? undefined : (JSON.parse(result.out) as RunJson) };
}

/** Pass, fail or the run status per spec id. */
function outcomes(json: RunJson | undefined): Record<string, string> {
  return Object.fromEntries(
    (json?.runs ?? []).map((line) => [
      line.spec,
      line.status === 'completed' ? (line.pass ? 'pass' : 'fail') : line.status,
    ]),
  );
}

/** The ids of the proof specs whose metadata names the atom. */
async function specsOfAtom(atom: string): Promise<string[]> {
  const { loadSpecFile } = await import('@agent-nexus/driftbench-core');
  const out: string[] = [];
  for (const path of proofSpecs()) {
    const loaded = await loadSpecFile(path);
    if (!loaded.ok) throw new Error(path);
    const estate = loaded.spec.metadata?.estate as { atoms?: string[] } | undefined;
    if (estate?.atoms?.includes(atom)) out.push(loaded.spec.id);
  }
  return out.sort();
}

describe('driftbench estate run', () => {
  it('refuses a command that is not a stand-in unless the run is allowed to be billed', async () => {
    const store = join(await folder(), 'runs.db');
    const spec = join(LIVE, PROOF.route_positive ?? '');
    const base = ['estate', 'run', spec, '--estate', FIXTURE, '--runtime', 'claude-code', '--store', store];
    const bare = await run(base);
    expect(bare.code).toBe(2);
    expect(bare.err).toContain('claude is not a stand-in');
    const other = await run([...base, '--command', '/bin/echo']);
    expect(other.code).toBe(2);
    expect(other.err).toContain('billed');
  });

  it('refuses another runtime, an estate that is not a folder, and an estate that drifted from its map', async () => {
    const spec = join(LIVE, PROOF.route_positive ?? '');
    expect((await estateRun(FIXTURE, [spec], '--runtime', 'nexus')).code).toBe(2);
    expect((await estateRun(join(FIXTURE, 'nowhere'), [spec])).code).toBe(2);
    const copy = join(await folder(), 'estate');
    const { cp } = await import('node:fs/promises');
    await cp(join(FIXTURE, 'CLAUDE.md'), join(copy, 'CLAUDE.md'));
    await cp(join(FIXTURE, '.claude'), join(copy, '.claude'), { recursive: true });
    await writeFile(join(copy, 'CLAUDE.md'), '# Another estate\n');
    const drifted = await estateRun(copy, [spec], '--map', MAP);
    expect(drifted.code).toBe(2);
    expect(drifted.err).toContain('does not match the map');
  });

  it('runs specs through the fake command into the store, pinned to the map, with the cost the stream reports', async () => {
    const specs = [PROOF.route_positive, PROOF.tool_denied].map((path) => join(LIVE, path ?? ''));
    const result = await estateRun(FIXTURE, specs, '--map', MAP);
    expect(result.err).toBe('');
    expect(result.code).toBe(1);
    const original = await loadEstateMap(MAP);
    expect(result.json?.pins).toEqual([original.ok ? original.map.hash : '']);
    expect(result.json?.standIn).toBe(true);
    expect(result.json?.runs.map((line) => [line.pass, line.failing, line.costUsd])).toEqual([
      [true, [], 0],
      [false, ['block 0: forbidden.WebFetch'], 0],
    ]);
    const { openStore } = await import('@agent-nexus/driftbench-store');
    const store = await openStore(result.store);
    const runs = await store.listRuns({ campaignId: result.json?.campaignId ?? '' });
    await store.close();
    expect(runs).toHaveLength(2);
    const guarded = runs.find(
      (entry) =>
        entry.specId === 'estate.route_positive.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.1',
    );
    expect(guarded?.blocks[0]?.observed.runtime?.skills?.map((skill) => skill.name)).toEqual([
      'invoice-reconcile',
    ]);
  });

  it('sets variables for the runtime and passes denied tools, and refuses a variable that is no NAME=VALUE', async () => {
    const dir = await folder();
    const calls = join(dir, 'calls.jsonl');
    const spec = join(LIVE, PROOF.route_positive ?? '');
    const result = await estateRun(
      FIXTURE,
      [spec],
      '--set-env',
      `FAKE_CALLS=${calls}`,
      '--set-env',
      'NEXUS_BASE_URL=http://127.0.0.1:9',
      '--disallow',
      'Read(~/.nexus-secrets/**)',
      'WebFetch',
    );
    expect(result.code).toBe(0);
    const [call] = (await readFile(calls, 'utf8'))
      .trim()
      .split('\n')
      .map((text) => JSON.parse(text));
    const argv = call.argv as string[];
    const at = argv.indexOf('--disallowed-tools');
    expect(argv.slice(at, at + 3)).toEqual(['--disallowed-tools', 'Read(~/.nexus-secrets/**)', 'WebFetch']);
    expect(argv.indexOf('-p')).toBeGreaterThan(at);
    const bad = await estateRun(FIXTURE, [spec], '--set-env', 'NOEQUALS');
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('--set-env');
  });

  it('passes --model, --max-turns, --max-budget-usd and --permission-mode to the runtime, picks the config folder with --config, and refuses bad values', async () => {
    const dir = await folder();
    const spec = join(LIVE, PROOF.route_positive ?? '');
    const seen = async (name: string, ...extra: string[]) => {
      const calls = join(dir, `${name}.jsonl`);
      const result = await estateRun(FIXTURE, [spec], '--set-env', `FAKE_CALLS=${calls}`, ...extra);
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      const [call] = (await readFile(calls, 'utf8'))
        .trim()
        .split('\n')
        .map((text) => JSON.parse(text));
      return call as { argv: string[]; configDir: string | null };
    };
    const passed = await seen(
      'passed',
      '--model',
      'stand-in-model',
      '--max-turns',
      '3',
      '--max-budget-usd',
      '0.5',
      '--permission-mode',
      'plan',
      '--timeout',
      '60000',
    );
    const after = (flag: string) => passed.argv[passed.argv.indexOf(flag) + 1];
    expect(after('--model')).toBe('stand-in-model');
    expect(after('--max-turns')).toBe('3');
    expect(after('--max-budget-usd')).toBe('0.5');
    expect(after('--permission-mode')).toBe('plan');

    // A stand-in gets its own config folder by default; --config host leaves the runtime on HOME's, here a
    // scratch folder so no run touches the evaluator's own config.
    const isolated = await seen('isolated');
    expect(String(isolated.configDir).endsWith('/config')).toBe(true);
    const host = await seen('host', '--config', 'host', '--set-env', `HOME=${dir}`);
    expect(host.configDir).toBeNull();

    for (const [flags, message] of [
      [['--timeout', 'soon'], '--timeout is a whole number of milliseconds'],
      [['--max-turns', '0'], '--max-turns is a whole number of at least 1'],
      [['--max-budget-usd', '0'], '--max-budget-usd is a positive amount'],
      [['--config', 'shared'], '--config is host or isolated'],
    ] as const) {
      const bad = await estateRun(FIXTURE, [spec], ...flags);
      expect(bad.code).toBe(2);
      expect(bad.err).toContain(message);
    }
  });

  it.runIf(process.platform === 'darwin')(
    'runs the command under the lock, with the paths --lock-deny names refused',
    async () => {
      const spec = join(LIVE, PROOF.route_positive ?? '');
      const secret = join(await folder(), 'secrets');
      const result = await estateRun(FIXTURE, [spec], '--lock-deny', secret);
      expect(result.code).toBe(0);
      const { openStore } = await import('@agent-nexus/driftbench-store');
      const store = await openStore(result.store);
      const [stored] = await store.listRuns({ campaignId: result.json?.campaignId ?? '' });
      await store.close();
      const agent = stored?.blocks[0]?.observed.executions?.find((record) => record.role === 'agent');
      expect(agent?.command).toContain('/usr/bin/sandbox-exec -p');
      expect(agent?.command).toContain('secrets');
      expect(agent?.command).toContain('.claude/settings.json');
    },
  );

  it('passes the model, turn and budget limits and the trusted tools to the command, in its own config folder on a stand-in', async () => {
    const calls = join(await folder(), 'calls.jsonl');
    process.env.FAKE_CALLS = calls;
    try {
      const spec = join(LIVE, PROOF.route_positive ?? '');
      const result = await estateRun(
        FIXTURE,
        [spec],
        '--model',
        'haiku',
        '--max-turns',
        '3',
        '--max-budget-usd',
        '0.5',
        '--trust-estate',
        '--pass-env',
        'FAKE_CALLS',
      );
      expect(result.code).toBe(0);
    } finally {
      delete process.env.FAKE_CALLS;
    }
    const [call] = (await readFile(calls, 'utf8'))
      .trim()
      .split('\n')
      .map((text) => JSON.parse(text));
    const argv = call.argv as string[];
    expect(argv.slice(0, 6)).toEqual(['--model', 'haiku', '--max-turns', '3', '--max-budget-usd', '0.5']);
    expect(argv).toContain('--allowed-tools');
    expect(call.configDir).not.toBeNull();
    const bad = await estateRun(FIXTURE, [join(LIVE, PROOF.route_positive ?? '')], '--max-turns', 'three');
    expect(bad.code).toBe(2);
  });

  it('fails a spec of another map on a pinned copy, and notes an unpinned one', async () => {
    const spec = join(LIVE, PROOF.route_positive ?? '');
    const base = await folder();
    const first = join(base, 'mutant');
    await run(['estate', 'mutate', MAP, '--atom', R7, '--invert', '--to', first]);
    // A mutant of the mutant answers to the first mutant's map and its own: a spec of the original map is
    // of another map there.
    const second = join(base, 'mutant-2');
    expect(
      (await run(['estate', 'mutate', join(first, 'map.yaml'), '--atom', R3, '--delete', '--to', second]))
        .code,
    ).toBe(0);
    const pinned = await estateRun(second, [spec], '--map', join(second, 'map.yaml'));
    expect(pinned.code).toBe(1);
    expect(pinned.json?.runs[0]?.status).toBe('failed');
    const unpinned = await estateRun(FIXTURE, [spec]);
    expect(unpinned.code).toBe(0);
    expect(unpinned.json?.notes).toContain(
      'the estate copy is not pinned to a map hash; pass --map to pin it',
    );
  });
});

describe('many specs in one estate run', () => {
  it('reads a run-order file, from its own folder, with comments, and runs the same as the list', async () => {
    const dir = await folder();
    const specs = [PROOF.route_positive ?? '', PROOF.tool_denied ?? ''];
    await writeFile(
      join(dir, 'order.txt'),
      ['# the batch', ...specs.map((spec) => relative(dir, join(LIVE, spec))), ''].join('\n'),
    );
    const listed = await estateRun(
      FIXTURE,
      specs.map((spec) => join(LIVE, spec)),
      '--map',
      MAP,
    );
    const ordered = await estateRun(FIXTURE, [], '--order', join(dir, 'order.txt'), '--map', MAP);
    expect(outcomes(ordered.json)).toEqual(outcomes(listed.json));
    expect(Object.keys(outcomes(ordered.json))).toHaveLength(2);
    expect(ordered.json?.pins).toEqual(listed.json?.pins);
  }, 120_000);

  it('refuses a run with no spec and an order file it cannot read', async () => {
    expect((await estateRun(FIXTURE, [])).code).toBe(2);
    expect((await estateRun(FIXTURE, [], '--order', join(await folder(), 'missing.txt'))).code).toBe(2);
  });
});

describe('a mutant run with its own map (bench defect D6)', () => {
  it('keeps the original map as a pin beside the mutant map, so the original specs run', async () => {
    const spec = join(LIVE, PROOF.route_positive ?? '');
    const to = join(await folder(), 'mutant');
    await run(['estate', 'mutate', MAP, '--atom', R7, '--invert', '--to', to]);
    const withMap = await estateRun(to, [spec], '--map', join(to, 'map.yaml'));
    const without = await estateRun(to, [spec]);
    expect(withMap.code).toBe(0);
    expect(withMap.json?.runs[0]?.status).toBe('completed');
    expect(withMap.json?.pins).toEqual(without.json?.pins);
    expect(withMap.json?.pins).toHaveLength(2);
  }, 120_000);
});

// The instructions carry no check of their own, so their specs are judged: the stand-in judge passes them.
const JUDGE = () => ['--judge', 'claude:haiku', '--judge-command', FAKE_JUDGE, '--judge-budget', '1'];

describe('the Northwind proof: 14 live specs on the fake command, and two estate mutants', () => {
  const FAULTS = [
    'estate.misroute.route.shipment-tracker.an-ask-that-fits-shipment-tracker',
    'estate.tool_denied.tool.settings.deny-webfetch',
  ];
  let clean: Record<string, string>;

  it('runs the 14: the clean streams pass, the two planted faults fail on their own checks', async () => {
    const result = await estateRun(FIXTURE, proofSpecs(), '--map', MAP, ...JUDGE());
    expect(result.err).toBe('');
    expect(result.code).toBe(1);
    clean = outcomes(result.json);
    expect(Object.keys(clean)).toHaveLength(14);
    // A spec that fails on a check is never undecided.
    expect(result.json?.undecided).toBe(0);
    const failing = Object.entries(clean)
      .filter(([, outcome]) => outcome !== 'pass')
      .map(([spec]) => spec)
      .sort();
    expect(failing).toEqual(FAULTS);
    const byId = Object.fromEntries((result.json?.runs ?? []).map((line) => [line.spec, line.failing]));
    expect(byId[FAULTS[0] ?? '']).toEqual(['block 0: skills.shipment-tracker']);
    expect(byId[FAULTS[1] ?? '']).toEqual(['block 0: forbidden.WebFetch']);
  }, 120_000);

  it.each([
    [
      GATE,
      '--delete',
      [
        'estate.ordered_pair.gate.invoice-reconcile.read-references-matching-rules-md-before',
        'estate.skip_pressure.gate.invoice-reconcile.read-references-matching-rules-md-before',
      ],
      [],
    ],
  ])(
    'a mutant of %s (%s) turns its atom specs red, the rest as before',
    async (atom, op, red, green) => {
      const to = join(await folder(), 'mutant');
      expect((await run(['estate', 'mutate', MAP, '--atom', atom, op, '--to', to])).code).toBe(0);
      const result = await estateRun(to, proofSpecs(), ...JUDGE());
      expect(result.code).toBe(1);
      const mutant = outcomes(result.json);
      expect(await specsOfAtom(atom)).toEqual([...red, ...green].sort());
      for (const spec of red) {
        expect(clean[spec]).toBe('pass');
        expect(mutant[spec]).toBe('fail');
      }
      for (const spec of green) expect(mutant[spec]).toBe('pass');
      const others = Object.keys(clean).filter((spec) => !red.includes(spec));
      for (const spec of others) expect(mutant[spec]).toBe(clean[spec]);
    },
    120_000,
  );
  it('a mutant that deletes the WebFetch deny offers the tool, and tools_offered names it', async () => {
    const to = join(await folder(), 'mutant');
    const atom = 'tool.settings.deny-webfetch';
    expect((await run(['estate', 'mutate', MAP, '--atom', atom, '--delete', '--to', to])).code).toBe(0);
    const spec = join(LIVE, PROOF.tool_denied ?? '');
    const original = await estateRun(FIXTURE, [spec], '--map', MAP);
    const mutant = await estateRun(to, [spec]);
    expect(original.json?.runs[0]?.failing).toEqual(['block 0: forbidden.WebFetch']);
    expect(mutant.json?.runs[0]?.failing).toEqual([
      'block 0: tools_offered.exclude.WebFetch',
      'block 0: forbidden.WebFetch',
    ]);
  }, 120_000);
});

const FAKE_JUDGE = join(FIXTURE, 'live/fake/judge.cjs');
const HOLIDAY = join(
  LIVE,
  'obligation/estate.obligation.instruction.route-planner.never-plan-a-delivery-on-a.yaml',
);
const OTHER = join(
  LIVE,
  specNaming('obligation', 'instruction.weekly-report.count-only-what-the-ledger-and'),
);

type JudgedJson = Omit<RunJson, 'runs'> & {
  judge: string;
  judgeCostUsd: number;
  runs: Array<
    RunJson['runs'][number] & { judgeCostUsd: number; judged: Array<{ criterion: string; outcome: string }> }
  >;
};

describe('judged criteria in estate run', () => {
  it('asks the judge for each judged criterion, adds its cost to the run, and fails a criterion it fails', async () => {
    const result = await estateRun(
      FIXTURE,
      [HOLIDAY, OTHER],
      '--judge',
      'claude:haiku',
      '--judge-command',
      FAKE_JUDGE,
    );
    expect(result.err).toBe('');
    const json = result.json as JudgedJson;
    expect(json.judge).toBe('claude:haiku');
    const [holiday, other] = json.runs;
    expect(holiday?.judged).toEqual([
      { criterion: 'instruction.route-planner.never-plan-a-delivery-on-a', outcome: 'fail' },
    ]);
    expect(holiday?.pass).toBe(false);
    expect(holiday?.failing.some((entry) => entry.includes('judge.instruction.route-planner'))).toBe(true);
    expect(other?.judged.length).toBeGreaterThan(0);
    expect(other?.judged.every((verdict) => verdict.outcome === 'pass')).toBe(true);
    for (const line of json.runs) {
      expect(line.judgeCostUsd).toBeCloseTo(0.0015 * line.judged.length);
      expect(line.costUsd ?? 0).toBeGreaterThanOrEqual(line.judgeCostUsd);
    }
    const judgedCount = json.runs.reduce((sum, line) => sum + line.judged.length, 0);
    expect(json.judgeCostUsd).toBeCloseTo(0.0015 * judgedCount);
  }, 120_000);

  it('without a judge, a judged criterion is inconclusive and the spec cannot pass', async () => {
    const result = await estateRun(FIXTURE, [OTHER]);
    const json = result.json as JudgedJson;
    expect(json.judge).toBe('none');
    expect(json.judgeCostUsd).toBe(0);
    expect(json.runs[0]?.judged.every((verdict) => verdict.outcome === 'inconclusive')).toBe(true);
    expect(json.runs[0]?.pass).toBe(false);
    // The fake answers it without the report it asks for: a failed check, so it is not undecided.
    expect(json.runs[0]?.undecided).toBe(false);
    expect(json.undecided).toBe(0);
    expect(json.notes.some((note) => note.includes('no judge'))).toBe(true);
  }, 120_000);

  it('refuses a billed judge with no budget, and a judge that is not claude:<model>', async () => {
    const billed = await estateRun(FIXTURE, [OTHER], '--judge', 'claude:haiku');
    expect(billed.code).toBe(2);
    expect(billed.err).toContain('--judge-budget');
    const other = await estateRun(FIXTURE, [OTHER], '--judge', 'gpt:4');
    expect(other.code).toBe(2);
    expect(other.err).toContain('claude:<model>');
    const stray = await estateRun(FIXTURE, [OTHER], '--judge-budget', '1');
    expect(stray.code).toBe(2);
  }, 60_000);
});

describe('an undecided spec', () => {
  const verdict = (outcome: string) => ({
    id: `custom.stage_seen`,
    name: 'stage_seen',
    kind: 'machine',
    gating: true,
    outcome,
  });
  const runOf = (outcomes: string[], status = 'completed') =>
    ({
      specId: 'estate.x',
      runId: 'r',
      status,
      blocks: [
        {
          index: 0,
          pass: outcomes.every((outcome) => outcome === 'pass'),
          verdicts: outcomes.map(verdict),
          observed: { cost: {} },
        },
      ],
    }) as unknown as Parameters<typeof lineOf>[0];

  it('is one that only inconclusive checks keep from passing: no stage feed, no judge', () => {
    expect(lineOf(runOf(['inconclusive']), 0)).toMatchObject({ pass: false, undecided: true });
    expect(lineOf(runOf(['pass', 'inconclusive']), 0)).toMatchObject({ pass: false, undecided: true });
    expect(lineOf(runOf(['fail', 'inconclusive']), 0)).toMatchObject({ pass: false, undecided: false });
    expect(lineOf(runOf(['pass']), 0)).toMatchObject({ pass: true, undecided: false });
    expect(lineOf(runOf(['inconclusive'], 'error'), 0)).toMatchObject({ pass: false, undecided: false });
  });

  it('is not applicable when only not-applicable checks keep it from passing: no stage record', () => {
    expect(lineOf(runOf(['not_applicable']), 0)).toMatchObject({
      pass: false,
      undecided: false,
      notApplicable: true,
    });
    expect(lineOf(runOf(['pass', 'not_applicable']), 0)).toMatchObject({ notApplicable: true });
    expect(lineOf(runOf(['fail', 'not_applicable']), 0)).toMatchObject({
      pass: false,
      notApplicable: false,
    });
    expect(lineOf(runOf(['inconclusive', 'not_applicable']), 0)).toMatchObject({
      undecided: false,
      notApplicable: false,
    });
    expect(lineOf(runOf(['pass']), 0)).toMatchObject({ notApplicable: false });
  });
});

describe('estate run --progress appends a line per finished spec', () => {
  it('appends each run line as its spec finishes, and leaves stdout as the one summary document', async () => {
    const progress = join(await folder(), 'progress.jsonl');
    const specs = [PROOF.route_positive, PROOF.tool_denied].map((path) => join(LIVE, path ?? ''));
    const result = await estateRun(FIXTURE, specs, '--map', MAP, '--progress', progress);
    expect(result.err).toBe('');
    const lines = (await readFile(progress, 'utf8')).split('\n').filter((line) => line !== '');
    expect(lines).toHaveLength(2);
    const ids = lines.map((line) => (JSON.parse(line) as RunJson['runs'][number]).spec);
    expect(ids.sort()).toEqual(Object.keys(outcomes(result.json)).sort());
    expect(result.json?.runs).toHaveLength(2);
  }, 120_000);
});

describe('estate run leaves no process behind', () => {
  it('ends a daemon the run started from the estate copy, after the run', async () => {
    const { spawnSync } = await import('node:child_process');
    const dir = await folder();
    const marker = `live-daemon-${Date.now()}`;
    const daemon = join(dir, 'daemon.py');
    await writeFile(
      daemon,
      [
        'import os, sys, time',
        'child = os.fork()',
        'if child > 0:',
        '    os.waitpid(child, 0)',
        '    sys.exit(0)',
        'os.setsid()',
        'if os.fork() > 0:',
        '    sys.exit(0)',
        'null = os.open(os.devnull, os.O_RDWR)',
        'for fd in (0, 1, 2):',
        '    os.dup2(null, fd)',
        'time.sleep(600)',
        '',
      ].join('\n'),
    );
    // A stand-in that, like an estate's session daemon, leaves a process running in the copy it works in,
    // in its own session, then answers as the fake does.
    const wrapper = join(dir, 'leaky-claude.sh');
    await writeFile(
      wrapper,
      `#!/bin/sh\n# @driftbench-stand-in\ncp "${daemon}" "$PWD/daemon.py"\npython3 "$PWD/daemon.py" ${marker} </dev/null >/dev/null 2>&1\nexec node "${FAKE}" "$@"\n`,
    );
    const { chmod } = await import('node:fs/promises');
    await chmod(wrapper, 0o755);
    const running = () =>
      (spawnSync('ps', ['-A', '-ww', '-o', 'pid=,command='], { encoding: 'utf8' }).stdout ?? '')
        .split('\n')
        .filter((line) => line.includes(marker) && !line.includes('-o pid=,command='))
        .map((line) => Number.parseInt(line.trim(), 10));
    try {
      const spec = join(LIVE, PROOF.route_positive ?? '');
      const store = join(dir, 'runs.db');
      const result = await run([
        'estate',
        'run',
        spec,
        '--estate',
        FIXTURE,
        '--runtime',
        'claude-code',
        '--command',
        wrapper,
        '--store',
        store,
        '--states',
        STATES,
        '--json',
      ]);
      expect(result.err).toBe('');
      expect((JSON.parse(result.out) as RunJson).runs[0]?.status).toBe('completed');
      expect(running()).toEqual([]);
    } finally {
      for (const pid of running()) process.kill(pid, 'SIGKILL');
    }
  }, 120_000);
});

describe('driftbench estate run --from', () => {
  type CarryJson = Omit<RunJson, 'runs'> & {
    runs: Array<RunJson['runs'][number] & { carried?: boolean }>;
    radius?: {
      fresh: number;
      carried: number;
      outside: number;
      from: string;
      refused: Array<{ reason: string; cells: number }>;
    };
    carryNote?: string;
  };
  const manifestText = (from: string, to: string) =>
    `from: ${from}\nto: ${to}\nchanges:\n  - kind: prompt\n    id: ${R7}\n    note: the line of R7 changed\n`;

  async function manifest(from = 'v1', to = 'v2'): Promise<string> {
    const path = join(await folder(), 'change.yaml');
    await writeFile(path, manifestText(from, to));
    return path;
  }

  /**
   * A stand-in call is one line of the FAKE_CALLS file. The path is part of what a run depends on, so every run of
   * a test uses the same file, emptied between runs.
   */
  async function counter() {
    const path = join(await folder(), 'calls.jsonl');
    return {
      env: ['--set-env', `FAKE_CALLS=${path}`],
      async take(): Promise<number> {
        const text = await readFile(path, 'utf8').catch(() => '');
        await writeFile(path, '');
        return text === '' ? 0 : text.trim().split('\n').length;
      },
    };
  }

  /** The first run, labelled v1. */
  async function firstRun(calls: Awaited<ReturnType<typeof counter>>, specs: string[], ...extra: string[]) {
    const result = await estateRun(
      FIXTURE,
      specs,
      '--map',
      MAP,
      '--agent-version',
      'v1',
      ...calls.env,
      ...extra,
    );
    expect(result.err).toBe('');
    await calls.take();
    return { ...result, json: result.json as CarryJson };
  }

  async function secondRun(
    calls: Awaited<ReturnType<typeof counter>>,
    oldStore: string,
    specs: string[],
    ...extra: string[]
  ) {
    const result = await estateRun(
      FIXTURE,
      specs,
      '--map',
      MAP,
      '--agent-version',
      'v2',
      '--from',
      oldStore,
      ...calls.env,
      ...extra,
    );
    return { ...result, json: result.json as CarryJson | undefined, calls: await calls.take() };
  }

  /** The paths of the proof specs whose metadata names the atom. */
  async function pathsOfAtom(atom: string): Promise<string[]> {
    const { loadSpecFile } = await import('@agent-nexus/driftbench-core');
    const out: string[] = [];
    for (const path of proofSpecs()) {
      const loaded = await loadSpecFile(path);
      if (!loaded.ok) throw new Error(path);
      const estate = loaded.spec.metadata?.estate as { atoms?: string[] } | undefined;
      if (estate?.atoms?.includes(atom)) out.push(path);
    }
    return out;
  }

  /**
   * Four proof specs, one of them (the obligation) naming R7: the radius of a change to R7 is not the whole suite
   * only when some spec in the run declares a dependency on the changed atom.
   */
  const small = () =>
    [PROOF.obligation, PROOF.journey, PROOF.route_positive, PROOF.tool_denied].map((path) =>
      join(LIVE, path ?? ''),
    );

  /** The stand-in calls a run of just these specs makes: what a carried result saves. */
  async function callsOf(calls: Awaited<ReturnType<typeof counter>>, specs: string[]): Promise<number> {
    await estateRun(FIXTURE, specs, '--map', MAP, ...calls.env);
    return calls.take();
  }

  it('carries a failure as a failure: status, reasons and evidence stay what the old store holds', async () => {
    const specs = proofSpecs();
    const calls = await counter();
    const old = await firstRun(calls, specs);
    const before = await readFile(old.store);
    const next = await secondRun(calls, old.store, specs, '--change', await manifest());
    expect(next.err).toBe('');
    expect(await readFile(old.store)).toEqual(before);
    const lines = (next.json as CarryJson).runs;
    const carried = lines.filter((line) => line.carried === true && !line.pass);
    expect(carried.length).toBeGreaterThan(0);
    const { openStore } = await import('@agent-nexus/driftbench-store');
    const oldStore = openStore(old.store);
    const newStore = openStore(next.store);
    const oldRuns = await oldStore.listRuns();
    const newRuns = await newStore.listRuns();
    await oldStore.close();
    await newStore.close();
    for (const line of carried) {
      const was = oldRuns.find((entry) => entry.specId === line.spec);
      const now = newRuns.find((entry) => entry.specId === line.spec);
      expect(was, line.spec).toBeDefined();
      expect(now, line.spec).toBeDefined();
      expect(now?.status).toBe(was?.status);
      expect(line.failing.length).toBeGreaterThan(0);
      expect(line.failing).toEqual(old.json.runs.find((entry) => entry.spec === line.spec)?.failing);
      expect(JSON.stringify(now?.blocks)).toBe(JSON.stringify(was?.blocks));
    }
  });

  it('reruns the specs of the radius and carries the result of every other spec from the old store', async () => {
    const specs = proofSpecs();
    const calls = await counter();
    const old = await firstRun(calls, specs);
    expect(old.json.runs).toHaveLength(specs.length);
    const change = await manifest();
    const inRadius = await specsOfAtom(R7);
    expect(inRadius.length).toBeGreaterThan(0);
    expect(inRadius.length).toBeLessThan(specs.length);
    const before = await readFile(old.store);
    const next = await secondRun(calls, old.store, specs, '--change', change);
    expect(next.err).toBe('');
    expect(await readFile(old.store)).toEqual(before);
    const json = next.json as CarryJson;
    // The spec outcomes are the old ones: a carried result keeps its verdict, a rerun gives the same here.
    expect(outcomes(json)).toEqual(outcomes(old.json));
    expect(
      json.runs
        .filter((line) => line.carried !== true)
        .map((line) => line.spec)
        .sort(),
    ).toEqual(inRadius);
    expect(json.runs.filter((line) => line.carried === true)).toHaveLength(specs.length - inRadius.length);
    expect(json.radius).toMatchObject({
      fresh: inRadius.length,
      carried: specs.length - inRadius.length,
      from: old.json.campaignId,
    });
    // The stand-in is called only for the blocks of the radius: as many times as a run of those specs alone.
    expect(next.calls).toBe(await callsOf(calls, await pathsOfAtom(R7)));
    expect(next.calls).toBeGreaterThan(0);
    const { openStore } = await import('@agent-nexus/driftbench-store');
    const store = await openStore(next.store);
    const runs = await store.listRuns({ campaignId: json.campaignId });
    await store.close();
    expect(runs).toHaveLength(specs.length);
    const carried = runs.filter((entry) => entry.carried !== undefined);
    expect(carried).toHaveLength(specs.length - inRadius.length);
    for (const entry of carried) {
      expect(entry.carried?.fromCampaign).toBe(old.json.campaignId);
      expect(entry.carried?.agentVersion).toBe('v1');
      expect(entry.target.variant).toBe('v2');
    }
  });

  it('refuses to carry when no run of the old store names the version the manifest starts from', async () => {
    const specs = small();
    const calls = await counter();
    const old = await firstRun(calls, specs);
    const next = await secondRun(calls, old.store, specs, '--change', await manifest('v0'));
    const json = next.json as CarryJson;
    expect(json.runs.every((line) => line.carried !== true)).toBe(true);
    expect(json.carryNote).toContain('holds no run of agent version v0');
    expect(next.calls).toBeGreaterThan(0);
  });

  it('carries nothing from an old store whose runs were not labelled with a version', async () => {
    const specs = small();
    const calls = await counter();
    const unlabelled = await estateRun(FIXTURE, specs, '--map', MAP, ...calls.env);
    expect(unlabelled.json?.runs).toHaveLength(specs.length);
    await calls.take();
    const next = await secondRun(calls, unlabelled.store, specs, '--change', await manifest());
    const json = next.json as CarryJson;
    expect(json.runs.every((line) => line.carried !== true)).toBe(true);
    expect(json.radius?.carried).toBe(0);
    expect(json.carryNote).toContain('carry no agent version or execution stamp');
  });

  it('runs a spec fresh when it changed since the old run, and carries the specs that did not', async () => {
    const specs = small();
    const calls = await counter();
    const old = await firstRun(calls, specs);
    const edited = join(await folder(), 'edited.yaml');
    // The journey is outside the radius of R7; editing it changes its hash, so its old result is no sample of it.
    const text = await readFile(specs[1] ?? '', 'utf8');
    await writeFile(
      edited,
      text.replace(/^title: "?/m, (head) => `${head}edited: `),
    );
    const next = await secondRun(
      calls,
      old.store,
      [specs[0] ?? '', edited, ...specs.slice(2)],
      '--change',
      await manifest(),
    );
    const json = next.json as CarryJson;
    const fresh = json.runs.filter((line) => line.carried !== true).map((line) => line.spec);
    expect(fresh.sort()).toEqual([old.json.runs[0]?.spec, old.json.runs[1]?.spec].sort());
    expect(json.radius?.refused.map((entry) => entry.reason).join(' ')).toContain('holds no run of the cell');
    expect(json.runs.filter((line) => line.carried === true).length).toBeGreaterThan(0);
  });

  it.each([
    ['model', ['--model', 'other-model']],
    ['environment', ['--set-env', 'NORTHWIND_REGION=south']],
    ['tool rules', ['--disallow', 'WebFetch']],
  ])('refuses a result made with another %s', async (_name, extra) => {
    const specs = small();
    const calls = await counter();
    const old = await firstRun(calls, specs);
    const next = await secondRun(calls, old.store, specs, '--change', await manifest(), ...extra);
    const json = next.json as CarryJson;
    expect(json.runs.every((line) => line.carried !== true)).toBe(true);
    expect(json.radius?.refused.map((entry) => entry.reason)).toContain(
      'current execution context differs or cannot be proved',
    );
  });

  describe('a variable the run passes on', () => {
    const NAME = 'NORTHWIND_PASSED_ON';
    let before: string | undefined;
    beforeEach(() => {
      before = process.env[NAME];
    });
    afterEach(() => {
      if (before === undefined) delete process.env[NAME];
      else process.env[NAME] = before;
    });

    it('carries a result made with the same value and refuses one made with another', async () => {
      const specs = small();
      const calls = await counter();
      process.env[NAME] = 'north';
      const old = await firstRun(calls, specs, '--pass-env', NAME);
      const change = await manifest();
      const same = await secondRun(calls, old.store, specs, '--change', change, '--pass-env', NAME);
      expect((same.json as CarryJson).runs.some((line) => line.carried === true)).toBe(true);
      process.env[NAME] = 'south';
      const next = await secondRun(calls, old.store, specs, '--change', change, '--pass-env', NAME);
      const json = next.json as CarryJson;
      expect(json.runs.every((line) => line.carried !== true)).toBe(true);
      expect(json.radius?.refused.map((entry) => entry.reason)).toContain(
        'current execution context differs or cannot be proved',
      );
    });

    it('gives the same value another stamp in another store, and the same stamp through --from', async () => {
      const specs = small();
      const calls = await counter();
      process.env[NAME] = 'north';
      const { openStore } = await import('@agent-nexus/driftbench-store');
      const stampsOf = async (path: string) => {
        const store = await openStore(path);
        const runs = await store.listRuns();
        const salt = await store.metaGet('estate.salt');
        await store.close();
        return { salt, stamps: new Set(runs.map((entry) => entry.provenance?.adapter.cacheIdentityHash)) };
      };
      const one = await firstRun(calls, specs, '--pass-env', NAME);
      const two = await firstRun(calls, specs, '--pass-env', NAME);
      const first = await stampsOf(one.store);
      const second = await stampsOf(two.store);
      expect(first.salt).toMatch(/^[0-9a-f]{32}$/);
      expect(second.salt).toMatch(/^[0-9a-f]{32}$/);
      expect(second.salt).not.toBe(first.salt);
      expect(first.stamps.size).toBe(1);
      expect(second.stamps.size).toBe(1);
      expect([...second.stamps][0]).not.toBe([...first.stamps][0]);
      // Carry copies the salt, so the new store's digests are the old store's and the result is carried.
      const change = await manifest();
      const carried = await secondRun(calls, one.store, specs, '--change', change, '--pass-env', NAME);
      expect((carried.json as CarryJson).runs.some((line) => line.carried === true)).toBe(true);
      expect((await stampsOf(carried.store)).salt).toBe(first.salt);
    });

    it('carries nothing from a store whose meta table holds no salt row, and runs fresh without error', async () => {
      const specs = small();
      const calls = await counter();
      process.env[NAME] = 'north';
      const old = await firstRun(calls, specs, '--pass-env', NAME);
      const { DatabaseSync } = await import('node:sqlite');
      const raw = new DatabaseSync(old.store);
      raw.exec("DELETE FROM meta WHERE key = 'estate.salt'");
      raw.close();
      const change = await manifest();
      const next = await secondRun(calls, old.store, specs, '--change', change, '--pass-env', NAME);
      expect(next.err).toBe('');
      const json = next.json as CarryJson;
      expect(json.runs.length).toBeGreaterThan(0);
      expect(json.runs.every((line) => line.carried !== true)).toBe(true);
    });

    it('keeps the value out of the store', async () => {
      const calls = await counter();
      process.env[NAME] = 'north-secret-value';
      const old = await firstRun(calls, small(), '--pass-env', NAME);
      const { openStore } = await import('@agent-nexus/driftbench-store');
      const store = await openStore(old.store);
      const campaigns = await store.listCampaigns();
      const runs = await store.listRuns({ campaignId: old.json.campaignId });
      await store.close();
      expect(JSON.stringify([campaigns, runs])).not.toContain('north-secret-value');
      expect(await readFile(old.store, 'latin1')).not.toContain('north-secret-value');
    });
  });

  const LINKS = [
    ['a symbolic link', symlink],
    ['a hard link', link],
  ] as const;
  for (const [what, make] of LINKS) {
    it(`refuses a --store that is ${what} to --from with exit 2 and leaves the old store as it was`, async () => {
      const specs = small();
      const calls = await counter();
      const old = await firstRun(calls, specs);
      const alias = join(await folder(), 'alias.db');
      await make(old.store, alias);
      const before = await readFile(old.store);
      const next = await secondRun(calls, old.store, specs, '--change', await manifest(), '--store', alias);
      expect(next.code).toBe(2);
      expect(next.err).toContain('--store is the old store under another name');
      expect(next.calls).toBe(0);
      expect(await readFile(old.store)).toEqual(before);
    });
  }

  it('refuses a bad combination of the flags with exit 2 and runs nothing', async () => {
    const specs = small().slice(0, 2);
    const counted = await counter();
    const old = await firstRun(counted, specs);
    const change = await manifest();
    const base = counted.env;
    const only = await estateRun(FIXTURE, specs, '--agent-version', 'v2', '--from', old.store, ...base);
    expect(only.code).toBe(2);
    expect(only.err).toContain('go together');
    const noChangeFrom = await estateRun(
      FIXTURE,
      specs,
      '--agent-version',
      'v2',
      '--change',
      change,
      ...base,
    );
    expect(noChangeFrom.code).toBe(2);
    const noVersion = await estateRun(FIXTURE, specs, '--from', old.store, '--change', change, ...base);
    expect(noVersion.code).toBe(2);
    expect(noVersion.err).toContain('--agent-version');
    const dependent = await estateRun(FIXTURE, specs, '--max-carry', '2', ...base);
    expect(dependent.code).toBe(2);
    const same = await run([
      'estate',
      'run',
      ...specs,
      '--estate',
      FIXTURE,
      '--runtime',
      'claude-code',
      '--command',
      FAKE,
      '--store',
      old.store,
      '--agent-version',
      'v2',
      '--from',
      old.store,
      '--change',
      change,
    ]);
    expect(same.code).toBe(2);
    expect(same.err).toContain('cannot be the same file');
    const missing = await estateRun(
      FIXTURE,
      specs,
      '--agent-version',
      'v2',
      '--from',
      join(await folder(), 'nowhere.db'),
      '--change',
      change,
      ...base,
    );
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('not a file');
    expect(await counted.take()).toBe(0);
  });

  it('writes the same target and campaign as before when no carry flag is given', async () => {
    const result = await estateRun(FIXTURE, [proofSpecs()[0] ?? ''], '--map', MAP);
    const { openStore } = await import('@agent-nexus/driftbench-store');
    const store = await openStore(result.store);
    const [campaign] = await store.listCampaigns();
    const [stored] = await store.listRuns({ campaignId: result.json?.campaignId ?? '' });
    await store.close();
    expect(campaign?.agentVersion).toBeUndefined();
    expect(campaign?.radius).toBeUndefined();
    expect(stored?.target.variant).toBeUndefined();
    expect(stored?.target.agent).toBe(result.json?.pins[0]?.slice(0, 12));
  });
});
