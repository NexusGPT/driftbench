/**
 * Stores a candidate campaign in which one Acme fault agent stands in for each Acme agent, so `driftbench
 * compare` and `driftbench report --baseline` can read it against a campaign of the real agents. The specs,
 * modes, repeats, checks and drivers are the CLI's own (`campaign run`): only the adapters change. The
 * campaign pins each spec on its target with the fault named as the variant, so the store says which agent
 * ran. Everything runs in process or in a local sandbox: no model is called. Fictional data only.
 *
 *   pnpm exec tsx examples/acme/reports/run-fault-campaign.ts --store <db> --campaign <id> \
 *     --fault x2-keeps-first-email --fault ops-d6-deletes-readme [--mode T,F,P] [--repeats 2]
 *
 * Exit 0 when the campaign is stored (its cells may fail: that is the point), 2 on bad input.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { classifyTool, defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type AgentAdapter,
  type Campaign,
  canonicalJson,
  injectingDriver,
  type LoadedSpec,
  loadSpecs,
  planCampaign,
  RunMode,
  runCampaign,
  type TargetRef,
} from '@agent-nexus/driftbench-core';
import { type FaultDef, faultAdapter } from '@agent-nexus/driftbench-generate';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { openStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { faults } from '../faults/index';

const { values } = parseArgs({
  options: {
    store: { type: 'string' },
    campaign: { type: 'string' },
    fault: { type: 'string', multiple: true },
    mode: { type: 'string', default: 'T,F,P' },
    repeats: { type: 'string', default: '2' },
    specs: { type: 'string', default: 'examples/acme/specs' },
    'created-at': { type: 'string' },
  },
});

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

if (!values.store || !values.campaign) fail('Give --store <db> and --campaign <id>.');
const chosen: FaultDef[] = (values.fault ?? []).map(
  (id) => faults.find((fault) => fault.id === id) ?? fail(`No fault ${id} in examples/acme/faults.`),
);
const modes = (values.mode ?? 'T,F,P').split(',').map((text) => {
  const mode = RunMode.safeParse(text.trim());
  return mode.success ? mode.data : fail(`Unknown mode ${text}.`);
});
const repeats = Number(values.repeats);
if (!Number.isInteger(repeats) || repeats < 1) fail('--repeats takes a whole number of at least 1.');

/** The target a spec runs on in this campaign: its own, with the fault that wraps it named as the variant. */
function faultTarget(own: TargetRef): { target: TargetRef; fault?: FaultDef } {
  const name = own.agent === undefined ? own.adapter : `${own.adapter}:${own.agent}`;
  const fault = chosen.find((entry) => entry.target === name);
  return fault ? { target: { ...own, variant: `fault-${fault.id}` }, fault } : { target: own };
}

const loaded: LoadedSpec[] = [];
for (const result of await loadSpecs([resolve(values.specs ?? 'examples/acme/specs')])) {
  if (!result.ok) fail(`Invalid spec ${result.path}.`);
  loaded.push(result);
}

const sandboxes = await mkdtemp(join(tmpdir(), 'driftbench-fault-campaign-'));
const store = openStore(resolve(values.store));
let exit = 0;
try {
  const createdAt = values['created-at'] ?? new Date().toISOString();
  const adapters = new Map<string, AgentAdapter>();
  const cells = [];
  const pinned = [];
  for (const entry of loaded) {
    const own = entry.spec.target ?? fail(`${entry.spec.id} names no target.`);
    const { target, fault } = faultTarget(own);
    const key = canonicalJson(target);
    if (!adapters.has(key)) {
      if (fault)
        adapters.set(
          key,
          faultAdapter(fault, () => localProvider({ dir: sandboxes })),
        );
      else {
        const { acmeFunctionAdapter, acmeOpsAdapter } = await import(
          '../../../packages/cli/src/commands/campaign'
        );
        const real = own.adapter === 'process' ? await acmeOpsAdapter() : await acmeFunctionAdapter();
        adapters.set(key, real ?? fail(`No adapter for ${key}.`));
      }
    }
    await store.putSpec(entry);
    pinned.push({ id: entry.spec.id, hash: entry.hash, target });
    cells.push(...planCampaign([entry], [target], modes, repeats).cells);
  }
  const counts = { T: 0, F: 0, P: 0 };
  for (const mode of modes) counts[mode] = repeats;
  const campaign: Campaign = {
    campaignId: values.campaign as string,
    specs: pinned,
    targets: [...new Map(pinned.map((entry) => [canonicalJson(entry.target), entry.target])).values()],
    modes,
    repeats: counts,
    budgetUsd: 0,
    judge: { mode: 'system1', judges: [] },
    createdAt,
  };
  if (await store.getCampaign(campaign.campaignId)) fail(`Campaign ${campaign.campaignId} already exists.`);
  await store.putCampaign(campaign);
  const specs = new Map(loaded.map((entry) => [`${entry.spec.id}@${entry.hash}`, entry.spec]));
  const outcomes = await runCampaign({
    campaignId: campaign.campaignId,
    cells,
    specFor: (cell) => specs.get(`${cell.specId}@${cell.specHash}`) ?? fail(`No spec ${cell.specId}.`),
    adapterFor: (target) =>
      adapters.get(canonicalJson(target)) ?? fail(`No adapter for ${canonicalJson(target)}.`),
    driver: (cell) =>
      cell.perturbationId === undefined
        ? createScriptedDriver()
        : injectingDriver(createScriptedDriver(), cell.perturbationId),
    consequential: (label) => classifyTool(label) !== undefined,
    checks: defaultChecks(),
    artifacts: defaultReaders(),
    store,
    concurrency: 4,
  });
  const states = { pass: 0, fail: 0, failed: 0, stopped: 0, pending: 0 };
  for (const outcome of outcomes) states[outcome.state] += 1;
  process.stdout.write(
    `Campaign ${campaign.campaignId}: ${outcomes.length} cells, ${states.pass} pass, ${states.fail} fail, ${states.failed + states.stopped} did not complete. Faults: ${chosen.map((fault) => fault.id).join(', ') || 'none'}.\n`,
  );
} catch (cause) {
  process.stderr.write(`${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}\n`);
  exit = 2;
} finally {
  await store.close();
  await rm(sandboxes, { recursive: true, force: true });
}
process.exit(exit);
