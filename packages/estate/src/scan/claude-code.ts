import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, posix } from 'node:path';
import type {
  EstateFile,
  EstateReader,
  FileKind,
  GuardDecl,
  PermissionDecl,
  ProseChunk,
  RawEstate,
  Read,
  ReadNote,
  RegistryRow,
  SettingDecl,
  SkillDecl,
  StepDecl,
  SubagentDecl,
} from './reader';
import { keyLine, type Located, lineAt, linesOf, readFrontmatter, readTables } from './text';

/**
 * The Claude Code reader: the runtime adapter of the estate scanner. It reads `CLAUDE.md` (and
 * `.claude/CLAUDE.md`, `CLAUDE.local.md`), memory files under `.claude/memory/`, skills under
 * `.claude/skills/<name>/SKILL.md` with the files beside them, helper agents under `.claude/agents/`,
 * `.claude/settings.json` (model, permissions, environment keys, hooks), the hooks a skill declares in its
 * frontmatter, a check registry (a file whose name holds "registry"), and step lists (a JSON file with a
 * `steps` list). Claude Code calls a guard a hook; the scanner gets them as guards.
 */

const STANDING = new Set(['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']);
const SETTINGS = new Set(['.claude/settings.json', '.claude/settings.local.json']);
const SKIP_DIRS = new Set(['node_modules', '.git']);
const MAX_FILE_BYTES = 1024 * 1024;
const INTERPRETERS = new Set([
  'python',
  'python3',
  'node',
  'sh',
  'bash',
  'zsh',
  'deno',
  'bun',
  'tsx',
  'ruby',
]);
const SCRIPT_EXTENSION = /\.(sh|bash|py|js|mjs|cjs|ts|rb|pl)$/;
const ANCHORS = [/^\$\{?CLAUDE_PROJECT_DIR\}?\//, /^\$\{?CLAUDE_PLUGIN_ROOT\}?\//];

export class ClaudeCodeReader implements EstateReader {
  readonly runtime = 'claude-code';

  async read(root: string): Promise<RawEstate> {
    const notes: ReadNote[] = [];
    const paths = [
      ...(await present(root, ['CLAUDE.md', 'CLAUDE.local.md'])),
      ...(await walk(root, '.claude', notes)),
    ];
    const files: EstateFile[] = [];
    for (const path of paths) {
      const text = await readFile(join(root, path), 'utf8');
      files.push({ path, text, ...classify(path, text) });
    }

    const estate: RawEstate = {
      runtime: this.runtime,
      labels: { read: 'Read', edit: 'Edit', write: 'Write', shell: 'Bash', dispatch: 'Agent' },
      files,
      skills: [],
      subagents: [],
      guards: [],
      permissions: [],
      settings: [],
      registry: [],
      steps: [],
      prose: [],
      notes,
    };
    for (const file of files) {
      if (file.kind === 'settings') readSettings(file, estate);
      if (file.kind === 'skill') readSkill(file, estate);
      if (file.kind === 'subagent') readSubagent(file, estate);
      if (file.kind === 'registry') readRegistry(file, estate);
      if (file.kind === 'step_list') readSteps(file, estate);
      if (file.kind === 'standing' || file.kind === 'memory') {
        const count = file.text.replace(/\n+$/, '').split('\n').length;
        addProse(estate, file, 1, count);
      }
    }
    const scripts = new Set(estate.guards.flatMap((guard) => (guard.script ? [guard.script] : [])));
    for (const file of files) if (scripts.has(file.path)) file.kind = 'guard_script';
    return estate;
  }
}

async function present(root: string, names: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const name of names) {
    const info = await stat(join(root, name)).catch(() => undefined);
    if (info?.isFile()) found.push(name);
  }
  return found;
}

async function walk(root: string, folder: string, notes: ReadNote[]): Promise<string[]> {
  const entries = await readdir(join(root, folder), { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const path = posix.join(folder, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...(await walk(root, path, notes)));
    } else if (entry.isFile()) {
      const info = await stat(join(root, path));
      if (info.size > MAX_FILE_BYTES) notes.push({ file: path, message: 'skipped: larger than 1 MB' });
      else found.push(path);
    }
  }
  return found;
}

