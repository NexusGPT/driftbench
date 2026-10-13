import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { READERS } from '@agent-nexus/driftbench-artifacts';
import { parse as parseYaml, stringify } from 'yaml';
import {
  type Condition,
  type Count,
  FamilyFile,
  isRange,
  type Knob,
  type Oracle,
  ReviewFile,
  type SeedFile,
} from './schema';

/** A problem with a family, where it sits, and what it is. */
export type FamilyIssue = { path: string; message: string };

export type LoadedFamily = {
  /** The family file. */
  path: string;
  /** The folder of the family file; the oracle, the review and copied files resolve from it. */
  dir: string;
  family: FamilyFile;
  oracle: Oracle;
  oraclePath: string;
  familySha256: string;
  oracleSha256: string;
};

export type FamilyLoad =
  | { ok: true; loaded: LoadedFamily }
  | { ok: false; path: string; issues: FamilyIssue[] };

/** The file name a family folder holds. */
export const FAMILY_FILE = 'family.yaml';

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Reads a family: a folder holding family.yaml, or the file itself. Checks the schema, every name the
 * file uses (knobs, tables, columns, phrases, blocks), the reader checks against the reader vocabulary,
 * and loads the oracle. Never throws on bad input.
 */
export async function loadFamily(input: string): Promise<FamilyLoad> {
  const given = resolve(input);
  const info = await stat(given).catch(() => undefined);
  const path = info?.isDirectory() ? join(given, FAMILY_FILE) : given;
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return {
      ok: false,
      path,
      issues: [{ path: '', message: `cannot read the family file: ${describe(cause)}` }],
    };
  }
  let raw: unknown;
  try {
    raw = parseYaml(text, { prettyErrors: true, uniqueKeys: true });
  } catch (cause) {
    return { ok: false, path, issues: [{ path: '', message: `not valid YAML: ${describe(cause)}` }] };
  }
  const parsed = FamilyFile.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      path,
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    };
  }
  const family = parsed.data;
  const issues = checkNames(family);
  const dir = dirname(path);
  const oraclePath = resolve(dir, family.oracle);
  let oracleBytes: Buffer | undefined;
  try {
    oracleBytes = await readFile(oraclePath);
  } catch (cause) {
    issues.push({ path: 'oracle', message: `cannot read the oracle ${family.oracle}: ${describe(cause)}` });
  }
  for (const [index, file] of family.files.entries()) {
    if (!('copy' in file)) continue;
    const from = resolve(dir, file.copy.from);
    if (!(await stat(from).catch(() => undefined))?.isFile()) {
      issues.push({
        path: `files.${index}.copy.from`,
        message: `no file ${file.copy.from} beside the family file`,
      });
    }
  }
  if (issues.length > 0 || oracleBytes === undefined) return { ok: false, path, issues };

  let oracle: Oracle;
  try {
    const module = (await import(pathToFileURL(oraclePath).href)) as { expected?: unknown };
    if (typeof module.expected !== 'function') {
      return {
        ok: false,
        path,
        issues: [{ path: 'oracle', message: `${family.oracle} exports no function expected(input)` }],
      };
    }
    oracle = module.expected as Oracle;
  } catch (cause) {
    return {
      ok: false,
      path,
      issues: [{ path: 'oracle', message: `cannot load ${family.oracle}: ${describe(cause)}` }],
    };
  }
  return {
    ok: true,
    loaded: {
      path,
      dir,
      family,
      oracle,
      oraclePath,
      familySha256: sha256(text),
      oracleSha256: sha256(oracleBytes),
    },
  };
}

