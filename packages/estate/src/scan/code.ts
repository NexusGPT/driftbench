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
  { id: 'restart', title: 'A process restart', pattern: /\b(?:restart|reboot)(?:s|ed)?\b/i },
  {
    id: 'rate_wave',
    title: 'A wave of rate limits',
    pattern:
      /\brate[- ]limit|\btoo many requests\b|\b(?:HTTP(?: status)?|status(?: code)?|responds?|answers?|returns?)\s+(?:with\s+)?(?:an?\s+)?429\b|\b429\s+(?:error|response|status)\b/i,
  },
  {
    id: 'session_boundary',
    title: 'A new session',
    pattern:
      /\b(start of (every|each|a) session|new session|session start|session (?:is )?resumed|resume (?:the |a )?session)/i,
  },
  { id: 'notification', title: 'A helper notification', pattern: /\bnotification/i },
  { id: 'nudge_storm', title: 'Repeated guard nudges', pattern: /\bnudges?\b/i },
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
    const mention = body.find((line) => line.text.includes(name));
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

/** A path and its spelling in the source, before notation is normalized. */
type NamedReference = { path: string; spelling: string };

/** Paths a line names, sharing one tokenizer with reference provenance and negation checks. */
export function namedPaths(line: string): string[] {
  return namedReferences(line).map(({ path }) => path);
}

