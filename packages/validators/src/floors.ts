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
    ladderVersion: z.number().int().min(1).optional(),
  })
  .strict();

const HistoryEntry = z
  .object({
    ladderVersion: z.number().int().min(1),
    floor: z.number().int().min(0),
    evidence: Evidence.optional(),
  })
  .strict();

/** The first format: one floor per component, no ladder version. Read and migrated to version 2. */
const FloorsFileV1 = z
  .object({
    version: z.literal(1),
    floors: z.record(z.string(), z.number().int().min(0)),
    evidence: z.record(z.string(), Evidence).optional(),
  })
  .strict();

/**
 * validators/floors.json, version 2 (docs/validators.md section 12.5): the floor of each component holds for
 * its `ladderVersion`; the floors of earlier ladder versions are kept under `history`, oldest first.
 */
export const FloorsFileSchema = z
  .object({
    version: z.literal(2),
    ladderVersion: z.record(z.string(), z.number().int().min(1)),
    floors: z.record(z.string(), z.number().int().min(0)),
    evidence: z.record(z.string(), Evidence).optional(),
    history: z.record(z.string(), z.array(HistoryEntry)).optional(),
  })
  .strict()
  .superRefine((file, ctx) => {
    for (const component of Object.keys(file.floors)) {
      if (file.ladderVersion[component] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['ladderVersion', component],
          message: 'a floor names its ladder version',
        });
      }
    }
    for (const [component, evidence] of Object.entries(file.evidence ?? {})) {
      if (evidence.ladderVersion !== file.ladderVersion[component]) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence', component, 'ladderVersion'],
          message: `the evidence names ladder version ${evidence.ladderVersion}, the floor ${file.ladderVersion[component]}`,
        });
      }
    }
    for (const [component, entries] of Object.entries(file.history ?? {})) {
      const versions = [
        ...entries.map((entry) => entry.ladderVersion),
        file.ladderVersion[component] ?? Infinity,
      ];
      if (versions.some((version, index) => index > 0 && version <= (versions[index - 1] as number))) {
        ctx.addIssue({
          code: 'custom',
          path: ['history', component],
          message: 'history holds earlier ladder versions, oldest first, all below the current one',
        });
      }
    }
  });

export type FloorsFile = z.infer<typeof FloorsFileSchema>;
export type FloorEvidence = z.infer<typeof Evidence>;
export type FloorHistoryEntry = z.infer<typeof HistoryEntry>;

/** A file holding no floor. */
export function emptyFloors(): FloorsFile {
  return { version: 2, ladderVersion: {}, floors: {} };
}

/** Migrates a version 1 file: every floor and its evidence belong to ladder version 1. */
export function migrateFloors(file: z.infer<typeof FloorsFileV1>): FloorsFile {
  return {
    version: 2,
    // Every component the file names, by a floor or by evidence alone, was measured on ladder version 1.
    ladderVersion: Object.fromEntries(
      [...new Set([...Object.keys(file.floors), ...Object.keys(file.evidence ?? {})])].map((component) => [
        component,
        1,
      ]),
    ),
    floors: { ...file.floors },
    ...(file.evidence
      ? {
          evidence: Object.fromEntries(
            Object.entries(file.evidence).map(([component, evidence]) => [
              component,
              { ...evidence, ladderVersion: 1 },
            ]),
          ),
        }
      : {}),
  };
}

/**
 * Reads validators/floors.json; an absent file holds no floor, a version 1 file is migrated in memory. Throws
 * on a file that does not parse.
 */
