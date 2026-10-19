import { basename, posix } from 'node:path';
import type { Atom, AtomKind, EvidencePredicate } from '../schema';
import { isNormative, maskIllustrativePrefixes, normativeEstate } from './document-roles';
import { guardRuleSources } from './guard-rules';
import type { EstateFile, GuardDecl, ProseChunk, RawEstate, RegistryRow } from './reader';
import { ignoredReference, pathReference } from './reference-role';
import { blankFences, type Located, linesOf, provenanceHash, readFrontmatter, slug } from './text';

/**
 * The code half of the scan: every atom whose source has structure. Skills, helpers, guards, permissions,
 * settings, stages and the routes of skill and helper descriptions come from the reader's declarations; scripts
 * from their files and the commands that run them. What a sentence says (references, gates, runtime hazards, the
 * routes of a routing table) comes from the pointer reader. Code atoms are approved as read: their quote is the
 * file's own structure.
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

const SCRIPT = /\.(sh|bash|py|js|mjs|cjs|ts|rb|pl)$/i;

/** Builds atoms with stable, unique ids: kind, scope and a slug of the title, then -2, -3 on a repeat. */
export class AtomBuilder {
  readonly atoms: Atom[] = [];
  private readonly ids = new Set<string>();
  /** Per base id, the lowest suffix that may be free: every suffix below it is taken, and ids are never freed. */
  private readonly suffixes = new Map<string, number>();
  private readonly byFile = new Map<string, Atom[]>();

  constructor(private readonly files: ReadonlyMap<string, EstateFile>) {}

  /** The file of the estate that a path written in `from` leads to; the path as resolved when none is found. */
  locate(path: string, from: string): string {
    return this.resolve(path, from).path;
  }

  /** The estate the scan reads: its aliases, base folders, skipped files and external folders resolve a path. */
  private estate: RawEstate | undefined;
  configure(raw: RawEstate): void {
    this.estate = raw;
  }

  /** Where a path written in `from` leads, how it was found, and whether the file is one of the estate. */
  resolve(
    path: string,
    from: string,
    bare = false,
  ): NamedTarget & { exists: boolean; ignored: boolean; unresolved: boolean; concrete: boolean } {
    const raw = this.estate;
    const skipped = raw ? skippedOf(raw) : new Set<string>();
    const target = locateNamed(path, from, this.files, {
      bases: raw?.bases ?? [],
      skipped,
      aliases: raw?.aliases ?? {},
      byName: raw ? names(raw, this.files) : fileNames(this.files),
      externals: raw?.externals ?? [],
    });
    const present = this.files.has(target.path);
    // A name with no separator that resolves nowhere has no place. Quoted, backticked or linked with an
    // extension, it designates a file beside its source and is concrete; a loose word, or a name with no
    // extension, is information only.
    const lacksPlace = target.via === 'none' && !target.candidates && !/[/\\]/.test(path);
    const unresolved = lacksPlace && (bare || !pathReference(path));
    return {
      ...target,
      unresolved,
      concrete: lacksPlace && !unresolved,
      exists: present || skipped.has(target.path),
      ignored:
        !present && raw !== undefined && (skipped.has(target.path) || ignoredReference(raw, target.path)),
    };
  }

  /** The kind of a file of the estate, when it is one. */
  kindOf(path: string): string | undefined {
    return this.files.get(path)?.kind;
  }

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
    replyAct?: Atom['replyAct'];
    approved?: boolean;
  }): Atom {
    const base = `${atom.kind}.${this.scopeOf(atom.at.file)}.${slug(atom.title)}`;
    let id = base;
    if (this.ids.has(id)) {
      let count = this.suffixes.get(base) ?? 2;
      while (this.ids.has(`${base}-${count}`)) count++;
      id = `${base}-${count}`;
      this.suffixes.set(base, count + 1);
    }
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
      ...(atom.replyAct ? { replyAct: atom.replyAct } : {}),
    };
    this.atoms.push(built);
    const inFile = this.byFile.get(built.provenance.file);
    if (inFile) inFile.push(built);
    else this.byFile.set(built.provenance.file, [built]);
    return built;
  }

  /** The atoms built on a file, in the order they were added. */
  atomsOf(path: string): readonly Atom[] {
    return this.byFile.get(path) ?? [];
  }
}

/**
 * The verdict a guard source declares on a line of its own, in a comment or a docstring: `Verdict: deny`.
 * It is read only for a guard the registry gives no verdict.
 */
