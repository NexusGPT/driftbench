import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { LadderReport } from './ladder';

/** Where the floors live, from the repository root. */
export const FLOORS_FILE = 'validators/floors.json';

const Evidence = z
  .object({
    level: z.number().int().min(1),
    seeds: z.array(z.string()).min(2),
    hiddenSeed: z.number().int().min(0),
    head: z.string().optional(),
  })
  .strict();

export const FloorsFileSchema = z
  .object({
    version: z.literal(1),
    floors: z.record(z.string(), z.number().int().min(0)),
    evidence: z.record(z.string(), Evidence).optional(),
  })
  .strict();

export type FloorsFile = z.infer<typeof FloorsFileSchema>;
export type FloorEvidence = z.infer<typeof Evidence>;

/** Reads validators/floors.json; an absent file holds no floor. Throws on a file that does not parse. */
export function readFloors(root: string): FloorsFile {
  const path = join(root, FLOORS_FILE);
  if (!existsSync(path)) return { version: 1, floors: {} };
  const parsed = FloorsFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    throw new Error(`${FLOORS_FILE} is not a floors file: ${parsed.error.issues.map(issueText).join('; ')}`);
  }
  return parsed.data;
}

/** The floor of a component; 0 when it has none. */
export function floorOf(file: FloorsFile, component: string): number {
  return file.floors[component] ?? 0;
}

export function writeFloors(root: string, file: FloorsFile): void {
  const sorted: FloorsFile = {
    version: 1,
    floors: Object.fromEntries(Object.entries(file.floors).sort(([a], [b]) => a.localeCompare(b))),
    ...(file.evidence
      ? { evidence: Object.fromEntries(Object.entries(file.evidence).sort(([a], [b]) => a.localeCompare(b))) }
      : {}),
  };
  writeFileSync(join(root, FLOORS_FILE), `${JSON.stringify(sorted, null, 2)}\n`);
}

/** One floor comparison: the level of the run against the floor of its component. */
export type FloorCheck = { component: string; level: number; floor: number; holds: boolean };

/**
 * Compares runs with their floors, and names the floors that cannot be checked: a floor on a component no
 * validator is registered for, or a floor above the top of its ladder.
 */
export function checkFloors(
  reports: readonly LadderReport[],
  file: FloorsFile,
  registered: Record<string, { top: number }>,
): { checks: FloorCheck[]; problems: string[] } {
  const checks = reports.map((report) => {
    const floor = floorOf(file, report.component);
    return { component: report.component, level: report.level, floor, holds: report.level >= floor };
  });
  const problems: string[] = [];
  for (const [component, floor] of Object.entries(file.floors)) {
    const ladder = registered[component];
    if (!ladder)
      problems.push(`${FLOORS_FILE} holds a floor for ${component}, which has no registered validator.`);
    else if (floor > ladder.top)
      problems.push(
        `${FLOORS_FILE} sets ${component} to ${floor}, above the top of its ladder (${ladder.top}).`,
      );
  }
  return { checks, problems };
}

const EvidenceRun = z.object({ seed: z.number().int(), hidden: z.boolean(), level: z.number().int().min(0) });
const EvidenceReport = z.object({
  component: z.string(),
  level: z.number().int().min(0),
  top: z.number().int().min(1),
  seeds: z.array(EvidenceRun).min(1),
  hiddenSeed: z.object({
    seed: z.number().int(),
    source: z.enum(['head', 'fallback']),
    head: z.string().optional(),
  }),
});

export type RaiseRequest = {
  component: string;
  level: number;
  /** The parsed `driftbench validate <component> --json` output that justifies the rise. */
  evidence: unknown;
  /** The top level of the component's registered ladder. */
  top: number;
};

/**
 * Raises one floor. Refuses a level at or below the current floor (the floor only rises), a level above the
 * ladder's top, and evidence that is not a `--json` run of the component on at least one visible seed and the
 * hidden seed derived from a commit, reaching the level on every seed.
 */
export function raiseFloor(
  file: FloorsFile,
  request: RaiseRequest,
): { file: FloorsFile } | { refused: string } {
  const { component, level, top } = request;
  const current = floorOf(file, component);
  if (!Number.isInteger(level) || level < 1)
    return { refused: `A floor is a whole level of at least 1, not ${level}.` };
  if (level > top) return { refused: `${component} has ${top} levels; ${level} is above its top.` };
  if (level <= current) {
    return {
      refused: `The floor of ${component} is ${current}; it only rises, so ${level} is refused.`,
    };
  }
  const candidates = Array.isArray((request.evidence as { reports?: unknown })?.reports)
    ? ((request.evidence as { reports: unknown[] }).reports as unknown[])
    : [request.evidence];
  const found = candidates.find((entry) => (entry as { component?: unknown })?.component === component);
  if (!found) return { refused: `The evidence holds no run of ${component}.` };
  const parsed = EvidenceReport.safeParse(found);
  if (!parsed.success) {
    return {
      refused: `The evidence is not a driftbench validate --json run: ${parsed.error.issues.map(issueText).join('; ')}`,
    };
  }
  const report = parsed.data;
  if (report.top !== top) {
    return { refused: `The evidence ran a ladder of ${report.top} levels; ${component} now has ${top}.` };
  }
  const visible = report.seeds.filter((run) => !run.hidden);
  const hidden = report.seeds.filter((run) => run.hidden);
  if (visible.length === 0 || hidden.length === 0) {
    return { refused: 'The evidence must run at least one visible seed and the hidden seed (--hidden).' };
  }
  if (report.hiddenSeed.source !== 'head') {
    return { refused: 'The evidence ran the fallback hidden seed; run it inside the repository.' };
  }
  const minimum = Math.min(...report.seeds.map((run) => run.level));
  if (minimum !== report.level) {
    return { refused: `The evidence says level ${report.level} but its seeds give ${minimum}.` };
  }
  const short = report.seeds.filter((run) => run.level < level);
  if (short.length > 0) {
    return {
      refused: `The evidence does not reach ${level} on seed ${short
        .map((run) => (run.hidden ? 'hidden' : String(run.seed)))
        .join(', ')}.`,
    };
  }
  const evidence: FloorEvidence = {
    level: report.level,
    seeds: report.seeds.map((run) => (run.hidden ? 'hidden' : String(run.seed))),
    hiddenSeed: report.hiddenSeed.seed,
    ...(report.hiddenSeed.head ? { head: report.hiddenSeed.head } : {}),
  };
  return {
    file: {
      version: 1,
      floors: { ...file.floors, [component]: level },
      evidence: { ...(file.evidence ?? {}), [component]: evidence },
    },
  };
}

function issueText(issue: { path: PropertyKey[]; message: string }): string {
  return `${issue.path.map(String).join('.') || '(file)'} ${issue.message}`;
}