function namedReferences(line: string): NamedReference[] {
  const found: NamedReference[] = [];
  const claimed: Array<[number, number]> = [];
  const take = (match: RegExpMatchArray, token: string | undefined, wiki = false) => {
    const start = match.index ?? 0;
    if (claimed.some(([from, to]) => start >= from && start < to)) return;
    claimed.push([start, start + match[0].length]);
    if (!token) return;
    const spelling = token.trim();
    let path = spelling
      .replace(/\\/g, '/')
      .replace(/^@/, '')
      .replace(/^\$(?:\{CLAUDE_PROJECT_DIR\}|CLAUDE_PROJECT_DIR)\//, '')
      .replace(/[#?].*$/, '')
      .replace(/:\d+(?::\d+)?$/, '');
    if (wiki && !/\.[A-Za-z0-9]+$/.test(path)) path += '.md';
    const execution = /\b(?:run|execute)(?: the command)?\s*$|\bexample:\s*$/i.test(line.slice(0, start));
    if (
      /^[a-z]+:/i.test(path) ||
      /[<>*?{}$|;&]/.test(path) ||
      /\s--?\w/.test(path) ||
      (execution && /\s/.test(path)) ||
      !/\.[A-Za-z0-9]+$/.test(path)
    )
      return;
    found.push({ path, spelling });
  };
  for (const match of line.matchAll(/`([^`\n]+)`/g)) take(match, match[1]);
  for (const match of line.matchAll(/\[[^\]\n]*\]\((?:<([^>\n]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g))
    take(match, match[1] ?? match[2]);
  for (const match of line.matchAll(/"([^"\n]+)"|'([^'\n]+)'/g)) take(match, match[1] ?? match[2]);
  for (const match of line.matchAll(/\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g)) take(match, match[1], true);
  for (const match of line.matchAll(/<([^<>\s]+)>|\*\*([^*\n]+)\*\*/g)) take(match, match[1] ?? match[2]);
  // Whole tokens, never a filename extracted from inside a URL, glob, example or link title.
  // Find the directive once: rescanning each token's prefix makes long prose quadratic.
  const directive = /\b(?:read|open|load|consult|include|import|see|use)\b/i.exec(line);
  const directiveEnd = directive ? directive.index + directive[0].length : Number.POSITIVE_INFINITY;
  for (const match of line.matchAll(/[^\s`"'<>()[\],;!]+/g)) {
    if (!match[0].includes('.')) continue;
    if (!match[0].startsWith('@') && (match.index ?? 0) < directiveEnd) continue;
    take(match, match[0].replace(/[.:]+$/, ''));
  }
  return found;
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

function referenceAtoms(
  chunk: ProseChunk,
  files: ReadonlyMap<string, EstateFile>,
  raw: RawEstate,
  builder: AtomBuilder,
): void {
  const skipped = new Set(raw.ignored?.paths ?? []);
  const standing = files.get(chunk.file)?.kind === 'standing';
  for (const line of chunkLines(chunk, files.get(chunk.file))) {
    // A standing line `@path` is an import: the runtime loads that file, so the agent reads nothing.
    if (standing && /^@\S+$/.test(line.text.trim())) continue;
    for (const { path: named, spelling } of namedReferences(line.text)) {
      if (!positiveMention(line.text, spelling, ['read', 'open', 'load'])) continue;
      const located = locateNamed(named, chunk.file, files, {
        bases: raw.bases ?? [],
        skipped,
        aliases: raw.aliases ?? {},
        byName: names(raw, files),
        externals: raw.externals ?? [],
      });
      const path = located.path;
      const target = files.get(path);
      const source = files.get(chunk.file);
      // A routing link loads the declared skill; it does not separately order a read of its definition.
      if (
        source &&
        routeNames(raw).definitions.has(path) &&
        routeSources(source, files, raw)
          .get(line.line)
          ?.some((route) => route.definition === path)
      )
        continue;
      const isSkipped = target === undefined && skipped.has(path);
      if (!target && !isSkipped && !DOCUMENT.test(path)) continue;
      if (target && (target.kind === 'guard_script' || SCRIPT.test(path))) continue;
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

type RouteSource = {
  line: number;
  quote: string;
  ask: string;
  target: string;
  isSkill: boolean;
  via: 'table' | 'prose' | 'heading';
  definition?: string;
};

const ROUTE_SOURCES = new WeakMap<RawEstate, Map<string, Map<number, RouteSource[]>>>();
const ROUTE_NAMES = new WeakMap<
  RawEstate,
  {
    skills: Set<string>;
    helpers: Set<string>;
    definitions: Map<string, string>;
  }
>();

function routeNames(raw: RawEstate) {
  let index = ROUTE_NAMES.get(raw);
  if (!index) {
    index = {
      skills: new Set(raw.skills.map((skill) => skill.name)),
      helpers: new Set(raw.subagents.map((helper) => helper.name)),
      definitions: new Map(raw.skills.map((skill) => [skill.file, skill.name])),
    };
    ROUTE_NAMES.set(raw, index);
  }
  return index;
}

/** Resolve only declared targets, retaining the distinction between a skill and a named agent. */
function routeTargets(
  cell: string,
  file: EstateFile,
  files: ReadonlyMap<string, EstateFile>,
  raw: RawEstate,
) {
  const { skills, helpers, definitions } = routeNames(raw);
  const targets = new Map<string, { target: string; isSkill: boolean; definition?: string }>();
  const add = (written: string, spelling = written, definition?: string) => {
    const clean = written
      .replace(/[`*]/g, '')
      .replace(/[.!]+$/, '')
      .trim();
    const helper = /^(?:the )?(.+?) agent$/i.exec(clean)?.[1];
    const target = (helper ?? clean.replace(/^the\s+/i, '').replace(/\s+skill$/i, '')).replace(/^\//, '');
    const isSkill = !(helper && helpers.has(helper)) && skills.has(target);
    if (
      (!isSkill && !helpers.has(target)) ||
      !positiveMention(cell, spelling, ['load', 'use', 'dispatch', 'call'], true)
    )
      return;
    targets.set(`${isSkill ? 'skill' : 'agent'}:${target}`, {
      target,
      isSkill,
      ...(definition ? { definition } : {}),
    });
  };
  const clean = cell.replace(/[`*]/g, '').trim();
  const explicitHelper = /^(?:the )?(.+?) agent[.!]?$/i.exec(clean)?.[1];
  if (explicitHelper && helpers.has(explicitHelper)) {
    add(clean, explicitHelper);
  } else {
    add(clean);
    for (const match of cell.matchAll(/`([^`]+)`/g)) add(match[1] ?? '');
  }
  for (const match of cell.matchAll(/\[[^\]]+\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const path = resolveNamed((match[1] ?? '').replace(/[#?].*$/, ''), file.path, files, raw.bases);
    const skill = definitions.get(path);
    if (skill) add(skill, match[0], path);
  }
  return [...targets.values()];
}

/** A routing table header that states the condition of an ask. */
const ROUTE_CONDITION =
  /^(?:when|use when|if|whenever|ask|asks|request|requests|trigger|triggers|condition|situation|intent|task|tasks|for|the user wants)\b/i;
/** A column of people: who owns or maintains a skill is no ask. */
const ROUTE_PEOPLE =
  /^(?:owners?|maintainers?|maintained by|owned by|authors?|contacts?|team|people|person|assignees?|reviewers?)\b/i;
/** A column of remarks names no target. */
const ROUTE_NOTES =
  /^(?:notes?|comments?|remarks?|descriptions?|details?|why|reasons?|see also|examples?)\b/i;

/** Routing is defined by a condition and an action, never by a name appearing in an arbitrary table. */
function routeSources(
  file: EstateFile,
  files: ReadonlyMap<string, EstateFile>,
  raw: RawEstate,
): Map<number, RouteSource[]> {
  let cache = ROUTE_SOURCES.get(raw);
  if (!cache) {
    cache = new Map();
    ROUTE_SOURCES.set(raw, cache);
  }
  const cached = cache.get(file.path);
  if (cached) return cached;
  const sources = new Map<number, RouteSource[]>();
  const add = (route: RouteSource) => {
    const row = sources.get(route.line) ?? [];
    row.push(route);
    sources.set(route.line, row);
  };
  const clean = (value: string) =>
    value
      .replace(/[`*]/g, '')
      .replace(/[.!]+$/, '')
      .trim();
  for (const table of readTables(file.text)) {
    const headers = table.header.map(clean);
    // The ask is the column whose header states a condition, else the first column; a column of people
    // (owners, maintainers) is no ask, and a notes column names no target.
    const conditional = headers.findIndex((header) => ROUTE_CONDITION.test(header));
    const condition = conditional >= 0 ? conditional : 0;
    if (ROUTE_PEOPLE.test(headers[condition] ?? '')) continue;
    const actions = headers.flatMap((header, index) =>
      index !== condition && !ROUTE_NOTES.test(header) ? [index] : [],
    );
    for (const row of table.rows) {
      const ask = clean(row.cells[condition] ?? '');
      if (!ask) continue;
      for (const action of actions) {
        for (const target of routeTargets(row.cells[action] ?? '', file, files, raw)) {
          add({ ...target, ask, line: row.line, quote: row.text, via: 'table' });
        }
      }
    }
  }
  // Routing in prose and headings is read in the standing instructions, where routing lives; a skill body's
  // "when X, dispatch Y" is a step of that skill, not the routing of an ask.
  if (file.kind !== 'standing') {
    cache.set(file.path, sources);
    return sources;
  }
  const lines = chunkLines(
    { id: 'routing', file: file.path, startLine: 1, endLine: file.text.split('\n').length, text: file.text },
    file,
  );
  for (const [index, line] of lines.entries()) {
    const directive =
      /^(?:[-*+]\s+|\d+[.)]\s+)?(?:(?:to|for)\s+(.+?)\s*[:,]|(?:when|if|whenever)\s+(?:the user|a user|someone)?\s*(?:wants|asks|needs)?\s*(?:to\s+)?(.+?),)\s*(?:please\s+)?(?:always\s+)?(?:load|use|invoke|dispatch|call)\s+(.+?)\.?$/i.exec(
        line.text,
      );
    if (directive) {
      const ask = clean(directive[1] ?? directive[2] ?? '');
      for (const target of routeTargets(directive[3] ?? '', file, files, raw)) {
        add({ ...target, ask, line: line.line, quote: line.quote, via: 'prose' });
      }
    }
    const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(line.text);
    if (!heading) continue;
    const targets = routeTargets(heading[1] ?? '', file, files, raw);
    if (!targets.length) continue;
    for (let next = index + 1; next < lines.length; next++) {
      const following = lines[next];
      if (!following) break;
      if (/^#{1,6}\s/.test(following.text)) break;
      const condition =
        /^(?:use|load|invoke|dispatch|call)\s+(?:it|this(?:\s+skill|\s+agent|\s+helper)?)\s+(?:when|if|whenever|for)\s+(?:the user|a user|someone)?\s*(?:wants|asks|needs)?\s*(?:to\s+)?(.+?)\.?$/i.exec(
          following.text,
        );
      if (!condition) continue;
      for (const target of targets)
        add({
          ...target,
          ask: clean(condition[1] ?? ''),
          line: line.line,
          quote: line.quote,
          via: 'heading',
        });
      break;
    }
  }
  cache.set(file.path, sources);
  return sources;
}

function routeAtoms(
  chunk: ProseChunk,
  files: ReadonlyMap<string, EstateFile>,
  _names: { skills: Set<string>; subagents: Set<string> },
  raw: RawEstate,
  builder: AtomBuilder,
): void {
  const file = files.get(chunk.file);
  if (!file) return;
  const routes = routeSources(file, files, raw);
  for (let line = chunk.startLine; line <= chunk.endLine; line++) {
    for (const { quote, ask, target, isSkill, via } of routes.get(line) ?? []) {
      builder.add({
        kind: 'route',
        title: `An ask to ${ask} ${isSkill ? 'loads' : 'dispatches'} ${target}`,
        at: { file: chunk.file, startLine: line, endLine: line, quote },
        evidence: [
          isSkill
            ? { type: 'skill_loaded', name: target }
            : { type: 'tool_called', label: raw.labels.dispatch, input: { subagent_type: target } },
        ],
        situation: ask,
        fields: { target, targetKind: isSkill ? 'skill' : 'subagent', via, ask },
      });
    }
  }
}

/**
 * Read prerequisites are parsed as clauses. A line is first masked: each inline code span, markdown link
 * and quotation becomes one opaque token, so a file name, a quoted command or a quoted example is never
 * split, searched for directive words or mistaken for a rule. The masked line is cut into clauses at
 * sentence ends, semicolons and coordinated directives (", and read …"), and each clause is matched against
 * the forms below. The words in front of the verb read (its head) must give a directive: a polite, modal or
 * adverbial lead-in is kept, while a negated, optional or conditional head ("do not read", "you need not
 * read", "if you read") gives no gate.
 */
const OPEN_TOKEN = '\uE000';
const CLOSE_TOKEN = '\uE001';
const TOKEN = String.raw`\uE000\d+\uE001`;
/** What is read: one masked span, else the words up to the next form word. */
const TARGET = String.raw`(${TOKEN}|\S+)`;
const NEGATIVE = String.raw`(?:do\s+not|don't|never|must\s+not|mustn't|should\s+not|shouldn't|cannot|can't|may\s+not)`;
/** `prose`: the form ends on what is read, so a step in words ("the output of the build") may be read. */
const GATE_FORMS: Array<{
  form: string;
  pattern: RegExp;
  head: number[];
  read: number;
  act: number;
  prose?: boolean;
}> = [
  {
    form: 'before-colon-read',
    pattern: new RegExp(String.raw`^(.*?)\bbefore\s+([^:]+?)\s*:\s*(.*?)\bread\s+(${TOKEN}|.+)$`, 'i'),
    head: [1, 3],
    read: 4,
    act: 2,
    prose: true,
  },
  {
    form: 'before-comma-read',
    pattern: new RegExp(String.raw`^(.*?)\bbefore\s+([^,:]+?)\s*,\s*(.*?)\bread\s+(${TOKEN}|.+)$`, 'i'),
    head: [1, 3],
    read: 4,
    act: 2,
    prose: true,
  },
  {
    form: 'prior-to-read',
    pattern: new RegExp(
      String.raw`^(.*?)\bprior\s+to\s+([^,:]+?)\s*[:,]\s*(.*?)\bread\s+(${TOKEN}|.+)$`,
      'i',
    ),
    head: [1, 3],
    read: 4,
    act: 2,
    prose: true,
  },
  {
    form: 'read-first-then',
    pattern: new RegExp(String.raw`^(.*?)\bread\s+${TARGET}\s+first,?\s+(?:and\s+)?then\s+(.+)$`, 'i'),
    head: [1],
    read: 2,
    act: 3,
  },
  {
    form: 'read-before',
    pattern: new RegExp(String.raw`^(.*?)\bread\s+${TARGET}(?:\s+first)?\s+before\s+(.+)$`, 'i'),
    head: [1],
    read: 2,
    act: 3,
  },
  {
    form: 'not-until-read',
    pattern: new RegExp(
      String.raw`^(.*?)\b${NEGATIVE}\s+(.+?)\s+until\s+(?:you\s+have\s+|you've\s+|you\s+|after\s+)?(?:read|reading)\s+(?:the\s+output\s+of\s+)?(${TOKEN}|.+)$`,
      'i',
    ),
    head: [1],
    read: 3,
    act: 2,
    prose: true,
  },
  {
    form: 'not-without-reading',
    pattern: new RegExp(
      String.raw`^(.*?)\b${NEGATIVE}\s+(.+?)\s+without\s+(?:first\s+)?(?:reading|having\s+read)\s+${TARGET}`,
      'i',
    ),
    head: [1],
    read: 3,
    act: 2,
  },
  {
    form: 'only-after-reading',
    pattern: new RegExp(
      String.raw`^(.+?)\s+only\s+(?:after|once)\s+(?:you\s+have\s+|you've\s+|having\s+)?(?:reading|read)\s+${TARGET}`,
      'i',
    ),
    head: [],
    read: 2,
    act: 1,
  },
  {
    form: 'question-read-first',
    pattern: new RegExp(String.raw`^(.+?)\?\s*(.*?)\bread\s+${TARGET}\s+first\b`, 'i'),
    head: [2],
    read: 3,
    act: 1,
  },
];

/** A clause led by one of these is a condition or a purpose, not the directive itself. */
const SUBORDINATE =
  /^(?:if|when|whenever|unless|whether|because|although|though|since|once|while|after|as\s+soon\s+as|in\s+case)\b/;
/** A head with one of these words lifts the requirement: "do not read", "you need not read", "optionally read". */
const NEGATED = /\b(?:not|never|no|nor|neither|cannot|optional|optionally)\b|n't\b/;

/** Whether the words before "read" make it a directive: no negation, and not itself a condition. */
function directiveHead(head: string): boolean {
  const segments = head
    .toLowerCase()
    .replace(/[*_]/g, '')
    .split(/[,:]/)
    .map((segment) => segment.trim());
  const main = segments.pop() ?? '';
  if (SUBORDINATE.test(main) || NEGATED.test(main)) return false;
  // A leading condition ("If no objection is raised,") may hold a negation of its own; any other lead-in may not.
  return segments.every((segment) => SUBORDINATE.test(segment) || !NEGATED.test(segment));
}

type MaskedLine = { text: string; spans: string[] };

/** Replace code spans, links and quotations with tokens; a code span around one plain word is emphasis. */
function maskLine(line: string): MaskedLine {
  const spans: string[] = [];
  const token = (span: string) => `${OPEN_TOKEN}${spans.push(span) - 1}${CLOSE_TOKEN}`;
  const text = line
    .replace(/`([^`\n]+)`/g, (span, inner: string) => (/^[A-Za-z]+$/.test(inner) ? inner : token(span)))
    .replace(/\[[^\]\n]*\]\((?:<[^>\n]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g, token)
    .replace(/"[^"\n]+"|\u201C[^\u201D\n]+\u201D/g, token)
    .replace(
      /(^|[\s(])('[^'\n]+')(?=$|[\s.,;:!?)])/g,
      (_match, lead: string, span: string) => lead + token(span),
    );
  return { text, spans };
}

function unmask(text: string, spans: readonly string[]): string {
  let out = text;
  const pattern = new RegExp(TOKEN, 'g');
  // A link's text may hold a masked code span: unmask until no token is left.
  while (pattern.test(out)) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, (token) => spans[Number(token.slice(1, -1))] ?? '');
  }
  return out;
}

/** Cut a masked line into directive clauses; masked spans are never cut. */
function gateClauses(text: string): string[] {
  const clauses: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    const end = char === ';' || ((char === '.' || char === '!') && (next === undefined || /\s/.test(next)));
    if (!end) continue;
    const prefix = text
      .slice(start, index + 1)
      .replace(/[*`]/g, '')
      .trim();
    // A numbered list, a rule label or an abbreviation ("e.g.") is not the end of a directive.
    if (char === '.' && /^(?:[-+]\s*)?(?:\d+|[A-Z]+#?\d+)\.$/i.test(prefix)) continue;
    if (char === '.' && /\b(?:e\.g|i\.e|etc|vs|cf)\.$/i.test(prefix)) continue;
    clauses.push(text.slice(start, index));
    start = index + 1;
  }
  clauses.push(text.slice(start));
  return clauses
    .flatMap((clause) => clause.split(/,\s*(?:and|but)\s+(?=\S)/i))
    .map((clause) =>
      clause
        .replace(/\*\*/g, '')
        .replace(/^\s*(?:[-+*]\s+)?(?:\d+[.)]\s+)?(?:[A-Z]+#?\d+[.:]\s+)?/i, '')
        .trim(),
    )
    .filter((clause) => clause !== '');
}

/**
 * The thing to read: a masked span, else a path-like word, else (where the form allows) the words of the
 * clause, a step to run. A bare word such as "it" or "them" names nothing to read first.
 */
function gateTarget(raw: string, spans: readonly string[], prose: boolean): string {
  const text = raw.trim();
  const span = new RegExp(`^${TOKEN}`).exec(text);
  if (span) return unmask(span[0], spans);
  const word = /^\S+/.exec(text)?.[0] ?? '';
  if (/[/\\]|\.[A-Za-z0-9]+[.,:;!?)]*$/.test(word)) return word.replace(/[.,:;!?)]+$/, '');
  return prose ? unmask(text, spans).replace(/[.,:;!?]+$/, '') : '';
}

function gateAtoms(
  chunk: ProseChunk,
  files: ReadonlyMap<string, EstateFile>,
  raw: RawEstate,
  builder: AtomBuilder,
): void {
  for (const line of chunkLines(chunk, files.get(chunk.file))) {
    const { text, spans } = maskLine(line.text);
    for (const clause of gateClauses(text)) {
      for (const { form, pattern, head, read, act, prose } of GATE_FORMS) {
        const match = pattern.exec(clause);
        if (!match) continue;
        if (!head.every((group) => directiveHead(unmask(match[group] ?? '', spans)))) continue;
        const target = gateTarget(match[read] ?? '', spans, prose === true);
        const named = namedPaths(`Read ${target}`)[0];
        const first = named ?? target.replace(/[`*"'\u201C\u201D]/g, '').trim();
        const trigger = unmask(match[act] ?? '', spans)
          .replace(/[`*]/g, '')
          .trim();
        if (first === '' || trigger === '' || !isAct(trigger)) continue;
        // A file is a path the reference tokenizer accepts (a code span may hold spaces), else one bare word.
        const isFile = /\.[A-Za-z0-9]+$/.test(first) && (named !== undefined || !/\s/.test(first));
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
        break;
      }
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
    // "before you can edit": a modal after the subject is not the act.
    .replace(/^(?:can|may|must|should|will|shall)\s+/, '')
    .split(/\s+/);
  const first = words[0] ?? '';
  // An -ing form names an act in a gate (matching a line, posting a reply); else a verb of the list.
  // "anything", "something": a pronoun, not an -ing form.
  if (ACT_VERBS.has(first) || (first.length > 5 && first.endsWith('ing') && !first.endsWith('thing')))
    return true;
  // "every ticket edit", "each change": an act named as a noun after a quantifier.
  return ['every', 'each', 'any'].includes(first) && words.slice(1).some((word) => ACT_VERBS.has(word));
}

/** The tool an act names: editing is an edit, committing or running is a shell call; else the act itself. */
function actLabel(act: string, raw: RawEstate): string {
  const verb = act.toLowerCase();
  if (/\b(edit|editing|change|changing|modify|modifying|update|updating)\b/.test(verb))
    return raw.labels.edit;
  if (/\b(write|writing|save|saving|create|creating)\b/.test(verb)) return raw.labels.write;
  if (
    /\b(commit|committing|push|pushing|run|running|deploy|deploying|rename|renaming|move|moving)\b/.test(verb)
  )
    return raw.labels.shell;
  if (/\b(dispatch|dispatching|delegate|delegating)\b/.test(verb)) return raw.labels.dispatch;
  return act;
}

function hazardAtoms(chunk: ProseChunk, files: ReadonlyMap<string, EstateFile>, builder: AtomBuilder): void {
  if (!files.has(chunk.file)) return;
  for (const line of chunkLines(chunk, files.get(chunk.file))) {
    for (const hazard of HAZARDS) {
      if (!hazard.pattern.test(line.text) || !runtimeHazard(hazard.id, line.text)) continue;
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
      return !/\b(?:restart\s+button|(?:printer|device|equipment|appliance)(?:'s)?\s+(?:restarts?|reboots?))\b/i.test(
        line,
      );
    case 'rate_wave':
      return !/\b(?:supplier|customer|client)(?:'s)?\s+rate[- ]limits?\b|\brate[- ]limits?\s+for\s+(?:orders|purchases|deliveries)\b/i.test(
        line,
      );
    case 'nudge_storm':
      // A nudge the agent receives (repeated nudges, a hook nudges the agent), never the agent nudging a
      // value of the work ("nudge the price up").
      return [
        ...line.matchAll(
          /\bnudg(?:e|es|ed|ing)\b(\s+(?:up\s+|down\s+)?(?:the|a|an|this|that|these|those|its|their|our|your|my|it|them)\b(?:\s+(\w+))?)?/gi,
        ),
      ].some(
        (match) =>
          match[1] === undefined ||
          /^(?:agent|assistant|model|session|helper|subagent|claude|guard|hook)$/i.test(match[2] ?? ''),
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

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