function classify(path: string, text: string): { kind: FileKind; owner?: string } {
  if (STANDING.has(path)) return { kind: 'standing' };
  if (SETTINGS.has(path)) return { kind: 'settings' };
  const parts = path.split('/');
  if (parts[1] === 'memory' && path.endsWith('.md')) return { kind: 'memory' };
  if (parts[1] === 'skills' && parts.length >= 4) {
    const owner = parts[2] ?? '';
    return parts.length === 4 && parts[3] === 'SKILL.md'
      ? { kind: 'skill', owner }
      : { kind: 'skill_file', owner };
  }
  if (parts[1] === 'agents' && parts.length === 3 && path.endsWith('.md')) return { kind: 'subagent' };
  if (/registry/i.test(basename(path)) && /\.(md|json)$/.test(path)) return { kind: 'registry' };
  if (path.endsWith('.json') && isStepList(text)) return { kind: 'step_list' };
  return { kind: 'other' };
}

function isStepList(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && Array.isArray(parsed.steps);
  } catch {
    return false;
  }
}

/** The passage at a character offset: its line, and the quote as given. */
function at(file: EstateFile, offset: number, quote: string): Located {
  const startLine = lineAt(file.text, offset);
  return { file: file.path, startLine, endLine: lineAt(file.text, offset + quote.length - 1), quote };
}

/** Finds a needle from a cursor and moves the cursor past it. */
function seek(file: EstateFile, needle: string, cursor: { at: number }): Located | undefined {
  const offset = file.text.indexOf(needle, cursor.at);
  if (offset < 0) return undefined;
  cursor.at = offset + needle.length;
  return at(file, offset, needle);
}

function seekPattern(file: EstateFile, pattern: RegExp, cursor: { at: number }): Located | undefined {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const search = new RegExp(pattern.source, flags);
  search.lastIndex = cursor.at;
  const match = search.exec(file.text);
  if (!match) return undefined;
  cursor.at = match.index + match[0].length;
  return at(file, match.index, match[0]);
}

