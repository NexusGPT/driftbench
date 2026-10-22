import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeCodeLiveAdapter, loadStateLibrary } from '@agent-nexus/driftbench-adapters';
import { contentHash, type RunResult } from '@agent-nexus/driftbench-core';
import {
  copyEstate,
  type EstateMap,
  loadEstateMap,
  loadPlan,
  mapHash,
  type Plan,
  quoteAtSpan,
  toEstateSpaceMap,
} from '@agent-nexus/driftbench-estate';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { loadSpaceMap, type SpaceMap } from '@agent-nexus/driftbench-space';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { type CampaignDeps, defaultDeps, registerCampaignCommands } from '../src/commands/campaign';
import { isStandIn } from '../src/commands/estate-live';
import { replayChecks } from '../src/commands/replay';
import { type Io, main } from '../src/index';

/**
 * The whole estate chain on the fictional Northwind fixture, with no model call: scan, approve, space map,
 * plan, generate, mutate and run, diff, impact, radius. Each step reads the file the step before wrote, and
 * every hand-off is asserted by an id or a hash that the two steps must agree on. The table printed at the
 * end lists them. The same chain, step by step with its commands, is on docs/estate-chain.md.
 *
 * No model call. The scan replays the recorded labels of the pointer reader. The live runs use the fixture's stand-in command, a
 * script with the stand-in marker that `estate run` accepts without --allow-billed, and the check below
 * refuses the real runtime. The provider keys are emptied for the whole file, so a command that tried to
 * reach a model would stop with an error instead.
 */

vi.setConfig({ testTimeout: 600_000, hookTimeout: 60_000 });

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const V2 = join(ROOT, 'examples/estates/fixture-v2');
const FAKE = join(FIXTURE, 'live/fake/claude.mjs');
const MANIFEST = join(FIXTURE, 'live/fake/manifest.json');
const STATES = join(FIXTURE, 'live/states/library.json');

/** The instruction atom the chain follows: mutated in step 6, rewritten in version 2, the radius of step 9. */
const R7 = 'instruction.standing.r7-when-a-shipment-is-late';
/** The gate the chain mutates in step 6: its file is read before any line is matched. */
const GATE = 'gate.invoice-reconcile.read-references-matching-rules-md-before';
/** The reference atom of the same line: deleting the line deletes it too (the mutant record lists it as collateral). */
const GATE_REFERENCE = 'reference.invoice-reconcile.read-references-matching-rules-md';
const FAKE_JUDGE = join(FIXTURE, 'live/fake/judge.cjs');
/** The instructions carry no check of their own, so their specs are judged: the stand-in judge passes them. */
const JUDGE = ['--judge', 'claude:haiku', '--judge-command', FAKE_JUDGE, '--judge-budget', '1'];
const R12 = 'instruction.standing.r12-when-r2-applies-and-the';
/**
 * The words the stand-in judge fails a reply on in steps 10 and 11: the reply the stand-in plays when the
 * quote of R7 is gone from the estate. It states the late shipment and does not propose the email.
 */
const SILENT_REPLY = 'NW-55012 is with DPX';
const ROUTE_PLAN = 'route.standing.an-ask-to-plan-the-delivery';
const LEDGER_GUARD = 'guard.settings.posttooluse-bash-guard-ledger-guard-py';
/** The agent versions of the chain: the estate as scanned, and the estate with its prompt edited. */
const AGENT_V1 = 'northwind-v1';
const AGENT_V2 = 'northwind-v2';
/** The edit of version 2 to the standing file: the wording of the committed fixture-v2 on this line. */
const EDIT_FROM = 'late by more than two days';
const EDIT_TO = 'late by more than one day';
const FORCE_PUSH_GUARD = 'guard.settings.pretooluse-bash-guard-block-force-push';

type Generated = {
  path: string;
  /** The folder under the generated root: specs/live, specs/unit, incomplete/live or incomplete/replay. */
  folder: string;
  spec: {
    id: string;
    version?: string;
    given?: { vars?: { estate?: { map_hash?: string } } };
    blocks: Array<{ when?: { user?: string } }>;
    metadata: {
      estate: {
        atoms: string[];
        planRow: string;
        mapHash: string;
        testType: string;
        mode: string;
        cell: Record<string, string>;
        plan?: string;
        /** Set on a spec that stands for several equivalent plan rows (the generator folds them). */
        equivalence?: { count: number; planRows: string[] };
      };
    };
  };
};
/** One side of a changed atom in the diff: the atom's provenance. */
type Change = { file: string; startLine: number; endLine: number; quote: string; hash: string };
type DiffJson = {
  old: { path: string; readAt: string; hash: string; atoms: number; edges: number };
  new: { path: string; readAt: string; hash: string; atoms: number; edges: number };
  atoms: {
    added: Array<{ id: string }>;
    removed: Array<{ id: string }>;
    changed: Array<{
      id: string;
      change: 'whitespace' | 'semantic';
      before: Change;
      after: Change;
      now?: string;
    }>;
    moved: Array<{ id: string; from: { startLine: number }; to: { startLine: number } }>;
    restated: Array<{ id: string }>;
  };
  guards: Array<{ guard: string; move: string; from: string | null; to: string | null }>;
  /** The ledger units of the two versions; present only when the diff read both ledgers. */
  units?: unknown;
  summary: Record<
    'added' | 'removed' | 'whitespace' | 'semantic' | 'moved' | 'restated' | 'unchanged',
    number
  >;
};
type ImpactJson = {
  diff: { old: string; new: string };
  tests: { live: number };
  regenerate: Array<{ test: string; file: string; atoms: Array<{ atom: string; why: string }> }>;
  reapprove: Array<{ atom: string; tests: string[] }>;
  retire: Array<{ test: string; atoms: string[]; state: string }>;
  new: Array<{ atom: string }>;
  /** Live tests that cite an atom id the old map does not hold: no change of the diff can reach them. */
  stale?: Array<{ test: string; file: string; atoms: string[] }>;
  unaffected: { moved: number; tests: number };
  needsPerson: string[];
};
type RunJson = {
  standIn: boolean;
  pins: string[];
  costUsd: number;
  runs: Array<{ spec: string; status: string; pass: boolean; failing: string[] }>;
};
type RadiusJson = {
  manifest: { hash: string; from: string; to: string; changes: string[] };
  whole: { change: string; reason: string } | null;
  specs: Array<{
    specId: string;
    blocks: Array<{ id: string; why: string[]; state: Record<string, string> }>;
  }>;
  totals: Record<string, { in: number; direct: number; forward: number; out: number; total: number }>;
};

/** What each step leaves for the steps after it. */
const chain: {
  scanned?: EstateMap;
  approved?: EstateMap;
  space?: SpaceMap;
  plan?: Plan;
  specs?: Generated[];
  diff?: DiffJson;
  /** The impact of the diff on the generated suite, read by step 9. */
  suiteImpact?: ImpactJson;
  /** What step 6 ran: the specs, who names the atom, and each spec's result on the estate and on its mutant. */
  universe?: {
    entries: Generated[];
    naming: Set<string>;
    before: Record<string, { outcome: string; failing: string[] }>;
    after: Record<string, { outcome: string; failing: string[] }>;
    mutantDir: string;
    mutantHash: string;
  };
  /** What step 9 wrote and read: the change manifest and the radius report over the generated suite. */
  radius?: {
    manifest: string;
    report: RadiusJson;
    /** The standing file as edited for version 2, and the estate copy that holds it. */
    editedPrompt: string;
    estate: string;
  };
  /**
   * What the campaigns of steps 10 to 12 run: the specs of step 6 and every live spec that names the atom step 9
   * edits, which of them name it, and each spec's result from `estate run` on version 1 and on the edited version 2.
   */
  subset?: {
    entries: Generated[];
    naming: Set<string>;
    before: Record<string, { outcome: string; failing: string[] }>;
    after: Record<string, { outcome: string; failing: string[] }>;
  };
  /** The baseline campaign of step 10. */
  baseline?: { runs: RunResult[]; calls: number };
} = {};

let work = '';

/** Runs `work` with the stand-in judge set to fail the replies that hold `words`, then restores it. */
async function judgeFailing<T>(words: string, work: () => Promise<T>): Promise<T> {
  const saved = process.env.FAKE_JUDGE_FAIL;
  process.env.FAKE_JUDGE_FAIL = words;
  try {
    return await work();
  } finally {
    if (saved === undefined) delete process.env.FAKE_JUDGE_FAIL;
    else process.env.FAKE_JUDGE_FAIL = saved;
  }
}

type Row = { step: string; input: string; output: string; tie: string; verified: 'yes' | 'NO' };
const rows: Row[] = [];

async function cli(argv: string[]) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd: work,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

function must<T>(value: T | undefined, step: string): T {
  if (value === undefined)
    throw new Error(`step ${step} left nothing for this step to read: it did not finish`);
  return value;
}

/** Runs the assertions of one step. The row stays "NO" when one of them throws. */
async function prove(step: string, input: string, output: string, check: () => Promise<string>) {
  const row: Row = { step, input, output, tie: '', verified: 'NO' };
  rows.push(row);
  row.tie = await check();
  row.verified = 'yes';
}

function table(): string {
  const head = ['step', 'input file', 'output file', 'id or hash that ties them', 'verified'];
  const body = rows.map((row) => [row.step, row.input, row.output, row.tie, row.verified]);
  const widths = head.map((title, at) =>
    Math.max(title.length, ...body.map((line) => (line[at] ?? '').length)),
  );
  const line = (cells: string[]) => cells.map((cell, at) => cell.padEnd(widths[at] ?? 0)).join('  ');
  return [line(head), line(widths.map((width) => '-'.repeat(width))), ...body.map(line)].join('\n');
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const short = (hash: string) => hash.slice(0, 12);
const sorted = (list: Iterable<string>) => [...list].sort();

/** The numbers captured by a pattern in a command's output. */
function figures(text: string, pattern: RegExp): number[] {
  const match = pattern.exec(text);
  if (match === null) throw new Error(`no line of the output matches ${pattern}:\n${text}`);
  return match.slice(1).map(Number);
}

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(path)));
    else out.push(path);
  }
  return out.sort();
}

