import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type Atom, parseEstateMapText } from '@agent-nexus/driftbench-estate';
import { type Io, main } from '../../src/index';

/**
 * A generator of invented agent estates for the root, settings, map-location and output-size fixes.
 *
 * An estate is described by ROLES, never by file names:
 *   capabilities  parts the model can load on demand (each reached by the instruction)
 *   policies      parts that can block an action (each wired by a settings source, each backed by a script)
 *   strays        parts nothing names
 * A LAYOUT renders the roles into files for the runtime. A SETTINGS SOURCE decides where the wiring of the
 * policies is stored. The expected counts come from the roles and the first principles of the runtime (a
 * policy exists for the runtime only when its wiring is read; a part nothing names is a stray), never from
 * the output of the product. Every name is invented here from the seed.
 */

export type Layout =
  /** The runtime's own layout, scanned from its root. */
  | 'project'
  /** The same layout, the project sitting deeper in a workspace folder. */
  | 'nested'
  /** The scan root is the parent of the project: the runtime would not start there. */
  | 'parent'
  /** Roles rendered in a layout the runtime does not read. */
  | 'foreign'
  /** A folder with no part at all. */
  | 'empty'
  /** A folder holding only files an editor or an operating system leaves. */
  | 'junk-only';

export type SettingsSource =
  /** Wiring stored with the estate, in the settings file the runtime reads. */
  | 'stored'
  /** Wiring stored in the local settings file the runtime also reads. */
  | 'local'
  /** Wiring rendered at install time: not stored; a copy is handed over. */
  | 'rendered'
  /** No wiring anywhere. */
  | 'absent';

export type Roles = { capabilities: number; policies: number; strays: number };

export type Variant = { layout: Layout; settings: SettingsSource; roles: Roles; seed: number };

export const LAYOUTS: readonly Layout[] = ['project', 'nested', 'parent', 'foreign', 'empty', 'junk-only'];
export const SETTINGS_SOURCES: readonly SettingsSource[] = ['stored', 'local', 'rendered', 'absent'];

/** What the runtime must make of a variant, from its rules. */
export type Expected = {
  /** Parts of any kind the scan reads: zero means the scan read nothing. */
  readsSomething: boolean;
  /** Capabilities the runtime loads from this layout. */
  capabilities: number;
  /** Policies whose wiring the runtime reads. */
  policies: number;
  /** Parts nothing names, among the parts read. */
  strays: number;
};

export type Rendered = {
  /** The folder that holds everything. */
  top: string;
  /** The folder to scan. */
  root: string;
  /** For the `rendered` settings source: the file handed over. */
  settingsFile?: string;
  /** The guard scripts, as paths from the scan root, for the tests that delete one. */
  scripts: string[];
  /** The stray files, as paths from the scan root. */
  strayFiles: string[];
  expected: Expected;
};

const SYLLABLES = ['ba', 'lo', 'ri', 'ten', 'mu', 'sa', 'dro', 'vi', 'ko', 'pel', 'zan', 'ur', 'fe', 'gol'];

/** Invented names: the same seed and index give the same name, and no name repeats within a seed. */
export function invent(seed: number, count: number, prefix: string): string[] {
  const out: string[] = [];
  let state = (seed * 2654435761) >>> 0;
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state ^ (index + 1), 1103515245) + 12345) >>> 0;
    const a = SYLLABLES[state % SYLLABLES.length];
    const b = SYLLABLES[(state >>> 8) % SYLLABLES.length];
    out.push(`${prefix}-${a}${b}-${index}`);
  }
  return out;
}

export function title(variant: Variant): string {
  const { capabilities, policies, strays } = variant.roles;
  return `${variant.layout}/${variant.settings} c${capabilities} p${policies} s${strays}`;
}

const INSTRUCTION = '# Quay desk assistant\n\nAlways answer in the language of the user.\n';

function skillText(name: string): string {
  return `---\nname: ${name}\ndescription: Handles one kind of request for the quay desk.\n---\n\nFollow the steps for ${name}.\n`;
}

function routingTable(capabilities: readonly string[]): string {
  if (capabilities.length === 0) return '';
  const rows = capabilities.map((name) => `| handle ${name} | \`${name}\` |`);
  return `\n| When the user wants to | Load |\n|---|---|\n${rows.join('\n')}\n`;
}

function registryText(guardFiles: readonly string[]): string {
  const rows = guardFiles.map((file, index) => `| G${index + 1} | ${file} | none |`);
  return `# Check registry\n\n| Id | Guard | Enforces |\n|---|---|---|\n${rows.join('\n')}\n`;
}

function settingsText(commands: readonly string[]): string {
  const hooks = commands.map((command) => ({ type: 'command', command }));
  return `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks }] } }, null, 2)}\n`;
}

async function put(base: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(base, path)), { recursive: true });
    await writeFile(join(base, path), text);
  }
}

