import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { validateStrict } from '../src/support/schema';

it('accepts the real Skill args field while retaining the skill enum and rejecting invented parameters', async () => {
  const file = new URL('../../../examples/northwind-campaign/specs/weekly-report.yaml', import.meta.url);
  const spec = parse(await readFile(file, 'utf8'));
  const schema = spec.metadata.tool_schemas.Skill;
  expect(validateStrict({ skill: 'weekly-report', args: 'week 43' }, schema)).toEqual([]);
  expect(validateStrict({ skill: 'invented-skill', args: 'week 43' }, schema).length).toBeGreaterThan(0);
  expect(validateStrict({ skill: 'weekly-report', invented: true }, schema).length).toBeGreaterThan(0);
});

it('checks the invoice skill and matching rules at the clarification block where the live trace loads them', async () => {
  const file = new URL('../../../examples/northwind-campaign/specs/invoice-over.yaml', import.meta.url);
  const spec = parse(await readFile(file, 'utf8'));
  expect(spec.blocks[0].expect.skills).toContainEqual({ name: 'invoice-reconcile', count: { min: 1 } });
  expect(spec.blocks[0].expect.references).toContainEqual({ path: '**/matching-rules.md', count: { min: 1 } });
  expect(spec.blocks[1].expect.execution).toEqual({ ran_code: true });
  expect(spec.blocks[1].expect.subagents).toContainEqual({ name: 'ledger-auditor', count: { min: 1 } });
  expect(spec.blocks[1].expect.regex).toContain('60\\.00 EUR');
});
