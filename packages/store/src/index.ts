/**
 * The result store: specs, campaigns, runs, the response cache and the measured cost units, in one
 * SQLite file through `node:sqlite` (Node.js 22.13 or newer), with a JSON bundle per campaign for
 * sharing.
 */
export const packageName = '@driftbench/store';

/** The cell id is the runner's own, so a resumed campaign finds the runs the store holds under it. */
export { type CellKey, cellId } from '@driftbench/core';
export { BUNDLE_FORMAT, type BundleManifest, type CampaignBundle, readCampaignBundle } from './bundle';
export { StoreError, type StoreErrorCode } from './errors';
export { SCHEMA_VERSION } from './schema';
export { assertNodeVersion, MIN_NODE_VERSION } from './sqlite';
export { openMemoryStore, openStore, type SqliteStore } from './store';
export {
  BLOCK_METRIC,
  type CostCell,
  type CostProjection,
  JUDGE_CALL_METRIC,
  measuredUnits,
  projectCost,
} from './units';
