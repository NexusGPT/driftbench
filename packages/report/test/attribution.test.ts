import { blame } from '@agent-nexus/driftbench-checks';
import type { RunResult } from '@agent-nexus/driftbench-core';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AttributionOptions,
  attributionOf,
  blockOutcome,
  type ReportDiagnosis,
  type ReportFix,
} from '../src/attribution';
import { type CampaignData, loadCampaign, runPassed, specOfRun } from '../src/data';
import { renderHtml, renderRun } from '../src/html';
import { attributionZone } from '../src/html-attribution';
import { buildScorecard } from '../src/scorecard';
import { attributionText } from '../src/text';
import { storeAcmeCampaign } from './support';

/**
 * The second score on the scorecard and the run page (codeagent_equivalence_blame.md E5), on the stored Acme
 * campaign with the x3 fault: the diagnoses come from the shipped blame and placement files, the fix list from
 * the fix plan. The machine pass rate never changes; the machine rate includes all completed runs, while the agent-attributed rate excludes unassigned runs.
 */

let fault: CampaignData;

beforeAll(async () => {
  const store = openMemoryStore();
  await storeAcmeCampaign(store, {
    campaignId: 'c-acme-x3',
    modes: ['T', 'F', 'P'],
    repeats: 2,
    fault: 'x3-skips-recap',
  });
  fault = await loadCampaign(store, 'c-acme-x3');
  await store.close();
}, 120_000);

/**
 * The lines of the Acme sales prompt two of its checks verify (examples/acme prompt, "Explicit confirmation" and
 * "The recap"): the links a block carries with relation verifies. Every other failing check has no link, so its
 * failure stays unassigned.
 */
const LINKS = [
  { verdict: 'forbidden.order.create', home: 'core', act: 'gate', file: 'prompts/acme-sales.md', line: 71 },
  { verdict: 'stage.reached', home: 'core', act: 'stage', file: 'prompts/acme-sales.md', line: 68 },
];

/** Diagnoses of every failing block, by run and block, and the campaign's fix plan, from the shipped files. */
function attribution(data: CampaignData): AttributionOptions {
  const diagnoses: Record<string, Record<number, ReportDiagnosis[]>> = {};
  const campaign: blame.CampaignDiagnosis[] = [];
  for (const run of data.runs) {
    const spec = specOfRun(data, run);
    for (const block of run.blocks) {
      if (block.pass) continue;
      const specBlock = spec?.blocks[block.index];
      const result = blame.diagnoseBlock({
        verdicts: block.verdicts,
        evidenceFor: blame.blockEvidenceInputs({
          observed: block.observed,
          verdicts: block.verdicts,
          ...(specBlock?.expect === undefined ? {} : { expect: specBlock.expect }),
          ...(spec === undefined ? {} : { spec }),
          extra: { links: LINKS },
        }),
        ...(specBlock?.expect?.tools === undefined
          ? {}
          : { tools: specBlock.expect.tools.filter((tool) => tool.count !== 0).map((tool) => tool.label) }),
        blame: blame.shippedPolicy('policy/blame'),
        placement: blame.shippedPolicy('policy/placement'),
      });
      diagnoses[run.runId] = {
        ...(diagnoses[run.runId] ?? {}),
        [block.index]: result.diagnoses.map(blame.toStepOutput),
      };
      campaign.push(...result.diagnoses.map((one) => ({ ...one, block: `${run.runId}#${block.index}` })));
    }
  }
  const plan = blame.fixPlan(campaign, blame.shippedPolicy('policy/placement'));
  const fixes: ReportFix[] = plan.fixes.map((fix) => ({
    fixLocation: fix.fix_location,
    ...(fix.fix_target === undefined ? {} : { fixTarget: fix.fix_target }),
    fixAction: fix.fix_action,
    blocks: fix.blocks,
    agentBlocks: fix.agent_blocks,
    removeCopies: fix.remove_copies,
    ...(fix.superseded_by === undefined ? {} : { supersededBy: fix.superseded_by }),
    confidence: fix.confidence,
  }));
  return { diagnoses, fixes };
}

