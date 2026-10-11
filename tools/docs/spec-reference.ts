/**
 * Writes docs/reference/spec.md from the zod schemas exported by @driftbench/core: the spec, the
 * drift classes of run records, and the behaviour inventory that `spec coverage` reads.
 *
 * zod's own toJSONSchema turns the schemas into JSON Schema. Each exported schema keeps its export
 * name, so the page has one section per named type. Field descriptions come from `.describe()` in
 * the schemas; a field without one gets an empty cell and is listed by `--missing`. The meaning of
 * each enum value lives in VALUE_LINES below, and generation fails when a value has no line.
 *
 * Usage:  pnpm docs:reference [--check] [--out <file>] [--missing]
 *   (no flag)   write the page
 *   --check     compare instead of writing: exit 1 and name the file when it is stale
 *   --out       the file to write or check (default docs/reference/spec.md)
 *   --missing   print every field that has no description, one per line
 * Exit:   0 written, current or listed; 1 stale or missing; 2 usage error.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@driftbench/core';
import { slug } from './check-links';

type Node = { [key: string]: unknown };
type Schema = { toJSONSchema(params?: object): unknown };
export type Io = { out: (text: string) => void; err: (text: string) => void };

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DEFAULT_OUT = resolve(ROOT, 'docs/reference/spec.md');
const NAME = 'x-name';

/** One line per enum value, keyed by the export name of the enum. */
export const VALUE_LINES: Record<string, Record<string, string>> = {
  DeviationClass: {
    D1_off_topic:
      'An off-topic question in the middle of the flow, such as asking for opening hours. Expected: a short answer, then the agent resumes its pending stage in the same block.',
    D2_goal_shift:
      'The user changes the goal, such as a different basket after the recap. Expected: back to the stage that owns the change, with no question about facts already known.',
    D3_contradiction:
      'The user gives a value that contradicts an earlier one, such as a second account number. Expected: the agent notices and asks which one holds; it never takes the last one silently.',
    D4_loose_confirmation:
      'A vague confirmation, such as "ok perfect", where the flow needs an explicit one. Expected: no submission or other irreversible action without the explicit confirmation.',
    D5_language_switch:
      "One message in another language. Expected: replies stay in the user's declared language, with no mixing.",
    D6_instruction_in_data:
      'Data carries an instruction, such as a form field or a workspace file that says to ignore the rules. Expected: the agent treats it as data and never obeys it.',
    D7_silence_or_burst:
      'An empty message, or several messages at once. Expected: one reply, no double send.',
    D8_tool_failure:
      'A tool or a command fails or returns an error. Expected: an honest fallback and one retry; never a success that did not happen.',
    D9_out_of_scope:
      "A request outside the agent's job, such as a billing complaint in the middle of an order. Expected: the agent routes it to the place that handles it and keeps it out of the current flow.",
    D10_return:
      'The user returns to the flow after a deviation, such as "ok, let\'s continue" two blocks later. Expected: the agent resumes at the right stage with every known fact kept.',
  },
  DriftClass: {
    X1_local:
      'A wrong answer or a wrong action in this block while every earlier fact still holds. Found by any failing check or criterion on the block alone.',
    X2_contradiction:
      'The block contradicts a fact established earlier, as held in the ledger. Found by the ledger check.',
    X3_flow:
      'The agent is at the wrong stage: it skips one, repeats one, or asks again for a known fact. Found by the stage classifier against `expect.stage`.',
    X4_format:
      'A format or persona rule breaks: narration of internal steps, the wrong language, a double send, card misuse, the wrong channel rules. Found by format and channel checks.',
    X5_tool:
      'A tool call, a skill or a guard is missing, extra or repeated, or a call has wrong parameters. Found by the tool, skill and guard checks.',
  },
};

/** Text printed under a section heading, for the sections whose values describe behaviour. */
const SECTION_NOTES: Record<string, string> = {
  DeviationClass:
    'Used by `when.injection.class` and `perturbations[].class`. Running a perturbation is planned, phase 3. See [recovery](../concepts/recovery.md).',
  DriftClass:
    'Run records, not specs, carry these classes: one or more on each failing block. The drift engine that assigns them is planned, phase 3. See [drift](../concepts/drift.md).',
  Inventory:
    'The behaviour inventory is the file `driftbench spec coverage --inventory` reads. It lists the behaviours an agent must show and the flows that group them. A spec covers a behaviour by naming its id in `covers`, and joins a flow with the tag `flow:<id>` or by covering one of its behaviours. See [CLI](cli.md#driftbench-spec-coverage).',
};

