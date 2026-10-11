import {
  type Check,
  type CheckContext,
  type EndState,
  type EndStateSpec,
  machineVerdict,
  type Verdict,
} from '@driftbench/core';
import { checkAssertion } from '../support/assert';
import { definedKeys, isEmpty, isRecord, show } from '../support/values';

const NAME = 'end_state';

/** One field that differs between the expected and the observed end state, the RunResult shape. */
export type EndStateDiff = { field: string; expected: unknown; observed: unknown };

type FieldResult = EndStateDiff & { ok: boolean; evidence: string };

/**
 * The end state of the world after the run against the spec's `end_state`. It runs on the last block of a
 * teacher-forced or free-running run; a perturbed run may end elsewhere by design and is not compared.
 *
 * What the check reads in `ctx.endState`. For one mapping, the value the adapter read from its `source`
 * (a record keyed by that source is unwrapped). For a list, a record keyed by source, such as
 * `{ 'tool:order.create': payload }`, or an array in the list's order. For `none`, whatever the adapter
 * recorded: absent, null or empty means nothing was submitted.
 *
 * `subset` (the default) compares the listed fields, `exact` also fails on a field the spec does not
 * list. One verdict per field, so the report prints the diff field by field.
 */
export const endState: Check = {
  name: NAME,
  applies: (ctx) =>
    ctx.spec.end_state !== undefined && ctx.mode !== 'P' && ctx.blockIndex === ctx.spec.blocks.length - 1,
  evaluate(ctx: CheckContext): Verdict[] {
    const spec = ctx.spec.end_state;
    if (spec === undefined) return [];
    return compareFields(spec, ctx.endState).map((result) =>
      machineVerdict(NAME, result.field, result.ok ? 'pass' : 'fail', result.evidence),
    );
  },
};

/**
 * The end state compared field by field: `match` and the fields that differ, in the shape of
 * `RunResult.endState`, so the runner records the same diff the verdicts print.
 */
export function compareEndState(spec: EndState, value: unknown): { match: boolean; diff: EndStateDiff[] } {
  const diff = compareFields(spec, value)
    .filter((result) => !result.ok)
    .map(({ field, expected, observed }) => ({ field, expected, observed }));
  return { match: diff.length === 0, diff };
}

function compareFields(spec: EndState, value: unknown): FieldResult[] {
  if (spec === 'none') return [nothingSubmitted(value)];
  const list = Array.isArray(spec) ? spec : [spec];
  return list.flatMap((entry, index) => {
    const prefix = Array.isArray(spec) ? `${entry.source}.` : '';
    return compareOne(entry, stateFor(spec, value, entry, index), prefix);
  });
}

function nothingSubmitted(value: unknown): FieldResult {
  const recorded = submissions(value);
  return {
    field: 'none',
    expected: 'none',
    observed: value ?? null,
    ok: recorded.length === 0,
    evidence:
      recorded.length === 0
        ? 'no submission recorded: the end state the adapter read is empty'
        : `end_state is none, but the adapter recorded ${recorded.join('; ')}`,
  };
}

/** What an end state holds, one line per submission: a key of a record, an item of a list. */
function submissions(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item) => !isEmpty(item)).map((item) => show(item));
  if (isRecord(value)) {
    return definedKeys(value)
      .filter((key) => !isEmpty(value[key]))
      .map((key) => `${key} ${show(value[key])}`);
  }
  return isEmpty(value) ? [] : [show(value)];
}

function stateFor(spec: EndState, value: unknown, entry: EndStateSpec, index: number): unknown {
  if (!Array.isArray(spec)) {
    if (isRecord(value) && definedKeys(value).length === 1 && entry.source in value)
      return value[entry.source];
    return value;
  }
  if (Array.isArray(value)) return value[index];
  return isRecord(value) ? value[entry.source] : undefined;
}

function compareOne(entry: EndStateSpec, state: unknown, prefix: string): FieldResult[] {
  if (!isRecord(state)) {
    const read =
      state === undefined || state === null
        ? 'nothing was read (no payload recorded, or the adapter cannot read end states)'
        : `the state is ${show(state)}, not a mapping`;
    return [
      {
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
        field: `${prefix}${field}`,
        expected: undefined,
        observed: state[field],
        ok: false,
        evidence: `${entry.source} ${field} is ${show(state[field])}, a field the exact end state does not list`,
      });
    }
  }
  return results;
}
