import { parse as parseToml } from 'smol-toml';
import { isMap, parseAllDocuments, parseDocument, YAMLMap, YAMLSeq } from 'yaml';
import type { ProposalDimension } from './proposal';
import { blankComments, locate, readOpenApi, readTools, readXml } from './tool-readers';
import type { Requote, Tool, ToolsIssue, ToolsPrepass } from './tool-types';
import { type Walk, walk, walkQuery, walkXml } from './tool-walk';

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

export type { ToolsIssue, ToolsPrepass } from './tool-types';
export { toolSlug } from './tool-walk';

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

function fail(code: ToolsIssue['code'], path: string, message: string): ToolsPrepass {
  return { ok: false, errors: [{ code, path, message }] };
}
