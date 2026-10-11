import { isMap, isScalar, isSeq, type Pair, parseDocument, type YAMLMap } from 'yaml';
import { entry, keyOf, mapAt, pairText, plain, stringItems } from './nodes';
import type { ProposalDimension, ProposalValue } from './proposal';
import { foldQuote } from './quote';
import { proposeRole } from './space';

/**
 * The code pre-pass on tool schemas. Every input and output property whose JSON Schema states a partition
 * (an enum, a const, a boolean, a numeric bound, a length bound, a format or pattern, an array, a null, or
 * an optional flag) becomes a data dimension with its boundary values, role detail (the generator varies it
 * inside a cell; it is no axis of the space map), each value id prefixed with its
 * dimension id (`coverage.check.out.found.true`). A property the schema leaves open,
 * such as a required string with no constraint, gives no value: code proposes only what the schema says.
 *
 * Accepted files: a list of tools; or a mapping with `tools`, `tool_schemas` or `metadata.tool_schemas` (a
 * spec), holding a list of tools or a mapping from tool name to tool. A tool has a name and an input schema
 * under `input_schema`, `inputSchema` or `parameters`, and may have an output schema under `output_schema`,
 * `outputSchema` or `returns`. The OpenAI form `{ type: function, function: {...} }` is read too, and so are Gemini
 * function declarations, at the root or grouped in the tools list.
 */

export type ToolsIssue = {
  code: 'TOOLS_PARSE' | 'TOOLS_NOT_FOUND' | 'TOOLS_INVALID' | 'TOOLS_DUPLICATE';
  path: string;
  message: string;
};

export type ToolsPrepass =
  | { ok: true; tools: string[]; dimensions: ProposalDimension[]; notes: string[] }
  | { ok: false; errors: ToolsIssue[] };

/** How deep the pre-pass follows nested objects: `customer.email` is depth 1. */
const MAX_DEPTH = 2;
/** A property's whole text is its quote when it is this short; a longer one is quoted by its keyword. */
const WHOLE_PROPERTY_QUOTE = 300;

type Tool = { name: string; path: string; input?: YAMLMap; output?: YAMLMap };
type Partition = { id: string; title: string; quote: string };

export function toolsPrepass(text: string, source: string): ToolsPrepass {
  const doc = parseDocument(text, { uniqueKeys: true, prettyErrors: true });
  const first = doc.errors[0];
  if (first)
    return fail('TOOLS_PARSE', '', first.message.split('\n')[0] ?? 'the file is not valid YAML or JSON');
  const located = locate(doc.contents);
  if (!located) {
    return fail(
      'TOOLS_NOT_FOUND',
      '',
      'no tools found: expected a list of tools, or a mapping with tools, tool_schemas or metadata.tool_schemas',
    );
  }
  const read = readTools(located.node, located.path);
  if ('errors' in read) return { ok: false, errors: read.errors };

  const dimensions: ProposalDimension[] = [];
  const notes: string[] = [];
  const ids = new Set<string>();
  for (const tool of read.tools) {
    if (!tool.input && !tool.output) notes.push(`${tool.name}: no input or output schema`);
    for (const [direction, schema] of [
      ['in', tool.input],
      ['out', tool.output],
    ] as const) {
      if (!schema) continue;
      const open: string[] = [];
      walk({ text, source, tool, direction, dimensions, ids, open, root: schema }, schema, [], 0);
      if (open.length > 0) {
        const side = direction === 'in' ? 'input' : 'output';
        notes.push(`${tool.name} ${side}: no partition stated for ${open.join(', ')}`);
      }
    }
  }
  return { ok: true, tools: read.tools.map((tool) => tool.name), dimensions, notes };
}

type Walk = {
  text: string;
  source: string;
  tool: Tool;
  direction: 'in' | 'out';
  dimensions: ProposalDimension[];
  ids: Set<string>;
  open: string[];
  /** The tool's input or output schema, where a local $ref points. */
  root: YAMLMap;
};

