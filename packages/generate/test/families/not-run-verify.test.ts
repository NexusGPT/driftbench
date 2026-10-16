/** Repros of the independent re-review of the not_run verdict: no unsent block reads as a failure. */

import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { loadSpecFile } from '@agent-nexus/driftbench-core';
import { expect, it } from 'vitest';
import { acmeAdapter } from '../../../core/test/runner/support';
import { verifySpec } from '../../src/families/verify';

it('unsupported family reference is unmeasured not failed', async () => {
  const file = process.cwd() + '/examples/acme/specs/conversations/tool-failure.yaml';
  const loaded = await loadSpecFile(file);
  if (!loaded.ok) throw new Error('fixture');
  const result = await verifySpec(file, loaded.spec, {
    adapter: acmeAdapter({ capabilities: { toolStubs: false } }),
    target: { adapter: 'function', agent: 'acme-sales' },
    checks: defaultChecks(),
    artifacts: defaultReaders(),
    cwd: process.cwd(),
  });
  expect(result.state).not.toBe('fail');
});
