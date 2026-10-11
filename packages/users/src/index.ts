/** User drivers: scripted (phase 1), perturbing and simulated (phase 3), the red-team pack and recovery. */
export const packageName = '@driftbench/users';
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
export { createScriptedDriver } from './scripted';
export {
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
