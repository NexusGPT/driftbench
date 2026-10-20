import {
  type Assertion,
  type Expect,
  type evidence,
  isZero,
  type Observed,
  type Spec,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { entryKeys, isRecord } from '../support/values';
import { DEFAULT_VALUE_POLICY, type ValuePolicy } from '../value-check/ladder';

/**
 * The value check's record of a failing verdict, in the shape the blame evidence reads. The tools check stores,
 * on each input verdict, the rung that decided every value it did not pass by equality (`Verdict.valueCheck`:
 * the call, the value's path, the rung and its outcome). The value itself is in the stored tool call, and the
 * gold in the block's expectation, so the record joins them. Nothing is replayed and no model is called.
 */

/**
 * The family a rung belongs to, as `evidence.ValueFact.rung` names them, by what the rung implements and not by
 * its item id: a project may rename or add items. A rung no family knows keeps its item id.
 */
const FAMILY: Readonly<Record<string, string>> = {
  'builtin:value-check/outcome': 'rung1',
  'builtin:value-check/recompute': 'rung1',
  'builtin:value-check/state-diff': 'rung1',
  'builtin:value-check/contract': 'rung2',
  'builtin:value-check/as-given': 'rung2b',
  'builtin:value-check/judge': 'rung3',
  'builtin:value-check/exact': 'rung4',
};

/** The two verdicts of the ladder that are not items of a policy: both are the exact compare. */
const EXACT_RUNGS: ReadonlySet<string> = new Set(['identity', 'exact_fallback']);

/** The family of a rung id under a policy. */
export function rungFamily(rung: string, policy: ValuePolicy = DEFAULT_VALUE_POLICY): string {
  if (EXACT_RUNGS.has(rung)) return 'rung4';
  const impl = policy.items.find((item) => item.id === rung)?.impl;
  return (impl === undefined ? undefined : FAMILY[impl]) ?? rung;
}

/** The tool label and argument a tools-check input verdict is about, given the block's expected tools. */
function subjectOf(
  verdictId: string,
  expect: Expect | undefined,
): { tool: string; field: string; assertion: Assertion | undefined } | undefined {
  const tools = (expect?.tools ?? []).filter((tool) => !isZero(tool.count));
  const keys = entryKeys(tools.map((tool) => tool.label));
  for (const [index, tool] of tools.entries()) {
    const prefix = `tools.${keys[index]}.input.`;
    if (!verdictId.startsWith(prefix)) continue;
    const field = verdictId.slice(prefix.length);
    if (field === '' || field.includes('.')) continue;
    return { tool: tool.label, field, assertion: tool.input?.[field] };
  }
  return undefined;
}

/** The value at a path inside a value, undefined when the path leaves an object. */
function at(value: unknown, path: readonly string[]): unknown {
  let node = value;
  for (const key of path) {
    if (!isRecord(node)) return undefined;
    node = node[key];
  }
  return node;
}

/** The gold the assertion states for a path inside the argument: the bare value, `exact`, or a `subset` leaf. */
function goldOf(assertion: Assertion | undefined, path: readonly string[]): unknown {
  if (isRecord(assertion)) {
    if ('exact' in assertion) return path.length === 0 ? assertion.exact : at(assertion.exact, path);
    if ('subset' in assertion) return at(assertion.subset, path);
    return undefined;
  }
  return path.length === 0 ? assertion : undefined;
}

/** A failing outcome first: the evidence reads the first fact as the one that decided the verdict. */
const ORDER: Readonly<Record<string, number>> = { fail: 0, inconclusive: 1, pass: 2 };

export type ValueFactSource = {
  observed: Pick<Observed, 'toolCalls'>;
  expect?: Expect;
  /** The value-check policy the block resolved; the shipped one when absent. */
  policy?: ValuePolicy;
};

/** The value facts of one verdict of a stored block: one per value the ladder decided, failures first. */
export function valueFacts(source: ValueFactSource, verdict: Pick<Verdict, 'id' | 'valueCheck'>) {
  const decisions = verdict.valueCheck ?? [];
  if (decisions.length === 0) return [];
  const subject = subjectOf(verdict.id, source.expect);
  if (subject === undefined) return [];
  const calls = source.observed.toolCalls.filter((call) => call.label === subject.tool);
  const facts: evidence.ValueFact[] = decisions.map((decision) => {
    const path = decision.path.split('.').slice(1);
    const input = calls[decision.call - 1]?.input;
    const gold = goldOf(subject.assertion, path);
    return {
      tool: subject.tool,
      field: subject.field,
      path,
      call: decision.call - 1,
      value: at(isRecord(input) ? input[subject.field] : undefined, path),
      ...(gold === undefined ? {} : { gold }),
      rung: rungFamily(decision.rung, source.policy),
      ...(decision.outcome === 'pass' || decision.outcome === 'fail' || decision.outcome === 'inconclusive'
        ? { settles: decision.outcome }
        : {}),
    };
  });
  return facts
    .map((fact, index) => ({ fact, index }))
    .sort(
      (a, b) => (ORDER[a.fact.settles ?? ''] ?? 3) - (ORDER[b.fact.settles ?? ''] ?? 3) || a.index - b.index,
    )
    .map((entry) => entry.fact);
}

/** The tool definitions a spec declares, by tool label: `metadata.tool_schemas`. */
export function toolSchemasOf(spec: Pick<Spec, 'metadata'> | undefined): Record<string, unknown> | undefined {
  const schemas = (spec?.metadata as { tool_schemas?: unknown } | undefined)?.tool_schemas;
  return isRecord(schemas) ? schemas : undefined;
}
