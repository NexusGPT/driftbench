import { CLAUDE_CODE_PROFILE } from './claude-code';
import { registerRuntimeProfile } from './profile';

export { CLAUDE_CODE_PROFILE } from './claude-code';
export {
  type LayoutProfile,
  type PathVariables,
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
