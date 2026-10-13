import { basename, posix } from 'node:path';
import type { Atom, AtomKind, EvidencePredicate } from '../schema';
import type { EstateFile, GuardDecl, ProseChunk, RawEstate, RegistryRow } from './reader';
import {
  blankFences,
  type Located,
  linesOf,
  provenanceHash,
  readFrontmatter,
  readTables,
  slug,
} from './text';

/**
 * The code half of the scan: every atom whose source has structure. Skills, helpers, guards, permissions,
 * settings and stages come from the reader's declarations; references, scripts, routing table rows,
 * fixed-form gates ("Before X: Read Y" and its equivalents) and passages that address a runtime hazard come
 * from patterns over the prose. Code atoms are approved as read: their quote is the file's own structure.
 */

/** The role code proposes per kind: axis kinds become cells of the plan, detail kinds vary inside a cell. */
export const DEFAULT_ROLE: Record<AtomKind, 'axis' | 'detail'> = {
  instruction: 'axis',
  gate: 'axis',
  route: 'axis',
  skill: 'axis',
  reference: 'detail',
  script: 'detail',
  subagent: 'axis',
  guard: 'axis',
  tool: 'detail',
  setting: 'detail',
  stage: 'axis',
  register: 'axis',
  hazard: 'detail',
  invariant: 'detail',
};

/** Hazards of a long-running agent, found in prose by the words that name them. */
export const HAZARDS = [
  // The noun and the participle; "compact" alone is an adjective (a compact table) far more often.
  {
    id: 'compaction',
    title: 'A compaction of the context',
    pattern:
      /\b(compactions?|compacted|auto-?compact)\b|\b(?:conversation|context) is summari[sz]ed\b|\bcontext window (?:fills? up|is full)\b/i,
  },
  { id: 'restart', title: 'A process restart', pattern: /\b(?:restart|reboot)(s|ed)?\b/i },
  {
    id: 'rate_wave',
    title: 'A wave of rate limits',
    // A 429 is a rate limit only where it is a status: after a word that answers, returns or names a code.
    pattern:
      /\brate[- ]limit|\b(?:HTTP|status|code|error)\s+429\b|\b(?:answers?|returns?|responds?(?: with)?|gets?|got|hits?)\s+(?:an?\s+)?429\b|\b429\s+(?:error|response|status|too many)/i,
  },
  {
    id: 'session_boundary',
    title: 'A new session',
    pattern:
      /\b(start of (every|each|a) session|new session|session start)|\bsession\s+(?:is\s+|was\s+|gets\s+)?resumed\b|\bresum(?:e|es|ed|ing)\s+(?:a|the)\s+session\b/i,
  },
  { id: 'notification', title: 'A helper notification', pattern: /\bnotification/i },
  {
    id: 'nudge_storm',
    title: 'Repeated guard nudges',
    // The noun, not the verb: "nudges repeat", "a guard nudge"; "nudge the price" moves a value.
    pattern:
      /\bnudges\b|\b(?:a|the|each|every|one|same|guard|hook)\s+nudge\b|\bnudge\s+(?:storm|wave|burst)s?\b/i,
  },
] as const;

/** Extensions a named file needs to count as a reference when it does not exist. */
const DOCUMENT = /\.(md|markdown|txt|json|ya?ml|csv|tsv|html|py|sh|js|mjs|ts)$/i;
const SCRIPT = /\.(sh|bash|py|js|mjs|cjs|ts|rb|pl)$/i;

/** Builds atoms with stable, unique ids: kind, scope and a slug of the title, then -2, -3 on a repeat. */
export class AtomBuilder {
  readonly atoms: Atom[] = [];
  private readonly ids = new Set<string>();

  constructor(private readonly files: ReadonlyMap<string, EstateFile>) {}

  scopeOf(path: string): string {
    const file = this.files.get(path);
    if (!file) return slug(path, 8);
    switch (file.kind) {
      case 'standing':
        return path === 'CLAUDE.md' || path.endsWith('/CLAUDE.md') ? 'standing' : slug(path, 8);
      case 'memory':
        return `memory-${slug(basename(path).replace(/\.md$/, ''), 4)}`;
      case 'skill':
      case 'skill_file':
        return slug(file.owner ?? path, 6);
      case 'subagent':
        return slug(basename(path).replace(/\.md$/, ''), 6);
      case 'settings':
        return 'settings';
      case 'registry':
        return 'registry';
      case 'step_list':
        return 'steps';
      default:
        return slug(path, 8);
    }
  }

  add(atom: {
    kind: AtomKind;
    title: string;
    at: Located;
    evidence: EvidencePredicate[];
    producedBy?: 'code' | 'model';
    situation?: string;
    fields?: Record<string, unknown>;
    approved?: boolean;
  }): Atom {
    const base = `${atom.kind}.${this.scopeOf(atom.at.file)}.${slug(atom.title)}`;
    let id = base;
    for (let count = 2; this.ids.has(id); count++) id = `${base}-${count}`;
    this.ids.add(id);
    const producedBy = atom.producedBy ?? 'code';
    const built: Atom = {
      id,
      kind: atom.kind,
      title: atom.title,
      provenance: { ...atom.at, hash: provenanceHash(atom.at) },
      producedBy,
      role: DEFAULT_ROLE[atom.kind],
      approved: atom.approved ?? producedBy === 'code',
      ...(atom.situation ? { situation: atom.situation } : {}),
      evidence: atom.evidence,
      enforcement: [],
      ...(atom.fields ? { fields: atom.fields } : {}),
    };
    this.atoms.push(built);
    return built;
  }
}

/** The name a trace gives a guard: a catalogue check's id, else its script's file name, else a slug of its command. */
export function guardName(guard: Pick<GuardDecl, 'script' | 'command' | 'check'>): string {
  if (guard.check) return guard.check.id;
  return guard.script ? basename(guard.script) : slug(guard.command, 8);
}

