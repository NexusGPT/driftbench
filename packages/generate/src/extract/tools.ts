import { parse as parseToml } from 'smol-toml';
import { isMap, isScalar, isSeq, type Pair, parseAllDocuments, parseDocument, YAMLMap, YAMLSeq } from 'yaml';
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
 * function declarations, at the root or grouped in the tools list, and the legacy OpenAI `functions` list.
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
const MAX_DEPTH = 3;
/** A property's whole text is its quote when it is this short; a longer one is quoted by its keyword. */
const WHOLE_PROPERTY_QUOTE = 300;
/** The longest quote a proposal may hold. */
const MAX_QUOTE = 1000;

type Requote = (quote: string, path: string[]) => string;

type Tool = {
  name: string;
  path: string;
  input?: YAMLMap;
  output?: YAMLMap;
  /** The text a schema was read from, when it is a JSON string inside the file (quotes come from it). */
  inputText?: string;
  outputText?: string;
  /** Cohere parameter_definitions or LangChain args: the input is a mapping of parameters, each with its type. */
  cohere?: boolean;
  /** OpenAPI query parameters: the input is these parameter mappings, each with a schema. */
  query?: YAMLMap[];
  /** Legacy XML descriptions: parameters with their type and the text they were read from. */
  xml?: Array<{ name: string; type: string; quote: string }>;
};
type Partition = { id: string; title: string; quote: string };

export function toolsPrepass(text: string, source: string): ToolsPrepass {
  const read = toolsPrepassOf(text, source);
  if (read.ok || !read.errors.some((error) => error.code === 'TOOLS_PARSE')) return read;
  // TOML: read it as the same data, written as JSON; quotes are then lines of the TOML file itself.
  let data: unknown;
  try {
    data = parseToml(text);
  } catch {
    return read;
  }
  const json = JSON.stringify(data, null, 2);
  const converted = toolsPrepassOf(json, source, (quote, path) => tomlLine(text, quote, path));
  return converted.ok ? converted : read;
}

/** The line of a TOML file a quote of its JSON form stands for: the key's own line, else its table header. */
function tomlLine(toml: string, quote: string, path: string[]): string {
  const lines = toml.split('\n').map((line) => line.trimEnd());
  const key = /^\s*"?([^"\s:]+)"?\s*:/.exec(quote.split('\n')[0] ?? '')?.[1] ?? path[path.length - 1] ?? '';
  const name = path[path.length - 1] ?? key;
  const own = (re: RegExp) => lines.find((line) => re.test(line));
  const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return own(new RegExp(`^\\s*\\[+[^\\]]*\\.${escaped(name)}\\]+\\s*$`)) && key !== 'enum' && key !== 'const'
    ? (own(new RegExp(`^\\s*${escaped(key)}\\s*=`)) ??
        (own(new RegExp(`^\\s*\\[+[^\\]]*\\.${escaped(name)}\\]+\\s*$`)) as string))
    : (own(new RegExp(`^\\s*"?${escaped(key)}"?\\s*=`)) ??
        own(new RegExp(`^\\s*\\[+[^\\]]*\\.${escaped(name)}\\]+\\s*$`)) ??
        lines.find((line) => line.trim() !== '' && !line.trim().startsWith('#')) ??
        '');
}

