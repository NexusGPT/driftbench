import { CLAUDE_CODE_PROFILE } from './claude-code';
import { registerRuntimeProfile } from './profile';

export { CLAUDE_CODE_PROFILE } from './claude-code';
export { CLAUDE_CODE_MAP_KINDS, CLAUDE_CODE_TYPES } from './claude-code-types';
export {
  type LayoutProfile,
  loadsByItself,
  type PathVariables,
  type PolicyModel,
  type PolicyTool,
  type RoutingRule,
  type RuntimeProfile,
  registerRuntimeProfile,
  runtimeProfile,
  runtimeProfileNames,
  type SettingsSource,
  type StandingProfile,
  staticSettingsFiles,
  variablePrefix,
} from './profile';

registerRuntimeProfile(CLAUDE_CODE_PROFILE);
