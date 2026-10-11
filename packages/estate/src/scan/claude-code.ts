import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, join, posix } from 'node:path';
import { guardName } from './code';
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
      if (file.kind === 'step_list') readSteps(file, estate);
      if (file.kind === 'standing' || file.kind === 'memory') {
        const count = file.text.replace(/\n+$/, '').split('\n').length;
        addProse(estate, file, 1, count);
      }
    }
    // The registry comes last: a row names its guard by a script, a check id or an id the script holds,
    // so every guard is known before a row is matched to one.
    for (const file of files) if (file.kind === 'registry') readRegistry(file, estate);
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

/**
 * Every file under a folder, sorted by name. A symbolic link is followed to what it points at, a file or a
 * folder, and read under the link's own path (the path the runtime loads it by). A link back to a folder
 * the walk is already inside is a cycle: it is skipped with a note, as is a link that points at nothing.
 */
async function walk(
  root: string,
  folder: string,
  notes: ReadNote[],
  ancestors: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const real = await realpath(join(root, folder)).catch(() => undefined);
  if (real === undefined) return [];
  if (ancestors.has(real)) {
    notes.push({ file: folder, message: 'skipped: a link back to a folder the walk is already inside' });
    return [];
  }
  const inside = new Set(ancestors).add(real);
  const entries = await readdir(join(root, folder), { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const path = posix.join(folder, entry.name);
    let folderEntry = entry.isDirectory();
    let fileEntry = entry.isFile();
    if (entry.isSymbolicLink()) {
      const target = await stat(join(root, path)).catch(() => undefined);
      if (!target) {
        notes.push({ file: path, message: 'skipped: a link that points at nothing' });
        continue;
      }
      folderEntry = target.isDirectory();
      fileEntry = target.isFile();
    }
    if (folderEntry) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...(await walk(root, path, notes, inside)));
    } else if (fileEntry) {
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

/** Header cells that name a registry table's columns. A table is a registry table by its first column. */
const COLUMNS = {
  id: /^(id|check id|code)$/i,
  guard: /^(guards?|scripts?|checks?|hooks?|adapters?|handlers?|runs?)$/i,
  enforces: /^(enforces|rules?)$/i,
  watches: /^(fires when|fires on|watches|watch|triggers?)$/i,
  event: /^events?$/i,
  verdict: /^(verdict|mode)$/i,
  state: /^(rollout|status|state)$/i,
} as const;

/** A row id: one token with a digit in it, such as `G6`, `AW4` or `check-12`. */
const ROW_ID = /^[A-Za-z][\w.#-]*\d[\w.#-]*$/;

/**
 * Reads every table of a markdown check registry whose first column holds ids: a header `Id`, or a first
 * cell that is one token with a digit in every row. The other columns are free text. A row names its guard
 * by (in this order) a guard the estate runs, named in any cell; a catalogue check with the row's id; a
 * guard script whose source holds the row's id; else the guard column as written; else the id. The rules
 * it enforces come from an `Enforces` column (ids and quoted passages) and from a `Fires when` or
 * `Watches` column (quoted passages and ids).
 */
function readRegistry(file: EstateFile, estate: RawEstate): void {
  if (file.path.endsWith('.json')) {
    readJsonRegistry(file, estate);
    return;
  }
  const known = knownGuards(estate);
  for (const table of readTables(file.text)) {
    const column = (pattern: RegExp, from = 0) =>
      table.header.findIndex((cell, index) => index >= from && pattern.test(cell));
    const firstIsId =
      COLUMNS.id.test(table.header[0] ?? '') ||
      (table.rows.length > 0 && table.rows.every((row) => ROW_ID.test(strip(row.cells[0] ?? ''))));
    const legacyGuard = column(COLUMNS.guard);
    const legacyEnforces = column(COLUMNS.enforces);
    if (!firstIsId && (legacyGuard < 0 || legacyEnforces < 0)) continue;
    const id = firstIsId ? 0 : column(COLUMNS.id);
    const guard = column(COLUMNS.guard, firstIsId ? 1 : 0);
    const enforces = column(COLUMNS.enforces);
    const watches = column(COLUMNS.watches);
    const event = column(COLUMNS.event);
    const verdict = column(COLUMNS.verdict);
    const state = column(COLUMNS.state);
    for (const row of table.rows) {
      const cell = (index: number) => (index >= 0 ? strip(row.cells[index] ?? '') : '');
      const rowId = cell(id) || cell(guard);
      if (rowId === '') continue;
      const others = row.cells.filter((_, index) => index !== id);
      const named = guardNamedIn(guard >= 0 ? [row.cells[guard] ?? '', ...others] : others, known);
      const links = [
        ...(enforces >= 0 ? parseEnforces(row.cells[enforces] ?? '') : []),
        ...(watches >= 0 ? parseWatches(row.cells[watches] ?? '', rowId) : []),
      ];
      const entry: RegistryRow = {
        id: rowId,
        guard:
          named ?? checkGuard(rowId, estate) ?? scriptHolding(rowId, estate, known) ?? (cell(guard) || rowId),
        enforces: links,
        at: { file: file.path, startLine: row.line, endLine: row.line, quote: row.text },
      };
      if (cell(event) !== '') entry.event = cell(event);
      if (cell(verdict) !== '') entry.verdict = cell(verdict);
      if (cell(state) !== '') entry.state = cell(state);
      estate.registry.push(entry);
    }
  }
}

/** The names the estate's guards go by: a script's file name, a check id. */
function knownGuards(estate: RawEstate): Set<string> {
  return new Set(estate.guards.map((guard) => guardName(guard)));
}

/** A known guard named in one of the cells: as a whole cell, a backticked token or a word of the cell. */
function guardNamedIn(cells: readonly string[], known: ReadonlySet<string>): string | undefined {
  for (const raw of cells) {
    const cell = strip(raw);
    const tokens = [cell, ...cell.split(/[\s,;|()]+/)].map((token) => strip(token)).filter(Boolean);
    for (const token of tokens) {
      if (known.has(token)) return token;
      const base = basename(token);
      if (base !== token && known.has(base)) return base;
    }
  }
  return undefined;
}

/** The catalogue check of the same id, when the estate has one. */
function checkGuard(id: string, estate: RawEstate): string | undefined {
  return estate.guards.find((guard) => guard.check?.id === id)?.check?.id;
}

/** The guard whose script source holds the id as a word: a check that lives inside a guard script. */
function scriptHolding(id: string, estate: RawEstate, known: ReadonlySet<string>): string | undefined {
  const word = new RegExp(`(^|[^\\w])${escapeRegex(id)}([^\\w]|$)`);
  for (const guard of estate.guards) {
    if (!guard.script) continue;
    const text = estate.files.find((file) => file.path === guard.script)?.text;
    const name = guardName(guard);
    if (text !== undefined && known.has(name) && word.test(text)) return name;
  }
  return undefined;
}

/** Free text that says when a check fires: the quoted passages it repeats, and rule ids other than its own. */
function parseWatches(cell: string, own: string): RegistryRow['enforces'] {
  const found: RegistryRow['enforces'] = [];
  for (const match of cell.matchAll(/"([^"]+)"|\u201c([^\u201d]+)\u201d|\b([A-Z]{1,3}\d{1,3})\b/g)) {
    const quote = match[1] ?? match[2];
    if (quote !== undefined) found.push({ quote });
    else if (match[3] !== undefined && match[3] !== own) found.push({ id: match[3] });
  }
  return found;
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
