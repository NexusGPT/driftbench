import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { loadEstateMap } from '@driftbench/estate';
import { REPO } from './bench';
import { FIXTURE, fixtureSuite } from './fixture-suite';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';

/**
 * estate.stats: the coverage lines of docs/estate.md section 7 ("Not built yet: coverage lines per atom kind:
 * atoms with an approved test over atoms; atoms enforced by a guard over atoms"), on the Northwind fixture.
 * The command and its JSON are written in docs/estate.md section 7, "The coverage command: `estate stats`",
 * and docs/reference/cli.md (frozen: a change needs an audit finding). The oracle
 * counts from the approved map and the generated suite: atoms of the kind; those named by a complete spec;
 * those whose enforcement lists a guard. Seed-free, judged once.
 */

const COMPONENT = 'packages/cli/src/commands/estate-stats.ts';

const KINDS: Array<[string, Tier]> = [
  ['instruction', 2],
  ['gate', 2],
  ['reference', 2],
  ['route', 1],
  ['skill', 1],
  ['script', 2],
  ['subagent', 2],
  ['guard', 2],
  ['tool', 2],
  ['register', 2],
  ['stage', 2],
  ['hazard', 3],
  ['setting', 3],
  ['invariant', 3],
];

type Line = 'tested' | 'enforced';
type Truth = Record<string, { atoms: number; tested: number; enforced: number }>;
type Reported = Record<string, { atoms?: number; tested?: number; enforced?: number }>;

const CAUSES: Record<Line, string> = {
  tested: 'report per atom kind the atoms with an approved test over the atoms',
  enforced: 'report per atom kind the atoms enforced by a guard over the atoms',
};

export function statsFamily(): Family {
  const family = 'estate.stats';
  const cells = KINDS.flatMap(([kind, tier]) =>
    (['tested', 'enforced'] as const).map((line) => ({ kind, line, tier })),
  );
  const items = itemsOf(
    family,
    4,
    COMPONENT,
    cells.map(({ kind, line, tier }) => ({
      key: `${line}-${kind}`,
      tier,
      title: `estate stats reports the ${kind} atoms ${line === 'tested' ? 'with an approved test' : 'enforced by a guard'}, over the ${kind} atoms`,
      cause: CAUSES[line],
    })),
  );
  return {
    id: family,
    level: 4,
    component: COMPONENT,
    items,
    seedFree: true,
    async evaluate() {
      const out = new Map<string, ItemResult>();
      const suite = await fixtureSuite();
      const map = await loadEstateMap(join(FIXTURE, 'approved.yaml'));
      if (!map.ok) {
        for (const item of items) out.set(item.id, { pass: false, detail: 'the fixture map does not load' });
        return out;
      }
      const truth: Truth = {};
      for (const atom of map.map.atoms) {
        if (!atom.approved) continue;
        const entry = (truth[atom.kind] ??= { atoms: 0, tested: 0, enforced: 0 });
        entry.atoms += 1;
        if (suite.specs.some((spec) => spec.complete && spec.atoms.includes(atom.id))) entry.tested += 1;
        if ((atom.enforcement ?? []).length > 0) entry.enforced += 1;
      }
      const result = spawnSync(
        'pnpm',
        [
          '-s',
          'driftbench',
          'estate',
          'stats',
          '--map',
          suite.map,
          '--plan',
          join(suite.work, 'plan.yaml'),
          '--specs',
          join(suite.work, 'suite'),
          '--json',
        ],
        { cwd: REPO, encoding: 'utf8', timeout: 300_000 },
      );
      const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      let reported: Reported | undefined;
      try {
        reported = (JSON.parse(text.slice(text.indexOf('{'))) as { coverage?: { kinds?: Reported } }).coverage
          ?.kinds;
      } catch {
        reported = undefined;
      }
      for (const { kind, line } of cells) {
        const id = `${family}.${line}-${kind}`;
        const want = truth[kind] ?? { atoms: 0, tested: 0, enforced: 0 };
        if (!reported) {
          out.set(id, {
            pass: false,
            detail: `estate stats printed no coverage (exit ${result.status}): ${text.trim().slice(0, 100)}`,
          });
          continue;
        }
        const got = reported[kind] ?? {};
        const ok = got.atoms === want.atoms && got[line] === want[line];
        out.set(
          id,
          ok
            ? { pass: true, detail: `holds (${want[line]} of ${want.atoms})` }
            : {
                pass: false,
                detail: `reported ${got[line]} of ${got.atoms}, expected ${want[line]} of ${want.atoms}`,
              },
        );
      }
      return out;
    },
  };
}
