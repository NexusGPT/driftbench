/**
 * Shared walk openings, measured once. A spec's leading blocks whose machine Then another complete spec
 * already measures add no test of their own: the same Then, reached the same way, judged on every agent the
 * same. They move into the Given prefix of the first block that stays, as the conversation so far.
 */

import { isPlainObject, type Spec } from '@agent-nexus/driftbench-core';
import { machineSignature } from '../gate';

type Plain = Record<string, unknown>;
type PrefixMessage = { role: 'user' | 'assistant'; content: string; tool_calls?: PrefixCall[] };
type PrefixCall = { id: string; label: string; input: unknown; output: unknown };

/** A literal JSON value: what a prefix call can carry as the argument the turn sent. */
function literal(value: unknown): boolean {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(literal);
  if (isPlainObject(value)) {
    // An assertion object ({ regex }, { one_of }, ...) is not a value the user sent.
    return false;
  }
  return false;
}

/**
 * The prefix messages one block turns into, or undefined when it cannot be one: a block said as a probe, a
 * block whose tool runs read no literal argument, a tool whose answer the Given does not fix, or a call
 * whose effect the spec's end state reads. The
 * assistant turn has no words: only the calls it made, with the arguments the Then asserts and the
 * answers the Given world returns, so nothing in it is a reply the agent would read as its own.
 */
function asPrefix(spec: Plain, block: Plain, index: number): PrefixMessage[] | undefined {
  const when = block.when as Plain | undefined;
  if (!when || typeof when.user !== 'string' || 'injection' in when) return undefined;
  if (block.given !== undefined) return undefined;
  const expect = (block.expect ?? {}) as Plain;
  const tools = (expect.tools ?? []) as Plain[];
  const world = (((spec.given as Plain | undefined)?.world as Plain | undefined)?.tools ?? {}) as Record<
    string,
    Plain
  >;
  // A call the spec's end state reads changes the world the run checks at the end: it must run, not be told.
  const endState = spec.end_state;
  const sources = new Set(
    (Array.isArray(endState) ? endState : isPlainObject(endState) ? [endState] : []).map((entry) =>
      String((entry as Plain).source ?? '').replace(/^tool:/, ''),
    ),
  );
  const calls: PrefixCall[] = [];
  for (const tool of tools) {
    const count = tool.count;
    if (count === 0) continue;
    if (sources.has(tool.label as string) || endState === 'none') return undefined;
    if (count !== 1) return undefined;
    const input = (tool.input ?? {}) as Plain;
    if (!Object.values(input).every(literal)) return undefined;
    const label = tool.label as string;
    const answer = world[label];
    if (!answer || !('result' in answer)) return undefined;
    calls.push({ id: `prefix-${index + 1}-${label}`, label, input, output: answer.result });
  }
  return [
    { role: 'user', content: when.user },
    { role: 'assistant', content: '', ...(calls.length > 0 ? { tool_calls: calls } : {}) },
  ];
}

/**
 * Moves the leading blocks of a complete spec whose machine signature an earlier complete spec measures
 * into the Given prefix of the first block that stays. The last block always stays, and so does every
 * block from the first one that cannot be a prefix. `measured` holds the signatures of the complete specs
 * written so far; the spec's own measured blocks join it. The spec object is changed in place; the number of
 * blocks moved is returned.
 */
export function prefixRepeated(spec: Plain, measured: Set<string>): number {
  const blocks = (spec.blocks ?? []) as Plain[];
  const signature = (index: number) => machineSignature(spec as unknown as Spec, index);
  const prefix: PrefixMessage[] = [];
  let moved = 0;
  // A perturbation is said before a block by its index: the blocks before it stay where they are.
  const injectAt = Math.min(
    blocks.length - 1,
    ...((spec.perturbations ?? []) as Plain[]).map((entry) => (entry.inject_at as number) ?? 0),
  );
  while (moved < injectAt) {
    const block = blocks[moved] as Plain;
    if (!measured.has(signature(moved))) break;
    const messages = asPrefix(spec, block, moved);
    if (!messages) break;
    prefix.push(...messages);
    moved += 1;
  }
  if (moved > 0) {
    const kept = blocks.slice(moved);
    const first = kept[0] as Plain;
    kept[0] = { ...first, given: { ...((first.given as Plain | undefined) ?? {}), prefix } };
    // Key order of a block: id, given, when, expect, as the spec schema lists them.
    const { id, given, ...rest } = kept[0] as Plain;
    kept[0] = { id, given, ...rest };
    spec.blocks = kept;
    const generated = ((spec.metadata as Plain | undefined)?.generated ?? {}) as Plain;
    if (Array.isArray(generated.blocks)) generated.blocks = (generated.blocks as unknown[]).slice(moved);
    if (Array.isArray(spec.perturbations))
      spec.perturbations = (spec.perturbations as Plain[]).map((entry) => ({
        ...entry,
        inject_at: (entry.inject_at as number) - moved,
      }));
  }
  const remaining = (spec.blocks ?? []) as Plain[];
  remaining.forEach((_block, index) => {
    measured.add(signature(index));
  });
  return moved;
}
