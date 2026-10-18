import { stringify as stringifyYaml } from 'yaml';
import type { Expect } from '../schema/spec';
import { type LoadResult, validateSpec } from '../spec/load';

/**
 * A script API that compiles to a driftbench conversation spec: `user`, `agent`, `judge`, `injection`. Each step maps onto the spec's own shape, and a
 * step with no spec equivalent throws a ScriptError that says why, so nothing is dropped in silence.
 *
 * - `user(text, expect)` opens a block whose stimulus is the user's message. `expect` holds its expectations.
 * - `injection(class, text, expect)` opens a block whose stimulus is a deviation of that class.
 * - `agent(expect)` adds expectations to the reply of the last block. It needs a block before it.
 * - `judge(criteria)` names judged criteria on the last block. A final verdict without criteria has no spec
 *   form, so `judge()` with no names throws.
 * - `proceed(n, { hint, expect })` reserves n turns for the simulated user: n blocks whose stimulus is the hint,
 *   listed in the spec metadata. The simulated driver plays them at run time.
 * - `succeed()` and `fail()` have no spec form: the spec has no early-stop step. Each throws.
 */

/** A ScriptError: a step the script API cannot compile, or one used out of order. */
export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptError';
  }
}

/** The expectations a block takes: any field of the spec's Expect. */
export type Expectations = Partial<Expect>;

/** One step of a script. Build them with the functions of this module; the shape is internal. */
export type Turn =
  | { readonly kind: 'user'; readonly text: string; readonly expect: Expectations }
  | {
      readonly kind: 'injection';
      readonly deviation: string;
      readonly text: string;
      readonly expect: Expectations;
    }
  | { readonly kind: 'agent'; readonly expect: Expectations }
  | { readonly kind: 'judge'; readonly criteria: readonly string[] }
  | { readonly kind: 'end'; readonly verdict: 'success' | 'failure'; readonly reason?: string }
  | {
      readonly kind: 'proceed';
      readonly turns: number;
      readonly hint: string;
      readonly expect: Expectations;
    };

/** The options of the spec a script compiles to. Every field is optional and passes through unchanged. */
export type ConversationOptions = {
  title?: string;
  description?: string;
  channel?: string;
  lang?: string;
  stages?: readonly string[];
  /** Judged criteria, as the spec's CriterionDef objects. Blocks reference them by name. */
  criteria?: readonly Record<string, unknown>[];
};

/** A compiled conversation: the spec object, and the loader's verdict on it. */
export type ConversationResult = {
  spec: Record<string, unknown>;
  load: LoadResult;
};

/** A user message: the block's stimulus, and what the reply must show. */
export function user(text: string, expect: Expectations = {}): Turn {
  return { kind: 'user', text, expect };
}

/** A deviation written into the conversation, with its class (D1_off_topic and the rest of the ten). */
export function injection(deviation: string, text: string, expect: Expectations = {}): Turn {
  return { kind: 'injection', deviation, text, expect };
}

/** Expectations on the reply to the last block. Needs a user turn or an injection before it. */
export function agent(expect: Expectations): Turn {
  return { kind: 'agent', expect };
}

/** Judged criteria, by name, on the last block. `name@gating` makes a fail fail the block. */
export function judge(criteria: readonly string[]): Turn {
  if (criteria.length === 0) {
    throw new ScriptError('judge() needs criteria: a final verdict with no criteria has no spec form');
  }
  return { kind: 'judge', criteria: [...criteria] };
}

/** The hint a reserved turn gives the simulated user when the script does not name one. */
export const DEFAULT_PROCEED_HINT = 'Continue the conversation toward your goal.';

/**
 * Reserves `turns` user turns for the simulated user. The spec holds one block per turn: its stimulus is the
 * hint, which the simulated driver reads as what the person means to say, and its expectations are `expect`.
 * The block positions, counted from 0, are listed in the spec's metadata, `simulated_blocks`, so a reader sees which turns the
 * simulated user plays. A run with a scripted driver sends the hint word for word.
 */
export function proceed(turns: number, options: { hint?: string; expect?: Expectations } = {}): Turn {
  if (typeof turns !== 'number') {
    throw new ScriptError('proceed() needs how many turns the simulated user plays');
  }
  if (!Number.isInteger(turns)) throw new ScriptError('proceed() needs a whole number of turns');
  if (turns < 1) throw new ScriptError('proceed() needs at least one turn');
  const hint = options.hint ?? DEFAULT_PROCEED_HINT;
  if (hint.trim() === '') throw new ScriptError('proceed() needs a hint that is not empty');
  return { kind: 'proceed', turns, hint, expect: options.expect ?? {} };
}

/**
 * `succeed(reason?)` ends the script with a success verdict where it stands: the run stops after the blocks before it.
 * The turns after it are kept as blocks the verdict skips; an agent() or judge() after it is refused.
 */
