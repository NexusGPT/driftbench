import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { Campaign, RunResult } from '@driftbench/core';
import { describeCause, describeIssues, StoreError } from './errors';
import { SCHEMA_VERSION } from './schema';

/** The `format` every campaign bundle manifest carries. */
export const BUNDLE_FORMAT = 'driftbench-campaign';

const MANIFEST = 'manifest.json';
const CAMPAIGN = 'campaign.json';
const RUNS = 'runs';

/** The first file a reader opens. It is written last, so a bundle without one did not finish. */
export type BundleManifest = {
  format: typeof BUNDLE_FORMAT;
  schemaVersion: number;
  campaignId: string;
  counts: { runs: number; blocks: number };
};

/** One campaign as a bundle holds it. */
export type CampaignBundle = {
  manifest: BundleManifest;
  campaign: Campaign;
  runs: RunResult[];
};

/**
 * Writes `<dir>/<campaignId>/campaign.json`, `runs/<runId>.json` and `manifest.json`, and returns
 * the folder. Records are pretty printed for review and diff. The old manifest goes first and the new
 * one comes last, so an interrupted export leaves a folder that `readCampaignBundle` refuses.
 */
export async function writeCampaignBundle(
  dir: string,
  campaign: Campaign,
  runs: readonly RunResult[],
): Promise<string> {
  const folder = resolve(dir, fileName(campaign.campaignId));
  const names = new Map<string, string>();
  for (const run of runs) {
    const name = `${fileName(run.runId)}.json`;
    const clash = names.get(name.toLowerCase());
    if (clash !== undefined) {
      throw new StoreError(
        'BUNDLE_INVALID',
        `runs ${clash} and ${run.runId} would share one file name on a case-insensitive disk`,
      );
    }
    names.set(name.toLowerCase(), run.runId);
  }

  await mkdir(join(folder, RUNS), { recursive: true });
  await rm(join(folder, MANIFEST), { force: true });
  await writeJson(join(folder, CAMPAIGN), campaign);
  for (const run of runs) await writeJson(join(folder, RUNS, `${fileName(run.runId)}.json`), run);
  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    campaignId: campaign.campaignId,
    counts: { runs: runs.length, blocks: runs.reduce((total, run) => total + run.blocks.length, 0) },
  };
  await writeJson(join(folder, MANIFEST), manifest);
  return folder;
}

/**
 * Reads a folder `exportCampaign` wrote, validating the manifest, the campaign and every run with
 * their schemas, and checking the counts against the manifest. Any gap raises `BUNDLE_INVALID`.
 */
export async function readCampaignBundle(folder: string): Promise<CampaignBundle> {
  const manifest = checkManifest(await readJson(join(folder, MANIFEST), folder), folder);

  const campaign = Campaign.safeParse(await readJson(join(folder, CAMPAIGN), folder));
  if (!campaign.success) {
    throw invalid(
      folder,
      `${CAMPAIGN} does not match the Campaign schema: ${describeIssues(campaign.error.issues)}`,
    );
  }
  if (campaign.data.campaignId !== manifest.campaignId) {
    throw invalid(
      folder,
      `${CAMPAIGN} holds campaign ${campaign.data.campaignId}, the manifest names ${manifest.campaignId}`,
    );
  }

  const files = (await listJsonFiles(join(folder, RUNS))).sort();
  const runs: RunResult[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const parsed = RunResult.safeParse(await readJson(join(folder, RUNS, file), folder));
    if (!parsed.success) {
      throw invalid(
        folder,
        `${RUNS}/${file} does not match the RunResult schema: ${describeIssues(parsed.error.issues)}`,
      );
    }
    if (seen.has(parsed.data.runId)) throw invalid(folder, `run ${parsed.data.runId} appears in two files`);
    seen.add(parsed.data.runId);
    runs.push(parsed.data);
  }

  const blocks = runs.reduce((total, run) => total + run.blocks.length, 0);
  if (runs.length !== manifest.counts.runs || blocks !== manifest.counts.blocks) {
    throw invalid(
      folder,
      `it holds ${runs.length} runs and ${blocks} blocks, its manifest counts ${manifest.counts.runs} and ${manifest.counts.blocks}; export into an empty folder`,
    );
  }
  return { manifest, campaign: campaign.data, runs };
}

function checkManifest(value: unknown, folder: string): BundleManifest {
  const manifest = (value ?? {}) as Partial<Record<keyof BundleManifest, unknown>>;
  if (manifest.format !== BUNDLE_FORMAT) {
    throw invalid(folder, `${MANIFEST} is not a ${BUNDLE_FORMAT} manifest`);
  }
  const version = manifest.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw invalid(folder, `${MANIFEST} has no schema version`);
  }
  if (version > SCHEMA_VERSION) {
    throw new StoreError(
      'SCHEMA_VERSION',
      `the bundle at ${folder} has schema version ${version}; this version of driftbench reads ${SCHEMA_VERSION} and older`,
    );
  }
  const counts = (manifest.counts ?? {}) as Record<string, unknown>;
  if (
    typeof manifest.campaignId !== 'string' ||
    manifest.campaignId === '' ||
    !isCount(counts.runs) ||
    !isCount(counts.blocks)
  ) {
    throw invalid(folder, `${MANIFEST} needs a campaignId and whole counts of runs and blocks`);
  }
  return {
    format: BUNDLE_FORMAT,
    schemaVersion: version,
    campaignId: manifest.campaignId,
    counts: { runs: counts.runs, blocks: counts.blocks },
  };
}

/**
 * An id as a file name: percent-encoded like a URI component, plus `*` and a leading dot, so no id
 * can name a parent folder, a hidden file or a path.
 */
function fileName(id: string): string {
  return encodeURIComponent(id).replace(/\*/g, '%2A').replace(/^\./, '%2E');
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(path: string, folder: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    throw invalid(folder, `cannot read ${relative(folder, path)}: ${describeCause(cause)}`, cause);
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw invalid(folder, `${relative(folder, path)} is not JSON: ${describeCause(cause)}`, cause);
  }
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function invalid(folder: string, message: string, cause?: unknown): StoreError {
  return new StoreError(
    'BUNDLE_INVALID',
    `the bundle at ${folder} is invalid: ${message}`,
    cause === undefined ? undefined : { cause },
  );
}
