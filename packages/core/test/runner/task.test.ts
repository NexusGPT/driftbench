import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processAdapter } from '@agent-nexus/driftbench-adapters';
import { type Check, loadSpecFile, RunResult } from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSpec } from '../../src/runner';
import { stageCheck } from './support';

/**
 * A task spec goes through the same runSpec as a conversation (owner rule of 2026-10-11): the Acme price
 * sheet task on the process adapter, with the fixture code agent of the sandbox package in a local
 * sandbox. The checks read the produced file through `CheckContext.readArtifact`, with no special case.
 */

const AGENT = fileURLToPath(new URL('../../../sandbox/test/fixtures/code-agent.mjs', import.meta.url));
const PRICE_SHEET = fileURLToPath(
  new URL('../../../../examples/acme/specs/tasks/price-sheet.yaml', import.meta.url),
);

let parent: string;
beforeAll(async () => {
  parent = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-runner-task-')));
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

describe('a task spec through runSpec', () => {
  it('runs the Acme price sheet task on the process adapter, and the checks read the workspace', async () => {
    const loaded = await loadSpecFile(PRICE_SHEET);
    if (!loaded.ok) throw new Error('the price sheet spec is invalid');
    const reads: string[] = [];
    const reader: Check = {
      name: 'workspace_read',
      applies: (ctx) => ctx.readArtifact !== undefined,
      async evaluate(ctx) {
        const bytes = await ctx.readArtifact?.('out/acme-price-sheet.csv');
        reads.push(new TextDecoder().decode(bytes));
        return [];
      },
    };
    const adapter = processAdapter({
      command: process.execPath,
      args: [AGENT],
      provider: localProvider({ dir: parent }),
    });
    const run = await runSpec(loaded.spec, {
      adapter,
      driver: createScriptedDriver(),
      checks: [stageCheck, reader],
      mode: 'F',
      repeat: 0,
    });
    expect(RunResult.safeParse(JSON.parse(JSON.stringify(run))).success).toBe(true);
    expect(run.status, run.error).toBe('completed');
    expect(run.specId).toBe('acme-price-sheet');
    expect(run.target).toEqual({ adapter: 'process', agent: 'acme-ops' });
    expect(run.blocks.map((block) => [block.stageObserved, block.pass])).toEqual([
      ['build_sheet', true],
      ['add_summary', true],
    ]);
    expect(run.blocks.map((block) => block.observed.workspaceDiff)).toEqual([
      { created: ['out/acme-price-sheet.csv'], changed: [], deleted: [] },
      { created: [], changed: ['out/acme-price-sheet.csv'], deleted: [] },
    ]);
    expect(run.blocks[0]?.observed.executions?.map((record) => record.role)).toEqual(['command', 'agent']);
    expect(reads).toHaveLength(2);
    expect(reads[0]).toContain('mobile-s,Acme Mobile S,mobile,15,180');
    expect(reads[0]).not.toContain('summary');
    expect(reads[1]).toContain('summary,Acme Air 5G,home,35,420');
    // The second block saw the first exchange: the runner's history reached the agent.
    expect(run.blocks[1]?.observed.text).toContain('History: 3 messages.');
  });
});