function toolsPrepassOf(text: string, source: string, requote?: Requote): ToolsPrepass {
  if (text.trimStart().startsWith('<')) {
    const xml = readXml(text);
    if (xml) return toolsOf(text, source, xml, requote);
  }
  // A stream of documents (`---` between them) holds one tool per document: read as a list of tools.
  let docs = parseAllDocuments(text, { uniqueKeys: true, prettyErrors: true });
  if (docs.some((doc) => doc.errors.length > 0)) {
    // JSON with comments: blank the comments (same length, so every position stays) and read again.
    const blanked = blankComments(text);
    if (blanked !== text) {
      const again = parseAllDocuments(blanked, { uniqueKeys: true, prettyErrors: true });
      if (again.every((doc) => doc.errors.length === 0)) {
        docs = again;
        text = blanked;
      }
    }
  }
  if (docs.some((doc) => doc.errors.length > 0)) {
    // JSON lines: every line is one JSON object; read the lines as one list.
    const lines = text.split('\n').filter((line) => line.trim() !== '');
    const alone = lines.map((line) => parseDocument(line, { uniqueKeys: true }));
    if (lines.length > 1 && alone.every((doc) => doc.errors.length === 0 && isMap(doc.contents))) {
      text = `[${lines.join(',\n')}]`;
      docs = parseAllDocuments(text, { uniqueKeys: true, prettyErrors: true });
    }
  }
  const first = docs.flatMap((doc) => doc.errors)[0];
  if (first)
    return fail('TOOLS_PARSE', '', first.message.split('\n')[0] ?? 'the file is not valid YAML or JSON');
  const stream = docs.length > 1 ? new YAMLSeq() : undefined;
  if (stream) for (const doc of docs) if (doc.contents) stream.items.push(doc.contents);
  const openApi = stream ? undefined : readOpenApi(docs[0]?.contents);
  if (openApi) return toolsOf(text, source, openApi, requote);
  const located = locate(stream ?? docs[0]?.contents);
  if (!located) {
    return fail(
      'TOOLS_NOT_FOUND',
      '',
      'no tools found: expected a list of tools, or a mapping with tools, tool_schemas or metadata.tool_schemas',
    );
  }
  return toolsOf(text, source, readTools(located.node, located.path), requote);
}

function toolsOf(
  text: string,
  source: string,
  read: { tools: Tool[] } | { errors: ToolsIssue[] },
  requote?: Requote,
): ToolsPrepass {
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
      if (!schema && !(direction === 'in' && (tool.query || tool.xml))) continue;
      const open: string[] = [];
      const own = direction === 'in' ? tool.inputText : tool.outputText;
      const ctx: Walk = {
        text: own ?? text,
        source,
        tool,
        direction,
        dimensions,
        ids,
        open,
        root: schema ?? new YAMLMap(),
        cohere: direction === 'in' && tool.cohere === true,
        requote,
        stack: [],
      };
      if (direction === 'in' && tool.xml) walkXml(ctx, tool.xml);
      else if (direction === 'in' && tool.query) walkQuery(ctx, tool.query);
      else if (schema) walk(ctx, schema, [], 0);
      if (open.length > 0) {
        const side = direction === 'in' ? 'input' : 'output';
        notes.push(`${tool.name} ${side}: no partition stated for ${open.join(', ')}`);
      }
    }
  }
  return { ok: true, tools: read.tools.map((tool) => tool.name), dimensions, notes };
}

/** `//` and `/* *​/` comments outside strings, replaced by spaces of the same length. */
function blankComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    const n = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && n === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];

/**
 * An OpenAPI 3 or Swagger 2 document: one tool per operation with an operationId. The input is the JSON
 * request body (OpenAPI 3) or the body parameter (Swagger 2); the output is the schema of the 200 response.
 * A `$ref` to the document's components or definitions is followed one step.
 */
function readOpenApi(root: unknown): { tools: Tool[] } | { errors: ToolsIssue[] } | undefined {
  const paths = mapAt(root, 'paths');
  if (!paths || (!entry(root, 'openapi') && !entry(root, 'swagger'))) return undefined;
  const follow = (node: unknown): unknown => {
    const ref = isMap(node) ? plain(entry(node, '$ref')?.value) : undefined;
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return node;
    let target: unknown = root;
    for (const part of ref.slice(2).split('/'))
      target = mapAt(target, part.replace(/~1/g, '/').replace(/~0/g, '~'));
    return isMap(target) ? target : node;
  };
  const tools: Tool[] = [];
  const errors: ToolsIssue[] = [];
  const seen = new Set<string>();
  for (const pathPair of paths.items as Pair[]) {
    for (const operationPair of (isMap(pathPair.value) ? pathPair.value.items : []) as Pair[]) {
      const method = keyOf(operationPair);
      const operation = operationPair.value;
      if (!method || !HTTP_METHODS.includes(method) || !isMap(operation)) continue;
      const name = plain(entry(operation, 'operationId')?.value);
      if (typeof name !== 'string' || name.trim() === '') continue;
      const where = `paths.${keyOf(pathPair) ?? '?'}.${method}`;
      if (seen.has(name)) {
        errors.push({ code: 'TOOLS_DUPLICATE', path: where, message: `tool "${name}" is listed twice` });
        continue;
      }
      seen.add(name);
      const body = follow(entry(operation, 'requestBody')?.value);
      const bodyParameter = (
        entry(operation, 'parameters')?.value as { items?: unknown[] } | undefined
      )?.items
        ?.map(follow)
        .find((parameter) => plain(entry(parameter, 'in')?.value) === 'body');
      const ok = follow(mapAt(mapAt(operation, 'responses'), '200'));
      const schema = (node: unknown) => {
        const found =
          mapAt(mapAt(mapAt(node, 'content'), 'application/json'), 'schema') ?? mapAt(node, 'schema');
        const resolved = follow(found);
        return isMap(resolved) ? resolved : undefined;
      };
      const query = (
        (entry(operation, 'parameters')?.value as { items?: unknown[] } | undefined)?.items ?? []
      )
        .map(follow)
        .filter(
          (parameter): parameter is YAMLMap =>
            isMap(parameter) && plain(entry(parameter, 'in')?.value) === 'query',
        );
      const input = schema(body) ?? schema(bodyParameter);
      tools.push({
        name,
        path: where,
        input,
        output: schema(ok),
        ...(!input && query.length > 0 ? { query } : {}),
      });
    }
  }
  return errors.length > 0 ? { errors } : { tools };
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
  /** The schema is a Cohere parameter_definitions mapping. */
  cohere: boolean;
  /** The $refs being read, outermost first: a $ref entered twice is not entered again. */
  stack: string[];
  /** Rewrites a quote to the text of the file the data was converted from. */
  requote?: Requote;
};

