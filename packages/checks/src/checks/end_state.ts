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

type FieldResult = EndStateDiff & { id: string; ok: boolean; evidence: string };

/**
 * The end state of the world after the run against the spec's `end_state`. It runs on the last block of
 * the spec in a teacher-forced or free-running run; a perturbed run may end elsewhere by design and is
 * not compared.
 *
 * What the check reads in `ctx.endState`, as the runner fills it. For one mapping, the value the adapter
 * read from its `source`; undefined means nothing was recorded. For a list, a record keyed by source,
 * such as `{ 'tool:order.create': payload }`. For `none`, the list of every recorded payload (the adapter
 * source `*`): the check passes when it is undefined, null, `[]` or `{}`, and fails naming the first
 * payload otherwise.
 *
 * `subset` (the default) compares the listed fields, `exact` also fails on a field the spec does not
 * list. One verdict per field, so the report prints the diff field by field. The diff entries follow the
 * runner's `compareEndState`: an unexpected field is expected `{ absent: true }`, a list names its fields
 * `<source>.<field>`, and `none` fails with one entry for the field `*`.
 */
export const endState: Check = {
  name: NAME,
  applies: (ctx) => ctx.spec.end_state !== undefined && ctx.mode !== 'P' && isLastSpecBlock(ctx),
  evaluate(ctx: CheckContext): Verdict[] {
    const spec = ctx.spec.end_state;
    if (spec === undefined) return [];
    return compareFields(spec, ctx.endState).map((result) =>
      machineVerdict(NAME, result.id, result.ok ? 'pass' : 'fail', result.evidence),
    );
  },
};

/**
 * The end state compared field by field: `match` and the fields that differ, in the shape of
 * `RunResult.endState`. The runner records its own diff from core; this one mirrors it, so the verdicts and
 * the run record agree field for field.
 */
export function compareEndState(spec: EndState, value: unknown): { match: boolean; diff: EndStateDiff[] } {
  const diff = compareFields(spec, value)
    .filter((result) => !result.ok)
    .map(({ field, expected, observed }) => ({ field, expected, observed }));
  return { match: diff.length === 0, diff };
}

/** The runner passes the spec's own block objects, so the last block is found by identity; by position otherwise. */
function isLastSpecBlock(ctx: CheckContext): boolean {
  return ctx.block === ctx.spec.blocks.at(-1) || ctx.blockIndex === ctx.spec.blocks.length - 1;
}

function compareFields(spec: EndState, value: unknown): FieldResult[] {
  if (spec === 'none') return [nothingSubmitted(value)];
  const list = Array.isArray(spec) ? spec : [spec];
  return list.flatMap((entry) => {
    const prefix = Array.isArray(spec) ? `${entry.source}.` : '';
    const state = Array.isArray(spec) ? (isRecord(value) ? value[entry.source] : undefined) : value;
    return compareOne(entry, state, prefix);
  });
}

function nothingSubmitted(value: unknown): FieldResult {
  const recorded = payloads(value);
  const [first] = recorded;
  return {
    id: 'none',
    field: '*',
    expected: [],
    observed: value ?? null,
    ok: recorded.length === 0,
    evidence:
      recorded.length === 0
        ? 'no payload recorded, as end_state none expects'
        : `end_state is none, but the adapter recorded ${plural(recorded.length, 'payload')}; the first: ${show(first)}`,
  };
}

/** The payloads an end state of `none` holds: the runner's list, or the values of a record. */
function payloads(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  if (isRecord(value)) return definedKeys(value).map((key) => value[key]);
  return [value];
}

function compareOne(entry: EndStateSpec, state: unknown, prefix: string): FieldResult[] {
  if (!isRecord(state)) {
    const read =
      state === undefined || state === null
        ? 'nothing was read (no payload recorded, or the adapter cannot read end states)'
        : `the state is ${show(state)}, not a mapping`;
    return [
      {
        id: entry.source,
        field: entry.source,
        expected: entry.expect,
        observed: state ?? null,
        ok: false,
        evidence: `${entry.source}: ${read}; expected a state holding ${Object.keys(entry.expect).join(', ')}`,
      },
    ];
  }
  const results: FieldResult[] = Object.entries(entry.expect).map(([field, assertion]) => {
    const observed = state[field];
    const result = checkAssertion(observed, assertion);
    const problem = result.problem ? `; ${result.problem}` : '';
    return {
      id: `${prefix}${field}`,
      field: `${prefix}${field}`,
      expected: assertion,
      observed,
      ok: result.ok,
      evidence: `${entry.source} ${field} is ${show(observed)}, expected ${result.expected}${problem}`,
    };
  });
  if (entry.mode === 'exact') {
    for (const field of definedKeys(state)) {
      if (field in entry.expect) continue;
      results.push({
        id: `${prefix}${field}`,
        field: `${prefix}${field}`,
        expected: { absent: true },
        observed: state[field],
        ok: false,
        evidence: `${entry.source} ${field} is ${show(state[field])}, a field the exact end state does not list`,
      });
    }
  }
  return results;
}
