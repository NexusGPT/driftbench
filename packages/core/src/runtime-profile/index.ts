import { CLAUDE_CODE_PROFILE } from './claude-code';
import { registerRuntimeProfile } from './profile';

export { CLAUDE_CODE_PROFILE } from './claude-code';
export { CLAUDE_CODE_MAP_KINDS, CLAUDE_CODE_TYPES } from './claude-code-types';
export {
  coverageFolders,
  type LayoutProfile,
  loadsByItself,
  type PathVariables,
  PROFILE_ERROR_CODES,
  type ProfileError,
  type ProfileErrorCode,
  profileErrors,
  type RoutingRule,
  type RuntimeProfile,
  RuntimeProfileError,
  registerRuntimeProfile,
  renderedSettingsFile,
  runtimeProfile,
  runtimeProfileNames,
  type SettingsSource,
  type StandingProfile,
  staticSettingsFiles,
  variablePrefix,
} from './profile';

registerRuntimeProfile(CLAUDE_CODE_PROFILE);