/** Legacy XML descriptions name a parameter and its type only: every parameter is optional. */
function readXml(text: string): { tools: Tool[] } | { errors: ToolsIssue[] } | undefined {
  const blocks = [...text.matchAll(/<tool_description>([\s\S]*?)<\/tool_description>/g)];
  if (blocks.length === 0) return undefined;
  const tools: Tool[] = [];
  for (const block of blocks) {
    const name = /<tool_name>\s*([^<]+?)\s*<\/tool_name>/.exec(block[1] ?? '')?.[1];
    if (!name) return { errors: [{ code: 'TOOLS_INVALID', path: '', message: 'a tool needs a name' }] };
    const xml = [...(block[1] ?? '').matchAll(/<parameter>[\s\S]*?<\/parameter>/g)].flatMap((match) => {
      const parameter = /<name>\s*([^<]+?)\s*<\/name>/.exec(match[0])?.[1];
      const type = /<type>\s*([^<]+?)\s*<\/type>/.exec(match[0])?.[1] ?? '';
      return parameter ? [{ name: parameter, type, quote: match[0] }] : [];
    });
    tools.push({ name, path: name, xml });
  }
  return { tools };
}

function walkXml(ctx: Walk, parameters: NonNullable<Tool['xml']>): void {
  for (const { name, type, quote } of parameters) {
    const property = parseDocument(`type: ${SHORT_TYPES[type] ?? type}`).contents;
    if (!isMap(property)) continue;
    const partitions = partitionsOf(name, property, () => quote);
    if (partitions.length === 0) partitions.push({ id: 'present', title: `${name} is given`, quote });
    partitions.push({ id: 'absent', title: `${name} is left out (not required)`, quote });
    addDimension(ctx, [name], partitions);
  }
}

/** OpenAPI query parameters: each is a property named by `name`, with its `schema` and `required` flag. */
function walkQuery(ctx: Walk, parameters: YAMLMap[]): void {
  for (const parameter of parameters) {
    const name = plain(entry(parameter, 'name')?.value);
    const schemaPair = entry(parameter, 'schema');
    if (typeof name !== 'string' || !schemaPair || !isMap(schemaPair.value)) continue;
    field(
      ctx,
      name,
      schemaPair,
      schemaPair.value,
      plain(entry(parameter, 'required')?.value) === true,
      undefined,
      [],
      0,
    );
  }
}