/** Every registry row that names a guard, matched on the guard's name, in registry order. */
export function registryRowsOf(guard: GuardDecl, registry: readonly RegistryRow[]): RegistryRow[] {
  const name = guardName(guard);
  return registry.filter((row) => basename(row.guard) === name);
}

/**
 * The registry row of a guard. When several rows name the guard (one guard script runs several checks),
 * one row stands for them all: the first row's id, event, verdict and place, the first state written, and
 * the rules every row enforces.
 */
export function registryRowOf(guard: GuardDecl, registry: readonly RegistryRow[]): RegistryRow | undefined {
  const rows = registryRowsOf(guard, registry);
  const [first, ...rest] = rows;
  if (!first || rest.length === 0) return first;
  const state = rows.find((row) => row.state !== undefined)?.state;
  return {
    ...first,
    enforces: rows.flatMap((row) => row.enforces),
    ...(state !== undefined ? { state } : {}),
  };
}

/** Every atom code reads, in a fixed order, so ids are the same on every run. */
export function codeAtoms(raw: RawEstate, builder: AtomBuilder): void {
  const files = new Map(raw.files.map((file) => [file.path, file]));
  const { labels } = raw;
  const dispatch = (name: string): EvidencePredicate => ({
    type: 'tool_called',
    label: labels.dispatch,
    input: { subagent_type: name },
  });

  for (const skill of raw.skills) {
    builder.add({
      kind: 'skill',
      title: `Skill ${skill.name}`,
      at: skill.at,
      evidence: [{ type: 'skill_loaded', name: skill.name }],
      fields: {
        name: skill.name,
        folder: skill.folder,
        tools: skill.tools.map((tool) => tool.value),
        ...(skill.description ? { description: skill.description.value } : {}),
      },
    });
    if (skill.description) {
      builder.add({
        kind: 'route',
        title: `An ask that fits ${skill.name} loads it`,
        at: skill.description.at,
        evidence: [{ type: 'skill_loaded', name: skill.name }],
        situation: skill.description.value,
        fields: { target: skill.name, targetKind: 'skill', via: 'description' },
      });
    }
  }

  for (const helper of raw.subagents) {
    builder.add({
      kind: 'subagent',
      title: `Helper ${helper.name}`,
      at: helper.at,
      evidence: [dispatch(helper.name)],
      fields: {
        name: helper.name,
        tools: helper.tools.map((tool) => tool.value),
        skills: helper.skills.map((skill) => skill.value),
        ...(helper.model ? { model: helper.model.value } : {}),
        ...(helper.effort ? { effort: helper.effort.value } : {}),
        ...(helper.description ? { description: helper.description.value } : {}),
      },
    });
    if (helper.description) {
      builder.add({
        kind: 'route',
        title: `An ask that fits ${helper.name} dispatches it`,
        at: helper.description.at,
        evidence: [dispatch(helper.name)],
        situation: helper.description.value,
        fields: { target: helper.name, targetKind: 'subagent', via: 'description' },
      });
    }
  }

  for (const guard of raw.guards) {
    const name = guardName(guard);
    const row = registryRowOf(guard, raw.registry);
    const rows = registryRowsOf(guard, raw.registry).filter((entry) => entry.origin !== 'catalogue');
    builder.add({
      kind: 'guard',
      title: `${guard.event}${guard.matcher ? ` ${guard.matcher}` : ''} guard ${name}`,
      at: guard.at,
      evidence: [{ type: 'guard', name, ...(row?.verdict ? { verdict: row.verdict } : {}) }],
      fields: {
        name,
        event: guard.event,
        command: guard.command,
        anchored: guard.anchored,
        scope: guard.scope,
        ...(guard.matcher ? { matcher: guard.matcher } : {}),
        ...(guard.script ? { script: guard.script, scriptExists: files.has(guard.script) } : {}),
        ...(guard.dispatcher ? { dispatcher: guard.dispatcher } : {}),
        ...(guard.timeout !== undefined ? { timeout: guard.timeout } : {}),
        ...(guard.type !== undefined ? { type: guard.type } : {}),
        ...(row ? { registry: row.id } : {}),
        ...(rows.length > 1 ? { registryRows: rows.map((entry) => entry.id) } : {}),
        ...(row?.state !== undefined ? { state: row.state } : {}),
        ...(guard.check
          ? {
              check: guard.check.id,
              ...(guard.check.kind !== undefined ? { checkKind: guard.check.kind } : {}),
              ...(guard.check.state !== undefined ? { state: guard.check.state } : {}),
              ...(guard.check.work !== undefined ? { work: guard.check.work } : {}),
              ...(guard.check.steps.length > 0 ? { steps: guard.check.steps } : {}),
              ...(guard.check.trigger && guard.check.trigger.length > 0
                ? { trigger: guard.check.trigger }
                : {}),
              ...(guard.check.host !== undefined ? { host: guard.check.host } : {}),
            }
          : {}),
      },
    });
  }

  const bare = new Set<string>();
  for (const permission of raw.permissions) {
    if (permission.pattern === undefined) bare.add(permission.tool);
    const evidence: EvidencePredicate =
      permission.effect === 'deny' && permission.pattern === undefined
        ? { type: 'tool_not_called', label: permission.tool }
        : {
            type: 'custom',
            name: 'permission',
            options: { effect: permission.effect, rule: permission.rule },
          };
    builder.add({
      kind: 'tool',
      title: `${capital(permission.effect)} ${permission.rule}`,
      at: permission.at,
      evidence: [evidence],
      fields: {
        tool: permission.tool,
        effect: permission.effect,
        rule: permission.rule,
        ...(permission.pattern !== undefined ? { pattern: permission.pattern } : {}),
      },
    });
  }
  const declared = [...raw.skills, ...raw.subagents].flatMap((unit) => unit.tools);
  for (const tool of declared) {
    const name = toolBase(tool.value);
    if (bare.has(name)) continue;
    bare.add(name);
    builder.add({
      kind: 'tool',
      title: `Declared ${name}`,
      at: tool.at,
      evidence: [{ type: 'custom', name: 'permission', options: { effect: 'declared', rule: name } }],
      fields: { tool: name, effect: 'declared', rule: name },
    });
  }

  for (const setting of raw.settings) {
    builder.add({
      kind: 'setting',
      title: `Setting ${setting.key}${setting.value !== undefined ? ` is ${setting.value}` : ''}`,
      at: setting.at,
      evidence: [
        {
          type: 'custom',
          name: 'run_config',
          options: { key: setting.key, ...(setting.value !== undefined ? { value: setting.value } : {}) },
        },
      ],
      fields: { key: setting.key, ...(setting.value !== undefined ? { value: setting.value } : {}) },
    });
  }

  for (const step of raw.steps) {
    builder.add({
      kind: 'stage',
      title: `Stage ${step.id}${step.title ? `: ${step.title}` : ''}`,
      at: step.at,
      evidence: [{ type: 'stage_reached', name: step.id }],
      fields: {
        id: step.id,
        next: step.next,
        anytime: step.anytime,
        ...(step.process !== undefined ? { process: step.process } : {}),
      },
    });
  }

  for (const skill of raw.skills) scriptAtoms(skill.name, skill.folder, skill.file, raw, files, builder);

  const names = {
    skills: new Set(raw.skills.map((skill) => skill.name)),
    subagents: new Set(raw.subagents.map((helper) => helper.name)),
  };
  for (const chunk of raw.prose) {
    referenceAtoms(chunk, files, raw, builder);
    routeAtoms(chunk, files, names, raw, builder);
    gateAtoms(chunk, files, raw, builder);
    hazardAtoms(chunk, files, builder);
  }
}

