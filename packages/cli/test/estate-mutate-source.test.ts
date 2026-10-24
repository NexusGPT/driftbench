import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The command starts a copy of the fixture; under a full parallel suite that takes more than the default.
vi.setConfig({ testTimeout: 60_000 });

const seen = vi.hoisted(() => ({ calls: [] as Array<{ root: string; source?: string }> }));

vi.mock('@agent-nexus/driftbench-estate', async (importOriginal) => {
  const real = await importOriginal<typeof import('@agent-nexus/driftbench-estate')>();
  return {
    ...real,
    mutateEstate: (copy: { root: string; source?: string }, ...rest: unknown[]) => {
      seen.calls.push({ root: copy.root, ...(copy.source !== undefined ? { source: copy.source } : {}) });
      return (real.mutateEstate as (...args: unknown[]) => unknown)(copy, ...rest);
    },
  };
});

import { type Io, main } from '../src/index';

const FIXTURE = fileURLToPath(new URL('../../../examples/estates/fixture', import.meta.url));
const made: string[] = [];
afterEach(async () => {
  while (made.length > 0) await rm(made.pop() ?? '', { recursive: true, force: true });
});

describe('driftbench estate mutate hands the estate to the mutation', () => {
  it('passes the estate folder as the source, so the copy is compared with it and collateral is reported', async () => {
    const to = join(await mkdtemp(join(tmpdir(), 'estate-mutate-source-')), 'mutant');
    made.push(join(to, '..'));
    const io: Io = { out: () => {}, err: () => {}, cwd: FIXTURE };
    const code = await main(
      [
        'estate',
        'mutate',
        join(FIXTURE, 'approved.yaml'),
        '--atom',
        'gate.standing.read-before-edit-it',
        '--delete',
        '--to',
        to,
      ],
      io,
    );
    expect(code).toBe(0);
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]?.root).toBe(to);
    expect(seen.calls[0]?.source).toBe(FIXTURE);
  });
});