export function succeed(reason?: string): Turn {
  return { kind: 'end', verdict: 'success', ...(reason === undefined ? {} : { reason }) };
}

/** `fail(reason?)` ends the script with a failure verdict. Like `succeed`, it can come at any step. */
export function fail(reason?: string): Turn {
  return { kind: 'end', verdict: 'failure', ...(reason === undefined ? {} : { reason }) };
}

/**
 * Compiles a script into a conversation spec and validates it with the spec loader. Blocks are numbered b1,
 * b2 and so on. Throws a ScriptError for a step the spec cannot hold or one used out of order; a spec the
 * loader rejects comes back as `load.ok === false` with its issues.
 */
export function conversation(
  id: string,
  turns: readonly Turn[],
  options: ConversationOptions = {},
): ConversationResult {
  const blocks: Record<string, unknown>[] = [];
  const expects: Expectations[] = [];
  const simulated: number[] = [];
  let endSpec: { verdict: 'success' | 'failure'; reason?: string } | undefined;
  // The index of the last block before the end turn: the blocks after it are skipped by the verdict.
  let endAt = -1;
  for (const turn of turns) {
    if (turn.kind === 'end') {
      if (endSpec !== undefined) throw new ScriptError('the script has one succeed() or fail(), not two');
      endSpec = { verdict: turn.verdict, ...(turn.reason === undefined ? {} : { reason: turn.reason }) };
      endAt = blocks.length - 1;
      continue;
    }
    if (endSpec !== undefined && (turn.kind === 'agent' || turn.kind === 'judge')) {
      throw new ScriptError(
        `${turn.kind === 'agent' ? 'agent()' : 'judge()'} comes after succeed() or fail(): the block it checks is skipped by the verdict`,
      );
    }
    if (turn.kind === 'proceed') {
      for (let n = 0; n < turn.turns; n += 1) {
        const number = blocks.length + 1;
        blocks.push({ id: `b${number}`, when: { user: turn.hint } });
        expects.push({ ...turn.expect });
        simulated.push(blocks.length - 1);
      }
      continue;
    }
    if (turn.kind === 'user' || turn.kind === 'injection') {
      const number = blocks.length + 1;
      const block: Record<string, unknown> = {
        id: `b${number}`,
        when:
          turn.kind === 'user'
            ? { user: turn.text }
            : { injection: { class: turn.deviation, user: turn.text } },
      };
      blocks.push(block);
      expects.push({ ...turn.expect });
      continue;
    }
    const last = blocks.length - 1;
    const target = blocks[last];
    if (target === undefined) {
      throw new ScriptError(
        `${turn.kind === 'agent' ? 'agent()' : 'judge()'} comes after a user turn: none is before it`,
      );
    }
    const current = expects[last] ?? {};
    const addition: Expectations = turn.kind === 'agent' ? turn.expect : { criteria: [...turn.criteria] };
    expects[last] = mergeExpect(current, addition, String(target.id));
  }
  const compiled = blocks.map((block, index) => {
    const expect = expects[index] ?? {};
    return Object.keys(expect).length === 0 ? block : { ...block, expect };
  });
  const spec: Record<string, unknown> = { id, kind: 'conversation' };
  if (options.title !== undefined) spec.title = options.title;
  if (options.description !== undefined) spec.description = options.description;
  if (options.channel !== undefined) spec.channel = options.channel;
  if (options.lang !== undefined) spec.lang = options.lang;
  if (options.stages !== undefined) spec.stages = [...options.stages];
  if (options.criteria !== undefined) spec.criteria = [...options.criteria];
  spec.blocks = compiled;
  if (endSpec !== undefined) {
    // The verdict names its block only when blocks follow it; a script that ends on its last block keeps the short form.
    spec.end = endAt === blocks.length - 1 ? endSpec : { ...endSpec, atBlock: endAt };
  }
  if (simulated.length > 0) spec.metadata = { simulated_blocks: simulated };
  return { spec, load: validateSpec(spec, `script:${id}`) };
}

/** Writes a compiled spec as YAML, the form the loader reads. */
export function toYaml(spec: Record<string, unknown>): string {
  return stringifyYaml(spec);
}

/**
 * Merges expectations into one block. A list field concatenates; a scalar set twice in the same block is a
 * ScriptError, because one of the two would silently win.
 */
function mergeExpect(into: Expectations, more: Expectations, blockId: string): Expectations {
  const out: Record<string, unknown> = { ...into };
  for (const [key, value] of Object.entries(more)) {
    if (value === undefined) continue;
    const before = out[key];
    if (Array.isArray(value) && Array.isArray(before)) {
      out[key] = [...before, ...value];
    } else if (before !== undefined) {
      throw new ScriptError(`${key} is set twice in block ${blockId}`);
    } else {
      out[key] = value;
    }
  }
  return out as Expectations;
}