/** One script atom per script file of a skill, anchored where the skill body names it, else in the script. */
function scriptAtoms(
  skill: string,
  folder: string,
  definition: string,
  raw: RawEstate,
  files: ReadonlyMap<string, EstateFile>,
  builder: AtomBuilder,
): void {
  // A long body may be cut into several chunks: the mention is looked for in each, in order.
  const body = raw.prose
    .filter((chunk) => chunk.file === definition)
    .flatMap((chunk) => chunkLines(chunk, files.get(definition)));
  for (const file of raw.files) {
    if (file.kind !== 'skill_file' || file.owner !== skill) continue;
    const relative = posix.relative(folder, file.path);
    if (!SCRIPT.test(file.path) && !relative.startsWith('scripts/')) continue;
    const name = basename(file.path);
    // The line that names the script best: by its path from the skill, then by its name in backticks, then
    // any mention of its name.
    const mention =
      body.find((line) => line.text.includes(relative)) ??
      body.find((line) => new RegExp(`\`[^\`]*\\b${escapeRegExp(name)}[^\`]*\``).test(line.text)) ??
      body.find((line) => line.text.includes(name));
    const at: Located = mention
      ? { file: definition, startLine: mention.line, endLine: mention.line, quote: mention.quote }
      : firstLine(file);
    builder.add({
      kind: 'script',
      title: `Script ${relative}`,
      at,
      evidence: [{ type: 'tool_called', label: raw.labels.shell, input: { command: { contains: name } } }],
      fields: { path: file.path, skill, named: mention !== undefined },
    });
  }
}

