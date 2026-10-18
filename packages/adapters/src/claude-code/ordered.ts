import { type CheckContext, machineVerdict, type Observed, type Verdict } from '@agent-nexus/driftbench-core';
import { isRecord } from './format';
import type { ReplayRaw } from './session';

/**
 * The ordered-pair check, registered as a custom check (`rules.custom.ordered`). A gate says "before X, do
 * Y"; the pair `{ before: Y, after: X }` holds in a block when every X of the block has a Y before it, in
 * this block or an earlier one of the run.
 *
 * A name matches a tool call by its label (`Read`), a skill load by `skill:<name>` and a stage by
 * `stage:<name>`. With `key`, the two must carry the same value in that input field (`file_path`: the same
 * file was read before it was edited). With `reset: compaction`, a Y before the last compaction preceding
 * the X does not count: what the agent read before a compaction is gone from its context.
 *
 * `before` may be a list: any one of its names before the X holds the pair (`before: [Read, Write]`). A
 * successful Write counts as a Read of what it wrote: after writing a file the agent holds its content, and
 * the runtime accepts an Edit of it, so `before: Read` with `key: file_path` is met by a Write of that file.
 * A Write that failed counts as nothing.
 *
 * An end written `Label~text` names a call of that tool whose command, file path or skill holds the text:
 * `Bash~git status` before `Bash~commit` tells two calls of one tool apart.
 *
 * Options: one pair, or `{ pairs: [...] }`. One verdict per pair, `ordered.<before>.<after>` (a list joined
 * by `_or_`), and none for a pair whose X does not occur in the block.
 */
export type OrderedPair = { before: string[]; after: string; key?: string; reset?: 'compaction' };

type Event = { names: string[]; input: Record<string, unknown>; block: number; describe: string } | 'reset';

export function orderedCheck(ctx: CheckContext, options: unknown): Verdict[] {
  const pairs = parsePairs(options);
  const earlier = ctx.history.map((block) => eventsOf(block.observed, block.index));
  const own = eventsOf(ctx.observed, ctx.blockIndex);
  const start = earlier.reduce((sum, list) => sum + list.length, 0);
  const all = [...earlier.flat(), ...own];
  return pairs.flatMap((pair): Verdict[] => {
    const missing: string[] = [];
    let seen = 0;
    for (let at = start; at < all.length; at += 1) {
      const event = all[at];
      if (event === undefined || event === 'reset' || !matches(event, pair.after)) continue;
      seen += 1;
      if (!hasBefore(all, at, pair, event)) missing.push(event.describe);
    }
    if (seen === 0) return [];
    const id = `${pair.before.map(safe).join('_or_')}.${safe(pair.after)}`;
    const before = pair.before.join(' or ');
    const same = pair.key === undefined ? '' : ` with the same ${pair.key}`;
    const reset = pair.reset === 'compaction' ? ' since the last compaction' : '';
    return [
      machineVerdict(
        'ordered',
        id,
        missing.length === 0 ? 'pass' : 'fail',
        missing.length === 0
          ? `every ${pair.after} in this block (${seen}) has a ${before}${same} before it${reset}`
          : `${missing.length} of ${seen} ${pair.after} in this block have no ${before}${same} before them${reset}: ${missing.join('; ')}`,
      ),
    ];
  });
}

function hasBefore(
  all: readonly (Event | undefined)[],
  at: number,
  pair: OrderedPair,
  after: Exclude<Event, 'reset'>,
): boolean {
  for (let index = at - 1; index >= 0; index -= 1) {
    const event = all[index];
    if (event === 'reset') {
      if (pair.reset === 'compaction') return false;
      continue;
    }
    if (event === undefined || !pair.before.some((name) => matches(event, name))) continue;
    if (pair.key === undefined || sameValue(event.input[pair.key], after.input[pair.key])) return true;
  }
  return false;
}

/** True when an event is the end a pair names: by name, or `Label~text` for a call holding the text. */
function matches(event: Exclude<Event, 'reset'>, name: string): boolean {
  if (event.names.includes(name)) return true;
  const cut = name.indexOf('~');
  if (cut <= 0) return false;
  const label = name.slice(0, cut);
  const text = name.slice(cut + 1);
  if (event.names[0] !== label || text === '') return false;
  const target =
    event.input.command ?? event.input.file_path ?? event.input.notebook_path ?? event.input.skill;
  return typeof target === 'string' && target.includes(text);
}

function sameValue(a: unknown, b: unknown): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

/** The block's events in order: tool calls (with skill names), stages by time, compaction markers. */
function eventsOf(observed: Observed, block: number): Event[] {
  const calls = observed.toolCalls;
  const events: Array<{ event: Event; order: number }> = calls.map((call, index) => {
    const input = isRecord(call.input) ? call.input : {};
    const names = [call.label];
    // A successful Write holds the content of what it wrote, as a Read of it would.
    if (call.label === 'Write' && call.error === undefined) names.push('Read');
    if (call.label === 'Skill') {
      const skill = input.skill ?? input.name;
      if (typeof skill === 'string') names.push(`skill:${skill}`);
    }
    const target = input.file_path ?? input.notebook_path ?? input.command ?? input.skill;
    const what = typeof target === 'string' ? ` ${target}` : '';
    return {
      event: { names, input, block, describe: `${call.label}${what} (block ${block}, call ${index + 1})` },
      order: index,
    };
  });
  const raw = observed.raw as Partial<ReplayRaw> | undefined;
  for (const marker of Array.isArray(raw?.markers) ? raw.markers : []) {
    if (marker.kind === 'compaction') events.push({ event: 'reset', order: marker.afterToolCalls - 0.5 });
  }
  for (const stage of observed.runtime?.stages ?? []) {
    const time = stage.at === undefined ? Number.NaN : Date.parse(stage.at);
    let order = calls.length;
    if (!Number.isNaN(time)) {
      const next = calls.findIndex(
        (call) => call.startedAt !== undefined && Date.parse(call.startedAt) > time,
      );
      if (next >= 0) order = next;
    }
    events.push({
      event: {
        names: [`stage:${stage.name}`],
        input: {},
        block,
        describe: `stage ${stage.name} (block ${block})`,
      },
      order: order - 0.25,
    });
  }
  return events
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map((entry) => entry.event);
}

function parsePairs(options: unknown): OrderedPair[] {
  const list = isRecord(options) && Array.isArray(options.pairs) ? options.pairs : [options];
  return list.map((entry, index) => {
    const before = isRecord(entry)
      ? typeof entry.before === 'string'
        ? [entry.before]
        : Array.isArray(entry.before) &&
            entry.before.length > 0 &&
            entry.before.every((name) => typeof name === 'string' && name !== '')
          ? (entry.before as string[])
          : undefined
      : undefined;
    if (!isRecord(entry) || before === undefined || typeof entry.after !== 'string') {
      throw new Error(
        `pair ${index + 1} needs before (a name or a list of names) and after, each a tool label, skill:<name> or stage:<name>`,
      );
    }
    if (entry.key !== undefined && typeof entry.key !== 'string')
      throw new Error(`pair ${index + 1}: key is a field name`);
    if (entry.reset !== undefined && entry.reset !== 'compaction') {
      throw new Error(`pair ${index + 1}: reset takes only compaction`);
    }
    return {
      before,
      after: entry.after,
      ...(entry.key === undefined ? {} : { key: entry.key as string }),
      ...(entry.reset === undefined ? {} : { reset: 'compaction' as const }),
    };
  });
}

function safe(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}
