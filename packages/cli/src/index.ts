export { type CampaignDeps, type CampaignScope, campaignRunCommand, defaultDeps } from './commands/campaign';
export { type CoverageOptions, coverageCommand } from './commands/coverage';
export { lintCommand, validateCommand } from './commands/spec';
export { type Io, processIo } from './io';
export { type MainOptions, main } from './main';
export {
  type DriftbenchPlugin,
  definePlugin,
  type PluginAdapterFactory,
  type PluginApi,
  type PluginScope,
} from './plugins';
export { VERSION } from './version';