/** Paths a line names: relative file names, literal quotes, markdown link destinations and wiki links. */
export function namedPaths(line: string): string[] {
  const found: string[] = [];
  const claimed: Array<[number, number]> = [];
  // A section anchor or a query names the same file; a web address is no path. A path may be written with
  // backslashes, from the project folder variable, or with a line (and column) after it: the same file.
  const bare = (path: string) => {
    let clean = path.replace(/[#?].*$/, '');
    if (!/\s/.test(clean) && clean.includes('\\')) clean = clean.replace(/\\+/g, '/');
    clean = clean.replace(/^\$\{?CLAUDE_PROJECT_DIR\}?\//, '');
    return clean.replace(/(\.[A-Za-z][A-Za-z0-9]*):\d+(?::\d+)?$/, '$1');
  };
  // A wiki link names a markdown file without its extension: [[references/guide]], [[guide|the guide]].
  for (const match of line.matchAll(/\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]/g)) {
    claimed.push([match.index, match.index + match[0].length]);
    const target = match[1]?.trim();
    if (target && !/^[a-z]+:/i.test(target))
      found.push(/\.[A-Za-z0-9]+$/.test(target) ? bare(target) : `${bare(target)}.md`);
  }
  for (const match of line.matchAll(/`([^`\n]+)`/g)) {
    if (claimed.some(([start, end]) => match.index >= start && match.index < end)) continue;
    claimed.push([match.index, match.index + match[0].length]);
    const token = match[1]?.trim();
    // A quoted shell command is an example, not one file name. Spaces within a file name stay.
    const execution = /\b(?:run|execute)(?: the command)?\s*$|\bexample:\s*$/i.test(
      line.slice(0, match.index),
    );
    if (
      token &&
      !/^[a-z]+:\/\//i.test(token) &&
      !/[|;&]/.test(token) &&
      !/\s--?\w/.test(token) &&
      !(execution && /\s/.test(token))
    )
      found.push(bare(token));
  }
  for (const match of line.matchAll(/\]\((?:<([^>\n]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
    let start = match.index;
    let depth = 0;
    for (let index = match.index; index >= 0; index -= 1) {
      const char = line[index];
      if (char !== '[' && char !== ']') continue;
      let slashes = 0;
      for (let before = index - 1; before >= 0 && line[before] === '\\'; before -= 1) slashes += 1;
      if (slashes % 2 !== 0) continue;
      depth += char === ']' ? 1 : -1;
      if (depth === 0) {
        start = index;
        break;
      }
    }
    claimed.push([start, match.index + match[0].length]);
    const target = match[1] ?? match[2];
    if (target && !/^[a-z]+:/i.test(target)) found.push(bare(target));
  }
  for (const match of line.matchAll(/"([^"\n]+)"|'([^'\n]+)'/g)) {
    if (claimed.some(([start, end]) => match.index >= start && match.index < end)) continue;
    claimed.push([match.index, match.index + match[0].length]);
    const token = (match[1] ?? match[2])?.trim();
    const execution = /\b(?:run|execute)(?: the command)?\s*$|\bexample:\s*$/i.test(
      line.slice(0, match.index),
    );
    if (
      token &&
      !/^[a-z]+:/i.test(token) &&
      !/[|;&]/.test(token) &&
      !/\s--?\w/.test(token) &&
      !(execution && /\s/.test(token))
    )
      found.push(bare(token));
  }
  for (const match of line.matchAll(/(?<![\w./\\:])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z][A-Za-z0-9]*)/g)) {
    if (claimed.some(([start, end]) => match.index >= start && match.index < end)) continue;
    const prefix = line.slice(0, match.index);
    if (/\b(?:run|execute)(?: the command)?\s+\S+\s+[^.;!?]*$|\bexample:\s*[^.;!?]*$/i.test(prefix)) continue;
    const token = match[1];
    if (token && !found.includes(token)) found.push(token);
  }
  return found.filter((path) => !/[<>*?{}$]/.test(path) && /\.[A-Za-z0-9]+$/.test(path));
}

/** Whether at least one mention requires the act, rather than forbidding it in its own clause. */
export function positiveMention(
  text: string,
  name: string,
  verbs: readonly string[],
  bareNever = false,
): boolean {
  if (name === '') return false;
  const forbidden = new RegExp(
    `\\b(?:never|do not|don['’]t|must not|should not)\\s+(?:${verbs.join('|')})\\b[^.;!?]*$`,
    'i',
  );
  let offset = text.indexOf(name);
  while (offset >= 0) {
    const prefix =
      text
        .slice(0, offset)
        .split(/[\n;!?]|\.(?=\s|$)|\b(?:but|until|instead)\b/i)
        .at(-1) ?? '';
    if (!forbidden.test(prefix) && !(bareNever && /\bnever\s*[`*]*$/i.test(prefix))) return true;
    offset = text.indexOf(name, offset + name.length);
  }
  return false;
}

/**
 * A path a file names, relative to the root. It is tried, in order, from the naming file's folder, from the
 * root, then from each base folder the runtime declares; the first that names a file of the estate (or a file
 * the reader skipped on purpose, in `skipped`) wins. When none does, the path stays as the naming file's
 * folder gives it (from the root when it starts with `.claude/`), so the finding names where it was looked
 * for.
 */
export function resolveNamed(
  path: string,
  from: string,
  files: ReadonlyMap<string, EstateFile>,
  bases: readonly string[] = [],
  skipped: ReadonlySet<string> = new Set(),
): string {
  const clean = path.replace(/^\.\//, '');
  const candidates = [
    posix.join(posix.dirname(from), clean),
    clean,
    ...bases.map((base) => posix.join(base, clean)),
  ].map((candidate) => posix.normalize(candidate));
  const hit = candidates.find((candidate) => files.has(candidate) || skipped.has(candidate));
  if (hit !== undefined) return hit;
  if (clean.startsWith('.claude/')) return posix.normalize(clean);
  return candidates[0] as string;
}

/** Where a named path leads: one file, several candidates, or nowhere; and how it was found. */
export type NamedTarget = {
  path: string;
  via: 'place' | 'alias' | 'suffix' | 'external' | 'none';
  candidates?: string[];
};

/**
 * True when a path as written points outside the estate: it starts with `~/` or `/`, or it starts with one
 * of the external folders. Only the written form decides; a name is never guessed external.
 */
export function isExternal(path: string, externals: readonly string[] = []): boolean {
  const clean = path.replace(/^\.\//, '');
  if (clean.startsWith('~/') || clean.startsWith('/')) return true;
  return externals.some((root) => clean.startsWith(root.endsWith('/') ? root : `${root}/`));
}

/**
 * A bare name tries its exact local folder, then its local subtree, before the estate root. Other
 * named paths resolve as `resolveNamed` does, then through the estate's aliases (`REF/a.md` as
 * `<folder>/a.md`), then by its ending: the longest tail of the path (its last segments, down to the bare
 * file name) that ends any file of the estate decides. One file: the path resolves to it. Several: the
 * reference is ambiguous and lists them.
 */
export function locateNamed(
  path: string,
  from: string,
  files: ReadonlyMap<string, EstateFile>,
  options: {
    bases?: readonly string[];
    skipped?: ReadonlySet<string>;
    aliases?: Readonly<Record<string, readonly string[]>>;
    byName?: ReadonlyMap<string, readonly string[]>;
    externals?: readonly string[];
  } = {},
): NamedTarget {
  const skipped = options.skipped ?? new Set<string>();
  const known = (candidate: string) => files.has(candidate) || skipped.has(candidate);
  const clean = path.replace(/^\.\//, '');
  const byName = options.byName ?? fileNames(files);
  // A bare name belongs to the naming file's own folder and subtree before the estate root.
  if (!clean.includes('/')) {
    const local = posix.normalize(posix.join(posix.dirname(from), clean));
    if (known(local)) return { path: local, via: 'place' };
    const folder = posix.dirname(from);
    if (folder !== '.') {
      const hits = (byName.get(clean) ?? []).filter((candidate) => candidate.startsWith(`${folder}/`));
      if (hits.length === 1) return { path: hits[0] as string, via: 'suffix' };
      if (hits.length > 1) return { path: local, via: 'none', candidates: [...hits].sort() };
    }
  }
  const placed = resolveNamed(path, from, files, options.bases ?? [], skipped);
  if (known(placed)) return { path: placed, via: 'place' };
  // A path written as outside the estate is not looked for by its ending: it names the outside, as written.
  if (isExternal(clean, options.externals ?? [])) return { path: clean, via: 'external' };
  const [head, ...rest] = clean.split('/');
  const folders = head !== undefined && rest.length > 0 ? (options.aliases?.[head] ?? []) : [];
  for (const folder of folders) {
    const candidate = posix.normalize(posix.join(folder, ...rest));
    if (known(candidate)) return { path: candidate, via: 'alias' };
  }
  // The ending is looked for among the estate's own files: a skipped file (node_modules, a test fixture)
  // is found only by its place, never as a candidate for a name.
  const segments = clean
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');
  const named = byName.get(segments[segments.length - 1] ?? '') ?? [];
  for (let start = 0; start < segments.length; start++) {
    const tail = segments.slice(start).join('/');
    const hits = named.filter((candidate) => candidate === tail || candidate.endsWith(`/${tail}`));
    if (hits.length === 1) return { path: hits[0] as string, via: 'suffix' };
    if (hits.length > 1) return { path: placed, via: 'none', candidates: [...hits].sort() };
  }
  return { path: placed, via: 'none' };
}

/** Every file of the estate (and every skipped file) by its file name. */
export function fileNames(
  files: ReadonlyMap<string, EstateFile>,
  skipped: ReadonlySet<string> = new Set(),
): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const path of [...files.keys(), ...skipped]) {
    const name = basename(path);
    byName.set(name, [...(byName.get(name) ?? []), path]);
  }
  return byName;
}

/** The file-name index of an estate, built once per estate read. */
const NAME_INDEX = new WeakMap<RawEstate, Map<string, string[]>>();
function names(raw: RawEstate, files: ReadonlyMap<string, EstateFile>): Map<string, string[]> {
  const cached = NAME_INDEX.get(raw);
  if (cached) return cached;
  const built = fileNames(files);
  NAME_INDEX.set(raw, built);
  return built;
}

/** The heading of a section of change notes. */
const CHANGE_HEADING =
  /^(?:changes|changelog|change log|history|version history|release notes|what changed)\b/i;
/** A line saying what was done to a file: removed, deleted, renamed, replaced, retired, dropped, moved. */
const CHANGE_DONE =
  /\b(?:was|were|has been|have been)\s+(?:removed|deleted|renamed|replaced|retired|dropped|moved)\b|\b(?:removed|deleted|renamed|replaced|retired|dropped)\s+(?:the\s+(?:file\s+)?)?`/i;

function referenceAtoms(
  chunk: ProseChunk,
  files: ReadonlyMap<string, EstateFile>,
  raw: RawEstate,
  builder: AtomBuilder,
): void {
  const skipped = new Set(raw.ignored?.paths ?? []);
  let notes = false;
  for (const line of chunkLines(chunk, files.get(chunk.file))) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line.text);
    if (heading) notes = CHANGE_HEADING.test(heading[1] ?? '');
    // A change note says what happened to a file; it asks for no read.
    if (notes || CHANGE_DONE.test(line.text)) continue;
    for (const named of namedPaths(line.text)) {
      // A path written in another form (backslashes, a wiki link) is looked for by its file name's stem.
      const written = line.text.includes(named) ? named : basename(named).replace(/\.[A-Za-z0-9]+$/, '');
      if (!positiveMention(line.text, written, ['read', 'open', 'load'])) continue;
      const located = locateNamed(named, chunk.file, files, {
        bases: raw.bases ?? [],
        skipped,
        aliases: raw.aliases ?? {},
        byName: names(raw, files),
        externals: raw.externals ?? [],
      });
      const path = located.path;
      const target = files.get(path);
      const isSkipped = target === undefined && skipped.has(path);
      if (!target && !isSkipped && !DOCUMENT.test(path)) continue;
      if (target && (target.kind === 'guard_script' || SCRIPT.test(path))) continue;
      // A routing row that links to a skill's or a helper's file routes to it; it asks for no read.
      if (target && (target.kind === 'skill' || target.kind === 'subagent') && line.text.startsWith('|'))
        continue;
      builder.add({
        kind: 'reference',
        title: `Read ${named}`,
        at: { file: chunk.file, startLine: line.line, endLine: line.line, quote: line.quote },
        evidence: [{ type: 'tool_called', label: raw.labels.read, input: { file_path: { contains: path } } }],
        situation: line.text,
        fields: {
          path,
          exists: target !== undefined || isSkipped,
          readWhen: line.text,
          from: chunk.file,
          ...(isSkipped ? { ignored: true } : {}),
          ...(located.via === 'alias' || located.via === 'suffix' ? { resolvedBy: located.via } : {}),
          ...(located.candidates ? { candidates: located.candidates } : {}),
          ...(located.via === 'external' ? { external: true } : {}),
        },
      });
    }
  }
}

/** A routing table's ask column, by its header. */
const ASK_HEADER = /\b(?:when|wants?|asks?|if|situation|trigger)\b/i;
/** A first column of people: such a table says who keeps a skill, not when to load it. */
const PEOPLE_HEADER = /^(?:owners?|maintainers?|authors?|people|persons?|who|teams?|contacts?|reviewers?)\b/i;

function routeAtoms(
  chunk: ProseChunk,
  files: ReadonlyMap<string, EstateFile>,
  names: { skills: Set<string>; subagents: Set<string> },
  raw: RawEstate,
  builder: AtomBuilder,
): void {
  const file = files.get(chunk.file);
  if (!file) return;
  for (const table of readTables(file.text, chunk.startLine, chunk.endLine)) {
    const header = table.header.map((cell) => cell.replace(/[`*]/g, '').trim());
    // The ask sits in the column whose header says when (`When the user wants to`, `Use when`), else the
    // first. A table whose first column names people (owners, maintainers) routes nothing.
    const named = header.findIndex((cell) => ASK_HEADER.test(cell));
    if (named < 0 && PEOPLE_HEADER.test(header[0] ?? '')) continue;
    const askAt = Math.max(0, named);
    for (const row of table.rows) {
      const ask = row.cells[askAt]?.replace(/[`*]/g, '').trim() ?? '';
      for (const cell of row.cells.filter((_, index) => index !== askAt)) {
        // A target and the words it is written with in the cell, to check the cell does not negate it.
        const written = new Map<string, string>();
        for (const match of cell.matchAll(/`\/?([^`]+)`/g)) written.set(match[1] ?? '', match[1] ?? '');
        const plain = cell.replace(/[`*]/g, '').trim();
        if (names.skills.has(plain) || names.subagents.has(plain)) written.set(plain, plain);
        const helper = /^(?:the )?(.+) agent$/.exec(plain)?.[1];
        if (helper && names.subagents.has(helper)) written.set(helper, helper);
        // A link to a skill's or a helper's own file names that skill or helper.
        let linkedHelper: string | undefined;
        for (const match of cell.matchAll(/\[([^\]\n]*)\]\(([^)\s]+)\)/g)) {
          const unit = unitOfFile(resolveNamed(match[2] ?? '', chunk.file, files, raw.bases ?? []), raw);
          if (!unit) continue;
          written.set(unit.name, match[0]);
          if (unit.kind === 'subagent') linkedHelper = unit.name;
        }
        for (const [target, mention] of written) {
          if (!positiveMention(cell, mention, ['load', 'dispatch', 'call'], true)) continue;
          const asHelper = (target === helper || target === linkedHelper) && names.subagents.has(target);
          const isSkill = !asHelper && names.skills.has(target);
          if (!isSkill && !names.subagents.has(target)) continue;
          builder.add({
            kind: 'route',
            title: `An ask to ${ask} ${isSkill ? 'loads' : 'dispatches'} ${target}`,
            at: { file: chunk.file, startLine: row.line, endLine: row.line, quote: row.text },
            evidence: [
              isSkill
                ? { type: 'skill_loaded', name: target }
                : { type: 'tool_called', label: raw.labels.dispatch, input: { subagent_type: target } },
            ],
            situation: ask,
            fields: { target, targetKind: isSkill ? 'skill' : 'subagent', via: 'table', ask },
          });
        }
      }
    }
  }
}

/** The skill or helper whose definition file a path is. */
function unitOfFile(path: string, raw: RawEstate): { name: string; kind: 'skill' | 'subagent' } | undefined {
  const skill = raw.skills.find((unit) => unit.file === path);
  if (skill) return { name: skill.name, kind: 'skill' };
  const helper = raw.subagents.find((unit) => unit.file === path);
  return helper ? { name: helper.name, kind: 'subagent' } : undefined;
}

/** What a gate names to read: a backticked or double-quoted name, a markdown link, or one word. */
const TARGET = '(`[^`]+`|"[^"\\n]+"|\\[[^\\]\\n]*\\]\\([^)\\s]+\\)|\\S+)';
/** A quoted target only: the forms beyond the first four take no bare word, so prose never reads as a gate. */
const QUOTED = '(`[^`]+`|"[^"\\n]+"|\\[[^\\]\\n]*\\]\\([^)\\s]+\\))';
/** Where a sentence starts: the line start (after a list marker) or after a stop. */
const START = '(?:^|[.;!?]\\s+)(?:[-*]\\s+)?';

/**
 * The fixed forms of a gate, each giving the thing to read first and the act it comes before. The first four
 * are the documented forms; the others say the same order in other words.
 */
const GATE_FORMS: Array<{ form: string; pattern: RegExp; read: number; act: number }> = [
  {
    form: 'before-colon-read',
    pattern: new RegExp(`\\bbefore ([^:;]+?):\\s*read\\s+${TARGET}`, 'i'),
    read: 2,
    act: 1,
  },
  {
    form: 'before-comma-read',
    pattern: new RegExp(`\\bbefore ([^,:;]+?),\\s*read\\s+${QUOTED}`, 'i'),
    read: 2,
    act: 1,
  },
  {
    form: 'read-before',
    pattern: new RegExp(`\\bread\\s+${QUOTED}\\s+before\\s+([^.;!]+)`, 'i'),
    read: 1,
    act: 2,
  },
  {
    form: 'not-until-read',
    pattern: /\bdo not ([^.;]+?) until you have read (?:the output of )?(`[^`]+`|[^.;]+)/i,
    read: 2,
    act: 1,
  },
  {
    form: 'read-first-then',
    pattern: new RegExp(`\\bread\\s+${QUOTED}\\s+first,?\\s+then\\s+([^.;!?]+)`, 'i'),
    read: 1,
    act: 2,
  },
  {
    form: 'never-without-reading',
    pattern: new RegExp(
      `\\b(?:never|do not|don't)\\s+([^.;!?]+?)\\s+without\\s+(?:first\\s+)?reading\\s+${QUOTED}`,
      'i',
    ),
    read: 2,
    act: 1,
  },
  {
    form: 'only-after-reading',
    pattern: new RegExp(
      `${START}([^.;!?]+?)\\s+only\\s+after\\s+(?:you\\s+(?:have\\s+)?)?(?:reading|read)\\s+${QUOTED}`,
      'i',
    ),
    read: 2,
    act: 1,
  },
  {
    form: 'question-read-first',
    pattern: new RegExp(`${START}([^.;!?]+?)\\?\\s*read\\s+${QUOTED}\\s+first`, 'i'),
    read: 2,
    act: 1,
  },
  {
    form: 'prior-to-read',
    pattern: new RegExp(`\\bprior to ([^,:;]+?)[,:]\\s*read\\s+${QUOTED}`, 'i'),
    read: 2,
    act: 1,
  },
];

/** The name a gate's target gives: a link's destination, without quotes, markup or a closing stop. */
function gateTarget(raw: string): string {
  const link = /^\[[^\]]*\]\(([^)\s]+)\)$/.exec(raw.trim());
  const name = link?.[1] ?? raw;
  return name
    .replace(/[`*"]/g, '')
    .replace(/[.,;:!?]+$/, '')
    .replace(/[#?].*$/, '')
    .trim();
}

function gateAtoms(
  chunk: ProseChunk,
  files: ReadonlyMap<string, EstateFile>,
  raw: RawEstate,
  builder: AtomBuilder,
): void {
  for (const line of chunkLines(chunk, files.get(chunk.file))) {
    // A form quoted as an example ("before editing: read the notes") is no rule of the line.
    const quoted = Array.from(line.text.matchAll(/"[^"\n]*"|\u201c[^\u201d\n]*\u201d/g), (match) => [
      match.index,
      match.index + match[0].length,
    ]);
    const matches = GATE_FORMS.flatMap(({ pattern, ...form }) =>
      Array.from(line.text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`)), (match) => ({
        ...form,
        match,
      })),
    ).sort((a, b) => a.match.index - b.match.index);
    let coveredUntil = 0;
    for (const { form, read, act, match } of matches) {
      if (match.index < coveredUntil) continue;
      const at = match.index + match[0].search(/\S/);
      if (quoted.some(([start, end]) => at > (start as number) && at < (end as number))) continue;
      // "Never read Y before X" forbids the read: no order to keep.
      if (
        form === 'read-before' &&
        /\b(?:never|not|don't|must not|should not)\s*$/i.test(line.text.slice(0, at))
      )
        continue;
      // Markup around the words (bold, backticks, quotes, a link) is not part of the act or of what is read.
      const first = gateTarget(match[read] ?? '');
      const trigger = (match[act] ?? '').replace(/[`*]/g, '').trim();
      if (first === '' || trigger === '' || !isAct(trigger)) continue;
      coveredUntil = match.index + match[0].length;
      const isFile = /\.[A-Za-z0-9]+$/.test(first) && !/\s/.test(first);
      // The file to read first is found as a reference's is: its place, an alias, then its ending.
      const located = isFile
        ? locateNamed(first, chunk.file, files, {
            bases: raw.bases ?? [],
            skipped: new Set(raw.ignored?.paths ?? []),
            aliases: raw.aliases ?? {},
            byName: names(raw, files),
            externals: raw.externals ?? [],
          })
        : undefined;
      const path = located?.path;
      const before = isFile ? raw.labels.read : raw.labels.shell;
      const after = actLabel(trigger, raw);
      const evidence: EvidencePredicate[] = [
        { type: 'ordered', before, after },
        path
          ? { type: 'tool_called', label: raw.labels.read, input: { file_path: { contains: path } } }
          : { type: 'tool_called', label: raw.labels.shell, input: { command: { contains: first } } },
      ];
      builder.add({
        kind: 'gate',
        title: `Read ${first} before ${trigger}`,
        at: { file: chunk.file, startLine: line.line, endLine: line.line, quote: line.quote },
        evidence,
        situation: trigger,
        fields: {
          form,
          first,
          trigger,
          ...(path ? { path } : {}),
          ...(located?.via === 'alias' || located?.via === 'suffix' ? { resolvedBy: located.via } : {}),
          ...(located?.candidates ? { candidates: located.candidates } : {}),
          ...(located?.via === 'external' ? { external: true } : {}),
        },
      });
    }
  }
}

/** Verbs of the acts a gate can come before, with their -ing forms. */
const ACT_VERBS = new Set(
  [
    ['edit', 'editing'],
    ['write', 'writing'],
    ['change', 'changing'],
    ['modify', 'modifying'],
    ['save', 'saving'],
    ['create', 'creating'],
    ['commit', 'committing'],
    ['push', 'pushing'],
    ['run', 'running'],
    ['deploy', 'deploying'],
    ['dispatch', 'dispatching'],
    ['delegate', 'delegating'],
    ['update', 'updating'],
    ['rename', 'renaming'],
    ['delete', 'deleting'],
    ['remove', 'removing'],
    ['merge', 'merging'],
    ['send', 'sending'],
    ['publish', 'publishing'],
    ['release', 'releasing'],
    ['reply', 'replying'],
    ['answer', 'answering'],
    ['call', 'calling'],
    ['move', 'moving'],
    ['copy', 'copying'],
    ['install', 'installing'],
    ['open', 'opening'],
    ['close', 'closing'],
  ].flat(),
);

/**
 * An act the agent performs: its first word, after a subject (you, we, the agent), is a verb of acting. A
 * time ("9 in the morning"), a meal or a past event ("the audit last year") is no act, nor is a feeling.
 */
function isAct(trigger: string): boolean {
  const words = trigger
    .toLowerCase()
    .replace(/^(you|we|i|the agent|the assistant)\s+/, '')
    .split(/\s+/);
  const first = words[0] ?? '';
  // An -ing form names an act in a gate (matching a line, posting a reply); else a verb of the list.
  if (ACT_VERBS.has(first) || (first.length > 5 && first.endsWith('ing'))) return true;
  // "every ticket edit", "each change": an act named as a noun after a quantifier.
  return ['every', 'each', 'any'].includes(first) && words.slice(1).some((word) => ACT_VERBS.has(word));
}

/** The tool an act names: editing is an edit, committing or running is a shell call; else the act itself. */
function actLabel(act: string, raw: RawEstate): string {
  const verb = act.toLowerCase();
  if (/\b(edit|editing|change|changing|modify|modifying|update|updating)\b/.test(verb))
    return raw.labels.edit;
  if (/\b(write|writing|save|saving|create|creating)\b/.test(verb)) return raw.labels.write;
  if (/\b(commit|committing|push|pushing|run|running|deploy|deploying|rename|renaming)\b/.test(verb))
    return raw.labels.shell;
  if (/\b(dispatch|dispatching|delegate|delegating)\b/.test(verb)) return raw.labels.dispatch;
  return act;
}

function hazardAtoms(chunk: ProseChunk, files: ReadonlyMap<string, EstateFile>, builder: AtomBuilder): void {
  if (!files.has(chunk.file)) return;
  for (const line of chunkLines(chunk, files.get(chunk.file))) {
    // Words quoted as an example (an error message, a phrase) are not the line's own words.
    const own = line.text.replace(/"[^"\n]*"|\u201c[^\u201d\n]*\u201d/g, ' ');
    for (const hazard of HAZARDS) {
      if (!hazard.pattern.test(own) || !runtimeHazard(hazard.id, own)) continue;
      builder.add({
        kind: 'hazard',
        title: `Recover from ${hazard.title.toLowerCase()}`,
        at: { file: chunk.file, startLine: line.line, endLine: line.line, quote: line.quote },
        evidence: [{ type: 'custom', name: 'hazard_recovery', options: { hazard: hazard.id } }],
        situation: hazard.title,
        fields: { hazard: hazard.id },
      });
    }
  }
}

/**
 * An event with no owner is about the runtime in an instruction estate. Explicit owners still matter:
 * equipment restarts, commercial rate limits, customer messages and course sessions are domain work,
 * not events that interrupt the assistant. Keep incoming notifications from helpers as runtime events.
 */
function runtimeHazard(id: (typeof HAZARDS)[number]['id'], text: string): boolean {
  const line = text.replace(/[`*]/g, '').replace(/[‘’]/g, "'");
  switch (id) {
    case 'compaction': {
      const runtime = line.replace(
        /\b(?:supplier|customer|client)(?:'s)?\s+(?:conversation|context)(?: window)? (?:is summari[sz]ed|fills? up|is full)\b/gi,
        '',
      );
      return HAZARDS.find((hazard) => hazard.id === id)?.pattern.test(runtime) ?? false;
    }
    case 'restart':
      return !/\b(?:restart\s+button|(?:printer|device|equipment|appliance)(?:'s)?\s+(?:restart|reboot)s?|(?:restart|reboot)\s+the\s+(?:[\w-]+\s+)?(?:printer|device|equipment|appliance))\b/i.test(
        line,
      );
    case 'rate_wave':
      return !/\b(?:supplier|customer|client)(?:'s)?\s+rate[- ]limits?\b|\brate[- ]limits?\s+for\s+(?:orders|purchases|deliveries)\b/i.test(
        line,
      );
    case 'notification':
      return (
        !/\b(?:send|deliver|post|email)\b[^.;!?]*\bnotifications?\b/i.test(line) ||
        /\b(?:helper|subagent|worker|guard|hook)\b/i.test(line)
      );
    case 'session_boundary':
      return !/\bsession\s+(?:of|for|in)\s+(?:the\s+|a\s+)?(?:training|course|class|workshop|lesson)\b/i.test(
        line,
      );
    default:
      return true;
  }
}

/** The non-blank lines of a chunk, numbered as lines of its file. */
const MASKED_PROSE = new WeakMap<EstateFile, string[]>();
export function chunkLines(
  chunk: ProseChunk,
  source?: EstateFile,
): Array<{ line: number; text: string; quote: string }> {
  let masked: string;
  if (source) {
    let lines = MASKED_PROSE.get(source);
    if (!lines) {
      const body = ['skill', 'skill_file', 'subagent'].includes(source.kind)
        ? readFrontmatter(source.text).bodyLine
        : 1;
      const original = source.text.split('\n');
      lines = blankFences(original.map((line, index) => (index < body - 1 ? '' : line)).join('\n')).split(
        '\n',
      );
      MASKED_PROSE.set(source, lines);
    }
    masked = lines.slice(chunk.startLine - 1, chunk.endLine).join('\n');
  } else masked = blankFences(chunk.text);
  const original = chunk.text.split('\n');
  return linesOf(masked)
    .filter((line) => line.text !== '')
    .map((line) => ({
      line: chunk.startLine + line.line - 1,
      text: line.text,
      quote: original[line.line - 1]?.trim() ?? line.text,
    }));
}

/** `Bash` for `Bash(git status)`. */
export function toolBase(rule: string): string {
  return rule.replace(/\(.*$/, '').trim();
}

function firstLine(file: EstateFile): Located {
  const line = linesOf(file.text).find((entry) => entry.text !== '' && !entry.text.startsWith('#!'));
  const chosen = line ?? linesOf(file.text).find((entry) => entry.text !== '');
  return {
    file: file.path,
    startLine: chosen?.line ?? 1,
    endLine: chosen?.line ?? 1,
    quote: chosen?.text ?? basename(file.path),
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
