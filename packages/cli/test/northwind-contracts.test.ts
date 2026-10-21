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

const harness = await import(
  new URL('../../../examples/northwind-campaign/plugin.mjs', import.meta.url).href
);
const prerequisite = harness.invoicePrerequisite;
const ruleRead = {
  label: 'Read',
  input: { file_path: '.claude/skills/invoice-reconcile/references/matching-rules.md' },
};
const reconcile = {
  label: 'Bash',
  input: {
    command:
      'python3 .claude/skills/invoice-reconcile/scripts/reconcile.py ledger/INV-1004.json ledger/PO-77.json',
  },
};
function prerequisiteContext(calls: unknown[], prior: unknown[] = []) {
  return {
    block: { id: 'reconcile' },
    blockIndex: 1,
    observed: { toolCalls: calls },
    history: [{ index: 0, observed: { toolCalls: prior } }],
  };
}
it('fails a reconcile with no matching-rules read anywhere in history', () => {
  expect(
    prerequisite(prerequisiteContext([reconcile], [{ label: 'Read', input: { file_path: 'unrelated.md' } }])),
  ).toContainEqual(expect.objectContaining({ outcome: 'fail' }));
});
it('fails when matching-rules is read only after reconciliation', () => {
  expect(prerequisite(prerequisiteContext([reconcile, ruleRead]))).toContainEqual(
    expect.objectContaining({ outcome: 'fail' }),
  );
});
it('does not count a failed matching-rules read', () => {
  expect(prerequisite(prerequisiteContext([{ ...ruleRead, error: 'denied' }, reconcile]))).toContainEqual(
    expect.objectContaining({ outcome: 'fail' }),
  );
});
it('requires the reconcile command rather than vacuously accepting no matching work', () => {
  expect(prerequisite(prerequisiteContext([ruleRead]))).toContainEqual(
    expect.objectContaining({ outcome: 'fail' }),
  );
});
it.each(['earlier block', 'current block'])(
  'accepts a matching-rules read before reconciliation in the %s',
  (where) => {
    const result =
      where === 'earlier block'
        ? prerequisite(prerequisiteContext([reconcile], [ruleRead]))
        : prerequisite(prerequisiteContext([ruleRead, reconcile]));
    expect(result).toContainEqual(expect.objectContaining({ outcome: 'pass' }));
  },
);
