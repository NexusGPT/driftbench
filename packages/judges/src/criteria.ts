import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { CriterionDef } from '@agent-nexus/driftbench-core';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { type JudgeRequest, TranscriptEntry } from './contract';
import { withCriterionSettings } from './criterion-settings';

/**
 * A criteria folder: one YAML file per criterion, named after it, holding the criterion and its fixture
 * pair. The pass fixture is a transcript slice the criterion must pass; the fail fixture one it must fail.
 * The owning judge must separate the two 3 times out of 3 before it is trusted (calibration, P2.3).
 */

export const CriterionFixture = z.strictObject({
  /** What the slice shows, for a reader. */
  note: z.string().optional().describe('What the slice shows, for a reader.'),
  transcript: z
    .array(TranscriptEntry)
    .min(1)
    .describe('The slice the judge reads: what the user sent, what the agent did and said.'),
  /** The text of a produced file, for a task criterion. */
  artifact: z.string().optional().describe('The text of a produced file, for a task criterion.'),
  /** The workspace inputs the criterion names, by path: the file text the judge compares against. */
  inputs: z
    .record(z.string(), z.string())
    .optional()
    .describe('The workspace inputs the criterion names, by path: the file text the judge compares against.'),
  given: z
    .strictObject({
      stage: z.string().optional().describe('The stage the block expects.'),
      ledger: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('The facts the agent holds at the block.'),
    })
    .optional()
    .describe("A summary of the block's Given, as the judge reads it."),
});
export type CriterionFixture = z.infer<typeof CriterionFixture>;

export const CriterionFile = z.strictObject({
  criterion: CriterionDef,
  fixtures: z
    .strictObject({
      pass: CriterionFixture.describe('A slice the criterion must pass.'),
      fail: CriterionFixture.describe('A slice the criterion must fail.'),
    })
    .describe('The fixture pair: the owning judge must separate the two every time before it is trusted.'),
});
export type CriterionFile = z.infer<typeof CriterionFile>;

export type LoadedCriterion = {
  readonly path: string;
  readonly def: CriterionDef;
  readonly fixtures: { readonly pass: CriterionFixture; readonly fail: CriterionFixture };
};

export type CriteriaIssue = { readonly path: string; readonly message: string };

export type CriteriaLoad = { readonly criteria: LoadedCriterion[]; readonly issues: CriteriaIssue[] };

const YAML_EXT = new Set(['.yaml', '.yml']);

/** Loads every criterion file of a folder, in name order. Problems are returned, never thrown. */
export async function loadCriteria(dir: string): Promise<CriteriaLoad> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => YAML_EXT.has(extname(name))).sort();
  } catch (cause) {
    return { criteria: [], issues: [{ path: dir, message: `cannot read the folder: ${message(cause)}` }] };
  }
  const criteria: LoadedCriterion[] = [];
  const issues: CriteriaIssue[] = [];
  if (names.length === 0) issues.push({ path: dir, message: 'no criterion file (.yaml or .yml)' });
  const seen = new Map<string, string>();
  for (const name of names) {
    const path = join(dir, name);
    const loaded = parseCriterionFile(await readFile(path, 'utf8'), path);
    if ('issues' in loaded) {
      issues.push(...loaded.issues);
      continue;
    }
    const stem = basename(name, extname(name));
    const own: CriteriaIssue[] = [];
    if (loaded.def.name !== stem) {
      own.push({ path, message: `the criterion is named ${loaded.def.name}, the file ${stem}` });
    }
    const twin = seen.get(loaded.def.name);
    if (twin) own.push({ path, message: `criterion ${loaded.def.name} is also defined in ${twin}` });
    seen.set(loaded.def.name, path);
    if (sameSlice(loaded.fixtures.pass, loaded.fixtures.fail)) {
      own.push({ path, message: 'the pass and fail fixtures are the same slice: they cannot separate' });
    }
    for (const which of ['pass', 'fail'] as const) {
      for (const input of loaded.def.inputs ?? []) {
        if (loaded.fixtures[which].inputs?.[input] === undefined) {
          own.push({ path, message: `fixture ${which} lacks the input ${input} the criterion names` });
        }
      }
    }
    // Conformance reads the rubric alone: its conditions are in the rubric, never in pictures.
    if ((!loaded.def.fail || !loaded.def.pass) && loaded.def.assessment !== 'conformance') {
      own.push({ path, message: 'the criterion needs both a FAIL and a PASS picture' });
    }
    issues.push(...own);
    if (own.length === 0) criteria.push(loaded);
  }
  return { criteria, issues };
}

/** Parses one criterion file. */
export function parseCriterionFile(
  text: string,
  path: string,
): LoadedCriterion | { issues: CriteriaIssue[] } {
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch (cause) {
    return { issues: [{ path, message: `not YAML: ${message(cause)}` }] };
  }
  const parsed = CriterionFile.safeParse(value);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => ({
        path,
        message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      })),
    };
  }
  return { path, def: parsed.data.criterion, fixtures: parsed.data.fixtures };
}

/** The request a fixture sends, as a block of a run would. */
export function fixtureRequest(criterion: LoadedCriterion, which: 'pass' | 'fail'): JudgeRequest {
  const fixture = criterion.fixtures[which];
  const def = criterion.def;
  return withCriterionSettings(
    {
      criterion: {
        name: def.name,
        rubric: def.rubric,
        ...(def.pass === undefined ? {} : { pass: def.pass }),
        ...(def.fail === undefined ? {} : { fail: def.fail }),
        scope: def.scope ?? 'block',
      },
      transcript: fixture.transcript,
      ...(fixture.artifact === undefined ? {} : { artifact: fixture.artifact }),
      ...(fixture.given === undefined ? {} : { given: fixture.given }),
      ...fixtureInputs(def.inputs, fixture.inputs),
    },
    def,
  );
}

/** The inputs a criterion names, in its order, from a fixture or a labelled block. */
export function fixtureInputs(
  names: readonly string[] | undefined,
  files: Readonly<Record<string, string>> | undefined,
): { inputs?: { path: string; text: string }[] } {
  if (!names || names.length === 0) return {};
  return {
    inputs: names.map((path) => ({
      path,
      text: files?.[path] ?? `(not available: ${path} is not in the fixture)`,
    })),
  };
}

function sameSlice(a: CriterionFixture, b: CriterionFixture): boolean {
  return JSON.stringify([a.transcript, a.artifact]) === JSON.stringify([b.transcript, b.artifact]);
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