function walk(ctx: Walk, schema: YAMLMap, prefix: string[], depth: number): void {
  const properties = ctx.cohere ? schema : mapAt(schema, 'properties');
  if (!properties) return;
  const requiredPair = ctx.cohere ? undefined : entry(schema, 'required');
  const required = new Set(stringItems(requiredPair?.value));
  // A required list inside an allOf member counts as the schema's own.
  const allOf = entry(schema, 'allOf')?.value;
  if (isSeq(allOf))
    for (const member of allOf.items)
      for (const key of stringItems(entry(member, 'required')?.value)) required.add(key);
  if (ctx.cohere) {
    for (const pair of properties.items as Pair[]) {
      const name = keyOf(pair);
      if (name !== undefined && plain(entry(pair.value, 'required')?.value) === true) required.add(name);
    }
  }
  // dependentRequired, draft-07 dependencies (array form) and dependentSchemas with a required list.
  const needs = new Map<string, Array<{ other: string; quote: string }>>();
  for (const keyword of ['dependentRequired', 'dependencies', 'dependentSchemas']) {
    const dependency = entry(schema, keyword);
    for (const pair of (isMap(dependency?.value) ? dependency.value.items : []) as Pair[]) {
      const name = keyOf(pair);
      const others = isMap(pair.value)
        ? stringItems(entry(pair.value, 'required')?.value)
        : stringItems(pair.value);
      if (name === undefined) continue;
      needs.set(name, [
        ...(needs.get(name) ?? []),
        ...others.map((other) => ({ other, quote: pairText(ctx.text, dependency) ?? '' })),
      ]);
    }
  }
  for (const pair of properties.items as Pair[]) {
    const name = keyOf(pair);
    const property = resolveRef(ctx.root, pair.value);
    if (name === undefined || !isMap(property)) continue;
    // A caller never sends a readOnly property, a tool never returns a writeOnly one, and a deprecated one is not exercised.
    const flag = (key: string) => plain(entry(property, key)?.value) === true;
    if (
      flag('deprecated') ||
      (flag('readOnly') && ctx.direction === 'in') ||
      (flag('writeOnly') && ctx.direction === 'out')
    )
      continue;
    const via = refOf(pair.value);
    const items = entry(property, 'items')?.value;
    // A $ref already entered once is read a second time for its plain properties, never a third time.
    if (entered(ctx, via) >= 2 || entered(ctx, refOf(items)) >= 2) continue;
    // A readOnly output and a writeOnly input are always there: the side that sets them gives them.
    const always =
      (flag('readOnly') && ctx.direction === 'out') || (flag('writeOnly') && ctx.direction === 'in');
    field(
      ctx,
      name,
      pair,
      property,
      required.has(name) || always,
      requiredPair,
      prefix,
      depth,
      via,
      needs.get(name),
    );
  }
  objectCases(ctx, schema, prefix);
}

/** What an object accepts beyond its named properties: a key it does not allow, a typed extra key, a pattern key. */
function objectCases(ctx: Walk, schema: YAMLMap, prefix: string[]): void {
  const cases: Array<[string, string, Array<[string, string]>]> = [];
  // A closed input (additionalProperties false) rejects a key the schema does not name: a case sends one.
  if (ctx.direction === 'in' && plain(entry(schema, 'additionalProperties')?.value) === false) {
    cases.push(['additionalProperties', 'unknown-key', [['sent', 'a key the schema does not name is sent']]]);
  }
  if (plain(entry(schema, 'unevaluatedProperties')?.value) === false) {
    cases.push([
      'unevaluatedProperties',
      'unknown-key',
      [['sent', 'a key the schema does not evaluate is sent']],
    ]);
  }
  if (isMap(entry(schema, 'additionalProperties')?.value)) {
    cases.push([
      'additionalProperties',
      'extra-key',
      [
        ['typed', 'an extra key holds a value of the schema it states'],
        ['mistyped', 'an extra key holds a value of another type'],
      ],
    ]);
  }
  if (isMap(entry(schema, 'patternProperties')?.value)) {
    cases.push([
      'patternProperties',
      'pattern-key',
      [
        ['matching', 'a key matching the pattern holds a value of its schema'],
        ['mistyped', 'a key matching the pattern holds a value of another type'],
      ],
    ]);
  }
  if (entry(schema, 'if') && (entry(schema, 'then') || entry(schema, 'else'))) {
    cases.push([
      'if',
      'if',
      [
        ['then', 'the condition holds and the then schema applies'],
        ['else', 'the condition fails and the else schema applies'],
      ],
    ]);
  }
  for (const [keyword, id, values] of cases) {
    const quote = pairText(ctx.text, entry(schema, keyword)) ?? '';
    addDimension(
      ctx,
      [...prefix, id],
      values.map(([partition, title]) => ({ id: partition, title, quote })),
    );
  }
}

function refOf(node: unknown): string | undefined {
  const ref = isMap(node) ? plain(entry(node, '$ref')?.value) : undefined;
  return typeof ref === 'string' ? ref : undefined;
}

