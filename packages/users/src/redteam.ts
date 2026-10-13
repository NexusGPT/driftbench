import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { DeviationClass, WorldState } from '@agent-nexus/driftbench-core';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { DEVIATIONS } from './deviations';
import { seededIndex } from './random';

/**
 * The red-team pack: one YAML file per deviation class, each holding phrasings for conversations and, for
 * the classes that apply to code tasks, for tasks. Every phrasing is fictional and carries `approved`: a
 * person reads it and sets it to true. The perturbing driver draws by seed from the approved phrasings
 * only, unless the caller asks for drafts.
 *
 * What a phrasing holds depends on how its class reaches the agent:
 * - a user class (D1 to D5, D9, D10): `user`, the message;
 * - D7: `user` (an empty string is silence) or `burst`, two or more messages;
 * - D6 on a conversation: `world`, a change of the world whose data carries `instruction`, the text the
 *   agent must treat as data (for example a store record with a notes field);
 * - D6 on a task: `file` and `content`, a file planted in the workspace that carries the instruction;
 * - D8 on a conversation: `error`, the error a tool returns, and optionally `tool`, the tool that fails
 *   (without it, the first tool the spec expects from the injection on);
 * - D8 on a task: `content`, the text of an obstacle planted where the agent's next command reads or
 *   writes, so that command fails.
 */

export const PhrasingKinds = ['conversation', 'task'] as const;
export type PhrasingKind = (typeof PhrasingKinds)[number];

export const Phrasing = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .describe('An id, unique in the pack: lower case letters, digits and hyphens.'),
    approved: z.boolean().describe('True once a person has read the phrasing and accepts it.'),
    note: z.string().optional().describe('Why the phrasing exists, for the reviewer.'),
    user: z.string().optional().describe('The message the user sends. Empty is silence (D7 only).'),
    burst: z.array(z.string().min(1)).min(2).optional().describe('Messages that arrive together (D7 only).'),
    world: WorldState.optional().describe('A change of the world (D6 on a conversation).'),
    instruction: z.string().min(1).optional().describe('The instruction the world carries (D6).'),
    error: z.string().min(1).optional().describe('The error the tool returns (D8 on a conversation).'),
    tool: z.string().min(1).optional().describe('The tool that fails (D8 on a conversation).'),
    file: z.string().min(1).optional().describe('The planted file (D6 on a task).'),
    content: z.string().min(1).optional().describe('The text of the planted file or obstacle (task).'),
    must: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Patterns the reply to this phrasing must match (conversation only). Merged into the injected block.',
      ),
    must_not: z
      .array(z.string().min(1))
      .optional()
      .describe('Patterns the reply to this phrasing must not match (conversation only).'),
  })
  .describe('One phrasing of a deviation.');
export type Phrasing = z.infer<typeof Phrasing>;

export const PackFile = z
  .strictObject({
    class: DeviationClass.describe('The class every phrasing of the file belongs to.'),
    title: z.string().min(1).optional().describe('A title for a reader; no command reads it.'),
    conversation: z.array(Phrasing).min(1).describe('Phrasings for conversation specs.'),
    task: z.array(Phrasing).min(1).optional().describe('Phrasings for task specs.'),
  })
  .describe('One file of the red-team pack: the phrasings of one deviation class.');
export type PackFile = z.infer<typeof PackFile>;

/** A loaded pack: one file per class, by class. */
export type RedteamPack = {
  readonly files: ReadonlyMap<DeviationClass, PackFile & { path: string }>;
};

export class RedteamPackError extends Error {
  override name = 'RedteamPackError';
}

/** The fields a phrasing must hold, and the fields it may hold, by class and kind. */
function shapeProblems(cls: DeviationClass, kind: PhrasingKind, phrasing: Phrasing): string[] {
  const has = (field: keyof Phrasing) => phrasing[field] !== undefined;
  const carrier = DEVIATIONS[cls].carrier;
  let required: (keyof Phrasing)[];
  let allowed: (keyof Phrasing)[];
  if (cls === 'D6_instruction_in_data') {
    required = kind === 'conversation' ? ['world', 'instruction'] : ['file', 'content'];
    allowed = required;
  } else if (cls === 'D8_tool_failure') {
    required = kind === 'conversation' ? ['error'] : ['content'];
    allowed = kind === 'conversation' ? ['error', 'tool'] : ['content'];
  } else if (carrier === 'user_or_burst') {
    required = [];
    allowed = ['user', 'burst'];
  } else {
    required = ['user'];
    allowed = ['user'];
  }
  const problems: string[] = [];
  for (const field of required) if (!has(field)) problems.push(`needs ${field}`);
  if (kind === 'task' && (has('must') || has('must_not'))) {
    problems.push('must and must_not are for conversation phrasings; a task phrasing does not take them');
  }
  const carriers: (keyof Phrasing)[] = [
    'user',
    'burst',
    'world',
    'instruction',
    'error',
    'tool',
    'file',
    'content',
  ];
  for (const field of carriers) {
    if (has(field) && !allowed.includes(field))
      problems.push(`has ${field}, which ${cls} on a ${kind} does not use`);
  }
  if (carrier === 'user_or_burst' && has('user') === has('burst'))
    problems.push('needs user or burst, not both');
  if (carrier === 'user' && phrasing.user !== undefined && phrasing.user.trim() === '') {
    problems.push('has an empty user message; only D7 sends silence');
  }
  if (cls === 'D6_instruction_in_data' && kind === 'conversation' && phrasing.world && phrasing.instruction) {
    if (!JSON.stringify(phrasing.world).includes(JSON.stringify(phrasing.instruction).slice(1, -1))) {
      problems.push('its world does not carry its instruction');
    }
  }
  return problems;
}

