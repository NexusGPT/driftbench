/**
 * A deliberately bounded static Python syntax reader. It tokenizes strings/comments before recognizing calls,
 * tracks imported names through scopes and rebinding, and never imports Python or evaluates an expression.
 * Unsupported expressions remain unresolved input for coverage; they are never guessed from English text.
 */
type Token = { text: string; line: number; column: number; string?: string; dynamic?: boolean };
type Statement = { tokens: Token[]; line: number; indent: number };
export type PythonFact = { name: string; line: number; [key: string]: unknown };
export type PythonFacts = {
  graphs: PythonFact[];
  nodes: PythonFact[];
  tools: PythonFact[];
  prompts: PythonFact[];
  agents: PythonFact[];
  guards: PythonFact[];
  toolBindings: Array<{ node: string; graph: string; tool: string; line: number }>;
  edges: Array<{ graph: string; from: string; to: string; line: number }>;
  unresolved: Array<{ line: number; reason: string }>;
};

function emptyFacts(): PythonFacts {
  return {
    graphs: [],
    nodes: [],
    tools: [],
    prompts: [],
    agents: [],
    guards: [],
    toolBindings: [],
    edges: [],
    unresolved: [],
  };
}

const PAIRS: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };
const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  v: '\v',
  a: '\x07',
  '\\': '\\',
  '"': '"',
  "'": "'",
  '\n': '',
};