function readSettings(file: EstateFile, estate: RawEstate): void {
  let json: unknown;
  try {
    json = JSON.parse(file.text);
  } catch (cause) {
    estate.notes.push({ file: file.path, message: `not JSON: ${String(cause)}` });
    return;
  }
  if (!isRecord(json)) return;

  for (const [key, value] of Object.entries(json)) {
    if (['hooks', 'permissions', 'env'].includes(key)) continue;
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
    const found = seekPattern(
      file,
      new RegExp(`"${escapeRegex(key)}"\\s*:\\s*${escapeRegex(JSON.stringify(value))}`),
      {
        at: 0,
      },
    );
    if (found) estate.settings.push({ key, value: String(value), at: found });
  }

  const permissions = isRecord(json.permissions) ? json.permissions : {};
  if (typeof permissions.defaultMode === 'string') {
    const found = seekPattern(
      file,
      new RegExp(`"defaultMode"\\s*:\\s*${escapeRegex(JSON.stringify(permissions.defaultMode))}`),
      { at: 0 },
    );
    if (found)
      estate.settings.push({ key: 'permissions.defaultMode', value: permissions.defaultMode, at: found });
  }
  for (const effect of ['allow', 'deny', 'ask'] as const) {
    const rules = permissions[effect];
    if (!Array.isArray(rules)) continue;
    const cursor = { at: file.text.search(new RegExp(`"${effect}"\\s*:`)) };
    if (cursor.at < 0) continue;
    for (const rule of rules) {
      if (typeof rule !== 'string') continue;
      const found = seek(file, JSON.stringify(rule), cursor);
      if (!found) continue;
      const match = /^([^(]+)(?:\((.*)\))?$/.exec(rule);
      const permission: PermissionDecl = { effect, rule, tool: (match?.[1] ?? rule).trim(), at: found };
      if (match?.[2] !== undefined) permission.pattern = match[2];
      estate.permissions.push(permission);
    }
  }

  if (isRecord(json.env)) {
    const cursor = { at: file.text.search(/"env"\s*:/) };
    for (const key of Object.keys(json.env)) {
      // The key only: an environment value may be a secret and never enters the map.
      const found = cursor.at >= 0 ? seek(file, JSON.stringify(key), cursor) : undefined;
      if (found) estate.settings.push({ key: `env.${key}`, at: found } satisfies SettingDecl);
    }
  }

  if (isRecord(json.hooks)) {
    const cursor = { at: file.text.search(/"hooks"\s*:/) };
    readGuards(json.hooks, 'estate', (command) => seek(file, JSON.stringify(command), cursor), estate, file);
  }
}

/** Reads a hooks mapping (event to matcher groups to commands), from the settings or a skill's frontmatter. */
function readGuards(
  hooks: Record<string, unknown>,
  scope: string,
  locate: (command: string) => Located | undefined,
  estate: RawEstate,
  file: EstateFile,
): void {
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
      const matcher = typeof group.matcher === 'string' && group.matcher !== '' ? group.matcher : undefined;
      for (const hook of group.hooks) {
        if (!isRecord(hook) || hook.type !== 'command' || typeof hook.command !== 'string') continue;
        const found = locate(hook.command);
        if (!found) {
          estate.notes.push({
            file: file.path,
            message: `cannot find the command of a ${event} guard in the file`,
          });
          continue;
        }
        const guard: GuardDecl = {
          event,
          command: hook.command,
          scope,
          at: found,
          ...scriptOf(hook.command),
        };
        if (matcher !== undefined) guard.matcher = matcher;
        if (typeof hook.timeout === 'number') guard.timeout = hook.timeout;
        estate.guards.push(guard);
      }
    }
  }
}

