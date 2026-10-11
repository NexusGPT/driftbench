import {
  type Check,
  type CheckContext,
  type EndState,
  type EndStateSpec,
  machineVerdict,
  type Verdict,
} from '@driftbench/core';
import { checkAssertion } from '../support/assert';
import { definedKeys, isRecord, plural, show } from '../support/values';

const NAME = 'end_state';

/** One field that differs between the expected and the observed end state, the RunResult shape. */
export type EndStateDiff = { field: string; expected: unknown; observed: unknown };

type FieldCheck = EndStateDiff & { id: string; ok: boolean; evidence: string };

/**
 * The end state of the world after the run against the spec's `end_state`. It runs on the last block of
 * the spec in a teacher-forced or free-running run; a perturbed run may end elsewhere by design and is
 * not compared.
 *
 * What the check reads in `ctx.endState`, as the runner fills it. For one mapping, the value the adapter
 * read from its `source`. For a list, a record keyed by source, such as `{ 'tool:order.create': payload }`.
 * For `none`, the list of every recorded payload (the adapter source `*`): the check passes when it is
 * undefined, null, `[]` or `{}`, and fails naming the first payload otherwise.
 *
 * `subset` (the default) compares the listed fields, `exact` also fails on a field the spec does not
 * list. One verdict per expected field, the same ids whether or not anything was read; a source that
 * recorded nothing, or a state that is not a mapping, fails every expected field, `{ absent: true }`
 * assertions included. An empty `expect` gives one verdict `end_state.<source>`: it passes when the source
 * recorded anything, and fails when it recorded nothing, with the diff entry `{ field: <source>, expected:
 * { nonempty: true }, observed: { absent: true } }`, in a list too.
 */
export const endState: Check = {
  name: NAME,
  applies: (ctx) => ctx.spec.end_state !== undefined && ctx.mode !== 'P' && isLastSpecBlock(ctx),
  evaluate(ctx: CheckContext): Verdict[] {
    const spec = ctx.spec.end_state;
    if (spec === undefined) return [];
    if (spec === 'none') return [noneVerdict(ctx.endState)];
    return fieldChecks(spec, ctx.endState).map((check) =>
      machineVerdict(NAME, check.id, check.ok ? 'pass' : 'fail', check.evidence),
    );
  },
};

/**
 * The end state compared field by field: `match` and the fields that differ, in the shape of
 * `RunResult.endState`. It mirrors the runner's `compareEndState` in core, so the verdicts and the run
 * record agree: an absent value is written `{ absent: true }` (undefined does not survive JSON), a list
 * names its fields `<source>.<field>`, and `none` gives one entry `*.<index>` per payload found.
 */
export function compareEndState(spec: EndState, value: unknown): { match: boolean; diff: EndStateDiff[] } {
  const diff: EndStateDiff[] =
    spec === 'none'
      ? payloads(value).map((payload, index) => ({
          field: `*.${index}`,
          expected: { absent: true },
          observed: payload,
        }))
      : fieldChecks(spec, value)
          .filter((check) => !check.ok)
          .map(({ field, expected, observed }) => ({ field, expected, observed }));
  return { match: diff.length === 0, diff };
}

/** The runner passes the spec's own block objects, so the last block is found by identity; by position otherwise. */
function isLastSpecBlock(ctx: CheckContext): boolean {
  return ctx.block === ctx.spec.blocks.at(-1) || ctx.blockIndex === ctx.spec.blocks.length - 1;
}

function noneVerdict(value: unknown): Verdict {
  const recorded = payloads(value);
  if (recorded.length === 0) {
    return machineVerdict(NAME, 'none', 'pass', 'no payload recorded, as end_state none expects');
  }
  return machineVerdict(
    NAME,
    'none',
    'fail',
    `end_state is none, but the adapter recorded ${plural(recorded.length, 'payload')}; the first: ${show(recorded[0])}`,
  );
}

/** The payloads an end state of `none` holds: the runner's list, or the values of a record. */
function payloads(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  if (isRecord(value)) return definedKeys(value).map((key) => value[key]);
  return [value];
}

function fieldChecks(spec: EndStateSpec | EndStateSpec[], value: unknown): FieldCheck[] {
  const list = Array.isArray(spec) ? spec : [spec];
  return list.flatMap((entry) => {
    if (!Array.isArray(spec)) return entryChecks(entry, value, '');
    return entryChecks(entry, isRecord(value) ? value[entry.source] : undefined, `${entry.source}.`);
  });
}

function entryChecks(entry: EndStateSpec, state: unknown, prefix: string): FieldCheck[] {
  const fields = Object.entries(entry.expect);
  const nothing = state === undefined || state === null;
  if (fields.length === 0) {
    // An empty expect asks only that the source recorded something, whatever its shape.
    const presence = nothing
      ? missing(
          entry.source,
          { nonempty: true },
          `${entry.source}: nothing was read (no payload recorded, or the adapter cannot read end states); expected a recorded state`,
        )
      : {
          id: entry.source,
          field: entry.source,
          expected: { nonempty: true },
          observed: state,
          ok: true,
          evidence: `${entry.source} recorded ${isRecord(state) ? 'a mapping' : typeName(state)} ${show(state)}`,
        };
    if (nothing || !isRecord(state) || entry.mode !== 'exact') return [presence];
    return [presence, ...extras(entry, state, prefix)];
  }
  if (!isRecord(state)) {
    const why = nothing
      ? 'nothing was read (no payload recorded, or the adapter cannot read end states)'
      : `the state read is ${typeName(state)} (${show(state)}), not a mapping`;
    return fields.map(([field, assertion]) =>
      missing(
        `${prefix}${field}`,
        assertion,
        `${entry.source}: ${why}, so ${field} is absent; expected ${checkAssertion(undefined, assertion).expected}`,
      ),
    );
  }
  const checks: FieldCheck[] = fields.map(([field, assertion]) => {
    const observed = state[field];
    const result = checkAssertion(observed, assertion);
    const problem = result.problem ? `; ${result.problem}` : '';
    return {
      id: `${prefix}${field}`,
      field: `${prefix}${field}`,
      expected: assertion,
      observed: observed === undefined ? { absent: true } : observed,
      ok: result.ok,
      evidence: `${entry.source} ${field} is ${show(observed)}, expected ${result.expected}${problem}`,
    };
  });
  return entry.mode === 'exact' ? [...checks, ...extras(entry, state, prefix)] : checks;
}

/** Exact mode: every field of the read state the spec does not list fails, expected `{ absent: true }`. */
function extras(entry: EndStateSpec, state: Record<string, unknown>, prefix: string): FieldCheck[] {
  return definedKeys(state)
    .filter((field) => !(field in entry.expect))
    .map((field) => ({
      id: `${prefix}${field}`,
      field: `${prefix}${field}`,
      expected: { absent: true },
      observed: state[field],
      ok: false,
      evidence: `${entry.source} ${field} is ${show(state[field])}, a field the exact end state does not list`,
    }));
}

/** The type of a state that is not a mapping, as evidence names it. */
function typeName(state: unknown): string {
  if (Array.isArray(state)) return 'a list';
  return typeof state === 'object' ? 'an object' : `a ${typeof state}`;
}

function missing(field: string, expected: unknown, evidence: string): FieldCheck {
  return { id: field, field, expected, observed: { absent: true }, ok: false, evidence };
}
