import { parseSpecText } from '@agent-nexus/driftbench-core';
import { expect, it } from 'vitest';
import { generateEstateSuite } from '../../src/estate/generate';
import { APPROVED_PLAN, fixtureInputs, PLANNER_PATHS } from './support';

const GUARD = 'guard.settings.pretooluse-edit-write-guard-read-before';

it('asks every positive test of the read-before-edit guard with a request that edits a file', async () => {
  const result = generateEstateSuite(await fixtureInputs(APPROVED_PLAN), { paths: PLANNER_PATHS });
  const own = result.specs.filter(
    (record) => record.testType === 'guard_positive' && record.complete && record.atoms[0] === GUARD,
  );
  expect(own.length).toBeGreaterThan(0);
  for (const record of own) {
    const file = result.files.find((entry) => entry.path === record.path);
    const parsed = parseSpecText(file?.text ?? '', 'yaml', record.path);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const when = parsed.spec.blocks[0]?.when as { user?: string } | undefined;
    // The guard stops an edit made before a read: the ask names the act it governs, an edit of a file.
    expect(when?.user, record.id).toMatch(/\bedit\b/i);
    expect(when?.user, record.id).toMatch(/\bfiles?\b/i);
  }
}, 120_000);