describe('the two scores on the Acme x3 campaign', () => {
  it('keeps the machine pass rate of the scorecard, and adds the agent-attributed one', () => {
    const plain = buildScorecard(fault);
    const card = buildScorecard(fault, { attribution: attribution(fault) });
    expect(plain.attribution).toBeUndefined();
    const summary = card.attribution;
    expect(summary).toBeDefined();
    const completed = fault.runs.filter((run) => run.status === 'completed');
    expect(summary?.machine?.k).toBe(completed.filter(runPassed).length);
    expect(summary?.machine?.n).toBe(completed.length);
    expect(card.campaign.passing).toBe(plain.campaign.passing);
    const decided = (summary?.agent?.n ?? 0) + (summary?.unassigned ?? 0);
    expect(decided).toBe(completed.length);
  });

  it('renders the same scorecard as before when no block carries a diagnosis', () => {
    expect(renderHtml(buildScorecard(fault, { attribution: {} }))).toBe(renderHtml(buildScorecard(fault)));
  });

  it('matches the committed snapshots: the zone, its text, and one failing run page', async () => {
    const options = attribution(fault);
    const card = buildScorecard(fault, { attribution: options, maxRuns: 3 });
    await expect(attributionZone(card.attribution)).toMatchFileSnapshot(
      './__snapshots__/acme-x3-attribution.html',
    );
    await expect(`${attributionText(card.attribution).join('\n')}\n`).toMatchFileSnapshot(
      './__snapshots__/acme-x3-attribution.txt',
    );
    const failing = card.drilldown.find(
      (run) => !run.pass && run.blocks.some((block) => block.diagnoses !== undefined),
    );
    expect(failing).toBeDefined();
    // The run's events carry wall-clock times; the page without them is the same bytes every time.
    const { events: _events, ...steady } = failing as NonNullable<typeof failing>;
    await expect(renderRun(steady)).toMatchFileSnapshot('./__snapshots__/acme-x3-attribution-run.html');
    expect(renderHtml(card)).toContain('id="attribution"');
  });

  it('shows a badge on a page scored with a non-default rule file, and none with the defaults', () => {
    const options = attribution(fault);
    const custom = buildScorecard(fault, {
      attribution: {
        ...options,
        objects: [{ kind: 'policy/blame', id: 'northwind', hash: '0123456789abcdef' }],
      },
      maxRuns: 1,
    });
    expect(custom.attribution?.nonDefault).toEqual(['policy/blame:northwind@0123456789abcdef']);
    expect(renderHtml(custom)).toContain(
      '<span class="badge">non-default</span> Scored with policy/blame:northwind@0123456789abcdef.',
    );
    const run = custom.drilldown[0];
    expect(run?.nonDefault).toEqual(['policy/blame:northwind@0123456789abcdef']);
    expect(renderRun(run as NonNullable<typeof run>)).toContain('non-default');
    const shipped = buildScorecard(fault, {
      attribution: { ...options, objects: [{ kind: 'policy/blame', id: 'default' }] },
    });
    expect(shipped.attribution?.nonDefault).toEqual([]);
    expect(renderHtml(shipped)).not.toContain('<span class="badge">non-default</span>');
  });
});

describe('unassigned stays in the machine denominator and outside the agent-attributed rate', () => {
  const block = (pass: boolean, ids: string[]): RunResult['blocks'][number] =>
    ({
      index: 0,
      pass,
      verdicts: ids.map((id) => ({
        id,
        kind: 'machine',
        name: 'tools',
        gating: true,
        outcome: 'fail',
        evidence: id,
      })),
    }) as unknown as RunResult['blocks'][number];

  it('a block passes for the agent only when every failure is setup, excluded or credited', () => {
    expect(
      blockOutcome(block(false, ['a', 'b']), [
        { verdictRef: 'a', disposition: 'setup' },
        { verdictRef: 'b', disposition: 'credited' },
      ]),
    ).toBe('pass');
    expect(
      blockOutcome(block(false, ['a', 'b']), [
        { verdictRef: 'a', disposition: 'setup' },
        { verdictRef: 'b', disposition: 'unassigned' },
      ]),
    ).toBe('unassigned');
    expect(
      blockOutcome(block(false, ['a', 'b']), [
        { verdictRef: 'a', disposition: 'unassigned' },
        { verdictRef: 'b', disposition: 'agent' },
      ]),
    ).toBe('fail');
    expect(blockOutcome(block(false, ['a']), [])).toBe('unassigned');
  });

  it('leaves an unassigned run out of the agent rate and keeps it out of the machine numerator', () => {
    const runs = [true, false, false].map(
      (pass, i) =>
        ({
          runId: `r${i}`,
          status: 'completed',
          blocks: [block(pass, pass ? [] : ['a'])],
        }) as unknown as RunResult,
    );
    const data = { runs } as unknown as CampaignData;
    const summary = attributionOf(data, {
      diagnoses: {
        r1: { 0: [{ verdictRef: 'a', disposition: 'credited' }] },
        r2: { 0: [{ verdictRef: 'a', disposition: 'unassigned' }] },
      },
    });
    expect(summary?.machine).toMatchObject({ k: 1, n: 3 });
    expect(summary?.agent).toMatchObject({ k: 2, n: 2 });
    expect(summary?.unassigned).toBe(1);
    expect(summary?.blocks).toMatchObject({ failing: 2, credited: 1, unassigned: 1, agent: 0 });
  });
});