function walk(ctx: Walk, schema: YAMLMap, prefix: string[], depth: number): void {
  const properties = mapAt(schema, 'properties');
  if (!properties) return;
  const requiredPair = entry(schema, 'required');
  const required = new Set(stringItems(requiredPair?.value));
  for (const pair of properties.items as Pair[]) {
    const name = keyOf(pair);
    const property = resolveRef(ctx.root, pair.value);
    if (name === undefined || !isMap(property)) continue;
    const path = [...prefix, name];
    const quote = quoter(ctx.text, pair, property);
    const partitions = partitionsOf(name, property, quote);
    const types = typesOf(property);
    if (!required.has(name)) {
      if (partitions.length === 0) {
        partitions.push({ id: 'present', title: `${name} is given`, quote: quote() });
      }
      partitions.push({
        id: 'absent',
        title: `${name} is left out (not required)`,
        quote: pairText(ctx.text, requiredPair) ?? quote(),
      });
    }
    if (partitions.length > 0) addDimension(ctx, path, partitions);
    else if (!types.includes('object')) ctx.open.push(path.join('.'));
    if (types.includes('object') && depth + 1 <= MAX_DEPTH) walk(ctx, property, path, depth + 1);
  }
}

/**
 * A local $ref (`#/$defs/Name`, `#/definitions/Name`) read from the schema it sits in, one step: the target's
 * own keywords replace the reference. Anything else is returned as it is.
 */
function resolveRef(root: YAMLMap, node: unknown): unknown {
  const ref = isMap(node) ? plain(entry(node, '$ref')?.value) : undefined;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return node;
  let target: unknown = root;
  for (const part of ref.slice(2).split('/'))
    target = mapAt(target, part.replace(/~1/g, '/').replace(/~0/g, '~')) ?? entry(target, part)?.value;
  return isMap(target) ? target : node;
}

function addDimension(ctx: Walk, path: string[], partitions: Partition[]): void {
  let id = [toolSlug(ctx.tool.name), ctx.direction, ...path.map(propertySlug)].join('.');
  for (let n = 2; ctx.ids.has(id); n++) id = `${id}-${n}`;
  ctx.ids.add(id);
  // A spec names a data value by its id alone (the tag data:<id>), so the id carries its dimension.
  const seen = new Set<string>();
  const values: ProposalValue[] = partitions.map((partition) => {
    let valueId = `${id}.${partition.id}`;
    for (let n = 2; seen.has(valueId); n++) valueId = `${id}.${partition.id}-${n}`;
    seen.add(valueId);
    return {
      id: valueId,
      title: partition.title,
      evidence: { source: ctx.source, quote: partition.quote },
      produced_by: 'code',
    };
  });
  const side = ctx.direction === 'in' ? 'input' : 'output';
  ctx.dimensions.push({
    id,
    title: `${ctx.tool.name} ${side} ${path.join('.')}`,
    kind: 'data',
    role: proposeRole(ctx.dimensions, 'data', true),
    produced_by: 'code',
    approved: false,
    values,
  });
}

/** The partitions a property's schema states, each with the keyword whose text justifies it. */
function partitionsOf(name: string, property: YAMLMap, quote: (keyword?: string) => string): Partition[] {
  const out: Partition[] = [];
  const add = (id: string, title: string, keyword?: string) => out.push({ id, title, quote: quote(keyword) });
  const types = typesOf(property);
  const members = plain(entry(property, 'enum')?.value);
  if (Array.isArray(members)) {
    for (const member of members) add(valueSlug(member), `${name} is ${show(member)}`, 'enum');
  } else if (entry(property, 'const')) {
    const constant = plain(entry(property, 'const')?.value);
    add(valueSlug(constant), `${name} is always ${show(constant)}`, 'const');
  } else {
    if (types.includes('boolean')) {
      add('true', `${name} is true`, 'type');
      add('false', `${name} is false`, 'type');
    }
    if (types.includes('integer') || types.includes('number')) numberPartitions(name, property, add);
    if (types.includes('string')) stringPartitions(name, property, add);
    if (types.includes('array')) arrayPartitions(name, property, add);
    if (types.includes('object') && types.includes('null')) add('present', `${name} is an object`, 'type');
    if (types.includes('object')) objectPartitions(name, property, add);
  }
  const nullable = plain(entry(property, 'nullable')?.value) === true;
  // An enum that lists null already gave the null partition.
  const listed = out.some((partition) => partition.id === 'null');
  if ((types.includes('null') || nullable) && !listed)
    add('null', `${name} is null`, nullable ? 'nullable' : 'type');
  return out;
}

