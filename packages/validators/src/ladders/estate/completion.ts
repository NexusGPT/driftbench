import type { Observed } from '@agent-nexus/driftbench-core';
import type { Atom } from '@agent-nexus/driftbench-estate';
import type { EstateRun } from './pipeline';

/** A green generated test must retain its target demand. These observation counterexamples
 * change one capability channel, preserving unrelated output and workspace evidence.
 * They belong to the bank, never to the follower, and depend on the input estate, not expectations. */
export function completionCounterexample(
  run: EstateRun,
  testType: string,
  atom: Atom,
  rowId: string,
): ((observed: Observed) => void) | undefined {
  const fields = atom.fields ?? {};
  if (testType === 'guard_register')
    return (o) => {
      for (const guard of o.runtime?.guards ?? [])
        if (guard.name === fields.name) {
          guard.stdout = '';
          guard.stderr = '';
        }
    };
  if (testType === 'guard_negative' && String(fields.name).includes('reply-length'))
    return (o) => {
      o.runtime ??= {};
      o.runtime.guards ??= [];
      o.runtime.guards.push({
        name: String(fields.name),
        verdict: 'warn',
        stderr: 'Reply exceeds the limit.',
      });
    };
  if (testType === 'hazard_recovery' && String(fields.hazard).includes('compaction'))
    return (o) => {
      (o.raw as { markers?: unknown[] }).markers = [];
    };
  if (['stage_anytime', 'stage_order'].includes(testType) && fields.anytime === true)
    return (o) => {
      if (o.runtime?.stages) o.runtime.stages = o.runtime.stages.filter((s) => s.name !== fields.id);
    };
  if (testType === 'tool_boundary')
    return (o) => {
      if (fields.effect === 'ask') {
        const raw = o.raw as { kept?: Array<{ record: { subtype?: string } }> };
        raw.kept = raw.kept?.filter(
          (r) => !['permission_request', 'permission_decision'].includes(r.record.subtype ?? ''),
        );
      } else {
        const label = String(fields.rule).split('(')[0];
        o.toolCalls = o.toolCalls.filter((call) => call.label !== label);
      }
    };
  if (testType === 'tool_denied' && !String(fields.rule).includes('('))
    return (o) => {
      o.runtime ??= {};
      o.runtime.offered = [...(o.runtime.offered ?? []), String(fields.rule)];
    };
  const hid = run.scanned.match.hidOf.get(atom.id) ?? '';
  if (testType === 'skip_pressure' && hid.endsWith(':fixed-gate'))
    return (o) => {
      // Keep every read and its reference evidence, but move it after the protected act.
      const reads = o.toolCalls.filter((call) => call.label === 'Read');
      o.toolCalls = [...o.toolCalls.filter((call) => call.label !== 'Read'), ...reads];
    };
  if (
    testType === 'read_when' ||
    (testType === 'journey' &&
      atom.kind === 'route' &&
      run.plan.plan.rows
        .find((r) => r.id === rowId)
        ?.atomIds.some((id) => run.scanned.map.atoms.some((a) => a.id === id && a.kind === 'reference')))
  )
    return (o) => {
      if (o.runtime) o.runtime.references = [];
      o.toolCalls = o.toolCalls.filter((call) => call.label !== 'Read');
    };
  return undefined;
}
