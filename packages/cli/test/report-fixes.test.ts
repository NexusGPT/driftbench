import { readFileSync } from 'node:fs';
import { blame } from '@agent-nexus/driftbench-checks';
import { type Diagnosis, initializeShippedObjects } from '@agent-nexus/driftbench-core';
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

  it('omits a superseded zero-block fix and preserves the ranked fixes in plan order', () => {
    const written = runs.flatMap((run) =>
      run.blocks.flatMap((block) =>
        block.diagnoses.map((raw) => {
          const diagnosis = raw as Diagnosis;
          return { runId: run.runId, blockIndex: block.index, verdictRef: diagnosis.verdictRef, diagnosis };
        }),
      ),
    );
    const plan = blame.fixPlan(blame.campaignDiagnoses(written), blame.shippedPolicy('policy/placement'), 10);
    expect(plan.fixes.some((fix) => fix.superseded_by !== undefined && fix.blocks === 0)).toBe(true);
    const ranked = plan.fixes.filter((fix) => fix.blocks > 0);
    const displayed = fixes.map((fix) => [fix.fixLocation, fix.fixTarget, fix.fixAction]);
    expect(displayed).toEqual(ranked.map((fix) => [fix.fix_location, fix.fix_target, fix.fix_action]));
    expect(fixes.every((fix) => fix.blocks > 0)).toBe(true);
  });

  it('caps more than ten eligible fixes including nonzero superseded copies in rank order', () => {
    const raw = runs.flatMap((run) => run.blocks.flatMap((block) => block.diagnoses)) as Diagnosis[];
    const trigger = raw.find((one) => one.fixLocation === 'skill.trigger');
    if (trigger === undefined) throw new Error('The stored fixture must contain a trigger diagnosis');
    const extra = Array.from({ length: 12 }, (_, index) => ({
      runId: `fictional-extra-${index}`,
      blocks: [
        {
          index: 0,
          diagnoses: [
            {
              ...trigger,
              fixTarget: `skill:fictional-${index}#description`,
              placement: `${trigger.placement.split('#')[0]}#fixed`,
            },
          ],
        },
      ],
    }));
    const localRule = raw.find((one) => one.fixLocation === 'skill.content');
    if (localRule === undefined) throw new Error('The stored fixture must contain a skill-rule diagnosis');
    // Three local homes of the same rule cause a core promotion with nonempty superseded copies.
    const promoted = Array.from({ length: 6 }, (_, index) => ({
      runId: `fictional-promoted-${index}`,
      blocks: [
        {
          index: 0,
          diagnoses: [
            {
              ...localRule,
              fixTarget: `skill:promoted-${Math.floor(index / 2)}#rule`,
              placement: `${localRule.placement.split('#')[0]}#skill_local`,
              evidence: { ...localRule.evidence, home: `promoted-${Math.floor(index / 2)}` },
            },
          ],
        },
      ],
    }));
    const many = { runs: [...runs, ...extra, ...promoted] } as unknown as typeof data;
    const written = many.runs.flatMap((run) =>
      run.blocks.flatMap((block) =>
        (block as { diagnoses: Diagnosis[] }).diagnoses.map((diagnosis) => ({
          runId: run.runId,
          blockIndex: block.index,
          verdictRef: diagnosis.verdictRef,
          diagnosis,
        })),
      ),
    );
    const all = blame.fixPlan(
      blame.campaignDiagnoses(written),
      blame.shippedPolicy('policy/placement'),
      written.length,
    ).fixes;
    expect(all.filter((fix) => fix.blocks > 0).length).toBeGreaterThan(10);
    expect(all.some((fix) => fix.blocks > 0 && fix.superseded_by !== undefined)).toBe(true);
    const expected = all.filter((fix) => fix.blocks > 0).slice(0, 10);
    const displayed = reportFixes(many);
    expect(displayed).toHaveLength(10);
    expect(displayed.map((fix) => [fix.fixLocation, fix.fixTarget, fix.fixAction])).toEqual(
      expected.map((fix) => [fix.fix_location, fix.fix_target, fix.fix_action]),
    );
  });

  it('is empty, and adds no option, for a campaign with no diagnosis', () => {
    const bare = { runs: [{ runId: 'r1', blocks: [{ index: 0 }] }] } as unknown as typeof data;
    expect(reportFixes(bare)).toEqual([]);
    expect(fixListOption(bare)).toEqual({});
  });
});
