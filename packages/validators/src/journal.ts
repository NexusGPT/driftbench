import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/** The folder of a component's loop files, from the repository root. */
export function loopFolder(component: string): string {
  return `validators/${component}`;
}

export function journalFile(component: string): string {
  return `${loopFolder(component)}/journal.jsonl`;
}

const level = z.number().int().min(0);

const SeedLevels = z
  .object({
    seed: z.string().regex(/^(\d+|hidden)$/, 'a seed is a whole number or "hidden"'),
    before: level,
    after: level,
  })
  .strict();

const LevelMetric = z
  .object({
    level: z.number().int().min(1),
    id: z.string().min(1),
    metric: z.string().min(1),
    threshold: z.number(),
    before: z.number().nullable(),
    after: z.number().nullable(),
  })
  .strict();

/**
 * One iteration of the executor loop (docs/validators.md section 10.2): iteration, model, seeds, command,
 * level before and after (overall and per seed), every level's metric, the failing items before, the
 * hypothesis, the research, the change, tests added, the result, duration and token estimate.
 */
export const JournalRowSchema = z
  .object({
    iteration: z.number().int().min(1),
    at: z.iso.datetime(),
    model: z.string().min(1),
    seeds: z.array(z.string().regex(/^(\d+|hidden)$/)).min(1),
    command: z.string().min(1),
    level: z.object({ before: level, after: level }).strict(),
    perSeed: z.array(SeedLevels).min(1),
    metrics: z.array(LevelMetric).min(1),
    failingBefore: z.array(z.string().min(1)),
    hypothesis: z.string().min(1),
    research: z
      .object({ sources: z.array(z.string().min(1)).min(1), finding: z.string().min(1) })
      .strict()
      .nullable(),
    change: z
      .object({
        files: z.array(z.string().min(1)),
        commit: z
          .string()
          .regex(/^[0-9a-f]{7,40}$/)
          .nullable(),
      })
      .strict(),
    testsAdded: z.array(z.string().min(1)),
    result: z.enum(['raised', 'unchanged', 'lowered', 'stuck']),
    durationMinutes: z.number().min(0),
    tokenEstimate: z.number().int().min(0),
  })
  .strict()
  .superRefine((row, ctx) => {
    const listed = [...row.seeds].sort().join(',');
    const reported = row.perSeed
      .map((entry) => entry.seed)
      .sort()
      .join(',');
    if (listed !== reported) {
      ctx.addIssue({
        code: 'custom',
        path: ['perSeed'],
        message: 'perSeed must hold exactly the seeds listed',
      });
    }
    const before = Math.min(...row.perSeed.map((entry) => entry.before));
    const after = Math.min(...row.perSeed.map((entry) => entry.after));
    if (row.level.before !== before || row.level.after !== after) {
      ctx.addIssue({
        code: 'custom',
        path: ['level'],
        message: `level must be the minimum over perSeed: before ${before}, after ${after}`,
      });
    }
    const expected =
      row.level.after > row.level.before
        ? 'raised'
        : row.level.after < row.level.before
          ? 'lowered'
          : undefined;
    if (expected && row.result !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['result'],
        message: `the level moved, so result is ${expected}`,
      });
    }
    if (!expected && (row.result === 'raised' || row.result === 'lowered')) {
      ctx.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'the level did not move: unchanged or stuck',
      });
    }
    const levels = row.metrics.map((metric) => metric.level);
    if (levels.some((value, index) => value !== index + 1)) {
      ctx.addIssue({
        code: 'custom',
        path: ['metrics'],
        message: 'metrics list every level in order from 1',
      });
    }
  });

export type JournalRow = z.infer<typeof JournalRowSchema>;

/** The rows of a journal, and the lines that are not valid rows. An absent journal has no row. */
export function readJournal(root: string, component: string): { rows: JournalRow[]; problems: string[] } {
  const path = join(root, journalFile(component));
  if (!existsSync(path)) return { rows: [], problems: [] };
  const rows: JournalRow[] = [];
  const problems: string[] = [];
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (line.trim() === '') return;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        problems.push(`${journalFile(component)}:${index + 1} is not JSON.`);
        return;
      }
      const parsed = JournalRowSchema.safeParse(value);
      if (parsed.success) rows.push(parsed.data);
      else
        problems.push(`${journalFile(component)}:${index + 1} ${rowIssues(parsed.error.issues).join('; ')}`);
    });
  rows.forEach((row, index) => {
    if (row.iteration !== index + 1) {
      problems.push(`${journalFile(component)}: row ${index + 1} says iteration ${row.iteration}.`);
    }
  });
  return { rows, problems };
}

/** Checks a row against the schema and the journal: it must be the next iteration. */
export function validateRow(
  value: unknown,
  previous: readonly JournalRow[],
): { row: JournalRow } | { refused: string[] } {
  const parsed = JournalRowSchema.safeParse(value);
  if (!parsed.success) return { refused: rowIssues(parsed.error.issues) };
  const next = previous.length + 1;
  if (parsed.data.iteration !== next) {
    return {
      refused: [`iteration must be ${next}, the next row of the journal, not ${parsed.data.iteration}`],
    };
  }
  return { row: parsed.data };
}

/** Appends a validated row as one line. Refuses a journal that already holds an invalid line. */
export function appendJournal(
  root: string,
  component: string,
  value: unknown,
): { row: JournalRow } | { refused: string[] } {
  const { rows, problems } = readJournal(root, component);
  if (problems.length > 0) return { refused: problems };
  const checked = validateRow(value, rows);
  if ('refused' in checked) return checked;
  const path = join(root, journalFile(component));
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(checked.row)}\n`);
  return checked;
}

function rowIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map((issue) => `${issue.path.map(String).join('.') || '(row)'}: ${issue.message}`);
}
