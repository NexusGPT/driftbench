/**
 * @agent-nexus/driftbench-sandbox: the workspace a code agent works in for one run. A local sandbox is a temporary
 * folder (weak isolation); a docker sandbox is a container with that folder mounted (strong isolation).
 * Both seed the folder from the Given, snapshot it before and after a block, diff the snapshots, run
 * commands with bounded output and a timeout, read files with a bound, and remove the folder at the end.
 */
export const packageName = '@agent-nexus/driftbench-sandbox';
export { trackFolder, trackGroup, untrackFolder, untrackGroup } from './cleanup';
export { DOCKER_WORKSPACE, type DockerProviderOptions, DockerSandbox, dockerProvider } from './docker';
export {
  DEFAULT_EXEC_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_MAX_READ_BYTES,
  DEFAULT_SNAPSHOT_LIMITS,
  SandboxLimitError,
  SandboxPathError,
  SKIPPED_NAMES,
  type SnapshotLimits,
  TIMEOUT_EXIT_CODE,
} from './limits';
export { type LocalProviderOptions, LocalSandbox, localProvider } from './local';
export {
  type ApprovalAction,
  type ApprovalDecision,
  type ApprovalPolicy,
  type ApprovalRequest,
  type ApprovalRule,
  decide,
  type PolicedSandbox,
  SandboxApprovalError,
  withApprovalPolicy,
} from './policy';
export { REAP_GRACE_MS, reapFolder, reapFolderSync, runProcessesIn } from './reap';
export { diffSnapshots } from './walk';
