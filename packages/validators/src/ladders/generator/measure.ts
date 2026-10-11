import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { functionAdapter } from '@driftbench/adapters';
import { defaultChecks } from '@driftbench/checks';
import {
  type AgentAdapter,
  type LoadedSpec,
  type LoadResult,
  loadSpecs,
  type RunResult,
  type Spec,
} from '@driftbench/core';
import {
  blockOutcome,
  COMPLETE_DIR,
  deviationOf,
  type FaultSession,
  failingIds,
  faultAdapter,
  type GenerateResult,
  generateSuite,
  loadApprovedMap,
  type PreparedMap,
  projectRun,
  type RunContext,
  runOnce,
  type ThenField,
  thenFields,
} from '@driftbench/generate';
import { createScriptedDriver } from '@driftbench/users';
import { baselineSuite } from './baseline';
import { CHEATERS, type Cheater, cheaterAdapter, replayCalls } from './cheaters';
import { faultFamily, type HiddenFault } from './faults';
import { createFollower } from './follower';
import { type HiddenSpec, hiddenSpec } from './hidden';
import { MAP_FILES, type RenderedMap, renderMap } from './render';

/**
 * One seed of the generator validator, measured: the hidden specification rendered as a map, the real
 * generator run on it twice, every generated spec loaded from disk, and every complete spec run through the
 * real runner and checks on the rule follower (k repeats), on each cheater and on each fault agent. The
 * ladder's levels read this record; nothing here decides a level.
 */

/** Repeats on the rule follower, for pass to the k (level 7). */
export const REFERENCE_REPEATS = 5;

/** The map path every generated spec records: the same in both runs, so their bytes can be compared. */
export const MAP_PATH = `../map/${MAP_FILES.map}`;

/** What a test or a mutation replaces: each part of the chain the validator drives. */
export type GeneratorParts = {
  hidden?: (seed: number) => HiddenSpec;
  render?: (spec: HiddenSpec) => RenderedMap;
  generate?: (prepared: PreparedMap, options: { seed: number; mapPath: string }) => GenerateResult;
  /** The rule follower: what the reference runs. */
  follower?: (spec: HiddenSpec) => () => FaultSession;
  faults?: (spec: HiddenSpec) => HiddenFault[];
  cheaters?: readonly Cheater[];
  /** The hand-written suite: the coverage baseline and the replay cheater's source. */
  baseline?: (spec: HiddenSpec) => LoadedSpec[];
  /** Repeats on the reference. */
  k?: number;
};

export type GeneratedFileSet = Map<string, string>;

export type Generation = {
  hidden: HiddenSpec;
  /** Set when the generator refused the map: nothing was generated. */
  refused?: { code: string; message: string; issues: string[] };
  /** The files of the first run and of the second, by path relative to the output folder. */
  first: GeneratedFileSet;
  second: GeneratedFileSet;
  /** Every spec of the first run, loaded from disk by the core loader. */
  loaded: LoadResult[];
  /** The loaded specs of the complete folder. */
  complete: LoadedSpec[];
  report?: GenerateResult['report'];
};

/** One block of a complete spec, and what every agent made of it. */
export type BlockRun = {
  key: string;
  spec: string;
  index: number;
  seeder: string;
  fields: ThenField[];
  deviation?: string;
  reference: Array<'pass' | 'fail' | 'unjudged'>;
  referenceFailing: string[];
  referenceTrace: string;
  cheaters: Partial<Record<Cheater, { outcome: 'pass' | 'fail' | 'unjudged'; passing: string[] }>>;
  faults: Record<string, { outcome: 'pass' | 'fail' | 'unjudged'; failing: string[] }>;
};

export type FaultRecord = { fault: HiddenFault; changedOn: string[]; ranOn: number };

export type Runs = {
  blocks: BlockRun[];
  faults: FaultRecord[];
  /** The specs whose runs ended in error, with the error. */
  errors: string[];
};

/** The run context of every run: the default checks and the scripted driver, as the gate runs them. */
export function runContext(): RunContext {
  return { checks: defaultChecks(), driver: () => createScriptedDriver() };
}