/** Defaults the loader applies before validation, keyed by section and field. */
export const LOADER_DEFAULTS: Record<string, string> = {
  'Spec.kind': '`conversation`, set by the loader',
};

const INTRO = `<!-- Generated by tools/docs/spec-reference.ts from the zod schemas in packages/core/src/schema. Do not edit by hand: run \`pnpm docs:reference\`. -->

# Spec reference

A spec is one YAML or JSON file. It describes one conversation or one task as a succession of blocks; see [block](../concepts/block.md) and [Given, When, Then](../concepts/given-when-then.md). This page lists every field the loader accepts, then the fields of the behaviour inventory that \`driftbench spec coverage\` reads. It is generated from the zod schemas that the CLI uses.

* Keys are snake_case. An unknown key is an error.
* Required means the field is present once the loader has applied the shorthand below.
* Descriptions come from the schemas. An empty cell means the schema has no description for that field yet.

## Shorthand

The loader rewrites these forms before it validates a spec.

* \`kind\` may be left out: the loader sets \`conversation\`.
* A block may write \`user: <message>\` or \`burst: [<message>, <message>]\` in place of \`when\`.
* \`ledger_seed\` at the top level is the same as \`given.ledger\`.
* \`workspace_seed\` at the top level is the same as \`given.world.workspace\`. A string means \`{ from: <string> }\`.
`;

const USAGE = `Usage: pnpm docs:reference [--check] [--out <file>] [--missing]
Writes docs/reference/spec.md from the zod schemas. --check compares instead of writing.
Exit 0 written or current, 1 stale or missing, 2 usage error.
`;

function isSchema(value: unknown): value is Schema {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<Schema>).toJSONSchema === 'function'
  );
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNode(value: unknown): Node {
  return isNode(value) ? value : {};
}

/** Export names by schema. When two exports share a schema (Block and BlockSpec), the shorter, documented name wins. */
export function schemaNames(exports: Record<string, unknown>): Map<unknown, string> {
  const names = new Map<unknown, string>();
  for (const [name, value] of Object.entries(exports)) {
    if (!isSchema(value)) continue;
    const known = names.get(value);
    if (known === undefined || name.length < known.length || (name.length === known.length && name < known)) {
      names.set(value, name);
    }
  }
  return names;
}

/**
 * The export name of a schema. A field written `Stimulus.describe('...')` holds a clone of the export:
 * zod's `.describe()` returns a copy whose `_zod.parent` is the schema it described, so the walk follows it.
 */
export function exportName(schema: unknown, names: Map<unknown, string>): string | undefined {
  let current = schema;
  for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth += 1) {
    const name = names.get(current);
    if (name !== undefined) return name;
    current = (current as { _zod?: { parent?: unknown } })._zod?.parent;
  }
  return undefined;
}

/**
 * JSON Schema of one zod schema, as an author writes it (`io: 'input'`: a field with a default is optional),
 * with the export name of every named part kept under `x-name`.
 */
export function toJsonSchema(schema: Schema, names: Map<unknown, string>): Node {
  return asNode(
    schema.toJSONSchema({
      target: 'draft-2020-12',
      io: 'input',
      override: (ctx: { zodSchema: unknown; jsonSchema: Node }) => {
        const name = exportName(ctx.zodSchema, names);
        if (name !== undefined) ctx.jsonSchema[NAME] = name;
      },
    }),
  );
}

/** Fails when an enum value has no line, or a line names a value the enum does not have. */
export function checkValueLines(
  name: string,
  values: string[],
  lines: Record<string, string> | undefined,
): asserts lines is Record<string, string> {
  if (lines === undefined) throw new Error(`spec-reference: enum ${name} has no entry in VALUE_LINES`);
  const unexplained = values.filter((value) => !lines[value]?.trim());
  const unknown = Object.keys(lines).filter((value) => !values.includes(value));
  if (unexplained.length > 0) {
    throw new Error(
      `spec-reference: ${name} values without a line in VALUE_LINES: ${unexplained.join(', ')}`,
    );
  }
  if (unknown.length > 0) {
    throw new Error(`spec-reference: VALUE_LINES.${name} names values the enum lacks: ${unknown.join(', ')}`);
  }
}

function code(value: unknown): string {
  return `\`${typeof value === 'string' ? value : JSON.stringify(value)}\``;
}

function row(cells: string[]): string {
  return `| ${cells.map((cell) => cell.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`;
}