type Add = (id: string, title: string, keyword?: string) => void;

function numberPartitions(name: string, property: YAMLMap, add: Add): void {
  const bound = (key: string) => {
    const value = plain(entry(property, key)?.value);
    return typeof value === 'number' ? value : undefined;
  };
  // Draft-04 writes an exclusive bound as minimum or maximum with a boolean exclusiveMinimum or exclusiveMaximum.
  const flag = (key: string) => plain(entry(property, key)?.value) === true;
  let minimum = bound('minimum');
  let maximum = bound('maximum');
  let exclusiveMinimum = bound('exclusiveMinimum');
  let exclusiveMaximum = bound('exclusiveMaximum');
  if (flag('exclusiveMinimum') && minimum !== undefined) {
    exclusiveMinimum = minimum;
    minimum = undefined;
  }
  if (flag('exclusiveMaximum') && maximum !== undefined) {
    exclusiveMaximum = maximum;
    maximum = undefined;
  }
  if (minimum !== undefined) {
    add('below-minimum', `${name} below its minimum ${minimum}`, 'minimum');
    add('at-minimum', `${name} at its minimum ${minimum}`, 'minimum');
    add('above-minimum', `${name} just above its minimum ${minimum}`, 'minimum');
  }
  if (exclusiveMinimum !== undefined) {
    add(
      'at-exclusive-minimum',
      `${name} equal to its exclusive minimum ${exclusiveMinimum}`,
      'exclusiveMinimum',
    );
    add('above-exclusive-minimum', `${name} just above ${exclusiveMinimum}`, 'exclusiveMinimum');
  }
  if (maximum !== undefined) {
    add('below-maximum', `${name} just below its maximum ${maximum}`, 'maximum');
    add('at-maximum', `${name} at its maximum ${maximum}`, 'maximum');
    add('above-maximum', `${name} above its maximum ${maximum}`, 'maximum');
  }
  if (exclusiveMaximum !== undefined) {
    add('below-exclusive-maximum', `${name} just below ${exclusiveMaximum}`, 'exclusiveMaximum');
    add(
      'at-exclusive-maximum',
      `${name} equal to its exclusive maximum ${exclusiveMaximum}`,
      'exclusiveMaximum',
    );
  }
  const multipleOf = bound('multipleOf');
  if (multipleOf !== undefined && multipleOf > 0) {
    add('multiple', `${name} a multiple of ${multipleOf}`, 'multipleOf');
    add('not-multiple', `${name} not a multiple of ${multipleOf}`, 'multipleOf');
  }
}

function stringPartitions(name: string, property: YAMLMap, add: Add): void {
  const length = (key: string) => {
    const value = plain(entry(property, key)?.value);
    return typeof value === 'number' ? value : undefined;
  };
  const minLength = length('minLength');
  const maxLength = length('maxLength');
  if (minLength !== undefined) {
    if (minLength > 0)
      add('below-min-length', `${name} shorter than its minLength ${minLength}`, 'minLength');
    add('at-min-length', `${name} exactly ${minLength} characters long`, 'minLength');
  }
  if (maxLength !== undefined) {
    add('at-max-length', `${name} exactly ${maxLength} characters long`, 'maxLength');
    add('above-max-length', `${name} longer than its maxLength ${maxLength}`, 'maxLength');
  }
  const format = plain(entry(property, 'format')?.value);
  const shaped = typeof format === 'string' ? `a well-formed ${format}` : 'matching its pattern';
  if (typeof format === 'string' || entry(property, 'pattern')) {
    const keyword = typeof format === 'string' ? 'format' : 'pattern';
    add('well-formed', `${name} is ${shaped}`, keyword);
    add('malformed', `${name} is not ${shaped}`, keyword);
    return;
  }
  const encoding = plain(entry(property, 'contentEncoding')?.value);
  if (typeof encoding === 'string') {
    add('well-formed', `${name} is well-formed ${encoding}`, 'contentEncoding');
    add('malformed', `${name} is not well-formed ${encoding}`, 'contentEncoding');
  }
}

