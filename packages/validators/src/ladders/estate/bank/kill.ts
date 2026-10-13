import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type EstateMap, loadEstateMap } from '@agent-nexus/driftbench-estate';
import { cli } from './bench';
import { FIXTURE, fixtureSuite, runOnFake } from './fixture-suite';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';

/**
 * kill.fake: the mutant kill rate per mutant class, on the fake runtime (docs/estate.md section 8, estate
 * mutants). For an atom kind and an operation (delete, or invert for prose obligations), the n-th atom of
 * that kind in the Northwind fixture's approved map is mutated with `estate mutate`; the generated suite must
 * hold a complete live spec naming that atom which passes on the original estate and fails on the mutant,
 * both run with the fixture's fake runtime. One cause per atom kind: a generated test that a change of that
 * kind of atom turns red. The fixture does not depend on the seed: the family is judged once.
 */

const COMPONENT = 'packages/generate/src/estate/generate.ts';
const SPECS_PER_ATOM = 4;

export type Cell = { kind: string; index: number; op: 'delete' | 'invert'; tier: Tier };

const KINDS: Array<[string, Tier]> = [
  ['instruction', 2],
  ['gate', 2],
  ['reference', 2],
  ['route', 1],
  ['skill', 1],
  ['script', 3],
  ['subagent', 3],
  ['guard', 3],
  ['tool', 2],
  ['register', 3],
  ['stage', 3],
  ['hazard', 4],
  ['setting', 4],
  ['invariant', 4],
];

const CELLS: Cell[] = [
  ...KINDS.flatMap(([kind, tier]) => [0, 1].map((index) => ({ kind, index, op: 'delete' as const, tier }))),
  { kind: 'instruction', index: 0, op: 'invert', tier: 3 },
  { kind: 'gate', index: 0, op: 'invert', tier: 3 },
  { kind: 'register', index: 0, op: 'invert', tier: 4 },
];

const keyOf = (cell: Cell) => `${cell.op}-${cell.kind}-${cell.index + 1}`;

export function killFamily(): Family {
  const family = 'kill.fake';
  const items = itemsOf(
    family,
    5,
    COMPONENT,
    CELLS.map((cell) => ({
      key: keyOf(cell),
      tier: cell.tier,
      title: `a generated spec, green on the original fixture, turns red on the ${cell.op} mutant of ${cell.kind} atom ${cell.index + 1}`,
      cause: `generate a test that a change of a ${cell.kind} atom turns red on the fake runtime`,
    })),
  );
  return {
    id: family,
    level: 5,
    component: COMPONENT,
    items,
    seedFree: true,
    async evaluate() {
      const out = new Map<string, ItemResult>();
      const suite = await fixtureSuite();
      const map = await loadEstateMap(suite.map);
      if (!map.ok) {
        for (const item of items) out.set(item.id, { pass: false, detail: 'the fixture map does not load' });
        return out;
      }
      const work = await mkdtemp(join(tmpdir(), 'estate-kill-'));
      const originalVerdict = new Map<string, boolean>();
      try {
        for (const cell of CELLS) {
          out.set(
            `${family}.${keyOf(cell)}`,
            await judge(cell, map.map, suite.specs, join(FIXTURE, 'approved.yaml'), work, originalVerdict),
          );
        }
      } finally {
        await rm(work, { recursive: true, force: true });
      }
      return out;
    },
  };
}

async function judge(
  cell: Cell,
  estate: EstateMap,
  specs: Awaited<ReturnType<typeof fixtureSuite>>['specs'],
  map: string,
  work: string,
  original: Map<string, boolean>,
): Promise<ItemResult> {
  const atom = estate.atoms
    .filter((candidate) => candidate.kind === cell.kind)
    .map((candidate) => candidate.id)
    .sort()[cell.index];
  if (!atom) return { pass: false, detail: `the fixture holds no ${cell.kind} atom ${cell.index + 1}` };
  // docs/estate.md section 5: invariant and setting rows are static tests, run by `estate static` on the
  // original or a mutant copy. They never have a live spec, so they are judged by their static tests.
  if (cell.kind === 'setting' || cell.kind === 'invariant') return judgeStatic(cell, atom, specs, map, work);
  const same = equivalent(cell, atom, estate);
  if (same) return { pass: true, detail: `not judged, an equivalent mutant: ${same}` };
  const naming = specs.filter((spec) => spec.complete && spec.mode === 'live' && spec.atoms.includes(atom));
  if (naming.length === 0) return { pass: false, detail: `no complete live spec names ${atom}` };
  const chosen = naming.slice(0, SPECS_PER_ATOM);
  const unknown = chosen.filter((spec) => !original.has(spec.id));
  if (unknown.length > 0) {
    const verdicts = runOnFake(
      FIXTURE,
      unknown.map((spec) => spec.path),
      join(work, `original-${original.size}.db`),
      map,
    );
    for (const spec of unknown) original.set(spec.id, verdicts.get(spec.id) === true);
  }
  const green = chosen.filter((spec) => original.get(spec.id));
  if (green.length === 0)
    return {
      pass: false,
      detail: `none of the ${chosen.length} complete live specs naming ${atom} passes on the original`,
    };
  const mutant = join(work, `${cell.op}-${cell.kind}-${cell.index}`);
  const made = cli(['estate', 'mutate', map, '--atom', atom, `--${cell.op}`, '--to', mutant]);
  if (made.code !== 0)
    return {
      pass: false,
      detail: `estate mutate refused the ${cell.op} of ${atom}: ${made.out.trim().slice(0, 140)}`,
    };
  const verdicts = runOnFake(
    mutant,
    green.map((spec) => spec.path),
    join(mutant, 'runs.db'),
  );
  const red = green.filter((spec) => verdicts.get(spec.id) === false);
  return red.length > 0
    ? { pass: true, detail: `${red[0]?.id} turns red` }
    : {
        pass: false,
        detail: `the ${green.length} specs green on the original stay green on the ${cell.op} mutant of ${atom}`,
      };
}

