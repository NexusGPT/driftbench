import {
  type Assertion,
  type Check,
  type CheckContext,
  isZero,
  machineVerdict,
  type ToolCall,
  type ToolExpect,
  type Verdict,
} from '@driftbench/core';
import { checkAssertion } from '../support/assert';
import { countAllows, describeCount, minimumOf } from '../support/count';
import { entryKeys, isRecord, listed, plural, show, times } from '../support/values';

const NAME = 'tools';

/**
 * The expected tool calls of a block. Per expected tool: the call count with Count semantics, and every
 * input assertion on every call of that tool. `tool_order` lines the expected tools up with the observed
 * calls (exact, in_order, any_order, the Google ADK trajectory match types). The argument accuracy, the
 * share of expected arguments that matched, is reported with a score and never gates.
 *
 * A tool expected 0 times belongs to the forbidden check, so its fact is never reported twice.
 */
export const tools: Check = {
  name: NAME,
  applies: (ctx) => expectedTools(ctx).length > 0 || ctx.expect.tool_order !== undefined,
  evaluate(ctx) {
    const expected = expectedTools(ctx);
    const keys = entryKeys(expected.map((tool) => tool.label));
    const calls = ctx.observed.toolCalls;
    const verdicts: Verdict[] = [];
    let argumentsExpected = 0;
    const missed: string[] = [];

    expected.forEach((tool, index) => {
      const key = keys[index] ?? tool.label;
      const own = calls.filter((call) => call.label === tool.label);
      verdicts.push(countVerdict(key, tool, own, calls));
      for (const [field, assertion] of Object.entries(tool.input ?? {})) {
        argumentsExpected += 1;
        const verdict = inputVerdict(key, tool.label, field, own, assertion);
        if (verdict.outcome !== 'pass') missed.push(`${tool.label} input.${field}`);
        verdicts.push(verdict);
      }
    });

    if (ctx.expect.tool_order !== undefined) {
      verdicts.push(orderVerdict(ctx.expect.tool_order, expected, calls));
    }

    if (argumentsExpected > 0) {
      const matched = argumentsExpected - missed.length;
      const missedNote = missed.length > 0 ? `; missed: ${missed.join(', ')}` : '';
      verdicts.push(
        machineVerdict(
          NAME,
          'argument_accuracy',
          matched === argumentsExpected ? 'pass' : 'fail',
          `${matched} of ${plural(argumentsExpected, 'expected argument')} matched${missedNote}`,
          { gating: false, score: matched / argumentsExpected },
        ),
      );
    }
    return verdicts;
  },
};

/** The block's expected tools, without the ones expected 0 times. */
function expectedTools(ctx: CheckContext): ToolExpect[] {
  return (ctx.expect.tools ?? []).filter((tool) => !isZero(tool.count));
}

function countVerdict(key: string, tool: ToolExpect, own: ToolCall[], calls: ToolCall[]): Verdict {
  const ok = countAllows(tool.count, own.length);
  const seen = ok ? '' : `; calls in this block: ${listed(calls.map((call) => call.label))}`;
  return machineVerdict(
    NAME,
    `${key}.count`,
    ok ? 'pass' : 'fail',
    `${tool.label} called ${times(own.length)}, expected ${describeCount(tool.count)}${seen}`,
  );
}

function inputVerdict(
  key: string,
  label: string,
  field: string,
  own: ToolCall[],
  assertion: Assertion,
): Verdict {
  const id = `${key}.input.${field}`;
  if (own.length === 0) {
    const { expected } = checkAssertion(undefined, assertion);
    return machineVerdict(
      NAME,
      id,
      'fail',
      `${label} was not called, so input.${field} could not be ${expected}`,
    );
  }
  const failures: string[] = [];
  let expected = '';
  let problem: string | undefined;
  own.forEach((call, index) => {
    const value = isRecord(call.input) ? call.input[field] : undefined;
    const result = checkAssertion(value, assertion);
    expected = result.expected;
    problem = result.problem ?? problem;
    if (!result.ok) failures.push(`call ${index + 1}${callId(call)}: input.${field} is ${show(value)}`);
  });
  if (problem) return machineVerdict(NAME, id, 'fail', `input.${field} ${expected}: ${problem}`);
  if (failures.length > 0) {
    return machineVerdict(NAME, id, 'fail', `${label} ${failures.join('; ')}; expected ${expected}`);
  }
  const values = own.map((call) => show(isRecord(call.input) ? call.input[field] : undefined));
  return machineVerdict(
    NAME,
    id,
    'pass',
    `${label} input.${field} is ${expected} on ${plural(own.length, 'call')}: ${[...new Set(values)].join(', ')}`,
  );
}

function callId(call: ToolCall): string {
  return call.id === undefined ? '' : ` (${call.id})`;
}

type Mode = NonNullable<CheckContext['expect']['tool_order']>;

function orderVerdict(mode: Mode, expected: ToolExpect[], calls: ToolCall[]): Verdict {
  const labels = calls.map((call) => call.label);
  const saw = labels.length === 0 ? 'no call' : labels.join(', ');
  const wanted = expected.map((tool) => `${tool.label} (${describeCount(tool.count)})`);
  let ok: boolean;
  let rule: string;
  if (mode === 'exact') {
    ok = matchesExactly(expected, labels);
    rule = 'exactly these calls, in this order, and no other';
  } else if (mode === 'in_order') {
    ok = isSubsequence(expansion(expected), labels);
    rule = 'these calls in this order, other calls allowed between them';
  } else {
    ok = includesAll(expansion(expected), labels);
    rule = 'these calls in any order';
  }
  return machineVerdict(
    NAME,
    'order',
    ok ? 'pass' : 'fail',
    `${mode}: expected ${rule}: ${listed(wanted)}; saw ${saw}`,
  );
}

/** The expected calls one by one: each tool as many times as its count requires at the least. */
function expansion(expected: ToolExpect[]): string[] {
  return expected.flatMap((tool) => Array<string>(minimumOf(tool.count)).fill(tool.label));
}

function isSubsequence(wanted: string[], labels: string[]): boolean {
  let next = 0;
  for (const label of labels) if (label === wanted[next]) next += 1;
  return next >= wanted.length;
}

function includesAll(wanted: string[], labels: string[]): boolean {
  const left = [...labels];
  return wanted.every((label) => {
    const at = left.indexOf(label);
    if (at < 0) return false;
    left.splice(at, 1);
    return true;
  });
}

/**
 * Exact: the observed calls split into consecutive runs, one per expected tool in order, each run made of
 * that tool only and as long as its count allows, with no call left over.
 */
function matchesExactly(expected: ToolExpect[], labels: string[]): boolean {
  const memo = new Map<string, boolean>();
  const from = (entry: number, position: number): boolean => {
    if (entry === expected.length) return position === labels.length;
    const key = `${entry}:${position}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const tool = expected[entry];
    if (tool === undefined) return position === labels.length;
    let run = 0;
    while (labels[position + run] === tool.label) run += 1;
    let result = false;
    for (let length = 0; length <= run && !result; length += 1) {
      result = countAllows(tool.count, length) && from(entry + 1, position + length);
    }
    memo.set(key, result);
    return result;
  };
  return from(0, 0);
}