function decodeString(text: string): string {
  return text.replace(/\\(?:x[\da-fA-F]{2}|u[\da-fA-F]{4}|U[\da-fA-F]{8}|[0-7]{1,3}|.)/gs, (escape) => {
    const value = escape.slice(1);
    const known = ESCAPES[value];
    if (known !== undefined) return known;
    if (/^[0-7]/.test(value)) return String.fromCodePoint(Number.parseInt(value, 8));
    if (/^[xuU]/.test(value)) {
      const point = Number.parseInt(value.slice(1), 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : escape;
    }
    return escape;
  });
}

function tokenize(text: string): { statements: Statement[]; error?: { line: number; reason: string } } {
  const statements: Statement[] = [];
  let tokens: Token[] = [];
  const delimiters: string[] = [];
  let line = 1;
  let column = 0;
  let index = 0;
  const consume = (count: number) => {
    for (let n = 0; n < count; n++) {
      if (text[index] === '\n') {
        line++;
        column = 0;
      } else if (text[index] === '\t') column += 8 - (column % 8);
      else column++;
      index++;
    }
  };
  const flush = () => {
    const first = tokens[0];
    if (first) statements.push({ tokens, line: first.line, indent: first.column });
    tokens = [];
  };
  while (index < text.length) {
    const char = text[index] as string;
    if (char === '#') {
      while (index < text.length && text[index] !== '\n') consume(1);
      continue;
    }
    if (char === '\\' && /[\r\n]/.test(text[index + 1] ?? '')) {
      consume(text[index + 1] === '\r' ? 3 : 2);
      continue;
    }
    if (char === '\n' || char === ';') {
      if (delimiters.length === 0) flush();
      consume(1);
      continue;
    }
    if (/\s/.test(char)) {
      consume(1);
      continue;
    }
    const start = index;
    const startLine = line;
    const startColumn = column;
    const prefix = /^(?:[rRuUbBfF]|[bB][rR]|[rR][bB]|[fF][rR]|[rR][fF])?(?=['"])/.exec(text.slice(index));
    if (prefix) {
      const flags = prefix[0].toLowerCase();
      consume(flags.length);
      const quote = text[index] as string;
      const delimiter = text.startsWith(quote.repeat(3), index) ? quote.repeat(3) : quote;
      consume(delimiter.length);
      const bodyStart = index;
      let closed = false;
      while (index < text.length) {
        if (text.startsWith(delimiter, index)) {
          closed = true;
          break;
        }
        if (text[index] === '\\') consume(Math.min(2, text.length - index));
        else if (text[index] === '\n' && delimiter.length === 1) break;
        else consume(1);
      }
      if (!closed) return { statements: [], error: { line: startLine, reason: 'unclosed-string' } };
      const body = text.slice(bodyStart, index);
      consume(delimiter.length);
      tokens.push({
        text: text.slice(start, index),
        line: startLine,
        column: startColumn,
        ...(flags.includes('f') || flags.includes('b')
          ? { dynamic: true }
          : { string: flags.includes('r') ? body : decodeString(body) }),
      });
      continue;
    }
    const name = /^[\p{ID_Start}_][\p{ID_Continue}_]*/u.exec(text.slice(index));
    const token = name?.[0] ?? char;
    if (PAIRS[token]) delimiters.push(PAIRS[token] as string);
    else if ([')', ']', '}'].includes(token) && delimiters.pop() !== token) {
      return { statements: [], error: { line, reason: 'unmatched-delimiter' } };
    }
    tokens.push({ text: token, line, column });
    consume(token.length);
  }
  if (delimiters.length > 0) return { statements: [], error: { line, reason: 'unclosed-delimiter' } };
  flush();
  return { statements };
}

function split(tokens: readonly Token[], separator = ','): Token[][] {
  const out: Token[][] = [];
  let start = 0;
  let depth = 0;
  for (const [index, token] of tokens.entries()) {
    if (PAIRS[token.text]) depth++;
    if ([')', ']', '}'].includes(token.text)) depth--;
    if (token.text === separator && depth === 0) {
      out.push(tokens.slice(start, index));
      start = index + 1;
    }
  }
  out.push(tokens.slice(start));
  return out.filter((group) => group.length > 0);
}

function dotted(tokens: readonly Token[]): string | undefined {
  if (tokens.length === 0 || tokens.length % 2 === 0) return undefined;
  if (
    tokens.some((token, index) =>
      index % 2 === 0
        ? !/^[A-Za-z_]\w*$/.test(token.text) || token.string !== undefined
        : token.text !== '.',
    )
  )
    return undefined;
  return tokens.map((token) => token.text).join('');
}

type Call = {
  callee: string;
  args: Token[][];
  keywords: Map<string, Token[]>;
  line: number;
  open: number;
  end: number;
};
function calls(tokens: readonly Token[]): Call[] {
  const out: Call[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]?.text !== '(') continue;
    let start = index - 1;
    while (start > 1 && tokens[start - 1]?.text === '.') start -= 2;
    const callee = dotted(tokens.slice(start, index));
    if (!callee) continue;
    let depth = 1;
    let end = index + 1;
    for (; end < tokens.length; end++) {
      if (tokens[end]?.text === '(') depth++;
      if (tokens[end]?.text === ')' && --depth === 0) break;
    }
    const args: Token[][] = [];
    const keywords = new Map<string, Token[]>();
    for (const group of split(tokens.slice(index + 1, end))) {
      if (group[1]?.text === '=' && group[0]) keywords.set(group[0].text, group.slice(2));
      else args.push(group);
    }
    out.push({ callee, args, keywords, line: tokens[start]?.line ?? 1, open: index, end });
  }
  return out;
}

type Scope = {
  indent: number;
  name: string;
  imports: Map<string, string>;
  constants: Map<string, string>;
  promptFiles: Map<string, string>;
  graphs: Map<string, string>;
  decorators: Token[][];
};
function resolveName(name: string, scope: Scope): string {
  const [head, ...rest] = name.split('.');
  const imported = scope.imports.get(head ?? '');
  return imported ? [imported, ...rest].join('.') : name;
}
function literal(tokens: readonly Token[] | undefined, scope: Scope): string | undefined {
  if (!tokens || tokens.length === 0) return undefined;
  if (tokens.every((token) => token.string !== undefined)) return tokens.map((token) => token.string).join('');
  if (tokens.length === 1) return scope.constants.get(tokens[0]?.text ?? '');
  return undefined;
}

/** A file-relative pathlib read is statically located; a working-directory read is deliberately not guessed. */
function promptFile(tokens: readonly Token[] | undefined, scope: Scope): string | undefined {
  if (!tokens) return undefined;
  const path = calls(tokens).find((call) => resolveName(call.callee, scope) === 'pathlib.Path');
  if (path?.args.length !== 1 || dotted(path.args[0] ?? []) !== '__file__') return undefined;
  const method = tokens.findIndex((token, index) => token.text === 'read_text' && tokens[index - 1]?.text === '.');
  if (method < 0) return undefined;
  const close = path.end;
  const remainder = tokens.slice(close + 1, method - 1);
  if (remainder[0]?.text === '.' && remainder[1]?.text === 'with_name') {
    const end = remainder.findIndex((token, index) => index > 2 && token.text === ')');
    if (end < 0 || remainder.slice(end + 1).some((token) => token.text !== ')')) return undefined;
    const name = literal(remainder.slice(3, end), scope);
    return name && !/[/\\]/.test(name) && name !== '.' && name !== '..' ? name : undefined;
  }
  if (remainder[0]?.text !== '.' || remainder[1]?.text !== 'parent') return undefined;
  const pieces = remainder.slice(2).filter((token) => token.text !== ')');
  const parts = split(pieces, '/');
  const values = parts.map((part) => literal(part, scope));
  return values.length > 0 && values.every((value) => value !== undefined) ? values.join('/') : undefined;
}
function childScope(parent: Scope, name: string, indent: number): Scope {
  return {
    indent,
    name: parent.name ? `${parent.name}/${name}` : name,
    imports: new Map(parent.imports),
    constants: new Map(parent.constants),
    promptFiles: new Map(parent.promptFiles),
    graphs: new Map(parent.graphs),
    decorators: [],
  };
}

function readImport(tokens: readonly Token[], scope: Scope): boolean {
  if (tokens[0]?.text === 'import') {
    for (const group of split(tokens.slice(1))) {
      const as = group.findIndex((token) => token.text === 'as');
      const module = dotted(as < 0 ? group : group.slice(0, as));
      if (!module) continue;
      const alias = as < 0 ? module.split('.')[0] : group[as + 1]?.text;
      if (alias) scope.imports.set(alias, as < 0 ? alias : module);
    }
    return true;
  }
  if (tokens[0]?.text !== 'from') return false;
  const at = tokens.findIndex((token) => token.text === 'import');
  const module = dotted(tokens.slice(1, at));
  if (!module) return true;
  for (const group of split(tokens.slice(at + 1).filter((token) => !['(', ')'].includes(token.text)))) {
    const name = group[0]?.text;
    const alias = group[1]?.text === 'as' ? group[2]?.text : name;
    if (name && alias) scope.imports.set(alias, `${module}.${name}`);
  }
  return true;
}

/** Python determines a function's locals for its entire suite, including assignments after a reference. */
function localBindings(statements: readonly Statement[], position: number): Set<string> {
  const header = statements[position];
  const names = new Set<string>();
  const outer = new Set<string>();
  let nested: number | undefined;
  if (!header) return names;
  for (const statement of statements.slice(position + 1)) {
    if (statement.indent <= header.indent) break;
    if (nested !== undefined && statement.indent > nested) continue;
    nested = undefined;
    const tokens = statement.tokens;
    const keyword = tokens[0]?.text === 'async' ? 1 : 0;
    const first = tokens[keyword]?.text;
    if (first === 'global' || first === 'nonlocal') {
      for (const token of tokens.slice(keyword + 1)) if (/^[A-Za-z_]\w*$/.test(token.text)) outer.add(token.text);
      continue;
    }
    if (first === 'def' || first === 'class') {
      const name = tokens[keyword + 1]?.text;
      if (name) names.add(name);
      nested = statement.indent;
      continue;
    }
    if ((tokens[1]?.text === '=' || tokens[1]?.text === ':') && tokens[0]) names.add(tokens[0].text);
    if (first === 'for') {
      const end = tokens.findIndex((token) => token.text === 'in');
      for (const token of tokens.slice(keyword + 1, end)) if (/^[A-Za-z_]\w*$/.test(token.text)) names.add(token.text);
    }
    for (const [index, token] of tokens.entries()) {
      if (token.text === 'as' && tokens[index + 1]) names.add((tokens[index + 1] as Token).text);
    }
    if (first === 'import') {
      for (const group of split(tokens.slice(keyword + 1))) if (group[0]) names.add(group[0].text);
    }
    if (first === 'from') {
      const start = tokens.findIndex((token) => token.text === 'import');
      for (const group of split(tokens.slice(start + 1))) if (group[0]) names.add(group[0].text);
    }
  }
  for (const name of outer) names.delete(name);
  return names;
}

/** API symbol selectors are data local to this reader. They are syntax identities, never prose patterns. */
export const PYTHON_SYNTAX_SELECTORS = {
  graph: ['langgraph.graph.StateGraph'],
  tool: ['langchain.tools.tool', 'langchain_core.tools.tool'],
  prompt: ['langchain_core.messages.SystemMessage', 'langchain.messages.SystemMessage'],
  agent: ['langchain.agents.create_agent', 'langgraph.prebuilt.create_react_agent'],
  guard: ['langgraph.types.interrupt'],
  toolNode: ['langgraph.prebuilt.ToolNode'],
  methods: { node: 'add_node', edge: 'add_edge', conditional: 'add_conditional_edges' },
} as const;
const TOOL = new Set<string>(PYTHON_SYNTAX_SELECTORS.tool);
const MESSAGE = new Set<string>(PYTHON_SYNTAX_SELECTORS.prompt);
const AGENT = new Set<string>(PYTHON_SYNTAX_SELECTORS.agent);

/** Normalized syntax records selected by PYTHON_AGENT_TYPES, before construction of common-model parts. */
export function pythonAgentFacts(text: string): PythonFacts {
  const facts = emptyFacts();
  const parsed = tokenize(text);
  if (parsed.error) {
    facts.unresolved.push(parsed.error);
    return facts;
  }
  const scopes: Scope[] = [
    {
      indent: -1,
      name: '',
      imports: new Map(),
      constants: new Map(),
      promptFiles: new Map(),
      graphs: new Map(),
      decorators: [],
    },
  ];
  const lines = text.split('\n');
  const functions = new Map<string, string>();
  for (const [position, statement] of parsed.statements.entries()) {
    while (scopes.length > 1 && statement.indent <= (scopes.at(-1)?.indent ?? -1)) scopes.pop();
    const scope = scopes.at(-1) as Scope;
    const tokens = statement.tokens;
    if (readImport(tokens, scope)) continue;
    if (tokens[0]?.text === '@') {
      scope.decorators.push(tokens.slice(1));
      continue;
    }
    const definition = tokens[0]?.text === 'async' ? 1 : 0;
    if (tokens[definition]?.text === 'def' || tokens[definition]?.text === 'class') {
      const name = tokens[definition + 1]?.text;
      if (!name) continue;
      scope.imports.delete(name);
      scope.constants.delete(name);
      scope.promptFiles.delete(name);
      const next = parsed.statements.slice(position + 1).find((item) => item.indent <= statement.indent);
      const body = lines.slice(statement.line - 1, next ? next.line - 1 : lines.length).join('\n');
      if (tokens[definition]?.text === 'def') functions.set(scope.name ? `${scope.name}/${name}` : name, body);
      const decorators = scope.decorators.splice(0);
      const tool = decorators.find((decorator) => {
        const call = calls(decorator)[0];
        return TOOL.has(resolveName(call?.callee ?? dotted(decorator) ?? '', scope));
      });
      if (tool) {
        const call = calls(tool)[0];
        const firstBody = parsed.statements[position + 1];
        const toolName = call?.args[0] ? literal(call.args[0], scope) : name;
        const described = call?.keywords.get('description');
        const description = described
          ? literal(described, scope)
          : firstBody && firstBody.indent > statement.indent ? firstBody.tokens[0]?.string : undefined;
        if (described && description === undefined) {
          facts.unresolved.push({ line: statement.line, reason: 'dynamic-tool-description' });
        }
        if (toolName === undefined) facts.unresolved.push({ line: statement.line, reason: 'dynamic-tool-name' });
        else {
          facts.tools.push({
            name: toolName,
            symbol: name,
            owner: scope.name,
            line: statement.line,
            body,
            description,
          });
        }
      }
      const inner = childScope(scope, name, statement.indent);
      for (const local of localBindings(parsed.statements, position)) {
        inner.imports.delete(local);
        inner.constants.delete(local);
        inner.promptFiles.delete(local);
        inner.graphs.delete(local);
      }
      const open = tokens.findIndex((token) => token.text === '(');
      const close = tokens.findIndex((token) => token.text === ')');
      if (tokens[definition]?.text === 'def') {
        for (const parameter of split(tokens.slice(open + 1, close))) {
          const bound = parameter.find((token) => /^[A-Za-z_]\w*$/.test(token.text))?.text;
          if (bound) {
            inner.imports.delete(bound);
            inner.constants.delete(bound);
            inner.promptFiles.delete(bound);
            inner.graphs.delete(bound);
          }
        }
      }
      scopes.push(inner);
      continue;
    }
    scope.decorators = [];
    const equal = tokens.findIndex((token) => token.text === '=');
    const assigned =
      equal > 0 && /^[A-Za-z_]\w*$/.test(tokens[0]?.text ?? '') && (equal === 1 || tokens[1]?.text === ':')
        ? tokens[0]?.text
        : undefined;
    const expression = assigned ? tokens.slice(equal + 1) : tokens;
    const foundCalls = calls(expression);
    const addPrompt = (name: string, input: readonly Token[] | undefined, line: number) => {
      const value = literal(input, scope);
      const file = promptFile(input, scope) ??
        (input?.length === 1 ? scope.promptFiles.get(input[0]?.text ?? '') : undefined);
      if (file !== undefined) facts.prompts.push({ name, file, relativeTo: 'module', owner: scope.name, line });
      else if (value === undefined) facts.unresolved.push({ line, reason: 'dynamic-prompt' });
      else facts.prompts.push({ name, text: value, owner: scope.name, line });
    };
    for (const call of foundCalls) {
      const resolved = resolveName(call.callee, scope);
      if ((PYTHON_SYNTAX_SELECTORS.graph as readonly string[]).includes(resolved)) {
        if (!assigned) {
          facts.unresolved.push({ line: call.line, reason: 'unbound-graph' });
          continue;
        }
        const name = scope.name ? `${scope.name}/${assigned}` : assigned;
        facts.graphs.push({ name, line: call.line });
        scope.graphs.set(assigned, name);
      } else if (MESSAGE.has(resolved)) {
        addPrompt(
          assigned ?? `${scope.name}/message@${call.line}`,
          call.keywords.get('content') ?? call.args[0],
          call.line,
        );
      } else if (AGENT.has(resolved)) {
        const name = assigned ?? `${scope.name}/agent@${call.line}`;
        facts.agents.push({ name, owner: scope.name, line: call.line });
        const prompt = call.keywords.get('system_prompt') ?? call.keywords.get('prompt');
        if (prompt) addPrompt(`${name}/prompt`, prompt, call.line);
      } else if ((PYTHON_SYNTAX_SELECTORS.guard as readonly string[]).includes(resolved)) {
        if (!scope.name) {
          facts.unresolved.push({ line: call.line, reason: 'interrupt-outside-function' });
          continue;
        }
        const name = `${scope.name}/${assigned ?? `interrupt@${call.line}`}`;
        facts.guards.push({ name, owner: scope.name, line: call.line });
      } else {
        const dot = call.callee.lastIndexOf('.');
        const graph = scope.graphs.get(call.callee.slice(0, dot));
        const method = call.callee.slice(dot + 1);
        if (!graph) continue;
        if (method === PYTHON_SYNTAX_SELECTORS.methods.node) {
          const action = call.keywords.get('action') ?? call.args[1] ?? call.args[0];
          const toolNode = calls(action ?? []).find((item) =>
            (PYTHON_SYNTAX_SELECTORS.toolNode as readonly string[]).includes(resolveName(item.callee, scope)),
          );
          const callable = toolNode ? 'langgraph.prebuilt.ToolNode' : dotted(action ?? []);
          const name =
            literal(call.keywords.get('node') ?? call.args[0], scope) ??
            (call.args.length === 1 ? callable : undefined);
          if (!name || !callable) facts.unresolved.push({ line: call.line, reason: 'dynamic-node' });
          else {
            facts.nodes.push({
              name,
              graph,
              callable: resolveName(callable, scope),
              scope: scope.name,
              line: call.line,
            });
            if (toolNode) {
              const tools = toolNode.keywords.get('tools') ?? toolNode.args[0];
              if (tools?.[0]?.text !== '[') facts.unresolved.push({ line: call.line, reason: 'dynamic-tools' });
              else {
                for (const item of split(tools.slice(1, -1))) {
                  const tool = dotted(item);
                  if (tool) {
                    facts.toolBindings.push({ node: name, graph, tool: resolveName(tool, scope), line: call.line });
                  } else facts.unresolved.push({ line: call.line, reason: 'dynamic-tools' });
                }
              }
            }
          }
        } else if (method === PYTHON_SYNTAX_SELECTORS.methods.edge) {
          const from = literal(call.keywords.get('start_key') ?? call.args[0], scope);
          const to = literal(call.keywords.get('end_key') ?? call.args[1], scope);
          if (from === undefined || to === undefined)
            facts.unresolved.push({ line: call.line, reason: 'dynamic-edge-target' });
          else facts.edges.push({ graph, from, to, line: call.line });
        } else if (method === PYTHON_SYNTAX_SELECTORS.methods.conditional) {
          const from = literal(call.keywords.get('source') ?? call.args[0], scope);
          const mapping = call.keywords.get('path_map') ?? call.args[2];
          if (from === undefined || mapping?.[0]?.text !== '{') {
            facts.unresolved.push({ line: call.line, reason: 'dynamic-edge-target' });
            continue;
          }
          for (const entry of split(mapping.slice(1, -1))) {
            const colon = entry.findIndex((token) => token.text === ':');
            const to = literal(entry.slice(colon + 1), scope);
            if (colon < 0 || to === undefined)
              facts.unresolved.push({ line: call.line, reason: 'dynamic-edge-target' });
            else facts.edges.push({ graph, from, to, line: call.line });
          }
        }
      }
    }
    if (assigned) {
      const value = literal(expression, scope);
      const file = promptFile(expression, scope);
      const named = dotted(expression);
      const alias = named ? resolveName(named, scope) : undefined;
      const graphAlias = named ? scope.graphs.get(named) : undefined;
      scope.imports.delete(assigned);
      scope.constants.delete(assigned);
      scope.promptFiles.delete(assigned);
      if (value !== undefined) scope.constants.set(assigned, value);
      if (file !== undefined) scope.promptFiles.set(assigned, file);
      if (alias && alias !== named) scope.imports.set(assigned, alias);
      if (graphAlias) scope.graphs.set(assigned, graphAlias);
      if (
        !graphAlias && !foundCalls.some((call) =>
          (PYTHON_SYNTAX_SELECTORS.graph as readonly string[]).includes(resolveName(call.callee, scope)),
        )
      ) {
        scope.graphs.delete(assigned);
      }
    }
  }
  for (const node of facts.nodes) {
    const callable = typeof node.callable === 'string' ? node.callable : '';
    const scoped = node.scope ? `${node.scope}/${callable}` : callable;
    const body = functions.get(scoped) ?? functions.get(callable);
    if (body !== undefined) node.body = body;
  }
  return facts;
}