/** Every name a family uses must exist, and every reader check must be one the reader of its kind answers. */
export function checkNames(family: FamilyFile): FamilyIssue[] {
  const issues: FamilyIssue[] = [];
  const knobs = family.knobs;
  const knob = (name: string, at: string): Knob | undefined => {
    const found = Object.hasOwn(knobs, name) ? knobs[name] : undefined;
    if (!found) issues.push({ path: at, message: `no knob ${name}` });
    return found;
  };
  const rangeKnob = (name: string, at: string) => {
    const found = knob(name, at);
    if (found && !isRange(found))
      issues.push({ path: at, message: `the knob ${name} is a list; a count needs a whole-number knob` });
  };
  const listKnob = (name: string, at: string, needs: readonly string[] = []) => {
    const found = knob(name, at);
    if (!found) return;
    if (isRange(found)) {
      issues.push({ path: at, message: `the knob ${name} is a whole number; this needs a list of values` });
      return;
    }
    for (const value of needs) {
      if (!found.values.includes(value))
        issues.push({ path: at, message: `the knob ${name} has no value "${value}"` });
    }
  };
  const condition = (cond: Condition | undefined, at: string) => {
    for (const [name, wanted] of Object.entries(cond ?? {})) {
      const found = knob(name, `${at}.${name}`);
      if (!found) continue;
      for (const value of Array.isArray(wanted) ? wanted : [wanted]) {
        const fits = isRange(found)
          ? typeof value === 'number' && value >= found.min && value <= found.max
          : found.values.includes(String(value));
        if (!fits)
          issues.push({
            path: `${at}.${name}`,
            message: `the knob ${name} never holds ${JSON.stringify(value)}`,
          });
      }
    }
  };
  const count = (value: Count, at: string) => {
    if (typeof value !== 'number') rangeKnob(value.knob, `${at}.knob`);
  };

  listKnob(family.wording_knob, 'wording_knob');
  const wording = knobs[family.wording_knob];
  if (wording && wording.class !== 'style') {
    issues.push({
      path: 'wording_knob',
      message: `the wording knob ${family.wording_knob} must be a style knob`,
    });
  }

  for (const [index, constraint] of family.constraints.entries()) {
    const at = `constraints.${index}`;
    if ('compare' in constraint) {
      rangeKnob(constraint.compare.left, `${at}.compare.left`);
      if (typeof constraint.compare.right === 'string')
        rangeKnob(constraint.compare.right, `${at}.compare.right`);
    } else {
      condition(constraint.implies.when, `${at}.implies.when`);
      condition(constraint.implies.require, `${at}.implies.require`);
    }
  }

  const tableColumns = new Map<string, string[]>();
  for (const [name, table] of Object.entries(family.tables)) {
    const at = `tables.${name}`;
    count(table.rows, `${at}.rows`);
    const seen: string[] = [];
    for (const [index, column] of table.columns.entries()) {
      const where = `${at}.columns.${index}`;
      if (seen.includes(column.name))
        issues.push({ path: where, message: `the column ${column.name} is declared twice` });
      const gen = column.gen;
      const earlier = (ref: string, key: string) => {
        if (!seen.includes(ref)) {
          issues.push({
            path: `${where}.gen.${key}`,
            message: `${ref} is not a column declared before ${column.name}`,
          });
        }
      };
      if ('groups' in gen) count(gen.groups.count, `${where}.gen.groups.count`);
      if ('choice_by' in gen) earlier(gen.choice_by.column, 'choice_by.column');
      if ('int' in gen && gen.int.min > gen.int.max) {
        issues.push({ path: `${where}.gen.int`, message: 'min is larger than max' });
      }
      if ('template' in gen) {
        if (gen.seq_by !== undefined) earlier(gen.seq_by, 'seq_by');
        for (const slot of slotsOf(gen.template)) {
          const [ref] = slot.split('|');
          if (ref !== 'seq' && ref !== 'row' && ref !== undefined) earlier(ref, 'template');
        }
      }
      seen.push(column.name);
    }
    tableColumns.set(name, seen);
  }
  const tableColumn = (table: string, column: string | undefined, at: string) => {
    const columns = tableColumns.get(table);
    if (!columns) {
      issues.push({ path: at, message: `no table ${table}` });
      return;
    }
    if (column !== undefined && !columns.includes(column)) {
      issues.push({ path: at, message: `the table ${table} has no column ${column}` });
    }
  };

  const phrases = new Set<string>();
  for (const [index, phrase] of family.phrases.entries()) {
    if (phrases.has(phrase.id))
      issues.push({ path: `phrases.${index}`, message: `the phrase ${phrase.id} is declared twice` });
    phrases.add(phrase.id);
  }
  const phrase = (id: string, at: string) => {
    if (!phrases.has(id)) issues.push({ path: at, message: `no phrase ${id}` });
  };

  for (const [index, file] of family.files.entries()) {
    const at = `files.${index}`;
    condition(file.when, `${at}.when`);
    for (const slot of slotsOf(file.path)) knob(slot, `${at}.path`);
    seedFileNames(file, at, tableColumn, listKnob, phrase);
  }

  const corners = new Set<string>();
  for (const [index, corner] of family.corners.kinds.entries()) {
    const at = `corners.kinds.${index}`;
    if (corners.has(corner.id))
      issues.push({ path: at, message: `the corner ${corner.id} is declared twice` });
    if (corner.id === 'base' || corner.id === 'planted') {
      issues.push({ path: at, message: `${corner.id} names a variant of its own; pick another corner id` });
    }
    corners.add(corner.id);
    if ('empty_cell' in corner) tableColumn(corner.empty_cell.table, corner.empty_cell.column, at);
    if ('duplicate_row' in corner) tableColumn(corner.duplicate_row.table, undefined, at);
    if ('column_order' in corner) tableColumn(corner.column_order.table, undefined, at);
    if ('unit_change' in corner) {
      tableColumn(corner.unit_change.table, corner.unit_change.column, at);
      for (const [rule, entry] of corner.unit_change.rules.entries()) {
        try {
          const pattern = new RegExp(entry.match);
          if (!/\((?!\?)/.test(pattern.source)) {
            issues.push({
              path: `${at}.unit_change.rules.${rule}`,
              message: 'the pattern needs a group around the number',
            });
          }
        } catch (cause) {
          issues.push({
            path: `${at}.unit_change.rules.${rule}`,
            message: `invalid pattern: ${describe(cause)}`,
          });
        }
      }
    }
  }
  if (family.corners.per_instance > family.corners.kinds.length) {
    issues.push({
      path: 'corners.per_instance',
      message: `asks for ${family.corners.per_instance} corners of ${family.corners.kinds.length} kinds`,
    });
  }

  const blocks = new Set<string>();
  for (const [index, block] of family.blocks.entries()) {
    const at = `blocks.${index}`;
    if (blocks.has(block.id)) issues.push({ path: at, message: `the block ${block.id} is declared twice` });
    blocks.add(block.id);
    condition(block.when, `${at}.when`);
    if (block.stage !== undefined && family.spec.stages && !family.spec.stages.includes(block.stage)) {
      issues.push({ path: `${at}.stage`, message: `the stage ${block.stage} is not in spec.stages` });
    }
    for (const key of ['artifacts', 'workspace', 'stage']) {
      if (block.expect && Object.hasOwn(block.expect, key)) {
        issues.push({
          path: `${at}.expect.${key}`,
          message:
            key === 'stage'
              ? 'the stage is the block field stage'
              : `the oracle decides ${key}; the family may not fix it`,
        });
      }
    }
    for (const [part, entry] of block.parts.entries()) {
      condition(entry.when, `${at}.parts.${part}.when`);
      for (const id of entry.phrases) phrase(id, `${at}.parts.${part}.phrases`);
    }
  }

  if (family.planted) {
    listKnob(family.planted.knob, 'planted.knob', ['with']);
    phrase(family.planted.phrase, 'planted.phrase');
    if (!blocks.has(family.planted.block))
      issues.push({ path: 'planted.block', message: `no block ${family.planted.block}` });
    for (const [index, pattern] of family.planted.must_not.entries()) {
      try {
        new RegExp(pattern, 'm');
      } catch (cause) {
        issues.push({ path: `planted.must_not.${index}`, message: `invalid pattern: ${describe(cause)}` });
      }
    }
  }

  for (const [kind, names] of Object.entries(family.checks)) {
    const reader = READERS.find((entry) => entry.kind === kind);
    for (const name of names ?? []) {
      if (!reader?.checkNames.includes(name)) {
        issues.push({
          path: `checks.${kind}`,
          message: `${name} is not a check of the ${kind} reader; it answers ${reader?.checkNames.join(', ') ?? 'nothing'}`,
        });
      }
    }
  }
  return issues;
}

function seedFileNames(
  file: SeedFile,
  at: string,
  tableColumn: (table: string, column: string | undefined, at: string) => void,
  listKnob: (name: string, at: string, needs?: readonly string[]) => void,
  phrase: (id: string, at: string) => void,
): void {
  if ('csv' in file) {
    for (const column of file.csv.columns) tableColumn(file.csv.table, column, `${at}.csv.columns`);
    if (file.csv.column_order_knob) listKnob(file.csv.column_order_knob, `${at}.csv.column_order_knob`);
    if (file.csv.line_endings_knob) listKnob(file.csv.line_endings_knob, `${at}.csv.line_endings_knob`);
  } else if ('json' in file) {
    for (const column of file.json.columns) tableColumn(file.json.table, column, `${at}.json.columns`);
    if (file.json.column_order_knob) listKnob(file.json.column_order_knob, `${at}.json.column_order_knob`);
  } else if ('xlsx' in file) {
    tableColumn(file.xlsx.table, file.xlsx.sheet_by, `${at}.xlsx.sheet_by`);
    file.xlsx.columns.forEach((column, index) => {
      tableColumn(file.xlsx.table, column.column, `${at}.xlsx.columns.${index}.column`);
    });
  } else if ('text' in file) {
    phrase(file.text.phrase, `${at}.text.phrase`);
  }
}

/** The {slot} names a template uses, in order, each once. */
export function slotsOf(template: string): string[] {
  const out: string[] = [];
  for (const match of template.matchAll(/\{([A-Za-z_][A-Za-z0-9_|]*)\}/g)) {
    const name = match[1];
    if (name !== undefined && !out.includes(name)) out.push(name);
  }
  return out;
}

export type ReviewStatus =
  | { state: 'missing'; path: string }
  | { state: 'invalid'; path: string; message: string }
  | { state: 'pending'; path: string; review: ReviewFile }
  | { state: 'stale'; path: string; review: ReviewFile; changed: string[] }
  | { state: 'signed'; path: string; review: ReviewFile };

/**
 * Where the family's review stands. Signed holds only while the family and oracle hashes are the ones the
 * person signed; a change to either makes it stale, and the family needs a new review.
 */
export async function reviewStatus(loaded: LoadedFamily): Promise<ReviewStatus> {
  const path = resolve(loaded.dir, loaded.family.review);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { state: 'missing', path };
  }
  let raw: unknown;
  try {
    raw = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    return { state: 'invalid', path, message: `not valid YAML: ${describe(cause)}` };
  }
  const parsed = ReviewFile.safeParse(raw);
  if (!parsed.success) {
    return {
      state: 'invalid',
      path,
      message: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(file)'}: ${issue.message}`)
        .join('; '),
    };
  }
  const review = parsed.data;
  if (review.family !== loaded.family.id) {
    return {
      state: 'invalid',
      path,
      message: `the review is of the family ${review.family}, not ${loaded.family.id}`,
    };
  }
  const changed = [
    ...(review.family_sha256 === loaded.familySha256 ? [] : ['the family file']),
    ...(review.oracle_sha256 === loaded.oracleSha256 ? [] : ['the oracle']),
  ];
  const signed = review.signed_by !== null && review.signed_on !== null;
  if (changed.length > 0 && signed) return { state: 'stale', path, review, changed };
  if (!signed) return { state: 'pending', path, review };
  return { state: 'signed', path, review };
}