/** The script a command runs, relative to the root, and whether it is found from an anchor. */
export function scriptOf(command: string): { script?: string; anchored: boolean } {
  for (const raw of command.split(/\s+/)) {
    const token = raw.replace(/["']/g, '');
    if (token === '' || token.startsWith('-') || INTERPRETERS.has(token)) continue;
    if (!token.includes('/') && !SCRIPT_EXTENSION.test(token)) return { anchored: false };
    for (const anchor of ANCHORS) {
      if (anchor.test(token)) return { script: posix.normalize(token.replace(anchor, '')), anchored: true };
    }
    if (token.startsWith('/') || token.startsWith('~')) return { script: token, anchored: true };
    return { script: posix.normalize(token), anchored: false };
  }
  return { anchored: false };
}

function readSkill(file: EstateFile, estate: RawEstate): void {
  const frontmatter = readFrontmatter(file.text);
  if (frontmatter.error) estate.notes.push({ file: file.path, message: `frontmatter: ${frontmatter.error}` });
  const fields = frontmatter.fields;
  const name = typeof fields.name === 'string' ? fields.name : (file.owner ?? basename(file.path));
  const skill: SkillDecl = {
    name,
    file: file.path,
    folder: posix.dirname(file.path),
    at: nameAt(file, frontmatter, name),
    tools: listAt(file, frontmatter, 'allowed-tools', fields['allowed-tools']),
    fields: withoutHooks(fields),
    body: { startLine: frontmatter.bodyLine, endLine: lastLine(file.text) },
  };
  const description = valueAt(file, frontmatter, 'description', fields.description);
  if (description) skill.description = description;
  estate.skills.push(skill);
  if (isRecord(fields.hooks)) {
    const cursor = { at: 0 };
    readGuards(
      fields.hooks,
      name,
      (command) =>
        seek(file, command, cursor) ??
        seek(file, JSON.stringify(command), cursor) ??
        seekPattern(file, /command\s*:.*/, cursor),
      estate,
      file,
    );
  }
  addProse(estate, file, skill.body.startLine, skill.body.endLine);
}

function readSubagent(file: EstateFile, estate: RawEstate): void {
  const frontmatter = readFrontmatter(file.text);
  if (frontmatter.error) estate.notes.push({ file: file.path, message: `frontmatter: ${frontmatter.error}` });
  const fields = frontmatter.fields;
  const name = typeof fields.name === 'string' ? fields.name : basename(file.path, '.md');
  const subagent: SubagentDecl = {
    name,
    file: file.path,
    at: nameAt(file, frontmatter, name),
    tools: listAt(file, frontmatter, 'tools', fields.tools),
    skills: listAt(file, frontmatter, 'skills', fields.skills),
    fields,
    body: { startLine: frontmatter.bodyLine, endLine: lastLine(file.text) },
  };
  const description = valueAt(file, frontmatter, 'description', fields.description);
  if (description) subagent.description = description;
  const model = valueAt(file, frontmatter, 'model', fields.model);
  if (model) subagent.model = model;
  const effort = valueAt(file, frontmatter, 'effort', fields.effort);
  if (effort) subagent.effort = effort;
  estate.subagents.push(subagent);
  addProse(estate, file, subagent.body.startLine, subagent.body.endLine);
}

function readRegistry(file: EstateFile, estate: RawEstate): void {
  if (file.path.endsWith('.json')) {
    readJsonRegistry(file, estate);
    return;
  }
  for (const table of readTables(file.text)) {
    const column = (pattern: RegExp) => table.header.findIndex((cell) => pattern.test(cell));
    const id = column(/^id$/i);
    const guard = column(/^(guard|script|check|hook)s?$/i);
    const enforces = column(/^(enforces|rules?)$/i);
    if (guard < 0 || enforces < 0) continue;
    const event = column(/^event$/i);
    const verdict = column(/^(verdict|mode)$/i);
    for (const row of table.rows) {
      const name = strip(row.cells[guard] ?? '');
      if (name === '') continue;
      const entry: RegistryRow = {
        id: strip(row.cells[id] ?? '') || name,
        guard: name,
        enforces: parseEnforces(row.cells[enforces] ?? ''),
        at: { file: file.path, startLine: row.line, endLine: row.line, quote: row.text },
      };
      if (event >= 0 && row.cells[event]) entry.event = strip(row.cells[event] ?? '');
      if (verdict >= 0 && row.cells[verdict]) entry.verdict = strip(row.cells[verdict] ?? '');
      estate.registry.push(entry);
    }
  }
}

function readJsonRegistry(file: EstateFile, estate: RawEstate): void {
  let json: unknown;
  try {
    json = JSON.parse(file.text);
  } catch (cause) {
    estate.notes.push({ file: file.path, message: `not JSON: ${String(cause)}` });
    return;
  }
  const rows = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.checks) ? json.checks : [];
  const cursor = { at: 0 };
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== 'string') continue;
    const guard = [row.guard, row.script, row.check].find((value) => typeof value === 'string');
    if (typeof guard !== 'string') continue;
    const found = seekPattern(
      file,
      new RegExp(`"id"\\s*:\\s*${escapeRegex(JSON.stringify(row.id))}`),
      cursor,
    );
    if (!found) continue;
    const enforces = Array.isArray(row.enforces)
      ? row.enforces.filter((item) => typeof item === 'string')
      : [];
    const entry: RegistryRow = {
      id: row.id,
      guard,
      enforces: enforces.map((item) =>
        /^[A-Za-z]{1,3}\d{1,3}$/.test(item) ? { id: item } : { quote: item },
      ),
      at: found,
    };
    if (typeof row.event === 'string') entry.event = row.event;
    if (typeof row.verdict === 'string') entry.verdict = row.verdict;
    estate.registry.push(entry);
  }
}

