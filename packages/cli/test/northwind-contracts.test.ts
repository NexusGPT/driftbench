import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { validateStrict } from '../../checks/src/support/schema';

it('accepts the real Skill args field while retaining the skill enum and rejecting invented parameters', async () => {
  const file = new URL('../../../examples/northwind-campaign/specs/weekly-report.yaml', import.meta.url);
  const spec = parse(await readFile(file, 'utf8'));
  const schema = spec.metadata.tool_schemas.Skill;
  expect(validateStrict({ skill: 'weekly-report', args: 'week 43' }, schema)).toEqual([]);
  expect(validateStrict({ skill: 'invented-skill', args: 'week 43' }, schema).length).toBeGreaterThan(0);
  expect(validateStrict({ skill: 'weekly-report', invented: true }, schema).length).toBeGreaterThan(0);
});

it('checks invoice skill activation at clarification and the temporal matching-rules prerequisite', async () => {
  const file = new URL('../../../examples/northwind-campaign/specs/invoice-over.yaml', import.meta.url);
  const spec = parse(await readFile(file, 'utf8'));
  expect(spec.blocks[0].expect.skills).toContainEqual({ name: 'invoice-reconcile', count: { min: 1 } });
  expect(spec.rules.custom).toHaveProperty('northwind-invoice-prerequisite');
  expect(spec.blocks[1].expect.execution).toEqual({ ran_code: true });
  expect(spec.blocks[1].expect.subagents).toContainEqual({ name: 'ledger-auditor', count: { min: 1 } });
  expect(spec.blocks[1].expect.regex).toContain('60\\.00 EUR');
});


const harness = await import(new URL('../../../examples/northwind-campaign/plugin.mjs', import.meta.url).href);
const prerequisite = harness.invoicePrerequisite;
const event = { id: 'fictional-execution', at: '2026-10-21T10:00:02.000Z' };
const ruleRead = { label: 'Read', input: { file_path: '.claude/skills/invoice-reconcile/references/matching-rules.md' },
  output: 'matching rules', startedAt: '2026-10-21T10:00:00.000Z', latencyMs: 10 };
function context(calls: unknown[], prior: unknown[] = [], events: unknown[] = [event]) {
  return { block: { id: 'reconcile' }, blockIndex: 1,
    observed: { toolCalls: calls, raw: { northwindReconcileExecutions: events } },
    history: [{ observed: { toolCalls: prior } }] };
}
it('fails an execution with no matching-rules Read anywhere in history', () => {
  expect(prerequisite(context([], [{ ...ruleRead, input: { file_path: 'unrelated.md' } }]))).toContainEqual(expect.objectContaining({ outcome: 'fail' }));
});
it('fails a matching-rules Read completed only after the execution', () => {
  expect(prerequisite(context([{ ...ruleRead, startedAt: '2026-10-21T10:00:03.000Z' }]))).toContainEqual(expect.objectContaining({ outcome: 'fail' }));
});
it('does not count a failed or unfinished matching-rules Read', () => {
  for (const read of [{ ...ruleRead, error: 'denied' }, { ...ruleRead, output: undefined }, { ...ruleRead, latencyMs: 3000 }]) {
    expect(prerequisite(context([read]))).toContainEqual(expect.objectContaining({ outcome: 'fail' }));
  }
});
it('requires execution evidence rather than vacuously accepting no matching work', () => {
  expect(prerequisite(context([ruleRead], [], []))).toContainEqual(expect.objectContaining({ outcome: 'fail' }));
});
it.each(['earlier block', 'current block'])('accepts a completed matching-rules Read in the %s', (where) => {
  const result = where === 'earlier block' ? prerequisite(context([], [ruleRead])) : prerequisite(context([ruleRead]));
  expect(result).toContainEqual(expect.objectContaining({ outcome: 'pass' }));
});
it('judges every execution, even a later one on an ask block', () => {
  const ctx = context([], [], [event, { ...event, id: 'second' }]); ctx.block.id = 'ask';
  expect(prerequisite(ctx)).toContainEqual(expect.objectContaining({ outcome: 'fail' }));
});