async function readSpecs(dir: string): Promise<Generated[]> {
  const paths = (await filesUnder(dir)).filter((path) => path.endsWith('.yaml'));
  return Promise.all(
    paths.map(async (path) => ({
      path,
      folder: relative(dir, path).split('/').slice(0, 2).join('/'),
      spec: parseYaml(await readFile(path, 'utf8')) as Generated['spec'],
    })),
  );
}

async function loadMap(path: string): Promise<EstateMap> {
  const loaded = await loadEstateMap(path);
  if (!loaded.ok) throw new Error(`${path}: ${loaded.errors.map((issue) => issue.message).join('; ')}`);
  return loaded.map;
}

/** A map without the fields that say where and when it was read. */
function withoutRootAndTime(map: EstateMap) {
  return {
    ...map,
    root: '',
    readAt: '',
    ...(map.producedBy === undefined ? {} : { producedBy: { ...map.producedBy, at: '' } }),
  };
}

/** JSON with the keys of every object sorted, so equal content gives equal text. */
function stable(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item !== null && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item as Record<string, unknown>)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, each]) => [key, sort(each)]),
          )
        : item;
  return JSON.stringify(sort(value));
}

/**
 * What a spec asks and checks: all of it but its name and its provenance. The names of the judged criteria
 * come from atom ids, so they are replaced by their position; the rubric and the flags stay.
 */
function contentOf(spec: Generated['spec']): string {
  const {
    id: _id,
    title: _title,
    metadata: _metadata,
    tags: _tags,
    ...rest
  } = structuredClone(spec) as Record<string, unknown>;
  const criteria = rest.criteria as Array<Record<string, unknown>> | undefined;
  const names = new Map(criteria?.map((criterion, at) => [criterion.name, `criterion.${at}`]));
  if (criteria)
    rest.criteria = criteria.map((criterion) => ({ ...criterion, name: names.get(criterion.name) }));
  rest.blocks = (rest.blocks as Array<{ expect?: { criteria?: string[] } }>).map((block) => ({
    ...block,
    expect: {
      ...block.expect,
      ...(Array.isArray(block.expect?.criteria)
        ? { criteria: block.expect.criteria.map((name) => names.get(name) ?? name) }
        : {}),
    },
  }));
  return stable(rest);
}

const atomsOf = (entry: Generated) => entry.spec.metadata.estate.atoms;

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'driftbench-estate-chain-'));
  // The parsed-map cache of the estate commands lives in the work folder, not in the shared temporary one.
  vi.stubEnv('DRIFTBENCH_MAP_CACHE', join(work, 'map-cache'));
  // No provider key: a command that tried to reach a model would stop with an error instead.
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', '');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(work, { recursive: true, force: true });
});

