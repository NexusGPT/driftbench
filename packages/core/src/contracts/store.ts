import type { Campaign, Observed, RunResult } from '../schema/run';
import type { LoadedSpec } from '../spec/load';

/**
 * The store contract. The store keeps specs, campaigns, runs, the response cache and the measured
 * cost units. A campaign is immutable: a re-run is a new campaign that pins the same spec hashes.
 */

export type RunFilter = {
  campaignId?: string;
  specId?: string;
  mode?: RunResult['mode'];
  status?: RunResult['status'];
};

/** A measured unit cost, used to project a campaign's spend before it runs. */
export type CostUnit = {
  adapter: string;
  /** What was measured: block, judge_call, tool_call. */
  metric: string;
  usd: number;
  measuredAt: string;
  samples?: number;
};

export interface Store {
  putSpec(spec: LoadedSpec): Promise<void>;
  getSpec(id: string, hash: string): Promise<LoadedSpec | undefined>;

  putCampaign(campaign: Campaign): Promise<void>;
  getCampaign(campaignId: string): Promise<Campaign | undefined>;

  /** Stores a run under its campaign; the campaign must exist. A run put twice replaces the first (resume). */
  putRun(campaignId: string, run: RunResult): Promise<void>;
  /** A run id is the cell id, shared by the same cell in two campaigns; pass the campaign to pick one. */
  getRun(runId: string, campaignId?: string): Promise<RunResult | undefined>;
  listRuns(filter?: RunFilter): Promise<RunResult[]>;

  /** The cache key is the runner's: spec hash, block index, Given hash, target, adapter version. */
  cacheGet(key: string): Promise<Observed | undefined>;
  cachePut(key: string, observed: Observed, ttlMs?: number): Promise<void>;

  putUnit(unit: CostUnit): Promise<void>;
  listUnits(adapter?: string): Promise<CostUnit[]>;

  /** Writes a versioned JSON bundle of one campaign into a folder and returns its path. */
  exportCampaign(campaignId: string, dir: string): Promise<string>;
  close(): Promise<void>;
}