function objectPartitions(name: string, property: YAMLMap, add: Add): void {
  const count = (key: string) => {
    const value = plain(entry(property, key)?.value);
    return typeof value === 'number' ? value : undefined;
  };
  const minProperties = count('minProperties');
  const maxProperties = count('maxProperties');
  if (minProperties !== undefined && minProperties > 0) {
    add(
      'below-min-properties',
      `${name} has ${minProperties - 1} keys, one under its minProperties`,
      'minProperties',
    );
    add('at-min-properties', `${name} has exactly ${minProperties} keys`, 'minProperties');
  }
  if (maxProperties !== undefined) {
    add('at-max-properties', `${name} has exactly ${maxProperties} keys`, 'maxProperties');
    add('above-max-properties', `${name} has more than ${maxProperties} keys`, 'maxProperties');
  }
}

function arrayPartitions(name: string, property: YAMLMap, add: Add): void {
  const count = (key: string) => {
    const value = plain(entry(property, key)?.value);
    return typeof value === 'number' ? value : undefined;
  };
  const minItems = count('minItems');
  const maxItems = count('maxItems');
  add('empty', minItems ? `${name} is empty, below its minItems ${minItems}` : `${name} is empty`, 'type');
  add('one-item', `${name} has one item`, 'type');
  add('several-items', `${name} has several items`, 'type');
  if (minItems !== undefined && minItems > 0) {
    add('below-min-items', `${name} has ${minItems - 1} items, one under its minItems`, 'minItems');
    add('at-min-items', `${name} has exactly ${minItems} items`, 'minItems');
  }
  if (maxItems !== undefined) {
    add('at-max-items', `${name} has exactly ${maxItems} items`, 'maxItems');
    add('above-max-items', `${name} has more than ${maxItems} items`, 'maxItems');
  }
  if (plain(entry(property, 'uniqueItems')?.value) === true) {
    add('duplicate-items', `${name} holds the same item twice`, 'uniqueItems');
  }
}

/** The quote for a partition: the whole property when it is short, else the keyword's own line. */
function quoter(text: string, pair: Pair, property: YAMLMap): (keyword?: string) => string {
  const whole = pairText(text, pair) ?? '';
  return (keyword) => {
    if (foldQuote(whole).length <= WHOLE_PROPERTY_QUOTE || !keyword) return whole;
    return pairText(text, entry(property, keyword)) ?? whole;
  };
}