/** `R3, R5` or `"a quoted rule"`: ids and quoted passages. */
function parseEnforces(cell: string): RegistryRow['enforces'] {
  const found: RegistryRow['enforces'] = [];
  for (const match of cell.matchAll(/"([^"]+)"|`([^`]+)`|\b([A-Za-z]{1,3}\d{1,3})\b/g)) {
    if (match[1] !== undefined) found.push({ quote: match[1] });
    else if (match[2] !== undefined) found.push({ quote: match[2] });
    else if (match[3] !== undefined) found.push({ id: match[3] });
  }
  return found;
}

function readSteps(file: EstateFile, estate: RawEstate): void {
  const json: unknown = JSON.parse(file.text);
  if (!isRecord(json) || !Array.isArray(json.steps)) return;
  const cursor = { at: 0 };
  for (const step of json.steps) {
    if (!isRecord(step) || typeof step.id !== 'string') continue;
    const found = seekPattern(
      file,
      new RegExp(`"id"\\s*:\\s*${escapeRegex(JSON.stringify(step.id))}`),
      cursor,
    );
    if (!found) continue;
    const line = linesOf(file.text)[found.startLine - 1]?.text ?? found.quote;
    const decl: StepDecl = {
      id: step.id,
      next: Array.isArray(step.next) ? step.next.filter((next) => typeof next === 'string') : [],
      anytime: step.anytime === true,
      at: { ...found, endLine: found.startLine, quote: line },
    };
    if (typeof step.title === 'string') decl.title = step.title;
    estate.steps.push(decl);
  }
}

function addProse(estate: RawEstate, file: EstateFile, startLine: number, endLine: number): void {
  const lines = file.text.split('\n').slice(startLine - 1, endLine);
  if (lines.every((line) => line.trim() === '')) return;
  const chunk: ProseChunk = { id: file.path, file: file.path, startLine, endLine, text: lines.join('\n') };
  estate.prose.push(chunk);
}

function nameAt(file: EstateFile, frontmatter: ReturnType<typeof readFrontmatter>, name: string): Located {
  const found = keyLine(file.text, 'name', frontmatter);
  if (found) return { file: file.path, startLine: found.line, endLine: found.line, quote: found.text };
  const first = linesOf(file.text).find((line) => line.text !== '');
  return {
    file: file.path,
    startLine: first?.line ?? 1,
    endLine: first?.line ?? 1,
    quote: first?.text || name,
  };
}

/** A scalar frontmatter field with its line; the quote is the value when the line holds it. */
function valueAt(
  file: EstateFile,
  frontmatter: ReturnType<typeof readFrontmatter>,
  key: string,
  value: unknown,
): Read<string> | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const found = keyLine(file.text, key, frontmatter);
  if (!found) return undefined;
  const quote = found.text.includes(value) ? value : found.text;
  return { value, at: { file: file.path, startLine: found.line, endLine: found.line, quote } };
}

/** A list field (`Read, Edit` or a YAML list), each item with the line it is on. */
function listAt(
  file: EstateFile,
  frontmatter: ReturnType<typeof readFrontmatter>,
  key: string,
  value: unknown,
): Array<Read<string>> {
  const items =
    typeof value === 'string'
      ? splitList(value)
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
  const found = keyLine(file.text, key, frontmatter);
  const end = frontmatter.endLine;
  if (!found || end === undefined) return [];
  const lines = linesOf(file.text).filter((line) => line.line >= found.line && line.line < end);
  return items.flatMap((item) => {
    const line = lines.find((candidate) => candidate.raw.includes(item));
    return line
      ? [{ value: item, at: { file: file.path, startLine: line.line, endLine: line.line, quote: item } }]
      : [];
  });
}

/** Splits `Read, Edit, Bash(python3 *)` on the commas outside parentheses. */
export function splitList(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
    } else current += char;
  }
  items.push(current.trim());
  return items.filter((item) => item !== '');
}

function withoutHooks(fields: Record<string, unknown>): Record<string, unknown> {
  const { hooks: _hooks, ...rest } = fields;
  return rest;
}

function lastLine(text: string): number {
  return text.replace(/\n+$/, '').split('\n').length;
}

function strip(cell: string): string {
  return cell.replace(/^[`*"]+|[`*"]+$/g, '').trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