export function readFloors(root: string): FloorsFile {
  const path = join(root, FLOORS_FILE);
  if (!existsSync(path)) return emptyFloors();
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if ((value as { version?: unknown })?.version === 1) {
    const old = FloorsFileV1.safeParse(value);
    if (old.success) return migrateFloors(old.data);
    throw new Error(`${FLOORS_FILE} is not a floors file: ${old.error.issues.map(issueText).join('; ')}`);
  }
  const parsed = FloorsFileSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${FLOORS_FILE} is not a floors file: ${parsed.error.issues.map(issueText).join('; ')}`);
  }
  return parsed.data;
}

/**
 * The floor of a component. With a ladder version, only a floor set for that version counts: a floor of an
 * earlier version is history and gives 0.
 */
export function floorOf(file: FloorsFile, component: string, version?: number): number {
  if (version !== undefined && (file.ladderVersion[component] ?? version) !== version) return 0;
  return file.floors[component] ?? 0;
}

/** A line explaining a floor that does not apply to the ladder version that ran, or undefined. */
export function floorNote(file: FloorsFile, component: string, version: number): string | undefined {
  const own = file.ladderVersion[component];
  if (own === undefined || own === version) return undefined;
  if (own < version) {
    return `The floor ${file.floors[component]} belongs to ladder version ${own}; version ${version} has no floor yet.`;
  }
  return `${FLOORS_FILE} is at ladder version ${own} but the registered ladder is version ${version}.`;
}

function sorted<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

export function writeFloors(root: string, file: FloorsFile): void {
  const out: FloorsFile = {
    version: 2,
    ladderVersion: sorted(file.ladderVersion),
    floors: sorted(file.floors),
    ...(file.evidence ? { evidence: sorted(file.evidence) } : {}),
    ...(file.history && Object.keys(file.history).length > 0 ? { history: sorted(file.history) } : {}),
  };
  writeFileSync(join(root, FLOORS_FILE), `${JSON.stringify(out, null, 2)}\n`);
}

/** One floor comparison: the level of the run against the floor of its component. */
export type FloorCheck = { component: string; level: number; floor: number; holds: boolean };

/**
 * Compares runs with the floors of their ladder version only, and names the floors that cannot be checked: a
 * floor on a component no validator is registered for, a floor of a ladder version above the registered one,
 * or a floor above the top of its ladder.
 */
export function checkFloors(
  reports: readonly LadderReport[],
  file: FloorsFile,
  registered: Record<string, { top: number; version?: number }>,
): { checks: FloorCheck[]; problems: string[] } {
  const checks = reports.map((report) => {
    const floor = floorOf(file, report.component, report.ladderVersion ?? 1);
    return { component: report.component, level: report.level, floor, holds: report.level >= floor };
  });
  const problems: string[] = [];
  for (const [component, floor] of Object.entries(file.floors)) {
    const ladder = registered[component];
    const own = file.ladderVersion[component] ?? 1;
    if (!ladder)
      problems.push(`${FLOORS_FILE} holds a floor for ${component}, which has no registered validator.`);
    else if (own > (ladder.version ?? 1))
      problems.push(
        `${FLOORS_FILE} holds ladder version ${own} for ${component}, above the registered version ${ladder.version ?? 1}.`,
      );
    else if (own === (ladder.version ?? 1) && floor > ladder.top)
      problems.push(
        `${FLOORS_FILE} sets ${component} to ${floor}, above the top of its ladder (${ladder.top}).`,
      );
  }
  return { checks, problems };
}

const EvidenceRun = z.object({ seed: z.number().int(), hidden: z.boolean(), level: z.number().int().min(0) });
const EvidenceReport = z.object({
  component: z.string(),
  ladderVersion: z.number().int().min(1).optional(),
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
  /** The ladder version the floor is for (`--ladder-version`); it must be the registered ladder's version. */
  ladderVersion: number;
  /** The version of the registered ladder. */
  registeredVersion: number;
};

/**
 * Raises one floor for one ladder version. Within a version the floor only rises: a level at or below it is
 * refused. A ladder version above the file's starts a new floor at any level from 1, and the earlier version's
 * floor moves to `history`; a version below the file's, or other than the registered ladder's, is refused. Also
 * refused: a level above the ladder's top, and evidence that is not a `--json` run of this ladder version on at
 * least one visible seed and the hidden seed derived from a commit, reaching the level on every seed.
 */
export function raiseFloor(
  file: FloorsFile,
  request: RaiseRequest,
): { file: FloorsFile } | { refused: string } {
  const { component, level, top, ladderVersion, registeredVersion } = request;
  if (ladderVersion !== registeredVersion) {
    return {
      refused: `The registered ${component} ladder is version ${registeredVersion}; a floor for version ${ladderVersion} is refused.`,
    };
  }
  const own = file.ladderVersion[component];
  if (own !== undefined && own > ladderVersion) {
    return { refused: `${FLOORS_FILE} is at ladder version ${own} for ${component}; versions only rise.` };
  }
  const sameVersion = own === ladderVersion;
  const current = sameVersion ? (file.floors[component] ?? 0) : 0;
  if (!Number.isInteger(level) || level < 1)
    return { refused: `A floor is a whole level of at least 1, not ${level}.` };
  if (level > top) return { refused: `${component} has ${top} levels; ${level} is above its top.` };
  if (sameVersion && level <= current) {
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
  if (report.ladderVersion !== ladderVersion) {
    return {
      refused: `The evidence ran ladder version ${report.ladderVersion ?? 'unknown'}; the floor is for version ${ladderVersion}.`,
    };
  }
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
    ladderVersion,
  };
  const history = { ...(file.history ?? {}) };
  if (own !== undefined && !sameVersion) {
    const previous = file.evidence?.[component];
    history[component] = [
      ...(history[component] ?? []),
      { ladderVersion: own, floor: file.floors[component] ?? 0, ...(previous ? { evidence: previous } : {}) },
    ];
  }
  return {
    file: {
      version: 2,
      ladderVersion: { ...file.ladderVersion, [component]: ladderVersion },
      floors: { ...file.floors, [component]: level },
      evidence: { ...(file.evidence ?? {}), [component]: evidence },
      ...(Object.keys(history).length > 0 ? { history } : {}),
    },
  };
}

function issueText(issue: { path: PropertyKey[]; message: string }): string {
  return `${issue.path.map(String).join('.') || '(file)'} ${issue.message}`;
}
