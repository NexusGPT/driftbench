import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEstateMap } from '@driftbench/estate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Io, main } from '../src/index';

// Each test starts sandboxes and processes; under a full parallel suite that takes more than the default.
vi.setConfig({ testTimeout: 60_000 });

/** `driftbench estate mutate` and `estate run` on the fictional Northwind fixture, with the fake headless command. */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const MAP = join(FIXTURE, 'approved.yaml');
const R3 = 'gate.standing.read-a-file-before-editing-it';
const R7 = 'instruction.standing.tell-the-user-about-a-late';

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
    expect((await readdir(to)).sort()).toEqual(['.claude', 'CLAUDE.md', 'map.yaml', 'mutant.json']);
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

/** One complete live spec per test type of the fixture's generated suite: the 14 of the proof. */
const PROOF: Record<string, string> = {
  guard_positive: 'guard_positive/estate.pairwise.0142.yaml',
  journey: 'journey/estate.journey.03.yaml',
  misroute: 'misroute/estate.misroute.route.shipment-tracker.an-ask-that-fits-shipment-tracker.yaml',
  obligation: 'obligation/estate.obligation.instruction.standing.tell-the-user-about-a-late.yaml',
  ordered_pair: 'ordered_pair/estate.ordered_pair.gate.standing.never-report-done-before-verify-passed.yaml',
  outside_trigger:
    'outside_trigger/estate.outside_trigger.instruction.standing.tell-the-user-about-a-late.yaml',
  register_sample:
    'register_sample/estate.register_sample.register.invoice-reconcile.one-closing-line-per-invoice.build.yaml',
  route_near_miss:
    'route_near_miss/estate.route_near_miss.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.yaml',
  route_positive:
    'route_positive/estate.route_positive.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.1.yaml',
  skip_pressure: 'skip_pressure/estate.skip_pressure.gate.standing.read-a-file-before-editing-it.yaml',
  stage_order: 'stage_order/estate.stage_order.stage.steps.stage-do-make-the-change.yaml',
  stage_skip: 'stage_skip/estate.stage_skip.stage.steps.stage-verify-run-the-check-that.yaml',
  tool_denied: 'tool_denied/estate.tool_denied.tool.settings.deny-webfetch.yaml',
  twin: 'twin/estate.twin.instruction.standing.tell-the-user-about-a-late.yaml',
};

const proofSpecs = () => Object.values(PROOF).map((path) => join(LIVE, path));

type RunJson = {
  campaignId: string;
  standIn: boolean;
  pins: string[];
  notes: string[];
  runs: Array<{ spec: string; status: string; pass: boolean; failing: string[]; costUsd: number | null }>;
  passed: number;
  failed: number;
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
  const { loadSpecFile } = await import('@driftbench/core');
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
    const { openStore } = await import('@driftbench/store');
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

  it.runIf(process.platform === 'darwin')(
    'runs the command under the lock, with the paths --lock-deny names refused',
    async () => {
      const spec = join(LIVE, PROOF.route_positive ?? '');
      const secret = join(await folder(), 'secrets');
      const result = await estateRun(FIXTURE, [spec], '--lock-deny', secret);
      expect(result.code).toBe(0);
      const { openStore } = await import('@driftbench/store');
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

describe('the Northwind proof: 14 live specs on the fake command, and three estate mutants', () => {
  const FAULTS = [
    'estate.misroute.route.shipment-tracker.an-ask-that-fits-shipment-tracker',
    'estate.tool_denied.tool.settings.deny-webfetch',
  ];
  let clean: Record<string, string>;

  it('runs the 14: the clean streams pass, the two planted faults fail on their own checks', async () => {
    const result = await estateRun(FIXTURE, proofSpecs(), '--map', MAP);
    expect(result.err).toBe('');
    expect(result.code).toBe(1);
    clean = outcomes(result.json);
    expect(Object.keys(clean)).toHaveLength(14);
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
    [R3, '--delete', ['estate.skip_pressure.gate.standing.read-a-file-before-editing-it'], []],
    [
      R7,
      '--invert',
      [
        'estate.obligation.instruction.standing.tell-the-user-about-a-late',
        'estate.twin.instruction.standing.tell-the-user-about-a-late',
      ],
      ['estate.outside_trigger.instruction.standing.tell-the-user-about-a-late'],
    ],
  ])(
    'a mutant of %s (%s) turns its atom specs red, the rest as before',
    async (atom, op, red, green) => {
      const to = join(await folder(), 'mutant');
      expect((await run(['estate', 'mutate', MAP, '--atom', atom, op, '--to', to])).code).toBe(0);
      const result = await estateRun(to, proofSpecs());
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
  'obligation/estate.obligation.instruction.route-planner.no-delivery-planned-on-a-public.yaml',
);
const OTHER = join(LIVE, 'obligation/estate.pairwise.0515.yaml');

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
      { criterion: 'instruction.route-planner.no-delivery-planned-on-a-public', outcome: 'fail' },
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