export function declaredVerdict(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  for (const line of text.split('\n')) {
    const match =
      /^\s*(?:[#*/]+\s*)?Verdict\s*:\s*(deny|block|warn|nudge|allow|ask)\s*\.?\s*(?:\*\/|""")?\s*$/i.exec(
        line,
      );
    if (match?.[1]) return match[1].toLowerCase();
  }
  return undefined;
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
  raw = normativeEstate(raw);
  builder.configure(raw);
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
    // With no registry verdict, the guard's own source may declare it on a line of its own: `Verdict: deny`.
    const declared = row?.verdict
      ? undefined
      : declaredVerdict(guard.script ? files.get(guard.script)?.text : undefined);
    const verdict = row?.verdict ?? declared;
    const script = guard.script ? files.get(guard.script) : undefined;
    const ruleSources = [
      ...(script ? guardRuleSources(script) : []),
      ...registryRowsOf(guard, raw.registry).flatMap((entry) =>
        entry.description
          ? [{ ...(entry.descriptionAt ?? entry.at), kind: 'registry', text: entry.description }]
          : [],
      ),
    ];
    builder.add({
      kind: 'guard',
      title: `${guard.event}${guard.matcher ? ` ${guard.matcher}` : ''} guard ${name}`,
      at: guard.at,
      evidence: [{ type: 'guard', name, ...(verdict ? { verdict } : {}) }],
      fields: {
        name,
        event: guard.event,
        command: guard.command,
        anchored: guard.anchored,
        scope: guard.scope,
        ...(declared ? { verdictFrom: 'source' } : {}),
        ...(ruleSources.length > 0
          ? {
              ruleText: [...new Set(ruleSources.map((source) => source.text))].join('\n'),
              ruleSources,
              rules: registryRowsOf(guard, raw.registry)
                .filter((entry) => entry.description)
                .map((entry) => ({
                  id: entry.id,
                  description: entry.description,
                  ...(entry.verdict ? { verdict: entry.verdict } : {}),
                  ...(entry.state ? { state: entry.state } : {}),
                  source: entry.descriptionAt ?? entry.at,
                })),
            }
          : {}),
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

  // Index declared roots at any depth. The nearest ancestor owns a file, so nested skills keep
  // their own scripts even when names or owner labels differ from folder names after a rename.
  // Walk path ancestors with root lookups, never scan every skill for each file.
  const skillRoots = new Set(raw.skills.map((skill) => posix.normalize(skill.folder)));
  const folderFiles = new Map<string, EstateFile[]>();
  for (const file of raw.files) {
    // Ownership comes from the folder, not from a document's role: a role limits what prose may declare.
    if (file.kind !== 'skill_file') continue;
    let folder = posix.dirname(posix.normalize(file.path));
    while (!skillRoots.has(folder)) {
      const parent = posix.dirname(folder);
      if (parent === folder) break;
      folder = parent;
    }
    if (!skillRoots.has(folder)) continue;
    const held = folderFiles.get(folder);
    if (held) held.push(file);
    else folderFiles.set(folder, [file]);
  }
  const proseOf = new Map<string, ProseChunk[]>();
  for (const chunk of raw.prose) {
    const held = proseOf.get(chunk.file);
    if (held) held.push(chunk);
    else proseOf.set(chunk.file, [chunk]);
  }
  for (const skill of raw.skills)
    scriptAtoms(
      skill.name,
      skill.folder,
      skill.file,
      folderFiles.get(posix.normalize(skill.folder)) ?? [],
      proseOf.get(skill.file) ?? [],
      raw,
      files,
      builder,
    );
}

/** The script file a command runs: after assignments, exec and env, and an interpreter with its flags. */
function commandExecutable(command: string): string | undefined {
  const words =
    command
      .match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g)
      ?.map((word) => word.replace(/^["']|["']$/g, '')) ?? [];
  while (words[0] === 'exec' || words[0] === 'env' || /^[A-Za-z_]\w*=/.test(words[0] ?? '')) words.shift();
  const executable = words.shift();
  if (
    !/^(?:python(?:\d+(?:\.\d+)*)?|node|bash|sh|zsh|ruby|perl|deno|bun|tsx)$/.test(basename(executable ?? ''))
  )
    return executable;
  while (words[0]?.startsWith('-')) {
    // Inline interpreter programs are not script-file invocations.
    if (['-c', '-e', '--eval', '-m'].includes(words[0])) return undefined;
    words.shift();
  }
  return words.shift();
}

function scriptInvocation(text: string, name: string): boolean {
  // Punctuation inside quoted commands belongs to the command, not the enclosing prose.
  const masked = text.replace(/`[^`]*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (part) =>
    ' '.repeat(part.length),
  );
  const clauses: string[] = [];
  let start = 0;
  for (const match of masked.matchAll(/[;,]|[.!?](?=\s|$)|\b(?:and\s+)?then\b/gi)) {
    clauses.push(text.slice(start, match.index));
    start = match.index + match[0].length;
  }
  clauses.push(text.slice(start));
  for (const clause of clauses) {
    const clean = clause.trim().replace(/^[-+*]\s+|^\d+[.)]\s+/, '');
    const directive =
      /^(?:you\s+)?(?:(?:must|should|always|first|then|also|please)\s+)?(?:run|execute|invoke|call|use|launch|start)\s+(?:the\s+script\s+)?(.+)$/i.exec(
        clean,
      );
    const argumentInstruction =
      /^(?:you\s+)?(?:(?:must|should|always)\s+)?pass\b.+?\bto\s+(`[^`]+`|\S+)/i.exec(clean);
    if (
      argumentInstruction &&
      basename((argumentInstruction[1] ?? '').replace(/[`.,;]+$/g, '').replace(/^`/, '')) === name
    )
      return true;
    // A link to the script file points at it, unless the clause forbids it.
    for (const link of clean.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g)) {
      const target = basename((link[1] ?? '').replace(/[#?].*$/, ''));
      if (target === name && !/\b(?:never|do not|don't|must not|should not)\b/i.test(clean)) return true;
    }
    // With no imperative verb, accept a command only when it occupies the whole clause. After a verb,
    // every code span is a command of that verb ("run `a` first and `b` last").
    const command = directive?.[1] ?? clean;
    const spans = directive ? [...command.matchAll(/`([^`]+)`/g)].map((span) => span[1] ?? '') : [];
    const span = /^`([^`]+)`/.exec(command);
    if (!directive && span && span[0].length !== command.length) continue;
    if (
      !directive &&
      !span &&
      !/[/]/.test(command.split(/\s+/)[0] ?? '') &&
      !/^(?:exec|env|python[\d.]*|node|bash|sh|zsh|ruby|perl|deno|bun|tsx)\s/.test(command)
    )
      continue;
    for (const written of spans.length > 0 ? spans : [span?.[1] ?? command]) {
      if (basename(commandExecutable(written) ?? '') === name) return true;
    }
  }
  return false;
}

/** One script atom per script file of a skill, anchored where the skill body names it, else in the script. */
function scriptAtoms(
  skill: string,
  folder: string,
  definition: string,
  skillFiles: readonly EstateFile[],
  bodyChunks: readonly ProseChunk[],
  raw: RawEstate,
  files: ReadonlyMap<string, EstateFile>,
  builder: AtomBuilder,
): void {
  // A long body may be cut into several chunks: the mention is looked for in each, in order.
  const body = bodyChunks.flatMap((chunk) => chunkLines(chunk, files.get(definition)));
  for (const file of skillFiles) {
    const relative = posix.relative(folder, file.path);
    if (!SCRIPT.test(file.path) && !relative.startsWith('scripts/')) continue;
    const name = basename(file.path);
    const mention = body.find((line) => scriptInvocation(line.text, name));
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
export type NamedReference = {
  path: string;
  spelling: string;
  start: number;
  end: number;
  /** Found as a loose word after a directive, not quoted, linked or backticked. */
  bare: boolean;
};

/** Paths a line names, sharing one tokenizer with reference provenance and negation checks. */
export function namedPaths(line: string, identifiers = false): string[] {
  return namedReferences(line, identifiers).map(({ path }) => path);
}

export function namedReferences(line: string, identifiers = false): NamedReference[] {
  const found: NamedReference[] = [];
  const claimed: Array<[number, number]> = [];
  const take = (
    match: RegExpMatchArray,
    token: string | undefined,
    wiki = false,
    length = match[0].length,
    identifierContext = false,
    bare = false,
  ) => {
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
    const identifier =
      identifiers &&
      (identifierContext || /^['"*\x60]/.test(match[0])) &&
      /^[\p{L}_][\p{L}\p{N}_-]*$/u.test(path) &&
      /\b(?:read|open|load)\s+(?:the\s+)?(?:(?:skill|helper|agent|identifier)\s+)?$/i.test(
        line.slice(0, start),
      );
    // A sentence is not a file name: a name with spaces needs an extension, and no segment exceeds a file name.
    const sentence =
      (/\s/.test(path) && !/\.[A-Za-z0-9]+$/.test(path)) || path.split('/').some((part) => part.length > 255);
    const concrete =
      !sentence &&
      pathReference(path) &&
      !path.endsWith('/') &&
      (!/\s/.test(posix.basename(path)) || /\.[^./\s]+$/.test(path));
    if (
      /^[a-z]+:/i.test(path) ||
      /[<>*?{}$|;&]/.test(path) ||
      /\s--?\w/.test(path) ||
      (execution && /\s/.test(path)) ||
      (identifiers ? !concrete && !identifier : !/\.[A-Za-z0-9]+$/.test(path))
    )
      return;
    found.push({ path, spelling, start, end: start + length, bare });
  };
  for (const match of line.matchAll(/`([^`\n]+)`/g)) take(match, match[1]);
  for (const match of line.matchAll(/\[[^\]\n]*\]\((?:<([^>\n]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g))
    take(match, match[1] ?? match[2]);
  for (const match of line.matchAll(/"([^"\n]+)"|'([^'\n]+)'/g)) take(match, match[1] ?? match[2]);
  for (const match of line.matchAll(/\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g)) take(match, match[1], true);
  for (const match of line.matchAll(/<([^<>\s]+)>|\*\*([^*\n]+)\*\*/g)) take(match, match[1] ?? match[2]);
  if (identifiers) {
    for (const match of line.matchAll(
      /\b(?:read|open|load)\s+(?:the\s+)?(?:skill|helper|agent|identifier)\s+([\p{L}_][\p{L}\p{N}_-]*)(?![\p{L}\p{N}_/\\-]|\.[\p{L}\p{N}_])/giu,
    )) {
      const name = match[1];
      if (!name) continue;
      const token = [name] as RegExpMatchArray;
      token.index = (match.index ?? 0) + match[0].length - name.length;
      take(token, name, false, name.length, true);
    }
  }
  // Whole tokens, never a filename extracted from inside a URL, glob, example or link title.
  // Find the directive once: rescanning each token's prefix makes long prose quadratic.
  const directive = /\b(?:read|open|load|consult|include|import|see|use)\b/i.exec(line);
  const directiveEnd = directive ? directive.index + directive[0].length : Number.POSITIVE_INFINITY;
  for (const match of line.matchAll(/[^\s`"'<>()[\],;!]+/g)) {
    if (!match[0].includes('.') && !(identifiers && /[/\\]/.test(match[0]))) continue;
    if (!match[0].startsWith('@') && (match.index ?? 0) < directiveEnd) continue;
    const token = match[0].replace(/[.:]+$/, '');
    take(match, token, false, token.length, false, true);
  }
  return found;
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
  return externals.some((root) => clean === root || clean.startsWith(root.endsWith('/') ? root : `${root}/`));
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
  if (isExternal(placed, options.externals ?? [])) return { path: placed, via: 'external' };
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
    const hits = endingIn(named, tail);
    if (hits.length === 1) return { path: hits[0] as string, via: 'suffix' };
    if (hits.length > 1) return { path: placed, via: 'none', candidates: [...hits].sort() };
  }
  return { path: placed, via: 'none' };
}

/**
 * The files of one file name whose path is `tail` or ends with `/tail`. Many lines name the same path, and a
 * name such as `SKILL.md` is shared by many files, so the answer is kept per list of files and per tail. The
 * scanner gives a name a new list when it learns a new file; a list that grows in place drops what was kept.
 */
const ENDINGS = new WeakMap<readonly string[], { size: number; byTail: Map<string, string[]> }>();
function endingIn(named: readonly string[], tail: string): string[] {
  let kept = ENDINGS.get(named);
  if (!kept || kept.size !== named.length) {
    kept = { size: named.length, byTail: new Map() };
    ENDINGS.set(named, kept);
  }
  const { byTail } = kept;
  let hits = byTail.get(tail);
  if (!hits) {
    hits = named.filter((candidate) => candidate === tail || candidate.endsWith(`/${tail}`));
    byTail.set(tail, hits);
  }
  return hits;
}

/** Every file of the estate (and every skipped file) by its file name. */
export function fileNames(
  files: ReadonlyMap<string, EstateFile>,
  skipped: ReadonlySet<string> = new Set(),
): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const path of [...files.keys(), ...skipped]) {
    const name = basename(path);
    const paths = byName.get(name);
    if (paths) paths.push(path);
    else byName.set(name, [path]);
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

/** The paths the reader skipped, as a set built once per estate read. */
const SKIPPED = new WeakMap<RawEstate, Set<string>>();
function skippedOf(raw: RawEstate): Set<string> {
  const cached = SKIPPED.get(raw);
  if (cached) return cached;
  const built = new Set(raw.ignored?.paths ?? []);
  SKIPPED.set(raw, built);
  return built;
}

/**
 * Existing files that non-normative documents (a changelog, a history, a template, an example) point at.
 * Such a document is navigation: its links still say that a file is documented, so the file is named, but
 * it supplies no atom, rule, gate or missing-file finding, and a link from it never makes a file reachable.
 */
export function navigationNames(raw: RawEstate): Set<string> {
  const files = new Map(raw.files.map((file) => [file.path, file]));
  const named = new Set<string>();
  const skipped = skippedOf(raw);
  const options = {
    bases: raw.bases ?? [],
    skipped,
    aliases: raw.aliases ?? {},
    byName: names(raw, files),
    externals: raw.externals ?? [],
  };
  for (const file of raw.files) {
    if (isNormative(file) || !/\.(?:md|markdown|txt)$/i.test(file.path)) continue;
    const lineCount = file.text.split('\n').length;
    const chunk: ProseChunk = {
      id: file.path,
      file: file.path,
      startLine: 1,
      endLine: lineCount,
      text: file.text,
    };
    for (const line of chunkLines(chunk, file)) {
      for (const name of namedPaths(line.text, true)) {
        const located = locateNamed(name, file.path, files, options);
        if (located.via === 'none' || located.via === 'external' || located.candidates) continue;
        if (files.has(located.path) && located.path !== file.path) named.add(located.path);
      }
    }
  }
  return named;
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

/** A clause led by one of these is a condition or a purpose, not the directive itself. */
const SUBORDINATE =
  /^(?:if|when|whenever|unless|whether|because|although|though|since|once|while|after|as\s+soon\s+as|in\s+case)\b/;
/** A head with one of these words lifts the requirement: "do not read", "you need not read", "optionally read". */
const NEGATED = /\b(?:not|never|no|nor|neither|cannot|optional|optionally)\b|n't\b/;

/** Whether the words before "read" make it a directive: no negation, and not itself a condition. */
export function directiveHead(head: string): boolean {
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
export function maskLine(line: string): MaskedLine {
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

export function unmask(text: string, spans: readonly string[]): string {
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
export function gateClauses(text: string, splitCoordinated = true): string[] {
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
    .flatMap((clause) => (splitCoordinated ? clause.split(/,\s*(?:and|but)\s+(?=\S)/i) : [clause]))
    .map((clause) =>
      clause
        .replace(/\*\*/g, '')
        .replace(/^\s*(?:[-+*]\s+)?(?:\d+[.)]\s+)?(?:[A-Z]+#?\d+[.:]\s+)?/i, '')
        .trim(),
    )
    .filter((clause) => clause !== '');
}

/**
 * The non-blank lines of a chunk, numbered as lines of its file. The reader and every code pass read each
 * chunk, so the lines are kept per chunk and source; a caller reads them and never changes them.
 */
const MASKED_PROSE = new WeakMap<EstateFile, string[]>();
const CHUNK_LINES = new WeakMap<
  ProseChunk,
  { source: EstateFile | undefined; lines: Array<{ line: number; text: string; quote: string }> }
>();
export function chunkLines(
  chunk: ProseChunk,
  source?: EstateFile,
): Array<{ line: number; text: string; quote: string }> {
  const kept = CHUNK_LINES.get(chunk);
  if (kept && kept.source === source) return kept.lines;
  const lines = maskedChunkLines(chunk, source);
  CHUNK_LINES.set(chunk, { source, lines });
  return lines;
}

function maskedChunkLines(
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
      lines = maskIllustrativePrefixes(
        blankFences(original.map((line, index) => (index < body - 1 ? '' : line)).join('\n')),
      ).split('\n');
      MASKED_PROSE.set(source, lines);
    }
    masked = lines.slice(chunk.startLine - 1, chunk.endLine).join('\n');
  } else masked = blankFences(chunk.text);
  // The quote is the line as written in the file: masking a counter-example or an illustration never edits it.
  const original = source
    ? source.text.split('\n').slice(chunk.startLine - 1, chunk.endLine)
    : chunk.text.split('\n');
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
