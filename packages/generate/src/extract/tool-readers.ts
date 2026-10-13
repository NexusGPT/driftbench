/** Reading tool schemas from their file formats: JSON, YAML, TOML, OpenAPI and XML. */

import { isMap, isScalar, isSeq, type Pair, parseDocument, type YAMLMap } from 'yaml';
import { entry, keyOf, mapAt, plain } from './nodes';
import type { Tool, ToolsIssue } from './tool-types';

/** `//` and `/* *​/` comments outside strings, replaced by spaces of the same length. */
export function blankComments(text: string): string {
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
export function readOpenApi(root: unknown): { tools: Tool[] } | { errors: ToolsIssue[] } | undefined {
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

/** Legacy XML descriptions name a parameter and its type only: every parameter is optional. */
export function readXml(text: string): { tools: Tool[] } | { errors: ToolsIssue[] } | undefined {
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

export function locate(root: unknown): { node: unknown; path: string } | undefined {
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

export function readTools(node: unknown, path: string): { tools: Tool[] } | { errors: ToolsIssue[] } {
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
