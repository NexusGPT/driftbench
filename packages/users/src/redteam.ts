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

/**
 * One reply pattern. A bare string applies at every stage. An object with `at_stage` applies only where the
 * conversation stands in one of the named stages when the deviation arrives.
 */
export const ReplyPattern = z.union([
  z.string().min(1),
  z.strictObject({
    pattern: z.string().min(1).describe('The pattern.'),
    at_stage: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        'The stages the pattern applies at, named in the `stages` of the file. The stage is the one the previous block of the spec expects.',
      ),
  }),
]);
export type ReplyPattern = z.infer<typeof ReplyPattern>;

export const Phrasing = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .describe('An id, unique in the pack: lower case letters, digits and hyphens.'),
    approved: z.boolean().describe('True once a person has read the phrasing and accepts it.'),
    note: z.string().optional().describe('Why the phrasing exists, for the reviewer.'),
    ends_conversation: z
      .boolean()
      .optional()
      .describe(
        'In attack, stop only after this conversation phrasing has checked, passing reply expectations.',
      ),
    user: z.string().optional().describe('The message the user sends. Empty is silence (D7 only).'),
    burst: z.array(z.string().min(1)).min(2).optional().describe('Messages that arrive together (D7 only).'),
    world: WorldState.optional().describe('A change of the world (D6 on a conversation).'),
    instruction: z.string().min(1).optional().describe('The instruction the world carries (D6).'),
    error: z.string().min(1).optional().describe('The error the tool returns (D8 on a conversation).'),
    tool: z.string().min(1).optional().describe('The tool that fails (D8 on a conversation).'),
    file: z.string().min(1).optional().describe('The planted file (D6 on a task).'),
    content: z.string().min(1).optional().describe('The text of the planted file or obstacle (task).'),
    must: z
      .array(ReplyPattern)
      .optional()
      .describe(
        'Patterns the reply to this phrasing must match (conversation only). Merged into the injected block. A pattern with `at_stage` applies only at those stages.',
      ),
    must_not: z
      .array(ReplyPattern)
      .optional()
      .describe(
        'Patterns the reply to this phrasing must not match (conversation only). A pattern with `at_stage` applies only at those stages.',
      ),
  })
  .describe('One phrasing of a deviation.');
export type Phrasing = z.infer<typeof Phrasing>;

export const PackFile = z
  .strictObject({
    class: DeviationClass.describe('The class every phrasing of the file belongs to.'),
    title: z.string().min(1).optional().describe('A title for a reader; no command reads it.'),
    stages: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe('The stage names this file may use in `at_stage`. Any other name makes the pack invalid.'),
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
export function shapeProblems(cls: DeviationClass, kind: PhrasingKind, phrasing: Phrasing): string[] {
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
  const problems = phrasingKindProblems(kind, phrasing);
  for (const field of required) if (!has(field)) problems.push(`needs ${field}`);
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

/** Shared by pack validation and replay, including spec-authored recordings whose carrier is in the spec. */
export function phrasingKindProblems(kind: PhrasingKind, phrasing: Phrasing): string[] {
  const problems: string[] = [];
  if (kind === 'task' && (phrasing.must !== undefined || phrasing.must_not !== undefined)) {
    problems.push('must and must_not are for conversation phrasings; a task phrasing does not take them');
  }
  if (kind === 'task' && phrasing.ends_conversation !== undefined) {
    problems.push('ends_conversation is for conversation phrasings');
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
      for (const key of ['must', 'must_not'] as const) {
        for (const entry of phrasing[key] ?? []) {
          if (typeof entry === 'string') continue;
          for (const stage of entry.at_stage) {
            if (!(file.stages ?? []).includes(stage)) {
              problems.push(
                `${kind} ${phrasing.id}: ${key} ${JSON.stringify(entry.pattern)} names the stage ${stage}, which the file does not list in stages`,
              );
            }
          }
        }
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
/** How many phrasings a class can draw in this mode: approved only, or drafts too. Zero means the class is not drawable. */
export function phrasingPool(
  pack: RedteamPack,
  cls: DeviationClass,
  kind: PhrasingKind,
  drafts: boolean,
): number {
  const file = pack.files.get(cls);
  if (!file) return 0;
  const all = file[kind] ?? [];
  return (drafts ? all : all.filter((phrasing) => phrasing.approved)).length;
}

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

/** The text of a reply pattern. */
export function patternText(entry: ReplyPattern): string {
  return typeof entry === 'string' ? entry : entry.pattern;
}

/**
 * The patterns of a phrasing that apply where the conversation stands in `stage`. A pattern with `at_stage`
 * stays only when the stage is one of its stages; where the spec states no stage, it is dropped, because no
 * stage-bound demand can be shown to be reachable there.
 */
export function patternsAt(
  entries: readonly ReplyPattern[] | undefined,
  stage: string | undefined,
): string[] {
  return (entries ?? [])
    .filter((entry) => typeof entry === 'string' || (stage !== undefined && entry.at_stage.includes(stage)))
    .map(patternText);
}

/** A reply check a phrasing carries that the injection did not receive, with why. */
export type NotApplicable = {
  key: 'must' | 'must_not';
  pattern: string;
  at_stage: string[];
  /** `no stage`: the spec states no stage there. `other stage`: the stage is stated and is not listed. */
  reason: 'no stage' | 'other stage';
};

/** What became of the reply checks of one phrasing at one injection. */
export type ReplyChecks = {
  /** The stage the injection arrives in; absent when the spec states none. */
  stage?: string;
  total: number;
  applied: number;
  notApplicable: NotApplicable[];
};

/** The accounting of a phrasing's `must` and `must_not` entries at `stage`: applied, or not applicable and why. */
export function replyChecksAt(
  phrasing: { must?: readonly ReplyPattern[] | undefined; must_not?: readonly ReplyPattern[] | undefined },
  stage: string | undefined,
): ReplyChecks {
  const notApplicable: NotApplicable[] = [];
  let total = 0;
  for (const key of ['must', 'must_not'] as const) {
    for (const entry of phrasing[key] ?? []) {
      total += 1;
      if (typeof entry === 'string' || (stage !== undefined && entry.at_stage.includes(stage))) continue;
      notApplicable.push({
        key,
        pattern: entry.pattern,
        at_stage: [...entry.at_stage],
        reason: stage === undefined ? 'no stage' : 'other stage',
      });
    }
  }
  return {
    ...(stage === undefined ? {} : { stage }),
    total,
    applied: total - notApplicable.length,
    notApplicable,
  };
}