const entered = (ctx: Walk, ref: string | undefined) =>
  ref === undefined ? 0 : ctx.stack.filter((seen) => seen === ref).length;

/** Reads a schema reached through a $ref: the ref is on the stack while its properties are read. */
function walkVia(ctx: Walk, schema: YAMLMap, prefix: string[], depth: number, via: string | undefined): void {
  if (via) ctx.stack.push(via);
  walk(ctx, schema, prefix, depth);
  if (via) ctx.stack.pop();
}

/** An array's items: `<array>.item` (or `<array>.<position>` for a tuple), and the properties of an object item. */
function arrayItems(
  ctx: Walk,
  name: string,
  property: YAMLMap,
  quote: (keyword?: string) => string,
  path: string[],
  depth: number,
): void {
  const tuple = entry(property, 'prefixItems')?.value ?? entry(property, 'items')?.value;
  const children: Array<{ at: string; raw: unknown; keyword: string }> = isSeq(tuple)
    ? tuple.items.map((raw, index) => ({
        at: String(index),
        raw,
        keyword: entry(property, 'prefixItems') ? 'prefixItems' : 'items',
      }))
    : tuple
      ? [{ at: 'item', raw: tuple, keyword: 'items' }]
      : [];
  for (const child of children) {
    const node = resolveRef(ctx.root, child.raw);
    if (!isMap(node)) continue;
    const childPath = [...path, child.at];
    const partitions = partitionsOf(
      `${name} ${child.at}`,
      node,
      () => quote(child.keyword),
      (n) => resolveRef(ctx.root, n),
    );
    if (partitions.length > 0) addDimension(ctx, childPath, partitions);
    if (typesOf(node).includes('object') && depth + 1 <= MAX_DEPTH)
      walkVia(ctx, node, childPath, depth + 1, refOf(child.raw));
  }
}

/** One property: its partitions, its optional cases, and its nested object. */
function field(
  ctx: Walk,
  name: string,
  pair: Pair,
  property: YAMLMap,
  isRequired: boolean,
  requiredPair: Pair | undefined,
  prefix: string[],
  depth: number,
  via?: string,
  needs: Array<{ other: string; quote: string }> = [],
): void {
  const path = [...prefix, name];
  const quote = quoter(ctx.text, pair, property);
  const partitions = partitionsOf(name, property, quote, (node) => resolveRef(ctx.root, node));
  const types = typesOf(property);
  if (!isRequired) {
    // An optional property with a default is left out and the default applies: that is a case of its own.
    if (entry(property, 'default') !== undefined) {
      partitions.push({ id: 'at-default', title: `${name} is left to its default`, quote: quote('default') });
    }
    if (partitions.length === 0) {
      partitions.push({ id: 'present', title: `${name} is given`, quote: quote() });
    }
    partitions.push({
      id: 'absent',
      title: `${name} is left out (not required)`,
      quote: pairText(ctx.text, requiredPair) ?? quote(),
    });
  }
  for (const { other, quote: why } of needs) {
    partitions.push({
      id: `present-without-${other}`,
      title: `${name} is given without ${other}`,
      quote: why,
    });
  }
  if (partitions.length > 0) addDimension(ctx, path, partitions);
  else if (!types.includes('object')) ctx.open.push(path.join('.'));
  if (types.includes('object') && depth + 1 <= MAX_DEPTH) walkVia(ctx, property, path, depth + 1, via);
  if (types.includes('array')) arrayItems(ctx, name, property, quote, path, depth);
  variantChildren(ctx, property, path, depth);
}

/** The properties of the object branches of a oneOf or anyOf: `<property>.<variant>.<child>`. */
function variantChildren(ctx: Walk, property: YAMLMap, path: string[], depth: number): void {
  if (depth + 1 > MAX_DEPTH) return;
  for (const keyword of ['oneOf', 'anyOf']) {
    const list = entry(property, keyword)?.value;
    if (!isSeq(list)) continue;
    list.items.forEach((raw, index) => {
      const node = resolveRef(ctx.root, raw);
      if (!isMap(node) || !typesOf(node).includes('object')) return;
      const title = plain(entry(node, 'title')?.value);
      walkVia(
        ctx,
        node,
        [...path, typeof title === 'string' ? title : String(index + 1)],
        depth + 1,
        refOf(raw),
      );
    });
  }
}