/** The follower behind the function adapter. */
export function followerAdapter(session: () => FaultSession, version = 'rule-follower'): AgentAdapter {
  return functionAdapter<FaultSession>({
    create: () => session(),
    respond: (messages, world, _vars, state) => state.respond(messages, world),
    payloads: (state) => state.payloads(),
    deterministic: true,
    version,
  });
}

async function writeAll(root: string, files: readonly { path: string; text: string }[]): Promise<void> {
  for (const file of files) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.text);
  }
}

async function readAll(root: string): Promise<GeneratedFileSet> {
  const out: GeneratedFileSet = new Map();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.set(relative(root, full).split(sep).join('/'), await readFile(full, 'utf8'));
    }
  };
  await walk(root);
  return out;
}

/**
 * Renders the hidden specification of `seed` into a fresh folder, runs the generator on it twice (as
 * `driftbench generate --map <map> --out <dir> --seed <seed>` does: load the approved map, generate, write
 * every file), and loads every written spec with the core loader. The folder is removed before it returns.
 */
export async function generation(seed: number, parts: GeneratorParts = {}): Promise<Generation> {
  const hidden = (parts.hidden ?? hiddenSpec)(seed);
  const rendered = (parts.render ?? renderMap)(hidden);
  const root = await mkdtemp(join(tmpdir(), 'driftbench-vgen-'));
  try {
    const mapDir = join(root, 'map');
    await mkdir(mapDir);
    for (const [key, name] of Object.entries(MAP_FILES)) {
      await writeFile(join(mapDir, name), rendered[key as keyof RenderedMap]);
    }
    const loaded = await loadApprovedMap(join(mapDir, MAP_FILES.map));
    if (!loaded.ok) {
      return {
        hidden,
        refused: {
          code: loaded.code,
          message: loaded.message,
          issues: loaded.issues.map((issue) => `${issue.path || '(file)'} ${issue.code} ${issue.message}`),
        },
        first: new Map(),
        second: new Map(),
        loaded: [],
        complete: [],
      };
    }
    const generate = parts.generate ?? ((prepared, options) => generateSuite(prepared, options));
    const runs: GenerateResult[] = [];
    for (const folder of ['first', 'second']) {
      const again = await loadApprovedMap(join(mapDir, MAP_FILES.map));
      if (!again.ok) throw new Error(`the map loaded once and was refused the second time: ${again.message}`);
      const result = generate(again.prepared, { seed, mapPath: MAP_PATH });
      await writeAll(join(root, folder), result.files);
      runs.push(result);
    }
    const first = await readAll(join(root, 'first'));
    const second = await readAll(join(root, 'second'));
    const specs = await loadSpecs([join(root, 'first')]);
    const loadedSpecs = specs.map((result) => ({
      ...result,
      path: relative(join(root, 'first'), result.path).split(sep).join('/'),
    }));
    const complete = loadedSpecs.filter(
      (result): result is LoadedSpec => result.ok && result.path.startsWith(`${COMPLETE_DIR}/`),
    );
    complete.sort((a, b) => a.path.localeCompare(b.path));
    return {
      hidden,
      first,
      second,
      loaded: loadedSpecs,
      complete,
      report: runs[0]?.report as GenerateResult['report'],
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function seederOf(spec: Spec): string {
  const generated = spec.metadata?.generated as { seeder?: unknown } | undefined;
  return typeof generated?.seeder === 'string' ? generated.seeder : 'hand-written';
}

/** What the follower did in a block: the stage it reports and the calls it made. */
function traceOf(run: RunResult, index: number): string {
  const block = run.blocks.find((entry) => entry.index === index);
  if (!block) return 'the run ended before the block';
  const stage = block.observed.runtime?.stages?.at(-1)?.name ?? 'none reported';
  const calls = block.observed.toolCalls.map((call) => `${call.label}(${JSON.stringify(call.input)})`);
  return `stage ${stage}; calls ${calls.length > 0 ? calls.join(', ') : 'none'}; reply "${block.observed.text}"`;
}

/** Hygiene and limits the runner applies to every block: never part of a Then, as the gate reads a block. */
const NOT_THEN: ReadonlySet<string> = new Set(['pii', 'schema_strict', 'budget']);

function passingIds(run: RunResult, index: number): string[] {
  const block = run.blocks.find((entry) => entry.index === index);
  return (block?.verdicts ?? [])
    .filter(
      (verdict) =>
        verdict.gating && verdict.outcome === 'pass' && !NOT_THEN.has(verdict.id.split('.', 1)[0] ?? ''),
    )
    .map((verdict) => verdict.id);
}

function failingDetails(run: RunResult, index: number): string[] {
  const block = run.blocks.find((entry) => entry.index === index);
  const failing = new Set(failingIds(run, index));
  return (block?.verdicts ?? [])
    .filter((verdict) => failing.has(verdict.id))
    .map((verdict) => `${verdict.id}: ${verdict.evidence}`);
}

/**
 * Runs every complete spec on the follower k times, on every cheater once and on every fault once, through
 * the real runner in free-running mode with the default checks, as the gate does.
 */
export async function runAll(generated: Generation, parts: GeneratorParts = {}): Promise<Runs> {
  const { hidden } = generated;
  const k = parts.k ?? REFERENCE_REPEATS;
  const context = runContext();
  const follower = (parts.follower ?? ((spec: HiddenSpec) => createFollower(spec)))(hidden);
  const reference = followerAdapter(follower);
  const faults = (parts.faults ?? faultFamily)(hidden);
  const cheaters = parts.cheaters ?? CHEATERS;
  const replay = replayCalls((parts.baseline ?? baselineSuite)(hidden).map((loaded) => loaded.spec));
  const provider = () => {
    throw new Error('the generator validator plants function faults only');
  };
  const adapters = faults.map((fault) => ({ fault, adapter: faultAdapter(fault.def, provider) }));
  const records = new Map<string, FaultRecord>(
    faults.map((fault) => [fault.def.id, { fault, changedOn: [], ranOn: 0 }]),
  );
  const blocks: BlockRun[] = [];
  const errors: string[] = [];

  for (const { spec } of generated.complete) {
    const references: RunResult[] = [];
    for (let repeat = 1; repeat <= k; repeat += 1)
      references.push(await runOnce(spec, reference, repeat, context));
    const first = references[0] as RunResult;
    if (first.status !== 'completed')
      errors.push(`${spec.id}: the follower run ${first.status}${first.error ? `: ${first.error}` : ''}`);
    const base = projectRun(first);
    const cheaterRuns = new Map<Cheater, RunResult>();
    for (const name of cheaters)
      cheaterRuns.set(name, await runOnce(spec, cheaterAdapter(name, spec, hidden, replay), 1, context));
    const faultRuns = new Map<string, RunResult>();
    for (const { fault, adapter } of adapters) {
      const result = await runOnce(spec, adapter, 1, context);
      faultRuns.set(fault.def.id, result);
      const record = records.get(fault.def.id) as FaultRecord;
      record.ranOn += 1;
      const projected = projectRun(result);
      if (projected.length !== base.length || projected.some((part, index) => part !== base[index])) {
        record.changedOn.push(spec.id);
      }
    }
    spec.blocks.forEach((block, index) => {
      const deviation = deviationOf(spec, index);
      const run: BlockRun = {
        key: `${spec.id}#${block.id ?? index}`,
        spec: spec.id,
        index,
        seeder: seederOf(spec),
        fields: thenFields(spec, index),
        ...(deviation === undefined ? {} : { deviation }),
        reference: references.map((result) => blockOutcome(result, index)),
        referenceFailing: failingDetails(first, index),
        referenceTrace: traceOf(first, index),
        cheaters: {},
        faults: {},
      };
      for (const [name, result] of cheaterRuns) {
        run.cheaters[name] = { outcome: blockOutcome(result, index), passing: passingIds(result, index) };
      }
      for (const [id, result] of faultRuns) {
        run.faults[id] = { outcome: blockOutcome(result, index), failing: failingIds(result, index) };
      }
      blocks.push(run);
    });
  }
  return { blocks, faults: [...records.values()], errors };
}