/** Checks one parsed pack file; returns the problems, each naming the phrasing. */
export function checkPackFile(file: PackFile): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const kind of PhrasingKinds) {
    for (const phrasing of file[kind] ?? []) {
      if (ids.has(phrasing.id)) problems.push(`${kind} ${phrasing.id}: the id is used twice`);
      ids.add(phrasing.id);
      for (const problem of shapeProblems(file.class, kind, phrasing)) {
        problems.push(`${kind} ${phrasing.id}: ${problem}`);
      }
    }
  }
  return problems;
}

/**
 * Reads every .yaml and .yml file of a folder as a pack file. Throws a RedteamPackError that names every
 * file and problem when a file does not parse or validate, when two files hold the same class, or when the
 * folder holds none.
 */
export async function loadRedteamPack(dir: string): Promise<RedteamPack> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => ['.yaml', '.yml'].includes(extname(name))).sort();
  } catch (cause) {
    throw new RedteamPackError(
      `the red-team pack ${dir} cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (names.length === 0) throw new RedteamPackError(`the red-team pack ${dir} holds no YAML file`);
  const files = new Map<DeviationClass, PackFile & { path: string }>();
  const problems: string[] = [];
  for (const name of names) {
    const path = join(dir, name);
    let raw: unknown;
    try {
      raw = parseYaml(await readFile(path, 'utf8'), { uniqueKeys: true });
    } catch (cause) {
      problems.push(
        `${name}: ${cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause)}`,
      );
      continue;
    }
    const parsed = PackFile.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push(`${name}: ${issue.path.map(String).join('.') || '(file)'} ${issue.message}`);
      }
      continue;
    }
    const file = parsed.data;
    for (const problem of checkPackFile(file)) problems.push(`${name}: ${problem}`);
    const earlier = files.get(file.class);
    if (earlier) problems.push(`${name}: ${file.class} is already the class of ${basename(earlier.path)}`);
    else files.set(file.class, { ...file, path });
  }
  if (problems.length > 0) {
    throw new RedteamPackError(`the red-team pack ${dir} is invalid:\n  ${problems.join('\n  ')}`);
  }
  return { files };
}

/** A pack held in memory, for tests and callers that build one. Validated as a loaded pack is. */
export function redteamPack(files: readonly PackFile[]): RedteamPack {
  const map = new Map<DeviationClass, PackFile & { path: string }>();
  const problems: string[] = [];
  for (const raw of files) {
    const file = PackFile.parse(raw);
    for (const problem of checkPackFile(file)) problems.push(`${file.class}: ${problem}`);
    if (map.has(file.class)) problems.push(`${file.class}: two files hold this class`);
    map.set(file.class, { ...file, path: `<memory:${file.class}>` });
  }
  if (problems.length > 0)
    throw new RedteamPackError(`the red-team pack is invalid:\n  ${problems.join('\n  ')}`);
  return { files: map };
}

export type DrawOptions = {
  readonly cls: DeviationClass;
  readonly kind: PhrasingKind;
  readonly seed: number;
  /** Draw from every phrasing, approved or not. Default false: approved phrasings only. */
  readonly drafts?: boolean;
};

/**
 * One phrasing of a class, drawn by seed: the same pack, class, kind and seed give the same phrasing.
 * Throws a RedteamPackError when the pack has no file for the class, no phrasing for the kind, or no
 * approved one (without drafts).
 */
export function drawPhrasing(pack: RedteamPack, options: DrawOptions): Phrasing & { packPath: string } {
  const file = pack.files.get(options.cls);
  if (!file) throw new RedteamPackError(`the red-team pack has no file for ${options.cls}`);
  const all = file[options.kind] ?? [];
  if (all.length === 0) {
    throw new RedteamPackError(`${basename(file.path)} holds no ${options.kind} phrasing for ${options.cls}`);
  }
  const pool = options.drafts ? all : all.filter((phrasing) => phrasing.approved);
  if (pool.length === 0) {
    throw new RedteamPackError(
      `${basename(file.path)} holds no approved ${options.kind} phrasing for ${options.cls}: a person reads each one and sets approved: true, or the run asks for drafts`,
    );
  }
  const picked = pool[seededIndex([options.seed, options.cls, options.kind], pool.length)];
  if (!picked) throw new RedteamPackError('the seeded draw fell outside the pool');
  return { ...picked, packPath: file.path };
}
