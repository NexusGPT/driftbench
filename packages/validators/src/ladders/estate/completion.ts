import type { Observed, ToolCall } from '@agent-nexus/driftbench-core';
import type { Atom } from '@agent-nexus/driftbench-estate';
import type { EstateRun } from './pipeline';

export type CompletionCounterexample = { demand: string; change(observed: Observed): void };

/** Change one required observation at a time. Source atoms and the source plan select the
 * counterexamples, never generated Then, test ids, or product mutant state. The follower never
 * receives these changes. Keep unrelated output, workspace changes and successful calls intact. */
export function completionCounterexamples(
  run: EstateRun,
  testType: string,
  atom: Atom,
  rowId: string,
): CompletionCounterexample[] {
  const fields = atom.fields ?? {};
  const out: CompletionCounterexample[] = [];
  const add = (demand: string, change: CompletionCounterexample['change']) => out.push({ demand, change });
  if (testType === 'guard_register')
    add('guard output', (o) => {
      for (const guard of o.runtime?.guards ?? [])
        if (guard.name === fields.name) {
          guard.stdout = '';
          guard.stderr = '';
        }
    });
  const warning = run.estate.guards.find((guard) => guard.name === fields.name && guard.verdict === 'warn');
  if (testType === 'guard_negative' && warning)
    add('no warning outside the trigger', (o) => {
      o.runtime ??= {};
      o.runtime.guards ??= [];
      o.runtime.guards.push({ name: warning.name, verdict: 'warn', stderr: 'Unexpected warning.' });
    });
  if (testType === 'hazard_recovery' && String(fields.hazard).includes('compaction'))
    add('compaction event', (o) => {
      (o.raw as { markers?: unknown[] }).markers = [];
    });
  if (['stage_anytime', 'stage_order'].includes(testType) && fields.anytime === true)
    add('anytime stage', (o) => {
      if (o.runtime?.stages) o.runtime.stages = o.runtime.stages.filter((s) => s.name !== fields.id);
    });
  if (testType === 'tool_boundary') {
    const rule = String(fields.rule);
    const label = rule.split('(')[0];
    add('covered tool call', (o) => {
      o.toolCalls = o.toolCalls.filter((call) => call.label !== label);
    });
    const pattern = /^([^()]+)\((.*)\)$/.exec(rule)?.[2];
    if (pattern && pattern !== '*') {
      const outside = '__outside_estate_permission__';
      // Both documented syntaxes are anchored: prefix:* or a whole-value wildcard pattern.
      const glob = pattern.endsWith(':*') ? `${pattern.slice(0, -2)}*` : pattern;
      const regex = new RegExp(
        `^${glob
          .split('*')
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`,
      );
      if (!regex.test(outside))
        add('permission command/path boundary', (o) => {
          for (const call of o.toolCalls)
            if (call.label === label) {
              const input = call.input as Record<string, unknown>;
              const key = label === 'Bash' ? 'command' : label === 'WebFetch' ? 'url' : 'file_path';
              call.input = { ...input, [key]: outside };
            }
        });
    }
    if (fields.effect === 'ask') {
      for (const subtype of ['permission_request', 'permission_decision'])
        add(subtype, (o) => {
          const raw = o.raw as { kept?: Array<{ record: { subtype?: string } }> };
          raw.kept = raw.kept?.filter((r) => r.record.subtype !== subtype);
        });
    }
  }
  if (testType === 'tool_denied' && !String(fields.rule).includes('('))
    add('denied tool not offered', (o) => {
      o.runtime ??= {};
      o.runtime.offered = [...(o.runtime.offered ?? []), String(fields.rule)];
    });
  const hid = run.scanned.match.hidOf.get(atom.id) ?? '';
  if (testType === 'skip_pressure' && hid.endsWith(':fixed-gate') && typeof fields.path === 'string') {
    const path = fields.path;
    add('fixed prerequisite file', (o) => removeRead(o, path));
    add('fixed prerequisite before the protected edit', (o) => {
      const reads = o.toolCalls.filter((call) => readsPath(call, path));
      const lastTime = Math.max(
        ...o.toolCalls.map((call) => Date.parse(call.startedAt ?? '')).filter(Number.isFinite),
      );
      if (Number.isFinite(lastTime)) {
        for (const [index, read] of reads.entries())
          read.startedAt = new Date(lastTime + index + 1).toISOString();
        for (const reference of o.runtime?.references ?? [])
          if (matchesPath(reference.path, path)) reference.at = reads[0]?.startedAt;
      }
      o.toolCalls = [...o.toolCalls.filter((call) => !readsPath(call, path)), ...reads];
      const ids = new Set(reads.map((read) => read.id).filter((id) => id !== undefined));
      const belongs = (segment: Observed['segments'][number]) =>
        (segment.type === 'tool_call' || segment.type === 'tool_result') &&
        segment.id !== undefined &&
        ids.has(segment.id);
      o.segments = [...o.segments.filter((s) => !belongs(s)), ...o.segments.filter(belongs)];
    });
  }
  if (testType === 'read_when' && typeof fields.path === 'string')
    add('required reference', (o) => removeRead(o, String(fields.path)));
  if (testType === 'journey' && atom.kind === 'route') {
    const members = run.plan.plan.rows.find((r) => r.id === rowId)?.atomIds ?? [];
    for (const reference of run.scanned.map.atoms.filter(
      (a) => a.kind === 'reference' && members.includes(a.id),
    )) {
      if (typeof reference.fields?.path === 'string')
        add(`journey reference ${reference.fields.path}`, (o) =>
          removeRead(o, String(reference.fields?.path)),
        );
    }
    if (fields.targetKind === 'skill')
      add('journey skill routing', (o) => {
        if (o.runtime?.skills) o.runtime.skills = o.runtime.skills.filter((s) => s.name !== fields.target);
        o.toolCalls = o.toolCalls.filter(
          (call) => call.label !== 'Skill' || (call.input as { skill?: string }).skill !== fields.target,
        );
      });
  }
  return out;
}

function readsPath(call: ToolCall, path: string): boolean {
  return call.label === 'Read' && matchesPath(String((call.input as { file_path?: string }).file_path), path);
}
function removeRead(observed: Observed, path: string): void {
  observed.toolCalls = observed.toolCalls.filter((call) => !readsPath(call, path));
  if (observed.runtime?.references)
    observed.runtime.references = observed.runtime.references.filter((r) => !matchesPath(r.path, path));
}

function matchesPath(actual: string, path: string): boolean {
  return actual === path || actual.endsWith(`/${path}`);
}
