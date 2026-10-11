import type { RunResult, Store } from '@driftbench/core';
import { z } from 'zod';

/**
 * The regression hook of an estate change: the replay suite runs over the recorded corpus, and each spec on
 * each session is compared with the previous replay kept in the store. Pass to pass holds the line; fail to
 * pass is the change's own case (red before, green after, on the same transcript); pass to fail is a
 * regression and needs a person. Without a store, or with no earlier replay in it, there is nothing to
 * compare and every run says so.
 */

export const Flip = z.enum(['pass_to_pass', 'fail_to_pass', 'pass_to_fail', 'fail_to_fail', 'no_previous']);
export type Flip = z.infer<typeof Flip>;

/** One spec on one session, as the replay reports it. */
export type ReplayOutcome = { spec: string; session: string; pass: boolean };

export const Regression = z.strictObject({
  campaign: z.string().min(1).describe('The replay campaign this change ran'),
  previous: z.string().min(1).nullable().describe('The stored replay campaign it was compared with'),
  store: z.string().nullable(),
  runs: z.array(
    z.strictObject({
      spec: z.string().min(1),
      session: z.string().min(1),
      before: z.enum(['pass', 'fail']).nullable(),
      after: z.enum(['pass', 'fail']),
      flip: Flip,
    }),
  ),
  counts: z.strictObject({
    pass_to_pass: z.number().int().min(0),
    fail_to_pass: z.number().int().min(0),
    pass_to_fail: z.number().int().min(0),
    fail_to_fail: z.number().int().min(0),
    no_previous: z.number().int().min(0),
  }),
  notes: z.array(z.string()),
});
export type Regression = z.infer<typeof Regression>;

const verdict = (pass: boolean): 'pass' | 'fail' => (pass ? 'pass' : 'fail');

/** Each current run against the previous run of the same spec on the same session. */
export function compareReplays(
  previous: readonly ReplayOutcome[] | undefined,
  current: readonly ReplayOutcome[],
): Pick<Regression, 'runs' | 'counts'> {
  const before = new Map((previous ?? []).map((run) => [`${run.spec}\n${run.session}`, run.pass]));
  const counts: Regression['counts'] = {
    pass_to_pass: 0,
    fail_to_pass: 0,
    pass_to_fail: 0,
    fail_to_fail: 0,
    no_previous: 0,
  };
  const runs = current.map((run) => {
    const prior = before.get(`${run.spec}\n${run.session}`);
    const flip: Flip =
      prior === undefined ? 'no_previous' : (`${verdict(prior)}_to_${verdict(run.pass)}` as Flip);
    counts[flip]++;
    return {
      spec: run.spec,
      session: run.session,
      before: prior === undefined ? null : verdict(prior),
      after: verdict(run.pass),
      flip,
    };
  });
  return { runs, counts };
}

/** A stored run's verdict, as the replay command reads it. */
export function runPassed(run: RunResult): boolean {
  return (
    run.status === 'completed' && run.blocks.every((block) => block.pass) && run.endState?.match !== false
  );
}

/**
 * The latest replay campaign the store holds (newest first, as the store lists them), with the outcome of
 * each of its runs. A replay campaign's id starts with `replay-`; the session is the run target's agent.
 */
export async function latestReplay(
  store: Store,
): Promise<{ campaignId: string; outcomes: ReplayOutcome[] } | undefined> {
  const campaign = (await store.listCampaigns()).find((entry) => entry.campaignId.startsWith('replay-'));
  if (!campaign) return undefined;
  const runs = await store.listRuns({ campaignId: campaign.campaignId });
  return {
    campaignId: campaign.campaignId,
    outcomes: runs.map((run) => ({
      spec: run.specId,
      session: run.target.agent ?? run.target.adapter,
      pass: runPassed(run),
    })),
  };
}

/** The lines a person reads, and what needs one: every pass that turned into a fail. */
export function renderRegression(regression: Regression): string[] {
  const c = regression.counts;
  const lines = [
    `Replay of ${regression.runs.length} ${regression.runs.length === 1 ? 'run' : 'runs'}, campaign ${regression.campaign}, ${regression.previous === null ? (regression.store === null ? 'no store given: nothing to compare' : 'no earlier replay in the store: nothing to compare') : `against ${regression.previous}`}.`,
    `  pass to pass ${c.pass_to_pass}, fail to pass ${c.fail_to_pass}, pass to fail ${c.pass_to_fail}, fail to fail ${c.fail_to_fail}, no previous ${c.no_previous}.`,
  ];
  for (const run of regression.runs) {
    if (run.flip === 'fail_to_pass' || run.flip === 'pass_to_fail') {
      lines.push(
        `  ${run.flip === 'fail_to_pass' ? 'fixed' : 'broke'}: ${run.spec} on ${run.session}, ${run.flip.replace(/_/g, ' ')}`,
      );
    }
  }
  for (const note of regression.notes) lines.push(`  note: ${note}`);
  return lines;
}

export function regressionNeeds(regression: Regression): string[] {
  return regression.runs
    .filter((run) => run.flip === 'pass_to_fail')
    .map((run) => `regression: ${run.spec} on the session ${run.session} passed before and fails now`);
}