function typesOf(property: YAMLMap): string[] {
  const type = entry(property, 'type')?.value;
  if (isScalar(type) && typeof type.value === 'string') return [type.value];
  if (isSeq(type)) return stringItems(type);
  if (entry(property, 'properties')) return ['object'];
  // No type: the keywords say which type the schema constrains (JSON Schema validation, sections 6.2 to 6.4).
  const has = (keys: string[]) => keys.some((key) => entry(property, key) !== undefined);
  if (has(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'])) return ['number'];
  if (has(['format', 'pattern', 'minLength', 'maxLength', 'contentEncoding'])) return ['string'];
  if (has(['items', 'minItems', 'maxItems', 'uniqueItems'])) return ['array'];
  return [];
}

function locate(root: unknown): { node: unknown; path: string } | undefined {
  if (isSeq(root)) return { node: root, path: '' };
  if (!isMap(root)) return undefined;
  for (const key of ['tools', 'tool_schemas', 'functionDeclarations']) {
    const found = entry(root, key);
    if (found) return { node: found.value, path: key };
  }
  const nested = entry(mapAt(root, 'metadata'), 'tool_schemas');
  return nested ? { node: nested.value, path: 'metadata.tool_schemas' } : undefined;
}

function readTools(node: unknown, path: string): { tools: Tool[] } | { errors: ToolsIssue[] } {
  const raw: Array<{ name: unknown; map: unknown; path: string }> = [];
  const at = (index: string | number) => (path ? `${path}.${index}` : String(index));
  if (isSeq(node)) {
    node.items.forEach((item, index) => {
      // Gemini groups its tools as { functionDeclarations: [...] } inside the tools list.
      const declarations = entry(item, 'functionDeclarations')?.value;
      if (isSeq(declarations)) {
        declarations.items.forEach((declaration, inner) => {
          raw.push({
            name: plain(entry(declaration, 'name')?.value),
            map: declaration,
            path: at(`${index}.functionDeclarations.${inner}`),
          });
        });
        return;
      }
      const map = unwrap(item);
      raw.push({ name: plain(entry(map, 'name')?.value), map, path: at(index) });
    });
  } else if (isMap(node)) {
    for (const pair of node.items as Pair[]) {
      const name = keyOf(pair);
      raw.push({ name, map: unwrap(pair.value), path: at(name ?? '?') });
    }
  } else {
    return {
      errors: [{ code: 'TOOLS_INVALID', path, message: 'expected a list of tools or a mapping of tools' }],
    };
  }
  const errors: ToolsIssue[] = [];
  const tools: Tool[] = [];
  const names = new Set<string>();
  for (const candidate of raw) {
    if (!isMap(candidate.map)) {
      errors.push({ code: 'TOOLS_INVALID', path: candidate.path, message: 'a tool is a mapping' });
      continue;
    }
    if (typeof candidate.name !== 'string' || candidate.name.trim() === '') {
      errors.push({ code: 'TOOLS_INVALID', path: candidate.path, message: 'a tool needs a name' });
      continue;
    }
    if (names.has(candidate.name)) {
      errors.push({
        code: 'TOOLS_DUPLICATE',
        path: candidate.path,
        message: `tool "${candidate.name}" is listed twice`,
      });
      continue;
    }
    names.add(candidate.name);
    tools.push({
      name: candidate.name,
      path: candidate.path,
      input: firstMap(candidate.map, ['input_schema', 'inputSchema', 'parameters']),
      output: firstMap(candidate.map, ['output_schema', 'outputSchema', 'returns']),
    });
  }
  return errors.length > 0 ? { errors } : { tools };
}

/** Reads past the OpenAI wrapper `{ type: function, function: {...} }`. */
function unwrap(node: unknown): unknown {
  const fn = mapAt(node, 'function');
  return fn && plain(entry(node, 'type')?.value) === 'function' ? fn : node;
}

function firstMap(map: unknown, keys: string[]): YAMLMap | undefined {
  for (const key of keys) {
    const found = mapAt(map, key);
    if (found) return found;
  }
  return undefined;
}

/** A tool name as a dimension id part: `catalog.search` stays, `getWeather` becomes `get_weather`. */
export function toolSlug(name: string): string {
  const slug = snake(name).replace(/[^a-z0-9_.-]+/g, '_');
  return /^[a-z]/.test(slug) ? slug : `t_${slug}`;
}

function propertySlug(name: string): string {
  const slug = snake(name).replace(/[^a-z0-9_-]+/g, '_');
  return slug === '' ? 'p' : slug;
}

function snake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function valueSlug(member: unknown): string {
  const slug = String(member)
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/-+$/, '');
  return slug === '' ? 'value' : slug;
}

function show(member: unknown): string {
  return typeof member === 'string' ? member : JSON.stringify(member);
}

function fail(code: ToolsIssue['code'], path: string, message: string): ToolsPrepass {
  return { ok: false, errors: [{ code, path, message }] };
}
