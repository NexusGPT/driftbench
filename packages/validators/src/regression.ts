import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { type FloorsFile, floorOf } from './floors';

/** The list of seeds that exposed a real defect (docs/validators.md, section 12.5, "Regression seeds"). */
export const REGRESSION_FILE = 'validators/regression-seeds.json';

const COMPONENT = /^[a-z][a-z0-9-]*$/;

export const RegressionSeed = z
  .object({
    /** `<component>-<seed>`: the name of the CI leg that runs the entry. */
    id: z.string().min(1),
    component: z.string().regex(COMPONENT),
    /** The seed number, run as an ordinary seed: the hidden flag changes only the label of a run. */
    seed: z.number().int().min(0).safe(),
    /**
     * The seed must pass every level from 1 through this one, and through the floor of its validator when that is
     * higher (`regressionThrough`). The level the defect showed at; raised, never lowered.
     */
    through: z.number().int().min(1),
    /** The pull request that fixed the defect, or the word `open` while it is not fixed. */
    fixedBy: z.string().min(1),
    /** What the seed showed, in a sentence: the level and the items that failed. */
    defect: z.string().min(1),
    /** The runs that show the defect and its fix. */
    evidence: z.string().min(1),
  })
  .strict();

export type RegressionSeed = z.infer<typeof RegressionSeed>;

export const RegressionFileSchema = z
  .object({ version: z.literal(1), seeds: z.array(RegressionSeed) })
  .strict();

export type RegressionFile = z.infer<typeof RegressionFileSchema>;

/** The name of the leg that runs an entry. */
export function regressionId(component: string, seed: number): string {
  return `${component}-${seed}`;
}

/**
 * Reads validators/regression-seeds.json; an absent file holds no seed. Throws on a file that does not parse, an
 * entry whose id is not `<component>-<seed>`, a repeated id, or an entry for a component or a level that does not
 * exist (`tops` maps each registered component to the number of its levels).
 */
export function readRegressionSeeds(root: string, tops: Readonly<Record<string, number>>): RegressionSeed[] {
  const path = join(root, REGRESSION_FILE);
  if (!existsSync(path)) return [];
  const parsed = RegressionFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.map(String).join('.') || '(file)'} ${issue.message}`,
    );
    throw new Error(`${REGRESSION_FILE} is not a regression list: ${issues.join('; ')}`);
  }
  const seen = new Set<string>();
  for (const entry of parsed.data.seeds) {
    if (entry.id !== regressionId(entry.component, entry.seed)) {
      throw new Error(
        `${REGRESSION_FILE}: the id of ${entry.id} is not ${regressionId(entry.component, entry.seed)}.`,
      );
    }
    if (seen.has(entry.id)) throw new Error(`${REGRESSION_FILE}: ${entry.id} is listed twice.`);
    seen.add(entry.id);
    const top = tops[entry.component];
    if (top === undefined) throw new Error(`${REGRESSION_FILE}: ${entry.id} names no registered validator.`);
    if (entry.through > top) {
      throw new Error(
        `${REGRESSION_FILE}: ${entry.id} asks through level ${entry.through}; ${entry.component} has ${top}.`,
      );
    }
  }
  return parsed.data.seeds;
}

/**
 * The last level an entry runs: the level the defect showed at, or the floor of the validator at its registered
 * ladder version when that is higher, never above the top. A floor raise widens every entry with no edit of the
 * list, so a regression seed cannot drop at a level between the defect and the floor unseen.
 */
export function regressionThrough(
  entry: Pick<RegressionSeed, 'component' | 'through'>,
  floors: FloorsFile,
  version: number,
  top: number,
): number {
  return Math.min(top, Math.max(entry.through, floorOf(floors, entry.component, version)));
}

const Row = z.object({
  level: z.number().int(),
  id: z.string().optional(),
  pass: z.boolean().nullable(),
  items: z.array(z.object({ id: z.string() })).optional(),
  bank: z.array(z.object({ id: z.string(), pass: z.boolean().optional() })).optional(),
});
const Report = z.object({
  component: z.string(),
  seeds: z.array(z.object({ seed: z.number().int(), rows: z.array(Row) })),
});

/**
 * Checks the `--json` report of `validate <component> --seed <seed> --levels 1..<through>` against its entry: it
 * is the report of that component and that seed alone, and every level from 1 through `through` (the entry's, or
 * `regressionThrough` when the floor is higher) was computed and passed. Returns the problems; an empty list means the seed holds. A level that was not computed (null) is a
 * problem, never a pass.
 */
export function checkRegressionReport(
  entry: RegressionSeed,
  report: unknown,
  through = entry.through,
): string[] {
  const parsed = Report.safeParse(report);
  if (!parsed.success) return [`the report of ${entry.id} is not a validate --json report`];
  const { component, seeds } = parsed.data;
  if (component !== entry.component)
    return [`the report of ${entry.id} is for ${component}, not ${entry.component}`];
  const run = seeds[0];
  if (seeds.length !== 1 || run === undefined || run.seed !== entry.seed) {
    return [`the report of ${entry.id} does not hold seed ${entry.seed} alone`];
  }
  const problems: string[] = [];
  for (let level = 1; level <= through; level += 1) {
    const row = run.rows.find((candidate) => candidate.level === level);
    if (row === undefined || row.pass === null)
      problems.push(`level ${level} of ${entry.id} was not computed`);
    else if (!row.pass) {
      const failing = (row.items ?? []).map((item) => item.id);
      const named =
        failing.length > 0
          ? failing
          : (row.bank ?? []).filter((item) => item.pass === false).map((item) => item.id);
      problems.push(
        `level ${level}${row.id ? ` (${row.id})` : ''} of ${entry.id} fails${named.length > 0 ? `: ${named.slice(0, 8).join(', ')}${named.length > 8 ? `, and ${named.length - 8} more` : ''}` : ''}`,
      );
    }
  }
  return problems;
}
