import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
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

type Cell = { kind: string; index: number; op: 'delete' | 'invert'; tier: Tier };

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
            await judge(
              cell,
              map.map.atoms,
              suite.specs,
              join(FIXTURE, 'approved.yaml'),
              work,
              originalVerdict,
            ),
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
  atoms: ReadonlyArray<{ id: string; kind: string }>,
  specs: Awaited<ReturnType<typeof fixtureSuite>>['specs'],
  map: string,
  work: string,
  original: Map<string, boolean>,
): Promise<ItemResult> {
  const atom = atoms
    .filter((candidate) => candidate.kind === cell.kind)
    .map((candidate) => candidate.id)
    .sort()[cell.index];
  if (!atom) return { pass: false, detail: `the fixture holds no ${cell.kind} atom ${cell.index + 1}` };
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
