import { parseSpecText } from '@agent-nexus/driftbench-core';
import { expect, it } from 'vitest';
import { generateEstateSuite } from '../../src/estate/generate';
import { APPROVED_PLAN, fixtureInputs, PLANNER_PATHS } from './support';

const GUARD = 'guard.settings.posttooluse-bash-guard-ledger-guard-py';

it('asks the live positive tests of the ledger guard with an approved request that runs the delete itself', async () => {
  const result = generateEstateSuite(await fixtureInputs(APPROVED_PLAN), { paths: PLANNER_PATHS });
  const own = result.specs.filter(
    (record) => record.testType === 'guard_positive' && record.mode === 'live' && record.atoms[0] === GUARD,
  );
  expect(own.length).toBeGreaterThan(0);
  for (const record of own) {
    expect(record.complete, record.id).toBe(true);
    const file = result.files.find((entry) => entry.path === record.path);
    const parsed = parseSpecText(file?.text ?? '', 'yaml', record.path);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const block = parsed.spec.blocks[0];
    const ask = String((block?.when as { user?: string } | undefined)?.user);
    // The guard watches a shell command: the ask instructs one that removes a file under ledger/.
    expect(ask, record.id).toMatch(/\brun\b.*\brm ledger\//i);
    const expectation = block?.expect as { workspace?: { deleted?: string[] } } | undefined;
    expect(expectation?.workspace?.deleted, record.id).toEqual(['ledger/2026-W41.csv']);
  }
}, 120_000);
