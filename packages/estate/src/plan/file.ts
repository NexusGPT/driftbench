import { readFile } from 'node:fs/promises';
import { isPlainObject } from '@driftbench/core';
import { formatJson } from '@driftbench/generate';
import { Document, isMap, isSeq, parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import { Plan } from '../schema';
import type { PlanDetails } from './build';

/**
 * The plan file: YAML, one row per line, written so a person can approve, strike or weigh rows in place.
 * Loading checks the schema and that row ids are unique. `approvePlanRows` flips statuses and keeps the
 * layout; the rest of a row is what code derived from the map and is regenerated, not edited.
 */

export const PlanIssueCodes = [
  'PLAN_PARSE',
  'PLAN_NOT_OBJECT',
  'PLAN_DUPLICATE_ROW',
  'PLAN_UNKNOWN_ROW',
] as const;
export type PlanIssueCode = (typeof PlanIssueCodes)[number] | `SCHEMA_${string}`;
export type PlanIssue = { code: PlanIssueCode; path: string; message: string };
export type PlanFileResult = { ok: true; plan: Plan } | { ok: false; errors: PlanIssue[] };

const HEADER = [
  ' driftbench estate plan: what to test before any test text, derived by code from the approved map.',
  ' Each row names the atoms it exercises, its cell on the situation axes, its test type and run mode.',
  ' Rows come from three sources: the contract of each atom kind, journeys over the estate graph from',
  ' the standing instructions, and pairwise cells (ids pairwise.N) of a covering array over the axes.',
  ' status: proposed until a person approves or strikes it; weight: the share of the budget a row gets.',
  ' Approve with  driftbench estate plan approve <this file> --all | --row <id>   strike with --row <id> --strike',
  ' Edit status and weight only: the rest is regenerated from the map.',
];

export function renderPlan(plan: Plan): string {
  const doc = new Document(plan, { aliasDuplicateObjects: false });
  doc.commentBefore = HEADER.join('\n');
  const rows = doc.get('rows', true);
  if (isSeq(rows)) for (const row of rows.items) if (isMap(row)) row.flow = true;
  const summary = doc.get('summary', true);
  if (isMap(summary)) {
    for (const key of ['unenforcedAtoms']) {
      const list = summary.get(key, true);
      if (isSeq(list) && list.items.length === 0) list.flow = true;
    }
  }
  return doc.toString({ lineWidth: 0 });
}

/** The summary file beside the plan: the summary of the plan file and the lists behind its counts. */
export function renderPlanSummary(plan: Plan, details: PlanDetails): string {
  return formatJson({ mapHash: plan.mapHash, spaceHash: plan.spaceHash, ...plan.summary, ...details });
}

/** `plan.yaml` gives `plan.summary.json`. */
export function summaryPathOf(planPath: string): string {
  return `${planPath.replace(/\.ya?ml$/i, '')}.summary.json`;
}

export function parsePlanText(text: string): PlanFileResult {
  let raw: unknown;
  try {
    raw = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    return { ok: false, errors: [issue('PLAN_PARSE', '', describe(cause))] };
  }
  return validatePlan(raw);
}

export function validatePlan(raw: unknown): PlanFileResult {
  if (!isPlainObject(raw))
    return { ok: false, errors: [issue('PLAN_NOT_OBJECT', '', 'a plan file holds one mapping')] };
  const parsed = Plan.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(fromZod) };
  const errors: PlanIssue[] = [];
  const ids = new Set<string>();
  parsed.data.rows.forEach((row, index) => {
    if (ids.has(row.id))
      errors.push(issue('PLAN_DUPLICATE_ROW', `rows.${index}.id`, `row "${row.id}" is listed twice`));
    ids.add(row.id);
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, plan: parsed.data };
}

export type LoadedPlan =
  | { ok: true; path: string; text: string; plan: Plan }
  | { ok: false; path: string; errors: PlanIssue[] };

export async function loadPlan(path: string): Promise<LoadedPlan> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return { ok: false, path, errors: [issue('PLAN_PARSE', '', `cannot read the file: ${describe(cause)}`)] };
  }
  const parsed = parsePlanText(text);
  return parsed.ok ? { ok: true, path, text, plan: parsed.plan } : { ok: false, path, errors: parsed.errors };
}

function issue(code: PlanIssueCode, path: string, message: string): PlanIssue {
  return { code, path, message };
}

function fromZod(zodIssue: z.core.$ZodIssue): PlanIssue {
  let message = zodIssue.message;
  if (zodIssue.code === 'unrecognized_keys')
    message = `unknown key${zodIssue.keys.length > 1 ? 's' : ''}: ${zodIssue.keys.join(', ')}`;
  else if (zodIssue.code === 'invalid_type') message = message.replace(/received undefined$/, 'missing');
  return issue(`SCHEMA_${zodIssue.code.toUpperCase()}`, zodIssue.path.map(String).join('.'), message);
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message.split('\n').slice(0, 3).join(' ').trim();
  return String(cause);
}
