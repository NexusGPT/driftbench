import type { Located } from './text';

/**
 * The one interface between the generic scanner and a runtime. A reader knows its runtime's file layout and
 * file formats (where the standing instructions live, how a guard is declared, what a permission rule looks
 * like) and returns the estate as raw files with their kinds, plus the declarations it parsed, each with the
 * exact passage it was read from. The scanner turns declarations into atoms; it never opens a file itself.
 */

export const FILE_KINDS = [
  'standing',
  'memory',
  'skill',
  'skill_file',
  'subagent',
  'settings',
  'guard_script',
  'registry',
  'step_list',
  'other',
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** One file of the estate. `owner` names the skill a skill file belongs to. */
export type EstateFile = { path: string; kind: FileKind; text: string; owner?: string };

/** A value read from a declaration, with the passage it was read from. */
export type Read<T> = { value: T; at: Located };

/** A skill: its definition file, name, description, tools and where its body starts. */
export type SkillDecl = {
  name: string;
  file: string;
  /** The folder of the skill, relative to the root. Paths its body names resolve from here. */
  folder: string;
  at: Located;
  description?: Read<string>;
  tools: Array<Read<string>>;
  fields: Record<string, unknown>;
  body: { startLine: number; endLine: number };
};

/** A helper agent: its contract as its frontmatter states it. */
export type SubagentDecl = {
  name: string;
  file: string;
  at: Located;
  description?: Read<string>;
  tools: Array<Read<string>>;
  model?: Read<string>;
  effort?: Read<string>;
  skills: Array<Read<string>>;
  fields: Record<string, unknown>;
  body: { startLine: number; endLine: number };
};

/** A guard: the event it runs on, the matcher, the command and the script the command runs. */
export type GuardDecl = {
  event: string;
  matcher?: string;
  command: string;
  /** The script the command runs, relative to the root, when the command names one. */
  script?: string;
  /** True when the command finds its script from an anchor (the project folder), not the working folder. */
  anchored: boolean;
  /** `estate` for a guard of the settings, else the name of the skill that declares it. */
  scope: string;
  timeout?: number;
  at: Located;
};

export type PermissionDecl = {
  effect: 'allow' | 'deny' | 'ask';
  rule: string;
  /** The tool the rule names, such as Bash for `Bash(git status)`. */
  tool: string;
  /** The argument pattern, when the rule has one. */
  pattern?: string;
  at: Located;
};

/** A setting: its key and, when it is safe to keep, its value. Environment values are never kept. */
export type SettingDecl = { key: string; value?: string; at: Located };

/** One row of a check registry: a guard and the rules it enforces, by id or by a quoted passage. */
export type RegistryRow = {
  id: string;
  guard: string;
  event?: string;
  enforces: Array<{ id: string } | { quote: string }>;
  verdict?: string;
  at: Located;
};

/** One step of a step list. `anytime` steps may happen at any point; the others follow `next`. */
export type StepDecl = { id: string; title?: string; next: string[]; anytime: boolean; at: Located };

/** A passage of prose a model splits into atoms: the body of an instruction file. */
export type ProseChunk = { id: string; file: string; startLine: number; endLine: number; text: string };

/** A problem a reader met: a file it could not parse, a declaration with a missing field. */
export type ReadNote = { file: string; message: string };

/** The labels the runtime's trace gives the tools an atom's evidence names. */
export type ToolLabels = { read: string; edit: string; write: string; shell: string; dispatch: string };

export type RawEstate = {
  runtime: string;
  labels: ToolLabels;
  files: EstateFile[];
  skills: SkillDecl[];
  subagents: SubagentDecl[];
  guards: GuardDecl[];
  permissions: PermissionDecl[];
  settings: SettingDecl[];
  registry: RegistryRow[];
  steps: StepDecl[];
  prose: ProseChunk[];
  notes: ReadNote[];
};

export interface EstateReader {
  /** The runtime the reader understands, recorded in the map: claude-code, ... */
  readonly runtime: string;
  /** Reads the estate at `root`. Paths in the result are relative to `root`, with forward slashes. */
  read(root: string): Promise<RawEstate>;
}