/**
 * Why the mutant of the cell's atom is equivalent (nothing the agent sees or does changes), or undefined. Read
 * from the fixture's files and map, never from the product under test:
 * - a skill's `name:` line whose value is the skill's folder: the runtime names a skill by its folder
 *   (docs/estate.md section 8, the same rule `estate mutate` follows when it refuses the delete);
 * - a gate whose ordered pair the step list already imposes: every `next` edge into the later stage comes from
 *   the earlier one, so deleting the gate leaves the order an obeying agent follows unchanged.
 */
export function equivalent(cell: Cell, atomId: string, estate: EstateMap): string | undefined {
  if (cell.op !== 'delete') return undefined;
  const atom = estate.atoms.find((candidate) => candidate.id === atomId);
  if (!atom) return undefined;
  if (atom.kind === 'skill') {
    const folder = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(atom.provenance.file)?.[1];
    const name = /^name:\s*(\S+)\s*$/.exec(atom.provenance.quote.trim())?.[1];
    return folder && name === folder
      ? `the name line of ${atom.provenance.file} repeats its folder, ${folder}, and the runtime names a skill by its folder`
      : undefined;
  }
  if (atom.kind === 'gate') {
    const pair = atom.evidence.find((item) => item.type === 'ordered') as
      | { type: 'ordered'; before: string; after: string }
      | undefined;
    if (!pair) return undefined;
    const stageOf = (name: string) =>
      estate.atoms.find((candidate) => candidate.kind === 'stage' && candidate.fields?.id === name);
    const before = stageOf(pair.before);
    const after = stageOf(pair.after);
    if (!before || !after || after.fields?.anytime === true) return undefined;
    const into = estate.edges.filter((edge) => edge.kind === 'next' && edge.to === after.id);
    return into.length > 0 && into.every((edge) => edge.from === before.id)
      ? `the step list reaches ${pair.after} only from ${pair.before}, the order the gate asks for`
      : undefined;
  }
  return undefined;
}

/** A setting or invariant cell: a static test naming the atom passes on the original and fails on the mutant. */
async function judgeStatic(
  cell: Cell,
  atom: string,
  specs: Awaited<ReturnType<typeof fixtureSuite>>['specs'],
  map: string,
  work: string,
): Promise<ItemResult> {
  const tests = specs
    .filter((spec) => spec.mode === 'static' && spec.atoms.includes(atom))
    .map((spec) => spec.path);
  if (tests.length === 0) return { pass: false, detail: `no static test names ${atom}` };
  const verdicts = (estate: string): boolean[] => {
    const run = cli(['estate', 'static', ...tests, '--estate', estate, '--json']);
    const at = run.out.indexOf('{');
    if (at < 0) return [];
    try {
      return ((JSON.parse(run.out.slice(at)) as { results?: Array<{ pass: boolean }> }).results ?? []).map(
        (result) => result.pass === true,
      );
    } catch {
      return [];
    }
  };
  const original = verdicts(FIXTURE);
  if (!original.some(Boolean))
    return {
      pass: false,
      detail: `none of the ${tests.length} static tests naming ${atom} passes on the original`,
    };
  const mutant = join(work, `${cell.op}-${cell.kind}-${cell.index}`);
  const made = cli(['estate', 'mutate', map, '--atom', atom, `--${cell.op}`, '--to', mutant]);
  if (made.code !== 0)
    return {
      pass: false,
      detail: `estate mutate refused the ${cell.op} of ${atom}: ${made.out.trim().slice(0, 140)}`,
    };
  const after = verdicts(mutant);
  return original.some((green, index) => green && after[index] === false)
    ? { pass: true, detail: `a static test of ${atom} turns red on the ${cell.op} mutant` }
    : {
        pass: false,
        detail: `the static tests green on the original stay green on the ${cell.op} mutant of ${atom}`,
      };
}
