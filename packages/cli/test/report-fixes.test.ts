import { readFileSync } from 'node:fs';
import { initializeShippedObjects } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { fixListOption, reportFixes } from '../src/report-fixes';

/**
 * The fix list of the report. The diagnoses are the ones `code-agent-liability` stored on the Northwind
 * campaign rehearsal (the stand-in runtime, three specs, repeat 0): what a stored campaign holds, not what a
 * test builds. Only the fields the list reads are kept: run ids, block indexes and diagnoses, one run a line.
 */

initializeShippedObjects();

type StoredRun = { runId: string; spec: string; blocks: Array<{ index: number; diagnoses: unknown[] }> };
const runs = readFileSync(new URL('./fixtures/northwind-diagnoses.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => line !== '')
  .map((line) => JSON.parse(line) as StoredRun)
  .map((run) => ({ runId: run.runId, blocks: run.blocks }));
const data = { runs } as unknown as Parameters<typeof reportFixes>[0];

describe('the report fix list', () => {
  const fixes = reportFixes(data);

  it('is not empty on a campaign whose blocks hold diagnoses', () => {
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixListOption(data).attribution?.fixes).toEqual(fixes);
  });

  it('names the causes the stored diagnoses name', () => {
    // A routed skill that was not loaded: the description of the skill is the fix.
    const trigger = fixes.find((fix) => fix.fixLocation === 'skill.trigger');
    expect(trigger?.fixAction).toBe('rewrite_description');
    expect(trigger?.fixTarget).toMatch(/^skill:(shipment-tracker|weekly-report)#description$/);
    // A skill rule the agent had and broke: the fix is the rule's wording, at the skill or in the core prompt.
    expect(fixes.some((fix) => fix.fixAction === 'strengthen_rule')).toBe(true);
  });

  it("counts each fix by the blocks it explains and the ones that are the agent's", () => {
    for (const fix of fixes) {
      expect(fix.blocks).toBeGreaterThanOrEqual(1);
      expect(fix.agentBlocks).toBeLessThanOrEqual(fix.blocks);
    }
    const total = fixes.reduce((sum, fix) => sum + fix.blocks, 0);
    expect(total).toBeGreaterThanOrEqual(4);
  });

  it("ranks the fixes that explain the agent's failing blocks first", () => {
    const agent = fixes.map((fix) => fix.agentBlocks);
    expect(agent).toEqual([...agent].sort((a, b) => b - a));
  });

  it('is empty, and adds no option, for a campaign with no diagnosis', () => {
    const bare = { runs: [{ runId: 'r1', blocks: [{ index: 0 }] }] } as unknown as typeof data;
    expect(reportFixes(bare)).toEqual([]);
    expect(fixListOption(bare)).toEqual({});
  });
});