describe('the Northwind estate chain, from scan to radius, with no model call', () => {
  it('step 1: scan with the recorded labels writes a map whose atom ids and provenance hashes recompute', async () => {
    await prove('1 scan', 'estate folder, cassette.jsonl', 'map.yaml', async () => {
      const out = join(work, 'map.yaml');
      const result = await cli([
        'estate',
        'scan',
        FIXTURE,
        '--runtime',
        'claude-code',
        '--pointer',
        '--cassette',
        join(FIXTURE, 'cassette.jsonl'),
        '--out',
        out,
      ]);
      expect(result.err).toBe('');
      // The recorded labeler gave answers the checks refused (a span outside its unit, a condition with no target):
      // they stay out of the map and the scan says so, and exits 1.
      expect(result.code).toBe(1);
      expect(result.out).toContain('refused:');
      const map = await loadMap(out);
      chain.scanned = map;

      // The count line agrees with the file: code atoms are approved as read, model atoms wait for a person.
      const byCode = map.atoms.filter((atom) => atom.producedBy === 'code' && atom.approved).length;
      const byModel = map.atoms.filter((atom) => atom.producedBy === 'model' && !atom.approved).length;
      expect(byCode + byModel).toBe(map.atoms.length);
      expect(
        figures(
          result.out,
          /: (\d+) atoms \((\d+) read by code and approved, (\d+) split from prose by the model and waiting for approval\), (\d+) edges\./,
        ),
      ).toEqual([map.atoms.length, byCode, byModel, map.edges.length]);

      // Every atom has an id that starts with its kind, and no id is used twice.
      expect(new Set(map.atoms.map((atom) => atom.id)).size).toBe(map.atoms.length);
      for (const atom of map.atoms) expect(atom.id.startsWith(`${atom.kind}.`), atom.id).toBe(true);

      // Every provenance hash recomputes from file, span and quote, and the quote is in the estate file at its span.
      const texts = new Map<string, string>();
      for (const atom of map.atoms) {
        const { file, startLine, endLine, quote, hash } = atom.provenance;
        expect(sha256(`${file}\n${startLine}-${endLine}\n${quote}`), atom.id).toBe(hash);
        if (!texts.has(file)) texts.set(file, await readFile(join(FIXTURE, file), 'utf8'));
        expect(quoteAtSpan(texts.get(file) ?? '', atom.provenance), `${atom.id}: quote at its span`).toBe(
          true,
        );
      }

      // The map hash recomputes from the atom hashes and the edges. The map is the committed one, except for
      // the root it records and the time of the scan.
      expect(mapHash(map.atoms, map.edges)).toBe(map.hash);
      expect(resolve(work, map.root)).toBe(FIXTURE);
      const committed = await loadMap(join(FIXTURE, 'map.yaml'));
      expect(map.hash).toBe(committed.hash);
      expect(withoutRootAndTime(map)).toEqual(withoutRootAndTime(committed));
      return `map hash ${short(map.hash)}, ${map.atoms.length} atoms`;
    });
  });

  it('step 2: approve --all writes the same map with every atom approved, and the map hash does not move', async () => {
    await prove('2 approve', 'map.yaml', 'approved.yaml', async () => {
      const scanned = must(chain.scanned, '1');
      const out = join(work, 'approved.yaml');
      const result = await cli(['estate', 'approve', join(work, 'map.yaml'), '--all', '--to', out]);
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      const waiting = scanned.atoms.filter((atom) => !atom.approved).length;
      expect(figures(result.out, /Approved (\d+) atoms in .*; (\d+) were already approved\./)).toEqual([
        waiting,
        scanned.atoms.length - waiting,
      ]);

      // Only the approved flag changed: same ids, same quotes, same edges, same hash.
      const approved = await loadMap(out);
      chain.approved = approved;
      expect(approved.atoms.every((atom) => atom.approved)).toBe(true);
      expect(approved.atoms).toEqual(scanned.atoms.map((atom) => ({ ...atom, approved: true })));
      expect(approved.edges).toEqual(scanned.edges);
      expect(approved.hash).toBe(scanned.hash);

      // The listing says every atom is approved, and the map is the committed approved map.
      const listing = await cli(['estate', 'approve', out]);
      expect(listing.code).toBe(0);
      expect(listing.out).toContain(`all ${approved.atoms.length} atoms are approved.`);
      const committed = await loadMap(join(FIXTURE, 'approved.yaml'));
      expect(withoutRootAndTime(approved)).toEqual(withoutRootAndTime(committed));
      return `${approved.atoms.length} atoms approved, map hash ${short(approved.hash)} unchanged`;
    });
  });

  it('step 3: map writes a space map whose target values are approved atom ids of that map', async () => {
    await prove('3 space map', 'approved.yaml', 'space.yaml', async () => {
      const approved = must(chain.approved, '2');
      const out = join(work, 'space.yaml');
      const result = await cli([
        'estate',
        'map',
        join(work, 'approved.yaml'),
        '--to',
        out,
        '--agent',
        'northwind',
      ]);
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      const loaded = await loadSpaceMap(out);
      if (!loaded.ok) throw new Error(loaded.errors.map((issue) => issue.message).join('; '));
      const space = loaded.map;
      chain.space = space;

      // The space map names its map: its version is the start of the map hash.
      expect(space.version).toBe(short(approved.hash));
      const byId = new Map(approved.atoms.map((atom) => [atom.id, atom]));
      const targets = space.dimensions.filter((dimension) => dimension.id.startsWith('atoms.'));
      expect(targets.length).toBeGreaterThan(0);
      const listed: string[] = [];
      for (const dimension of targets) {
        for (const value of dimension.values) {
          const atom = byId.get(value.id);
          expect(atom, `${value.id} is an atom of the approved map`).toBeDefined();
          expect(atom?.approved, `${value.id} is approved`).toBe(true);
          expect(atom?.role, `${value.id} is an axis atom`).toBe('axis');
          expect(`atoms.${atom?.kind}`, `${value.id} sits under its kind`).toBe(dimension.id);
          expect(value.title).toBe(atom?.title);
          listed.push(value.id);
        }
      }
      // No approved axis atom is missing from it.
      expect(sorted(listed)).toEqual(
        sorted(approved.atoms.filter((atom) => atom.approved && atom.role === 'axis').map((atom) => atom.id)),
      );
      // The count line agrees with the file, and the file is the committed space map.
      expect(
        figures(result.out, /: (\d+) situation axes, (\d+) target dimensions \(.*\), (\d+) constraints\./),
      ).toEqual([space.dimensions.length - targets.length, targets.length, space.constraints.length]);
      const committed = await loadSpaceMap(join(FIXTURE, 'space.yaml'));
      expect(committed.ok && committed.map).toEqual(space);
      return `space version ${space.version} is the map hash start; ${listed.length} target atoms`;
    });
  });

  it('step 4: plan reads the space map and writes rows whose atoms exist in the approved map', async () => {
    await prove('4 plan', 'approved.yaml, space.yaml', 'plan.yaml', async () => {
      const approved = must(chain.approved, '2');
      const space = must(chain.space, '3');
      const out = join(work, 'plan.yaml');
      const result = await cli([
        'estate',
        'plan',
        join(work, 'approved.yaml'),
        '--space',
        join(work, 'space.yaml'),
        '--out',
        out,
      ]);
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      const loaded = await loadPlan(out);
      if (!loaded.ok) throw new Error(loaded.errors.map((issue) => issue.message).join('; '));
      const plan = loaded.plan;
      chain.plan = plan;
      expect(figures(result.out, /: (\d+) rows \(/)).toEqual([plan.rows.length]);

      // The plan names its map and its space map by hash, and so does the summary beside it.
      expect(plan.mapHash).toBe(approved.hash);
      expect(plan.spaceHash).toBe(contentHash(space));
      const summary = JSON.parse(await readFile(join(work, 'plan.summary.json'), 'utf8')) as {
        mapHash: string;
        spaceHash: string;
      };
      expect([summary.mapHash, summary.spaceHash]).toEqual([plan.mapHash, plan.spaceHash]);

      // Every row names approved atoms of the map, and every cell value is one the space map holds.
      const byId = new Map(approved.atoms.map((atom) => [atom.id, atom]));
      const values = new Map(
        space.dimensions.map((dimension) => [
          dimension.id,
          new Set(dimension.values.map((value) => value.id)),
        ]),
      );
      for (const row of plan.rows) {
        expect(row.status, row.id).toBe('proposed');
        for (const id of row.atomIds) expect(byId.get(id)?.approved, `${row.id} names ${id}`).toBe(true);
        for (const [dimension, value] of Object.entries(row.cell)) {
          expect(
            values.get(dimension)?.has(value),
            `${row.id}: ${dimension}=${value} is in the space map`,
          ).toBe(true);
          if (dimension.startsWith('atoms.')) {
            expect(`atoms.${byId.get(value)?.kind}`, `${row.id}: ${value} sits under its kind`).toBe(
              dimension,
            );
          }
        }
      }

      // The committed plan has these rows and this summary. Its spaceHash differs: it was written without
      // --space, from the map's own space map, which carries the agent name "estate" instead of "northwind".
      const committed = await loadPlan(join(FIXTURE, 'plan.yaml'));
      if (!committed.ok) throw new Error('the committed plan does not load');
      expect(plan.rows).toEqual(committed.plan.rows);
      expect(plan.summary).toEqual(committed.plan.summary);
      expect(plan.mapHash).toBe(committed.plan.mapHash);
      expect(committed.plan.spaceHash).toBe(contentHash(toEstateSpaceMap(approved)));
      return `plan map hash ${short(plan.mapHash)}, space hash ${plan.spaceHash}`;
    });
  });

  it('step 5: plan approve then generate write tests that name approved atoms, the map hash and a row of the plan', async () => {
    await prove('5 generate', 'approved.yaml, plan.yaml', 'generated/', async () => {
      const approved = must(chain.approved, '2');
      const plan = must(chain.plan, '4');
      const planPath = join(work, 'plan.yaml');

      const approving = await cli(['estate', 'plan', 'approve', planPath, '--all']);
      expect(approving.err).toBe('');
      expect(approving.code).toBe(0);
      expect(figures(approving.out, /Approved (\d+) rows in .*; (\d+) were already approved\./)).toEqual([
        plan.rows.length,
        0,
      ]);
      const reread = await loadPlan(planPath);
      if (!reread.ok) throw new Error('the approved plan does not load');
      expect(reread.plan.rows.every((row) => row.status === 'approved')).toBe(true);

      const out = join(work, 'generated');
      const generated = await cli([
        'estate',
        'generate',
        '--map',
        join(work, 'approved.yaml'),
        '--plan',
        planPath,
        '--out',
        out,
        '--phrases',
        join(FIXTURE, 'phrases.yaml'),
        '--sessions',
        join(FIXTURE, 'sessions/index.yaml'),
        '--json',
      ]);
      expect(generated.err).toBe('');
      // Exit 1: the suite is written, and some specs are incomplete; each names the gap that keeps it so.
      expect(generated.code).toBe(1);
      const report = JSON.parse(generated.out) as {
        map: { hash: string; atoms: number };
        plan: { rows: number; approved: number; proposed: number; struck: number };
        summary: { specs: number; complete: number; incomplete: number };
        /** Absent from a report of a generator that folds nothing. */
        equivalence?: { collapsed: number; groups: Array<{ spec: string; count: number; rows: string[] }> };
      };
      expect(report.map).toMatchObject({ hash: approved.hash, atoms: approved.atoms.length });
      expect(report.plan).toMatchObject({
        rows: plan.rows.length,
        approved: plan.rows.length,
        proposed: 0,
        struck: 0,
      });

      const specs = await readSpecs(out);
      chain.specs = specs;

      /**
       * What must hold for a plan row to stand under a representative, computed from the plan and not from the
       * generator's label. The row has the atoms, test type, mode and cell of the representative's row. The
       * representative is a complete spec. And the row, generated alone from a plan that holds only it, is a
       * complete spec with the same blocks (Given, When, Then) and rules as the representative. Returns the
       * ways it fails to hold; none means the fold is proved.
       */
      const foldProblems = async (rep: Generated, id: string): Promise<string[]> => {
        const problems: string[] = [];
        const own = plan.rows.find((row) => row.id === id);
        const head = plan.rows.find((row) => row.id === rep.spec.metadata.estate.planRow);
        if (own === undefined || head === undefined)
          return [`${id} or its representative is no row of the plan`];
        if (!rep.folder.startsWith('specs/'))
          problems.push(`the representative ${rep.spec.id} is incomplete`);
        if (stable(own.atomIds) !== stable(head.atomIds))
          problems.push(`${id} names other atoms than ${head.id}`);
        if (own.testType !== head.testType) problems.push(`${id} is another test type than ${head.id}`);
        if (own.mode !== head.mode) problems.push(`${id} runs in another mode than ${head.id}`);
        if (stable(own.cell) !== stable(head.cell)) problems.push(`${id} has another cell than ${head.id}`);
        const dir = join(work, 'folds', createHash('sha256').update(id).digest('hex').slice(0, 12));
        await mkdir(dir, { recursive: true });
        await writeFile(
          join(dir, 'plan.yaml'),
          stringifyYaml({
            ...plan,
            rows: plan.rows.map((row) => ({ ...row, status: row.id === id ? 'approved' : 'struck' })),
          }),
        );
        const alone = await cli([
          'estate',
          'generate',
          '--map',
          join(work, 'approved.yaml'),
          '--plan',
          join(dir, 'plan.yaml'),
          '--out',
          join(dir, 'generated'),
          '--phrases',
          join(FIXTURE, 'phrases.yaml'),
          '--sessions',
          join(FIXTURE, 'sessions/index.yaml'),
          '--json',
        ]);
        if (alone.err !== '') return [...problems, `${id} alone: ${alone.err.trim()}`];
        const written = await readSpecs(join(dir, 'generated'));
        if (written.length !== 1) return [...problems, `${id} alone gives ${written.length} specs, not one`];
        const [single] = written;
        if (single === undefined) return problems;
        if (!single.folder.startsWith('specs/')) problems.push(`${id} alone is an incomplete spec`);
        if (contentOf(single.spec) !== contentOf(rep.spec)) {
          problems.push(`${id} alone is not the spec of ${rep.spec.id}: its blocks or rules differ`);
        }
        return problems;
      };
      const rowsById = new Map(plan.rows.map((row) => [row.id, row]));
      const atomIds = new Set(approved.atoms.map((atom) => atom.id));
      const covered = new Set<string>();
      /** The rows folded into another spec: they have no spec of their own. */
      const folded = new Set<string>();
      const representatives = new Set<string>();
      const claims: Array<{ rep: Generated; id: string }> = [];
      for (const entry of specs) {
        const { spec, path } = entry;
        const where = relative(out, path);
        const estate = spec.metadata.estate;
        // The three hand-offs: atoms of the approved map, the map hash, a row of the plan.
        for (const atom of estate.atoms) expect(atomIds.has(atom), `${where}: ${atom} is an atom`).toBe(true);
        expect(estate.mapHash, where).toBe(approved.hash);
        expect(spec.given?.vars?.estate?.map_hash, where).toBe(approved.hash);
        expect(spec.version, where).toBe(short(approved.hash));
        const row = rowsById.get(estate.planRow);
        expect(row, `${where}: ${estate.planRow} is a row of the plan`).toBeDefined();
        // And the spec carries what its row says.
        expect(estate.atoms, where).toEqual(row?.atomIds);
        expect([estate.testType, estate.mode, estate.cell], where).toEqual([
          row?.testType,
          row?.mode,
          row?.cell,
        ]);
        covered.add(estate.planRow);
        representatives.add(estate.planRow);
        // The generator folds exactly equivalent specs into one representative, by design. The representative
        // lists every row it stands for in `equivalence.planRows`: each is a row of the plan, and each counts as
        // covered by this spec.
        if (estate.equivalence !== undefined) {
          const { count, planRows } = estate.equivalence;
          expect(planRows, `${where}: the folded rows`).toContain(estate.planRow);
          expect(count, `${where}: the fold count`).toBe(planRows.length);
          expect(new Set(planRows).size, `${where}: a row is folded once`).toBe(planRows.length);
          for (const id of planRows) {
            expect(rowsById.has(id), `${where}: ${id} is a row of the plan`).toBe(true);
            expect(folded.has(id), `${where}: ${id} is folded into one spec only`).toBe(false);
            if (id !== estate.planRow) {
              folded.add(id);
              claims.push({ rep: entry, id });
            }
            covered.add(id);
          }
        }
      }
      // Each fold is proved from the plan, not read from the label: a folded row, generated alone, is the
      // representative's complete spec. A row whose own test is gone cannot stand under another spec.
      for (const { rep: head, id } of claims) {
        expect(await foldProblems(head, id), `${head.spec.id} stands for ${id}`).toEqual([]);
      }
      // The proof can fail. A row is listed under a spec it is not equivalent to, whether that spec is complete
      // or incomplete, and the fold count and the plan row stay consistent: the proof rejects each case. The
      // row is the currency conversion obligation of the invoice skill when the plan holds one.
      const forgedRow =
        plan.rows.find(
          (row) => row.id.includes('convert-a-foreign-currency') && row.testType === 'obligation',
        ) ?? plan.rows.find((row) => row.testType === 'obligation');
      const unrelated = specs.find(
        (entry) =>
          entry.folder.startsWith('specs/') &&
          entry.spec.metadata.estate.planRow !== forgedRow?.id &&
          !atomsOf(entry).some((atom) => forgedRow?.atomIds.includes(atom)),
      );
      const unfinished = specs.find((entry) => entry.folder.startsWith('incomplete'));
      expect(forgedRow, 'a row to forge a fold for').toBeDefined();
      expect(unrelated, 'a complete spec unrelated to that row').toBeDefined();
      expect(unfinished, 'an incomplete spec').toBeDefined();
      for (const head of [unrelated, unfinished]) {
        if (head === undefined || forgedRow === undefined) continue;
        const problems = await foldProblems(head, forgedRow.id);
        expect(problems.length, `${forgedRow.id} listed under ${head.spec.id}`).toBeGreaterThan(0);
      }
      // The static and the unit tests are JSON files that carry the same three fields.
      const jsonTests = (await filesUnder(out)).filter(
        (path) => path.endsWith('.json') && /\/(static|unit)\//.test(path),
      );
      for (const path of jsonTests) {
        const test = JSON.parse(await readFile(path, 'utf8')) as {
          atom: string;
          planRow: string;
          mapHash: string;
        };
        expect(atomIds.has(test.atom), `${path}: ${test.atom}`).toBe(true);
        expect(test.mapHash, path).toBe(approved.hash);
        expect(rowsById.has(test.planRow), `${path}: ${test.planRow}`).toBe(true);
        covered.add(test.planRow);
      }
      // Every approved row gave a test, and every test came from a row.
      expect(sorted(covered)).toEqual(sorted(rowsById.keys()));
      // The report counts what the folders hold: complete specs sit under specs/ and static/, the others under incomplete/.
      const incomplete = specs.filter((entry) => entry.folder.startsWith('incomplete')).length;
      const staticTests = jsonTests.filter((path) => path.includes('/static/')).length;
      expect(report.summary.incomplete).toBe(incomplete);
      expect(report.summary.complete).toBe(specs.length - incomplete + staticTests);
      expect(report.summary.specs).toBe(specs.length + staticTests);
      // The written specs plus the rows folded into them are the plan rows, and the report counts the folds.
      const collapsed = report.equivalence?.collapsed ?? 0;
      expect(collapsed).toBe(folded.size);
      expect([...folded].filter((id) => representatives.has(id))).toEqual([]);
      expect((report.equivalence?.groups ?? []).reduce((sum, group) => sum + group.count - 1, 0)).toBe(
        folded.size,
      );
      expect(report.summary.specs + collapsed).toBe(plan.rows.length);
      return `${plan.rows.length} plan rows, ${covered.size} rows with a test (${folded.size} folded into an equivalent spec), all on map hash ${short(approved.hash)}`;
    });
  });

  /**
   * The 14 complete live specs of the fixture's own proof (estate-live.test.ts), one per test type, here
   * taken from the suite this chain generated. The force-push guard spec is found by its content: pairwise
   * specs are numbered by their row.
   */
  const PROOF = [
    'journey/estate.journey.03.yaml',
    'misroute/estate.misroute.route.shipment-tracker.an-ask-that-fits-shipment-tracker.yaml',
    'obligation/estate.obligation.instruction.standing.r7-when-a-shipment-is-late.yaml',
    'ordered_pair/estate.ordered_pair.gate.invoice-reconcile.read-references-matching-rules-md-before.yaml',
    'outside_trigger/estate.outside_trigger.instruction.standing.r7-when-a-shipment-is-late.yaml',
    'register_sample/estate.register_sample.register.invoice-reconcile.end-with-one-line-per-invoice.build.yaml',
    'route_near_miss/estate.route_near_miss.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.yaml',
    'route_positive/estate.route_positive.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.1.yaml',
    'skip_pressure/estate.skip_pressure.gate.invoice-reconcile.read-references-matching-rules-md-before.yaml',
    'stage_order/estate.stage_order.stage.steps.stage-do-make-the-change.yaml',
    'stage_skip/estate.stage_skip.stage.steps.stage-verify-run-the-check-that.yaml',
    'tool_denied/estate.tool_denied.tool.settings.deny-webfetch.yaml',
    'twin/estate.twin.instruction.standing.r7-when-a-shipment-is-late.yaml',
  ];
  /** The two planted faults of the recorded streams: they fail on their own checks, with or without a mutant. */
  const FAULTS = [
    'estate.misroute.route.shipment-tracker.an-ask-that-fits-shipment-tracker',
    'estate.tool_denied.tool.settings.deny-webfetch',
  ];

  /** What one spec did in a run: pass or fail (or its run status), and the checks that failed. */
  type Result = { outcome: string; failing: string[] };

  async function estateRun(name: string, estateRoot: string, specs: string[], ...extra: string[]) {
    const result = await cli([
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
      `FAKE_MANIFEST=${MANIFEST}`,
      '--store',
      join(work, `${name}.db`),
      '--states',
      STATES,
      '--json',
      ...extra,
    ]);
    expect(result.err).toBe('');
    const json = JSON.parse(result.out) as RunJson;
    const results: Record<string, Result> = Object.fromEntries(
      json.runs.map((run) => [
        run.spec,
        {
          outcome: run.status === 'completed' ? (run.pass ? 'pass' : 'fail') : run.status,
          failing: run.failing,
        },
      ]),
    );
    return { code: result.code, json, results };
  }

  it('step 6: deleting the gate atom turns the specs that name it red, and no other spec moves', async () => {
    await prove('6 mutate, run', 'approved.yaml, generated specs', 'mutant/, run results', async () => {
      const approved = must(chain.approved, '2');
      const generated = must(chain.specs, '5');
      const atom = approved.atoms.find((candidate) => candidate.id === GATE);
      if (atom === undefined) throw new Error(`${GATE} is not an atom of the approved map`);

      // No model: the command is the fixture's stand-in, and a run of the real runtime is refused.
      expect(await isStandIn(FAKE)).toBe(true);
      const refused = await cli([
        'estate',
        'run',
        join(work, 'generated', 'specs', 'live', PROOF[0] ?? ''),
        '--estate',
        FIXTURE,
        '--runtime',
        'claude-code',
        '--store',
        join(work, 'refused.db'),
      ]);
      expect(refused.code).toBe(2);
      expect(refused.err).toContain('claude is not a stand-in');

      // The mutant: the atom's line deleted in a copy of the estate, with its own map beside it.
      const mutantDir = join(work, 'mutant');
      const made = await cli([
        'estate',
        'mutate',
        join(work, 'approved.yaml'),
        '--atom',
        GATE,
        '--delete',
        '--to',
        mutantDir,
        '--json',
      ]);
      expect(made.err).toBe('');
      expect(made.code).toBe(0);
      const record = JSON.parse(made.out) as {
        atom: string;
        op: string;
        file: string;
        before: string;
        after: string;
        originalMapHash: string;
        mapHash: string;
      };
      const mutantMap = await loadMap(join(mutantDir, 'map.yaml'));
      expect(record).toMatchObject({
        atom: GATE,
        op: 'delete',
        file: atom.provenance.file,
        originalMapHash: approved.hash,
      });
      expect(record.mapHash).toBe(mutantMap.hash);
      expect(mutantMap.hash).not.toBe(approved.hash);
      expect(record.before).toContain(atom.provenance.quote);
      expect(record.after).toBe('');
      // Only that file differs from the estate, and only on that line.
      const changedFiles: string[] = [];
      for (const path of await filesUnder(mutantDir)) {
        const name = relative(mutantDir, path);
        if (name === 'map.yaml' || name === 'mutant.json') continue;
        const was = await readFile(join(FIXTURE, name), 'utf8');
        const now = await readFile(path, 'utf8');
        if (was === now) continue;
        changedFiles.push(name);
        expect(now).toBe(was.replace(`${record.before}\n`, ''));
      }
      expect(changedFiles).toEqual([atom.provenance.file]);

      // The hand-off by hash is enforced by the command too, not only by this test: the plan and the phrase
      // bank answer to the original map, so the mutant's map is refused and nothing is written.
      const wrong = await cli([
        'estate',
        'generate',
        '--map',
        join(mutantDir, 'map.yaml'),
        '--plan',
        join(work, 'plan.yaml'),
        '--out',
        join(work, 'refused'),
        '--phrases',
        join(FIXTURE, 'phrases.yaml'),
        '--sessions',
        join(FIXTURE, 'sessions/index.yaml'),
      ]);
      expect(wrong.code).toBe(2);
      expect(wrong.err).toContain(
        `the plan was made from map ${short(approved.hash)}, the map given is ${short(record.mapHash)}`,
      );
      expect(await readdir(work)).not.toContain('refused');

      // What the stand-in reads of the estate: each recorded ask has alternatives, and when the estate copy
      // no longer holds a quote, the alternative plays instead. On the original none plays. On the mutant the
      // ones that play are keyed on the inverted line, and so are the asks they belong to.
      const recorded = JSON.parse(await readFile(MANIFEST, 'utf8')) as {
        asks: Array<{ ask: string; unless?: Array<{ file: string; quote: string }> }>;
      };
      const alternatives = recorded.asks.flatMap((entry) =>
        (entry.unless ?? []).map((rule) => ({ ask: entry.ask, ...rule })),
      );
      const playing = async (root: string) => {
        const out: typeof alternatives = [];
        for (const rule of alternatives) {
          if (!(await readFile(join(root, rule.file), 'utf8')).includes(rule.quote)) out.push(rule);
        }
        return out;
      };
      expect(await playing(FIXTURE)).toEqual([]);
      const played = await playing(mutantDir);
      expect(played.length).toBeGreaterThan(0);
      for (const rule of played) {
        expect(rule.file, rule.ask).toBe(atom.provenance.file);
        expect(atom.provenance.quote, rule.ask).toContain(rule.quote);
      }
      const affected = new Set(played.map((rule) => rule.ask));

      // The specs to run. Every spec that names the atom. Every other spec whose ask is one the mutant
      // changes: in playback mode the stand-in reads the changed file only through those alternatives, so
      // these are the specs that can move. And the specs of the fixture's own proof, one of each test type,
      // that carry no changed ask: the controls.
      const live = generated.filter((entry) => entry.folder === 'specs/live');
      const byPath = new Map(live.map((entry) => [entry.path, entry]));
      const asksChanged = (entry: Generated) =>
        entry.spec.blocks.some((block) => affected.has(block.when?.user ?? ''));
      // The specs that name the gate or its reference and ask for the work in one of the asks the stand-in plays
      // two ways.
      expect(made.out).toContain(GATE_REFERENCE);
      const naming = live.filter(
        (entry) =>
          atomsOf(entry).some((name) => name === GATE || name === GATE_REFERENCE) && asksChanged(entry),
      );
      const sharing = live.filter((entry) => !naming.includes(entry) && asksChanged(entry));
      const forcePush = live
        .filter(
          ({ spec }) =>
            spec.metadata.estate.testType === 'guard_positive' &&
            spec.metadata.estate.atoms.includes(FORCE_PUSH_GUARD) &&
            spec.metadata.estate.cell.deviation === 'none',
        )
        .map((entry) => entry.path)
        .sort()[0];
      const proof = [
        ...PROOF.map((name) => join(work, 'generated', 'specs', 'live', name)),
        forcePush ?? '',
      ].map((path) => {
        const entry = byPath.get(path);
        if (entry === undefined) throw new Error(`the generated suite has no live spec ${path}`);
        return entry;
      });
      expect(proof).toHaveLength(14);
      const controls = proof.filter((entry) => !naming.includes(entry) && !sharing.includes(entry));
      expect(controls.length).toBeGreaterThan(0);
      expect(naming.map((entry) => entry.spec.metadata.estate.testType)).toEqual(
        expect.arrayContaining(['ordered_pair', 'skip_pressure']),
      );
      const paths = [...naming, ...sharing, ...controls].map((entry) => entry.path).sort();
      expect(new Set(paths).size).toBe(paths.length);

      // The generated specs of the proof are the committed ones, except for the plan path they record.
      for (const entry of proof) {
        const name = relative(join(work, 'generated'), entry.path);
        const committed = parseYaml(
          await readFile(join(FIXTURE, 'generated', name), 'utf8'),
        ) as Generated['spec'];
        const mine = structuredClone(entry.spec);
        delete mine.metadata.estate.plan;
        delete committed.metadata.estate.plan;
        expect(mine, name).toEqual(committed);
      }

      // The original estate, pinned to the map this chain approved.
      const original = await estateRun(
        'original',
        FIXTURE,
        paths,
        '--map',
        join(work, 'approved.yaml'),
        ...JUDGE,
      );
      expect(original.code).toBe(1);
      expect(original.json.standIn).toBe(true);
      // Only the stand-in judge reports a cost, and a small one.
      expect(original.json.costUsd).toBeLessThan(1);
      expect(original.json.pins).toEqual([approved.hash]);
      const before = original.results;
      expect(Object.keys(before)).toHaveLength(paths.length);
      // Every spec that names the atom passes. The specs that fail are the two planted faults of the recorded
      // streams, and the specs that share the ask of the invoice stream but check what that stream never does
      // (dispatch the auditor, read the currency table, declare the Bash tool): they are red on the original, and
      // stay as red on the mutant.
      for (const entry of naming) expect(before[entry.spec.id]?.outcome, entry.spec.id).toBe('pass');
      const unmet = sharing.filter((entry) => before[entry.spec.id]?.outcome === 'fail');
      expect(unmet.length).toBeGreaterThan(0);
      for (const entry of unmet)
        expect(before[entry.spec.id]?.failing.length, entry.spec.id).toBeGreaterThan(0);
      expect(
        sorted(Object.entries(before).flatMap(([id, result]) => (result.outcome === 'pass' ? [] : [id]))),
      ).toEqual(sorted([...FAULTS, ...unmet.map((entry) => entry.spec.id)]));

      // The same specs on the mutant, pinned to the original map hash and to the mutant's own.
      const mutant = await estateRun('mutant', mutantDir, paths, ...JUDGE);
      expect(mutant.code).toBe(1);
      expect(mutant.json.standIn).toBe(true);
      expect(mutant.json.pins).toEqual([approved.hash, record.mapHash]);
      const after = mutant.results;
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());

      // A spec that names the gate and asks what the mutant changes fails: the file is no longer read first.
      // The stand-in plays the recorded stream without the read when the quote is gone from the estate copy.
      const red = naming.filter((entry) => after[entry.spec.id]?.outcome === 'fail');
      expect(red.map((entry) => entry.spec.id).sort()).toEqual(
        sorted(naming.filter(asksChanged).map((entry) => entry.spec.id)),
      );
      expect(red.map((entry) => entry.spec.metadata.estate.testType)).toEqual(
        expect.arrayContaining(['ordered_pair', 'skip_pressure']),
      );
      for (const entry of red) {
        expect(after[entry.spec.id], entry.spec.id).toEqual({
          outcome: 'fail',
          failing: ['block 0: references.**/.claude/skills/invoice-reconcile/references/matching-rules.md'],
        });
      }
      for (const entry of naming.filter((candidate) => !red.includes(candidate))) {
        expect(after[entry.spec.id], entry.spec.id).toEqual(before[entry.spec.id]);
      }
      // Every other spec gives the result it gave before, the failing checks included.
      for (const entry of [...sharing, ...controls]) {
        expect(after[entry.spec.id], entry.spec.id).toEqual(before[entry.spec.id]);
      }
      chain.universe = {
        entries: [...naming, ...sharing, ...controls],
        naming: new Set(naming.map((entry) => entry.spec.id)),
        before,
        after,
        mutantDir,
        mutantHash: record.mapHash,
      };
      return `${GATE} deleted, map ${short(approved.hash)} to ${short(record.mapHash)}; ${red.length} of ${naming.length} specs that name it fail, ${sharing.length + controls.length} others unchanged`;
    });
  });

  it('step 7: the diff of the approved map against version 2 names the semantic changes, with the chain hashes on both sides', async () => {
    await prove('7 diff', 'approved.yaml, fixture-v2/map.yaml', 'diff.json', async () => {
      const approved = must(chain.approved, '2');
      const out = join(work, 'diff.json');
      const result = await cli([
        'estate',
        'diff',
        join(work, 'approved.yaml'),
        join(V2, 'map.yaml'),
        '--old-guards',
        join(V2, 'maintain/guard-state.v1.yaml'),
        '--out',
        out,
      ]);
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      const diff = JSON.parse(await readFile(out, 'utf8')) as DiffJson;
      chain.diff = diff;
      const v2 = await loadMap(join(V2, 'map.yaml'));

      // Both sides are named by hash: the old side is the map this chain approved.
      expect([diff.old.hash, diff.old.atoms, diff.old.edges]).toEqual([
        approved.hash,
        approved.atoms.length,
        approved.edges.length,
      ]);
      expect([diff.new.hash, diff.new.atoms]).toEqual([v2.hash, v2.atoms.length]);

      // The changes of section 8 of docs/estate.md.
      const semantic = diff.atoms.changed.filter((change) => change.change === 'semantic');
      expect(sorted(semantic.map((change) => change.id))).toEqual(sorted([ROUTE_PLAN, R7]));
      // R12 is rewritten as R19 at one ledger unit that the readers label as no rule in either version: no
      // atom of either map holds R12, so the diff names none for it (the units are read with the ledgers).
      expect(approved.atoms.some((atom) => atom.id === R12)).toBe(false);
      expect(v2.atoms.some((atom) => atom.id === R12)).toBe(false);
      // R2 is a rule of both versions, so its wrap onto two lines is a change of white space.
      expect(
        diff.atoms.changed.filter((change) => change.change === 'whitespace').map((change) => change.id),
      ).toEqual(['instruction.standing.r2-never-send-an-email-to']);
      expect(diff.atoms.removed.map((atom) => atom.id)).toEqual([]);
      expect(diff.atoms.added.map((atom) => atom.id)).toEqual([
        'register.weekly-report.fill-the-template-in-this-order',
        'instruction.standing.r18-never-approve-a-credit-note',
      ]);
      expect(diff.atoms.moved).toHaveLength(25);
      expect(diff.atoms.restated.map((atom) => atom.id)).toEqual([
        'instruction.standing.r8-do-not-invent-order-numbers',
        'instruction.standing.r17-report-a-number-only-when',
        'invariant.standing.the-standing-instructions-stay-under-40000',
      ]);
      expect(diff.guards.filter((guard) => guard.move !== 'unchanged')).toMatchObject([
        { guard: LEDGER_GUARD, move: 'promoted', from: 'warn', to: 'enforce' },
      ]);
      expect(diff.summary).toMatchObject({
        added: 2,
        removed: 0,
        whitespace: 1,
        semantic: 2,
        moved: 25,
        restated: 3,
      });
      // An atom that moved and was restated counts in both lists, and once among the atoms that are not unchanged.
      expect(diff.summary.unchanged).toBe(
        diff.old.atoms -
          new Set(
            [diff.atoms.removed, diff.atoms.changed, diff.atoms.moved, diff.atoms.restated].flatMap((list) =>
              list.map((atom) => atom.id),
            ),
          ).size,
      );

      // R7: the "before" hash is the hash the scan gave the atom in step 1, the "after" hash is version 2's.
      const before = approved.atoms.find((atom) => atom.id === R7)?.provenance;
      const after = v2.atoms.find((atom) => atom.id === R7)?.provenance;
      const change = semantic.find((entry) => entry.id === R7);
      expect(change?.before).toEqual(before);
      expect(change?.after).toEqual(after);
      expect(change?.before.quote).toContain('more than two days');
      expect(change?.after.quote).toContain('more than one day');
      // A moved atom keeps its quote and changes only its line.
      for (const move of diff.atoms.moved) {
        const was = approved.atoms.find((atom) => atom.id === move.id)?.provenance;
        const now = v2.atoms.find((atom) => atom.id === move.id)?.provenance;
        expect(now?.quote, move.id).toBe(was?.quote);
        expect([move.from.startLine, move.to.startLine], move.id).toEqual([was?.startLine, now?.startLine]);
        expect(move.to.startLine).not.toBe(move.from.startLine);
      }
      // The diff is the committed one, except for where the old map was written and when it was read, and for
      // the ledger units: the committed diff read both ledgers, and this one reads none.
      const committed = JSON.parse(await readFile(join(V2, 'maintain/diff.json'), 'utf8')) as DiffJson;
      const bare = (value: DiffJson) => ({
        ...value,
        units: undefined,
        old: { ...value.old, path: '', readAt: '' },
        new: { ...value.new, path: '' },
      });
      expect(bare(diff)).toEqual(bare(committed));
      return `old ${short(diff.old.hash)} to new ${short(diff.new.hash)}; ${R7} hash ${short(before?.hash ?? '')} to ${short(after?.hash ?? '')}`;
    });
  });

  it('step 8: impact gives 3, 2, 0, 2 on the version 1 tests, and on the generated suite it finds exactly the specs that name a changed atom', async () => {
    await prove('8 impact', 'diff.json, fixture-v2/tests, generated specs', 'impact.json', async () => {
      const diff = must(chain.diff, '7');
      const generated = must(chain.specs, '5');
      const removed = diff.atoms.removed.map((atom) => atom.id);
      const promoted = diff.guards.filter((guard) => guard.move === 'promoted').map((guard) => guard.guard);
      const semantic = diff.atoms.changed
        .filter((change) => change.change === 'semantic')
        .map((change) => change.id);
      const restated = diff.atoms.restated.map((atom) => atom.id);
      const reasonOf = (atom: string) =>
        removed.includes(atom) ? 'removed' : promoted.includes(atom) ? 'guard_state' : 'semantic';

      // The eight version 1 tests of the fixture.
      const out = join(work, 'impact.json');
      const result = await cli([
        'estate',
        'impact',
        join(work, 'diff.json'),
        '--tests',
        join(V2, 'tests'),
        '--out',
        out,
      ]);
      expect(result.err).toBe('');
      // Exit 1: four items wait for a person.
      expect(result.code).toBe(1);
      const impact = JSON.parse(await readFile(out, 'utf8')) as ImpactJson;
      expect(impact.diff).toEqual({ old: diff.old.hash, new: diff.new.hash });
      expect([
        impact.regenerate.length,
        impact.reapprove.length,
        impact.retire.length,
        impact.new.length,
      ]).toEqual([3, 2, 0, 2]);
      // Five items wait for a person: two re-approvals, two new atoms, and the test that cites R12's atom.
      expect(impact.needsPerson).toHaveLength(5);
      // The test that cites an atom no longer in the map is listed, and it is not untouched.
      expect(impact.stale).toMatchObject([{ test: 'northwind-unsent-draft', atoms: [R12] }]);
      expect(impact.unaffected).toEqual({
        moved: diff.atoms.moved.length,
        tests: impact.tests.live - impact.regenerate.length - (impact.stale?.length ?? 0),
      });
      for (const entry of impact.regenerate) {
        // Each regenerated test names, in its own metadata, an atom the diff changed, for the reason given.
        const test = parseYaml(await readFile(join(V2, 'tests', entry.file), 'utf8')) as {
          metadata: { estate: { atoms: string[] } };
        };
        for (const { atom, why } of entry.atoms) {
          expect(test.metadata.estate.atoms, `${entry.test} names ${atom}`).toContain(atom);
          expect([...removed, ...promoted, ...semantic], `${atom} changed in the diff`).toContain(atom);
          expect(why).toBe(reasonOf(atom));
        }
      }
      expect(sorted(impact.regenerate.map((entry) => entry.test))).toEqual([
        'northwind-late-shipment',
        'northwind-ledger-archive',
        'northwind-route-planner',
      ]);
      expect(sorted(impact.reapprove.map((entry) => entry.atom))).toEqual(sorted(semantic));
      expect(impact.reapprove.find((entry) => entry.atom === R7)?.tests).toEqual(['northwind-late-shipment']);
      // R12 is no atom of either map, so no test waits for its re-approval and none is retired.
      expect(impact.reapprove.find((entry) => entry.atom === R12)).toBeUndefined();
      expect(impact.retire).toEqual([]);
      expect(sorted(impact.new.map((entry) => entry.atom))).toEqual(
        sorted(diff.atoms.added.map((atom) => atom.id)),
      );

      // The suite this chain generated, indexed the same way. A spec is retired when all its atoms are
      // removed. It is regenerated when it names an atom that changed in meaning, was restated, was promoted
      // or was removed. A respaced atom and a moved atom touch no spec.
      const suite = generated.filter((entry) => entry.folder.startsWith('specs/'));
      const retiring = suite.filter((entry) => atomsOf(entry).every((atom) => removed.includes(atom)));
      const touching = new Set([...semantic, ...restated, ...promoted, ...removed]);
      const regenerating = suite.filter(
        (entry) => atomsOf(entry).some((atom) => touching.has(atom)) && !retiring.includes(entry),
      );
      const wideOut = join(work, 'impact-generated.json');
      const bulk = await cli([
        'estate',
        'impact',
        join(work, 'diff.json'),
        '--tests',
        join(work, 'generated', 'specs'),
        '--out',
        wideOut,
      ]);
      expect(bulk.err).toBe('');
      expect(bulk.code).toBe(1);
      const wide = JSON.parse(await readFile(wideOut, 'utf8')) as ImpactJson;
      chain.suiteImpact = wide;
      expect(wide.tests.live).toBe(suite.length);
      expect(sorted(wide.regenerate.map((entry) => entry.test))).toEqual(
        sorted(regenerating.map((entry) => entry.spec.id)),
      );
      expect(sorted(wide.retire.map((entry) => entry.test))).toEqual(
        sorted(retiring.map((entry) => entry.spec.id)),
      );
      expect(wide.unaffected.tests).toBe(suite.length - regenerating.length - retiring.length);
      // A moved atom touches no spec: the specs that name moved atoms only are left alone.
      const moved = new Set(diff.atoms.moved.map((atom) => atom.id));
      const restatedNow = new Set(restated);
      const respaced = suite.filter((entry) =>
        atomsOf(entry).every((atom) => moved.has(atom) && !restatedNow.has(atom)),
      );
      expect(respaced.length).toBeGreaterThan(0);
      const touched = new Set([...wide.regenerate, ...wide.retire].map((entry) => entry.test));
      for (const entry of respaced) expect(touched.has(entry.spec.id), entry.spec.id).toBe(false);
      // R7: the specs that wait for re-approval are the generated specs that name R7.
      const namingR7 = suite.filter((entry) => atomsOf(entry).includes(R7)).map((entry) => entry.spec.id);
      expect(namingR7.length).toBeGreaterThan(3);
      expect(sorted(wide.reapprove.find((entry) => entry.atom === R7)?.tests ?? [])).toEqual(
        sorted(namingR7),
      );
      return `diff hashes ${short(impact.diff.old)} and ${short(impact.diff.new)}; ${namingR7.length} generated specs name ${R7}`;
    });
  });

  it('step 9: radius auto derives the change from the edited prompt, and its radius is the generated specs that name the atom', async () => {
    await prove(
      '9 radius',
      'prompt edit, approved.yaml, generated specs',
      'change.yaml, radius report',
      async () => {
        const generated = must(chain.specs, '5');
        const approved = must(chain.approved, '2');
        // The edit: one line of the standing file, as a person would change it. Version 2 of the estate is the
        // fixture with that edit, and nothing else.
        const standing = await readFile(join(FIXTURE, 'CLAUDE.md'), 'utf8');
        expect(standing.split(EDIT_FROM).length - 1, 'the edited wording is in the file once').toBe(1);
        const edited = standing.replace(EDIT_FROM, EDIT_TO);
        const estate = join(work, 'estate-v2');
        await copyEstate(FIXTURE, estate, approved);
        await writeFile(join(estate, 'CLAUDE.md'), edited);
        const editedPrompt = join(estate, 'CLAUDE.md');
        // The change manifest is derived from the edit and the approved map, not written by hand.
        const manifest = join(work, 'change.yaml');
        const auto = await cli([
          'radius',
          'auto',
          '--prompt',
          join(FIXTURE, 'CLAUDE.md'),
          editedPrompt,
          '--map',
          join(work, 'approved.yaml'),
          '--source',
          'CLAUDE.md',
          '--from-version',
          AGENT_V1,
          '--to-version',
          AGENT_V2,
          '--out',
          manifest,
        ]);
        expect(auto.err).toBe('');
        expect(auto.code).toBe(0);
        const derived = parseYaml(await readFile(manifest, 'utf8')) as {
          from: string;
          to: string;
          changes: Array<{ kind: string; id?: string; global?: boolean }>;
        };
        // It names the atom whose quote the edit touched, and no other: not the whole suite. The edit has two
        // regions ("two" to "one", "days" to "day"), and both belong to the quote of the same atom.
        expect([derived.from, derived.to]).toEqual([AGENT_V1, AGENT_V2]);
        expect(derived.changes.length).toBeGreaterThan(0);
        for (const change of derived.changes) {
          expect(change, 'a change of the manifest').toMatchObject({ kind: 'prompt', id: R7 });
          expect(change.global).toBeUndefined();
        }
        const result = await cli([
          'radius',
          join(work, 'generated', 'specs'),
          '--change',
          manifest,
          '--json',
        ]);
        expect(result.err).toBe('');
        const report = JSON.parse(result.out) as RadiusJson;
        // The radius being the whole suite is a failure, and the reason the command gives is printed with it.
        expect(report.whole, `the radius is the whole suite: ${JSON.stringify(report.whole)}`).toBeNull();
        expect(result.code).toBe(0);
        expect(report.manifest).toMatchObject({ from: AGENT_V1, to: AGENT_V2 });
        // One label for each region of the edit, all naming the same atom.
        expect(report.manifest.changes.length).toBeGreaterThan(0);
        expect(new Set(report.manifest.changes)).toEqual(new Set([`prompt:${R7}`]));

        const suite = generated.filter((entry) => entry.folder.startsWith('specs/'));
        const namingR7 = new Set(
          suite.filter((entry) => atomsOf(entry).includes(R7)).map((entry) => entry.spec.id),
        );
        expect(report.specs.map((spec) => spec.specId).sort()).toEqual(
          sorted(suite.map((entry) => entry.spec.id)),
        );
        let inside = 0;
        let outside = 0;
        for (const spec of report.specs) {
          for (const block of spec.blocks) {
            if (namingR7.has(spec.specId)) {
              // Every block of a spec that names the atom is in the radius, for that atom.
              expect(block.state.F, `${spec.specId}/${block.id}`).toBe('direct');
              expect(new Set(block.why), `${spec.specId}/${block.id}`).toEqual(new Set([`prompt:${R7}`]));
              inside++;
            } else {
              expect(block.state.F, `${spec.specId}/${block.id}`).toBe('out');
              outside++;
            }
          }
        }
        expect(inside).toBeGreaterThan(0);
        // At least one block that does not name the atom is out.
        expect(outside).toBeGreaterThan(0);
        expect(report.totals.F).toMatchObject({ in: inside, direct: inside, forward: 0, out: outside });

        // The radius, the impact of step 8 and the metadata of step 5 name the same specs.
        const impact = must(chain.suiteImpact, '8');
        expect(sorted(impact.reapprove.find((entry) => entry.atom === R7)?.tests ?? [])).toEqual(
          sorted(namingR7),
        );
        chain.radius = { manifest, report, editedPrompt, estate };
        return `manifest ${report.manifest.hash} names ${R7}; ${inside} of ${inside + outside} blocks in the radius, ${outside} out`;
      },
    );
  });

  // Steps 10 and 11 run campaigns of the stand-in through the live adapter, in this process, as the radius
  // tests of the Acme suite do: the agent version labels the estate, and a radius run carries the stored runs.
  const outcomeOf = (run: RunResult): string =>
    run.status !== 'completed' ? run.status : run.blocks.every((block) => block.pass) ? 'pass' : 'fail';
  // The label of a failing check is the one `estate run` prints: a check that could not decide says so.
  const failingOf = (run: RunResult): string[] =>
    run.blocks.flatMap((block) =>
      block.verdicts
        .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
        .map(
          (verdict) =>
            `block ${block.index}: ${verdict.id}${verdict.outcome === 'inconclusive' ? ' (inconclusive)' : ''}`,
        ),
    );

  /** One campaign through the `campaign` commands, over the estate in `root` and the stand-in command. */
  async function runCampaign(root: string, pins: string[], calls: string, argv: string[]) {
    const library = await loadStateLibrary(STATES);
    const deps: CampaignDeps = {
      ...defaultDeps,
      checks: replayChecks(),
      adapterFor: async (target) =>
        target.adapter === 'claude-code'
          ? claudeCodeLiveAdapter({
              command: FAKE,
              estateRoot: root,
              provider: localProvider(),
              pins,
              library,
              env: { FAKE_MANIFEST: MANIFEST, FAKE_CALLS: calls },
              args: [],
              config: 'isolated',
              retries: { backoffMs: 0 },
            })
          : undefined,
    };
    const output = { out: '', err: '' };
    const io: Io = {
      out: (text) => {
        output.out += text;
      },
      err: (text) => {
        output.err += text;
      },
      cwd: work,
    };
    let code = 0;
    const program = new Command('driftbench')
      .exitOverride()
      .configureOutput({ writeOut: io.out, writeErr: io.err });
    registerCampaignCommands(
      program,
      io,
      (exit) => {
        code = exit;
      },
      deps,
    );
    try {
      await program.parseAsync(['campaign', 'run', ...argv], { from: 'user' });
    } catch (cause) {
      if (!(cause instanceof CommanderError)) throw cause;
      return { code: 2, ...output };
    }
    return { code, ...output };
  }
  /**
   * The calls of the stand-in that answered an ask: one per block sent. The log holds other lines, such as
   * the wave of overloaded answers a planted hazard makes the run retry. A stand-in never called writes no log.
   */
  const callsIn = async (path: string): Promise<number> =>
    (await readFile(path, 'utf8').catch(() => ''))
      .split('\n')
      .filter((line) => line !== '')
      .filter((line) => (JSON.parse(line) as { played?: string }).played !== undefined).length;
  const runsOf = async (id: string): Promise<RunResult[]> => {
    const db = await openStore(join(work, 'campaigns.db'));
    try {
      return await db.listRuns({ campaignId: id });
    } finally {
      await db.close();
    }
  };

  it('step 10: the version 1 campaign runs the specs of step 6 and those that name the edited atom, and stores their verdicts', async () => {
    await prove(
      '10 campaign v1',
      'step 6 specs, specs naming the edited atom, fixture estate',
      'campaigns.db c-v1',
      async () => {
        const approved = must(chain.approved, '2');
        const stepSix = must(chain.universe, '6');
        const radius = must(chain.radius, '9');
        const generated = must(chain.specs, '5');
        // Step 6 deletes the gate, so its specs name the gate; the edit of step 9 is to another atom. The campaigns run
        // the specs of step 6 and every live spec that names the edited atom, so the subset of step 11 is the latter.
        const live = generated.filter((entry) => entry.folder === 'specs/live');
        const namingEdited = live.filter((entry) => atomsOf(entry).includes(R7));
        expect(namingEdited.length).toBeGreaterThan(0);
        const entries = [
          ...stepSix.entries,
          ...namingEdited.filter((entry) => !stepSix.entries.includes(entry)),
        ];
        const paths = entries.map((entry) => entry.path).sort();
        // The verdicts the campaigns must reproduce: `estate run` of the same specs on version 1 and on version 2.
        // The specs of R7 are judged, and the stand-in judge passes a reply unless it holds the words of the
        // silent reply that the stand-in plays on version 2. The edited estate no longer matches the approved
        // map (the quote of R7 moved), so `--map` would refuse it: the specs carry the map hash, and this run
        // does not check it.
        const v1 = await estateRun(
          'subset-v1',
          FIXTURE,
          paths,
          '--map',
          join(work, 'approved.yaml'),
          ...JUDGE,
        );
        const v2 = await judgeFailing(SILENT_REPLY, () =>
          estateRun('subset-v2', radius.estate, paths, ...JUDGE),
        );
        const universe = {
          entries,
          naming: new Set(namingEdited.map((entry) => entry.spec.id)),
          before: v1.results,
          after: v2.results,
        };
        chain.subset = universe;
        const calls = join(work, 'calls-v1.jsonl');
        const result = await runCampaign(FIXTURE, [approved.hash], calls, [
          ...paths,
          '--target',
          'claude-code:northwind',
          '--agent-version',
          AGENT_V1,
          '--campaign',
          'c-v1',
          '--store',
          join(work, 'campaigns.db'),
          '--no-cache',
          '--concurrency',
          '1',
          ...JUDGE,
        ]);
        expect(result.err).toBe('');
        // Exit 1: the planted faults of the recorded streams fail by design.
        expect(result.code).toBe(1);
        const runs = await runsOf('c-v1');
        expect(runs.map((run) => run.specId).sort(), 'one run per spec').toEqual(
          universe.entries.map((entry) => entry.spec.id).sort(),
        );
        // Every cell ran, fresh: one block of each reached the stand-in, and none was carried.
        expect(runs.every((run) => run.carried === undefined)).toBe(true);
        const blocks = runs.reduce((sum, run) => sum + run.blocks.length, 0);
        expect(await callsIn(calls)).toBe(blocks);
        // The verdicts are those `estate run` read on the same specs and the same estate.
        for (const run of runs) {
          expect({ outcome: outcomeOf(run), failing: failingOf(run) }, run.specId).toEqual(
            universe.before[run.specId],
          );
        }
        chain.baseline = { runs, calls: blocks };
        return `${runs.length} cells of map ${short(approved.hash)} run as agent version ${AGENT_V1}; ${blocks} blocks sent to the stand-in`;
      },
    );
  });

  it('step 11: only the radius subset is run against the changed prompt, and the rest is carried with its verdict', async () => {
    await prove('11 subset run', 'change.yaml, radius, estate v2', 'campaigns.db c-v2', async () => {
      const approved = must(chain.approved, '2');
      const universe = must(chain.subset, '10');
      const radius = must(chain.radius, '9');
      const baseline = must(chain.baseline, '10');
      const paths = universe.entries.map((entry) => entry.path).sort();
      const ids = universe.entries.map((entry) => entry.spec.id);

      // The subset: the specs of this campaign that step 9 put in the radius of the change.
      const inRadius = new Set(
        radius.report.specs
          .filter((spec) => spec.blocks.some((block) => block.state.F !== 'out'))
          .map((spec) => spec.specId),
      );
      const subset = ids.filter((id) => inRadius.has(id)).sort();
      expect(subset).toEqual(sorted(universe.naming));
      expect(subset.length).toBeLessThan(ids.length);

      // The changed prompt is version 2: the estate of step 9 with its standing file edited. The agent is the
      // stand-in again. It plays its recorded alternative when the quote of the atom is gone from the estate
      // copy, so the specs that name the edited atom and ask what it governs are the ones `estate run` read red.
      const calls = join(work, 'calls-v2.jsonl');
      const result = await judgeFailing(SILENT_REPLY, () =>
        runCampaign(radius.estate, [approved.hash], calls, [
          ...paths,
          '--target',
          'claude-code:northwind',
          '--agent-version',
          AGENT_V2,
          '--campaign',
          'c-v2',
          '--change',
          radius.manifest,
          '--from',
          'c-v1',
          '--store',
          join(work, 'campaigns.db'),
          '--no-cache',
          '--concurrency',
          '1',
          ...JUDGE,
        ]),
      );
      expect(result.err).toBe('');
      // Exit 1: the specs that name the edited atom fail, as `estate run` read on version 2.
      expect(result.code).toBe(1);
      const runs = await runsOf('c-v2');
      expect(runs).toHaveLength(ids.length);
      const fresh = runs.filter((run) => run.carried === undefined);
      const carried = runs.filter((run) => run.carried !== undefined);

      // (a) Exactly the subset ran, and the agent was sent exactly its blocks.
      expect(sorted(fresh.map((run) => run.specId))).toEqual(subset);
      const sent = fresh.reduce((sum, run) => sum + run.blocks.length, 0);
      expect(await callsIn(calls)).toBe(sent);
      expect(sent).toBeLessThan(baseline.calls);

      // (b) Their verdicts are the ones `estate run` read on version 2: the specs that carry a changed ask
      // get the silent reply, which the stand-in judge fails, and the outside-trigger control stays green.
      for (const run of fresh) {
        expect({ outcome: outcomeOf(run), failing: failingOf(run) }, run.specId).toEqual(
          universe.after[run.specId],
        );
      }
      const red = fresh.filter((run) => outcomeOf(run) === 'fail').map((run) => run.specId);
      expect(red.length).toBeGreaterThan(0);
      expect(red.length).toBeLessThan(fresh.length);

      // (c) Every spec outside the subset is carried, not rerun, and its verdict is unchanged: the stored
      // blocks of version 1, the verdict of version 1, and the verdict `estate run` read on version 2.
      expect(sorted(carried.map((run) => run.specId))).toEqual(sorted(ids.filter((id) => !inRadius.has(id))));
      const stored = new Map(baseline.runs.map((run) => [run.specId, run]));
      for (const run of carried) {
        const source = stored.get(run.specId);
        expect(run.carried, run.specId).toMatchObject({
          fromCampaign: 'c-v1',
          fromRun: source?.runId,
          agentVersion: AGENT_V1,
          age: { campaigns: 1 },
        });
        expect(run.blocks, run.specId).toEqual(source?.blocks);
        const verdict = { outcome: outcomeOf(run), failing: failingOf(run) };
        expect(verdict, run.specId).toEqual(universe.before[run.specId]);
        expect(verdict, run.specId).toEqual(universe.after[run.specId]);
      }

      // (d) The report lists the subset and why: the change names the atom, and each cell of the subset
      // is in the radius for that atom, where the others are out.
      const db = await openStore(join(work, 'campaigns.db'));
      const stored2 = await db.getCampaign('c-v2');
      await db.close();
      expect(stored2?.radius).toMatchObject({
        fromVersion: AGENT_V1,
        toVersion: AGENT_V2,
        changes: radius.report.manifest.changes,
        from: 'c-v1',
        fresh: subset.length,
        carried: carried.length,
      });
      expect(stored2?.radius?.manifest).toBe(radius.report.manifest.hash);
      expect(stored2?.radius?.whole).toBeUndefined();
      expect(result.out).toContain(
        `Blast radius of ${AGENT_V1} to ${AGENT_V2} (manifest ${radius.report.manifest.hash}): ${radius.report.manifest.changes.join(', ')}.`,
      );
      expect(result.out).toContain(
        `${subset.length} of ${ids.length} cells in the radius. ${subset.length} cells run fresh, ${carried.length} carried from c-v1.`,
      );
      expect(result.out).toContain(`Saved: ${baseline.calls - sent} of ${baseline.calls} blocks`);
      for (const id of subset) expect(result.out, id).toMatch(new RegExp(`${id} .* (pass|fail)`));
      for (const id of carried.map((run) => run.specId)) {
        expect(result.out, id).toContain(`${id} · claude-code:northwind · F · repeat 0`);
      }
      const why = radius.report.specs.filter((spec) => subset.includes(spec.specId));
      for (const spec of why) {
        for (const block of spec.blocks)
          expect(new Set(block.why), spec.specId).toEqual(new Set([`prompt:${R7}`]));
      }
      return `${subset.length} of ${ids.length} specs run (${sent} blocks sent, ${baseline.calls - sent} saved), ${carried.length} carried from c-v1; ${red.length} red on the changed ${R7}`;
    });
  });

  it('step 12: an edit that changes no rule selects no spec and runs no cell', async () => {
    await prove(
      '12 no-rule edit',
      'CRLF prompt, approved.yaml, c-v1',
      'empty change.yaml, c-v1-crlf',
      async () => {
        const approved = must(chain.approved, '2');
        const universe = must(chain.subset, '10');
        const baseline = must(chain.baseline, '10');
        const ids = universe.entries.map((entry) => entry.spec.id);
        const paths = universe.entries.map((entry) => entry.path).sort();

        // The edit: the standing file with its line endings turned from LF to CRLF. No word changes.
        const standing = await readFile(join(FIXTURE, 'CLAUDE.md'), 'utf8');
        expect(standing.includes('\r')).toBe(false);
        const estate = join(work, 'estate-crlf');
        await copyEstate(FIXTURE, estate, approved);
        await writeFile(join(estate, 'CLAUDE.md'), standing.replace(/\n/g, '\r\n'));
        const manifest = join(work, 'change-crlf.yaml');
        // The edit is a new version of the agent, as a person would label it. It changes no word.
        const auto = await cli([
          'radius',
          'auto',
          '--prompt',
          join(FIXTURE, 'CLAUDE.md'),
          join(estate, 'CLAUDE.md'),
          '--map',
          join(work, 'approved.yaml'),
          '--source',
          'CLAUDE.md',
          '--from-version',
          AGENT_V1,
          '--to-version',
          AGENT_V2,
          '--out',
          manifest,
        ]);
        expect(auto.err).toBe('');
        expect(auto.code).toBe(0);
        const derived = parseYaml(await readFile(manifest, 'utf8')) as { changes: unknown[] };
        expect(derived.changes).toEqual([]);

        // The radius of that manifest over the whole generated suite is empty: every block is outside it.
        const selected = await cli([
          'radius',
          join(work, 'generated', 'specs'),
          '--change',
          manifest,
          '--json',
        ]);
        expect(selected.err).toBe('');
        expect(selected.code).toBe(0);
        const report = JSON.parse(selected.out) as RadiusJson;
        expect(report.whole).toBeNull();
        expect(report.totals.F).toMatchObject({ in: 0, direct: 0, forward: 0 });
        expect(report.totals.F?.out).toBeGreaterThan(0);

        // And the campaign runs no cell: every spec is carried from c-v1 and the stand-in is never called.
        const calls = join(work, 'calls-crlf.jsonl');
        const result = await runCampaign(estate, [approved.hash], calls, [
          ...paths,
          '--target',
          'claude-code:northwind',
          '--agent-version',
          AGENT_V2,
          '--campaign',
          'c-v1-crlf',
          '--change',
          manifest,
          '--from',
          'c-v1',
          '--store',
          join(work, 'campaigns.db'),
          '--no-cache',
          '--concurrency',
          '1',
        ]);
        expect(result.err).toBe('');
        // Exit 1: the carried runs of the planted faults are still red.
        expect(result.code).toBe(1);
        const runs = await runsOf('c-v1-crlf');
        expect(runs.map((run) => run.specId).sort()).toEqual([...ids].sort());
        expect(runs.filter((run) => run.carried === undefined)).toEqual([]);
        const stored = new Map(baseline.runs.map((run) => [run.specId, run]));
        for (const run of runs) {
          expect(run.carried, run.specId).toMatchObject({ fromCampaign: 'c-v1', agentVersion: AGENT_V1 });
          expect(run.blocks, run.specId).toEqual(stored.get(run.specId)?.blocks);
        }
        expect(await callsIn(calls)).toBe(0);
        const db = await openStore(join(work, 'campaigns.db'));
        const record = (await db.getCampaign('c-v1-crlf'))?.radius;
        await db.close();
        expect(record).toMatchObject({
          fromVersion: AGENT_V1,
          toVersion: AGENT_V2,
          changes: [],
          fresh: 0,
          carried: ids.length,
          from: 'c-v1',
        });
        expect(result.out).toContain(
          `0 of ${ids.length} cells in the radius. 0 cells run fresh, ${ids.length} carried from c-v1.`,
        );
        return `a CRLF edit of the standing file: ${derived.changes.length} changes, 0 of ${ids.length} specs selected, 0 cells run, ${ids.length} carried`;
      },
    );
  });

  it('step 13: every hand-off above is verified, and the table lists them', () => {
    // The table is printed even when a step failed, so the failing step shows as NO.
    console.log(`\n${table()}\n`);
    expect(rows.map((row) => row.step.split(' ')[0])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
    ]);
    expect(rows.filter((row) => row.verified !== 'yes')).toEqual([]);
  });
});
