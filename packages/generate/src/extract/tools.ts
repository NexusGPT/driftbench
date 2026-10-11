import { isMap, isScalar, isSeq, type Pair, parseDocument, type YAMLMap } from 'yaml';
import { entry, keyOf, mapAt, pairText, plain, stringItems } from './nodes';
import type { ProposalDimension, ProposalValue } from './proposal';
import { foldQuote } from './quote';

/**
 * The code pre-pass on tool schemas. Every input and output property whose JSON Schema states a partition
 * (an enum, a const, a boolean, a numeric bound, a length bound, a format or pattern, an array, a null, or
 * an optional flag) becomes a data dimension with its boundary values. A property the schema leaves open,
 * such as a required string with no constraint, gives no value: code proposes only what the schema says.
 *
 * Accepted files: a list of tools; or a mapping with `tools`, `tool_schemas` or `metadata.tool_schemas` (a
 * spec), holding a list of tools or a mapping from tool name to tool. A tool has a name and an input schema
 * under `input_schema`, `inputSchema` or `parameters`, and may have an output schema under `output_schema`,
 * `outputSchema` or `returns`. The OpenAI form `{ type: function, function: {...} }` is read too.
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
      walk({ text, source, tool, direction, dimensions, ids, open }, schema, [], 0);
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
};

function walk(ctx: Walk, schema: YAMLMap, prefix: string[], depth: number): void {
  const properties = mapAt(schema, 'properties');
  if (!properties) return;
  const requiredPair = entry(schema, 'required');
  const required = new Set(stringItems(requiredPair?.value));
  for (const pair of properties.items as Pair[]) {
    const name = keyOf(pair);
    const property = pair.value;
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

function addDimension(ctx: Walk, path: string[], partitions: Partition[]): void {
  let id = [toolSlug(ctx.tool.name), ctx.direction, ...path.map(propertySlug)].join('.');
  for (let n = 2; ctx.ids.has(id); n++) id = `${id}-${n}`;
  ctx.ids.add(id);
  const seen = new Set<string>();
  const values: ProposalValue[] = partitions.map((partition) => {
    let valueId = partition.id;
    for (let n = 2; seen.has(valueId); n++) valueId = `${partition.id}-${n}`;
    seen.add(valueId);
    return {
      id: valueId,
      title: partition.title,
      evidence: { source: ctx.source, quote: partition.quote },
      approved: false,
    };
  });
  const side = ctx.direction === 'in' ? 'input' : 'output';
  ctx.dimensions.push({ id, title: `${ctx.tool.name} ${side} ${path.join('.')}`, kind: 'data', values });
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
  }
  const nullable = plain(entry(property, 'nullable')?.value) === true;
  if (types.includes('null') || nullable) add('null', `${name} is null`, nullable ? 'nullable' : 'type');
  return out;
}

type Add = (id: string, title: string, keyword?: string) => void;

function numberPartitions(name: string, property: YAMLMap, add: Add): void {
  const bound = (key: string) => {
    const value = plain(entry(property, key)?.value);
    return typeof value === 'number' ? value : undefined;
  };
  const minimum = bound('minimum');
  const maximum = bound('maximum');
  const exclusiveMinimum = bound('exclusiveMinimum');
  const exclusiveMaximum = bound('exclusiveMaximum');
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
  if (maxItems !== undefined) {
    add('at-max-items', `${name} has exactly ${maxItems} items`, 'maxItems');
    add('above-max-items', `${name} has more than ${maxItems} items`, 'maxItems');
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
  return entry(property, 'properties') ? ['object'] : [];
}

function locate(root: unknown): { node: unknown; path: string } | undefined {
  if (isSeq(root)) return { node: root, path: '' };
  if (!isMap(root)) return undefined;
  for (const key of ['tools', 'tool_schemas']) {
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