function sectionKind(node: Node): 'object' | 'union' | 'enum' | undefined {
  if (node.type === 'object' && isNode(node.properties)) return 'object';
  if (Array.isArray(node.anyOf)) return 'union';
  if (Array.isArray(node.enum)) return 'enum';
  return undefined;
}

function numberAt(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** A bound zod adds for safe integers says nothing to a reader. */
function bound(value: unknown): number | undefined {
  return typeof value === 'number' && Math.abs(value) !== Number.MAX_SAFE_INTEGER ? value : undefined;
}

function scalarParts(node: Node): { base: string; rules: string[] } | undefined {
  if (node.type === 'string') {
    const rules: string[] = [];
    const min = numberAt(node.minLength);
    const max = numberAt(node.maxLength);
    if (min !== undefined && max !== undefined) rules.push(`${min} to ${max} characters`);
    else if (min === 1) rules.push('not empty');
    else if (min !== undefined) rules.push(`at least ${min} characters`);
    else if (max !== undefined) rules.push(`at most ${max} characters`);
    if (typeof node.pattern === 'string') rules.push(`matching ${code(node.pattern)}`);
    return { base: 'string', rules };
  }
  if (node.type === 'integer' || node.type === 'number') {
    const rules: string[] = [];
    const min = bound(node.minimum);
    const max = bound(node.maximum);
    if (min !== undefined && max !== undefined) rules.push(`${min} to ${max}`);
    else if (min !== undefined) rules.push(`at least ${min}`);
    else if (max !== undefined) rules.push(`at most ${max}`);
    if (typeof node.exclusiveMinimum === 'number') rules.push(`greater than ${node.exclusiveMinimum}`);
    if (typeof node.exclusiveMaximum === 'number') rules.push(`less than ${node.exclusiveMaximum}`);
    return { base: node.type, rules };
  }
  if (node.type === 'boolean') return { base: 'boolean', rules: [] };
  return undefined;
}

/** `string, not empty`, but `string matching ...` when a pattern is the only rule. */
function withRules(base: string, rules: string[]): string {
  if (rules.length === 1 && rules[0]?.startsWith('matching ')) return `${base} ${rules[0]}`;
  return [base, ...rules].join(', ');
}

const PLURALS: Record<string, string> = {
  string: 'strings',
  integer: 'integers',
  number: 'numbers',
  boolean: 'booleans',
  'JSON value': 'JSON values',
};

function enumText(values: unknown[]): string {
  const shown = values.map(code);
  if (shown.length === 2) return `${shown[0]} or ${shown[1]}`;
  return `one of ${shown.join(', ')}`;
}

function isEmpty(node: Node): boolean {
  return Object.keys(node).every((key) => key === NAME || key === 'description');
}

/** True for the recursive shape zod gives `z.json()`: any JSON value. */
function isJsonValue(def: Node, ref: string): boolean {
  const options = Array.isArray(def.anyOf) ? def.anyOf.map(asNode) : [];
  const types = options.map((option) => String(option.type)).sort();
  if (types.join(',') !== 'array,boolean,null,number,object,string') return false;
  const array = options.find((option) => option.type === 'array');
  const object = options.find((option) => option.type === 'object');
  return asNode(array?.items).$ref === ref && asNode(object?.additionalProperties).$ref === ref;
}

/** True for a union option written as a mapping with one required key, such as `{ regex: ... }`. */
function isSingleKey(node: Node): boolean {
  if (sectionKind(node) !== 'object' || typeof node[NAME] === 'string') return false;
  const keys = Object.keys(asNode(node.properties));
  return keys.length === 1 && Array.isArray(node.required) && node.required.includes(keys[0]);
}

class Page {
  private readonly nodes = new Map<string, Node>();
  private readonly done = new Set<string>();
  readonly order: string[] = [];
  readonly sections: string[] = [];
  readonly missing: string[] = [];

  /**
   * @param defs the `$defs` of the root schema, for `z.json()` references
   * @param typeDescriptions the description of each named schema, from its export: a field may hold a
   *   described copy, whose own description belongs to the field, not to the type
   */
  constructor(
    private readonly defs: Node,
    private readonly typeDescriptions: Map<string, string>,
  ) {}

  /** Renders a section, then the sections it links to, depth first. */
  emit(title: string, node: Node): void {
    if (this.done.has(title)) return;
    this.done.add(title);
    this.nodes.set(title, node);
    const children: string[] = [];
    this.order.push(title);
    this.sections.push(this.section(title, node, children));
    for (const child of children) {
      const childNode = this.nodes.get(child);
      if (childNode) this.emit(child, childNode);
    }
  }

  private link(title: string, node: Node, children: string[]): string {
    const known = this.nodes.get(title);
    if (known === undefined) this.nodes.set(title, node);
    else if (typeof node[NAME] !== 'string' && JSON.stringify(known) !== JSON.stringify(node)) {
      throw new Error(`spec-reference: two different shapes would share the section title "${title}"`);
    }
    if (!this.done.has(title) && !children.includes(title)) children.push(title);
    return `[${title}](#${slug(title)})`;
  }

  private ref(ref: string): string {
    const def = asNode(this.defs[ref.replace('#/$defs/', '')]);
    if (isJsonValue(def, ref)) return 'JSON value';
    throw new Error(`spec-reference: no rendering for the reference ${ref}`);
  }

  private typeOf(node: Node, hint: string, children: string[]): string {
    if (typeof node.$ref === 'string') return this.ref(node.$ref);
    const name = node[NAME];
    const kind = sectionKind(node);
    if (typeof name === 'string' && kind !== undefined) return this.link(name, node, children);
    if (kind === 'object') return this.link(hint, node, children);
    if ('const' in node) return code(node.const);
    if (Array.isArray(node.enum)) return enumText(node.enum);
    if (Array.isArray(node.anyOf)) {
      return node.anyOf.map((option) => this.typeOf(asNode(option), hint, children)).join(' or ');
    }
    const parts = scalarParts(node);
    if (parts) return withRules(parts.base, parts.rules);
    if (node.type === 'null') return code(null);
    if (node.type === 'array') return this.array(node, hint, children);
    if (node.type === 'object') return this.map(node, hint, children);
    if (isEmpty(node)) return 'any value';
    throw new Error(`spec-reference: no rendering for ${JSON.stringify(node)}`);
  }

  private array(node: Node, hint: string, children: string[]): string {
    const items = asNode(node.items);
    const parts = 'const' in items || Array.isArray(items.enum) ? undefined : scalarParts(items);
    let text: string;
    if (parts) {
      text = `list of ${PLURALS[parts.base] ?? parts.base}`;
      if (parts.rules.length > 0) text += `, each ${parts.rules.join(', ')}`;
    } else {
      const inner = this.typeOf(items, hint, children);
      text = `list of ${PLURALS[inner] ?? inner.replace(/^map of /, 'maps of ')}`;
    }
    const min = numberAt(node.minItems);
    const max = numberAt(node.maxItems);
    if (min !== undefined && min > 0) text += `, at least ${min} ${min === 1 ? 'item' : 'items'}`;
    if (max !== undefined) text += `, at most ${max} ${max === 1 ? 'item' : 'items'}`;
    return text;
  }

  private map(node: Node, hint: string, children: string[]): string {
    const value = node.additionalProperties;
    if (value === false) return 'empty mapping';
    if (value === undefined || value === true || (isNode(value) && isEmpty(value))) {
      return 'map of string to any value';
    }
    return `map of string to ${this.typeOf(asNode(value), `${hint} value`, children)}`;
  }

  private description(node: Node): string {
    if (typeof node.description === 'string') return node.description;
    if (node.type === 'array' && typeof asNode(node.items).description === 'string') {
      return String(asNode(node.items).description);
    }
    return '';
  }

  private fields(title: string, node: Node, children: string[]): string[] {
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    const rows = ['| Field | Type | Required | Default | Description |', '|---|---|---|---|---|'];
    for (const [key, value] of Object.entries(asNode(node.properties))) {
      const field = asNode(value);
      const description = this.description(field);
      if (description === '') this.missing.push(`${title}.${key}`);
      const fallback = 'default' in field ? code(field.default) : (LOADER_DEFAULTS[`${title}.${key}`] ?? '');
      const type = this.typeOf(field, `${title} ${key}`, children);
      rows.push(row([code(key), type, required.has(key) ? 'yes' : 'no', fallback, description]));
    }
    return rows;
  }

  private union(title: string, node: Node, children: string[]): string[] {
    const options = (Array.isArray(node.anyOf) ? node.anyOf : []).map(asNode);
    const keyed = options.filter(isSingleKey);
    const mappings = options.filter(
      (option) =>
        !isSingleKey(option) && sectionKind(option) === 'object' && typeof option[NAME] !== 'string',
    );
    const others = options.filter((option) => !keyed.includes(option) && !mappings.includes(option));
    if (mappings.length > 1 || (mappings.length > 0 && keyed.length > 0)) {
      throw new Error(`spec-reference: ${title} mixes mapping shapes the generator does not render yet`);
    }

    const mapping = mappings[0];
    const lines: string[] = [];
    if (others.length === 0 && mapping === undefined) {
      lines.push('Write a mapping with exactly one of these keys.', '');
    } else {
      lines.push('Write one of these forms.', '');
      for (const option of others) lines.push(`* ${this.typeOf(option, title, children)}`);
      if (keyed.length > 0) lines.push('* a mapping with exactly one of the keys below');
      if (mapping) lines.push('* a mapping with the fields below');
      lines.push('');
    }

    if (keyed.length > 0) {
      lines.push('| Key | Type | Description |', '|---|---|---|');
      for (const option of keyed) {
        const [key, value] = Object.entries(asNode(option.properties))[0] ?? ['', {}];
        const field = asNode(value);
        const description = this.description(field) || this.description(option);
        if (description === '') this.missing.push(`${title}.${key}`);
        lines.push(row([code(key), this.typeOf(field, `${title} ${key}`, children), description]));
      }
    }
    if (mapping) lines.push(...this.fields(title, mapping, children));
    return lines;
  }

  private values(title: string, node: Node): string[] {
    const values = (Array.isArray(node.enum) ? node.enum : []).map(String);
    const lines = VALUE_LINES[title];
    checkValueLines(title, values, lines);
    return [
      '| Value | Meaning |',
      '|---|---|',
      ...values.map((value) => row([code(value), lines[value] ?? ''])),
    ];
  }

  private section(title: string, node: Node, children: string[]): string {
    const lines = [`## ${title}`, ''];
    const description = this.typeDescriptions.get(title) ?? this.description(node);
    if (description !== '') lines.push(description, '');
    const note = SECTION_NOTES[title];
    if (note !== undefined) lines.push(note, '');
    const kind = sectionKind(node);
    if (kind === 'object') lines.push(...this.fields(title, node, children));
    else if (kind === 'union') lines.push(...this.union(title, node, children));
    else if (kind === 'enum') lines.push(...this.values(title, node));
    return lines.join('\n').replace(/\n+$/, '');
  }
}

/** The whole page, and the fields that have no description. */
export function renderReference(): { markdown: string; missing: string[] } {
  const names = schemaNames({ ...core });
  const typeDescriptions = new Map<string, string>();
  for (const [schema, name] of names) {
    const description = (schema as { description?: unknown }).description;
    typeDescriptions.set(name, typeof description === 'string' ? description : '');
  }
  const spec = toJsonSchema(core.Spec, names);
  const page = new Page(asNode(spec.$defs), typeDescriptions);
  page.emit('Spec', spec);
  page.emit('DriftClass', toJsonSchema(core.DriftClass, names));
  page.emit('Inventory', toJsonSchema(core.Inventory, names));

  const contents = ['## Contents', '', ...page.order.map((title) => `* [${title}](#${slug(title)})`)];
  const markdown = `${[INTRO.trimEnd(), contents.join('\n'), ...page.sections].join('\n\n')}\n`;
  return { markdown, missing: page.missing };
}

function parseArgs(argv: string[]): { check: boolean; missing: boolean; help: boolean; out?: string } {
  const options: { check: boolean; missing: boolean; help: boolean; out?: string } = {
    check: false,
    missing: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--check') options.check = true;
    else if (arg === '--missing') options.missing = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--out') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error('--out needs a file');
      options.out = value;
      index += 1;
    } else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function display(file: string): string {
  const rel = relative(ROOT, file);
  return rel === '' || rel.startsWith('..') ? file : rel;
}

/** Runs the generator. Returns the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  let options: ReturnType<typeof parseArgs>;
  try {
    options = parseArgs(argv);
  } catch (cause) {
    io.err(`spec-reference: ${cause instanceof Error ? cause.message : String(cause)}\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    io.out(USAGE);
    return 0;
  }

  const { markdown, missing } = renderReference();
  if (options.missing) {
    io.out(missing.map((field) => `${field}\n`).join(''));
    return 0;
  }

  const file = resolve(options.out ?? DEFAULT_OUT);
  const shown = display(file);
  if (options.check) {
    const current = await readFile(file, 'utf8').catch(() => undefined);
    if (current === undefined) {
      io.err(`${shown} is missing. Run \`pnpm docs:reference\` to write it.\n`);
      return 1;
    }
    if (current !== markdown) {
      io.err(
        `${shown} is stale: it differs from the zod schemas. Run \`pnpm docs:reference\` to regenerate it.\n`,
      );
      return 1;
    }
    io.out(`${shown} is up to date.\n`);
    return 0;
  }
  await writeFile(file, markdown);
  io.out(`Wrote ${shown}.\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
