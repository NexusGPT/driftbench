import { resolve } from 'node:path';
import {
  type Campaign,
  completeBaselineProvenance,
  loadChangeManifest,
  loadSpecs,
  planCampaign,
  prepareRejudge,
  type RunResult,
  rejudgeRun,
} from '@agent-nexus/driftbench-core';
import { loadCampaign } from '@agent-nexus/driftbench-report';
import { openStore } from '@agent-nexus/driftbench-store';
import type { Command } from 'commander';
import type { Io } from '../io';
import { addJudgeOptions, type RunJudgeOptions, runJudgeFrom } from './run-judge';

type Options = RunJudgeOptions & {
  from: string;
  campaign: string;
  store: string;
  change: string;
  maxCarry?: string;
  maxAge?: string;
  json?: boolean;
};
export function registerCampaignRejudge(campaign: Command, io: Io, setExit: (code: number) => void): void {
  addJudgeOptions(
    campaign
      .command('rejudge')
      .description('Judge selected criteria on compatible stored observations, without calling the agent.')
      .argument('<paths...>', 'the new spec files or folders')
      .requiredOption('--from <campaign>', 'the stamped baseline campaign')
      .requiredOption('--campaign <id>', 'a new campaign id')
      .requiredOption('--store <file>', 'the baseline and output store')
      .requiredOption(
        '--change <manifest>',
        'criterion-only manifest, with the same from and to agent version',
      )
      .option('--max-carry <n>', 'maximum consecutive carries', '5')
      .option('--max-age <days>', 'maximum age of the observations', '7')
      .option('--json', 'print the re-judge summary as JSON'),
  ).action(async (paths: string[], options: Options) => {
    setExit(await campaignRejudge(paths, options, io));
  });
}

export async function campaignRejudge(paths: string[], options: Options, io: Io): Promise<number> {
  let store: ReturnType<typeof openStore> | undefined;
  try {
    const manifest = await loadChangeManifest(resolve(io.cwd, options.change));
    if (!manifest.ok) throw new Error(manifest.errors.join('\n'));
    const change = manifest.manifest;
    if (
      change.from !== change.to ||
      !change.changes.length ||
      change.changes.some((c) => c.kind !== 'criterion' || !c.id)
    )
      throw new Error(
        'Re-judge needs a criterion-only manifest with identical from/to agent versions; otherwise rerun the agent.',
      );
    const maxCarry = Number(options.maxCarry ?? 5);
    const maxAgeDays = Number(options.maxAge ?? 7);
    if (!Number.isInteger(maxCarry) || maxCarry < 0 || !Number.isFinite(maxAgeDays) || maxAgeDays < 0)
      throw new Error('Carry limits must be nonnegative; --max-carry must be a whole number.');
    store = openStore(resolve(io.cwd, options.store));
    if (await store.getCampaign(options.campaign))
      throw new Error(`Campaign ${options.campaign} already exists.`);
    const data = await loadCampaign(store, options.from);
    if (!completeBaselineProvenance({ provenance: data.campaign.provenance, runs: data.runs }))
      throw new Error(
        'Legacy campaign has missing, incomplete or inconsistent execution provenance; run a new full campaign before re-judging.',
      );
    const results = await loadSpecs(paths.map((p) => resolve(io.cwd, p)));
    const loaded = results.filter((r) => r.ok);
    if (!loaded.length || loaded.length !== results.length)
      throw new Error('The new specs are invalid or empty.');
    if (
      new Set(loaded.map((l) => l.spec.id)).size !== loaded.length ||
      loaded.length !== data.campaign.specs.length
    )
      throw new Error('Re-judge requires exactly the baseline specs, with unique ids.');
    const specs = new Map(loaded.map((l) => [l.spec.id, l]));
    if (change.changes.some((c) => !loaded.some((l) => l.spec.criteria?.some((def) => def.name === c.id))))
      throw new Error('A selected criterion is not defined in the new specs.');
    const now = new Date();
    const prepared = data.runs.map((run) => {
      const old = data.specs.get(`${run.specId}@${run.specHash}`);
      const next = specs.get(run.specId);
      if (!old || !next) throw new Error(`Missing pinned spec ${run.specId}; rerun the agent.`);
      return prepareRejudge(old.spec, next.spec, run, {
        fromCampaign: options.from,
        baselineProvenance: data.campaign.provenance,
        agentVersion: change.from,
        criteria: change.changes.flatMap((c) => (c.id ? [c.id] : [])),
        maxCarry,
        maxAgeDays,
        now,
      });
    });
    for (const pinned of data.campaign.specs) {
      const old = data.specs.get(`${pinned.id}@${pinned.hash}`);
      if (!old) throw new Error(`Missing old spec ${pinned.id}`);
      const expected = planCampaign(
        [old],
        pinned.target ? [pinned.target] : data.campaign.targets,
        data.campaign.modes,
        data.campaign.repeats,
      ).cells;
      if (expected.some((cell) => !data.runs.some((run) => run.runId === cell.cellId)))
        throw new Error('Baseline campaign is incomplete; rerun the agent.');
    }
    if (!prepared.length) throw new Error('Baseline campaign contains no observations; rerun the agent.');
    if (!options.judge) throw new Error('Re-judge requires --judge claude:<model>.');
    const judge = await runJudgeFrom(options, io);
    if (!judge) return 2;
    const campaign: Campaign = {
      ...data.campaign,
      campaignId: options.campaign,
      createdAt: now.toISOString(),
      judge: { mode: 'llm', judges: [judge.label] },
      specs: data.campaign.specs.map((p) => ({ ...p, hash: specs.get(p.id)?.hash ?? p.hash })),
      rejudged: prepared.map((p) => p.stamp),
    };
    delete campaign.radius;
    if (campaign.sources) campaign.sources = campaign.sources.filter((source) => source.kind === 'prompt');
    // Preflight above completes before any call or write. Store the new campaign so a failed judge
    // remains an explicit inconclusive result, never a silent carry of the previous judge verdict.
    for (const loadedSpec of loaded) await store.putSpec(loadedSpec);
    await store.putCampaign(campaign);
    const runs: RunResult[] = [];
    for (const item of prepared) {
      const run = await rejudgeRun(item, judge.check, () => judge.spend.usd);
      await store.putRun(campaign.campaignId, run);
      runs.push(run);
    }
    const summary = {
      campaign: campaign.campaignId,
      from: options.from,
      agentCalls: 0,
      rejudged: runs.flatMap((r) => r.blocks).filter((b) => b.rejudged).length,
      carried: runs.flatMap((r) => r.blocks).filter((b) => !b.rejudged).length,
      judgeCostUsd: judge.spend.usd,
    };
    io.out(
      options.json
        ? `${JSON.stringify(summary, null, 2)}\n`
        : `Campaign ${summary.campaign}: ${summary.rejudged} blocks re-judged, ${summary.carried} carried; 0 agent calls. Judge cost ${summary.judgeCostUsd.toFixed(4)} USD.\n`,
    );
    return runs.every((r) => r.blocks.every((b) => b.pass) && r.endState?.match !== false) ? 0 : 1;
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  } finally {
    await store?.close();
  }
}