/** Writes the variant into a fresh folder and says what the runtime must make of it. */
export async function render(variant: Variant): Promise<Rendered> {
  const top = await mkdtemp(join(tmpdir(), 'driftbench-variant-'));
  const { roles, seed } = variant;
  const capabilities = invent(seed, roles.capabilities, 'cap');
  const guards = invent(seed, roles.policies, 'guard');
  const strays = invent(seed, roles.strays, 'stray');
  const scripts: string[] = [];
  const strayFiles: string[] = [];
  const none: Expected = { readsSomething: false, capabilities: 0, policies: 0, strays: 0 };

  if (variant.layout === 'empty') return { top, root: top, scripts, strayFiles, expected: none };
  if (variant.layout === 'junk-only') {
    await put(top, { '.DS_Store': 'x', 'draft.txt~': 'x', 'node_modules/pkg/index.js': 'x' });
    return { top, root: top, scripts, strayFiles, expected: none };
  }

  if (variant.layout === 'foreign') {
    // Roles in a layout of nobody's runtime: the files exist, the runtime loads none of them.
    const files: Record<string, string> = { 'guide.txt': INSTRUCTION };
    for (const name of capabilities) files[`abilities/${name}/about.txt`] = skillText(name);
    for (const guard of guards) files[`rules/${guard}.sh`] = '#!/bin/sh\nexit 0\n';
    for (const stray of strays) files[`misc/${stray}.txt`] = 'nothing names this\n';
    await put(top, files);
    return { top, root: top, scripts, strayFiles, expected: none };
  }

  // The runtime's layout. The project sits at the scan root, or deeper, or one level below it.
  const projectBase =
    variant.layout === 'project' ? 'home' : variant.layout === 'nested' ? 'workspace/deep' : 'proj';
  const root = variant.layout === 'parent' ? top : join(top, projectBase);
  const at = (path: string) => `${projectBase}/${path}`;
  const guardFiles = guards.map((guard) => `${guard}.sh`);
  const commands = guardFiles.map((file) => `"$CLAUDE_PROJECT_DIR"/.claude/guards/${file}`);
  const files: Record<string, string> = {
    [at('CLAUDE.md')]: `${INSTRUCTION}${routingTable(capabilities)}`,
  };
  for (const name of capabilities) files[at(`.claude/skills/${name}/SKILL.md`)] = skillText(name);
  for (const file of guardFiles) {
    files[at(`.claude/guards/${file}`)] = '#!/bin/sh\nexit 0\n';
    scripts.push(`.claude/guards/${file}`);
  }
  if (guards.length > 0) files[at('.claude/guards/CHECK-REGISTRY.md')] = registryText(guardFiles);
  for (const stray of strays) {
    files[at(`.claude/notes/${stray}.md`)] = `# ${stray}\n`;
    strayFiles.push(`.claude/notes/${stray}.md`);
  }
  let settingsFile: string | undefined;
  if (guards.length > 0 && variant.settings === 'stored')
    files[at('.claude/settings.json')] = settingsText(commands);
  if (guards.length > 0 && variant.settings === 'local')
    files[at('.claude/settings.local.json')] = settingsText(commands);
  if (guards.length > 0 && variant.settings === 'rendered') {
    settingsFile = join(top, 'rendered', 'install-output.json');
    files['rendered/install-output.json'] = settingsText(commands);
  }
  await put(top, files);

  const wired = variant.settings !== 'absent' && guards.length > 0;
  // A scan rooted above the project reads only the standing files below it (the runtime loads those on demand).
  const atProject = variant.layout !== 'parent';
  return {
    top,
    root,
    ...(settingsFile ? { settingsFile } : {}),
    scripts: atProject ? scripts : [],
    strayFiles: atProject ? strayFiles : [],
    expected: {
      readsSomething: true,
      capabilities: atProject ? roles.capabilities : 0,
      policies: atProject && wired ? roles.policies : 0,
      strays: atProject ? roles.strays : 0,
    },
  };
}

/** Runs the CLI in a folder and captures what it printed. */
export async function cli(argv: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

/** What `estate lint --json` prints: the findings shown and, per code, the total, the number shown and the number omitted. */
export type LintData = {
  failed: boolean;
  findings: Array<{ code: string; subject: string; message: string }>;
  totals: Array<{ code: string; total: number; shown: number; omitted: number }>;
  checks: Array<{
    check: string;
    status: 'pass' | 'fail' | 'not-run';
    notRun?: string;
    read: number;
    skipped: number;
    missing: string[];
  }>;
  notRun: boolean;
  /** The closing verdict of the report. */
  summary: 'findings' | 'none-ran' | 'unknown-files' | 'clean';
  unknown: number;
};

export function lintData(out: string): LintData {
  return JSON.parse(out) as LintData;
}

/** The true total of every code a lint reported. */
export function findingCounts(out: string): Record<string, number> {
  return Object.fromEntries(lintData(out).totals.map((entry) => [entry.code, entry.total]));
}

/** The subjects of the findings a lint listed for a code, in order. */
export function listedSubjects(out: string, code: string): string[] {
  return lintData(out)
    .findings.filter((finding) => finding.code === code)
    .map((finding) => finding.subject);
}

/** The atoms of a written map. */
export async function atomsOf(mapFile: string): Promise<Atom[]> {
  const parsed = parseEstateMapText(await readFile(mapFile, 'utf8'));
  if (!parsed.ok) throw new Error(`the map ${mapFile} does not load`);
  return parsed.map.atoms;
}

/** The atoms of a map, counted by kind. */
export function countByKind(atoms: readonly Atom[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const atom of atoms) counts[atom.kind] = (counts[atom.kind] ?? 0) + 1;
  return counts;
}

/** The invariant atom of a check, or undefined when the scan measured none. */
export function invariantOf(atoms: readonly Atom[], check: string): Atom | undefined {
  return atoms.find((atom) => atom.kind === 'invariant' && atom.fields?.check === check);
}

/** A copy of a folder at a deeper place, for the tests that move an estate. */
export async function copyTo(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}