/**
 * A local $ref (`#/$defs/Name`, `#/definitions/Name`) read from the schema it sits in, one step: the target's
 * own keywords replace the reference. Anything else is returned as it is.
 */
function resolveRef(root: YAMLMap, node: unknown): unknown {
  const ref = isMap(node) ? plain(entry(node, '$ref')?.value) : undefined;
  if (typeof ref !== 'string' || !isMap(node)) return node;
  let target: unknown;
  if (ref.startsWith('#/')) {
    target = root;
    for (const part of ref.slice(2).split('/'))
      target = mapAt(target, part.replace(/~1/g, '/').replace(/~0/g, '~')) ?? entry(target, part)?.value;
  } else if (/^#[A-Za-z_][\w.-]*$/.test(ref)) {
    target = findAnchor(root, ref.slice(1));
  }
  if (!isMap(target)) return node;
  // Keywords beside the $ref apply with it (JSON Schema 2020-12): the target's keywords, then the siblings'.
  const siblings = (node.items as Pair[]).filter((pair) => keyOf(pair) !== '$ref');
  if (siblings.length === 0) return target;
  const merged = new YAMLMap();
  const sibling = new Set(siblings.map(keyOf));
  for (const pair of target.items as Pair[]) if (!sibling.has(keyOf(pair))) merged.items.push(pair);
  merged.items.push(...siblings);
  return merged;
}

