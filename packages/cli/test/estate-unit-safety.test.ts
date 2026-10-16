import { Expect, type Spec } from '@agent-nexus/driftbench-core';
import { ClaudeCodeReader } from '@agent-nexus/driftbench-estate';
import { expect, it } from 'vitest';
import { estate } from '../../estate/test/support';
import { runUnitSpecs } from '../src/commands/estate-unit-spec';

const unsupported = Object.keys(Expect.shape).filter((key) => !['guards', 'execution'].includes(key));
it.each(unsupported)('refuses unsupported expect.%s before executing any operation', async (key) => {
  const root = await estate({
    'CLAUDE.md': '# Fictional parcels\n',
    '.claude/marker.sh': '#!/bin/sh\nprintf specimen\n',
  });
  const spec = {
    id: 'unsupported',
    title: 'Fictional assertion',
    kind: 'task',
    target: { adapter: 'claude-code' },
    blocks: [
      {
        user: 'Inspect a parcel',
        expect: {
          execution: { exit_code: 0 },
          [key]:
            key === 'skills'
              ? [{ name: 'parcels', count: 1 }]
              : key === 'must'
                ? ['unseen phrase']
                : key === 'workspace'
                  ? { created: ['parcel.txt'] }
                  : null,
        },
      },
    ],
    metadata: {
      estate: {
        mode: 'unit',
        testType: 'script_fixture',
        unit: {
          target: { kind: 'script', path: '.claude/marker.sh' },
          cases: [{ id: 'sample', material: 'parcel', payload: {} }],
        },
      },
    },
  } as unknown as Spec;
  const result = await runUnitSpecs([spec], { root, reader: new ClaudeCodeReader(), noSandbox: true });
  expect(result.inputErrors.join('\n')).toContain(`expect.${key}`);
  expect(result.runs[0]?.pass).toBe(false);
  expect(result.scripts).toEqual([]);
});
