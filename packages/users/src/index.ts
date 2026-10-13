/** User drivers: scripted, perturbing and simulated, the red-team pack and recovery. */
export const packageName = '@agent-nexus/driftbench-users';
export {
  AttackError,
  type AttackOptions,
  type AttackRecording,
  type AttackResult,
  type AttackRound,
  type Cue,
  cuesOf,
  runAttack,
} from './attack';
export {
  type Carrier,
  DEVIATIONS,
  type DeviationDef,
  deviationClassOf,
  isWorldClass,
} from './deviations';
export {
  createPerturbingDriver,
  type DrawnPerturbation,
  fromPhrasing,
  isWorldOnly,
  PerturbationError,
  type PerturbationSource,
  type PerturbingDriver,
  type PerturbingDriverOptions,
  resolvePerturbation,
} from './perturb';
export { seededIndex } from './random';
export {
  checkPackFile,
  type DrawOptions,
  drawPhrasing,
  loadRedteamPack,
  PackFile,
  Phrasing,
  type PhrasingKind,
  PhrasingKinds,
  type RedteamPack,
  RedteamPackError,
  redteamPack,
} from './redteam';
export {
  HARM_PLUGINS,
  loadRedteamPlugins,
  PluginFamilies,
  type PluginFamily,
  type PluginToSpecOptions,
  POLICY_PLUGINS,
  pluginToSpec,
  REDTEAM_PLUGINS,
  RedteamPlugin,
  renderPlugin,
  renderText,
  SECURITY_PLUGINS,
  SKIPPED_PLUGINS,
  type SkippedPlugin,
} from './redteam-plugins/index';
export { createScriptedDriver } from './scripted';
export {
  checkUserFamilies,
  createSimulatedUser,
  describePersona,
  loadPersona,
  loadUserRecording,
  Persona,
  personaOptions,
  type SimulatedUser,
  SimulatedUserError,
  type SimulatedUserOptions,
  type UserModelPort,
  UserRecording,
  userRecordingPort,
} from './simulated';