/** The questions a reviewer answers once per family, before signing. */
export const REVIEW_QUESTIONS = [
  'Every knob, value and constraint describes a real variation of the task, and the knob classes are right (difficulty, structure, style).',
  'Every phrase is one a real user could send, and no phrase gives away an expected value.',
  'The oracle computes the expected cells, files and workspace diff from the seed alone, as the instruction defines them, and never from an agent output.',
  'The reader checks the family emits are the ones that decide the task; nothing that matters is left unchecked.',
  'Each corner-case kind keeps the workspace inside the task contract, and the planted variant keeps the same expected outcome.',
  'The style knobs change nothing the oracle expects (the generator checks it on every instance).',
] as const;

/** A pending review file for the family as it stands: its hashes, the questions, no signature. */
export function pendingReview(loaded: LoadedFamily): ReviewFile {
  return {
    family: loaded.family.id,
    family_sha256: loaded.familySha256,
    oracle_sha256: loaded.oracleSha256,
    questions: [...REVIEW_QUESTIONS],
    signed_by: null,
    signed_on: null,
  };
}

/**
 * Writes a pending review file for the family as it stands (its hashes, the questions, no signature) and
 * returns its path. A person reads the family, answers the questions and fills signed_by and signed_on.
 */
export async function writePendingReview(loaded: LoadedFamily): Promise<string> {
  const path = resolve(loaded.dir, loaded.family.review);
  const header =
    '# The review of a code-agent task family. A person reads the family file, the oracle and one\n' +
    '# instance, answers the questions below, then fills signed_by and signed_on. The signature holds\n' +
    '# for the two hashes: a change to the family file or the oracle needs a new review.\n';
  await writeFile(path, `${header}${stringify(pendingReview(loaded), { lineWidth: 0 })}`);
  return path;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