/** The mapping that states `$anchor: <name>`, found anywhere under the root. */
function findAnchor(node: unknown, name: string): YAMLMap | undefined {
  if (isSeq(node)) {
    for (const item of node.items) {
      const found = findAnchor(item, name);
      if (found) return found;
    }
    return undefined;
  }
  if (!isMap(node)) return undefined;
  if (plain(entry(node, '$anchor')?.value) === name) return node;
  for (const pair of node.items as Pair[]) {
    const found = findAnchor(pair.value, name);
    if (found) return found;
  }
  return undefined;
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
      evidence: {
        source: ctx.source,
        quote: ctx.requote ? ctx.requote(partition.quote, path) : partition.quote,
      },
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

const TYPE_NULL = (node: unknown) => isMap(node) && plain(entry(node, 'type')?.value) === 'null';

/**
 * oneOf, anyOf and allOf. A oneOf or anyOf of consts reads like an enum; a branch beside a null branch gives
 * its own partitions and null; any other gives one value per branch, `variant-<title>`, `variant-<key>` for
 * an OpenAPI discriminator mapping, else `variant-<n>`. allOf gives the partitions of every member.
 */
function compositionPartitions(
  name: string,
  property: YAMLMap,
  quote: (keyword?: string) => string,
  resolve: (node: unknown) => unknown,
): Partition[] | undefined {
  const allOf = entry(property, 'allOf')?.value;
  if (isSeq(allOf)) {
    const merged: Partition[] = [];
    for (const member of allOf.items) {
      const node = resolve(member);
      if (!isMap(node)) continue;
      for (const partition of partitionsOf(name, node, () => quote('allOf'), resolve)) {
        if (!merged.some((seen) => seen.id === partition.id)) merged.push(partition);
      }
    }
    if (merged.length > 0) return merged;
  }
  for (const keyword of ['oneOf', 'anyOf']) {
    const list = entry(property, keyword)?.value;
    if (!isSeq(list)) continue;
    const branches = list.items.map((item) => ({ raw: item, node: resolve(item) }));
    const maps = branches.filter((branch) => isMap(branch.node));
    if (maps.length === 0) continue;
    if (maps.every((branch) => entry(branch.node, 'const'))) {
      return maps.map((branch) => {
        const constant = plain(entry(branch.node, 'const')?.value);
        return { id: valueSlug(constant), title: `${name} is ${show(constant)}`, quote: quote(keyword) };
      });
    }
    const nonNull = maps.filter((branch) => !TYPE_NULL(branch.node));
    if (nonNull.length === 1 && maps.length === 2) {
      const only = nonNull[0]?.node;
      const inner = isMap(only) ? partitionsOf(name, only, () => quote(keyword), resolve) : [];
      return [...inner, { id: 'null', title: `${name} is null`, quote: quote(keyword) }];
    }
    const mapping = mapAt(entry(property, 'discriminator')?.value, 'mapping');
    const keys = new Map<string, string>();
    for (const pair of (mapping?.items ?? []) as Pair[]) {
      const target = plain(pair.value);
      if (typeof target === 'string') keys.set(target, keyOf(pair) ?? '');
    }
    const used = new Set<string>();
    return maps.map((branch, index) => {
      const ref = isMap(branch.raw) ? plain(entry(branch.raw, '$ref')?.value) : undefined;
      const title = plain(entry(branch.node, 'title')?.value);
      const label =
        (typeof ref === 'string' && keys.get(ref)) ||
        (typeof title === 'string' && title) ||
        String(index + 1);
      let id = `variant-${valueSlug(label)}`;
      for (let n = 2; used.has(id); n++) id = `variant-${valueSlug(label)}-${n}`;
      used.add(id);
      return { id, title: `${name} takes the form ${label}`, quote: quote(keyword) };
    });
  }
  return undefined;
}

/** The partitions a property's schema states, each with the keyword whose text justifies it. */
function partitionsOf(
  name: string,
  property: YAMLMap,
  quote: (keyword?: string) => string,
  resolve: (node: unknown) => unknown = (node) => node,
): Partition[] {
  const composed = compositionPartitions(name, property, quote, resolve);
  if (composed) return composed;
  const out: Partition[] = [];
  const add = (id: string, title: string, keyword?: string) => out.push({ id, title, quote: quote(keyword) });
  const types = typesOf(property);
  const members = plain(entry(property, 'enum')?.value);
  if (Array.isArray(members)) {
    for (const [index, member] of members.entries()) {
      add(
        isStructured(member) ? `member-${index + 1}` : valueSlug(member),
        `${name} is ${show(member)}`,
        'enum',
      );
    }
  } else if (entry(property, 'const')) {
    const constant = plain(entry(property, 'const')?.value);
    add(
      isStructured(constant) ? 'fixed' : valueSlug(constant),
      `${name} is always ${show(constant)}`,
      'const',
    );
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
  // not with an enum: a value the enum excludes, and one it allows.
  if (Array.isArray(plain(entry(mapAt(property, 'not'), 'enum')?.value))) {
    add('excluded', `${name} is one of the values the schema excludes`, 'not');
    add('allowed', `${name} is a value the schema allows`, 'not');
  }
  const nullable =
    plain(entry(property, 'nullable')?.value) === true ||
    plain(entry(property, 'x-nullable')?.value) === true;
  // An enum that lists null already gave the null partition.
  const listed = out.some((partition) => partition.id === 'null');
  if ((types.includes('null') || nullable) && !listed)
    add(
      'null',
      `${name} is null`,
      nullable ? (entry(property, 'nullable') ? 'nullable' : 'x-nullable') : 'type',
    );
  return out;
}

const isStructured = (value: unknown) => value !== null && typeof value === 'object';

type Add = (id: string, title: string, keyword?: string) => void;

const property_format = (property: YAMLMap) => plain(entry(property, 'format')?.value);

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
  if (
    property_format(property) === 'int32' &&
    bound('minimum') === undefined &&
    bound('maximum') === undefined
  ) {
    add('at-int32-max', `${name} at the largest 32-bit integer`, 'format');
    add('above-int32-max', `${name} above the largest 32-bit integer`, 'format');
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
  if (plain(entry(property, 'contentMediaType')?.value) === 'application/json') {
    add('well-formed', `${name} is well-formed JSON`, 'contentMediaType');
    add('malformed', `${name} is not well-formed JSON`, 'contentMediaType');
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
  if (entry(mapAt(property, 'propertyNames'), 'pattern')) {
    add('well-formed-key', `${name} has only keys matching its propertyNames pattern`, 'propertyNames');
    add('malformed-key', `${name} has a key that does not match its propertyNames pattern`, 'propertyNames');
  }
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
  // A closed tuple: an item beyond the listed positions is one more case.
  const tuple = isSeq(entry(property, 'prefixItems')?.value) || isSeq(entry(property, 'items')?.value);
  if (
    tuple &&
    (plain(entry(property, 'unevaluatedItems')?.value) === false ||
      plain(entry(property, 'additionalItems')?.value) === false)
  ) {
    add('extra-item', `${name} has an item beyond its listed positions`, 'unevaluatedItems');
  }
  if (entry(property, 'contains')) {
    add('has-match', `${name} has an item matching contains`, 'contains');
    add('no-match', `${name} has no item matching contains`, 'contains');
    const minContains = count('minContains');
    if (minContains !== undefined && minContains > 0) {
      add(
        'below-min-contains',
        `${name} has ${minContains - 1} matching items, one under minContains`,
        'minContains',
      );
      add('at-min-contains', `${name} has exactly ${minContains} matching items`, 'minContains');
    }
  }
}

/** The quote for a partition: the whole property when it is short, else the keyword's own line. */
function quoter(text: string, pair: Pair, property: YAMLMap): (keyword?: string) => string {
  const whole = pairText(text, pair) ?? '';
  // A quote is at most 1000 characters: a longer line is quoted by its first passage.
  const cap = (quote: string) => (quote.length > MAX_QUOTE ? quote.slice(0, MAX_QUOTE).trimEnd() : quote);
  return (keyword) => {
    if (foldQuote(whole).length <= WHOLE_PROPERTY_QUOTE || !keyword) return cap(whole);
    return cap(pairText(text, entry(property, keyword)) ?? whole);
  };
}

const SHORT_TYPES: Record<string, string> = {
  str: 'string',
  int: 'integer',
  bool: 'boolean',
  float: 'number',
};

function typesOf(property: YAMLMap): string[] {
  const type = entry(property, 'type')?.value;
  if (isScalar(type) && typeof type.value === 'string') return [SHORT_TYPES[type.value] ?? type.value];
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
  for (const key of ['tools', 'tool_schemas', 'functionDeclarations', 'function_declarations', 'functions']) {
    const found = entry(root, key);
    if (found) return { node: found.value, path: key };
  }
  const nested = entry(mapAt(root, 'metadata'), 'tool_schemas');
  if (nested) return { node: nested.value, path: 'metadata.tool_schemas' };
  // An agent configuration keeps its tools under agent.
  const agent = entry(mapAt(root, 'agent'), 'tools');
  return agent ? { node: agent.value, path: 'agent.tools' } : undefined;
}

function readTools(node: unknown, path: string): { tools: Tool[] } | { errors: ToolsIssue[] } {
  const raw: Array<{ name: unknown; map: unknown; path: string }> = [];
  const at = (index: string | number) => (path ? `${path}.${index}` : String(index));
  if (isSeq(node)) {
    node.items.forEach((item, index) => {
      // Gemini groups its tools as { functionDeclarations: [...] } inside the tools list.
      const declarations = (entry(item, 'functionDeclarations') ?? entry(item, 'function_declarations'))
        ?.value;
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
    const cohere = mapAt(candidate.map, 'parameter_definitions') ?? mapAt(candidate.map, 'args');
    const input = cohere
      ? { map: cohere, text: undefined }
      : schemaOf(candidate.map, ['input_schema', 'inputSchema', 'parameters']);
    const output = schemaOf(candidate.map, ['output_schema', 'outputSchema', 'returns']);
    tools.push({
      name: candidate.name,
      path: candidate.path,
      input: input?.map,
      output: output?.map,
      inputText: input?.text,
      outputText: output?.text,
      cohere: cohere ? true : undefined,
    });
  }
  return errors.length > 0 ? { errors } : { tools };
}

/** Reads past the OpenAI wrapper `{ type: function, function: {...} }` and the Bedrock wrapper `{ toolSpec: {...} }`. */
function unwrap(node: unknown): unknown {
  const fn = mapAt(node, 'function');
  if (fn && plain(entry(node, 'type')?.value) === 'function') return fn;
  return mapAt(node, 'toolSpec') ?? node;
}

/** A schema given as a map, or as a JSON string (some exports stringify their parameters). */
function schemaOf(map: unknown, keys: string[]): { map: YAMLMap; text?: string } | undefined {
  const found = firstMap(map, keys);
  if (found) return { map: found };
  for (const key of keys) {
    const value = entry(map, key)?.value;
    if (!isScalar(value) || typeof value.value !== 'string') continue;
    const parsed = parseDocument(value.value, { uniqueKeys: true });
    if (parsed.errors.length === 0 && isMap(parsed.contents))
      return { map: parsed.contents, text: value.value };
  }
  return undefined;
}

function firstMap(map: unknown, keys: string[]): YAMLMap | undefined {
  for (const key of keys) {
    const found = mapAt(map, key);
    // Bedrock holds the schema one step down as inputSchema.json, Vercel as parameters.jsonSchema.
    if (found)
      return (!entry(found, 'properties') && (mapAt(found, 'json') ?? mapAt(found, 'jsonSchema'))) || found;
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
