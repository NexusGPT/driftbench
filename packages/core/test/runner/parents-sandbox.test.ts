import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSpec } from '../../src/runner/run';
import { blockStatus } from '../../src/runner/verdicts';
import { specOf } from './support';

/**
 * Parent blocks on a code agent in a sandbox: the files a parent leaves in its workspace are the child's
 * starting workspace, in a sandbox of its own. A tiny local agent, fictional Acme data, no model call.
 */

const AGENT = `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.DRIFTBENCH_WORKSPACE;
const ask = readFileSync(0, 'utf8').trim();
const notes = join(root, 'notes.txt');
if (ask === 'write') { writeFileSync(notes, 'Acme order ACME-7\\n'); console.log('saved'); }
else if (ask === 'binary') { writeFileSync(join(root, 'logo.bin'), Buffer.from([0xff, 0xfe, 0x00, 0x81])); console.log('saved'); }
else if (ask === 'append') { writeFileSync(notes, readFileSync(notes, 'utf8') + 'paid\\n'); console.log('appended'); }
else console.log(existsSync(notes) ? readFileSync(notes, 'utf8') : 'no notes');
`;

const driver = createScriptedDriver();
const checks = defaultChecks();
let parent: string;
let agent: string;

beforeAll(async () => {
  parent = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-parents-sandbox-')));
  agent = join(parent, 'agent.mjs');
  await writeFile(agent, AGENT);
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

function adapter() {
  return processAdapter({
    command: process.execPath,
    args: [agent],
    provider: localProvider({ dir: parent }),
    deterministic: true,
  });
}

describe('parent blocks on a sandboxed code agent', () => {
  it.each(['F', 'T'] as const)(
    '%s carries the parent workspace into the child sandbox, and isolates siblings and roots',
    async (mode) => {
      const spec = specOf({
        id: 'sandbox-parents',
        blocks: [
          { id: 'write', user: 'write', expect: { must: ['saved'] } },
          { id: 'read', parent: 'write', user: 'read', expect: { must: ['ACME-7'] } },
          { id: 'append', parent: 'write', user: 'append' },
          { id: 'after', parent: 'append', user: 'read', expect: { must: ['paid'] } },
          { id: 'sibling', parent: 'write', user: 'read', expect: { must_not: ['paid'] } },
          { id: 'fresh', user: 'read', expect: { must: ['no notes'] } },
        ],
      });
      const run = await runSpec(spec, { adapter: adapter(), driver, checks, mode, repeat: 0 });
      expect(run.blocks.map((block) => `${block.blockId}:${blockStatus(block)}`)).toEqual([
        'write:pass',
        'read:pass',
        'append:pass',
        'after:pass',
        'sibling:pass',
        'fresh:pass',
      ]);
    },
    30_000,
  );

  it('marks the children not run with the reason when the workspace cannot be exported', async () => {
    const spec = specOf({
      id: 'sandbox-binary',
      blocks: [
        { id: 'logo', user: 'binary' },
        { id: 'child', parent: 'logo', user: 'read' },
        { id: 'leaf', parent: 'child', user: 'read' },
        { id: 'other', user: 'read', expect: { must: ['no notes'] } },
      ],
    });
    const run = await runSpec(spec, { adapter: adapter(), driver, checks, mode: 'T', repeat: 0 });
    expect(run.blocks.map(blockStatus)).toEqual(['pass', 'not_run', 'blocked', 'pass']);
    expect(run.blocks[1]?.notRun).toMatchObject({ kind: 'setup_failed', check: 'parent snapshot' });
    expect(run.blocks[1]?.notRun?.got).toContain('logo.bin is not UTF-8 text');
    expect(run.blocks[2]?.blocked).toMatchObject({ by: 'child', root: 'child' });
  }, 30_000);

  it('marks the children not run when a sandbox adapter cannot export at all, never resetting them', async () => {
    const { snapshotGiven: _export, ...rest } = adapter();
    const spec = specOf({
      id: 'sandbox-unexported',
      blocks: [
        { id: 'write', user: 'write' },
        { id: 'read', parent: 'write', user: 'read', expect: { must: ['ACME-7'] } },
      ],
    });
    const run = await runSpec(spec, { adapter: rest, driver, checks, mode: 'T', repeat: 0 });
    expect(run.blocks.map(blockStatus)).toEqual(['pass', 'not_run']);
    expect(run.blocks[1]?.notRun).toMatchObject({ kind: 'unsupported', layer: '5 world' });
  }, 30_000);
});
